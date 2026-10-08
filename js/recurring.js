/**
 * recurring.js — Domiciliados que se confirman cada mes.
 *
 * Un domiciliado es un gasto marcado como recurrente. Cada mes, cuando llega su día,
 * la app PREGUNTA si se cobró (no registra sola). Opciones:
 *   - Sí, se cobró      -> crea el gasto (con el monto que confirmes) y SÍ afecta el saldo,
 *                          igual que cualquier gasto real.
 *   - No se cobró      -> no registra nada, solo marca ese mes como omitido.
 *   - Cancelar         -> deja de preguntar y de aparecer en Domiciliados.
 *
 * Estado en meta["recurringStatus"]: { [serieKey]: { cancelled: bool, skipped: ["YYYY-MM", ...] } }
 * Una serie ya está "confirmada" este mes si existe un gasto suyo con fecha de este mes.
 */

function recurringSeriesKey(t) {
  return `${(t.merchant || "").trim().toLowerCase()}|${t.categoryId || ""}|${t.accountId}`;
}

/** Series de domiciliados: la última versión de cada una (monto, día, cuenta). */
function buildRecurringSeries(allTx) {
  const map = new Map();
  for (const t of allTx) {
    if (!t.isRecurring || !t.recurringDay || t.type !== "expense") continue;
    const key = recurringSeriesKey(t);
    const prev = map.get(key);
    if (!prev || (t.date + t.createdAt) > (prev.last.date + prev.last.createdAt)) {
      map.set(key, { key, last: t, txs: prev ? [...prev.txs, t] : [t] });
    } else {
      prev.txs.push(t);
    }
  }
  return [...map.values()];
}

/** Día del mes actual para un domiciliado (si el mes es más corto, el último día). */
function recurringDueISO(day, monthKeyStr) {
  const [y, m] = monthKeyStr.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${monthKeyStr}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

async function loadRecurringStatus() {
  return DB.getMeta("recurringStatus", {});
}
async function saveRecurringStatus(status) {
  return DB.setMeta("recurringStatus", status);
}

/** Series que tocan confirmar hoy: ya llegó su día este mes, no se ha cobrado/omitido, no canceladas. */
function dueRecurringThisMonth(series, status, todayISO) {
  const mk = todayISO.slice(0, 7);
  return series
    .filter((s) => {
      const st = status[s.key] || {};
      if (st.cancelled) return false;
      if (st.skipped && st.skipped.includes(mk)) return false;
      if (s.txs.some((t) => DateUtil.monthKey(t.date) === mk)) return false; // ya registrado este mes
      const due = recurringDueISO(s.last.recurringDay, mk);
      return due <= todayISO;
    })
    .map((s) => ({ ...s, dueISO: recurringDueISO(s.last.recurringDay, mk) }))
    .sort((a, b) => a.dueISO.localeCompare(b.dueISO));
}

/** Tarjeta "Por confirmar" (se dibuja arriba en Pagos). */
async function renderDueRecurring(root) {
  const [allTx, accounts, categories, status] = await Promise.all([
    DB.getAll("transactions"),
    DB.getAll("accounts"),
    DB.getAll("categories"),
    loadRecurringStatus(),
  ]);
  const series = buildRecurringSeries(allTx);
  const due = dueRecurringThisMonth(series, status, DateUtil.todayISO());
  if (due.length === 0) return;

  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const card = el("div", { class: "card due-card" }, [el("div", { class: "card-title" }, "Por confirmar este mes")]);
  for (const s of due) {
    const acc = accMap[s.last.accountId];
    card.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { class: "icon" }, iconNode("repeat")),
        el("div", { class: "main" }, [
          el("div", { class: "title" }, s.last.merchant || "Domiciliado"),
          el("div", { class: "meta" }, `${DateUtil.formatLong(s.dueISO)} · ${acc ? acc.name : "Sin cuenta"} · ~${Money.format(s.last.amountCents)}`),
        ]),
        el("button", { class: "btn btn-sm", onclick: () => openRecurringConfirm(s) }, "Confirmar"),
      ])
    );
  }
  root.appendChild(card);
}

/** Hoja de confirmación: monto (puede cambiar), y las tres decisiones. */
async function openRecurringConfirm(s) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  sheet.innerHTML = `
    <div class="sheet-header"><h2>${escapeHtml(s.last.merchant || "Domiciliado")}</h2><button class="sheet-close" data-close>✕</button></div>
    <p class="muted" style="font-size:14px;margin-top:0;">Fecha de cobro: ${DateUtil.formatLong(s.dueISO)}</p>
    <div class="form-group"><label>Monto cobrado (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="r-amount" value="${Money.toInputValue(s.last.amountCents)}"></div>
    <button class="btn" id="r-yes">Sí, se cobró</button>
    <button class="btn btn-secondary mt-8" id="r-no">No se cobró este mes</button>
    <button class="btn btn-secondary mt-8" id="r-cancel" style="color:var(--danger);">Ya no se cobra (cancelar)</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);

  sheet.querySelector("#r-yes").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#r-amount").value);
    if (amountCents <= 0) { toast("Pon el monto que se cobró", "error"); return; }
    const mk = s.dueISO.slice(0, 7);
    const status = await loadRecurringStatus();
    // Evita duplicar si ya se confirmó este mes en otra pestaña
    const allTx = await DB.getAll("transactions");
    if (allTx.some((t) => recurringSeriesKey(t) === s.key && DateUtil.monthKey(t.date) === mk)) {
      toast("Este cobro ya está registrado este mes", "error");
      close();
      Router.render();
      return;
    }
    const record = {
      type: "expense",
      amountCents,
      accountId: s.last.accountId,
      toAccountId: null,
      categoryId: s.last.categoryId || null,
      merchant: s.last.merchant || "",
      note: "Domiciliado confirmado",
      date: s.dueISO,
      isRecurring: true,
      recurringDay: s.last.recurringDay,
      attachment: null,
      split: null,
      source: "recurring",
      createdAt: new Date().toISOString(),
    };
    await saveTransactionWithBalances(record, null); // es un cobro real: sí afecta el saldo
    toast("Cobro registrado", "success");
    close();
    Router.render();
  });

  sheet.querySelector("#r-no").addEventListener("click", async () => {
    const mk = s.dueISO.slice(0, 7);
    const status = await loadRecurringStatus();
    const st = status[s.key] || {};
    status[s.key] = { ...st, skipped: [...(st.skipped || []), mk] };
    await saveRecurringStatus(status);
    close();
    Router.render();
  });

  sheet.querySelector("#r-cancel").addEventListener("click", async () => {
    if (!confirm(`¿Dejar de preguntar por "${s.last.merchant || "este domiciliado"}"? Tus gastos anteriores no se borran.`)) return;
    const status = await loadRecurringStatus();
    status[s.key] = { ...(status[s.key] || {}), cancelled: true };
    await saveRecurringStatus(status);
    close();
    Router.render();
  });
}
