/**
 * accounts.js — CRUD de cuentas + cálculo de rendimientos (cuentas de ahorro).
 */

async function renderAccounts(root) {
  const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Cuentas")]));

  const savingsAccounts = accounts.filter((a) => a.type === "savings" && a.annualRatePct);
  if (savingsAccounts.length > 0) {
    root.appendChild(await renderSavingsSummary(savingsAccounts));
  }

  if (accounts.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "No tienes cuentas todavía.")));
  } else {
    for (const a of accounts) {
      root.appendChild(renderAccountCard(a));
    }
  }

  root.appendChild(el("button", { class: "btn mt-8", onclick: () => openAccountSheet({ onSaved: () => Router.render() }) }, "+ Agregar cuenta"));

  root.querySelectorAll("[data-edit-account]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const acc = await DB.get("accounts", parseInt(btn.dataset.editAccount, 10));
      openAccountSheet({ existing: acc, onSaved: () => Router.render() });
    });
  });
}

function renderAccountCard(a) {
  const dailyInterest = a.type === "savings" && a.annualRatePct ? computeDailyInterestCents(a) : 0;
  return el("div", { class: "card" }, [
    el("div", { class: "flex-between" }, [
      el("div", { class: "flex-between", style: "gap:10px;" }, [
        el("div", { class: "icon", style: "width:38px;height:38px;border-radius:10px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;font-size:18px;" }, accountIcon(a.type)),
        el("div", {}, [
          el("div", { class: "title" }, a.name),
          el("div", { class: "meta" }, accountSubtitle(a)),
        ]),
      ]),
      el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", "data-edit-account": a.id }, "Editar"),
    ]),
    el("div", { class: "balance-hero", style: "padding:14px 0 4px;" }, [
      el("div", { class: "amount", style: "font-size:26px;" }, Money.format(a.balanceCents)),
    ]),
    a.type === "savings" && a.annualRatePct
      ? el("div", { class: "text-dim", style: "font-size:12px;text-align:center;" }, `Generando ~${Money.format(dailyInterest)}/día`)
      : null,
  ]);
}

function computeDailyInterestCents(account) {
  const dailyRate = account.annualRatePct / 100 / 365;
  return Math.round(account.balanceCents * dailyRate);
}
function computeMonthlyInterestCents(account) {
  const dailyRate = account.annualRatePct / 100 / 365;
  const days = DateUtil.daysInMonth(new Date().getFullYear(), new Date().getMonth());
  return Math.round(account.balanceCents * dailyRate * days);
}

async function renderSavingsSummary(savingsAccounts) {
  const totalBalance = savingsAccounts.reduce((s, a) => s + a.balanceCents, 0);
  const totalDaily = savingsAccounts.reduce((s, a) => s + computeDailyInterestCents(a), 0);
  const totalMonthly = savingsAccounts.reduce((s, a) => s + computeMonthlyInterestCents(a), 0);

  return el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "Resumen de rendimientos"),
    el("div", { class: "stat-row" }, [
      el("div", { class: "stat-box" }, [el("div", { class: "label" }, "Saldo en ahorro"), el("div", { class: "value" }, Money.format(totalBalance))]),
      el("div", { class: "stat-box income" }, [el("div", { class: "label" }, "Generando al mes"), el("div", { class: "value" }, Money.format(totalMonthly))]),
    ]),
    el("div", { class: "text-dim", style: "font-size:12px; margin-top:8px;" }, `≈ ${Money.format(totalDaily)} por día entre ${savingsAccounts.length} cuenta(s)`),
  ]);
}

async function openAccountSheet({ existing = null, onSaved = null } = {}) {
  const data = existing || {
    name: "",
    type: "debit",
    bank: "",
    balanceCents: 0,
    currency: "MXN",
    cutDay: null,
    dueDay: null,
    creditLimitCents: null,
    annualRatePct: null,
    archived: false,
    createdAt: new Date().toISOString(),
  };

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  sheet.innerHTML = `
    <div class="sheet-header">
      <h2>${existing ? "Editar cuenta" : "Nueva cuenta"}</h2>
      <button class="sheet-close" data-close>✕</button>
    </div>

    <div class="form-group">
      <label>Nombre</label>
      <input type="text" id="f-name" value="${data.name}" placeholder="Ej. Banamex Débito">
    </div>

    <div class="form-group">
      <label>Tipo</label>
      <select id="f-type">
        <option value="cash" ${data.type === "cash" ? "selected" : ""}>Efectivo</option>
        <option value="debit" ${data.type === "debit" ? "selected" : ""}>Débito</option>
        <option value="credit" ${data.type === "credit" ? "selected" : ""}>Crédito</option>
        <option value="savings" ${data.type === "savings" ? "selected" : ""}>Cuenta con rendimiento</option>
      </select>
    </div>

    <div class="form-group">
      <label>Banco / Fintech (opcional)</label>
      <input type="text" id="f-bank" value="${data.bank || ""}" placeholder="Ej. Banamex, Nu, Klar...">
    </div>

    <div class="form-group">
      <label>${existing ? "Saldo actual" : "Saldo inicial"}</label>
      <input type="number" inputmode="decimal" step="0.01" id="f-balance" value="${Money.toInputValue(data.balanceCents)}">
    </div>

    <div id="credit-fields" style="display:${data.type === "credit" ? "block" : "none"}">
      <div class="form-group">
        <label>Día de corte (1-31)</label>
        <input type="number" min="1" max="31" id="f-cutday" value="${data.cutDay || ""}">
      </div>
      <div class="form-group">
        <label>Día límite de pago (1-31)</label>
        <input type="number" min="1" max="31" id="f-dueday" value="${data.dueDay || ""}">
      </div>
      <div class="form-group">
        <label>Límite de crédito (opcional)</label>
        <input type="number" inputmode="decimal" step="0.01" id="f-limit" value="${data.creditLimitCents ? Money.toInputValue(data.creditLimitCents) : ""}">
      </div>
    </div>

    <div id="savings-fields" style="display:${data.type === "savings" ? "block" : "none"}">
      <div class="form-group">
        <label>Tasa anual (%)</label>
        <input type="number" inputmode="decimal" step="0.01" id="f-rate" value="${data.annualRatePct || ""}" placeholder="Ej. 11.5">
      </div>
    </div>

    <div class="btn-row mt-8">
      ${existing ? '<button class="btn btn-danger btn-sm" id="f-archive" style="flex:0 0 auto;">Archivar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.querySelector("#f-type").addEventListener("change", (e) => {
    sheet.querySelector("#credit-fields").style.display = e.target.value === "credit" ? "block" : "none";
    sheet.querySelector("#savings-fields").style.display = e.target.value === "savings" ? "block" : "none";
  });

  if (existing) {
    sheet.querySelector("#f-archive").addEventListener("click", async () => {
      if (!confirm("¿Archivar esta cuenta? No se borran sus transacciones, pero dejará de aparecer en el resumen.")) return;
      existing.archived = true;
      await DB.put("accounts", existing);
      close();
      if (onSaved) onSaved();
    });
  }

  sheet.querySelector("#f-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#f-name").value.trim();
    if (!name) { toast("Ponle un nombre a la cuenta", "error"); return; }
    const type = sheet.querySelector("#f-type").value;

    const record = {
      ...data,
      name,
      type,
      bank: sheet.querySelector("#f-bank").value.trim(),
      balanceCents: Money.toCents(sheet.querySelector("#f-balance").value),
      cutDay: type === "credit" ? parseInt(sheet.querySelector("#f-cutday").value || "0", 10) || null : null,
      dueDay: type === "credit" ? parseInt(sheet.querySelector("#f-dueday").value || "0", 10) || null : null,
      creditLimitCents: type === "credit" ? Money.toCents(sheet.querySelector("#f-limit").value || "0") || null : null,
      annualRatePct: type === "savings" ? parseFloat(sheet.querySelector("#f-rate").value || "0") || null : null,
      rateUpdatedAt: type === "savings" ? DateUtil.todayISO() : null,
    };
    if (existing) record.id = existing.id;

    await DB.put("accounts", record);
    toast("Cuenta guardada", "success");
    close();
    if (onSaved) onSaved();
  });
}

window.renderAccounts = renderAccounts;
window.openAccountSheet = openAccountSheet;
window.computeDailyInterestCents = computeDailyInterestCents;
window.computeMonthlyInterestCents = computeMonthlyInterestCents;
