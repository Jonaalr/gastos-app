/**
 * seed.js — Datos iniciales (categorías predeterminadas).
 * Se insertan una sola vez, en la primera ejecución de la app.
 */

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Súper", icon: "🛒", autoRule: "oxxo|walmart|soriana|chedraui|heb|costco|superama|la comer" },
  { name: "Restaurantes", icon: "🍽️", autoRule: "rest|rappi|uber eats|didi food" },
  { name: "Transporte", icon: "🚗", autoRule: "uber|didi|gasolin|pemex|shell|mobil|estacionamiento" },
  { name: "Servicios", icon: "💡", autoRule: "cfe|telmex|totalplay|izzi|megacable|att|telcel|movistar" },
  { name: "Renta / Hogar", icon: "🏠", autoRule: "renta|hipoteca" },
  { name: "Salud", icon: "💊", autoRule: "farmacia|similares|guadalajara|hospital|doctor" },
  { name: "Entretenimiento", icon: "🎬", autoRule: "netflix|spotify|disney|hbo|cinepolis|cinemex" },
  { name: "Ropa y calzado", icon: "👕", autoRule: "zara|liverpool|palacio|shein" },
  { name: "Educación", icon: "📚", autoRule: null },
  { name: "Tarjeta de crédito (pago)", icon: "💳", autoRule: null },
  { name: "Otros gastos", icon: "📦", autoRule: null },
];

const DEFAULT_INCOME_CATEGORIES = [
  { name: "Sueldo", icon: "💼", autoRule: null },
  { name: "Rendimientos", icon: "📈", autoRule: null },
  { name: "Otros ingresos", icon: "➕", autoRule: null },
];

async function seedIfNeeded() {
  const already = await DB.getMeta("seeded", false);
  if (already) return;

  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    await DB.add("categories", {
      name: c.name,
      parentId: null,
      kind: "expense",
      icon: c.icon,
      isDefault: true,
      autoRule: c.autoRule,
    });
  }
  for (const c of DEFAULT_INCOME_CATEGORIES) {
    await DB.add("categories", {
      name: c.name,
      parentId: null,
      kind: "income",
      icon: c.icon,
      isDefault: true,
      autoRule: c.autoRule,
    });
  }

  await DB.setMeta("seeded", true);
}

/** Dado un texto de comercio, sugiere categoría según autoRule (regex simple) */
async function suggestCategory(merchantText, kind = "expense") {
  if (!merchantText) return null;
  const categories = await DB.getAllByIndex("categories", "kind", kind);
  const text = merchantText.toLowerCase();
  for (const cat of categories) {
    if (!cat.autoRule) continue;
    const re = new RegExp(cat.autoRule, "i");
    if (re.test(text)) return cat.id;
  }
  return null;
}

window.seedIfNeeded = seedIfNeeded;
window.suggestCategory = suggestCategory;
