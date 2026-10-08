/**
 * dashboard.js — Pantalla principal: saldo total, gasto del mes, cuentas y últimos movimientos.
 */

async function renderDashboard(root) {
  await capitalizeSavings();
  const [accounts, transactions, userName] = await Promise.all([
    DB.getAll("accounts"),
    DB.getAll("transactions"),
    DB.getMeta("userName", ""),
  ]);

  const activeAccounts = accounts.filter((a) => !a.archived);
  // Dinero total = efectivo + débito + ahorro (sin tarjetas)
  const moneyTotal = activeAccounts.filter((a) => a.type !== "credit").reduce((sum, a) => sum + a.balanceCents, 0);
  // Por pagar = lo gastado en tarjetas de crédito
  const creditDebt = activeAccounts.filter((a) => a.type === "credit").reduce((sum, a) => sum + creditInfo(a).spent, 0);
  // Total ya pagando tarjetas
  const afterDebt = moneyTotal - creditDebt;

  const thisMonth = DateUtil.monthKey();
  const txThisMonth = transactions.filter((t) => DateUtil.monthKey(t.date) === thisMonth);
  const incomeThisMonth = txThisMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
  const expenseThisMonth = txThisMonth.filter((t) => t.type === "expense").reduce((s, t) => s + myShareCents(t), 0);

  const recent = [...transactions].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, 8);
  const categories = await DB.getAll("categories");
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  root.appendChild(
    el("div", { class: "topbar" }, [
      el("div", {}, [
        el("h1", {}, userName ? `Hola, ${userName}` : "Mis Gastos"),
        el("div", { class: "subtitle" }, DateUtil.formatLong(DateUtil.todayISO())),
      ]),
    ])
  );

  // ---- Stats: saldo total + gasto del mes ----
  root.appendChild(
    el("div", { class: "stat-card primary hero-total" }, [
      el("div", { class: "stat-label" }, "Dinero total"),
      el("div", { class: "stat-value big" }, Money.format(moneyTotal)),
      el("div", { class: "debt-row" }, [
        el("span", {}, "Por pagar en tarjetas"),
        el("strong", {}, `−${Money.format(creditDebt)}`),
      ]),
      el("div", { class: "after-debt" }, [
        el("span", {}, "Total ya pagando tarjetas"),
        el("strong", {}, Money.format(afterDebt)),
      ]),
    ])
  );

  root.appendChild(
    el("div", { class: "stats-grid", style: "grid-template-columns:1fr;" }, [
      el("div", { class: "stat-card secondary" }, [
        el("div", { class: "stat-label" }, "Gasto del mes"),
        el("div", { class: "stat-value" }, Money.format(expenseThisMonth)),
        el("div", { class: "stat-sub" }, `Ingresos ${Money.format(incomeThisMonth)}`),
      ]),
    ])
  );

  // ---- Por cobrar (solo si hay gastos compartidos pendientes) ----
  const receivable = await receivablesTotal();
  if (receivable.count > 0) {
    root.appendChild(
      el("div", { class: "receivable-card", onclick: () => Router.navigate("/receivables") }, [
        el("div", {}, [
          el("div", { class: "stat-label" }, "Por cobrar"),
          el("div", { class: "receivable-amount" }, Money.format(receivable.total)),
          el("div", { class: "stat-sub" }, `${receivable.count} ${receivable.count === 1 ? "persona te debe" : "personas te deben"}`),
        ]),
        el("div", { class: "receivable-arrow" }, "›"),
      ])
    );
  }

  // ---- Cuentas (carrusel horizontal) ----
  if (activeAccounts.length === 0) {
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "empty-state" }, "Aún no tienes cuentas registradas."),
        el("button", { class: "btn", onclick: () => Router.navigate("/accounts") }, "Crear mi primera cuenta"),
      ])
    );
  } else {
    root.appendChild(
      el("div", { class: "section-header" }, [
        el("div", { class: "section-heading" }, "Mis cuentas"),
        el("button", { class: "link-btn", onclick: () => Router.navigate("/accounts") }, "Ver todo"),
      ])
    );
    const carousel = el("div", { class: "accounts-carousel" });
    for (const a of activeAccounts) {
      const isCredit = a.type === "credit" && a.creditLimitCents;
      carousel.appendChild(
        el("div", { class: "account-pill", onclick: () => Router.navigate("/accounts") }, [
          el("div", { class: "icon-chip" }, accountIcon(a.type)),
          el("div", { class: "pill-name" }, a.name),
          el("div", { class: "pill-amount" }, Money.format(isCredit ? creditInfo(a).available : a.balanceCents)),
          el("div", { class: "pill-sub" }, isCredit ? "disponible" : accountSubtitle(a)),
        ])
      );
    }
    root.appendChild(carousel);
  }

  // ---- Movimientos recientes agrupados por día ----
  root.appendChild(
    el("div", { class: "section-header" }, [
      el("div", { class: "section-heading" }, "Movimientos"),
      el("button", { class: "link-btn", onclick: () => Router.navigate("/transactions") }, "Ver todos"),
    ])
  );

  if (recent.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "Sin movimientos todavía. Toca el botón + para registrar uno.")));
  } else {
    const byDay = new Map();
    for (const t of recent) {
      if (!byDay.has(t.date)) byDay.set(t.date, []);
      byDay.get(t.date).push(t);
    }
    for (const [day, list] of byDay) {
      root.appendChild(el("div", { class: "day-label" }, DateUtil.relativeLabel(day)));
      const card = el("div", { class: "card tx-card" });
      for (const t of list) card.appendChild(renderTxRow(t, catMap, accMap));
      root.appendChild(card);
    }
  }

  root.querySelectorAll(".list-item[data-tx-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      const tx = await DB.get("transactions", parseInt(row.dataset.txId, 10));
      openTransactionSheet({ existing: tx, onSaved: () => Router.render() });
    });
  });
}

function accountIcon(type) {
  return { cash: "💵", debit: "💳", credit: "🪪", savings: "🏦" }[type] || "💰";
}
function accountSubtitle(a) {
  if (a.type === "credit") return a.cutDay ? `Crédito · corte día ${a.cutDay}` : "Crédito";
  if (a.type === "savings") return `Rendimiento · ${a.annualRatePct || 0}% anual`;
  return { cash: "Efectivo", debit: "Débito" }[a.type] || "";
}

function renderTxRow(t, catMap, accMap) {
  const cat = t.categoryId ? catMap[t.categoryId] : null;
  const acc = accMap[t.accountId];
  const isIncome = t.type === "income";
  const isTransfer = t.type === "transfer";
  const sign = isIncome ? "+" : isTransfer ? "" : "-";
  const kind = isIncome ? "income" : isTransfer ? "transfer" : "expense";

  const row = el("div", { class: "list-item", "data-tx-id": t.id }, [
    el("div", { class: `icon tx-${kind}` }, isTransfer ? "🔁" : cat ? cat.icon : "📦"),
    el("div", { class: "main" }, [
      el("div", { class: "title" }, isTransfer ? "Transferencia" : t.merchant || (cat ? cat.name : "Sin descripción")),
      el("div", { class: "meta" }, `${cat && !isTransfer ? cat.name + " · " : ""}${acc ? acc.name : "—"}${t.isRecurring ? " · domiciliado" : ""}${t.split ? ` · entre varios, tu parte ${Money.format(t.split.myShareCents)}` : ""}`),
    ]),
    el("div", { class: `amount ${kind === "transfer" ? "" : kind}` }, `${sign}${Money.format(t.amountCents)}`),
  ]);
  row.style.cursor = "pointer";
  return row;
}

window.renderDashboard = renderDashboard;
window.renderTxRow = renderTxRow;
window.accountIcon = accountIcon;
window.accountSubtitle = accountSubtitle;
