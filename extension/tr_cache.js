/**
 * Subtitle Study — 2-Tier Translation Cache + Batch Proxy Module (tr_cache.js)
 * Clean-room Manifest V3 module (zero external dependencies, strict DOM-safe).
 *
 * Tier 1: 128-entry hot in-memory LRU Map
 * Tier 2: IndexedDB ('ss_translation_cache_v1' / store 'entries', max 5000 entries pruned oldest-first by updatedAt)
 * Cache key format: `${model}|${tl}|${glossaryHash}|${text}`
 */
(function (root) {
  'use strict';

  const DB_NAME = 'ss_translation_cache_v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'entries';
  const UPDATED_AT_INDEX = 'by_updatedAt';
  const MAX_MEM_ENTRIES = 128;
  const MAX_IDB_ENTRIES = 5000;
  const FALLBACK_CONCURRENCY = 4;
  const COMPANION_TIMEOUT_MS = 60000;

  const memCache = new Map();
  let dbPromise = null;
  let boundIdbFactory = null;
  let lastMonotonicTs = 0;

  function nextUpdatedAt() {
    const now = Date.now();
    lastMonotonicTs = now > lastMonotonicTs ? now : lastMonotonicTs + 1;
    return lastMonotonicTs;
  }

  function hashStringFNV1a(input) {
    const str = String(input || '');
    if (!str) return '';
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function resolveGlossaryHash(body) {
    if (!body || typeof body !== 'object') return '';
    if (body.glossaryHash !== undefined && body.glossaryHash !== null) {
      return String(body.glossaryHash);
    }
    if (body.glossary_hash !== undefined && body.glossary_hash !== null) {
      return String(body.glossary_hash);
    }
    if (body.glossary) {
      try {
        const serialized = typeof body.glossary === 'string'
          ? body.glossary
          : JSON.stringify(body.glossary);
        return hashStringFNV1a(serialized);
      } catch (_) {
        return '';
      }
    }
    return '';
  }

  function buildTrCacheKey(model, tl, glossaryHash, text) {
    return `${model ?? ''}|${tl ?? ''}|${glossaryHash ?? ''}|${text ?? ''}`;
  }

  function memTouch(key, value) {
    if (memCache.has(key)) memCache.delete(key);
    memCache.set(key, value);
    while (memCache.size > MAX_MEM_ENTRIES) {
      const oldestKey = memCache.keys().next().value;
      if (oldestKey === undefined) break;
      memCache.delete(oldestKey);
    }
  }

  function getIdbFactory() {
    if (root && root.indexedDB) return root.indexedDB;
    if (typeof indexedDB !== 'undefined') return indexedDB;
    return null;
  }

  function openCacheDb() {
    const idb = getIdbFactory();
    if (!idb || typeof idb.open !== 'function') return Promise.resolve(null);
    if (dbPromise && boundIdbFactory === idb) return dbPromise;
    boundIdbFactory = idb;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (_) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = function (event) {
        const db = (event && event.target && event.target.result) || req.result;
        if (!db) return;
        let store;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        } else if (req.transaction) {
          store = req.transaction.objectStore(STORE_NAME);
        }
        if (store && store.indexNames && !store.indexNames.contains(UPDATED_AT_INDEX)) {
          if (typeof store.createIndex === 'function') {
            store.createIndex(UPDATED_AT_INDEX, 'updatedAt', { unique: false });
          }
        }
      };
      req.onsuccess = function () {
        const db = req.result || null;
        if (db && typeof db.onversionchange !== 'undefined') {
          db.onversionchange = function () {
            try { db.close(); } catch (_) {}
            if (boundIdbFactory === idb) dbPromise = null;
          };
        }
        resolve(db);
      };
      req.onerror = function () { dbPromise = null; resolve(null); };
      req.onblocked = function () { dbPromise = null; resolve(null); };
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB request failed')); };
    });
  }

  function txCompletePromise(tx) {
    return new Promise((resolve, reject) => {
      if (!tx) { resolve(); return; }
      let settled = false;
      const finishOk = function () { if (!settled) { settled = true; resolve(); } };
      const finishErr = function () { if (!settled) { settled = true; reject(tx.error || new Error('IndexedDB transaction failed')); } };
      tx.oncomplete = finishOk;
      tx.onerror = finishErr;
      tx.onabort = finishErr;
      if (tx._synchronousComplete === true) finishOk();
    });
  }

  async function pruneIdbStoreIfNeeded(store) {
    const total = await reqToPromise(store.count());
    if (typeof total !== 'number' || total <= MAX_IDB_ENTRIES) return;
    let toRemove = total - MAX_IDB_ENTRIES;
    const hasIndexCursor = store.indexNames && typeof store.indexNames.contains === 'function' &&
      store.indexNames.contains(UPDATED_AT_INDEX) && typeof store.index === 'function';
    if (hasIndexCursor) {
      const idx = store.index(UPDATED_AT_INDEX);
      if (idx && typeof idx.openCursor === 'function') {
        await new Promise((resolve, reject) => {
          const cursorReq = idx.openCursor(null, 'next');
          cursorReq.onsuccess = function () {
            const cursor = cursorReq.result;
            if (!cursor || toRemove <= 0) { resolve(); return; }
            if (typeof cursor.delete === 'function') cursor.delete();
            else if (cursor.primaryKey !== undefined) store.delete(cursor.primaryKey);
            toRemove -= 1;
            if (toRemove > 0) cursor.continue();
            else resolve();
          };
          cursorReq.onerror = function () { reject(cursorReq.error || new Error('Cursor prune failed')); };
        });
        return;
      }
    }
    if (typeof store.getAll === 'function') {
      const records = await reqToPromise(store.getAll());
      if (Array.isArray(records) && records.length > MAX_IDB_ENTRIES) {
        records.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
        for (let i = 0; i < toRemove && i < records.length; i++) {
          await reqToPromise(store.delete(records[i].key));
        }
      }
    }
  }

  async function trCacheGet(key) {
    const k = String(key);
    if (memCache.has(k)) {
      const hit = memCache.get(k);
      memTouch(k, hit);
      return hit;
    }
    const db = await openCacheDb();
    if (!db) return undefined;
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const record = await reqToPromise(store.get(k));
      if (record && Object.prototype.hasOwnProperty.call(record, 'value')) {
        memTouch(k, record.value);
        return record.value;
      }
    } catch (_) {
      return undefined;
    }
    return undefined;
  }

  async function trCacheSet(key, value) {
    const k = String(key);
    memTouch(k, value);
    const db = await openCacheDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = txCompletePromise(tx);
      const store = tx.objectStore(STORE_NAME);
      await reqToPromise(store.put({ key: k, value, updatedAt: nextUpdatedAt() }));
      await pruneIdbStoreIfNeeded(store);
      await done;
    } catch (_) {}
  }

  async function trCacheClear() {
    memCache.clear();
    const db = await openCacheDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = txCompletePromise(tx);
      const store = tx.objectStore(STORE_NAME);
      await reqToPromise(store.clear());
      await done;
    } catch (_) {}
  }

  async function unwrapCompanionResponse(rawRes) {
    if (!rawRes || typeof rawRes !== 'object') return { ok: false, status: 0, payload: null };
    const status = typeof rawRes.status === 'number' ? rawRes.status : (rawRes.ok ? 200 : 500);
    if (typeof rawRes.json === 'function' && rawRes.translations === undefined && rawRes.translation === undefined && rawRes.data === undefined) {
      try {
        const parsed = await rawRes.json();
        const ok = Boolean(rawRes.ok) && (parsed && parsed.ok !== false);
        return { ok, status, payload: parsed };
      } catch (_) {
        return { ok: false, status, payload: null };
      }
    }
    const ok = rawRes.ok !== undefined ? Boolean(rawRes.ok) : status >= 200 && status < 300;
    const payload = rawRes.data && typeof rawRes.data === 'object' ? rawRes.data : rawRes;
    return { ok, status, payload };
  }

  function extractBatchTranslationsMap(payload, missingSegments) {
    const out = new Map();
    if (!payload || typeof payload !== 'object') return out;
    const list = Array.isArray(payload.translations)
      ? payload.translations
      : Array.isArray(payload.results)
        ? payload.results
        : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (typeof item === 'string') {
          if (i < missingSegments.length) out.set(missingSegments[i].id, item);
        } else if (item && typeof item === 'object') {
          const itemId = item.id !== undefined ? item.id : (i < missingSegments.length ? missingSegments[i].id : undefined);
          const tr = item.translation ?? item.translated_text ?? item.text;
          if (itemId !== undefined && typeof tr === 'string') out.set(itemId, tr);
        }
      }
      return out;
    }
    if (payload.translations && typeof payload.translations === 'object') {
      for (const seg of missingSegments) {
        const tr = payload.translations[seg.id];
        if (typeof tr === 'string') out.set(seg.id, tr);
      }
    }
    return out;
  }

  function extractSingleTranslation(payload) {
    if (typeof payload === 'string') return payload;
    if (!payload || typeof payload !== 'object') return null;
    const val = payload.translation ?? payload.translated_text ?? payload.result ?? payload.text;
    return typeof val === 'string' ? val : null;
  }

  async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const laneCount = Math.max(1, Math.min(limit, items.length));
    async function lane() {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    }
    const lanes = [];
    for (let i = 0; i < laneCount; i++) lanes.push(lane());
    await Promise.all(lanes);
    return results;
  }

  async function handleTranslateBatch(callCompanion, body) {
    if (typeof callCompanion !== 'function') {
      throw new TypeError('handleTranslateBatch requires a callCompanion function');
    }
    const reqBody = body && typeof body === 'object' ? body : {};
    const segments = Array.isArray(reqBody.segments) ? reqBody.segments : [];
    if (segments.length === 0) return { ok: true, translations: [] };

    const model = reqBody.model ?? '';
    const tl = reqBody.target_lang ?? reqBody.tl ?? '';
    const glossaryHash = resolveGlossaryHash(reqBody);

    const orderedResults = new Array(segments.length);
    const missing = [];
    const missingIndexMap = new Map();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] || {};
      const segId = seg.id !== undefined ? seg.id : i;
      const segText = String(seg.text ?? '');
      const key = buildTrCacheKey(model, tl, glossaryHash, segText);

      if (!segText.trim()) {
        orderedResults[i] = { id: segId, translation: '', cached: true };
        continue;
      }

      const cachedVal = await trCacheGet(key);
      if (cachedVal !== undefined) {
        orderedResults[i] = { id: segId, translation: String(cachedVal), cached: true };
      } else {
        if (!missingIndexMap.has(segId)) {
          const missEntry = { id: segId, text: segText };
          if (seg.context !== undefined) missEntry.context = seg.context;
          missing.push(missEntry);
          missingIndexMap.set(segId, []);
        }
        missingIndexMap.get(segId).push({ index: i, key });
      }
    }

    if (missing.length === 0) return { ok: true, translations: orderedResults };

    let batchSucceeded = false;
    let resolvedTranslations = new Map();

    try {
      const batchRaw = await callCompanion('/translate_batch', { ...reqBody, segments: missing }, 'POST', COMPANION_TIMEOUT_MS);
      const unwrapped = await unwrapCompanionResponse(batchRaw);
      if (unwrapped.status !== 404 && unwrapped.ok) {
        const extracted = extractBatchTranslationsMap(unwrapped.payload, missing);
        if (extracted.size === missing.length) {
          resolvedTranslations = extracted;
          batchSucceeded = true;
        }
      }
    } catch (_) {
      batchSucceeded = false;
    }

    if (!batchSucceeded) {
      let fallbackError = null;
      const singlePairs = await runWithConcurrency(missing, FALLBACK_CONCURRENCY, async (seg) => {
        const context = seg.context !== undefined ? seg.context : (reqBody.context !== undefined ? reqBody.context : '');
        const singleRaw = await callCompanion(
          '/translate_text',
          { text: seg.text, target_lang: reqBody.target_lang ?? tl, context, model: reqBody.model, device: reqBody.device },
          'POST',
          COMPANION_TIMEOUT_MS
        );
        const unwrapped = await unwrapCompanionResponse(singleRaw);
        if (!unwrapped.ok) {
          fallbackError = (unwrapped.payload && unwrapped.payload.error) || `HTTP ${unwrapped.status}`;
          return { id: seg.id, translation: null };
        }
        const tr = extractSingleTranslation(unwrapped.payload);
        if (tr === null) {
          fallbackError = 'Invalid /translate_text response payload';
          return { id: seg.id, translation: null };
        }
        return { id: seg.id, translation: tr };
      });

      for (const pair of singlePairs) {
        if (pair && pair.translation !== null) resolvedTranslations.set(pair.id, pair.translation);
      }
      if (fallbackError && resolvedTranslations.size === 0) {
        return { ok: false, error: String(fallbackError), translations: orderedResults.filter(Boolean) };
      }
    }

    for (const seg of missing) {
      const tr = resolvedTranslations.has(seg.id) ? resolvedTranslations.get(seg.id) : '';
      const targets = missingIndexMap.get(seg.id) || [];
      for (let j = 0; j < targets.length; j++) {
        const { index, key } = targets[j];
        if (resolvedTranslations.has(seg.id)) await trCacheSet(key, tr);
        orderedResults[index] = { id: seg.id, translation: tr, cached: false };
      }
    }

    return { ok: true, translations: orderedResults };
  }

  async function _resetForTests() {
    memCache.clear();
    if (dbPromise) {
      try {
        const db = await dbPromise;
        if (db && typeof db.close === 'function') db.close();
      } catch (_) {}
    }
    dbPromise = null;
    boundIdbFactory = null;
    lastMonotonicTs = 0;
  }

  function _getMemCacheSnapshot() {
    return Array.from(memCache.entries());
  }

  const api = {
    DB_NAME,
    STORE_NAME,
    MAX_MEM_ENTRIES,
    MAX_IDB_ENTRIES,
    FALLBACK_CONCURRENCY,
    buildTrCacheKey,
    trCacheGet,
    trCacheSet,
    trCacheClear,
    handleTranslateBatch,
    _resetForTests,
    _getMemCacheSnapshot,
  };

  root.SS_TR_CACHE = api;
  root.trCacheGet = trCacheGet;
  root.trCacheSet = trCacheSet;
  root.trCacheClear = trCacheClear;
  root.handleTranslateBatch = handleTranslateBatch;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
