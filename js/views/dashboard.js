/**
 * dashboard.js — Pantalla principal: saldo total, resumen del mes, últimos movimientos.
 */

async function renderDashboard(root) {
  const [accounts, transactions, userName] = await Promise.all([
    DB.getAll("accounts"),
    DB.getAll("transactions"),
    DB.getMeta("userName", ""),
  ]);

  const activeAccounts = accounts.filter((a) => !a.archived);
  const totalBalance = activeAccounts.reduce((sum, a) => sum + a.balanceCents, 0);

  const thisMonth = DateUtil.monthKey();
  const txThisMonth = transactions.filter((t) => DateUtil.monthKey(t.date) === thisMonth);
  const incomeThisMonth = txThisMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
  const expenseThisMonth = txThisMonth.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountCents, 0);

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

  root.appendChild(
    el("div", { class: "card balance-hero" }, [
      el("div", { class: "label" }, "Saldo total"),
      el("div", { class: "amount" }, Money.format(totalBalance)),
    ])
  );

  root.appendChild(
    el("div", { class: "stat-row mb-8" }, [
      el("div", { class: "stat-box income" }, [
        el("div", { class: "label" }, "Ingresos del mes"),
        el("div", { class: "value" }, Money.format(incomeThisMonth)),
      ]),
      el("div", { class: "stat-box expense" }, [
        el("div", { class: "label" }, "Gastos del mes"),
        el("div", { class: "value" }, Money.format(expenseThisMonth)),
      ]),
    ])
  );

  if (activeAccounts.length === 0) {
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "empty-state" }, "Aún no tienes cuentas registradas."),
        el("button", { class: "btn", onclick: () => Router.navigate("/accounts") }, "Crear mi primera cuenta"),
      ])
    );
  } else {
    const list = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Cuentas")]);
    for (const a of activeAccounts) {
      list.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { class: "icon" }, accountIcon(a.type)),
          el("div", { class: "main" }, [
            el("div", { class: "title" }, a.name),
            el("div", { class: "meta" }, accountSubtitle(a)),
          ]),
          el("div", { class: "amount" }, Money.format(a.balanceCents)),
        ])
      );
    }
    root.appendChild(list);
  }

  const recentCard = el("div", { class: "card" }, [
    el("div", { class: "flex-between" }, [
      el("div", { class: "card-title" }, "Movimientos recientes"),
      el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", onclick: () => Router.navigate("/transactions") }, "Ver todos"),
    ]),
  ]);

  if (recent.length === 0) {
    recentCard.appendChild(el("div", { class: "empty-state" }, "Sin movimientos todavía. Toca el botón + para registrar uno."));
  } else {
    for (const t of recent) {
      recentCard.appendChild(renderTxRow(t, catMap, accMap));
    }
  }
  root.appendChild(recentCard);

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
  if (a.type === "credit") return `Crédito · corte día ${a.cutDay}`;
  if (a.type === "savings") return `Rendimiento · ${a.annualRatePct || 0}% anual`;
  return { cash: "Efectivo", debit: "Débito" }[a.type] || "";
}

function renderTxRow(t, catMap, accMap) {
  const cat = t.categoryId ? catMap[t.categoryId] : null;
  const acc = accMap[t.accountId];
  const isIncome = t.type === "income";
  const isTransfer = t.type === "transfer";
  const sign = isIncome ? "+" : isTransfer ? "" : "-";
  const amountClass = isIncome ? "income" : isTransfer ? "" : "expense";

  const row = el("div", { class: "list-item", "data-tx-id": t.id }, [
    el("div", { class: "icon" }, isTransfer ? "🔁" : cat ? cat.icon : "📦"),
    el("div", { class: "main" }, [
      el("div", { class: "title" }, isTransfer ? "Transferencia" : t.merchant || (cat ? cat.name : "Sin descripción")),
      el("div", { class: "meta" }, `${DateUtil.formatShort(t.date)} · ${acc ? acc.name : "—"}${t.isRecurring ? " · 🔄 domiciliado" : ""}`),
    ]),
    el("div", { class: `amount ${amountClass}` }, `${sign}${Money.format(t.amountCents)}`),
  ]);
  row.style.cursor = "pointer";
  return row;
}

window.renderDashboard = renderDashboard;
window.renderTxRow = renderTxRow;
window.accountIcon = accountIcon;
window.accountSubtitle = accountSubtitle;
