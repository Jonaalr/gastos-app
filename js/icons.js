/**
 * icons.js — Iconos de línea (SVG) para toda la app, en lugar de emojis.
 * svgIcon(nombre) devuelve el SVG como texto; iconNode(nombre) devuelve un nodo listo para insertar.
 */

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  bank: '<path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 7H7"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2 1-3 4-3 8h3"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v2M20 16v2"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  bag: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  transfer: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>',
  handshake: '<path d="M8 12l3 3 5-5M3 9l4-4 5 3 4-3 5 4-6 7-3-2-3 2z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  filter: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
  trend: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75M22 21v-2a4 4 0 0 0-3-3.87"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
};

function svgIcon(name, size = 22) {
  const path = ICON_PATHS[name] || ICON_PATHS.tag;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function iconNode(name, cls = "ico", size = 20) {
  const span = document.createElement("span");
  span.className = cls;
  span.innerHTML = svgIcon(name, size);
  return span;
}

/** Icono de categoría según su nombre (las categorías guardadas pueden traer un emoji viejo) */
function categoryIconName(cat) {
  const n = ((cat && cat.name) || "").toLowerCase();
  if (/súper|super|mercado|oxxo|abarrote|tienda/.test(n)) return "cart";
  if (/restaurant|comida|café|cafe|bar/.test(n)) return "food";
  if (/transporte|gasolin|uber|auto|estacion/.test(n)) return "car";
  if (/servicio|luz|agua|internet|tel[eé]fono|celular|suscrip/.test(n)) return "bolt";
  if (/renta|hogar|casa|hipoteca/.test(n)) return "home";
  if (/ropa|compra|shopping/.test(n)) return "bag";
  if (/nómina|nomina|ingreso|salario/.test(n)) return "banknote";
  return "tag";
}
/** Icono de categoría: el emoji que elegiste; si no tiene, el icono de línea por nombre */
function categoryIconNode(cat, cls = "ico") {
  if (cat && cat.icon) return el("span", { class: "cat-emoji" }, cat.icon);
  return iconNode(categoryIconName(cat), cls, 20);
}

/** Texto para menús: "🛒 Súper" */
function categoryLabel(cat) {
  return cat.icon ? `${cat.icon} ${cat.name}` : cat.name;
}

const CATEGORY_ICON_CHOICES = [
  "🛒", "🍽️", "🚗", "💡", "🏠", "💊", "🎬", "👕", "📚", "💳", "📦", "💼",
  "📈", "➕", "🐶", "✈️", "🎁", "💇", "🏋️", "☕", "🍺", "🎮", "📱", "🛠️",
  "🧾", "🎓", "🚌", "⛽", "🌱", "🧸", "🎵", "💰",
];
