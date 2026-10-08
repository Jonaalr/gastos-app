/**
 * sheet-gestures.js — Hojas que se cierran arrastrando hacia abajo (estilo iOS).
 *
 * Se aplica automáticamente a cualquier hoja (.sheet-backdrop) que se agregue a la página.
 * - Arrastrar desde la barra superior o el encabezado de la hoja.
 * - Se cierra si la sueltas más abajo de 120 px o con un movimiento rápido hacia abajo.
 * - Si no, regresa con un rebote suave.
 * - Si la tocas mientras aún se mueve, la animación se interrumpe en ese punto.
 */
(function () {
  const CLOSE_DISTANCE = 120; // px
  const CLOSE_VELOCITY = 0.6; // px por milisegundo
  const GRAB_ZONE = 44; // px desde arriba de la hoja donde se puede arrastrar
  const SPRING = "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1)";

  function currentOffset(sheet) {
    const t = getComputedStyle(sheet).transform;
    if (!t || t === "none") return 0;
    try {
      return new DOMMatrixReadOnly(t).m42 || 0;
    } catch (e) {
      return 0;
    }
  }

  function attach(backdrop) {
    const sheet = backdrop.querySelector(".sheet");
    if (!sheet || sheet.dataset.gesture) return;
    sheet.dataset.gesture = "1";

    let dragging = false;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let offset = 0;

    sheet.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const rect = sheet.getBoundingClientRect();
      const inGrabZone = e.clientY - rect.top < GRAB_ZONE;
      const inHeader = e.target.closest && e.target.closest(".sheet-header");
      if (!inGrabZone && !inHeader) return;

      // Interrumpe cualquier animación en curso desde la posición actual
      offset = currentOffset(sheet);
      sheet.style.animation = "none";
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${offset}px)`;
      backdrop.style.transition = "none";

      dragging = true;
      startY = e.clientY;
      lastY = e.clientY;
      lastT = performance.now();
      velocity = 0;
      try {
        sheet.setPointerCapture(e.pointerId);
      } catch (err) {
        /* algunos navegadores no soportan captura: no pasa nada */
      }
    });

    sheet.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const now = performance.now();
      const raw = e.clientY - startY + offset;
      // Hacia abajo se sigue el dedo; hacia arriba se resiste (efecto de goma)
      const dy = raw > 0 ? raw : raw * 0.25;
      const dt = now - lastT;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = now;
      sheet.style.transform = `translateY(${dy}px)`;
      backdrop.style.background = `rgba(0, 0, 0, ${Math.max(0, 0.5 - dy / 700)})`;
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      const dy = currentOffset(sheet);
      const shouldClose = dy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY;
      if (shouldClose) {
        sheet.style.transition = "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)";
        sheet.style.transform = "translateY(100%)";
        backdrop.style.transition = "background 0.28s";
        backdrop.style.background = "rgba(0, 0, 0, 0)";
        setTimeout(() => backdrop.remove(), 280);
      } else {
        sheet.style.transition = SPRING;
        sheet.style.transform = "translateY(0)";
        backdrop.style.transition = "background 0.45s";
        backdrop.style.background = "";
      }
    };
    sheet.addEventListener("pointerup", finish);
    sheet.addEventListener("pointercancel", finish);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.classList.contains("sheet-backdrop")) {
          // Espera al siguiente turno por si el contenido de la hoja se llena después
          setTimeout(() => attach(node), 0);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true });
})();
