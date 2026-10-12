/**
 * revolut-savings.js — Lector del estado de cuenta de Revolut (cuenta en pesos + Rendimientos Diarios).
 *
 * Renglón de movimiento:  "15 sept 2026  Transferencia SPEI recibida de STP  $8,500.00  $8,500.00"
 * - Transferencias recibidas de otras personas -> abono (refund): úsalo como "Reembolso de…" si aplica.
 * - Transferencias enviadas -> cargo (charge).
 * - Movimientos entre la cuenta y Rendimientos Diarios, y transferencias de tu propio nombre -> pago (no se importan).
 * - "Interés neto pagado" no se importa: los rendimientos los calcula la app con la tasa de la cuenta.
 *
 * El nombre del titular se toma del propio estado de cuenta (no se guarda en el código).
 * Funciona en el navegador (window.RevolutSavingsImporter) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RevolutSavingsImporter = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
  const ROW = /^\s*(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep(?:t)?|oct|nov|dic)\.?\s+(\d{4})\s+(.*)$/i;
  const MONEY = /\$([\d,]+\.\d{2})/g;
  const INTEREST = /Inter[eé]s neto pagado/i;
  const INTERNAL = /Rendimientos Diarios/i;
  const NOISE = /Reportar tarjeta|Revolut Bank|Juárez|\+52|Obtener ayuda|Escanear|©|Página \d|Estado de cuenta en MXN|^\s*Desde \d|Fecha\s+Descripci|Transacciones de|Resumen de|IPAB|Instituto|Tiene 90 d|une@revolut|condusef|banxico|Comisiones|Descripción\s+Importe/i;

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

  function detect(lines) {
    const text = lines.join("\n");
    return /Revolut/i.test(text)
      && /Rendimientos Diarios/i.test(text)
      && /Estado de cuenta en MXN/i.test(text)
      && /Saldo inicial/i.test(text);
  }

  /** Nombre del titular: la línea en mayúsculas justo debajo del encabezado */
  function findHolder(lines) {
    for (const l of lines.slice(0, 20)) {
      const t = l.trim();
      if (/^[A-ZÁÉÍÓÚÑ ]{8,}$/.test(t) && !/REVOLUT|ESTADO|CUENTA/.test(t)) return t;
    }
    return "";
  }

  /** Transferencia de tu propio nombre (de otra cuenta tuya): nombre de pila + apellido paterno */
  function isOwnName(description, holder) {
    const parts = normalize(holder).split(" ").filter((p) => p.length > 2);
    if (parts.length < 2) return false;
    const d = normalize(description);
    return d.includes(parts[0]) && d.includes(parts[parts.length - 2]);
  }

  function parse(lines) {
    const warnings = [];
    const text = lines.join("\n");
    const holder = findHolder(lines);

    const periodM = /Desde\s+(\d{1,2}) de (\w+) de (\d{4})\s+hasta\s+(\d{1,2}) de (\w+) de (\d{4})/i.exec(text);
    const monthOf = (name) => MONTHS[normalize(name).slice(0, 3)] || null;
    let periodStart = null;
    let periodEnd = null;
    if (periodM) {
      const m1 = monthOf(periodM[2]);
      const m2 = monthOf(periodM[5]);
      if (m1 && m2) {
        periodStart = `${periodM[3]}-${String(m1).padStart(2, "0")}-${String(periodM[1]).padStart(2, "0")}`;
        periodEnd = `${periodM[6]}-${String(m2).padStart(2, "0")}-${String(periodM[4]).padStart(2, "0")}`;
      }
    }
    const accM = /Número de cuenta\s+(\d{4,})/i.exec(text);
    const startM = /Saldo inicial\s+\$([\d,]+\.\d{2})/i.exec(text);
    const endAll = [...text.matchAll(/Saldo final\s+\$([\d,]+\.\d{2})/gi)];
    const endM = endAll.length ? endAll[endAll.length - 1] : null;

    const info = {
      bank: "Revolut",
      cardName: "Cuenta Revolut (rendimientos)",
      accountType: "savings",
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

    // ---- Renglones de movimientos (ambas secciones; los intereses se omiten) ----
    const rows = [];
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim()) continue;
      const row = ROW.exec(line);
      if (row) {
        const month = MONTHS[row[2].toLowerCase().slice(0, 3)];
        rows.push({
          date: `${row[3]}-${String(month).padStart(2, "0")}-${String(row[1]).padStart(2, "0")}`,
          head: row[4],
          extra: [],
        });
        continue;
      }
      if (!rows.length || NOISE.test(line)) continue;
      // Línea de continuación del renglón anterior (concepto, "De …", y el año de la fecha partida)
      const last = rows[rows.length - 1];
      if (!/^\s*\d{4}\s*$/.test(line)) last.extra.push(line.trim());
    }

    const seen = new Set();
    const movements = [];
    for (const r of rows) {
      if (INTEREST.test(r.head)) continue; // rendimientos: la app los calcula
      const amountM = /\$([\d,]+\.\d{2})/.exec(r.head);
      if (!amountM) { warnings.push(`No encontré el monto de un movimiento del ${r.date}.`); continue; }
      const amountCents = toCents(amountM[1]);
      const concept = r.head.slice(0, amountM.index).replace(/\s+/g, " ").trim();
      const rawDescription = [concept, ...r.extra].join(" ").replace(/\s+/g, " ").trim();

      // Evita contar dos veces el mismo movimiento si aparece en ambas secciones
      const key = `${r.date}|${amountCents}|${normalize(concept)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let kind;
      const incoming = /recibid[oa]|entrante/i.test(concept);
      if (INTERNAL.test(concept) || isOwnName(rawDescription, holder)) kind = "payment";
      else kind = incoming ? "refund" : "charge";

      movements.push({
        date: r.date,
        postDate: r.date,
        kind,
        amountCents,
        rawDescription,
        description: kind === "payment" ? "Movimiento entre tu cuenta y rendimientos" : concept.charAt(0).toUpperCase() + concept.slice(1).toLowerCase(),
        holder: "titular",
      });
    }

    const parsedCharges = movements.filter((m) => m.kind === "charge").reduce((s, m) => s + m.amountCents, 0);
    const parsedPayments = movements.filter((m) => m.kind === "refund").reduce((s, m) => s + m.amountCents, 0);
    warnings.push("Los rendimientos (intereses) no se importan: la app los calcula con la tasa de la cuenta, así que este estado no cuadra en el total.");
    return {
      info,
      movements,
      warnings,
      reconciliation: {
        parsedCharges,
        parsedPayments,
        expectedCharges: null,
        expectedPayments: null,
        parsedChargeCount: movements.filter((m) => m.kind === "charge").length,
        parsedPaymentCount: movements.filter((m) => m.kind === "refund").length,
        expectedChargeCount: null,
        expectedPaymentCount: null,
        ok: false,
      },
    };
  }

  return { id: "revolut-savings", label: "Revolut · cuenta de rendimientos", detect, parse };
});
