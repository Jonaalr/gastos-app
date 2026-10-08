/**
 * reconcile.js — Conciliación (SOLO LECTURA).
 *
 * Carga un estado de cuenta en PDF de una tarjeta, lo compara con los gastos
 * que ya registraste en ese periodo y muestra tres grupos:
 *   - Cuadran: el cargo del banco ya lo tienes registrado.
 *   - Falta en tu registro: está en el banco y en tu app no.
 *   - Solo en tu registro: lo tienes tú, pero no aparece en el estado.
 *
 * Esta pantalla NO escribe nada: ni agrega movimientos, ni borra, ni toca el saldo.
 * El PDF se lee en el teléfono y no se sube a ningún lado.
 */

const RECONCILE_WINDOW_DAYS = 3;

/** Suma n días a una fecha "YYYY-MM-DD" (en UTC para no cambiar de día por la zona horaria). */
function shiftISO(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compara los cargos de un estado de cuenta con los gastos registrados de la cuenta.
 * Función pura: no lee ni escribe la base de datos.
 *
 * @param parsed     resultado de importer.parse(lines) -> { info, movements }
 * @param allTx      todas las transacciones
 * @param accountId  id de la tarjeta
 */
function reconcileStatement(parsed, allTx, accountId) {
  const { info, movements } = parsed;
  const charges = movements.filter((m) => m.kind === "charge");
  const accountTx = allTx.filter((t) => t.accountId === accountId && t.type === "expense");

  if (charges.length === 0) {
    return { empty: true };
  }

  const dates = charges.map((m) => m.date).sort();
  const start = info.periodStart || dates[0];
  const end = info.periodEnd || dates[dates.length - 1];
  const poolFrom = shiftISO(start < dates[0] ? start : dates[0], -RECONCILE_WINDOW_DAYS);
  const poolTo = shiftISO(end > dates[dates.length - 1] ? end : dates[dates.length - 1], RECONCILE_WINDOW_DAYS);

  // Gastos que ya se importaron de este estado: si aparecen, el cargo ya está
  const importedKeys = new Set(accountTx.filter((t) => t.importKey).map((t) => t.importKey));
  // Gastos manuales que pueden corresponder a un cargo del banco
  const pool = accountTx.filter((t) => !t.importKey && t.date >= poolFrom && t.date <= poolTo);

  const used = new Set();
  const seen = {};
  const matched = [];
  const missing = [];

  for (const m of charges) {
    const base = `${info.last4}|${m.date}|${m.amountCents}|${StatementImporters.merchantKey(m.rawDescription)}`;
    seen[base] = (seen[base] || 0) + 1;
    const key = `${base}#${seen[base]}`;

    if (importedKeys.has(key)) {
      matched.push({ m, tx: null, imported: true });
      continue;
    }
    const hit = pool.find(
      (t) => !used.has(t.id) && t.amountCents === m.amountCents && Math.abs(DateUtil.daysBetween(t.date, m.date)) <= RECONCILE_WINDOW_DAYS
    );
    if (hit) {
      used.add(hit.id);
      matched.push({ m, tx: hit, imported: false });
    } else {
      missing.push({ m });
    }
  }

  const extra = pool.filter((t) => !used.has(t.id));

  const bankTotal = charges.reduce((s, m) => s + m.amountCents, 0);
  const myTotal = accountTx
    .filter((t) => t.date >= start && t.date <= end)
    .reduce((s, t) => s + t.amountCents, 0);

  return {
    empty: false,
    info,
    periodFrom: start,
    periodTo: end,
    bankTotal,
    myTotal,
    matched,
    missing,
    extra,
  };
}

async function renderReconcile(root, params) {
  const accountId = parseInt(params.get("account") || "0", 10) || 0;
  const account = await DB.get("accounts", accountId);
  root.innerHTML = "";

  root.appendChild(
    el("div", { class: "topbar" }, [
      el("button", { class: "btn btn-secondary btn-sm", onclick: () => Router.navigate(`/account?id=${accountId}`) }, "← Volver"),
    ])
  );
  root.appendChild(el("h1", { class: "page-title" }, "Conciliación"));

  if (!account || account.type !== "credit") {
    root.appendChild(el("p", { class: "muted" }, "Entra desde una tarjeta de crédito para conciliar su estado de cuenta."));
    return;
  }

  root.appendChild(
    el("p", { class: "muted" }, `Compara el estado de cuenta de ${account.name} con lo que ya registraste. Esta pantalla solo compara: no agrega, no borra y no cambia el saldo.`)
  );

  const status = el("p", { class: "muted" }, "");
  const results = el("div", {});
  const input = el("input", { type: "file", accept: "application/pdf" });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    results.innerHTML = "";
    status.textContent = "Leyendo el estado de cuenta…";
    try {
      const lines = await readPdfLines(file);
      const importer = StatementImporters.detect(lines);
      if (!importer) {
        status.textContent = "No reconozco ese estado de cuenta. ¿Es un PDF de estado de cuenta?";
        return;
      }
      const parsed = importer.parse(lines);
      if (account.statementLast4 && parsed.info.last4 && parsed.info.last4 !== account.statementLast4) {
        status.textContent = "Este estado de cuenta parece ser de otra tarjeta. Revisa cuál subiste.";
        return;
      }
      const allTx = await DB.getAll("transactions");
      const result = reconcileStatement(parsed, allTx, accountId);
      status.textContent = "";
      renderReconcileResult(results, result);
    } catch (err) {
      console.error(err);
      status.textContent = err && err.name === "PasswordException"
        ? "No se pudo abrir: contraseña incorrecta."
        : "No pude leer ese archivo.";
    }
  });

  root.appendChild(el("div", { class: "form-group" }, [el("label", {}, "Estado de cuenta (PDF)"), input]));
  root.appendChild(status);
  root.appendChild(results);
}

/** Dibuja el resultado de reconcileStatement dentro de un contenedor. Solo muestra datos. */
function renderReconcileResult(container, result) {
  container.innerHTML = "";
  if (result.empty) {
    container.appendChild(el("p", { class: "muted" }, "No encontré cargos en ese estado de cuenta."));
    return;
  }

  const diff = result.bankTotal - result.myTotal;
  const diffText = diff === 0
    ? "Tus registros cuadran con el total del banco."
    : diff > 0
      ? `Te faltan registrar ${Money.format(diff)}.`
      : `Registraste ${Money.format(-diff)} de más.`;

  container.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "muted" }, `Periodo ${DateUtil.formatShort(result.periodFrom)} – ${DateUtil.formatShort(result.periodTo)}`),
      el("div", { class: "btn-row" }, [
        el("div", {}, [el("div", { class: "muted" }, "Según el banco"), el("div", { class: "amount" }, Money.format(result.bankTotal))]),
        el("div", {}, [el("div", { class: "muted" }, "Tu registro"), el("div", { class: "amount" }, Money.format(result.myTotal))]),
      ]),
      el("div", { class: `imp-check-badge ${diff === 0 ? "ok" : "warn"}` }, diffText),
    ])
  );

  const okCount = result.matched.length;
  container.appendChild(reconcileGroup(`Cuadran · ${okCount}`, "ok", result.matched.map((r) => ({
    date: r.m.date,
    merchant: r.m.description,
    amount: r.m.amountCents,
    note: r.imported ? "Ya importado" : "Ya lo registraste",
  }))));

  container.appendChild(reconcileGroup(`Falta en tu registro · ${result.missing.length}`, "warn", result.missing.map((r) => ({
    date: r.m.date,
    merchant: r.m.description,
    amount: r.m.amountCents,
    note: "Está en el banco y no en tu app",
  }))));

  container.appendChild(reconcileGroup(`Solo en tu registro · ${result.extra.length}`, "warn", result.extra.map((t) => ({
    date: t.date,
    merchant: t.merchant || "Sin comercio",
    amount: t.amountCents,
    note: "No aparece en el estado de cuenta",
  }))));
}

function reconcileGroup(title, tone, rows) {
  const list = el("div", { class: "card" }, [el("div", { class: `imp-check-badge ${tone}` }, title)]);
  if (rows.length === 0) {
    list.appendChild(el("div", { class: "muted" }, "Nada por aquí."));
    return list;
  }
  for (const r of rows) {
    list.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { class: "grow" }, [
          el("div", {}, r.merchant),
          el("div", { class: "muted" }, `${DateUtil.formatShort(r.date)} · ${r.note}`),
        ]),
        el("div", { class: "amount" }, Money.format(r.amount)),
      ])
    );
  }
  return list;
}
