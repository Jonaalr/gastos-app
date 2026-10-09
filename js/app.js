/**
 * app.js — Punto de entrada: arma el shell (nav inferior + FAB), registra rutas,
 * siembra datos iniciales y arranca el router.
 */

const NAV_ITEMS = [
  { path: "/dashboard", icon: "home", label: "Inicio" },
  { path: "/accounts", icon: "bank", label: "Dinero" },
  { path: "/reports", icon: "chart", label: "Reportes" },
  { path: "/calendar", icon: "calendar", label: "Pagos" },
  { path: "/settings", icon: "gear", label: "Ajustes" },
];

/** Qué pestaña de la barra se marca para cada pantalla (Dinero y Reportes agrupan varias vistas) */
const NAV_GROUPS = {
  "/accounts": "/accounts",
  "/debts": "/accounts",
  "/receivables": "/accounts",
  "/transactions": "/reports",
  "/reports": "/reports",
  "/budgets": "/reports",
};
function navActivePath(path) {
  return NAV_GROUPS[path] || path;
}

/** Selector de secciones de tres pestañas con icono. `match` lista rutas extra que la encienden */
function sectionTabs(options, activePath) {
  const wrap = el("div", { class: "segmented section-tabs" });
  for (const opt of options) {
    const isActive = opt.match ? opt.match.includes(activePath) : opt.path === activePath;
    const btn = el("button", { type: "button", class: isActive ? "active" : "" }, [
      el("span", { class: "st-icon", html: svgIcon(opt.icon, 18) }),
      el("span", { class: "st-label" }, opt.label),
    ]);
    btn.addEventListener("click", () => { if (!isActive) Router.navigate(opt.path); });
    wrap.appendChild(btn);
  }
  return wrap;
}

/** Filtros tipo chip (Todos | Préstamos | Compartidos, Presupuestos | Metas) */
function filterChips(options, activeId, onPick) {
  return el("div", { class: "filter-row section-chips" }, options.map((o) =>
    el("button", { class: `chip ${o.id === activeId ? "on" : ""}`, "data-filter": o.id, onclick: () => onPick(o.id) }, [
      el("span", { class: "chip-icon", html: svgIcon(o.icon, 14) }),
      el("span", {}, o.label),
    ])
  ));
}

const DINERO_TABS = [
  { path: "/accounts", label: "Cuentas", icon: "bank" },
  { path: "/debts", label: "Deudas", icon: "card" },
  { path: "/receivables", label: "Préstamos", icon: "handshake" },
];
const REPORTES_TABS = [
  { path: "/transactions", label: "Movimientos", icon: "transfer" },
  { path: "/reports", label: "Informes", icon: "chart" },
  { path: "/budgets", label: "Planes", icon: "target", match: ["/budgets"] },
];
const PRESTAMOS_FILTERS = [
  { id: "todos", label: "Todos", icon: "filter" },
  { id: "prestamos", label: "Préstamos", icon: "handshake" },
  { id: "compartidos", label: "Gastos compartidos", icon: "users" },
];
const PLANES_VIEWS = [
  { id: "presupuestos", label: "Presupuestos", icon: "pie" },
  { id: "metas", label: "Metas", icon: "flag" },
];
/** Chips de Planes: Presupuestos | Metas */
function planesChips(activeId) {
  return filterChips(PLANES_VIEWS, activeId, (id) => Router.navigate(id === "metas" ? "/budgets?vista=metas" : "/budgets"));
}

function buildShell() {
  const app = document.getElementById("app");

  const viewRoot = el("div", { id: "view-root" });
  app.appendChild(viewRoot);

  const fab = el("button", { class: "fab", id: "fab-add" }, "+");
  document.body.appendChild(fab);
  fab.addEventListener("click", () => {
    // En Pagos, el + agrega un pago domiciliado (aparece en la lista de Pagos)
    if (document.body.dataset.route === "/calendar") {
      openTransactionSheet({ prefill: { type: "expense", isRecurring: true }, onSaved: () => Router.render() });
      return;
    }
    openAddMenu();
  });

  const nav = el("div", { class: "bottom-nav" });
  for (const item of NAV_ITEMS) {
    const btn = el("button", { class: "nav-item", "data-path": item.path }, [
      el("div", { class: "nav-icon", html: svgIcon(item.icon, 22) }),
      el("div", {}, item.label),
    ]);
    btn.addEventListener("click", () => Router.navigate(item.path));
    nav.appendChild(btn);
  }
  document.body.appendChild(nav);
}

function registerRoutes() {
  Router.register("/dashboard", renderDashboard);
  Router.register("/transactions", renderTransactions);
  Router.register("/accounts", renderAccounts);
  Router.register("/categories", renderCategories);
  Router.register("/budgets", renderBudgets);
  Router.register("/calendar", renderCalendar);
  Router.register("/reports", renderReports);
  Router.register("/settings", renderSettings);
  Router.register("/import", renderImportStatement);
  Router.register("/receivables", renderReceivables);
  Router.register("/account", renderAccountDetail);
  Router.register("/reconcile", renderReconcile);
  Router.register("/debts", renderDebts);
}

async function main() {
  buildShell();
  registerRoutes();
  await seedIfNeeded();
  await capitalizeSavings();

  if ("serviceWorker" in navigator) {
    // Si sale una versión nueva, recarga una sola vez para mostrarla sin que tengas que abrir la app dos veces
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  await Router.render();

  const userName = await DB.getMeta("userName", "");
  if (!userName) {
    setTimeout(promptFirstName, 400);
  }
}

async function promptFirstName() {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  sheet.innerHTML = `
    <div class="sheet-header"><h2>¡Bienvenido!</h2></div>
    <div class="form-group">
      <label>¿Cómo te llamas?</label>
      <input type="text" id="f-firstname" placeholder="Tu nombre">
    </div>
    <button class="btn" id="f-save-name">Empezar</button>
  `;
  sheet.querySelector("#f-save-name").addEventListener("click", async () => {
    const name = sheet.querySelector("#f-firstname").value.trim();
    if (name) await DB.setMeta("userName", name);
    backdrop.remove();
    Router.render();
  });
}

document.addEventListener("DOMContentLoaded", main);
