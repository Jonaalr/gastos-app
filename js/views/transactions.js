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
  const search = el("input", { type: "search", placeholder: "Buscar comercio, nota o categoría", value: q, style: "width:100%;margin-bottom:8px;" });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") goTo({ q: search.value.trim() }); });
  search.addEventListener("change", () => goTo({ q: search.value.trim() }));

  // Etiquetas de los chips
  const monthLabel = (k) => {
    const [y, m] = k.split("-").map(Number);
    const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return `${names[m - 1]} ${y}`;
  };
  const periodLabel = allTime
    ? "Todo el historial"
    : ranged
      ? `${fromF ? DateUtil.formatShort(fromF) : "…"} – ${toF ? DateUtil.formatShort(toF) : "…"}`
      : monthLabel(monthKey);
  const catObj = catF && catF !== "none" ? categories.find((c) => String(c.id) === catF) : null;
  const catName = catF === "none" ? "Sin categoría" : catObj ? catObj.name : "Categoría";
  const accObj = accF ? accMap[accF] : null;
  const accName = accObj ? accObj.name : "Cuenta";

  // Hojas de filtro (periodo, categoría, cuenta)
  const openFilterSheet = (title, nodes) => {
    const backdrop = el("div", { class: "sheet-backdrop" });
    const sheet = el("div", { class: "sheet" }, [el("div", { class: "sheet-header" }, [el("h2", {}, title)]), ...nodes]);
    backdrop.appendChild(sheet);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    return backdrop;
  };
  const filterOpt = (label, on, onPick) =>
    el("button", { class: `filter-opt${on ? " on" : ""}`, type: "button", onclick: onPick }, [
      el("span", {}, label),
      el("span", {}, on ? "✓" : ""),
    ]);
  const chip = (label, on, onPick) => el("button", { class: `chip${on ? " on" : ""}`, type: "button", onclick: onPick }, label);

  const openPeriod = () => {
    let mode = ranged ? "rango" : "mes";
    const body = el("div", {});
    const backdrop = openFilterSheet("Periodo", [body]);
    const close = () => backdrop.remove();
    const draw = () => {
      body.innerHTML = "";
      body.appendChild(el("div", { class: "segmented", style: "margin-bottom:10px;" }, [
        el("button", { class: mode === "mes" ? "active" : "", type: "button", onclick: () => { mode = "mes"; draw(); } }, "Mes"),
        el("button", { class: mode === "rango" ? "active" : "", type: "button", onclick: () => { mode = "rango"; draw(); } }, "Rango de fechas"),
      ]));
      if (mode === "mes") {
        body.appendChild(filterOpt("Todo el historial", allTime, () => { close(); goTo({ todo: "1", month: "" }); }));
        const keys = [];
        const now = new Date();
        for (let i = 0; i < 24; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          keys.push(DateUtil.monthKey(d));
        }
        if (!keys.includes(monthKey)) keys.unshift(monthKey);
        for (const k of keys) {
          body.appendChild(filterOpt(monthLabel(k), !allTime && !ranged && k === monthKey, () => { close(); goTo({ month: k, from: "", to: "", todo: "" }); }));
        }
      } else {
        let f = fromF;
        let t = toF;
        body.appendChild(el("div", { style: "margin-bottom:8px;" }, [
          el("label", { class: "muted", style: "font-size:12px;" }, "Desde"),
          el("input", { type: "date", value: f, style: "width:100%;", onchange: (e) => { f = e.target.value; } }),
        ]));
        body.appendChild(el("div", { style: "margin-bottom:8px;" }, [
          el("label", { class: "muted", style: "font-size:12px;" }, "Hasta"),
          el("input", { type: "date", value: t, style: "width:100%;", onchange: (e) => { t = e.target.value; } }),
        ]));
        body.appendChild(el("button", { class: "btn", type: "button", onclick: () => { close(); goTo({ from: f, to: t, month: "", todo: "" }); } }, "Aplicar"));
      }
    };
    draw();
  };

  const openCat = () => {
    const opts = [
      filterOpt("Todas las categorías", !catF, () => { backdrop.remove(); goTo({ cat: "" }); }),
      filterOpt("Sin categoría", catF === "none", () => { backdrop.remove(); goTo({ cat: "none" }); }),
      ...categories
        .filter((c) => c.kind === "expense" || c.kind === "income")
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .map((c) => filterOpt(categoryLabel(c), catF === String(c.id), () => { backdrop.remove(); goTo({ cat: String(c.id) }); })),
    ];
    const backdrop = openFilterSheet("Categoría", opts);
  };

  const openAcc = () => {
    const opts = [
      filterOpt("Todas las cuentas", !accF, () => { backdrop.remove(); goTo({ acc: "" }); }),
      ...accounts
        .filter((a) => !a.archived)
        .sort(accountPickerCompare)
        .map((a) => filterOpt(accountPickerLabel(a), accF === String(a.id), () => { backdrop.remove(); goTo({ acc: String(a.id) }); })),
    ];
    const backdrop = openFilterSheet("Cuenta", opts);
  };

  root.appendChild(
    el("div", { class: "card", style: "padding:12px;" }, [
      search,
      el("div", { class: "filter-row one-line" }, [
        chip(`${periodLabel} ▾`, true, openPeriod),
        chip(`${catName} ▾`, !!catF, openCat),
        chip(`${accName} ▾`, !!accF, openAcc),
      ]),
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
