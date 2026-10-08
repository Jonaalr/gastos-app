/**
 * capture.js — Registrar gastos desde una captura de pantalla de una notificación.
 *
 * Flujo: botón + -> menú ("Escribir gasto" | "Desde captura") -> eliges la captura
 * -> el texto se lee AQUÍ, en el teléfono (Tesseract.js, sin subir nada)
 * -> se llenan monto, comercio, fecha y cuenta -> revisas el formulario y guardas.
 *
 * La imagen no se guarda en ningún lado: solo se usa para leer el texto.
 */

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const CAPTURE_LANGS = "spa+eng";
let tesseractPromise = null;

/** Abre el menú del botón + sobre fondo difuminado. */
function openAddMenu() {
  const backdrop = el("div", { class: "add-menu-backdrop" });
  const menu = el("div", { class: "add-menu" });
  const close = () => backdrop.remove();

  const writeBtn = el("button", { class: "add-menu-item", type: "button" }, [
    el("div", { class: "add-menu-icon" }, "✎"),
    el("div", { class: "add-menu-text" }, [
      el("div", { class: "add-menu-title" }, "Escribir gasto"),
      el("div", { class: "add-menu-sub" }, "Como hasta ahora"),
    ]),
  ]);
  const captureBtn = el("button", { class: "add-menu-item", type: "button" }, [
    el("div", { class: "add-menu-icon" }, "▣"),
    el("div", { class: "add-menu-text" }, [
      el("div", { class: "add-menu-title" }, "Desde captura"),
      el("div", { class: "add-menu-sub" }, "Elige una notificación y yo lleno los datos"),
    ]),
  ]);

  const voiceBtn = el("button", { class: "add-menu-item", type: "button" }, [
    el("div", { class: "add-menu-icon" }, "◉"),
    el("div", { class: "add-menu-text" }, [
      el("div", { class: "add-menu-title" }, "Por voz"),
      el("div", { class: "add-menu-sub" }, "Dicta el gasto y yo lleno los datos"),
    ]),
  ]);

  const actions = new Map([
    [writeBtn, () => openTransactionSheet({ onSaved: () => Router.render() })],
    [captureBtn, () => pickCaptureImage()],
    [voiceBtn, () => openVoiceSheet()],
  ]);
  writeBtn.addEventListener("click", () => { close(); actions.get(writeBtn)(); });
  captureBtn.addEventListener("click", () => { close(); actions.get(captureBtn)(); });
  voiceBtn.addEventListener("click", () => { close(); actions.get(voiceBtn)(); });

  // Se pinta la opción bajo el dedo (igual que el menú desplegable); al soltar, se elige
  let hovered = null;
  const setHover = (item) => {
    if (item === hovered) return;
    if (hovered) hovered.classList.remove("hover");
    hovered = item;
    if (hovered) hovered.classList.add("hover");
  };
  const itemAt = (touch) => {
    const node = document.elementFromPoint(touch.clientX, touch.clientY);
    const item = node && node.closest ? node.closest(".add-menu-item") : null;
    return item && menu.contains(item) ? item : null;
  };
  menu.addEventListener("touchstart", (e) => setHover(itemAt(e.touches[0])), { passive: true });
  menu.addEventListener("touchmove", (e) => setHover(itemAt(e.touches[0])), { passive: true });
  menu.addEventListener("touchend", (e) => {
    const target = hovered;
    setHover(null);
    if (target && actions.has(target)) {
      e.preventDefault();
      close();
      actions.get(target)();
    }
  });
  menu.addEventListener("touchcancel", () => setHover(null), { passive: true });
  // Mientras el menú está abierto, deslizar no debe mover la página de atrás
  backdrop.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  menu.append(writeBtn, captureBtn, voiceBtn);
  backdrop.appendChild(menu);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
}

/** Abre el selector de imágenes del teléfono y procesa la que elijas. */
function pickCaptureImage() {
  const input = el("input", { type: "file", accept: "image/*" });
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (file) await handleCaptureFile(file);
  });
  input.click();
}

async function handleCaptureFile(file) {
  toast("Leyendo la captura…", "info");
  let text = "";
  try {
    text = await recognizeCaptureText(file);
  } catch (err) {
    console.error(err);
    toast("No pude leer la captura. Revisa tu conexión la primera vez.", "error");
    return;
  }

  const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
  const parsed = parseCapture(text, accounts);
  if (!parsed.amountCents) {
    toast("No encontré un monto en la captura", "error");
    return;
  }

  openTransactionSheet({
    prefill: {
      type: "expense",
      amountCents: parsed.amountCents,
      merchant: parsed.merchant,
      date: parsed.date,
      accountId: parsed.accountId,
      source: "ocr",
      notice: parsed.notice,
    },
    onSaved: () => Router.render(),
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

async function recognizeCaptureText(file) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker(CAPTURE_LANGS);
  try {
    const { data } = await worker.recognize(file);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

// ---------- Lectura del texto ----------

const CAPTURE_BANKS = [
  { re: /revolut/i, name: "Revolut", prefer: null },
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

  const bank = CAPTURE_BANKS.find((b) => b.re.test(flat)) || null;
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

const VOICE_LANG = "es-MX";

function voiceRecognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Abre la hoja de dictado: un toque en el micrófono empieza a escuchar. Si no funciona, se puede escribir o dictar con el teclado. */
function openVoiceSheet() {
  const rec = voiceRecognizer();
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  let listening = false;
  const close = () => { try { rec && rec.abort(); } catch (_) {} backdrop.remove(); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const status = el("p", { class: "muted", style: "text-align:center;margin:8px 0;min-height:18px;" }, "");
  const heard = el("div", { class: "voice-heard" }, "");
  const micBtn = el("button", { class: "voice-mic", type: "button", "aria-label": "Dictar" }, "◉");
  const textBox = el("textarea", {
    rows: 2,
    placeholder: "O escribe o dicta con el micrófono del teclado: «gasté 150 en Oxxo»",
    style: "width:100%;box-sizing:border-box;margin-top:10px;border-radius:12px;padding:10px;font-size:16px;",
  });
  const useText = el("button", { class: "btn btn-secondary", type: "button", style: "width:100%;margin-top:8px;" }, "Usar este texto");

  sheet.append(
    el("div", { class: "sheet-header" }, [
      el("h2", {}, "Dicta el gasto"),
      el("button", { class: "sheet-close", type: "button", onclick: close }, "✕"),
    ]),
    el("div", { style: "display:flex;justify-content:center;margin:12px 0;" }, [micBtn]),
    status,
    heard,
    textBox,
    useText,
    el("p", { class: "muted", style: "font-size:11px;text-align:center;margin-top:10px;" },
      "El audio lo procesa el reconocimiento de voz de tu navegador (en iPhone, Apple). Los gastos se guardan solo en tu teléfono."
    )
  );

  // Del texto (dictado o escrito) al formulario lleno
  async function fillFromText(text) {
    const clean = String(text || "").trim();
    if (!clean) { toast("Escribe o dicta el gasto primero", "error"); return; }
    heard.textContent = `«${clean}»`;
    const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
    const parsed = parseVoice(clean, accounts);
    if (!parsed.amountCents) {
      status.textContent = "No encontré un monto en eso. Incluye la cantidad, por ejemplo «150».";
      return;
    }
    close();
    openTransactionSheet({
      prefill: {
        type: "expense",
        amountCents: parsed.amountCents,
        merchant: parsed.merchant,
        date: parsed.date,
        accountId: parsed.accountId,
        source: "voice",
        notice: "Datos dictados · revísalos antes de guardar",
      },
      onSaved: () => Router.render(),
    });
  }
  useText.addEventListener("click", () => fillFromText(textBox.value));

  if (!rec) {
    status.textContent = "Este navegador no tiene dictado. Usa el micrófono del teclado en el cuadro de abajo.";
    micBtn.disabled = true;
    return;
  }

  rec.lang = VOICE_LANG;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  rec.onstart = () => { status.textContent = "Escuchando… di el gasto y toca el micrófono al terminar."; };
  rec.onresult = (e) => {
    listening = false;
    micBtn.classList.remove("on");
    const text = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
    if (!text) { status.textContent = "No llegó texto. Prueba de nuevo o usa el teclado."; return; }
    textBox.value = text;
    fillFromText(text);
  };
  rec.onerror = (e) => {
    listening = false;
    micBtn.classList.remove("on");
    const why = {
      "not-allowed": "Safari no tiene permiso para usar el dictado. Revisa en Ajustes > Safari o Ajustes > Privacidad.",
      "service-not-allowed": "El dictado no está disponible aquí. Usa el micrófono del teclado.",
      "no-speech": "No escuché nada. Toca el micrófono y habla después de que empiece a escuchar.",
      "audio-capture": "No encuentro el micrófono.",
      "network": "Sin conexión para el dictado. Usa el micrófono del teclado.",
    }[e.error] || `El dictado se detuvo (${e.error || "sin detalle"}). Usa el micrófono del teclado.`;
    status.textContent = why;
  };
  rec.onend = () => {
    if (listening) { listening = false; micBtn.classList.remove("on"); status.textContent = "Terminó sin resultado. Toca el micrófono para intentar de nuevo."; }
  };

  micBtn.addEventListener("click", () => {
    if (listening) { try { rec.stop(); } catch (_) {} return; }
    listening = true;
    micBtn.classList.add("on");
    heard.textContent = "";
    status.textContent = "Iniciando el micrófono…";
    try { rec.start(); } catch (err) { listening = false; micBtn.classList.remove("on"); status.textContent = `No pude iniciar el micrófono (${err && err.message ? err.message : "error"}).`; }
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
