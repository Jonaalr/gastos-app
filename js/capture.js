/**
 * capture.js — Registrar gastos desde una captura de pantalla de una notificación.
 *
 * Flujo: botón + -> "Capturas" -> eliges una o varias capturas
 * -> el texto se lee AQUÍ, en el teléfono (Tesseract.js, sin subir nada)
 * -> una captura: confirmación corta con monto, comercio, cuenta y categoría sugeridos
 * -> varias: una lista para revisar y guardar todo de una vez.
 *
 * La imagen no se guarda en ningún lado: solo se usa para leer el texto.
 */

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const CAPTURE_LANGS = "spa+eng";
let tesseractPromise = null;

/** Abre el selector de imágenes del teléfono: una captura o varias a la vez. */
function pickCaptureImage() {
  const input = el("input", { type: "file", accept: "image/*", multiple: "multiple" });
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) await handleCaptureFiles(files);
  });
  input.click();
}

/** Aviso fijo mientras se leen las capturas (un toast se iría antes de terminar) */
function captureProgress(text) {
  const label = el("div", { class: "capture-progress-text" }, text);
  const node = el("div", { class: "capture-progress" }, [el("div", { class: "capture-progress-card" }, [el("div", { class: "capture-spinner" }), label])]);
  document.body.appendChild(node);
  return { set: (t) => { label.textContent = t; }, done: () => node.remove() };
}

async function handleCaptureFiles(files) {
  const many = files.length > 1;
  const progress = captureProgress(many ? `Leyendo captura 1 de ${files.length}…` : "Leyendo la captura…");
  let texts = [];
  try {
    texts = await recognizeCaptureTexts(files, (i) => { if (many) progress.set(`Leyendo captura ${i} de ${files.length}…`); });
  } catch (err) {
    console.error(err);
    progress.done();
    toast("No pude leer la captura. Revisa tu conexión la primera vez.", "error");
    return;
  }
  progress.done();

  const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
  const parsed = texts.map((t) => parseCapture(t, accounts));
  const good = parsed.filter((p) => p.amountCents);
  if (good.length === 0) {
    toast(many ? "No encontré montos en las capturas" : "No encontré un monto en la captura", "error");
    return;
  }
  if (!many) {
    const p = good[0];
    openQuickAdd({
      prefill: { amountCents: p.amountCents, merchant: p.merchant, date: p.date, accountId: p.accountId, source: "ocr", notice: p.notice },
      onSaved: () => Router.render(),
    });
    return;
  }
  await openCaptureReview(good, parsed.length - good.length);
}

/**
 * Varias capturas: una lista para revisar y guardar todo de una vez.
 * Cada renglón trae la cuenta y categoría sugeridas; los posibles duplicados llegan desmarcados.
 */
async function openCaptureReview(items, failedCount) {
  const accounts = expenseAccounts(await DB.getAll("accounts"));
  if (accounts.length === 0) { toast("Primero crea una cuenta en Dinero → Cuentas", "error"); return; }
  const [habits, categories, txs] = await Promise.all([
    loadSpendingHabits(),
    DB.getAllByIndex("categories", "kind", "expense"),
    DB.getAll("transactions"),
  ]);
  const valid = (id) => (accounts.some((a) => a.id === id) ? id : null);
  for (const it of items) {
    const hit = habits.find(it.merchant);
    it.accountId = valid(it.accountId) || valid(hit && hit.accountId) || valid(habits.lastAccountId) || accounts[0].id;
    it.categoryId = await suggestCategoryFor(it.merchant, habits);
    // Duplicado: mismo monto, misma cuenta y fecha a un día de distancia
    it.dup = txs.some((t) => t.type === "expense" && t.amountCents === it.amountCents && t.accountId === it.accountId && t.date && Math.abs(DateUtil.daysBetween(t.date.slice(0, 10), it.date)) <= 1);
  }

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const accOptions = (sel) => accounts.map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${escapeHtml(accountPickerLabel(a))}</option>`).join("");
  const catOptions = (sel) => `<option value="">Sin categoría</option>` + categories.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${escapeHtml(categoryLabel(c))}</option>`).join("");
  sheet.innerHTML = `
    <div class="sheet-header">
      <h2>Revisar capturas</h2>
      <button class="sheet-close" type="button" data-close aria-label="Cerrar">✕</button>
    </div>
    <div class="field-hint" style="margin:0 0 12px;">Corrige lo que haga falta y guarda todo de una vez.${failedCount ? ` No pude leer ${failedCount} ${failedCount === 1 ? "captura" : "capturas"}.` : ""}</div>
    ${items.map((it, i) => `
      <div class="cr-row${it.dup ? " off" : ""}" data-i="${i}">
        <div class="cr-top">
          <input type="checkbox" class="cr-inc" ${it.dup ? "" : "checked"} aria-label="Incluir este gasto">
          <input type="text" class="cr-merchant" value="${escapeHtml(it.merchant || "")}" placeholder="Comercio" autocomplete="off">
          <input type="number" inputmode="decimal" step="0.01" class="cr-amount" value="${Money.toInputValue(it.amountCents)}" aria-label="Monto">
        </div>
        <div class="cr-bottom">
          <select class="cr-acc" aria-label="Cuenta">${accOptions(it.accountId)}</select>
          <select class="cr-cat" aria-label="Categoría">${catOptions(it.categoryId)}</select>
        </div>
        <div class="cr-meta">
          <input type="date" class="cr-date" value="${it.date}" aria-label="Fecha">
          ${it.dup ? '<span class="cr-dup">Parece que ya está registrado</span>' : ""}
        </div>
      </div>`).join("")}
    <div class="btn-row mt-8 sheet-actions">
      <button class="btn" type="button" id="cr-save"></button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const rows = [...sheet.querySelectorAll(".cr-row")];
  const saveBtn = sheet.querySelector("#cr-save");
  const included = () => rows.filter((r) => r.querySelector(".cr-inc").checked);
  const refresh = () => {
    const n = included().length;
    saveBtn.textContent = n === 0 ? "Nada que guardar" : `Guardar ${n} ${n === 1 ? "gasto" : "gastos"}`;
    saveBtn.disabled = n === 0;
    rows.forEach((r) => r.classList.toggle("off", !r.querySelector(".cr-inc").checked));
  };
  rows.forEach((r) => r.querySelector(".cr-inc").addEventListener("change", refresh));
  refresh();
  sheet.querySelector("[data-close]").addEventListener("click", close);

  let saving = false;
  saveBtn.addEventListener("click", async () => {
    if (saving) return;
    const picked = included();
    const records = [];
    for (const r of picked) {
      const amount = Money.toCents(r.querySelector(".cr-amount").value);
      if (!amount || amount <= 0) { toast("Hay un gasto sin monto", "error"); return; }
      const cat = r.querySelector(".cr-cat").value;
      records.push({
        type: "expense",
        amountCents: amount,
        accountId: parseInt(r.querySelector(".cr-acc").value, 10),
        toAccountId: null,
        categoryId: cat ? parseInt(cat, 10) : null,
        merchant: r.querySelector(".cr-merchant").value.trim(),
        note: "",
        date: r.querySelector(".cr-date").value || DateUtil.todayISO(),
        isRecurring: false,
        recurringDay: null,
        split: null,
        pendingSplit: false,
        source: "ocr",
        createdAt: new Date().toISOString(),
      });
    }
    saving = true;
    for (const rec of records) await saveTransactionWithBalances(rec, null);
    toast(`${records.length} ${records.length === 1 ? "gasto guardado" : "gastos guardados"}`, "success");
    close();
    Router.render();
  });
}

/** Carga Tesseract.js desde el CDN la primera vez y devuelve el texto de la imagen. */
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => {
        tesseractPromise = null;
        reject(new Error("No se pudo cargar el lector"));
      };
      document.head.appendChild(script);
    });
  }
  return tesseractPromise;
}

/** Lee el texto de una o varias capturas con un solo lector (más rápido que abrir uno por imagen). */
async function recognizeCaptureTexts(files, onProgress) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker(CAPTURE_LANGS);
  const texts = [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress(i + 1);
      try {
        const { data } = await worker.recognize(files[i]);
        texts.push(data.text || "");
      } catch (err) {
        console.error(err);
        texts.push(""); // esa captura no se pudo leer; las demás siguen
      }
    }
  } finally {
    await worker.terminate();
  }
  return texts;
}

// ---------- Lectura del texto ----------

const CAPTURE_BANKS = [
  // La notificación de Revolut a veces no trae la palabra "Revolut": se reconoce por su formato ("Gastaste $X · Gastos de hoy")
  { re: /revolut/i, textRe: /revolut|gastaste\s*\$|gastos de hoy/i, name: "Revolut", prefer: null },
  { re: /banamex/i, name: "Banamex", prefer: "credit" },
  { re: /mercado\s?pago/i, name: "Mercado Pago", prefer: null },
];

/**
 * Convierte el texto de una captura en datos de un gasto.
 * Devuelve { amountCents, merchant, date, accountId, notice }.
 * Cualquier dato que no encuentre queda vacío o por defecto; el usuario lo revisa.
 */
function parseCapture(rawText, accounts = []) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const flat = lines.join(" ");

  const amountCents = parseCaptureAmount(flat);
  const date = parseCaptureDate(flat) || DateUtil.todayISO();
  const merchant = parseCaptureMerchant(lines, flat);

  const bank = CAPTURE_BANKS.find((b) => (b.textRe || b.re).test(flat)) || null;
  const account = bank ? pickAccountForBank(bank, accounts) : null;

  const notice = bank
    ? `Datos leídos de la captura de ${bank.name} · revísalos antes de guardar`
    : "Datos leídos de la captura · revísalos antes de guardar";

  return {
    amountCents,
    merchant,
    date,
    accountId: account ? account.id : null,
    notice,
  };
}

function parseCaptureAmount(flat) {
  const re = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  const hits = [];
  let m;
  while ((m = re.exec(flat)) !== null) {
    const before = flat.slice(Math.max(0, m.index - 25), m.index).toLowerCase();
    const keyword = /monto|gastaste|pagaste|cargo|compra|retiro/.test(before);
    hits.push({ value: m[1], keyword });
  }
  const pick = hits.find((h) => h.keyword) || hits[0];
  if (!pick) return 0;
  return Money.toCents(pick.value);
}

function parseCaptureDate(flat) {
  const m = flat.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCaptureMerchant(lines, flat) {
  // Banamex: el comercio va después de "Retiro/Compra" y antes de "monto" o la fecha.
  // El nombre de la tarjeta (p. ej. "COSTCO BANAMEX") aparece antes y no se toma.
  const banamex = flat.match(
    /(?:retiro\s*\/\s*compra|retiro|compra)\s*[:\-]?\s*(.+?)(?=\s+monto\b|\s+por\s+\$|\s+\$|\s+\d{1,2}\/\d{1,2}\/\d{2,4}|\s+el\s+\d|$)/i
  );
  if (banamex) {
    const name = cleanMerchant(banamex[1]);
    if (name) return name;
  }

  // Revolut / otros: el comercio suele estar en la línea justo antes del monto.
  const amountIdx = lines.findIndex((l) => /\$\s?\d/.test(l));
  for (let i = amountIdx - 1; i >= 0; i--) {
    const candidate = cleanMerchant(lines[i]);
    if (candidate && !/\$|revolut|notific|hoy|ayer|gastos de/i.test(lines[i])) return candidate;
  }
  return "";
}

function cleanMerchant(text) {
  return String(text || "")
    .replace(/\bCOSTCO\s*BANAMEX\b/gi, "")
    .replace(/\bBANAMEX\b/gi, "")
    .replace(/\bAuto\.?\s*\d*\b.*$/i, "")
    // La hora de la notificación suele leerse pegada al comercio: "Cinépolis Ahora", "Oxxo hace 5 min", "Costco 9:41"
    .replace(/\s+(ahora|now|hace\s+\d+\s*\w+|\d{1,2}:\d{2}(\s?[ap]\.?\s?m\.?)?)\s*$/i, "")
    .replace(/[|•·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function pickAccountForBank(bank, accounts) {
  const matches = accounts.filter(
    (a) => a.type !== "savings" && new RegExp(bank.re.source, "i").test(`${a.name || ""} ${a.bank || ""}`)
  );
  if (matches.length === 0) return null;
  if (bank.prefer) {
    const preferred = matches.find((a) => a.type === bank.prefer);
    if (preferred) return preferred;
  }
  return matches[0];
}

// ---------- Registro por voz ----------
// El audio lo procesa el reconocimiento de voz del navegador (en iPhone, Apple).
// Lo que se guarda sigue siendo solo en tu teléfono.

/** Hoja de "Por voz": se dicta con el micrófono del teclado del iPhone y la app llena el gasto. */
function openVoiceSheet() {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const status = el("p", { class: "muted", style: "font-size:13px;min-height:18px;margin:8px 0 0;" }, "");
  const textBox = el("textarea", {
    rows: 3,
    placeholder: "Toca aquí y usa el micrófono del teclado: «gasté 150 en Oxxo»",
    style: "width:100%;box-sizing:border-box;margin-top:10px;border-radius:12px;padding:12px;font-size:16px;",
  });
  const useText = el("button", { class: "btn", type: "button", style: "width:100%;margin-top:10px;" }, "Llenar el gasto");

  sheet.append(
    el("div", { class: "sheet-header" }, [
      el("h2", {}, "Dicta el gasto"),
      el("button", { class: "sheet-close", type: "button", onclick: close }, "✕"),
    ]),
    el("p", { class: "muted", style: "font-size:14px;margin:0 0 4px;" },
      "En el teclado del iPhone, toca el micrófono y di el gasto. Por ejemplo: «gasté 150 pesos en Oxxo» o «ayer compré 320 en Costco con Banamex»."
    ),
    textBox,
    useText,
    status,
    el("p", { class: "muted", style: "font-size:11px;text-align:center;margin-top:12px;" },
      "El dictado del teclado lo procesa Apple. Los gastos se guardan solo en tu teléfono."
    )
  );

  useText.addEventListener("click", async () => {
    const clean = textBox.value.trim();
    if (!clean) { status.textContent = "Dicta o escribe el gasto primero."; return; }
    const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
    const parsed = parseVoice(clean, accounts);
    if (!parsed.amountCents) {
      status.textContent = "No encontré un monto. Incluye la cantidad, por ejemplo «150».";
      return;
    }
    close();
    openQuickAdd({
      prefill: {
        amountCents: parsed.amountCents,
        merchant: parsed.merchant,
        date: parsed.date,
        accountId: parsed.accountId,
        source: "voice",
        notice: "Datos dictados · revísalos antes de guardar",
      },
      onSaved: () => Router.render(),
    });
  });
}

/**
 * Convierte una frase dictada en datos de gasto.
 * Ej.: "gasté 150 pesos en Oxxo" -> 15000, Oxxo, hoy.
 *      "ayer compré 320 en Costco con Banamex" -> 32000, Costco, ayer, cuenta Banamex.
 */
function parseVoice(text, accounts = []) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  const amountM = lower.match(/(\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  let amountCents = 0;
  if (amountM) {
    const n = amountM[1].replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
    amountCents = Money.toCents(n);
  }

  let date = DateUtil.todayISO();
  if (/\bayer\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() - 1);
    date = DateUtil.toISO(d);
  }

  let merchant = "";
  const merchantM = raw.match(/\ben\s+(?:la\s+|el\s+)?([^,.;]+?)(?=\s+con\s|\s+el\s+\d|\s+ayer\b|\s+hoy\b|$)/i);
  if (merchantM) merchant = merchantM[1].trim();
  if (merchant) merchant = merchant.charAt(0).toUpperCase() + merchant.slice(1);

  let accountId = null;
  for (const a of accounts) {
    const name = (a.name || "").toLowerCase();
    if (name && lower.includes(name)) { accountId = a.id; break; }
  }
  if (!accountId) {
    const bank = CAPTURE_BANKS.find((b) => b.re.test(lower));
    const acc = bank ? pickAccountForBank(bank, accounts) : null;
    if (acc) accountId = acc.id;
  }

  return { amountCents, merchant, date, accountId };
}
