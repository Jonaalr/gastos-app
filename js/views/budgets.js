/**
 * budgets.js — Presupuestos por categoría con alertas al 80% / 100%.
 */

async function renderBudgets(root, params) {
  const monthKey = params.get("month") || DateUtil.monthKey();
  const [budgets, categories, allTx] = await Promise.all([
    DB.getAllByIndex("budgets", "monthKey", monthKey),
    DB.getAllByIndex("categories", "kind", "expense"),
    DB.getAll("transactions"),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const spentByCategory = {};
  for (const t of allTx) {
    if (t.type !== "expense") continue;
    if (DateUtil.monthKey(t.date) !== monthKey) continue;
    if (!t.categoryId) continue;
    spentByCategory[t.categoryId] = (spentByCategory[t.categoryId] || 0) + myShareCents(t);
  }

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Presupuestos")]));
  root.appendChild(sectionTabs(PRESUPUESTO_TABS, "/budgets"));
  root.appendChild(renderMonthSwitcher(monthKey, (newMonth) => Router.navigate(`/budgets?month=${newMonth}`)));

  const totalLimit = budgets.reduce((s, b) => s + b.limitCents, 0);
  const totalSpent = budgets.reduce((s, b) => s + (spentByCategory[b.categoryId] || 0), 0);
  if (budgets.length > 0) {
    root.appendChild(renderBudgetBar("Total presupuestado", totalSpent, totalLimit, true));
  }

  const usedCategoryIds = new Set(budgets.map((b) => b.categoryId));
  const availableCats = categories.filter((c) => !usedCategoryIds.has(c.id));

  if (budgets.length === 0) {
    root.appendChild(el("div", { class: "card" }, el("div", { class: "empty-state" }, "Sin presupuestos este mes. Agrega uno por categoría.")));
  } else {
    for (const b of budgets) {
      const cat = catMap[b.categoryId];
      const spent = spentByCategory[b.categoryId] || 0;
      const card = el("div", { class: "card" });
      card.appendChild(
        el("div", { class: "flex-between" }, [
          el("div", { style: "font-weight:700;" }, `${cat ? cat.name : "—"}`),
          el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", "data-edit-budget": b.id }, "Editar"),
        ])
      );
      card.appendChild(renderBudgetBar(null, spent, b.limitCents));
      root.appendChild(card);
    }
  }

  if (availableCats.length > 0) {
    root.appendChild(
      el("button", { class: "btn mt-8", onclick: () => openBudgetSheet({ monthKey, availableCats, onSaved: () => Router.render() }) }, "+ Agregar presupuesto")
    );
  }

  root.querySelectorAll("[data-edit-budget]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const b = await DB.get("budgets", parseInt(btn.dataset.editBudget, 10));
      openBudgetSheet({ monthKey, existing: b, onSaved: () => Router.render() });
    });
  });
}

function renderBudgetBar(label, spentCents, limitCents, big = false) {
  const pct = limitCents > 0 ? Math.min(100, Math.round((spentCents / limitCents) * 100)) : 0;
  const level = pct >= 100 ? "danger" : pct >= 80 ? "warn" : "";
  const container = el("div", {});
  if (label) container.appendChild(el("div", { class: "card-title" }, label));
  container.appendChild(
    el("div", { class: "flex-between" }, [
      el("div", { style: big ? "font-weight:700;" : "font-size:13px;" }, `${Money.format(spentCents)} de ${Money.format(limitCents)}`),
      el("div", { class: `badge ${level || "success"}` }, `${pct}%`),
    ])
  );
  const track = el("div", { class: "progress-track" });
  track.appendChild(el("div", { class: `progress-fill ${level}`, style: `width:${pct}%` }));
  container.appendChild(track);
  if (pct >= 100) container.appendChild(el("div", { class: "text-dim", style: "font-size:12px;margin-top:6px;color:var(--danger);" }, "Superaste el presupuesto de este mes."));
  else if (pct >= 80) container.appendChild(el("div", { class: "text-dim", style: "font-size:12px;margin-top:6px;color:var(--warn);" }, "Vas en el 80% o más del presupuesto."));
  return container;
}

async function openBudgetSheet({ monthKey, existing = null, availableCats = [], onSaved = null } = {}) {
  const data = existing || { categoryId: availableCats[0]?.id, monthKey, limitCents: 0 };
  if (!existing && !data.categoryId) {
    toast("No hay categorías disponibles para agregar", "error");
    return;
  }

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  sheet.innerHTML = `
    <div class="sheet-header">
      <h2>${existing ? "Editar presupuesto" : "Nuevo presupuesto"}</h2>
      <button class="sheet-close" data-close>✕</button>
    </div>
    ${existing ? "" : `
    <div class="form-group">
      <label>Categoría</label>
      <select id="f-category">${availableCats.map((c) => `<option value="${c.id}">${categoryLabel(c)}</option>`).join("")}</select>
    </div>`}
    <div class="form-group">
      <label>Límite mensual (MXN)</label>
      <input type="number" inputmode="decimal" step="0.01" id="f-limit" value="${data.limitCents ? Money.toInputValue(data.limitCents) : ""}">
    </div>
    <div class="btn-row mt-8">
      ${existing ? '<button class="btn btn-danger btn-sm" id="f-delete" style="flex:0 0 auto;">Eliminar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

  sheet.querySelector("[data-close]").addEventListener("click", close);

  if (existing) {
    sheet.querySelector("#f-delete").addEventListener("click", async () => {
      await DB.delete("budgets", existing.id);
      close();
      if (onSaved) onSaved();
    });
  }

  sheet.querySelector("#f-save").addEventListener("click", async () => {
    const limitCents = Money.toCents(sheet.querySelector("#f-limit").value);
    if (!limitCents || limitCents <= 0) { toast("Ingresa un límite válido", "error"); return; }
    const record = {
      ...data,
      categoryId: existing ? data.categoryId : parseInt(sheet.querySelector("#f-category").value, 10),
      limitCents,
    };
    if (existing) record.id = existing.id;
    await DB.put("budgets", record);
    toast("Presupuesto guardado", "success");
    close();
    if (onSaved) onSaved();
  });
}

window.renderBudgets = renderBudgets;
