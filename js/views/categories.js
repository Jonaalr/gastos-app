/**
 * categories.js — CRUD de categorías y subcategorías.
 */

async function renderCategories(root) {
  const categories = await DB.getAll("categories");
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const incomeCats = categories.filter((c) => c.kind === "income");

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Categorías")]));

  root.appendChild(el("div", { class: "section-title" }, "Gastos"));
  root.appendChild(renderCategoryList(expenseCats));
  root.appendChild(el("button", { class: "btn", style: "margin-top:12px;", onclick: () => openCategoryEditSheet({ kind: "expense", onSaved: () => Router.render() }) }, "+ Categoría de gasto"));

  root.appendChild(el("div", { class: "section-title", style: "margin-top:20px;" }, "Ingresos"));
  root.appendChild(renderCategoryList(incomeCats));
  root.appendChild(el("button", { class: "btn", style: "margin-top:12px;", onclick: () => openCategoryEditSheet({ kind: "income", onSaved: () => Router.render() }) }, "+ Categoría de ingreso"));
}

/** Lista de categorías: toca una fila para cambiar su nombre o emoji */
function renderCategoryList(cats) {
  const card = el("div", { class: "card" });
  if (cats.length === 0) {
    card.appendChild(el("div", { class: "empty-state" }, "Sin categorías todavía."));
    return card;
  }
  for (const c of cats) {
    card.appendChild(
      el("div", { class: "list-item", style: "cursor:pointer;", onclick: async () => {
        const cat = await DB.get("categories", c.id);
        openCategoryEditSheet({ existing: cat, onSaved: () => Router.render() });
      } }, [
        el("div", { class: "icon" }, categoryIconNode(c)),
        el("div", { class: "main" }, [el("div", { class: "title" }, c.name)]),
        el("div", {}, "›"),
      ])
    );
  }
  return card;
}

async function openCategoryEditSheet({ existing = null, kind = "expense", onSaved = null } = {}) {
  const data = existing || { name: "", icon: "📦", kind, isDefault: false, autoRule: null };

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  sheet.innerHTML = `
    <div class="sheet-header">
      <h2>${existing ? "Editar categoría" : "Nueva categoría"}</h2>
      <button class="sheet-close" data-close>✕</button>
    </div>
    <div class="form-group">
      <label>Nombre</label>
      <input type="text" id="f-name" value="${escapeHtml(data.name)}" placeholder="Ej. Mascotas">
    </div>
    <div class="form-group">
      <label>Emoji</label>
      <div class="icon-grid" id="f-icon-grid"></div>
      <input type="text" id="f-icon-custom" placeholder="O escribe o pega cualquier emoji" maxlength="4" style="margin-top:8px;">
      <input type="hidden" id="f-icon" value="${data.icon}">
    </div>
    <div class="btn-row mt-8">
      ${existing && !existing.isDefault ? '<button class="btn btn-danger btn-sm" id="f-delete" style="flex:0 0 auto;">Eliminar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

  sheet.querySelector("[data-close]").addEventListener("click", close);

  // Emoji: cuadrícula de sugerencias o uno propio; el elegido queda marcado
  const iconInput = sheet.querySelector("#f-icon");
  const iconCustom = sheet.querySelector("#f-icon-custom");
  const iconGrid = sheet.querySelector("#f-icon-grid");
  const iconChoices = [...new Set([data.icon, ...CATEGORY_ICON_CHOICES].filter(Boolean))];
  const markIcon = () => iconGrid.querySelectorAll(".icon-pick").forEach((b) =>
    b.classList.toggle("on", b.dataset.icon === iconInput.value));
  for (const emoji of iconChoices) {
    const b = el("button", { type: "button", class: "icon-pick", "data-icon": emoji }, emoji);
    b.addEventListener("click", () => { iconInput.value = emoji; iconCustom.value = ""; markIcon(); });
    iconGrid.appendChild(b);
  }
  iconCustom.addEventListener("input", () => {
    const v = iconCustom.value.trim();
    if (v) { iconInput.value = v; markIcon(); }
  });
  markIcon();

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
window.openCategoryEditSheet = openCategoryEditSheet;
