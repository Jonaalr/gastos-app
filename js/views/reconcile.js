/**
 * reconcile.js — Conciliación de un estado de cuenta (PDF) de una tarjeta.
 *
 * Compara los cargos del banco con los gastos que ya registraste en el periodo y muestra:
 *   - Cuadran: el cargo del banco ya lo tienes registrado.
 *   - Falta en tu registro: está en el banco y en tu app no -> botón "Agregar".
 *   - Solo en tu registro: lo tienes tú y no aparece en el estado -> botón "Editar".
 *
 * Seguridad con los datos:
 *   - Los cargos que se agregan entran con balanceApplied: false, igual que la importación:
 *     son historial y NO cambian el saldo actual de la tarjeta.
 *   - Antes de agregar, se vuelve a revisar que no exista ya (no hay duplicados).
 *   - Agregar varios se guarda en una sola operación: o se guardan todos, o ninguno.
 *   - Nada se borra desde aquí. "Solo en tu registro" solo abre tu formulario para editar.
 *   - El PDF se lee en el teléfono y no se sube a ningún lado.
 */

const RECONCILE_WINDOW_DAYS = 3;

/** Suma n días a una fecha "YYYY-MM-DD" (en UTC para no cambiar de día por la zona horaria). */
function shiftISO(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Clave única de un cargo del estado (la misma que usa la importación). */
function statementChargeKey(info, m, seen) {
  const base = `${info.last4}|${m.date}|${m.amountCents}|${StatementImporters.merchantKey(m.rawDescription)}`;
  seen[base] = (seen[base] || 0) + 1;
  return `${base}#${seen[base]}`;
}

/**
 * Compara los cargos de un estado de cuenta con los gastos registrados de la cuenta.
 * Función pura: no lee ni escribe la base de datos.
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

  const importedKeys = new Set(accountTx.filter((t) => t.importKey).map((t) => t.importKey));
  const pool = accountTx.filter((t) => !t.importKey && t.date >= poolFrom && t.date <= poolTo);

  const used = new Set();
  const seen = {};
  const matched = [];
  const missing = [];

  for (const m of charges) {
    const key = statementChargeKey(info, m, seen);
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
      missing.push({ m, key });
    }
  }

  const extra = pool.filter((t) => !used.has(t.id));

  const bankTotal = charges.reduce((s, m) => s + m.amountCents, 0);
  const myTotal = accountTx
    .filter((t) => t.date >= start && t.date <= end)
    .reduce((s, t) => s + t.amountCents, 0);

  return { empty: false, info, periodFrom: start, periodTo: end, bankTotal, myTotal, matched, missing, extra };
}

/**
 * Agrega los cargos faltantes como historial (no tocan el saldo).
 * Vuelve a revisar la base antes de guardar para no duplicar nada.
 */
async function addMissingCharges(parsed, items, accountId) {
  const [allTx, categories, memory] = await Promise.all([
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getMeta("merchantCategories", {}),
  ]);
  const existingKeys = new Set(allTx.filter((t) => t.importKey).map((t) => t.importKey));
  const expenseCategories = categories.filter((c) => c.kind === "expense");
  const { info } = parsed;
  const batch = `${info.bank || "estado"}-${info.last4}-${info.cutDate || "s/f"}`;
  const now = new Date().toISOString();

  const records = items
    .filter((it) => !existingKeys.has(it.key))
    .map((it) => ({
      type: "expense",
      amountCents: it.m.amountCents,
      accountId,
      toAccountId: null,
      categoryId: StatementImporters.suggestCategoryId(it.m.description, expenseCategories, memory),
      merchant: it.m.description,
      note: it.m.rawDescription.replace(/\s+/g, " "),
      date: it.m.date,
      isRecurring: false,
      recurringDay: null,
      attachment: null,
      source: "import",
      importKey: it.key,
      importBatch: batch,
      balanceApplied: false, // historial: el saldo actual no cambia
      createdAt: now,
    }));

  if (records.length === 0) return 0;
  return DB.addMany("transactions", records);
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
    el("p", { class: "muted" }, `Compara el estado de cuenta de ${account.name} con lo que ya registraste.`)
  );

  const status = el("p", { class: "muted" }, "");
  const results = el("div", {});
  let lastParsed = null;

  async function refresh() {
    if (!lastParsed) return;
    const allTx = await DB.getAll("transactions");
    const result = reconcileStatement(lastParsed, allTx, accountId);
    showResult(result);
  }

  const handlers = {
    onAdd: async (items) => {
      try {
        const n = await addMissingCharges(lastParsed, items, accountId);
        toast(n === 1 ? "Cargo agregado al historial" : `${n} cargos agregados al historial`, "success");
      } catch (err) {
        console.error(err);
        toast("No pude agregarlos. No se guardó nada.", "error");
      }
      await refresh();
    },
    onEdit: (tx) => openTransactionSheet({ existing: tx, onSaved: refresh }),
  };

  function showResult(result) {
    results.innerHTML = "";
    renderReconcileResult(results, result, handlers);
  }

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
      lastParsed = parsed;
      status.textContent = "";
      await refresh();
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

/** Dibuja el resultado. Los botones llaman a handlers.onAdd / handlers.onEdit. */
function renderReconcileResult(container, result, handlers = {}) {
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

  container.appendChild(reconcileGroup(`Cuadran · ${result.matched.length}`, "ok", result.matched.map((r) => ({
    date: r.m.date,
    merchant: r.m.description,
    amount: r.m.amountCents,
    note: r.imported ? "Ya importado" : "Ya lo registraste",
  }))));

  const missingItems = result.missing;
  const missingGroup = reconcileGroup(`Falta en tu registro · ${missingItems.length}`, "warn", missingItems.map((r) => ({
    date: r.m.date,
    merchant: r.m.description,
    amount: r.m.amountCents,
    note: "Está en el banco y no en tu app",
    action: handlers.onAdd ? { label: "Agregar", run: () => handlers.onAdd([r]) } : null,
  })));
  if (handlers.onAdd && missingItems.length > 1) {
    missingGroup.appendChild(
      el("button", { class: "btn btn-sm mt-8", onclick: () => handlers.onAdd(missingItems) }, `Agregar los ${missingItems.length}`)
    );
  }
  container.appendChild(missingGroup);

  container.appendChild(reconcileGroup(`Solo en tu registro · ${result.extra.length}`, "warn", result.extra.map((t) => ({
    date: t.date,
    merchant: t.merchant || "Sin comercio",
    amount: t.amountCents,
    note: "No aparece en el estado de cuenta",
    action: handlers.onEdit ? { label: "Editar", run: () => handlers.onEdit(t) } : null,
  }))));
}

function reconcileGroup(title, tone, rows) {
  const list = el("div", { class: "card" }, [el("div", { class: `imp-check-badge ${tone}` }, title)]);
  if (rows.length === 0) {
    list.appendChild(el("div", { class: "muted" }, "Nada por aquí."));
    return list;
  }
  for (const r of rows) {
    const side = [el("div", { class: "amount" }, Money.format(r.amount))];
    if (r.action) {
      side.push(el("button", { class: "btn btn-secondary btn-sm", onclick: r.action.run }, r.action.label));
    }
    list.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { class: "grow" }, [
          el("div", {}, r.merchant),
          el("div", { class: "muted" }, `${DateUtil.formatShort(r.date)} · ${r.note}`),
        ]),
        el("div", { style: "display:flex;flex-direction:column;align-items:flex-end;gap:6px;" }, side),
      ])
    );
  }
  return list;
}
