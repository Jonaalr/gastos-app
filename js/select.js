/**
 * select.js — Reemplaza los <select> por un botón con un menú flotante (estilo del mockup).
 * El <select> original queda oculto y sigue siendo la fuente del valor: el resto de la app
 * lo lee y escucha su evento "change" como antes.
 */
(function () {
  const SELECTOR = "select";
  let openBackdrop = null;

  const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5-5 5 5M7 14l5 5 5-5"/></svg>';

  function syncLabel(sel) {
    const opt = sel.options[sel.selectedIndex];
    sel._fsel.label.textContent = opt ? opt.text : "";
    sel._fsel.btn.disabled = sel.disabled;
  }

  function enhance(sel) {
    if (sel.dataset.enhanced || !sel.parentNode) return;
    sel.dataset.enhanced = "1";
    sel.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "fsel";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fsel-btn";
    const label = document.createElement("span");
    label.className = "fsel-label";
    const chev = document.createElement("span");
    chev.className = "fsel-chev";
    chev.innerHTML = CHEVRON;
    btn.append(label, chev);
    wrap.appendChild(btn);
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    sel._fsel = { wrap, btn, label };
    btn.addEventListener("click", (e) => { e.preventDefault(); openMenu(sel); });
    sel.addEventListener("change", () => syncLabel(sel));
    new MutationObserver(() => syncLabel(sel)).observe(sel, { childList: true, subtree: true, characterData: true });
    syncLabel(sel);
  }

  function closeMenu() {
    if (openBackdrop) { openBackdrop.remove(); openBackdrop = null; }
  }

  function pick(sel, o) {
    sel.value = o.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    closeMenu();
  }

  /** Mientras el dedo se desliza sobre el menú, la opción bajo el dedo se pinta de verde.
   *  Al soltar se elige esa opción, salvo que el gesto fuera un desplazamiento de la lista. */
  function trackFinger(sel, menu) {
    let hovered = null;
    let startScroll = 0;
    const setHover = (item) => {
      if (item === hovered) return;
      if (hovered) hovered.classList.remove("hover");
      hovered = item;
      if (hovered) hovered.classList.add("hover");
    };
    const itemAt = (touch) => {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const item = el && el.closest ? el.closest(".fsel-item") : null;
      return item && menu.contains(item) ? item : null;
    };
    menu.addEventListener("touchstart", (e) => {
      startScroll = menu.scrollTop;
      setHover(itemAt(e.touches[0]));
    }, { passive: true });
    menu.addEventListener("touchmove", (e) => {
      setHover(itemAt(e.touches[0]));
    }, { passive: true });
    menu.addEventListener("touchend", (e) => {
      const scrolled = Math.abs(menu.scrollTop - startScroll) > 4;
      const target = hovered;
      setHover(null);
      if (target && target._opt && !scrolled) {
        e.preventDefault();
        pick(sel, target._opt);
      }
    });
    menu.addEventListener("touchcancel", () => setHover(null), { passive: true });
  }

  function openMenu(sel) {
    closeMenu();
    const backdrop = document.createElement("div");
    backdrop.className = "fsel-backdrop";
    const menu = document.createElement("div");
    menu.className = "fsel-menu";
    menu.setAttribute("role", "listbox");
    Array.from(sel.options).forEach((o, i) => {
      const on = i === sel.selectedIndex;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "fsel-item" + (on ? " on" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", on ? "true" : "false");
      const text = document.createElement("span");
      text.textContent = o.text;
      item.appendChild(text);
      if (on) {
        const check = document.createElement("span");
        check.className = "fsel-check";
        check.textContent = "✓";
        item.appendChild(check);
      }
      item._opt = o;
      item.addEventListener("click", () => pick(sel, o));
      menu.appendChild(item);
    });
    backdrop.appendChild(menu);
    document.body.appendChild(backdrop);
    openBackdrop = backdrop;
    trackFinger(sel, menu);

    // Menú centrado en la pantalla: nunca queda cortado arriba ni a los lados
    menu.style.width = "";
    // Se desplaza solo el menú (scrollIntoView movía también la página en iPhone)
    const current = menu.querySelector(".on");
    if (current) menu.scrollTop = Math.max(0, current.offsetTop - menu.clientHeight / 2 + current.offsetHeight / 2);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeMenu(); });
  }

  function scan(root) {
    if (root.matches && root.matches(SELECTOR)) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(enhance);
  }

  document.addEventListener("DOMContentLoaded", () => scan(document.body));
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && !n.classList?.contains("fsel") && !n.classList?.contains("fsel-backdrop")) scan(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
