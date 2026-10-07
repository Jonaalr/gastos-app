/**
 * calendar.js — Calendario de pagos: tarjetas de crédito (corte/límite) y domiciliados.
 */

async function renderCalendar(root) {
  const [accounts, transactions] = await Promise.all([DB.getAll("accounts"), DB.getAll("transactions")]);
  const creditCards = accounts.filter((a) => a.type === "credit" && !a.archived && a.dueDay);
  const recurring = transactions.filter((t) => t.isRecurring && t.recurringDay);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Calendario de pagos")]));

  const events = [];

  for (const card of creditCards) {
    const nextDue = DateUtil.nextOccurrence(card.dueDay, new Date());
    const nextCut = card.cutDay ? DateUtil.nextOccurrence(card.cutDay, new Date()) : null;
    const spent = Math.max(0, -card.balanceCents);
    events.push({
      date: nextDue,
      title: `Pago: ${card.name}`,
      meta: `Límite de pago${spent ? " · gastado " + Money.format(spent) : ""}`,
      icon: "🪪",
      amount: spent || null,
      kind: "credit",
    });
    if (nextCut) {
      events.push({ date: nextCut, title: `Corte: ${card.name}`, meta: "Fecha de corte de tarjeta", icon: "📅", kind: "cut" });
    }
  }

  // Domiciliados: agrupar por comercio+categoría para no repetir cada transacción pasada
  const seen = new Set();
  for (const t of recurring) {
    const key = `${t.merchant}-${t.categoryId}-${t.accountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nextDate = DateUtil.nextOccurrence(t.recurringDay, new Date());
    events.push({
      date: nextDate,
      title: t.merchant || "Pago domiciliado",
      meta: `Recurrente · ~${Money.format(t.amountCents)}`,
      icon: "🔁",
      amount: t.amountCents,
      kind: "recurring",
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) {
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "empty-state" }, "Sin pagos próximos. Agrega una tarjeta de crédito con día de corte/pago, o marca transacciones como domiciliadas."),
      ])
    );
    return;
  }

  const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Próximos pagos")]);
  for (const ev of events) {
    const daysLeft = DateUtil.daysBetween(DateUtil.todayISO(), ev.date);
    const urgency = daysLeft <= 3 ? "danger" : daysLeft <= 7 ? "warn" : "";
    card.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { class: "icon" }, ev.icon),
        el("div", { class: "main" }, [
          el("div", { class: "title" }, ev.title),
          el("div", { class: "meta" }, `${DateUtil.formatLong(ev.date)}${ev.meta ? " · " + ev.meta : ""}`),
        ]),
        el("div", { class: `badge ${urgency}` }, daysLeft === 0 ? "Hoy" : daysLeft === 1 ? "Mañana" : `${daysLeft} días`),
      ])
    );
  }
  root.appendChild(card);
}

window.renderCalendar = renderCalendar;
