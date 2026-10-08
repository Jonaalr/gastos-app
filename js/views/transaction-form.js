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
    accountId: accounts[0].id,
    toAccountId: null,
    categoryId: null,
    merchant: prefill?.merchant || "",
    note: "",
    date: prefill?.date || DateUtil.todayISO(),
    isRecurring: false,
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
    const cats = (await DB.getAllByIndex("categories", "kind", kind)).filter((c) => !c.parentId);
    const subByParent = {};
    const allCats = await DB.getAllByIndex("categories", "kind", kind);
    for (const c of allCats) {
      if (c.parentId) {
        subByParent[c.parentId] = subByParent[c.parentId] || [];
        subByParent[c.parentId].push(c);
      }
    }
    let html = `<option value="">Sin categoría</option>`;
    for (const c of cats) {
      html += `<option value="${c.id}">${c.name}</option>`;
      for (const sub of subByParent[c.id] || []) {
        html += `<option value="${sub.id}">&nbsp;&nbsp;↳ ${sub.name}</option>`;
      }
    }
    return html;
  }

  const catOptionsExpense = await renderCategoryOptions("expense");
  const catOptionsIncome = await renderCategoryOptions("income");

  // Gasto: sin cuentas de rendimiento. Ingreso: sin tarjetas de crédito. Transferencia: todas.
  // Siempre en orden alfabético.
  function accountOptions(selectedId, type = data.type) {
    return accounts
      .filter((a) => (type === "expense" ? a.type !== "savings" : type === "income" ? a.type !== "credit" : true))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((a) => `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${a.name}</option>`)
      .join("");
  }

  // ---------- Estado del reparto ----------
  let people = (await DB.getAll("people")).sort((a, b) => a.name.localeCompare(b.name));
  const split = {
    enabled: !!data.split,
    selected: new Set(data.split ? data.split.participants.map((p) => p.personId) : []),
    mode: data.split ? "manual" : "equal",
    manual: new Map(data.split ? data.split.participants.map((p) => [p.personId, p.shareCents]) : []),
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
    box.innerHTML = `Tu parte <b>${Money.format(res.myShareCents)}</b> · Te deben <b>${Money.format(res.total - res.myShareCents)}</b>`;
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
        const value = split.mode === "manual" ? Money.toInputValue(split.manual.get(id) ?? shares.get(id) ?? 0) : Money.toInputValue(shares.get(id) ?? 0);
        return `<div class="split-row">
          <span>${escapeHtml(nameOf(id))}</span>
          <input type="number" inputmode="decimal" step="0.01" data-share="${id}" value="${value}" ${split.mode === "equal" ? "readonly" : ""}>
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

    <div class="btn-row mt-8">
      ${existing ? '<button class="btn btn-danger btn-sm" id="f-delete" style="flex:0 0 auto;">Eliminar</button>' : ""}
      <button class="btn" id="f-save">Guardar</button>
    </div>
  `;

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
      splitRecord = { myShareCents: res.myShareCents, participants: res.participants };
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
}

window.openTransactionSheet = openTransactionSheet;
window.saveTransactionWithBalances = saveTransactionWithBalances;
window.deleteTransactionWithBalances = deleteTransactionWithBalances;
