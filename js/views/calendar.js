/**
 * calendar.js — Calendario de pagos: tarjetas de crédito (corte y pago en un mismo recuadro) y domiciliados.
 */

async function renderCalendar(root) {
  const [accounts, transactions] = await Promise.all([DB.getAll("accounts"), DB.getAll("transactions")]);
  const creditCards = accounts
    .filter((a) => a.type === "credit" && !a.archived && a.dueDay)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const recurring = transactions.filter((t) => t.isRecurring && t.recurringDay);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Calendario de pagos")]));

  const today = DateUtil.todayISO();
  const badgeFor = (iso) => {
    const daysLeft = DateUtil.daysBetween(today, iso);
    const urgency = daysLeft <= 3 ? "danger" : daysLeft <= 7 ? "warn" : "";
    return el("div", { class: `badge ${urgency}` }, daysLeft === 0 ? "Hoy" : daysLeft === 1 ? "Mañana" : `${daysLeft} días`);
  };

  // Una caja por tarjeta: fecha de corte y fecha de pago juntas
  for (const card of creditCards) {
    const nextDue = DateUtil.nextOccurrence(card.dueDay, new Date());
    const nextCut = card.cutDay ? DateUtil.nextOccurrence(card.cutDay, new Date()) : null;
    const spent = Math.max(0, -card.balanceCents);
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "card-title" }, card.name),
        el("div", { class: "text-dim", style: "font-size:12px;margin-top:-6px;margin-bottom:6px;" }, spent ? `Gastado ${Money.format(spent)}` : "Sin saldo gastado"),
        nextCut
          ? el("div", { class: "list-item" }, [
              el("div", { class: "icon" }, "📅"),
              el("div", { class: "main" }, [el("div", { class: "title" }, "Fecha de corte"), el("div", { class: "meta" }, DateUtil.formatLong(nextCut))]),
              badgeFor(nextCut),
            ])
          : null,
        el("div", { class: "list-item" }, [
          el("div", { class: "icon" }, "🪪"),
          el("div", { class: "main" }, [el("div", { class: "title" }, "Fecha límite de pago"), el("div", { class: "meta" }, DateUtil.formatLong(nextDue))]),
          badgeFor(nextDue),
        ]),
      ])
    );
  }

  // Domiciliados: agrupar por comercio+categoría para no repetir cada transacción pasada
  const events = [];
  const seen = new Set();
  for (const t of recurring) {
    const key = `${t.merchant}-${t.categoryId}-${t.accountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      date: DateUtil.nextOccurrence(t.recurringDay, new Date()),
      title: t.merchant || "Pago domiciliado",
      meta: `Recurrente · ~${Money.format(t.amountCents)}`,
      icon: "🔁",
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  if (creditCards.length === 0 && events.length === 0) {
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "empty-state" }, "Sin pagos próximos. Agrega una tarjeta de crédito con día de corte/pago, o marca transacciones como domiciliadas."),
      ])
    );
    return;
  }

  if (events.length > 0) {
    const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Domiciliados")]);
    for (const ev of events) {
      card.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { class: "icon" }, ev.icon),
          el("div", { class: "main" }, [
            el("div", { class: "title" }, ev.title),
            el("div", { class: "meta" }, `${DateUtil.formatLong(ev.date)} · ${ev.meta}`),
          ]),
          badgeFor(ev.date),
        ])
      );
    }
    root.appendChild(card);
  }
}

window.renderCalendar = renderCalendar;
