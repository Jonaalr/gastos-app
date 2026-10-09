/**
 * bbva-credit.js — Lector del estado de cuenta de tarjetas de crédito BBVA México.
 *
 * Renglón de movimiento:  "22-sep-2026   22-sep-2026   BMOVIL.PAGO TDC   - $1,095.34"
 * (fecha de operación, fecha de cargo, descripción, monto: + cargo, - abono)
 * Las compras de "10 DE 12 MERCADO PAGO ; Tarjeta Digital ***1611" son cargos normales de este periodo.
 *
 * Funciona en el navegador (window.BbvaCreditImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BbvaCreditImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
  const DATE = "(\\d{1,2}-[a-zA-Záéíóú]{3,4}-\\d{4})";
  const MONEY = "\\$\\s*([\\d,]+\\.\\d{2})";
  // 22-sep-2026   22-sep-2026   BMOVIL.PAGO TDC   - $1,095.34
  const ROW = new RegExp(`^${DATE}\\s+${DATE}\\s+(.+?)\\s+([+-])\\s*${MONEY}$`);

  function toCents(text) {
    return Math.round(parseFloat(String(text).replace(/,/g, "")) * 100);
  }

  /** "04-oct-2026" -> "2026-10-04" */
  function parseDate(text) {
    const m = /^(\d{1,2})-([a-zA-Záéíóú]{3,4})-(\d{4})$/.exec(String(text || "").trim());
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }

  function toTitleCase(text) {
    return text.toLowerCase().replace(/(^|[^a-záéíóúñ])([a-záéíóúñ])/g, (m, p, c) => p + c.toUpperCase());
  }

  /** "10 DE 12 MERCADO PAGO ; Tarjeta Digital ***1611" -> "Mercado Pago" */
  function cleanMerchant(raw) {
    let text = String(raw || "").replace(/\s+/g, " ").trim();
    text = text.replace(/^\d+\s+DE\s+\d+\s+/i, "");          // cuota "10 DE 12"
    text = text.replace(/\s*;\s*Tarjeta Digital.*$/i, "");    // ; Tarjeta Digital ***1611
    return toTitleCase(text.trim() || String(raw || "").trim());
  }

  function detect(lines) {
    const text = lines.join("\n");
    return /BBVA/i.test(text) && /CARGOS,?\s*COMPRAS Y ABONOS REGULARES/i.test(text) && /DESGLOSE DE MOVIMIENTOS/i.test(text);
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const first = (re) => re.exec(text);

    // ---- Datos de la tarjeta ----
    const periodM = first(/Periodo:\s*(\d{1,2}-\w{3,4}-\d{4})\s+al\s+(\d{1,2}-\w{3,4}-\d{4})/);
    const cutM = first(/Fecha de corte:\s*(\d{1,2}-\w{3,4}-\d{4})/);
    const dueM = first(/Fecha l[ií]mite de pago:\s*\d*\s*(?:[A-Za-záéíóú]+,\s*)?(\d{1,2}-\w{3,4}-\d{4})/);
    const limitM = first(new RegExp(`L[ií]mite de cr[eé]dito:\\s*${MONEY}`));
    const payM = first(new RegExp(`Pago para no generar intereses:?\\s*\\d*\\s*${MONEY}`, "i"));
    const minM = first(new RegExp(`Pago m[ií]nimo:\\s*\\d*\\s*${MONEY}`));
    const cardM = first(/N[uú]mero de tarjeta:\s*(\d{12,16})/);
    const totalChargesM = first(new RegExp(`Total cargos\\s*\\+?\\s*${MONEY}`));
    const totalPaymentsM = first(new RegExp(`Total abonos\\s*-?\\s*${MONEY}`));

    const info = {
      bank: "BBVA",
      cardName: "Tarjeta Oro BBVA",
      last4: cardM ? cardM[1].slice(-4) : null,
      periodStart: periodM ? parseDate(periodM[1]) : null,
      periodEnd: periodM ? parseDate(periodM[2]) : null,
      cutDate: cutM ? parseDate(cutM[1]) : null,
      dueDate: dueM ? parseDate(dueM[1]) : null,
      limitCents: limitM ? toCents(limitM[1]) : null,
      payToAvoidInterestCents: payM ? toCents(payM[1]) : null,
      minPaymentCents: minM ? toCents(minM[1]) : null,
    };

    // ---- Movimientos (solo cargos, compras y abonos regulares) ----
    const movements = [];
    let inSection = false;
    let deferredWarned = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/CARGOS,?\s*COMPRAS Y ABONOS REGULARES/i.test(line)) { inSection = true; continue; }
      if (/COMPRAS Y CARGOS DIFERIDOS A MESES|DIFERIDOS A MESES SIN INTERESES/i.test(line) && !inSection) {
        if (!deferredWarned) {
          warnings.push("Este estado de cuenta incluye compras a meses; esa sección todavía no se importa.");
          deferredWarned = true;
        }
        continue;
      }
      if (!inSection) continue;
      if (/^Total cargos/i.test(line)) break;

      const row = ROW.exec(line);
      if (!row) continue;
      const op = parseDate(row[1]);
      if (!op) { warnings.push(`No se entendió la fecha "${row[1]}"`); continue; }
      const sign = row[4];
      const rawDescription = row[3].trim();
      // Un "-" con pago o abono es lo que pagaste a la tarjeta: no se importa como gasto
      const isPayment = sign === "-" && /PAGO|ABONO|TRASPASO/i.test(rawDescription);
      const kind = sign === "+" ? "charge" : isPayment ? "payment" : "refund";
      movements.push({
        date: op,
        postDate: parseDate(row[2]),
        kind,
        amountCents: toCents(row[5]),
        rawDescription,
        description: kind === "payment" ? `Pago a la tarjeta · ${cleanMerchant(rawDescription)}` : cleanMerchant(rawDescription),
        holder: /Tarjeta Digital/i.test(rawDescription) ? "digital" : "titular",
      });
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

  return { id: "bbva-credit", label: "BBVA · tarjeta de crédito", detect, parse, cleanMerchant, parseDate };
});
