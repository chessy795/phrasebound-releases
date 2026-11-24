// Live pronunciation lookup: real recordings from free dictionary sources, fetched when the learner clicks.
// Nothing is downloaded or shipped; each click asks the source, like Yomitan does.
//   1. Japanese: JapanesePod101 dictionary audio (needs the kana reading). Its "no audio" clip is detected and skipped.
//   2. ko/yue/zh/en/es/fr/de/it/pt/ru/tl: LanguagePod101-family dictionary audio (exact headword match only).
//   3. Every language: Wikimedia Commons recordings (Lingua Libre "LL-Q... (lang)-speaker-word.wav" and Wiktionary
//      "En-us-word.ogg" style files), found through the Commons search API.
// Returns {ok, url, source, speaker} or {ok:false}. Results (hits and misses) are cached in storage for 30 days.
// Loaded in the background service worker (importScripts) and exposed as self.SS_PRON.
(function (root) {
  'use strict';
  const LANGQ = { en: 'Q1860', ja: 'Q5287', ko: 'Q9176', zh: 'Q9192', yue: 'Q9186', es: 'Q1321', fr: 'Q150', de: 'Q188', pt: 'Q5146', it: 'Q652', ru: 'Q7737', tl: 'Q34057' };
  const LANG3 = { en: 'eng', ja: 'jpn', ko: 'kor', zh: 'cmn', yue: 'yue', es: 'spa', fr: 'fra', de: 'deu', pt: 'por', it: 'ita', ru: 'rus', tl: 'tgl' };
  const WIKT = { en: ['En-us', 'En-uk', 'En-au', 'En'], fr: ['Fr', 'Fr-Paris'], de: ['De'], es: ['Es'], it: ['It'], pt: ['Pt-br', 'Pt'],
    ru: ['Ru'], ja: ['Ja'], ko: ['Ko'], zh: ['Zh', 'Cmn'], yue: ['Yue'], tl: ['Tl'] };
  // LanguagePod101 family (Innovative Language): voice-actor recordings in its free dictionary. Same endpoint Yomitan uses.
  const POD = { ko: 'koreanclass101', yue: 'cantoneseclass101', zh: 'chineseclass101', en: 'englishclass101', es: 'spanishpod101',
    fr: 'frenchpod101', de: 'germanpod101', it: 'italianpod101', pt: 'portuguesepod101', ru: 'russianpod101', tl: 'filipinopod101' };
  const JPOD_MISSING_BYTES = 52288;   // size of JapanesePod101's "the audio for this clip is currently not available" clip
  const TTL = 30 * 864e5;
  const mem = new Map();

  const norm = (l) => {
    l = String(l || 'en').toLowerCase();
    if (/^(zh-(hk|mo)|yue)/.test(l)) return 'yue';
    if (/^(zh|cmn)/.test(l)) return 'zh';
    if (/^(fil|tl)/.test(l)) return 'tl';
    return l.split(/[-_]/)[0];
  };

  async function commonsSearch(q) {
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', list: 'search', srnamespace: '6', srlimit: '30', srsearch: q, origin: '*',
    });
    const r = await fetch(u);
    if (!r.ok) throw new Error('commons ' + r.status);   // rate limit or outage: do not cache as "no recording"
    const d = await r.json();
    return ((d.query && d.query.search) || []).map((x) => x.title);
  }
  async function commonsFileUrl(title) {
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|user', titles: title, origin: '*',
    });
    const d = await (await fetch(u)).json();
    const p = Object.values((d.query && d.query.pages) || {})[0];
    const ii = p && p.imageinfo && p.imageinfo[0];
    return ii ? { url: ii.url, user: ii.user } : null;
  }

  async function fromCommons(text, lang) {
    const l3 = LANG3[lang];
    const esc = text.replace(/"/g, '');
    // Lingua Libre: one file per speaker and word
    if (l3) {
      const titles = await commonsSearch(`intitle:"${esc}" intitle:"(${l3})"`);
      const want = (t) => t.startsWith('File:LL-Q') && t.includes(`(${l3})-`) && t.endsWith(`-${text}.wav`);
      // prefer files filed under the language's own item (LL-Q1860 = English); others are often learners' recordings
      const hit = titles.find((t) => want(t) && t.startsWith(`File:LL-${LANGQ[lang]} (`)) || titles.find(want);
      if (hit) {
        const f = await commonsFileUrl(hit);
        if (f) return { ok: true, url: f.url, source: 'Lingua Libre (Wikimedia Commons)', speaker: (hit.split('-')[2] || '').trim() || f.user };
      }
    }
    // Wiktionary-style files: En-us-water.ogg, Fr-bonjour.ogg
    for (const pre of WIKT[lang] || []) {
      const titles = await commonsSearch(`intitle:"${pre}-${esc}"`);
      const re = new RegExp('^File:' + pre.replace(/[-]/g, '\\-') + '-' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(-\\d)?\\.(ogg|oga|mp3|wav|flac)$', 'i');
      const hit = titles.find((t) => re.test(t));
      if (hit) {
        const f = await commonsFileUrl(hit);
        if (f) return { ok: true, url: f.url, source: 'Wiktionary recording (Wikimedia Commons)', speaker: f.user };
      }
    }
    return null;
  }

  const unesc = (x) => x.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  async function fromPod101(text, lang) {
    const site = POD[lang];
    if (!site) return null;
    const r = await fetch(`https://www.${site}.com/learningcenter/reference/dictionary_post`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ post: 'dictionary_reference', match_type: 'exact', search_query: text, vulgar: 'true' }),
    });
    if (!r.ok) throw new Error(site + ' ' + r.status);
    const html = await r.text();
    const want = text.toLowerCase();
    // each result row holds its headword (.dc-vocab) and audio <source>s; keep only rows whose headword is exactly the term
    for (const row of html.split(/class="[^"]*dc-result-row(?=[\s"])[^"]*"/).slice(1)) {
      const v = row.match(/class=['"]dc-vocab['"][^>]*>([\s\S]*?)<\/span>/);
      if (!v || unesc(v[1]).toLowerCase() !== want) continue;
      const src = row.match(/<source src="([^"]+\.mp3)"/);
      if (src) return { ok: true, url: src[1], source: site.replace(/(class|pod)101$/, (m) => m === 'class101' ? 'Class101' : 'Pod101').replace(/^./, (c) => c.toUpperCase()) };
    }
    return null;
  }

  async function fromJapanesePod(text, reading) {
    const kana = reading || (/^[぀-ヿーー]+$/.test(text) ? text : '');
    if (!kana) return null;
    const u = 'https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?' + new URLSearchParams({ kanji: text, kana });
    const r = await fetch(u);
    if (!r.ok) return null;
    const b = await r.arrayBuffer();
    if (!b.byteLength || b.byteLength === JPOD_MISSING_BYTES) return null;
    return { ok: true, url: u, source: 'JapanesePod101' };
  }

  async function lookup(text, lang, reading) {
    text = String(text || '').trim();
    lang = norm(lang);
    if (!text || text.length > 60) return { ok: false };
    const key = `pron|${lang}|${text}|${reading || ''}`;
    if (mem.has(key)) return mem.get(key);
    try {
      const got = await chrome.storage.local.get(key);
      const c = got && got[key];
      if (c && Date.now() - c.at < TTL) { mem.set(key, c.v); return c.v; }
    } catch (e) {}
    let v = null;
    try {
      if (lang === 'ja') v = await fromJapanesePod(text, reading);
      if (!v) v = await fromPod101(text, lang).catch(() => null);   // site down: still try Commons
      if (!v) v = await fromCommons(text, lang);
      if (!v && lang === 'en' && text !== text.toLowerCase()) v = await fromCommons(text.toLowerCase(), lang);
    } catch (e) { return { ok: false, transient: true, error: String(e && e.message || e) }; }
    v = v || { ok: false };
    mem.set(key, v);
    try { await chrome.storage.local.set({ [key]: { at: Date.now(), v } }); } catch (e) {}
    return v;
  }

  // Playback in the offscreen document, so page content policies (YouTube, Netflix) cannot block the audio.
  let creating = null;
  async function ensureOffscreen() {
    if (chrome.runtime.getContexts) {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (ctx && ctx.length) return;
    }
    if (!creating) {
      creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play dictionary pronunciation recordings' })
        .catch((e) => { if (!/single offscreen|already/i.test(String(e && e.message))) throw e; })
        .finally(() => { creating = null; });
    }
    await creating;
  }
  async function play(text, lang, reading, rate) {
    const v = await lookup(text, lang, reading);
    if (!v.ok) return v;
    await ensureOffscreen();
    const r = await chrome.runtime.sendMessage({ type: 'SS_PRON_PLAY', url: v.url, rate: rate || 1 });
    return r && r.ok ? v : { ok: false, error: (r && r.error) || 'playback failed', url: v.url };
  }

  root.SS_PRON = { lookup, play, norm };
})(typeof self !== 'undefined' ? self : globalThis);
