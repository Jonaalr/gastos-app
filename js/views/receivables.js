/**
 * receivables.js — Dinero > Por cobrar (filtros Todos / Préstamos / Gastos compartidos). Personas con quienes compartes gastos, sus cargos y sus cobros.
 *
 * Saldo de una persona = suma de su parte en los gastos entre varios − cobros registrados.
 * Un saldo negativo significa que te pagó de más (a favor).
 */

/** Calcula el saldo de cada persona, ordenado por lo que más te debe */
/** "2026-10-31" + n meses, con el día del domiciliado (si el mes es más corto, el último día) */
function addMonthsISO(iso, months, day) {
  const [y, m] = iso.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return DateUtil.toISO(new Date(target.getFullYear(), target.getMonth(), Math.min(day, last)));
}

/** ¿Todos los participantes ya pagaron su parte de este ciclo? */
function cycleLines(cycle, tpl, collections, people) {
  const nameOf = Object.fromEntries(people.map((p) => [p.id, p.name]));
  return tpl.split.participants.map((part) => {
    const paidCents = collections
      .filter((c) => c.cycleId === cycle.id && c.personId === part.personId)
      .reduce((s, c) => s + c.amountCents, 0);
    return { personId: part.personId, name: nameOf[part.personId] || "—", shareCents: part.shareCents, paidCents };
  });
}

/**
 * Ciclos de los domiciliados compartidos: cada cargo mensual es un ciclo.
 * Se crea el siguiente cuando el actual ya lo pagaron todos o cuando llegó su fecha (lo que pase primero),
 * así un cargo que ya se cobró no se pierde aunque alguien tarde en pagar.
 */
async function syncDomCycles(transactions, collections, people) {
  const today = DateUtil.todayISO();
  let cycles = await DB.getMeta("domCycles", []);
  const templates = transactions.filter((t) => t.split && t.isRecurring && t.recurringDay);
  const alive = new Set(templates.map((t) => t.id));
  const before = cycles.length;
  cycles = cycles.filter((c) => alive.has(c.txId));
  let changed = cycles.length !== before;

  for (const tpl of templates) {
    let mine = cycles.filter((c) => c.txId === tpl.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!mine.length) {
      // Sin historia retroactiva: si el gasto es de un mes pasado, el primer ciclo es el próximo cargo
      const sameOrLaterMonth = DateUtil.monthKey(tpl.date) >= DateUtil.monthKey(today);
      const dueDate = sameOrLaterMonth ? tpl.date : DateUtil.nextOccurrence(tpl.recurringDay);
      const first = { id: uid(), txId: tpl.id, dueDate };
      cycles.push(first);
      mine = [first];
      changed = true;
    }
    for (let guard = 0; guard < 24; guard++) {
      const last = mine[mine.length - 1];
      const lines = cycleLines(last, tpl, collections, people);
      const paidAll = lines.every((l) => l.paidCents >= l.shareCents);
      if (!(paidAll || last.dueDate <= today)) break;
      const next = { id: uid(), txId: tpl.id, dueDate: addMonthsISO(last.dueDate, 1, tpl.recurringDay) };
      cycles.push(next);
      mine.push(next);
      changed = true;
    }
  }

  if (changed) await DB.setMeta("domCycles", cycles);
  return cycles.filter((c) => alive.has(c.txId));
}

async function computeReceivables() {
  const [people, transactions, collections] = await Promise.all([
    DB.getAll("people"),
    DB.getAll("transactions"),
    DB.getAll("collections"),
  ]);

  const byPerson = new Map(people.map((p) => [p.id, { person: p, charged: 0, paid: 0, charges: [], payments: [] }]));
  const txById = new Map(transactions.map((t) => [t.id, t]));

  // Gastos normales entre varios
  for (const t of transactions) {
    if (!t.split || t.isRecurring) continue;
    for (const part of t.split.participants) {
      const row = byPerson.get(part.personId);
      if (!row) continue;
      row.charged += part.shareCents;
      row.charges.push({ kind: "charge", date: t.date, tx: t, amountCents: part.shareCents });
    }
  }

  // Domiciliados compartidos: cada ciclo cobra la parte de cada participante
  // Solo cuentan como deuda los cargos que ya llegaron; un pago anticipado queda "a favor" hasta entonces
  const today = DateUtil.todayISO();
  const cycles = await syncDomCycles(transactions, collections, people);
  for (const cycle of cycles) {
    if (cycle.dueDate > today) continue;
    const tx = txById.get(cycle.txId);
    if (!tx) continue;
    for (const part of tx.split.participants) {
      const row = byPerson.get(part.personId);
      if (!row) continue;
      row.charged += part.shareCents;
      row.charges.push({ kind: "charge", date: cycle.dueDate, tx, amountCents: part.shareCents });
    }
  }

  for (const c of collections) {
    const row = byPerson.get(c.personId);
    if (!row) continue;
    row.paid += c.amountCents;
    row.payments.push({ kind: "payment", date: c.date, collection: c, amountCents: c.amountCents });
  }

  return [...byPerson.values()]
    .map((r) => ({ ...r, balance: r.charged - r.paid }))
    .sort((a, b) => b.balance - a.balance || a.person.name.localeCompare(b.person.name));
}

/** Ciclos de domiciliados que aún no están pagados por todos (los pagados desaparecen) */
async function openDomCycles() {
  const [people, transactions, collections] = await Promise.all([
    DB.getAll("people"),
    DB.getAll("transactions"),
    DB.getAll("collections"),
  ]);
  const cycles = await syncDomCycles(transactions, collections, people);
  const today = DateUtil.todayISO();
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const out = [];
  for (const cycle of cycles) {
    const tx = txById.get(cycle.txId);
    if (!tx) continue;
    const lines = cycleLines(cycle, tx, collections, people);
    if (lines.every((l) => l.paidCents >= l.shareCents)) continue;
    out.push({
      cycle,
      tx,
      lines,
      late: cycle.dueDate < today,
      dueDate: cycle.dueDate,
    });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Total que te deben (solo saldos positivos) y cuántas personas */
async function receivablesTotal() {
  const rows = await computeReceivables();
  const owing = rows.filter((r) => r.balance > 0);
  return { total: owing.reduce((s, r) => s + r.balance, 0), count: owing.length };
}

function initialOf(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

let receivablesFilterOpen = false;

async function renderReceivables(root, params) {
  const personId = parseInt(params.get("person") || "0", 10) || null;
  if (personId) return renderPersonDetail(root, personId);

  // Filtro: ?f=todos | prestamos | compartidos (?tab=prestamos se sigue aceptando)
  const legacy = params.get("tab") === "prestamos" ? "prestamos" : "todos";
  const f = ["todos", "prestamos", "compartidos"].includes(params.get("f")) ? params.get("f") : legacy;
  const showLoans = f !== "compartidos";
  const showShared = f !== "prestamos";

  const rows = await computeReceivables();
  const owing = rows.filter((r) => r.balance > 0);
  const settled = rows.filter((r) => r.balance <= 0 && r.charged > 0);
  const sharedTotal = owing.reduce((s, r) => s + r.balance, 0);
  const loans = showLoans ? await loadLoans() : [];
  const loansOwed = loans.reduce((s, l) => s + loanStatus(l).owed, 0);

  const total = (showShared ? sharedTotal : 0) + (showLoans ? loansOwed : 0);
  const parts = [];
  if (showLoans && loans.length) parts.push(`${loans.length} ${loans.length === 1 ? "préstamo" : "préstamos"}`);
  if (showShared && owing.length) parts.push(`${owing.length} ${owing.length === 1 ? "persona" : "personas"}`);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Dinero")]));
  root.appendChild(sectionTabs(DINERO_TABS, "/receivables"));
  root.appendChild(
    expandableFilter(PRESTAMOS_FILTERS, f, receivablesFilterOpen,
      () => { receivablesFilterOpen = !receivablesFilterOpen; Router.render(); },
      (id) => { receivablesFilterOpen = false; Router.navigate(id === "todos" ? "/receivables" : `/receivables?f=${id}`); })
  );

  root.appendChild(
    el("div", { class: "card balance-hero" }, [
      el("div", { class: "label" }, "Te deben"),
      el("div", { class: "amount" }, Money.format(total)),
      el("div", { class: "label" }, parts.length ? parts.join(" · ") : "Nadie te debe nada"),
    ])
  );

  if (showLoans) {
    if (f === "todos") root.appendChild(el("div", { class: "card-title", style: "margin:16px 2px 6px;" }, "Préstamos"));
    await renderLoansTab(root, f === "prestamos");
  }

  if (showShared) {
    if (f === "todos") root.appendChild(el("div", { class: "card-title", style: "margin:16px 2px 6px;" }, "Gastos compartidos"));
    const domCycles = await openDomCycles();
    if (domCycles.length) root.appendChild(domCyclesCard(domCycles));
    if (owing.length === 0 && domCycles.length === 0) {
      root.appendChild(
        el("div", { class: "card" }, [
          el("div", { class: "empty-state" }, "Cuando registres un gasto entre varios, aquí verás quién te debe y cuánto."),
        ])
      );
    } else if (owing.length) {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Pendientes")]);
      for (const r of owing) card.appendChild(personRow(r));
      root.appendChild(card);
    }

    if (settled.length) {
      const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Al corriente")]);
      for (const r of settled) card.appendChild(personRow(r));
      root.appendChild(card);
    }

    root.appendChild(
      el("button", { class: "btn mt-8", onclick: () => openPersonSheet({ onSaved: () => Router.render() }) }, "+ Agregar persona")
    );
  }
}

function domCyclesCard(cycles) {
  const card = el("div", { class: "card" }, [el("div", { class: "card-title" }, "Domiciliados compartidos")]);
  for (const c of cycles) {
    const date = DateUtil.formatShort(c.dueDate);
    const status = c.late
      ? el("span", { class: "amount expense", style: "font-size:12px;" }, `Atrasado · cargo ${date}`)
      : el("span", { class: "meta" }, `Próximo cargo ${date}`);
    const block = el("div", { class: "dom-cycle", style: "padding:10px 0;border-top:1px solid rgba(0,0,0,.08);" }, [
      el("div", { class: "flex-between" }, [el("strong", {}, c.tx.merchant || "Domiciliado"), status]),
    ]);
    for (const l of c.lines) {
      const remaining = Math.max(0, l.shareCents - l.paidCents);
      const done = remaining === 0;
      const btn = done
        ? el("span", { class: "meta" }, "Pagado")
        : el("button", {
            class: "btn small",
            type: "button",
            onclick: () => openCollectionSheet({
              personId: l.personId,
              name: l.name,
              suggested: remaining,
              cycleId: c.cycle.id,
              note: `${c.tx.merchant || "Domiciliado"} · ${date}`,
              onSaved: () => Router.render(),
            }),
          }, "Ya me pagó");
      block.appendChild(
        el("div", { class: "flex-between", style: "margin-top:8px;" }, [
          el("div", {}, [el("div", { style: "font-weight:600;" }, l.name), el("div", { class: "meta" }, `Parte ${Money.format(l.shareCents)}${l.paidCents && !done ? ` · pagó ${Money.format(l.paidCents)}` : ""}`)]),
          btn,
        ])
      );
    }
    card.appendChild(block);
  }
  return card;
}

function personRow(r) {
  const status = r.balance > 0 ? `Debe ${Money.format(r.balance)}` : r.balance < 0 ? `A favor ${Money.format(-r.balance)}` : "Pagado";
  return el("div", { class: "list-item", style: "cursor:pointer;", onclick: () => Router.navigate(`/receivables?person=${r.person.id}`) }, [
    el("div", { class: "icon" }, initialOf(r.person.name)),
    el("div", { class: "main" }, [
      el("div", { class: "title" }, r.person.name),
      el("div", { class: "meta" }, `Cargado ${Money.format(r.charged)} · cobrado ${Money.format(r.paid)}`),
    ]),
    el("div", { class: `amount ${r.balance > 0 ? "expense" : "income"}`, style: "font-size:13px;" }, status),
  ]);
}

async function renderPersonDetail(root, personId) {
  const rows = await computeReceivables();
  const row = rows.find((r) => r.person.id === personId);
  if (!row) {
    Router.navigate("/receivables");
    return;
  }

  root.appendChild(
    el("div", { class: "topbar", style: "flex-direction:column;align-items:flex-start;gap:6px;" }, [
      el("button", { class: "link-btn", onclick: () => Router.navigate("/receivables?f=compartidos") }, "‹ Gastos compartidos"),
      el("h1", {}, row.person.name),
    ])
  );

  const label = row.balance > 0 ? "Te debe" : row.balance < 0 ? "Te pagó de más" : "Al corriente";
  root.appendChild(
    el("div", { class: "card balance-hero" }, [
      el("div", { class: "label" }, label),
      el("div", { class: "amount" }, Money.format(Math.abs(row.balance))),
      el("div", { class: "label" }, `Cargado ${Money.format(row.charged)} · cobrado ${Money.format(row.paid)}`),
    ])
  );

  root.appendChild(
    el("button", { class: "btn", onclick: () => openCollectionSheet({ personId, name: row.person.name, suggested: Math.max(0, row.balance), onSaved: () => Router.render() }) }, "Registrar cobro")
  );

  const movements = [...row.charges, ...row.payments].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const card = el("div", { class: "card mt-8" }, [el("div", { class: "card-title" }, "Movimientos")]);

  if (movements.length === 0) {
    card.appendChild(el("div", { class: "empty-state" }, "Sin movimientos todavía."));
  }

  for (const m of movements) {
    if (m.kind === "charge") {
      const t = m.tx;
      const merchant = t.merchant || "Gasto";
      card.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { class: "icon" }, iconNode("receipt")),
          el("div", { class: "main" }, [
            el("div", { class: "title" }, merchant),
            el("div", { class: "meta" }, `${DateUtil.formatShort(m.date)} · total ${Money.format(t.amountCents)}`),
          ]),
          el("div", { class: "amount expense" }, `+${Money.format(m.amountCents)}`),
        ])
      );
    } else {
      const c = m.collection;
      const methodLabel = c.method === "cash" ? "Efectivo" : "Transferencia";
      card.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { class: "icon" }, iconNode(c.method === "cash" ? "banknote" : "bank")),
          el("div", { class: "main" }, [
            el("div", { class: "title" }, `Cobro · ${methodLabel}`),
            el("div", { class: "meta" }, `${DateUtil.formatShort(m.date)}${c.note ? " · " + c.note : ""}`),
          ]),
          el("div", { class: "amount income" }, `−${Money.format(m.amountCents)}`),
          el("button", { class: "icon-btn", title: "Eliminar cobro", "data-del-collection": c.id, "aria-label": "Eliminar cobro" }, "✕"),
        ])
      );
    }
  }
  root.appendChild(card);

  root.querySelectorAll("[data-del-collection]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este cobro?")) return;
      await DB.delete("collections", parseInt(btn.dataset.delCollection, 10));
      toast("Cobro eliminado", "success");
      Router.render();
    });
  });
}

async function openPersonSheet({ onSaved = null } = {}) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  sheet.innerHTML = `
    <div class="sheet-header"><h2>Nueva persona</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group">
      <label>Nombre</label>
      <input type="text" id="f-person-name" placeholder="Ej. Hermano, Ana, Cuñado">
    </div>
    <button class="btn" id="f-person-save">Guardar</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.querySelector("#f-person-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#f-person-name").value.trim().replace(/\s+/g, " ");
    if (!name) { toast("Escribe un nombre", "error"); return; }
    const all = await DB.getAll("people");
    if (all.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast("Ya existe una persona con ese nombre", "error");
      return;
    }
    await DB.add("people", { name, createdAt: new Date().toISOString() });
    toast("Persona agregada", "success");
    close();
    if (onSaved) onSaved();
  });
  setTimeout(() => sheet.querySelector("#f-person-name").focus(), 50);
}

async function openCollectionSheet({ personId, name, suggested = 0, cycleId = null, note = "", onSaved = null } = {}) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived && a.type !== "credit").sort(accountPickerCompare);
  let method = "transfer";
  sheet.innerHTML = `
    <div class="sheet-header"><h2>Cobro de ${escapeHtml(name)}</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group">
      <label>Monto (MXN)</label>
      <input type="number" inputmode="decimal" step="0.01" id="f-col-amount" value="${suggested ? Money.toInputValue(suggested) : ""}" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>¿En qué cuenta entró el dinero?</label>
      <select id="f-col-account">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountPickerLabel(a))}</option>`).join("")}</select>
      <div class="field-hint">Se registra como reembolso: suma a esa cuenta, pero no cuenta como ingreso.</div>
    </div>
    <div class="form-group">
      <label>Forma de pago</label>
      <div class="segmented" id="f-col-method">
        <button type="button" data-method="transfer" class="active">Transferencia</button>
        <button type="button" data-method="cash">Efectivo</button>
      </div>
      <div class="field-hint">Si te pagó una parte en transferencia y otra en efectivo, registra dos cobros.</div>
    </div>
    <div class="form-group">
      <label>Fecha</label>
      <input type="date" id="f-col-date" value="${DateUtil.todayISO()}">
    </div>
    <div class="form-group">
      <label>Nota (opcional)</label>
      <input type="text" id="f-col-note" placeholder="Ej. cena del viernes" value="${escapeHtml(note)}">
    </div>
    <button class="btn" id="f-col-save">Guardar cobro</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.querySelectorAll("#f-col-method button").forEach((btn) => {
    btn.addEventListener("click", () => {
      method = btn.dataset.method;
      sheet.querySelectorAll("#f-col-method button").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  if (!accounts.length) {
    toast("Primero crea una cuenta para registrar el cobro", "error");
    close();
    return;
  }
  sheet.querySelector("#f-col-save").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#f-col-amount").value);
    if (!amountCents || amountCents <= 0) { toast("Ingresa un monto válido", "error"); return; }
    const accountId = parseInt(sheet.querySelector("#f-col-account").value, 10);
    if (!accountId) { toast("Elige la cuenta donde entró el dinero", "error"); return; }
    const date = sheet.querySelector("#f-col-date").value || DateUtil.todayISO();
    const noteText = sheet.querySelector("#f-col-note").value.trim();
    const person = await DB.get("people", personId);
    const colId = await DB.add("collections", {
      personId,
      amountCents,
      method,
      date,
      note: noteText,
      accountId,
      cycleId,
      createdAt: new Date().toISOString(),
    });
    // Reembolso: entra a la cuenta (saldo y Movimientos), pero no es ingreso en Informes
    const txId = await saveTransactionWithBalances({
      type: "income",
      amountCents,
      accountId,
      toAccountId: null,
      categoryId: null,
      merchant: `Reembolso · ${person ? person.name : name}`,
      note: noteText,
      date,
      isRecurring: false,
      recurringDay: null,
      attachment: null,
      source: "reembolso",
      reimbursement: true,
      collectionId: colId,
      pendingSplit: false,
      balanceApplied: true,
      createdAt: new Date().toISOString(),
    });
    const saved = await DB.get("collections", colId);
    saved.reimbursementTxId = txId;
    await DB.put("collections", saved);
    toast("Cobro registrado", "success");
    close();
    if (onSaved) onSaved();
  });
}

window.renderReceivables = renderReceivables;
window.computeReceivables = computeReceivables;
window.receivablesTotal = receivablesTotal;
