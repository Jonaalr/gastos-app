/**
 * router.js — Router simple basado en hash (#/ruta) + navegación inferior.
 */

const Router = {
  routes: {},
  current: null,

  register(path, renderFn) {
    Router.routes[path] = renderFn;
  },

  async navigate(path) {
    if (!location.hash.slice(1).startsWith(path)) {
      location.hash = path;
      return; // el evento hashchange dispara render()
    }
    await Router.render();
  },

  async render() {
    const hash = location.hash.slice(1) || "/dashboard";
    const [path, queryString] = hash.split("?");
    const params = new URLSearchParams(queryString || "");
    const renderFn = Router.routes[path] || Router.routes["/dashboard"];
    Router.current = path;
    Router.updateNav(path);

    const root = document.getElementById("view-root");
    root.innerHTML = "";
    try {
      await renderFn(root, params);
    } catch (err) {
      console.error(err);
      root.appendChild(el("div", { class: "card" }, `Error al cargar la vista: ${err.message}`));
    }
  },

  updateNav(path) {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.path === path);
    });
  },
};

window.addEventListener("hashchange", Router.render);

window.Router = Router;
