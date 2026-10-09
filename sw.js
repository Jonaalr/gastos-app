/**
 * sw.js — Service Worker
 * Cachea los archivos de la app para que abra rápido y funcione offline.
 * Los DATOS viven en IndexedDB, no aquí — este archivo solo cachea código.
 */

const CACHE_NAME = "gastos-app-v94";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/utils.js",
  "./js/icons.js",
  "./js/select.js",
  "./js/capture.js",
  "./js/views/reconcile.js",
  "./js/views/goals.js",
  "./js/recurring.js",
  "./js/views/debts.js",
  "./js/views/loans.js",
  "./js/importers/revolut-credit.js",
  "./js/importers/bbva-credit.js",
  "./js/importers/nu-credit.js",
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

// Red primero, pero si tarda más de 2.5 s abre lo guardado (y la red actualiza la caché en segundo plano).
// Así la app no se queda en pantalla negra con internet lento.
const NETWORK_WAIT_MS = 2500;
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const networkP = fetch(event.request, { cache: "no-cache" }).then((response) => {
      if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    });
    const quick = await Promise.race([
      networkP.then((r) => ({ r }), () => ({ failed: true })),
      new Promise((resolve) => setTimeout(() => resolve({ slow: true }), NETWORK_WAIT_MS)),
    ]);
    if (quick.r) return quick.r;
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      return await networkP;
    } catch (err) {
      return (await caches.match("./index.html")) || Response.error();
    }
  })());
});
