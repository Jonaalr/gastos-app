/**
 * transaction-form.js — Sheet (modal) compartido para crear/editar una transacción.
 * Lo usan dashboard, transactions, calendar, etc.
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
      html += `<option value="${c.id}">${c.icon} ${c.name}</option>`;
      for (const sub of subByParent[c.id] || []) {
        html += `<option value="${sub.id}">&nbsp;&nbsp;↳ ${sub.name}</option>`;
      }
    }
    return html;
  }

  const catOptionsExpense = await renderCategoryOptions("expense");
  const catOptionsIncome = await renderCategoryOptions("income");

  function accountOptions(selectedId) {
    return accounts
      .map((a) => `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${a.name}</option>`)
      .join("");
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
      <select id="f-to-account">${accountOptions(data.toAccountId)}</select>
    </div>

    <div class="form-group" id="group-merchant" style="display:${data.type === "transfer" ? "none" : "block"}">
      <label>Comercio / descripción</label>
      <input type="text" id="f-merchant" value="${data.merchant || ""}" placeholder="Ej. Costco, Oxxo...">
    </div>

    <div class="form-group" id="group-category" style="display:${data.type === "transfer" ? "none" : "block"}">
      <label>Categoría</label>
      <select id="f-category">${data.type === "income" ? catOptionsIncome : catOptionsExpense}</select>
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
      sheet.querySelector("#group-recurring").style.display = currentType === "expense" ? "block" : "none";
      sheet.querySelector("#label-account").textContent = currentType === "transfer" ? "Cuenta origen" : "Cuenta";
      const catSelect = sheet.querySelector("#f-category");
      catSelect.innerHTML = currentType === "income" ? catOptionsIncome : catOptionsExpense;
    });
  });

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
      await DB.delete("transactions", existing.id);
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
      source: data.source || "manual",
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
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
  const account = await DB.get("accounts", tx.accountId);
  if (!account) return;

  if (tx.type === "expense") {
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
