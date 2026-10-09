/**
 * debts.js — Deudas grandes (crédito de auto, préstamo, etc.), dentro de Presupuestos.
 *
 * Cada deuda tiene monto total, pago mensual opcional y su historial de pagos.
 * Lo que falta = total − pagos registrados. Los pagos que registras aquí
 * Un abono puede reflejarse como gasto (crea un movimiento y baja el saldo de la cuenta de origen).
 * Se guardan en meta["debts"].
 */

async function loadDebts() {
  return DB.getMeta("debts", []);
}
async function saveDebts(debts) {
  return DB.setMeta("debts", debts);
}
function debtPaidCents(d) {
  return (d.payments || []).reduce((s, p) => s + p.amountCents, 0);
}
function debtRemainingCents(d) {
  return Math.max(0, d.totalCents - debtPaidCents(d));
}

const DEUDAS_FILTERS = [
  { id: "todas", label: "Todas", icon: "filter" },
  { id: "deudas", label: "Mis deudas", icon: "card" },
  { id: "compras", label: "Compras a meses", icon: "cart" },
];
let debtsFilterOpen = false;

async function renderDebts(root, params) {
  const f = DEUDAS_FILTERS.some((o) => o.id === params.get("f")) ? params.get("f") : "todas";
  const showDebts = f !== "compras";
  const showPlans = f !== "deudas";
  const debts = showDebts ? await loadDebts() : [];
  const plans = showPlans ? await loadInstallments() : [];
  // Saldo de tarjetas de crédito (se maneja en la cuenta; aquí solo se muestra)
  const creditCards = showDebts
    ? (await DB.getAll("accounts")).filter((a) => a.type === "credit" && !a.archived).map((a) => ({ a, info: creditInfo(a) }))
    : [];
  const cardsOwed = creditCards.reduce((s, c) => s + c.info.spent, 0);
  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Dinero")]));
  root.appendChild(sectionTabs(DINERO_TABS, "/debts"));
  root.appendChild(
    expandableFilter(DEUDAS_FILTERS, f, debtsFilterOpen,
      () => { debtsFilterOpen = !debtsFilterOpen; Router.render(); },
      (id) => { debtsFilterOpen = false; Router.navigate(id === "todas" ? "/debts" : `/debts?f=${id}`); })
  );

  if (debts.length > 0 || plans.length > 0 || creditCards.length > 0) {
    const totalDebt = debts.reduce((s, d) => s + d.totalCents, 0) + plans.reduce((s, p) => s + p.monthlyCents * p.totalMonths, 0);
    const totalPaid = debts.reduce((s, d) => s + debtPaidCents(d), 0) + plans.reduce((s, p) => s + p.monthlyCents * p.paidMonths, 0);
    const totalRemaining = debts.reduce((s, d) => s + debtRemainingCents(d), 0) + plans.reduce((s, p) => s + installmentRemainingCents(p), 0) + cardsOwed;
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "Falta por pagar en total"),
        el("div", { class: "debt-total", style: `color:${totalRemaining > 0 ? "var(--danger)" : "var(--income)"}` }, Money.format(totalRemaining)),
        el("div", { class: "muted" }, `${Money.format(totalPaid)} pagado de ${Money.format(totalDebt)}`),
        cardsOwed > 0 ? el("div", { class: "muted", style: "font-size:12px;margin-top:4px;" }, `Incluye ${Money.format(cardsOwed)} de tarjetas de crédito`) : null,
      ])
    );
  }

  if (showDebts && debts.length === 0) {
    root.appendChild(el("div", { class: "card", style: "margin-top:12px;" }, [el("div", { class: "empty-state" }, "Registra tus deudas grandes, como un crédito de auto o un préstamo, y ve cuánto te falta por pagar.")]));
  }
  if (showDebts) {
    for (const d of debts) root.appendChild(debtCard(d));
    root.appendChild(el("button", { class: "btn", style: "margin-top:12px;", onclick: () => openDebtSheet(null) }, "+ Nueva deuda"));
    if (creditCards.length > 0) {
      root.appendChild(el("div", { class: "section-heading", style: "margin:18px 0 0;" }, "Tarjetas de crédito"));
      for (const { a, info } of creditCards) root.appendChild(creditCardRow(a, info));
    }
  }
  if (showPlans) await renderInstallmentsCard(root);
}

/** Tarjeta de una deuda (mismo formato que Préstamos). Al tocarla abre su detalle. */
function debtCard(d) {
  const paid = debtPaidCents(d);
  const remaining = debtRemainingCents(d);
  const pct = d.totalCents > 0 ? Math.min(100, Math.round((paid / d.totalCents) * 100)) : 0;
  const done = remaining <= 0;
  let info = done ? "Liquidada" : `${pct}% pagado`;
  if (!done && d.monthlyCents > 0) {
    const months = Math.ceil(remaining / d.monthlyCents);
    info += ` · ${months} ${months === 1 ? "pago" : "pagos"} de ${Money.format(d.monthlyCents)} al mes`;
  }
  return el("div", { class: "card", style: "margin-top:12px;cursor:pointer;", onclick: () => openDebtDetailSheet(d) }, [
    el("div", { class: "flex-between" }, [
      el("div", {}, [el("div", { class: "title", style: "font-weight:700;" }, d.name), el("div", { class: "meta muted", style: "font-size:12px;" }, info)]),
      el("strong", { style: "white-space:nowrap;margin-left:10px;" }, `Faltan ${Money.format(remaining)}`),
    ]),
    el("div", { class: "goal-bar", style: "margin-top:10px;" }, [el("div", { class: `goal-fill${done ? " done" : ""}`, style: `width:${pct}%` })]),
    el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, `Pagado ${Money.format(paid)} de ${Money.format(d.totalCents)}`),
  ]);
}

/** Tarjeta de crédito: lo que debes en ella. Al tocarla abre la cuenta. */
function creditCardRow(a, info) {
  const pct = info.limit > 0 ? Math.min(100, Math.round((info.spent / info.limit) * 100)) : 0;
  return el("div", { class: "card", style: "margin-top:12px;cursor:pointer;", onclick: () => Router.navigate(`/account?id=${a.id}`) }, [
    el("div", { class: "flex-between" }, [
      el("div", {}, [el("div", { class: "title", style: "font-weight:700;" }, a.name), el("div", { class: "meta muted", style: "font-size:12px;" }, info.limit ? `${pct}% de ${Money.format(info.limit)}` : "Tarjeta de crédito")]),
      el("strong", { style: "white-space:nowrap;margin-left:10px;" }, `Debes ${Money.format(info.spent)}`),
    ]),
    info.limit ? el("div", { class: "goal-bar", style: "margin-top:10px;" }, [el("div", { class: "goal-fill", style: `width:${pct}%` })]) : null,
  ]);
}

/** Detalle de una deuda: resumen, acciones y pagos. */
function openDebtDetailSheet(d) {
  const { sheet, close } = loanSheet(d.name);
  const line = (t, v) => el("div", { class: "list-item" }, [el("div", { class: "main" }, [el("div", { class: "title" }, t)]), el("div", {}, v)]);
  const payments = (d.payments || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  sheet.appendChild(el("p", { class: "muted", style: "font-size:14px;margin-top:0;" },
    `Total ${Money.format(d.totalCents)}${d.monthlyCents ? ` · pago mensual ${Money.format(d.monthlyCents)}` : ""}`));
  sheet.appendChild(el("div", { class: "card", style: "margin:12px 0;" }, [
    line("Pagado", Money.format(debtPaidCents(d))),
    line("Falta por pagar", el("strong", {}, Money.format(debtRemainingCents(d)))),
  ]));
  sheet.appendChild(el("button", { class: "btn", onclick: () => { close(); openDebtPayment(d); } }, "Abono a la deuda"));
  sheet.appendChild(el("button", { class: "btn btn-secondary mt-8", onclick: () => { close(); openDebtSheet(d); } }, "Editar deuda"));
  sheet.appendChild(el("div", { class: "section-heading", style: "margin:14px 0 6px;" }, `Pagos (${payments.length})`));
  if (payments.length === 0) sheet.appendChild(el("div", { class: "muted", style: "font-size:13px;" }, "Todavía no hay pagos registrados."));
  for (const p of payments) {
    sheet.appendChild(el("div", { class: "list-item" }, [
      el("div", { class: "main" }, [el("div", { class: "title" }, Money.format(p.amountCents)), el("div", { class: "meta" }, `${DateUtil.formatLong(p.date)}${p.note ? ` · ${p.note}` : ""}`)]),
    ]));
  }
}

/** Crear o editar una deuda (y revisar/borrar sus pagos). */
async function openDebtSheet(existing) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const payments = (existing?.payments || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const paymentsHtml = payments.length
    ? payments.map((p) => `
        <div class="debt-pay-row">
          <span>${DateUtil.formatShort(p.date)}${p.note ? ` · ${escapeHtml(p.note)}` : ""}</span>
          <span class="debt-pay-amt">${Money.format(p.amountCents)}</span>
          <button class="sheet-close" type="button" data-del-pay="${p.id}" aria-label="Quitar pago">✕</button>
        </div>`).join("")
    : `<p class="muted" style="font-size:12px;">Aún no hay pagos registrados.</p>`;

  sheet.innerHTML = `
    <div class="sheet-header"><h2>${existing ? "Editar deuda" : "Nueva deuda"}</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group"><label>Nombre</label><input type="text" id="d-name" placeholder="Ej. Crédito del auto" value="${existing ? escapeHtml(existing.name) : ""}"></div>
    <div class="form-group"><label>Monto total de la deuda (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="d-total" value="${existing ? Money.toInputValue(existing.totalCents) : ""}"></div>
    <div class="form-group"><label>Pago mensual (opcional)</label><input type="number" inputmode="decimal" step="0.01" id="d-monthly" value="${existing && existing.monthlyCents ? Money.toInputValue(existing.monthlyCents) : ""}"></div>
    ${existing ? `<div class="form-group"><label>Pagos registrados</label>${paymentsHtml}</div>` : ""}
    <button class="btn" id="d-save">Guardar</button>
    ${existing ? `<button class="btn btn-secondary mt-8" id="d-delete" style="color:var(--danger);">Eliminar deuda</button>` : ""}
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);

  sheet.querySelector("#d-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#d-name").value.trim();
    const totalCents = Money.toCents(sheet.querySelector("#d-total").value);
    const monthlyCents = Money.toCents(sheet.querySelector("#d-monthly").value);
    if (!name) { toast("Ponle un nombre a la deuda", "error"); return; }
    if (totalCents <= 0) { toast("Pon el monto total de la deuda", "error"); return; }
    const debts = await loadDebts();
    if (existing) {
      const i = debts.findIndex((d) => d.id === existing.id);
      if (i >= 0) debts[i] = { ...debts[i], name, totalCents, monthlyCents };
    } else {
      debts.push({ id: uid(), name, totalCents, monthlyCents, payments: [], createdAt: new Date().toISOString() });
    }
    await saveDebts(debts);
    close();
    Router.render();
  });

  // Quitar un pago registrado por error (recalcula lo que falta)
  sheet.querySelectorAll("[data-del-pay]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este abono? Lo que falta por pagar se recalcula. Si se reflejó como gasto, el gasto también se quita y el saldo de la cuenta se regresa.")) return;
      const debts = await loadDebts();
      const d = debts.find((x) => x.id === existing.id);
      const pay = d && (d.payments || []).find((p) => p.id === btn.dataset.delPay);
      if (pay && pay.transactionId) {
        const tx = await DB.get("transactions", pay.transactionId);
        if (tx) await deleteTransactionWithBalances(tx); // devuelve el monto al saldo
      }
      if (d) d.payments = (d.payments || []).filter((p) => p.id !== btn.dataset.delPay);
      await saveDebts(debts);
      close();
      Router.render();
      openDebtSheet(debts.find((x) => x.id === existing.id));
    });
  });

  const del = sheet.querySelector("#d-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la deuda "${existing.name}"? Tus cuentas y movimientos no cambian.`)) return;
      await saveDebts((await loadDebts()).filter((d) => d.id !== existing.id));
      close();
      Router.render();
    });
  }
}

/** Abono a una deuda: eliges de qué cuenta sale y, si quieres, lo reflejas como gasto (baja el saldo). */
async function openDebtPayment(debt) {
  const remaining = debtRemainingCents(debt);
  const accounts = (await DB.getAll("accounts"))
    .filter((a) => !a.archived && a.type !== "savings")
    .sort(accountPickerCompare);
  if (accounts.length === 0) {
    toast("No puedes registrar el abono porque no tienes cuentas. Crea una en Ajustes → Cuentas.", "error");
    return;
  }
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  const suggested = debt.monthlyCents > 0 ? Math.min(debt.monthlyCents, remaining) : remaining;
  const accOptions = accounts.sort(accountPickerCompare).map((a) => `<option value="${a.id}">${escapeHtml(accountPickerLabel(a))}</option>`).join("");
  sheet.innerHTML = `
    <div class="sheet-header"><h2>Abono a la deuda</h2><button class="sheet-close" data-close>✕</button></div>
    <p class="muted">${escapeHtml(debt.name)} · te faltan ${Money.format(remaining)}</p>
    <div class="form-group"><label>Monto del abono (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="p-amount" value="${Money.toInputValue(suggested)}"></div>
    <div class="form-group"><label>Fecha</label><input type="date" id="p-date" value="${DateUtil.todayISO()}"></div>
    <div class="form-group" id="p-account-wrap"><label>¿De qué cuenta sale?</label><select id="p-account">${accOptions}</select></div>
    <div class="form-group">
      <label class="checkbox-row">
        <input type="checkbox" id="p-as-expense" checked>
        <span>Reflejarlo como gasto (baja el saldo de la cuenta)</span>
      </label>
      <p class="muted" style="font-size:12px;margin-top:6px;">Con esta opción el abono aparece en Movimientos y el saldo de la cuenta baja. Sin ella, solo baja lo que falta de la deuda.</p>
    </div>
    <div class="form-group"><label>Nota (opcional)</label><input type="text" id="p-note" placeholder="Ej. Pago de octubre"></div>
    <button class="btn" id="p-save">Registrar abono</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  // La cuenta solo se pide si el abono se refleja como gasto
  const asExpenseBox = sheet.querySelector("#p-as-expense");
  const accWrap = sheet.querySelector("#p-account-wrap");
  const syncAccount = () => { accWrap.style.display = asExpenseBox.checked ? "" : "none"; };
  asExpenseBox.addEventListener("change", syncAccount);
  syncAccount();
  sheet.querySelector("#p-save").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#p-amount").value);
    if (amountCents <= 0) { toast("Pon el monto del abono", "error"); return; }
    const date = sheet.querySelector("#p-date").value || DateUtil.todayISO();
    const note = sheet.querySelector("#p-note").value.trim();
    const asExpense = sheet.querySelector("#p-as-expense").checked;
    const pickedAccount = parseInt(sheet.querySelector("#p-account").value, 10);
    if (asExpense && !pickedAccount) { toast("Elige la cuenta de la que sale el abono", "error"); return; }
    const accountId = asExpense ? pickedAccount : null;

    let transactionId = null;
    if (asExpense) {
      // Mismo registro que un gasto normal: sí baja el saldo de la cuenta
      transactionId = await saveTransactionWithBalances({
        type: "expense",
        amountCents,
        accountId,
        toAccountId: null,
        categoryId: null,
        merchant: `Abono: ${debt.name}`,
        note: note || "Abono a deuda",
        date,
        isRecurring: false,
        recurringDay: null,
        attachment: null,
        split: null,
        source: "debt",
        createdAt: new Date().toISOString(),
      }, null);
    }

    const debts = await loadDebts();
    const d = debts.find((x) => x.id === debt.id);
    if (d) d.payments = [...(d.payments || []), { id: uid(), date, amountCents, note, accountId, transactionId }];
    await saveDebts(debts);
    close();
    Router.render();
  });
}

/* ---------- Compras a meses ----------
 * Cada compra a meses tiene cuota mensual, meses totales y meses ya pagados.
 * Cada cuota se registra como gasto (lo que sale de tu cuenta cada mes).
 * Se guardan en meta["installments"]. */

async function loadInstallments() {
  return DB.getMeta("installments", []);
}
async function saveInstallments(plans) {
  return DB.setMeta("installments", plans);
}
function installmentRemainingCents(p) {
  return p.monthlyCents * Math.max(0, p.totalMonths - p.paidMonths);
}

async function renderInstallmentsCard(root) {
  const [plans, accounts] = await Promise.all([loadInstallments(), DB.getAll("accounts")]);
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  if (plans.length === 0) {
    root.appendChild(el("div", { class: "card", style: "margin-top:12px;" }, [el("div", { class: "empty-state" }, "Aquí ves en qué cuota vas de cada compra a meses y cuánto te falta. También te lo sugerimos al importar tu estado de cuenta.")]));
  }
  for (const p of plans) {
    const remaining = installmentRemainingCents(p);
    const done = p.paidMonths >= p.totalMonths;
    const pct = Math.min(100, Math.round((p.paidMonths / p.totalMonths) * 100));
    const left = p.totalMonths - p.paidMonths;
    const acc = accMap[p.accountId];
    const info = done
      ? "Liquidada"
      : `Cuota ${p.paidMonths + 1} de ${p.totalMonths} · te quedan ${left} · ${Money.format(p.monthlyCents)} al mes${acc ? ` · ${acc.name}` : ""}`;
    root.appendChild(
      el("div", { class: "card", style: "margin-top:12px;cursor:pointer;", onclick: () => openInstallmentDetailSheet(p) }, [
        el("div", { class: "flex-between" }, [
          el("div", {}, [el("div", { class: "title", style: "font-weight:700;" }, p.name), el("div", { class: "meta muted", style: "font-size:12px;" }, info)]),
          el("strong", { style: "white-space:nowrap;margin-left:10px;" }, `Faltan ${Money.format(remaining)}`),
        ]),
        el("div", { class: "goal-bar", style: "margin-top:10px;" }, [el("div", { class: `goal-fill${done ? " done" : ""}`, style: `width:${pct}%` })]),
        el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, `Pagado ${Money.format(p.monthlyCents * p.paidMonths)} de ${Money.format(p.monthlyCents * p.totalMonths)}`),
      ])
    );
  }
  root.appendChild(el("button", { class: "btn", style: "margin-top:12px;", onclick: () => openInstallmentSheet(null) }, "+ Compra a meses"));
}

/** Detalle de una compra a meses: resumen y acciones. */
function openInstallmentDetailSheet(p) {
  const done = p.paidMonths >= p.totalMonths;
  const { sheet, close } = loanSheet(p.name);
  const line = (t, v) => el("div", { class: "list-item" }, [el("div", { class: "main" }, [el("div", { class: "title" }, t)]), el("div", {}, v)]);
  sheet.appendChild(el("p", { class: "muted", style: "font-size:14px;margin-top:0;" },
    `${Money.format(p.monthlyCents)} al mes · ${p.totalMonths} cuotas`));
  sheet.appendChild(el("div", { class: "card", style: "margin:12px 0;" }, [
    line("Cuotas pagadas", `${p.paidMonths} de ${p.totalMonths}`),
    line("Falta por pagar", el("strong", {}, Money.format(installmentRemainingCents(p)))),
  ]));
  if (!done) sheet.appendChild(el("button", { class: "btn", onclick: () => { close(); openInstallmentPayment(p); } }, "Registrar cuota"));
  sheet.appendChild(el("button", { class: "btn btn-secondary mt-8", onclick: () => { close(); openInstallmentSheet(p); } }, "Editar compra"));
}

/** Crear o editar una compra a meses. */
async function openInstallmentSheet(existing) {
  const accounts = (await DB.getAll("accounts"))
    .filter((a) => !a.archived && a.type !== "savings")
    .sort(accountPickerCompare);
  if (accounts.length === 0) {
    toast("No puedes registrar una compra a meses porque no tienes cuentas. Crea una en Ajustes → Cuentas.", "error");
    return;
  }
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const accOptions = accounts
    .map((a) => `<option value="${a.id}" ${existing && existing.accountId === a.id ? "selected" : ""}>${escapeHtml(accountPickerLabel(a))}</option>`)
    .join("");
  sheet.innerHTML = `
    <div class="sheet-header"><h2>${existing ? "Editar compra a meses" : "Compra a meses"}</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group"><label>Nombre</label><input type="text" id="i-name" placeholder="Ej. Laptop, Mercado Pago" value="${existing ? escapeHtml(existing.name) : ""}"></div>
    <div class="form-group"><label>¿En qué tarjeta o cuenta se cobra?</label><select id="i-account">${accOptions}</select></div>
    <div class="form-group"><label>Monto total de la compra (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="i-total" value="${existing ? Money.toInputValue(existing.monthlyCents * existing.totalMonths) : ""}"></div>
    <div class="form-group"><label>Número de meses</label><input type="number" inputmode="numeric" step="1" id="i-months" value="${existing ? existing.totalMonths : ""}"></div>
    <div class="form-group"><label>Cuota mensual (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="i-monthly" value="${existing ? Money.toInputValue(existing.monthlyCents) : ""}"><div class="field-hint">Si la dejas vacía, la calculo: total ÷ meses.</div></div>
    <div class="form-group"><label>¿Cuántas cuotas ya pagaste?</label><input type="number" inputmode="numeric" step="1" id="i-paid" value="${existing ? existing.paidMonths : 0}"></div>
    <button class="btn" id="i-save">Guardar</button>
    ${existing ? `<button class="btn btn-secondary mt-8" id="i-delete" style="color:var(--danger);">Eliminar compra</button>` : ""}
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);

  sheet.querySelector("#i-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#i-name").value.trim();
    const accountId = parseInt(sheet.querySelector("#i-account").value, 10);
    const totalCents = Money.toCents(sheet.querySelector("#i-total").value);
    const totalMonths = parseInt(sheet.querySelector("#i-months").value, 10);
    const paidMonths = parseInt(sheet.querySelector("#i-paid").value || "0", 10);
    let monthlyCents = Money.toCents(sheet.querySelector("#i-monthly").value);
    if (!name) { toast("Ponle un nombre a la compra", "error"); return; }
    if (!(totalCents > 0)) { toast("Pon el monto total de la compra", "error"); return; }
    if (!(totalMonths >= 2)) { toast("Pon al menos 2 meses", "error"); return; }
    if (!(paidMonths >= 0 && paidMonths <= totalMonths)) { toast("Las cuotas pagadas deben estar entre 0 y el número de meses", "error"); return; }
    if (!monthlyCents) monthlyCents = Math.round(totalCents / totalMonths);

    const plans = await loadInstallments();
    if (existing) {
      const i = plans.findIndex((p) => p.id === existing.id);
      if (i >= 0) plans[i] = { ...plans[i], name, accountId, totalMonths, monthlyCents, paidMonths, key: StatementImporters.merchantKey(name) };
    } else {
      plans.push({ id: uid(), name, accountId, totalMonths, monthlyCents, paidMonths, key: StatementImporters.merchantKey(name), createdAt: new Date().toISOString() });
    }
    await saveInstallments(plans);
    close();
    Router.render();
  });

  const del = sheet.querySelector("#i-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la compra "${existing.name}"? Las cuotas que ya registraste como gasto no cambian.`)) return;
      await saveInstallments((await loadInstallments()).filter((p) => p.id !== existing.id));
      close();
      Router.render();
    });
  }
}

/** Registrar una cuota: es un gasto normal en la cuenta/tarjeta y avanza la cuota en que vas. */
async function openInstallmentPayment(plan) {
  const accounts = (await DB.getAll("accounts"))
    .filter((a) => !a.archived && a.type !== "savings")
    .sort(accountPickerCompare);
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  const accOptions = accounts
    .map((a) => `<option value="${a.id}" ${a.id === plan.accountId ? "selected" : ""}>${escapeHtml(accountPickerLabel(a))}</option>`)
    .join("");
  const nextCuota = plan.paidMonths + 1;
  sheet.innerHTML = `
    <div class="sheet-header"><h2>Cuota ${nextCuota} de ${plan.totalMonths}</h2><button class="sheet-close" data-close>✕</button></div>
    <p class="muted">${escapeHtml(plan.name)} · ${Money.format(plan.monthlyCents)}</p>
    <div class="form-group"><label>Monto de la cuota (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="c-amount" value="${Money.toInputValue(plan.monthlyCents)}"></div>
    <div class="form-group"><label>Fecha</label><input type="date" id="c-date" value="${DateUtil.todayISO()}"></div>
    <div class="form-group"><label>Cuenta o tarjeta</label><select id="c-account">${accOptions}</select></div>
    <p class="muted" style="font-size:12px;">Se registra como gasto y avanza a la cuota ${nextCuota + 1}. Si luego importas el estado de cuenta con esa misma cuota, quita una de las dos para no duplicarla.</p>
    <button class="btn" id="c-save">Registrar cuota</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.querySelector("#c-save").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#c-amount").value);
    if (amountCents <= 0) { toast("Pon el monto de la cuota", "error"); return; }
    const date = sheet.querySelector("#c-date").value || DateUtil.todayISO();
    const accountId = parseInt(sheet.querySelector("#c-account").value, 10);
    await saveTransactionWithBalances({
      type: "expense",
      amountCents,
      accountId,
      toAccountId: null,
      categoryId: null,
      merchant: plan.name,
      note: `Cuota ${nextCuota} de ${plan.totalMonths}`,
      date,
      isRecurring: false,
      recurringDay: null,
      attachment: null,
      split: null,
      source: "installment",
      createdAt: new Date().toISOString(),
    }, null);
    const plans = await loadInstallments();
    const p = plans.find((x) => x.id === plan.id);
    if (p) p.paidMonths = Math.min(p.totalMonths, p.paidMonths + 1);
    await saveInstallments(plans);
    close();
    Router.render();
  });
}
