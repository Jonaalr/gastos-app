/**
 * importers/index.js — Registro de lectores de estados de cuenta y ayudas para categorizar.
 *
 * Para soportar un banco nuevo: crear su lector (como banamex-credit.js) con
 * { id, label, detect(lines), parse(lines) } y agregarlo a `list`.
 */

const StatementImporters = {
  list: [window.BanamexCreditImporter, window.RevolutCreditImporter, window.BbvaCreditImporter],

  /** Devuelve el lector que reconoce estas líneas de texto, o null */
  detect(lines) {
    return StatementImporters.list.find((imp) => imp.detect(lines)) || null;
  },

  // ---- Categorías sugeridas ----
  // Se buscan por NOMBRE de categoría para funcionar con las categorías que ya tengas.
  hints: [
    { category: "Salud", re: /hosp|clinica|farm|far guad|medic|dental|dentis|laborat|psm|consult/i },
    { category: "Súper", re: /abarrotes|mandadito|ranchito|walmart|wal mart|soriana|chedraui|heb |costco|oxxo|7 eleven|modelorama|extra |superama|la comer/i },
    { category: "Restaurantes", re: /\brest\b|restaurante|cafe|taco|pizza|sushi|burger|hamburg|rappi|uber eats|didi food|starbucks/i },
    { category: "Transporte", re: /gas serv|gasolin|pemex|uber|didi|estacionamiento|caseta/i },
    { category: "Servicios", re: /agua de|cfe|telmex|telcel|izzi|totalplay|megacable|internet/i },
    { category: "Entretenimiento", re: /netflix|spotify|disney|hbo|cinepolis|cinemex|padel|xbox|playstation/i },
    { category: "Ropa y calzado", re: /zara|liverpool|palacio de hierro|shein|h&m|nike|adidas/i },
  ],

  /** Clave estable de un comercio para recordar la categoría que elegiste ("Amazon Mexico" -> "amazon mexico") */
  merchantKey(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  },

  /**
   * Sugiere la categoría de un gasto: primero lo que ya elegiste antes para ese comercio,
   * luego las palabras clave de arriba y por último la regla automática de cada categoría.
   */
  suggestCategoryId(description, categories, memory = {}) {
    const key = StatementImporters.merchantKey(description);
    if (key && memory[key] && categories.some((c) => c.id === memory[key])) return memory[key];

    const text = String(description || "");
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const hint of StatementImporters.hints) {
      if (!hint.re.test(norm(text))) continue;
      const cat = categories.find((c) => !c.parentId && norm(c.name).startsWith(norm(hint.category)));
      if (cat) return cat.id;
    }
    for (const cat of categories) {
      if (cat.autoRule && new RegExp(cat.autoRule, "i").test(text)) return cat.id;
    }
    return null;
  },
  /**
   * Compras a meses que se ven en el estado de cuenta: "10 DE 12 MERCADO PAGO ..." significa
   * cuota 10 de 12. Devuelve un plan por comercio con la cuota en la que vas y cuántas faltan.
   */
  installmentsFromMovements(movements) {
    const plans = {};
    for (const m of movements || []) {
      if (m.kind !== "charge") continue;
      const found = /(\d{1,2})\s+DE\s+(\d{1,2})\s+/i.exec(String(m.rawDescription || ""));
      if (!found) continue;
      const current = parseInt(found[1], 10);
      const total = parseInt(found[2], 10);
      if (!(total > 1 && current >= 1 && current <= total)) continue;
      const key = StatementImporters.merchantKey(m.description);
      if (!key) continue;
      if (!plans[key] || current > plans[key].current) {
        plans[key] = { key, name: m.description, current, total, monthlyCents: m.amountCents };
      }
    }
    return Object.values(plans);
  },
};

window.StatementImporters = StatementImporters;
