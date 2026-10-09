/**
 * receivables.js — Dinero > Por cobrar (filtros Todos / Préstamos / Gastos compartidos). Personas con quienes compartes gastos, sus cargos y sus cobros.
 *
 * Saldo de una persona = suma de su parte en los gastos entre varios − cobros registrados.
 * Un saldo negativo significa que te pagó de más (a favor).
 */

/** Calcula el saldo de cada persona, ordenado por lo que más te debe */
async function computeReceivables() {
  const [people, transactions, collections] = await Promise.all([
    DB.getAll("people"),
    DB.getAll("transactions"),
    DB.getAll("collections"),
  ]);

  const byPerson = new Map(people.map((p) => [p.id, { person: p, charged: 0, paid: 0, charges: [], payments: [] }]));

  for (const t of transactions) {
    if (!t.split) continue;
    for (const part of t.split.participants) {
      const row = byPerson.get(part.personId);
      if (!row) continue;
      row.charged += part.shareCents;
      row.charges.push({ kind: "charge", date: t.date, tx: t, amountCents: part.shareCents });
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

/** Total que te deben (solo saldos positivos) y cuántas personas */
async function receivablesTotal() {
  const rows = await computeReceivables();
  const owing = rows.filter((r) => r.balance > 0);
  return { total: owing.reduce((s, r) => s + r.balance, 0), count: owing.length };
}

function initialOf(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

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
  const loans = await loadLoans();
  const loansOwed = loans.reduce((s, l) => s + loanStatus(l).owed, 0);

  const total = (showShared ? sharedTotal : 0) + (showLoans ? loansOwed : 0);
  const parts = [];
  if (showLoans && loans.length) parts.push(`${loans.length} ${loans.length === 1 ? "préstamo" : "préstamos"}`);
  if (showShared && owing.length) parts.push(`${owing.length} ${owing.length === 1 ? "persona" : "personas"}`);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Dinero")]));
  root.appendChild(sectionTabs(DINERO_TABS, "/receivables"));
  root.appendChild(
    filterChips(PRESTAMOS_FILTERS, f, (id) => Router.navigate(id === "todos" ? "/receivables" : `/receivables?f=${id}`))
  );

  // Tarjeta "Te deben": al tocarla se despliega el desglose de gastos compartidos y préstamos
  const breakdownRow = (label, cents, sub) =>
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid rgba(0,0,0,.08);text-align:left;" }, [
      el("div", {}, [el("div", { style: "font-weight:600;" }, label), el("div", { class: "muted", style: "font-size:12px;" }, sub)]),
      el("strong", {}, Money.format(cents)),
    ]);
  const detail = el("div", { style: "display:none;margin-top:8px;" }, [
    breakdownRow("Gastos compartidos", sharedTotal, `${owing.length} ${owing.length === 1 ? "persona te debe" : "personas te deben"}`),
    breakdownRow("Préstamos", loansOwed, `${loans.length} ${loans.length === 1 ? "préstamo" : "préstamos"}`),
  ]);
  const chev = el("span", { style: "display:inline-block;transition:transform .2s;color:#c7c7cc;margin-left:6px;vertical-align:middle;", html: svgIcon("chevron", 16) });
  const hero = el("div", { class: "card balance-hero", style: "cursor:pointer;" }, [
    el("div", { class: "label" }, [el("span", {}, "Te deben"), chev]),
    el("div", { class: "amount" }, Money.format(total)),
    el("div", { class: "label" }, parts.length ? parts.join(" · ") : "Nadie te debe nada"),
    detail,
  ]);
  hero.addEventListener("click", () => {
    const open = detail.style.display === "none";
    detail.style.display = open ? "block" : "none";
    chev.style.transform = open ? "rotate(90deg)" : "";
  });
  root.appendChild(hero);

  if (showLoans) {
    if (f === "todos") root.appendChild(el("div", { class: "card-title", style: "margin:16px 2px 6px;" }, "Préstamos"));
    await renderLoansTab(root, f === "prestamos");
  }

  if (showShared) {
    if (f === "todos") root.appendChild(el("div", { class: "card-title", style: "margin:16px 2px 6px;" }, "Gastos compartidos"));
    if (owing.length === 0) {
      root.appendChild(
        el("div", { class: "card" }, [
          el("div", { class: "empty-state" }, "Cuando registres un gasto entre varios, aquí verás quién te debe y cuánto."),
        ])
      );
    } else {
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

async function openCollectionSheet({ personId, name, suggested = 0, onSaved = null } = {}) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  let method = "transfer";
  sheet.innerHTML = `
    <div class="sheet-header"><h2>Cobro de ${escapeHtml(name)}</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group">
      <label>Monto (MXN)</label>
      <input type="number" inputmode="decimal" step="0.01" id="f-col-amount" value="${suggested ? Money.toInputValue(suggested) : ""}" placeholder="0.00">
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
      <input type="text" id="f-col-note" placeholder="Ej. cena del viernes">
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
  sheet.querySelector("#f-col-save").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#f-col-amount").value);
    if (!amountCents || amountCents <= 0) { toast("Ingresa un monto válido", "error"); return; }
    await DB.add("collections", {
      personId,
      amountCents,
      method,
      date: sheet.querySelector("#f-col-date").value || DateUtil.todayISO(),
      note: sheet.querySelector("#f-col-note").value.trim(),
      createdAt: new Date().toISOString(),
    });
    toast("Cobro registrado", "success");
    close();
    if (onSaved) onSaved();
  });
}

window.renderReceivables = renderReceivables;
window.computeReceivables = computeReceivables;
window.receivablesTotal = receivablesTotal;
