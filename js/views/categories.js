/**
 * categories.js — CRUD de categorías y subcategorías.
 */

async function renderCategories(root) {
  const categories = await DB.getAll("categories");
  const expenseCats = categories.filter((c) => c.kind === "expense" && !c.parentId);
  const incomeCats = categories.filter((c) => c.kind === "income" && !c.parentId);
  const subOf = (id) => categories.filter((c) => c.parentId === id);

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Categorías")]));

  root.appendChild(el("div", { class: "section-title" }, "Gastos"));
  root.appendChild(renderCategoryList(expenseCats, subOf));

  root.appendChild(el("div", { class: "section-title" }, "Ingresos"));
  root.appendChild(renderCategoryList(incomeCats, subOf));

  root.appendChild(
    el("div", { class: "btn-row mt-8" }, [
      el("button", { class: "btn btn-secondary", onclick: () => openCategorySheet({ kind: "expense", onSaved: () => Router.render() }) }, "+ Categoría de gasto"),
      el("button", { class: "btn btn-secondary", onclick: () => openCategorySheet({ kind: "income", onSaved: () => Router.render() }) }, "+ Categoría de ingreso"),
    ])
  );

  root.querySelectorAll("[data-edit-cat]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const cat = await DB.get("categories", parseInt(btn.dataset.editCat, 10));
      openCategorySheet({ existing: cat, onSaved: () => Router.render() });
    });
  });
  root.querySelectorAll("[data-add-sub]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCategorySheet({
        kind: btn.dataset.kind,
        parentId: parseInt(btn.dataset.addSub, 10),
        onSaved: () => Router.render(),
      });
    });
  });
}

function renderCategoryList(cats, subOf) {
  const card = el("div", { class: "card" });
  if (cats.length === 0) {
    card.appendChild(el("div", { class: "empty-state" }, "Sin categorías todavía."));
    return card;
  }
  for (const c of cats) {
    const subs = subOf(c.id);
    card.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { class: "icon" }, categoryIconNode(c)),
        el("div", { class: "main" }, [
          el("div", { class: "title" }, c.name),
          subs.length ? el("div", { class: "meta" }, subs.map((s) => s.name).join(", ")) : null,
        ]),
        el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;", "data-add-sub": c.id, "data-kind": c.kind }, "+ sub"),
        el("button", { class: "btn-sm btn-secondary btn", style: "width:auto;margin-left:6px;", "data-edit-cat": c.id }, "Editar"),
      ])
    );
  }
  return card;
}

async function openCategorySheet({ existing = null, kind = "expense", parentId = null, onSaved = null } = {}) {
  const data = existing || { name: "", icon: "📦", kind, parentId, isDefault: false, autoRule: null };

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  sheet.innerHTML = `
    <div class="sheet-header">
      <h2>${existing ? "Editar categoría" : parentId ? "Nueva subcategoría" : "Nueva categoría"}</h2>
      <button class="sheet-close" data-close>✕</button>
    </div>
    <div class="form-group">
      <label>Ícono (emoji)</label>
      <input type="text" id="f-icon" value="${data.icon}" maxlength="4" style="width:70px; text-align:center; font-size:20px;">
    </div>
    <div class="form-group">
      <label>Nombre</label>
      <input type="text" id="f-name" value="${data.name}" placeholder="Ej. Mascotas">
    </div>
    <div class="btn-row mt-8">
      ${existing && !existing.isDefault ? '<button class="btn btn-danger btn-sm" id="f-delete" style="flex:0 0 auto;">Eliminar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

  sheet.querySelector("[data-close]").addEventListener("click", close);

  if (existing && !existing.isDefault) {
    sheet.querySelector("#f-delete").addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta categoría? Las transacciones que la usan quedarán sin categoría.")) return;
      await DB.delete("categories", existing.id);
      close();
      if (onSaved) onSaved();
    });
  }

  sheet.querySelector("#f-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#f-name").value.trim();
    if (!name) { toast("Ponle un nombre", "error"); return; }
    const record = {
      ...data,
      name,
      icon: sheet.querySelector("#f-icon").value.trim() || "📦",
    };
    if (existing) record.id = existing.id;
    await DB.put("categories", record);
    toast("Categoría guardada", "success");
    close();
    if (onSaved) onSaved();
  });
}

window.renderCategories = renderCategories;
window.openCategorySheet = openCategorySheet;
