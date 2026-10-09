/**
 * banamex-credit.js — Lector del "Estado de Cuenta Mensual" de tarjetas de crédito Banamex.
 *
 * Recibe las líneas de texto del PDF (ver pdf-lines.js) y devuelve:
 *   - datos de la tarjeta (últimos 4 dígitos, límite, fecha de corte y de pago)
 *   - la lista de movimientos (compras, pagos y devoluciones)
 *   - una verificación contra los totales que imprime el propio estado de cuenta
 *
 * Funciona en el navegador (window.BanamexCreditImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BanamexCreditImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };

  const DATE = "(\\d{1,2}-[a-zA-Záéíóú]{3,4}-\\d{4})";
  const MONEY = "\\$\\s*([\\d,]+\\.\\d{2})";
  // 05-may-2026  06-may-2026  DESCRIPCIÓN  +  $600.00
  const ROW = new RegExp(`^${DATE}\\s+${DATE}\\s+(.+?)\\s+([+-])\\s+${MONEY}$`);
  // Primer renglón de un movimiento que ocupa varias líneas (el monto viene hasta el final)
  const ROW_START = new RegExp(`^${DATE}\\s+${DATE}\\s+(.+)$`);
  const ROW_END = new RegExp(`^(.*?)\\s*\\s([+-])\\s+${MONEY}$`);

  function toCents(text) {
    return Math.round(parseFloat(String(text).replace(/,/g, "")) * 100);
  }

  /** "05-jun-2026" o "6-may-2026" -> "2026-06-05" */
  function parseDate(text) {
    const m = /^(\d{1,2})-([a-zA-Záéíóú]{3,4})-(\d{4})$/.exec(text.trim());
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }

  function detect(lines) {
    const text = lines.join("\n");
    return /Estado de Cuenta Mensual/i.test(text) && /Tarjeta de Cr[eé]dito/i.test(text) && /BANAMEX/i.test(text) && /DESGLOSE DE MOVIMIENTOS/i.test(text);
  }

  // RFC del comercio que el banco imprime pegado a la descripción: "HMA 2005119F3MX", "CME910715UB9MX"
  // Persona moral: 3 letras (con o sin espacio); persona física: 4 letras; luego 6 dígitos de fecha y 3 de homoclave
  const RFC_TAIL = /\s*(?:[A-ZÑ&]{3}\s?|[A-ZÑ&]{4})\d{6}[A-Z0-9]{3}(?:MX)?$/;
  const RFC_ONLY = /^(?:[A-ZÑ&]{3}\s?|[A-ZÑ&]{4})\d{6}[A-Z0-9]{3}(?:MX)?$/;
  const CITY_STATE = /^[A-ZÑ ]+ [A-Z]{2}MX$/;

  function toTitleCase(text) {
    return text.toLowerCase().replace(/(^|[^a-záéíóúñ])([a-záéíóúñ])/g, (m, p, c) => p + c.toUpperCase());
  }

  /** "ABARROTES EL MANDADITO HMA 2005119F3MX" -> "Abarrotes El Mandadito" */
  function cleanMerchant(raw) {
    const parts = raw.trim().split(/\s{2,}/);
    let main = parts[0];
    const rest = parts.slice(1).join(" ").trim();
    if (rest && !(RFC_ONLY.test(rest) || CITY_STATE.test(rest))) main = `${main} ${rest}`;
    main = main.replace(RFC_TAIL, "").replace(/\s+[A-Z]{2}MX$/, "").replace(/\s+/g, " ").trim();
    return toTitleCase(main || raw.trim());
  }

  function paymentLabel(rawLines) {
    const text = rawLines.join("\n");
    const from = /PAGO RECIBIDO DE:\s*(.+?)(?:\s{2,}|\n|$)/.exec(text);
    const concept = /CONCEPTO:\s*(.+)/.exec(text);
    let label = from ? `Pago recibido de ${from[1].trim()}` : "Pago a la tarjeta";
    if (concept && concept[1].trim()) label += ` · ${concept[1].trim()}`;
    return label;
  }

  function classify(sign, rawDescription) {
    if (sign === "+") return "charge";
    return /\bPAGO\b|SU ABONO|TRASPASO/i.test(rawDescription) ? "payment" : "refund";
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const first = (re) => {
      const m = re.exec(text);
      return m ? m : null;
    };

    // ---- Datos de la tarjeta ----
    const cardNameM = first(/Tarjeta de Cr[eé]dito\s+(.+?)\s{2,}N[uú]mero de d[ií]as/);
    const cardNumM = first(/N[uú]mero de tarjeta\s+((?:\d{4}\s?){4})/);
    const periodM = first(/Periodo:\s*(\d{1,2}-\w{3,4}-\d{4})\s+al\s+(\d{1,2}-\w{3,4}-\d{4})/);
    const cutM = first(/Fecha de corte:\s*(\d{1,2}-\w{3,4}-\d{4})/);
    const dueM = first(/Fecha l[ií]mite de pago:\s*(?:[A-Za-záéíóú]+,\s*)?(\d{1,2}-\w{3,4}-\d{4})/);
    const limitM = first(new RegExp(`L[ií]mite de cr[eé]dito:\\s*${MONEY}`));
    const payM = first(new RegExp(`Pago para no generar intereses:?\\s*\\d*\\s+${MONEY}`));
    const minM = first(new RegExp(`Pago m[ií]nimo:\\s*\\d*\\s+${MONEY}`));
    const totalChargesM = first(new RegExp(`Total cargos\\s*\\+\\s+${MONEY}`));
    const totalPaymentsM = first(new RegExp(`Total abonos\\s*-\\s+${MONEY}`));

    const digits = cardNumM ? cardNumM[1].replace(/\s/g, "") : "";
    const info = {
      bank: "Banamex",
      cardName: cardNameM ? toTitleCase(cardNameM[1]) : "Tarjeta de crédito",
      last4: digits ? digits.slice(-4) : null,
      periodStart: periodM ? parseDate(periodM[1]) : null,
      periodEnd: periodM ? parseDate(periodM[2]) : null,
      cutDate: cutM ? parseDate(cutM[1]) : null,
      dueDate: dueM ? parseDate(dueM[1]) : null,
      limitCents: limitM ? toCents(limitM[1]) : null,
      payToAvoidInterestCents: payM ? toCents(payM[1]) : null,
      minPaymentCents: minM ? toCents(minM[1]) : null,
    };

    // ---- Movimientos ----
    const movements = [];
    let inBreakdown = false;
    let holder = "titular";
    let section = "regular";
    let pending = null;
    let deferredWarned = false;

    const push = (opDate, postDate, rawDescription, sign, amountText, extraLines) => {
      const op = parseDate(opDate);
      if (!op) {
        warnings.push(`No se entendió la fecha "${opDate}"`);
        return;
      }
      const kind = classify(sign, rawDescription);
      const isPayment = kind === "payment";
      movements.push({
        date: op,
        postDate: parseDate(postDate),
        kind,
        amountCents: toCents(amountText),
        rawDescription: extraLines && extraLines.length ? [rawDescription, ...extraLines].join(" | ") : rawDescription,
        description: isPayment ? (extraLines && extraLines.length ? paymentLabel(extraLines) : "Pago a la tarjeta") : cleanMerchant(rawDescription),
        holder,
      });
    };

    const dropPending = () => {
      if (pending) {
        warnings.push(`Un movimiento del ${pending.opDate} quedó incompleto y se omitió`);
        pending = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (!inBreakdown) {
        if (/DESGLOSE DE MOVIMIENTOS/i.test(line)) inBreakdown = true;
        continue;
      }
      if (/^Total cargos/i.test(line)) {
        dropPending();
        break;
      }
      if (/Tarjeta titular:/i.test(line)) { holder = "titular"; continue; }
      if (/Tarjeta digital:/i.test(line)) { holder = "digital"; continue; }
      if (/Tarjeta adicional:/i.test(line)) { holder = "adicional"; continue; }
      if (/CARGOS, ABONOS Y COMPRAS REGULARES/i.test(line)) { section = "regular"; continue; }
      if (/DIFERIDOS A MESES|COMPRAS A MESES/i.test(line) && !ROW.test(line)) {
        section = "deferred";
        if (!deferredWarned) {
          warnings.push("Este estado de cuenta incluye compras a meses; esa sección todavía no se importa.");
          deferredWarned = true;
        }
        continue;
      }
      if (section !== "regular") continue;

      if (pending) {
        if (line === "\f" || /^Notas:/i.test(line) || ROW_START.test(line)) {
          dropPending();
        } else {
          const end = ROW_END.exec(line);
          if (end) {
            pending.extra.push(end[1].trim());
            push(pending.opDate, pending.postDate, pending.raw, end[2], end[3], pending.extra);
            pending = null;
          } else if (pending.extra.length < 14) {
            pending.extra.push(line);
          } else {
            dropPending();
          }
          continue;
        }
      }

      const row = ROW.exec(line);
      if (row) {
        push(row[1], row[2], row[3], row[4], row[5], null);
        continue;
      }
      const start = ROW_START.exec(line);
      if (start) pending = { opDate: start[1], postDate: start[2], raw: start[3].trim(), extra: [] };
    }
    dropPending();

    // ---- Verificación contra los totales del estado de cuenta ----
    const sum = (kinds) => movements.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + m.amountCents, 0);
    const parsedCharges = sum(["charge"]);
    const parsedPayments = sum(["payment", "refund"]);
    const expectedCharges = totalChargesM ? toCents(totalChargesM[1]) : null;
    const expectedPayments = totalPaymentsM ? toCents(totalPaymentsM[1]) : null;
    const reconciliation = {
      parsedCharges,
      parsedPayments,
      expectedCharges,
      expectedPayments,
      ok: expectedCharges !== null && expectedPayments !== null && parsedCharges === expectedCharges && parsedPayments === expectedPayments,
    };

    return { info, movements, warnings, reconciliation };
  }

  return { id: "banamex-credit", label: "Banamex · tarjeta de crédito", detect, parse, cleanMerchant, parseDate };
});
