/**
 * sw.js — Service Worker
 * Cachea los archivos de la app para que abra rápido y funcione offline.
 * Los DATOS viven en IndexedDB, no aquí — este archivo solo cachea código.
 */

const CACHE_NAME = "gastos-app-v25";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/utils.js",
  "./js/icons.js",
  "./js/select.js",
  "./icons/banks/revolut.png",
  "./icons/banks/nubank.png",
  "./icons/banks/didi.png",
  "./icons/banks/banamex.png",
  "./icons/banks/bbva.png",
  "./icons/banks/mercadopago.png",
  "./icons/banks/uala.png",
  "./icons/banks/spin.png",
  "./icons/banks/cashi.png",
  "./js/db.js",
  "./js/seed.js",
  "./js/router.js",
  "./js/datepicker.js",
  "./js/importers/pdf-lines.js",
  "./js/importers/banamex-credit.js",
  "./js/importers/index.js",
  "./js/views/import-statement.js",
  "./js/views/receivables.js",
  "./vendor/pdfjs/pdf.min.js",
  "./vendor/pdfjs/pdf.worker.min.js",
  "./js/views/dashboard.js",
  "./js/views/transactions.js",
  "./js/views/accounts.js",
  "./js/views/categories.js",
  "./js/views/budgets.js",
  "./js/views/calendar.js",
  "./js/views/reports.js",
  "./js/views/settings.js",
  "./js/views/account-detail.js",
  "./js/sheet-gestures.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  // cache:"reload" salta la caché HTTP de GitHub Pages para bajar siempre la versión más nueva
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Red primero (siempre la versión más nueva); si no hay internet, usa lo guardado.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
