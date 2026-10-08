/**
 * pdf-lines.js — Convierte un PDF (ya abierto con pdf.js) en líneas de texto.
 *
 * pdf.js entrega fragmentos de texto sueltos con su posición (x, y). Aquí los
 * agrupamos por renglón (misma altura) y los ordenamos de izquierda a derecha,
 * separando las columnas con dos espacios. Así cada renglón visual del estado
 * de cuenta queda como una línea de texto que los lectores por banco pueden analizar.
 *
 * Funciona igual en el navegador (window.PdfLines) y en Node para pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PdfLines = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ROW_TOLERANCE = 3; // puntos de diferencia vertical que aún cuentan como el mismo renglón
  const COLUMN_GAP = 9; // hueco horizontal a partir del cual se considera otra columna

  function itemsToLines(items) {
    const cells = items
      .filter((it) => it.str !== undefined && it.str.trim() !== "")
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }));

    // De arriba hacia abajo (en PDF la "y" crece hacia arriba)
    cells.sort((a, b) => b.y - a.y || a.x - b.x);

    const rows = [];
    for (const c of cells) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - c.y) <= ROW_TOLERANCE) row.cells.push(c);
      else rows.push({ y: c.y, cells: [c] });
    }

    return rows.map((row) => {
      row.cells.sort((a, b) => a.x - b.x);
      let text = "";
      let prevEnd = null;
      for (const c of row.cells) {
        if (prevEnd !== null) {
          const gap = c.x - prevEnd;
          text += gap > COLUMN_GAP ? "  " : gap > 1 ? " " : "";
        }
        text += c.str.trim();
        prevEnd = c.x + c.w;
      }
      return text.trim();
    });
  }

  /** @returns {Promise<string[]>} todas las líneas del documento, página por página */
  async function extractLines(pdfDoc) {
    const lines = [];
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const page = await pdfDoc.getPage(n);
      const content = await page.getTextContent();
      for (const line of itemsToLines(content.items)) if (line) lines.push(line);
      lines.push("\f"); // marca de fin de página
    }
    return lines;
  }

  return { extractLines, itemsToLines };
});
