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
  "/statements": "/settings",
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

/** Filtros tipo chip (Todos | Préstamos | Compartidos) */
function filterChips(options, activeId, onPick) {
  return el("div", { class: "filter-row section-chips" }, options.map((o) => iconChip(o.icon, o.label, o.id === activeId, () => onPick(o.id))));
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
/** Chips de Planes: Presupuestos | Metas, del mismo tamaño */
function planesChips(activeId) {
  return el("div", { class: "filter-row section-chips chips-equal" }, PLANES_VIEWS.map((o) =>
    iconChip(o.icon, o.label, o.id === activeId, () => Router.navigate(o.id === "metas" ? "/budgets?vista=metas" : "/budgets"))
  ));
}

const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function monthLabelES(k) {
  const [y, m] = k.split("-").map(Number);
  return `${MESES_ES[m - 1]} ${y}`;
}
/** Texto del chip de periodo: mes, rango o todo el historial. p = { monthKey, from, to, todo } */
function periodLabelFor(p) {
  if (p.todo) return "Todo el historial";
  if (p.from || p.to) return `${p.from ? DateUtil.formatShort(p.from) : "…"} – ${p.to ? DateUtil.formatShort(p.to) : "…"}`;
  return monthLabelES(p.monthKey);
}
function chipBtn(label, on, onPick) {
  return el("button", { class: `chip${on ? " on" : ""}`, type: "button", onclick: onPick }, label);
}
function filterOpt(label, on, onPick) {
  return el("button", { class: `filter-opt${on ? " on" : ""}`, type: "button", onclick: onPick }, [
    el("span", {}, label),
    el("span", {}, on ? "✓" : ""),
  ]);
}
function openFilterSheet(title, nodes) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" }, [el("div", { class: "sheet-header" }, [el("h2", {}, title)]), ...nodes]);
  backdrop.appendChild(sheet);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  return backdrop;
}
/** Hoja de Periodo: Mes (lista de meses) o Rango de fechas. go(cambios) aplica el filtro */
function openPeriodSheet(p, go) {
  let mode = p.from || p.to ? "rango" : "mes";
  const body = el("div", {});
  const backdrop = openFilterSheet("Periodo", [body]);
  const close = () => backdrop.remove();
  const draw = () => {
    body.innerHTML = "";
    body.appendChild(el("div", { class: "segmented", style: "margin-bottom:10px;" }, [
      el("button", { class: mode === "mes" ? "active" : "", type: "button", onclick: () => { mode = "mes"; draw(); } }, "Mes"),
      el("button", { class: mode === "rango" ? "active" : "", type: "button", onclick: () => { mode = "rango"; draw(); } }, "Rango de fechas"),
    ]));
    if (mode === "mes") {
      body.appendChild(filterOpt("Todo el historial", !!p.todo, () => { close(); go({ todo: "1", month: "", from: "", to: "" }); }));
      const now = new Date();
      const keys = [];
      for (let i = 0; i < 24; i++) keys.push(DateUtil.monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
      if (!keys.includes(p.monthKey)) keys.unshift(p.monthKey);
      for (const k of keys) {
        const on = !p.todo && !p.from && !p.to && k === p.monthKey;
        body.appendChild(filterOpt(monthLabelES(k), on, () => { close(); go({ month: k, from: "", to: "", todo: "" }); }));
      }
    } else {
      let f = p.from || "";
      let t = p.to || "";
      body.appendChild(el("div", { style: "margin-bottom:8px;" }, [
        el("label", { class: "muted", style: "font-size:12px;" }, "Desde"),
        el("input", { type: "date", value: f, style: "width:100%;", onchange: (e) => { f = e.target.value; } }),
      ]));
      body.appendChild(el("div", { style: "margin-bottom:8px;" }, [
        el("label", { class: "muted", style: "font-size:12px;" }, "Hasta"),
        el("input", { type: "date", value: t, style: "width:100%;", onchange: (e) => { t = e.target.value; } }),
      ]));
      body.appendChild(el("button", { class: "btn", type: "button", onclick: () => { close(); go({ from: f, to: t, month: "", todo: "" }); } }, "Aplicar"));
    }
  };
  draw();
}
/** Hoja de Categoría (incluye Sin categoría) */
function openCategorySheet(categories, catF, go) {
  const backdrop = openFilterSheet("Categoría", [
    filterOpt("Todas las categorías", !catF, () => { backdrop.remove(); go({ cat: "" }); }),
    filterOpt("Sin categoría", catF === "none", () => { backdrop.remove(); go({ cat: "none" }); }),
    ...categories
      .filter((c) => c.kind === "expense" || c.kind === "income")
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((c) => filterOpt(categoryLabel(c), catF === String(c.id), () => { backdrop.remove(); go({ cat: String(c.id) }); })),
  ]);
}
/** Hoja de Cuenta */
function openAccountSheet(accounts, accF, go) {
  const backdrop = openFilterSheet("Cuenta", [
    filterOpt("Todas las cuentas", !accF, () => { backdrop.remove(); go({ acc: "" }); }),
    ...accounts
      .filter((a) => !a.archived)
      .sort(accountPickerCompare)
      .map((a) => filterOpt(accountPickerLabel(a), accF === String(a.id), () => { backdrop.remove(); go({ acc: String(a.id) }); })),
  ]);
}
/** Chip desplegable: muestra el filtro activo; al tocarlo se despliegan los demás (con icono) */
function expandableFilter(options, activeId, open, onToggle, onPick) {
  const cur = options.find((o) => o.id === activeId) || options[0];
  const nodes = [
    el("button", { class: "chip on", type: "button", "data-filter": cur.id, "aria-expanded": open ? "true" : "false", onclick: onToggle }, [
      el("span", { class: "chip-icon", html: svgIcon(cur.icon, 14) }),
      el("span", {}, `${cur.label} ${open ? "▴" : "▾"}`),
    ]),
  ];
  if (open) {
    for (const o of options) {
      if (o.id === cur.id) continue;
      nodes.push(el("button", { class: "chip", type: "button", "data-filter": o.id, onclick: () => onPick(o.id) }, [
        el("span", { class: "chip-icon", html: svgIcon(o.icon, 14) }),
        el("span", {}, o.label),
      ]));
    }
  }
  return el("div", { class: "filter-row section-chips" }, nodes);
}
/** Chip con icono (filtros de Movimientos, Informes y Planes) */
function iconChip(icon, label, on, onPick) {
  return el("button", { class: `chip${on ? " on" : ""}`, type: "button", onclick: onPick }, [
    el("span", { class: "chip-icon", html: svgIcon(icon, 14) }),
    el("span", {}, label),
  ]);
}
/** Panel de filtros: un botón "Filtros" que despliega la fila con Mes, Categoría y Cuenta */
function filtersPanel({ open, count, onToggle, items }) {
  const label = `Filtros${count ? ` · ${count}` : ""} ${open ? "▴" : "▾"}`;
  const toggle = iconChip("filter", label, open || count > 0, onToggle);
  const nodes = [el("div", { class: "filter-row section-chips" }, [toggle])];
  if (open) nodes.push(el("div", { class: "filter-row section-chips" }, items));
  return nodes;
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
  Router.register("/statements", renderStatements);
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
