/**
 * app.js — Punto de entrada: arma el shell (nav inferior + FAB), registra rutas,
 * siembra datos iniciales y arranca el router.
 */

const NAV_ITEMS = [
  { path: "/dashboard", icon: "home", label: "Inicio" },
  { path: "/accounts", icon: "bank", label: "Dinero" },
  { path: "/budgets", icon: "pie", label: "Presup." },
  { path: "/calendar", icon: "calendar", label: "Pagos" },
  { path: "/settings", icon: "gear", label: "Ajustes" },
];

/** Qué pestaña de la barra se marca para cada pantalla (Dinero y Presupuestos agrupan dos vistas) */
const NAV_GROUPS = {
  "/accounts": "/accounts",
  "/transactions": "/accounts",
  "/budgets": "/budgets",
  "/reports": "/budgets",
  "/debts": "/budgets",
};
function navActivePath(path) {
  return NAV_GROUPS[path] || path;
}

/** Selector de vistas dentro de una sección (Dinero: Cuentas | Movimientos; Presupuestos: Presupuestos | Reportes) */
function sectionTabs(options, activePath) {
  const wrap = el("div", { class: "segmented section-tabs" });
  for (const opt of options) {
    const btn = el("button", { type: "button", class: opt.path === activePath ? "active" : "" }, opt.label);
    btn.addEventListener("click", () => { if (opt.path !== activePath) Router.navigate(opt.path); });
    wrap.appendChild(btn);
  }
  return wrap;
}
const DINERO_TABS = [
  { path: "/accounts", label: "Cuentas" },
  { path: "/transactions", label: "Movimientos" },
];
const PRESUPUESTO_TABS = [
  { path: "/budgets", label: "Presupuestos" },
  { path: "/reports", label: "Reportes" },
  { path: "/debts", label: "Deudas" },
];

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
