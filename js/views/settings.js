/**
 * settings.js — Nombre, accesos a Cuentas/Categorías, y respaldo (export/import JSON).
 */

async function renderSettings(root) {
  const userName = await DB.getMeta("userName", "");

  root.appendChild(el("div", { class: "topbar" }, [el("h1", {}, "Ajustes")]));

  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "form-group", style: "margin-bottom:0;" }, [
        el("label", {}, "Tu nombre"),
        el("input", { type: "text", id: "f-username", value: userName, placeholder: "¿Cómo te llamas?" }),
      ]),
    ])
  );
  root.querySelector("#f-username").addEventListener("blur", async (e) => {
    await DB.setMeta("userName", e.target.value.trim());
    toast("Guardado", "success");
  });

  const current = getThemePref();
  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, "Apariencia"),
      el(
        "div",
        { class: "segmented" },
        [["system", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]].map(([value, label]) =>
          el("button", {
            type: "button",
            class: current === value ? "active" : "",
            onclick: () => { setThemePref(value); Router.render(); },
          }, label)
        )
      ),
    ])
  );

  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "list-item", onclick: () => Router.navigate("/accounts") }, [
        el("div", { class: "icon" }, iconNode("card")),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Cuentas"), el("div", { class: "meta" }, "Agregar, editar, archivar")]),
        el("div", {}, "›"),
      ]),
      el("div", { class: "list-item", onclick: () => Router.navigate("/import") }, [
        el("div", { class: "icon" }, iconNode("receipt")),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Importar estado de cuenta"), el("div", { class: "meta" }, "Lee un PDF de tu banco")]),
        el("div", {}, "›"),
      ]),
      el("div", { class: "list-item", onclick: () => Router.navigate("/receivables") }, [
        el("div", { class: "icon" }, iconNode("handshake")),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Préstamos y compartidos"), el("div", { class: "meta" }, "Lo que te deben")]),
        el("div", {}, "›"),
      ]),
      el("div", { class: "list-item", onclick: () => Router.navigate("/categories") }, [
        el("div", { class: "icon" }, iconNode("tag")),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Categorías"), el("div", { class: "meta" }, "Predeterminadas y personalizadas")]),
        el("div", {}, "›"),
      ]),
    ])
  );

  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, "Respaldo"),
      el("div", { class: "text-dim", style: "font-size:13px;margin-bottom:12px;" }, "Tus datos viven solo en este iPhone. Haz un respaldo cada semana por si cambias de teléfono o borras el navegador. Ojo: Safari y el icono de la pantalla de inicio guardan datos por separado; exporta e importa desde la misma."),
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn btn-secondary", id: "btn-export" }, "Exportar respaldo"),
        el("button", { class: "btn btn-secondary", id: "btn-import" }, "Importar respaldo"),
      ]),
      el("input", { type: "file", id: "file-import", accept: "application/json", style: "display:none;" }),
    ])
  );

  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, "Borrar todos los datos"),
      el("div", { class: "text-dim", style: "font-size:13px;margin-bottom:12px;" }, "Elimina cuentas, movimientos, personas, cobros y presupuestos de este iPhone. No se puede deshacer."),
      el("button", { class: "btn btn-danger", id: "btn-wipe" }, "Borrar todos los datos"),
    ])
  );
  root.querySelector("#btn-wipe").addEventListener("click", wipeAllData);

  root.querySelector("#btn-export").addEventListener("click", exportBackup);
  root.querySelector("#btn-import").addEventListener("click", () => root.querySelector("#file-import").click());
  root.querySelector("#file-import").addEventListener("change", importBackup);

  root.appendChild(
    el("div", { class: "text-center text-dim", style: "font-size:11px;margin-top:20px;" }, "Mis Gastos · datos 100% locales · sin cuentas, sin anuncios")
  );
}

async function wipeAllData() {
  if (!confirm("¿Borrar TODOS los datos de esta app? Esta acción no se puede deshacer.")) return;
  const word = prompt('Para confirmar, escribe BORRAR (en mayúsculas):');
  if (word !== "BORRAR") {
    toast("Borrado cancelado", "info");
    return;
  }
  try {
    await DB.clearAll();
    await seedIfNeeded();
    toast("Datos borrados. La app está lista para empezar de nuevo.", "success");
    Router.navigate("/dashboard");
    Router.render();
  } catch (err) {
    console.error(err);
    toast("No se pudieron borrar los datos", "error");
  }
}

async function exportBackup() {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gastos-respaldo-${DateUtil.todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  await DB.setMeta("lastBackupAt", new Date().toISOString());
  toast("Respaldo descargado", "success");
}

const BACKUP_EVERY_DAYS = 7;

/**
 * Aviso para respaldar: aparece en Inicio si no hay respaldo reciente (7 días).
 * "Más tarde" lo oculta 2 días. No aparece si aún no tienes datos.
 */
async function backupReminderCard() {
  const [accounts, transactions, last, snoozeUntil] = await Promise.all([
    DB.getAll("accounts"),
    DB.getAll("transactions"),
    DB.getMeta("lastBackupAt", null),
    DB.getMeta("backupSnoozeUntil", null),
  ]);
  if (accounts.length === 0 && transactions.length === 0) return null;

  const today = DateUtil.todayISO();
  if (snoozeUntil && snoozeUntil >= today) return null;

  const days = last ? DateUtil.daysBetween(DateUtil.toISO(new Date(last)), today) : null;
  if (days !== null && days < BACKUP_EVERY_DAYS) return null;

  const text = days === null
    ? "Aún no has descargado un respaldo de tus datos."
    : `Tu último respaldo fue hace ${days} ${days === 1 ? "día" : "días"}.`;

  return el("div", { class: "card backup-reminder" }, [
    el("div", { class: "card-title" }, "Respalda tus datos"),
    el("div", { class: "text-dim", style: "font-size:13px;margin-bottom:12px;" }, `${text} Guárdalo en Archivos o iCloud Drive.`),
    el("div", { class: "btn-row" }, [
      el("button", { class: "btn", onclick: exportBackup }, "Exportar ahora"),
      el("button", {
        class: "btn btn-secondary",
        onclick: async () => {
          const d = new Date();
          d.setDate(d.getDate() + 2);
          await DB.setMeta("backupSnoozeUntil", DateUtil.toISO(d));
          Router.render();
        },
      }, "Más tarde"),
    ]),
  ]);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm("Importar reemplazará TODOS los datos actuales con los del respaldo. ¿Continuar?")) {
    e.target.value = "";
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await DB.importAll(data, { replace: true });
    toast("Respaldo importado", "success");
    Router.navigate("/dashboard");
  } catch (err) {
    console.error(err);
    toast("No se pudo leer el archivo de respaldo", "error");
  }
  e.target.value = "";
}

window.renderSettings = renderSettings;
