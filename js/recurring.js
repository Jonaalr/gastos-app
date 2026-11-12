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
 *
 * Reglas que evitan duplicados:
 *  - Cada domiciliado tiene UN solo gasto marcado como domiciliado (el más reciente). Al confirmar
 *    un mes, el nuevo cargo toma la marca y el anterior queda como historial.
 *  - Los domiciliados COMPARTIDOS no se confirman aquí: su cargo mensual lo registran los ciclos
 *    de Préstamos (receivables.js) cuando llega la fecha, junto con lo que debe cada persona.
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
function dueRecurringThisMonth(series, status, todayISO, allTx = null) {
  const mk = todayISO.slice(0, 7);
  const charged = allTx ? chargedSeriesKeys(allTx, mk) : null;
  return series
    .filter((s) => {
      const st = status[s.key] || {};
      if (s.last.split) return false; // compartido: lo registran los ciclos, no se confirma a mano
      if (charged && charged.has(s.key)) return false; // ya hay un gasto igual este mes (confirmado, manual o importado)
      if (st.cancelled) return false;
      if (st.skipped && st.skipped.includes(mk)) return false;
      if (s.txs.some((t) => DateUtil.monthKey(t.date) === mk)) return false; // ya registrado este mes
      const due = recurringDueISO(s.last.recurringDay, mk);
      return due <= todayISO;
    })
    .map((s) => ({ ...s, dueISO: recurringDueISO(s.last.recurringDay, mk) }))
    .sort((a, b) => a.dueISO.localeCompare(b.dueISO));
}

/** Series que ya tienen un gasto en el mes dado (mismo comercio, categoría y cuenta) */
function chargedSeriesKeys(allTx, monthKeyStr) {
  return new Set(allTx.filter((t) => t.type === "expense" && t.date && DateUtil.monthKey(t.date) === monthKeyStr).map(recurringSeriesKey));
}

/** Suma de los domiciliados de este mes que aún no tienen su cargo registrado (para "Por pagar" en Inicio) */
function pendingRecurringCents(allTx, status, todayISO = DateUtil.todayISO()) {
  const mk = todayISO.slice(0, 7);
  const charged = chargedSeriesKeys(allTx, mk);
  return buildRecurringSeries(allTx)
    .filter((s) => {
      const st = status[s.key] || {};
      return !st.cancelled && !(st.skipped && st.skipped.includes(mk)) && !charged.has(s.key);
    })
    .reduce((sum, s) => sum + s.last.amountCents, 0);
}

/**
 * Deja un solo gasto marcado como domiciliado por serie y une plantillas duplicadas de un compartido.
 * Corre al abrir la app y al guardar un domiciliado. No cambia montos ni saldos, salvo quitar un
 * cargo automático repetido (mismo domiciliado y mismo mes), que se anota en meta["recurringFixLog"].
 */
async function normalizeRecurringSeries() {
  const txs = await DB.getAll("transactions");
  const groups = new Map();
  for (const t of txs) {
    if (!t.isRecurring || !t.recurringDay || t.type !== "expense") continue;
    const key = recurringSeriesKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  if (![...groups.values()].some((list) => list.length > 1)) return { demoted: 0, removed: [] };

  const byId = new Map(txs.map((t) => [t.id, t]));
  const collections = await DB.getAll("collections");
  let cycles = await DB.getMeta("domCycles", []);
  let cyclesChanged = false;
  let demoted = 0;
  const removed = [];
  const stamp = (t) => (t.date || "") + (t.createdAt || "");

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => stamp(a).localeCompare(stamp(b)));
    const shared = list.filter((t) => t.split);
    // Sin reparto: manda el más reciente. Compartido: manda el más antiguo con reparto (tiene la historia de cargos)
    const primary = shared.length ? shared[0] : list[list.length - 1];
    for (const dup of list) {
      if (dup === primary) continue;
      if (shared.length) {
        const mine = cycles.filter((c) => c.txId === dup.id);
        for (const c of mine) {
          const same = cycles.find((x) => x.txId === primary.id && x.dueDate.slice(0, 7) === c.dueDate.slice(0, 7));
          if (!same) {
            // La plantilla no tenía cargo ese mes: este ciclo pasa a ser suyo
            c.txId = primary.id;
            if (c.chargeTxId === dup.id) dup.cycleId = c.id;
          } else {
            // Ya había un cargo ese mes: los cobros pasan a ese ciclo y el repetido se quita
            for (const col of collections.filter((x) => x.cycleId === c.id)) {
              col.cycleId = same.id;
              await DB.put("collections", col);
            }
            const charge = c.chargeTxId ? byId.get(c.chargeTxId) : null;
            if (charge && charge.id !== dup.id) {
              if (same.chargeTxId && same.chargeTxId !== charge.id && charge.source === "domiciliado") {
                removed.push({ ...charge });
                await DB.delete("transactions", charge.id);
              } else {
                charge.cycleId = same.id;
                await DB.put("transactions", charge);
                if (!same.chargeTxId) same.chargeTxId = charge.id;
              }
            } else if (charge) {
              dup.cycleId = same.id;
              if (!same.chargeTxId) same.chargeTxId = dup.id;
            }
            cycles = cycles.filter((x) => x !== c);
          }
          cyclesChanged = true;
        }
        if (dup.split && !dup.cycleId) {
          // Cargo compartido suelto: se liga al ciclo de su mes para no contarlo dos veces
          let cyc = cycles.find((x) => x.txId === primary.id && x.dueDate.slice(0, 7) === dup.date.slice(0, 7));
          if (!cyc) {
            cyc = { id: uid(), txId: primary.id, dueDate: dup.date.slice(0, 10), chargeTxId: dup.id };
            cycles.push(cyc);
          }
          dup.cycleId = cyc.id;
          cyclesChanged = true;
        }
      }
      dup.isRecurring = false;
      await DB.put("transactions", dup);
      demoted += 1;
    }
  }
  if (cyclesChanged) await DB.setMeta("domCycles", cycles);
  if (removed.length) {
    const log = await DB.getMeta("recurringFixLog", []);
    await DB.setMeta("recurringFixLog", [...log, { at: new Date().toISOString(), removed }]);
  }
  return { demoted, removed };
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
  const due = dueRecurringThisMonth(series, status, DateUtil.todayISO(), allTx);
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
    // El cargo nuevo es ahora "el domiciliado"; los anteriores quedan como historial
    for (const old of s.txs) {
      const fresh = await DB.get("transactions", old.id);
      if (fresh && fresh.isRecurring) await DB.put("transactions", { ...fresh, isRecurring: false });
    }
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

window.normalizeRecurringSeries = normalizeRecurringSeries;
window.pendingRecurringCents = pendingRecurringCents;
