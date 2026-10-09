/**
 * transactions.js — Listado completo de transacciones con filtro por mes.
 */

let txFiltersOpen = false;

async function renderTransactions(root, params) {
  const monthKey = params.get("month") || DateUtil.monthKey();
  const [allTx, categories, accounts] = await Promise.all([
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getAll("accounts"),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  // Filtros: texto (busca en todos los meses), categoría y cuenta
  const q = (params.get("q") || "").trim();
  const catF = params.get("cat") || "";
  const accF = params.get("acc") || "";
  const fromF = params.get("from") || "";
  const toF = params.get("to") || "";
  const ranged = !!(fromF || toF);
  const allTime = params.get("todo") === "1";
  const qLower = q.toLowerCase();
  const txMonth = allTx
    .filter((t) => (q || ranged || allTime ? true : DateUtil.monthKey(t.date) === monthKey))
    .filter((t) => (fromF ? t.date >= fromF : true) && (toF ? t.date <= toF : true))
    .filter((t) => {
      if (catF === "none") return !t.categoryId;
      if (catF) return String(t.categoryId) === catF;
      return true;
    })
    .filter((t) => (accF ? String(t.accountId) === accF : true))
    .filter((t) => {
      if (!qLower) return true;
      const cat = catMap[t.categoryId];
      const hay = `${t.merchant || ""} ${t.note || ""} ${cat ? cat.name : ""}`.toLowerCase();
      return hay.includes(qLower);
    });
  txMonth.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const goTo = (changes) => {
    const next = new URLSearchParams();
    const values = { month: monthKey, q, cat: catF, acc: accF, from: fromF, to: toF, ...changes };
    const dropMonth = !!(values.q || values.from || values.to || values.todo);
    for (const [k, v] of Object.entries(values)) if (v && !(k === "month" && dropMonth)) next.set(k, v);
    Router.navigate(`/transactions?${next.toString()}`);
  };

  const income = txMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
  const expense = txMonth.filter((t) => t.type === "expense").reduce((s, t) => s + myShareCents(t), 0);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Reportes")]));
  root.appendChild(sectionTabs(REPORTES_TABS, "/transactions"));


  // Barra de búsqueda y filtros
  const txFiltersNodes = () => {
    const pinfo = { monthKey, from: fromF, to: toF, todo: allTime };
    const catObj = catF && catF !== "none" ? categories.find((c) => String(c.id) === catF) : null;
    const catName = catF === "none" ? "Sin categoría" : catObj ? catObj.name : "Categoría";
    const accObj = accF ? accMap[accF] : null;
    const count = (ranged || allTime ? 1 : 0) + (catF ? 1 : 0) + (accF ? 1 : 0);
    return filtersPanel({
      open: txFiltersOpen,
      count,
      onToggle: () => { txFiltersOpen = !txFiltersOpen; Router.render(); },
      items: [
        iconChip("calendar", `${periodLabelFor(pinfo)} ▾`, ranged || allTime, () => openPeriodSheet(pinfo, (c) => goTo(c))),
        iconChip("tag", `${catName} ▾`, !!catF, () => openCategorySheet(categories, catF, (c) => goTo(c))),
        iconChip("bank", `${accObj ? accObj.name : "Cuenta"} ▾`, !!accF, () => openAccountSheet(accounts, accF, (c) => goTo(c))),
      ],
    });
  };

  const search = el("input", { type: "search", placeholder: "Buscar comercio, nota o categoría", value: q, style: "width:100%;margin-bottom:8px;" });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") goTo({ q: search.value.trim() }); });
  search.addEventListener("change", () => goTo({ q: search.value.trim() }));

  root.appendChild(
    el("div", { class: "card tx-search-card", style: "padding:12px;" }, [
      search,
      el("div", { class: "tx-filters-center" }, txFiltersNodes()),
      q ? el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, `Buscando "${q}" en todos los meses`) : null,
    ])
  );

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
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, (allTime || ranged || q || catF || accF ? "Sin movimientos con estos filtros." : "Sin movimientos este mes."))));
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
  const rawLabel = new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1); // "mayo de 2026" -> "Mayo de 2026"
  const prev = new Date(y, m - 2, 1);
  const next = new Date(y, m, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;

  return el("div", { class: "flex-between card", style: "padding:10px 12px;" }, [
    el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", onclick: () => onChange(prevKey) }, "‹"),
    el("div", { style: "font-weight:700;" }, label),
    el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", onclick: () => onChange(nextKey) }, "›"),
  ]);
}

window.renderTransactions = renderTransactions;
window.renderMonthSwitcher = renderMonthSwitcher;
