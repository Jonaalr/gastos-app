/**
 * app.js — Punto de entrada: arma el shell (nav inferior + FAB), registra rutas,
 * siembra datos iniciales y arranca el router.
 */

const NAV_ITEMS = [
  { path: "/dashboard", icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>", label: "Inicio' },
  { path: "/transactions", icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>", label: "Movs' },
  { path: "/budgets", icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 12 12 3"/><path d="M12 12l6.4 3.7"/></svg>", label: "Presup.' },
  { path: "/calendar", icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>", label: "Pagos' },
  { path: "/reports", icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>", label: "Reportes' },
  { path: "/settings", icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>", label: "Ajustes' },
];

function buildShell() {
  const app = document.getElementById("app");

  const viewRoot = el("div", { id: "view-root" });
  app.appendChild(viewRoot);

  const fab = el("button", { class: "fab", id: "fab-add" }, "+");
  document.body.appendChild(fab);
  fab.addEventListener("click", () => {
    openTransactionSheet({ onSaved: () => Router.render() });
  });

  const nav = el("div", { class: "bottom-nav" });
  for (const item of NAV_ITEMS) {
    const btn = el("button", { class: "nav-item", "data-path": item.path }, [
      el("div", { class: "nav-icon", html: item.icon }),
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
    <div class="sheet-header"><h2>¡Bienvenido! 👋</h2></div>
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
