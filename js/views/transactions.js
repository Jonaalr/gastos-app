/**
 * transactions.js — Listado completo de transacciones con filtro por mes.
 */

async function renderTransactions(root, params) {
  const monthKey = params.get("month") || DateUtil.monthKey();
  const [allTx, categories, accounts] = await Promise.all([
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getAll("accounts"),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const txMonth = allTx.filter((t) => DateUtil.monthKey(t.date) === monthKey);
  txMonth.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const income = txMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
  const expense = txMonth.filter((t) => t.type === "expense").reduce((s, t) => s + t.amountCents, 0);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Movimientos")]));

  root.appendChild(renderMonthSwitcher(monthKey, (newMonth) => Router.navigate(`/transactions?month=${newMonth}`)));

  root.appendChild(
    el("div", { class: "stat-row mb-8" }, [
      el("div", { class: "stat-box income" }, [el("div", { class: "label" }, "Ingresos"), el("div", { class: "value" }, Money.format(income))]),
      el("div", { class: "stat-box expense" }, [el("div", { class: "label" }, "Gastos"), el("div", { class: "value" }, Money.format(expense))]),
    ])
  );

  const byDay = {};
  for (const t of txMonth) {
    byDay[t.date] = byDay[t.date] || [];
    byDay[t.date].push(t);
  }
  const days = Object.keys(byDay).sort().reverse();

  if (days.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "Sin movimientos este mes.")));
  } else {
    for (const day of days) {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, DateUtil.formatLong(day))]);
      for (const t of byDay[day]) card.appendChild(renderTxRow(t, catMap, accMap));
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

function renderMonthSwitcher(monthKey, onChange) {
  const [y, m] = monthKey.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const prev = new Date(y, m - 2, 1);
  const next = new Date(y, m, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;

  return el("div", { class: "flex-between card", style: "padding:10px 12px;" }, [
    el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", onclick: () => onChange(prevKey) }, "‹"),
    el("div", { style: "font-weight:700; text-transform:capitalize;" }, label),
    el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", onclick: () => onChange(nextKey) }, "›"),
  ]);
}

window.renderTransactions = renderTransactions;
window.renderMonthSwitcher = renderMonthSwitcher;
