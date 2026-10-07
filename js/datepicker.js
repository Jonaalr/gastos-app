/**
 * datepicker.js — Calendario emergente (popup centrado) para elegir una fecha.
 *
 * Uso:
 *   const iso = await pickDate({ title: "Día de corte", value: "2026-10-15" });
 *   // iso = "2026-10-15" o null si se cerró sin elegir
 */

const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const WEEKDAYS_ES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

function pickDate({ title = "", value = null } = {}) {
  return new Promise((resolve) => {
    const today = DateUtil.todayISO();
    const selected = value || null;
    const start = DateUtil.parseISO(value || today);
    let viewYear = start.getFullYear();
    let viewMonth = start.getMonth();

    const backdrop = el("div", { class: "picker-backdrop" });
    const popup = el("div", { class: "picker-popup" });
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    const finish = (result) => {
      backdrop.remove();
      resolve(result);
    };
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(null);
    });

    function shiftMonth(delta) {
      const d = new Date(viewYear, viewMonth + delta, 1);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      render();
    }

    function render() {
      popup.innerHTML = "";

      if (title) popup.appendChild(el("div", { class: "picker-title" }, title));

      popup.appendChild(
        el("div", { class: "picker-header" }, [
          el("button", { class: "picker-nav", type: "button", "aria-label": "Mes anterior", onclick: () => shiftMonth(-1) }, "‹"),
          el("div", { class: "picker-month" }, `${MONTHS_ES[viewMonth]} ${viewYear}`),
          el("button", { class: "picker-nav", type: "button", "aria-label": "Mes siguiente", onclick: () => shiftMonth(1) }, "›"),
        ])
      );

      popup.appendChild(el("div", { class: "picker-weekdays" }, WEEKDAYS_ES.map((w) => el("div", {}, w))));

      const grid = el("div", { class: "picker-grid" });
      const first = new Date(viewYear, viewMonth, 1);
      const offset = (first.getDay() + 6) % 7; // semana inicia en lunes
      // Siempre 6 filas (42 celdas) para que el popup no cambie de alto al cambiar de mes
      for (let i = 0; i < 42; i++) {
        const d = new Date(viewYear, viewMonth, 1 - offset + i);
        const iso = DateUtil.toISO(d);
        const inMonth = d.getMonth() === viewMonth;
        const cls = ["picker-day"];
        if (!inMonth) cls.push("outside");
        if (iso === today) cls.push("today");
        if (iso === selected) cls.push("selected");
        grid.appendChild(el("button", { class: cls.join(" "), type: "button", onclick: () => finish(iso) }, String(d.getDate())));
      }
      popup.appendChild(grid);

      popup.appendChild(
        el("div", { class: "picker-footer" }, [
          el("button", { class: "picker-link", type: "button", onclick: () => finish(null) }, "Cancelar"),
        ])
      );
    }

    render();
  });
}

window.pickDate = pickDate;
