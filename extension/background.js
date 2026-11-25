try { if (typeof importScripts === 'function') importScripts('tr_cache.js'); } catch (e) {}
// Background service worker (12-Language Multi-Site Edition):
//  1) Multilingual dictionary lookup (local companion G:\dict_src when online -> Wiktionary REST w/ examples fallback)
//  2) Tatoeba CC-BY 2.0 parallel example concordancer across all 12 languages (op === 'examples')
//  3) Local companion proxy (http://127.0.0.1:8787) bypassing streaming site page CSP
//  4) Native AnkiConnect proxy (http://127.0.0.1:8765) for 1-click card + screenshot push
//  5) Universal 12-language N×N Formulaic Expression & Glossary Hint engine (op === 'matchTextIdioms') — indexes fe_*.json once
//     inside the service worker so every webpage gets <3ms idiom highlights & MT localization hints without exposing data/*
//  6) Persistent 2-tier Translation LRU Cache (256 hot memory + 8,000-entry IndexedDB with 7-day TTL)
//  7) Webpage-to-Study-Deck saver (op === 'saveWebItem') & Burned-In Video Frame OCR bridge (op === 'ocrFrame')

if (typeof importScripts === 'function') {
  try { importScripts('lang.js', 'idioms.js'); } catch (e) {}
  importScripts('watched_scenes.js');
  try { importScripts('storage.js'); } catch (e) {}
  try { importScripts('pron.js'); } catch (e) {}
  try { importScripts('cedict.js'); } catch (e) {}   // bundled CC-CEDICT: Chinese lookups without the companion (Claude, 2026-11-18)
  try { importScripts('packs.js'); } catch (e) {}    // offline dictionary packs, all 12 languages (Claude, 2026-11-18)
  importScripts('user-dictionaries.js');
}

let dictCompanionDownUntil = 0;

// Offline Chinese fallback used by both lookup paths when the companion has nothing (or isn't running).
async function cedictSource(words, lang) {
  if (typeof self.cedictLookup !== 'function') return null;
  const base = (lang || '').toLowerCase().split(/[-_]/)[0];
  if (base === 'ja' || base === 'ko') return null;   // kanji/hanja words belong to JMdict/Korean dictionaries
  for (const w of words || []) {
    if (!/[㐀-鿿]/.test(w) || /[぀-ヿ가-힯]/.test(w)) continue;
    try {
      const hits = await self.cedictLookup(w);
      // CC-CEDICT readings are Mandarin pinyin, so they are left out for Cantonese videos.
      if (hits.length) return { id: 'cedict_bundled', name: 'CC-CEDICT', note: base === 'yue' ? 'bundled · Mandarin dictionary, no Cantonese reading' : 'bundled with the extension', licence: 'CC BY-SA 4.0', word: w, entries: hits.map((e) => ({ head: e.trad !== e.head ? e.head + ' (' + e.trad + ')' : e.head, reading: base === 'yue' ? '' : e.reading, pos: '', defs: e.defs, examples: [] })) };
    } catch (e) {}
  }
  return null;
}

const strip = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const cache = new Map();
// Compressed audio is shared by tabs in this extension profile. The page keeps its decoded hot cache.
const pendingSpeech = new Map();
let speechDatabase;
function openSpeechDatabase() {
  if (!speechDatabase) speechDatabase = new Promise((resolve,reject) => {
    const open = indexedDB.open('phrasebound-speech-v1',1);
    open.onupgradeneeded = () => open.result.createObjectStore('clips').createIndex('ageSize',['time','size']);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => { db.close(); speechDatabase = null; };
      resolve(db);
    };
  }).catch(error => { speechDatabase = null; throw error; });
  return speechDatabase;
}
async function cachedSpeech(key) {
  const db = await openSpeechDatabase();
  return new Promise((resolve,reject) => {
    const req = db.transaction('clips').objectStore('clips').get(key);
    req.onsuccess = () => resolve(req.result?.bytes);
    req.onerror = () => reject(req.error);
  });
}
async function storeSpeech(key,bytes) {
  const db = await openSpeechDatabase();
  await new Promise((resolve,reject) => {
    const tx = db.transaction('clips','readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    const store = tx.objectStore('clips');
    store.put({bytes,time:Date.now(),size:bytes.byteLength},key);
    let count = 0, size = 0;
    const scan = store.index('ageSize').openKeyCursor(null,'prev');
    scan.onsuccess = () => {
      const cursor = scan.result;
      if (!cursor) return;
      count++;
      size += cursor.key[1];
      if (count > 128 || size > 8 * 1024 * 1024) store.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}
async function speechAudio(lang,text,key) {
  let bytes = await cachedSpeech(key).catch(() => null);
  if (!bytes) {
    const query = new URLSearchParams({client:'tw-ob',ie:'UTF-8',tl:lang,q:text});
    const response = await fetch('https://translate.google.com/translate_tts?' + query, {
      credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(12000)
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw Error('No audio');
    bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 1024*1024) throw Error('Invalid audio size');
    await storeSpeech(key,bytes).catch(() => {});
  }
  let binary = '';
  for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
function sharedSpeechAudio(lang,text) {
  const key = JSON.stringify(['google-tw-ob',lang,text]);
  if (!pendingSpeech.has(key)) {
    pendingSpeech.set(key,speechAudio(lang,text,key).finally(() => pendingSpeech.delete(key)));
  }
  return pendingSpeech.get(key);
}

const extDataCache = new Map();
const exampleCache = new Map();
let companionUrl = 'http://127.0.0.1:8787';
const NATIVE_HOST_NAME = 'com.phrasebound.companion';
let nativeWakePromise = null;
let nativeWakeCooldownUntil = 0;
let nativeHostMissingUntil = 0;
let autoStartCompanionEnabled = true;
// Local AI switched off in the popup: no requests reach the companion and nothing wakes it (frees the GPU)
let companionOff = false;
const isLocalCompanion = () => /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(companionUrl);

try {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['ss_set'], (r) => {
      const st = r && r.ss_set;
      if (st && typeof st.autoStartCompanion === 'boolean') {
        autoStartCompanionEnabled = st.autoStartCompanion;
      }
      companionOff = !!(st && st.companionOff);
      if (st && st.companionUrl) {
        companionUrl = String(st.companionUrl).replace(/\/+$/, '');
      }
    });
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        const nv = changes && changes.ss_set && changes.ss_set.newValue;
        if (nv && typeof nv.autoStartCompanion === 'boolean') {
          autoStartCompanionEnabled = nv.autoStartCompanion;
        }
        if (nv) companionOff = !!nv.companionOff;
        if (nv && nv.companionUrl) {
          companionUrl = String(nv.companionUrl).replace(/\/+$/, '');
        }
      });
    }
  }
} catch (e) {}

async function ensureCompanionRunning(force = false) {
  if (companionOff && !force) return { ok: false, skipped: true, off: true };
  if (!force && (!autoStartCompanionEnabled || Date.now() < nativeHostMissingUntil || Date.now() < nativeWakeCooldownUntil)) {
    return { ok: false, skipped: true };
  }
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendNativeMessage !== 'function') {
    return { ok: false, error: 'nativeMessaging API unavailable' };
  }
  if (nativeWakePromise) return nativeWakePromise;
  nativeWakeCooldownUntil = Date.now() + 20000;
  nativeWakePromise = new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { op: 'ensure' }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = String(err.message || err);
          if (/not found|forbidden|specified native messaging host/i.test(msg)) {
            nativeHostMissingUntil = Date.now() + 300000;
          }
          resolve({ ok: false, error: msg });
          return;
        }
        resolve(resp && typeof resp === 'object' ? resp : { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  }).finally(() => { nativeWakePromise = null; });
  return nativeWakePromise;
}

// Stable session UUID for OpenCode-compatible endpoints (prevents per-call session churn)
const SESSION_UUID = (() => {
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
})();

const setLru = (map, key, val, max = 300) => {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  if (map.size > max) map.delete(map.keys().next().value);
};

// ---------------------------------------------------------------------------
// 2-Tier Persistent Translation Cache (256 hot memory + IndexedDB LRU)
// ---------------------------------------------------------------------------
const TR_HOT_MAX = 256;
const TR_IDB_MAX = 8000;
const TR_TTL_MS = 7 * 86400000;
const trHotCache = new Map();
let _trDbPromise = null;

function openTrCacheDb() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
  if (_trDbPromise) return _trDbPromise;
  _trDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('ss_tr_cache_v1', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          const st = db.createObjectStore('entries', { keyPath: 'k' });
          st.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return _trDbPromise;
}

async function trCacheGetMany(keys) {
  const out = {};
  const miss = [];
  const now = Date.now();
  for (const k of keys || []) {
    if (!k) continue;
    const hot = trHotCache.get(k);
    if (hot && now - hot.ts <= TR_TTL_MS) {
      hot.ts = now;
      setLru(trHotCache, k, hot, TR_HOT_MAX);
      out[k] = hot.v;
    } else {
      if (hot) trHotCache.delete(k);
      miss.push(k);
    }
  }
  if (!miss.length) return out;
  const db = await openTrCacheDb();
  if (!db) return out;
  await new Promise((res) => {
    try {
      const tx = db.transaction('entries', 'readonly');
      const st = tx.objectStore('entries');
      let rem = miss.length;
      for (const k of miss) {
        const rq = st.get(k);
        rq.onsuccess = () => {
          const row = rq.result;
          if (row && row.v && now - (row.ts || 0) <= TR_TTL_MS) {
            out[k] = row.v;
            setLru(trHotCache, k, { v: row.v, ts: now }, TR_HOT_MAX);
          }
          if (--rem <= 0) res();
        };
        rq.onerror = () => { if (--rem <= 0) res(); };
      }
    } catch (e) { res(); }
  });
  return out;
}

async function trCachePutMany(entries) {
  if (!Array.isArray(entries) || !entries.length) return { ok: true, saved: 0 };
  const now = Date.now();
  for (const e of entries) {
    if (e && e.k && e.v) setLru(trHotCache, e.k, { v: e.v, ts: now }, TR_HOT_MAX);
  }
  const db = await openTrCacheDb();
  if (!db) return { ok: true, saved: entries.length };
  await new Promise((res) => {
    try {
      const tx = db.transaction('entries', 'readwrite');
      const st = tx.objectStore('entries');
      for (const e of entries) {
        if (e && e.k && e.v) st.put({ k: e.k, v: e.v, ts: now });
      }
      const cntReq = st.count();
      cntReq.onsuccess = () => {
        const excess = (cntReq.result || 0) - TR_IDB_MAX;
        if (excess > 0) {
          const idx = st.index('ts');
          let deleted = 0;
          const cur = idx.openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (c && deleted < excess + 200) {
              c.delete();
              deleted++;
              c.continue();
            }
          };
        }
      };
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    } catch (e) { res(); }
  });
  return { ok: true, saved: entries.length };
}

async function trCacheStatsAndClear(clear = false) {
  if (clear) trHotCache.clear();
  const db = await openTrCacheDb();
  if (!db) return { ok: true, hot: trHotCache.size, idb: 0 };
  return await new Promise((res) => {
    try {
      const tx = db.transaction('entries', clear ? 'readwrite' : 'readonly');
      const st = tx.objectStore('entries');
      if (clear) {
        st.clear();
        tx.oncomplete = () => res({ ok: true, hot: 0, idb: 0 });
        tx.onerror = () => res({ ok: false, hot: 0, idb: 0 });
      } else {
        const rq = st.count();
        rq.onsuccess = () => res({ ok: true, hot: trHotCache.size, idb: rq.result || 0 });
        rq.onerror = () => res({ ok: true, hot: trHotCache.size, idb: 0 });
      }
    } catch (e) {
      res({ ok: true, hot: trHotCache.size, idb: 0 });
    }
  });
}

// ---------------------------------------------------------------------------
// Universal 5-Language Service-Worker Formulaic Expression Matcher
// ---------------------------------------------------------------------------
const CANTONESE_MARKERS_RE = /[嘅喺咁噉咗冇係唔嚟畀俾搵諗睇攞仲晒哂喎囉㗎咩啲]/;
const _dataJsonCache = new Map();
const _feIndexCache = new Map();
let _zhChengyuLookup = null;

async function loadExtensionJson(relPath) {
  if (_dataJsonCache.has(relPath)) return _dataJsonCache.get(relPath);
  try {
    const url = chrome.runtime.getURL(relPath);
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    _dataJsonCache.set(relPath, j);
    return j;
  } catch (e) {
    return null;
  }
}

async function getZhChengyuLookup() {
  if (_zhChengyuLookup) return _zhChengyuLookup;
  const zhJson = await loadExtensionJson('data/fe_zh.json');
  const map = new Map();
  if (zhJson && Array.isArray(zhJson.items)) {
    for (const row of zhJson.items) {
      const [disp, , pri, rd, gEn, gZh, keys] = row;
      if (!disp) continue;
      const entry = { display: disp, pri: pri || 0, reading: rd || '', gloss: gEn || gZh || '', glossEn: gEn || '', glossZh: gZh || '' };
      const put = (k) => {
        if (!k) return;
        const prev = map.get(k);
        if (!prev || ((!prev.glossEn && !prev.glossZh) && (entry.glossEn || entry.glossZh)) || (entry.pri > prev.pri && (entry.glossEn || entry.glossZh))) {
          map.set(k, entry);
        }
      };
      put(disp);
      for (const k of keys || []) put(k);
    }
  }
  _zhChengyuLookup = map;
  return map;
}

function lookupChengyuSync(map, rawZh) {
  if (!map || !rawZh) return null;
  const cands = (Array.isArray(rawZh) ? rawZh : [rawZh])
    .flatMap((x) => String(x || '').split(/[；;、,，/]/))
    .map((x) => x.trim())
    .filter(Boolean);
  let fallback = null;
  for (const k of cands) {
    const hit = map.get(k);
    if (hit) {
      if (hit.glossEn || hit.glossZh) return hit;
      if (!fallback) fallback = hit;
    }
  }
  return fallback;
}

const _sidecarMissCache = new Set();

async function loadSwGlossSidecar(srcLang, uiLang) {
  const IDIOMS = typeof SS_IDIOMS !== 'undefined' ? SS_IDIOMS : globalThis.SS_IDIOMS;
  const s = IDIOMS ? IDIOMS.normLang(srcLang) : String(srcLang || 'en').toLowerCase();
  const u = IDIOMS ? IDIOMS.normLang(uiLang) : String(uiLang || 'en').toLowerCase();
  if (!s || !u || s === u) return null;
  const rel = `data/gloss_${s}_${u}.json`;
  if (_sidecarMissCache.has(rel)) return null;
  const data = await loadExtensionJson(rel);
  if (!data) _sidecarMissCache.add(rel);
  return data;
}

function detectBlockLanguage(texts, hint = '') {
  const LANG = typeof SS_LANG !== 'undefined' ? SS_LANG : globalThis.SS_LANG;
  if (LANG && typeof LANG.detectLang === 'function') {
    return LANG.detectLang(texts, hint);
  }
  const joined = (texts || []).join('\n');
  if (/[\uac00-\ud7af]/.test(joined)) return 'ko';
  if (/[\u3040-\u30ff]/.test(joined)) return 'ja';
  if (/[\u3400-\u9fff]/.test(joined)) return CANTONESE_MARKERS_RE.test(joined) ? 'yue' : 'zh';
  if (/[\u0400-\u04ff]/.test(joined)) return 'ru';
  return 'en';
}

async function ensureSwFeIndex(rawLang) {
  const LANG = typeof SS_LANG !== 'undefined' ? SS_LANG : globalThis.SS_LANG;
  const IDIOMS = typeof SS_IDIOMS !== 'undefined' ? SS_IDIOMS : globalThis.SS_IDIOMS;
  if (!IDIOMS) return null;
  const lang = IDIOMS.normLang(rawLang);
  if (_feIndexCache.has(lang)) return _feIndexCache.get(lang);

  let idx = null;
  if (IDIOMS.isCjkLang(lang)) {
    const [packs, formsData] = await Promise.all([
      Promise.all(IDIOMS.cjkFeFiles(lang).map((name) => loadExtensionJson('data/' + name))),
      lang === 'ko' ? loadExtensionJson('data/forms_ko.json') : Promise.resolve(null),
    ]);
    if (formsData && LANG && LANG.setForms) LANG.setForms(lang, formsData);
    if (packs.some(Boolean)) idx = { cjk: true, index: IDIOMS.buildCjkIndex(packs), glossMap: null };
  } else {
    // Token-matched languages across Germanic (en, de), Romance (es, fr, pt, it), Slavic (ru), and Austronesian (tl)
    const [feData, ranksData, formsData, glossEn] = await Promise.all([
      loadExtensionJson(`data/fe_${lang}.json`),
      loadExtensionJson(`data/ranks_${lang}.json`),
      lang !== 'en' ? loadExtensionJson(`data/forms_${lang}.json`) : Promise.resolve(null),
      lang === 'en' ? loadExtensionJson('data/fe_en_gloss.json') : Promise.resolve(null),
    ]);
    if (lang === 'en' && ranksData && LANG && LANG.setLexicon) LANG.setLexicon(ranksData);
    if (formsData && LANG && LANG.setForms) LANG.setForms(lang, formsData);
    if (feData || lang === 'en') {
      idx = {
        cjk: false,
        index: IDIOMS.buildFeIndex(feData || { items: [] }, ranksData || null, lang),
        glossMap: glossEn || null,
      };
    }
  }
  if (idx) _feIndexCache.set(lang, idx);
  return idx;
}

function pickSwTargetEq(hit, tlCode, zhMap) {
  const tlRaw = String(tlCode || 'en').toLowerCase();
  const tlBase = tlRaw.split(/[-_]/)[0];
  const tlNorm = tlRaw.includes('hk') || tlBase === 'yue' ? 'yue' : (tlBase === 'cn' ? 'zh' : tlBase);
  const eq = hit && hit.eq;
  if (eq && typeof eq === 'object') {
    const raw = eq[tlCode] || eq[tlRaw] || eq[tlNorm] || eq[tlBase] || (tlNorm === 'yue' ? eq.zh : null);
    if (raw) {
      if (tlNorm === 'zh' || tlNorm === 'yue') {
        const zhHit = lookupChengyuSync(zhMap, raw);
        if (zhHit && zhHit.display) return zhHit.display;
      }
      const parts = (Array.isArray(raw) ? raw : [raw])
        .flatMap((x) => String(x || '').split(/[；;。]/))
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length >= 2 && parts[0].length > 26 && parts[parts.length - 1].length <= 36) {
        return parts[parts.length - 1];
      }
      if (parts.length) return parts[0];
    }
  }
  if ((tlNorm === 'zh' || tlBase === 'zh') && /^Cantonese/i.test(hit.type || '') && hit.glossZh) {
    return String(hit.glossZh).split(/[；;]/)[0].trim();
  }
  return '';
}

function bestSwMeaning(hit, tlCode, enGlossMap, zhChengyu = null, sidecar = null) {
  const IDIOMS = typeof SS_IDIOMS !== 'undefined' ? SS_IDIOMS : globalThis.SS_IDIOMS;
  if (IDIOMS && typeof IDIOMS.resolveFeGloss === 'function') {
    const res = IDIOMS.resolveFeGloss(hit, tlCode, { sidecar, enGlossMap, zhEq: zhChengyu });
    if (res && res.text) return res;
  }
  return { text: hit.gloss || hit.glossZh || hit.defJa || hit.defKo || hit.native || '', lang: 'en', needsMt: false };
}

async function matchWebpageIdioms(texts, langHint = '', tl = 'en', modelKey = 'plamo-0.8b', useBig = false) {
  const LANG = typeof SS_LANG !== 'undefined' ? SS_LANG : globalThis.SS_LANG;
  const IDIOMS = typeof SS_IDIOMS !== 'undefined' ? SS_IDIOMS : globalThis.SS_IDIOMS;
  if (!LANG || !IDIOMS || !Array.isArray(texts) || !texts.length) {
    return { ok: false, detectedLang: 'en', byPara: [], items: [], glossary: [] };
  }
  const detectedLang = detectBlockLanguage(texts, langHint);
  const pack = await ensureSwFeIndex(detectedLang);
  if (!pack || !pack.index) {
    return { ok: true, detectedLang, byPara: texts.map(() => []), items: [], glossary: [] };
  }
  const [zhMap, nxnSidecar] = await Promise.all([
    (detectedLang === 'ko' || String(tl).toLowerCase().startsWith('zh') || String(tl).toLowerCase().startsWith('yue'))
      ? getZhChengyuLookup()
      : Promise.resolve(null),
    loadSwGlossSidecar(detectedLang, tl),
  ]);
  const L = LANG.get(detectedLang);
  const curModel = String(modelKey || 'plamo-0.8b').toLowerCase();
  const isRichPromptModel = Boolean(useBig) || /^(index|hy|qwen3\.5-(4b|9b)|qwen2)/.test(curModel);

  const byPara = [];
  const aggMap = new Map();
  const glMap = new Map();

  for (let pi = 0; pi < texts.length; pi++) {
    const line = String(texts[pi] || '');
    if (!line.trim()) { byPara.push([]); continue; }
    const rawHits = pack.cjk
      ? IDIOMS.matchCjk(line, pack.index)
      : IDIOMS.matchTokens(L.split(line), L, pack.index);

    const paraHits = rawHits.map((h) => {
      const zhChengyu = (h.eq && h.eq.zh && zhMap) ? lookupChengyuSync(zhMap, h.eq.zh) : null;
      const glossObj = bestSwMeaning(h, tl, pack.glossMap, zhChengyu, nxnSidecar);
      const meaning = (glossObj && glossObj.text) || '';
      const meaningLang = String((glossObj && glossObj.lang) || '').toLowerCase().split(/[-_]/)[0];
      const item = {
        pattern: h.pattern,
        display: h.display,
        surface: h.surface,
        type: h.type || '',
        bucket: h.bucket || IDIOMS.classifyLayer(h.layer, h.type),
        meaning: meaning || '',
        needsMtGloss: Boolean(glossObj && glossObj.needsMt),
        glossZh: h.glossZh || '',
        lit: h.lit || '',
        reading: h.reading || h.hanja || '',
        hanja: h.hanja || '',
        eq: h.eq || null,
        zhEq: zhChengyu || null,
        deceptive: !!h.deceptive,
        charStart: h.charStart,
        charEnd: h.charEnd != null ? h.charEnd : (h.charStart + (h.surface || '').length),
        anchorRanges: h.anchorRanges || [[h.charStart, h.charStart + (h.surface || '').length]],
      };

      if (!aggMap.has(item.pattern)) {
        aggMap.set(item.pattern, Object.assign({}, item, { count: 1, sampleLine: line }));
      } else {
        aggMap.get(item.pattern).count++;
      }

      // Glossary for the MT model: a target-language equivalent, or a meaning only when it is already in
      // the target language (an English meaning forced into a Chinese translation leaks English). Lines
      // where the expression may be literal (발이 넓다 about feet) get no glossary. (audit 2026-11-23)
      const tlBaseGl = String(tl || 'en').toLowerCase().split(/[-_]/)[0].replace('yue', 'zh');
      if (item.bucket !== 'colloc' && !h.litRisk) {
        const eqTarget = pickSwTargetEq(h, tl, zhMap);
        const sameLang = (meaningLang || 'en').replace('yue', 'zh') === tlBaseGl;
        const cleanMean = sameLang ? String(item.meaning || '').split(/[；;]/)[0].trim().slice(0, 68) : '';
        const isGapped = item.bucket === 'frame' && /[….*XY]/.test(item.display || '');
        if ((eqTarget || cleanMean) && (!isGapped || isRichPromptModel)) {
          let dst = '';
          if (isRichPromptModel) {
            if (isGapped) {
              dst = `[pattern ${item.display}: ${eqTarget ? eqTarget + (cleanMean && cleanMean !== eqTarget ? ' — ' + cleanMean : '') : cleanMean}]`;
            } else if (eqTarget && cleanMean && eqTarget.toLowerCase() !== cleanMean.toLowerCase()) {
              dst = `${eqTarget} (idiom meaning: ${cleanMean})`;
            } else {
              dst = eqTarget || `${cleanMean} (idiom)`;
            }
          } else {
            dst = eqTarget || cleanMean;
          }
          const surfKey = (item.surface || item.display || '').toLowerCase();
          if (surfKey && dst && !glMap.has(surfKey)) {
            glMap.set(surfKey, { src: item.surface || item.display, dst });
          }
        }
      }
      return item;
    });
    byPara.push(paraHits);
  }

  return {
    ok: true,
    detectedLang,
    byPara,
    items: [...aggMap.values()],
    glossary: [...glMap.values()].slice(0, 40),
  };
}

// ---------------------------------------------------------------------------
// Webpage Save-to-Deck & Burned-In Frame Vision OCR
// ---------------------------------------------------------------------------
let captionEditWrites = Promise.resolve();
async function saveCaptionEdit(message) {
  const {video, track, target, startMs, original, translation, previous} = message;
  if (![video,track,target,original,translation,previous].every(v=>typeof v === 'string') ||
      !video || !track || !target || !original || !Number.isSafeInteger(startMs) || startMs < 0 ||
      original.length > 10000 || translation.length > 10000) return {ok:false};
  const key = 'ss_caption_edits:' + JSON.stringify([video,track,target]);
  const cue = JSON.stringify([startMs,original]);
  const entries = (await chrome.storage.local.get(key))[key] || {};
  if ((entries[cue] || '') !== previous) return {ok:false,conflict:true};
  if (translation) entries[cue]=translation; else delete entries[cue];
  if (Object.keys(entries).length) await chrome.storage.local.set({[key]:entries});
  else await chrome.storage.local.remove(key);
  return {ok:true};
}

let webStudyWrites = Promise.resolve();
async function saveWebStudyItem(itemPayload) {
  const now = Date.now();
  const word = String(itemPayload.word || itemPayload.display || '').trim();
  if (!word) return { ok: false, error: 'Empty word' };
  const lemma = String(itemPayload.lemma || itemPayload.pattern || word).trim();
  const lang = String(itemPayload.lang || 'en').toLowerCase().split(/[-_]/)[0];

  const local = await new Promise((res) => chrome.storage.local.get(['ss_items', 'ss_words', 'ss_xp'], res));
  const items = Array.isArray(local.ss_items) ? local.ss_items.slice() : [];
  const words = Object.assign({}, local.ss_words || {});
  words[`${lang}|${lemma.toLowerCase()}`] = 'learning';

  const existingIdx = items.findIndex((x) => x && String(x.lang || 'en').toLowerCase().split(/[-_]/)[0] === lang
    && String(x.lemma || x.word || '').toLowerCase() === lemma.toLowerCase()
    && (!itemPayload.studyKey || x.studyKey === itemPayload.studyKey));
  const rec = {
    word,
    lemma,
    lang,
    type: itemPayload.type || 'phrase',
    def: itemPayload.def || '',
    reading: itemPayload.reading || '',
    line: itemPayload.line || '',
    trans: itemPayload.trans || '',
    title: itemPayload.title || '',
    pageUrl: itemPayload.pageUrl || '',
    videoId: itemPayload.videoId || '',
    t: itemPayload.t || 0,
    endT: itemPayload.endT || 0,
    at: new Date(now).toISOString(),
    deceptive: Boolean(itemPayload.deceptive),
  };
  if (itemPayload.studyKey) rec.studyKey = itemPayload.studyKey;
  if (existingIdx >= 0) {
    const existing = items[existingIdx];
    items[existingIdx] = { ...rec, ...existing, id: SS_STORE.reviewId(existing),
      def: existing.def || rec.def, line: existing.line || rec.line, reading: existing.reading || rec.reading };
    if (existing.id && (existing.def || !rec.def) && (existing.line || !rec.line) && (existing.reading || !rec.reading)) {
      return { ok: true, duplicate: true, totalSaved: items.length };
    }
  } else {
    items.unshift(SS_STORE.initItemSchedule({ ...rec, id: crypto.randomUUID() }, now));
  }

  const xp = Number(local.ss_xp || 0) + (existingIdx < 0 ? 5 : 0);
  await new Promise((res) => chrome.storage.local.set({ ss_items: items, ss_words: words, ss_xp: xp }, res));

  // Mirror into subtitle_study_db IndexedDB so YouTube tab sees it seamlessly
  if (typeof indexedDB !== 'undefined' && indexedDB) {
    try {
      const db = await new Promise((resolve) => {
        const rq = indexedDB.open('subtitle_study_db', 1);
        rq.onupgradeneeded = () => {
          for (const s of ['kv', 'encounters', 'glossaries', 'research']) {
            if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s);
          }
        };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
      });
      if (db) {
        await new Promise((res) => {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(items, 'items');
          tx.objectStore('kv').put(words, 'words');
          tx.objectStore('kv').put(xp, 'xp');
          tx.oncomplete = () => res();
          tx.onerror = () => res();
        });
      }
    } catch (e) {}
  }
  return { ok: true, totalSaved: items.length, item: rec };
}

function normVisionChatUrl(rawUrl) {
  const u = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (u.endsWith('/chat/completions')) return u;
  if (u.endsWith('/v1')) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

async function runFrameOcr(msg) {
  const imageDataUrl = String(msg.imageDataUrl || '');
  if (!imageDataUrl.startsWith('data:image/')) return { ok: false, error: 'Invalid frame image data' };

  // Use the local OCR engine before a separately configured Vision OCR service.
  const localOcr = await callCompanion('/ocr', { image_b64: imageDataUrl, lang: msg.lang || 'auto', subtitle_band: msg.subtitleBand === true }, 'POST', 25000);
  if (msg.textOnly && localOcr?.ok) return {ok:true,text:localOcr.text || '',source:localOcr.engine};
  if (localOcr && localOcr.ok && typeof localOcr.text === 'string' && localOcr.text.trim()) {
    const cleanText = localOcr.text.trim();
    const feRes = await matchWebpageIdioms([cleanText], msg.lang || '', msg.tl || 'en', msg.model || 'plamo-0.8b');
    return { ok: true, text: cleanText, source: localOcr.engine || 'Local Companion OCR', fe: feRes };
  }

  let { ocrUrl: rawOcrUrl, ocrKey: rawOcrKey, ocrModel: rawOcrModel } = msg;
  if (!rawOcrUrl) {
    const stored = await new Promise((res) => chrome.storage.local.get(['ss_set'], (r) => res((r && r.ss_set) || {})));
    ({ ocrUrl: rawOcrUrl, ocrKey: rawOcrKey, ocrModel: rawOcrModel } = stored);
  }
  const endpoint = normVisionChatUrl(rawOcrUrl);
  if (!endpoint) {
    return {
      ok: false,
      needsConfig: true,
      error: 'Frame captured. Add a Vision OCR endpoint (e.g. local Ollama / llama-server VLM at http://127.0.0.1:11434) in Options -> Services, or start Companion with rapidocr-onnxruntime.',
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = rawOcrKey || '';
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (msg.openCodeSession || /opencode/i.test(endpoint)) {
      headers['x-opencode-session'] = SESSION_UUID;
    }
    const body = {
      model: rawOcrModel || 'qwen2.5vl:7b',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Read ONLY the subtitle text visible in this video frame crop. Output the exact subtitle line(s) verbatim with no commentary, no quotes, and no translation. If no subtitle text is present, output EMPTY.',
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 220,
      chat_template_kwargs: { enable_thinking: false },
    };
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `Vision OCR HTTP ${res.status}` };
    const data = await res.json();
    let rawTxt = String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    if (!rawTxt || /^EMPTY\.?$/i.test(rawTxt)) return { ok: true, text: '', source: body.model, fe: { items: [], glossary: [] } };
    if (msg.textOnly) return {ok:true,text:rawTxt,source:body.model};
    const feRes = await matchWebpageIdioms([rawTxt], msg.lang || '', msg.tl || 'en', msg.model || 'plamo-0.8b');
    return { ok: true, text: rawTxt, source: body.model, fe: feRes };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Existing Companion, AnkiConnect, Wiktionary, Tatoeba & Hot-Reload Routes
// ---------------------------------------------------------------------------
const TATOEBA_ISO3 = {
  en: 'eng',
  ja: 'jpn',
  zh: 'cmn',
  'zh-hans': 'cmn',
  'zh-hant': 'cmn',
  cn: 'cmn',
  yue: 'yue',
  ko: 'kor',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
  pt: 'por',
  it: 'ita',
  ru: 'rus',
  tl: 'tgl',
  fil: 'tgl',
  tgl: 'tgl',
  vi: 'vie',
  th: 'tha',
  ar: 'ara',
  nl: 'nld',
  pl: 'pol',
  tr: 'tur',
  uk: 'ukr',
  id: 'ind',
};

const toIso3 = (code) => {
  const c = String(code || 'en').toLowerCase().replace('_', '-').trim();
  return TATOEBA_ISO3[c] || TATOEBA_ISO3[c.split('-')[0]] || 'eng';
};

const ACTIVE_WAKE_PATH_RE = /^\/(translate|transcribe|ocr|summarize|explain|prepass|annotate|readings|prosody|pdf_(?:extract|render|export)|anki_apkg|youtube\/publisher-captions)\b/;

// Each tab keeps one local recognition connection while its live capture is active.
const liveSpeechSockets = new Map();
async function sendLiveSpeech(tabId, base, body, timeoutMs) {
  const url = new URL('/live/audio', base);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return null;
  url.protocol = 'ws:';
  let state = liveSpeechSockets.get(tabId);
  if (state && state.socket.url !== url.href) { state.socket.close(); state = null; }
  if (state?.pending) return {ok:false, error:'Previous live recognition request is still running'};
  if (!state || state.socket.readyState >= WebSocket.CLOSING) {
    const socket = new WebSocket(url.href);
    state = {socket, idleTimer:null, pending:null};
    liveSpeechSockets.set(tabId,state);
    socket.onclose = () => {
      clearTimeout(state.idleTimer);
      state.pending?.(null);
      if (liveSpeechSockets.get(tabId) === state) liveSpeechSockets.delete(tabId);
    };
    socket.onerror = () => socket.close();
  }
  clearTimeout(state.idleTimer);
  return new Promise(resolve => {
    const socket = state.socket;
    const sentAt = Date.now();
    let sent = false;
    const finish = result => {
      if (!state.pending) return;
      state.pending = null;
      clearTimeout(timer);
      socket.onopen = socket.onmessage = null;
      // HTTP fallback is safe only when this packet never reached the socket.
      resolve(result || (sent ? {ok:false,error:'Live audio connection closed'} : null));
      if (socket.readyState === WebSocket.OPEN) state.idleTimer=setTimeout(()=>socket.close(),15000);
    };
    const timer = setTimeout(()=>{finish(null);socket.close();},timeoutMs);
    state.pending = finish;
    socket.onmessage = event => {
      try {
        const data=JSON.parse(event.data),now=Date.now();
        data.transport_ms={route:'socket',sent_at:sentAt,headers_at:now,decoded_at:now};
        finish(data);
      } catch (_) { finish({ok:false,error:'Unreadable live recognition response'}); socket.close(); }
    };
    const sendPacket = () => {
      try { socket.send(JSON.stringify(body)); sent=true; }
      catch (_) { finish(null); socket.close(); }
    };
    if (socket.readyState === WebSocket.OPEN) sendPacket(); else socket.onopen=sendPacket;
  });
}

// Self-update: the companion writes new extension files into the unpacked folder; reload once per new version.
async function maybeReloadForUpdate(h) {
  try {
    const disk = h && h.update && h.update.ext_version;
    const running = chrome.runtime.getManifest().version;
    const vt = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
    const newer = (a, b) => { const x = vt(a), y = vt(b); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    if (!disk || !newer(disk, running)) return;
    const got = await chrome.storage.local.get('ss_reloaded_for');
    if (got.ss_reloaded_for === disk) return;   // folder Chrome loads is elsewhere: don't loop
    await chrome.storage.local.set({ ss_reloaded_for: disk });
    setTimeout(() => chrome.runtime.reload(), 1500);
  } catch (e) {}
}

async function callCompanion(path, body = null, method = null, timeoutMs = 60000, extraHeaders = null, _retriedWake = false) {
  if (companionOff && isLocalCompanion()) return { ok: false, off: true, error: 'Local AI is off' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const destination = companionUrl + path;
    let includeHistory = false;
    if (body && Object.hasOwn(body, 'past_scenes')) {
      const url = new URL(destination);
      includeHistory = path === '/explain' && ['http:', 'https:'].includes(url.protocol)
        && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!includeHistory) {
        body = { ...body };
        delete body.past_scenes;
      }
    }
    const headers = body ? Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}) : (extraHeaders || undefined);
    const sentAt = path === '/transcribe_chunk' ? Date.now() : 0;
    const res = await fetch(destination, {
      method: method || (body ? 'POST' : 'GET'),
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: includeHistory ? 'error' : 'follow',
    });
    if (!res.ok) return { ok: false, status: res.status };
    const headersAt = sentAt ? Date.now() : 0;
    const data = await res.json();
    if (sentAt) data.transport_ms = {sent_at:sentAt, headers_at:headersAt, decoded_at:Date.now()};
    if (path === '/health') maybeReloadForUpdate(data);
    return Object.assign({ ok: true }, data);
  } catch (e) {
    clearTimeout(timer);
    if (!_retriedWake && ACTIVE_WAKE_PATH_RE.test(String(path || '')) && autoStartCompanionEnabled) {
      const woke = await ensureCompanionRunning(false);
      if (woke && woke.ok) {
        return callCompanion(path, body, method, timeoutMs, extraHeaders, true);
      }
    }
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnkiConnect(ankiUrl, action, params = {}) {
  const url = (ankiUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const j = await res.json();
    if (j.error) return { ok: false, error: j.error };
    return { ok: true, result: j.result };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function defineWiktionary(word, lang = 'en') {
  const rawBase = (lang || 'en').toLowerCase().split(/[-_]/)[0];
  const base = rawBase === 'fil' || rawBase === 'tgl' ? 'tl' : rawBase;
  const effectiveLang = /^[A-Za-z][A-Za-z'\s-]*$/.test(word) && base !== 'en' && /^(ja|zh|cn|yue|ko|ru)$/.test(base)
    ? 'en'
    : base;
  const ck = effectiveLang + '|' + word;
  if (cache.has(ck)) return cache.get(ck);
  let r = await fetch('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(word));
  // Simplified Chinese pages are often only a pointer to the traditional page (一辈子 -> 一輩子), which this API answers with 404.
  if (!r.ok && /^(zh|cn|yue)$/.test(effectiveLang) && typeof self.cedictTrad === 'function') {
    const trad = await self.cedictTrad(word).catch(() => '');
    if (trad && trad !== word) r = await fetch('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(trad));
  }
  if (!r.ok) return null;
  const j = await r.json();
  let sec = j[effectiveLang];
  if (!sec || !sec.length) {
    if (effectiveLang === 'zh' || effectiveLang === 'cn') sec = j.zh || j.cmn || j.yue;
    else if (effectiveLang === 'yue') sec = j.yue || j.zh || j.cmn;
    else if (effectiveLang === 'tl') sec = j.tl || j.fil;
  }
  if ((!sec || !sec.length) && /^[A-Za-z'\s-]+$/.test(word)) sec = j.en;
  if (!sec || !sec.length) sec = [];

  const out = [];
  for (const e of sec) {
    const defs = [];
    const examples = [];
    for (const d of e.definitions || []) {
      const defTxt = strip(d.definition);
      if (defTxt && defs.length < 3) defs.push(defTxt);
      for (const ex of d.examples || []) {
        const exTxt = strip(ex);
        if (exTxt && examples.length < 2) examples.push(exTxt);
      }
    }
    if (defs.length) out.push({ pos: e.partOfSpeech || '', defs, examples });
  }
  const res = out.length ? out.slice(0, 4) : null;
  setLru(cache, ck, res);
  return res;
}

async function fetchTatoebaExamples(query, lang = 'en', tl = 'en') {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [] };
  const from3 = /^[A-Za-z'\s-]+$/.test(q) && /^(ja|zh|cn|yue|ko|ru)/.test(lang) ? 'eng' : toIso3(lang);
  const to3 = toIso3(tl || 'en');
  const ck = `${from3}|${to3}|${q.toLowerCase()}`;
  if (exampleCache.has(ck)) return exampleCache.get(ck);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url = `https://tatoeba.org/en/api_v0/search?from=${from3}&query=${encodeURIComponent(q)}&to=${to3 === from3 ? 'eng' : to3}`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, items: [] };
    const j = await r.json();
    const rows = Array.isArray(j.results) ? j.results : [];
    const items = [];
    for (const row of rows) {
      const text = strip(row.text);
      if (!text || text.length > 130) continue;
      let tr = '';
      for (const grp of row.translations || []) {
        if (!Array.isArray(grp) || !grp.length) continue;
        const pref = grp.find((x) => x && x.lang === to3 && x.text);
        if (pref) { tr = strip(pref.text); break; }
        if (!tr && grp[0] && grp[0].text) tr = strip(grp[0].text);
      }
      if (!tr) continue;
      items.push({ text, trans: tr });
      if (items.length >= 5) break;
    }
    const out = { ok: true, source: 'Tatoeba (CC-BY 2.0)', items };
    setLru(exampleCache, ck, out);
    return out;
  } catch (e) {
    return { ok: false, items: [], error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

function normWebMtLang(code, fallback = 'en') {
  const c = String(code || '').trim().toLowerCase().replace(/_/g, '-');
  if (!c || c === 'auto') return 'auto';
  if (c === 'zh-hant' || c === 'zh-tw' || c === 'zh-hk') return 'zh-TW';
  if (c === 'zh-hans' || c === 'zh-cn' || c === 'zh') return 'zh-CN';
  if (c === 'fil' || c === 'tgl') return 'tl';
  if (c === 'yue') return 'yue';
  return c.split('-')[0] || fallback;
}

async function fetchGoogleMtOne(text, sl, tl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx'
      + `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) return '';
    const j = await r.json();
    if (!Array.isArray(j) || !Array.isArray(j[0])) return '';
    return j[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
  } catch (_) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Zero-setup free web MT fallback (no .bat companion required) backed by 2-tier trCache.
async function translateViaGoogleWeb(rawTexts, rawSl = 'auto', rawTl = 'en', fresh = false) {
  const arr = Array.isArray(rawTexts) ? rawTexts.map((x) => String(x || '')) : [String(rawTexts || '')];
  const sl = normWebMtLang(rawSl, 'auto');
  const tl = normWebMtLang(rawTl, 'en');
  if (!arr.length || !tl || tl === 'auto') return { ok: false, translations: [] };

  const keys = arr.map((t) => (t.trim() ? `webmt|${sl}|${tl}|${t}` : ''));
  const cached = fresh ? {} : await trCacheGetMany(keys.filter(Boolean)).catch(() => ({}));
  const out = new Array(arr.length).fill('');
  const misses = [];
  for (let i = 0; i < arr.length; i++) {
    if (!arr[i].trim()) continue;
    const hit = cached[keys[i]];
    if (typeof hit === 'string' && hit) out[i] = hit;
    else misses.push(i);
  }
  if (!misses.length) return { ok: true, translations: out };

  const SEP = '\n[[~SS~]]\n';
  const SEP_RE = /\s*\[\[\s*~\s*SS\s*~\s*\]\]\s*/i;
  const toSave = [];
  let idxPos = 0;
  while (idxPos < misses.length) {
    const chunkIdxs = [];
    let charBudget = 0;
    while (idxPos < misses.length && chunkIdxs.length < 18) {
      const mi = misses[idxPos];
      const len = arr[mi].length + SEP.length;
      if (chunkIdxs.length > 0 && charBudget + len > 1600) break;
      chunkIdxs.push(mi);
      charBudget += len;
      idxPos++;
    }
    if (chunkIdxs.length === 1) {
      const i0 = chunkIdxs[0];
      const tr = await fetchGoogleMtOne(arr[i0], sl, tl);
      if (tr) { out[i0] = tr; toSave.push({ k: keys[i0], v: tr }); }
    } else {
      const joined = chunkIdxs.map((i0) => arr[i0].replace(/\r?\n/g, ' ')).join(SEP);
      const trAll = await fetchGoogleMtOne(joined, sl, tl);
      const parts = trAll ? trAll.split(SEP_RE) : [];
      if (parts.length === chunkIdxs.length) {
        for (let k = 0; k < chunkIdxs.length; k++) {
          const tRes = parts[k].trim();
          if (tRes) { out[chunkIdxs[k]] = tRes; toSave.push({ k: keys[chunkIdxs[k]], v: tRes }); }
        }
      } else {
        await Promise.all(chunkIdxs.map(async (i0) => {
          const tr = await fetchGoogleMtOne(arr[i0], sl, tl);
          if (tr) { out[i0] = tr; toSave.push({ k: keys[i0], v: tr }); }
        }));
      }
    }
  }
  if (toSave.length) trCachePutMany(toSave).catch(() => {});
  const anyHit = out.some((x) => !!x);
  return { ok: anyHit, translations: out, error: anyHit ? '' : 'Google Translate unavailable' };
}

function normMicrosoftMtLang(code) {
  const lang = normWebMtLang(code);
  return ({ 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans', tl: 'fil' })[lang] || lang;
}

async function translateViaMicrosoft(rawTexts, rawSl, rawTl, credentials, fresh) {
  const translations = rawTexts.map(() => '');
  const key = credentials?.key?.trim();
  if (!key) return { translations, error: 'Add a Microsoft Translator key in Settings' };
  const sl = normMicrosoftMtLang(rawSl);
  const tl = normMicrosoftMtLang(rawTl);
  if (tl === 'auto') return { translations, error: 'Select a target language' };

  const params = new URLSearchParams({ 'api-version': '3.0', to: tl });
  if (sl !== 'auto') params.set('from', sl);
  const headers = { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
  const region = credentials.region?.trim();
  if (region) headers['Ocp-Apim-Subscription-Region'] = region;
  const keys = rawTexts.map(text => text.trim() ? JSON.stringify(['microsoft-v1', sl, tl, text]) : '');
  const hits = fresh ? {} : await trCacheGetMany(keys.filter(Boolean)).catch(() => ({}));
  const pending = [];
  for (const [index, text] of rawTexts.entries()) {
    if (!keys[index]) continue;
    if (hits[keys[index]]) translations[index] = hits[keys[index]];
    else if (text.length <= 50000) pending.push(index);
  }
  const saved = [];
  let error = '';
  for (let i = 0; i < pending.length;) {
    const indexes = [];
    let length = 0;
    while (i < pending.length && indexes.length < 100) {
      const index = pending[i];
      if (length + rawTexts[index].length > 50000) break;
      indexes.push(index);
      length += rawTexts[index].length;
      i++;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch('https://api.cognitive.microsofttranslator.com/translate?' + params, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify(indexes.map(index => ({ Text: rawTexts[index] })))
      });
      if (!response.ok) {
        error = 'Microsoft Translator returned HTTP ' + response.status;
        break;
      }
      const result = await response.json();
      for (const [offset, index] of indexes.entries()) {
        const text = result?.[offset]?.translations?.[0]?.text;
        if (typeof text === 'string' && text.trim()) {
          translations[index] = text;
          saved.push({ k: keys[index], v: text });
        }
      }
    } catch (_) {
      error = 'Microsoft Translator unavailable';
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (saved.length) trCachePutMany(saved).catch(() => {});
  return { translations, error: error || 'Microsoft Translator returned no translation' };
}

async function translateViaWebEngines(request) {
  const { ss_set: settings = {}, ss_ms_translator: credentials } = await new Promise(resolve =>
    chrome.storage.local.get(['ss_set', 'ss_ms_translator'], result => resolve(result || {})));
  const preferred = (request.provider || settings.webMtProvider) === 'microsoft' ? 'microsoft' : 'google';
  const fallback = (request.fallback ?? settings.webMtFallback) !== false;
  const texts = (Array.isArray(request.texts) ? request.texts : [request.texts ?? request.text ?? '']).map(text => String(text || ''));
  const translations = texts.map(() => '');
  const providers = texts.map(() => '');
  const names = { google: 'Google Translate', microsoft: 'Microsoft Translator' };
  const order = [preferred];
  if (fallback) order.push(preferred === 'microsoft' ? 'google' : 'microsoft');
  let pending = texts.map((text, index) => text.trim() ? index : -1).filter(index => index >= 0);
  let error = '';
  for (const provider of order) {
    if (!pending.length) break;
    const input = pending.map(index => texts[index]);
    const sl = request.sl || 'auto';
    const tl = request.tl || 'en';
    const result = provider === 'microsoft'
      ? await translateViaMicrosoft(input, sl, tl, credentials, request.fresh)
      : await translateViaGoogleWeb(input, sl, tl, request.fresh);
    pending = pending.filter((index, offset) => {
      const text = result.translations[offset];
      if (!text) return true;
      translations[index] = text;
      providers[index] = provider;
      return false;
    });
    if (pending.length) error = result.error || names[provider] + ' returned no translation';
  }
  return { ok: translations.some(Boolean), translations, providers,
    provider: [...new Set(providers.filter(Boolean))].map(name => names[name]).join(' + '),
    error: pending.length ? error : '' };
}

async function runCustomOpenAiTranslate(opts = {}) {
  try {
    let api = opts.customApi || null;
    if (!api && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const stored = await new Promise((res) => chrome.storage.local.get(['ss_set'], (r) => res((r && r.ss_set) || {})));
      api = stored.customApi || {};
    }
    api = api || {};
    const baseUrl = String(api.baseUrl || '').replace(/\/+$/, '');
    const apiKey = String(api.apiKey || '').trim();
    const model = String(api.model || '').trim() || 'gpt-4o-mini';
    const tl = String(opts.tl || 'en').trim();
    if (!baseUrl) return { ok: false, error: 'Custom API base URL not configured' };

    const endpoint = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const callOneChat = async (systemPrompt, userPrompt, timeoutMs) => {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), Number(timeoutMs || 25000));
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers,
          signal: ctrl.signal,
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, model };
        const j = await resp.json();
        const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content
          ? String(j.choices[0].message.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim()
          : '';
        return out ? { ok: true, translation: out, model } : { ok: false, error: 'Empty response', model };
      } finally {
        clearTimeout(tm);
      }
    };

    if (Array.isArray(opts.texts)) {
      const texts = opts.texts.map((x) => String(x || ''));
      const translations = new Array(texts.length).fill('');
      const nonEmptyIdxs = [];
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].trim()) nonEmptyIdxs.push(i);
      }
      if (!nonEmptyIdxs.length) return { ok: true, translations, translation: '', model };

      const missingIdxs = [];
      for (let off = 0; off < nonEmptyIdxs.length; off += 12) {
        const chunk = nonEmptyIdxs.slice(off, off + 12);
        const promptBody = chunk.map((i0) => `<seg id="${i0}">${texts[i0]}</seg>`).join('\n');
        const sys = `You are a concise literary translator. Translate each <seg id="N">...</seg> naturally into ${tl}. Preserve <seg id="N">...</seg> tags and placeholders like {v0} exactly; output ONLY the translated <seg id="N">...</seg> lines.`;
        const res = await callOneChat(sys, promptBody, opts.timeoutMs || 35000).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
        const hitMap = new Map();
        if (res && res.ok && res.translation) {
          const re = /<seg\s+id=["']?(\d+)["']?\s*>([\s\S]*?)<\/seg>/gi;
          let m;
          while ((m = re.exec(res.translation)) !== null) {
            hitMap.set(Number(m[1]), m[2].trim());
          }
        }
        for (const i0 of chunk) {
          if (hitMap.has(i0) && hitMap.get(i0)) translations[i0] = hitMap.get(i0);
          else missingIdxs.push(i0);
        }
      }

      if (missingIdxs.length) {
        let cursor = 0;
        const singleSys = `You are a concise literary translator. Translate the user text naturally into ${tl}. Output ONLY the translation, preserving any placeholders like {v0}.`;
        const workers = [];
        for (let w = 0; w < Math.min(3, missingIdxs.length); w++) {
          workers.push((async () => {
            while (cursor < missingIdxs.length) {
              const i0 = missingIdxs[cursor++];
              const sr = await callOneChat(singleSys, texts[i0], opts.timeoutMs || 25000).catch(() => null);
              if (sr && sr.ok && sr.translation) translations[i0] = sr.translation;
            }
          })());
        }
        await Promise.all(workers);
      }
      const anyHit = translations.some((x) => !!x);
      return anyHit
        ? { ok: true, translations, translation: translations[0] || '', model }
        : { ok: false, error: 'Custom API batch translation failed', translations, model };
    }

    const srcText = String(opts.text || '').trim();
    if (!srcText) return { ok: true, translation: '', model };
    const sys = `You are a concise literary translator. Translate the user text naturally into ${tl}. Output ONLY the translation, preserving any placeholders like {v0}.`;
    return await callOneChat(sys, srcText, opts.timeoutMs || 25000);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Custom API error' };
  }
}

function setupContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus || typeof chrome.contextMenus.create !== 'function') return;
  try {
    chrome.contextMenus.removeAll(() => {
      void (chrome.runtime && chrome.runtime.lastError);
      chrome.contextMenus.create({ id: 'ss-ocr-image', title: 'Translate / Restore Image', contexts: ['image'] });
      chrome.contextMenus.create({ id: 'ss-crop-ocr', title: 'Drag-Box Region OCR (Alt+Shift+O)', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'ss-open-in-reader', title: 'Open in Phrasebound Study Reader', contexts: ['page', 'selection'] });
    });
  } catch (e) {}
}

async function fetchImageAsBase64(imgUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(imgUrl, { signal: ctrl.signal });
    if (!res.ok) return null;
    const mime = res.headers.get('content-type') || 'image/png';
    const u8 = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(bin)}`;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

if (typeof chrome !== 'undefined' && chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const tabId = tab && tab.id;
    const frame = { frameId: info.frameId ?? 0 };
    if (info.menuItemId === 'ss-ocr-image' && tabId != null && info.srcUrl) {
      (async () => {
        const toggled = await new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(tabId, { op: 'ssToggleImageIfTranslated', srcUrl: info.srcUrl }, frame, (resp) => {
              void (chrome.runtime && chrome.runtime.lastError);
              resolve(Boolean(resp && resp.toggled));
            });
          } catch (_e) { resolve(false); }
        });
        if (toggled) return;

        const setRes = await new Promise((r) => chrome.storage.local.get(['ss_set'], r));
        const st = (setRes && setRes.ss_set) || {};
        if (st.companionUrl) companionUrl = String(st.companionUrl).replace(/\/+$/, '');
        const tl = st.tl || 'en';
        const dataUrl = info.srcUrl.startsWith('data:') ? info.srcUrl : await fetchImageAsBase64(info.srcUrl);
        if (!dataUrl) {
          chrome.tabs.sendMessage(tabId, { op: 'ssShowImageOcrResult', ok: false, srcUrl: info.srcUrl, error: 'Could not read image bytes for translation' }, frame, () => { void chrome.runtime.lastError; });
          return;
        }
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const ocrRes = await callCompanion('/ocr', { image_b64: b64, target_lang: tl }, 'POST', 35000);
        const rawRegions = (Array.isArray(ocrRes && ocrRes.bubbles) && ocrRes.bubbles.length)
          ? ocrRes.bubbles
          : (Array.isArray(ocrRes && ocrRes.regions) ? ocrRes.regions : []);
        let regions = rawRegions.filter((r) => r && Array.isArray(r.box) && r.text);
        let fullText = (ocrRes && (ocrRes.text || ocrRes.ocr_text)) || '';
        let fullTr = (ocrRes && (ocrRes.translation || ocrRes.tr)) || '';

        if (regions.length) {
          const texts = regions.map((r) => r.text);
          let translations = [];
          const ocrSvc = (st.sceneServices && st.sceneServices.ocr) || 'auto';
          const localMap = { local_plamo2b: 'plamo-2b', local_index2b: 'index-2b', local_gemma_e4b: 'gemma-e4b', local_hymt7b: 'hy-mt2-7b' };
          const ocrModel = localMap[ocrSvc] || st.mtModel || 'plamo-2b';
          if (ocrSvc === 'free_web') {
            const wt = await translateViaWebEngines({ texts, sl: 'auto', tl }).catch(() => null);
            if (wt && wt.ok && Array.isArray(wt.translations)) translations = wt.translations;
          } else if (ocrSvc === 'custom_openai') {
            const ct = await runCustomOpenAiTranslate({ texts, tl, customApi: st.customApi || null, timeoutMs: 35000 }).catch(() => null);
            if (ct && ct.ok && Array.isArray(ct.translations)) translations = ct.translations;
          } else {
            const bt = await callCompanion('/translate_batch', {
              segments: texts.map((t, i) => ({ id: String(i), text: t })),
              target_lang: tl,
              model: ocrModel,
            }, 'POST', 35000);
            if (bt && bt.ok && Array.isArray(bt.translations) && bt.translations.length === texts.length) {
              translations = bt.translations;
            }
          }
          if (!translations.length) {
            const wt = await translateViaWebEngines({ texts, sl: 'auto', tl }).catch(() => null);
            if (wt && wt.ok && Array.isArray(wt.translations)) translations = wt.translations;
          }
          regions = regions.map((r, i) => ({
            box: r.box,
            text: r.text,
            translation: String(translations[i] || '').trim() || r.text,
          }));
          if (!fullTr && translations.length) fullTr = translations.join('\n');
        } else if (!fullText) {
          const vEndpoint = normVisionChatUrl(st.ocrUrl || st.llmUrl || '');
          if (vEndpoint) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 30000);
            try {
              const headers = { 'Content-Type': 'application/json' };
              const apiKey = st.ocrKey || st.llmKey || '';
              if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
              const vBody = {
                model: st.ocrModel || st.llmModel || 'qwen2.5vl:7b',
                messages: [{
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Extract every visible text block with normalized [x,y,w,h] (0..1000) bounding box and translate into ${tl}. Reply ONLY as a JSON array: [{"box":[x,y,w,h],"text":"...","translation":"..."}]. No markdown.`,
                    },
                    { type: 'image_url', image_url: { url: dataUrl } },
                  ],
                }],
                temperature: 0,
                max_tokens: 900,
              };
              const vr = await fetch(vEndpoint, { method: 'POST', headers, body: JSON.stringify(vBody), signal: ctrl.signal });
              if (vr.ok) {
                const vj = await vr.json();
                const rawJson = String((vj && vj.choices && vj.choices[0] && vj.choices[0].message && vj.choices[0].message.content) || '')
                  .replace(/```json|```/gi, '').trim();
                const parsed = JSON.parse(rawJson);
                if (Array.isArray(parsed)) {
                  regions = parsed.filter((x) => x && Array.isArray(x.box) && x.box.length === 4 && (x.translation || x.text))
                    .map((x) => ({ box: x.box.map(Number), text: String(x.text || ''), translation: String(x.translation || x.text || '') }));
                  fullText = regions.map((x) => x.text).filter(Boolean).join('\n');
                  fullTr = regions.map((x) => x.translation).filter(Boolean).join('\n');
                }
              }
            } catch (_) {} finally { clearTimeout(timer); }
          }
        }

        chrome.tabs.sendMessage(tabId, {
          op: 'ssShowImageOcrResult',
          ok: !!(regions.length || fullText),
          srcUrl: info.srcUrl,
          dataUrl: regions.length ? dataUrl : '',
          regions,
          text: fullText,
          translation: fullTr,
          error: (!regions.length && !fullText) ? ((ocrRes && ocrRes.error) || 'No text detected (install rapidocr-onnxruntime or set Vision OCR URL)') : '',
        }, frame, () => { void chrome.runtime.lastError; });
      })();
      return;
    }
    if (info.menuItemId === 'ss-crop-ocr' && tabId != null) {
      chrome.tabs.sendMessage(tabId, { op: 'ssStartRegionOcr' }, { frameId: 0 }, () => { void chrome.runtime.lastError; });
      return;
    }
    if (info.menuItemId === 'ss-open-in-reader') {
      if (info.selectionText && info.selectionText.trim()) {
        chrome.storage.local.set({
          ss_pending_reader_doc: { title: (tab && tab.title) || 'Selected Passage', text: info.selectionText.trim(), url: (tab && tab.url) || '' },
        }, () => { chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') }); });
        return;
      }
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { op: 'ssExtractReaderPayload' }, frame, (payload) => {
          void chrome.runtime.lastError;
          if (payload && payload.text) {
            chrome.storage.local.set({ ss_pending_reader_doc: payload }, () => { chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') }); });
          }
        });
      }
    }
  });
}

setupContextMenus();

let bootMtime = 0;

async function snapshotBootMtime() {
  const r = await callCompanion('/ext_mtime', null, 'GET', 1200);
  if (r && r.ok && typeof r.mtime === 'number' && r.mtime > 0) {
    bootMtime = r.mtime;
    try { chrome.storage.local.set({ ss_ext_boot_mtime: bootMtime }); } catch (e) {}
  }
  return bootMtime;
}

chrome.runtime.onInstalled.addListener(() => {
  bootMtime = 0;
  try { chrome.storage.local.remove('ss_ext_boot_mtime'); } catch (e) {}
  snapshotBootMtime();
  setupContextMenus();
});
chrome.runtime.onStartup.addListener(() => {
  bootMtime = 0;
  try { chrome.storage.local.remove('ss_ext_boot_mtime'); } catch (e) {}
  snapshotBootMtime();
  setupContextMenus();
});
chrome.storage.local.get(['ss_ext_boot_mtime'], (res) => {
  if (!bootMtime && res && res.ss_ext_boot_mtime) bootMtime = Number(res.ss_ext_boot_mtime) || 0;
  if (!bootMtime) snapshotBootMtime();
});

// Auto-reload without the companion: an unpacked extension serves its files straight from disk, so hashing the
// code files shows when they were edited. The stamp from load time is kept in storage (the service worker sleeps)
// and cleared on install/update, which is what chrome.runtime.reload() triggers.
const STAMP_FILES = ['manifest.json', 'content.js', 'content.css', 'background.js', 'idioms.js', 'select.js', 'lang.js',
  'readings.js', 'storage.js', 'export.js', 'audio_clip.js', 'tr_cache.js', 'page.js', 'popup.js', 'reader.js', 'player.js',
  'options.html', 'options.css', 'options.js',
  'sites/core.js', 'sites/parse.js', 'sites/youtube.js', 'sites/youtube.page.js', 'sites/bilibili.js', 'sites/bilibili.page.js',
  'sites/netflix.js', 'sites/netflix.page.js', 'sites/prime.js', 'sites/prime.page.js', 'sites/disney.js', 'sites/disney.page.js',
  'sites/appletv.js', 'sites/appletv.page.js', 'sites/live.js', 'sites/live.page.js', 'sites/generic.js', 'sites/generic.page.js',
  'packs.js', 'cedict.js', 'pron.js', 'pron_player.js', 'review.js', 'review.html', 'review.css',
  'data/fe_ja_study.json', 'data/fe_ko_study.json', 'data/ja_patterns_tsutsuji.json', 'data/build_stamp.json'];
async function localStamp() {
  let h = 2166136261 >>> 0;
  for (const f of STAMP_FILES) {
    let t = '';
    try { t = await (await fetch(chrome.runtime.getURL(f), { cache: 'no-store' })).text(); } catch (e) { t = '!' + f; }
    for (let i = 0; i < t.length; i += 7) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ t.length, 16777619) >>> 0;
  }
  return String(h);
}
let bootStamp = '';
let stampBusy = false;
let pendingStamp = '';
async function checkLocalStamp() {
  if (stampBusy) return { ok: true, reloading: false };
  stampBusy = true;
  try {
    if (!bootStamp) {
      const got = await chrome.storage.local.get('ss_ext_boot_stamp');
      bootStamp = (got && got.ss_ext_boot_stamp) || '';
    }
    const now = await localStamp();
    if (!bootStamp) {
      bootStamp = now;
      await chrome.storage.local.set({ ss_ext_boot_stamp: now });
      return { ok: true, reloading: false, local: true };
    }
    if (now !== bootStamp) {
      // Reload only once the files have stopped changing (same hash on two checks), so a half-saved file is not loaded.
      if (now !== pendingStamp) { pendingStamp = now; return { ok: true, reloading: false, local: true }; }
      pendingStamp = '';
      await chrome.storage.local.remove('ss_ext_boot_stamp');
      setTimeout(() => { try { chrome.runtime.reload(); } catch (e) {} }, 80);
      return { ok: true, reloading: true, local: true };
    }
    return { ok: true, reloading: false, local: true };
  } finally { stampBusy = false; }
}
chrome.runtime.onInstalled.addListener(() => { bootStamp = ''; chrome.storage.local.remove('ss_ext_boot_stamp'); localStamp().then((s) => { bootStamp = s; chrome.storage.local.set({ ss_ext_boot_stamp: s }); }); });
chrome.runtime.onStartup.addListener(() => { bootStamp = ''; chrome.storage.local.remove('ss_ext_boot_stamp'); });
chrome.runtime.onStartup.addListener(() => { setTimeout(() => { callCompanion('/health', null, 'GET', 3000).catch(() => {}); }, 5000); });   // picks up self-updates

function webScopeKey(tabId) {
  return 'ss_web_scope_' + tabId;
}

async function changeWebScope(sender, scope) {
  const tabId = sender.tab.id;
  const document = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (document?.documentId !== sender.documentId || !document) return;
  const mode = scope === 'full' || scope === 'smart_i1' ? scope : null;
  await chrome.storage.session.set({ [webScopeKey(tabId)]: { mode, documentId: sender.documentId } });
  await chrome.tabs.sendMessage(tabId, { op: 'ssSyncEmbeddedScope' }).catch(() => {});
}

async function getWebScope(tabId) {
  const key = webScopeKey(tabId);
  const [items, document] = await Promise.all([
    chrome.storage.session.get(key),
    chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
  ]);
  const scope = items[key];
  return scope && scope.documentId === document?.documentId ? scope.mode : null;
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  chrome.storage.session?.remove('ss_scene_pair_' + tabId).catch(() => {});
  chrome.storage.session.remove(webScopeKey(tabId)).catch(() => {});
});

// Library extension (local, unpacked from claude/library_ext) saves transcripts into G:\Downloads\library.
const LIBRARY_EXT_ID = 'mebfjdigagcgnfleeelppkdemefdapfk';
let highlightWrites = Promise.resolve();
function highlightRequest(m, sender) {
  const key = 'ss_highlightHistory';
  async function handle() {
    const local = chrome.storage.local;
    const data = (await local.get(key))[key] || {enabled:false, rows:[]};
    const extensionPage = (sender.url || '').startsWith(chrome.runtime.getURL(''));
    if (m.op === 'highlightsManage' && extensionPage) {
      if (m.action === 'clear') data.rows = [];
      if (m.action === 'remove') data.rows = data.rows.filter(row => row.id !== m.id);
      if (typeof m.enabled === 'boolean') data.enabled = m.enabled;
      if (m.action || typeof m.enabled === 'boolean') await local.set({[key]:data});
      return {ok:true,...data};
    }
    if (!sender.tab || sender.tab.incognito) return {ok:false};
    const page = new URL(sender.url || sender.tab.url);
    if (!['https:','http:'].includes(page.protocol)) return {ok:false};
    if (m.op === 'highlightsHint') {
      if (!data.enabled) return {ok:true};
      const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
      const language = String(m.lang || '').toLowerCase();
      if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(language)) return {ok:true};
      const forms = [...new Set((Array.isArray(m.forms) ? m.forms : []).slice(0,5).map(normalize))]
        .filter(form => form.length && form.length <= 160);
      if (!forms.length) return {ok:true};
      const segmenter = new Intl.Segmenter(language,{granularity:'word'});
      const words = value => [...segmenter.segment(normalize(value))].filter(s=>s.isWordLike).map(s=>s.segment);
      const sequences = forms.map(words).filter(seq=>seq.length);
      const current = normalize(m.line);
      let best, bestScore = -1;
      for (const row of data.rows) {
        if (row.lang.toLowerCase() !== language || !row.context || normalize(row.context) === current ||
            forms.includes(normalize(row.context))) continue;
        const direct = forms.includes(normalize(row.term));
        if (!direct) {
          if (!forms.some(form => normalize(row.term).includes(form))) continue;
          const selected = words(row.term);
          if (!sequences.some(seq=>selected.some((_,i)=>seq.every((w,j)=>selected[i+j]===w)))) continue;
        }
        const score = direct ? 2 : 1;
        if (score > bestScore) {best = row; bestScore = score;}
        if (direct) break;
      }
      return {ok:true,hint:best && {line:best.context,title:best.title,url:best.url}};
    }
    if (m.op === 'highlightsState') return {ok:true,enabled:data.enabled};
    if (m.op === 'highlightsEnable') {
      data.enabled = m.enabled === true;
      await local.set({[key]:data});
      return {ok:true,enabled:data.enabled};
    }
    if (m.op !== 'highlightsRecord' || !data.enabled) return {ok:false};
    const term = String(m.term || '').trim().slice(0,3000);
    if (!term) return {ok:false};
    let url = page.href;
    if (m.post && /^(?:www\.)?(?:x|twitter)\.com$/.test(page.hostname)) {
      const post = new URL(m.post,page);
      if (post.origin === page.origin && /^\/[^/]+\/status\/\d+$/.test(post.pathname)) url = post.origin+post.pathname;
    }
    const norm = s => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
    const context=String(m.context || term).slice(0,3000), lang=String(m.lang || 'und').slice(0,24);
    const same = row => row.lang === lang && norm(row.term) === norm(term);
    const rows = data.rows;
    const index = rows.findIndex(row => same(row) && row.url === url && row.context === context);
    const earlier = rows.find((row,i) => same(row) && i !== index);
    const row = index < 0 ? {id:crypto.randomUUID(),first:Date.now(),count:0} : rows.splice(index,1)[0];
    Object.assign(row,{term,context,lang,url,title:String(m.title || page.hostname).slice(0,250),last:Date.now(),count:row.count+1});
    rows.unshift(row);
    data.rows = rows.slice(0,500);
    await local.set({[key]:data});
    return {ok:true,count:row.count,earlier:earlier && {context:earlier.context,url:earlier.url,title:earlier.title}};
  }
  const result=highlightWrites.then(handle);
  highlightWrites=result.catch(()=>{});
  return result;
}

chrome.runtime.onMessage.addListener((m, s, send) => {
  if (!m) return;
  if (['highlightsHint','highlightsState','highlightsEnable','highlightsRecord','highlightsManage'].includes(m.op)) {
    highlightRequest(m,s).then(send,()=>send({ok:false}));return true;
  }
  if (m.op === 'ssSetWebScope' && s?.frameId === 0 && s.tab?.id != null) {
    changeWebScope(s, m.mode).then(() => send({ ok: true }), () => send({ ok: false }));
    return true;
  }
  if (m.op === 'ssGetWebScope' && s?.frameId > 0 && s.tab?.id != null) {
    getWebScope(s.tab.id).then((mode) => send({ ok: true, mode }), () => send({ ok: false }));
    return true;
  }
  if (m.op === 'ssEmbeddedShortcut' && s?.frameId > 0 && s.tab?.id != null) {
    if (['ssToggleArticle', 'ssToggleFullPage', 'ssStartRegionOcr'].includes(m.action)) {
      chrome.tabs.sendMessage(s.tab.id, { op: m.action }, { frameId: 0 }).then(send, () => send(null));
      return true;
    }
  }
  if (['startScenePair', 'startRecallPlaylist', 'readScenePair', 'nextScenePair', 'stopScenePair'].includes(m.op)) {
    compareScenes(m, s).then(send, () => send({ ok: false }));
    return true;
  }
  if (m.op === 'getDiscoveredLessons') {
    fetch(chrome.runtime.getURL('local-study-packs/contrasts.json'), {cache:'no-store'})
      .then(r => r.ok ? r.json() : []).then(send, () => send([]));
    return true;
  }
  if (['recordWatchedScenes', 'getWatchedScenes', 'listSceneRecall', 'clearWatchedScenes', 'sceneFrequency', 'labelScene'].includes(m.op)) {
    watchedSceneRequest(m).then(send, () => send({ ok: false }));
    return true;
  }
  if (m.op === 'reviewStudyItem') {
    SS_STORE.reviewSavedItem(m.id, m.rating, m.timestamp).then(
      (item) => send({ ok: !!item, item }),
      () => send({ ok: false })
    );
    return true;
  }
  if (m.op === 'undoStudyReview') {
    SS_STORE.undoReview(m.at).then((ok) => send({ ok }), () => send({ ok: false }));
    return true;
  }
  if (m.op === 'pronPlay' || m.op === 'pronLookup') {
    // Real recordings from dictionary sources (pron.js). The caller falls back to TTS when ok is false.
    if (!self.SS_PRON) { send({ ok: false, error: 'pron.js not loaded' }); return; }
    const p = m.op === 'pronPlay' ? SS_PRON.play(m.text, m.lang, m.reading, m.rate) : SS_PRON.lookup(m.text, m.lang, m.reading);
    p.then((r) => send(r), (e) => send({ ok: false, error: String(e) }));
    return true;
  }
  if (m.op === 'libSaveText') {
    try {
      chrome.runtime.sendMessage(LIBRARY_EXT_ID, { cmd: 'saveText', path: m.path, text: m.text }, (r) => {
        const err = chrome.runtime.lastError;
        send(err ? { error: 'Library extension not found (' + err.message + ')' } : (r || { error: 'no reply' }));
      });
    } catch (e) { send({ error: String(e) }); }
    return true;
  }
  if (m.op === 'checkExtReload') {
    (async () => {
      if (m.url) companionUrl = m.url.replace(/\/+$/, '');
      const r = await callCompanion('/ext_mtime', null, 'GET', 1200);
      if (!r || !r.ok || typeof r.mtime !== 'number' || r.mtime <= 0) {
        // No companion: compare the code files on disk with what was loaded, and reload by itself.
        send(await checkLocalStamp());
        return;
      }
      if (!bootMtime) {
        bootMtime = r.mtime;
        try { chrome.storage.local.set({ ss_ext_boot_mtime: bootMtime }); } catch (e) {}
        send({ ok: true, reloading: false, mtime: r.mtime });
        return;
      }
      if (r.mtime > bootMtime + 0.05) {
        bootMtime = r.mtime;
        try { chrome.storage.local.set({ ss_ext_boot_mtime: bootMtime }); } catch (e) {}
        send({ ok: true, reloading: true, mtime: r.mtime });
        setTimeout(() => { try { chrome.runtime.reload(); } catch (e) {} }, 80);
        return;
      }
      send({ ok: true, reloading: false, mtime: r.mtime });
    })();
    return true;
  }
  if (m.op === 'captureTabCrop') {
    const tab = s && s.tab;
    if (!tab || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
      send({ ok: false, error: 'Tab capture unavailable' });
      return false;
    }
    (async () => {
      const activeBefore = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
      if (!activeBefore || activeBefore.id !== tab.id) throw new Error('Focus this tab to capture its selected region.');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const activeAfter = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
      if (!activeAfter || activeAfter.id !== tab.id) throw new Error('The active tab changed during capture.');
      send({ ok: true, dataUrl });
    })().catch(error => send({ ok: false, error: error.message || 'Tab capture unavailable' }));
    return true;
  }

  if (m.op === 'openStudyGemini') {
    if (s?.tab?.id == null || s.frameId !== 0) { send({ ok: false }); return false; }
    chrome.tabs.create({ url: 'https://gemini.google.com/', openerTabId: s.tab.id })
      .then(() => send({ ok: true }), () => send({ ok: false }));
    return true;
  }
  if (m.op === 'openExtPage') {
    const allowed = ['reader.html', 'player.html', 'review.html'].includes(m.page) ? m.page : '';
    if (!allowed) { send({ ok: false }); return false; }
    try { chrome.tabs.create({ url: chrome.runtime.getURL(allowed) }); send({ ok: true }); } catch (e) { send({ ok: false }); }
    return false;
  }
  if (m.op === 'loadExtData') {
    const clean = String(m.file || '').replace(/^data\//, '').trim();
    if (!/^[A-Za-z0-9_.-]+\.json$/.test(clean)) {
      send({ ok: false, data: null });
      return false;
    }
    if (extDataCache.has(clean)) {
      send({ ok: true, data: extDataCache.get(clean) });
      return false;
    }
    fetch(chrome.runtime.getURL('data/' + clean))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d != null) extDataCache.set(clean, d);
        send({ ok: d != null, data: d });
      })
      .catch(() => send({ ok: false, data: null }));
    return true;
  }
  if (m.op === 'hostedSpeech') {
    const tag = String(m.lang || '').toLowerCase().replace(/_/g,'-');
    const base = tag.split('-')[0];
    const lang = /^(yue|zh-yue)(-|$)/.test(tag) || tag === 'zh-hk' ? 'yue'
      : base === 'zh' ? (/hant|tw|hk|mo/.test(tag) ? 'zh-TW' : 'zh-CN')
      : ['tl','fil'].includes(base) ? 'fil' : base;
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    if (!text || text.length > 200 || !['ja','ko','yue','zh-TW','zh-CN','fil','ru','en','de','fr','it','pt','es'].includes(lang)) {
      send({ok:false}); return false;
    }
    sharedSpeechAudio(lang,text).then(audio => send({ok:true,audio}), () => send({ok:false}));
    return true;
  }
  if (m.op === 'webTranslate') {
    translateViaWebEngines(m).then(send, () => send({ ok: false, translations: [], error: 'Web translation unavailable' }));
    return true;
  }
  if (m.op === 'openOptions') {
    try {
      if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage(() => send({ ok: true }));
        return true;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }, () => send({ ok: true }));
    } catch (e) {
      send({ ok: false, error: e.message });
    }
    return true;
  }
  if (m.op === 'openReader') {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') }, () => send({ ok: true }));
    } catch (e) {
      send({ ok: false, error: e.message });
    }
    return true;
  }
  if (m.op === 'customTranslate') {
    runCustomOpenAiTranslate({
      text: m.text,
      texts: m.texts,
      tl: m.tl,
      customApi: m.customApi,
      timeoutMs: m.timeoutMs,
    }).then(send);
    return true;
  }
  if (m.op === 'setCompanionUrl' && m.url) {
    companionUrl = m.url.replace(/\/+$/, '');
    send({ ok: true });
    return;
  }
  if (m.op === 'trCacheGet') {
    if (Array.isArray(m.keys)) {
      trCacheGetMany(m.keys).then((hits) => send({ ok: true, hits }));
      return true;
    }
    if (globalThis.SS_TR_CACHE && SS_TR_CACHE.trCacheGet) {
      SS_TR_CACHE.trCacheGet(m.key).then((val) => send({ ok: val !== undefined, value: val }));
      return true;
    }
    trCacheGetMany([m.key].filter(Boolean)).then((hits) => {
      const val = hits && m.key ? hits[m.key] : undefined;
      send({ ok: val !== undefined, value: val });
    });
    return true;
  }
  if (m.op === 'trCacheSet') {
    if (globalThis.SS_TR_CACHE && SS_TR_CACHE.trCacheSet) {
      SS_TR_CACHE.trCacheSet(m.key, m.value).then(() => send({ ok: true }));
      return true;
    }
    send({ ok: false });
    return;
  }
  if (m.op === 'trCacheClear') {
    Promise.all([
      globalThis.SS_TR_CACHE && SS_TR_CACHE.trCacheClear ? SS_TR_CACHE.trCacheClear() : Promise.resolve(),
      trCacheStatsAndClear(true),
    ]).then(([, stats]) => send(stats || { ok: true, hot: 0, idb: 0 }));
    return true;
  }
  if (m.op === 'translateBatch') {
    if (m.url) companionUrl = m.url.replace(/\/+$/, '');
    if (globalThis.SS_TR_CACHE && SS_TR_CACHE.handleTranslateBatch) {
      SS_TR_CACHE.handleTranslateBatch(callCompanion, m.body || m).then(send);
      return true;
    }
    callCompanion('/translate_batch', m.body || m, 'POST', 60000).then(send);
    return true;
  }
  if (m.op === 'setCompanionPower') {
    const on = !!m.on;
    chrome.storage.local.get(['ss_set'], (r) => {
      const st = Object.assign({}, (r && r.ss_set) || {}, { companionOff: !on });
      companionOff = !on;
      chrome.storage.local.set({ ss_set: st }, () => {
        if (on) {
          ensureCompanionRunning(true).then((res) => send(Object.assign({ on: true }, res || {})));
        } else {
          try {
            chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { op: 'stop' }, (resp) => {
              const err = chrome.runtime.lastError;
              send(err ? { ok: false, on: false, error: String(err.message || err) } : Object.assign({ on: false }, resp || { ok: true }));
            });
          } catch (e) {
            send({ ok: false, on: false, error: String((e && e.message) || e) });
          }
        }
      });
    });
    return true;
  }
  if (m.op === 'wakeCompanion') {
    if (m.url) companionUrl = m.url.replace(/\/+$/, '');
    callCompanion('/health', null, 'GET', 1200).then(async (r) => {
      if (r && r.ok) { send({ ok: true, alreadyRunning: true, health: r }); return; }
      const woke = await ensureCompanionRunning(true);
      if (woke && woke.ok) {
        const h2 = await callCompanion('/health', null, 'GET', 2000);
        send(Object.assign({}, woke, { health: h2 && h2.ok ? h2 : null }));
      } else {
        send(woke || { ok: false, error: 'Wake failed' });
      }
    });
    return true;
  }
  if (m.op === 'companion') {
    if (m.url) companionUrl = m.url.replace(/\/+$/, '');
    const extra = m.openCodeSession ? { 'x-opencode-session': SESSION_UUID } : null;
    if (m.liveAudio && m.path === '/transcribe_chunk' && s.tab?.id != null) {
      const fallback = () => callCompanion(m.path,m.body,'POST',m.timeoutMs || 45000);
      sendLiveSpeech(s.tab.id, companionUrl, m.body, m.timeoutMs || 45000)
        .then(result => result || fallback(), fallback).then(send);
    } else {
      callCompanion(m.path, m.body || null, m.method || null, m.timeoutMs || 60000, extra).then(send);
    }
    return true;
  }
  if (m.op === 'matchTextIdioms') {
    matchWebpageIdioms(m.texts || [], m.lang || '', m.tl || 'en', m.model || 'plamo-0.8b', !!m.useBig).then(send);
    return true;
  }
  if (m.op === 'trCachePut') {
    trCachePutMany(m.entries || []).then(send);
    return true;
  }
  if (m.op === 'trCacheStats') {
    trCacheStatsAndClear(false).then(send);
    return true;
  }
  if (m.op === 'saveCaptionEdit') {
    const task = captionEditWrites.then(()=>saveCaptionEdit(m));
    captionEditWrites = task.catch(()=>{});
    task.then(send,()=>send({ok:false}));
    return true;
  }
  if (m.op === 'saveWebItem') {
    const saved = webStudyWrites.then(() => saveWebStudyItem(m.item || {}));
    webStudyWrites = saved.catch(() => {});
    saved.then(send, () => send({ ok: false, error: 'Could not save this study card' }));
    return true;
  }
  if (m.op === 'ocrFrame') {
    if (m.url) companionUrl = m.url.replace(/\/+$/, '');
    runFrameOcr(m).then(send);
    return true;
  }
  if (m.op === 'mtSpeedCatalog') {
    loadExtensionJson('data/mt_speed.json').then((cat) => send({ ok: !!cat, catalog: cat || null }));
    return true;
  }
  if (m.op === 'ankiConnect') {
    callAnkiConnect(m.ankiUrl, m.action, m.params || {}).then(send);
    return true;
  }
  if (m.op === 'examples') {
    fetchTatoebaExamples(m.query, m.lang || 'en', m.tl || 'en').then(send);
    return true;
  }
  if (m.op === 'defineAll') {
    (async () => {
      const words = m.words || [];
      let dLang = String(m.lang || 'en').toLowerCase().split(/[-_]/)[0];
      const joined = words.join(' ');
      if (!dLang || dLang === 'auto') {
        if (/[\u3040-\u30ff]/.test(joined)) dLang = 'ja';
        else if (/[\uac00-\ud7af]/.test(joined)) dLang = 'ko';
        else if (/[\u0400-\u04ff]/.test(joined)) dLang = 'ru';
        else if (/[\u4e00-\u9fff]/.test(joined)) dLang = /[係唔嘅咁咗嚟冇睇畀諗點樣乜嘢]/.test(joined) ? 'yue' : 'zh';
        else if (/[äöüß]/i.test(joined)) dLang = 'de';
        else if (/[çœæ]/i.test(joined)) dLang = 'fr';
        else if (/[ñ¿¡]/i.test(joined)) dLang = 'es';
        else if (/[ãõ]/i.test(joined)) dLang = 'pt';
        else dLang = 'en';
      }
      const imported = () => self.SS_USER_DICTIONARIES
        ?.lookup(words, dLang, self.SS_LANG, self.koreanDictionaryVariants).catch(() => []) || Promise.resolve([]);
      if (m.packsOnly) {
        const sources = await imported();
        if (typeof self.packSources === 'function') {
          sources.push(...await self.packSources(words, dLang, m.tl).catch(() => []));
        }
        if (!sources.some((s) => /cedict/i.test(s.id || s.name || ''))) {
          const zh = await cedictSource(words, dLang);
          if (zh) sources.push(zh);
        }
        send({ ok: sources.length > 0, lang: dLang, sources });
        return;
      }
      // When the companion is unreachable, skip it for 60 s so each click doesn't wait on it again.
      const local = Date.now() < dictCompanionDownUntil ? Promise.resolve(null)
        : callCompanion('/dict_multi', { words, lang: dLang || 'en', tl: m.tl || '' }, 'POST', 3000).then((c) => {
          if (c && !c.ok && c.error) dictCompanionDownUntil = Date.now() + 60000;
          return c;
        }).catch(() => null);
      const online = m.noOnline ? Promise.resolve(null) : (async () => {
        const rawLang = (dLang || 'en').toLowerCase().split(/[-_]/)[0];
        for (const w of words) {
          try {
            const res = await defineWiktionary(w, rawLang);
            if (res) return { id: 'wikt_online', name: 'Wiktionary', note: 'en.wiktionary.org, live', licence: 'CC BY-SA', word: w, entries: res.map((e) => ({ head: w, reading: '', pos: e.pos, defs: e.defs, examples: e.examples })) };
          } catch (e) {}
        }
        return null;
      })();
      const [c, o, userSources] = await Promise.all([local, online, imported()]);
      const sources = [...userSources, ...((c && c.ok && c.sources) || [])];
      // Offline packs answer whenever the companion has nothing (most learners never run it).
      if (!c?.sources?.length && typeof self.packSources === 'function') {
        sources.push(...await self.packSources(words, dLang, m.tl).catch(() => []));
      }
      if (!sources.some((s) => /cedict/i.test(s.id || s.name || ''))) {
        const zh = await cedictSource(words, dLang);
        if (zh) sources.push(zh);
      }
      if (o && !sources.some((s) => s.id === o.id)) sources.push(o);
      send({ ok: sources.length > 0, lang: dLang, sources });
    })();
    return true;
  }
  if (m.op === 'define') {
    (async () => {
      const rawLang = (m.lang || 'en').toLowerCase().split(/[-_]/)[0];
      const hasAsciiWords = (m.words || []).some((w) => /^[A-Za-z][A-Za-z'\s-]*$/.test(w));
      const hasKana = (m.words || []).some((w) => /[\u3040-\u30ff]/.test(w));
      const hasHangul = (m.words || []).some((w) => /[\uac00-\ud7af]/.test(w));
      const hasHan = (m.words || []).some((w) => /[\u4e00-\u9fff]/.test(w));
      const hasCyrillic = (m.words || []).some((w) => /[\u0400-\u04ff]/.test(w));
      const normRaw = rawLang === 'fil' || rawLang === 'tgl' ? 'tl' : rawLang;
      const effectiveDictLang = hasHangul ? 'ko' : hasKana ? 'ja' : hasCyrillic ? 'ru' : (hasHan && !/^(ja|zh|cn|yue)$/.test(normRaw) ? 'zh' : normRaw);
      if (/^(ja|ko|zh|cn|yue|ru|es|fr|de|pt|it|tl)$/.test(effectiveDictLang) && !(hasAsciiWords && /^(ja|ko|zh|cn|yue|ru)$/.test(effectiveDictLang))) {
        const c = await callCompanion('/dict', { words: m.words, lang: effectiveDictLang, tl: m.tl || '' }, 'POST', 2500);
        if (c && c.ok && c.entries && c.entries.length) {
          send({ word: c.word, reading: c.reading || '', entries: c.entries, source: c.source || 'Local dictionary' });
          return;
        }
        const pk = typeof self.packSources === 'function' ? await self.packSources(m.words, effectiveDictLang, m.tl).catch(() => []) : [];
        if (pk.length) {
          send({ word: pk[0].word, reading: pk[0].entries[0].reading || '', entries: pk.flatMap((s) => s.entries.map((e) => ({ pos: e.pos, defs: e.defs }))).slice(0, 6), source: pk.map((s) => `${s.name} (${s.licence})`).join(', ') });
          return;
        }
        const zh = /^(zh|cn|yue)$/.test(effectiveDictLang) ? await cedictSource(m.words, effectiveDictLang) : null;
        if (zh) {
          send({ word: zh.word, reading: zh.entries[0].reading || '', entries: zh.entries.map((e) => ({ pos: e.pos, defs: e.defs })), source: 'CC-CEDICT (CC BY-SA 4.0)' });
          return;
        }
      }
      for (const w of m.words || []) {
        try {
          const res = await defineWiktionary(w, effectiveDictLang);
          if (res) {
            send({ word: w, entries: res, source: 'Wiktionary (CC BY-SA)' });
            return;
          }
        } catch (e) {}
      }
      send(null);
    })();
    return true;
  }
});
