/**
 * reports.js — Gasto mensual por categoría + control total de ahorro.
 */

async function renderReports(root, params) {
  const monthKey = params.get("month") || DateUtil.monthKey();
  const [allTx, categories, accounts] = await Promise.all([
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getAll("accounts"),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const txMonth = allTx.filter((t) => DateUtil.monthKey(t.date) === monthKey && t.type === "expense");
  const byCategory = {};
  for (const t of txMonth) {
    const key = t.categoryId || "none";
    byCategory[key] = (byCategory[key] || 0) + myShareCents(t);
  }
  const totalExpense = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const rows = Object.entries(byCategory)
    .map(([catId, amount]) => ({
      cat: catId === "none" ? { name: "Sin categoría", icon: "📦" } : catMap[catId],
      amount,
      pct: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Reportes")]));
  root.appendChild(sectionTabs(PRESUPUESTO_TABS, "/reports"));
  root.appendChild(renderMonthSwitcher(monthKey, (newMonth) => Router.navigate(`/reports?month=${newMonth}`)));

  // ---- Comparación con el mes anterior ----
  const [py, pm] = monthKey.split("-").map(Number);
  const prevKey = pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, "0")}`;
  const prevTotal = allTx
    .filter((t) => DateUtil.monthKey(t.date) === prevKey && t.type === "expense")
    .reduce((sum, t) => sum + myShareCents(t), 0);
  const diff = totalExpense - prevTotal;
  const prevLabel = new Date(py, (pm === 1 ? 12 : pm - 1) - 1, 1).toLocaleDateString("es-MX", { month: "long" });
  const compareCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Comparado con " + prevLabel)]);
  if (prevTotal === 0 && totalExpense === 0) {
    compareCard.appendChild(el("div", { class: "empty-state" }, "Sin gastos en ninguno de los dos meses."));
  } else if (prevTotal === 0) {
    compareCard.appendChild(el("div", { class: "muted" }, `No hay gastos registrados en ${prevLabel}, así que no hay con qué comparar.`));
  } else {
    const pct = Math.round((Math.abs(diff) / prevTotal) * 100);
    const up = diff > 0;
    compareCard.appendChild(
      el("div", { class: "btn-row" }, [
        el("div", {}, [el("div", { class: "muted" }, prevLabel), el("div", { class: "amount" }, Money.format(prevTotal))]),
        el("div", {}, [el("div", { class: "muted" }, "Este mes"), el("div", { class: "amount" }, Money.format(totalExpense))]),
      ])
    );
    compareCard.appendChild(
      el("div", { class: `imp-check-badge ${diff === 0 ? "ok" : up ? "warn" : "ok"}` },
        diff === 0 ? "Igual que el mes anterior" : `${up ? "▲ Gastaste" : "▼ Gastaste"} ${Money.format(Math.abs(diff))} ${up ? "más" : "menos"} (${pct}%)`)
    );
  }
  root.appendChild(compareCard);

  // ---- Gasto por categoría ----
  const catCard = el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "Gasto por categoría"),
    el("div", { style: "font-size:22px;font-weight:800;margin-bottom:12px;" }, Money.format(totalExpense)),
  ]);
  if (rows.length === 0) {
    catCard.appendChild(el("div", { class: "empty-state" }, "Sin gastos este mes."));
  } else {
    for (const r of rows) {
      const bar = el("div", { style: "margin-bottom:12px;" }, [
        el("div", { class: "flex-between", style: "margin-bottom:4px;" }, [
          el("div", {}, `${r.cat.name}`),
          el("div", { style: "font-weight:700;" }, Money.format(r.amount)),
        ]),
      ]);
      const track = el("div", { class: "progress-track" });
      track.appendChild(el("div", { class: "progress-fill", style: `width:${r.pct}%` }));
      bar.appendChild(track);
      catCard.appendChild(bar);
    }
  }
  root.appendChild(catCard);

  // ---- Control total de ahorro ----
  root.appendChild(await renderSavingsControl(allTx, accounts));
}

async function renderSavingsControl(allTx, accounts) {
  const savingsAccounts = accounts.filter((a) => a.type === "savings" && !a.archived);
  const totalSavingsBalance = savingsAccounts.reduce((s, a) => s + a.balanceCents, 0);

  // Ahorro neto histórico = total de ingresos - total de gastos (todas las cuentas)
  const totalIncome = allTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
  const totalExpense = allTx.filter((t) => t.type === "expense").reduce((s, t) => s + myShareCents(t), 0);
  const netSavings = totalIncome - totalExpense;

  const monthlyInterest = savingsAccounts.reduce((s, a) => {
    if (!a.annualRatePct) return s;
    return s + computeMonthlyInterestCents(a);
  }, 0);

  return el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "Control total de ahorro"),
    el("div", { class: "stat-row" }, [
      el("div", { class: "stat-box income" }, [
        el("div", { class: "label" }, "En cuentas con rendimiento"),
        el("div", { class: "value" }, Money.format(totalSavingsBalance)),
      ]),
      el("div", { class: "stat-box" }, [
        el("div", { class: "label" }, "Generando al mes"),
        el("div", { class: "value" }, Money.format(monthlyInterest)),
      ]),
    ]),
    el("div", { class: "mt-8", style: "font-size:13px;" }, [
      el("div", { class: "flex-between" }, [
        el("span", { class: "text-dim" }, "Ingresos históricos totales"),
        el("span", {}, Money.format(totalIncome)),
      ]),
      el("div", { class: "flex-between mt-8" }, [
        el("span", { class: "text-dim" }, "Gastos históricos totales"),
        el("span", {}, Money.format(totalExpense)),
      ]),
      el("div", { class: "flex-between mt-8", style: "font-weight:700;border-top:1px solid var(--border);padding-top:8px;" }, [
        el("span", {}, "Ahorro neto"),
        el("span", { style: netSavings >= 0 ? "color:var(--income);" : "color:var(--expense);" }, Money.format(netSavings)),
      ]),
    ]),
  ]);
}

window.renderReports = renderReports;
