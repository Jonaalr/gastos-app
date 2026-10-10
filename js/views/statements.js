/**
 * statements.js — Estados de cuenta: qué estados ya cargaste por cuenta y cuáles faltan.
 *
 * No guarda nada nuevo: cada estado importado deja sus movimientos con una clave
 * `importBatch` ("banco-últimos4-fecha de corte"). Aquí se agrupan esas claves.
 */

/** "BBVA-1234-2026-09-30" -> { bank, last4, cutDate } ("s/f" = sin fecha de corte) */
function parseStatementKey(key) {
  const m = /^(.*)-(\d{4})-(\d{4}-\d{2}-\d{2}|s\/f)$/.exec(key || "");
  if (!m) return { bank: key || "Estado de cuenta", last4: "", cutDate: null };
  return { bank: m[1], last4: m[2], cutDate: m[3] === "s/f" ? null : m[3] };
}

/** Un registro por estado importado, con su cuenta, rango de fechas y cuántos movimientos trajo */
async function loadStatements() {
  const txs = (await DB.getAll("transactions")).filter((t) => t.source === "import" && t.importBatch);
  const byKey = {};
  for (const t of txs) {
    const s = byKey[t.importBatch] || (byKey[t.importBatch] = {
      key: t.importBatch, accountId: t.accountId, count: 0, from: t.date, to: t.date, importedAt: t.createdAt || "",
    });
    s.count += 1;
    if (t.date < s.from) s.from = t.date;
    if (t.date > s.to) s.to = t.date;
    if (t.createdAt && (!s.importedAt || t.createdAt < s.importedAt)) s.importedAt = t.createdAt;
  }
  return Object.values(byKey)
    .map((s) => ({ ...s, ...parseStatementKey(s.key) }))
    .sort((a, b) => (b.cutDate || b.to).localeCompare(a.cutDate || a.to));
}

/** Mes (YYYY-MM) al que pertenece un estado: el de su corte, o el último movimiento si no tiene corte */
function statementMonth(s) {
  return DateUtil.monthKey(s.cutDate || s.to);
}

async function renderStatements(root) {
  const [statements, accounts] = await Promise.all([loadStatements(), DB.getAll("accounts")]);
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Estados de cuenta")]));
  root.appendChild(el("div", { class: "muted", style: "font-size:13px;margin:-4px 0 12px;" },
    "Cada mes ves si ya cargaste el estado de tu tarjeta. Los meses sin ✓ te faltan."));

  // Últimos 12 meses (terminando en el actual)
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(DateUtil.monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));

  // Cuentas que se muestran: tarjetas de crédito y cualquier cuenta que ya tenga estados
  const shown = accounts.filter((a) => !a.archived && (a.type === "credit" || statements.some((s) => s.accountId === a.id)));

  if (shown.length === 0) {
    root.appendChild(el("div", { class: "card" }, [el("div", { class: "empty-state" }, "Aún no has cargado estados de cuenta. Cuando importes uno, aparecerá aquí.")]));
  }

  for (const a of shown) {
    const mine = statements.filter((s) => s.accountId === a.id);
    const loaded = new Set(mine.map(statementMonth));
    const createdMonth = a.createdAt ? DateUtil.monthKey(a.createdAt) : null;
    const loadedCount = months.filter((k) => loaded.has(k)).length;
    const grid = el("div", { class: "stmt-grid" }, months.map((k) => {
      const before = createdMonth && k < createdMonth;
      const on = loaded.has(k);
      const label = MESES_ES[Number(k.split("-")[1]) - 1].slice(0, 3);
      return el("div", { class: `stmt-m${on ? " on" : ""}${before ? " before" : ""}`, title: `${label} ${k.split("-")[0]}` }, [
        el("div", { class: "stmt-name" }, label),
        el("div", { class: "stmt-mark" }, on ? "✓" : before ? "" : "—"),
      ]);
    }));
    root.appendChild(el("div", { class: "card", style: "margin-top:12px;" }, [
      el("div", { class: "flex-between" }, [
        el("div", { class: "title", style: "font-weight:700;" }, a.name),
        el("div", { class: "muted", style: "font-size:12px;" }, `${loadedCount} de ${months.length} meses`),
      ]),
      grid,
    ]));
  }

  if (statements.length > 0) {
    root.appendChild(el("div", { class: "section-heading", style: "margin:18px 0 0;" }, "Estados cargados"));
    for (const s of statements) {
      const acc = accMap[s.accountId];
      const cutTxt = s.cutDate ? `Corte ${DateUtil.formatLong(s.cutDate)}` : `Movimientos del ${DateUtil.formatShort(s.from)} al ${DateUtil.formatShort(s.to)}`;
      const importedTxt = s.importedAt ? ` · importado ${DateUtil.formatShort(s.importedAt.slice(0, 10))}` : "";
      root.appendChild(el("div", { class: "card", style: "margin-top:12px;" }, [
        el("div", { class: "flex-between" }, [
          el("div", {}, [
            el("div", { class: "title", style: "font-weight:700;" }, `${s.bank}${s.last4 ? ` · ···${s.last4}` : ""}`),
            el("div", { class: "meta muted", style: "font-size:12px;" }, `${acc ? acc.name : "Cuenta eliminada"} · ${cutTxt}`),
          ]),
          el("strong", { style: "white-space:nowrap;margin-left:10px;" }, `${s.count} mov.`),
        ]),
        s.importedAt ? el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" }, `Importado${importedTxt.replace(" · importado", " el")}`) : null,
      ]));
    }
  }

  root.appendChild(el("button", { class: "btn", style: "margin-top:12px;", onclick: () => Router.navigate("/import") }, "+ Importar estado de cuenta"));
}

window.renderStatements = renderStatements;
