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

  // Filtros: texto (busca en todos los meses), categoría y cuenta
  const q = (params.get("q") || "").trim();
  const catF = params.get("cat") || "";
  const accF = params.get("acc") || "";
  const fromF = params.get("from") || "";
  const toF = params.get("to") || "";
  const ranged = !!(fromF || toF);
  const qLower = q.toLowerCase();
  const txMonth = allTx
    .filter((t) => (q || ranged ? true : DateUtil.monthKey(t.date) === monthKey))
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
    const dropMonth = !!(values.q || values.from || values.to);
    for (const [k, v] of Object.entries(values)) if (v && !(k === "month" && dropMonth)) next.set(k, v);
    Router.navigate(`/transactions?${next.toString()}`);
  };

  const income = txMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
  const expense = txMonth.filter((t) => t.type === "expense").reduce((s, t) => s + myShareCents(t), 0);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Reportes")]));
  root.appendChild(sectionTabs(REPORTES_TABS, "/transactions"));

  root.appendChild(renderMonthSwitcher(monthKey, (newMonth) => goTo({ month: newMonth })));

  // Barra de búsqueda y filtros
  const search = el("input", { type: "search", placeholder: "Buscar comercio, nota o categoría", value: q, style: "width:100%;margin-bottom:8px;" });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") goTo({ q: search.value.trim() }); });
  search.addEventListener("change", () => goTo({ q: search.value.trim() }));
  const catSel = el("select", {}, [
    el("option", { value: "" }, "Todas las categorías"),
    el("option", { value: "none" }, "Sin categoría"),
    ...categories.filter((c) => c.kind === "expense" || c.kind === "income").sort((a, b) => a.name.localeCompare(b.name, "es")).map((c) =>
      el("option", { value: String(c.id), ...(String(c.id) === catF ? { selected: "selected" } : {}) }, categoryLabel(c))
    ),
  ]);
  catSel.value = catF;
  catSel.addEventListener("change", () => goTo({ cat: catSel.value }));
  const accSel = el("select", {}, [
    el("option", { value: "" }, "Todas las cuentas"),
    ...accounts.filter((a) => !a.archived).sort(accountPickerCompare).map((a) =>
      el("option", { value: String(a.id) }, accountPickerLabel(a))
    ),
  ]);
  accSel.value = accF;
  accSel.addEventListener("change", () => goTo({ acc: accSel.value }));
  root.appendChild(
    el("div", { class: "card", style: "padding:12px;" }, [
      search,
      el("div", { class: "btn-row" }, [
        el("div", { style: "flex:1;min-width:0;" }, [catSel]),
        el("div", { style: "flex:1;min-width:0;" }, [accSel]),
      ]),
      el("div", { class: "btn-row", style: "margin-top:8px;" }, [
        el("div", { style: "flex:1;min-width:0;" }, [
          el("label", { class: "muted", style: "font-size:12px;" }, "Desde"),
          el("input", { type: "date", value: fromF, style: "width:100%;", onchange: (e) => goTo({ from: e.target.value }) }),
        ]),
        el("div", { style: "flex:1;min-width:0;" }, [
          el("label", { class: "muted", style: "font-size:12px;" }, "Hasta"),
          el("input", { type: "date", value: toF, style: "width:100%;", onchange: (e) => goTo({ to: e.target.value }) }),
        ]),
      ]),
      q ? el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, `Buscando "${q}" en todos los meses`) : null,
      ranged ? el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, "Mostrando el rango de fechas elegido") : null,
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
