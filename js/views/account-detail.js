/**
 * account-detail.js — Detalle de una cuenta: saldo, acciones y enlace a sus movimientos (en Movimientos, filtrados por la cuenta).
 */

async function renderAccountDetail(root, params) {
  await capitalizeSavings();
  const id = parseInt(params.get("id") || "0", 10) || 0;
  const [account, transactions, categories, accounts] = await Promise.all([
    DB.get("accounts", id),
    DB.getAll("transactions"),
    DB.getAll("categories"),
    DB.getAll("accounts"),
  ]);
  if (!account) {
    Router.navigate("/accounts");
    return;
  }

  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const isCredit = account.type === "credit";
  const info = isCredit ? creditInfo(account) : null;

  root.appendChild(
    el("div", { class: "topbar" }, [
      el("div", {}, [
        el("button", { class: "link-btn", onclick: () => Router.navigate("/accounts") }, "‹ Cuentas"),
        el("h1", {}, account.name),
      ]),
    ])
  );

  root.appendChild(
    el("div", { class: "card balance-hero" }, [
      el("div", { class: "label" }, isCredit ? "Disponible" : "Saldo actual"),
      el("div", { class: "amount" }, Money.format(isCredit ? info.available : account.balanceCents)),
      isCredit
        ? el("div", { class: "label" }, [
            el("span", { class: "debt" }, `Gastado ${Money.format(info.spent)}`),
            ` · límite ${Money.format(info.limit)}`,
          ])
        : el("div", { class: "label" }, accountSubtitle(account)),
      el("div", { class: "btn-row", style: "margin-top:14px;" }, [
        el("button", { class: "btn btn-secondary btn-sm", onclick: () => openAccountSheet({ existing: account, onSaved: () => Router.render() }) }, "Editar"),
        isCredit
          ? el("button", { class: "btn btn-secondary btn-sm", onclick: () => Router.navigate(`/import?account=${id}`) }, "Importar estado (PDF)")
          : null,
        isCredit
          ? el("button", { class: "btn btn-secondary btn-sm", onclick: () => Router.navigate(`/reconcile?account=${id}`) }, "Conciliar")
          : null,
      ]),
    ])
  );

  // Los movimientos viven en Movimientos, filtrados por esta cuenta (incluye transferencias recibidas)
  root.appendChild(
    el("button", { class: "btn btn-primary", style: "width:100%;margin-top:6px;", onclick: () => Router.navigate(`/transactions?acc=${id}&todo=1`) }, "Ver movimientos de esta cuenta")
  );
}

window.renderAccountDetail = renderAccountDetail;window.renderAccountDetail = renderAccountDetail;
