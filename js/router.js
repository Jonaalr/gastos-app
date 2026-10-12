/**
 * router.js — Router simple basado en hash (#/ruta) + navegación inferior.
 */

const Router = {
  routes: {},
  current: null,
  guard: null, // { active, message }: pregunta antes de salir de una pantalla con datos sin guardar
  currentHash: "",

  register(path, renderFn) {
    Router.routes[path] = renderFn;
  },

  async navigate(path) {
    if (location.hash.slice(1) !== path) {
      // Dentro de la misma sección (p. ej. Reportes → Movimientos) no se apila historial:
      // así un solo "atrás" regresa a la sección de donde vienes (Inicio)
      const group = (p) => (typeof navActivePath === "function" ? navActivePath(p) : p);
      const curPath = (location.hash.slice(1) || "/dashboard").split("?")[0];
      if (group(curPath) === group(path.split("?")[0]) && !(Router.guard && Router.guard.active)) {
        history.replaceState(null, "", "#" + path);
        await Router.render();
        return;
      }
      location.hash = path;
      return; // el evento hashchange dispara render()
    }
    await Router.render();
  },

  async render() {
    Router.currentHash = location.hash;
    const hash = location.hash.slice(1) || "/dashboard";
    const [path, queryString] = hash.split("?");
    const params = new URLSearchParams(queryString || "");
    const renderFn = Router.routes[path] || Router.routes["/dashboard"];
    Router.current = path;
    document.body.dataset.route = path;
    Router.syncNavAutoHide(path);
    Router.updateNav(path);

    const root = document.getElementById("view-root");
    // Cada render se arma aparte y solo se muestra si es el último pedido (evita duplicados al cambiar filtros rápido)
    const seq = (Router._seq = (Router._seq || 0) + 1);
    const staging = document.createElement("div");
    try {
      await renderFn(staging, params);
    } catch (err) {
      console.error(err);
      staging.appendChild(el("div", { class: "card" }, `Error al cargar la vista: ${err.message}`));
    }
    if (seq !== Router._seq) return;
    root.innerHTML = "";
    while (staging.firstChild) root.appendChild(staging.firstChild);

    // Ojito para ocultar cifras en la barra superior (excepto barras en columna, p. ej. detalle de persona)
    const topbar = root.querySelector(".topbar");
    if (topbar && path !== "/import" && topbar.style.flexDirection !== "column" && typeof privacyToggleButton === "function") {
      topbar.appendChild(privacyToggleButton());
    }
  },

  /** Secciones donde la barra inferior se oculta al bajar y reaparece al subir */
  syncNavAutoHide(path) {
    const auto = Router.AUTO_HIDE_NAV.includes(path);
    document.body.classList.toggle("nav-hidden", auto);
    Router.lastScrollY = window.scrollY;
  },

  updateNav(path) {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.path === (typeof navActivePath === "function" ? navActivePath(path) : path));
    });
  },
};

// Cambio de pantalla (barra inferior, botón atrás): si hay datos sin guardar, pregunta antes
let revertingHash = false;
window.addEventListener("hashchange", () => {
  if (revertingHash) { revertingHash = false; return; }
  if (Router.guard && Router.guard.active && !window.confirm(Router.guard.message)) {
    revertingHash = true;
    location.hash = Router.currentHash;
    return;
  }
  Router.guard = null;
  Router.render();
});

Router.AUTO_HIDE_NAV = ["/reports", "/transactions", "/budgets", "/accounts", "/debts", "/receivables", "/calendar"];
Router.lastScrollY = 0;
Router.bounceUntil = 0;
window.addEventListener("scroll", () => {
  if (!Router.AUTO_HIDE_NAV.includes(document.body.dataset.route)) return;
  const y = window.scrollY;
  const dy = y - Router.lastScrollY;
  Router.lastScrollY = y;
  // Rebote de iOS al llegar al final: no cuenta como subir, la barra se queda como estaba
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (y > max + 1) { Router.bounceUntil = Date.now() + 700; return; }
  if (Date.now() < (Router.bounceUntil || 0) && y >= max - 80) return;
  if (y < 0) return;
  if (y <= 8) document.body.classList.remove("nav-hidden");
  else if (dy > 4) document.body.classList.add("nav-hidden");
  else if (dy < -4) document.body.classList.remove("nav-hidden");
}, { passive: true });

window.Router = Router;
