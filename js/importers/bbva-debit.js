/**
 * bbva-debit.js — Lector del estado de cuenta de cuentas de débito BBVA México (Libretón, Cuenta Digital).
 *
 * Renglón de movimiento:  "31/AGO 31/AGO PAGO DE NOMINA 8,250.00 [saldo operación] [saldo liquidación]"
 * Las fechas no traen año: se toma del periodo (DEL ... AL ...). El signo (cargo o abono) no viene
 * en el renglón: se deduce con la cadena de saldos del propio estado de cuenta.
 * Un pago a la tarjeta de crédito es una transferencia (no gasto ni ingreso).
 *
 * Funciona en el navegador (window.BbvaDebitImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BbvaDebitImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DIC: 12 };
  const MONEY_TOKEN = /-?\d{1,3}(?:,\d{3})*\.\d{2}/;
  const ROW = /^(\d{2})\/([A-Z]{3,4})\s+(\d{2})\/([A-Z]{3,4})\s+(.*)$/;
  const TRANSFER_CARD = /PAGO\s+TARJETA\s+DE\s+CREDITO|PAGO\s+TDC|PAGO\s+TARJETA\b/i;
  const MAX_UNKNOWN = 16;

  function toCents(text) {
    return Math.round(parseFloat(String(text).replace(/,/g, "")) * 100);
  }

  /** "29/08/2026" -> "2026-08-29" */
  function parseSlashDate(text) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text || "").trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  /** Mes en letras del renglón ("AGO") -> número */
  function monthOf(text) {
    return MONTHS[String(text || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] || null;
  }

  /** "PAGO DE NOMINA" -> "Pago de nomina"; quita la referencia de los conceptos */
  function cleanDescription(raw) {
    let text = String(raw || "").replace(/\s+/g, " ").trim();
    text = text.replace(/\s+Referencia\s+\d+.*$/i, "");
    text = text.replace(/^(BNET|SPEI)\s+\d+\s*/i, (m, p) => p.toUpperCase() + " ");
    text = text || String(raw || "").trim();
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  function detect(lines) {
    const text = lines.join("\n");
    return /BBVA/i.test(text)
      && /Detalle de Movimientos Realizados/i.test(text)
      && /Saldo Anterior/i.test(text)
      && !/DESGLOSE DE MOVIMIENTOS/i.test(text);
  }

  /**
   * Asigna el signo de cada movimiento pendiente para que la cadena de saldos cuadre.
   * Devuelve un arreglo de signos (+1 abono, -1 cargo) o null si no hay una única solución.
   */
  function solveSigns(startCents, pending, targetCents) {
    const k = pending.length;
    const solutions = [];
    for (let mask = 0; mask < 1 << k; mask++) {
      let sum = startCents;
      for (let j = 0; j < k; j++) sum += mask & (1 << j) ? pending[j].amountCents : -pending[j].amountCents;
      if (sum === targetCents) solutions.push(mask);
      if (solutions.length > 1) return null;
    }
    if (solutions.length !== 1) return null;
    return pending.map((_, j) => (solutions[0] & (1 << j) ? 1 : -1));
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const first = (re) => re.exec(text);

    // ---- Datos de la cuenta ----
    const periodM = first(/DEL\s+(\d{2}\/\d{2}\/\d{4})\s+AL\s+(\d{2}\/\d{2}\/\d{4})/i);
    const cutM = first(/Fecha de Corte\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    // El número de cuenta va en la misma línea que su etiqueta (en columna, con mucho espacio entre medio)
    const accLine = lines.find((l) => /No\.\s*de\s*Cuenta/i.test(l)) || "";
    const accM = /(\d{6,})/.exec(accLine.slice(accLine.search(/No\.\s*de\s*Cuenta/i) + 14));
    const anteriorM = first(/Saldo Anterior\s+([\d,]+\.\d{2})/i);
    const finalM = first(/Saldo Final\s+([\d,]+\.\d{2})/i);
    const depositsM = first(/Dep[oó]sitos\s*\/\s*Abonos\s*\(\+\)\s*\d+\s+([\d,]+\.\d{2})/i);
    const withdrawalsM = first(/Retiros\s*\/\s*Cargos\s*\(-\)\s*\d+\s+([\d,]+\.\d{2})/i);
    const totalChargesM = first(/TOTAL IMPORTE CARGOS\s+([\d,]+\.\d{2})\s+TOTAL MOVIMIENTOS CARGOS\s+(\d+)/i);
    const totalPaymentsM = first(/TOTAL IMPORTE ABONOS\s+([\d,]+\.\d{2})\s+TOTAL MOVIMIENTOS ABONOS\s+(\d+)/i);

    const periodStart = periodM ? parseSlashDate(periodM[1]) : null;
    const periodEnd = periodM ? parseSlashDate(periodM[2]) : null;
    const startYear = periodStart ? parseInt(periodStart.slice(0, 4), 10) : null;
    const startMonth = periodStart ? parseInt(periodStart.slice(5, 7), 10) : null;
    const endYear = periodEnd ? parseInt(periodEnd.slice(0, 4), 10) : startYear;

    const info = {
      bank: "BBVA",
      cardName: "Cuenta débito BBVA",
      accountType: "debit",
      last4: accM ? accM[1].slice(-4) : null,
      periodStart,
      periodEnd,
      cutDate: cutM ? parseSlashDate(cutM[1]) : null,
      dueDate: null,
      limitCents: null,
      payToAvoidInterestCents: null,
      minPaymentCents: null,
      startBalanceCents: anteriorM ? toCents(anteriorM[1]) : null,
      endBalanceCents: finalM ? toCents(finalM[1]) : null,
    };

    // ---- Renglones del detalle de movimientos ----
    const rows = [];
    let inSection = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/Detalle de Movimientos Realizados/i.test(line)) { inSection = true; continue; }
      if (!inSection) continue;
      if (/Total de Movimientos|TOTAL IMPORTE/i.test(line)) { inSection = false; continue; }

      const row = ROW.exec(line);
      if (row) {
        const tailAll = row[5];
        const tokens = [];
        let tail = tailAll;
        const tailM = /((?:\s+-?\d{1,3}(?:,\d{3})*\.\d{2}){1,3})\s*$/.exec(tailAll);
        if (tailM) {
          tail = tailAll.slice(0, tailM.index);
          tailM[1].trim().split(/\s+/).forEach((t) => tokens.push(t));
        }
        const day = parseInt(row[1], 10);
        const month = monthOf(row[2]);
        const endRowMonth = monthOf(row[4]);
        if (!month || !tokens.length) { warnings.push(`No se entendió un renglón: "${line.slice(0, 40)}…"`); continue; }
        const year = startMonth && month < startMonth ? endYear : startYear;
        const date = year ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
        void endRowMonth;
        rows.push({
          date,
          amountCents: toCents(tokens[0]),
          saldoCents: tokens[1] ? toCents(tokens[1]) : null,
          tail: tail.replace(/\s+/g, " ").trim(),
          extra: [],
        });
        continue;
      }
      // Renglón de continuación (referencia o concepto) de la operación anterior
      if (!rows.length) continue;
      if (/PAGINA|Estado de Cuenta|No\.\s*de\s*Cuenta|FECHA|OPERACI|DESCRIPCI|SALDO|MONTO|CARGO|ABONO|CLABE|RFC|Periodo|GAT|BBVA MEXICO|Libret|Cuenta Digital|Hoja/i.test(line)) continue;
      rows[rows.length - 1].extra.push(line);
    }

    // ---- Signo por cadena de saldos ----
    let balance = info.startBalanceCents;
    let pending = [];
    for (const r of rows) {
      pending.push(r);
      if (r.saldoCents === null) continue;
      if (balance === null) { warnings.push("Falta el saldo anterior; no se pudo deducir el signo de algunos movimientos."); balance = r.saldoCents; pending = []; continue; }
      const signs = pending.length <= MAX_UNKNOWN ? solveSigns(balance, pending, r.saldoCents) : null;
      if (signs) pending.forEach((p, j) => { p.sign = signs[j]; });
      else { warnings.push("Algunos movimientos no cuadran con el saldo; revísalos (se tomaron como cargo)."); pending.forEach((p) => { p.sign = -1; }); }
      balance = r.saldoCents;
      pending = [];
    }
    if (pending.length) {
      const signs = info.endBalanceCents !== null && balance !== null && pending.length <= MAX_UNKNOWN
        ? solveSigns(balance, pending, info.endBalanceCents) : null;
      if (signs) pending.forEach((p, j) => { p.sign = signs[j]; });
      else { warnings.push("Algunos movimientos no cuadran con el saldo; revísalos (se tomaron como cargo)."); pending.forEach((p) => { p.sign = -1; }); }
    }

    // ---- Movimientos finales ----
    const movements = rows.map((r) => {
      const rawDescription = [r.tail, ...r.extra].join(" ").replace(/\s+/g, " ").trim();
      const isTransfer = r.sign === -1 && TRANSFER_CARD.test(r.tail);
      const kind = r.sign === 1 ? "refund" : isTransfer ? "transfer" : "charge";
      return {
        date: r.date,
        postDate: r.date,
        kind,
        amountCents: r.amountCents,
        rawDescription,
        description: kind === "transfer" ? "Pago a tarjeta de crédito" : cleanDescription(r.tail),
        holder: "titular",
      };
    });

    // ---- Verificación contra los totales del estado de cuenta ----
    const sum = (kinds) => movements.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + m.amountCents, 0);
    const count = (kinds) => movements.filter((m) => kinds.includes(m.kind)).length;
    const expectedCharges = totalChargesM ? toCents(totalChargesM[1]) : null;
    const expectedPayments = totalPaymentsM ? toCents(totalPaymentsM[1]) : null;
    const parsedCharges = sum(["charge", "transfer"]);
    const parsedPayments = sum(["refund"]);
    const reconciliation = {
      parsedCharges,
      parsedPayments,
      expectedCharges,
      expectedPayments,
      parsedChargeCount: count(["charge", "transfer"]),
      parsedPaymentCount: count(["refund"]),
      expectedChargeCount: totalChargesM ? parseInt(totalChargesM[2], 10) : null,
      expectedPaymentCount: totalPaymentsM ? parseInt(totalPaymentsM[2], 10) : null,
      ok: expectedCharges !== null && expectedPayments !== null && parsedCharges === expectedCharges && parsedPayments === expectedPayments,
    };
    if (info.startBalanceCents !== null && info.endBalanceCents !== null && depositsM && withdrawalsM) {
      const calc = info.startBalanceCents + toCents(depositsM[1]) - toCents(withdrawalsM[1]);
      if (calc !== info.endBalanceCents) warnings.push("El saldo inicial, los abonos, los cargos y el saldo final no cuadran.");
    }

    return { info, movements, warnings, reconciliation };
  }

  return { id: "bbva-debit", label: "BBVA · cuenta de débito", detect, parse, cleanDescription, parseSlashDate };
});
