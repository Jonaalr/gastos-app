/**
 * quick-add.js — Registro rápido de un gasto.
 *
 * El botón + abre esta hoja: monto con teclado propio, tus comercios frecuentes como botones,
 * y la cuenta y categoría ya sugeridas según tu historial. Un gasto habitual queda en
 * monto -> comercio -> Guardar. Lo demás (reparto, nota, domiciliado) vive en "Más opciones".
 *
 * También se usa como confirmación corta de una captura o un dictado.
 */

function qaNorm(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuentas desde las que se puede pagar un gasto (mismo criterio que el formulario completo) */
function expenseAccounts(accounts) {
  return accounts.filter((a) => !a.archived && (a.type !== "savings" || a.spendable)).sort(accountPickerCompare);
}

/**
 * Hábitos de gasto a partir del historial (últimos 180 días):
 *  - list: comercios ordenados por frecuencia y recencia, con su cuenta y categoría habituales
 *  - find(texto): el comercio del historial que corresponde a un texto (exacto o por inicio)
 *  - lastAccountId: la cuenta del último gasto que registraste tú (no importado)
 */
async function loadSpendingHabits() {
  const txs = await DB.getAll("transactions");
  const today = DateUtil.todayISO();
  const map = new Map();
  let lastAccountId = null;
  let lastStamp = "";
  for (const t of txs) {
    if (t.type !== "expense") continue;
    const manual = t.balanceApplied !== false;
    if (manual && !t.isRecurring && (t.createdAt || "") > lastStamp) {
      lastStamp = t.createdAt || "";
      lastAccountId = t.accountId;
    }
    const name = (t.merchant || "").trim();
    if (!name || t.isRecurring || t.cycleId || !t.date) continue;
    const days = DateUtil.daysBetween(t.date.slice(0, 10), today);
    if (days > 180 || days < -1) continue;
    const key = qaNorm(name);
    if (!key) continue;
    let e = map.get(key);
    if (!e) {
      e = { key, name, score: 0, count: 0, stamp: "", accountId: null, cats: new Map() };
      map.set(key, e);
    }
    e.count += 1;
    e.score += (manual ? 2 : 1) / (1 + Math.max(0, days) / 30);
    const stamp = t.date + (t.createdAt || "");
    if (stamp > e.stamp) {
      e.stamp = stamp;
      e.name = name;
      e.accountId = t.accountId;
    }
    if (t.categoryId) e.cats.set(t.categoryId, (e.cats.get(t.categoryId) || 0) + 1);
  }
  const list = [...map.values()].sort((a, b) => b.score - a.score);
  for (const e of list) {
    e.categoryId = [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  function find(text) {
    const k = qaNorm(text);
    if (!k) return null;
    if (map.has(k)) return map.get(k);
    if (k.length < 3) return null;
    // "oxxo centro" -> "oxxo", o lo que llevas escrito -> el comercio que empieza igual
    return list.find((e) => e.key.length >= 3 && (k.startsWith(e.key) || e.key.startsWith(k))) || null;
  }
  return { list, find, lastAccountId };
}

/** Categoría sugerida para un comercio: primero tu historial, luego las reglas de la categoría */
async function suggestCategoryFor(merchant, habits, kind = "expense") {
  const hit = kind === "expense" && habits ? habits.find(merchant) : null;
  if (hit && hit.categoryId) return hit.categoryId;
  return suggestCategory(merchant, kind);
}

/** Mientras el teclado del iPhone está abierto, sube la hoja para que no la tape */
function liftSheetAboveKeyboard(backdrop, sheet) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const fit = () => {
    const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
    const open = covered > 80;
    backdrop.style.paddingBottom = open ? `${covered}px` : "";
    sheet.style.maxHeight = open ? `${Math.round(vv.height - 8)}px` : "";
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  return () => {
    vv.removeEventListener("resize", fit);
    vv.removeEventListener("scroll", fit);
  };
}

/**
 * Abre el registro rápido.
 * prefill: { amountCents, merchant, date, accountId, categoryId, source, notice } (captura o dictado)
 */
async function openQuickAdd({ prefill = null, onSaved = null } = {}) {
  const allAccounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
  const accounts = expenseAccounts(allAccounts);
  if (accounts.length === 0) {
    toast("Primero crea una cuenta en Dinero → Cuentas", "error");
    return;
  }
  const [habits, categories] = await Promise.all([loadSpendingHabits(), DB.getAllByIndex("categories", "kind", "expense")]);
  const validAccount = (id) => (accounts.some((a) => a.id === id) ? id : null);

  const today = DateUtil.todayISO();
  const state = {
    amount: "",
    date: (prefill?.date || today).slice(0, 10),
    // Si la captura reconoció el banco, esa cuenta manda; si no, se sugiere por historial
    accountTouched: !!validAccount(prefill?.accountId),
    categoryTouched: !!prefill?.categoryId,
  };
  if (prefill?.amountCents) {
    state.amount = (prefill.amountCents / 100).toFixed(2).replace(/\.00$/, "");
  }

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet qa-sheet" });
  backdrop.appendChild(sheet);
  const unlift = liftSheetAboveKeyboard(backdrop, sheet);
  const close = () => {
    unlift();
    backdrop.remove();
  };
  // Solo se cierra si el toque empezó y terminó fuera de la hoja (la hoja cambia de alto al escribir)
  let downOutside = false;
  backdrop.addEventListener("pointerdown", (e) => { downOutside = e.target === backdrop; });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && downOutside) close();
  });

  const dayISO = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return DateUtil.toISO(d);
  };
  const dateChoices = [
    [dayISO(0), "Hoy"],
    [dayISO(1), "Ayer"],
    [dayISO(2), "Antier"],
  ];
  if (!dateChoices.some(([iso]) => iso === state.date)) dateChoices.unshift([state.date, DateUtil.formatShort(state.date)]);

  sheet.innerHTML = `
    <div class="sheet-header qa-header">
      <h2>Nuevo gasto</h2>
      <div class="qa-tools">
        <button type="button" class="qa-tool" id="qa-capture">${svgIcon("camera", 16)}<span>Capturas</span></button>
        <button type="button" class="qa-tool" id="qa-voice">${svgIcon("mic", 16)}<span>Dictar</span></button>
        <button type="button" class="sheet-close" id="qa-close" aria-label="Cerrar">✕</button>
      </div>
    </div>
    ${prefill?.notice ? `<div class="capture-notice">${escapeHtml(prefill.notice)}</div>` : ""}

    <div class="segmented qa-type">
      <button type="button" class="active" data-type="expense">Gasto</button>
      <button type="button" data-type="income">Ingreso</button>
      <button type="button" data-type="transfer">Transferencia</button>
    </div>

    <div class="qa-amount" id="qa-amount" aria-live="polite"><span class="qa-cur">$</span><span id="qa-amount-val">0</span></div>

    <div class="qa-where">
      <input type="text" id="qa-merchant" placeholder="¿En dónde? Ej. Oxxo" autocomplete="off" autocapitalize="words" value="${escapeHtml(prefill?.merchant || "")}">
      <div class="qa-date"><select id="qa-date" aria-label="Fecha">
        ${dateChoices.map(([iso, label]) => `<option value="${iso}" ${iso === state.date ? "selected" : ""}>${label}</option>`).join("")}
        <option value="__other__">Otra fecha…</option>
      </select></div>
    </div>
    <div class="qa-chips" id="qa-chips"></div>

    <div class="qa-fields">
      <div class="form-group">
        <label>Cuenta</label>
        <select id="qa-account">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountPickerLabel(a))}</option>`).join("")}</select>
      </div>
      <div class="form-group">
        <label>Categoría</label>
        <select id="qa-category"><option value="">Sin categoría</option>${categories.map((c) => `<option value="${c.id}">${escapeHtml(categoryLabel(c))}</option>`).join("")}</select>
      </div>
    </div>

    <div class="qa-keypad" id="qa-keypad">
      ${["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"]
        .map((k) => `<button type="button" class="qa-key" data-key="${k}" ${k === "back" ? 'aria-label="Borrar"' : ""}>${k === "back" ? svgIcon("backspace", 22) : k}</button>`)
        .join("")}
    </div>

    <div class="btn-row qa-actions sheet-actions">
      <button type="button" class="btn btn-secondary" id="qa-more">Más opciones</button>
      <button type="button" class="btn" id="qa-save">Guardar</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const $ = (sel) => sheet.querySelector(sel);
  const accSel = $("#qa-account");
  const catSel = $("#qa-category");
  const merchantInput = $("#qa-merchant");
  const setSelect = (sel, value) => {
    if (value === null || value === undefined || ![...sel.options].some((o) => o.value === String(value))) return false;
    sel.value = String(value);
    sel.dispatchEvent(new Event("change", { bubbles: true })); // refresca el botón del menú
    return true;
  };

  // ---------- Monto ----------
  const amountCents = () => Money.toCents(state.amount || "0");
  function drawAmount() {
    const [int, dec] = state.amount.split(".");
    const intText = (int || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    $("#qa-amount-val").textContent = state.amount.includes(".") ? `${intText}.${dec || ""}` : intText;
    $("#qa-amount").classList.toggle("empty", !state.amount);
  }
  function pressKey(k) {
    let a = state.amount;
    if (k === "back") a = a.slice(0, -1);
    else if (k === ".") {
      if (!a.includes(".")) a = (a || "0") + ".";
    } else if (a.includes(".")) {
      if (a.split(".")[1].length < 2) a += k;
    } else if (a === "0") a = k;
    else if (a.length < 7) a += k;
    state.amount = a;
    drawAmount();
  }
  sheet.querySelectorAll(".qa-key").forEach((btn) => btn.addEventListener("click", () => pressKey(btn.dataset.key)));
  // Tocar el monto regresa al teclado de números (cierra el teclado de letras)
  $("#qa-amount").addEventListener("click", () => merchantInput.blur());
  drawAmount();

  // ---------- Sugerencias por historial ----------
  let applying = false;
  async function applyHabit(text) {
    const hit = habits.find(text);
    applying = true;
    if (hit && !state.accountTouched) setSelect(accSel, validAccount(hit.accountId));
    if (!state.categoryTouched) {
      const catId = await suggestCategoryFor(text, habits);
      if (catId) setSelect(catSel, catId);
    }
    applying = false;
  }
  accSel.addEventListener("change", () => { if (!applying) state.accountTouched = true; });
  catSel.addEventListener("change", () => { if (!applying) state.categoryTouched = true; });

  function drawChips() {
    const box = $("#qa-chips");
    const typed = qaNorm(merchantInput.value);
    const matches = (typed ? habits.list.filter((e) => e.key.includes(typed) && e.key !== typed) : habits.list).slice(0, 10);
    box.innerHTML = "";
    box.style.display = matches.length ? "flex" : "none";
    for (const e of matches) {
      const chip = el("button", { type: "button", class: "chip qa-chip" }, e.name);
      chip.addEventListener("click", () => {
        merchantInput.value = e.name;
        merchantInput.blur();
        applyHabit(e.name);
        drawChips();
      });
      box.appendChild(chip);
    }
  }
  merchantInput.addEventListener("input", () => {
    drawChips();
    if (habits.list.some((e) => e.key === qaNorm(merchantInput.value))) applyHabit(merchantInput.value);
  });
  merchantInput.addEventListener("blur", () => { if (merchantInput.value.trim()) applyHabit(merchantInput.value); });
  // Con el teclado de letras abierto, el de números se guarda para dejar espacio
  // (con un pequeño retraso, para que la hoja no cambie de tamaño a medio toque)
  let typingTimer = null;
  const setTyping = (on) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => sheet.classList.toggle("qa-typing", on), on ? 250 : 120);
  };
  merchantInput.addEventListener("focus", () => setTyping(true));
  merchantInput.addEventListener("blur", () => setTyping(false));
  merchantInput.addEventListener("keydown", (e) => { if (e.key === "Enter") merchantInput.blur(); });

  // Valores iniciales: cuenta de la captura, o la del comercio, o la última que usaste
  applying = true;
  setSelect(accSel, validAccount(prefill?.accountId) || validAccount(habits.lastAccountId) || accounts[0].id);
  if (prefill?.categoryId) setSelect(catSel, prefill.categoryId);
  applying = false;
  if (merchantInput.value.trim()) await applyHabit(merchantInput.value);
  drawChips();

  // ---------- Pasar al formulario completo ----------
  const currentPrefill = (extra = {}) => ({
    type: "expense",
    amountCents: amountCents(),
    merchant: merchantInput.value.trim(),
    date: state.date,
    accountId: parseInt(accSel.value, 10),
    categoryId: catSel.value ? parseInt(catSel.value, 10) : null,
    source: prefill?.source || "manual",
    ...extra,
  });
  const openFull = (extra) => {
    close();
    openTransactionSheet({ prefill: currentPrefill(extra), onSaved });
  };
  $("#qa-more").addEventListener("click", () => openFull());
  sheet.querySelectorAll(".qa-type button").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.type !== "expense") openFull({ type: btn.dataset.type, accountId: null, categoryId: null });
    })
  );
  $("#qa-date").addEventListener("change", (e) => {
    if (e.target.value === "__other__") openFull();
    else state.date = e.target.value;
  });
  $("#qa-close").addEventListener("click", close);
  $("#qa-capture").addEventListener("click", () => { close(); pickCaptureImage(); });
  $("#qa-voice").addEventListener("click", () => { close(); openVoiceSheet(); });

  // ---------- Guardar ----------
  let saving = false;
  $("#qa-save").addEventListener("click", async () => {
    if (saving) return;
    const amount = amountCents();
    if (!amount || amount <= 0) {
      toast("Escribe el monto", "error");
      $("#qa-amount").classList.remove("shake");
      void $("#qa-amount").offsetWidth;
      $("#qa-amount").classList.add("shake");
      return;
    }
    saving = true;
    const merchant = merchantInput.value.trim();
    await saveTransactionWithBalances({
      type: "expense",
      amountCents: amount,
      accountId: parseInt(accSel.value, 10),
      toAccountId: null,
      categoryId: catSel.value ? parseInt(catSel.value, 10) : null,
      merchant,
      note: "",
      date: state.date,
      isRecurring: false,
      recurringDay: null,
      split: null,
      pendingSplit: false,
      source: prefill?.source || "manual",
      createdAt: new Date().toISOString(),
    });
    toast(`Guardado · ${Money.format(amount)}${merchant ? ` en ${merchant}` : ""}`, "success");
    close();
    if (onSaved) onSaved();
  });
}

window.openQuickAdd = openQuickAdd;
window.loadSpendingHabits = loadSpendingHabits;
window.suggestCategoryFor = suggestCategoryFor;
window.expenseAccounts = expenseAccounts;
