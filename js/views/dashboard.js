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

  // ---- Aviso para respaldar (si toca) ----
  const backupReminder = await backupReminderCard();
  if (backupReminder) root.appendChild(backupReminder);

  // ---- Saldo total (tarjeta blanca) ----
  root.appendChild(
    el("div", { class: "hero-card" }, [
      el("div", { class: "hero-label" }, "Dinero total"),
      el("div", { class: "hero-value" }, Money.format(moneyTotal)),
      el("div", { class: "hero-rows" }, [
        el("div", { class: "hero-row" }, [el("span", {}, "Tarjetas"), el("strong", { class: "neg" }, `−${Money.format(creditDebt)}`)]),
        el("div", { class: "hero-row" }, [el("span", {}, "Libre tras tarjetas"), el("strong", {}, Money.format(afterDebt))]),
      ]),
    ])
  );

  // ---- Gasto del mes: anillo por categoría ----
  const catTotals = new Map();
  for (const t of txThisMonth) {
    if (t.type !== "expense") continue;
    const key = t.categoryId || 0;
    catTotals.set(key, (catTotals.get(key) || 0) + myShareCents(t));
  }
  const slices = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const top = slices.slice(0, 4);
  const restTotal = slices.slice(4).reduce((sum, [, v]) => sum + v, 0);
  if (restTotal) top.push([-1, restTotal]);
  const palette = ["#16A34A", "#3B82F6", "#F59E0B", "#8B5CF6", "#94A3B8"];
  const ringTotal = expenseThisMonth || 1;
  const circ = 2 * Math.PI * 46;
  let offset = 0;
  const arcs = top
    .map(([, val], i) => {
      const len = (circ * val) / ringTotal;
      const arc = `<circle cx="60" cy="60" r="46" fill="none" stroke="${palette[i]}" stroke-width="14" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`;
      offset += len;
      return arc;
    })
    .join("");
  const ring = el("div", {
    class: "ring",
    html: `<svg viewBox="0 0 120 120" width="150" height="150"><circle cx="60" cy="60" r="46" fill="none" stroke="rgba(120,120,128,0.16)" stroke-width="14"/>${arcs}</svg>`,
  });
  ring.appendChild(el("div", { class: "ring-center" }, [el("div", { class: "ring-label" }, "Gastado"), el("div", { class: "ring-value" }, Money.format(expenseThisMonth))]));
  const legend = top.map(([key, val], i) => {
    const name = key === -1 ? "Otros" : catMap[key] ? catMap[key].name : "Sin categoría";
    return el("div", { class: "legend-row" }, [
      el("span", { class: "dot", style: `background:${palette[i]}` }),
      el("span", { class: "legend-name" }, name),
      el("span", { class: "legend-val" }, Money.format(val)),
    ]);
  });
  root.appendChild(
    el("div", { class: "chart-card" }, [
      el("div", { class: "chart-head" }, [
        el("div", { class: "chart-title" }, "Gasto del mes"),
        el("div", { class: "chart-sub" }, `Ingresos ${Money.format(incomeThisMonth)}`),
      ]),
      el("div", { class: "donut-wrap" }, [ring, el("div", { class: "legend" }, legend.length ? legend : [el("div", { class: "text-dim" }, "Sin gastos este mes")])]),
    ])
  );

  // ---- Últimos 7 días: barras ----
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = DateUtil.toISO(d);
    const sum = transactions.filter((t) => t.type === "expense" && t.date === iso).reduce((acc, t) => acc + myShareCents(t), 0);
    week.push({ sum, label: ["D", "L", "M", "M", "J", "V", "S"][d.getDay()] });
  }
  const weekMax = Math.max(1, ...week.map((d) => d.sum));
  const weekTotal = week.reduce((acc, d) => acc + d.sum, 0);
  const bars = week
    .map((d, i) => {
      const h = Math.max(4, Math.round((d.sum / weekMax) * 84));
      return `<rect x="${i * 44 + 9}" y="${100 - h}" width="26" height="${h}" rx="9" fill="#16A34A" opacity="${i === 6 ? 1 : 0.4}"/><text x="${i * 44 + 22}" y="116" text-anchor="middle" font-size="11" fill="#8E8E93">${d.label}</text>`;
    })
    .join("");
  root.appendChild(
    el("div", { class: "chart-card" }, [
      el("div", { class: "chart-head" }, [
        el("div", { class: "chart-title" }, "Últimos 7 días"),
        el("div", { class: "chart-sub" }, `${Money.format(weekTotal)} gastados`),
      ]),
      el("div", { html: `<svg viewBox="0 0 308 120" width="100%" height="120" role="img" aria-label="Gasto de los últimos 7 días">${bars}</svg>` }),
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
        el("div", { class: "account-pill", onclick: () => Router.navigate(`/account?id=${a.id}`) }, [
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
  const name = { cash: "banknote", debit: "card", credit: "card", savings: "bank" }[type] || "banknote";
  return iconNode(name, "ico", 20);
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
    el("div", { class: `icon tx-${kind}` }, isTransfer ? iconNode("transfer") : cat ? categoryIconNode(cat) : iconNode("tag")),
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
