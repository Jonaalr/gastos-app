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

  // Pagos del mes que aún no se registran (domiciliados sin confirmar, no cancelados ni omitidos)
  const recStatus = await DB.getMeta("recurringStatus", {});
  const pendingRecurring = buildRecurringSeries(transactions)
    .filter((sr) => {
      const st = recStatus[sr.key] || {};
      if (st.cancelled || (st.skipped && st.skipped.includes(thisMonth))) return false;
      return !sr.txs.some((t) => DateUtil.monthKey(t.date) === thisMonth);
    })
    .reduce((sum, sr) => sum + sr.last.amountCents, 0);
  const availableToSpend = afterDebt - pendingRecurring;

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

  // ---- Saldo total (tarjeta blanca). "Por pagar" se despliega para ver de dónde viene ----
  const debtsList = await DB.getMeta("debts", []);
  const plansList = await loadInstallments();
  const debtsLeft = debtsList.reduce((sum, d) => sum + debtRemainingCents(d), 0) + plansList.reduce((sum, p) => sum + installmentRemainingCents(p), 0);
  const porPagar = creditDebt + pendingRecurring + debtsLeft;
  const loansOwed = (await loadLoans()).reduce((sum, l) => sum + loanStatus(l).owed, 0);
  const disponible = moneyTotal - porPagar;
  let heroHidden = false;
  let porPagarOpen = false;
  try {
    heroHidden = localStorage.getItem("ocultarSaldoInicio") === "1";
    porPagarOpen = localStorage.getItem("porPagarAbierto") === "1";
  } catch (e) { /* sin almacenamiento: valores por defecto */ }
  const money = (cents) => (heroHidden ? "$••••••" : Money.format(cents));
  // Títulos que llevan a su sección (gris normal con flecha clara)
  const goRow = (label, route, valueNode, cls = "hero-row") =>
    el("div", { class: `${cls} hero-nav`, role: "button", tabindex: "0", onclick: () => Router.navigate(route) }, [
      el("span", {}, [label, el("span", { class: "hero-go" }, "›")]),
      valueNode,
    ]);
  const subRow = (label, route, cents) => goRow(label, route, el("span", { class: "neg" }, `−${money(cents)}`), "hero-sub");
  const detail = el("div", { class: "hero-detail", style: porPagarOpen ? "" : "display:none;" }, [
    subRow("Tarjetas de crédito", "/accounts", creditDebt),
    subRow("Pagos por registrar", "/calendar", pendingRecurring),
    subRow("Deudas y compras a meses", "/debts", debtsLeft),
  ]);
  const chevron = el("span", { class: `hero-chev${porPagarOpen ? " open" : ""}` }, "›");
  const toggleRow = el("div", {
    class: "hero-row hero-toggle",
    role: "button",
    tabindex: "0",
    onclick: () => {
      porPagarOpen = !porPagarOpen;
      try { localStorage.setItem("porPagarAbierto", porPagarOpen ? "1" : "0"); } catch (e) { /* solo esta sesión */ }
      detail.style.display = porPagarOpen ? "" : "none";
      chevron.classList.toggle("open", porPagarOpen);
    },
  }, [el("span", {}, [el("span", {}, "Por pagar"), chevron]), el("strong", { class: "neg" }, `−${money(porPagar)}`)]);
  const eyeBtn = el("button", {
    class: "hero-eye",
    type: "button",
    title: heroHidden ? "Mostrar saldo" : "Ocultar saldo",
    "aria-label": heroHidden ? "Mostrar saldo" : "Ocultar saldo",
    onclick: () => {
      try { localStorage.setItem("ocultarSaldoInicio", heroHidden ? "0" : "1"); } catch (e) { /* solo esta sesión */ }
      Router.render();
    },
  }, [iconNode(heroHidden ? "eyeOff" : "eye", "ico", 18)]);
  root.appendChild(
    el("div", { class: "hero-card" }, [
      el("div", { class: "hero-head" }, [el("div", { class: "hero-label" }, "Dinero total"), eyeBtn]),
      el("div", { class: "hero-value" }, money(moneyTotal)),
      el("div", { class: "hero-rows" }, [
        toggleRow,
        detail,
        loansOwed > 0 ? goRow("Te deben", "/receivables?tab=prestamos", el("strong", { class: "pos" }, money(loansOwed))) : null,
        el("div", { class: "hero-row" }, [el("span", {}, "Disponible"), el("strong", {}, money(disponible))]),
      ]),
    ])
  );

  // ---- Gasto por mes: anillo por categoría. Desliza horizontalmente para ver meses anteriores ----
  let monthOffset = 0;
  const monthHolder = el("div", { class: "swipe-slot" });
  const drawMonth = (dir = 0) => {
    const ref = new Date();
    ref.setDate(1);
    ref.setMonth(ref.getMonth() - monthOffset);
    const mk = DateUtil.monthKey(ref);
    const txMonth = transactions.filter((t) => DateUtil.monthKey(t.date) === mk);
    const incomeM = txMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amountCents, 0);
    const expenseM = txMonth.filter((t) => t.type === "expense").reduce((s, t) => s + myShareCents(t), 0);
    const catTotals = new Map();
    for (const t of txMonth) {
      if (t.type !== "expense") continue;
      const key = t.categoryId || 0;
      catTotals.set(key, (catTotals.get(key) || 0) + myShareCents(t));
    }
    const slices = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
    const top = slices.slice(0, 4);
    const restTotal = slices.slice(4).reduce((sum, [, v]) => sum + v, 0);
    if (restTotal) top.push([-1, restTotal]);
    const palette = ["#16A34A", "#3B82F6", "#F59E0B", "#8B5CF6", "#94A3B8"];
    const ringTotal = expenseM || 1;
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
    ring.appendChild(el("div", { class: "ring-center" }, [el("div", { class: "ring-label" }, "Gastado"), el("div", { class: "ring-value" }, Money.format(expenseM))]));
    const legend = top.map(([key, val], i) => {
      const name = key === -1 ? "Otros" : catMap[key] ? catMap[key].name : "Sin categoría";
      return el("div", { class: "legend-row" }, [
        el("span", { class: "dot", style: `background:${palette[i]}` }),
        el("span", { class: "legend-name" }, name),
        el("span", { class: "legend-val" }, Money.format(val)),
      ]);
    });
    const monthName = `${MONTHS_ES[ref.getMonth()]} ${ref.getFullYear()}`;
    const card = el("div", { class: "chart-card" + slideClass(dir) }, [
      el("div", { class: "chart-head" }, [
        el("div", { class: "chart-title" }, monthName),
        el("div", { class: "chart-sub" }, `Ingresos ${Money.format(incomeM)}`),
      ]),
      el("div", { class: "donut-wrap" }, [ring, el("div", { class: "legend" }, legend.length ? legend : [el("div", { class: "text-dim" }, "Sin gastos este mes")])]),
      monthDotsFooter(monthOffset, () => { monthOffset = 0; drawMonth(); }),
    ]);
    monthHolder.innerHTML = "";
    monthHolder.appendChild(card);
  };
  attachSwipe(monthHolder, (dir) => {
    const next = monthOffset + dir;
    if (next < 0 || next > 11) return;
    monthOffset = next;
    drawMonth(dir);
  });
  drawMonth();
  root.appendChild(monthHolder);

  // ---- Últimos 7 días por semana: barras. Desliza para ver semanas anteriores ----
  let weekOffset = 0;
  const weekHolder = el("div", { class: "swipe-slot" });
  const drawWeek = (dir = 0) => {
    const end = new Date();
    end.setDate(end.getDate() - weekOffset * 7);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const iso = DateUtil.toISO(d);
      const sum = transactions.filter((t) => t.type === "expense" && t.date === iso).reduce((acc, t) => acc + myShareCents(t), 0);
      week.push({ sum, label: ["D", "L", "M", "M", "J", "V", "S"][d.getDay()] });
    }
    const weekMax = Math.max(1, ...week.map((d) => d.sum));
    const weekTotal = week.reduce((acc, d) => acc + d.sum, 0);
    const bars = week
      .map((d, i) => {
        const h = Math.max(4, Math.round((d.sum / weekMax) * 84));
        return `<rect class="bar" style="animation-delay:${i * 45}ms" x="${i * 44 + 9}" y="${100 - h}" width="26" height="${h}" rx="9" fill="#16A34A" opacity="${i === 6 ? 1 : 0.4}"/><text x="${i * 44 + 22}" y="116" text-anchor="middle" font-size="11" fill="#8E8E93">${d.label}</text>`;
      })
      .join("");
    const startD = new Date(end);
    startD.setDate(end.getDate() - 6);
    const rangeLabel = `${DateUtil.formatShort(DateUtil.toISO(startD))} – ${DateUtil.formatShort(DateUtil.toISO(end))}`;
    const card = el("div", { class: "chart-card" + slideClass(dir) }, [
      el("div", { class: "chart-head" }, [
        el("div", { class: "chart-title" }, weekOffset === 0 ? "Últimos 7 días" : `7 días · ${rangeLabel}`),
        el("div", { class: "chart-sub" }, `${Money.format(weekTotal)} gastados`),
      ]),
      el("div", { html: `<svg viewBox="0 0 308 120" width="100%" height="120" role="img" aria-label="Gasto de los últimos 7 días">${bars}</svg>` }),
      weekDotsFooter(weekOffset, () => { weekOffset = 0; drawWeek(); }),
    ]);
    weekHolder.innerHTML = "";
    weekHolder.appendChild(card);
  };
  attachSwipe(weekHolder, (dir) => {
    const next = weekOffset + dir;
    if (next < 0 || next > 52) return;
    weekOffset = next;
    drawWeek(dir);
  });
  drawWeek();
  root.appendChild(weekHolder);

  // ---- Por cobrar (solo si hay gastos compartidos o préstamos pendientes). Al tocarla se despliega el desglose ----
  const receivable = await receivablesTotal();
  const loanCount = (await loadLoans()).length;
  if (receivable.count > 0 || loanCount > 0) {
    let cobrarOpen = false;
    try { cobrarOpen = localStorage.getItem("porCobrarAbierto") === "1"; } catch (e) { /* sin almacenamiento */ }
    const cobrarRow = (label, route, cents, sub) =>
      el("div", {
        role: "button",
        tabindex: "0",
        style: "display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid rgba(0,0,0,.08);cursor:pointer;",
        onclick: () => Router.navigate(route),
      }, [
        el("div", {}, [el("div", { style: "font-weight:600;" }, label), el("div", { class: "stat-sub" }, sub)]),
        el("strong", {}, Money.format(cents)),
      ]);
    const cobrarDetail = el("div", { style: cobrarOpen ? "" : "display:none;" }, [
      cobrarRow("Gastos compartidos", "/receivables?f=compartidos", receivable.total, `${receivable.count} ${receivable.count === 1 ? "persona te debe" : "personas te deben"}`),
      cobrarRow("Préstamos", "/receivables?f=prestamos", loansOwed, `${loanCount} ${loanCount === 1 ? "préstamo" : "préstamos"}`),
    ]);
    const cobrarChev = el("span", { class: `hero-chev${cobrarOpen ? " open" : ""}` }, "›");
    const cobrarHead = el("div", {
      role: "button",
      tabindex: "0",
      style: "cursor:pointer;",
      onclick: () => {
        cobrarOpen = !cobrarOpen;
        try { localStorage.setItem("porCobrarAbierto", cobrarOpen ? "1" : "0"); } catch (e) { /* solo esta sesión */ }
        cobrarDetail.style.display = cobrarOpen ? "" : "none";
        cobrarChev.classList.toggle("open", cobrarOpen);
      },
    }, [
      el("div", { class: "stat-label" }, [el("span", {}, "Por cobrar"), cobrarChev]),
      el("div", { class: "receivable-amount" }, Money.format(receivable.total + loansOwed)),
      el("div", { class: "stat-sub" }, "Toca para ver el desglose"),
    ]);
    root.appendChild(el("div", { class: "receivable-card", style: "display:block;" }, [cobrarHead, cobrarDetail]));
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
          el("div", { class: "icon-chip" }, accountBadge(a)),
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

/** Logo del banco según el nombre o banco de la cuenta (icons/banks/*.png). Null si no hay logo. */
const BANK_LOGOS = [
  [/revolut/i, "revolut"],
  [/nu\b|nubank|cajita/i, "nubank"],
  [/didi/i, "didi"],
  [/banamex/i, "banamex"],
  [/bbva/i, "bbva"],
  [/mercado\s?pago/i, "mercadopago"],
  [/ual[aá]/i, "uala"],
  [/spin/i, "spin"],
  [/cashi/i, "cashi"],
];
function bankLogoFor(account) {
  const text = `${account.name || ""} ${account.bank || ""}`;
  const hit = BANK_LOGOS.find(([re]) => re.test(text));
  return hit ? `icons/banks/${hit[1]}.png` : null;
}
/** Nodo para la cuenta: logo del banco si lo hay, si no el icono por tipo */
function accountBadge(account) {
  const src = bankLogoFor(account);
  if (!src) return accountIcon(account.type);
  const img = document.createElement("img");
  img.className = "bank-logo";
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  return img;
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
      el("div", { class: "meta" }, [
        `${cat && !isTransfer ? cat.name + " · " : ""}${acc ? acc.name : "—"}${t.isRecurring ? " · domiciliado" : ""}${t.split ? ` · entre varios, tu parte ${Money.format(t.split.myShareCents)}` : ""}`,
        t.pendingSplit && !t.split ? el("span", { class: "pending-split" }, "Pendiente por repartir") : null,
      ]),
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

/** Desliza horizontalmente: dir = +1 (a la izquierda del tiempo, más antiguo) o -1 (más reciente) */
function attachSwipe(node, onSwipe) {
  let x0 = null;
  let y0 = null;
  node.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  node.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx > 0 ? 1 : -1);
  });
}

/** Pie de la tarjeta: pista para deslizar y botón para volver al período actual */
function swipeFooter(offset, unit, onReset) {
  const hint = el("span", { class: "swipe-hint" }, offset === 0 ? `Desliza para ver ${unit} anteriores` : `Desliza para ver más ${unit}`);
  const children = [hint];
  if (offset !== 0) children.push(el("button", { class: "link-btn", onclick: onReset }, "Volver a hoy"));
  return el("div", { class: "swipe-footer" }, children);
}

/** Clase de animación de entrada: dir > 0 = se viene de la izquierda (más antiguo), dir < 0 = de la derecha */
function slideClass(dir) {
  if (dir > 0) return " slide-l";
  if (dir < 0) return " slide-r";
  return " fade-in";
}

/** Puntitos del mes: 12 posiciones (la de la derecha es este mes; la activa es la que se ve) */
function monthDotsFooter(offset, onReset) {
  const dots = [];
  for (let i = 0; i < 12; i++) {
    const active = 11 - i === offset;
    dots.push(el("i", { class: active ? "on" : "" }));
  }
  const children = [el("div", { class: "dots-nav" }, dots)];
  if (offset !== 0) children.push(el("button", { class: "link-btn dots-reset", onclick: onReset }, "Volver a hoy"));
  return el("div", { class: "dots-footer" }, children);
}

/** Puntitos de semanas: 12 por bloque; al pasar de 12 semanas atrás, los puntos cambian de bloque */
function weekDotsFooter(offset, onReset) {
  const base = Math.floor(offset / 12) * 12;
  const dots = [];
  for (let i = 0; i < 12; i++) {
    const value = base + (11 - i);
    dots.push(el("i", { class: value === offset ? "on" : "" }));
  }
  const children = [el("div", { class: "dots-nav" }, dots)];
  if (offset !== 0) children.push(el("button", { class: "link-btn dots-reset", onclick: onReset }, "Volver a hoy"));
  return el("div", { class: "dots-footer" }, children);
}
