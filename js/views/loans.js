/**
 * loans.js — Préstamos que hiciste (te deben). Viven en la pestaña "Préstamos" de Por cobrar.
 *
 * Interés (como los bancos): cada mes se cobra el porcentaje sobre lo que falta de capital.
 * Cada pago primero cubre el interés acumulado y después el capital. Lo que no se paga de interés se suma a lo que te deben.
 *
 * Saldo de cuentas:
 *  - Préstamo nuevo: la cuenta de donde sale el dinero baja al prestarlo (no cuenta como gasto).
 *  - Préstamo antiguo: no toca ningún saldo (ya estaba reflejado).
 *  - Pago recibido: si eliges cuenta, su saldo sube.
 */

async function loadLoans() {
  return DB.getMeta("loans", []);
}
async function saveLoans(loans) {
  return DB.setMeta("loans", loans);
}

/** Fechas de cada cobro de interés: mismo día del mes, desde el inicio hasta la fecha dada */
function loanAccrualDates(startISO, asOfISO) {
  const [y, m, d] = startISO.split("-").map(Number);
  const dates = [];
  for (let k = 1; k < 1200; k++) {
    const iso = DateUtil.toISO(new Date(y, m - 1 + k, d));
    if (iso > asOfISO) break;
    dates.push(iso);
  }
  return dates;
}

/** Cuánto te deben hoy (o a una fecha): capital, interés pendiente y lo que ya te pagaron */
function loanStatus(loan, asOfISO = DateUtil.todayISO()) {
  const rate = (loan.monthlyRatePct || 0) / 100;
  let capital = loan.principalCents;
  let interest = 0;
  let interestPaid = 0;
  let capitalPaid = 0;
  const events = [];
  if (rate > 0) for (const date of loanAccrualDates(loan.startDate, asOfISO)) events.push({ date, accrual: true });
  for (const p of loan.payments || []) if (p.date <= asOfISO) events.push({ date: p.date, amountCents: p.amountCents });
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.accrual ? -1 : 1));
  for (const e of events) {
    if (e.accrual) {
      interest += Math.round(capital * rate);
      continue;
    }
    let amount = e.amountCents;
    const toInterest = Math.min(amount, interest);
    interest -= toInterest;
    amount -= toInterest;
    const toCapital = Math.min(amount, capital);
    capital -= toCapital;
    interestPaid += toInterest;
    capitalPaid += toCapital;
  }
  return { capital, interest, owed: capital + interest, paidTotal: interestPaid + capitalPaid, rate: loan.monthlyRatePct || 0 };
}

function loanSheet(title) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  sheet.innerHTML = `<div class="sheet-header"><h2>${escapeHtml(title)}</h2><button class="sheet-close" data-close>✕</button></div>`;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  return { sheet, close };
}

async function activeAccountsSorted() {
  return (await DB.getAll("accounts")).filter((a) => !a.archived).sort(accountPickerCompare);
}

async function openNewLoanSheet(onSaved) {
  const accounts = await activeAccountsSorted();
  const { sheet, close } = loanSheet("Nuevo préstamo");
  sheet.insertAdjacentHTML("beforeend", `
    <div class="form-group"><label>¿A quién le prestaste?</label><input type="text" id="l-name" placeholder="Ej. Novia, Juan"></div>
    <div class="form-group"><label>Monto prestado (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="l-amount" placeholder="0.00"></div>
    <div class="form-group"><label>Fecha en que prestaste</label><input type="date" id="l-date" value="${DateUtil.todayISO()}"></div>
    <div class="form-group"><label>¿Cuándo salió el dinero?</label>
      <select id="l-kind">
        <option value="new">Ahora: sale de una de mis cuentas</option>
        <option value="old">Hace tiempo: ya está reflejado, no toca mi saldo</option>
      </select>
    </div>
    <div class="form-group" id="l-acc-group"><label>¿De qué cuenta sale?</label>
      <select id="l-account">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountPickerLabel(a))}</option>`).join("")}</select>
    </div>
    <div class="form-group"><label>Interés mensual (%)</label><input type="number" inputmode="decimal" step="0.1" id="l-rate" placeholder="Vacío o 0 = sin intereses"></div>
    <button class="btn" id="l-save">Guardar préstamo</button>`);
  const kind = sheet.querySelector("#l-kind");
  kind.addEventListener("change", () => {
    sheet.querySelector("#l-acc-group").style.display = kind.value === "new" ? "block" : "none";
  });
  sheet.querySelector("#l-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#l-name").value.trim();
    const principalCents = Money.toCents(sheet.querySelector("#l-amount").value);
    const startDate = sheet.querySelector("#l-date").value || DateUtil.todayISO();
    const rate = parseFloat(sheet.querySelector("#l-rate").value) || 0;
    const isNew = kind.value === "new";
    const accountId = isNew ? parseInt(sheet.querySelector("#l-account").value, 10) : null;
    if (!name) { toast("Escribe a quién le prestaste", "error"); return; }
    if (!principalCents || principalCents <= 0) { toast("Ingresa un monto válido", "error"); return; }
    if (isNew && !accountId) { toast("Elige la cuenta de donde salió el dinero", "error"); return; }
    if (isNew) {
      const acc = await DB.get("accounts", accountId);
      acc.balanceCents = (acc.balanceCents || 0) - principalCents;
      await DB.put("accounts", acc);
    }
    const loans = await loadLoans();
    loans.push({ id: uid(), name, principalCents, monthlyRatePct: rate, startDate, oldLoan: !isNew, accountId, payments: [], createdAt: new Date().toISOString() });
    await saveLoans(loans);
    toast("Préstamo guardado", "success");
    close();
    onSaved();
  });
}

async function openLoanPaymentSheet(loan, onSaved) {
  const accounts = await activeAccountsSorted();
  const status = loanStatus(loan);
  const { sheet, close } = loanSheet(`Pago de ${loan.name}`);
  sheet.insertAdjacentHTML("beforeend", `
    <p class="muted" style="font-size:14px;margin-top:0;">Te deben ${Money.format(status.owed)}</p>
    <div class="form-group"><label>Monto que te pagaron (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="p-amount" value="${Money.toInputValue(status.owed)}"></div>
    <div class="form-group"><label>Fecha</label><input type="date" id="p-date" value="${DateUtil.todayISO()}"></div>
    <div class="form-group"><label>¿En qué cuenta entró el dinero?</label>
      <select id="p-account"><option value="">Sin cuenta</option>${accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountPickerLabel(a))}</option>`).join("")}</select>
    </div>
    <button class="btn" id="p-save">Guardar pago</button>`);
  sheet.querySelector("#p-save").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#p-amount").value);
    const date = sheet.querySelector("#p-date").value || DateUtil.todayISO();
    const accountId = parseInt(sheet.querySelector("#p-account").value, 10) || null;
    if (!amountCents || amountCents <= 0) { toast("Ingresa un monto válido", "error"); return; }
    if (amountCents > status.owed) { toast("Es más de lo que te deben", "error"); return; }
    const loans = await loadLoans();
    const target = loans.find((l) => l.id === loan.id);
    target.payments = [...(target.payments || []), { id: uid(), date, amountCents, accountId }];
    await saveLoans(loans);
    if (accountId) {
      const acc = await DB.get("accounts", accountId);
      acc.balanceCents = (acc.balanceCents || 0) + amountCents;
      await DB.put("accounts", acc);
    }
    toast("Pago registrado", "success");
    close();
    onSaved();
  });
}

async function openLoanDetailSheet(loan, onChanged) {
  const status = loanStatus(loan);
  const { sheet, close } = loanSheet(loan.name);
  const rateTxt = loan.monthlyRatePct ? `${loan.monthlyRatePct}% mensual` : "Sin intereses";
  const info = el("div", { class: "muted", style: "font-size:14px;margin-top:0;" }, `Prestado ${Money.format(loan.principalCents)} el ${DateUtil.formatLong(loan.startDate)} · ${rateTxt}${loan.oldLoan ? " · préstamo antiguo" : ""}`);
  sheet.appendChild(info);
  sheet.appendChild(el("div", { class: "card", style: "margin:12px 0;" }, [
    el("div", { class: "list-item" }, [el("div", { class: "main" }, [el("div", { class: "title" }, "Capital pendiente")]), el("div", {}, Money.format(status.capital))]),
    el("div", { class: "list-item" }, [el("div", { class: "main" }, [el("div", { class: "title" }, "Interés acumulado")]), el("div", {}, Money.format(status.interest))]),
    el("div", { class: "list-item" }, [el("div", { class: "main" }, [el("div", { class: "title" }, "Te deben en total")]), el("strong", {}, Money.format(status.owed))]),
  ]));
  sheet.appendChild(el("button", { class: "btn", onclick: () => { close(); openLoanPaymentSheet(loan, onChanged); } }, "Registrar pago"));

  const payments = [...(loan.payments || [])].sort((a, b) => b.date.localeCompare(a.date));
  sheet.appendChild(el("div", { class: "section-heading", style: "margin:14px 0 6px;" }, `Pagos (${payments.length})`));
  if (payments.length === 0) sheet.appendChild(el("div", { class: "muted", style: "font-size:13px;" }, "Todavía no te han pagado."));
  for (const p of payments) {
    sheet.appendChild(el("div", { class: "list-item" }, [
      el("div", { class: "main" }, [el("div", { class: "title" }, Money.format(p.amountCents)), el("div", { class: "meta" }, `${DateUtil.formatLong(p.date)}${p.accountId ? "" : " · sin cuenta"}`)]),
      el("button", { class: "btn btn-secondary btn-sm", onclick: async () => {
        if (!confirm("¿Quitar este pago? Si entró a una cuenta, su saldo baja.")) return;
        const loans = await loadLoans();
        const target = loans.find((l) => l.id === loan.id);
        target.payments = target.payments.filter((x) => x.id !== p.id);
        await saveLoans(loans);
        if (p.accountId) {
          const acc = await DB.get("accounts", p.accountId);
          if (acc) { acc.balanceCents = (acc.balanceCents || 0) - p.amountCents; await DB.put("accounts", acc); }
        }
        close();
        onChanged();
      } }, "Quitar"),
    ]));
  }

  if ((loan.payments || []).length === 0) {
    sheet.appendChild(el("button", { class: "btn btn-secondary mt-8", style: "color:var(--danger);", onclick: async () => {
      if (!confirm(`¿Eliminar el préstamo a ${loan.name}?`)) return;
      const loans = await loadLoans();
      await saveLoans(loans.filter((l) => l.id !== loan.id));
      if (!loan.oldLoan && loan.accountId) {
        const acc = await DB.get("accounts", loan.accountId);
        if (acc) { acc.balanceCents = (acc.balanceCents || 0) + loan.principalCents; await DB.put("accounts", acc); }
      }
      close();
      onChanged();
    } }, "Eliminar préstamo"));
  }
}

/** Pestaña "Préstamos" dentro de Por cobrar */
async function renderLoansTab(root) {
  const loans = await loadLoans();
  const rows = loans.map((l) => ({ loan: l, status: loanStatus(l) }));
  const totalOwed = rows.reduce((s, r) => s + r.status.owed, 0);
  root.appendChild(el("div", { class: "card" }, [
    el("div", { class: "label" }, "Te deben"),
    el("div", { class: "ring-value", style: "font-size:28px;font-weight:700;" }, Money.format(totalOwed)),
    el("div", { class: "muted", style: "font-size:13px;" }, `${rows.length} ${rows.length === 1 ? "préstamo" : "préstamos"}`),
  ]));
  root.appendChild(el("button", { class: "btn", onclick: () => openNewLoanSheet(() => Router.render()) }, "+ Nuevo préstamo"));

  if (rows.length === 0) {
    root.appendChild(el("div", { class: "card", style: "margin-top:12px;" }, [el("div", { class: "empty-state" }, "Aquí registras lo que prestaste y te van pagando. Toca + Nuevo préstamo.")]));
    return;
  }
  for (const { loan, status } of rows) {
    const paidPct = status.paidTotal + status.owed > 0 ? Math.round((status.paidTotal / (status.paidTotal + status.owed)) * 100) : 0;
    const rateTxt = loan.monthlyRatePct ? `${loan.monthlyRatePct}% mensual` : "Sin intereses";
    root.appendChild(el("div", { class: "card", style: "margin-top:12px;cursor:pointer;", onclick: () => openLoanDetailSheet(loan, () => Router.render()) }, [
      el("div", { class: "flex-between" }, [
        el("div", {}, [el("div", { class: "title", style: "font-weight:700;" }, loan.name), el("div", { class: "meta muted", style: "font-size:12px;" }, `Prestado ${Money.format(loan.principalCents)} · ${rateTxt}`)]),
        el("strong", {}, Money.format(status.owed)),
      ]),
      el("div", { class: "goal-bar", style: "margin-top:10px;" }, [el("div", { class: "goal-fill", style: `width:${paidPct}%` })]),
      el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, `Te han pagado ${Money.format(status.paidTotal)} · ${paidPct}%`),
    ]));
  }
}

window.loadLoans = loadLoans;
window.loanStatus = loanStatus;
window.renderLoansTab = renderLoansTab;
