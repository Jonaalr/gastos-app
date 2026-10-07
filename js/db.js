/**
 * db.js — Capa de acceso a datos (IndexedDB)
 * ------------------------------------------
 * Todos los montos se guardan en CENTAVOS (enteros) para evitar errores
 * de redondeo con decimales. 160.00 MXN se guarda como 16000.
 *
 * Esquema:
 *
 * accounts
 *   id            (autoIncrement)
 *   name          string            "Banamex Débito"
 *   type          "cash"|"debit"|"credit"|"savings"
 *   bank          string|null       "Banamex"
 *   balanceCents  integer           saldo actual en centavos
 *   currency      "MXN"
 *   // solo type === "credit"
 *   cutDay        integer|null      día de corte (1-31)
 *   dueDay        integer|null      día límite de pago (1-31)
 *   creditLimitCents integer|null
 *   // solo type === "savings"
 *   annualRatePct number|null       tasa anual, ej. 11.5
 *   rateUpdatedAt string|null       ISO date de la última vez que se capitalizó
 *   createdAt     string ISO
 *   archived      boolean
 *
 * categories
 *   id            (autoIncrement)
 *   name          string
 *   parentId      integer|null      subcategoría si tiene parentId
 *   kind          "expense"|"income"
 *   icon          string            emoji
 *   isDefault     boolean
 *   autoRule      string|null       texto a matchear en comercio (ej. "oxxo")
 *
 * transactions
 *   id            (autoIncrement)
 *   type          "expense"|"income"|"transfer"
 *   amountCents   integer           siempre positivo; el signo lo da `type`
 *   accountId     integer           cuenta origen
 *   toAccountId   integer|null      solo en transfer
 *   categoryId    integer|null
 *   merchant      string
 *   note          string
 *   date          string ISO       fecha de la operación
 *   isRecurring   boolean           pago domiciliado
 *   recurringDay  integer|null      día del mes esperado
 *   attachment    blob|null         foto del ticket
 *   source        "manual"|"ocr"|"shortcut"|"import"
 *   createdAt     string ISO
 *
 * budgets
 *   id            (autoIncrement)
 *   categoryId    integer
 *   monthKey      string            "2026-10"
 *   limitCents    integer
 *
 * meta (key/value, para config general: nombre de usuario, etc.)
 *   key           string (keyPath)
 *   value         any
 */

const DB_NAME = "gastos_app_db";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("accounts")) {
        const store = db.createObjectStore("accounts", { keyPath: "id", autoIncrement: true });
        store.createIndex("type", "type");
        store.createIndex("archived", "archived");
      }

      if (!db.objectStoreNames.contains("categories")) {
        const store = db.createObjectStore("categories", { keyPath: "id", autoIncrement: true });
        store.createIndex("kind", "kind");
        store.createIndex("parentId", "parentId");
      }

      if (!db.objectStoreNames.contains("transactions")) {
        const store = db.createObjectStore("transactions", { keyPath: "id", autoIncrement: true });
        store.createIndex("date", "date");
        store.createIndex("accountId", "accountId");
        store.createIndex("categoryId", "categoryId");
        store.createIndex("type", "type");
        store.createIndex("isRecurring", "isRecurring");
      }

      if (!db.objectStoreNames.contains("budgets")) {
        const store = db.createObjectStore("budgets", { keyPath: "id", autoIncrement: true });
        store.createIndex("monthKey", "monthKey");
        store.createIndex("categoryId", "categoryId");
      }

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // ---------- Genéricos ----------
  async add(storeName, obj) {
    const store = await tx(storeName, "readwrite");
    return promisifyRequest(store.add(obj));
  },
  async put(storeName, obj) {
    const store = await tx(storeName, "readwrite");
    return promisifyRequest(store.put(obj));
  },
  async get(storeName, id) {
    const store = await tx(storeName);
    return promisifyRequest(store.get(id));
  },
  async getAll(storeName) {
    const store = await tx(storeName);
    return promisifyRequest(store.getAll());
  },
  async delete(storeName, id) {
    const store = await tx(storeName, "readwrite");
    return promisifyRequest(store.delete(id));
  },
  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName);
    const idx = store.index(indexName);
    return promisifyRequest(idx.getAll(value));
  },

  // ---------- Meta (config simple) ----------
  async getMeta(key, fallback = null) {
    const row = await DB.get("meta", key);
    return row ? row.value : fallback;
  },
  async setMeta(key, value) {
    return DB.put("meta", { key, value });
  },

  // ---------- Export / Import de respaldo ----------
  async exportAll() {
    const [accounts, categories, transactions, budgets, metaRows] = await Promise.all([
      DB.getAll("accounts"),
      DB.getAll("categories"),
      DB.getAll("transactions"),
      DB.getAll("budgets"),
      DB.getAll("meta"),
    ]);
    // Los adjuntos (blobs) se convierten a base64 para que quepan en JSON.
    const txSerializable = await Promise.all(
      transactions.map(async (t) => {
        if (t.attachment instanceof Blob) {
          const base64 = await blobToBase64(t.attachment);
          return { ...t, attachment: { __blob: true, mime: t.attachment.type, base64 } };
        }
        return t;
      })
    );
    return {
      exportedAt: new Date().toISOString(),
      version: DB_VERSION,
      accounts,
      categories,
      transactions: txSerializable,
      budgets,
      meta: metaRows,
    };
  },

  async importAll(data, { replace = true } = {}) {
    const db = await openDB();
    const storeNames = ["accounts", "categories", "transactions", "budgets", "meta"];
    const t = db.transaction(storeNames, "readwrite");

    if (replace) {
      for (const name of storeNames) t.objectStore(name).clear();
    }

    const put = (storeName, obj) => t.objectStore(storeName).put(obj);

    for (const a of data.accounts || []) put("accounts", a);
    for (const c of data.categories || []) put("categories", c);
    for (const b of data.budgets || []) put("budgets", b);
    for (const m of data.meta || []) put("meta", m);
    for (const tr of data.transactions || []) {
      if (tr.attachment && tr.attachment.__blob) {
        const blob = base64ToBlob(tr.attachment.base64, tr.attachment.mime);
        put("transactions", { ...tr, attachment: blob });
      } else {
        put("transactions", tr);
      }
    }

    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  },
};

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mime) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

window.DB = DB;
