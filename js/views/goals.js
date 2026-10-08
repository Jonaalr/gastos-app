/**
 * goals.js — Metas de ahorro.
 *
 * Una meta tiene nombre y monto objetivo. Su avance sale de:
 *   - una cuenta de ahorro ligada (usa su saldo), o
 *   - aportes manuales que tú registras.
 * Las metas NO crean movimientos: no tocan saldos ni presupuestos.
 * Se guardan en meta["savingsGoals"].
 */

async function loadGoals() {
  return DB.getMeta("savingsGoals", []);
}
async function saveGoals(goals) {
  return DB.setMeta("savingsGoals", goals);
}

/** Tarjeta de metas (se dibuja al final de Dinero > Cuentas). */
async function renderGoalsCard(root) {
  const [goals, accounts] = await Promise.all([loadGoals(), DB.getAll("accounts")]);
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const card = el("div", { class: "card goals-card" }, [el("div", { class: "card-title" }, "Metas de ahorro")]);
  if (goals.length === 0) {
    card.appendChild(el("div", { class: "muted" }, "Pon una meta, por ejemplo un viaje o un fondo de emergencia, y ve tu avance."));
  }

  for (const g of goals) {
    const linked = g.accountId ? accMap[g.accountId] : null;
    const saved = linked ? Math.max(0, linked.balanceCents) : g.savedCents || 0;
    const pct = g.targetCents > 0 ? Math.min(100, Math.round((saved / g.targetCents) * 100)) : 0;
    const done = saved >= g.targetCents && g.targetCents > 0;
    const actions = [];
    if (!linked) {
      actions.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openGoalContribution(g) }, "Aportar"));
    }
    actions.push(el("button", { class: "btn btn-secondary btn-sm", onclick: () => openGoalSheet(g) }, "Editar"));

    card.appendChild(
      el("div", { class: "goal-row" }, [
        el("div", { class: "goal-head" }, [
          el("div", { class: "goal-name" }, g.name),
          el("div", { class: "goal-amount" }, `${Money.format(saved)} de ${Money.format(g.targetCents)}`),
        ]),
        el("div", { class: "goal-bar" }, [el("div", { class: `goal-fill${done ? " done" : ""}`, style: `width:${pct}%` })]),
        el("div", { class: "goal-meta" }, [
          el("span", {}, done ? "Meta cumplida" : `${pct}% · ${linked ? `ligada a ${linked.name}` : "aportes manuales"}`),
          el("div", { class: "goal-actions" }, actions),
        ]),
      ])
    );
  }

  card.appendChild(el("button", { class: "btn mt-8", onclick: () => openGoalSheet(null) }, "+ Nueva meta"));
  root.appendChild(card);
}

/** Crear o editar una meta. */
async function openGoalSheet(existing) {
  const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived && a.type === "savings");
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const accOptions = [`<option value="">Aportes manuales</option>`]
    .concat(accounts.map((a) => `<option value="${a.id}" ${existing && existing.accountId === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`))
    .join("");

  sheet.innerHTML = `
    <div class="sheet-header"><h2>${existing ? "Editar meta" : "Nueva meta"}</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group"><label>Nombre</label><input type="text" id="g-name" placeholder="Ej. Viaje a Japón" value="${existing ? escapeHtml(existing.name) : ""}"></div>
    <div class="form-group"><label>Monto objetivo (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="g-target" value="${existing ? Money.toInputValue(existing.targetCents) : ""}"></div>
    <div class="form-group"><label>¿Dónde lo guardas?</label><select id="g-account">${accOptions}</select></div>
    <div class="form-group" id="g-saved-wrap" style="${existing && existing.accountId ? "display:none" : ""}">
      <label>Lo que llevas ahorrado (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="g-saved" value="${existing && !existing.accountId ? Money.toInputValue(existing.savedCents || 0) : ""}">
    </div>
    <button class="btn" id="g-save">Guardar</button>
    ${existing ? `<button class="btn btn-secondary mt-8" id="g-delete" style="color:var(--danger);">Eliminar meta</button>` : ""}
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  const accSel = sheet.querySelector("#g-account");
  accSel.addEventListener("change", () => {
    sheet.querySelector("#g-saved-wrap").style.display = accSel.value ? "none" : "";
  });

  sheet.querySelector("#g-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#g-name").value.trim();
    const targetCents = Money.toCents(sheet.querySelector("#g-target").value);
    if (!name) { toast("Ponle un nombre a la meta", "error"); return; }
    if (targetCents <= 0) { toast("Pon un monto objetivo", "error"); return; }
    const accountId = parseInt(accSel.value, 10) || null;
    const savedCents = accountId ? 0 : Money.toCents(sheet.querySelector("#g-saved").value);
    const goals = await loadGoals();
    if (existing) {
      const i = goals.findIndex((g) => g.id === existing.id);
      if (i >= 0) goals[i] = { ...goals[i], name, targetCents, accountId, savedCents };
    } else {
      goals.push({ id: uid(), name, targetCents, accountId, savedCents, createdAt: new Date().toISOString() });
    }
    await saveGoals(goals);
    close();
    Router.render();
  });

  const del = sheet.querySelector("#g-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la meta "${existing.name}"? Tus cuentas y movimientos no cambian.`)) return;
      await saveGoals((await loadGoals()).filter((g) => g.id !== existing.id));
      close();
      Router.render();
    });
  }
}

/** Aporte manual a una meta (no crea movimiento ni toca saldos). */
async function openGoalContribution(goal) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  sheet.innerHTML = `
    <div class="sheet-header"><h2>Aportar a "${escapeHtml(goal.name)}"</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group"><label>Cuánto llevas ahorrado en total (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="c-amount" value="${Money.toInputValue(goal.savedCents || 0)}"></div>
    <p class="muted" style="font-size:12px;">Esto solo actualiza el avance de la meta. No cambia tus cuentas ni tus gastos.</p>
    <button class="btn" id="c-save">Guardar avance</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.querySelector("#c-save").addEventListener("click", async () => {
    const savedCents = Money.toCents(sheet.querySelector("#c-amount").value);
    const goals = await loadGoals();
    const i = goals.findIndex((g) => g.id === goal.id);
    if (i >= 0) goals[i] = { ...goals[i], savedCents: Math.max(0, savedCents) };
    await saveGoals(goals);
    close();
    Router.render();
  });
}
