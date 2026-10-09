/**
 * revolut-credit.js — Lector del estado de cuenta de tarjetas de crédito Revolut (México).
 *
 * Renglón de movimiento:  "10 sept 2026   11 sept 2026   Compra Kinguin   +$80.89"
 * (fecha de operación, fecha de cargo, descripción, monto: + cargo, - abono)
 * Las líneas "Tarjeta: **** 1234" y "To: Comercio, Ciudad" que siguen dan el dato limpio del comercio.
 *
 * Funciona en el navegador (window.RevolutCreditImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RevolutCreditImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
  const DATE = "(\\d{1,2}\\s+[a-zA-Záéíóú]{3,4}\\s+\\d{4})";
  const MONEY = "\\$\\s*([\\d,]+\\.\\d{2})";
  // 10 sept 2026   11 sept 2026   Compra Kinguin   +$80.89
  const ROW = new RegExp(`^${DATE}\\s+${DATE}\\s+(.+?)\\s+([+-])\\s*${MONEY}$`);

  function toCents(text) {
    return Math.round(parseFloat(String(text).replace(/,/g, "")) * 100);
  }

  /** "10 sept 2026" -> "2026-09-10" */
  function parseDate(text) {
    const m = /^(\d{1,2})\s+([a-zA-Záéíóú]{3,4})\s+(\d{4})$/.exec(String(text || "").trim());
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }

  function toTitleCase(text) {
    return text.toLowerCase().replace(/(^|[^a-záéíóúñ])([a-záéíóúñ])/g, (m, p, c) => p + c.toUpperCase());
  }

  /** "Compra Oxxo Malecon Cen" -> "Oxxo Malecon Cen" */
  function cleanMerchant(raw) {
    return toTitleCase(String(raw || "").replace(/^Compra\s+/i, "").replace(/\s+/g, " ").trim());
  }

  /** "To: Kinguin, Hamrun" -> "Kinguin" (solo el nombre antes de la coma) */
  function merchantFromTo(toText) {
    return toTitleCase(toText.replace(/^To:\s*/i, "").split(",")[0].replace(/\s+/g, " ").trim());
  }

  function detect(lines) {
    const text = lines.join("\n");
    return /Revolut/i.test(text) && /Cargos, abonos y compras regulares/i.test(text) && /Fecha de cargo/i.test(text);
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const first = (re) => re.exec(text);

    // ---- Datos de la tarjeta ----
    const periodM = first(/Periodo\s+(\d{1,2}\s+\w{3,4}\s+\d{4})\s+al\s+(\d{1,2}\s+\w{3,4}\s+\d{4})/);
    const cutM = first(/Fecha corte\s+(\d{1,2}\s+\w{3,4}\s+\d{4})/);
    const dueM = first(/Fecha l[ií]mite de pago\s+(?:[A-Za-záéíóú]+,\s*)?(\d{1,2}\s+\w{3,4}\s+\d{4})/);
    const limitM = first(new RegExp(`L[ií]mite de cr[eé]dito\\s+${MONEY}`));
    const payM = first(new RegExp(`Pago para no generar intereses\\s+${MONEY}`));
    const minM = first(new RegExp(`Pago m[ií]nimo\\s+${MONEY}`));
    const cardM = first(/\*{4}\s\*{4}\s\*{4}\s(\d{4})/);
    const totalChargesM = first(new RegExp(`Total cargos\\s*\\+\\s*${MONEY}`));
    const totalPaymentsM = first(new RegExp(`Total abonos\\s*-\\s*${MONEY}`));

    const info = {
      bank: "Revolut",
      cardName: "Revolut Credit Card",
      last4: cardM ? cardM[1] : null,
      periodStart: periodM ? parseDate(periodM[1]) : null,
      periodEnd: periodM ? parseDate(periodM[2]) : null,
      cutDate: cutM ? parseDate(cutM[1]) : null,
      dueDate: dueM ? parseDate(dueM[1]) : null,
      limitCents: limitM ? toCents(limitM[1]) : null,
      payToAvoidInterestCents: payM ? toCents(payM[1]) : null,
      minPaymentCents: minM ? toCents(minM[1]) : null,
    };

    // ---- Movimientos (solo la sección de cargos, abonos y compras regulares) ----
    const movements = [];
    let inSection = false;
    let last = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/Cargos, abonos y compras regulares/i.test(line)) { inSection = true; continue; }
      if (!inSection) continue;
      if (/^Total cargos/i.test(line)) break;

      const row = ROW.exec(line);
      if (row) {
        const op = parseDate(row[1]);
        if (!op) { warnings.push(`No se entendió la fecha "${row[1]}"`); last = null; continue; }
        const sign = row[4];
        const rawDescription = row[3].trim();
        // Un "-" es un abono (pago a la tarjeta o devolución). Los pagos no se importan como gasto.
        const isPayment = sign === "-" && /\bFrom\b|PAGO|ABONO|Rendimiento|TRASPASO/i.test(rawDescription);
        const kind = sign === "+" ? "charge" : isPayment ? "payment" : "refund";
        last = {
          date: op,
          postDate: parseDate(row[2]),
          kind,
          amountCents: toCents(row[5]),
          rawDescription,
          description: kind === "payment" ? `Pago a la tarjeta · ${rawDescription}` : cleanMerchant(rawDescription),
          holder: "titular",
        };
        movements.push(last);
        continue;
      }
      // Línea de comercio que sigue al movimiento: "To: Kinguin, Hamrun"
      if (last && /^To:/i.test(line) && last.kind !== "payment") {
        last.description = merchantFromTo(line) || last.description;
        last.rawDescription = `${last.rawDescription} | ${line}`;
        last = null;
      }
    }

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

  return { id: "revolut-credit", label: "Revolut · tarjeta de crédito", detect, parse, cleanMerchant, parseDate };
});
