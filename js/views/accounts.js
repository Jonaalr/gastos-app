/**
 * accounts.js — CRUD de cuentas + cálculo de rendimientos (cuentas de ahorro)
 * + tarjetas de crédito (límite, disponible, gastado, corte y pago).
 *
 * Modelo de tarjeta de crédito:
 *   balanceCents = disponible - límite  (siempre ≤ 0: es lo que se debe)
 *   gastado      = -balanceCents
 *   disponible   = límite + balanceCents
 * Así cada gasto registrado en la tarjeta baja el disponible y sube lo gastado.
 */

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Cifras de una tarjeta de crédito en centavos */
function creditInfo(a) {
  const limit = a.creditLimitCents || 0;
  return {
    limit,
    spent: Math.max(0, -a.balanceCents),
    available: limit + a.balanceCents,
  };
}

/** Fecha corta "15 oct" de la próxima vez que cae un día del mes */
function nextDayLabel(day) {
  if (!day) return "—";
  return DateUtil.parseISO(DateUtil.nextOccurrence(day)).toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(/\./g, "");
}

/** Filtro seleccionado en la pantalla de cuentas (se conserva mientras la app esté abierta) */
let accountsFilter = "all";

const ACCOUNT_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "cash", label: "Efectivo" },
  { id: "debit", label: "Débito" },
  { id: "credit", label: "Crédito" },
  { id: "savings", label: "Rendimientos" },
];

async function renderAccounts(root) {
  await capitalizeSavings();
  const allAccounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
  const accounts = allAccounts.filter((a) => accountsFilter === "all" || a.type === accountsFilter);

  root.appendChild(
    el("div", { class: "topbar" }, [
      el("div", {}, [
        el("h1", {}, "Cuentas"),
        el("div", { class: "subtitle" }, `${accounts.length} ${accounts.length === 1 ? "cuenta" : "cuentas"}`),
      ]),
    ])
  );
  root.appendChild(sectionTabs(DINERO_TABS, "/accounts"));

  root.appendChild(
    el(
      "div",
      { class: "filter-row" },
      ACCOUNT_FILTERS.map((f) =>
        el("button", { class: `chip ${accountsFilter === f.id ? "on" : ""}`, "data-filter": f.id, onclick: () => { accountsFilter = f.id; Router.render(); } }, f.label)
      )
    )
  );

  const savingsAccounts = accounts.filter((a) => a.type === "savings" && a.annualRatePct);
  if (savingsAccounts.length > 0 && accountsFilter === "savings") {
    root.appendChild(await renderSavingsSummary(savingsAccounts));
  }

  if (allAccounts.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "No tienes cuentas todavía.")));
  } else if (accounts.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "No tienes cuentas de este tipo.")));
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
  const isCredit = a.type === "credit";
  const dailyInterest = a.type === "savings" && a.annualRatePct ? computeDailyInterestCents(a) : 0;
  const info = isCredit ? creditInfo(a) : null;

  return el("div", {
    class: `card account-card type-${a.type}`,
    style: "cursor:pointer;",
    onclick: (e) => {
      if (e.target.closest("button")) return;
      Router.navigate(`/account?id=${a.id}`);
    },
  }, [
    el("div", { class: "flex-between" }, [
      el("div", { class: "account-head" }, [
        el("div", { class: "icon-chip" }, accountBadge(a)),
        el("div", {}, [el("div", { class: "title" }, a.name), el("div", { class: "meta" }, accountSubtitle(a))]),
      ]),
      el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", "data-edit-account": a.id }, "Editar"),
    ]),
    el("div", { class: "account-amount-block" }, [
      el("div", { class: "label" }, isCredit ? "Disponible" : "Saldo"),
      el("div", { class: "amount" }, Money.format(isCredit ? info.available : a.balanceCents)),
    ]),
    isCredit
      ? el("div", { class: "credit-grid" }, [
          el("div", {}, [el("span", { class: "k" }, "Límite"), el("span", { class: "v" }, Money.format(info.limit))]),
          el("div", {}, [el("span", { class: "k" }, "Gastado"), el("span", { class: "v debt" }, Money.format(info.spent))]),
          el("div", {}, [el("span", { class: "k" }, "Próximo corte"), el("span", { class: "v" }, nextDayLabel(a.cutDay))]),
          el("div", {}, [el("span", { class: "k" }, "Pago vence"), el("span", { class: "v" }, nextDayLabel(a.dueDay))]),
        ])
      : null,
    a.type === "savings" && a.annualRatePct
      ? el("div", { class: "text-dim", style: "font-size:12px;margin-top:8px;" }, `Generando ~${Money.format(dailyInterest)}/día`)
      : null,
    isCredit
      ? el("button", { class: "btn btn-secondary btn-sm", style: "width:100%;margin-top:14px;", onclick: () => Router.navigate(`/import?account=${a.id}`) }, "Importar estado de cuenta (PDF)")
      : null,
  ]);
}

/**
 * Capitaliza los rendimientos de las cuentas de ahorro: cada día se calcula el
 * interés sobre el saldo del día anterior y se suma al saldo (interés compuesto).
 * Cuenta desde la última fecha de referencia (rateUpdatedAt) o desde que se creó la cuenta.
 * Se ejecuta en serie para que dos llamadas seguidas no dupliquen intereses.
 */
let savingsQueue = Promise.resolve();
function capitalizeSavings() {
  savingsQueue = savingsQueue.then(runCapitalizeSavings, runCapitalizeSavings);
  return savingsQueue;
}
async function runCapitalizeSavings() {
  const today = DateUtil.todayISO();
  const accounts = await DB.getAll("accounts");
  const categories = await DB.getAll("categories");
  const interestCat = categories.find((c) => c.kind === "income" && c.name === "Rendimientos");
  for (const a of accounts) {
    if (a.type !== "savings" || !a.annualRatePct || a.archived) continue;
    const since = a.rateUpdatedAt || (a.createdAt ? DateUtil.toISO(new Date(a.createdAt)) : today);
    const days = DateUtil.daysBetween(since, today);
    if (!(days > 0)) continue;

    const start = DateUtil.parseISO(since);
    let balance = a.balanceCents;
    for (let i = 0; i < days; i++) {
      const { gross, tax, net } = dailyInterestBreakdown(balance, a.annualRatePct, savingsRules(a));
      balance += net;
      // Cada día queda registrado como "Interés pagado" (no vuelve a cambiar el saldo)
      const day = new Date(start);
      day.setDate(day.getDate() + i + 1);
      await DB.add("transactions", {
        type: "income",
        amountCents: net,
        grossCents: gross,
        taxWithheldCents: tax,
        accountId: a.id,
        toAccountId: null,
        categoryId: interestCat ? interestCat.id : null,
        merchant: "Interés pagado",
        note: "",
        date: DateUtil.toISO(day),
        isRecurring: false,
        recurringDay: null,
        attachment: null,
        source: "interest",
        balanceApplied: false,
        createdAt: new Date().toISOString(),
      });
    }
    a.balanceCents = balance;
    a.rateUpdatedAt = today;
    await DB.put("accounts", a);
  }
}

/**
 * Reglas de rendimiento de cada cuenta de ahorro (cada banco es distinto):
 * - dayBasis: días de la base para el interés bruto (360 o 365)
 * - isrPct: ISR retenido anual en % (0 si el banco no retiene)
 * El ISR se calcula sobre base de 365 días.
 * Valores por defecto para cuentas sin configurar: base 365 y sin ISR.
 * Revolut México: base 360 y ISR 0.90 (ver config en el formulario de la cuenta).
 */
const ISR_DAY_BASIS = 365;
const DEFAULT_DAY_BASIS = 365;

function savingsRules(account) {
  const dayBasis = Number(account.interestDayBasis) === 360 ? 360 : DEFAULT_DAY_BASIS;
  const isrPct = Number.isFinite(Number(account.isrPct)) && account.isrPct !== null ? Number(account.isrPct) : 0;
  return { dayBasis, isrPct };
}

function dailyInterestBreakdown(balanceCents, annualRatePct, rules = { dayBasis: DEFAULT_DAY_BASIS, isrPct: 0 }) {
  const gross = Math.round(balanceCents * (annualRatePct / 100) / rules.dayBasis);
  const tax = Math.round(balanceCents * (rules.isrPct / 100) / ISR_DAY_BASIS);
  return { gross, tax, net: gross - tax };
}

function computeDailyInterestCents(account) {
  return dailyInterestBreakdown(account.balanceCents, account.annualRatePct, savingsRules(account)).net;
}
function computeMonthlyInterestCents(account) {
  const days = DateUtil.daysInMonth(new Date().getFullYear(), new Date().getMonth());
  return computeDailyInterestCents(account) * days;
}

async function renderSavingsSummary(savingsAccounts) {
  const totalBalance = savingsAccounts.reduce((s, a) => s + a.balanceCents, 0);
  const totalDaily = savingsAccounts.reduce((s, a) => s + computeDailyInterestCents(a), 0);
  const totalMonthly = savingsAccounts.reduce((s, a) => s + computeMonthlyInterestCents(a), 0);

  return el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "Resumen de rendimientos"),
    el("div", { class: "stat-row" }, [
      el("div", { class: "stat-box" }, [el("div", { class: "label" }, "Saldo generando rendimientos"), el("div", { class: "value" }, Money.format(totalBalance))]),
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
    cutRefDate: null,
    dueRefDate: null,
    creditLimitCents: null,
    annualRatePct: null,
    archived: false,
    createdAt: new Date().toISOString(),
  };

  // Estado de la tarjeta de crédito dentro del formulario
  const initialInfo = existing && existing.type === "credit" ? creditInfo(existing) : null;
  let cutRef = data.cutRefDate || (data.cutDay ? DateUtil.nextOccurrence(data.cutDay) : null);
  let dueRef = data.dueRefDate || (data.dueDay ? DateUtil.nextOccurrence(data.dueDay) : null);
  let availableTouched = false;

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
      <input type="text" id="f-name" value="${escapeAttr(data.name)}" placeholder="Ej. Banamex Débito">
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
      <input type="text" id="f-bank" value="${escapeAttr(data.bank)}" placeholder="Ej. Banamex, Nu, Klar...">
    </div>

    <div class="form-group" id="balance-group" style="display:${data.type === "credit" ? "none" : "block"}">
      <label>${existing ? "Saldo actual" : "Saldo inicial"}</label>
      <input type="number" inputmode="decimal" step="0.01" id="f-balance" value="${Money.toInputValue(data.type === "credit" ? 0 : data.balanceCents)}">
    </div>

    <div id="credit-fields" style="display:${data.type === "credit" ? "block" : "none"}">
      <div class="form-group">
        <label>Límite de crédito</label>
        <input type="number" inputmode="decimal" step="0.01" id="f-limit" placeholder="Ej. 10000" value="${initialInfo && initialInfo.limit ? Money.toInputValue(initialInfo.limit) : ""}">
      </div>
      <div class="form-group">
        <label>Saldo disponible actual</label>
        <input type="number" inputmode="decimal" step="0.01" id="f-available" placeholder="Lo que aún puedes gastar" value="${initialInfo && initialInfo.limit ? Money.toInputValue(initialInfo.available) : ""}">
        <div class="field-hint" id="credit-summary"></div>
      </div>
      <div class="form-group">
        <label>Fecha de corte</label>
        <button type="button" class="date-field" id="f-cut"></button>
        <div class="field-hint">Elige un corte de referencia (de este mes o el próximo). Los demás meses se calculan solos.</div>
      </div>
      <div class="form-group">
        <label>Fecha límite de pago</label>
        <button type="button" class="date-field" id="f-due"></button>
      </div>
    </div>

    <div id="savings-fields" style="display:${data.type === "savings" ? "block" : "none"}">
      <div class="form-group">
        <label>Tasa anual (%)</label>
        <input type="number" inputmode="decimal" step="0.01" id="f-rate" value="${data.annualRatePct || ""}" placeholder="Ej. 11.5">
      </div>
      <div class="form-group">
        <label>Base de días del interés</label>
        <select id="f-basis">
          <option value="365" ${savingsRules(data).dayBasis === 365 ? "selected" : ""}>365 días</option>
          <option value="360" ${savingsRules(data).dayBasis === 360 ? "selected" : ""}>360 días</option>
        </select>
      </div>
      <div class="form-group">
        <label>ISR retenido anual (%)</label>
        <input type="number" inputmode="decimal" step="0.01" id="f-isr" value="${savingsRules(data).isrPct || ""}" placeholder="0 si el banco no retiene">
        <div class="field-hint">Revolut México retiene 0.90%. Pon 0 si tu banco no retiene.</div>
      </div>
    </div>

    <div class="btn-row mt-8">
      ${existing ? '<button class="btn btn-danger btn-sm" id="f-archive" style="flex:0 0 auto;">Archivar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

  const $ = (sel) => sheet.querySelector(sel);

  function refreshDateButtons() {
    const set = (btn, iso, placeholder) => {
      btn.textContent = iso ? DateUtil.formatMedium(iso) : placeholder;
      btn.classList.toggle("empty", !iso);
    };
    set($("#f-cut"), cutRef, "Seleccionar fecha");
    set($("#f-due"), dueRef, "Seleccionar fecha");
  }

  function refreshCreditSummary() {
    const limit = Money.toCents($("#f-limit").value || "0");
    const availRaw = $("#f-available").value.trim();
    const hint = $("#credit-summary");
    if (!limit) { hint.textContent = "Gastado = límite − disponible"; return; }
    const available = availRaw === "" ? limit : Money.toCents(availRaw);
    const spent = limit - available;
    hint.textContent = spent >= 0 ? `Gastado en la tarjeta: ${Money.format(spent)}` : `Saldo a favor: ${Money.format(-spent)}`;
  }

  refreshDateButtons();
  refreshCreditSummary();

  $("[data-close]").addEventListener("click", close);
  $("#f-type").addEventListener("change", (e) => {
    const t = e.target.value;
    $("#credit-fields").style.display = t === "credit" ? "block" : "none";
    $("#balance-group").style.display = t === "credit" ? "none" : "block";
    $("#savings-fields").style.display = t === "savings" ? "block" : "none";
  });

  $("#f-cut").addEventListener("click", async () => {
    const iso = await pickDate({ title: "Fecha de corte", value: cutRef });
    if (iso) { cutRef = iso; refreshDateButtons(); }
  });
  $("#f-due").addEventListener("click", async () => {
    const iso = await pickDate({ title: "Fecha límite de pago", value: dueRef });
    if (iso) { dueRef = iso; refreshDateButtons(); }
  });

  $("#f-available").addEventListener("input", () => { availableTouched = true; refreshCreditSummary(); });
  $("#f-limit").addEventListener("input", () => {
    // Si el banco sube el límite, lo gastado no cambia: el disponible se ajusta solo
    if (initialInfo && !availableTouched) {
      const newLimit = Money.toCents($("#f-limit").value || "0");
      $("#f-available").value = newLimit ? Money.toInputValue(newLimit - initialInfo.spent) : "";
    }
    refreshCreditSummary();
  });

  if (existing) {
    $("#f-archive").addEventListener("click", async () => {
      if (!confirm("¿Archivar esta cuenta? No se borran sus transacciones, pero dejará de aparecer en el resumen.")) return;
      existing.archived = true;
      await DB.put("accounts", existing);
      close();
      if (onSaved) onSaved();
    });
  }

  $("#f-save").addEventListener("click", async () => {
    const name = $("#f-name").value.trim();
    if (!name) { toast("Ponle un nombre a la cuenta", "error"); return; }
    const type = $("#f-type").value;

    let balanceCents = Money.toCents($("#f-balance").value);
    let creditLimitCents = null;

    if (type === "credit") {
      creditLimitCents = Money.toCents($("#f-limit").value || "0");
      if (creditLimitCents <= 0) { toast("Pon el límite de crédito de la tarjeta", "error"); return; }
      const availRaw = $("#f-available").value.trim();
      const availableCents = availRaw === "" ? creditLimitCents : Money.toCents(availRaw);
      balanceCents = availableCents - creditLimitCents; // negativo = lo que se debe
    }

    const record = {
      ...data,
      name,
      type,
      bank: $("#f-bank").value.trim(),
      balanceCents,
      creditLimitCents,
      cutDay: type === "credit" && cutRef ? DateUtil.parseISO(cutRef).getDate() : null,
      dueDay: type === "credit" && dueRef ? DateUtil.parseISO(dueRef).getDate() : null,
      cutRefDate: type === "credit" ? cutRef : null,
      dueRefDate: type === "credit" ? dueRef : null,
      annualRatePct: type === "savings" ? parseFloat($("#f-rate").value || "0") || null : null,
      interestDayBasis: type === "savings" ? (parseInt($("#f-basis").value, 10) === 360 ? 360 : 365) : null,
      isrPct: type === "savings" ? Math.max(0, parseFloat($("#f-isr").value || "0") || 0) : null,
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
window.capitalizeSavings = capitalizeSavings;
window.computeMonthlyInterestCents = computeMonthlyInterestCents;
window.creditInfo = creditInfo;
window.nextDayLabel = nextDayLabel;
