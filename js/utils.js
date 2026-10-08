/**
 * utils.js — Formateo de dinero, fechas y helpers varios
 */

const Money = {
  /** true = las cifras se muestran como •••• (preferencia guardada en este dispositivo) */
  hidden: false,
  /** 16000 (centavos) -> "$160.00" */
  format(cents) {
    if (Money.hidden) return "••••";
    const value = (cents || 0) / 100;
    return value.toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN",
    });
  },
  /** "160.50" o 160.5 -> 16050 (centavos, redondeado) */
  toCents(value) {
    const n = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
    if (isNaN(n)) return 0;
    return Math.round(n * 100);
  },
  /** 16000 -> "160.00" (para inputs) */
  toInputValue(cents) {
    return ((cents || 0) / 100).toFixed(2);
  },
};

const DateUtil = {
  /** Date -> "YYYY-MM-DD" usando la fecha LOCAL (toISOString usa UTC y adelanta el día por las tardes) */
  toISO(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  /** "YYYY-MM-DD" -> Date a medianoche local (new Date("YYYY-MM-DD") lo interpreta en UTC) */
  parseISO(iso) {
    return new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  },
  todayISO() {
    return DateUtil.toISO(new Date());
  },
  monthKey(date = new Date()) {
    const d = typeof date === "string" ? DateUtil.parseISO(date) : date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  },
  /** "Hoy", "Ayer" o "3 de octubre" */
  relativeLabel(isoDate) {
    const today = DateUtil.todayISO();
    const diff = DateUtil.daysBetween(isoDate, today);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Ayer";
    return DateUtil.parseISO(isoDate).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  },
  /** "15 oct 2026" */
  formatMedium(isoDate) {
    return DateUtil.parseISO(isoDate).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "");
  },
  formatLong(isoDate) {
    const d = new Date(isoDate + (isoDate.length <= 10 ? "T00:00:00" : ""));
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  },
  formatShort(isoDate) {
    const d = new Date(isoDate + (isoDate.length <= 10 ? "T00:00:00" : ""));
    return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  },
  /** Dado un día de corte/pago (1-31) y una fecha base, regresa la próxima ocurrencia ISO */
  nextOccurrence(day, fromDate = new Date()) {
    const d = new Date(fromDate);
    d.setHours(0, 0, 0, 0); // si el pago es hoy, debe seguir contando como "Hoy"
    const year = d.getFullYear();
    const month = d.getMonth();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.min(day, lastDayOfMonth);
    let candidate = new Date(year, month, safeDay);
    if (candidate < d) {
      const lastDayNextMonth = new Date(year, month + 2, 0).getDate();
      candidate = new Date(year, month + 1, Math.min(day, lastDayNextMonth));
    }
    return DateUtil.toISO(candidate);
  },
  daysBetween(isoA, isoB) {
    const a = new Date(isoA + "T00:00:00");
    const b = new Date(isoB + "T00:00:00");
    return Math.round((b - a) / 86400000);
  },
  daysInMonth(year, monthIndex0) {
    return new Date(year, monthIndex0 + 1, 0).getDate();
  },
};

/** Tu parte de un movimiento: en gastos entre varios es tu porción; si no, el total */
function myShareCents(t) {
  if (!t) return 0;
  if (t.type !== "expense") return t.amountCents;
  return t.split ? t.split.myShareCents : t.amountCents;
}

/** Reparte un total en n partes iguales; los centavos sobrantes van a las primeras */
function splitEvenly(totalCents, n) {
  const base = Math.floor(totalCents / n);
  const rem = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Lee la preferencia de ocultar cifras (conveniencia por dispositivo; si el navegador la bloquea, se ignora) */
function loadPrivacyPref() {
  try {
    Money.hidden = localStorage.getItem("ocultarCifras") === "1";
  } catch (e) {
    Money.hidden = false;
  }
}
loadPrivacyPref();

function setPrivacyPref(hidden) {
  Money.hidden = hidden;
  try {
    localStorage.setItem("ocultarCifras", hidden ? "1" : "0");
  } catch (e) {
    /* sin almacenamiento: solo dura esta sesión */
  }
}

/** Botón de ojito para mostrar u ocultar todas las cifras */
function privacyToggleButton() {
  return el(
    "button",
    {
      class: "privacy-btn",
      type: "button",
      title: Money.hidden ? "Mostrar cifras" : "Ocultar cifras",
      "aria-label": Money.hidden ? "Mostrar cifras" : "Ocultar cifras",
      onclick: () => {
        setPrivacyPref(!Money.hidden);
        Router.render();
      },
    },
    Money.hidden ? "🙈" : "👁️"
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const node = el("div", { class: `toast toast-${type}` }, message);
  container.appendChild(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 250);
  }, 3000);
}

window.Money = Money;
window.privacyToggleButton = privacyToggleButton;
window.DateUtil = DateUtil;
window.uid = uid;
window.myShareCents = myShareCents;
window.splitEvenly = splitEvenly;
window.escapeHtml = escapeHtml;
window.el = el;
window.toast = toast;
