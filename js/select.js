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
      item.addEventListener("click", () => {
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        closeMenu();
      });
      menu.appendChild(item);
    });
    backdrop.appendChild(menu);
    document.body.appendChild(backdrop);
    openBackdrop = backdrop;

    // Pegado al botón. Se abre hacia el lado con más espacio y la altura se ajusta a ese espacio,
    // así siempre se ve completo y se puede deslizar.
    const r = sel._fsel.btn.getBoundingClientRect();
    const margin = 12;
    const spaceBelow = window.innerHeight - r.bottom - 6 - margin;
    const spaceAbove = r.top - 6 - margin;
    menu.style.width = r.width + "px";
    menu.style.left = r.left + "px";
    if (spaceBelow >= spaceAbove) {
      menu.style.top = r.bottom + 6 + "px";
      menu.style.maxHeight = Math.max(120, spaceBelow) + "px";
    } else {
      menu.style.bottom = window.innerHeight - r.top + 6 + "px";
      menu.style.top = "auto";
      menu.style.maxHeight = Math.max(120, spaceAbove) + "px";
    }
    const current = menu.querySelector(".on");
    if (current) current.scrollIntoView({ block: "nearest" });
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
