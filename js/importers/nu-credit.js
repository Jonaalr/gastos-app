/**
 * nu-credit.js — Lector del estado de cuenta de la tarjeta de crédito Nu México.
 *
 * Renglón de movimiento:  "24 AGO 2026   24 AGO 2026   Playstationnetwork | RFC: S.I.   +$1,999.00"
 * (fecha de la operación, fecha de cargo, descripción, monto: + cargo, - abono)
 * Debajo de cada renglón viene una línea extra ("Tarjeta virtual **** 7326", "Cambio MXN...") que se ignora.
 *
 * Funciona en el navegador (window.NuCreditImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NuCreditImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
  const DATE = "(\\d{1,2}\\s+[A-Za-záéíóú]{3}\\s+\\d{4})";
  const MONEY = "\\$\\s*([\\d,]+\\.\\d{2})";
  // 24 AGO 2026   24 AGO 2026   Playstationnetwork | RFC: S.I.   +$1,999.00
  const ROW = new RegExp(`^${DATE}\\s+${DATE}\\s+(.+?)\\s+([+-])\\s*${MONEY}$`);

  function toCents(text) {
    return Math.round(parseFloat(String(text).replace(/,/g, "")) * 100);
  }

  /** "21 SEP 2026" -> "2026-09-21" */
  function parseDate(text) {
    const m = /^(\d{1,2})\s+([A-Za-záéíóú]{3})\s+(\d{4})$/.exec(String(text || "").trim());
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }

  function toTitleCase(text) {
    return text.toLowerCase().replace(/(^|[^a-záéíóúñ])([a-záéíóúñ])/g, (m, p, c) => p + c.toUpperCase());
  }

  /** "Playstationnetwork | RFC: S.I." -> "Playstationnetwork" */
  function cleanMerchant(raw) {
    let text = String(raw || "").replace(/\s+/g, " ").trim();
    text = text.replace(/\s*\|\s*RFC:.*$/i, "");
    return toTitleCase(text.trim() || String(raw || "").trim());
  }

  function detect(lines) {
    const text = lines.join("\n");
    return /\bNu\b|Nubank/i.test(text) && /CARGOS,?\s*ABONOS Y COMPRAS REGULARES/i.test(text) && /Total de cargos/i.test(text);
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const first = (re) => re.exec(text);

    // ---- Datos de la tarjeta ----
    const periodM = first(/Periodo:\s*(\d{1,2}\s+\w{3}\s+\d{4})\s+al\s+(\d{1,2}\s+\w{3}\s+\d{4})/);
    const cutM = first(/Fecha de corte:\s*(\d{1,2}\s+\w{3}\s+\d{4})/);
    const dueM = first(/Fecha l[ií]mite de pago\d*:\s*(?:[A-Za-záéíóú]+,\s*)?(\d{1,2}\s+\w{3}\s+\d{4})/);
    const limitM = first(new RegExp(`L[ií]mite de cr[eé]dito:\\s*${MONEY}`));
    const minM = first(new RegExp(`Pago m[ií]nimo\\d*:\\s*${MONEY}`));
    const cardM = first(/N[uú]mero de tarjeta:\s*X[X\-]*?(\d{4})/i);
    const productM = first(/Producto:\s*Tarjeta de Cr[eé]dito\s+Nu,?\s*([^\n\r]*)/i);
    const totalChargesM = first(new RegExp(`Total de cargos\\s*\\+?\\s*${MONEY}`));
    const totalPaymentsM = first(new RegExp(`Total de abonos\\s*-?\\s*${MONEY}`));

    const product = productM && productM[1].trim() ? productM[1].trim() : "";
    const info = {
      bank: "Nu",
      cardName: product ? `Tarjeta Nu ${product}` : "Tarjeta Nu",
      last4: cardM ? cardM[1] : null,
      periodStart: periodM ? parseDate(periodM[1]) : null,
      periodEnd: periodM ? parseDate(periodM[2]) : null,
      cutDate: cutM ? parseDate(cutM[1]) : null,
      dueDate: dueM ? parseDate(dueM[1]) : null,
      limitCents: limitM ? toCents(limitM[1]) : null,
      minPaymentCents: minM ? toCents(minM[1]) : null,
    };

    // ---- Movimientos (cargos, compras y abonos regulares) ----
    const movements = [];
    let inSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/CARGOS,?\s*ABONOS Y COMPRAS REGULARES/i.test(line)) { inSection = true; continue; }
      if (!inSection) continue;
      if (/^Total de cargos/i.test(line)) break;

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
        holder: "titular",
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

  return { id: "nu-credit", label: "Nu · tarjeta de crédito", detect, parse, cleanMerchant, parseDate };
});
