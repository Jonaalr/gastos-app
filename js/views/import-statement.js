/**
 * import-statement.js — Importar movimientos desde un estado de cuenta en PDF.
 *
 * Flujo: elegir cuenta y PDF -> el PDF se lee AQUÍ, en el teléfono (no se sube a ningún lado)
 * -> pantalla de revisión (categoría por movimiento, duplicados marcados) -> guardar.
 * Los movimientos importados son historial: NO modifican el saldo de la cuenta.
 */

let pdfjsPromise = null;

/** Carga pdf.js solo cuando se necesita (pesa ~1.8 MB y no hace falta para abrir la app) */
function loadPdfJs() {
  if (!pdfjsPromise) {
    const base = new URL("vendor/pdfjs/", document.baseURI).href;
    pdfjsPromise = import(base + "pdf.min.js").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
      return mod;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

function askPdfPassword(wasWrong) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "sheet-backdrop" });
    const sheet = el("div", { class: "sheet" });
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    sheet.innerHTML = `
      <div class="sheet-header"><h2>PDF protegido</h2></div>
      <div class="form-group">
        <label>${wasWrong ? "Contraseña incorrecta, intenta de nuevo" : "Escribe la contraseña del estado de cuenta"}</label>
        <input type="password" id="f-pdfpass" autocomplete="off">
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="f-pdfcancel">Cancelar</button>
        <button class="btn" id="f-pdfok">Abrir</button>
      </div>`;
    const done = (value) => { backdrop.remove(); resolve(value); };
    sheet.querySelector("#f-pdfok").addEventListener("click", () => done(sheet.querySelector("#f-pdfpass").value));
    sheet.querySelector("#f-pdfcancel").addEventListener("click", () => done(null));
    setTimeout(() => sheet.querySelector("#f-pdfpass").focus(), 50);
  });
}

async function readPdfLines(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  task.onPassword = async (updatePassword, reason) => {
    const password = await askPdfPassword(reason === 2);
    if (password === null) task.destroy();
    else updatePassword(password);
  };
  const doc = await task.promise;
  try {
    return await PdfLines.extractLines(doc);
  } finally {
    try { await task.destroy(); } catch (e) { /* liberar memoria; si falla no importa */ }
  }
}

function categoryOptions(categories) {
  const parents = categories.filter((c) => !c.parentId);
  const options = [];
  for (const p of parents) {
    options.push({ id: p.id, label: `${p.icon || ""} ${p.name}`.trim() });
    for (const child of categories.filter((c) => c.parentId === p.id)) {
      options.push({ id: child.id, label: `${p.name} › ${child.name}` });
    }
  }
  return options;
}

async function renderImportStatement(root, params) {
  const [accounts, categories, allTx, memory] = await Promise.all([
    DB.getAll("accounts"),
    DB.getAll("categories"),
    DB.getAll("transactions"),
    DB.getMeta("merchantCategories", {}),
  ]);
  const activeAccounts = accounts.filter((a) => !a.archived);
  const expenseCategories = categories.filter((c) => c.kind === "expense");
  let catOptions = categoryOptions(expenseCategories);

  const preselected = parseInt(params.get("account") || "0", 10) || null;
  const state = {
    accountId: preselected || (activeAccounts.find((a) => a.type === "credit") || activeAccounts[0] || {}).id || null,
    importer: null,
    parsed: null,
    rows: [],
    updateCard: false,
  };

  root.appendChild(
    el("div", { class: "topbar" }, [
      el("div", {}, [el("h1", {}, "Importar estado de cuenta"), el("div", { class: "subtitle" }, "El PDF se lee en tu teléfono, no se sube a ningún lado")]),
    ])
  );

  if (activeAccounts.length === 0) {
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "empty-state" }, "Primero crea la cuenta o tarjeta a la que pertenece el estado de cuenta."),
        el("button", { class: "btn", onclick: () => Router.navigate("/accounts") }, "Ir a Cuentas"),
      ])
    );
    return;
  }

  // ---------- Paso 1: cuenta + archivo ----------
  const accountSelect = el("select", { id: "imp-account" }, activeAccounts.map((a) => el("option", { value: a.id }, `${a.name}${a.type === "credit" ? " (crédito)" : ""}`)));
  accountSelect.value = state.accountId;
  const fileInput = el("input", { type: "file", id: "imp-file", accept: "application/pdf,.pdf", style: "display:none;" });
  const status = el("div", { class: "field-hint", style: "margin-top:10px;" });
  const pickCard = el("div", { class: "card" }, [
    el("div", { class: "form-group" }, [el("label", {}, "¿A qué cuenta pertenece?"), accountSelect]),
    el("button", { class: "btn", id: "imp-pick" }, "Elegir estado de cuenta (PDF)"),
    fileInput,
    status,
    el("div", { class: "field-hint" }, `Formatos que reconozco: ${StatementImporters.list.map((i) => i.label).join(", ")}.`),
  ]);
  root.appendChild(pickCard);
  const reviewBox = el("div", { id: "imp-review" });
  root.appendChild(reviewBox);

  accountSelect.addEventListener("change", () => {
    state.accountId = parseInt(accountSelect.value, 10);
    if (state.parsed) { prepareRows(); renderReview(); }
  });
  root.querySelector("#imp-pick").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    reviewBox.innerHTML = "";
    state.parsed = null;
    status.textContent = "Leyendo estado de cuenta…";
    try {
      const lines = await readPdfLines(file);
      if (lines.filter((l) => l.trim() && l !== "\f").length < 5) {
        status.textContent = "Este PDF no tiene texto (parece una foto o un escaneo), así que no puedo leerlo todavía.";
        return;
      }
      const importer = StatementImporters.detect(lines);
      if (!importer) {
        status.textContent = "Todavía no reconozco el formato de este estado de cuenta. Envíame un ejemplo de ese banco y lo agrego.";
        return;
      }
      const parsed = importer.parse(lines);
      if (parsed.movements.length === 0) {
        status.textContent = "Reconocí el estado de cuenta pero no encontré movimientos.";
        return;
      }
      state.importer = importer;
      state.parsed = parsed;
      // Si ya importaste otro estado de esta tarjeta, elegir su cuenta automáticamente
      const match = activeAccounts.find((a) => parsed.info.last4 && a.statementLast4 === parsed.info.last4);
      if (match) { state.accountId = match.id; accountSelect.value = match.id; }
      status.textContent = "";
      prepareRows();
      renderReview();
    } catch (err) {
      console.error(err);
      status.textContent = err && err.name === "PasswordException" ? "No se pudo abrir: contraseña incorrecta." : "No pude leer ese archivo. ¿Es un PDF de estado de cuenta?";
    }
  });

  // ---------- Preparar filas (categorías y duplicados) ----------
  function prepareRows() {
    const { info, movements } = state.parsed;
    const importedKeys = new Set(allTx.filter((t) => t.importKey).map((t) => t.importKey));
    const manualTx = allTx.filter((t) => t.accountId === state.accountId && t.type === "expense" && !t.importKey);
    const seen = {};

    state.rows = movements
      .filter((m) => m.kind !== "payment")
      .map((m, i) => {
        const base = `${info.last4}|${m.date}|${m.amountCents}|${StatementImporters.merchantKey(m.rawDescription)}`;
        seen[base] = (seen[base] || 0) + 1;
        const importKey = `${base}#${seen[base]}`;

        let dup = null;
        if (importedKeys.has(importKey)) dup = { label: "Ya importado" };
        else if (m.kind === "charge") {
          const similar = manualTx.find((t) => t.amountCents === m.amountCents && Math.abs(DateUtil.daysBetween(t.date, m.date)) <= 3);
          if (similar) dup = { label: `Parecido a uno que ya registraste (${DateUtil.formatShort(similar.date)})` };
        }

        const refund = m.kind === "refund";
        return {
          i,
          m,
          importKey,
          dup,
          selected: !dup,
          refund,
          categoryId: refund ? null : StatementImporters.suggestCategoryId(m.description, expenseCategories, memory),
          manual: false,
          shared: false,
        };
      });

    // ¿Conviene ofrecer actualizar la tarjeta con los datos del estado de cuenta?
    const account = activeAccounts.find((a) => a.id === state.accountId);
    const ageDays = info.cutDate ? DateUtil.daysBetween(info.cutDate, DateUtil.todayISO()) : 9999;
    state.cardChanges = account && account.type === "credit" ? cardChangeList(account, info) : [];
    state.statementAgeDays = ageDays;
    state.updateCard = state.cardChanges.length > 0 && ageDays <= 70;
  }

  function cardChangeList(account, info) {
    const changes = [];
    if (info.limitCents && info.limitCents !== account.creditLimitCents) changes.push(`límite ${Money.format(info.limitCents)}`);
    const cutDay = info.cutDate ? DateUtil.parseISO(info.cutDate).getDate() : null;
    const dueDay = info.dueDate ? DateUtil.parseISO(info.dueDate).getDate() : null;
    if (cutDay && cutDay !== account.cutDay) changes.push(`corte día ${cutDay}`);
    if (dueDay && dueDay !== account.dueDay) changes.push(`pago límite día ${dueDay}`);
    return changes;
  }

  // ---------- Paso 2: revisión ----------
  function renderReview() {
    reviewBox.innerHTML = "";
    const { info, reconciliation, warnings, movements } = state.parsed;
    const payments = movements.filter((m) => m.kind === "payment");
    const period = info.periodStart && info.periodEnd ? `${DateUtil.formatShort(info.periodStart)} – ${DateUtil.formatShort(info.periodEnd)} ${DateUtil.parseISO(info.periodEnd).getFullYear()}` : "";

    // Resumen
    const summary = el("div", { class: "card" }, [
      el("div", { class: "flex-between" }, [
        el("div", {}, [el("div", { class: "title", style: "font-weight:700;" }, `${info.bank} · ${info.cardName}${info.last4 ? " ···" + info.last4 : ""}`), el("div", { class: "meta text-dim", style: "font-size:12px;margin-top:2px;" }, period)]),
      ]),
      el(
        "div",
        { class: `imp-check-badge ${reconciliation.ok ? "ok" : "warn"}` },
        reconciliation.ok
          ? `Cuadra con tu estado de cuenta · cargos ${Money.format(reconciliation.expectedCharges)}`
          : `No cuadra con los totales del estado de cuenta (leí cargos ${Money.format(reconciliation.parsedCharges)}${reconciliation.expectedCharges !== null ? " de " + Money.format(reconciliation.expectedCharges) : ""}). Revisa la lista antes de importar.`
      ),
      ...warnings.map((w) => el("div", { class: "field-hint", style: "color:var(--warn);" }, w)),
    ]);

    if (state.cardChanges.length) {
      const old = state.statementAgeDays > 70;
      const chk = el("input", { type: "checkbox", id: "imp-updatecard" });
      chk.checked = state.updateCard;
      chk.addEventListener("change", () => { state.updateCard = chk.checked; });
      summary.appendChild(
        el("label", { class: "checkbox-row", style: "margin-top:12px;" }, [
          chk,
          el("span", { style: "font-size:13px;" }, `Actualizar mi tarjeta: ${state.cardChanges.join(" · ")}${old ? ` (este estado de cuenta es de hace ${Math.round(state.statementAgeDays / 30)} meses, por eso no lo marqué)` : ""}`),
        ])
      );
    }
    reviewBox.appendChild(summary);

    // Lista de movimientos
    const head = el("div", { class: "section-header" }, [
      el("div", { class: "section-heading" }, `Movimientos (${state.rows.length})`),
      el("div", {}, [
        el("button", { class: "link-btn", onclick: () => setAll(true) }, "Todos"),
        el("span", { class: "text-dim" }, "  ·  "),
        el("button", { class: "link-btn", onclick: () => setAll(false) }, "Ninguno"),
      ]),
    ]);
    reviewBox.appendChild(head);

    const list = el("div", { class: "card imp-list" });
    for (const row of state.rows) list.appendChild(renderRow(row));
    reviewBox.appendChild(list);

    // Pagos (informativo)
    if (payments.length) {
      const total = payments.reduce((s, m) => s + m.amountCents, 0);
      const details = el("details", { class: "card imp-payments" }, [
        el("summary", {}, `Pagos y abonos a la tarjeta (${payments.length}) · ${Money.format(total)} · no se importan`),
        el("div", { class: "field-hint", style: "margin:8px 0;" }, "Son transferencias desde tus otras cuentas; si las registras desde la cuenta de origen, importarlas aquí las contaría dos veces."),
        ...payments.map((m) => el("div", { class: "imp-pay-row" }, [el("span", {}, `${DateUtil.formatShort(m.date)} · ${m.description}`), el("span", {}, Money.format(m.amountCents))])),
      ]);
      reviewBox.appendChild(details);
    }

    // Barra inferior
    const bar = el("div", { class: "imp-bar" }, [el("div", { class: "imp-bar-info", id: "imp-bar-info" }), el("button", { class: "btn", id: "imp-go" }, "Importar")]);
    reviewBox.appendChild(bar);
    bar.querySelector("#imp-go").addEventListener("click", doImport);
    refreshBar();
  }

  function renderRow(row) {
    const m = row.m;
    const chk = el("input", { type: "checkbox" });
    chk.checked = row.selected;
    chk.addEventListener("change", () => { row.selected = chk.checked; wrap.classList.toggle("off", !row.selected); refreshBar(); });

    const select = el("select", { class: "imp-cat" }, [
      el("option", { value: "" }, "Sin categoría"),
      ...catOptions.map((o) => el("option", { value: o.id }, o.label)),
      el("option", { value: "__new__" }, "+ Nueva categoría…"),
    ]);
    select.value = row.categoryId || "";
    if (row.refund) select.style.display = "none";
    select.addEventListener("change", () => {
      if (select.value === "__new__") {
        // Crear la categoría; al guardarla queda asignada a este movimiento
        select.value = row.categoryId || "";
        openCategorySheet({
          kind: "expense",
          onSaved: async () => {
            const exp = (await DB.getAll("categories")).filter((c) => c.kind === "expense");
            catOptions = categoryOptions(exp);
            const newest = exp.filter((c) => !c.parentId).sort((a, b) => b.id - a.id)[0];
            if (newest) { row.categoryId = newest.id; row.manual = true; }
            renderReviewKeepScroll();
          },
        });
        return;
      }
      const id = select.value ? parseInt(select.value, 10) : null;
      row.categoryId = id;
      row.manual = true;
      // Aplicar a los demás movimientos del mismo comercio que no hayas tocado
      const key = StatementImporters.merchantKey(m.description);
      let changed = 0;
      for (const other of state.rows) {
        if (other !== row && !other.manual && !other.refund && StatementImporters.merchantKey(other.m.description) === key) {
          other.categoryId = id;
          changed++;
        }
      }
      if (changed) renderReviewKeepScroll();
    });

    // Comentario libre: para anotar de qué fue un gasto que no reconoces por el nombre
    const comment = el("input", { type: "text", class: "imp-comment", placeholder: "Comentario: ¿de qué fue?", value: row.comment || "" });
    comment.addEventListener("input", () => { row.comment = comment.value; });

    // Compartido: lo marcas aquí y luego lo repartes en Movimientos (ahí eliges con quién)
    const shareBtn = el("button", { type: "button", class: `imp-share${row.shared ? " on" : ""}` }, row.shared ? "✓ Compartido" : "Compartido");
    shareBtn.addEventListener("click", (e) => {
      e.preventDefault();
      row.shared = !row.shared;
      renderReviewKeepScroll();
    });

    const tags = [shareBtn];
    if (m.holder === "digital") tags.push(el("span", { class: "imp-tag" }, "Tarjeta digital"));
    if (row.refund) tags.push(el("span", { class: "imp-tag ok" }, "Devolución"));
    if (row.dup) tags.push(el("span", { class: "imp-tag warn" }, row.dup.label));

    const wrap = el("div", { class: `imp-row${row.selected ? "" : " off"}` }, [
      el("label", { class: "imp-check" }, [chk]),
      el("div", { class: "imp-main" }, [
        el("div", { class: "imp-top" }, [el("span", { class: "imp-desc" }, m.description), el("span", { class: `imp-amount ${row.refund ? "income" : "expense"}` }, `${row.refund ? "+" : "-"}${Money.format(m.amountCents)}`)]),
        el("div", { class: "imp-sub" }, [el("span", {}, DateUtil.formatShort(m.date)), ...tags]),
        select,
        comment,
      ]),
    ]);
    return wrap;
  }

  function renderReviewKeepScroll() {
    const y = window.scrollY;
    renderReview();
    window.scrollTo(0, y);
  }

  function setAll(value) {
    state.rows.forEach((r) => { r.selected = value; });
    renderReviewKeepScroll();
  }

  function refreshBar() {
    const chosen = state.rows.filter((r) => r.selected);
    const total = chosen.reduce((s, r) => s + (r.refund ? -r.m.amountCents : r.m.amountCents), 0);
    const info = reviewBox.querySelector("#imp-bar-info");
    const go = reviewBox.querySelector("#imp-go");
    if (info) info.textContent = chosen.length ? `${chosen.length} movimientos · ${Money.format(total)}` : "Nada seleccionado";
    if (go) go.disabled = chosen.length === 0;
  }

  // ---------- Guardar ----------
  async function doImport() {
    const go = reviewBox.querySelector("#imp-go");
    go.disabled = true;
    go.textContent = "Importando…";
    const { info } = state.parsed;
    const chosen = state.rows.filter((r) => r.selected);
    const batch = `${info.bank}-${info.last4}-${info.cutDate || "s/f"}`;
    const now = new Date().toISOString();
    const monthCount = {};

    try {
      for (const r of chosen) {
        await DB.add("transactions", {
          type: r.refund ? "income" : "expense",
          amountCents: r.m.amountCents,
          accountId: state.accountId,
          toAccountId: null,
          categoryId: r.refund ? null : r.categoryId,
          merchant: r.m.description,
          note: [r.comment && r.comment.trim(), r.m.rawDescription.replace(/\s+/g, " ")].filter(Boolean).join(" · "),
          date: r.m.date,
          isRecurring: false,
          recurringDay: null,
          attachment: null,
          source: "import",
          pendingSplit: !!r.shared,
          importKey: r.importKey,
          importBatch: batch,
          balanceApplied: false, // historial: el saldo de la cuenta ya lo incluye
          createdAt: now,
        });
        const mk = DateUtil.monthKey(r.m.date);
        monthCount[mk] = (monthCount[mk] || 0) + 1;
      }

      // Recordar la categoría elegida para cada comercio (para los próximos estados de cuenta)
      const mem = { ...(await DB.getMeta("merchantCategories", {})) };
      for (const r of chosen) {
        if (r.categoryId && !r.refund) mem[StatementImporters.merchantKey(r.m.description)] = r.categoryId;
      }
      await DB.setMeta("merchantCategories", mem);

      // Datos de la cuenta: últimos 4 dígitos (para reconocerla la próxima vez) y, si lo pediste, límite/corte/pago
      const account = await DB.get("accounts", state.accountId);
      if (account) {
        if (info.last4) account.statementLast4 = info.last4;
        if (state.updateCard && account.type === "credit") {
          if (info.limitCents) account.creditLimitCents = info.limitCents; // lo gastado no cambia: el saldo sigue igual
          if (info.cutDate) {
            account.cutDay = DateUtil.parseISO(info.cutDate).getDate();
            account.cutRefDate = DateUtil.nextOccurrence(account.cutDay);
          }
          if (info.dueDate) {
            account.dueDay = DateUtil.parseISO(info.dueDate).getDate();
            account.dueRefDate = DateUtil.nextOccurrence(account.dueDay);
          }
        }
        await DB.put("accounts", account);
      }

      const topMonth = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0];
      toast(`${chosen.length} movimientos importados`, "success");
      Router.navigate(`/transactions?month=${topMonth ? topMonth[0] : DateUtil.monthKey()}`);
    } catch (err) {
      console.error(err);
      toast("No se pudo importar. Intenta de nuevo.", "error");
      go.disabled = false;
      go.textContent = "Importar";
    }
  }
}

window.renderImportStatement = renderImportStatement;
