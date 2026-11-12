/**
 * calendar.js — Pagos: tarjetas de crédito (corte y pago en un mismo recuadro) y domiciliados.
 */

/**
 * Pagos que vienen en los próximos días: fecha límite de las tarjetas con saldo y domiciliados.
 * Lo usan Inicio (Pendientes) y Pagos. Devuelve [{ date, daysLeft, title, meta, icon }] por fecha.
 */
function upcomingPayments(accounts, transactions, recStatus, withinDays) {
  const today = DateUtil.todayISO();
  const items = [];
  for (const a of accounts) {
    if (a.type !== "credit" || a.archived || !a.dueDay) continue;
    const spent = Math.max(0, -a.balanceCents);
    if (!spent) continue;
    items.push({ date: DateUtil.nextOccurrence(a.dueDay, new Date()), title: `Pago de ${a.name}`, meta: `Gastado ${Money.format(spent)}`, icon: "card" });
  }
  for (const s of buildRecurringSeries(transactions)) {
    if ((recStatus[s.key] || {}).cancelled) continue;
    items.push({
      date: DateUtil.nextOccurrence(s.last.recurringDay, new Date()),
      title: s.last.merchant || "Pago domiciliado",
      meta: `Domiciliado · ~${Money.format(s.last.amountCents)}`,
      icon: "repeat",
    });
  }
  return items
    .map((i) => ({ ...i, daysLeft: DateUtil.daysBetween(today, i.date) }))
    .filter((i) => i.daysLeft >= 0 && i.daysLeft <= withinDays)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Etiqueta de días que faltan: roja a 3 días o menos, ámbar a una semana */
function dueBadge(iso) {
  const daysLeft = DateUtil.daysBetween(DateUtil.todayISO(), iso);
  const urgency = daysLeft <= 3 ? "danger" : daysLeft <= 7 ? "warn" : "";
  return el("div", { class: `badge ${urgency}` }, daysLeft === 0 ? "Hoy" : daysLeft === 1 ? "Mañana" : `${daysLeft} días`);
}

async function renderCalendar(root) {
  const [accounts, transactions] = await Promise.all([DB.getAll("accounts"), DB.getAll("transactions")]);
  const creditCards = accounts
    .filter((a) => a.type === "credit" && !a.archived && a.dueDay)
    // Primero la tarjeta cuyo pago vence antes
    .sort((a, b) => DateUtil.nextOccurrence(a.dueDay, new Date()).localeCompare(DateUtil.nextOccurrence(b.dueDay, new Date())) || a.name.localeCompare(b.name, "es"));
  const recurring = transactions.filter((t) => t.isRecurring && t.recurringDay);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Pagos")]));
  await renderDueRecurring(root);

  const badgeFor = dueBadge;

  // Una caja por tarjeta: fecha de corte y fecha de pago juntas
  for (const card of creditCards) {
    const nextDue = DateUtil.nextOccurrence(card.dueDay, new Date());
    const nextCut = card.cutDay ? DateUtil.nextOccurrence(card.cutDay, new Date()) : null;
    const spent = Math.max(0, -card.balanceCents);
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "calendar-card-head" }, [
          el("div", { class: "icon-chip" }, [accountBadge(card)]),
          el("div", { class: "calendar-card-name" }, [
            el("div", { class: "card-title" }, card.name),
            el("div", { class: "text-dim", style: "font-size:12px;" }, spent ? `Gastado ${Money.format(spent)}` : "Sin saldo gastado"),
          ]),
        ]),
        nextCut
          ? el("div", { class: "list-item" }, [
              el("div", { class: "icon" }, iconNode("calendar")),
              el("div", { class: "main" }, [el("div", { class: "title" }, "Fecha de corte"), el("div", { class: "meta" }, DateUtil.formatLong(nextCut))]),
              badgeFor(nextCut),
            ])
          : null,
        el("div", { class: "list-item" }, [
          el("div", { class: "icon" }, iconNode("card")),
          el("div", { class: "main" }, [el("div", { class: "title" }, "Fecha límite de pago"), el("div", { class: "meta" }, DateUtil.formatLong(nextDue))]),
          badgeFor(nextDue),
        ]),
      ])
    );
  }

  // Domiciliados: un renglón por cobro recurrente (el más reciente de cada serie)
  const events = [];
  const recStatus = await loadRecurringStatus();
  const peopleNames = Object.fromEntries((await DB.getAll("people")).map((p) => [p.id, p.name]));
  const latestByKey = new Map();
  for (const t of recurring) {
    const key = recurringSeriesKey(t);
    const cur = latestByKey.get(key);
    if (!cur || (t.date || "") > (cur.date || "")) latestByKey.set(key, t);
  }
  for (const t of latestByKey.values()) {
    if ((recStatus[recurringSeriesKey(t)] || {}).cancelled) continue;
    const shared = t.split
      ? ` · Compartido con ${t.split.participants.map((p) => peopleNames[p.personId] || "—").join(", ")} · tu parte ${Money.format(t.split.myShareCents)}`
      : "";
    events.push({
      date: DateUtil.nextOccurrence(t.recurringDay, new Date()),
      title: t.merchant || "Pago domiciliado",
      meta: `Recurrente · ~${Money.format(t.amountCents)}${shared}`,
      icon: "repeat",
      tx: t,
      myCents: t.split ? t.split.myShareCents : t.amountCents,
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
    const card = el("div", { class: "card" }, [
      el("div", { class: "flex-between" }, [
        el("div", { class: "card-title" }, "Domiciliados"),
        el("div", { class: "card-title", style: "text-transform:none;letter-spacing:0;" }, `~${Money.format(events.reduce((s, e) => s + e.myCents, 0))} al mes`),
      ]),
      el("div", { class: "text-dim", style: "font-size:12px;margin-top:-6px;margin-bottom:6px;" }, "Pagos que se cobran solos cada mes. Toca + para agregar uno."),
    ]);
    for (const ev of events) {
      card.appendChild(
        el("div", { class: "list-item", style: "cursor:pointer;", onclick: () => openTransactionSheet({ existing: ev.tx, onSaved: () => Router.render() }) }, [
          el("div", { class: "icon" }, iconNode(ev.icon)),
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
window.upcomingPayments = upcomingPayments;
window.dueBadge = dueBadge;
