/**
 * nu-debit.js — Lector del estado de cuenta de la cuenta de débito Nu (no la tarjeta de crédito).
 *
 * Renglón de movimiento:  "05 SEP 2026   Compra en OXXO   -$123.00"
 * El signo viene explícito (+$ / -$), así que no hace falta deducirlo con saldos.
 * - Pago a tu tarjeta de crédito Nu  -> transferencia (no gasto ni ingreso).
 * - Movimientos de cajitas y transferencias entre tus propias cuentas -> no se importan (payment).
 * - Abonos de terceros (+$) -> ingreso sin categoría (refund).
 * - Cargos (-$) -> gasto.
 *
 * El nombre del titular se toma del propio estado de cuenta (no se guarda en el código).
 * Funciona en el navegador (window.NuDebitImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NuDebitImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };
  const ROW = /^\s*(\d{2})\s+([A-Z]{3})\s+(\d{4})\s*(.*)$/;
  const AMOUNT_END = /(?:^|\s)([+-])\$([\d,]+\.\d{2})\s*$/;
  const AMOUNT_ONLY = /^\s*([+-])\$([\d,]+\.\d{2})\s*$/;
  const TRANSFER_CARD = /Pago a tu tarjeta de cr[eé]dito/i;
  const CAJITA = /Cajita/i;
  const SECTION_START = /Detalle de movimientos en tu cuenta/i;
  const SECTION_END = /Detalle de movimientos de tus cajitas|Con estos movimientos|DINERO GENERADO|CONTACTO/i;
  const PAGE_NOISE = /Nubank, S\.A\.|C\.P\.|Cuenta Nu|FECHA|MONTO EN PESOS|Detalle de movimientos|Gr[aá]fico Transaccional|^\s*\d+\s+de\s+\d+\s*$/i;

  function toCents(text) {
    return Math.round(parseFloat(String(text).replace(/,/g, "")) * 100);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** "PAGO DE NOMINA" -> "Pago de nomina" */
  function cleanDescription(raw) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  function detect(lines) {
    const text = lines.join("\n");
    return /Nubank|\bNu\b/i.test(text)
      && SECTION_START.test(text)
      && /Saldo inicial/i.test(text)
      && !/CARGOS,?\s*ABONOS Y COMPRAS REGULARES/i.test(text);
  }

  /** Nombre del titular: la línea justo arriba de "Cuenta Nu:" */
  function findHolder(lines) {
    const idx = lines.findIndex((l) => /Cuenta Nu\s*:/i.test(l));
    for (let i = idx - 1; i >= 0 && i >= idx - 3; i--) {
      const t = lines[i].trim();
      if (t && !/Nubank|RFC|CLABE|Periodo/i.test(t)) return t;
    }
    return "";
  }

  /** Transferencia a tu propio nombre (otra cuenta tuya): nombre de pila + apellido paterno */
  function isOwnName(description, holder) {
    const parts = normalize(holder).split(" ").filter((p) => p.length > 2);
    if (parts.length < 2) return false;
    const first = parts[0];
    const paternal = parts[parts.length - 2];
    const d = normalize(description);
    return d.includes(first) && d.includes(paternal);
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const first = (re) => re.exec(text);

    const holder = findHolder(lines);
    const periodM = first(/DEL\s+(\d{2})\s+AL\s+(\d{2})\s+([A-Z]{3})\s+(\d{4})/i);
    const accM = first(/Cuenta Nu\s*:\s*(\d{4,})/i);
    const startM = first(/Saldo inicial\s+\$([\d,]+\.\d{2})/i);
    const endM = first(/Saldo al generar este estado de cuenta\s+\$([\d,]+\.\d{2})/i);

    const monthNum = periodM ? MONTHS[periodM[3].toUpperCase()] : null;
    const year = periodM ? parseInt(periodM[4], 10) : null;
    const periodStart = periodM && monthNum ? `${year}-${String(monthNum).padStart(2, "0")}-${periodM[1]}` : null;
    const periodEnd = periodM && monthNum ? `${year}-${String(monthNum).padStart(2, "0")}-${periodM[2]}` : null;

    const info = {
      bank: "Nu",
      cardName: "Cuenta de débito Nu",
      accountType: "debit",
      last4: accM ? accM[1].slice(-4) : null,
      periodStart,
      periodEnd,
      cutDate: periodEnd,
      dueDate: null,
      limitCents: null,
      payToAvoidInterestCents: null,
      minPaymentCents: null,
      startBalanceCents: startM ? toCents(startM[1]) : null,
      endBalanceCents: endM ? toCents(endM[1]) : null,
    };

    // ---- Renglones de la sección "Detalle de movimientos en tu cuenta" ----
    const rows = [];
    let inSection = false;
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim()) continue;
      if (SECTION_START.test(line)) { inSection = true; continue; }
      if (inSection && SECTION_END.test(line)) { inSection = false; continue; }
      if (!inSection) continue;
      if (holder && line.trim() === holder) continue;
      if (PAGE_NOISE.test(line)) continue;

      const row = ROW.exec(line);
      if (row) {
        const month = MONTHS[row[2].toUpperCase()];
        if (!month) { warnings.push(`No se entendió la fecha de un renglón: "${line.trim().slice(0, 30)}…"`); continue; }
        rows.push({
          date: `${row[3]}-${String(month).padStart(2, "0")}-${row[1]}`,
          head: row[4],
          extra: [],
          amountCents: null,
          sign: null,
        });
        continue;
      }
      if (!rows.length) continue;
      const last = rows[rows.length - 1];
      const amountOnly = AMOUNT_ONLY.exec(line);
      if (amountOnly && last.amountCents === null) {
        last.sign = amountOnly[1] === "+" ? 1 : -1;
        last.amountCents = toCents(amountOnly[2]);
        continue;
      }
      last.extra.push(line.trim());
    }

    // Monto: al final del renglón de fecha, o en la línea que sigue
    const movements = [];
    for (const r of rows) {
      if (r.amountCents === null) {
        const endM2 = AMOUNT_END.exec(r.head);
        if (endM2) {
          r.sign = endM2[1] === "+" ? 1 : -1;
          r.amountCents = toCents(endM2[2]);
          r.head = r.head.slice(0, endM2.index);
        }
      } else {
        // el monto ya vino en su propia línea; el renglón puede traer otro token al final
        r.head = r.head.replace(AMOUNT_END, "");
      }
      if (r.amountCents === null) { warnings.push(`No encontré el monto de un movimiento del ${r.date}.`); continue; }

      const chunks = r.head.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
      const concept = chunks.join(" · ");
      const rawDescription = [r.head.trim(), ...r.extra].join(" ").replace(/\s+/g, " ").trim();

      let kind;
      if (TRANSFER_CARD.test(concept)) kind = "transfer";
      else if (CAJITA.test(concept) || isOwnName(concept, holder)) kind = "payment";
      else kind = r.sign === 1 ? "refund" : "charge";

      movements.push({
        date: r.date,
        postDate: r.date,
        kind,
        amountCents: r.amountCents,
        rawDescription,
        description: kind === "transfer" ? "Pago a tarjeta de crédito Nu" : cleanDescription(concept || "Movimiento"),
        holder: "titular",
      });
    }

    // ---- Verificación: saldo inicial + todos los movimientos = saldo final ----
    const netCents = rows.reduce((s, r) => s + (r.amountCents === null ? 0 : r.sign * r.amountCents), 0);
    const sum = (kinds) => movements.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + m.amountCents, 0);
    const count = (kinds) => movements.filter((m) => kinds.includes(m.kind)).length;
    const balanceOk = info.startBalanceCents !== null && info.endBalanceCents !== null
      && netCents === info.endBalanceCents - info.startBalanceCents;
    if (!balanceOk && info.startBalanceCents !== null && info.endBalanceCents !== null) {
      warnings.push("El saldo inicial, los movimientos y el saldo final no cuadran.");
    }
    const parsedCharges = sum(["charge"]);
    const parsedPayments = sum(["refund"]);
    const reconciliation = {
      parsedCharges,
      parsedPayments,
      expectedCharges: balanceOk ? parsedCharges : null,
      expectedPayments: balanceOk ? parsedPayments : null,
      parsedChargeCount: count(["charge"]),
      parsedPaymentCount: count(["refund"]),
      expectedChargeCount: null,
      expectedPaymentCount: null,
      ok: balanceOk,
    };

    return { info, movements, warnings, reconciliation };
  }

  return { id: "nu-debit", label: "Nu · cuenta de débito", detect, parse, cleanDescription };
});
