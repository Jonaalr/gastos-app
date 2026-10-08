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

  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "list-item", onclick: () => Router.navigate("/accounts") }, [
        el("div", { class: "icon" }, "💳"),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Cuentas"), el("div", { class: "meta" }, "Agregar, editar, archivar")]),
        el("div", {}, "›"),
      ]),
      el("div", { class: "list-item", onclick: () => Router.navigate("/import") }, [
        el("div", { class: "icon" }, "📄"),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Importar estado de cuenta"), el("div", { class: "meta" }, "Lee un PDF de tu banco")]),
        el("div", {}, "›"),
      ]),
      el("div", { class: "list-item", onclick: () => Router.navigate("/receivables") }, [
        el("div", { class: "icon" }, "🤝"),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Por cobrar"), el("div", { class: "meta" }, "Personas que te deben por gastos compartidos")]),
        el("div", {}, "›"),
      ]),
      el("div", { class: "list-item", onclick: () => Router.navigate("/categories") }, [
        el("div", { class: "icon" }, "🏷️"),
        el("div", { class: "main" }, [el("div", { class: "title" }, "Categorías"), el("div", { class: "meta" }, "Predeterminadas y personalizadas")]),
        el("div", {}, "›"),
      ]),
    ])
  );

  root.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "card-title" }, "Respaldo"),
      el("div", { class: "text-dim", style: "font-size:13px;margin-bottom:12px;" }, "Tus datos viven solo en este iPhone. Haz un respaldo de vez en cuando por si cambias de teléfono o borras el navegador."),
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn btn-secondary", id: "btn-export" }, "Exportar respaldo"),
        el("button", { class: "btn btn-secondary", id: "btn-import" }, "Importar respaldo"),
      ]),
      el("input", { type: "file", id: "file-import", accept: "application/json", style: "display:none;" }),
    ])
  );

  root.querySelector("#btn-export").addEventListener("click", exportBackup);
  root.querySelector("#btn-import").addEventListener("click", () => root.querySelector("#file-import").click());
  root.querySelector("#file-import").addEventListener("change", importBackup);

  root.appendChild(
    el("div", { class: "text-center text-dim", style: "font-size:11px;margin-top:20px;" }, "Mis Gastos · datos 100% locales · sin cuentas, sin anuncios")
  );
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
  toast("Respaldo descargado", "success");
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
