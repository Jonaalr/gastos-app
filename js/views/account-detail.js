/**
 * account-detail.js — Detalle de una cuenta: saldo y todos sus movimientos
 * (ingresos, gastos y transferencias), agrupados por día, como en Revolut.
 */

let accountDetailFilter = "all";

const ACCOUNT_DETAIL_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "income", label: "Ingresos" },
  { id: "expense", label: "Gastos" },
  { id: "transfer", label: "Transferencias" },
];

async function renderAccountDetail(root, params) {
  await capitalizeSavings();
  const id = parseInt(params.get("id") || "0", 10) || 0;
  const [account, transactions, categories, accounts] = await Promise.all([
    DB.get("accounts", id),
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getAll("accounts"),
  ]);
  if (!account) {
    Router.navigate("/accounts");
    return;
  }

  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const isCredit = account.type === "credit";
  const info = isCredit ? creditInfo(account) : null;

  root.appendChild(
    el("div", { class: "topbar" }, [
      el("div", {}, [
        el("button", { class: "link-btn", onclick: () => Router.navigate("/accounts") }, "‹ Cuentas"),
        el("h1", {}, account.name),
      ]),
    ])
  );

  root.appendChild(
    el("div", { class: "card balance-hero" }, [
      el("div", { class: "label" }, isCredit ? "Disponible" : "Saldo actual"),
      el("div", { class: "amount" }, Money.format(isCredit ? info.available : account.balanceCents)),
      el("div", { class: "label" }, isCredit ? `Gastado ${Money.format(info.spent)} · límite ${Money.format(info.limit)}` : accountSubtitle(account)),
      el("div", { class: "btn-row", style: "margin-top:14px;" }, [
        el("button", { class: "btn btn-secondary btn-sm", onclick: () => openAccountSheet({ existing: account, onSaved: () => Router.render() }) }, "Editar"),
        isCredit
          ? el("button", { class: "btn btn-secondary btn-sm", onclick: () => Router.navigate(`/import?account=${id}`) }, "Importar estado (PDF)")
          : null,
      ]),
    ])
  );

  // ---- Movimientos de esta cuenta (salidas y entradas) ----
  const entries = [];
  for (const t of transactions) {
    const cat = t.categoryId ? catMap[t.categoryId] : null;
    if (t.accountId === id) {
      if (t.type === "transfer") {
        entries.push({ t, group: "transfer", dir: "out", title: `Transferencia a ${accMap[t.toAccountId]?.name || "—"}`, icon: "🔁" });
      } else if (t.type === "income") {
        entries.push({ t, group: "income", dir: "in", title: t.merchant || (cat ? cat.name : "Ingreso"), icon: cat ? cat.icon : "💰", cat });
      } else {
        entries.push({ t, group: "expense", dir: "out", title: t.merchant || (cat ? cat.name : "Gasto"), icon: cat ? cat.icon : "📦", cat });
      }
    } else if (t.type === "transfer" && t.toAccountId === id) {
      entries.push({ t, group: "transfer", dir: "in", title: `Transferencia de ${accMap[t.accountId]?.name || "—"}`, icon: "🔁" });
    }
  }

  root.appendChild(
    el(
      "div",
      { class: "filter-row" },
      ACCOUNT_DETAIL_FILTERS.map((f) =>
        el("button", { class: `chip ${accountDetailFilter === f.id ? "on" : ""}`, onclick: () => { accountDetailFilter = f.id; Router.render(); } }, f.label)
      )
    )
  );

  const shown = entries
    .filter((e) => accountDetailFilter === "all" || e.group === accountDetailFilter)
    .sort((a, b) => (b.t.date + (b.t.createdAt || "")).localeCompare(a.t.date + (a.t.createdAt || "")));

  if (shown.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "Sin movimientos en esta cuenta.")));
    return;
  }

  const byDay = new Map();
  for (const e of shown) {
    if (!byDay.has(e.t.date)) byDay.set(e.t.date, []);
    byDay.get(e.t.date).push(e);
  }

  for (const [day, list] of byDay) {
    const net = list.reduce((s, e) => s + (e.dir === "in" ? e.t.amountCents : -e.t.amountCents), 0);
    root.appendChild(
      el("div", { class: "day-label", style: "display:flex;justify-content:space-between;" }, [
        el("span", {}, DateUtil.relativeLabel(day)),
        el("span", {}, `${net >= 0 ? "+" : "−"}${Money.format(Math.abs(net))}`),
      ])
    );
    const card = el("div", { class: "card tx-card" });
    for (const e of list) card.appendChild(accountMovementRow(e));
    root.appendChild(card);
  }
}

function accountMovementRow(e) {
  const t = e.t;
  const isInterest = t.source === "interest";
  const time = t.createdAt
    ? new Date(t.createdAt).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })
    : "";
  const metaParts = [];
  if (e.cat && e.group !== "transfer") metaParts.push(e.cat.name);
  metaParts.push(isInterest ? "Interés diario" : time);
  if (t.split) metaParts.push(`tu parte ${Money.format(t.split.myShareCents)}`);

  const amountClass = e.dir === "in" ? "income" : e.group === "transfer" ? "" : "expense";
  const row = el("div", { class: "list-item" }, [
    el("div", { class: `icon tx-${e.dir === "in" ? "income" : "expense"}` }, e.icon),
    el("div", { class: "main" }, [
      el("div", { class: "title" }, e.title),
      el("div", { class: "meta" }, metaParts.filter(Boolean).join(" · ")),
    ]),
    el("div", { class: `amount ${amountClass}` }, `${e.dir === "in" ? "+" : "−"}${Money.format(t.amountCents)}`),
  ]);
  if (!isInterest) {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => openTransactionSheet({ existing: t, onSaved: () => Router.render() }));
  }
  return row;
}

window.renderAccountDetail = renderAccountDetail;
