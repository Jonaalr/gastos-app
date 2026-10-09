/**
 * debts.js — Deudas grandes (crédito de auto, préstamo, etc.), dentro de Presupuestos.
 *
 * Cada deuda tiene monto total, pago mensual opcional y su historial de pagos.
 * Lo que falta = total − pagos registrados. Los pagos que registras aquí
 * NO crean movimientos ni tocan saldos (igual que las metas de ahorro).
 * Se guardan en meta["debts"].
 */

async function loadDebts() {
  return DB.getMeta("debts", []);
}
async function saveDebts(debts) {
  return DB.setMeta("debts", debts);
}
function debtPaidCents(d) {
  return (d.payments || []).reduce((s, p) => s + p.amountCents, 0);
}
function debtRemainingCents(d) {
  return Math.max(0, d.totalCents - debtPaidCents(d));
}

async function renderDebts(root) {
  const debts = await loadDebts();
  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Presupuestos")]));
  root.appendChild(sectionTabs(PRESUPUESTO_TABS, "/debts"));

  if (debts.length > 0) {
    const totalDebt = debts.reduce((s, d) => s + d.totalCents, 0);
    const totalPaid = debts.reduce((s, d) => s + debtPaidCents(d), 0);
    const totalRemaining = debts.reduce((s, d) => s + debtRemainingCents(d), 0);
    root.appendChild(
      el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "Falta por pagar en total"),
        el("div", { class: "debt-total", style: `color:${totalRemaining > 0 ? "var(--danger)" : "var(--income)"}` }, Money.format(totalRemaining)),
        el("div", { class: "muted" }, `${Money.format(totalPaid)} pagado de ${Money.format(totalDebt)}`),
      ])
    );
  }

  const card = el("div", { class: "card goals-card" }, [el("div", { class: "card-title" }, "Mis deudas")]);
  if (debts.length === 0) {
    card.appendChild(el("div", { class: "muted" }, "Registra tus deudas grandes, como un crédito de auto o un préstamo, y ve cuánto te falta por pagar."));
  }

  for (const d of debts) {
    const paid = debtPaidCents(d);
    const remaining = debtRemainingCents(d);
    const pct = d.totalCents > 0 ? Math.min(100, Math.round((paid / d.totalCents) * 100)) : 0;
    const done = remaining <= 0;
    const payments = (d.payments || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    let info = done ? "Liquidada" : `${pct}% pagado`;
    if (!done && d.monthlyCents > 0) {
      const months = Math.ceil(remaining / d.monthlyCents);
      info += ` · ${months} ${months === 1 ? "pago" : "pagos"} de ${Money.format(d.monthlyCents)} al mes`;
    }

    card.appendChild(
      el("div", { class: "goal-row" }, [
        el("div", { class: "goal-head" }, [
          el("div", { class: "goal-name" }, d.name),
          el("div", { class: "goal-amount" }, `Faltan ${Money.format(remaining)}`),
        ]),
        el("div", { class: "goal-bar" }, [el("div", { class: `goal-fill${done ? " done" : ""}`, style: `width:${pct}%` })]),
        el("div", { class: "goal-meta" }, [
          el("span", {}, info),
          el("div", { class: "goal-actions" }, [
            el("button", { class: "btn btn-secondary btn-sm", onclick: () => openDebtPayment(d) }, "Pagar"),
            el("button", { class: "btn btn-secondary btn-sm", onclick: () => openDebtSheet(d) }, "Editar"),
          ]),
        ]),
        payments.length
          ? el("div", { class: "muted", style: "font-size:12px;margin-top:6px;" },
              `Último pago: ${DateUtil.formatShort(payments[0].date)} por ${Money.format(payments[0].amountCents)}`)
          : null,
      ])
    );
  }

  card.appendChild(el("button", { class: "btn mt-8", onclick: () => openDebtSheet(null) }, "+ Nueva deuda"));
  root.appendChild(card);
}

/** Crear o editar una deuda (y revisar/borrar sus pagos). */
async function openDebtSheet(existing) {
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const payments = (existing?.payments || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const paymentsHtml = payments.length
    ? payments.map((p) => `
        <div class="debt-pay-row">
          <span>${DateUtil.formatShort(p.date)}${p.note ? ` · ${escapeHtml(p.note)}` : ""}</span>
          <span class="debt-pay-amt">${Money.format(p.amountCents)}</span>
          <button class="sheet-close" type="button" data-del-pay="${p.id}" aria-label="Quitar pago">✕</button>
        </div>`).join("")
    : `<p class="muted" style="font-size:12px;">Aún no hay pagos registrados.</p>`;

  sheet.innerHTML = `
    <div class="sheet-header"><h2>${existing ? "Editar deuda" : "Nueva deuda"}</h2><button class="sheet-close" data-close>✕</button></div>
    <div class="form-group"><label>Nombre</label><input type="text" id="d-name" placeholder="Ej. Crédito del auto" value="${existing ? escapeHtml(existing.name) : ""}"></div>
    <div class="form-group"><label>Monto total de la deuda (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="d-total" value="${existing ? Money.toInputValue(existing.totalCents) : ""}"></div>
    <div class="form-group"><label>Pago mensual (opcional)</label><input type="number" inputmode="decimal" step="0.01" id="d-monthly" value="${existing && existing.monthlyCents ? Money.toInputValue(existing.monthlyCents) : ""}"></div>
    ${existing ? `<div class="form-group"><label>Pagos registrados</label>${paymentsHtml}</div>` : ""}
    <button class="btn" id="d-save">Guardar</button>
    ${existing ? `<button class="btn btn-secondary mt-8" id="d-delete" style="color:var(--danger);">Eliminar deuda</button>` : ""}
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);

  sheet.querySelector("#d-save").addEventListener("click", async () => {
    const name = sheet.querySelector("#d-name").value.trim();
    const totalCents = Money.toCents(sheet.querySelector("#d-total").value);
    const monthlyCents = Money.toCents(sheet.querySelector("#d-monthly").value);
    if (!name) { toast("Ponle un nombre a la deuda", "error"); return; }
    if (totalCents <= 0) { toast("Pon el monto total de la deuda", "error"); return; }
    const debts = await loadDebts();
    if (existing) {
      const i = debts.findIndex((d) => d.id === existing.id);
      if (i >= 0) debts[i] = { ...debts[i], name, totalCents, monthlyCents };
    } else {
      debts.push({ id: uid(), name, totalCents, monthlyCents, payments: [], createdAt: new Date().toISOString() });
    }
    await saveDebts(debts);
    close();
    Router.render();
  });

  // Quitar un pago registrado por error (recalcula lo que falta)
  sheet.querySelectorAll("[data-del-pay]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este pago? Lo que falta por pagar se recalcula.")) return;
      const debts = await loadDebts();
      const d = debts.find((x) => x.id === existing.id);
      if (d) d.payments = (d.payments || []).filter((p) => p.id !== btn.dataset.delPay);
      await saveDebts(debts);
      close();
      Router.render();
      openDebtSheet(debts.find((x) => x.id === existing.id));
    });
  });

  const del = sheet.querySelector("#d-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la deuda "${existing.name}"? Tus cuentas y movimientos no cambian.`)) return;
      await saveDebts((await loadDebts()).filter((d) => d.id !== existing.id));
      close();
      Router.render();
    });
  }
}

/** Registrar un pago a una deuda (no crea movimiento ni toca saldos). */
async function openDebtPayment(debt) {
  const remaining = debtRemainingCents(debt);
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  const suggested = debt.monthlyCents > 0 ? Math.min(debt.monthlyCents, remaining) : remaining;
  sheet.innerHTML = `
    <div class="sheet-header"><h2>Pagar "${escapeHtml(debt.name)}"</h2><button class="sheet-close" data-close>✕</button></div>
    <p class="muted">Te faltan ${Money.format(remaining)}</p>
    <div class="form-group"><label>Monto pagado (MXN)</label><input type="number" inputmode="decimal" step="0.01" id="p-amount" value="${Money.toInputValue(suggested)}"></div>
    <div class="form-group"><label>Fecha</label><input type="date" id="p-date" value="${DateUtil.todayISO()}"></div>
    <div class="form-group"><label>Nota (opcional)</label><input type="text" id="p-note" placeholder="Ej. Pago de octubre"></div>
    <p class="muted" style="font-size:12px;">Esto solo actualiza lo que falta de la deuda. No crea un gasto ni cambia tus cuentas.</p>
    <button class="btn" id="p-save">Registrar pago</button>
  `;
  sheet.querySelector("[data-close]").addEventListener("click", close);
  sheet.querySelector("#p-save").addEventListener("click", async () => {
    const amountCents = Money.toCents(sheet.querySelector("#p-amount").value);
    if (amountCents <= 0) { toast("Pon el monto pagado", "error"); return; }
    const date = sheet.querySelector("#p-date").value || DateUtil.todayISO();
    const note = sheet.querySelector("#p-note").value.trim();
    const debts = await loadDebts();
    const d = debts.find((x) => x.id === debt.id);
    if (d) d.payments = [...(d.payments || []), { id: uid(), date, amountCents, note }];
    await saveDebts(debts);
    close();
    Router.render();
  });
}
