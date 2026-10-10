/**
 * reports.js — Gasto mensual por categoría + control total de ahorro.
 */

let reportsFiltersOpen = false;

async function renderReports(root, params) {
  const monthKey = params.get("month") || DateUtil.monthKey();
  const fromF = params.get("from") || "";
  const toF = params.get("to") || "";
  const allTime = params.get("todo") === "1";
  const accF = params.get("acc") || "";
  const ranged = !!(fromF || toF);
  const useMonth = !ranged && !allTime;
  // Mes elegido en la gráfica de 6 meses (si no hay, el del periodo)
  const selParam = params.get("sel") || "";
  const selKey = useMonth && /^\d{4}-\d{2}$/.test(selParam) ? selParam : monthKey;

  const [allTx, categories, accounts] = await Promise.all([
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getAll("accounts"),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  // Cambia el periodo o la cuenta manteniendo lo demás (igual que en Movimientos)
  const go = (changes) => {
    const next = new URLSearchParams();
    const resetSel = ["month", "from", "to", "todo"].some((k) => k in changes);
    const values = { month: monthKey, from: fromF, to: toF, todo: allTime ? "1" : "", acc: accF, sel: resetSel ? "" : selKey === monthKey ? "" : selKey, ...changes };
    const dropMonth = !!(values.from || values.to || values.todo);
    for (const [k, v] of Object.entries(values)) if (v && !(k === "month" && dropMonth)) next.set(k, v);
    Router.navigate(`/reports?${next.toString()}`);
  };
  const inPeriod = (t) => {
    if (useMonth) return DateUtil.monthKey(t.date) === monthKey;
    if (allTime) return true;
    return (!fromF || t.date >= fromF) && (!toF || t.date <= toF);
  };

  const inCatPeriod = (t) => (useMonth ? DateUtil.monthKey(t.date) === selKey : inPeriod(t));
  const txPeriod = allTx.filter((t) => t.type === "expense" && inCatPeriod(t) && (!accF || String(t.accountId) === accF));
  const byCategory = {};
  for (const t of txPeriod) {
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
  root.appendChild(sectionTabs(REPORTES_TABS, "/reports"));
  const pinfo = { monthKey, from: fromF, to: toF, todo: allTime };
  const accObj = accF ? accMap[accF] : null;
  const count = (ranged || allTime ? 1 : 0) + (accF ? 1 : 0);
  for (const node of filtersPanel({
    open: reportsFiltersOpen,
    count,
    onToggle: () => { reportsFiltersOpen = !reportsFiltersOpen; Router.render(); },
    items: [
      iconChip("calendar", `${periodLabelFor(pinfo)} ▾`, ranged || allTime, () => openPeriodSheet(pinfo, go)),
      iconChip("bank", `${accObj ? accObj.name : "Cuenta"} ▾`, !!accF, () => openAccountSheet(accounts, accF, go)),
    ],
  })) root.appendChild(node);

  // ---- Gasto de los últimos 6 meses (solo cuando el periodo es un mes) ----
  if (useMonth) {
    const [py, pm] = monthKey.split("-").map(Number);
    const keys = [];
    for (let i = 5; i >= 0; i--) keys.push(DateUtil.monthKey(new Date(py, pm - 1 - i, 1)));
    const totalFor = (k) => allTx
      .filter((t) => t.type === "expense" && DateUtil.monthKey(t.date) === k && (!accF || String(t.accountId) === accF))
      .reduce((sum, t) => sum + myShareCents(t), 0);
    const totals = keys.map(totalFor);
    const selIdx = keys.indexOf(selKey);
    const cur = selIdx >= 0 ? totals[selIdx] : 0;
    const prevKey = DateUtil.monthKey(new Date(Number(selKey.split("-")[0]), Number(selKey.split("-")[1]) - 2, 1));
    const prevTotal = totalFor(prevKey);
    const diff = cur - prevTotal;
    const prevLabel = MESES_ES[Number(prevKey.split("-")[1]) - 1];
    const maxV = Math.max(1, ...totals);
    const barW = 34;
    const gap = 14;
    const baseY = 128;
    const maxH = 96;
    const compact = (cents) => {
      const pesos = Math.round(cents / 100);
      return pesos >= 1000 ? `$${(pesos / 1000).toFixed(1)}k` : `$${pesos}`;
    };
    const bars = totals.map((v, i) => {
      const h = Math.max(2, Math.round((v / maxV) * maxH));
      const x = 10 + i * (barW + gap);
      const isSel = keys[i] === selKey;
      const mLabel = MESES_ES[Number(keys[i].split("-")[1]) - 1].slice(0, 3);
      return `<g data-m="${keys[i]}" style="cursor:pointer;">`
        + `<rect x="${x - gap / 2}" y="0" width="${barW + gap}" height="150" fill="transparent"/>`
        + `<rect x="${x}" y="${baseY - h}" width="${barW}" height="${h}" rx="6" fill="${isSel ? "#16A34A" : "#d1d5db"}"/>`
        + `<text x="${x + barW / 2}" y="${baseY - h - 5}" text-anchor="middle" font-size="10" fill="#3f3f46">${compact(v)}</text>`
        + `<text x="${x + barW / 2}" y="${baseY + 16}" text-anchor="middle" font-size="11" fill="${isSel ? "#15803d" : "#8e8e93"}" font-weight="${isSel ? 700 : 400}">${mLabel}</text>`
        + `</g>`;
    }).join("");
    const chartCard = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Gasto de los últimos 6 meses")]);
    const chartWrap = el("div", { html: `<svg viewBox="0 0 ${10 * 2 + 6 * barW + 5 * gap} 150" width="100%" role="img" aria-label="Gasto de los últimos 6 meses">${bars}</svg>` });
    chartWrap.querySelectorAll("g[data-m]").forEach((g) => {
      g.addEventListener("click", () => {
        const k = g.getAttribute("data-m");
        go({ sel: k === monthKey ? "" : k });
      });
    });
    chartCard.appendChild(chartWrap);
    const selLabel = MESES_ES[Number(selKey.split("-")[1]) - 1];
    if (prevTotal === 0 && cur === 0) {
      chartCard.appendChild(el("div", { class: "empty-state" }, `Sin gastos en ${selLabel}.`));
    } else if (prevTotal === 0) {
      chartCard.appendChild(el("div", { class: "muted", style: "margin-top:8px;" }, `No hay gastos en ${prevLabel} para comparar.`));
    } else {
      const pct = Math.round((Math.abs(diff) / prevTotal) * 100);
      const up = diff > 0;
      chartCard.appendChild(
        el("div", { class: `imp-check-badge ${diff === 0 ? "ok" : up ? "warn" : "ok"}`, style: "margin-top:8px;" },
          diff === 0 ? `Igual que ${prevLabel}` : `${up ? "▲ Gastaste" : "▼ Gastaste"} ${Money.format(Math.abs(diff))} ${up ? "más" : "menos"} que ${prevLabel} (${pct}%)`)
      );
    }
    root.appendChild(chartCard);
  }

  // ---- Gasto por categoría (del periodo elegido) ----
  const catCard = el("div", { class: "card" }, [
    el("div", { class: "card-title" }, "Gasto por categoría"),
    el("div", { class: "muted", style: "font-size:12px;margin:-6px 0 6px;" }, periodLabelFor({ monthKey: useMonth ? selKey : monthKey, from: fromF, to: toF, todo: allTime })),
    el("div", { style: "font-size:22px;font-weight:800;margin-bottom:12px;" }, Money.format(totalExpense)),
  ]);
  if (rows.length === 0) {
    catCard.appendChild(el("div", { class: "empty-state" }, "Sin gastos en este periodo."));
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
  const totalIncome = allTx.filter((t) => t.type === "income" && !t.reimbursement).reduce((s, t) => s + t.amountCents, 0);
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
