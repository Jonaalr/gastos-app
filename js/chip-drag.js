/**
 * chip-drag.js — En las filas de filtros, al deslizar el dedo sobre las opciones
 * se van pintando (como un menú desplegable). Al soltar, queda elegida la última pintada.
 * Un toque normal sigue funcionando igual.
 */
(function () {
  const ROW = ".section-chips";
  const OPT = ".chip";
  let start = null;   // opción donde empezó el toque
  let painted = null; // opción pintada por el dedo ahora
  let moved = false;
  let sx = 0, sy = 0; // coordenadas donde empezó el toque

  const optAt = (x, y) => {
    const n = document.elementFromPoint(x, y);
    const o = n && n.closest ? n.closest(OPT) : null;
    return o && o.closest(ROW) === start.closest(ROW) ? o : null;
  };
  const paint = (el) => {
    if (painted === el) return;
    if (painted) painted.classList.remove("drag-on");
    painted = el;
    if (painted) painted.classList.add("drag-on");
  };

  document.addEventListener("touchstart", (e) => {
    const target = e.target && e.target.closest ? e.target.closest(OPT) : null;
    start = target && target.closest(ROW) ? target : null;
    moved = false;
    painted = null;
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
    // Al apretar, la opción se pinta de inmediato (aunque no muevas el dedo)
    if (start) paint(start);
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!start) return;
    const t = e.touches[0];
    if (!moved && Math.hypot(t.clientX - sx, t.clientY - sy) < 6) return;
    moved = true;
    paint(optAt(t.clientX, t.clientY));
  }, { passive: true });

  const finish = (e) => {
    if (!start) return;
    const last = painted;
    paint(null);
    if (moved && last && last !== start) {
      // Eligió la opción que quedó pintada; evita el clic normal de la liberación
      e.preventDefault();
      last.click();
    }
    start = null;
    moved = false;
  };
  document.addEventListener("touchend", finish, { passive: false });
  document.addEventListener("touchcancel", () => { paint(null); start = null; moved = false; });
})();
