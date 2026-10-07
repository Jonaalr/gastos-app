/**
 * utils.js — Formateo de dinero, fechas y helpers varios
 */

const Money = {
  /** 16000 (centavos) -> "$160.00" */
  format(cents) {
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
  todayISO() {
    return new Date().toISOString().slice(0, 10);
  },
  monthKey(date = new Date()) {
    const d = typeof date === "string" ? new Date(date) : date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    const year = d.getFullYear();
    const month = d.getMonth();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.min(day, lastDayOfMonth);
    let candidate = new Date(year, month, safeDay);
    if (candidate < d) {
      const lastDayNextMonth = new Date(year, month + 2, 0).getDate();
      candidate = new Date(year, month + 1, Math.min(day, lastDayNextMonth));
    }
    return candidate.toISOString().slice(0, 10);
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
window.DateUtil = DateUtil;
window.uid = uid;
window.el = el;
window.toast = toast;
