/**
 * transaction-form.js — Sheet (modal) compartido para crear/editar una transacción.
 * Lo usan dashboard, transactions, calendar, etc.
 *
 * Pago entre varios: un gasto puede repartirse entre personas. Se guarda
 *   split = { myShareCents, participants: [{ personId, shareCents }] }
 * El saldo de la cuenta siempre baja por el total; tu gasto real es solo tu parte.
 */

async function openTransactionSheet({ existing = null, prefill = null, onSaved = null } = {}) {
  const accounts = (await DB.getAll("accounts")).filter((a) => !a.archived);
  if (accounts.length === 0) {
    toast("Primero crea una cuenta en Ajustes → Cuentas", "error");
    return;
  }

  const data = existing || {
    type: prefill?.type || "expense",
    amountCents: prefill?.amountCents || 0,
    accountId: prefill?.accountId || accounts[0].id,
    toAccountId: null,
    categoryId: null,
    merchant: prefill?.merchant || "",
    note: "",
    date: prefill?.date || DateUtil.todayISO(),
    isRecurring: prefill?.isRecurring || false,
    recurringDay: null,
    source: prefill?.source || "manual",
    split: null,
  };

  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  async function renderCategoryOptions(kind) {
    const cats = await DB.getAllByIndex("categories", "kind", kind);
    let html = `<option value="">Sin categoría</option>`;
    for (const c of cats) html += `<option value="${c.id}">${categoryLabel(c)}</option>`;
    html += `<option value="__new__">+ Nueva categoría…</option>`;
    return html;
  }

  let catOptionsExpense = await renderCategoryOptions("expense");
  let catOptionsIncome = await renderCategoryOptions("income");
  async function refreshCategoryOptions() {
    catOptionsExpense = await renderCategoryOptions("expense");
    catOptionsIncome = await renderCategoryOptions("income");
  }

  // "+ Nueva categoría…": abre la hoja de categoría y, al guardar, la deja seleccionada
  function wireNewCategory() {
    const sel = sheet.querySelector("#f-category");
    if (!sel) return;
    sel.addEventListener("change", async () => {
      if (sel.value !== "__new__") return;
      const kind = currentType === "income" ? "income" : "expense";
      sel.value = "";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      openCategoryEditSheet({
        kind,
        onSaved: async () => {
          await refreshCategoryOptions();
          const latest = (await DB.getAllByIndex("categories", "kind", kind))
            .sort((a, b) => b.id - a.id)[0];
          const target = sheet.querySelector("#f-category");
          if (!target) return;
          target.innerHTML = currentType === "income" ? catOptionsIncome : catOptionsExpense;
          if (latest) target.value = String(latest.id);
          target.dispatchEvent(new Event("change", { bubbles: true }));
        },
      });
    });
  }

  // Gasto: sin cuentas de rendimiento. Ingreso: sin tarjetas de crédito. Transferencia: todas.
  // Siempre en orden alfabético.
  function accountOptions(selectedId, type = data.type) {
    return accounts
      .filter((a) => (type === "expense" ? a.type !== "savings" : type === "income" ? a.type !== "credit" : true))
      .slice()
      .sort(accountPickerCompare)
      .map((a) => `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${accountPickerLabel(a)}</option>`)
      .join("");
  }

  // ---------- Estado del reparto ----------
  let people = (await DB.getAll("people")).sort((a, b) => a.name.localeCompare(b.name));
  const split = {
    enabled: !!data.split,
    selected: new Set(data.split ? data.split.participants.map((p) => p.personId) : []),
    mode: data.split ? "manual" : "equal",
    manual: new Map(data.split ? data.split.participants.map((p) => [p.personId, p.shareCents]) : []),
    paid: new Set(data.split ? data.split.participants.filter((p) => p.paid).map((p) => p.personId) : []),
  };

  /** Calcula el reparto a partir del monto y la forma elegida. Devuelve error o el reparto. */
  function computeSplit() {
    const total = Money.toCents(sheet.querySelector("#f-amount").value);
    const ids = [...split.selected];
    if (ids.length === 0) return { error: "Elige al menos una persona para dividir el gasto" };

    if (split.mode === "equal") {
      // Partes iguales entre las personas y tú
      const parts = splitEvenly(total, ids.length + 1);
      return {
        total,
        myShareCents: parts[ids.length],
        participants: ids.map((personId, i) => ({ personId, shareCents: parts[i] })),
      };
    }

    const participants = ids.map((personId) => ({ personId, shareCents: split.manual.get(personId) ?? 0 }));
    const others = participants.reduce((s, p) => s + p.shareCents, 0);
    const myShareCents = total - others;
    if (myShareCents < 0) return { error: "Lo que te deben suma más que el total del gasto" };
    return { total, myShareCents, participants };
  }

  function updateSplitSummary() {
    const box = sheet.querySelector("#split-summary");
    if (!box) return;
    const res = computeSplit();
    if (res.error) {
      box.innerHTML = `<span style="color:var(--warn);">${escapeHtml(res.error)}</span>`;
      return;
    }
    // Te deben: solo lo que aún no te han pagado (las casillas marcadas ya no cuentan)
    const owed = res.participants.filter((p) => !split.paid.has(p.personId)).reduce((s, p) => s + p.shareCents, 0);
    box.innerHTML = `Tu parte <b>${Money.format(res.myShareCents)}</b> · Te deben <b>${Money.format(owed)}</b>`;
  }

  function renderSplitBox() {
    const box = sheet.querySelector("#split-box");
    if (!box) return;
    const res = computeSplit();
    const shares = new Map(!res.error ? res.participants.map((p) => [p.personId, p.shareCents]) : []);
    const nameOf = (id) => people.find((p) => p.id === id)?.name || "—";

    const chips = people
      .map((p) => `<button type="button" class="chip ${split.selected.has(p.id) ? "on" : ""}" data-person="${p.id}">${escapeHtml(p.name)}</button>`)
      .join("");

    const rows = [...split.selected]
      .map((id) => {
        const paid = split.paid.has(id);
        const value = paid ? "0" : split.mode === "manual" ? Money.toInputValue(split.manual.get(id) ?? shares.get(id) ?? 0) : Money.toInputValue(shares.get(id) ?? 0);
        return `<div class="split-row">
          <span>${escapeHtml(nameOf(id))}</span>
          <div class="split-amt">
            <input type="number" inputmode="decimal" step="0.01" data-share="${id}" value="${value}" ${split.mode === "equal" || paid ? "readonly" : ""}>
            <input type="checkbox" class="split-paid-chk" data-paid="${id}" title="Ya te pagó" aria-label="Ya te pagó" ${paid ? "checked" : ""}>
          </div>
        </div>`;
      })
      .join("");

    box.innerHTML = `
      <div class="split-chips">${chips || '<span class="field-hint">Aún no tienes personas. Agrega una abajo.</span>'}</div>
      <div class="split-add">
        <input type="text" id="f-newperson" placeholder="Nombre de una persona">
        <button type="button" class="btn btn-secondary btn-sm" id="f-addperson" style="width:auto;">Agregar</button>
      </div>
      <div class="segmented split-mode" style="margin:10px 0;">
        <button type="button" data-mode="equal" class="${split.mode === "equal" ? "active" : ""}">Partes iguales</button>
        <button type="button" data-mode="manual" class="${split.mode === "manual" ? "active" : ""}">Montos</button>
      </div>
      ${rows ? `<div class="split-rows">${rows}</div>` : ""}
      <div class="field-hint" id="split-summary" style="margin-top:10px;font-size:13px;"></div>
    `;

    box.querySelectorAll("[data-person]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.dataset.person, 10);
        if (split.selected.has(id)) split.selected.delete(id);
        else split.selected.add(id);
        renderSplitBox();
      });
    });

    box.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.mode === "manual" && split.mode !== "manual") {
          // Al pasar a montos, parto de lo que salía en partes iguales para que no cambie de golpe
          const eq = computeSplit();
          if (!eq.error) for (const p of eq.participants) split.manual.set(p.personId, p.shareCents);
        }
        split.mode = btn.dataset.mode;
        renderSplitBox();
      });
    });

    box.querySelectorAll("[data-share]").forEach((input) => {
      input.addEventListener("input", () => {
        split.manual.set(parseInt(input.dataset.share, 10), Money.toCents(input.value));
        updateSplitSummary();
      });
    });

    box.querySelectorAll("[data-paid]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = parseInt(input.dataset.paid, 10);
        if (input.checked) split.paid.add(id);
        else split.paid.delete(id);
        renderSplitBox();
      });
    });

    box.querySelector("#f-addperson").addEventListener("click", async () => {
      const name = box.querySelector("#f-newperson").value.trim().replace(/\s+/g, " ");
      if (!name) {
        toast("Escribe el nombre de la persona", "error");
        return;
      }
      const found = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (found) {
        split.selected.add(found.id);
      } else {
        const id = await DB.add("people", { name, createdAt: new Date().toISOString() });
        people = [...people, { id, name }].sort((a, b) => a.name.localeCompare(b.name));
        split.selected.add(id);
      }
      renderSplitBox();
    });

    updateSplitSummary();
  }

  sheet.innerHTML = `
    <div class="sheet-header">
      <h2>${existing ? "Editar" : "Nueva"} transacción</h2>
      <button class="sheet-close" data-close>✕</button>
    </div>
    ${prefill?.notice && !existing ? `<div class="capture-notice">${escapeHtml(prefill.notice)}</div>` : ""}

    <div class="segmented" id="type-segmented">
      <button type="button" data-type="expense" class="${data.type === "expense" ? "active" : ""}">Gasto</button>
      <button type="button" data-type="income" class="${data.type === "income" ? "active" : ""}">Ingreso</button>
      <button type="button" data-type="transfer" class="${data.type === "transfer" ? "active" : ""}">Transferencia</button>
    </div>

    <div class="form-group mt-8">
      <label>Monto (MXN)</label>
      <input type="number" inputmode="decimal" step="0.01" id="f-amount" value="${data.amountCents ? Money.toInputValue(data.amountCents) : ""}" placeholder="0.00">
    </div>

    <div class="form-group">
      <label id="label-account">Cuenta</label>
      <select id="f-account">${accountOptions(data.accountId)}</select>
    </div>

    <div class="form-group" id="group-to-account" style="display:${data.type === "transfer" ? "block" : "none"}">
      <label>Cuenta destino</label>
      <select id="f-to-account">${accountOptions(data.toAccountId, "transfer")}</select>
    </div>

    <div class="form-group" id="group-merchant" style="display:${data.type === "transfer" ? "none" : "block"}">
      <label>Comercio / descripción</label>
      <input type="text" id="f-merchant" value="${data.merchant || ""}" placeholder="Ej. Costco, Oxxo...">
    </div>

    <div class="form-group" id="group-category" style="display:${data.type === "transfer" ? "none" : "block"}">
      <label>Categoría</label>
      <select id="f-category">${data.type === "income" ? catOptionsIncome : catOptionsExpense}</select>
    </div>

    <div class="form-group" id="group-split" style="display:${data.type === "expense" ? "block" : "none"}">
      <label class="checkbox-row">
        <input type="checkbox" id="f-split" ${split.enabled ? "checked" : ""}>
        <span>Pago entre varios (se reparte con otras personas)</span>
      </label>
      <div id="split-box" style="display:${split.enabled ? "block" : "none"};margin-top:10px;"></div>
    </div>

    <div class="form-group">
      <label>Fecha</label>
      <input type="date" id="f-date" value="${data.date?.slice(0, 10) || DateUtil.todayISO()}">
    </div>

    <div class="form-group">
      <label>Nota (opcional)</label>
      <textarea id="f-note">${data.note || ""}</textarea>
    </div>

    <div class="form-group" id="group-recurring" style="display:${data.type === "expense" ? "block" : "none"}">
      <label class="checkbox-row">
        <input type="checkbox" id="f-recurring" ${data.isRecurring ? "checked" : ""}>
        <span>Este es un pago domiciliado (recurrente cada mes)</span>
      </label>
    </div>

    <div class="btn-row mt-8 sheet-actions">
      ${existing ? '<button class="btn btn-danger btn-sm" id="f-delete" style="flex:0 0 auto;">Eliminar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

  wireNewCategory();
  if (data.categoryId) {
    const catSelect = sheet.querySelector("#f-category");
    if (catSelect) catSelect.value = data.categoryId;
  }

  sheet.querySelector("[data-close]").addEventListener("click", close);

  let currentType = data.type;
  sheet.querySelectorAll("#type-segmented button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      currentType = btn.dataset.type;
      sheet.querySelectorAll("#type-segmented button").forEach((b) => b.classList.toggle("active", b === btn));
      sheet.querySelector("#group-to-account").style.display = currentType === "transfer" ? "block" : "none";
      sheet.querySelector("#group-merchant").style.display = currentType === "transfer" ? "none" : "block";
      sheet.querySelector("#group-category").style.display = currentType === "transfer" ? "none" : "block";
      sheet.querySelector("#group-split").style.display = currentType === "expense" ? "block" : "none";
      sheet.querySelector("#group-recurring").style.display = currentType === "expense" ? "block" : "none";
      sheet.querySelector("#label-account").textContent = currentType === "transfer" ? "Cuenta origen" : "Cuenta";
      const acctSel = sheet.querySelector("#f-account");
      const keep = parseInt(acctSel.value, 10);
      acctSel.innerHTML = accountOptions(keep, currentType);
      if (acctSel.value !== String(keep) && acctSel.options.length) acctSel.selectedIndex = 0;
      const catSelect = sheet.querySelector("#f-category");
      catSelect.innerHTML = currentType === "income" ? catOptionsIncome : catOptionsExpense;
    });
  });

  // Pago entre varios
  sheet.querySelector("#f-split").addEventListener("change", (e) => {
    split.enabled = e.target.checked;
    sheet.querySelector("#split-box").style.display = split.enabled ? "block" : "none";
    if (split.enabled) renderSplitBox();
  });
  sheet.querySelector("#f-amount").addEventListener("input", () => {
    if (split.enabled) renderSplitBox();
  });
  if (split.enabled) renderSplitBox();

  // Auto-sugerencia de categoría al escribir el comercio
  const merchantInput = sheet.querySelector("#f-merchant");
  merchantInput.addEventListener("blur", async () => {
    if (!merchantInput.value) return;
    const suggested = await suggestCategory(merchantInput.value, currentType === "income" ? "income" : "expense");
    if (suggested) {
      const catSelect = sheet.querySelector("#f-category");
      if (catSelect && !catSelect.value) catSelect.value = suggested;
    }
  });

  if (existing) {
    sheet.querySelector("#f-delete").addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta transacción?")) return;
      await deleteTransactionWithBalances(existing); // devuelve el monto al saldo de la cuenta
      toast("Transacción eliminada", "success");
      close();
      if (onSaved) onSaved();
    });
  }

  sheet.querySelector("#f-save").addEventListener("click", async () => {
    const amount = Money.toCents(sheet.querySelector("#f-amount").value);
    if (!amount || amount <= 0) {
      toast("Ingresa un monto válido", "error");
      return;
    }
    const accountId = parseInt(sheet.querySelector("#f-account").value, 10);
    const toAccountId = currentType === "transfer" ? parseInt(sheet.querySelector("#f-to-account").value, 10) : null;
    if (currentType === "transfer" && accountId === toAccountId) {
      toast("Elige dos cuentas distintas", "error");
      return;
    }
    const categoryId = currentType !== "transfer" ? (sheet.querySelector("#f-category").value || null) : null;

    let splitRecord = null;
    if (currentType === "expense" && split.enabled) {
      const res = computeSplit();
      if (res.error) {
        toast(res.error, "error");
        return;
      }
      splitRecord = {
        myShareCents: res.myShareCents,
        participants: res.participants.map((p) => ({ ...p, paid: split.paid.has(p.personId) })),
      };
    }

    // "Ya me pagó": cada persona marcada genera un cobro en Por cobrar; al desmarcarla, el cobro se quita
    const prevParts = existing?.split?.participants || [];
    const curIds = new Set(splitRecord ? splitRecord.participants.map((p) => p.personId) : []);
    const txDate = sheet.querySelector("#f-date").value || DateUtil.todayISO();
    const payNote = `Pagó: ${sheet.querySelector("#f-merchant").value.trim() || "gasto compartido"}`;
    if (splitRecord) {
      for (const p of splitRecord.participants) {
        const prevCol = prevParts.find((x) => x.personId === p.personId)?.collectionId || null;
        if (p.paid && p.shareCents > 0) {
          const fields = { personId: p.personId, amountCents: p.shareCents, method: "transfer", date: txDate, note: payNote, createdAt: new Date().toISOString() };
          if (prevCol && (await DB.get("collections", prevCol))) {
            await DB.put("collections", { ...(await DB.get("collections", prevCol)), ...fields, id: prevCol });
            p.collectionId = prevCol;
          } else {
            p.collectionId = await DB.add("collections", fields);
          }
        } else if (prevCol) {
          await DB.delete("collections", prevCol);
        }
      }
    }
    for (const prev of prevParts) {
      if (prev.collectionId && !curIds.has(prev.personId)) await DB.delete("collections", prev.collectionId);
    }

    const record = {
      type: currentType,
      amountCents: amount,
      accountId,
      toAccountId,
      categoryId: categoryId ? parseInt(categoryId, 10) : null,
      merchant: sheet.querySelector("#f-merchant").value.trim(),
      note: sheet.querySelector("#f-note").value.trim(),
      date: sheet.querySelector("#f-date").value || DateUtil.todayISO(),
      isRecurring: currentType === "expense" ? sheet.querySelector("#f-recurring").checked : false,
      recurringDay: null,
      split: splitRecord,
      // Marcado como compartido en la importación: se quita al repartirlo
      pendingSplit: splitRecord ? false : !!existing?.pendingSplit,
      source: data.source || "manual",
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    // Movimientos importados de un estado de cuenta: conservar su identidad y que no tocan el saldo
    if (existing && existing.balanceApplied === false) {
      record.balanceApplied = false;
      record.importKey = existing.importKey;
      record.importBatch = existing.importBatch;
    }
    if (record.isRecurring) {
      record.recurringDay = new Date(record.date + "T00:00:00").getDate();
    }
    if (existing) record.id = existing.id;

    await saveTransactionWithBalances(record, existing);
    toast("Guardado", "success");
    close();
    if (onSaved) onSaved();
  });
}

/**
 * Guarda la transacción y ajusta los saldos de cuentas afectadas.
 * Si es edición, primero revierte el efecto de la transacción anterior.
 */
async function saveTransactionWithBalances(record, previous) {
  if (previous) {
    await applyBalanceDelta(previous, -1);
  }
  const id = await DB.put("transactions", record);
  await applyBalanceDelta({ ...record, id }, +1);
  return id;
}

async function applyBalanceDelta(tx, sign) {
  // Los movimientos importados de estados de cuenta son historial: el saldo ya los incluye
  if (tx.balanceApplied === false) return;
  const account = await DB.get("accounts", tx.accountId);
  if (!account) return;

  if (tx.type === "expense") {
    // El saldo baja por el TOTAL, aunque tu gasto real sea solo tu parte
    account.balanceCents -= sign * tx.amountCents;
    await DB.put("accounts", account);
  } else if (tx.type === "income") {
    account.balanceCents += sign * tx.amountCents;
    await DB.put("accounts", account);
  } else if (tx.type === "transfer") {
    account.balanceCents -= sign * tx.amountCents;
    await DB.put("accounts", account);
    if (tx.toAccountId) {
      const toAccount = await DB.get("accounts", tx.toAccountId);
      if (toAccount) {
        toAccount.balanceCents += sign * tx.amountCents;
        await DB.put("accounts", toAccount);
      }
    }
  }
}

async function deleteTransactionWithBalances(tx) {
  await applyBalanceDelta(tx, -1);
  await DB.delete("transactions", tx.id);
  // Quitar también los cobros que se registraron con "Ya me pagó"
  for (const part of tx.split?.participants || []) {
    if (part.collectionId) await DB.delete("collections", part.collectionId);
  }
}

window.openTransactionSheet = openTransactionSheet;
window.saveTransactionWithBalances = saveTransactionWithBalances;
window.deleteTransactionWithBalances = deleteTransactionWithBalances;
