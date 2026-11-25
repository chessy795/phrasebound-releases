// Phrasebound content controller (formerly Subtitle Study).
// Strict Trusted-Types safe DOM: createElement + textContent only (ZERO innerHTML/outerHTML).
(() => {
  if (window.__ssContent) return;
  window.__ssContent = true;

  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      if (k === 'class') e.className = props[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
      else if (props[k] != null && props[k] !== false) e.setAttribute(k, props[k]);
    }
    for (const c of kids) if (c != null && c !== false && c !== undefined) e.append(c);
    return e;
  };

  const captionMark = () => h('span', { class: 'ss-caption-mark', 'aria-hidden': 'true' });

  const appendClean = (el, ...kids) => {
    if (!el) return el;
    for (const c of kids) if (c != null && c !== false && c !== undefined) el.append(c);
    return el;
  };

  const fmt = (s) => Math.floor(Math.max(0, s) / 60) + ':' + String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0');

  const STAGE_NOISE_RE = /\[\s*(?:music|singing|applause|laughter|cheering|instrumental|audio|sound|音樂|音乐|唱歌|拍手|笑|掌声|掌聲)[^\]]*\]|♪+/gi;
  const cleanCueText = (raw) =>
    String(raw || '')
      .replace(STAGE_NOISE_RE, ' ')
      .replace(/^[\s>»]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const toast = (msg) => {
    const t = h('div', { class: 'ss-toast' }, msg);
    (document.fullscreenElement || document.body).append(t);
    setTimeout(() => t.remove(), 2400);
  };

  // ---- Multi-site adapter lookup + fallback YouTube descriptor (for standalone VM tests) ----
  let seq = 0;
  const waits = new Map();
  window.addEventListener('message', (e) => {
    const m = e && e.data;
    if (e.source !== window || !m || m.ss !== 'res') return;
    const w = waits.get(m.id);
    if (w) { waits.delete(m.id); w(m.data); }
  });
  const localAsk = (op, extra, ms = 12000) => new Promise((res) => {
    const id = ++seq;
    waits.set(id, res);
    const origin = (location && location.origin && location.origin !== 'null') ? location.origin : '*';
    window.postMessage(Object.assign({ ss: 'req', id, op }, extra || {}), origin);
    setTimeout(() => { if (waits.has(id)) { waits.delete(id); res(null); } }, ms);
  });
  const ask = (op, extra, ms = 12000) =>
    (window.SS_SITES && typeof window.SS_SITES.ask === 'function')
      ? window.SS_SITES.ask(op, extra, ms)
      : localAsk(op, extra, ms);

  const hostFromLoc = (loc) => {
    const l = loc || location || {};
    if (l.hostname) return String(l.hostname);
    const m = String(l.origin || l.href || '').match(/^https?:\/\/([^/:?#]+)/i);
    return m ? m[1] : '';
  };

  const DEFAULT_YT_SITE = {
    id: 'yt',
    name: 'YouTube',
    isHost: (loc) => /(^|\.)youtube\.com$/i.test(hostFromLoc(loc)),
    match: (loc) => {
      const l = loc || location;
      return /(^|\.)youtube\.com$/i.test(hostFromLoc(l))
        && (l.pathname === '/watch' || String(l.pathname || '').startsWith('/shorts/'));
    },
    isShorts: () => String(location.pathname || '').startsWith('/shorts/'),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      if (String(location.pathname || '').startsWith('/shorts/')) {
        return document.getElementById('shorts-player')
          || document.querySelector('ytd-reel-video-renderer[is-active] .html5-video-player')
          || document.querySelector('#shorts-container .html5-video-player');
      }
      return document.getElementById('movie_player');
    },
    video: () => {
      const pc = DEFAULT_YT_SITE.container();
      return (pc && pc.querySelector && pc.querySelector('video')) || document.querySelector('#movie_player video');
    },
    controlsTarget: () => {
      const pc = DEFAULT_YT_SITE.container();
      return pc && pc.querySelector ? pc.querySelector('.ytp-right-controls') : null;
    },
    inlineSidebar: () => document.querySelector('#secondary-inner') || document.querySelector('#secondary'),
    rawVideoId: (loc) => {
      const l = loc || location;
      const sm = String(l.pathname || '').match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
      return sm ? sm[1] : (new URLSearchParams(l.search || '').get('v') || '');
    },
    videoKey: (rawId) => {
      const id = String(rawId || DEFAULT_YT_SITE.rawVideoId() || '').replace(/^yt:/, '');
      return id ? `yt:${id}` : '';
    },
    videoUrl: (rawId, tSec) => `https://www.youtube.com/watch?v=${encodeURIComponent(String(rawId || '').replace(/^yt:/, ''))}&t=${Math.floor(tSec || 0)}s`,
    onNavigate: (cb) => {
      document.addEventListener('yt-navigate-finish', cb);
      return () => document.removeEventListener('yt-navigate-finish', cb);
    },
    isAd: () => {
      const p = document.getElementById('movie_player');
      return !!(p && p.classList && p.classList.contains('ad-showing'));
    },
    seek: (sec) => {
      const v = DEFAULT_YT_SITE.video();
      if (v) v.currentTime = Math.max(0, sec) + 0.01;
    },
    nativeOff: () => {},
    nativeOn: () => {},
    features: { search: true, shorts: true, recommendations: true, stageLayout: true, ytMt: true },
  };

  const getActiveSite = () =>
    (window.SS_SITES && window.SS_SITES.current(location))
    || (DEFAULT_YT_SITE.match(location) ? DEFAULT_YT_SITE : null);

  const getHostSite = () =>
    (window.SS_SITES && window.SS_SITES.byHost && window.SS_SITES.byHost(location))
    || (DEFAULT_YT_SITE.isHost(location) ? DEFAULT_YT_SITE : null);

  const normSiteVidKey = (rawOrKey, siteObj = null) => {
    const s = String(rawOrKey || '').trim();
    if (!s) return '';
    if (/^(yt|nf|pv|dp|bili|atv|gen|tw|blive|cz|soop|kk|fb|tt):/.test(s)) return s;
    const site = siteObj || getActiveSite() || getHostSite() || DEFAULT_YT_SITE;
    return site && site.videoKey ? site.videoKey(s) : `yt:${s}`;
  };

  const sameVidKey = (a, b) => {
    if (!a || !b) return false;
    return normSiteVidKey(a) === normSiteVidKey(b);
  };

  const videoUrlOf = (vidKeyOrId, tSec = 0) => {
    if (window.SS_SITES && typeof window.SS_SITES.resolveVideoUrl === 'function') {
      return window.SS_SITES.resolveVideoUrl(vidKeyOrId, tSec);
    }
    return DEFAULT_YT_SITE.videoUrl(vidKeyOrId, tSec);
  };

  const bg = (msg) =>
    new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void (chrome.runtime && chrome.runtime.lastError);
          res(r || { ok: false });
        });
      } catch (e) {
        res({ ok: false, error: String((e && e.message) || e) });
      }
    });

  const comp = (path, body = null, method = null, timeoutMs = 60000) =>
    bg({ op: 'companion', path, body, method, timeoutMs, url: S.set.companionUrl });

  // ---- Static bundled data loaders ----
  const dataCache = {};
  const loadData = async (name) => {
    if (Object.prototype.hasOwnProperty.call(dataCache, name)) return dataCache[name];
    let out = null;
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      out = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ op: 'loadExtData', file: name }, (resp) => {
            if (chrome.runtime && chrome.runtime.lastError) { resolve(null); return; }
            resolve(resp && resp.ok ? resp.data : null);
          });
        } catch (_) { resolve(null); }
      });
    }
    if (out == null) {
      try {
        const r = await fetch(chrome.runtime.getURL('data/' + name));
        out = r.ok ? await r.json() : null;
      } catch (e) { out = null; }
    }
    dataCache[name] = out;
    return out;
  };

  // Spoken frequency of an expression in three corpora (ext/data/spoken_<lang>.json, built by _dev/build_spoken_rates.py).
  const fillSpokenRates = async (slot, fe) => {
    try {
      const lang = normLangCode((V && V.lang) || '');
      if (!lang) return;
      const d = await loadData(`spoken_${lang}.json`);
      if (!d || !d.r) return;
      const keys = [fe.display, fe.pattern, fe.surface].filter(Boolean);
      let r = null;
      for (const k of keys) { r = d.r[k] || d.r[String(k).toLowerCase()]; if (r) break; }
      if (!r) return;
      const unit = d.meta && d.meta.unit === 'characters' ? 'characters' : 'words';
      const names = (d.meta && d.meta.names) || ['YouTube talk', 'films and TV', 'TED talks'];
      const short = (d.meta && d.meta.short) || ['YouTube', 'film', 'TED'];
      const fmt = (x) => (x >= 10 ? Math.round(x) : x >= 1 ? x.toFixed(1) : x > 0 ? x.toFixed(2) : '0');
      const top = r.indexOf(Math.max(...r));
      const others = r.filter((_, i) => i !== top);
      const lead = r[top] > 0 && others.length && others.every((x) => r[top] >= 2 * x) ? ` · mostly in ${names[top]}` : '';
      slot.textContent = '';
      slot.append(h('b', {}, `Heard per million ${unit}: `),
        `${r.map((x, i) => `${short[i]} ${fmt(x)}`).join(' · ')}${lead}`);
      slot.title = 'Counted in ' + names.join(', ');
      slot.style.display = '';
    } catch (_) { /* optional */ }
  };

  // ---- Persistent & session state ----
  let S = { set: {}, words: {}, items: [], xp: 0 };
  let companionHealth = null;
  let V = null;
  let run = 0;
  let tab = 'lines';
  let dictOpen = false;
  let qtrayOpen = false;  // second toolbar row stays folded until 'More' is clicked
  let settingsOpen = false;
  let listFilter = '';
  let savedFilter = 'all';
  let drillMode = 'cloze';
  let drillState = null;
  let concordanceTarget = null;
  let concordanceRows = [];
  let clipStopAt = -1;
  let fitCardOpen = false;
  let fitWhyOpen = false;
  let feLayerFilter = 'all';
  let feSearchQuery = '';
  let wordsSortMode = 'learn';
  let exportOnlyNew = false;
  let pumpState = null;
  let lastWordClick = null;
  let loopRange = null; // { startLi, endLi } for A-B multi-line loop ([ and ])
  let asrState = { active: false, stopRequested: false, progressTxt: '', engine: '' };

  const save = (k, targetChanged) => SS_STORE.saveKey(k, S[k], targetChanged);
  const addXp = (pts) => { S.xp = (S.xp || 0) + pts; save('xp'); };
  const getProfile = () => SS_STORE.PROFILES[S.set.researchProfile || 'full'] || SS_STORE.PROFILES.full;
  const curVidKey = () => (V && (V.videoKey || (V.info && normSiteVidKey(V.info.videoId)))) || '';
  const logEv = (type, payload = {}) =>
    SS_STORE.logEvent(S.set.researchTelemetry, type, Object.assign({ videoId: curVidKey() }, payload), S.set.researchProfile || 'full');

  const isShortsPage = () => {
    const s = getActiveSite();
    return !!(s && s.isShorts && s.isShorts());
  };
  const playerContainer = () => {
    const s = getActiveSite();
    return (s && s.container && s.container()) || null;
  };
  const video = () => {
    const s = getActiveSite();
    return (s && s.video && s.video()) || null;
  };
  const normLangCode = (lang) => {
    const n = window.SS_IDIOMS && SS_IDIOMS.normLang ? SS_IDIOMS.normLang(lang) : String(lang || 'en').split('-')[0].toLowerCase();
    // Cantonese tracks are often labelled zh / zh-TW (and so is speech-to-text output): finishLoadAnalysis sets yueByText from the text
    return n === 'zh' && typeof V !== 'undefined' && V && V.yueByText && lang === V.lang ? 'yue' : n;
  };
  const sameTranslationLanguage = (a, b) => Boolean(a && b) &&
    SS_LANG.translationLanguageKey(a) === SS_LANG.translationLanguageKey(b);

  const prepareLines = (rawLines) => (rawLines || []).map((ln) => {
    const rawT = ln.rawT != null ? ln.rawT : (ln.t || '');
    const cleanT = S.set.cleanStageNoise !== false ? cleanCueText(rawT) : rawT;
    const s = Number(ln.s || 0);
    const d = ln.d != null ? Number(ln.d) : (ln.e != null ? Math.max(0.05, Number(ln.e) - s) : 2.5);
    const e = ln.e != null ? Number(ln.e) : Math.round((s + d) * 1000) / 1000;
    return Object.assign({}, ln, {
      s,
      e,
      d,
      rawT,
      t: cleanT,
      isInstrumental: !cleanT.trim(),
    });
  });

  // Capture current YouTube video frame onto <canvas> as compact WebP data URL
  const captureHardsubBand = (bandRatio = 0.28) => {
    try {
      const v = video();
      if (!v || v.mediaKeys || !v.videoWidth || !v.videoHeight) return '';
      const w = Math.min(960, v.videoWidth);
      const scale = w / v.videoWidth;
      const cropY = Math.floor(v.videoHeight * (1 - bandRatio));
      const cropH = Math.max(32, v.videoHeight - cropY);
      const hPx = Math.max(24, Math.round(cropH * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = hPx;
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(v, 0, cropY, v.videoWidth, cropH, 0, 0, w, hPx);
      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  };

  let ocrCardEl = null;
  const closeOcrCard = () => { if (ocrCardEl) { ocrCardEl.remove(); ocrCardEl = null; } };
  const translateFrameText = async (text, source, target, service) => {
    if (!target || sameTranslationLanguage(source,target)) return '';
    if (service === 'custom_openai') {
      const r = await bg({op:'customTranslate',text,tl:target,customApi:S.set.customApi || null});
      return r?.translation || '';
    }
    if (service !== 'free_web' && service !== 'browser_api') {
      const models = {local_plamo2b:'plamo-2b',local_index2b:'index-2b',local_gemma_e4b:'gemma-e4b',local_hymt7b:'hy-mt2-7b'};
      const r = await comp('/translate_text',{text,source_lang:source,target_lang:target,
        model:models[service] || S.set.mtModel || 'plamo-2b',device:S.set.mtDevice || 'gpu'},'POST',25000);
      if (r?.translation || service !== 'auto') return r?.translation || '';
    }
    const r = await bg({op:'webTranslate',texts:[text],sl:source || 'auto',tl:target});
    return r?.translations?.[0] || '';
  };
  const captureHardsubOcr = async () => {
    const v = video();
    if (!v) { toast('No active video found for OCR'); return; }
    if (v.mediaKeys) { toast('DRM-protected video blocks frame OCR; use native subtitle tracks here'); return; }
    const b64 = captureHardsubBand(0.28);
    if (!b64) { toast('Could not capture video frame (CORS or empty frame)'); return; }
    toast('Scanning burned-in subtitle band via OCR…');
    const langHint = (V && V.lang) ? normLangCode(V.lang) : 'auto';
    const r = await bg({
      op: 'ocrFrame',
      imageDataUrl: b64, subtitleBand:true,
      lang: langHint,
      tl: S.set.tl || 'en',
      url: S.set.companionUrl,
      ocrUrl: S.set.ocrUrl || '',
      ocrKey: S.set.ocrKey || '',
      ocrModel: S.set.ocrModel || '',
    });
    if (!r || !r.ok || !r.text) {
      toast((r && r.error) || 'No burned-in subtitle detected in bottom video band');
      return;
    }
    const lineTxt = String(r.text).replace(/\s+/g, ' ').trim();
    closeOcrCard();
    const tl = S.set.tl || 'en';
    const service = S.set.sceneServices?.ocr || 'auto';
    const trTxt = await translateFrameText(lineTxt,langHint,tl,service);
    const feHits = (window.SS_IDIOMS && typeof SS_IDIOMS.findInText === 'function') ? SS_IDIOMS.findInText(lineTxt, tl, langHint !== 'auto' ? langHint : '') : [];

    ocrCardEl = h('div', { class: 'ss-ocr-card' },
      h('div', { class: 'ss-ocr-head' },
        h('span', { class: 'ss-ocr-tag' }, `Hardsub OCR · ${r.source || r.engine || 'local'}`),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', {
            class: 'ss-qpill',
            onclick: () => {
              saveItem({ itemType: 'PHRASE', word: lineTxt, line: lineTxt, trans: trTxt, lang: langHint === 'auto' ? 'zh' : langHint, t: v.currentTime || 0 });
              toast('Saved OCR subtitle line');
            },
          }, '+ Save'),
          h('button', { class: 'ss-qpill', onclick: closeOcrCard }, '✕'))),
      h('div', { class: 'ss-ocr-src' }, lineTxt),
      trTxt ? h('div', { class: 'ss-ocr-tr' }, trTxt) : null,
      feHits.length ? h('div', { class: 'ss-ocr-fes' },
        ...feHits.map((f) => h('span', { class: 'ss-ocr-fe-chip', title: f.gloss || '' }, `${f.phrase}${f.gloss ? ' · ' + f.gloss : ''}`))) : null);
    (document.fullscreenElement || document.body).appendChild(ocrCardEl);
  };

  const captureVideoFrame = () => {
    try {
      const v = video();
      if (!v || !v.videoWidth || !v.videoHeight) return '';
      const scale = Math.min(1, 480 / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(v.videoWidth * scale));
      c.height = Math.max(1, Math.round(v.videoHeight * scale));
      const ctx = c.getContext('2d');
      ctx.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', 0.82);
    } catch (e) { return ''; }
  };

  // ---- UI roots & Cinema Split-Stage controller ----
  let ov, panel, headEl, qbarEl, dockEl, modalBack, tabsEl, listEl, ytpBtn, ytpGearBtn, floatBtn;

  const captionBottom = () => S.set.subtitleBottomPct ?? (S.set.overlayBottom === 10 ? 5 : S.set.overlayBottom ?? 5);
  const getBlurMode = () => V?.blurMode || 'off';
  const setBlurMode = (m) => {
    if (!V) return;
    V.blurMode = m;
    applyVisualPrefs();
    drawHead();
    if (V && V.cur >= 0) drawLine(V.cur);
  };
  const cycleBlurMode = () => {
    const order = ['off', 'tr', 'both', 'audio'];
    const next = order[(order.indexOf(getBlurMode()) + 1) % order.length];
    setBlurMode(next);
    const names = { off: 'Subtitles: Show all', tr: 'Subtitles: Blur translation', both: 'Listening Shield: Blur both lines', audio: 'Audio-first: Hide until hover / E' };
    toast(names[next]);
  };

  const isStageMode = () =>
    !!S.set.on && !!V && !S.set.panelHidden && !isShortsPage() && S.set.layoutMode !== 'inline' && window.innerWidth >= 1080 && !document.fullscreenElement;

  // Standalone Transcript tools (works identically on Bilibili, YouTube & all supported sites,
  // with direct browser .md download, timestamps toggle, clipboard copy, inline summary, and built-in ASR fallback).
  const fmtTs = (s) => { s = Math.max(0, Math.floor(s || 0)); const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
  const transcriptText = (withTime) => (V ? V.lines : []).map((l) => (withTime ? `[${fmtTs(l.s)}] ` : '') + l.t).join('\n');
  const videoMeta = () => {
    const bvid = (/\/video\/(BV\w+|av\d+)/i.exec(location.pathname) || [])[1]
      || (/\/bangumi\/play\/(ep\d+|ss\d+)/i.exec(location.pathname) || [])[1]
      || '';
    const p = +(new URLSearchParams(location.search).get('p') || 1);
    const rawTitle = (V && V.info && V.info.title) || document.title || bvid || 'transcript';
    const title = rawTitle.replace(/_(哔哩哔哩|嗶哩嗶哩)_bilibili$/i, '').trim() || bvid || 'transcript';
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    return {
      isBili: Boolean(getActiveSite() && getActiveSite().id === 'bili'),
      bvid, p, title, fname: safeName + '.md', sumFname: safeName + '.summary.md',
    };
  };
  const downloadMdFile = (filename, mdText) => {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([mdText], { type: 'text/markdown;charset=utf-8' }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch (_) {} }, 2500);
      return true;
    } catch (_) { return false; }
  };
  const parseTsSec = (tsStr) => {
    const parts = String(tsStr || '').split(':').map((x) => parseInt(x, 10));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };
  let summaryState = { loading: false, open: false, data: null, videoId: '' };
  let listFollowPausedUntil = 0;

  const buildLocalTranscriptSummary = async () => {
    const all = (V && V.lines || []).filter((l) => l && !l.isInstrumental && l.t && l.t.trim().length >= 4);
    if (!all.length) return null;
    const nBuckets = Math.min(6, Math.max(3, Math.ceil(all.length / 20)));
    const step = Math.max(1, Math.floor(all.length / nBuckets));
    const picks = [];
    for (let b = 0; b < all.length && picks.length < nBuckets; b += step) {
      const chunk = all.slice(b, Math.min(all.length, b + step));
      let best = chunk[0];
      let bestScore = -1;
      for (const ln of chunk) {
        const sc = Math.min(120, ln.t.trim().length) + (transFor(ln) ? 8 : 0);
        if (sc > bestScore) { bestScore = sc; best = ln; }
      }
      if (best) picks.push(best);
    }
    const targetLang = S.set.tl || 'en';
    const srcLang = (V && V.lang) || '';
    const sameLang = !srcLang || srcLang.split('-')[0].toLowerCase() === targetLang.split('-')[0].toLowerCase();
    const trPicks = new Map();
    if (!sameLang) {
      for (const p of picks) {
        const existing = transFor(p);
        if (existing) trPicks.set(p, existing);
      }
      const needMt = picks.filter((p) => !trPicks.has(p));
      if (needMt.length) {
        try {
          const wr = await bg({ op: 'webTranslate', texts: needMt.map((x) => x.t), tl: targetLang });
          if (wr && wr.ok && Array.isArray(wr.translations)) {
            needMt.forEach((p, idx) => { if (wr.translations[idx]) trPicks.set(p, wr.translations[idx]); });
          }
        } catch (_) {}
      }
    }
    const points = picks.map((p) => ({
      s: p.s,
      ts: fmtTs(p.s),
      text: trPicks.get(p) || p.t,
    }));
    return { points, source: sameLang ? 'Subtitle highlights' : 'Translated subtitle highlights' };
  };

  const lineHashOf = (lines) => {
    const sample = (lines || []).filter((l) => !l.isInstrumental).slice(0, 30).map((l) => l.t).join('|');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < sample.length; i++) { h ^= sample.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return `${(lines || []).length}:${h.toString(36)}`;
  };

  const shouldAutoSummarize = (vObj, existingTrace) => {
    if (!vObj || !vObj.lines || vObj.lines.length < 12) return false;
    const hash = lineHashOf(vObj.lines);
    if (existingTrace && existingTrace.trackHash === hash && existingTrace.summary) return false; // Never re-summarize looped songs/videos
    const speech = vObj.lines.filter((l) => !l.isInstrumental);
    if (speech.length < 12) return false;
    const instRatio = 1 - (speech.length / vObj.lines.length);
    const title = String((vObj.info && vObj.info.title) || '');
    const musicTitle = /\b(official\s*(music\s*video|mv|audio|lyric)|lyrics?\s*video|mv)\b|【?(純享|翻唱|試聽|歌詞)】?/i.test(title);
    if (musicTitle || instRatio > 0.45) return false;
    const engaged = (vObj._watchedSec || 0) >= 60 || (vObj._struggledMap && vObj._struggledMap.size >= 2);
    return engaged;
  };

  const buildAiStudyContextDigest = async () => {
    const m = videoMeta();
    const curLines = V && V._struggledMap ? [...V._struggledMap.values()].sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 8) : [];
    const traces = SS_STORE.getStudyTraces ? await SS_STORE.getStudyTraces(6) : [];
    const parts = [];
    parts.push(`# Study Context (${V && V.lang ? V.lang : 'auto'} -> ${S.set.tl || 'en'})`);
    parts.push(`## Current Video: ${m.title}`);
    if (V && V._watchedSec) parts.push(`Active study time: ${Math.round(V._watchedSec)}s`);
    if (curLines.length) {
      parts.push('Dragged-back / replayed lines:');
      for (const sc of curLines) parts.push(`- [${fmtTs(sc.s)}] ${sc.t}${sc.tr ? ' -> ' + sc.tr : ''} (replayed ${sc.count}x)`);
    } else if (V && V.lines && V.lines.length && V.cur >= 0 && V.lines[V.cur]) {
      const cl = V.lines[V.cur];
      parts.push(`Current line [${fmtTs(cl.s)}]: ${cl.t}${transFor(cl) ? ' -> ' + transFor(cl) : ''}`);
    }
    if (V && V.analysis && V.analysis.allFEs && V.analysis.allFEs.length) {
      parts.push('Key expressions here: ' + V.analysis.allFEs.slice(0, 10).map((f) => f.display).join(', '));
    }
    const prior = traces.filter((tr) => tr.videoKey !== curVidKey());
    if (prior.length) {
      parts.push('\n## Recent Watched History (Cross-Video Traces)');
      for (const pt of prior.slice(0, 5)) {
        const mins = Math.max(1, Math.round((pt.watchedSec || 0) / 60));
        parts.push(`- ${pt.title || pt.videoKey} (${mins}m studied${pt.lang ? ', ' + pt.lang : ''})${pt.summary ? ': ' + pt.summary : ''}`);
        if (pt.struggledCues && pt.struggledCues.length) {
          parts.push('  Replayed: ' + pt.struggledCues.slice(0, 3).map((c) => `[${fmtTs(c.s)}] ${c.t}`).join(' | '));
        }
      }
    }
    return parts.join('\n');
  };

  const generateTranscriptSummary = async () => {
    if (!V || !V.lines || !V.lines.length) { toast('No subtitle lines to summarize'); return; }
    const vid = curVidKey();
    const snapHash = lineHashOf(V.lines);
    const snapTitle = (V.info && V.info.title) || '';
    const snapAuthor = (V.info && V.info.author) || '';
    const snapSite = (V.site && V.site.id) || 'yt';
    const snapLang = V.lang || '';
    if (summaryState.videoId === vid && summaryState.data && !summaryState.loading) {
      summaryState.open = !summaryState.open;
      drawHead();
      drawList();
      return;
    }
    summaryState = { loading: true, open: true, data: null, videoId: vid };
    drawList();
    let parsed = null;
    if (companionHealth && companionHealth.ok) {
      try {
        const lines = V.lines.filter((l) => !l.isInstrumental);
        const sample = lines.length <= 48 ? lines : Array.from({length: 16},
          (_, i) => Math.round(i * (lines.length - 3) / 15)).flatMap(start => lines.slice(start, start + 3));
        const res = await comp('/summarize', {
          lines: sample.map((l) => ({ ts: fmtTs(l.s), t: l.t.slice(0, 100) })),
          title: snapTitle,
          target_lang: S.set.tl || 'en',
        }, 'POST', 90000);
        if (res && res.ok && res.summary) {
          const rawLines = String(res.summary).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          let tldr = '';
          const pts = [];
          for (const rl of rawLines) {
            if (/^tl;?dr\s*:/i.test(rl)) { tldr = rl.replace(/^tl;?dr\s*:\s*/i, '').trim(); continue; }
            const tm = rl.match(/^[-*•]?\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.+)$/);
            if (tm) pts.push({ s: parseTsSec(tm[1]), ts: tm[1], text: tm[2].trim() });
            else if (!tldr) tldr = rl.replace(/^[-*•]\s*/, '');
            else pts.push({ s: null, ts: '', text: rl.replace(/^[-*•]\s*/, '') });
          }
          if (tldr || pts.length) parsed = { tldr, points: pts, source: res.model || 'Local AI' };
        }
      } catch (_) {}
    }
    if (!parsed) parsed = await buildLocalTranscriptSummary();
    summaryState = { loading: false, open: true, data: parsed, videoId: vid };
    if (parsed && SS_STORE.recordStudyTrace) {
      SS_STORE.recordStudyTrace({
        videoKey: vid,
        title: snapTitle,
        author: snapAuthor,
        site: snapSite,
        lang: snapLang,
        trackHash: snapHash,
        summary: parsed.tldr || (parsed.points || []).slice(0, 3).map((p) => p.text).join(' · '),
      }).catch(() => {});
    }
    if (tab !== 'lines') tab = 'lines';
    drawHead();
    drawList();
  };

  const renderSummaryCard = () => {
    const vid = curVidKey();
    if (!summaryState.open || summaryState.videoId !== vid) return null;
    const close = () => { summaryState.open = false; drawHead(); drawList(); };
    if (summaryState.loading) {
      return h('div', { class: 'ss-sum-card' },
        h('div', { class: 'ss-sum-hdr' },
          h('strong', {}, 'Summary'),
        h('button', { class: 'ss-qpill', onclick: close }, 'Close')),
        h('div', { style: { fontSize: '12px', opacity: '.72' } }, 'Reading the subtitles…'));
    }
    const d = summaryState.data;
    if (!d) return null;
    const asMarkdown = () => {
      const m = videoMeta();
      const head = `# ${m.title}\n\n${location.href.split('#')[0]}\n\n## Summary\n\n`;
      const body = (d.tldr ? `**TL;DR:** ${d.tldr}\n\n` : '')
        + (d.points || []).map((p) => `- ${p.ts ? `[${p.ts}] ` : ''}${p.text}`).join('\n') + '\n';
      return head + body;
    };
    return h('div', { class: 'ss-sum-card' },
      h('div', { class: 'ss-sum-hdr' },
        h('strong', {}, `Summary · ${d.source || 'Outline'}`),
        h('div', { style: { display: 'flex', gap: '4px' } },
          h('button', {
            class: 'ss-qpill',
            onclick: async (ev) => {
              try { await navigator.clipboard.writeText(asMarkdown()); ev.target.textContent = 'Copied'; setTimeout(() => { ev.target.textContent = 'Copy'; }, 1400); } catch (_) {}
            },
          }, 'Copy'),
          h('button', {
            class: 'ss-qpill',
            onclick: () => { const m = videoMeta(); if (downloadMdFile(m.sumFname, asMarkdown())) toast(`Saved ${m.sumFname}`); },
          }, 'Save .md'),
          h('button', { class: 'ss-qpill', 'aria-label': 'Close summary', onclick: close }, '×'))),
      d.tldr ? h('div', { class: 'ss-sum-tldr' }, d.tldr) : null,
      h('div', { class: 'ss-sum-pts' },
        ...(d.points || []).map((p) => h('div', { class: 'ss-sum-row' },
          p.ts ? h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); if (p.s != null) seek(p.s); } }, p.ts) : null,
          h('span', {}, p.text)))));
  };

  const renderTranscriptBar = () => {
    if (!V || !V.lines || !V.lines.length) return null;
    const withTime = S.set.copyWithTimes !== false;
    const m = videoMeta();
    const mdDoc = () => `# ${m.title}\n\n${location.href.split('#')[0]}${V.info && V.info.author ? ' · ' + V.info.author : ''}\n\n` + transcriptText(withTime) + '\n';
    return h('div', { class: 'ss-tx-bar' },
      h('button', {
        class: 'ss-qpill' + (withTime ? ' ss-teal' : ''),
        title: 'Include [m:ss] timestamps when copying or saving Markdown',
        onclick: () => { S.set.copyWithTimes = !withTime; save('set'); drawList(); },
      }, withTime ? 'Times: On' : 'Times: Off'),
      h('button', {
        class: 'ss-qpill',
        title: 'Download transcript as Markdown (.md)',
        onclick: () => {
          if (downloadMdFile(m.fname, mdDoc())) toast(`Saved ${m.fname}`);
          try { if (m.isBili) chrome.runtime.sendMessage({ op: 'libSaveText', path: 'bilibili/' + m.fname, text: mdDoc() }, () => {}); } catch (_) {}
        },
      }, 'Save .md'),
      h('button', {
        class: 'ss-qpill',
        title: 'Copy watched traces + replayed lines to paste into Ask Gemini / Claude / ChatGPT',
        onclick: async (ev) => {
          try {
            const digest = await buildAiStudyContextDigest();
            await navigator.clipboard.writeText(digest);
            ev.target.textContent = 'Study context copied';
            toast('Copied Study Traces — paste into Ask Gemini / Claude / ChatGPT');
            setTimeout(() => { if (ev.target) ev.target.textContent = 'Copy study context'; }, 1600);
          } catch (_) { toast('Copy failed'); }
        },
      }, 'Copy study context'));
  };

  const transcriptTool = () => {
    if (!V.lines.length) return h('button', {
      class: 'ss-qpill ss-teal',
      title: 'Generate subtitles from this video’s audio using Companion',
      onclick: () => runLocalASR(false),
    }, 'Generate subtitles');
    return h('button', {
      class: 'ss-qpill' + (summaryState.open && summaryState.videoId === curVidKey() ? ' ss-act' : ''),
      title: 'Get key points from the subtitles with links to the video',
      onclick: () => {
        if (tab !== 'lines') { tab = 'lines'; drawHead(); }
        generateTranscriptSummary();
      },
    }, 'Summarize video');
  };

  // Hide only the side panel (subtitles on the video stay on). A small tab on the right edge brings it back.
  let panelTab = null;
  const setPanelHidden = (hide) => {
    S.set.panelHidden = !!hide;
    save('set');
    applyVisualPrefs();
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  };
  const ensurePanelTab = () => {
    const want = !!S.set.on && !!V && !!S.set.panelHidden && !document.fullscreenElement;
    if (!want) { if (panelTab) { panelTab.remove(); panelTab = null; } return; }
    if (!panelTab || !panelTab.isConnected) {
      panelTab = h('button', { id: 'ss-panel-tab', title: 'Show the Phrasebound panel (H)', onclick: (e) => { e.stopPropagation(); setPanelHidden(false); } }, captionMark());
      document.body.append(panelTab);
    }
  };

  // Fullscreen side panel (LR-style): a top-right toggle inside the fullscreen element docks the panel on the right
  // and shrinks the video to the remaining width, so the transcript stays usable in fullscreen.
  let fsPanelBtn = null;
  const fsPanelOpen = () => !!(document.fullscreenElement && panel && S.set.on && panel.dataset.fsOpen === '1');
  const ensureFsPanelBtn = () => {
    const fs = document.fullscreenElement;
    if (!fs || !S.set.on || !V) { if (fsPanelBtn) { fsPanelBtn.remove(); fsPanelBtn = null; } return; }
    if (!fsPanelBtn || fsPanelBtn.parentElement !== fs) {
      if (fsPanelBtn) fsPanelBtn.remove();
      fsPanelBtn = h('button', {
        id: 'ss-fs-panel-btn',
        title: 'Show or hide the Phrasebound side panel in fullscreen',
        onclick: (e) => {
          e.stopPropagation();
          if (!panel) return;
          panel.dataset.fsOpen = panel.dataset.fsOpen === '1' ? '0' : '1';
          applyVisualPrefs();
          setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
        },
      }, captionMark(), h('span', { class: 'ss-fs-panel-label' }));
      fs.append(fsPanelBtn);
    }
    fsPanelBtn.querySelector('.ss-fs-panel-label').textContent = fsPanelOpen() ? 'Close panel' : 'Open panel';
    fsPanelBtn.classList.toggle('ss-on', fsPanelOpen());
  };

  const mountPanel = () => {
    if (!panel) return;
    const fsDock = fsPanelOpen();
    document.documentElement.classList.toggle('ss-fs-panel', fsDock);
    panel.classList.toggle('ss-fs-dock', fsDock);
    if (fsDock) {
      const pw = Math.round(Math.max(340, Math.min(window.innerWidth * 0.45, S.set.panelW || window.innerWidth * 0.3)));
      document.documentElement.style.setProperty('--ss-stage-w', pw + 'px');
    }
    ensureFsPanelBtn();
    const stageOn = isStageMode();
    const wasStage = document.documentElement.classList.contains('ss-stage');
    document.documentElement.classList.toggle('ss-stage', stageOn);

    if (stageOn) {
      // Panel width: the user's own (drag the left edge), else about a third of the window. Kept between 340 px and 60%.
      const pw = Math.round(Math.max(340, Math.min(window.innerWidth * 0.6, S.set.panelW || window.innerWidth * 0.33)));
      document.documentElement.style.setProperty('--ss-stage-w', pw + 'px');
      if (!panel.querySelector(':scope > .ss-resize-handle')) {
        const grip = document.createElement('div');
        grip.className = 'ss-resize-handle';
        grip.title = 'Drag to make the panel wider or narrower';
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          grip.setPointerCapture(e.pointerId);
          const move = (ev) => {
            const w = Math.round(Math.max(340, Math.min(window.innerWidth * 0.6, window.innerWidth - ev.clientX)));
            document.documentElement.style.setProperty('--ss-stage-w', w + 'px');
            S.set.panelW = w;
          };
          const up = () => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', up);
            save('set');
            window.dispatchEvent(new Event('resize'));
          };
          grip.addEventListener('pointermove', move);
          grip.addEventListener('pointerup', up);
        });
        panel.prepend(grip);
      }
      panel.classList.add('ss-docked-stage');
      panel.classList.remove('ss-docked-inline', 'ss-float');
      if (panel.parentElement !== document.body) document.body.append(panel);
    } else {
      panel.classList.remove('ss-docked-stage');
      const s = getActiveSite();
      const sec = s && s.inlineSidebar ? s.inlineSidebar() : null;
      const fsHost = document.fullscreenElement || document.body;
      if (sec && sec.offsetParent !== null && !document.fullscreenElement) {
        panel.classList.add('ss-docked-inline');
        panel.classList.remove('ss-float');
        if (panel.parentElement !== sec) sec.prepend(panel);
      } else {
        panel.classList.remove('ss-docked-inline');
        panel.classList.add('ss-float');
        if (panel.parentElement !== fsHost) fsHost.append(panel);
      }
    }
    if (wasStage !== stageOn) {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    }
  };

  let nativeHiddenState = false;
  const syncNativeCaptions = (shouldHide) => {
    const s = getActiveSite() || getHostSite();
    document.documentElement.classList.toggle('ss-hide-yt-cc', shouldHide);
    if (!s) return;
    if (shouldHide && !nativeHiddenState) {
      nativeHiddenState = true;
      if (s.nativeOff) s.nativeOff();
    } else if (!shouldHide && nativeHiddenState) {
      nativeHiddenState = false;
      if (s.nativeOn) s.nativeOn();
    }
  };

  const applyVisualPrefs = () => {
    const s = getActiveSite();
    const active = !!S.set.on && !!V;
    if (!active && dictOpen) closeDock();
    const shorts = isShortsPage();
    const bm = getBlurMode();
    document.documentElement.classList.toggle('ss-fullscreen-shelf', active && s?.id === 'yt' && !shorts && S.set.fullscreenShelf !== false);
    document.documentElement.setAttribute('data-ss-site', s ? s.id : '');
    document.documentElement.classList.toggle('ss-on', active);
    document.documentElement.classList.toggle('ss-shorts', active && shorts);
    document.documentElement.classList.toggle('ss-autohide-ytp', active && !!S.set.autoHideYtpBar);
    syncNativeCaptions(active && (bm === 'audio' || !!(ov?.isConnected && ov.childElementCount)));
    const fadeKnown = S.set.fadeKnownReadings !== false;
    document.documentElement.classList.toggle('ss-tc', active && !!S.set.toneColors);
    document.documentElement.classList.toggle('ss-gc', active && !!S.set.genderColors);
    document.documentElement.classList.toggle('ss-pos', active && S.set.posColors !== false);
    if (ov) {
      const targetHost = document.fullscreenElement || playerContainer();
      if (targetHost && ov.parentElement !== targetHost) targetHost.append(ov);
      ov.style.setProperty('--ss-scale', String(S.set.overlayScale || 1));
      ov.style.setProperty('--ss-bottom', String(shorts ? Math.max(20, S.set.subtitleBottomPct ?? S.set.overlayBottom ?? 24) : captionBottom()) + '%');
      const subSt = S.set.subStyle || {};
      const alpha = subSt.bgOpacity != null ? subSt.bgOpacity : (S.set.overlayBgOpacity != null ? S.set.overlayBgOpacity : 0.84);
      ov.style.setProperty('--ss-bg-alpha', String(alpha));
      const setOptVar = (prop, val) => {
        if (val) ov.style.setProperty(prop, String(val));
        else if (typeof ov.style.removeProperty === 'function') ov.style.removeProperty(prop);
      };
      setOptVar('--ss-orig-size', subSt.origSize ? String(subSt.origSize / 26) : '');
      setOptVar('--ss-orig-color', subSt.origColor || '');
      setOptVar('--ss-tr-size', subSt.trSize ? String(subSt.trSize / 19) : '');
      setOptVar('--ss-tr-color', subSt.trColor || '');
      ov.classList.toggle('ss-dim-known', !!S.set.dimKnown);
      ov.classList.toggle('ss-blur', bm === 'tr');
      ov.classList.toggle('ss-blur-both', bm === 'both');
      ov.classList.toggle('ss-audio-only', bm === 'audio');
      ov.classList.toggle('ss-hide-bundles', !!S.set.hideBundleUnderlines);
      ov.classList.toggle('ss-fade-known', fadeKnown);
    }
    if (panel) {
      panel.classList.toggle('ss-dim-known', !!S.set.dimKnown);
      panel.classList.toggle('ss-blur', bm === 'tr');
      panel.classList.toggle('ss-blur-both', bm === 'both');
      panel.classList.toggle('ss-fade-known', fadeKnown);
      panel.classList.toggle('ss-theme-light', S.set.darkTheme === false);
      if (!S.set.on) panel.style.display = 'none';
      else if (document.fullscreenElement && panel.dataset.fsOpen !== '1') panel.style.display = 'none';
      else if (!document.fullscreenElement && S.set.panelHidden) panel.style.display = 'none';
      else panel.style.display = '';
      mountPanel();
    }
    ensurePanelTab();
    if (hoverEl) hoverEl.classList.toggle('ss-theme-light', S.set.darkTheme === false);
    if (ytpBtn) {
      ytpBtn.classList.toggle('ss-on', !!S.set.on);
      ytpBtn.setAttribute('aria-pressed', String(!!S.set.on));
    }
    if (floatBtn) {
      floatBtn.classList.toggle('ss-on', !!S.set.on);
      floatBtn.setAttribute('aria-pressed', String(!!S.set.on));
    }
  };

  window.addEventListener('resize', () => { if (panel && V) applyVisualPrefs(); });
  document.addEventListener('fullscreenchange', () => {
    if (V) {
      ensurePlayerBtn();
      applyVisualPrefs();
      if (V.cur >= 0) drawLine(V.cur);
    }
  });

  const onToggleStudy = () => {
    // SS button while the panel is hidden: bring the panel back instead of switching everything off
    if (!document.fullscreenElement && S.set.on && S.set.panelHidden) { setPanelHidden(false); return; }
    if (document.fullscreenElement && S.set.on && panel) {
      if (panel.dataset.fsOpen !== '1') {
        panel.dataset.fsOpen = '1';
        applyVisualPrefs();
        return;
      }
      panel.dataset.fsOpen = '0';
    }
    S.set.on = !S.set.on;
    save('set');
    applyVisualPrefs();
    if (ov && !S.set.on) ov.textContent = '';
    else if (V && V.cur >= 0) drawLine(V.cur);
  };

  const ensurePlayerBtn = () => {
    const s = getActiveSite();
    if (!s) return;
    const rc = s.controlsTarget ? s.controlsTarget() : null;
    if (rc) {
      const controlClass = (s.id === 'bili' ? 'ss-bili-btn ' : 'ytp-button ') + 'ss-ytp-btn';
      if (floatBtn) { floatBtn.remove(); floatBtn = null; }
      if (!ytpBtn || !ytpBtn.isConnected || ytpBtn.parentElement !== rc) {
        if (ytpBtn) ytpBtn.remove();
        ytpBtn = h('button', {
          type: 'button',
          class: controlClass + (S.set.on ? ' ss-on' : ''),
          title: 'Phrasebound: subtitles and panel on/off',
          'aria-pressed': String(!!S.set.on),
          onclick: onToggleStudy,
        }, captionMark());
        rc.prepend(ytpBtn);
      }
      // Settings right beside the SS button, so it is easy to find (the panel's own ⚙ is small)
      if (!ytpGearBtn || !ytpGearBtn.isConnected || ytpGearBtn.parentElement !== rc) {
        if (ytpGearBtn) ytpGearBtn.remove();
        ytpGearBtn = h('button', {
          type: 'button',
          class: controlClass + ' ss-ytp-gear',
          title: 'Phrasebound settings',
          'aria-label': 'Phrasebound settings',
          onclick: (e) => { e.stopPropagation(); settingsOpen = true; drawSettings(); },
        }, h('span', { 'aria-hidden': 'true' }, '⚙︎'));
        if (ytpBtn.nextSibling !== undefined && rc.insertBefore) rc.insertBefore(ytpGearBtn, ytpBtn.nextSibling || null);
        else rc.append(ytpGearBtn);
      }
      return;
    }
    const fsHost = document.fullscreenElement || document.body;
    if (fsHost && (!floatBtn || !floatBtn.isConnected || floatBtn.parentElement !== fsHost)) {
      if (floatBtn) floatBtn.remove();
      floatBtn = h('button', {
        id: 'ss-float-toggle',
        type: 'button',
        class: S.set.on ? 'ss-on' : '',
        'aria-pressed': String(!!S.set.on),
        title: 'Phrasebound: subtitles and panel on/off',
        onclick: onToggleStudy,
      }, captionMark());
      fsHost.append(floatBtn);
    }
  };

  const ensureUI = () => {
    const mp = document.fullscreenElement || playerContainer();
    if (!mp) return false;
    ensurePlayerBtn();
    if (!ov || !ov.isConnected || ov.parentElement !== mp) {
      if (ov) ov.remove();
      ov = h('div', { id: 'ss-ov' });
      mp.append(ov);
    }
    if (!panel || !panel.isConnected) {
      headEl = h('div', { class: 'ss-h' });
      qbarEl = h('div', { class: 'ss-qbar' });
      dockEl = h('div', { id: 'ss-dict-dock', style: { display: 'none' } });
      tabsEl = h('div', { class: 'ss-tabs' });
      listEl = h('div', { id: 'ss-list' });
      const pauseFollow = () => { listFollowPausedUntil = Date.now() + 6000; };
      listEl.addEventListener('wheel', pauseFollow, { passive: true });
      listEl.addEventListener('touchmove', pauseFollow, { passive: true });
      panel = h('div', { id: 'ss-panel' }, headEl, qbarEl, dockEl, tabsEl, listEl,
        h('div', { class: 'ss-keys' }, 'A/S/D step · W play · B shield · L/[ ] loop · R save · H hide panel · right-click = Known'));
      mountPanel();
    }
    applyVisualPrefs();
    return true;
  };

  let liveState = {
    active: false, mode: '', stopRequested: false, progressTxt: '',
    domTimer: null, lastDomText: '', lastDomCommitted: '', lastDomChangeAt: 0,
    recorder: null, stream: null, rawAudioTracks: [], startWall: 0, analyzeAt: 0,
    trQueue: [], trBusy: false,
  };

  const stopLiveCaptions = () => {
    liveState.session = (liveState.session || 0) + 1;
    liveState.closeAudio?.();
    liveState.closeAudio = null;
    liveState.lastPair = null;
    liveState.pairShownAt = 0;
    clearTimeout(liveState.studyTimer);
    liveState.studyTimer = null;
    liveState.studyBusy = false;
    liveState.recognizing = false;
    liveState.lastSpeechAt = 0;
    liveState.trBusy = false;
    liveState.stopRequested = true;
    liveState.active = false;
    liveState.mode = '';
    liveState.progressTxt = '';
    liveState.trQueue = [];
    if (liveState.domTimer) { clearInterval(liveState.domTimer); liveState.domTimer = null; }
    try { if (liveState.recorder && liveState.recorder.state !== 'inactive') liveState.recorder.stop(); } catch (e) {}
    liveState.recorder = null;
    try {
      if (liveState.stream) {
        for (const tr of liveState.stream.getTracks()) tr.stop();
      }
      if (Array.isArray(liveState.rawAudioTracks)) {
        for (const tr of liveState.rawAudioTracks) tr.stop();
      }
    } catch (e) {}
    liveState.stream = null;
    liveState.rawAudioTracks = [];
  };

  const isLiveContext = () => {
    const s = getActiveSite();
    if (!s) return false;
    if (V && V.info && V.info.isLive) return true;
    if (typeof s.isLive === 'function') return !!s.isLive(location);
    return !!(s.features && s.features.live);
  };

  const teardown = () => {
    closeDock();
    dockEl?.remove();
    V?.frameWatch?.stop();
    stopLiveCaptions();
    syncNativeCaptions(false);
    document.documentElement.classList.remove('ss-on', 'ss-hide-yt-cc', 'ss-stage', 'ss-shorts', 'ss-autohide-ytp');
    document.documentElement.setAttribute('data-ss-site', '');
    if (ov) ov.remove();
    if (panel) panel.remove();
    if (modalBack) modalBack.remove();
    if (floatBtn) floatBtn.remove();
    if (fsPanelBtn) fsPanelBtn.remove(); if (panelTab) { panelTab.remove(); panelTab = null; }
    document.documentElement.classList.remove('ss-fs-panel');
    ov = panel = qbarEl = modalBack = floatBtn = fsPanelBtn = null;
    settingsOpen = false;
    V = null;
    asrState.active = false;
  };

  // ---- Word & FE span rendering (supports Romaji, Hiragana, Pinyin, Jyutping ruby & 5-language FE links) ----
  const wKey = (lemma) => normLangCode(V ? V.lang : 'en') + '|' + lemma;
  const wordStatusOf = (lemma) => {
    const k = wKey(lemma);
    if (S.words[k]) return S.words[k];
    const leg = (V ? (V.lang || 'en').split('-')[0].toLowerCase() : 'en') + '|' + lemma;
    return S.words[leg] || '';
  };

  const curVocabLevel = (langOverride = '') => {
    const lg = langOverride || (V && V.lang) || 'en';
    if (SS_STORE && typeof SS_STORE.getLangVocabLevel === 'function') {
      return SS_STORE.getLangVocabLevel(S && S.set, lg);
    }
    return (S && S.set && S.set.vocabLevel) || 2000;
  };

  let _implicitSaveTimer = 0;
  const pendingVocabLevels = Object.create(null);
  const recordImplicitVocabSignal = (wordRank, understood, cue) => {
    if (!S || !S.set || S.set.autoCalibrateLevel === false || !V || !V.lang || !wordRank || !cue) return;
    if (!SS_STORE || typeof SS_STORE.updateImplicitLevel !== 'function') return;
    if (!V._comprehensionSignals) V._comprehensionSignals = new WeakMap();
    const prior = V._comprehensionSignals.get(cue);
    if (prior === false || prior === understood) return;
    V._comprehensionSignals.set(cue, understood);
    const lg = normLangCode(V.lang);
    const cur = curVocabLevel(lg);
    const next = SS_STORE.updateImplicitLevel(cur, wordRank, understood);
    if (next === cur) return;
    S.set.vocabLevelsByLang = Object.assign({}, S.set.vocabLevelsByLang || {}, { [lg]: next });
    pendingVocabLevels[lg] = next;
    if (_implicitSaveTimer) return;
    _implicitSaveTimer = setTimeout(() => {
      _implicitSaveTimer = 0;
      chrome.storage.local.get('ss_set', (data) => {
        const current = data.ss_set || {};
        const levels = Object.assign({}, current.vocabLevelsByLang || {}, pendingVocabLevels);
        for (const lang of Object.keys(pendingVocabLevels)) delete pendingVocabLevels[lang];
        if (current.autoCalibrateLevel !== false) {
          SS_STORE.saveKey('set', Object.assign({}, current, { vocabLevelsByLang: levels }));
        }
      });
    }, 12000);
  };

  const maxRankInLine = (ln, maxCap = Infinity) => {
    if (!ln || !ln.t || !V || !V.ranks || !V.L) return 0;
    let best = 0;
    for (const tk of V.L.split(ln.t)) {
      if (!tk || !tk.word) continue;
      const low = tk.w.toLowerCase();
      const lem = V.L.lemma ? V.L.lemma(tk.w) : low;
      const r = V.ranks[low] || V.ranks[lem] || 0;
      if (r > best && r <= maxCap) best = r;
    }
    return best;
  };

  const _sessionReviewedIds = new Set();
  const findDueSavedItemInLine = (ln) => {
    if (!S || !S.set || S.set.incidentalFsrs === false || !ln || !ln.t || !Array.isArray(S.items) || !S.items.length) return null;
    if (!SS_STORE || typeof SS_STORE.fsrsRetrievability !== 'function') return null;
    const lowLine = ln.t.toLowerCase();
    const curLg = V && V.lang ? normLangCode(V.lang) : '';
    const now = Date.now();
    for (const it of S.items) {
      if (!it || !it.id || _sessionReviewedIds.has(it.id)) continue;
      if (curLg && it.lang && normLangCode(it.lang) !== curLg) continue;
      const target = String(it.surface || it.word || '').trim().toLowerCase();
      if (target.length < 2) continue;
      if (!SS_STORE.containsStudyTerm(lowLine, target)) continue;
      if (SS_STORE.isRecallDue(it, S.set.fsrsRetention || 0.9, now)) return it;
    }
    return null;
  };

  // Cached fe_zh chengyu lookup (display + Traditional/Simplified keys -> { display, reading, glossEn, glossZh })
  let zhChengyuMap = null;
  const ensureZhChengyuMap = async () => {
    if (zhChengyuMap) return zhChengyuMap;
    const fj = await loadData('fe_zh.json');
    if (!fj || !Array.isArray(fj.items)) return null;
    const m = new Map();
    for (const row of fj.items) {
      const [disp, , pri, rd, gEn, gZh, keys] = row;
      if (!disp) continue;
      const entry = { display: disp, pri: pri || 0, reading: rd || '', glossEn: gEn || '', glossZh: gZh || '' };
      const put = (k) => {
        if (!k) return;
        const prev = m.get(k);
        if (!prev || ((!prev.glossEn && !prev.glossZh) && (entry.glossEn || entry.glossZh)) || (entry.pri > prev.pri && (entry.glossEn || entry.glossZh))) {
          m.set(k, entry);
        }
      };
      put(disp);
      for (const k of keys || []) put(k);
    }
    zhChengyuMap = m;
    return m;
  };

  const lookupZhChengyu = (rawVal) => {
    if (!zhChengyuMap || !rawVal) return null;
    const cands = (Array.isArray(rawVal) ? rawVal : [rawVal])
      .flatMap((x) => String(x || '').split(/[；;、,/]/))
      .map((s) => s.trim())
      .filter(Boolean);
    let fallbackHit = null;
    for (const c of cands) {
      const hit = zhChengyuMap.get(c);
      if (hit) {
        if (hit.glossEn || hit.glossZh) return hit;
        if (!fallbackHit) fallbackHit = hit;
      }
    }
    return fallbackHit;
  };

  const _nxnSidecarMiss = new Set();
  const loadNxnSidecar = async (srcLang, uiLang) => {
    const s = normLangCode(srcLang);
    const u = normLangCode(uiLang);
    if (!s || !u || s === u) return null;
    const fn = `gloss_${s}_${u}.json`;
    if (_nxnSidecarMiss.has(fn)) return null;
    const d = await loadData(fn);
    if (!d) _nxnSidecarMiss.add(fn);
    return d;
  };

  const bestFeMeaning = (fe, targetLang) => {
    if (!fe) return '';
    const tlRaw = targetLang || S.set.tl || 'en';
    const tl = normLangCode(tlRaw);
    if (fe._mtGloss && fe._mtGloss[tl]) return fe._mtGloss[tl];
    const zEq = fe._zhEq || (fe.eq && fe.eq.zh ? lookupZhChengyu(fe.eq.zh) : null);
    if (window.SS_IDIOMS && typeof SS_IDIOMS.resolveFeGloss === 'function') {
      const sidecar = V && V._nxnSidecars ? V._nxnSidecars[tl] : null;
      const res = SS_IDIOMS.resolveFeGloss(fe, tlRaw, {
        sidecar,
        enGlossMap: V && V._enGloss,
        zhEq: zEq,
      });
      if (res && res.text) return res.text;
    }
    const zEn = (zEq && zEq.glossEn) || '';
    const zZh = (zEq && zEq.glossZh) || '';
    if (tl === 'zh' || tl === 'yue') return fe.glossZh || zZh || fe.gloss || zEn || fe.defJa || fe.defKo || '';
    if (tl === 'ko') return fe.defKo || fe.gloss || zEn || fe.glossZh || zZh || '';
    if (tl === 'ja') return fe.defJa || fe.gloss || zEn || fe.glossZh || zZh || '';
    return fe.gloss || zEn || fe.glossZh || zZh || fe.defKo || fe.defJa || '';
  };

  // On-demand local companion N×N gloss localizer for top video FEs when prebuilt sidecar isn't on disk yet
  const maybeLocalizeTargetFeGlosses = async (myRun) => {
    if (!V || !V.analysis || !companionHealth || !companionHealth.ok) return;
    const tlRaw = S.set.tl || 'en';
    const tl = normLangCode(tlRaw);
    const srcNorm = normLangCode(V.lang);
    if (!tl || tl === srcNorm) return;
    const sidecar = V._nxnSidecars && V._nxnSidecars[tl];
    const pending = [];
    for (const fe of (V.analysis.allFEs || []).slice(0, 14)) {
      if (fe._mtGloss && fe._mtGloss[tl]) continue;
      const zEq = fe._zhEq || (fe.eq && fe.eq.zh ? lookupZhChengyu(fe.eq.zh) : null);
      const res = SS_IDIOMS.resolveFeGloss(fe, tlRaw, { sidecar, enGlossMap: V._enGloss, zhEq: zEq });
      if (res && res.needsMt && res.text) {
        pending.push({ fe, srcText: res.text });
      }
    }
    if (!pending.length) return;
    const r = await comp('/translate', {
      lines: pending.map((p, idx) => ({ s: idx, d: 1, t: p.srcText })),
      target_lang: tlRaw,
      merge_clauses: false,
      use_history: false,
      model: S.set.mtModel || undefined,
      device: S.set.mtDevice || undefined,
    }, 15000);
    if (myRun !== run || !V || !r || !r.ok || !Array.isArray(r.translations)) return;
    let updated = false;
    pending.forEach((p, idx) => {
      const tr = String(r.translations[idx] || '').trim();
      if (tr) {
        p.fe._mtGloss = p.fe._mtGloss || {};
        p.fe._mtGloss[tl] = tr;
        updated = true;
      }
    });
    if (updated && tab === 'glossary') drawList();
  };

  const setFeGroupHover = (gid, on) => {
    if (!gid) return;
    document.querySelectorAll(`[data-fe-gid="${gid}"]`).forEach((el) => el.classList.toggle('ss-fe-hi', on));
  };

  const getReadingAidMode = () => S.set.readingAid || (S.set.showRuby === false ? 'off' : 'romaji');

  const pickTokenReading = (r, mode) => {
    if (!r || mode === 'off') return '';
    const hasCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(r.orig || '');
    if (!hasCjk) return '';
    const RD = window.SS_READINGS;
    const showPitch = S.set.showPitchAccent !== false;
    const pitchOut = (val) => (RD && RD.applyPitchPref ? RD.applyPitchPref(val, showPitch) : val);
    const normTrack = normLangCode(V && V.lang);
    const isJa = normTrack === 'ja';
    if (mode === 'romaji_latin' || mode === 'hepburn') {
      const rom = r.romaji || '';
      return rom && rom.toLowerCase() !== (r.orig || '').toLowerCase() ? rom : '';
    }
    if (mode === 'hira' || (isJa && (mode === 'romaji' || mode === 'auto'))) {
      // Japanese words come with per-kanji parts (思|おも い 出|だ して) so furigana sits over the kanji only
      // Pitch mark (はしꜜ 橋 / はꜜし 箸 / はし‾ 端) only on words with a homophone that differs by pitch (furiPitch)
      if (r.hasKanji && Array.isArray(r.furiPitch) && r.furiPitch.length) return pitchOut(r.furiPitch);
      if (r.hasKanji && Array.isArray(r.furi) && r.furi.length && r.furi.some((p) => p[1])) return pitchOut(r.furi);
      return (r.hasKanji && r.hira && r.hira !== r.orig) ? pitchOut(r.hira) : '';
    }
    if (mode === 'zhuyin') {
      if (!r.hasKanji && !/[\u3400-\u9fff]/.test(r.orig || '')) return '';
      return r.zhuyin || (RD && RD.pinyinToZhuyin ? RD.pinyinToZhuyin(r.pinyin || '') : '');
    }
    if (mode === 'jyutping') return (r.hasKanji || /[\u3400-\u9fff]/.test(r.orig || '')) ? (r.jyutping || r.cantonese || r.canto || '') : '';
    if (mode === 'pinyin') return (r.hasKanji || /[\u3400-\u9fff]/.test(r.orig || '')) ? (r.pinyin || '') : '';
    if (mode === 'hanja') return r.hanja || '';
    if (mode === 'pron') return r.pron || '';
    // Romaji / Auto mode: use Jyutping first on Cantonese tracks, else Romaji / Pinyin
    const isYue = normTrack === 'yue';
    const rom = isYue
      ? (r.jyutping || r.cantonese || r.canto || r.pinyin || r.romaji || '')
      : (r.romaji || r.jyutping || r.pinyin || '');
    const out = rom && rom.toLowerCase() !== (r.orig || '').toLowerCase() ? rom : '';
    return out ? pitchOut(out) : '';
  };

  // ---- Dictionaries: every source at once (cached), and a small peek on hover ----
  const dictCache = new Map();
  const defineAll = (words, noOnline = false, packsOnly = false) => {
    const ck = [packsOnly ? 'p' : (noOnline ? 1 : 0), V.lang, S.set.tl || ''].concat(words).join('|');
    if (dictCache.has(ck)) return dictCache.get(ck);
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ op: 'defineAll', words, lang: V.lang, tl: S.set.tl || 'en', noOnline, packsOnly }, (r) => resolve(r || null));
      } catch (e) { resolve(null); }
    });
    p.then((r) => { if (!r || !r.ok) dictCache.delete(ck); });
    dictCache.set(ck, p);
    if (dictCache.size > 300) dictCache.delete(dictCache.keys().next().value);
    return p;
  };
  // Idle pre-warm of local dictionary cache for upcoming subtitle lines (LR_NOTES §8.6: 0ms hover/click lookup)
  let prefetchBusy = false;
  const prefetchUpcomingDicts = (startLi) => {
    if (prefetchBusy || !V || !V.lines || !companionHealth || !companionHealth.ok) return;
    prefetchBusy = true;
    const wordsToWarm = [];
    const seen = new Set();
    const hi = Math.min(V.lines.length, Math.max(0, startLi) + 10);
    for (let i = Math.max(0, startLi); i < hi && wordsToWarm.length < 18; i++) {
      const toks = (V.analysis && V.analysis.lineTokens[i]) || V.L.split(V.lines[i].t || '');
      for (const tk of toks) {
        if (!tk.word) continue;
        const lem = V.L.lemma(tk.w);
        if (seen.has(lem)) continue;
        seen.add(lem);
        const ck = [1, V.lang, S.set.tl || '', lem, tk.w.toLowerCase(), tk.w].join('|');
        if (!dictCache.has(ck)) wordsToWarm.push([lem, tk.w.toLowerCase(), tk.w]);
        if (wordsToWarm.length >= 18) break;
      }
    }
    (async () => {
      for (const ws of wordsToWarm) {
        if (!V) break;
        await defineAll([...new Set(ws.filter(Boolean))], true);
      }
    })().finally(() => { prefetchBusy = false; });
  };

  let hoverEl = null, hoverTimer = 0, hoverFor = null;
  const hidePeek = () => { clearTimeout(hoverTimer); hoverFor = null; if (hoverEl) hoverEl.style.display = 'none'; };
  const showPeek = (span, word, lemma, line, feMatch, charPos, reading) => {
    if (S.set.hoverPeek === false || dictOpen) return;
    clearTimeout(hoverTimer);
    hoverFor = span;
    const view = V;
    hoverTimer = setTimeout(async () => {
      if (hoverFor !== span || V !== view || !span.isConnected) return;
      const feAgg = feMatch && view.analysis?.allFEs?.find(item => item.pattern === feMatch.pattern);
      const literal = Boolean(feMatch && (feMatch.stage2Literal || view.pieMap?.[feMatch.pattern]?.usage === 'literal'));
      const phraseGloss = literal ? '' : bestFeMeaning(feAgg || feMatch);
      const tries = [...new Set([feMatch?.display, lemma, word.toLowerCase(), word].filter(Boolean))];
      const result = await defineAll(tries, true, true);
      if (hoverFor !== span || V !== view || !span.isConnected || dictOpen) return;
      const sources = result?.sources || [];
      const source = sources.find(item => item.id === S.set.dictSrc && item.entries?.length) || sources.find(item => item.entries?.length);
      const entry = source?.entries[0];
      const payload = cueExplainPayload(word, lemma, line, feMatch);
      const contextual = sceneGlossCache.get(cueExplainCacheKey(payload))?.word_gloss ||
        cueSceneSense(word, line, feMatch, charPos, normLangCode(view.lang)).sceneSense;
      const meanings = contextual ? [contextual] : phraseGloss ? [phraseGloss] : (entry?.defs || []).slice(0, 3);
      if (!meanings.length) return;
      const inlineReading = Array.isArray(reading) ? reading.map(([text, pronunciation]) => pronunciation || text).join('') : reading;
      const pronunciation = feAgg?.reading || feMatch?.reading || entry?.reading || inlineReading;
      const head = feMatch?.display || entry?.head || word;
      if (!hoverEl) hoverEl = h('div', { class: 'ss-peek', role: 'tooltip' });
      hoverEl.classList.toggle('ss-theme-light', S.set.darkTheme === false);
      const host = document.fullscreenElement || document.body;
      if (hoverEl.parentNode !== host) host.appendChild(hoverEl);
      hoverEl.textContent = '';
      appendClean(hoverEl,
        h('div', { class: 'ss-peek-h' }, h('b', {}, head), pronunciation && pronunciation !== head ? h('span', { class: 'ss-peek-r' }, pronunciation) : null),
        ...meanings.map(meaning => h('div', { class: 'ss-peek-meaning' }, meaning.slice(0, 200))),
        h('div', { class: 'ss-peek-s' }, contextual ? 'Meaning in this line' : phraseGloss ?
          (feMatch?.native || feMatch?.layer || feMatch?.type || 'Expression') : (source?.name || 'Dictionary')));
      const r = span.getBoundingClientRect();
      hoverEl.style.display = 'block';
      const pw = hoverEl.offsetWidth, ph = hoverEl.offsetHeight;
      hoverEl.style.left = Math.max(6, Math.min(innerWidth - pw - 6, r.left + r.width / 2 - pw / 2)) + 'px';
      const top = r.top - ph - 8 > 6 ? r.top - ph - 8 : r.bottom + 8;
      hoverEl.style.top = Math.max(6, Math.min(innerHeight - ph - 6, top)) + 'px';
    }, 250);
  };

  const feBucketClass = (feMatch) => {
    if (!feMatch) return '';
    const b = feMatch.bucket || (SS_IDIOMS.classifyLayer ? SS_IDIOMS.classifyLayer(feMatch.layer, feMatch.type) : 'idiom');
    const lr = feMatch.litRisk && !feMatch.deceptive ? ' ss-fe-litrisk' : '';
    if (b === 'frame') return ' ss-fe-frame' + lr;
    if (b === 'colloc') return ' ss-fe-colloc' + lr;
    return lr;
  };

  // Noun gender hints from gender_<lang>.json (Kaikki/en.wiktionary). Spans get ss-g-m/f/n; colour shows only with the
  // "Noun gender colours" switch (html.ss-gc). Tier-2 words (also a common verb/adjective form: fr "porte", "est") are
  // marked only right after an article/determiner; German tier-2 only when not sentence-initial. A gendered article
  // that disagrees with the stored gender ("le livre" vs livre f "pound") suppresses the mark.
  const GENDER_LANGS = new Set(['de', 'fr', 'es', 'pt', 'it', 'ru']);
  const DET_WORDS = {
    fr: { m: 'le un ce cet mon ton son du au', f: 'la une cette ma ta sa',
      x: "l' les des aux mes tes ses nos vos leur leurs chaque quel quelle quels quelles" },
    es: { m: 'el un este ese aquel del al ningún algún nuestro vuestro los unos estos esos aquellos nuestros vuestros',
      f: 'la una esta esa aquella ninguna alguna nuestra vuestra las unas estas esas aquellas nuestras vuestras',
      x: 'mi mis tu tus su sus cada' },
    pt: { m: 'o um este esse aquele do no ao pelo meu teu seu nosso vosso os uns estes esses aqueles dos aos pelos meus teus seus nossos',
      f: 'a uma esta essa aquela da na à pela minha tua sua nossa vossa as umas estas essas aquelas das nas às pelas minhas tuas suas nossas',
      x: 'cada' },
    it: { m: 'il lo un uno del dello al allo nel nello sul dal questo quel quello mio tuo suo nostro vostro i gli dei degli ai agli nei negli dai questi quei quegli miei tuoi suoi nostri vostri',
      f: 'la una della alla nella sulla dalla questa quella mia tua sua nostra vostra le delle alle nelle dalle queste quelle mie tue sue nostre vostre',
      x: "l' un' dell' all' nell' dall' sull' quest' quell' ogni" },
  };
  // "je la porte" / "yo la veo": le/la/lo after a subject pronoun or negation is an object clitic, not an article
  const CLITIC = {
    fr: { obj: "le la les l'", before: "je j' tu il elle on nous vous ils elles ne n' qui que qu' me m' te t' se s'" },
    es: { obj: 'lo la los las', before: 'yo tú él ella usted nosotros nosotras ellos ellas ustedes no que se me te ya nunca' },
    it: { obj: "lo la li le l'", before: 'io tu lui lei noi voi loro non che mi ti si ci vi' },
    pt: { obj: 'o a os as', before: 'eu tu ele ela você nós eles elas vocês não que se me te' },
  };
  for (const c of Object.values(CLITIC)) { c.obj = new Set(c.obj.split(' ')); c.before = new Set(c.before.split(' ')); }
  const DET_MAPS = {};
  for (const [lc, d] of Object.entries(DET_WORDS)) {
    DET_MAPS[lc] = new Map();
    for (const g of ['x', 'm', 'f']) for (const w of d[g].split(' ')) DET_MAPS[lc].set(w, g);
  }
  const genderOf = (w, prev, sentStart, prev2 = '') => {
    const G = V && V._gender;
    if (!G) return '';
    const lc = G.lang;
    let key = lc === 'de' ? w : w.toLowerCase().replace(/’/g, "'");
    let p = prev;
    const ap = key.lastIndexOf("'");
    if (ap > 0 && lc !== 'de') { p = key.slice(0, ap + 1); key = key.slice(ap + 1); }   // l'homme, dell'acqua
    let g = G.map.get(key);
    if (!g) return '';
    const D = DET_MAPS[lc];
    let dg = D && p ? D.get(p) : undefined;
    const cl = CLITIC[lc];
    if (dg && cl && p === prev && cl.obj.has(p) && cl.before.has(prev2)) return '';
    // names: a capitalised word inside a sentence with no article in front (avec Marie, con Pedro) is left alone
    if (lc !== 'de' && !sentStart && !dg && w[0] !== w[0].toLowerCase()) return '';
    if (g.length > 1) {
      if (lc === 'de' ? sentStart : !dg) return '';
      g = g[0];
    }
    if ((dg === 'm' || dg === 'f') && g !== dg) return '';
    return g;
  };

  const buildRtNode = (rtText, modeHint = '', explicitTones = null) => {
    const txt = String(rtText || '');
    if (!txt) return h('rt', {}, '');
    const RD = window.SS_READINGS;
    if (S.set.toneColors && RD && RD.inferReadingScheme && RD.tokenizeReadingTones) {
      const isYue = normLangCode(V && V.lang) === 'yue';
      const scheme = RD.inferReadingScheme(txt, modeHint, isYue);
      const toned = scheme ? RD.tokenizeReadingTones(txt, scheme, explicitTones) : null;
      if (toned) {
        return h('rt', { class: 'ss-rt-toned' }, ...toned.map((p) => (p.cls ? h('span', { class: p.cls }, p.text) : p.text)));
      }
    }
    if (S.set.showPitchAccent !== false && /[ꜜ‾]/.test(txt)) {
      const segs = txt.split(/([ꜜ‾])/).filter(Boolean);
      return h('rt', {}, ...segs.map((sg) => (sg === 'ꜜ' || sg === '‾' ? h('span', { class: 'ss-pitch-mark' }, sg) : sg)));
    }
    return h('rt', {}, txt);
  };

  const makeWordSpan = (word, lem, ln, feMatch, feGid = '', isFeAnchor = false, rubyReading = '', charPos = null, li = -1, displayWord = '', explicitTones = null) => {
    const shownWord = displayWord || word;
    const st = wordStatusOf(lem);
    const rank = V.ranks ? (Math.min(V.ranks[word.toLowerCase()] || 99999, V.ranks[lem] || 99999)) : 0;
    const contraction = /['’]/.test(word);
    // Bands: unlocked for any language with V.ranks loaded (English + CJK rank tables).
    const fit = V.analysis && V.analysis.fit;
    const lvl = curVocabLevel();
    const isName = !!(fit && fit.names.includes(word.toLowerCase()));
    const above = !!fit && !!V.ranks && !st && !isName && !contraction && rank > lvl;
    const isRare = above && rank > fit.learnCut;
    const isNext = above && !isRare;
    const freqBand = (S.set.freqUnderlines !== false && V.ranks && !st && !isName && !contraction && !feMatch && SS_IDIOMS.classifyFreqBand)
      ? SS_IDIOMS.classifyFreqBand(rank, lvl)
      : 'core';
    const freqCls = freqBand === 'b2k_8k' ? ' ss-freq-mid' : freqBand === 'b8k_20k' ? ' ss-freq-low' : '';
    const frequency = S.set.personalFrequency && S.set.idiomHistory !== false && feMatch && V.sceneFrequency?.get(feMatch.pattern);
    const bucketCls = feBucketClass(feMatch) + (frequency && isFeAnchor && frequency[0] > 1
      ? (frequency[0] >= 4 && frequency[1] >= 2 ? ' ss-repeat-high' : ' ss-repeat-mid') : '');
    const feCls = feMatch
      ? (isFeAnchor ? (' ss-fe-anchor' + (feMatch.deceptive ? ' ss-fe-deceptive' : '') + bucketCls) : (' ss-fe-slot' + bucketCls))
      : '';
    const modeHint = getReadingAidMode();
    const inner = Array.isArray(rubyReading)
      ? h('ruby', { class: 'ss-ruby ss-furi' }, ...rubyReading.flatMap((p) => [p[0], buildRtNode(p[1] || '', modeHint)]))
      : rubyReading && rubyReading.toLowerCase() !== word.toLowerCase()
        ? h('ruby', { class: 'ss-ruby' }, shownWord, buildRtNode(rubyReading, modeHint, explicitTones))
        : shownWord;

    return h('span', {
      class: 'ss-w' + (st ? ' ss-' + st : '') + (isRare ? ' ss-rare' : '') + (isNext ? ' ss-next' : '') + freqCls + feCls,
      'data-l': lem,
      'data-orig': shownWord !== word ? word : null,
      'data-li': li >= 0 ? String(li) : null,
      'data-c0': charPos ? String(charPos[0]) : null,
      'data-c1': charPos ? String(charPos[1]) : null,
      'data-fe-gid': feGid || null,
      title: feMatch ? `[${feMatch.native || feMatch.layer || feMatch.type}] ${feMatch.display}${feMatch.deceptive ? ' (easy to misread)' : ''}` : null,
      onmouseenter: (e) => { if (feGid) setFeGroupHover(feGid, true); showPeek(e.currentTarget, word, lem, ln, feMatch, charPos, rubyReading); },
      onmouseleave: () => { if (feGid) setFeGroupHover(feGid, false); hidePeek(); },
      onclick: (e) => {
        e.stopPropagation();
        hidePeek();
        // LR Pro power move: Shift+Click selects a multi-word span across adjacent words in the same line!
        if (e.shiftKey && lastWordClick && lastWordClick.li === li && charPos && ln && ln.t) {
          const s0 = Math.min(lastWordClick.c0, charPos[0]);
          const s1 = Math.max(lastWordClick.c1, charPos[1]);
          const phrase = ln.t.slice(s0, s1).trim();
          if (phrase && phrase.length >= 2) {
            document.querySelectorAll('.ss-w.ss-sel-range').forEach((el) => el.classList.remove('ss-sel-range'));
            document.querySelectorAll(`.ss-w[data-li="${li}"]`).forEach((el) => {
              const c0 = Number(el.getAttribute('data-c0')), c1 = Number(el.getAttribute('data-c1'));
              if (c0 < s1 && c1 > s0) el.classList.add('ss-sel-range');
            });
            if (S.set.speakOnClick) speakWord(phrase, V.lang);
            openDock(phrase, phrase.toLowerCase(), ln, null, true);
            return;
          }
        }
        document.querySelectorAll('.ss-w.ss-sel-range').forEach((el) => el.classList.remove('ss-sel-range'));
        if (charPos && li >= 0) lastWordClick = { li, c0: charPos[0], c1: charPos[1] };
        if (S.set.speakOnClick) speakWord(feMatch ? feMatch.surface : word, V.lang);
        const clickAct = S.set.wordClickAction || 'open_pause';
        if (clickAct === 'mark_speak') {
          cycleWordMark(lem, word, ln);
          if (!S.set.speakOnClick) speakWord(word, V.lang);
          return;
        }
        logEv('clickLookup', { word, lem, fe: feMatch ? feMatch.pattern : null });
        recordImplicitVocabSignal(rank, false, ln);
        openDock(word, lem, ln, feMatch, false, clickAct === 'open_play', charPos, rubyReading);
      },
      oncontextmenu: (e) => {
        e.preventDefault();
        e.stopPropagation();
        cycleWordMark(lem, word, ln);
      },
    }, inner);
  };

  // Character-offset FE anchor resolver (Task 5):
  //   - Collects exact anchor character intervals [a0, a1) for each match (好似…噉 -> 好似 & 噉; 喺…度 -> 喺 & 度).
  //   - Splits any token that straddles an anchor boundary so open-slot gap characters NEVER inherit anchor underlines.
  const buildCharFeInfo = (li, ln, isOverlay) => {
    const prof = getProfile();
    const matches = (prof.enhanceFE && V.analysis && V.analysis.lineMatches[li]) || [];
    if (!matches.length) return { cutPoints: [], resolveAnchor: () => null };
    const cuts = new Set();
    const anchorList = [];
    matches.forEach((m, mIdx) => {
      const c0 = m.charStart != null ? m.charStart : ln.t.indexOf(m.surface);
      const c1 = m.charEnd != null ? m.charEnd : (c0 >= 0 ? c0 + m.surface.length : -1);
      if (c0 < 0 || c1 <= c0) return;
      const gid = `${isOverlay ? 'o' : 'p'}_${li}_${mIdx}`;
      const ranges = m.anchorRanges && m.anchorRanges.length ? m.anchorRanges : [[c0, c1]];
      for (const [a0, a1] of ranges) {
        if (a1 > a0) {
          cuts.add(a0);
          cuts.add(a1);
          anchorList.push({ a0, a1, m, gid });
        }
      }
    });
    const cutPoints = [...cuts].sort((a, b) => a - b);
    const resolveAnchor = (t0, t1) => {
      for (const a of anchorList) {
        if (t0 >= a.a0 && t1 <= a.a1) return { m: a.m, gid: a.gid };
      }
      return null;
    };
    return { cutPoints, resolveAnchor };
  };

  const sliceByCuts = (str, c0, cutPoints) => {
    const c1 = c0 + str.length;
    const pts = [c0];
    for (const p of cutPoints) if (p > c0 && p < c1) pts.push(p);
    pts.push(c1);
    if (pts.length === 2) return [[str, c0, c1]];
    const pieces = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const s0 = pts[k], s1 = pts[k + 1];
      pieces.push([str.slice(s0 - c0, s1 - c0), s0, s1]);
    }
    return pieces;
  };

  // CJK lines: tag the language (right glyph forms, proportional kana) and drop the per-word padding,
  // which reads as spaces between words in Japanese and Chinese.
  const wrapLineToks = (frag, ln) => {
    const raw = String((ln && ln.lineLang) || (V && V.lang) || '');
    const base = normLangCode(raw);
    if (!['ja', 'zh', 'yue', 'ko'].includes(base)) return frag;
    const tag = base === 'ja' ? 'ja' : base === 'ko' ? 'ko' : base === 'yue' ? 'zh-HK' : (/hant|tw|hk|mo/i.test(raw) ? 'zh-Hant' : 'zh-Hans');
    return h('span', { class: 'ss-toks ss-cjk', lang: tag }, frag);
  };

  const renderLineTokens = (li, ln, isOverlay) => wrapLineToks(renderLineTokensRaw(li, ln, isOverlay), ln);
  // Cut a furigana list ([[text, kana], ...]) down to characters [start, start+len) of its word, for when an
  // idiom anchor splits the word. A kanji run's kana stays with the piece holding its first character.
  const sliceFuri = (furi, start, len) => {
    const out = [];
    let pos = 0;
    for (const [txt, kana] of furi) {
      const chars = Array.from(txt);
      const a = Math.max(start, pos), b = Math.min(start + len, pos + chars.length);
      if (a < b) out.push([chars.slice(a - pos, b - pos).join(''), a === pos ? (kana || '') : '']);
      pos += chars.length;
    }
    return out.some((x) => x[1]) ? out : '';
  };

  const renderLineTokensRaw = (li, ln, isOverlay) => {
    const L = V.L;
    const frag = document.createDocumentFragment();
    const mode = getReadingAidMode();
    const ann = V.annotations && V.annotations[li];
    const { cutPoints, resolveAnchor } = buildCharFeInfo(li, ln, isOverlay);

    // Use CJK/mixed morphology annotation if it contains kanji/hanzi/jyutping/zhuyin tokens — while keeping anchor-only FE underlines!
    if (ann && ann.length && ann.some((r) => r.hasKanji || r.hira || r.romaji || r.pinyin || r.zhuyin || r.jyutping || r.cantonese)) {
      let cursor = 0;
      for (const r of ann) {
        const orig = r.orig || '';
        const idx = ln.t.indexOf(orig, cursor);
        if (idx > cursor) appendClean(frag, ln.t.slice(cursor, idx));   // keep spaces and punctuation the tokenizer skipped
        const c0 = idx >= 0 ? idx : cursor;
        cursor = c0 + orig.length;
        const rd = pickTokenReading(r, mode);
        if (r.hasKanji || r.hira || r.romaji || r.pinyin || r.zhuyin || r.jyutping || r.cantonese) {
          const pieces = sliceByCuts(orig, c0, cutPoints);
          const origChars = Array.from(orig);
          const rdSyls = rd && !Array.isArray(rd) ? rd.trim().split(/\s+/) : [];
          const canSliceSyl = rdSyls.length > 1 && rdSyls.length === origChars.length;
          let cpOff = 0;
          pieces.forEach(([sub, s0, s1]) => {
            const subLen = Array.from(sub).length;
            const lem = L.lemma(sub);
            const anc = resolveAnchor(s0, s1);
            const subRd = pieces.length === 1
              ? rd
              : Array.isArray(rd) ? sliceFuri(rd, cpOff, subLen)
              : (canSliceSyl ? rdSyls.slice(cpOff, cpOff + subLen).join(' ') : '');
            const subTones = pieces.length === 1 && Array.isArray(r.tones) ? r.tones : null;
            cpOff += subLen;
            const wsp = makeWordSpan(sub, lem, ln, anc ? anc.m : null, anc ? anc.gid : '', !!anc, subRd, [s0, s1], li, '', subTones);
            if (r.gram || r.pos === 'p') wsp.classList.add('ss-gram');   // particles sit close to the word before them
            if (r.pos && S.set.posColors !== false && !anc && pieces.length === 1) {
              const pTag = String(r.pos).toLowerCase();
              if (pTag === 'n' || pTag === 'v' || pTag === 'a') wsp.classList.add('ss-pos-' + pTag);
            }
            appendClean(frag, wsp);
          });
        } else {
          let subOff = c0;
          for (const tk of L.split(orig)) {
            const t0 = subOff;
            subOff += tk.w.length;
            if (!tk.word) {
              appendClean(frag, tk.w);
            } else {
              for (const [sub, s0, s1] of sliceByCuts(tk.w, t0, cutPoints)) {
                const anc = resolveAnchor(s0, s1);
                appendClean(frag, makeWordSpan(sub, L.lemma(sub), ln, anc ? anc.m : null, anc ? anc.gid : '', !!anc, '', [s0, s1], li));
              }
            }
          }
        }
      }
      if (cursor < ln.t.length && !ann.some((r) => r.orig && ln.t.indexOf(r.orig) < 0)) appendClean(frag, ln.t.slice(cursor));
      return frag;
    }

    let toks = (V.analysis && V.analysis.lineTokens[li]) || L.split(ln.t);
    const normLg = normLangCode(V && V.lang);
    const RD = window.SS_READINGS;
    if ((normLg === 'yue' || normLg === 'zh') && V && V.readDictRich && RD && RD.mergeCjkDictTokens) {
      toks = RD.mergeCjkDictTokens(toks, normLg, V.readDictRich, cutPoints);
    }
    const canOfflineAid = mode !== 'off' && /^(ja|zh|yue|ko)$/.test(normLg) && V && V.readDictRich && RD && RD.lookupTokenAid;
    const canOfflinePos = S.set.posColors !== false && /^(ja|zh|yue)$/.test(normLg) && V && V.readDictRich && RD && RD.lookupTokenAid;
    const canKoOffline = normLg === 'ko' && mode !== 'off' && V && V.readDict && RD && RD.lookupKoReading;
    const canStress = (normLg === 'ru' || normLg === 'tl') && !!S.set.showStressMarks && V && V.readDict && RD && RD.applyInlineMarks;
    let charOff = 0;
    let prevWord = '';
    let prevWord2 = '';
    let sentStart = true;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      const t0 = charOff;
      charOff += tk.w.length;
      if (!tk.word) {
        appendClean(frag, tk.w);
        if (/[.!?…:;]/.test(tk.w)) sentStart = true;
        if (/\S/.test(tk.w)) prevWord = prevWord2 = '';   // a comma or dash between article and noun breaks the link
      } else {
        const g = V._gender ? genderOf(tk.w, prevWord, sentStart, prevWord2) : '';
        const pieces = sliceByCuts(tk.w, t0, cutPoints);
        const aid = (canOfflineAid || canOfflinePos)
          ? RD.lookupTokenAid(tk.w, normLg, V.readDictRich, { mode, showPitchAccent: S.set.showPitchAccent !== false })
          : null;
        const aidRd = aid && canOfflineAid ? pickTokenReading(aid, mode) : '';
        const origChars = Array.from(tk.w);
        const rdSyls = aidRd && !Array.isArray(aidRd) ? aidRd.trim().split(/\s+/) : [];
        const canSliceSyl = rdSyls.length > 1 && rdSyls.length === origChars.length;
        let cpOff = 0;
        for (const [sub, s0, s1] of pieces) {
          const subLen = Array.from(sub).length;
          const anc = resolveAnchor(s0, s1);
          let subRd = '';
          if (aidRd) {
            subRd = pieces.length === 1
              ? aidRd
              : Array.isArray(aidRd) ? sliceFuri(aidRd, cpOff, subLen)
              : (canSliceSyl ? rdSyls.slice(cpOff, cpOff + subLen).join(' ') : '');
          } else if (canKoOffline) {
            subRd = RD.lookupKoReading(sub, V.readDict);
          }
          cpOff += subLen;
          const dispSub = canStress ? RD.applyInlineMarks(sub, V.readDict, normLg) : '';
          const wsp = makeWordSpan(sub, L.lemma(sub), ln, anc ? anc.m : null, anc ? anc.gid : '', !!anc, subRd, [s0, s1], li, dispSub);
          if (g && pieces.length === 1) wsp.classList.add('ss-g-' + g);
          if (aid && aid.pos === 'p') wsp.classList.add('ss-gram');
          if (aid && canOfflinePos && !anc && pieces.length === 1 && (aid.pos === 'n' || aid.pos === 'v' || aid.pos === 'a')) {
            wsp.classList.add('ss-pos-' + aid.pos);
          }
          appendClean(frag, wsp);
        }
        prevWord2 = prevWord;
        prevWord = tk.w.toLowerCase().replace(/’/g, "'");
        sentStart = false;
      }
    }
    return frag;
  };

  const cycleWordMark = (lem, word, ln) => {
    const k = wKey(lem);
    const cur = S.words[k] || '';
    const next = cur === '' ? 'learning' : cur === 'learning' ? 'known' : '';
    if (next) S.words[k] = next;
    else delete S.words[k];
    save('words');
    repaintMarks();
    refreshCoverage();
    logEv('rightMark', { lem, word, next: next || 'clear' });
    toast(`${word}: ${next || 'cleared'}`);
  };

  const repaintMarks = () => {
    document.querySelectorAll('.ss-w').forEach((el) => {
      const st = wordStatusOf(el.getAttribute('data-l'));
      el.classList.toggle('ss-learning', st === 'learning');
      el.classList.toggle('ss-known', st === 'known');
      if (st) el.classList.remove('ss-rare', 'ss-next');
    });
  };

  const refreshCoverage = () => {
    if (!V || !V.analysis) return;
    let known = 0;
    for (const toks of V.analysis.lineTokens) {
      for (const tk of toks) {
        if (tk.word && wordStatusOf(V.L.lemma(tk.w)) === 'known') known++;
      }
    }
    const tot = V.analysis.diff.totalTokens || 1;
    if (V.analysis.fit && V.ranks) {
      const lang = (V.lang || 'en');
      V.analysis.fit = SS_IDIOMS.vocabFit(V.analysis.lineTokens, V.L, lang, V.ranks, S.words, curVocabLevel(lang)) || V.analysis.fit;
      V.analysis.diff.baseCovPct = V.analysis.fit.coveragePct;
      V.analysis.toLearn = V.analysis.fit.pool;
      const c = V.analysis.fit.coveragePct;
      V.analysis.diff.iPlusOneStatus = c >= 95 ? 'review' : c >= 82 ? 'sweet_spot' : 'stretch';
    }
    V.analysis.diff.knownTokens = known;
    V.analysis.diff.knownPct = Math.round((known / tot) * 100);
    if (known > 0) {
      const p = V.analysis.diff.knownPct;
      V.analysis.diff.levelLabel = p >= 90 ? 'Easy' : p >= 75 ? 'Challenging' : 'Hard';
    }
    drawHead();
  };

  // ---- Translation lookup by interval overlap (LR_NOTES §3: max overlap, >0.5s overlap, or >=80% coverage) ----
  const lookupTrAt = (trArr, sameTiming, ln) => {
    if (!V || !trArr || !trArr.length || !ln || ln.isInstrumental) return '';
    let raw = '';
    if (sameTiming) {
      const idx = V.lines.indexOf(ln);
      const t = idx >= 0 ? trArr[idx] : null;
      raw = t ? t.t : '';
    } else {
      const s0 = ln.s;
      const dur = Math.max(0.35, ln.d || 2.0);
      const e0 = s0 + dur;
      const picked = [];
      let bestCue = null, bestOv = 0;
      for (let k = 0; k < trArr.length; k++) {
        const c = trArr[k];
        if (c.s > e0 + 0.4) break;
        const nextS = k + 1 < trArr.length ? trArr[k + 1].s : Infinity;
        const ce = Math.min(nextS, c.s + Math.max(0.5, c.d || 2.5));
        if (ce <= s0 - 0.15) continue;
        const ov = Math.min(e0, ce) - Math.max(s0, c.s);
        if (ov > bestOv) { bestOv = ov; bestCue = c; }
        if (ov >= 0.5 || ov / dur >= 0.8) picked.push(c.t);
      }
      if (picked.length) raw = [...new Set(picked.filter(Boolean))].join(' ');
      else if (bestCue && bestOv > 0.08) raw = bestCue.t;
    }
    const cleaned = S.set.cleanStageNoise !== false ? cleanCueText(raw) : raw;
    return String(cleaned || '').replace(/^(?:[。，、；：]+|\.(?!\.)\s+)/, '').trim();
  };

  // Give the visible cue priority while the complete machine track is being built.
  const subtitleEditId = ln => JSON.stringify([Math.round(ln.s*1000),ln.rawT ?? ln.t]);
  const originalTranslation = ln => lookupTrAt(V && V.tr, V && V.sameTiming, ln) || V?.previewTranslations?.get(ln) || '';
  const transFor = ln => (ln && V?.captionEdits?.[ln.editId]) || (ln?.frameTranslation?.target === S.set.tl && ln.frameTranslation.text) || originalTranslation(ln);
  const loadCaptionEdits = async view => {
    if (!S.set.tl || !view.trackKey || !view.videoKey || isLiveContext()) return;
    const key = 'ss_caption_edits:' + JSON.stringify([view.videoKey,view.trackKey,S.set.tl]);
    view.editStorageKey = key;
    for (const ln of view.lines) ln.editId = subtitleEditId(ln);
    try {
      const entries = (await chrome.storage.local.get(key))[key] || {};
      if (V !== view || view.editStorageKey !== key || view.captionEdits) return;
      view.captionEdits = entries;
      if (Object.keys(entries).length) { drawList(); if (view.cur >= 0) drawLine(view.cur); }
    } catch (_) {}
  };
  const editCurrentTranslation = () => {
    const view = V, ln = view?.lines[view.cur];
    if (!ln?.editId || !view.editStorageKey) return;
    const target=S.set.tl, previous=view.captionEdits?.[ln.editId] || '';
    const field=h('textarea',{rows:3,'aria-label':'Corrected translation'});
    field.value=previous || (ln?.frameTranslation?.target === S.set.tl && ln.frameTranslation.text) || originalTranslation(ln);
    const status=h('p',{role:'status'});
    const modal=h('dialog',{class:'ss-caption-editor'},
      h('strong',{},'Edit translation'), h('p',{},ln.t), field, status);
    const preferred = /microsoft/i.test(view.trProv || '') ? 'microsoft' :
      /google/i.test(view.trProv || '') ? 'google' : S.set.webMtProvider || 'google';
    const other = preferred === 'microsoft' ? 'google' : 'microsoft';
    const engine = other === 'microsoft' ? 'Microsoft Translator' : 'Google Translate';
    const comparison=h('p',{role:'status'});
    const useResult=h('button',{type:'button',hidden:true,onclick:()=>{
      field.value=useResult.dataset.translation; field.focus();
    }},'Use this translation');
    const compare=h('button',{type:'button',onclick:async()=>{
      compare.disabled=true;
      comparison.textContent='Translating…';
      const response=await bg({op:'webTranslate',texts:[ln.t],sl:view.lang,tl:target,provider:other,fallback:false});
      if (!modal.isConnected) return;
      const text=response?.ok && response.translations?.[0];
      comparison.textContent=text ? engine+' · '+text : engine+' is unavailable.';
      if (text) { useResult.dataset.translation=text; useResult.hidden=false; }
      compare.disabled=Boolean(text);
    }},'Compare with '+engine);
    modal.append(compare,comparison,useResult);
    const submit=async value=>{
      if (saveButton.disabled) return;
      saveButton.disabled=resetButton.disabled=true;
      const result=await bg({op:'saveCaptionEdit',video:view.videoKey,track:view.trackKey,target,
        startMs:Math.round(ln.s*1000),original:ln.rawT ?? ln.t,previous,translation:value.trim()});
      if (result?.ok) { modal.close(); return; }
      status.textContent=result?.conflict ? 'Another tab edited this line. Reopen it to see the latest version.' : 'Could not save this correction.';
      saveButton.disabled=false;resetButton.disabled=!previous;
    };
    const saveButton=h('button',{type:'button',onclick:()=>submit(field.value)},'Save');
    const resetButton=h('button',{type:'button',disabled:!previous,onclick:()=>submit('')},'Restore original translation');
    modal.append(saveButton,resetButton,h('button',{type:'button',onclick:()=>modal.close()},'Cancel'));
    modal.addEventListener('close',()=>modal.remove(),{once:true});
    (document.fullscreenElement || document.body).append(modal);
    modal.showModal();field.focus();
  };
  const translateVisibleCue = async (ln, i) => {
    const view = V, target = S.set.tl;
    const service = S.set.sceneServices?.subtitle || 'auto';
    if (!view?.allowPreviewTranslation || !target || !['auto', 'free_web'].includes(service) ||
        (service === 'auto' && companionHealth?.plamo) || !ln?.t || view.previewRequests.has(ln)) return;
    view.previewRequests.add(ln);
    const result = await bg({op:'webTranslate', texts:[ln.t], sl:view.lang, tl:target}).catch(() => null);
    if (V !== view || S.set.tl !== target) return;
    const translated = result?.ok && result.translations?.[0];
    if (!translated) { setTimeout(() => view.previewRequests.delete(ln), 10000); return; }
    view.previewTranslations.set(ln, translated);
    if (view.cur === i && view.lines[i] === ln) drawLine(i);
  };
  const tr2For = (ln) => (S.set.tl2 && V && V.tr2 ? lookupTrAt(V.tr2, V.tr2Same, ln) : '');
  const aiTransFor = (ln) =>
    S.set.showDualHumanAi && V && V.trProv === 'Human' && V.aiTr
      ? lookupTrAt(V.aiTr, true, ln)
      : '';

  // ---- Overlay ----
  let revealedIndex = -1;
  const drawLine = (i) => {
    hidePeek();
    if (ov) ov.textContent = '';
    const ln = V?.lines[i];
    if (!ov || !S.set.on || !ln || ln.isInstrumental || !ln.t.trim()) {
      syncNativeCaptions(!!(S.set.on && V && getBlurMode() === 'audio'));
      return;
    }
    const rev = revealedIndex === i;
    const lowConf = ln.conf != null && ln.conf < 0.55;
    const showBadges = !!S.set.showOverlayBadges;
    const srcTip = V.srcProv ? (lowConf ? `${V.srcProv} (low conf)` : V.srcProv) : '';
    const origRow = h('span', { class: 'ss-row' },
      h('span', { class: 'ss-l ss-a' + (rev ? ' ss-rev' : '') + (lowConf ? ' ss-low-conf' : ''), title: srcTip, lang:ln.lineLang || V.lang },
        renderLineTokens(i, ln, true),
        (showBadges && V.srcProv) ? h('span', { class: 'ss-prov', title: lowConf ? 'Low-confidence ASR segment' : 'Caption source' }, lowConf ? `${V.srcProv} (low conf)` : V.srcProv) : null));
    const tr = transFor(ln);
    if (!tr) void translateVisibleCue(ln, i);
    const dueIt = tr && !rev ? findDueSavedItemInLine(ln) : null;
    if (dueIt && V._activeDueRecall?.item.id !== dueIt.id) V._activeDueRecall = { li: i, item: dueIt };
    if (!dueIt) V._activeDueRecall = null;
    const recall = V._activeDueRecall;
    const ratings = recall?.revealed ? h('span', { class: 'ss-recall-ratings', role: 'group', 'aria-label': 'Rate your recall' },
      ...['Again', 'Hard', 'Good', 'Easy'].map((label) => h('button', {
        type: 'button', class: 'ss-recall-pill',
        onclick: (event) => {
          event.stopPropagation();
          if (recall.pending) return;
          recall.pending = true;
          chrome.runtime.sendMessage({
            op: 'reviewStudyItem', id: String(recall.item.id), rating: label.toLowerCase(),
            timestamp: SS_STORE.reviewTimestamp(recall.item),
          }, (result) => {
            recall.pending = false;
            if (chrome.runtime.lastError || !result?.ok) { toast('Review changed or could not be saved'); return; }
            _sessionReviewedIds.add(recall.item.id);
            if (V?._activeDueRecall === recall) {
              V._activeDueRecall = null;
              revealedIndex = i;
              drawLine(i);
            }
          });
        },
      }, label))) : null;
    const reveal = recall && !recall.revealed ? h('button', {
      type: 'button', class: 'ss-recall-pill',
      onclick: (event) => {
        event.stopPropagation();
        video()?.pause();
        recall.revealed = true;
        drawLine(i);
      },
    }, `Recall ${dueIt.word} · Reveal`) : null;
    const trRow = tr ? h('span', { class: 'ss-row' }, reveal || h('span', {
      class: 'ss-l ss-b' + (rev || recall?.revealed ? ' ss-rev' : ''),
      title: V.captionEdits?.[ln.editId] ? 'Your correction' : V.trProv || 'Machine translation', lang: S.set.tl,
    }, tr, (showBadges && (V.trProv || V.captionEdits?.[ln.editId])) ? h('span', { class: 'ss-prov', title: 'Translation source' }, V.captionEdits?.[ln.editId] ? 'Your correction' : V.trProv) : null), ratings) : null;
    if (S.set.transAboveOrig && trRow) appendClean(ov, trRow, origRow);
    else appendClean(ov, origRow, trRow);
    // Keep the latest speech visible while its translation is in flight.
    // The completed source/translation pair stays together below the preview.
    const pending = liveState.active && liveState.mode === 'asr' && V.lines.at(-1);
    if (pending && pending !== ln && !transFor(pending)) {
      ov.prepend(h('span', {class:'ss-row ss-live-preview', lang:pending.lineLang || V.lang,
        'aria-label':'Latest speech, translation pending'}, h('span', {class:'ss-l'}, pending.t)));
    }
    syncNativeCaptions(ov.isConnected);
    const tr2 = tr2For(ln);
    if (!reveal && tr2 && tr2 !== tr) {
      appendClean(ov, h('span', { class: 'ss-row' },
        h('span', { class: 'ss-l ss-b ss-c' + (rev ? ' ss-rev' : ''), title: V.tr2Prov || '' },
          tr2,
          (showBadges && V.tr2Prov) ? h('span', { class: 'ss-prov', title: 'Third language source' }, V.tr2Prov) : null)));
    }
    const aiTr = aiTransFor(ln);
    if (!reveal && aiTr && aiTr !== tr) {
      appendClean(ov, h('span', { class: 'ss-row' },
        h('span', { class: 'ss-l ss-b' + (rev ? ' ss-rev' : ''), title: V.aiTrProv || '', style: { color: '#7ee2d6' } },
          aiTr,
          (showBadges && V.aiTrProv) ? h('span', { class: 'ss-prov' }, V.aiTrProv) : null)));
    }
  };



  // ---- Save item helper ----
  const saveItem = (item) => {
    const dup = S.items.find((x) => x.videoId === item.videoId && Math.abs((x.t || 0) - (item.t || 0)) < 0.5 && x.word === item.word);
    if (dup) return dup;
    const now = Date.now();
    const enriched = SS_STORE.initItemSchedule(Object.assign({
      id: now + '_' + Math.random().toString(36).slice(2, 6),
      thumbDataUrl: item.thumbDataUrl || captureVideoFrame(),
      sourceUrl: item.videoId ? videoUrlOf(item.videoId, item.t) : '',
      at: new Date(now).toISOString(),
    }, item), now);
    S.items.push(enriched);
    save('items');
    addXp(5);
    return enriched;
  };

  // ---- Web Speech Pronunciation Helper ----
  // Real recordings first (JapanesePod101, Lingua Libre / Wiktionary via pron.js, fetched live), browser voice as fallback.
  const speakWord = (text, lang, reading = '') => {
    try {
      chrome.runtime.sendMessage({ op: 'pronPlay', text, lang: normLangCode(lang || 'en'), reading }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) speakWordTts(text, lang);
      });
    } catch (e) { speakWordTts(text, lang); }
  };
  const speakWordTts = (text, lang) => {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const bcp = {
        en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', yue: 'zh-HK', ko: 'ko-KR',
        es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', it: 'it-IT', ru: 'ru-RU', tl: 'fil-PH', fil: 'fil-PH',
      };
      const base = normLangCode(lang || 'en');
      u.lang = /^[A-Za-z]/.test(text) && /^(ja|zh|yue|ko|ru)$/.test(base) ? 'en-US' : (bcp[base] || lang || 'en-US');
      window.speechSynthesis.speak(u);
    } catch (e) {}
  };

  // ---- Docked Dictionary, Context X-Ray, & Examples Drawer ----
  let dockPausedVideo = null;
  const sceneGlossCache = new Map();
  const expandCueSentence = (idx, line) => {
    if (!V || !V.lines || idx < 0 || !V.lines[idx]) return { line: line ? line.t : '', trans: line ? transFor(line) : '' };
    const curLn = V.lines[idx];
    let a = idx, b = idx;
    const END_RE = /[.!?。！？…」』"'\)]$/;
    if (a > 0 && V.lines[a - 1] && !V.lines[a - 1].isInstrumental && !END_RE.test(V.lines[a - 1].t.trim()) && (curLn.s - (V.lines[a - 1].s + (V.lines[a - 1].d || 2))) <= 1.5) a--;
    while (b + 1 < V.lines.length && b - a < 2 && V.lines[b + 1] && !V.lines[b + 1].isInstrumental && !END_RE.test(V.lines[b].t.trim()) && (V.lines[b + 1].s - (V.lines[b].s + (V.lines[b].d || 2))) <= 1.5) b++;
    const joiner = (V.L && V.L.noSpace) ? '' : ' ';
    const joined = V.lines.slice(a, b + 1).map((x) => x.t.trim()).filter(Boolean).join(joiner);
    const joinedTr = V.lines.slice(a, b + 1).map((x) => transFor(x)).filter(Boolean).join(' ');
    return { line: joined || curLn.t, trans: joinedTr || transFor(curLn) || '' };
  };
  const cueExplainPayload = (word, lemma, line, match, lineIndex = line ? V.lines.indexOf(line) : -1) => ({
    word: match?.surface || word, lemma: match?.display || lemma,
    line: cleanCueText(line?.t || ''), context: cleanCueText(expandCueSentence(lineIndex, line).line),
    gloss_only: Boolean(line), target_lang: S.set.tl || 'en', source_lang: V.lang || 'en', title: V.info?.title || '',
  });
  const cueExplainCacheKey = payload => JSON.stringify([S.set.companionUrl, S.set.mtModel, payload]);

  const selectPastScenes = (rows, currentKey, currentLine) => {
    const seen = new Set();
    const relevant = rows.filter(row =>
      /^(yt:|bili:)/.test(row.videoKey) && !sameVidKey(row.videoKey, currentKey) &&
      Number.isFinite(row.t) && row.t >= 0 && cleanCueText(row.line) &&
      cleanCueText(row.line) !== currentLine);
    relevant.sort((a, b) => Number(Boolean(b.sense)) - Number(Boolean(a.sense)) || (b.at || 0) - (a.at || 0));
    const distinct = relevant.filter(row => {
      const key = normSiteVidKey(row.videoKey);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const first = distinct[0];
    const other = first?.sense && distinct.find(row => row.sense && row.sense !== first.sense);
    return other ? [first, other] : distinct.slice(0, 2);
  };

  const geminiHandoff = (payload, time) => h('button', {
    type: 'button',
    class: 'ss-gemini-handoff ss-quiet',
    title: 'Copy the current subtitle and open Gemini. Paste the question there when you are ready.',
    onclick: async () => {
      const prompt = [
        'What does the selected expression mean in this subtitle? Use only the quoted dialogue as evidence.',
        `Source language: ${payload.source_lang}. Answer language: ${payload.target_lang}.`,
        `Selected expression: ${JSON.stringify(payload.word)}`,
        `Current subtitle [${fmtTs(time)}]: ${JSON.stringify(payload.line)}`,
      ];
      if (payload.context && payload.context !== payload.line) {
        prompt.push(`Nearby subtitle text: ${JSON.stringify(payload.context.slice(0, 280))}`);
      }
      try {
        await navigator.clipboard.writeText(prompt.join('\n'));
      } catch (_) {
        toast('Could not copy the subtitle. Check clipboard access.');
        return;
      }
      const opened = await bg({ op: 'openStudyGemini' });
      toast(opened?.ok ? 'Question copied. Paste it in Gemini.' : 'Question copied. Open Gemini to paste it.');
    },
  }, 'Ask Gemini');
  const releaseDockPause = () => {
    const paused = dockPausedVideo;
    paused?.removeEventListener('play', releaseDockPause);
    dockPausedVideo = null;
    return paused;
  };
  const closeDock = (resume = false) => {
    dictOpen = false;
    if (dockEl) { dockEl.style.display = 'none'; dockEl.textContent = ''; }
    const paused = releaseDockPause();
    if (resume === true && paused && paused === video() && paused.paused && !paused.ended) {
      paused.play()?.catch(() => {});
    }
  };

  const positionVideoDictionary = () => {
    if (!dictOpen || !dockEl?.classList.contains('ss-video-dict')) return;
    const host = document.fullscreenElement || document.body;
    if (dockEl.parentElement !== host) host.append(dockEl);
    const rect = (document.fullscreenElement || playerContainer())?.getBoundingClientRect();
    if (!rect) return;
    const top = Math.max(8, Math.min(rect.top + 10, window.innerHeight - 168));
    const right = Math.max(8, window.innerWidth - rect.right + 10);
    const captions = ov?.getBoundingClientRect();
    const bottom = captions?.height && captions.top > top + 150
      ? Math.min(captions.top - 8, window.innerHeight - 8)
      : window.innerHeight - 8;
    Object.assign(dockEl.style, {
      top: top + 'px', right: Math.min(right, Math.max(8, window.innerWidth - 428)) + 'px',
      maxHeight: Math.min(590, bottom - top) + 'px',
    });
  };
  window.addEventListener('resize', positionVideoDictionary);
  window.addEventListener('scroll', positionVideoDictionary, { passive: true, capture: true });
  document.addEventListener('fullscreenchange', positionVideoDictionary);
  document.addEventListener('click', (e) => {
    if (dictOpen && dockEl?.classList.contains('ss-video-dict') && !dockEl.contains(e.target)) closeDock(true);
  });

  const englishCueGrammar = (word, lemma, line, span) => {
    const base = String(lemma || word).toLowerCase();
    if (!span || base !== word.toLowerCase() || !/^[a-z]+$/.test(base)) return '';
    return /\b(?:i|you|he|she|it|we|they)\s+will$/i.test(cleanCueText(line.t.slice(0, span[0])))
      ? 'will + base verb' : '';
  };

  const renderHighlightedSnippet = (text, target) => {
    const span = h('span', {});
    const raw = String(text || '');
    const t = String(target || '').trim();
    if (!t) { span.textContent = raw; return span; }
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${esc})`, 'ig');
    const parts = raw.split(re);
    parts.forEach((p, idx) => {
      if (idx % 2 === 1) appendClean(span, h('span', { class: 'ss-ex-hi' }, p));
      else if (p) appendClean(span, p);
    });
    return span;
  };

  const buildExternalLinks = (queryText, rawLang) => {
    const isAscii = /^[A-Za-z][A-Za-z'\s-]*$/.test(queryText);
    const base = isAscii ? 'en' : (rawLang || 'en').toLowerCase().split('-')[0];
    const enc = encodeURIComponent(queryText.toLowerCase());
    const slugDash = encodeURIComponent(queryText.toLowerCase().replace(/\s+/g, '-'));
    const ygLang = { en: 'english', ja: 'japanese', zh: 'chinese', yue: 'cantonese', ko: 'korean', ru: 'russian' }[base] || 'english';

    return h('div', { class: 'ss-res-bar' },
      h('a', { class: 'ss-res-pill', href: `https://youglish.com/pronounce/${encodeURIComponent(queryText)}/${ygLang}`, target: '_blank', rel: 'noopener', title: 'Hear real speakers pronounce this phrase on YouGlish' }, '▶ YouGlish'),
      h('a', { class: 'ss-res-pill', href: `https://en.wiktionary.org/wiki/${enc}`, target: '_blank', rel: 'noopener' }, 'Wiktionary'),
      h('a', { class: 'ss-res-pill', href: `https://forvo.com/word/${enc}/`, target: '_blank', rel: 'noopener' }, 'Forvo'),
      base === 'en' ? h('a', { class: 'ss-res-pill', href: `https://idioms.thefreedictionary.com/${encodeURIComponent(queryText.replace(/\s+/g, '+'))}`, target: '_blank', rel: 'noopener' }, 'FreeDict Idioms') : null,
      base === 'en' ? h('a', { class: 'ss-res-pill', href: `https://dictionary.cambridge.org/dictionary/english/${slugDash}`, target: '_blank', rel: 'noopener' }, 'Cambridge') : null,
      base === 'en' ? h('a', { class: 'ss-res-pill', href: `https://www.collinsdictionary.com/dictionary/english/${slugDash}`, target: '_blank', rel: 'noopener' }, 'Collins') : null,
      base === 'ja' ? h('a', { class: 'ss-res-pill', href: `https://jisho.org/search/${encodeURIComponent(queryText)}`, target: '_blank', rel: 'noopener' }, 'Jisho') : null,
      base === 'ja' ? h('a', { class: 'ss-res-pill', href: `https://www.weblio.jp/content/${encodeURIComponent(queryText)}`, target: '_blank', rel: 'noopener' }, 'Weblio') : null,
      (base === 'zh' || base === 'yue' || /[\u4e00-\u9fff]/.test(queryText)) ? h('a', { class: 'ss-res-pill', href: `https://www.mdbg.net/chinese/dictionary?page=worddict&wdrst=0&wdqb=${encodeURIComponent(queryText)}`, target: '_blank', rel: 'noopener' }, 'MDBG') : null,
      (base === 'zh' || base === 'yue' || /[\u4e00-\u9fff]/.test(queryText)) ? h('a', { class: 'ss-res-pill', href: `https://words.hk/zidin/v/${encodeURIComponent(queryText)}`, target: '_blank', rel: 'noopener' }, 'words.hk') : null,
      base === 'ko' ? h('a', { class: 'ss-res-pill', href: `https://en.dict.naver.com/#/search?query=${encodeURIComponent(queryText)}`, target: '_blank', rel: 'noopener' }, 'Naver') : null,
      base === 'ru' ? h('a', { class: 'ss-res-pill', href: `https://en.openrussian.org/ru/${encodeURIComponent(queryText)}`, target: '_blank', rel: 'noopener' }, 'OpenRussian') : null);
  };

  // Render clickable Cross-Lingual Formula Graph chips (extra.eq across EN, ZH, YUE, JA, KO) + fe_zh chengyu meaning + 1-click Localize Pin
  const renderEqChips = (feObj, surfaceText) => {
    const eq = feObj && feObj.eq;
    if (!eq || typeof eq !== 'object') return null;
    const langLabels = { en: 'EN', zh: 'ZH', yue: 'YUE', ja: 'JA', ko: 'KO', es: 'ES', fr: 'FR', de: 'DE', pt: 'PT', it: 'IT', ru: 'RU', tl: 'TL', fil: 'TL' };
    const tlBase = normLangCode(S.set.tl || 'en');
    const tlIsZh = tlBase === 'zh' || tlBase === 'yue';
    const chips = [];
    for (const [k, rawVal] of Object.entries(eq)) {
      const vals = (Array.isArray(rawVal) ? rawVal : [rawVal]).map((x) => String(x || '').trim()).filter(Boolean);
      if (!vals.length) continue;
      const code = k.toLowerCase();
      const zhEntry = code === 'zh' ? ((feObj && feObj._zhEq) || lookupZhChengyu(vals)) : null;
      const bestVal = (zhEntry && zhEntry.display) ? zhEntry.display : vals[0];
      const zhGlossFull = zhEntry ? (tlIsZh ? (zhEntry.glossZh || zhEntry.glossEn) : (zhEntry.glossEn || zhEntry.glossZh)) : '';
      const zhGlossShort = zhGlossFull ? trimGlossHint(zhGlossFull) : '';
      const tipParts = [`Equivalent in ${langLabels[code] || code.toUpperCase()}: ${vals[0]}`];
      if (zhEntry && zhEntry.reading) tipParts.push(`Pīnyīn: ${zhEntry.reading}`);
      if (zhEntry && zhEntry.glossEn) tipParts.push(`EN: ${zhEntry.glossEn}`);
      if (zhEntry && zhEntry.glossZh) tipParts.push(`ZH: ${zhEntry.glossZh}`);
      tipParts.push('Click to hear · Shift+click to pin into video translator');

      const isTarget = normLangCode(code) === tlBase;
      chips.push(h('button', {
        class: 'ss-eq-chip' + (isTarget ? ' ss-act' : ''),
        title: tipParts.join(' · '),
        onclick: async (ev) => {
          ev.stopPropagation();
          if (ev.shiftKey && V && surfaceText) {
            V.glossaryTerms = mergeGlossaryTerms(V.glossaryTerms || [], [{ src: surfaceText, dst: bestVal, note: 'eq-pin' }]);
            await SS_STORE.saveGlossary(curVidKey(), V.info.channelId, { videoId: curVidKey(), terms: V.glossaryTerms, updatedAt: Date.now() }, [{ src: surfaceText, dst: bestVal, note: 'eq-pin' }]);
            await healGlossaryTerm(surfaceText, bestVal);
            return;
          }
          speakWord(bestVal, code === 'yue' ? 'zh-HK' : code);
        },
      },
      h('b', {}, langLabels[code] || code),
      bestVal,
      zhGlossShort ? h('span', { class: 'ss-eq-gloss' }, `· ${zhGlossShort}`) : null));
      if (isTarget && companionHealth && companionHealth.ok && surfaceText) {
        chips.push(h('button', {
          class: 'ss-eq-chip',
          title: `Localize subtitle translations using "${bestVal}"`,
          onclick: async (ev) => {
            ev.stopPropagation();
            V.glossaryTerms = mergeGlossaryTerms(V.glossaryTerms || [], [{ src: surfaceText, dst: bestVal, note: 'eq-pin' }]);
            await SS_STORE.saveGlossary(curVidKey(), V.info.channelId, { videoId: curVidKey(), terms: V.glossaryTerms, updatedAt: Date.now() }, [{ src: surfaceText, dst: bestVal, note: 'eq-pin' }]);
            await healGlossaryTerm(surfaceText, bestVal);
          },
        }, 'Localize MT'));
      }
    }
    return chips.length ? h('div', { class: 'ss-eq-row' }, ...chips) : null;
  };

  // Scene senses come only from the model (/explain) and the dictionaries. The hard-coded
  // demo answers for two expressions were removed in the 2026-11-23 audit.
  const cueSceneSense = () => ({ sceneSense: '', sceneHead: '', sceneSurface: '' });

  const openDock = (word, lemma, line, feMatch, forceWordOnly = false, keepPlaying = false, charPos = null, cueReading = '') => {
    const lang = normLangCode(V.lang);
    const videoCard = Boolean(line);
    const { sceneSense, sceneHead, sceneSurface } = cueSceneSense(word, line, feMatch, charPos, lang);

    dictOpen = true;
    const v = video();
    if (v && !keepPlaying && !v.paused) {
      if (videoCard) {
        releaseDockPause();
        dockPausedVideo = v;
        v.addEventListener('play', releaseDockPause, { once: true });
      }
      v.pause();
    }
    dockEl.classList.toggle('ss-video-dict', videoCard);
    if (videoCard) positionVideoDictionary();
    else if (dockEl.parentElement !== panel) {
      panel.insertBefore(dockEl, tabsEl);
      dockEl.style.maxHeight = '';
    }
    dockEl.style.display = '';
    dockEl.textContent = '';

    const activeFe = forceWordOnly ? null : feMatch;
    const setMark = (st) => {
      if (st) S.words[wKey(lemma)] = st;
      else delete S.words[wKey(lemma)];
      save('words');
      repaintMarks();
      refreshCoverage();
    };

    const prof = getProfile();
    const isPro = S.set.uiMode === 'pro';
    const queryDisplay = activeFe ? activeFe.display : word;
    const rank = V.ranks ? (V.ranks[word.toLowerCase()] || V.ranks[lemma] || 0) : 0;
    const headTitle = activeFe ? activeFe.display : word;
    const readingBadge = h('span', { class: 'ss-badge', style: { display: 'none' } });
    const body = h('div', { style: { marginTop: '6px' } }, (V.L.dict || /[\u3040-\u9fff\uac00-\ud7afA-Za-z]/.test(word)) ? 'Looking up…' : 'No offline dictionary for this language.');

    const modeSwitchPill = feMatch
      ? h('button', {
          class: 'ss-badge',
          style: { fontSize: '11px', padding: '2px 7px' },
          title: forceWordOnly ? `Switch to phrase "${feMatch.display}"` : `Switch to single word "${word}"`,
          onclick: () => openDock(word, lemma, line, feMatch, !forceWordOnly, keepPlaying, charPos, cueReading),
        }, forceWordOnly ? `Phrase: ${feMatch.display}` : `Just “${word}”`)
      : null;

    const rankLabel = rank ? (rank <= 1000 ? `★★★ #${rank}` : rank <= 3000 ? `★★☆ #${rank}` : `★☆☆ #${rank > 30000 ? '30k+' : rank}`) : '';
    const headNode = h('h4', {}, sceneHead || headTitle);
    const hdr = h('div', { class: 'ss-dh' },
      h('div', { class: 'ss-dh-left' },
        headNode,
        readingBadge,
        h('button', { class: 'ss-tts-btn', title: 'Pronounce aloud',
          onclick: () => speakWord(videoCard && !activeFe ? headNode.textContent : sceneHead || queryDisplay, V.lang) }, 'Speak'),
        rankLabel && !activeFe ? h('span', { class: 'ss-badge', title: `Word frequency rank ${rankLabel}` }, rankLabel.split(' ')[0]) : null,
        modeSwitchPill),
      h('button', { 'aria-label': 'Close dictionary', onclick: () => closeDock(videoCard) }, '×'));

    const feAggObj = activeFe && V.analysis ? V.analysis.allFEs.find((x) => x.pattern === activeFe.pattern) : null;
    const pieInfo = activeFe && V.pieMap ? V.pieMap[activeFe.pattern] : null;
    const deceptivePill = activeFe && (activeFe.deceptive || (pieInfo && pieInfo.deceptive_trap))
      ? h('div', { class: 'ss-decept-pill' }, '⚠️ Deceptive Transparency · looks literal, but non-literal here')
      : null;
    const feMeta = feAggObj || activeFe;
    const spokenSlot = feMeta ? h('div', { class: 'ss-spoken', style: { display: 'none' } }) : null;
    if (spokenSlot) fillSpokenRates(spokenSlot, feMeta);
    const offlineLit = (feMeta && feMeta.lit) || '';
    const offlineNative = (feMeta && (feMeta.native || feMeta.layer || feMeta.type)) || '';
    const offlineGloss = bestFeMeaning(feMeta);
    const offlineFalseFriend = (feMeta && feMeta.falseFriend) || '';
    const eqBox = feMeta ? renderEqChips(feMeta, activeFe ? activeFe.surface : word) : null;
    if (feMeta && feMeta.reading && feMeta.reading !== queryDisplay) {
      readingBadge.textContent = feMeta.reading;
      readingBadge.style.display = '';
    }
    const contrastBox = (pieInfo && (pieInfo.literal_gloss || pieInfo.idiomatic_gloss || pieInfo.explain)) || offlineLit || offlineGloss || offlineFalseFriend || eqBox
      ? h('div', { class: 'ss-contrast' },
          h('div', {}, h('b', {}, pieInfo && pieInfo.usage === 'literal' ? 'Literal in this scene' : (offlineNative || 'Formulaic expression')),
            feMeta && feMeta.play ? h('span', { class: 'ss-tag-pill ss-tag-play' }, (SS_IDIOMS && SS_IDIOMS.resolveNativeLabel) ? SS_IDIOMS.resolveNativeLabel('play', 'play', V.lang, '', true) : 'playful') : null,
            feMeta && feMeta.register ? h('span', { class: 'ss-tag-pill ss-tag-slang' }, feMeta.register) : null),
          pieInfo && pieInfo.explain ? h('div', { style: { marginTop: '2px' } }, pieInfo.explain) : null,
          (pieInfo && pieInfo.literal_gloss) || offlineLit ? h('div', { style: { fontSize: '11.5px', opacity: '.82' } }, `Literal: ${(pieInfo && pieInfo.literal_gloss) || offlineLit}`) : null,
          (pieInfo && pieInfo.idiomatic_gloss) || offlineGloss ? h('div', { class: 'ss-fe-meaning', style: { fontSize: '11.5px', color: '#2dd4bf' } }, `Meaning: ${(pieInfo && pieInfo.idiomatic_gloss) || offlineGloss}`) : null,
          offlineFalseFriend ? h('div', { style: { fontSize: '11.5px', color: '#fbbf24', marginTop: '2px' } }, `Mandarin contrast: ${offlineFalseFriend}`) : null,
          eqBox)
      : null;

    const sceneReading = '';
    const cuePronunciation = sceneReading || !activeFe && (Array.isArray(cueReading)
      ? cueReading.map(([base, kana]) => kana || base).join('') : cueReading);
    if (cuePronunciation && cuePronunciation !== word) {
      readingBadge.textContent = cuePronunciation;
      readingBadge.style.display = '';
    }
    let latestWordGloss = sceneSense;
    const xrayBox = h('div', { class: 'ss-xray', style: { display: companionHealth && companionHealth.plamo ? '' : 'none' } },
      h('div', { class: 'ss-xray-title' }, 'Context & Subtext X-Ray (Local AI)'),
      h('div', {}, `Analyzing in ${S.set.tl || 'en'}…`));


    const matchTraceTxt = activeFe && (
      String(activeFe.surface || '').toLowerCase() !== String(activeFe.display || '').toLowerCase() ||
      (Array.isArray(activeFe.anchorRanges) && activeFe.anchorRanges.length > 1)
    ) ? `Matched "${activeFe.surface}" -> ${activeFe.display}${activeFe.anchorRanges && activeFe.anchorRanges.length > 1 ? ' (split gap)' : ''}` : '';
    const matchTraceEl = matchTraceTxt && S.set.debugMatch
      ? h('div', { style: { fontSize: '11px', opacity: '.72', marginBottom: '6px' } }, matchTraceTxt)
      : null;

    const isMultiWord = !activeFe && (/\s/.test(word.trim()) || (V.L.noSpace && Array.from(word).length >= 3 && forceWordOnly));
    const lineIdx = line ? V.lines.indexOf(line) : -1;
    const buildCardObj = (extraFields = {}) => {
      const sentPair = expandCueSentence(lineIdx, line);
      return Object.assign({
        itemType: activeFe ? 'FE' : (isMultiWord ? 'PHRASE' : 'WORD'),
        layer: feMeta ? (feMeta.layer || feMeta.type || '') : '',
        word: activeFe ? activeFe.surface : word,
        surface: activeFe ? activeFe.surface : word,
        reading: readingBadge.textContent || (feMeta && feMeta.reading) || '',
        lemma: activeFe ? activeFe.pattern : lemma,
        lang: V.lang,
        def: latestWordGloss || (pieInfo && pieInfo.idiomatic_gloss) || offlineGloss ||
          (body.querySelector('.ss-dict-pane') || body).textContent.slice(0, 180),
        lit: (pieInfo && pieInfo.literal_gloss) || offlineLit || '',
        eq: feMeta && feMeta.eq ? feMeta.eq : null,
        line: sentPair.line,
        trans: sentPair.trans,
        provenance: V.trProv || 'none',
        t: line ? line.s : 0,
        endT: line ? line.s + (line.d || 3) : 3,
        videoId: curVidKey(),
        channelId: V.info.channelId || '',
        title: V.info.title,
        maxBand: activeFe ? activeFe.maxBand : 3,
        deceptive: activeFe ? !!activeFe.deceptive : false,
        soundCue: feAggObj ? (feAggObj.soundCue || '') : '',
      }, extraFields);
    };

    const ankiBtn = h('button', {
      class: 'ss-teal',
      title: 'Save & push directly to desktop Anki via AnkiConnect (:8765) with screenshot + word audio',
      onclick: async () => {
        let wordAudioUrl = '';
        try {
          const pr = await new Promise((r) => chrome.runtime.sendMessage({ op: 'pronLookup', text: activeFe ? activeFe.display : word, lang: normLangCode(V.lang), reading: readingBadge.textContent || '' }, r));
          if (pr && pr.ok && pr.url) wordAudioUrl = pr.url;
        } catch (_) {}
        const item = saveItem(buildCardObj({ wordAudioUrl }));
        if (!S.words[wKey(lemma)]) setMark('learning');
        drawHead();
        const res = await SS_EXPORT.pushToAnkiConnect([item], { ankiUrl: S.set.ankiConnectUrl, deck: S.set.ankiDeck, preflightDuplicates: true });
        if (res.ok) save('items');
        toast(res.ok ? `AnkiConnect: +${res.added} added${res.updated ? `, ${res.updated} updated` : ''} (${res.skipped} dup)` : (res.error || 'AnkiConnect offline'));
      },
    }, '⚡ Anki');

    try {
      const checkField = (activeFe ? activeFe.surface : word) + ((readingBadge.textContent || (feMeta && feMeta.reading)) ? ` [${readingBadge.textContent || (feMeta && feMeta.reading)}]` : '');
      chrome.runtime.sendMessage({
        op: 'ankiConnect',
        ankiUrl: S.set.ankiConnectUrl || 'http://127.0.0.1:8765',
        action: 'canAddNotes',
        params: { notes: [{ deckName: S.set.ankiDeck || 'Subtitle Study', modelName: 'Subtitle Study', fields: { Word: checkField }, options: { allowDuplicate: false, duplicateScope: 'deck' } }] },
      }, (r) => {
        if (r && r.ok && Array.isArray(r.result) && r.result[0] === false && ankiBtn.isConnected) {
          ankiBtn.textContent = '✓ In Anki';
        }
      });
    } catch (_) {}

    const btns = h('div', { class: 'ss-btns' },
      h('button', {
        class: 'ss-act',
        onclick: () => {
          saveItem(buildCardObj());
          if (!S.words[wKey(lemma)]) setMark('learning');
          drawHead();
          if (tab === 'saved') drawList();
          toast('Saved (+5 XP)');
        },
      }, 'Save'),
      ankiBtn,
      h('button', { onclick: () => setMark('learning') }, 'Learning'),
      h('button', { onclick: () => setMark('known') }, 'Known'),
      h('button', { onclick: () => setMark('') }, 'Clear'),
      isPro && companionHealth && companionHealth.ok ? h('button', {
        title: 'Pin to per-video glossary and auto-heal matching subtitle translations',
        onclick: async () => {
          const defaultDst = latestWordGloss || '';
          const src = activeFe ? activeFe.surface : word;
          const dst = window.prompt(`Pin "${src}" in video glossary as:`, defaultDst);
          if (!dst || !dst.trim()) return;
          V.glossaryTerms = mergeGlossaryTerms(V.glossaryTerms || [], [{ src, dst: dst.trim(), note: 'pinned' }]);
          await SS_STORE.saveGlossary(curVidKey(), V.info.channelId, { videoId: curVidKey(), terms: V.glossaryTerms, updatedAt: Date.now() }, [{ src, dst: dst.trim(), note: 'pinned' }]);
          await healGlossaryTerm(src, dst.trim());
        },
      }, 'Pin') : null,
      isPro && activeFe ? h('button', {
        class: 'ss-teal',
        onclick: () => {
          concordanceTarget = { key: 'fe|' + activeFe.pattern, label: activeFe.display };
          tab = 'review';
          drawHead();
          drawList();
        },
      }, 'Concordance') : null);

    // Example Section 1: In This Video
    const needle = (activeFe ? activeFe.surface : lemma || word).toLowerCase();
    const inVidHits = [];
    const terms = [...new Set([needle, word.toLowerCase()])].filter(Boolean);
    const wholeTerm = videoCard && !['ja', 'zh', 'yue'].includes(lang) && terms.length
      ? new RegExp('(?:^|[^\\p{L}\\p{N}])(?:' +
        terms.map(term => term.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')).join('|') +
        ')(?=$|[^\\p{L}\\p{N}])', 'u') : null;
    if (V && V.lines && needle) {
      V.lines.forEach((l, idx) => {
        if (l.isInstrumental) return;
        const low = l.t.toLowerCase();
        if (wholeTerm ? wholeTerm.test(low) : terms.some(term => low.includes(term))) {
          inVidHits.push({ idx, ln: l });
        }
      });
    }
    const inVidBox = inVidHits.length
      ? h('div', { class: 'ss-ex-section' },
          h('div', { class: 'ss-ex-hdr' }, `In This Video (${inVidHits.length})`),
          ...inVidHits.slice(0, 6).map((hit) => {
            const tr = transFor(hit.ln);
            return h('div', { class: 'ss-ex-row', onclick: () => replayScene(hit.ln.s, hit.ln.s + (hit.ln.d || 3)) },
              h('span', { class: 'ss-t', style: { marginRight: '6px', opacity: '.65' } }, fmt(hit.ln.s)),
              renderHighlightedSnippet(hit.ln.t, word),
              tr ? h('div', { style: { opacity: '.72', fontSize: '11.5px', marginTop: '2px' } }, tr) : null);
          }))
      : null;

    // Example Section 2: Tatoeba Parallel Corpus Examples
    const tatoebaBox = h('div', { class: 'ss-ex-section' },
      h('div', { class: 'ss-ex-hdr' }, 'Example Sentences (Tatoeba)'),
      h('div', { style: { fontSize: '11.5px', opacity: '.68' } }, 'Searching Tatoeba…'));

    // Put Quick X-Ray + Save/Known buttons ABOVE long Wiktionary definitions for effortless usability
    // Save and Known stay up front; every other action, the dictionary links and Tatoeba sit under "More"
    const moreBtns = h('div', { class: 'ss-btns' });
    Array.from(btns.children).forEach((b) => { if (!/^(Save|Known)$/.test(b.textContent)) moreBtns.appendChild(b); });
    const moreBox = h('details', { class: 'ss-more', open: dockMoreOpen || null, ontoggle: (e) => { dockMoreOpen = e.target.open; } },
      h('summary', {}, videoCard ? 'More tools and dictionaries' : 'More: Anki, other dictionaries, example sentences'),
      moreBtns, buildExternalLinks(queryDisplay, V.lang), videoCard ? null : tatoebaBox);
    const literarySlot = h('div', {});
    globalThis.SS_LITERARY?.append(literarySlot, normLangCode(V.lang), activeFe?.surface || word, line?.t);
    const episodicSlot = h('div', {});
    const currentKey = curVidKey();
    const cuePayload = cueExplainPayload(word, lemma, line, activeFe, lineIdx);
    const watchedRows = activeFe && S.set.idiomHistory !== false
      ? bg({ op: 'getWatchedScenes', lang, pattern: activeFe.pattern, exclude: '' }).then(reply => reply.rows || [])
      : Promise.resolve([]);
    const savedEncounter = !activeFe && S.set.idiomHistory !== false
      ? SS_STORE.getStudyTraces(40).then(traces => SS_STORE.findEpisodicMemory(lemma || word,
          S.items, traces, currentKey, { lang })).catch(() => null)
      : Promise.resolve(null);
    const pastScenes = line && S.set.idiomHistory !== false ? Promise.all([watchedRows, savedEncounter]).then(([rows, mem]) => {
      const candidates = rows.length ? rows : (mem ? [{ ...mem, line: mem.contextLine }] : []);
      return selectPastScenes(candidates, currentKey, cuePayload.line);
    }) : Promise.resolve([]);
    const transfer = videoCard && globalThis.SS_TRANSFER?.match(lang, line.t, activeFe?.surface || word, charPos, currentKey, line.s);
    const transferPanel = transfer ? h('div', {class:'ss-xray'},
      h('strong', {}, transfer.lesson.kind === 'spelling' ? 'Same sound · '+transfer.lesson.reading : 'Why this meaning?'), h('p', {}, transfer.lesson.choices[transfer.clip[5] || 0]),
      h('q', {}, transfer.clip[3]), h('p', {}, transfer.clip[4]),
      h('button', {onclick: async event => {
        const button = event.currentTarget;
        const row = await SS_TRANSFER.schedule(transfer.lesson, transfer.clip);
        button.textContent = row.result ? 'Review completed' : 'In Review · ' + new Date(row.due).toLocaleDateString();
      }}, 'Test me in a week'),
      transfer.lesson.practiceClips ? h('a',{href:chrome.runtime.getURL('review.html')+'?fromVideo='+encodeURIComponent(currentKey)+'#sense-memory',target:'_blank',rel:'noopener noreferrer'},'Practise with a different scene') : null) : null;
    const askGemini = videoCard ? geminiHandoff(cuePayload, line.s) : null;
    if (activeFe && S.set.idiomHistory !== false) {
      watchedRows.then(allRows => {
        const rows = allRows.filter(row => !sameVidKey(row.videoKey, currentKey));
        if (!episodicSlot.isConnected || !allRows?.length) return;
        const sceneLink = row => {
          const part = row.videoKey.match(/_p(\d+)(?:_|$)/);
          const site = row.videoKey.startsWith('bili:') ? 'Bilibili' : 'YouTube';
          const days = Math.max(0, Math.floor((Date.now() - row.at) / 86400000));
          return h('a', { class: 'ss-episodic-pill', href: videoUrlOf(row.videoKey, row.t),
            target: '_blank', rel: 'noopener noreferrer' },
            `Watched ${days ? days + 'd ago' : 'today'} on ${site} · ${row.title}${part ? ' · Part ' + part[1] : ''} · ${fmtTs(row.t)} — “${row.line}”`);
        };
        if (rows.length) appendClean(episodicSlot, sceneLink(rows[0]));
        const choices = h('div', { class: 'ss-btns' });
        const listen = (first, second, label) => h('button', { onclick: async () => {
          video()?.pause();
          const result = await bg({ op: 'startScenePair', lang: normLangCode(V.lang), pattern: activeFe.pattern, first, second });
          if (!result.ok) toast('These scenes are unavailable.');
        } }, label);
        const updatePair = () => {
          choices.replaceChildren();
          const first = rows[0];
          const other = first && allRows.find(row => row.videoKey !== first.videoKey);
          if (other) choices.appendChild(listen(first, other, 'Hear it again · 2 scenes'));
          const literal = allRows.find(row => row.sense === 'Literal' && allRows.some(r => r.sense === 'Idiomatic' && r.videoKey !== row.videoKey));
          const idiomatic = literal && allRows.find(row => row.sense === 'Idiomatic' && row.videoKey !== literal.videoKey);
          if (idiomatic) choices.appendChild(h('details', {}, h('summary', {}, 'Same words, different meaning'),
            h('p', {}, 'Literal · ', literal.line), h('p', {}, 'Idiomatic · ', idiomatic.line),
            listen(literal, idiomatic, 'Hear both uses')));
        };
        updatePair();
        const labels = h('details', {}, h('summary', {}, 'Label how the expression was used'));
        for (const row of allRows) {
          const sense = h('select', { 'aria-label': 'Usage in ' + row.line, onchange: async () => {
            const reply = await bg({ op: 'labelScene', lang: normLangCode(V.lang), pattern: activeFe.pattern,
              videoKey: row.videoKey, t: row.t, sense: sense.value });
            if (reply.ok) { row.sense = sense.value; updatePair(); } else sense.value = row.sense || '';
          } }, ...['', 'Literal', 'Idiomatic'].map(value => h('option', { value }, value || 'Unlabelled')));
          sense.value = row.sense || '';
          labels.appendChild(h('label', {}, row.line, ' ', sense));
        }
        if (S.set.personalFrequency) {
          const recent = allRows.filter(row => row.at >= Date.now() - 30 * 86400000);
          episodicSlot.appendChild(h('p', {}, recent.length + ' scenes across ' + new Set(recent.map(row => row.videoKey)).size + ' videos in the last 30 days'));
        }
        appendClean(episodicSlot, choices, labels);
        if (rows.length > 1) appendClean(episodicSlot, h('details', {},
          h('summary', {}, 'More watched scenes (' + (rows.length - 1) + ')'), ...rows.slice(1).map(sceneLink)));
      });
    } else if (!activeFe && S.set.idiomHistory !== false) {
      savedEncounter.then(mem => {
        if (!dockEl || !episodicSlot.isConnected) return;
        if (!mem) return;
        const whenTxt = mem.daysAgo === 0 ? 'today' : `${mem.daysAgo}d ago`;
        const ctxBit = mem.contextLine ? ` — “${mem.contextLine.slice(0, 60)}”` : '';
        const url = mem.sourceUrl || (mem.videoKey ? videoUrlOf(mem.videoKey, mem.t) : '');
        const hasUrl = /^https?:\/\//i.test(url);
        appendClean(episodicSlot, h(hasUrl ? 'a' : 'div', {
          class: 'ss-episodic-pill',
          title: mem.contextLine || mem.title,
          href: hasUrl ? url : null, target: hasUrl ? '_blank' : null, rel: hasUrl ? 'noopener noreferrer' : null,
        }, `↺ Seen ${whenTxt}${mem.site ? ' on ' + mem.site : ''} in “${String(mem.title || '').slice(0, 44)}”${ctxBit}`));
      }).catch(() => {});
    }

    let grammar = null;
    if (videoCard) {
      const pattern = lang === 'en' && !activeFe && line && englishCueGrammar(word, lemma, line, charPos);
      grammar = pattern ? h('p', { class: 'ss-video-pattern', hidden: '' }, h('b', {}, 'Grammar · '), pattern) : null;
      const source = cleanCueText(line.t);
      const focusText = sceneSurface || activeFe?.surface || word;
      const sceneExample = (cue, idx, current = false) => {
        const cueText = cleanCueText(cue.t);
        const gloss = transFor(cue);
        const reading = V.annotations?.[idx];
        const mode = getReadingAidMode();
        const snippet = h('span', { class: 'ss-video-example-text' });
        let offset = 0;
        const start = cueText.toLowerCase().indexOf(focusText.toLowerCase());
        for (const token of mode !== 'off' && start >= 0 ? reading || [] : []) {
          if (!token.orig) continue;
          const at = cueText.indexOf(token.orig, offset);
          if (at === -1) continue;
          const rd = pickTokenReading(token, mode);
          const end = at + token.orig.length;
          const highlighted = at < start + focusText.length && end > start;
          if (at > offset) snippet.append(cueText.slice(offset, at));
          const entry = h('span', { class: highlighted ? 'ss-ex-hi' : '' });
          if (Array.isArray(rd)) {
            for (const [text, kana] of rd) entry.append(kana ? h('ruby', {}, text, h('rt', {}, kana)) : text);
          } else entry.append(rd ? h('ruby', {}, token.orig, h('rt', {}, rd)) : token.orig);
          snippet.append(entry);
          offset = end;
        }
        if (offset < cueText.length) snippet.append(renderHighlightedSnippet(cueText.slice(offset), focusText));
        return h('button', { class: 'ss-video-example', 'aria-label': current ? 'Hear this line again' : null, onclick: () => {
          releaseDockPause();
          replayScene(cue.s, cue.e ?? (cue.s + (cue.d || 3)));
        } }, h('span', { class: 'ss-video-example-time' }, '▶ ', fmt(cue.s)),
          snippet, gloss ? h('span', { class: 'ss-video-example-tr' }, gloss) : null);
      };
      const otherCues = inVidHits.filter(hit => hit.ln !== line);
      const currentExamples = (limit, current) => h('div', { class: 'ss-video-scenes' },
        h('h5', {}, 'From this video'), sceneExample(line, lineIdx, current),
        ...otherCues.slice(0, limit).map(({idx, ln}) => sceneExample(ln, idx)));
      const meaning = h('section', { 'aria-label': 'Meaning' },
        sceneSense ? h('div', {class: 'ss-xray'}, h('div', {class: 'ss-xray-title'}, 'Meaning in this line · English'),
          h('div', {class: 'ss-video-context-text'}, sceneSense)) : null,
        transferPanel, body, h('div', { class: 'ss-video-actions' }, btns, askGemini),
        currentExamples(2, true), grammar, sceneSense ? null : xrayBox,
        sceneSense ? null : contrastBox, literarySlot, episodicSlot, sceneSense ? null : deceptivePill, spokenSlot, matchTraceEl, moreBox);
      const examples = h('section', { hidden: '', 'aria-label': 'Examples' },
        currentExamples(5, false),
        h('details', { class: 'ss-more', ontoggle: (e) => { if (e.target.open) loadExamples(); } },
          h('summary', {}, 'More examples by word match'), tatoebaBox));
      const study = globalThis.SS_LOCAL_STUDY?.create(document, {
        modes: ['explain', 'examples', 'grammar'],
        request: async (mode) => {
          if (!companionHealth?.plamo) await bg({ op: 'wakeCompanion' });
          if (!study.isConnected || curVidKey() !== currentKey) return null;
          return comp('/explain', { ...cuePayload, gloss_only: false, mode }, 'POST', 120000);
        },
      });
      const studyPanel = study ? h('section', { hidden: '', 'aria-label': 'Local study' },
        h('p', { class: 'ss-video-study-quote' }, renderHighlightedSnippet(source, activeFe?.surface || word)), study) : null;
      const views = [['Meaning', meaning], ['Examples', examples], ['Study', studyPanel]].filter(([, panel]) => panel);
      const nav = h('div', { class: 'ss-video-dict-nav' }, ...views.map(([label, panel]) => h('button', {
        'aria-pressed': String(panel === meaning),
        onclick: (event) => {
          for (const [, section] of views) section.hidden = section !== panel;
          for (const button of nav.children) button.setAttribute('aria-pressed', String(button === event.currentTarget));
        },
      }, label)));
      appendClean(dockEl, hdr, nav, meaning, examples, studyPanel);
    } else {
      appendClean(dockEl, hdr, literarySlot, episodicSlot, deceptivePill, spokenSlot, matchTraceEl, contrastBox, xrayBox, btns, body, inVidBox, moreBox);
    }

    const readingHint = line ? bg({op:'highlightsHint',lang,line:line.t,
      forms:transfer ? [transfer.clip[2], ...(transfer.lesson.form.includes(' / ') ? [] : [transfer.lesson.form])] :
        activeFe ? [activeFe.surface,activeFe.display,activeFe.pattern] : [word,lemma]})
      .then(reply=>reply?.hint || null).catch(()=>null) : Promise.resolve(null);
    const hintOnly = () => {
      const full = Array.from(dockEl.children).filter(node => node !== hdr);
      const old = full.map(node => node.hidden);
      for (const node of full) node.hidden = true;
      readingBadge.hidden = true;
      const output = h('div', { 'aria-live': 'polite' });
      const hint = h('div', { class: 'ss-scene-hints' }, h('strong', {}, 'Give me a hint'), h('div', { class: 'ss-btns' },
        h('button', { onclick: () => {
          const fromCue = Array.isArray(cueReading) ? cueReading.map(([text, kana]) => kana || text).join('') : cueReading;
          output.textContent = feMeta?.reading || (!activeFe && fromCue) || readingBadge.dataset.reading || 'No reading available for this entry.';
        } }, 'Reading'),
        (activeFe || transfer) && S.set.idiomHistory !== false ? h('button', {onclick: async () => {
          const pattern = activeFe?.pattern || (transfer.lesson.form.includes(' / ') ? transfer.clip[2] : transfer.lesson.form);
          const reply = await bg({op:'getWatchedScenes',lang,pattern,exclude:''});
          const row = reply?.rows?.find(r => r.line && (r.line !== line?.t) && (!sameVidKey(r.videoKey,currentKey) || Math.abs(r.t-line.s)>2));
          output.replaceChildren();
          if (row) output.append(h('q', {}, row.line), ' ', h('a', {href:videoUrlOf(row.videoKey,row.t),
            target:'_blank',rel:'noopener noreferrer'}, 'Replay ' + row.title + ' · ' + fmtTs(row.t)));
          else output.textContent = 'No earlier watched scene for this expression yet.';
        }}, 'From my watching history') : null,
        line ? h('button', { onclick: () => { releaseDockPause(); replayScene(line.s, line.e ?? (line.s + (line.d || 3))); } }, 'Hear the line') : null,
        h('button', { onclick: () => {
          const dictionaryGloss = offlineGloss || pane.querySelector('li')?.textContent;
          output.textContent = latestWordGloss || (dictionaryGloss && 'Dictionary meaning · ' + dictionaryGloss) || 'Meaning unavailable. Open the dictionary for sources.';
        } }, 'Meaning'),
        h('button', { onclick: event => {
          event.stopPropagation(); hint.remove(); full.forEach((node, i) => { node.hidden = old[i]; }); readingBadge.hidden = false; hintButton.hidden = false;
        } }, 'Full dictionary')), output);
      readingHint.then(row=>{
        if (!row || !hint.isConnected) return;
        const use = h('button',{onclick:()=>{
          output.replaceChildren(h('strong',{},'From your highlights'),h('blockquote',{},row.line),
            h('a',{href:row.url,target:'_blank',rel:'noopener noreferrer'},row.title || 'Open original'),
            h('p',{},'What does the expression mean in this subtitle?'));
        }},'From my highlights');
        hint.querySelector('.ss-btns').prepend(use);
        use.click();
      });
      hintButton.hidden = true;
      dockEl.appendChild(hint);
    };
    const hintButton = h('button', { class: 'ss-quiet', onclick: hintOnly }, 'Hint');
    (videoCard ? btns : hdr).appendChild(hintButton);
    readingHint.then(row=>{
      if (row && hintButton.isConnected) hintButton.textContent='Hint from my highlights';
    });
    if (S.set.hintFirst) hintOnly();

    // Show bundled dictionary results first, then add the queried sources.
    const tries = [...new Set([activeFe && activeFe.display, lemma, word.toLowerCase(), word].filter(Boolean))];
    const srcs = [];
    const tabs = h('div', { class: 'ss-dict-tabs' });
    const pane = h('div', { class: 'ss-dict-pane' });
    let activeShownId = '';
    const show = (src) => {
      activeShownId = src.id;
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('ss-act', b.dataset.id === src.id));
      pane.textContent = '';
      const dictRd = (src.entries.find((e) => e.reading) || {}).reading || '';
      const lemmaShown = videoCard && !activeFe && !sceneHead;
      if (lemmaShown) headNode.textContent = src.entries[0]?.head || headTitle;
      const cueReadingForHead = !lemmaShown || headNode.textContent === word ? cuePronunciation : '';
      const feHanjaOrRd = (feMeta && (feMeta.hanja || feMeta.reading)) || '';
      const rd = sceneReading || (dictRd && feHanjaOrRd && dictRd !== feHanjaOrRd
        ? `${feHanjaOrRd} · ${dictRd}`
        : (cueReadingForHead || dictRd || feHanjaOrRd));
      readingBadge.dataset.reading = dictRd;
      readingBadge.textContent = rd;
      readingBadge.style.display = rd && rd !== queryDisplay ? '' : 'none';
      const other = h('details', { class: 'ss-dict-more' }, h('summary', {}, 'Other dictionary senses'));
      src.entries.forEach((e, i) => {
        const head = e.head && e.head.toLowerCase() !== word.toLowerCase() && !(activeFe && e.head.toLowerCase() === String(activeFe.display || '').toLowerCase()) ? e.head : '';
        const label = [e.pos, head, i > 0 && e.reading && e.reading !== rd ? e.reading : ''].filter(Boolean).join(' · ');
        const defs = (e.defs || []).slice(0, i === 0 ? 4 : 3);
        const examples = (e.examples || []).slice(0, 1);
        if (!defs.length && !examples.length) return;
        const target = i === 0 ? pane : other;
        if (label) appendClean(target, h('div', { class: 'ss-pos' }, label));
        const primary = i === 0 ? defs.slice(0, 1) : defs;
        if (primary.length) appendClean(target, h('ol', {}, ...primary.map((d) => h('li', {}, d))));
        for (const ex of examples) appendClean(target, h('div', { class: 'ss-wikt-ex' }, `"${ex}"`));
        if (i === 0 && defs.length > 1) {
          appendClean(other, h('ol', { start: 2 }, ...defs.slice(1).map((d) => h('li', {}, d))));
        }
      });
      if (other.children.length > 1) appendClean(pane, other);
      // Drop the expression box's 'Meaning:' line when the dictionary already shows the same sense.
      const firstDef = String(((src.entries[0] || {}).defs || [])[0] || '').trim().toLowerCase();
      dockEl.querySelectorAll('.ss-fe-meaning').forEach((fm) => {
        fm.hidden = Boolean(firstDef) && fm.textContent.toLowerCase().includes(firstDef.slice(0, 40));
        const box = fm.closest('.ss-contrast');
        if (box && fm.hidden && box.children.length <= 2 && !box.querySelector('.ss-eq, [class*="eq"]')) box.classList.add('ss-contrast-slim');
      });
      appendClean(pane, h('div', { class: 'ss-dict-credit', title: `${src.name}${src.note ? ' · ' + src.note : ''}${src.licence ? ' · ' + src.licence : ''}` },
        `${src.name}${src.licence ? ' · ' + src.licence : ''}`));
    };
    const addTab = (src) => [...tabs.children].some((b) => b.textContent === src.name) ? null : appendClean(tabs, h('button', {
      class: 'ss-dict-tab', 'data-id': src.id, title: src.note || src.name,
      onclick: () => { S.set.dictSrc = src.id; save('set'); show(src); },
    }, src.name));
    const pick = () => srcs.find((s) => s.id === S.set.dictSrc) || srcs[0];
    const checkGrammar = () => {
      if (grammar && srcs.some((src) => src.entries.some((entry) => /^(?:v|verb|v\.)(?:$|\s)/i.test(entry.pos || '')))) {
        grammar.hidden = false;
      }
    };
    const mergeRemote = () => {
      defineAll(tries, false, false).then((full) => {
        if (!dockEl || !body.isConnected) return;
        const incoming = (full && full.sources) || [];
        let added = 0;
        for (const s of incoming) {
          if (s && s.id && !srcs.some((x) => x.id === s.id)) {
            srcs.push(s);
            addTab(s);
            added++;
          }
        }
        checkGrammar();
        if (!srcs.length) {
          body.textContent = 'No entry in the local dictionaries or Wiktionary.';
          return;
        }
        if (added > 0 && (!pane.isConnected || !activeShownId)) {
          body.textContent = '';
          appendClean(body, srcs.length > 1 ? tabs : null, pane);
          show(pick());
        } else if (srcs.length > 1 && !tabs.isConnected) {
          body.insertBefore(tabs, pane);
          const wanted = srcs.find((s) => s.id === S.set.dictSrc);
          if (wanted && wanted.id !== activeShownId) show(wanted);
          else show(pick());
        }
      });
    };
    defineAll(tries, true, true).then((res0) => {
      if (!dockEl || !body.isConnected) return;
      const localList = (res0 && res0.sources) || [];
      if (localList.length) {
        body.textContent = '';
        for (const s of localList) { srcs.push(s); addTab(s); }
        checkGrammar();
        appendClean(body, srcs.length > 1 ? tabs : null, pane);
        show(pick());
      } else {
        body.textContent = 'Looking up Wiktionary / local companion…';
      }
      mergeRemote();
    });

    // Async 2: Companion Context & Subtext X-Ray
    if (!sceneSense) {
      const baseKey = cueExplainCacheKey(cuePayload);
      const offerLookup = (message, label) => {
        xrayBox.style.display = '';
        xrayBox.textContent = '';
        appendClean(xrayBox, h('span', {}, message + ' '), h('button', {
          onclick: (event) => {
            event.stopPropagation();
            lookup(true);
          },
        }, label));
      };
      const lookup = async (manual = false) => {
        if (!xrayBox.isConnected) return;
        xrayBox.style.display = '';
        xrayBox.textContent = 'Finding the meaning in this line…';
        if (manual && !companionHealth?.plamo) {
          await bg({ op: 'wakeCompanion' });
          if (!xrayBox.isConnected) return;
        }
        const scenes = await pastScenes;
        if (!xrayBox.isConnected || V == null || curVidKey() !== currentKey) return;
        const history = S.set.idiomHistory !== false ? scenes.map(row => ({
          line: cleanCueText(row.line).slice(0, 360),
          sense: row.sense === 'Literal' || row.sense === 'Idiomatic' ? row.sense.toLowerCase() : 'unlabelled',
        })) : [];
        const payload = history.length ? { ...cuePayload, past_scenes: history } : cuePayload;
        const cacheKey = history.length ? cueExplainCacheKey(payload) : baseKey;
        const cached = sceneGlossCache.get(cacheKey);
        const ex = cached || await comp('/explain', activeFe ? { ...payload, gloss_only: false } : payload, 'POST', 120000);
        if (!dockEl || !xrayBox.isConnected) return;
        if (!ex || !ex.ok || ex.contextual !== true || (videoCard && !ex.word_gloss)) {
          if (videoCard) offerLookup(ex?.error || 'Contextual explanation unavailable.', 'Retry');
          else xrayBox.style.display = 'none';
          return;
        }
        latestWordGloss = ex.word_gloss || '';
        if (!cached && videoCard) {
          if (sceneGlossCache.size >= 128) sceneGlossCache.delete(sceneGlossCache.keys().next().value);
          sceneGlossCache.set(cacheKey, ex);
        }
        xrayBox.textContent = '';
        if (videoCard) {
          appendClean(xrayBox, h('div', { class: 'ss-xray-title' }, 'Meaning in this line · Local AI'),
            h('div', { class: 'ss-video-context-text', title: latestWordGloss }, latestWordGloss),
            activeFe && ex.subtext_note ? h('p', {}, ex.subtext_note) : null,
            ex.history_count ? h('small', {}, `Past scenes provided: ${ex.history_count}`) : null);
          return;
        }
        appendClean(xrayBox,
          h('div', { class: 'ss-xray-title' }, 'Meaning in this line'),
          ex.word_gloss ? h('div', {}, h('b', {}, 'Meaning: '), ex.word_gloss) : null,
          ex.line_trans ? h('div', { style: { marginTop: '2px', opacity: '.88' } }, h('b', {}, 'Scene: '), ex.line_trans) : null,
          ex.subtext_note ? h('div', { style: { marginTop: '2px', opacity: '.78', fontSize: '11.5px' } }, ex.subtext_note) : null);
      };
      if (sceneGlossCache.has(baseKey)) lookup();
      else if (companionHealth?.plamo) setTimeout(lookup, 220);
      else if (videoCard) offerLookup('Local context lookup is offline.', 'Explain this line');
    }

    // Async 3: Tatoeba Parallel Corpus
    let examplesRequested = false;
    const loadExamples = () => {
      if (examplesRequested) return;
      examplesRequested = true;
      chrome.runtime.sendMessage({ op: 'examples', query: queryDisplay, lang: V.lang, tl: S.set.tl || 'en' }, (exRes) => {
        if (!dockEl || !tatoebaBox.isConnected) return;
        const kids = [...tatoebaBox.children];
        kids.slice(1).forEach((k) => k.remove());
        if (!exRes || !exRes.ok || !exRes.items || !exRes.items.length) {
          appendClean(tatoebaBox, h('div', { style: { fontSize: '11.5px', opacity: '.65' } }, 'No matching Tatoeba sentences for this form.'));
          return;
        }
        exRes.items.slice(0, videoCard ? 2 : 4).forEach((item) => {
          appendClean(tatoebaBox, h(videoCard ? 'button' : 'div', {
            class: videoCard ? 'ss-video-example' : 'ss-ex-row', onclick: () => speakWord(item.text, V.lang),
          }, renderHighlightedSnippet(item.text, queryDisplay),
          item.trans ? h('span', { style: { display: 'block', opacity: '.72', fontSize: '11.5px', marginTop: '2px' } }, item.trans) : null));
        });
      });
    };
    if (!videoCard) loadExamples();
  };

  // ---- Playback helpers ----
  const subOff = (cueStart = -Infinity) => {
    let offset = V?.subOffset || 0;
    for (const point of V?.syncPoints || []) {
      if (point.start > cueStart) break;
      offset += point.delta;
    }
    return offset;
  };
  const persistSync = (anchor, offset) => {
    if (!V?.syncStoragePrefix) return;
    const key = V.syncStoragePrefix + anchor;
    const write = offset ? chrome.storage.local.set({[key]:offset}) : chrome.storage.local.remove(key);
    write.catch(()=>toast('Could not save subtitle timing on this device.'));
  };
  const changeGlobalSync = step => {
    V.subOffset = step === null ? 0 : (V.subOffset || 0) + step;
    persistSync('global', V.subOffset);
    drawHead();
    if (settingsOpen) drawSettings();
  };
  const loadTrackSync = async (view, track) => {
    const prefix = 'ss_sync:' + JSON.stringify([view.videoKey, track.id || view.trackKey]) + ':';
    view.syncStoragePrefix = prefix;
    const starts = [...new Set(view.lines.map(l=>l.s))].sort((a,b)=>a-b);
    const keys = [prefix+'global', ...starts.map(s=>prefix+s)];
    const saved = await chrome.storage.local.get(keys).catch(()=>({}));
    if (V !== view || view.syncStoragePrefix !== prefix) return;
    view.subOffset = Number.isFinite(saved[keys[0]]) ? saved[keys[0]] : 0;
    const points = [];
    for (let i=0;i<starts.length;i++) {
      const delta = saved[keys[i+1]];
      if (Number.isFinite(delta) && delta && (!i || starts[i]+delta > starts[i-1])) {
        points.push({start:starts[i],delta});
      }
    }
    view.syncPoints = points;
  };
  const changeSectionSync = step => {
    const start = V?.syncAnchor;
    if (!Number.isFinite(start)) return;
    const points = (V.syncPoints || []).filter(p => p.start !== start);
    const delta = step === null ? 0 : ((V.syncPoints || []).find(p => p.start === start)?.delta || 0) + step;
    if (delta) points.push({start,delta});
    const previous = V.syncPoints;
    V.syncPoints = points.sort((a,b)=>a.start-b.start);
    if (V.lines.some((line,i,all)=>i && line.s > all[i-1].s &&
        line.s + subOff(line.s) <= all[i-1].s + subOff(all[i-1].s))) {
      V.syncPoints = previous;
      toast('This change would move a caption before the previous one.');
      return;
    }
    persistSync(start,delta);
    drawSettings(); drawHead();
  };
  const seek = (t, endAt = -1, anchor = t) => {
    const s = getActiveSite();
    const v = video();
    if (!v && !(s && s.id === 'nf')) return;
    const off = subOff(anchor);
    const targetSec = Math.max(0, t + off);
    clipStopAt = endAt > 0 ? endAt + subOff(endAt - 0.000001) : -1;
    if (s && typeof s.seek === 'function') s.seek(targetSec);
    else if (v) v.currentTime = targetSec + 0.01;
    if (v && v.paused && v.play) v.play()?.catch?.(() => {});
  };

  let heldSpeed = null;
  const restoreHeldSpeed = () => {
    if (!heldSpeed) return;
    const { media, rate } = heldSpeed;
    heldSpeed = null;
    media.playbackRate = rate;
  };
  window.addEventListener('blur', restoreHeldSpeed);
  window.addEventListener('pointerup', restoreHeldSpeed, true);
  window.addEventListener('pointercancel', restoreHeldSpeed, true);
  window.addEventListener('keyup', event => {
    if (event.key === ' ' || event.key === 'Enter') restoreHeldSpeed();
  }, true);
  const holdSlow = event => {
    if (heldSpeed || (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key))) return;
    const media = video();
    if (!media) return;
    event.preventDefault();
    heldSpeed = {media, rate:media.playbackRate};
    media.playbackRate = Math.min(media.playbackRate, 0.75);
  };
  const replayScene = (t, endT) => seek(Math.max(0, t - 0.3), endT + 0.5, t);
  let repeatSession = null;
  const clearRepeatSession = (resumeGap=false) => {
    const media = resumeGap && repeatSession?.clearGap && repeatSession.view === V ? video() : null;
    repeatSession?.clearGap?.();
    repeatSession = null;
    if (media?.paused) media.play().catch(()=>{});
  };
  const runRepeatSection = (v, mediaTime) => {
    const first = loopRange?.startLi ?? loopIdx;
    const last = loopRange?.endLi ?? loopIdx;
    if (!V.lines[first] || !V.lines[last]) { clearRepeatSession(); return false; }
    if (repeatSession?.view !== V || repeatSession.first !== first || repeatSession.last !== last) {
      clearRepeatSession();
      repeatSession = {view:V,first,last,passes:0,clearGap:null};
    }
    const state = repeatSession;
    const pad = Number(S.set.repeatPadding ?? 0.25);
    const start = V.lines[first].s;
    const end = lineEnd(last);
    const mediaEnd = Math.min(v.duration || Infinity,end + subOff(V.lines[last].s) + pad);
    if (state.clearGap || v.seeking || (v.paused && !v.ended) || mediaTime < mediaEnd-0.05) return false;
    state.passes++;
    if (Number(S.set.repeatCount) > 0 && state.passes >= Number(S.set.repeatCount)) {
      loopIdx = -1; loopRange = null; clearRepeatSession(); drawHead(); drawList();
      return false;
    }
    const again = () => seek(Math.max(0,start-pad), -1, start);
    if (!S.set.repeatSpeakingGap) { again(); return true; }
    v.pause();
    const interrupt = () => { loopIdx=-1; loopRange=null; clearRepeatSession(); drawHead(); drawList(); };
    const timeout = setTimeout(()=>{
      state.clearGap();
      if (V===state.view && repeatSession===state && !V.site?.isAd?.() && video()===v) again();
    }, Math.max(0.3,(end-start)/(v.playbackRate || 1))*1000);
    state.clearGap = () => {
      clearTimeout(timeout);
      v.removeEventListener('play',interrupt);
      v.removeEventListener('seeking',interrupt);
      state.clearGap=null;
    };
    v.addEventListener('play',interrupt);
    v.addEventListener('seeking',interrupt);
    return true;
  };

  // ---- Companion actions: Prepass, Self-Healing Glossary, PLaMo MT, Vulkan Local ASR ----
  const mergeGlossaryTerms = (a, b) => {
    const m = new Map();
    for (const t of [...a, ...b]) if (t && t.src) m.set(t.src.toLowerCase(), t);
    return [...m.values()];
  };

  const trimGlossHint = (g) => {
    const s = String(g || '').replace(/\(literally:[^)]*\)/gi, '').trim();
    if (!s) return '';
    const first = s.split(/[；;]/)[0].trim();
    return first.length > 68 ? first.slice(0, 65) + '…' : first;
  };

  // Extract best localized target-language equivalent from extra.eq (resolving KRDict multi-clause strings & fe_zh chengyu).
  const pickTargetEq = (fe, tlCode) => {
    const tlNorm = normLangCode(tlCode || 'en');
    const tlBase = String(tlCode || 'en').toLowerCase().split(/[-_]/)[0];
    const eq = fe && fe.eq;
    if (eq && typeof eq === 'object') {
      const raw = eq[tlCode] || eq[tlNorm] || eq[tlBase] || (tlNorm === 'yue' ? eq.zh : null);
      if (raw) {
        if (tlNorm === 'zh' || tlNorm === 'yue') {
          const zhHit = (fe && fe._zhEq) || lookupZhChengyu(raw);
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
    // For Cantonese idioms translated into Mandarin, glossZh holds the localized Mandarin equivalent
    if ((tlNorm === 'zh' || tlBase === 'zh') && /^Cantonese/i.test(fe.type || '') && fe.glossZh) {
      return trimGlossHint(fe.glossZh);
    }
    return '';
  };

  // Build per-slice glossary combining user/channel pins + matched formulaic expressions (meaning + extra.eq idiom hints).
  // Instruction-following models (Index-Translate, Hy-MT, Qwen 4B+, Big-LLM) get both localized equivalent and meaning;
  // PLaMo's [plamo-translate] glossary template gets clean target substitution strings so parentheticals never leak into output.
  const buildSliceGlossary = (sIdx, eIdx, targetLang, useBig = false) => {
    const glMap = new Map();
    for (const g of (V && V.glossaryTerms) || []) {
      if (g && g.src && g.dst) glMap.set(g.src.toLowerCase(), { src: g.src, dst: g.dst });
    }
    if (!V || !V.analysis) return [...glMap.values()];
    const tlCode = String(targetLang || S.set.tl || 'en').toLowerCase();
    const curModel = String(S.set.mtModel || 'plamo-2b').toLowerCase();
    const isRichPromptModel = Boolean(useBig) || /^(index|hy|qwen3\.5-(4b|9b)|qwen2)/.test(curModel);
    const feByPat = new Map((V.analysis.allFEs || []).map((f) => [f.pattern, f]));
    const lm = V.analysis.lineMatches || [];
    const lo = Math.max(0, sIdx || 0);
    const hi = Math.min(lm.length - 1, eIdx != null ? eIdx : lm.length - 1);
    for (let i = lo; i <= hi; i++) {
      for (const hit of lm[i] || []) {
        const fe = feByPat.get(hit.pattern) || hit;
        const bkt = fe.bucket || (SS_IDIOMS.classifyLayer ? SS_IDIOMS.classifyLayer(fe.layer, fe.type) : 'idiom');
        if (bkt === 'colloc') continue; // Skip weak/transparent collocations so real idioms keep the 12-term line budget
        const pie = V.pieMap && V.pieMap[fe.pattern];
        if (pie && pie.usage === 'literal') continue;

        const eqTarget = pickTargetEq(fe, tlCode);
        const rawMeaning = (pie && pie.idiomatic_gloss) || bestFeMeaning(fe, tlCode);
        const meaning = trimGlossHint(rawMeaning);
        if (!eqTarget && !meaning) continue;

        const isGappedFrame = bkt === 'frame' && /[….*XY]/.test(fe.display || '');
        if (isGappedFrame && !isRichPromptModel) continue; // Avoid whole-span literal replacement on slot frames in PLaMo

        let dst = '';
        if (isRichPromptModel) {
          if (isGappedFrame) {
            dst = `[pattern ${fe.display}: ${eqTarget ? eqTarget + (meaning && meaning !== eqTarget ? ' — ' + meaning : '') : meaning}]`;
          } else if (eqTarget && meaning && eqTarget.toLowerCase() !== meaning.toLowerCase()) {
            dst = `${eqTarget} (idiom meaning: ${meaning})`;
          } else {
            dst = eqTarget || `${meaning} (idiom)`;
          }
        } else {
          dst = eqTarget || meaning;
        }

        const surf = hit.surface || fe.display;
        if (surf && dst && !glMap.has(surf.toLowerCase())) {
          glMap.set(surf.toLowerCase(), { src: surf, dst });
        }
      }
    }
    return [...glMap.values()].slice(0, 60);
  };

  const healGlossaryTerm = async (src, dst) => {
    if (!V || !V.lines || !V.lines.length || !src || !dst) return;
    const lowSrc = src.toLowerCase();
    const affected = new Set();
    V.lines.forEach((ln, idx) => {
      if (!ln.isInstrumental && ln.t.toLowerCase().includes(lowSrc)) {
        affected.add(idx);
        if (idx > 0 && !V.lines[idx - 1].isInstrumental) affected.add(idx - 1);
        if (idx + 1 < V.lines.length && !V.lines[idx + 1].isInstrumental) affected.add(idx + 1);
      }
    });
    if (!affected.size) { drawList(); return; }

    // Group contiguous indices into clean clause slices
    const sorted = [...affected].sort((a, b) => a - b);
    const spans = [];
    for (const idx of sorted) {
      const last = spans[spans.length - 1];
      if (!last || idx > last[1] + 1 || (idx - last[0]) >= 4) spans.push([idx, idx]);
      else last[1] = idx;
    }

    const tl = S.set.tl || 'ja';
    const gl = buildSliceGlossary(0, V.lines.length - 1, tl);
    if (!V.tr || V.tr.length !== V.lines.length) {
      V.tr = V.lines.map((l) => ({ s: l.s, d: l.d || 0, t: transFor(l) }));
      V.sameTiming = true;
    }

    let updatedCount = 0;
    await Promise.all(spans.map(async ([sIdx, eIdx]) => {
      const slice = V.lines.slice(sIdx, eIdx + 1).map((l) => ({ s: l.s, d: l.d || 0, t: l.t }));
      const r = await comp('/translate', { lines: slice, target_lang: tl, glossary: gl, merge_clauses: true, model: S.set.mtModel || 'plamo-2b', device: S.set.mtDevice || 'gpu' }, 'POST', 30000);
      if (r && r.ok && Array.isArray(r.translations)) {
        r.translations.forEach((trText, offset) => {
          const gi = sIdx + offset;
          if (V.tr[gi] && trText) {
            V.tr[gi].t = trText;
            updatedCount++;
          }
        });
      }
    }));

    V.trProv = 'PLaMo+Glossary';
    drawHead();
    drawList();
    if (V.cur >= 0) drawLine(V.cur);
    toast(`Healed ${updatedCount} lines with "${src} → ${dst}"`);
  };

  const runPrepass = async () => {
    if (!V || !V.analysis) return;
    toast('Building per-video glossary & idiom check…');
    const contextMap = {};
    for (const c of V.analysis.glossaryCandidates || []) {
      const hit = V.lines.find((l) => l.t.includes(c));
      if (hit) contextMap[c] = hit.t;
    }
    let pieList = Array.isArray(V.analysis.pieInstances) ? V.analysis.pieInstances.slice() : [];
    if (pieList.length < 10 && Array.isArray(V.analysis.allFEs)) {
      const seenPat = new Set(pieList.map((p) => p.pattern));
      const sortedFes = V.analysis.allFEs.slice().sort((a, b) => (b.litRisk ? 1 : 0) - (a.litRisk ? 1 : 0));
      for (const fe of sortedFes) {
        if (pieList.length >= 10) break;
        if (!fe || seenPat.has(fe.pattern) || !Array.isArray(fe.occurrences) || !fe.occurrences.length) continue;
        seenPat.add(fe.pattern);
        const o0 = fe.occurrences[0];
        pieList.push({ pattern: fe.pattern, display: fe.display, surface: o0.surface || fe.display, line: o0.line || '' });
      }
    }
    const res = await comp('/prepass', {
      videoId: V.info.videoId,
      title: V.info.title || '',
      author: V.info.author || '',
      description: V.info.description || '',
      source_lang: V.lang,
      target_lang: S.set.tl || 'ja',
      candidates: V.analysis.glossaryCandidates,
      sample_lines: V.lines.filter((l) => !l.isInstrumental).slice(0, 8).map((l) => l.t),
      pie_instances: pieList,
      context_map: contextMap,
    });
    if (!res || !res.ok) { toast('Companion not running on ' + S.set.companionUrl); return; }
    const merged = mergeGlossaryTerms(V.glossaryTerms || [], res.terms || []);
    V.glossaryTerms = merged;
    const pieMap = Object.assign({}, V.pieMap || {});
    for (const p of res.pie || []) if (p && p.pattern) pieMap[p.pattern] = p;
    V.pieMap = pieMap;
    if (V.analysis && Array.isArray(V.analysis.lineMatches)) {
      const litPats = new Set(Object.values(pieMap).filter((p) => p && p.usage === 'literal').map((p) => p.pattern));
      if (litPats.size) {
        for (const hits of V.analysis.lineMatches) {
          for (const m of hits || []) {
            if (m && litPats.has(m.pattern)) {
              m.litRisk = true;
              m.stage2Literal = true;
            }
          }
        }
        if (V.cur >= 0) drawLine(V.cur);
      }
    }
    if (Array.isArray(res.extra_fes) && res.extra_fes.length) V.extraFes = res.extra_fes;
    V.drills = null;
    V.glossaryMeta = { domain: res.domain || '', register: res.register || '', mode: res.mode || '' };
    await SS_STORE.saveGlossary(curVidKey(), V.info.channelId, {
      videoId: V.info.videoId,
      domain: V.glossaryMeta.domain,
      register: V.glossaryMeta.register,
      terms: merged,
      pieMap,
      extraFes: V.extraFes || [],
      updatedAt: Date.now(),
    }, merged);
    drawList();
    toast(`Glossary ready (${merged.length} terms · ${res.mode})`);
  };

  const runPlamoTranslate = async (silent = false, myRun = run, forceBig = false) => {
    if (!V || !V.lines.length || !S.set.tl) return;
    if (sameTranslationLanguage(S.set.tl, V.yueByText ? 'yue' : V.lang)) return;
    const tl = S.set.tl;
    const subSvc = (S.set.sceneServices && S.set.sceneServices.subtitle) || 'auto';
    const subLocalMap = { local_plamo2b: 'plamo-2b', local_index2b: 'index-2b', local_gemma_e4b: 'gemma-e4b', local_hymt7b: 'hy-mt2-7b' };
    const chosenModel = subLocalMap[subSvc] || S.set.mtModel || 'plamo-2b';
    const useBig = forceBig || (!!S.set.useBigLlm && !!(S.set.llmUrl || (companionHealth && companionHealth.big_llm_configured)));
    const provKey = useBig ? `big:${S.set.llmModel || 'api'}` : (subSvc !== 'auto' && !subLocalMap[subSvc] ? `svc:${subSvc}` : chosenModel);
    const vid = V.info && V.info.videoId;

    // 0. Check IndexedDB translation cache first (instant replay for Big-LLM or 2B tracks)
    const vStorageKey = curVidKey() || vid;
    if (!forceBig && vStorageKey && SS_STORE.getTrCache) {
      const cached = await SS_STORE.getTrCache(vStorageKey, tl, provKey);
      if (myRun !== run || !V) return;
      if (cached && cached.lines.length === V.lines.length) {
        const aiLines = V.lines.map((l, idx) => ({ s: l.s, d: l.d, t: cached.lines[idx] || '' }));
        if (V.trProv === 'Human' && silent && !S.set.preferAiOverHuman) { V.aiTr = aiLines; V.aiTrProv = cached.prov || provKey; }
        else { if (V.trProv === 'Human' && !V.humanTr) V.humanTr = V.tr; V.tr = aiLines; V.sameTiming = true; V.trProv = cached.prov || provKey; }
        V._aiTranslatedFor = tl + '|' + provKey;
        drawHead(); drawList(); if (V.cur >= 0) drawLine(V.cur);
        return;
      }
    }

    if (!silent) toast(useBig ? 'Pre-translating full script with Big LLM…' : (subSvc === 'free_web' ? 'Translating via Web MT…' : (subSvc === 'custom_openai' ? 'Translating via Custom API…' : 'Translating with AI…')));
    // Merge user glossary + matched FE idiom hints (meaning + extra.eq) across the full track
    const gl = buildSliceGlossary(0, V.lines.length - 1, tl, useBig);

    let res = null;
    if (useBig || (subSvc !== 'free_web' && subSvc !== 'browser_api' && subSvc !== 'custom_openai' && companionHealth && companionHealth.plamo)) {
      res = await comp('/translate', {
        lines: V.lines.map((l) => ({ s: l.s, d: l.d || 0, t: l.t })),
        target_lang: tl,
        glossary: gl,
        merge_clauses: S.set.mergeClauses !== false,
        title: (V.info && V.info.title) || '',
        author: (V.info && V.info.author) || '',
        model: chosenModel,
        device: S.set.mtDevice || 'gpu',
        use_history: true,
        use_big_llm: useBig,
        llm_url: S.set.llmUrl || '',
        llm_key: S.set.llmKey || '',
        llm_model: S.set.llmModel || '',
      }, 'POST', 180000);
      if (myRun !== run || !V) return;
    } else if (subSvc === 'custom_openai') {
      const cr = await bg({
        op: 'customTranslate',
        texts: V.lines.map((l) => (l.isInstrumental ? '' : l.t)),
        tl,
        customApi: S.set.customApi || null,
        timeoutMs: 60000,
      });
      if (myRun !== run || !V) return;
      if (cr && cr.ok && Array.isArray(cr.translations)) {
        res = { ok: true, translations: cr.translations, model: cr.model || 'Custom API' };
      }
    }
    if (!res || !res.ok || !res.translations) {
      // Zero-setup fallback: Chrome Built-in On-Device Translator -> Free Web MT (no companion needed)
      let fbTrans = null;
      let fbTag = 'Web MT';
      const srcBase = (V.lang || 'auto').split('-')[0];
      const dstBase = tl.split('-')[0];
      const TrApi = subSvc !== 'free_web' && S.set.useChromeBuiltinTranslator !== false && ((typeof Translator !== 'undefined' && Translator) || (typeof ai !== 'undefined' && ai && ai.translator));
      if (TrApi && typeof TrApi.create === 'function' && srcBase && srcBase !== 'auto' && srcBase !== dstBase) {
        try {
          const inst = await TrApi.create({ sourceLanguage: srcBase, targetLanguage: dstBase });
          const out = [];
          for (const ln of V.lines) out.push(ln.t && !ln.isInstrumental ? await inst.translate(ln.t) : '');
          if (out.some(Boolean)) { fbTrans = out; fbTag = 'Chrome AI'; }
        } catch (_) {}
      }
      if (!fbTrans) {
        if (!silent) toast('Translating subtitles via Web MT (zero-setup)…');
        const wr = await bg({
          op: 'webTranslate',
          texts: V.lines.map((l) => (l.isInstrumental ? '' : l.t)),
          sl: V.lang || 'auto',
          tl,
        });
        if (myRun !== run || !V) return;
        if (wr && wr.ok && Array.isArray(wr.translations)) {
          fbTrans = wr.translations;
          fbTag = wr.provider || 'Web MT';
        }
      }
      if (!fbTrans) {
        if (!silent) toast(res && res.error ? res.error : 'Translation unavailable offline');
        return;
      }
      res = { ok: true, translations: fbTrans, model: fbTag };
    }
    const aiLines = V.lines.map((l, idx) => ({ s: l.s, d: l.d, t: res.translations[idx] || '' }));
    const tag = (res.model || 'PLaMo-2B') + (res.is_lyrics ? '·Lyric' : '') + (gl.length ? '+Gloss' : '');
    if (vStorageKey && SS_STORE.saveTrCache) SS_STORE.saveTrCache(vStorageKey, tl, provKey, res.translations, tag);
    if (V.trProv === 'Human' && silent && !S.set.preferAiOverHuman) {
      V.aiTr = aiLines;
      V.aiTrProv = tag;
    } else {
      if (V.trProv === 'Human' && !V.humanTr) V.humanTr = V.tr;
      V.tr = aiLines;
      V.sameTiming = true;
      V.trProv = tag;
    }
    V._aiTranslatedFor = tl + '|' + provKey;
    drawHead();
    drawList();
    if (V.cur >= 0) drawLine(V.cur);
    if (!silent) toast(`Translated (${tag})`);
  };

  const checkCompanionLive = async (timeoutMs = 2000) => {
    const hRes = await comp('/health', null, 'GET', timeoutMs);
    companionHealth = hRes && hRes.ok ? hRes : null;
    drawHead();
    drawList();
    return companionHealth;
  };

  const mergeAsrSegments = (existing, incoming) => {
    const out = existing.slice();
    for (const seg of incoming) {
      const dup = out.some((x) => Math.abs(x.s - seg.s) < 0.8 && x.t === seg.t);
      if (!dup) out.push(seg);
    }
    out.sort((a, b) => a.s - b.s);
    return out;
  };

  const runLocalASR = async (fromPlayhead = true) => {
    if (!V || !V.info || asrState.active) return;
    V.frameWatch?.stop();
    const vid = V.info.videoId;
    if (!companionHealth || !companionHealth.ok) {
      toast('Checking local companion (:8787)…');
      await checkCompanionLive();
      if (!companionHealth || !companionHealth.ok) {
        toast(S.set.companionOff ? 'Local AI is off — turn it on in the Phrasebound popup' : 'Companion offline — start companion/start_companion.bat');
        return;
      }
    }

    const v = video();
    const playStart = fromPlayhead && v ? Math.max(0, Math.floor(v.currentTime - 1)) : 0;
    const chunkSec = 45;
    asrState = { active: true, stopRequested: false, progressTxt: `Starting at ${fmt(playStart)}…`, engine: S.set.asrBackend || 'qwen3_small_vulkan' };
    drawList();

    // Translation runs beside transcription: only lines with no translation yet are sent (plus 3 earlier lines as context),
    // and results are kept by start time + text, so backfill and merged lines don't shift them.
    const trStore = new Map();
    const trKey = (l) => (S.set.tl || '') + '|' + (useWeb() ? 'free_web' : S.set.mtModel || 'plamo-2b') + '|' + l.s.toFixed(2) + '|' + l.t;
    let trBusy = null;
    const useWeb = () => {
      const service = S.set.sceneServices?.subtitle || 'auto';
      return service === 'free_web' || (service === 'auto' && !companionHealth?.plamo);
    };
    const trWanted = () => !!(S.set.tl && (useWeb() || companionHealth.plamo) && V && V.lang && !sameTranslationLanguage(S.set.tl, V.yueByText ? 'yue' : V.lang));
    const translatePending = async () => {
      while (V && V.info && V.info.videoId === vid && trWanted()) {
        const lines = V.lines;
        const todo = [];
        for (let i = 0; i < lines.length; i++) if (!lines[i].isInstrumental && lines[i].t && !trStore.has(trKey(lines[i]))) todo.push(i);
        if (!todo.length) return;
        let end = todo[0];
        for (const i of todo) { if (i > end + 1 || i - todo[0] >= 60) break; end = i; }
        const from = Math.max(0, todo[0] - 3);
        const slice = lines.slice(from, end + 1);
        const target = S.set.tl;
        const web = useWeb();
        const gl = web ? [] : buildSliceGlossary(from, end, target);
        const trRes = web ? await bg({op:'webTranslate', texts:slice.map(l=>l.t), sl:V.lang, tl:target}) : await comp('/translate', {
          lines: slice.map((l) => ({ s: l.s, d: l.d || 0, t: l.t })),
          target_lang: S.set.tl, glossary: gl, merge_clauses: S.set.mergeClauses !== false,
          title: (V.info && V.info.title) || '', author: (V.info && V.info.author) || '',
          model: S.set.mtModel || 'plamo-2b', device: S.set.mtDevice || 'gpu', use_history: true,
        }, 'POST', 120000);
        if (target !== S.set.tl || web !== useWeb()) continue;
        if (trRes && trRes.ok === false && trRes.error) { toast('Translator: ' + trRes.error); return; }
        if (!trRes || !trRes.ok || !Array.isArray(trRes.translations) || !V || !V.info || V.info.videoId !== vid) return;
        slice.forEach((l, k) => { if (from + k >= todo[0] && !trStore.has(trKey(l))) trStore.set(trKey(l), trRes.translations[k] || ''); });
        V.tr = V.lines.map((l) => ({ s: l.s, d: l.d || 0, t: trStore.get(trKey(l)) || '' }));
        V.sameTiming = true;
        V.trProv = (trRes.provider || trRes.model || (web ? 'Web MT' : 'PLaMo-2B')) + (gl.length ? '+Gloss' : '');
        if (V.cur >= 0) drawLine(V.cur);
        drawList();
      }
    };
    const kickTranslate = () => { if (!trBusy && trWanted()) trBusy = translatePending().catch(() => {}).finally(() => { trBusy = null; }); };

    const queue = [{ s: playStart, limit: Infinity }];
    let seededBackfill = false;
    let firstClearDone = !fromPlayhead || V.srcProv === 'YT Auto';
    let chunkIdx = 0;
    if (firstClearDone) {
      V.tr = null;
      V.trProv = '';
      V.tr2 = null;
      V.tr2Prov = '';
      V.annotations = null;
    }

    while (queue.length && !asrState.stopRequested && V && V.info && V.info.videoId === vid) {
      const job = queue.shift();
      let cur = job.s;
      while (cur < job.limit && !asrState.stopRequested && V && V.info && V.info.videoId === vid) {
        const wantChunk = chunkIdx === 0 ? 16 : chunkSec;
        chunkIdx++;
        const len = Number.isFinite(job.limit) ? Math.min(wantChunk, Math.max(1, job.limit - cur)) : wantChunk;
        if (len < 1.0) break;
        asrState.progressTxt = `Transcribing ${fmt(cur)}–${fmt(cur + len)}${companionHealth.gpu_backend ? ' · ' + companionHealth.gpu_backend : ''}…`;
        drawList();

        const res = await comp('/transcribe', {
          videoId: vid,
          pageUrl: (typeof location !== 'undefined' && location.href) || '',
          site: (V.site && V.site.id) || 'yt',
          lang: S.set.asrLangHint || '',
          start_time: cur,
          chunk_sec: len,
          backend: S.set.asrBackend || 'qwen3_small_vulkan',
          title: V.info.title || '',
          author: V.info.author || '',
        }, 'POST', 180000);

        if (asrState.stopRequested || !V || !V.info || V.info.videoId !== vid) break;
        if (!res || !res.ok) {
          toast((res && res.error) || 'Local ASR failed');
          asrState.stopRequested = true;
          break;
        }

        if (!seededBackfill) {
          seededBackfill = true;
          if (playStart > 2) queue.push({ s: 0, limit: playStart });
        }

        const newLines = prepareLines(res.lines || []);
        const baseLines = firstClearDone ? [] : (V.lines || []);
        firstClearDone = false;
        V.lines = mergeAsrSegments(baseLines, newLines);
        const hint = S.set.asrLangHint || '';
        V.lang = hint === 'mixed' ? 'en' : (res.lang || hint || V.lang || 'en');
        V.L = SS_LANG.get(V.lang);
        V.srcProv = res.engine || 'Vulkan ASR';
        if (res.acoustic_wpm) V.acousticWpm = res.acoustic_wpm;
        V.msg = '';

        // Translate the new lines in the background; the next chunk is transcribed meanwhile.
        if (trWanted() && V.tr && V.sameTiming) V.tr = V.lines.map((l) => ({ s: l.s, d: l.d || 0, t: trStore.get(trKey(l)) || '' }));
        if (newLines.length) kickTranslate();

        await finishLoadAnalysis(run);
        if (res.next_start == null) break;
        cur = res.next_start;

        // Playhead Look-Ahead Buffer: avoid pegging GPU for 60-min+ videos when user only needs next 2-3 mins
        const lookaheadCap = S.set.gpuProfile === 'eco' ? 120 : 180;
        while (!asrState.stopRequested && V && V.info && V.info.videoId === vid) {
          const curPlay = video() ? video().currentTime : 0;
          if (cur <= curPlay + lookaheadCap || cur < playStart) break;
          asrState.progressTxt = `Buffered to ${fmt(cur)} (pacing GPU until ${fmt(Math.max(0, cur - lookaheadCap))})…`;
          drawList();
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    try {
      if (trBusy) await trBusy;
      if (!asrState.stopRequested) await translatePending();
    } catch (e) {}
    asrState.active = false;
    asrState.progressTxt = '';
    drawList();
    if (!asrState.stopRequested && V && V.lines.length) {
      toast(`ASR ready (${V.lines.length} segments · ${V.srcProv})`);
    }
  };

  // ---- Two-Tier Live Stream Bilingual Subtitles (DOM/TextTrack + captureStream GPU ASR) ----
  const liveTimeNow = () => {
    const v = video();
    if (v && Number.isFinite(v.currentTime) && v.currentTime > 0) return v.currentTime;
    if (!liveState.startWall) liveState.startWall = Date.now();
    return Math.max(0.1, (Date.now() - liveState.startWall) / 1000);
  };

  const inferScriptLang = (txt, fallback) => {
    if (/[가-힣]/.test(txt)) return 'ko';
    if (/[ぁ-んァ-ン]/.test(txt)) return 'ja';
    if (/[\u4e00-\u9fff]/.test(txt)) return /[嘅咗唔佢冇喺噉嗰咩啲嚟睇攞]/.test(txt) ? 'yue' : 'zh';
    if (/[а-яА-ЯёЁ]/.test(txt)) return 'ru';
    return fallback || (V && V.lang) || 'en';
  };

  // Overlap one network request with the current one. Apply results in cue order.
  const prepareNextLiveTranslation = () => {
    const job = liveState.trQueue[0];
    const service = S.set.sceneServices?.subtitle || 'auto';
    if (!job || job.web || !['auto', 'free_web'].includes(service) ||
        !job.tl || sameTranslationLanguage(job.sl, job.tl)) return;
    const request = { op:'webTranslate', texts:[job.text], sl:job.sl, tl:job.tl };
    const session = liveState.session;
    job.web = bg(request).then(async reply => {
      if (reply?.translations?.[0]) return reply;
      // A short transient provider failure should not permanently drop a recognized line.
      await new Promise(resolve => setTimeout(resolve, 300));
      if (session !== liveState.session || S.set.tl !== job.tl || !V?.lines.includes(job.ln)) return reply;
      return bg(request);
    });
  };

  const drainLiveTranslateQueue = async (myRun, vid) => {
    if (liveState.trBusy) return;
    const session = liveState.session;
    liveState.trBusy = true;
    try {
      while (session === liveState.session && liveState.trQueue.length && !liveState.stopRequested && myRun === run && V && V.info && V.info.videoId === vid) {
        prepareNextLiveTranslation();
        const job = liveState.trQueue.shift();
        prepareNextLiveTranslation();
        const tl = job.tl;
        if (tl !== S.set.tl) continue;
        if (!tl || sameTranslationLanguage(tl, job.sl)) continue;
        let translated = '';
        let prov = 'Web MT';
        const subSvc = (S.set.sceneServices && S.set.sceneServices.subtitle) || 'auto';
        const subLocalMap = { local_plamo2b: 'plamo-2b', local_index2b: 'index-2b', local_gemma_e4b: 'gemma-e4b', local_hymt7b: 'hy-mt2-7b' };
        if (subSvc === 'custom_openai') {
          const cr = await bg({ op: 'customTranslate', text: job.text, tl, customApi: S.set.customApi || null });
          if (cr && cr.ok && cr.translation) {
            translated = cr.translation;
            prov = cr.model || 'Custom API';
          }
        } else if (subSvc !== 'auto' && subSvc !== 'free_web' && subSvc !== 'browser_api' && companionHealth && companionHealth.ok && companionHealth.plamo) {
          const r = await comp('/translate_text', {
            text: job.text,
            target_lang: tl,
            model: subLocalMap[subSvc] || S.set.mtModel || 'plamo-2b',
            device: S.set.mtDevice || 'gpu',
            context: job.prev || '',
          }, 'POST', 20000);
          if (r && r.ok && r.translation) {
            translated = r.translation;
            prov = (r.model || 'PLaMo-2B');
          }
        }
        if (!translated && session === liveState.session) {
          const wr = await (job.web || bg({ op: 'webTranslate', texts: [job.text], sl: job.sl, tl }));
          if (wr && wr.ok && Array.isArray(wr.translations) && wr.translations[0]) {
            translated = wr.translations[0];
            prov = 'Web MT';
          }
        }
        if (session !== liveState.session || myRun !== run || !V || !V.info || V.info.videoId !== vid) return;
        // Cached or overlapping replies can arrive in the same paint cycle.
        if (translated && liveState.lastPair && V.lines.includes(job.ln)) {
          const dwell = liveState.trQueue.length > 2 ? 400 : 1000;
          const remaining = dwell - (performance.now() - liveState.pairShownAt);
          if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
          if (session !== liveState.session || myRun !== run || V?.info?.videoId !== vid) return;
        }
        const targetIdx = V.lines.indexOf(job.ln);
        if (translated && targetIdx >= 0 && S.set.tl === tl) {
          if (!Array.isArray(V.tr)) V.tr = V.lines.map((l) => ({ s: l.s, d: l.d || 0, t: '' }));
          while (V.tr.length < V.lines.length) V.tr.push({ s: V.lines[V.tr.length].s, d: V.lines[V.tr.length].d || 0, t: '' });
          V.tr[targetIdx] = { s: V.lines[targetIdx].s, d: V.lines[targetIdx].d || 0, t: translated };
          V.sameTiming = true;
          V.trProv = prov;
          if (targetIdx >= V.lines.indexOf(liveState.lastPair)) {
            liveState.lastPair = job.ln;
            liveState.pairShownAt = performance.now();
            V.cur = targetIdx;
            drawLine(targetIdx);
          }
          drawList();
        }
      }
    } finally {
      if (session === liveState.session) liveState.trBusy = false;
    }
  };

  const scheduleLiveStudy = myRun => {
    if (liveState.studyTimer || liveState.studyBusy) return;
    const session = liveState.session;
    liveState.studyTimer = setTimeout(async () => {
      liveState.studyTimer = null;
      if (session !== liveState.session || myRun !== run || !V?.lines.length) return;
      // Keep full-transcript dictionary work out of first-caption startup.
      // Explicit glossary/practice visits can request it immediately.
      const studying = tab === 'glossary' || tab === 'practice';
      if (!studying && liveState.mode === 'asr' &&
          (liveState.recognizing || liveState.trBusy || performance.now() - (liveState.lastSpeechAt || 0) < 5000)) {
        scheduleLiveStudy(myRun);
        return;
      }
      liveState.studyBusy = true;
      try { await finishLoadAnalysis(myRun, !studying); }
      catch (_) { /* The live caption pair remains usable without enrichment. */ }
      finally { if (session === liveState.session) liveState.studyBusy = false; }
    }, tab === 'glossary' || tab === 'practice' ? 0 : 12000);
  };

  const appendLiveLine = (rawText, opts = {}) => {
    if (!V || !V.info) return -1;
    const text = String(rawText || '').replace(/\s+/g, ' ').trim();
    if (!text) return -1;
    const last = V.lines[V.lines.length - 1];
    if (opts.startSec == null && last && last.t.toLowerCase() === text.toLowerCase()) return V.lines.length - 1;

    const myRun = run;
    const vid = V.info.videoId;
    const nowSec = liveTimeNow();
    const prevEnd = last ? (last.s + (last.d || 0)) : 0;
    const startSec = opts.startSec != null ? opts.startSec : Math.max(0, nowSec - 0.15);
    const revise = last && opts.revise === last;
    const s = revise ? last.s : Math.max(startSec, last ? last.s + 0.05 : 0);
    if (last && s < prevEnd) last.d = Math.max(0.4, Math.round((s - last.s) * 100) / 100);
    const estDur = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : Math.max(4.5, Math.min(9.0, text.length * 0.14));

    const detLang = opts.lang || inferScriptLang(text, (V.site && V.site.defaultLang) || S.set.asrLangHint || '');
    if (!V.lang || V.lang === 'en' || (opts.lang && liveState.mode === 'asr')) {
      V.lang = detLang;
      V.L = SS_LANG.get(V.lang);
    }
    V.srcProv = opts.srcProv || V.srcProv || 'Live CC';
    V.msg = '';

    const prepared = prepareLines([{ s: Math.round(s * 100) / 100, d: Math.round(estDur * 100) / 100, t: text, conf: opts.conf || 0.92 }]);
    if (!prepared.length) return -1;
    const ln = prepared[0];
    ln.lineLang = detLang;
    if (revise) {
      V.lines[V.lines.length-1] = ln;
      if (V.tr) V.tr[V.lines.length-1] = {s:ln.s,d:ln.d,t:''};
      liveState.trQueue = liveState.trQueue.filter(job=>job.ln!==last);
    } else V.lines.push(ln);

    // Keep scrolling window capped around 240 live utterances so DOM memory stays flat on multi-hour streams
    if (V.lines.length > 240) {
      const trim = V.lines.length - 200;
      V.lines.splice(0, trim);
      if (Array.isArray(V.tr)) V.tr.splice(0, trim);
    }
    const finalIdx = V.lines.length - 1;

    if (!Array.isArray(V.tr)) V.tr = V.lines.map((x) => ({ s: x.s, d: x.d || 0, t: '' }));
    while (V.tr.length < V.lines.length) V.tr.push({ s: V.lines[V.tr.length].s, d: V.lines[V.tr.length].d || 0, t: '' });
    if (opts.translation) {
      V.tr[finalIdx] = { s: ln.s, d: ln.d, t: opts.translation };
      V.sameTiming = true;
      V.trProv = opts.trProv || 'Local MT';
    } else if (S.set.tl && !sameTranslationLanguage(S.set.tl, detLang)) {
      liveState.trQueue.push({
        sl: detLang, tl:S.set.tl,
        ln,
        text,
        prev: finalIdx > 0 ? V.lines[finalIdx - 1].t : '',
      });
      prepareNextLiveTranslation();
      drainLiveTranslateQueue(myRun, vid);
    } else {
      liveState.lastPair = ln;
      liveState.pairShownAt = performance.now();
    }

    const paired = V.lines.indexOf(liveState.lastPair);
    V.cur = paired >= 0 && !opts.translation ? paired : finalIdx;
    drawLine(V.cur);
    drawList();
    markCur(finalIdx);
    scheduleLiveStudy(myRun);
    return finalIdx;
  };

  const readLiveDomCaptionText = () => {
    const s = getActiveSite();
    const sels = (s && s.liveCaptionSelectors) || [];
    for (const selStr of sels) {
      try {
        const nodes = document.querySelectorAll(selStr);
        if (!nodes || !nodes.length) continue;
        const txt = Array.from(nodes).map((n) => (n.textContent || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (txt) return txt;
      } catch (e) {}
    }
    const v = video();
    if (v && v.textTracks) {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i];
        if (!tt || !tt.activeCues || !tt.activeCues.length) continue;
        const parts = [];
        for (let j = 0; j < tt.activeCues.length; j++) {
          const ct = String(tt.activeCues[j].text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (ct) parts.push(ct);
        }
        const joined = parts.join(' ').trim();
        if (joined) return joined;
      }
    }
    return '';
  };

  const startLiveDomObserver = (announce = true) => {
    if (!V || !V.info) return;
    V.frameWatch?.stop();
    stopLiveCaptions();
    liveState.active = true;
    liveState.stopRequested = false;
    liveState.mode = 'dom';
    liveState.startWall = Date.now();
    liveState.lastDomText = '';
    liveState.lastDomCommitted = '';
    liveState.lastDomChangeAt = Date.now();
    liveState.progressTxt = `Watching ${V.site ? V.site.name : 'Live'} captions (zero-GPU mode)…`;
    const vid = V.info.videoId;
    const myRun = run;

    const commitDelta = (candidate) => {
      const clean = String(candidate || '').replace(/\s+/g, ' ').trim();
      if (!clean || clean === liveState.lastDomCommitted) return;
      const previous = liveState.lastDomCommitted;
      const samePrefix = previous.length >= 8 && clean.startsWith(previous.slice(0,Math.max(6,Math.floor(previous.length*0.65))));
      const last = V.lines.at(-1);
      const revise = last?.t===previous && (clean.startsWith(previous) || samePrefix) ? last : null;
      liveState.lastDomCommitted = clean;
      appendLiveLine(clean, {revise,srcProv:`${V.site ? V.site.name : 'Live'} CC`});
    };

    liveState.domTimer = setInterval(() => {
      if (liveState.stopRequested || myRun !== run || !V || !V.info || V.info.videoId !== vid) {
        stopLiveCaptions();
        return;
      }
      const curTxt = readLiveDomCaptionText();
      const now = Date.now();
      if (curTxt !== liveState.lastDomText) {
        // Utterance switched away from previous rolling line -> commit old line right away
        if (liveState.lastDomText && (!curTxt || !curTxt.startsWith(liveState.lastDomText.slice(0, Math.min(12, liveState.lastDomText.length))))) {
          commitDelta(liveState.lastDomText);
        }
        liveState.lastDomText = curTxt;
        liveState.lastDomChangeAt = now;
        if (curTxt && /[.!?。！？…]$/.test(curTxt) && curTxt.length >= 6) {
          commitDelta(curTxt);
        }
      } else if (curTxt && (now - liveState.lastDomChangeAt) >= 850) {
        commitDelta(curTxt);
      }
    }, 320);

    if (announce) toast('Live DOM caption watcher active');
    drawList();
  };

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });

  const liveReplayStart = () => {
    const cue = liveState.lastPair || V?.lines.at(-1);
    const ranges = video()?.seekable;
    if (!cue || !ranges) return null;
    for (let i=0;i<ranges.length;i++) {
      if (cue.s >= ranges.start(i) && cue.s < ranges.end(i)) return cue.s;
    }
    return null;
  };
  const replayLiveVideo = async () => {
    const start = liveReplayStart(), media = video();
    if (start === null || !media || !liveState.active) return;
    const view = V;
    try {
      media.currentTime = start;
      view.dvrMode = liveState.mode;
      stopLiveCaptions();
      drawList();
      await media.play();
    } catch (_) { if (view === V) toast('The player could not replay this line.'); }
  };
  const returnToBroadcast = async () => {
    const media = video(), view = V, mode = view?.dvrMode;
    if (!mode || !media || view.returningLive) return;
    const ranges = media.seekable;
    if (!ranges.length) { toast('The live broadcast is not seekable yet.'); return; }
    view.returningLive = true;
    try {
      const last = ranges.length-1;
      media.currentTime = Math.max(ranges.start(last),ranges.end(last)-2);
      await media.play();
      const deadline = performance.now()+8000;
      while (media.seeking && performance.now()<deadline && V===view) await new Promise(r=>setTimeout(r,80));
      if (V!==view || video()!==media) return;
      if (media.seeking) throw new Error();
      if (mode==='asr') await startLiveAudioCaptions();
      else startLiveDomObserver(false);
      if (liveState.active) view.dvrMode = '';
    } catch (_) { if (view===V) toast('Could not return to the live broadcast. Try again.'); }
    finally { view.returningLive = false; if (view===V) drawList(); }
  };

  const liveMediaTaps = new WeakMap();
  const liveRecognitionEngine = (lang, requested, health, fallback) => {
    const compact = requested === 'live_tiny' || requested === 'live_base';
    if (lang === 'yue' && (!requested || requested === 'auto' || compact)) {
      if (health.qwen3_asr_small) return 'qwen3_small_vulkan';
      if (health.qwen3_asr) return 'qwen3_vulkan';
      if (health.whisper_vulkan) return 'whisper_vulkan';
      return null;
    }
    if (requested && requested !== 'auto') return requested;
    if (lang === 'ko' && health.live_whisper_base) return 'live_base';
    if (health.live_whisper_tiny) return 'live_tiny';
    if (health.live_whisper_base) return 'live_base';
    return fallback || 'auto';
  };
  const startLiveAudioCaptions = async () => {
    if (!V || !V.info) return;
    const vid = V.info.videoId;
    const myRun = run;
    if (!companionHealth || !companionHealth.ok) {
      toast('Checking local companion (:8787)…');
      await checkCompanionLive(15000);
      if (run !== myRun || V?.info.videoId !== vid) return;
      if (!companionHealth || !companionHealth.ok) {
        toast(S.set.companionOff ? 'Local AI is off — turn it on in the Phrasebound popup for Live ASR' : 'Companion offline — start companion/start_companion.bat for GPU Live ASR');
        return;
      }
    }
    const lang = S.set.asrLangHint || '';
    const backend = liveRecognitionEngine(lang,S.set.liveAsrBackend,companionHealth,S.set.asrBackend);
    if (!backend) { toast('Cantonese live captions need Qwen3-ASR or Whisper v3 Turbo in Companion.'); return; }
    if (lang === 'yue' && ['live_tiny','live_base'].includes(S.set.liveAsrBackend)) {
      toast('Using '+(backend === 'whisper_vulkan' ? 'Whisper v3 Turbo' : 'Qwen3-ASR')+' for Cantonese.');
    }
    const v = video();
    if (!v) { toast('No active video player found'); return; }
    // DW's CDN offers CORS audio, but its player initially loads without CORS.
    if (V.site?.id === 'dw' && !v.crossOrigin && !v.mediaKeys && /^https?:/.test(v.currentSrc) && new URL(v.currentSrc).origin !== location.origin) {
      v.crossOrigin = 'anonymous';
      v.load();
      try {
        await v.play();
      } catch (_) {
        v.removeAttribute('crossorigin'); v.load(); v.play().catch(()=>{});
        toast('This stream could not share audio for captioning.'); return;
      }
      if (myRun !== run || V?.info.videoId !== vid) return;
    }
    let rawStream = null, tap = null;
    try {
      if (V.site?.id === 'dw') {
        // Chrome's native HLS player can return a live but silent captureStream track.
        // A Web Audio tap on the CORS-enabled element preserves ordinary playback.
        tap = liveMediaTaps.get(v);
        if (!tap) {
          const context = new AudioContext();
          const media = context.createMediaElementSource(v);
          const monitor = context.createGain();
          media.connect(monitor).connect(context.destination);
          tap = {context,media,monitor};
          liveMediaTaps.set(v,tap);
        }
        await tap.context.resume();
      } else {
        rawStream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
      }
    } catch (e) {
      toast('Browser blocked direct audio capture on this protected stream (' + e.message + ')');
      return;
    }
    const aTracks = rawStream && rawStream.getAudioTracks ? rawStream.getAudioTracks() : [];
    if ((!tap && !aTracks.length) || !window.AudioContext) {
      toast('Stream audio track unavailable for capture; turn on platform CC if offered');
      return;
    }

    stopLiveCaptions();
    if (rawStream && rawStream.getVideoTracks) {
      for (const vt of rawStream.getVideoTracks()) {
        try { vt.stop(); } catch (_) {}
      }
    }
    const clonedTracks = aTracks.map((t) => (t.clone ? t.clone() : t));
    const audioOnly = new MediaStream(clonedTracks);
    liveState.stream = audioOnly;
    liveState.rawAudioTracks = aTracks;
    liveState.active = true;
    liveState.stopRequested = false;
    liveState.mode = 'asr';
    liveState.startWall = Date.now();
    liveState.progressTxt = `Listening for speech…`;
    drawList();

    const streamingWhisper = backend === 'live_tiny' || backend === 'live_base';
    V.frameWatch?.stop();
    const session = liveState.session;
    const current = () => session === liveState.session && myRun === run && V?.info.videoId === vid;
    try {
      const ctx = tap?.context || new AudioContext();
      let processor, source, mute, reconnectTimer, stopReplay;
      liveState.closeAudio = () => {
        clearInterval(reconnectTimer);
        stopReplay?.();
        liveState.replayAudio = null;
        if (source && processor) { try { source.disconnect(processor); } catch (_) {} }
        processor?.disconnect(); mute?.disconnect();
        if (!tap) ctx.close().catch(()=>{});
      };
      const maxSeconds = streamingWhisper ? 4 : 5;
      try {
        if (!tap?.loaded) {
          const url = URL.createObjectURL(new Blob([SS_LIVE_WORKLET], {type:'text/javascript'}));
          try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          if (tap) tap.loaded = true;
        }
        if (!current()) return;
        processor = new AudioWorkletNode(ctx,'phrasebound-live-audio',{channelCount:1,channelCountMode:'explicit',processorOptions:{maxSeconds}});
      } catch (error) {
        if (!current()) return;
        // Some players prohibit dynamically loaded worklets. Use the same encoder
        // on the browser's audio callback without changing the page's policy.
        if (typeof ctx.createScriptProcessor !== 'function') throw error;
        processor = ctx.createScriptProcessor(2048,1,1);
      }
      await ctx.resume();
      if (!current()) return;
      source = tap?.media || ctx.createMediaStreamSource(audioOnly);
      mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute).connect(ctx.destination);
      const origin = liveTimeNow();
      const replayBuffer = new SS_LiveReplayBuffer();
      liveState.replayAudio = line => {
        if (!line || !current()) return;
        const start = line.s-origin;
        const audio = replayBuffer.excerpt(start < 0 && start > -0.01 ? 0 : start,start+line.d);
        if (!audio) { toast('That line is outside the last minute of audio.'); return; }
        stopReplay?.();
        const clip = ctx.createBuffer(1,audio.length,16000);
        clip.copyToChannel(audio,0);
        const playback = ctx.createBufferSource();
        playback.buffer = clip;
        playback.connect(ctx.destination);
        const mutedBefore = v.muted;
        if (tap?.monitor) tap.monitor.gain.value = 0;
        else v.muted = true;
        const restore = () => {
          playback.onended = null;
          playback.disconnect();
          if (tap?.monitor) tap.monitor.gain.value = 1;
          else if (!mutedBefore && v.muted) v.muted = false;
          stopReplay = null;
        };
        stopReplay = () => { playback.stop(); restore(); };
        playback.onended = restore;
        playback.start();
      };
      const queue = [];
      let queuedSeconds = 0, busy = false, overloaded = false;
      let previousTail = null, previousEnd = -1;
      async function drain() {
        if (busy) return;
        busy = true;
        liveState.recognizing = true;
        try {
          while (current() && queue.length) {
            const chunk = SS_takeLiveAudio(queue);
            queuedSeconds -= chunk.duration;
            const start = origin + chunk.start;
            let wav = chunk.wav, contextSec = 0;
            if (streamingWhisper) {
              const samples = new Uint8Array(wav,44);
              if (previousTail && Math.abs(previousEnd - chunk.start) < 0.00004) {
                contextSec = previousTail.length / 32000;
                wav = SS_joinLivePcm(wav, [previousTail, samples]);
              }
              previousTail = samples.slice(-64000);
              previousEnd = chunk.start + chunk.duration;
            }
            const payload = {audio_b64:await blobToBase64(new Blob([wav])),mime_type:'audio/wav',context_sec:contextSec,
              lang,target_lang:'',backend,
              start_offset:start,title:V.info.title || '',author:V.info.author || ''};
            const recognize = () => streamingWhisper && companionHealth?.live_caption_socket
              ? bg({op:'companion',path:'/transcribe_chunk',body:payload,method:'POST',timeoutMs:45000,
                  url:S.set.companionUrl,liveAudio:true})
              : comp('/transcribe_chunk',payload,'POST',45000);
            let res = await recognize();
            if (!current()) return;
            if (!res?.ok) res = await recognize();
            if (!current()) return;
            if (!res?.ok) {
              liveState.progressTxt = `Audio recognition failed at ${Math.floor(start)}s`;
              toast(liveState.progressTxt); drawList(); continue;
            }
            liveState.progressTxt = `Live captions · ${queuedSeconds.toFixed(1)}s queued`;
            const cues = res.lines?.length ? res.lines : [{s:start,t:res.text}];
            for (const cue of cues) {
              if (cue.t && /[\p{L}\p{N}]/u.test(cue.t)) {
                appendLiveLine(cue.t,{startSec:cue.s,duration:cue.d,lang:cue.lineLang || res.lang,srcProv:res.engine || 'Live audio'});
              }
            }
          }
          if (overloaded && current()) {
            stopLiveCaptions();
            toast('Captioning stopped after processing the queued audio. Choose a faster recognition engine to restart.');
            drawList();
          }
        } finally { busy=false; if (current()) liveState.recognizing=false; }
      }
      let quietSeconds = 0;
      const acceptPacket = data => {
        if (!current() || overloaded) return;
        if (V.site?.isAd?.() || video() !== v) {
          previousTail = null;
          previousEnd = -1;
          return;
        }
        replayBuffer.add(data);
        if (!data.speech) {
          quietSeconds += data.duration;
          if (quietSeconds >= 9) {
            const playerError = V.site?.id === 'yt' && document.querySelector('#movie_player .ytp-error-content-wrap')?.innerText?.trim();
            const status = v.error || playerError ? 'Stream playback failed. Restart the video to resume captions.'
              : v.paused || v.readyState < 3 || v.currentTime === 0 ? 'Waiting for stream playback' : 'Waiting for audible speech';
            if (liveState.progressTxt !== status) {
              liveState.progressTxt = status;
              drawList();
            }
          }
          return;
        }
        quietSeconds = 0;
        liveState.lastSpeechAt = performance.now();
        queue.push(data); queuedSeconds+=data.duration;
        if (queuedSeconds>=60) {
          overloaded=true;source.disconnect(processor);
          toast('Recognition is over a minute behind. Capture paused while queued audio finishes.');
        }
        drain().catch(error=>{if(current()){stopLiveCaptions();toast(error.message);drawList();}});
      };
      if (processor.port) processor.port.onmessage = event => acceptPacket(event.data);
      else {
        const encoder = new SS_LivePcmEncoder(ctx.sampleRate, maxSeconds, acceptPacket);
        processor.onaudioprocess = event => encoder.process(event.inputBuffer.getChannelData(0));
      }
      source.connect(processor);
      // YouTube may replace the element or end its captured track across an ad.
      // Reattach only after the programme is playing and only for this session.
      let reconnecting = false, retryAfter = 0;
      reconnectTimer = setInterval(async () => {
        if (!current() || reconnecting || overloaded || Date.now() < retryAfter || V.site?.isAd?.()) return;
        const next = video();
        if (!next || next.paused || next.readyState < 2) return;
        const ended = clonedTracks.length && clonedTracks.every(track => track.readyState === 'ended');
        if (next === v && !ended) return;
        reconnecting = true;
        try { await startLiveAudioCaptions(); }
        finally { reconnecting = false; retryAfter = Date.now() + 5000; }
      }, 1000);
    } catch (error) {
      if (current()) {stopLiveCaptions();toast('Live audio unavailable: '+error.message);drawList();}
    }
  };

  // ---- Settings drawer ----
  const sel = (opts, val, on) => {
    const s = h('select', { onchange: (e) => on(e.target.value) });
    for (const [v, t] of opts) {
      const o = h('option', { value: v }, t);
      if (v === val) o.selected = true;
      s.append(o);
    }
    return s;
  };
  const toggleBtn = (label, on, fn, title = null) => h('button', { class: on ? 'ss-act' : '', title, onclick: fn }, label);

  const closeSettingsModal = () => {
    settingsOpen = false;
    if (modalBack) { modalBack.remove(); modalBack = null; }
  };

  const setOpen = { ai: true, adv: false, kbd: false };
  let setNavActive = 'ss-sec-ai', setScroll = 0;  // settings: left nav jumps to a section; scroll position kept across redraws   // which settings groups are open, kept across redraws
  // Translator menu: every model the companion has on this PC, grouped by family, with the speed measured on this PC
  // (companion /mt_models, numbers from _dev/mt_speed_bench.py). Without the companion it falls back to the two old choices.
  let mtList = null, mtListAsked = false;
  const mtSpeedLabel = (m, dev) => {
    const sp = m.speed && m.speed[dev];
    if (!sp || sp.error) return dev === 'cpu' ? 'CPU speed not measured' : 'speed not measured';
    return `${sp.line_s < 1 ? sp.line_s.toFixed(2) : sp.line_s.toFixed(1)} s a line, ${sp.lines_per_min} lines/min`;
  };
  const mtModelSelect = () => {
    if (!mtList && !mtListAsked) {
      mtListAsked = true;
      comp('/mt_models', null, 'GET', 3000).then((r) => { if (r && r.ok && Array.isArray(r.models)) { mtList = r; if (settingsOpen) drawSettings(); } else mtListAsked = false; });
    }
    const cur = S.set.mtModel || 'plamo-2b';
    const dev = S.set.mtDevice === 'cpu' ? 'cpu' : 'gpu';
    const s = h('select', { onchange: (e) => { S.set.mtModel = e.target.value; save('set'); drawSettings(); runPlamoTranslate(false); } });
    const models = mtList ? mtList.models.filter((m) => m.available) : [
      { key: 'plamo-2b', family: 'PLaMo 3 Translate', size: '2B', gb: 1.81 },
      { key: 'index-2b', family: 'Index-Translate', size: '2B', gb: 2.08 },
      { key: 'hy-mt2', family: 'Hy-MT2', size: '1.8B', gb: 1.91 },
      { key: 'hy-mt2-7b', family: 'Hy-MT2', size: '7B', gb: 4.62 },
      { key: 'index-9b', family: 'Index-Translate', size: '9B', gb: 5.78 },
      { key: 'plamo-8b', family: 'PLaMo 3 Translate', size: '8B', gb: 4.9 },
      { key: 'gemma-e2b', family: 'Gemma 3n', size: 'E2B', gb: 1.8 },
      { key: 'gemma-e4b', family: 'Gemma 3n', size: 'E4B', gb: 3.1 },
      { key: 'plamo-0.8b', family: 'PLaMo 3 Translate', size: '0.8B', gb: 0.57 }];
    const groups = new Map();
    for (const m of models) { if (!groups.has(m.family)) groups.set(m.family, []); groups.get(m.family).push(m); }
    for (const [fam, ms] of groups) {
      const g = h('optgroup', { label: fam });
      for (const m of ms) {
        const tag = m.key === 'plamo-2b' ? ' (default)' : '';
        const o = h('option', { value: m.key }, `${m.size}${tag} · ${m.gb} GB · ${mtList ? mtSpeedLabel(m, dev) : ''}`.replace(/ · $/, ''));
        if (m.key === cur) o.selected = true;
        g.append(o);
      }
      s.append(g);
    }
    return s;
  };
  const mtModelNote = () => {
    if (!mtList) return null;
    const m = mtList.models.find((x) => x.key === (S.set.mtModel || 'plamo-2b'));
    const bits = [`Speeds measured on ${mtList.measured_on || 'this PC'}${mtList.measured_at ? ' (' + mtList.measured_at + ')' : ''}; yours will differ.`];
    if (m && m.gb >= 4.5) bits.push('This model is big: close other heavy programs first, and it translates one line at a time.');
    if (m && m.key === 'bonsai2-2b') bits.push('In our test Bonsai 2B left about half of Japanese lines untranslated.');
    if (m && /^(qwen|bonsai)/.test(m.key)) bits.push('General chat model, not trained for translation.');
    if (m && m.key.startsWith('lmt')) bits.push('Translates line by line only: no glossary or video context.');
    if (companionHealth && companionHealth.mt_error) bits.push('Last problem: ' + companionHealth.mt_error);
    return h('div', { class: 'ss-modal-row ss-note', style: 'opacity:.75;font-size:12px;display:block' }, bits.join(' '));
  };

  const drawSettings = () => {
    if (!settingsOpen) {
      if (modalBack) { modalBack.remove(); modalBack = null; }
      return;
    }
    const modalHost = document.fullscreenElement || document.body;
    if (!modalBack || modalBack.parentElement !== modalHost) {
      if (modalBack) modalBack.remove();
      modalBack = h('div', {
        id: 'ss-modal-back',
        onclick: (e) => { if (e.target === modalBack) closeSettingsModal(); },
      });
      modalHost.append(modalBack);
    }
    const oldRight = modalBack.querySelector('.ss-modal-right');
    if (oldRight) setScroll = oldRight.scrollTop;
    modalBack.textContent = '';

    const isPro = S.set.uiMode === 'pro';
    const trackOpts = (V && V.info && V.info.tracks || []).map((t) => [trackKey(t), (t.name || t.lang) + (t.auto && !/auto/i.test(t.name || '') ? ' (auto)' : '')]);
    const mkRow = (label, ctrl) => h('div', { class: 'ss-modal-row' }, h('span', {}, label), ctrl);
    const mkRange = (label, val, min, max, step, onChange) =>
      mkRow(label, h('input', { type: 'range', min, max, step, value: val, oninput: (e) => onChange(parseFloat(e.target.value)) }));
    const mkSwitch = (label, checked, onChange) => {
      const inp = h('input', { type: 'checkbox', onchange: (e) => onChange(e.target.checked) });
      inp.checked = !!checked;
      return mkRow(label, h('label', { class: 'ss-switch' }, inp, h('span', { class: 'ss-switch-track' })));
    };
    const mkKbd = (keyLabel, desc) => h('div', { class: 'ss-kbd-row' }, h('span', {}, desc), h('kbd', { class: 'ss-kbd' }, keyLabel));

    const online = companionHealth && companionHealth.ok;
    const leftCol = h('div', { class: 'ss-modal-left' },
      h('div', { class: 'ss-modal-brand' }, h('span', { class: 'ss-modal-logo' }, captionMark()), h('span', {}, 'Phrasebound')),
      h('div', { style: { fontSize: '12px', color: 'var(--ss-fg-muted)', lineHeight: '1.45' } },
        online
          ? `● Local AI Ready (${companionHealth.gpu_backend || 'GPU'})`
          : '○ Zero-Setup Web AI active (optional local GPU offline)'),
      h('button', { class: 'ss-btn-chip', onclick: async () => { await checkCompanionLive(); drawSettings(); } }, '↻ Check Local AI Server'),
      h('nav', { class: 'ss-set-nav' },
        ...[['ss-sec-ai', 'Local AI'], ['ss-sec-subs', 'Subtitles'], ['ss-sec-study', 'Study'], ['ss-sec-web', 'Webpages & OCR'], ['ss-sec-adv', 'Advanced'], ['ss-sec-kbd', 'Keyboard shortcuts']].map(([id, label]) =>
          h('button', { class: 'ss-nav-btn' + (setNavActive === id ? ' ss-act' : ''), 'data-sec': id, onclick: () => {
            setNavActive = id; const el = modalBack && modalBack.querySelector('#' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } }, label))));

    const rightCol = h('div', { class: 'ss-modal-right' },
      h('div', { class: 'ss-modal-hdr' },
        h('h3', {}, 'Settings'),
        h('button', { class: 'ss-modal-close', title: 'Close (Esc)', onclick: closeSettingsModal }, '×')),
      h('section', { id: 'ss-sec-ai', class: 'ss-set-sec' },
        h('div', { class: 'ss-sec-hdr' }, 'Local AI'),
        V && V.lines.length && online ? mkRow('Translate this video again', h('button', { class: 'ss-teal', onclick: () => { closeSettingsModal(); runPlamoTranslate(false); } }, 'Translate')) : null,
        mkRow('Computer power', sel([
          ['balanced', 'Normal (best quality)'],
          ['eco', 'Light (weak graphics card)'],
          ['zero_gpu', 'Off (YouTube subtitles only)'],
        ], S.set.gpuProfile || 'balanced', (val) => {
          S.set.gpuProfile = val;
          if (val === 'eco') { S.set.mtModel = 'plamo-0.8b'; S.set.autoAiTranslate = true; }
          else if (val === 'zero_gpu') { S.set.autoAiTranslate = false; S.set.asrBackend = 'faster_whisper'; }
          else { S.set.mtModel = 'plamo-2b'; S.set.autoAiTranslate = true; S.set.asrBackend = 'qwen3_small_vulkan'; }
          save('set'); drawSettings(); drawList();
        })),
        mkRow('Translation model', mtModelSelect()),
        mkRow('Run the translator on', sel([
          ['gpu', 'Graphics card (fast)'],
          ['cpu', 'Processor only (any PC, slower)'],
        ], S.set.mtDevice === 'cpu' ? 'cpu' : 'gpu', (val) => { S.set.mtDevice = val; save('set'); drawSettings(); runPlamoTranslate(false); })),
        mtModelNote(),
        mkSwitch('Translate every video with local AI', S.set.autoAiTranslate !== false, (v) => { S.set.autoAiTranslate = v; save('set'); }),
        mkSwitch('Translate selected text on any website', S.set.selectTranslate !== false, (v) => { S.set.selectTranslate = v; save('set'); }),
        mkRow('Speech-to-text model', sel([
          ['qwen3_small_vulkan', 'Qwen3-ASR 0.6B (default · fast)'],
          ['auto', 'Automatic'],
          ['whisper_vulkan', 'Whisper v3 Turbo (Vulkan GPU)'],
          ['qwen3_vulkan', 'Qwen3-ASR 1.7B (Vulkan · Mixed/Chinese/Cantonese)'],
          ['faster_whisper', 'Faster-Whisper (CPU Fallback)'],
        ], S.set.asrBackend || 'qwen3_small_vulkan', (val) => { S.set.asrBackend = val; save('set'); })),
        mkSwitch('Transcribe videos that have no subtitles', S.set.autoTranscribeMissing !== false, (v) => { S.set.autoTranscribeMissing = v; save('set'); }),
        V ? mkRow('Transcribe this video now', h('button', {
          class: 'ss-teal',
          onclick: () => { closeSettingsModal(); runLocalASR(true); },
        }, 'Transcribe')) : null,
        mkSwitch('Show human and AI translation together', !!S.set.showDualHumanAi, (v) => {
          S.set.showDualHumanAi = v; save('set');
          if (v && companionHealth && companionHealth.plamo && V && V.lines.length && !V.aiTr) runPlamoTranslate(true);
          else { drawList(); if (V && V.cur >= 0) drawLine(V.cur); }
        })),
      h('div', { class: 'ss-sec-hdr', id: 'ss-sec-subs' }, 'Subtitles'),
      V && trackOpts.length ? mkRow('Subtitle language', sel(trackOpts, V.trackKey, (val) => { S.set.trackKey = val; S.set.trackVid = curVidKey(); S.set.lang = val.split('|')[0]; save('set'); load(); drawSettings(); })) : null,
      V ? mkRow('Translate to', sel([['', 'Off']].concat(V.tlOpts || []), S.set.tl || '', (val) => { S.set.tl = val; save('set', true); load(); drawSettings(); })) : null,
      V && S.set.tl ? mkRow('Translation track', sel([
        ['', 'Prefer publisher captions'],
        ...((V.info.tracks || []).filter(t => !t.auto && !['asr','forced'].includes(t.kind) && sameTranslationLanguage(t.lang, S.set.tl))
          .map(t => [trackKey(t), t.name || t.lang])),
        ['machine', 'Machine translation'],
      ], S.set.translationTrackVideo === V.videoKey && S.set.translationTrackLanguage === S.set.tl ? S.set.translationTrack || '' : '', val => {
        S.set.translationTrack = val; S.set.translationTrackVideo = V.videoKey; S.set.translationTrackLanguage = S.set.tl;
        save('set'); load(); drawSettings();
      })) : null,
      V?.editStorageKey ? mkRow('Current subtitle',h('button',{class:'ss-btn-chip',disabled:V.cur<0,
        onclick:editCurrentTranslation},'Edit translation')) : null,
      V ? mkRow('Third language (trilingual subtitles)', sel([['', 'Off']].concat(V.tlOpts || []), S.set.tl2 || '', (val) => { S.set.tl2 = val; save('set'); load(); drawSettings(); })) : null,
      mkRow('Readings above Japanese / Chinese / Cantonese / Korean', sel([
        ['romaji', 'Romaji / Pīnyīn / Jyutping (Auto)'],
        ['hira', 'Hiragana (かな)'],
        ['pinyin', 'Pīnyīn Only (Mandarin)'],
        ['zhuyin', 'Zhuyin Only (注音)'],
        ['romaji_latin', 'Romaji (Latin)'],
        ['jyutping', 'Jyutping Only (粵拼 Cantonese)'],
        ['off', 'Off'],
      ], getReadingAidMode(), (val) => { S.set.readingAid = val; save('set'); drawHead(); drawList(); if (V && V.cur >= 0) drawLine(V.cur); })),
      mkSwitch('Tone colours on readings (Pīnyīn / 注音 / 粵拼)', !!S.set.toneColors, (v) => { S.set.toneColors = v; save('set'); drawList(); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Noun gender colours: blue m · rose f · green n (DE FR ES PT IT RU)', !!S.set.genderColors, (v) => { S.set.genderColors = v; save('set'); applyVisualPrefs(); }),
      mkSwitch('Japanese pitch accent on minimal pairs (ꜜ / ‾)', S.set.showPitchAccent !== false, (v) => { S.set.showPitchAccent = v; save('set'); drawList(); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Grammar POS colours: green noun · blue verb · amber adj (JA / ZH / YUE)', S.set.posColors !== false, (v) => { S.set.posColors = v; save('set'); applyVisualPrefs(); drawList(); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Russian & Tagalog stress marks (сказа́л / walâ)', !!S.set.showStressMarks, (v) => { S.set.showStressMarks = v; save('set'); drawHead(); drawList(); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Hide readings on words you know', S.set.fadeKnownReadings !== false, (v) => { S.set.fadeKnownReadings = v; save('set'); applyVisualPrefs(); }),
      mkRange('Subtitle text size', S.set.overlayScale || 1, 0.7, 1.5, 0.05, (v) => { S.set.overlayScale = v; save('set'); applyVisualPrefs(); }),
      mkRange('Subtitle height on the video', captionBottom(), 2, 34, 1, (v) => { S.set.subtitleBottomPct = v; save('set'); applyVisualPrefs(); }),
      mkRange('Subtitle background opacity', S.set.overlayBgOpacity != null ? S.set.overlayBgOpacity : 0.84, 0.1, 0.96, 0.04, (v) => { S.set.overlayBgOpacity = v; save('set'); applyVisualPrefs(); }),
      mkSwitch('Show translation above original line', !!S.set.transAboveOrig, (v) => { S.set.transAboveOrig = v; save('set'); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Show source badges on video overlay (YT Auto / MT)', !!S.set.showOverlayBadges, (v) => { S.set.showOverlayBadges = v; save('set'); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Merge split subtitle lines sharing one translation', S.set.mergeSharedTr !== false, (v) => { S.set.mergeSharedTr = v; save('set'); drawList(); }),
      mkSwitch('Auto-hide YouTube playback bar when mouse leaves', !!S.set.autoHideYtpBar, (v) => { S.set.autoHideYtpBar = v; save('set'); applyVisualPrefs(); }),
      V ? mkRow('Subtitle timing sync offset', h('span', { style: { display: 'flex', gap: '5px', alignItems: 'center' } },
        h('button', { class: 'ss-btn-chip', onclick: () => changeGlobalSync(-0.25) }, '−0.25s'),
        h('b', { style: { minWidth: '52px', textAlign: 'center' } }, `${(V.subOffset || 0) >= 0 ? '+' : ''}${(V.subOffset || 0).toFixed(2)}s`),
        h('button', { class: 'ss-btn-chip', onclick: () => changeGlobalSync(+0.25) }, '+0.25s'),
        V.subOffset ? h('button', { class: 'ss-btn-chip', onclick: () => changeGlobalSync(null) }, 'Reset') : null)) : null,
      V?.lines.length && !isLiveContext() ? mkRow('Sync from this line', h('span', {},
        h('button', {class:'ss-btn-chip', disabled:V.cur < 0, onclick:()=>{
          V.syncAnchor = V.lines[V.cur]?.s; drawSettings();
        }}, Number.isFinite(V.syncAnchor) ? fmt(V.syncAnchor) : 'Select current line'),
        ...(Number.isFinite(V.syncAnchor) ? [
          h('button',{class:'ss-btn-chip',onclick:()=>changeSectionSync(-0.25)},'−0.25s'),
          h('span',{}, ' ' + subOff(V.syncAnchor).toFixed(2) + 's '),
          h('button',{class:'ss-btn-chip',onclick:()=>changeSectionSync(0.25)},'+0.25s'),
          h('button',{class:'ss-btn-chip',onclick:()=>changeSectionSync(null)},'Reset here')
        ] : []))) : null,
      mkRow('Repetitions',sel([['0','Until stopped'],['2','Twice'],['3','Three times'],['5','Five times']],
        String(S.set.repeatCount || 0),v=>{S.set.repeatCount=Number(v);save('set');clearRepeatSession(true);})),
      mkSwitch('Leave time to say the line between repeats',!!S.set.repeatSpeakingGap,v=>{
        S.set.repeatSpeakingGap=v;save('set');clearRepeatSession(true);
      }),
      mkRow('Extra audio around repeated lines', sel([['0','None'],['0.25','0.25 seconds'],['0.5','0.5 seconds'],['1','1 second']], String(S.set.repeatPadding ?? 0.25), value => { S.set.repeatPadding = Number(value); save('set'); })),
      mkSwitch('Reserve space below the video for fullscreen subtitles', S.set.fullscreenShelf !== false, (v) => { S.set.fullscreenShelf = v; save('set'); applyVisualPrefs(); }),
      mkSwitch('Hide [music] and ♪ tags', S.set.cleanStageNoise !== false, (v) => {
        S.set.cleanStageNoise = v; save('set');
        if (V && V.lines.length) { V.lines = prepareLines(V.lines); drawList(); if (V.cur >= 0) drawLine(V.cur); }
      }),
      h('div', { class: 'ss-sec-hdr', id: 'ss-sec-study' }, 'Study'),
      mkRow('Mode', sel([
        ['simple', 'Simple'],
        ['pro', 'Study (adds Practice and Review)'],
      ], S.set.uiMode || 'simple', (val) => {
        S.set.uiMode = val; save('set');
        if (val !== 'pro' && tab !== 'lines' && tab !== 'glossary' && tab !== 'saved') tab = 'lines';
        drawHead(); drawList(); drawSettings();
      })),
      mkRow('Your vocabulary level', sel([...new Set([500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, curVocabLevel()])].sort((a, b) => a - b).map((n) => [String(n), `About ${n.toLocaleString()} words`]),
        String(curVocabLevel()), (val) => {
          S.set.vocabLevel = Number(val);
          if (V && V.lang) {
            S.set.vocabLevelsByLang = Object.assign({}, S.set.vocabLevelsByLang || {}, { [normLangCode(V.lang)]: Number(val) });
          }
          save('set'); load(); drawSettings();
        })),
      mkSwitch('Auto-calibrate vocabulary level from reading & viewing', S.set.autoCalibrateLevel !== false, (v) => { S.set.autoCalibrateLevel = v; save('set'); }),
      mkSwitch('Incidental spaced recall on due saved phrases', S.set.incidentalFsrs !== false, (v) => { S.set.incidentalFsrs = v; save('set'); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkRow('When clicking a subtitle word', sel([
        ['open_pause', 'Open dictionary & pause video'],
        ['open_play', 'Open dictionary (keep playing)'],
        ['mark_speak', 'Mark Learning / Known & speak aloud'],
      ], S.set.wordClickAction || 'open_pause', (val) => { S.set.wordClickAction = val; save('set'); })),
      mkSwitch('Speak word or phrase aloud on click', !!S.set.speakOnClick, (v) => { S.set.speakOnClick = v; save('set'); }),
      mkSwitch('Hide grammar-frame & collocation underlines on video (keep idioms)', !!S.set.hideBundleUnderlines, (v) => { S.set.hideBundleUnderlines = v; save('set'); applyVisualPrefs(); drawList(); }),
      mkSwitch('Deepen underlines for expressions I hear often', !!S.set.personalFrequency, on => {
        S.set.personalFrequency = on; save('set'); refreshSceneFrequency(V); drawList(); if (V?.cur >= 0) drawLine(V.cur);
      }),
      mkSwitch('Start dictionary lookups with a hint', !!S.set.hintFirst, on => { S.set.hintFirst = on; save('set'); }),
      mkRow('Watched scene links', h('button', { class: 'ss-btn', onclick: async () => {
        if (confirm('Clear all watched scene links across videos?')) {
          const result = await bg({ op: 'clearWatchedScenes' });
          if (result.ok && V) { V.sceneFrequency?.clear(); drawList(); if (V.cur >= 0) drawLine(V.cur); }
          toast(result.ok ? 'Watched scene links cleared' : 'Could not clear scene links');
        }
      } }, 'Clear scene links')),
      mkSwitch('Remember watched expressions for scene links and quizzes', S.set.idiomHistory !== false, (v) => { S.set.idiomHistory = v; save('set'); }),
      mkSwitch('Hover a word for a quick meaning (click opens every dictionary)', S.set.hoverPeek !== false, (v) => { S.set.hoverPeek = v; save('set'); }),
      mkSwitch('Arrow keys move between lines (like A / D)', !!S.set.arrowKeys, (v) => { S.set.arrowKeys = v; save('set'); }),
      mkSwitch('Pause on subtitle hover (resume on leave)', !!S.set.pauseOnSubHover, (v) => { S.set.pauseOnSubHover = v; save('set'); }),
      mkSwitch('Frequency band underlines (2k–8k / 8k–20k)', S.set.freqUnderlines !== false, (v) => { S.set.freqUnderlines = v; save('set'); drawList(); if (V && V.cur >= 0) drawLine(V.cur); }),
      mkSwitch('Condensed playback (skip long unsubtitled gaps)', !!S.set.condensedPlayback, (v) => { S.set.condensedPlayback = v; save('set'); drawHead(); }),
      mkRow('Listening shield / blur mode (B)', sel([
        ['off', 'Show all subtitles'],
        ['tr', 'Blur translation until hover / E'],
        ['both', 'Blur both lines until hover / E'],
        ['audio', 'Audio-first (hide overlay until hover / E)'],
      ], getBlurMode(), (val) => setBlurMode(val))),
      mkSwitch('Dim words you know', S.set.dimKnown, (v) => { S.set.dimKnown = v; save('set'); applyVisualPrefs(); }),
      mkSwitch('Panel beside the video (off = in the sidebar)', S.set.layoutMode !== 'inline', (v) => { S.set.layoutMode = v ? 'stage' : 'inline'; save('set'); applyVisualPrefs(); drawHead(); }),
      mkSwitch('Smart Auto-Flow speed (normal on dialogue, 1.5× on silence)', !!S.set.smartSpeedFlow, (v) => { S.set.smartSpeedFlow = v; save('set'); drawHead(); }),
      mkSwitch('Dark theme', S.set.darkTheme !== false, (v) => { S.set.darkTheme = v; save('set'); applyVisualPrefs(); modalBack.querySelector('#ss-modal').classList.toggle('ss-theme-light', v === false); }),
      h('section', { id: 'ss-sec-web', class: 'ss-set-sec' },
        h('div', { class: 'ss-sec-hdr' }, 'Webpages & Burned-In Frame OCR'),
        mkRow('Webpage bilingual scope (Alt+T)', sel([
          ['article', 'Article Only (識文 · main content)'],
          ['full', 'Full Page (docs, forums, dashboards)'],
        ], S.set.pageBilingualScope || 'article', (v) => { S.set.pageBilingualScope = v; save('set'); })),
        mkRow('Webpage bilingual display', sel([
          ['dual', 'Bilingual (Teal accent bar)'],
          ['dim', 'Bilingual (Subtle secondary line)'],
          ['replace', 'Translation Only (reversible)'],
        ], S.set.pageBilingualStyle || 'dual', (v) => { S.set.pageBilingualStyle = v; save('set'); })),
        mkRow('Single-paragraph hover mode', sel([
          ['ctrl', 'Hold Ctrl + Hover'],
          ['alt', 'Hold Alt + Hover'],
          ['ctrl_click', 'Ctrl + Click paragraph'],
          ['off', 'Off'],
        ], S.set.pageHoverMode || 'ctrl', (v) => { S.set.pageHoverMode = v; save('set'); })),
        mkSwitch('Highlight 12-language fe_*.json idioms on webpages', S.set.pageIdiomChips !== false, (v) => { S.set.pageIdiomChips = v; save('set'); }),
        mkSwitch('Input-box Tab-to-accept translator (Alt+I)', S.set.inputTranslate !== false, (v) => { S.set.inputTranslate = v; save('set'); }),
        mkSwitch('Mask API keys, emails & Luhn bank cards locally', !!S.set.maskSensitivePii, (v) => { S.set.maskSensitivePii = v; save('set'); }),
        mkRow('Vision OCR URL (for burned-in video subtitles)', h('input', {
          type: 'text', placeholder: 'http://127.0.0.1:11434/v1/chat/completions',
          value: S.set.ocrUrl || '',
          onchange: (e) => { S.set.ocrUrl = e.target.value.trim(); save('set'); },
        })),
        mkRow('Vision OCR model', h('input', {
          type: 'text', placeholder: 'qwen2.5vl:7b / minicpm-v / gemini-2.5-flash',
          value: S.set.ocrModel || '',
          onchange: (e) => { S.set.ocrModel = e.target.value.trim(); save('set'); },
        })),
        mkRow('Webpage translation cache', h('button', {
          class: 'ss-btn-chip',
          onclick: () => {
            chrome.runtime.sendMessage({ op: 'trCacheClear' }, () => toast('Webpage translation cache cleared'));
          },
        }, 'Clear Cached Webpage Translations'))),
      h('section', { id: 'ss-sec-adv', class: 'ss-set-sec' },
        h('div', { class: 'ss-sec-hdr' }, 'Advanced'),
        mkSwitch('Use Custom Cloud / Ollama Big LLM', !!S.set.useBigLlm, (v) => { S.set.useBigLlm = v; save('set'); }),
        mkRow('Endpoint URL', h('input', {
          type: 'text', placeholder: 'http://127.0.0.1:11434/v1/chat/completions',
          value: S.set.llmUrl || '',
          onchange: (e) => { S.set.llmUrl = e.target.value.trim(); save('set'); },
        })),
        mkRow('Model name', h('input', {
          type: 'text', placeholder: 'qwen2.5:14b / deepseek-chat / gemini-2.5-flash',
          value: S.set.llmModel || '',
          onchange: (e) => { S.set.llmModel = e.target.value.trim(); save('set'); },
        })),
        mkRow('API Key (local browser only)', h('input', {
          type: 'password', placeholder: 'sk-... (optional for Ollama)',
          value: S.set.llmKey || '',
          onchange: (e) => { S.set.llmKey = e.target.value.trim(); save('set'); },
        })),
        V && V.lines.length ? mkRow('Run Big-LLM pass', h('button', {
          class: 'ss-teal',
          onclick: () => { closeSettingsModal(); runPlamoTranslate(false, run, true); },
        }, 'Translate w/ Custom LLM')) : null,
        mkSwitch('Auto-reload extension on file edits', S.set.devAutoReload !== false, (v) => { S.set.devAutoReload = v; save('set'); }),
        mkRow('Research ablation profile', sel([
          ['full', 'Full (All features)'],
          ['control_plain', 'Control (No enhancement/drills)'],
          ['enhancement_only', 'Input Enhancement Only'],
          ['contrastive_gloss', 'Enhancement + Contrastive Gloss'],
          ['retrieval_consolidation', 'Enhancement + Retrieval Drills'],
        ], S.set.researchProfile || 'full', (val) => {
          S.set.researchProfile = val; save('set');
          if (tab === 'practice' && !getProfile().drills) tab = 'lines';
          drawHead(); drawList(); if (V && V.cur >= 0) drawLine(V.cur);
        })),
        mkRow('Companion URL', h('input', {
          type: 'text',
          value: S.set.companionUrl || 'http://127.0.0.1:8787',
          onchange: (e) => {
            S.set.companionUrl = e.target.value.trim(); save('set');
            chrome.runtime.sendMessage({ op: 'setCompanionUrl', url: S.set.companionUrl });
          },
        })),
        mkRow('AnkiConnect URL', h('input', {
          type: 'text',
          value: S.set.ankiConnectUrl || 'http://127.0.0.1:8765',
          onchange: (e) => { S.set.ankiConnectUrl = e.target.value.trim(); save('set'); },
        }))),
      h('section', { id: 'ss-sec-kbd', class: 'ss-set-sec' },
        h('div', { class: 'ss-sec-hdr' }, 'Keyboard shortcuts'),
        h('div', { class: 'ss-kbd-list' },
        mkKbd('A', 'Previous subtitle'),
        mkKbd('S', 'Replay subtitle'),
        mkKbd('D', 'Next subtitle'),
        mkKbd('W / Space', 'Play / Pause'),
        mkKbd('B / E', 'Cycle blur shield / Reveal line'),
        mkKbd('R', 'Save line'),
        mkKbd('L', 'Repeat current line'),
        mkKbd('[ / ]', 'Set A–B multi-line loop start / end'),
        mkKbd('1 / 2', 'Playback speed −0.1× / +0.1×'),
        mkKbd('C', 'Copy line + translation'),
        mkKbd('O', 'Capture burned-in subtitle frame (OCR)'),
        mkKbd('Alt + T / Alt + D', 'Webpage bilingual / Compare models'),
        mkKbd('Shift + Click', 'Select multi-word phrase span'),
        mkKbd('Right-click', 'Cycle Learning / Known'),
        mkKbd('Esc', 'Close window'))));

    const modalCard = h('div', {
      id: 'ss-modal',
      class: S.set.darkTheme === false ? 'ss-theme-light' : '',
      onclick: (e) => e.stopPropagation(),
    }, leftCol, rightCol);
    appendClean(modalBack, modalCard);
    rightCol.scrollTop = setScroll;
    // highlight the section being read in the left nav
    rightCol.addEventListener('scroll', () => {
      setScroll = rightCol.scrollTop;
      let cur = null;
      for (const sec of rightCol.querySelectorAll('#ss-sec-ai, #ss-sec-subs, #ss-sec-study, #ss-sec-web, #ss-sec-adv, #ss-sec-kbd')) {
        if (sec.offsetTop - rightCol.offsetTop <= rightCol.scrollTop + 40) cur = sec.id;
      }
      if (rightCol.scrollTop + rightCol.clientHeight >= rightCol.scrollHeight - 4) cur = 'ss-sec-kbd';
      if (cur && cur !== setNavActive) {
        setNavActive = cur;
        leftCol.querySelectorAll('.ss-nav-btn').forEach((b) => b.classList.toggle('ss-act', b.dataset.sec === cur));
      }
    }, { passive: true });
  };

  // ---- Header & Tabs ----
  let dockMoreOpen = false, exportOpen = false;
  const trackKey = (t) => t.lang + '|' + (t.auto ? 'auto' : 'human') + '|' + (t.name || '');

  const drawHead = () => {
    if (!headEl) return;
    headEl.textContent = '';
    if (qbarEl) qbarEl.textContent = '';
    if (!V) return;
    const isPro = S.set.uiMode === 'pro';
    const trackOpts = (V.info.tracks || []).map((t) => [trackKey(t), (t.name || t.lang) + (t.auto && !/auto/i.test(t.name || '') ? ' (auto)' : '')]);
    const v = video();
    const normCur = normLangCode(V.lang);
    const hasCjk = (V.lines || []).some((l) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(l.t)) || /^(ja|zh|cn|yue|ko)/.test(normCur);

    appendClean(headEl,
      trackOpts.length ? sel(trackOpts, V.trackKey, (val) => { S.set.trackKey = val; S.set.trackVid = curVidKey(); S.set.lang = val.split('|')[0]; save('set'); load(); }) : null,
      sel([['', 'Translate: Off']].concat(V.tlOpts || []), S.set.tl || '', (val) => { S.set.tl = val; save('set', true); load(); }),
      h('button', { title: 'Settings & Shortcuts', onclick: () => { settingsOpen = !settingsOpen; drawSettings(); } }, '⚙'),
      h('button', { class: 'ss-hide-panel', title: 'Hide panel (H). Subtitles on the video stay on.', onclick: () => {
        if (document.fullscreenElement && panel) { panel.dataset.fsOpen = '0'; applyVisualPrefs(); setTimeout(() => window.dispatchEvent(new Event('resize')), 60); }
        else setPanelHidden(true);
      } }, '»'));

    const d = V.analysis && V.analysis.diff;
    if (d && d.totalTokens > 0 && V.ranks && (qtrayOpen || fitCardOpen)) {
      appendClean(headEl, h('button', {
        class: 'ss-fit-chip', id: 'ss-vocabulary-guide',
        title: 'See words to review from these subtitles',
        'aria-expanded': String(fitCardOpen && tab === 'lines'), 'aria-controls': 'ss-list',
        onclick: () => {
          fitCardOpen = tab !== 'lines' || !fitCardOpen;
          tab = 'lines';
          drawHead(); drawList();
          document.getElementById('ss-vocabulary-guide')?.focus?.();
        },
      }, 'Vocabulary guide'));
    }
    if (isPro) {
      appendClean(headEl, h('span', { class: 'ss-badge', title: 'Points earned from practice and review' }, `${S.xp || 0} XP · ${SS_STORE.levelFor(S.xp || 0)}`));
    }

    if (qbarEl) {
      const bm = getBlurMode();
      const blurLbl = bm === 'off' ? 'Captions visible' : bm === 'tr' ? 'Translation blurred' : bm === 'both' ? 'Captions blurred' : 'Audio only';
      const loopActive = loopIdx >= 0 || !!loopRange;
      const loopLbl = loopRange ? 'Stop repeating lines' : (loopIdx >= 0 ? 'Stop repeating line' : 'Repeat line');
      const curRate = S.set.smartSpeedFlow ? 'flow' : String(Math.round(((v && v.playbackRate) || 1) * 100) / 100);
      const speedSel = sel([
        ['0.75', '0.75×'],
        ['0.85', '0.85×'],
        ['1', '1.0×'],
        ['1.15', '1.15×'],
        ['1.25', '1.25×'],
        ['flow', 'Auto-Flow'],
      ], ['0.75', '0.85', '1', '1.15', '1.25', 'flow'].includes(curRate) ? curRate : '1', (val) => {
        if (val === 'flow') {
          S.set.smartSpeedFlow = true;
          save('set');
          toast('Auto-Flow on: normal speed on speech, 1.5× over silence');
        } else {
          S.set.smartSpeedFlow = false;
          const num = parseFloat(val) || 1;
          S.set.dialogueSpeed = num;
          if (v) v.playbackRate = num;
          save('set');
        }
        drawHead();
      });
      speedSel.className = 'ss-qpill';
      speedSel.title = 'Playback speed (keys 1 / 2)';
      speedSel.setAttribute('aria-label', 'Playback speed');

      let rSel = null;
      if (hasCjk) {
        rSel = sel([
          ['romaji', 'Readings: Auto'],
          ['hira', 'かな'],
          ['romaji_latin', 'Romaji'],
          ['pinyin', 'Pīnyīn'],
          ['zhuyin', '注音'],
          ['jyutping', '粵拼'],
          ['off', 'Readings: Off'],
        ], getReadingAidMode(), (val) => {
          S.set.readingAid = val; save('set'); drawHead(); drawList(); if (V.cur >= 0) drawLine(V.cur);
        });
        rSel.className = 'ss-qpill';
        rSel.title = 'Phonetic reading aid above Japanese / Mandarin / Cantonese / Korean';
        rSel.setAttribute('aria-label', 'Subtitle readings');
      }

      const stressBtn = (normCur === 'ru' || normCur === 'tl') ? h('button', {
        class: 'ss-qpill' + (S.set.showStressMarks ? ' ss-teal' : ''),
        title: 'Toggle inline stress & diacritic marks (сказа́л / walâ)',
        onclick: () => { S.set.showStressMarks = !S.set.showStressMarks; save('set'); drawHead(); drawList(); if (V.cur >= 0) drawLine(V.cur); },
      }, 'Á Stress') : null;

      const contextualControl = rSel || stressBtn || speedSel;

      const recall = /^(yt:|bili:)/.test(curVidKey()) ? h('button', { type: 'button', id: 'ss-scene-recall',
        class: 'ss-qpill' + (tab === 'recall' ? ' ss-act' : ' ss-teal'), 'aria-pressed': String(tab === 'recall'),
        onclick: () => { closeDock(); tab = tab === 'recall' ? 'lines' : 'recall'; drawHead(); drawList(); document.getElementById('ss-scene-recall')?.focus?.(); },
      }, 'Scene Recall') : null;
      const copy = V.lines.length ? h('button', {
        class: 'ss-qpill ss-copy-transcript',
        title: 'Copy these subtitles. Shift-click to switch whether timestamps are included.',
        onclick: async (ev) => {
          const withTime = S.set.copyWithTimes !== false;
          try {
            await navigator.clipboard.writeText(transcriptText(ev.shiftKey ? !withTime : withTime));
            toast('Transcript copied');
          } catch (_) { toast('Could not copy the transcript'); }
        },
      }, 'Copy transcript') : null;
      const mainRow = h('div', { class: 'ss-qbar-main' }, copy,
        h('button', {
          class: 'ss-qpill' + (bm !== 'off' ? ' ss-act' : ''),
          title: 'Change what subtitles are visible (B). Reveal the current line (E).',
          onclick: cycleBlurMode,
        }, blurLbl),
        contextualControl,
        h('button', { type: 'button', class: 'ss-qpill ss-qmore', 'aria-expanded': String(qtrayOpen),
          title: 'More subtitle tools', onclick: () => { qtrayOpen = !qtrayOpen; drawHead(); } }, qtrayOpen ? 'Less' : 'More'));
      appendClean(qbarEl, mainRow);

      const tray = h('div', { class: 'ss-qtray' },
        recall,
        h('button', {
          class: 'ss-qpill' + (loopActive ? ' ss-teal' : ''),
          title: 'Repeat current line (L), or press [ and ] to loop a multi-line dialogue range',
          onclick: () => {
            clearRepeatSession(true);
            if (loopRange || loopIdx >= 0) { loopRange = null; loopIdx = -1; }
            else {
              loopIdx = Math.max(0, V.cur);
              if (V.lines[loopIdx] && (S.set.repeatCount || S.set.repeatSpeakingGap)) {
                const start=V.lines[loopIdx].s;
                seek(Math.max(0,start-Number(S.set.repeatPadding ?? 0.25)), -1, start);
              }
            }
            drawHead(); drawList();
          },
        }, loopLbl),
        contextualControl !== speedSel ? speedSel : null,
        h('button', {type:'button', class:'ss-qpill', title:'Hold to listen at up to 0.75× speed', onpointerdown:holdSlow, onkeydown:holdSlow, onblur:restoreHeldSpeed}, 'Hold to slow'),

        (rSel && stressBtn) ? stressBtn : null,
        h('button', {
          class: 'ss-qpill',
          title: 'Open a local EPUB, Markdown, or subtitle file in the reader',
          onclick: () => { try { chrome.runtime.sendMessage({ op: 'openExtPage', page: 'reader.html' }); } catch (_) {} },
        }, 'Open a document'),
        transcriptTool(),
        V.subOffset ? h('button', {
          class: 'ss-qpill ss-act',
          title: 'Subtitle sync offset active — click to reset to 0.0s',
          onclick: () => changeGlobalSync(null),
        }, `Sync ${V.subOffset > 0 ? '+' : ''}${V.subOffset.toFixed(2)}s`) : null);
      if (qtrayOpen || V.subOffset) appendClean(qbarEl, tray);
    }

    tabsEl.textContent = '';
    const dueCount = SS_STORE.dueReviews(S.items, Date.now(), Infinity).filter((it) => it.reviewStage !== 'new').length;
    const feCount = V.analysis ? (V.analysis.allFEs || V.analysis.targetFEs).length : 0;  // every match, not only the top 7
    const prof = getProfile();
    const tabDefs = isPro
      ? [
          ['lines', 'Subtitles'],
          ['glossary', `Glossary (${feCount})`],
          prof.drills ? ['practice', 'Practice'] : null,
          ['review', `Review${dueCount ? ` (${dueCount})` : ''}`],
          ['saved', `Saved (${S.items.length})`],
        ].filter(Boolean)
      : [
          ['lines', 'Subtitles'],
          // Idioms and Practice tabs fold behind the toolbar's 'More' (still shown while open).
          qtrayOpen || tab === 'glossary' ? ['glossary', `Idioms (${feCount})`] : null,
          prof.drills && V.lines.length && (qtrayOpen || tab === 'practice') ? ['practice', 'Practice'] : null,
          ['saved', `Saved (${S.items.length})`],
        ].filter(Boolean);
    for (const [k, label] of tabDefs) {
      appendClean(tabsEl, h('button', {
        class: tab === k ? 'ss-act' : '',
        onclick: () => {
          tab = k; drawHead(); drawList();
          if (liveState.active && (k === 'glossary' || k === 'practice')) {
            clearTimeout(liveState.studyTimer); liveState.studyTimer = null;
            scheduleLiveStudy(run);
          }
        },
      }, label));
    }
    drawSettings();
  };

  // ---- Paused-Video Burned-In Subtitle Frame OCR Studio (v0.5.0) ----
  let ocrBackEl = null;
  const closeBurnedInOcrModal = () => {
    if (ocrBackEl) { ocrBackEl.remove(); ocrBackEl = null; }
  };

  const captureVideoSubtitleCrop = (v, mode = 'band') => {
    if (!v || !v.videoWidth || !v.videoHeight) return '';
    try {
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const sy = mode === 'band' ? Math.round(vh * 0.70) : 0;
      const sh = mode === 'band' ? Math.max(40, vh - sy) : vh;
      const scale = Math.min(1, 1280 / Math.max(1, vw));
      const cw = Math.max(1, Math.round(vw * scale));
      const ch = Math.max(1, Math.round(sh * scale));
      const cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const ctx = cv.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(v, 0, sy, vw, sh, 0, 0, cw, ch);
      return cv.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  };

  const toggleFrameCaptions = () => {
    const view = V, media = video();
    if (!view || !media) return;
    if (view.frameWatch) { view.frameWatch.stop(); return; }
    if (media.mediaKeys) { toast('This player blocks frame capture. Choose a subtitle track.'); return; }
    if (asrState.active) asrState.stopRequested = true;
    if (liveState.active) stopLiveCaptions();
    let timer, previous = null, generation = 0;
    const current = () => V === view && view.frameWatch === watch && video() === media;
    const discontinuity = () => { generation++; previous = null; };
    const watch = {stop() {
      clearTimeout(timer); generation++;
      media.removeEventListener('seeking',discontinuity);
      view.frameWatch = null;
      if (V === view) drawList();
    }};
    view.frameWatch = watch;
    media.addEventListener('seeking',discontinuity);
    const scan = async () => {
      if (!current()) { watch.stop(); return; }
      const stamp = generation, target = S.set.tl, start = media.currentTime;
      const valid = () => current() && stamp === generation && S.set.tl === target;
      try {
        if (media.ended) { watch.stop(); return; }
        if (media.paused || media.seeking || media.readyState < 2) return;
        const frame = captureVideoSubtitleCrop(media,'band');
        if (!frame) { watch.stop(); toast('This video frame cannot be read.'); return; }
        const lang = S.set.asrLangHint || view.lang || 'auto';
        const result = await bg({op:'ocrFrame',textOnly:true,subtitleBand:true,imageDataUrl:frame,lang,tl:target,url:S.set.companionUrl,
          ocrUrl:S.set.ocrUrl,ocrModel:S.set.ocrModel,ocrKey:S.set.ocrKey});
        if (!valid()) return;
        const text = result?.text?.replace(/\s+/g,' ').trim();
        if (!text) {
          if (result?.needsConfig) { watch.stop(); toast(result.error); }
          if (previous && previous.s < start) { previous.d = Math.min(previous.d,start-previous.s); previous.e = previous.s+previous.d; }
          previous = null; return;
        }
        if (previous?.t === text && previous.frameTranslation?.target === target) {
          previous.d = Math.max(previous.d,media.currentTime+1-previous.s);
          previous.e = previous.s+previous.d;
          return;
        }
        const translated = await translateFrameText(text,lang,target,S.set.sceneServices?.subtitle || 'auto');
        if (!valid()) return;
        if (previous && previous.s < start) { previous.d = start-previous.s; previous.e = start; }
        const [cue] = prepareLines([{s:start,d:Math.max(2,media.currentTime-start+1.5),t:text}]);
        if (!cue) return;
        view.lines = mergeAsrSegments(view.lines || [],[cue]);
        previous = view.lines.find(l=>Math.abs(l.s-start)<0.8 && l.t===cue.t) || cue;
        previous.frameTranslation = {target,text:translated};
        if (!view.lang) { view.lang = lang === 'auto' ? inferScriptLang(text,'en') : lang; view.L = SS_LANG.get(view.lang); }
        view.srcProv = 'On-screen text'; view.msg = ''; view.cur = view.lines.indexOf(previous);
        drawLine(view.cur); drawList();
      } catch (_) { if (valid()) { watch.stop(); toast('Could not read on-screen captions.'); } }
      finally { if (current()) timer = setTimeout(scan,650); }
    };
    drawList(); scan();
  };

  const openBurnedInOcrModal = async (initialMode = 'band') => {
    closeBurnedInOcrModal();
    const v = video();
    if (!v) { toast('No active video player found'); return; }
    if (!v.paused) { try { v.pause(); } catch (e) {} }
    const snapTime = Math.max(0, Number(v.currentTime || 0));
    let cropMode = initialMode;
    let dataUrl = captureVideoSubtitleCrop(v, cropMode);

    ocrBackEl = h('div', {
      id: 'ss-ocr-back',
      onclick: (e) => { if (e.target === ocrBackEl) closeBurnedInOcrModal(); },
    });
    const imgEl = dataUrl ? h('img', { src: dataUrl, alt: 'Captured subtitle frame' }) : h('div', { style: { padding: '14px', opacity: '.7' } }, 'Video frame unavailable (DRM or unloaded)');
    const imgWrap = h('div', { class: 'ss-ocr-img-wrap' }, imgEl);
    const statusLine = h('div', { style: { fontSize: '12px', opacity: '.8', marginBottom: '6px' } }, dataUrl ? 'Running frame OCR…' : 'Type or paste burned-in subtitle line below:');
    const textArea = h('textarea', {
      class: 'ss-ocr-ta',
      placeholder: 'Recognized burned-in subtitle text appears here (editable)…',
    });
    const previewBox = h('div', { class: 'ss-ocr-preview', style: { display: 'none' } });

    let latestTrans = '', translatedText = '', translatedTarget = '';
    const view = V;
    let latestDetectedLang = (V && V.lang) || S.set.asrLangHint || 'auto';

    const analyzeCurrentText = async () => {
      const txt = (textArea.value || '').trim();
      if (!txt) { previewBox.style.display = 'none'; return; }
      previewBox.style.display = 'block';
      previewBox.textContent = 'Translating subtitle…';
      const target = S.set.tl;

      const [feRes, trRes] = await Promise.all([
        new Promise((res) => chrome.runtime.sendMessage({
          op: 'matchTextIdioms',
          texts: [txt],
          lang: '',
          tl: S.set.tl || 'en',
          model: S.set.mtModel || 'plamo-2b',
          useBig: !!S.set.useBigLlm,
        }, (r) => res(r || { ok: false }))),
        translateFrameText(txt,latestDetectedLang,target,S.set.sceneServices?.subtitle || 'auto'),
      ]);
      if (!previewBox.isConnected || view !== V || txt !== textArea.value.trim() || target !== S.set.tl) return;
      previewBox.textContent = '';
      if (feRes && feRes.detectedLang) latestDetectedLang = feRes.detectedLang;
      latestTrans = trRes; translatedText = txt; translatedTarget = target;

      appendClean(previewBox,
        h('div', { style: { fontWeight: '600', marginBottom: '4px' } }, latestTrans || 'Translation unavailable'),
        (feRes && Array.isArray(feRes.items) && feRes.items.length)
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '5px' } },
              ...feRes.items.map((it) => h('span', { class: 'ss-eq-chip' },
                `${it.display}${it.reading ? ' [' + it.reading + ']' : ''}${it.meaning ? ' · ' + String(it.meaning).split(/[；;]/)[0].slice(0, 34) : ''}`)))
          : h('div', { style: { fontSize: '11.5px', opacity: '.72' } }, `Detected language: ${latestDetectedLang}`));
    };

    const runOcrPass = () => {
      if (!dataUrl) return;
      statusLine.textContent = 'Running frame OCR…';
      chrome.runtime.sendMessage({
        op: 'ocrFrame',
        imageDataUrl: dataUrl, subtitleBand:cropMode === 'band',
        lang: (V && V.lang) || S.set.asrLangHint || '',
        tl: S.set.tl || 'en',
        model: S.set.mtModel || 'plamo-2b',
        url: S.set.companionUrl || undefined,
        ocrUrl: S.set.ocrUrl || '',
        ocrModel: S.set.ocrModel || '',
        ocrKey: S.set.ocrKey || '',
      }, (r) => {
        if (!statusLine.isConnected) return;
        if (r && r.ok && r.text) {
          statusLine.textContent = `✓ Recognized via ${r.source || 'OCR'} at ${fmt(snapTime)}`;
          textArea.value = r.text;
          analyzeCurrentText();
        } else {
          statusLine.textContent = (r && r.error) || 'Configure a Vision OCR endpoint in Settings → Webpages & OCR, or type the burned-in subtitle below.';
        }
      });
    };

    const insertIntoTimeline = async () => {
      const txt = (textArea.value || '').trim();
      if (!txt) { toast('Enter or recognize subtitle text first'); return; }
      if (!V || V !== view) return;
      const target = S.set.tl;
      const translation = translatedText === txt && translatedTarget === target ? latestTrans :
        await translateFrameText(txt,latestDetectedLang,target,S.set.sceneServices?.subtitle || 'auto');
      if (V !== view || target !== S.set.tl || !previewBox.isConnected || txt !== textArea.value.trim()) return;
      const oldLines = V.lines || [];
      const cue = prepareLines([{ s: Math.round(snapTime * 100) / 100, d: 3.6, t: txt, conf: 0.96 }]);
      V.lines = mergeAsrSegments(V.lines || [], cue);
      if (!V.lang || V.lines.length <= 2) {
        V.lang = latestDetectedLang === 'auto' ? inferScriptLang(txt,'en') : latestDetectedLang;
        V.L = SS_LANG.get(V.lang);
      }
      const inserted = V.lines.find(l=>Math.abs(l.s-cue[0].s)<0.8 && l.t===cue[0].t);
      if (inserted && translation) inserted.frameTranslation = {target,text:translation};
      if (V.sameTiming && V.tr) {
        const byLine = new Map(oldLines.map((l,i)=>[l,V.tr[i]]));
        V.tr = V.lines.map(l=>byLine.get(l) || {s:l.s,d:l.d,t:''});
      }
      V.srcProv = (V.srcProv ? V.srcProv + ' + ' : '') + 'Frame OCR';
      V.msg = '';
      await finishLoadAnalysis(run);
      V.cur = V.lines.findIndex((l) => Math.abs(l.s - cue[0].s) < 0.25);
      drawHead();
      drawList();
      if (V.cur >= 0) drawLine(V.cur);
      closeBurnedInOcrModal();
      toast(`Inserted burned-in subtitle at ${fmt(snapTime)}`);
    };

    const card = h('div', {
      id: 'ss-ocr-card',
      class: S.set.darkTheme === false ? 'ss-theme-light' : '',
      onclick: (e) => e.stopPropagation(),
    },
      h('div', { class: 'ss-ocr-hdr' },
        h('h4', {}, `Burned-In Subtitle Frame OCR (${fmt(snapTime)})`),
        h('button', { class: 'ss-modal-close', onclick: closeBurnedInOcrModal }, '×')),
      imgWrap,
      statusLine,
      textArea,
      previewBox,
      h('div', { class: 'ss-ocr-actions' },
        h('button', { class: 'ss-teal', onclick: insertIntoTimeline }, `Insert into Subtitles @ ${fmt(snapTime)}`),
        h('button', { class: 'ss-btn-chip', onclick: analyzeCurrentText }, 'Translate & Match Idioms'),
        h('button', {
          class: 'ss-btn-chip',
          onclick: () => {
            cropMode = cropMode === 'band' ? 'full' : 'band';
            dataUrl = captureVideoSubtitleCrop(v, cropMode);
            if (dataUrl && imgEl.tagName === 'IMG') imgEl.setAttribute('src', dataUrl);
            runOcrPass();
          },
        }, cropMode === 'band' ? 'Crop: Bottom 30% → Full Frame' : 'Crop: Full Frame → Bottom 30%'),
        h('button', { class: 'ss-btn-chip', onclick: closeBurnedInOcrModal }, 'Close')));

    appendClean(ocrBackEl, card);
    (document.fullscreenElement || document.body).append(ocrBackEl);
    runOcrPass();
  };

  // ---- Local ASR Studio Card (switches cleanly to Live Stream Bilingual Controls when live) ----
  const drawAsrCard = () => {
    const online = companionHealth && companionHealth.ok;
    const isLive = isLiveContext();
    const statusTxt = online
      ? `● ${companionHealth.gpu_backend || 'Online'}`
      : '○ Local GPU off (click to wake)';
    const wakeOrCheck = async () => {
      if (online) { checkCompanionLive(); return; }
      toast('Waking Local Companion…');
      const r = await bg({ op: 'wakeCompanion', force: true });
      await checkCompanionLive();
      if (!(r && r.ok)) toast('Skip Companion: enable Chrome AI / Web MT in Options, drop .srt, or run install_autostart.bat once');
    };
    const card = h('div', { class: 'ss-asr-card' },
      h('h5', {},
        h('span', {}, isLive ? 'Live Stream Bilingual Subtitles' : 'Local AI Transcription (Vulkan GPU)'),
        h('button', { style: { fontSize: '11px', padding: '2px 7px' }, onclick: wakeOrCheck }, statusTxt)),
      !online ? h('div', { style: { fontSize: '11.5px', opacity: '.78', marginBottom: '7px', lineHeight: '1.38' } },
        'Zero-setup ways to skip Companion: turn on platform CC, drop an .srt/.vtt file on the player, or use Free Web MT / Chrome Built-in AI in Options. Companion is only for raw audio ASR & Hardsub OCR.') : null,
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '7px' } },
        sel([
          ['', 'Lang: Auto-detect'],
          ['mixed', 'Mixed (EN + YUE/ZH)'],
          ...SS_LANG.SUPPORTED_12.map(code=>[code, SS_LANG.LANG_META[code].label]),
        ], S.set.asrLangHint || '', (v) => { S.set.asrLangHint = v; save('set'); }),
        sel([
          ['auto', isLive ? 'Automatic live captions' : 'Engine: Auto Vulkan GPU'],
          ...(isLive && companionHealth?.live_whisper_tiny ? [['live_tiny', 'Whisper tiny · low latency']] : []),
          ...(isLive && companionHealth?.live_whisper_base ? [['live_base', 'Whisper base']] : []),
          ['whisper_vulkan', 'Whisper v3 Turbo (Vulkan)'],
          ['qwen3_vulkan', 'Qwen3-ASR 1.7B (Vulkan)'],
          ['qwen3_small_vulkan', 'Qwen3-ASR 0.6B (Vulkan, faster)'],
          ['faster_whisper', 'Faster-Whisper'],
        ], isLive ? S.set.liveAsrBackend || 'auto' : S.set.asrBackend || 'qwen3_small_vulkan', (v) => { if (isLive) S.set.liveAsrBackend = v; else S.set.asrBackend = v; save('set'); })),
      (!V.lines.length || V.frameWatch || V.srcProv === 'On-screen text') ? h('button',{
        type:'button',class:V.frameWatch ? 'ss-act' : '',onclick:toggleFrameCaptions
      }, V.frameWatch ? 'Stop on-screen captions' : 'Translate on-screen captions') : null,
      isLive
        ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            h('button', {
              class: 'ss-teal',
              disabled: !!V.dvrMode || (liveState.active && liveState.mode === 'asr'),
              onclick: () => startLiveAudioCaptions(),
            }, (liveState.active && liveState.mode === 'asr') ? 'Listening…' : 'Live bilingual captions'),
            V.dvrMode ? h('button', {type:'button',disabled:V.returningLive,
              onclick:returnToBroadcast}, 'Back to live') :
              liveState.active && liveReplayStart() !== null ? h('button', {
                type:'button',onclick:replayLiveVideo}, 'Replay video line') : null,
            liveState.replayAudio && V.lines.length ? h('button', {
              type:'button', title:'Hear the last caption in the original broadcast audio',
              onclick:()=>liveState.replayAudio?.(liveState.lastPair || V.lines.at(-1)),
            }, 'Replay last line') : null,
            h('button', {
              disabled: !!V.dvrMode, class: (liveState.active && liveState.mode === 'dom') ? 'ss-act' : '',
              onclick: () => startLiveDomObserver(true),
            }, (liveState.active && liveState.mode === 'dom') ? 'Watching CC' : 'Watch Live CC'),
            h('button', {
              title: 'Capture text directly from video frame (O)',
              onclick: () => openBurnedInOcrModal(),
            }, 'Frame OCR'),
            liveState.active ? h('button', {
              class: 'ss-act',
              onclick: () => { stopLiveCaptions(); drawList(); },
            }, 'Stop Live') : null)
        : h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            h('button', {
              class: 'ss-teal',
              disabled: asrState.active,
              onclick: () => runLocalASR(true),
            }, asrState.active ? 'Transcribing…' : 'Transcribe from Playhead'),
            h('button', {
              disabled: asrState.active,
              onclick: () => runLocalASR(false),
            }, 'From 0:00'),
            h('button', {
              title: 'Capture hardcoded / burned-in subtitles from current video frame (O)',
              onclick: () => openBurnedInOcrModal(),
            }, 'Frame OCR'),
            asrState.active ? h('button', {
              class: 'ss-act',
              onclick: () => { asrState.stopRequested = true; },
            }, '■ Stop') : null));
    appendClean(listEl, card);
  };

  // ---- Vocabulary suggestions for the current subtitles ----
  const drawVideoFitCard = () => {
    const an = V && V.analysis;
    const d = an && an.diff;
    if (!d || !d.totalTokens) return;
    const fit = an.fit;
    const nFe = an.targetFEs.length;
    const speed = d.wpm ? `Speech pace: ${d.rate <= 2 ? 'slow' : d.rate === 3 ? 'medium' : 'fast'} (${Math.round(V.acousticWpm || d.wpm)} words per minute).${d.fastLinesPct >= 30 ? ' Try a slower playback speed.' : ''}` : '';
    const small = { fontSize: '11.5px', opacity: '.84', marginTop: '4px', lineHeight: '1.45' };

    appendClean(listEl, h('div', { class: 'ss-card ss-fit-card' },
      h('b', { class: 'ss-fit-title' }, 'Vocabulary for this video'),
      fit?.suggested.length ? drawSuggestBox(fit) : h('div', { style: small }, 'No words to review first.'),
      nFe ? h('div', { style: small }, `Also ${nFe} idioms worth knowing, in the ${S.set.uiMode === 'pro' ? 'Glossary' : 'Idioms'} tab.`) : null,
      speed ? h('div', { style: small }, speed) : null,
      h('div', { class: 'ss-fit-acts' },
        h('button', { onclick: () => { fitWhyOpen = !fitWhyOpen; drawList(); } }, fitWhyOpen ? 'Hide details' : 'How words are chosen'),
        h('button', {
          title: 'Download a lesson page with the difficulty summary and a quiz (.html)',
          onclick: () => { SS_EXPORT.exportTeacherLessonHtml(V.info, V.analysis, ensureDrills(), V.pieMap || {}); toast('Downloaded lesson (.html)'); },
        }, 'Download lesson page')),
      fitWhyOpen ? h('div', { style: Object.assign({}, small, { paddingTop: '6px', borderTop: '1px solid rgba(128,128,128,.2)' }) },
        h('div', {}, `Suggestions combine how often a word appears in these subtitles, your Known and Learning marks, and your vocabulary level setting (${(S.set.vocabLevel || 2000).toLocaleString()} words).`),
        h('div', {}, 'Mark a word Known to refine the suggestions, or change your level in Settings → Study.'),
        drawLevelHint()) : null));
  };

  // Offer the level estimated from the user's own Known / Learning marks when it differs from the setting.
  const drawLevelHint = () => {
    const est = V && V.ranks ? SS_IDIOMS.estimateLevel(S.words, V.ranks, V.lang || 'en') : null;
    const cur = S.set.vocabLevel || 2000;
    if (!est) return null;
    const lv = est.level >= 2000 ? Math.round(est.level / 500) * 500 : Math.round(est.level / 100) * 100;
    if (Math.abs(Math.log(lv / cur)) < 0.25) return null;
    return h('div', { class: 'ss-sugg', style: { background: 'rgba(120,170,255,.08)', borderColor: 'rgba(120,170,255,.3)' } },
      h('div', { style: { fontSize: '12px' } }, `Your ${est.marks} marked words (${est.known} Known, ${est.learning} Learning) suggest a level of about ${lv.toLocaleString()} words. The setting is ${cur.toLocaleString()}.`),
      h('div', { class: 'ss-fit-acts' }, h('button', { onclick: () => { S.set.vocabLevel = lv; save('set'); load(); } }, `Use ${lv.toLocaleString()}`)));
  };

  // Click a suggested word to mark it Learning. Right-click to mark it Known.
  const drawSuggestBox = (fit) => {
    const toggle = (lem, st) => {
      if (S.words[wKey(lem)] === st) delete S.words[wKey(lem)]; else S.words[wKey(lem)] = st;
      save('words'); repaintMarks(); refreshCoverage(); drawList();
    };
    const n = fit.suggested.length;
    return h('div', { class: 'ss-sugg' },
      h('div', { class: 'ss-sugg-head' }, n === 1 ? 'Start with this word' : `Start with these ${n} words`),
      h('div', { class: 'ss-sugg-words' },
        ...fit.suggested.map((w) => h('button', {
          class: 'ss-sugg-w' + (w.rank > fit.learnCut ? ' ss-sugg-rare' : ''),
          title: `Said ${w.count}× in this video. ${w.rank < 99999 ? 'Number ' + w.rank.toLocaleString() + ' in the common-word list.' : 'Not in the common-word list.'} Click to mark Learning. Right-click for Known.`,
          onclick: () => toggle(w.lemma, 'learning'),
          oncontextmenu: (e) => { e.preventDefault(); toggle(w.lemma, 'known'); },
        }, w.sample, h('small', {}, ' ×' + w.count)))),
      h('div', { class: 'ss-fit-acts' },
        h('button', { onclick: () => { for (const w of fit.suggested) S.words[wKey(w.lemma)] = 'learning'; save('words'); repaintMarks(); refreshCoverage(); drawList(); toast(`Marked ${n} words Learning`); } }, n === 1 ? 'Mark it as Learning' : `Mark all ${n} as Learning`)));
  };

  // ---- Tab Renderers ----
  const drawList = () => {
    hidePeek();
    if (!listEl) return;
    listEl.textContent = '';
    if (!V) return;

    if (tab === 'lines') return drawLinesTab();
    if (tab === 'glossary') return drawGlossaryTab();
    if (tab === 'practice') return drawPracticeTab();
    if (tab === 'review') return drawReviewTab();
    if (tab === 'saved') return drawSavedTab();
    if (tab === 'recall') return drawSceneRecall();
  };

  const localRecallCover = row => {
    const canvas = h('canvas',{class:'ss-recall-thumb',width:112,height:63,'aria-hidden':'true'});
    const id = /^yt:([A-Za-z0-9_-]{11})$/.exec(row.videoKey)?.[1];
    const existing = id && Array.from(document.images).find(image=>{
      if (!image.complete || !image.naturalWidth) return false;
      try {
        const url=new URL(image.currentSrc);
        return url.hostname==='i.ytimg.com' && url.pathname.split('/')[2]===id;
      } catch (_) { return false; }
    });
    if (existing) {
      canvas.getContext('2d').drawImage(existing,0,0,112,63);
      return canvas;
    }
    const item=S.items?.find(entry=>entry.thumbDataUrl && sameVidKey(entry.videoId,row.videoKey)
      && Number.isFinite(entry.t) && Math.abs(entry.t-row.t)<1);
    const match=item && /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(item.thumbDataUrl);
    if (!match) return null;
    try {
      const bytes=Uint8Array.from(atob(match[2]),ch=>ch.charCodeAt(0));
      createImageBitmap(new Blob([bytes],{type:match[1]})).then(bitmap=>{
        try { canvas.getContext('2d').drawImage(bitmap,0,0,112,63); } finally { bitmap.close(); }
      }).catch(()=>canvas.remove());
      return canvas;
    } catch (_) { return null; }
  };

  const drawSceneRecall = async () => {
    const view = V;
    const lang = normLangCode(view.lang || view.info?.lang || S.set.lang);
    const body = h('div', { class: 'ss-scene-library' });
    const status = h('p', { class: 'ss-scene-status', role: 'status' });
    const openReview = h('button', { type: 'button',
      onclick: () => chrome.runtime.sendMessage({ op: 'openExtPage', page: 'review.html' }),
    }, 'Review saved phrases');
    appendClean(listEl, body);
    appendClean(body, status, h('div', { class: 'ss-btns' }, openReview));
    if (S.set.idiomHistory === false) {
      status.textContent = 'Scene history is off. Turn on watched expressions in Settings to use Scene Recall.';
      return;
    }
    status.textContent = 'Finding your recent scenes…';
    const result = await bg({ op: 'listSceneRecall', lang });
    if (!body.isConnected || V !== view || tab !== 'recall' || S.set.idiomHistory === false) return;
    if (!result.ok || !result.groups?.length) {
      status.textContent = result.ok ? 'Watch a few lines with highlighted expressions to find them here.' : 'Could not load scene history.';
      return;
    }
    status.textContent = 'Recent expressions you watched';
    appendClean(body,h('button',{class:'ss-teal',type:'button',onclick:async event=>{
      const button=event.currentTarget;button.disabled=true;
      try {
        const result=await bg({op:'startRecallPlaylist',lang});
        if (result?.ok) video()?.pause(); else toast('No playable scenes in this list.');
      } finally { button.disabled=false; }
    }},'Play recent scenes'));
    for (const { pattern, latest, another } of result.groups) {
      const key = lang === 'en' ? pattern : lang + '|' + pattern;
      const display = S.feHist?.[key]?.display || pattern;
      const link = row => {
        return h('a', { class:'ss-episodic-pill ss-scene-link', href:videoUrlOf(row.videoKey,row.t),
          target:'_blank',rel:'noopener noreferrer'},
          localRecallCover(row),
          h('span',{},row.title || 'Video',' · ',fmtTs(row.t)), h('span',{},row.line));
      };
      const pair = another ? h('button', { type: 'button', onclick: async () => {
        const reply = await bg({ op: 'startScenePair', lang, pattern, first: latest, second: another });
        if (reply.ok) video()?.pause();
        else toast('These scenes are unavailable.');
      } }, 'Hear both scenes') : null;
      appendClean(body, h('article', { class: 'ss-card ss-scene-entry' }, h('h5', {}, display), link(latest),
        another ? link(another) : null, pair ? h('div', { class: 'ss-btns' }, pair) : null));
    }
  };

  let filter1TOnly = false;
  const drawLinesTab = () => {
    const isPro = S.set.uiMode === 'pro';
    if (fitCardOpen) drawVideoFitCard();
    if (isPro && V.analysis && V.analysis.diff && V.analysis.diff.highDifficulty && video() && video().playbackRate >= 0.99) {
      appendClean(listEl, h('div', { class: 'ss-warn' },
        h('span', {}, `Dense/fast speech (${V.analysis.diff.wpm} wpm, Vocab ${V.analysis.diff.vocab}/5). IdiomsTube recommends slowing playback.`),
        h('button', { class: 'ss-act', onclick: () => { const v = video(); if (v) { v.playbackRate = 0.85; drawHead(); drawList(); } } }, 'Set 0.85×')));
    }

    if (asrState.active && asrState.progressTxt) {
      appendClean(listEl, h('div', { class: 'ss-progress' },
        h('span', {}, asrState.progressTxt),
        h('button', { class: 'ss-act', onclick: () => { asrState.stopRequested = true; } }, '■ Stop')));
    }
    if (liveState.active && liveState.progressTxt) {
      appendClean(listEl, h('div', { class: 'ss-progress' },
        h('span', {}, liveState.progressTxt),
        h('button', { class: 'ss-act', onclick: () => { stopLiveCaptions(); drawList(); } }, 'Stop Live')));
    }

    if (!V.lines.length || V.srcProv === 'On-screen text' || V.frameWatch || V.srcProv === 'YT Auto' || asrState.active || isLiveContext()) {
      // Show the transcription card only once we know there are no subtitles (not while they load).
      const stillLoadingSubs = !V.lines.length && /^(Loading|Waiting for the ad|Fetching)/.test(String(V.msg || ''));
      if (stillLoadingSubs) { /* wait */ }
      else if (!V.lines.length || V.frameWatch || V.srcProv === 'On-screen text' || isLiveContext()) drawAsrCard();
      else if (V.srcProv === 'YT Auto') {
        appendClean(listEl, h('div', { class: 'ss-h', style: { justifyContent: 'space-between' } },
          h('span', { style: { fontSize: '11.5px', opacity: '.75' } }, 'Using YouTube auto-captions'),
          h('button', { class: 'ss-teal', style: { fontSize: '11.5px', padding: '3px 8px' }, onclick: () => runLocalASR(true) }, 'Transcribe with local AI')));
      }
    }

    const hasSharedTr = !!(V.tr && !V.sameTiming && V.lines.length > 1);
    if (V.lines.length && (isPro || V.lines.length > 8 || listFilter)) {
      appendClean(listEl, h('div', { class: 'ss-h' },
        h('input', {
          type: 'search',
          placeholder: 'Search subtitles or translations…',
          value: listFilter,
          style: { flex: '1', minWidth: '130px' },
          oninput: (e) => { listFilter = e.target.value.toLowerCase(); drawList(); },
        }),
        hasSharedTr ? h('button', {
          class: 'ss-qpill' + (S.set.mergeSharedTr !== false ? ' ss-teal' : ''),
          title: 'Merge consecutive split cues that map to one translation sentence (LR_NOTES §8.1)',
          onclick: () => { S.set.mergeSharedTr = S.set.mergeSharedTr === false; save('set'); drawList(); },
        }, 'Merge clauses') : null,
        (V.analysis && V.analysis.gold1TLines && V.analysis.gold1TLines.length > 0) ? h('button', {
          class: 'ss-qpill' + (filter1TOnly ? ' ss-act' : ''),
          title: 'Show only i+1 Gold Sentences with exactly 1 unknown word or target idiom (Migaku 1T standard)',
          onclick: () => { filter1TOnly = !filter1TOnly; drawList(); },
        }, `★ 1T (${V.analysis.gold1TLines.length})`) : null));
    }
    if (V.lines.length) {
      const sumCard = renderSummaryCard();
      if (sumCard) appendClean(listEl, sumCard);
      const txBar = renderTranscriptBar();
      if (txBar) appendClean(listEl, txBar);
    }

    if (V.msg && !V.lines.length) {
      appendClean(listEl, h('div', { class: 'ss-msg' }, V.msg));
      return;
    }

    const q = listFilter.trim();
    const allowMerge = !q && !filter1TOnly && hasSharedTr && S.set.mergeSharedTr !== false;
    let i = 0;
    while (i < V.lines.length) {
      const ln = V.lines[i];
      if (!q && ln.isInstrumental) {
        let j = i;
        while (j + 1 < V.lines.length && V.lines[j + 1].isInstrumental) j++;
        const nextVocal = V.lines[j + 1];
        const endT = nextVocal ? nextVocal.s : (V.lines[j].s + (V.lines[j].d || 2));
        if (endT - ln.s >= 2.0) {
          const isCurInst = V.cur >= i && V.cur <= j;
          appendClean(listEl, h('div', {
            class: 'ss-inst-chip' + (isCurInst ? ' ss-cur' : ''),
            title: 'Click to jump past instrumental break',
            onclick: () => seek(nextVocal ? nextVocal.s : endT),
          },
          h('span', {}, `♪ ${fmt(ln.s)} – ${fmt(endT)} · Instrumental`),
          nextVocal ? h('span', { style: { color: '#2dd4bf', fontWeight: '600' } }, 'Skip ⏭') : null));
          i = j + 1;
          continue;
        }
      }

      if (ln.isInstrumental) { i++; continue; }
      const tr = transFor(ln);
      const aiTr = aiTransFor(ln);

      // Clause-merged row when 2..4 consecutive cues share one human translation sentence (LR_NOTES §8.1)
      let gEnd = i;
      if (allowMerge && tr) {
        while (gEnd + 1 < V.lines.length && (gEnd - i) < 3 && !V.lines[gEnd + 1].isInstrumental && transFor(V.lines[gEnd + 1]) === tr) {
          gEnd++;
        }
      }

      if (gEnd > i) {
        const isCurGroup = V.cur >= i && V.cur <= gEnd;
        const inLoop = (loopRange && i <= loopRange.endLi && gEnd >= loopRange.startLi) || (loopIdx >= i && loopIdx <= gEnd);
        const subSpans = [];
        for (let k = i; k <= gEnd; k++) {
          const subLn = V.lines[k];
          subSpans.push(h('div', {
            class: 'ss-subline' + (V.cur === k ? ' ss-sub-cur' : ''),
            'data-sub-i': k,
            onclick: (ev) => { ev.stopPropagation(); seek(subLn.s); },
          }, renderLineTokens(k, subLn, false)));
        }
        const t2 = tr2For(ln);
        appendClean(listEl, h('div', {
          class: 'ss-li ss-li-group' + (isCurGroup ? ' ss-cur' : '') + (inLoop ? ' ss-loop-range' : ''),
          'data-i': i,
          'data-i-end': gEnd,
          onclick: () => seek(ln.s),
        },
        h('span', { class: 'ss-t' }, fmt(ln.s)),
        h('span', { style: { flex: '1' } },
          ...subSpans,
          h('span', { class: 'ss-tr' }, tr),
          t2 && t2 !== tr ? h('span', { class: 'ss-tr ss-tr3' }, t2) : null,
          aiTr && aiTr !== tr ? h('span', { class: 'ss-tr-dual' }, `${V.aiTrProv || 'AI'}: ${aiTr}`) : null)));
        i = gEnd + 1;
        continue;
      }

      const trRepeat = !!tr && i > 0 && tr === transFor(V.lines[i - 1]);
      if (q && !ln.t.toLowerCase().includes(q) && !tr.toLowerCase().includes(q) && !aiTr.toLowerCase().includes(q)) { i++; continue; }
      const row1T = V.analysis && V.analysis.line1T && V.analysis.line1T[i];
      if (filter1TOnly && !(row1T && row1T.is1T)) { i++; continue; }
      const lowConf = ln.conf != null && ln.conf < 0.55;
      const inLoop = (loopRange && i >= loopRange.startLi && i <= loopRange.endLi) || loopIdx === i;
      appendClean(listEl, h('div', {
        class: 'ss-li' + (i === V.cur ? ' ss-cur' : '') + (inLoop ? ' ss-loop-range' : '') + (lowConf ? ' ss-low-conf' : ''),
        'data-i': i,
        'data-i-end': i,
        onclick: () => seek(ln.s),
      },
      h('span', { class: 'ss-t' }, fmt(ln.s)),
      h('span', { style: { flex: '1' } },
        renderLineTokens(i, ln, false),
        (row1T && row1T.is1T) ? h('span', { class: 'ss-1t-badge', title: `1T i+1 sentence · target: ${row1T.display || row1T.target}` }, '1T ★') : null,
        ln.lineLang && S.set.asrLangHint === 'mixed' ? h('span', { class: 'ss-badge', style: { marginLeft: '6px', fontSize: '10px' } }, ln.lineLang.toUpperCase()) : null,
        lowConf ? h('span', { class: 'ss-badge', style: { marginLeft: '6px' } }, 'low-conf ASR') : null,
        tr ? h('span', { class: 'ss-tr' + (trRepeat ? ' ss-tr-rep' : ''), title: trRepeat ? 'Same translation line as above' : null }, tr) : null,
        (() => { const t2 = tr2For(ln); return t2 && t2 !== tr ? h('span', { class: 'ss-tr ss-tr3' }, t2) : null; })(),
        aiTr && aiTr !== tr ? h('span', { class: 'ss-tr-dual' }, `${V.aiTrProv || 'AI'}: ${aiTr}`) : null)));
      i++;
    }
  };

  // ---- Idiom history: idioms in lines you actually played through (seeking past a line does not count) ----
  let watchAcc = { li: -1, acc: 0, lastT: 0 };
  let feHistSaveTimer = 0;
  async function refreshSceneFrequency(view, patterns) {
    if (!view?.analysis || !S.set.personalFrequency || S.set.idiomHistory === false) return;
    patterns ||= view.analysis.allFEs.map(fe => fe.pattern);
    const { counts } = await bg({ op: 'sceneFrequency', lang: normLangCode(view.lang), patterns });
    if (!counts || V !== view) return;
    view.sceneFrequency ||= new Map();
    for (const [pattern, scenes, videos] of counts) view.sceneFrequency.set(pattern, [scenes, videos]);
    if (panel && panel.style.display !== 'none') drawList();
    if (view.cur >= 0) drawLine(view.cur);
  }
  const feByLine = () => {
    const an = V && V.analysis;
    if (!an) return null;
    if (V._feByLineFor !== an) {
      const m = new Map();
      for (const fe of an.allFEs || an.targetFEs || []) for (const o of fe.occurrences || []) {
        if (!m.has(o.li)) m.set(o.li, []);
        m.get(o.li).push({ fe, o });
      }
      V._feByLine = m; V._feByLineFor = an; V._watched = new Set();
    }
    return V._feByLine;
  };
  const histSummary = () => {
    const all = Object.values(S.feHist || {});
    const here = V && V.info ? all.filter((e) => e.videoId === V.info.videoId).length : 0;
    return `${all.length} idioms heard so far${here ? `, ${here} in this video` : ''}.`;
  };
  let traceFlushAt = 0;
  const trackWatched = (v, t, i) => {
    if (!V || !V.info) return;
    const prevT = watchAcc.lastT;
    const dt = t - prevT;
    watchAcc.lastT = t;

    // Detect timeline drag-back / scrub-back or rapid line replay (-2.5s .. -45s) as a comprehension struggle trace
    if (prevT > 0 && dt < -2.5 && dt > -45 && i >= 0 && V.lines[i] && !V.lines[i].isInstrumental) {
      const lnBack = V.lines[i];
      if (!V._struggledMap) V._struggledMap = new Map();
      const bk = Math.round(lnBack.s / 2);
      const curSc = V._struggledMap.get(bk) || { s: lnBack.s, t: lnBack.t, tr: transFor(lnBack) || '', count: 0 };
      curSc.count += 1;
      if (!curSc.tr) curSc.tr = transFor(lnBack) || '';
      V._struggledMap.set(bk, curSc);
      const hardRk = maxRankInLine(lnBack);
      if (hardRk) recordImplicitVocabSignal(hardRk, false, lnBack);
    }

    if (S.set.idiomHistory === false || v.paused || v.seeking || i < 0) return;
    if (dt > 0 && dt <= 0.6) {
      V._watchedSec = (V._watchedSec || 0) + dt;
      V._pendingTraceSec = (V._pendingTraceSec || 0) + dt;
      const nowMs = Date.now();
      if (SS_STORE.recordStudyTrace && (nowMs - traceFlushAt) >= 12000 && V._pendingTraceSec >= 4) {
        traceFlushAt = nowMs;
        const addSec = V._pendingTraceSec;
        V._pendingTraceSec = 0;
        const scList = V._struggledMap ? [...V._struggledMap.values()] : [];
        const topFEs = [...(V._encounteredFEs || [])].slice(0, 8);
        const tracedVideo = V;
        SS_STORE.recordStudyTrace({
          videoKey: curVidKey(),
          title: V.info.title || '',
          author: V.info.author || '',
          site: (V.site && V.site.id) || 'yt',
          lang: V.lang || '',
          addWatchedSec: addSec,
          incPlay: !V._tracePlayCounted,
          struggledCues: scList,
          topFEs,
        }).then((trRec) => {
          if (V !== tracedVideo) return;
          V._tracePlayCounted = true;
          const snapVidKey = curVidKey();
          const snapHash = lineHashOf(V.lines);
          const snapLines = V.lines.filter((l) => !l.isInstrumental).slice(0, 120).map((l) => ({ ts: fmtTs(l.s), t: l.t }));
          const snapTitle = V.info.title || '';
          if (!V._autoSumAttempted && shouldAutoSummarize(V, trRec)) {
            V._autoSumAttempted = true;
            const saveAutoSum = (txt) => {
              if (txt && SS_STORE.recordStudyTrace) {
                SS_STORE.recordStudyTrace({
                  videoKey: snapVidKey,
                  trackHash: snapHash,
                  summary: String(txt).slice(0, 400),
                }).catch(() => {});
              }
            };
            if (companionHealth && companionHealth.ok) {
              comp('/summarize', {
                lines: snapLines,
                title: snapTitle,
                target_lang: S.set.tl || 'en',
              }, 'POST', 30000).then((res) => {
                if (res && res.ok && res.summary) saveAutoSum(res.summary);
                else buildLocalTranscriptSummary().then((lo) => saveAutoSum(lo && lo.tldr));
              }).catch(() => {});
            } else {
              buildLocalTranscriptSummary().then((lo) => saveAutoSum(lo && lo.tldr)).catch(() => {});
            }
          }
        }).catch(() => {});
      }
    }

    if (watchAcc.li !== i) { watchAcc = { li: i, acc: 0, lastT: t }; return; }
    if (dt <= 0 || dt > 0.6) return;   // a jump, not playback
    watchAcc.acc += dt;
    const ln = V.lines[i];
    const m = feByLine();
    if (!m || !ln || V._watched.has(i) || watchAcc.acc < Math.min(1.2, 0.5 * (ln.d || 2))) return;
    V._watched.add(i);
    if (revealedIndex !== i) {
      const okRk = maxRankInLine(ln, curVocabLevel() * 2.2);
      if (okRk) recordImplicitVocabSignal(okRk, true, ln);
    }
    const hits = m.get(i);
    if (!hits) return;
    const videoKey = curVidKey();
    if (/^(yt:|bili:)/.test(videoKey) && t >= ln.s && t < lineEnd(i) && !isLiveContext()) {
      const patterns = hits.map(({ fe }) => fe.pattern);
      const watchedView = V;
      if (patterns.length) void bg({
        op: 'recordWatchedScenes', lang: normLangCode(V.lang), patterns,
        scene: { videoKey, title: V.info.title, line: ln.t, at: Date.now(),
          t: Math.max(0, ln.s + subOff(ln.s)), endT: Math.max(0, lineEnd(i) + subOff(ln.s)) }
      }).then(result => { if (result.ok) refreshSceneFrequency(watchedView, patterns); });
    }
    const H = S.feHist || (S.feHist = {});
    const now = Date.now();
    for (const { fe, o } of hits) {
      if (fe.isBundle && !S.set.quizIncludeBundles) continue; // Keep transparent frames/collocations out of idiom quiz unless opted in
      const pie = V.pieMap && V.pieMap[fe.pattern];
      if (pie && pie.usage === 'literal') continue;
      if (!V._encounteredFEs) V._encounteredFEs = new Set();
      V._encounteredFEs.add(fe.display);
      const hl = normLangCode(V.lang);
      const hk = hl === 'en' ? fe.pattern : `${hl}|${fe.pattern}`;   // English keys stay backward-compatible; yue stays separate from zh
      const e = H[hk] || (H[hk] = { display: fe.display, type: fe.type, bucket: fe.bucket || 'idiom', lang: hl, seen: 0, right: 0, wrong: 0, firstAt: now });
      Object.assign(e, {
        surface: o.surface, display: fe.display, bucket: fe.bucket || e.bucket || 'idiom',
        line: ln.t, trans: transFor(ln) || e.trans || '', videoId: V.info.videoId, title: V.info.title,
        t: ln.s, endT: ln.s + (ln.d || 3), lastAt: now,
        gloss: (pie && pie.idiomatic_gloss) || bestFeMeaning(fe) || e.gloss || '', reading: fe.reading || '',
      });
      e.seen++;
    }
    const keys = Object.keys(H);
    if (keys.length > 3000) keys.sort((a, b) => H[a].lastAt - H[b].lastAt).slice(0, keys.length - 3000).forEach((k) => delete H[k]);
    clearTimeout(feHistSaveTimer);
    feHistSaveTimer = setTimeout(() => save('feHist'), 4000);
    const c = document.getElementById('ss-hist-count');
    if (c) c.textContent = histSummary();
  };

  // Quiz: fill the gap in a line you heard; the least-known and longest-unquizzed come first.
  let quiz = null;
  const escRx = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startQuiz = (onlyThisVideo) => {
    const H = S.feHist || {};
    const pool = Object.entries(H).filter(([, e]) => e.line && e.surface && (!onlyThisVideo || (V && V.info && e.videoId === V.info.videoId)));
    if (!pool.length) { toast('Watch a bit first: idioms are saved as their lines play.'); return; }
    // Lin (2021) resurfaces items every 14 days; a right answer pushes the next review out 14 days.
    const DAY = 864e5, now = Date.now();
    const due = (e) => !e.quizAt || now - e.quizAt >= 14 * DAY || e.wrong > e.right;
    const score = ([, e]) => (due(e) ? 0 : 1e15) + (e.right - e.wrong * 2) * 1e13 + (e.quizAt || 0);
    pool.sort((a, b) => score(a) - score(b));
    const picks = pool.slice(0, 8).sort(() => Math.random() - 0.5);
    const curLang = normLangCode(V && V.lang);
    quiz = {
      i: 0, right: 0, qs: picks.map(([k, e]) => {
        const el = normLangCode(e.lang || 'en');
        const allSurf = Object.values(H).filter((x) => normLangCode(x.lang || 'en') === el).map((x) => x.surface)
          .concat(el === curLang ? ((V && V.analysis && V.analysis.allFEs) || []).map((f) => f.display) : []);
        const others = [...new Set(allSurf.filter((x) => x && x.toLowerCase() !== e.surface.toLowerCase()))].sort(() => Math.random() - 0.5).slice(0, 3);
        const blank = SS_IDIOMS.blankPhraseInLine
          ? SS_IDIOMS.blankPhraseInLine(e.line, e.surface, e.display || '', '______')
          : e.line.replace(new RegExp(escRx(e.surface), 'i'), '______');
        return { k, e, blank, options: [e.surface, ...others].sort(() => Math.random() - 0.5), answered: null };
      }),
    };
    tab = 'glossary'; drawHead(); drawList();
  };
  const drawQuiz = () => {
    const q = quiz.qs[quiz.i];
    if (!q) {
      appendClean(listEl, h('div', { class: 'ss-card' }, h('h5', {}, `Quiz done: ${quiz.right} / ${quiz.qs.length}`),
        h('div', { class: 'ss-btns' }, h('button', { class: 'ss-act', onclick: () => startQuiz(false) }, 'Another round'),
          h('button', { onclick: () => { quiz = null; drawList(); } }, 'Back to idioms'))));
      return;
    }
    const sameVid = V && V.info && sameVidKey(q.e.videoId, curVidKey());
    appendClean(listEl, h('div', { class: 'ss-card ss-quiz' },
      h('div', { style: { opacity: '.7', fontSize: '12px' } }, `Question ${quiz.i + 1} of ${quiz.qs.length} · from “${(q.e.title || '').slice(0, 60)}”`),
      h('div', { class: 'ss-quiz-line' }, q.blank),
      q.e.trans ? h('div', { style: { opacity: '.7', fontSize: '12.5px', marginTop: '3px' } }, q.e.trans) : null,
      h('div', { class: 'ss-quiz-opts' }, ...q.options.map((opt) => h('button', {
        class: 'ss-quiz-opt' + (q.answered ? (opt === q.e.surface ? ' ss-ok' : opt === q.answered ? ' ss-bad' : '') : ''),
        disabled: q.answered ? true : null,
        onclick: () => {
          q.answered = opt;
          const e = S.feHist[q.k];
          const ok = opt === q.e.surface;
          if (e) { if (ok) e.right++; else e.wrong++; e.quizAt = Date.now(); save('feHist'); }
          if (ok) quiz.right++;
          drawList();
        },
      }, opt))),
      q.answered ? h('div', { style: { marginTop: '6px' } },
        h('div', {}, h('b', {}, q.e.display), q.e.gloss ? ` · ${q.e.gloss}` : ''),
        h('div', { class: 'ss-btns' },
          sameVid
            ? h('button', { onclick: () => replayScene(q.e.t, q.e.endT) }, '▶ Hear the line')
            : h('a', { class: 'ss-res-pill', href: videoUrlOf(q.e.videoId, q.e.t), target: '_blank', rel: 'noopener' }, '▶ Open the line'),
          h('button', { class: 'ss-act', onclick: () => { quiz.i++; drawList(); } }, quiz.i + 1 < quiz.qs.length ? 'Next' : 'Finish'))) : null,
      h('div', { style: { marginTop: '6px' } }, h('button', { onclick: () => { quiz = null; drawList(); } }, 'Stop quiz'))));
  };
  const drawHistoryCard = () => {
    const recent = Object.values(S.feHist || {}).sort((a, b) => b.lastAt - a.lastAt).slice(0, 8);
    appendClean(listEl, h('div', { class: 'ss-card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' } },
        h('h5', { style: { margin: 0 } }, 'Idioms you have heard'),
        h('button', {
          class: 'ss-qpill' + (S.set.quizIncludeBundles ? ' ss-teal' : ''),
          title: 'Include grammar frames & collocations in watched history & quizzes',
          onclick: () => { S.set.quizIncludeBundles = !S.set.quizIncludeBundles; save('set'); drawList(); },
        }, S.set.quizIncludeBundles ? 'Idioms + Frames' : 'Idioms only')),
      h('div', { id: 'ss-hist-count', style: { opacity: '.75', fontSize: '12px', marginTop: '3px' } }, histSummary()),
      h('div', { style: { opacity: '.6', fontSize: '11.5px' } }, 'Saved when their line plays through. Skipping ahead does not count.'),
      recent.length ? h('div', { style: { margin: '4px 0', fontSize: '12px' } }, recent.map((e) => e.display).join(' · ')) : null,
      h('div', { class: 'ss-btns' },
        h('button', { class: 'ss-act', onclick: () => startQuiz(false) }, 'Quiz me (all videos)'),
        h('button', { onclick: () => startQuiz(true) }, 'Quiz me (this video)'))));
  };

  const drawGlossaryTab = () => {
    const an = V.analysis;
    if (!an) { appendClean(listEl, h('div', { class: 'ss-msg' }, 'No subtitle text loaded yet.')); return; }

    if (quiz) return drawQuiz();
    drawVideoFitCard();
    drawHistoryCard();

    // 1. Multi-layer Formulaic Expressions (Idioms/Proverbs · Frames/Patterns · Slang/Social · Collocations + Cross-Lingual eq)
    const allItems = an.allFEs || an.targetFEs || [];
    const bucketOf = (fe) => fe.bucket || (SS_IDIOMS.classifyLayer ? SS_IDIOMS.classifyLayer(fe.layer, fe.type) : 'idiom');
    const counts = { all: allItems.length, idiom: 0, frame: 0, slang: 0, colloc: 0, play: 0 };
    for (const fe of allItems) {
      counts[bucketOf(fe)] = (counts[bucketOf(fe)] || 0) + 1;
      if (fe.play) counts.play++;
    }
    if (feLayerFilter !== 'all' && !counts[feLayerFilter]) feLayerFilter = 'all';

    const fq = feSearchQuery.trim().toLowerCase();
    const filteredFEs = allItems.filter((fe) => {
      if (feLayerFilter === 'play') { if (!fe.play) return false; }
      else if (feLayerFilter !== 'all' && bucketOf(fe) !== feLayerFilter) return false;
      if (!fq) return true;
      const m = bestFeMeaning(fe).toLowerCase();
      return (fe.display || '').toLowerCase().includes(fq)
        || (fe.reading || '').toLowerCase().includes(fq)
        || m.includes(fq);
    });

    const bucketLabels = { idiom: 'Idiom', frame: 'Frame', slang: 'Slang/Social', colloc: 'Collocation', play: 'Playful' };
    appendClean(listEl, h('div', { class: 'ss-card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
        h('h5', { style: { margin: 0 } }, `Formulaic expressions in this video (${allItems.length})`),
        h('button', {
          class: 'ss-qpill' + (!S.set.hideBundleUnderlines ? ' ss-teal' : ''),
          title: 'Toggle grammar-frame & collocation underlines on the video overlay (idioms stay underlined)',
          onclick: () => { S.set.hideBundleUnderlines = !S.set.hideBundleUnderlines; save('set'); applyVisualPrefs(); drawList(); },
        }, S.set.hideBundleUnderlines ? 'Video: Idioms only' : 'Video: All layers')),
      allItems.length > 0 ? h('div', { class: 'ss-layer-bar' },
        ...[['all', 'All'], ['idiom', 'Idioms'], ['frame', 'Frames'], ['slang', 'Slang & Social'], ['colloc', 'Collocations'], ['play', 'Playful']]
          .filter(([k]) => k === 'all' || counts[k] > 0)
          .map(([k, lbl]) => h('button', {
            class: 'ss-layer-pill' + (feLayerFilter === k ? ' ss-act' : ''),
            onclick: () => { feLayerFilter = k; drawList(); },
          }, `${lbl} (${counts[k] || 0})`))) : null,
      allItems.length > 8 ? h('input', {
        type: 'search',
        placeholder: 'Filter idioms, readings, or meanings…',
        value: feSearchQuery,
        style: { width: '100%', boxSizing: 'border-box', marginBottom: '6px' },
        oninput: (ev) => { feSearchQuery = ev.target.value; drawList(); },
      }) : null,
      allItems.length > an.targetFEs.length ? h('div', { style: { opacity: '.7', fontSize: '12px', marginBottom: '4px' } }, `Top ${an.targetFEs.length} non-literal idioms are prioritized for drills & glossary hints.`) : null,
      !filteredFEs.length ? h('div', { style: { opacity: '.75' } }, 'No formulaic expressions matched in this filter.') : null,
      ...filteredFEs.slice(0, 80).map((fe) => {
        const first = fe.occurrences[0];
        const pie = V.pieMap && V.pieMap[fe.pattern];
        const isLit = pie && pie.usage === 'literal';
        const isTrap = !isLit && (fe.deceptive || (pie && pie.deceptive_trap));
        const bkt = bucketOf(fe);
        const isLitRisk = !isLit && !isTrap && !!fe.litRisk;
        const tagLabel = isLit ? 'Literal here' : isTrap ? '⚠️ Trap' : (fe.native || bucketLabels[bkt] || fe.type) + (isLitRisk ? ' · often literal' : '');
        const tagCls = isTrap ? 'ss-tag-trap' : (isLitRisk ? 'ss-tag-litrisk' : (fe.play ? 'ss-tag-play' : `ss-tag-${bkt}`));
        const isEn = normLangCode(V.lang) === 'en';
        const dictHref = isEn
          ? `https://idioms.thefreedictionary.com/${encodeURIComponent(fe.display.replace(/\s+/g, '+'))}`
          : `https://en.wiktionary.org/wiki/${encodeURIComponent(fe.display.replace(/\s+/g, '_'))}`;
        const meaning = bestFeMeaning(fe);
        const litNote = (pie && pie.literal_gloss) || fe.lit || '';
        const eqRow = renderEqChips(fe, (first && first.surface) || fe.display);
        return h('div', { style: { padding: '7px 0', borderBottom: '1px solid rgba(128,128,128,.14)' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' } },
            h('span', {},
              h('b', {
                style: { cursor: 'pointer' },
                title: 'Click to open full multi-dictionary & Context X-Ray card',
                onclick: () => { if (first) openDock(first.surface || fe.display, fe.pattern, V.lines[first.li], Object.assign({}, fe, { surface: first.surface || fe.display })); },
              }, fe.display),
              fe.reading && fe.reading !== fe.display ? h('span', { style: { opacity: '.72', fontSize: '12px' } }, ` ${fe.reading}`) : '',
              h('span', { class: `ss-tag-pill ${tagCls}` }, tagLabel),
              h('span', { style: { opacity: '.68', fontSize: '11.5px' } }, ` · ${fe.count}×${fe.soundCue ? ' · ' + fe.soundCue : ''}`)),
            h('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
              h('a', { href: dictHref, target: '_blank', rel: 'noopener', style: { fontSize: '11px', color: '#7cc0ff' } }, 'Dict'),
              first ? h('button', { onclick: () => replayScene(first.t, first.endT) }, fmt(first.t)) : null,
              h('button', {
                onclick: () => {
                  if (!first) return;
                  const ln = V.lines[first.li];
                  saveItem({
                    itemType: 'FE', layer: fe.layer || fe.type || '', word: (first && first.surface) || fe.display,
                    reading: fe.reading || '', lemma: fe.pattern, lang: V.lang,
                    def: (pie && pie.idiomatic_gloss) || meaning || `[${fe.type}] ${fe.display}`,
                    lit: litNote, eq: fe.eq || null, line: first.line, trans: transFor(ln),
                    provenance: V.trProv || 'none', t: first.t, endT: first.endT,
                    videoId: curVidKey(), channelId: V.info.channelId || '', title: V.info.title,
                    maxBand: fe.maxBand, deceptive: !!fe.deceptive, soundCue: fe.soundCue || '',
                  });
                  drawHead();
                  toast('FE saved (+5 XP)');
                },
              }, '+Save'))),
          meaning && !(pie && pie.idiomatic_gloss) ? h('div', { style: { fontSize: '12px', color: '#2dd4bf', marginTop: '2px' } }, meaning) : null,
          litNote && !(pie && pie.literal_gloss) ? h('div', { style: { fontSize: '11.5px', opacity: '.76', marginTop: '1px' } }, `Literal: ${litNote}`) : null,
          fe.falseFriend ? h('div', { style: { fontSize: '11.5px', color: '#fbbf24', marginTop: '1px' } }, `⚠️ Mandarin contrast: ${fe.falseFriend}`) : null,
          /^Cantonese/.test(fe.type || '') && fe.glossZh && meaning !== fe.glossZh
            ? h('div', { style: { fontSize: '12px', opacity: '.8', marginTop: '1px' } }, `普通話: ${fe.glossZh}`) : null,
          eqRow,
          first ? h('div', { style: { fontSize: '12px', opacity: '.78', marginTop: '3px' } }, `"${first.line}"`) : null,
          pie && pie.explain ? h('div', { style: { fontSize: '11.5px', color: '#93c5fd', marginTop: '2px' } }, pie.explain) : null,
          getProfile().contrastiveGloss && pie && (pie.literal_gloss || pie.idiomatic_gloss)
            ? h('div', { style: { fontSize: '11.5px', opacity: '.88', marginTop: '2px', color: '#2dd4bf' } },
                `Literal: ${pie.literal_gloss || '—'} · Meaning: ${pie.idiomatic_gloss || '—'}`)
            : null);
      }),
      ...(V.extraFes || []).map((ex) =>
        h('div', { style: { padding: '6px 0', borderTop: '1px dashed rgba(45,212,191,.3)' } },
          h('div', {}, h('b', {}, ex.phrase || ''), ' · AI-Discovered Idiom'),
          ex.explain ? h('div', { style: { fontSize: '11.5px', color: '#93c5fd', marginTop: '2px' } }, ex.explain) : null,
          ex.idiomatic_gloss ? h('div', { style: { fontSize: '11.5px', color: '#2dd4bf' } }, `Meaning: ${ex.idiomatic_gloss}`) : null))));

    // 2. Self-Healing Per-Video & Per-Channel Glossary (+ live preview of auto-sent FE idiom hints)
    const terms = V.glossaryTerms || [];
    const autoSliceHints = buildSliceGlossary(0, (V.lines || []).length - 1, S.set.tl || 'en', !!S.set.useBigLlm)
      .filter((g) => !terms.some((u) => (u.src || '').toLowerCase() === g.src.toLowerCase()));
    const srcInp = h('input', { type: 'text', placeholder: 'Source term…', style: { flex: '1', minWidth: '80px' } });
    const dstInp = h('input', { type: 'text', placeholder: 'Target translation…', style: { flex: '1', minWidth: '80px' } });
    appendClean(listEl, h('div', { class: 'ss-card' },
      h('h5', {}, `Names and terms for the translator (${terms.length}${autoSliceHints.length ? ` + ${autoSliceHints.length} idiom hints` : ''})`),
      h('div', { class: 'ss-h', style: { padding: '0 0 6px', border: '0', background: 'transparent' } },
        h('button', { class: 'ss-teal', onclick: runPrepass }, 'Find terms automatically'),
        h('button', { class: 'ss-act', onclick: () => runPlamoTranslate(false) }, 'Translate again with these terms')),
      h('div', { class: 'ss-h', style: { padding: '0 0 6px', border: '0', background: 'transparent' } },
        srcInp, dstInp,
        h('button', {
          onclick: async () => {
            const s = srcInp.value.trim(), d = dstInp.value.trim();
            if (!s || !d) return;
            V.glossaryTerms = mergeGlossaryTerms(V.glossaryTerms || [], [{ src: s, dst: d, note: 'user' }]);
            await SS_STORE.saveGlossary(curVidKey(), V.info.channelId, { videoId: curVidKey(), terms: V.glossaryTerms, updatedAt: Date.now() }, [{ src: s, dst: d, note: 'user' }]);
            logEv('glossaryEdit', { src: s, dst: d });
            await healGlossaryTerm(s, d);
          },
        }, 'Add')),
      ...terms.slice(0, 25).map((g, idx) =>
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', padding: '3px 0' } },
          h('span', {}, h('b', {}, g.src), ' → ', g.dst || '(untranslated)'),
          h('button', {
            onclick: async () => {
              V.glossaryTerms.splice(idx, 1);
              await SS_STORE.saveGlossary(curVidKey(), V.info.channelId, { videoId: curVidKey(), terms: V.glossaryTerms, updatedAt: Date.now() }, []);
              drawList();
            },
          }, '×'))),
      autoSliceHints.length ? h('details', { class: 'ss-more' },
        h('summary', {}, `Auto-sent idiom localization hints (${autoSliceHints.length})`),
        ...autoSliceHints.slice(0, 25).map((g) =>
          h('div', { style: { fontSize: '11.5px', padding: '2px 0', opacity: '.86' } },
            h('b', {}, g.src), ' → ', h('span', { style: { color: '#2dd4bf' } }, g.dst)))) : null));

    // 3. Language Reactor Words Explorer with 3 sort orders (LR_NOTES §4: To learn · Count in video · Frequency rank)
    const baseWords = (wordsSortMode === 'learn' ? an.toLearn : (an.allWords || an.toLearn)).filter((w) => wordStatusOf(w.lemma) !== 'known');
    const sortedWords = baseWords.slice().sort((a, b) => {
      if (wordsSortMode === 'freq') return b.count - a.count || a.rank - b.rank;
      if (wordsSortMode === 'rare') return b.rank - a.rank || b.count - a.count;
      return 0;
    });
    appendClean(listEl, h('div', { class: 'ss-card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } },
        h('h5', { style: { margin: 0 } }, `Words in this video (${sortedWords.length})`),
        h('span', { style: { display: 'flex', gap: '4px' } },
          ...[['learn', 'Worth learning'], ['freq', 'Most used'], ['rare', 'Rarest']].map(([m, lbl]) =>
            h('button', { class: 'ss-qpill' + (wordsSortMode === m ? ' ss-act' : ''), onclick: () => { wordsSortMode = m; drawList(); } }, lbl)))),
      ...sortedWords.slice(0, 20).map((w) =>
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,.12)' } },
          h('span', {},
            h('b', {}, w.sample),
            ` (${w.count}×${w.rank < 99999 ? ' · #' + (w.rank > 30000 ? '30k+' : w.rank) : ''})`,
            wordStatusOf(w.lemma) === 'learning' ? h('span', { class: 'ss-tag-pill ss-tag-slang' }, 'Learning') : null),
          h('span', { style: { display: 'flex', gap: '4px' } },
            h('button', { onclick: () => { seek(V.lines[w.firstLi].s); openDock(w.sample, w.lemma, V.lines[w.firstLi], null); } }, 'Lookup'),
            h('button', { onclick: () => { S.words[wKey(w.lemma)] = 'learning'; save('words'); repaintMarks(); refreshCoverage(); drawList(); } }, '+Learn'),
            h('button', { onclick: () => { S.words[wKey(w.lemma)] = 'known'; save('words'); repaintMarks(); refreshCoverage(); drawList(); } }, 'Known'))))));
  };

  // ---- True Acoustic F0 Pitch & Prosody Contour Extraction ----
  const computeClientProsody = (audioBuf, bins = 64) => {
    if (!audioBuf) return null;
    const ch = audioBuf.getChannelData(0);
    const sr = audioBuf.sampleRate || 48000;
    const win = Math.max(256, Math.min(2048, Math.round(sr * 0.032)));
    const minLag = Math.max(16, Math.floor(sr / 500));
    const maxLag = Math.min(win - 2, Math.floor(sr / 75));
    const hop = Math.max(1, Math.floor((ch.length - win) / bins));
    const rmsRaw = [];
    const f0Hz = [];

    for (let b = 0; b < bins; b++) {
      const idx = Math.min(Math.max(0, ch.length - win), b * hop);
      let sumSq = 0;
      let mean = 0;
      for (let j = 0; j < win; j++) {
        const x = ch[idx + j] || 0;
        mean += x;
        sumSq += x * x;
      }
      mean /= win;
      const e = Math.sqrt(sumSq / win);
      rmsRaw.push(e);
      if (e < 0.01 || maxLag <= minLag) { f0Hz.push(null); continue; }

      let r0 = 0;
      for (let j = 0; j < win; j++) {
        const d = (ch[idx + j] || 0) - mean;
        r0 += d * d;
      }
      if (r0 <= 1e-8) { f0Hz.push(null); continue; }

      let bestLag = -1;
      let bestAc = -1;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0;
        for (let j = 0; j < win - lag; j++) {
          s += ((ch[idx + j] || 0) - mean) * ((ch[idx + j + lag] || 0) - mean);
        }
        if (s > bestAc) { bestAc = s; bestLag = lag; }
      }
      if (bestLag > 0 && bestAc / r0 >= 0.30) f0Hz.push(sr / bestLag);
      else f0Hz.push(null);
    }

    const maxRms = Math.max(1e-5, ...rmsRaw);
    const rms = rmsRaw.map((r) => r / maxRms);
    const voiced = f0Hz.filter((f) => f != null).sort((a, b) => a - b);
    const medHz = voiced.length >= 3 ? voiced[Math.floor(voiced.length / 2)] : 0;
    const f0_st = f0Hz.map((f) => {
      if (f == null || medHz <= 0) return null;
      return Math.max(-12, Math.min(12, 12 * Math.log2(f / medHz)));
    });
    return { rms, f0_st, median_hz: Math.round(medHz) };
  };

  const trimActiveContour = (stArr) => {
    let lo = 0, hi = stArr.length - 1;
    while (lo < hi && stArr[lo] == null) lo++;
    while (hi > lo && stArr[hi] == null) hi--;
    return stArr.slice(lo, hi + 1);
  };

  const prosodyDtwCompare = (natSt, lrnSt) => {
    if (!natSt || !lrnSt) return null;
    const aRaw = trimActiveContour(natSt);
    const bRaw = trimActiveContour(lrnSt);
    // Extract voiced semitone trajectories (interpolating tiny 1-bin gaps)
    const cleanArr = (arr) => arr.map((v, i) => {
      if (v != null) return v;
      const p = i > 0 ? arr[i - 1] : null, n = i + 1 < arr.length ? arr[i + 1] : null;
      return p != null && n != null ? (p + n) / 2 : null;
    }).filter((v) => v != null);
    const a = cleanArr(aRaw);
    const b = cleanArr(bRaw);
    if (a.length < 4 || b.length < 4) return null;

    // Band-constrained Dynamic Time Warping (DTW) invariant to speaking speed differences
    const n = a.length, m = b.length;
    const band = Math.max(4, Math.ceil(Math.max(n, m) * 0.35));
    const INF = 1e9;
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
    const steps = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    dp[0][0] = 0;
    for (let i = 1; i <= n; i++) {
      const jc = Math.round((i / n) * m);
      const j0 = Math.max(1, jc - band), j1 = Math.min(m, jc + band);
      for (let j = j0; j <= j1; j++) {
        const d = Math.abs(a[i - 1] - b[j - 1]);
        let best = dp[i - 1][j - 1], st = steps[i - 1][j - 1];
        if (dp[i - 1][j] < best) { best = dp[i - 1][j]; st = steps[i - 1][j]; }
        if (dp[i][j - 1] < best) { best = dp[i][j - 1]; st = steps[i][j - 1]; }
        dp[i][j] = d + best;
        steps[i][j] = st + 1;
      }
    }
    const avgCost = dp[n][m] < INF ? dp[n][m] / Math.max(1, steps[n][m]) : 6.0;
    const score = Math.round(Math.max(15, Math.min(99, 100 - avgCost * 8.5)));

    // Stress-peak timing comparison (Lin 2025 / Ashby 2006 nuclear prominence)
    let natPeakIdx = 0, lrnPeakIdx = 0;
    for (let i = 1; i < n; i++) if (a[i] > a[natPeakIdx]) natPeakIdx = i;
    for (let j = 1; j < m; j++) if (b[j] > b[lrnPeakIdx]) lrnPeakIdx = j;
    const natPeakPct = Math.round((natPeakIdx / Math.max(1, n - 1)) * 100);
    const lrnPeakPct = Math.round((lrnPeakIdx / Math.max(1, m - 1)) * 100);
    const diffPct = lrnPeakPct - natPeakPct;
    const tip = Math.abs(diffPct) <= 16
      ? `Great stress timing (${score}% DTW match — pitch peak ~${natPeakPct}% aligns with speaker).`
      : diffPct < 0
        ? `Tip (${score}% DTW): Speaker stressed later (~${natPeakPct}% vs your ~${lrnPeakPct}%) — lift pitch later in the phrase.`
        : `Tip (${score}% DTW): Speaker stressed earlier (~${natPeakPct}% vs your ~${lrnPeakPct}%) — emphasize earlier.`;
    return { score, natPeakPct, lrnPeakPct, tip };
  };

  const prosodyOverlapScore = (natSt, lrnSt) => {
    const r = prosodyDtwCompare(natSt, lrnSt);
    return r ? r.score : null;
  };

  const drawContourLine = (ctx, arr, W, midY, scaleY, color) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    let penDown = false;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      if (v == null) { penDown = false; continue; }
      const x = 6 + (i / Math.max(1, n - 1)) * (W - 12);
      const y = midY - Math.max(-10, Math.min(10, v)) * scaleY;
      if (!penDown) { ctx.moveTo(x, y); penDown = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  const drawProsodyCanvas = (canvas, q, learnerProsody) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const midY = Math.floor(H * 0.54);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, midY, W, 1);

    const nat = q.nativeProsody;
    if (nat && nat.ok && nat.rms) {
      // Draw subtle native RMS amplitude bars around baseline
      const bw = (W - 12) / nat.rms.length;
      ctx.fillStyle = 'rgba(45, 212, 191, 0.22)';
      nat.rms.forEach((r, idx) => {
        const bh = Math.max(2, r * 24);
        ctx.fillRect(6 + idx * bw, midY - bh, Math.max(1.5, bw - 1), bh);
      });
      if (nat.f0_st) drawContourLine(ctx, nat.f0_st, W, midY, 2.6, '#2dd4bf');
    } else {
      // Offline cadence bars fallback
      const words = (q.line || q.target || '').split(/\s+/).filter(Boolean);
      const targetLow = (q.target || '').toLowerCase();
      const totalChars = Math.max(1, words.reduce((a, w) => a + w.length + 1, 0));
      let x = 6;
      for (const w of words) {
        const bw = Math.max(4, Math.floor(((w.length + 1) / totalChars) * (W - 12)));
        const inFe = targetLow.includes(w.toLowerCase().replace(/[^a-z']/g, ''));
        const bh = Math.min(24, 7 + w.length * 1.4);
        ctx.fillStyle = inFe ? '#2dd4bf' : 'rgba(45, 212, 191, 0.35)';
        ctx.fillRect(x, midY - 2 - bh, Math.max(2, bw - 2), bh);
        x += bw;
      }
    }

    if (learnerProsody) {
      const bw = (W - 12) / learnerProsody.rms.length;
      ctx.fillStyle = 'rgba(255, 180, 84, 0.28)';
      learnerProsody.rms.forEach((r, idx) => {
        const bh = Math.max(2, r * 24);
        ctx.fillRect(6 + idx * bw, midY + 1, Math.max(1.5, bw - 1), bh);
      });
      if (learnerProsody.f0_st) drawContourLine(ctx, learnerProsody.f0_st, W, midY, 2.6, '#ffb454');
    }

    // Legend + Match Badge
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillStyle = '#2dd4bf';
    ctx.fillText(nat && nat.ok ? `Native F0 (${nat.median_hz || '--'} Hz)` : 'Target Cadence', 8, 12);
    if (learnerProsody) {
      ctx.fillStyle = '#ffb454';
      ctx.fillText(`Your F0 (${learnerProsody.median_hz || '--'} Hz)`, 8, H - 5);
      const score = nat && nat.ok ? prosodyOverlapScore(nat.f0_st, learnerProsody.f0_st) : null;
      if (score != null) {
        ctx.fillStyle = '#eef2f8';
        ctx.fillText(`Match: ${score}%`, W - 64, 12);
      }
    }
  };

  // ---- Tab 3: IdiomsTube Consolidation Drills ----
  const ensureDrills = () => {
    if (!V || !V.analysis) return null;
    if (!V.drills) V.drills = SS_IDIOMS.generateDrills(V.analysis.targetFEs, V.analysis.allFEs, V.lines, transFor, V.pieMap || {});
    return V.drills;
  };

  // Build PhrasePump active-listening deck from current video lines (prioritizing Learning words + Target FEs + i+1 suggestions)
  const buildPhrasePumpDeck = () => {
    if (!V || !V.lines || !V.lines.length) return [];
    const suggSet = new Set(((V.analysis && V.analysis.fit && V.analysis.fit.suggested) || []).map((w) => w.lemma));
    const feLines = new Set();
    for (const fe of (V.analysis && V.analysis.targetFEs) || []) {
      for (const o of fe.occurrences || []) feLines.add(o.li);
    }
    const scored = [];
    V.lines.forEach((ln, li) => {
      if (ln.isInstrumental || !ln.t) return;
      const toks = ((V.analysis && V.analysis.lineTokens[li]) || V.L.split(ln.t)).filter((x) => x.word);
      if (toks.length < 2 || toks.length > 18) return;
      let sc = feLines.has(li) ? 5 : 0;
      for (const tk of toks) {
        const lem = V.L.lemma(tk.w);
        const st = wordStatusOf(lem);
        if (st === 'learning') sc += 6;
        else if (suggSet.has(lem)) sc += 3;
      }
      scored.push({ li, ln, toks: toks.map((x) => x.w), sc: sc + Math.random() * 0.8 });
    });
    scored.sort((a, b) => b.sc - a.sc);
    return scored.slice(0, 10).map((item) => {
      const tiles = item.toks.map((w, idx) => ({ id: idx, w }));
      const shuffled = tiles.slice().sort(() => Math.random() - 0.5);
      return {
        li: item.li,
        line: item.ln.t,
        trans: transFor(item.ln),
        t: item.ln.s,
        endT: item.ln.s + (item.ln.d || 3),
        expected: tiles,
        shuffled,
      };
    });
  };

  const drawPhrasePump = () => {
    if (!pumpState || !pumpState.deck || !pumpState.deck.length) {
      const deck = buildPhrasePumpDeck();
      if (!deck.length) {
        appendClean(listEl, h('div', { class: 'ss-msg' }, 'Load a subtitled video to practise listening.'));
        return;
      }
      pumpState = { deck, idx: 0, pickedIds: [], revealed: false, autoPlayedFor: -1, score: 0 };
    }
    const q = pumpState.deck[pumpState.idx];
    if (!q) {
      appendClean(listEl, h('div', { class: 'ss-card' },
        h('h5', {}, `Listening complete · ${pumpState.score}/${pumpState.deck.length}`),
        h('div', { class: 'ss-btns' },
          h('button', { class: 'ss-act', onclick: () => { pumpState = null; drawList(); } }, 'Start another listening set'),
          h('button', { onclick: () => { tab = 'lines'; drawHead(); drawList(); } }, 'Back to Subtitles'))));
      return;
    }
    if (pumpState.autoPlayedFor !== pumpState.idx) {
      pumpState.autoPlayedFor = pumpState.idx;
      setTimeout(() => replayScene(q.t, q.endT), 60);
    }
    const chosenWords = pumpState.pickedIds.map((id) => q.expected[id].w);
    const done = pumpState.revealed || chosenWords.length === q.expected.length;
    const joiner = V.L && V.L.noSpace ? '' : ' ';
    const exactOk = chosenWords.join(joiner).toLowerCase() === q.expected.map((x) => x.w).join(joiner).toLowerCase();

    const slotBox = h('div', { class: 'ss-tile-slot' },
      ...(chosenWords.length
        ? pumpState.pickedIds.map((id, pos) => h('button', {
            class: 'ss-tile ss-act',
            title: 'Click to remove tile',
            onclick: () => { if (!pumpState.revealed) { pumpState.pickedIds.splice(pos, 1); drawList(); } },
          }, q.expected[id].w))
        : [h('span', { style: { opacity: '.55', fontSize: '12px' } }, 'Listen to the clip and tap the words in order (or press Reveal)…')]));

    const usedSet = new Set(pumpState.pickedIds);
    const bankBox = h('div', { class: 'ss-tile-bank' },
      ...q.shuffled.map((tile) => h('button', {
        class: 'ss-tile' + (usedSet.has(tile.id) ? ' ss-used' : ''),
        onclick: () => {
          if (usedSet.has(tile.id) || pumpState.revealed) return;
          pumpState.pickedIds.push(tile.id);
          if (pumpState.pickedIds.length === q.expected.length) {
            const nowOk = pumpState.pickedIds.map((id) => q.expected[id].w).join(joiner).toLowerCase() === q.expected.map((x) => x.w).join(joiner).toLowerCase();
            if (nowOk && pumpState.creditedIndex !== pumpState.idx) {
              pumpState.creditedIndex = pumpState.idx;
              pumpState.score++;
              addXp(15);
            }
          }
          drawList();
        },
      }, tile.w)));

    appendClean(listEl, h('div', { class: 'ss-card ss-pump-card' },
      h('h5', {}, `Listening ${pumpState.idx + 1}/${pumpState.deck.length}`),
      h('div', { class: 'ss-h', style: { padding: '2px 0 6px', border: '0', background: 'transparent' } },
        h('button', { class: 'ss-teal', onclick: () => replayScene(q.t, q.endT) }, 'Replay Clip'),
        h('button', { onclick: () => { const v = video(); if (v) v.playbackRate = 0.8; replayScene(q.t, q.endT); } }, '0.8× Replay'),
        !done ? h('button', { onclick: () => { pumpState.revealed = true; drawList(); } }, 'Reveal') : null,
        pumpState.pickedIds.length && !pumpState.revealed ? h('button', { onclick: () => { pumpState.pickedIds = []; drawList(); } }, 'Clear') : null),
      q.trans ? h('div', { style: { fontSize: '12.5px', color: '#93c5fd', marginBottom: '4px' } }, `Meaning cue: ${q.trans}`) : null,
      slotBox,
      !done ? bankBox : null,
      done ? h('div', { style: { marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--ss-border)' } },
        h('div', { style: { fontWeight: '600', color: (exactOk && !pumpState.revealed) ? '#34d399' : '#fbbf24' } },
          (exactOk && !pumpState.revealed) ? 'Correct · 15 XP earned' : `Original: ${q.line}`),
        h('div', { class: 'ss-btns' },
          h('button', {
            onclick: () => {
              saveItem({ itemType: 'PHRASE', word: q.line, lemma: q.line.toLowerCase(), lang: V.lang, def: '', line: q.line, trans: q.trans || '', provenance: V.trProv || 'none', t: q.t, endT: q.endT, videoId: V.info.videoId, channelId: V.info.channelId || '', title: V.info.title });
              drawHead(); toast('Line saved (+5 XP)');
            },
          }, '+Save Line'),
          h('button', {
            class: 'ss-act',
            onclick: () => { pumpState.idx++; pumpState.pickedIds = []; pumpState.revealed = false; drawList(); },
          }, pumpState.idx + 1 < pumpState.deck.length ? 'Next Clip →' : 'Finish'))) : null));
  };

  const drawPracticeTab = () => {
    if (!getProfile().drills) {
      appendClean(listEl, h('div', { class: 'ss-msg' }, 'Drills disabled in current Research Profile (' + (S.set.researchProfile || 'full') + ').'));
      return;
    }
    const drills = ensureDrills();
    const exercises = [
      drills?.cloze.length ? ['cloze', 'Fill in the blanks'] : null,
      ['pump', 'Listen and rebuild'],
      drills?.spelling.length ? ['spelling', 'Spelling'] : null,
      drills?.spelling.length ? ['speaking', 'Read aloud'] : null,
      drills?.recall?.length ? ['recall', 'Recall the phrase'] : null,
    ].filter(Boolean);
    if (!exercises.some(([mode]) => mode === drillMode)) drillMode = exercises[0][0];
    const exercise = sel(exercises, drillMode, (mode) => { drillMode = mode; drillState = null; drawList(); });
    exercise.setAttribute('aria-label', 'Practice exercise');
    appendClean(listEl, h('div', { class: 'ss-h' },
      exercise,
      h('button', { onclick: () => { V.drills = null; drillState = null; pumpState = null; drawList(); } }, '↻ New set')));

    if (drillMode === 'pump') return drawPhrasePump();

    if (drillMode === 'cloze') {
      if (!drillState || drillState.mode !== 'cloze') drillState = { mode: 'cloze', idx: 0, picked: null, score: 0, shownAt: performance.now(), firstAttempt: true };
      const q = drills.cloze[drillState.idx];
      if (!q) {
        appendClean(listEl, h('div', { class: 'ss-card' }, h('h5', {}, `Cloze Complete: ${drillState.score}/${drills.cloze.length}`),
          h('button', { class: 'ss-act', onclick: () => { drillState = null; drawList(); } }, 'Retry')));
        return;
      }
      const card = h('div', { class: 'ss-card' },
        h('h5', {}, `Question ${drillState.idx + 1}/${drills.cloze.length}`),
        h('p', {}, q.prompt),
        q.trans ? h('p', { style: { fontSize: '12px', opacity: '.75' } }, q.trans) : null,
        h('div', { class: 'ss-h', style: { padding: '0 0 6px', border: '0', background: 'transparent' } },
          h('button', { class: 'ss-teal', onclick: () => { logEv('hintReplay', { q: q.pattern }); replayScene(q.t, q.endT); } }, '▶ Replay for a hint')));

      q.options.forEach((opt) => {
        const isAns = opt.toLowerCase() === q.answer.toLowerCase();
        const cls = 'ss-opt' + (drillState.picked ? (isAns ? ' ss-ok' : (drillState.picked === opt ? ' ss-bad' : '')) : '');
        appendClean(card, h('button', {
          class: cls,
          disabled: !!drillState.picked,
          onclick: () => {
            const latencyMs = Math.round(performance.now() - drillState.shownAt);
            drillState.picked = opt;
            if (isAns) { drillState.score++; addXp(15); }
            if (SS_STORE.recordConstructMastery(S.items, q.pattern, 'meaning', isAns)) save('items');
            logEv('drillAnswer', { mode: 'cloze', pattern: q.pattern, ok: isAns, latencyMs, firstAttempt: drillState.firstAttempt });
            drawList();
          },
        }, opt));
      });
      if (drillState.picked) {
        appendClean(card, h('button', {
          class: 'ss-act',
          style: { marginTop: '8px' },
          onclick: () => { drillState.idx++; drillState.picked = null; drillState.shownAt = performance.now(); drillState.firstAttempt = true; drawList(); },
        }, 'Next →'));
      }
      appendClean(listEl, card);
      return;
    }

    if (drillMode === 'spelling') {
      if (!drillState || drillState.mode !== 'spelling') drillState = { mode: 'spelling', idx: 0, guessed: new Set(), wrong: 0, shownAt: performance.now(), logged: false };
      const q = drills.spelling[drillState.idx];
      if (!q) {
        appendClean(listEl, h('div', { class: 'ss-card' }, h('h5', {}, 'Spelling Sprint Complete!'),
          h('button', { class: 'ss-act', onclick: () => { drillState = null; drawList(); } }, 'Retry')));
        return;
      }
      const target = q.answer;
      const isLetterChar = (ch) => /\p{L}/u.test(ch);
      const letters = Array.from(target).map((ch) => (!isLetterChar(ch) || drillState.guessed.has(ch.toLowerCase()) ? ch : '＿')).join(' ');
      const won = !Array.from(target).some((ch) => isLetterChar(ch) && !drillState.guessed.has(ch.toLowerCase()));
      const lost = drillState.wrong >= 6;
      const inp = h('input', { type: 'text', placeholder: 'Type character/letter or full phrase…', style: { flex: '1' } });
      const checkInput = () => {
        const val = inp.value.trim().toLowerCase();
        if (!val) return;
        const cp = Array.from(val);
        if (cp.length > 1) {
          if (val === target.toLowerCase()) { cp.forEach((c) => drillState.guessed.add(c)); addXp(15); }
          else drillState.wrong++;
        } else {
          if (!target.toLowerCase().includes(val)) drillState.wrong++;
          drillState.guessed.add(val);
        }
        const nowWon = !Array.from(target).some((ch) => isLetterChar(ch) && !drillState.guessed.has(ch.toLowerCase()));
        const nowLost = drillState.wrong >= 6;
        if ((nowWon || nowLost) && !drillState.logged) {
          drillState.logged = true;
          const latencyMs = Math.round(performance.now() - drillState.shownAt);
          if (SS_STORE.recordConstructMastery(S.items, q.pattern, 'form', nowWon)) save('items');
          logEv('drillAnswer', { mode: 'spelling', pattern: q.pattern, ok: nowWon, latencyMs, mistakes: drillState.wrong });
        }
        drawList();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkInput(); });

      appendClean(listEl, h('div', { class: 'ss-card' },
        h('h5', {}, `Hangman Spelling ${drillState.idx + 1}/${drills.spelling.length} · Mistakes: ${drillState.wrong}/6`),
        h('p', {}, q.prompt),
        h('div', { class: 'ss-mono' }, (won || lost) ? target : letters),
        h('div', { class: 'ss-h', style: { padding: '4px 0', border: '0', background: 'transparent' } },
          inp,
          h('button', { class: 'ss-act', onclick: checkInput }, 'Guess'),
          h('button', { class: 'ss-teal', onclick: () => { logEv('hintReplay', { q: q.pattern }); replayScene(q.t, q.endT); } }, '▶ Hint Scene')),
        (won || lost) ? h('div', { style: { marginTop: '6px' } },
          won ? '✓ Correct! (+15 XP) ' : `Answer: ${target} `,
          h('button', { class: 'ss-act', onclick: () => { drillState.idx++; drillState.guessed = new Set(); drillState.wrong = 0; drillState.shownAt = performance.now(); drillState.logged = false; drawList(); } }, 'Next →')) : null));
      return;
    }

    if (drillMode === 'recall') {
      if (!drillState || drillState.mode !== 'recall') drillState = { mode: 'recall', idx: 0, submitted: null, ok: false, firstAttempt: true, shownAt: performance.now(), score: 0 };
      const q = (drills.recall || [])[drillState.idx];
      if (!q) {
        appendClean(listEl, h('div', { class: 'ss-card' }, h('h5', {}, `Form Recall Complete: ${drillState.score}/${(drills.recall || []).length}`),
          h('button', { class: 'ss-act', onclick: () => { drillState = null; drawList(); } }, 'Retry')));
        return;
      }
      const inp = h('input', { type: 'text', placeholder: `Complete after "${q.cuePrefix}"…`, style: { flex: '1' } });
      const submitRecall = () => {
        const val = inp.value.trim();
        if (!val) return;
        const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, '').replace(/\s+/g, ' ').trim();
        const ok = norm(val) === norm(q.expectedTail) || norm(val) === norm(q.fullSurface);
        const latencyMs = Math.round(performance.now() - drillState.shownAt);
        drillState.submitted = val;
        drillState.ok = ok;
        if (ok) { drillState.score++; addXp(20); }
        if (SS_STORE.recordConstructMastery(S.items, q.pattern, 'form', ok)) save('items');
        logEv('drillAnswer', { mode: 'recall', pattern: q.pattern, ok, latencyMs, firstAttempt: drillState.firstAttempt });
        drillState.firstAttempt = false;
        drawList();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !drillState.submitted) submitRecall(); });

      appendClean(listEl, h('div', { class: 'ss-card' },
        h('h5', {}, `Cued Form Recall ${drillState.idx + 1}/${drills.recall.length} `),
        h('p', {}, q.prompt),
        q.trans ? h('p', { style: { fontSize: '12px', opacity: '.75' } }, q.trans) : null,
        h('div', { class: 'ss-h', style: { padding: '4px 0', border: '0', background: 'transparent' } },
          inp,
          h('button', { class: 'ss-act', disabled: !!drillState.submitted, onclick: submitRecall }, 'Check'),
          h('button', { class: 'ss-teal', onclick: () => { logEv('hintReplay', { q: q.pattern }); replayScene(q.t, q.endT); } }, '▶ Hint Scene')),
        drillState.submitted ? h('div', { style: { marginTop: '6px' } },
          drillState.ok ? `✓ Exact recall: "${q.fullSurface}" (+20 XP) ` : `Expected: "${q.expectedTail}" (Full: "${q.fullSurface}") `,
          h('button', {
            class: 'ss-act',
            onclick: () => { drillState.idx++; drillState.submitted = null; drillState.ok = false; drillState.firstAttempt = true; drillState.shownAt = performance.now(); drawList(); },
          }, 'Next →')) : null));
      return;
    }

    // 3. Read Aloud / True Acoustic F0 Pitch & Prosody Mirror
    if (!drillState || drillState.mode !== 'speaking') {
      drillState = { mode: 'speaking', idx: 0, heard: '', recording: false, audioUrl: '', learnerProsody: null, shownAt: performance.now() };
    }
    const q = drills.speaking[drillState.idx];
    if (!q) {
      appendClean(listEl, h('div', { class: 'ss-card' }, h('h5', {}, 'Read-Aloud Practice Complete!'),
        h('button', { class: 'ss-act', onclick: () => { drillState = null; drawList(); } }, 'Restart')));
      return;
    }

    const waveCanvas = h('canvas', { class: 'ss-wave', width: 320, height: 82, title: 'Cyan: Native Speaker F0 Pitch · Amber: Your F0 Pitch' });
    if (companionHealth && companionHealth.ok && !q.nativeProsody && !q._prosodyFetching) {
      q._prosodyFetching = true;
      comp('/prosody', { videoId: V.info.videoId, t_start: q.t, t_end: q.endT || q.t + 4, bins: 64 }, 'POST', 60000).then((pr) => {
        q._prosodyFetching = false;
        if (pr && pr.ok) {
          q.nativeProsody = pr;
          if (waveCanvas.isConnected) drawProsodyCanvas(waveCanvas, q, drillState.learnerProsody);
        }
      });
    }

    const card = h('div', { class: 'ss-card' },
      h('h5', {}, `Read Aloud ${drillState.idx + 1}/${drills.speaking.length} — "${q.target}"`),
      h('p', {}, q.line),
      q.trans ? h('p', { style: { fontSize: '12px', opacity: '.75' } }, q.trans) : null,
      waveCanvas,
      h('div', { class: 'ss-h', style: { padding: '4px 0', border: '0', background: 'transparent' } },
        h('button', { class: 'ss-teal', onclick: () => { logEv('hintReplay', { q: q.pattern }); replayScene(q.t, q.endT); } }, '▶ Play Original'),
        h('button', {
          class: drillState.recording ? 'ss-act' : '',
          onclick: async () => {
            if (drillState.recording) return;
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const mr = new MediaRecorder(stream);
              const chunks = [];
              mr.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
              mr.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                drillState.recording = false;
                const blob = new Blob(chunks, { type: 'audio/webm' });
                drillState.audioUrl = URL.createObjectURL(blob);
                try {
                  const AC = window.AudioContext || window.webkitAudioContext;
                  if (AC) {
                    const ac = new AC();
                    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
                    drillState.learnerProsody = computeClientProsody(buf, 64);
                    await ac.close();
                  }
                } catch (e) {}
                const score = q.nativeProsody && drillState.learnerProsody ? prosodyOverlapScore(q.nativeProsody.f0_st, drillState.learnerProsody.f0_st) : null;
                const latencyMs = Math.round(performance.now() - drillState.shownAt);
                addXp(10);
                if (SS_STORE.recordConstructMastery(S.items, q.pattern, 'prosody', true)) save('items');
                logEv('drillAnswer', { mode: 'speaking', pattern: q.pattern, ok: true, latencyMs, prosodyMatch: score, heard: drillState.heard || '' });
                drawList();
              };
              drillState.recording = true;
              drawList();
              mr.start();
              const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
              if (SR) {
                const rec = new SR();
                rec.lang = V.lang || 'en-US';
                rec.onresult = (ev) => { drillState.heard = ev.results[0][0].transcript; };
                try { rec.start(); } catch (e) {}
                setTimeout(() => { try { rec.stop(); } catch (e) {} }, 4000);
              }
              setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 4200);
            } catch (err) {
              toast('Mic permission denied or unavailable');
            }
          },
        }, drillState.recording ? 'Recording (4s)…' : 'Record Yourself'),
        h('button', { onclick: () => { drillState.idx++; drillState.heard = ''; drillState.audioUrl = ''; drillState.learnerProsody = null; drillState.shownAt = performance.now(); drawList(); } }, 'Next →')));

    drawProsodyCanvas(waveCanvas, q, drillState.learnerProsody);
    const dtwInfo = q.nativeProsody && drillState.learnerProsody ? prosodyDtwCompare(q.nativeProsody.f0_st, drillState.learnerProsody.f0_st) : null;
    if (dtwInfo) appendClean(card, h('div', { style: { fontSize: '12px', color: '#2dd4bf', marginTop: '4px' } }, dtwInfo.tip));
    if (drillState.heard) appendClean(card, h('div', { style: { fontSize: '12px', marginTop: '4px' } }, `Recognized: "${drillState.heard}"`));
    if (drillState.audioUrl) appendClean(card, h('audio', { controls: true, src: drillState.audioUrl, style: { width: '100%', marginTop: '6px' } }));
    appendClean(listEl, card);
  };

  // ---- Tab 4: Spaced Review + Multimodal Concordance ----
  const drawReviewTab = () => {
    if (concordanceTarget) {
      const target = concordanceTarget;
      appendClean(listEl, h('div', { class: 'ss-h' },
        h('b', {}, `Concordance: ${target.label}`),
        h('button', { onclick: () => { concordanceTarget = null; concordanceRows = []; drawList(); } }, '← Back to Flashcards')));
      if (!concordanceRows.length) {
        SS_STORE.getConcordance(target.key).then((rows) => {
          concordanceRows = rows;
          const box = listEl.querySelector('#ss-conc-box');
          if (!box) return;
          box.textContent = '';
          if (!rows.length) { appendClean(box, h('div', { class: 'ss-msg' }, 'No scenes logged across videos yet.')); return; }
          rows.forEach((r) => {
            appendClean(box, h('div', {
              class: 'ss-li',
              onclick: () => {
                if (sameVidKey(r.videoId, curVidKey())) replayScene(r.t, r.endT);
                else location.href = videoUrlOf(r.videoId, r.t);
              },
            },
            h('span', { class: 'ss-t' }, fmt(r.t)),
            h('span', {}, r.line, h('span', { class: 'ss-tr' }, `${r.title || r.videoId}${r.trans ? ' · ' + r.trans : ''}`))));
          });
        });
      }
      appendClean(listEl, h('div', { id: 'ss-conc-box' }, h('div', { class: 'ss-msg' }, 'Loading scenes…')));
      return;
    }

    appendClean(listEl, h('div', { class: 'ss-card' },
      h('button', { class: 'ss-act', onclick: () => chrome.runtime.sendMessage({ op: 'openExtPage', page: 'review.html' }) }, 'Open review')));
  };

  // ---- Tab 5: Saved & Exports (with LR-style "Only new / unexported" incremental batch mode) ----
  const drawSavedTab = () => {
    const newCount = S.items.filter((it) => !it.exportedAt).length;
    const shown = S.items.slice().reverse().filter((it) =>
      (savedFilter === 'all' || (it.itemType || 'WORD') === savedFilter) && (!exportOnlyNew || !it.exportedAt));
    const exportBatch = () => (exportOnlyNew ? shown : (savedFilter === 'all' ? S.items : shown));

    appendClean(listEl, h('div', { class: 'ss-h' },
      sel([['all', 'All'], ['WORD', 'Words'], ['FE', 'Idioms'], ['PHRASE', 'Phrases']], savedFilter, (v) => { savedFilter = v; drawList(); }),
      h('button', {
        class: 'ss-qpill' + (exportOnlyNew ? ' ss-teal' : ''),
        title: 'Filter & export only newly saved items that have not been exported yet',
        onclick: () => { exportOnlyNew = !exportOnlyNew; drawList(); },
      }, `New only (${newCount})`),
      h('button', { class: exportOpen ? 'ss-act' : '', onclick: () => { exportOpen = !exportOpen; drawList(); } }, exportOpen ? 'Export ▴' : 'Export ▾')));
    if (exportOpen) appendClean(listEl, h('div', { class: 'ss-h ss-export-menu' },
      h('button', {
        class: 'ss-teal',
        title: 'Push filtered cards + screenshots to desktop Anki via AnkiConnect (:8765)',
        onclick: async () => {
          const batch = exportBatch();
          const res = await SS_EXPORT.pushToAnkiConnect(batch, { ankiUrl: S.set.ankiConnectUrl, deck: S.set.ankiDeck });
          if (res.ok) { save('items'); drawList(); }
          toast(res.ok ? `AnkiConnect: +${res.added} added${res.updated ? `, ${res.updated} updated` : ''}, ${res.skipped} skipped` : (res.error || 'AnkiConnect offline'));
        },
      }, `Send to Anki (${exportBatch().length})`),
      h('button', { class: 'ss-act', onclick: () => { const ok = SS_EXPORT.exportAnkiTsv(exportBatch(), 'basic'); if (ok) { save('items'); drawList(); } else toast('Nothing in filter'); } }, 'Anki file (.tsv)'),
      h('button', { onclick: () => { const ok = SS_EXPORT.exportAnkiTsv(exportBatch(), 'cloze'); if (ok) { save('items'); drawList(); } else toast('Nothing in filter'); } }, 'Anki cloze (.tsv)'),
      companionHealth && companionHealth.ok ? h('button', {
        class: 'ss-teal',
        onclick: async () => { const ok = await SS_EXPORT.exportApkgViaCompanion(exportBatch()); if (ok) { save('items'); drawList(); } toast(ok ? 'Downloaded .apkg!' : 'Companion .apkg failed'); },
      }, 'Anki deck with media (.apkg)') : null,
      h('button', { onclick: () => { SS_EXPORT.exportJson(S.items, S.words); save('items'); drawList(); } }, 'Backup (.json)'),
      h('button', { onclick: () => { if (SS_EXPORT.exportCsv(exportBatch())) { save('items'); drawList(); } else toast('Nothing in filter'); } }, 'Excel CSV (.csv)'),
      h('button', { onclick: () => SS_EXPORT.exportSrt(V.lines, transFor, 'both', V.info.title, subOff) }, 'Subtitles (.srt)'),
      h('button', {
        class: 'ss-teal',
        title: 'Export standalone interactive Teacher Difficulty Audit & Quiz (.html)',
        onclick: () => { SS_EXPORT.exportTeacherLessonHtml(V.info, V.analysis, ensureDrills(), V.pieMap || {}); toast('Downloaded Teacher Lesson (.html)'); },
      }, 'Download lesson page (.html)'),
      h('button', {
        title: 'Export LME-ready tabular CSV (items, D0/FSRS, latencyMs, DTW prosody) for R / Python',
        onclick: async () => { SS_EXPORT.exportResearchCsv(S.items, await SS_STORE.exportResearchLog()); toast('Exported Research LME CSV'); },
      }, 'Research table (.csv)'),
      h('button', {
        title: 'Export anonymous timestamped learning telemetry JSON for research',
        onclick: async () => { SS_EXPORT.exportJson(S.items, S.words, await SS_STORE.exportResearchLog()); },
      }, 'Research log (.json)')));

    if (!shown.length) {
      appendClean(listEl, h('div', { class: 'ss-msg' }, 'Nothing saved in this filter yet. Click a word or press R to save the current subtitle.'));
      return;
    }
    shown.forEach((it) => {
      appendClean(listEl, h('div', {
        class: 'ss-li',
        title: it.title || '',
        onclick: () => {
          if (sameVidKey(it.videoId, curVidKey())) replayScene(it.t, it.endT || it.t + 3);
          else location.href = videoUrlOf(it.videoId, it.t);
        },
      },
      h('span', { class: 'ss-t' }, fmt(it.t)),
      h('span', {},
        h('b', {}, it.word), ` [${it.itemType || 'WORD'}] — ${it.line}`,
        it.trans ? h('span', { class: 'ss-tr' }, it.trans) : null),
      h('button', {
        title: 'Remove',
        onclick: (e) => { e.stopPropagation(); S.items = S.items.filter((x) => x !== it); save('items'); drawHead(); drawList(); },
      }, '×')));
    });
  };

  // ---- Playback sync & Hold-to-Peek ----
  const lineEnd = (i) => {
    const ln = V.lines[i], nx = V.lines[i + 1];
    let e = ln.e != null ? ln.e : (ln.s + (ln.d || 3));
    if (nx) e = Math.min(e, nx.s);
    return e;
  };
  const indexAt = (t, mediaTime = false) => {
    const a = V.lines;
    let lo = 0, hi = a.length - 1, r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const start = a[m].s;
      if (start + (mediaTime ? subOff(start) : 0) <= t) { r = m; lo = m + 1; } else hi = m - 1;
    }
    return r;
  };

  const markCur = (i) => {
    if (tab !== 'lines' || !listEl) return;
    listEl.querySelectorAll('.ss-cur').forEach((n) => n.classList.remove('ss-cur'));
    listEl.querySelectorAll('.ss-sub-cur').forEach((n) => n.classList.remove('ss-sub-cur'));
    let el = listEl.querySelector(`[data-i="${i}"]`);
    if (!el) {
      const sub = listEl.querySelector(`[data-sub-i="${i}"]`);
      if (sub) {
        sub.classList.add('ss-sub-cur');
        el = sub.closest('.ss-li');
      }
    } else {
      const sub = el.querySelector(`[data-sub-i="${i}"]`);
      if (sub) sub.classList.add('ss-sub-cur');
    }
    if (el) {
      el.classList.add('ss-cur');
      if (Date.now() >= listFollowPausedUntil) {
        const top = el.offsetTop - listEl.offsetTop;
        if (top < listEl.scrollTop || top > listEl.scrollTop + listEl.clientHeight - 60) listEl.scrollTop = top - listEl.clientHeight / 3;
      }
    }
  };

  // v1.1.0 Captionary Pause-on-Subtitle-Hover & MIT asbplayer External .srt/.vtt/.ass Drop onto Streaming Video
  let hoverPausedVideo = false;
  let boundDropContainer = null;

  const parseDroppedSubtitleText = (rawTxt, fileName) => {
    const low = String(fileName || '').toLowerCase();
    if (low.endsWith('.ass') || low.endsWith('.ssa') || /^\s*\[Script Info\]/i.test(rawTxt)) {
      const cues = [];
      const toSec = (ts) => {
        const m = String(ts || '').trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
        if (!m) return 0;
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
      };
      for (const ln of String(rawTxt || '').split(/\r?\n/)) {
        if (!ln.startsWith('Dialogue:')) continue;
        const rest = ln.slice(9).split(',');
        if (rest.length < 10) continue;
        const s = toSec(rest[1]);
        const e = toSec(rest[2]);
        const text = rest.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, ' ').trim();
        if (text && e > s) cues.push({ t: text, s, e, d: Math.round((e - s) * 1000) / 1000 });
      }
      return cues.sort((a, b) => a.s - b.s);
    }
    if (window.SS_PARSE && typeof SS_PARSE.parseAuto === 'function') {
      return SS_PARSE.parseAuto(rawTxt).map((c) => Object.assign({}, c, {
        e: c.e != null ? c.e : c.s + (c.d || 2.5),
        d: Math.round(((c.e != null ? c.e : c.s + (c.d || 2.5)) - c.s) * 1000) / 1000,
      }));
    }
    return [];
  };

  const wireOverlayHoverAndExternalSubDrop = () => {
    if (ov && !ov.__ssHoverBound) {
      ov.__ssHoverBound = true;
      ov.addEventListener('mouseenter', () => {
        if (!S.set.pauseOnSubHover) return;
        const v = video();
        if (v && !v.paused) {
          hoverPausedVideo = true;
          v.pause();
        }
      });
      ov.addEventListener('mouseleave', () => {
        if (!hoverPausedVideo || dictOpen) { hoverPausedVideo = false; return; }
        hoverPausedVideo = false;
        const v = video();
        if (v && v.paused) v.play()?.catch?.(() => {});
      });
    }
    const c = playerContainer();
    if (c && c !== boundDropContainer && c.addEventListener) {
      boundDropContainer = c;
      c.addEventListener('dragover', (ev) => {
        const dt = ev.dataTransfer;
        if (!dt || !dt.types || !Array.from(dt.types).includes('Files')) return;
        ev.preventDefault();
      });
      c.addEventListener('drop', async (ev) => {
        const files = ev.dataTransfer && ev.dataTransfer.files;
        if (!files || !files.length) return;
        const f = Array.from(files).find((x) => /\.(srt|vtt|ass|ssa)$/i.test(x.name || ''));
        if (!f) return;
        ev.preventDefault();
        ev.stopPropagation();
        const rawTxt = await f.text();
        const cues = parseDroppedSubtitleText(rawTxt, f.name);
        if (!cues.length) { toast('No subtitle cues found in ' + f.name); return; }
        if (ev.shiftKey && V && V.lines && V.lines.length) {
          V.tr = cues;
          V.sameTiming = false;
          V.trProv = 'Local File';
          drawHead(); drawList(); drawLine(V.cur);
          toast(`Loaded secondary translation track: ${f.name} (${cues.length} lines)`);
          return;
        }
        if (!V) {
          const site = getActiveSite();
          V = {
            info: { site: (site && site.id) || 'gen', videoId: (site && site.rawVideoId && site.rawVideoId()) || 'local_drop', title: document.title || f.name, tracks: [] },
            lines: [], tr: null, sameTiming: false, cur: -1, lang: S.set.lang || 'en', L: SS_LANG.get(S.set.lang || 'en'),
          };
        }
        V.syncStoragePrefix = null; V.syncPoints = []; V.syncAnchor = null; V.subOffset = 0;
        V.lines = cues;
        const fileLang = /(?:^|[._-])(en|ja|ko|zh|yue|es|fr|de|pt|it|ru|tl|fil)(?:[-_](?:Hant|Hans|TW|HK|JP|KR|BR|US))?\.(?:srt|vtt|ass|ssa)$/i.exec(f.name);
        V.yueByText = false;
        V.lang = fileLang ? normLangCode(fileLang[1].toLowerCase()) :
          inferScriptLang(cues.slice(0, 8).map(cue => cue.t).join(' '), V.lang || S.set.lang);
        V.L = SS_LANG.get(V.lang);
        V.cur = -1;
        V.tr = null;
        V.aiTr = null;
        V.sameTiming = false;
        V.msg = '';
        V.srcProv = f.name.slice(0, 18);
        await finishLoadAnalysis(++run);
        toast(`Loaded external subtitles: ${f.name} (${cues.length} cues · Shift+Drop for translation track)`);
      });
    }
  };

  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (window.__ssComparingScenes) return;
    ensurePlayerBtn();
    wireOverlayHoverAndExternalSubDrop();
    if (!V || !V.lines.length) return;
    const s = getActiveSite();
    if (s && s.isAd && s.isAd()) {
      if (ov && ov.childNodes.length) drawLine(-1);
      return;
    }
    const v = video();
    if (!v) return;
    if (panel) panel.classList.toggle('ss-playing-calm', !v.paused && !dictOpen && !settingsOpen);
    const liveMode = isLiveContext();
    const rawT = (liveMode && !(Number.isFinite(v.currentTime) && v.currentTime > 0)) ? liveTimeNow() : v.currentTime;
    if (clipStopAt > 0 && rawT >= clipStopAt && !v.paused) {
      clipStopAt = -1;
      v.pause();
      return;
    }
    const livePair = liveState.active ? V.lines.indexOf(liveState.lastPair) : -1;
    const i = livePair >= 0 ? livePair : indexAt(rawT, true);
    const t = rawT - subOff(V.lines[i]?.s);

    if (!liveMode && runRepeatSection(v,rawT)) return;

    // Condensed Playback (MIT asbplayer style): jump directly across unsubtitled gaps >= 2.4s (VOD only)
    if (!liveMode && S.set.condensedPlayback && !v.paused && clipStopAt < 0 && !loopRange && loopIdx < 0) {
      const inCueNow = i >= 0 && t <= lineEnd(i) + 0.2 && !V.lines[i].isInstrumental;
      const nextCue = V.lines[i + 1];
      if (!inCueNow && nextCue && (nextCue.s - t) >= 2.4) {
        seek(Math.max(0, nextCue.s - 0.16));
        return;
      }
    }

    // Smart Auto-Flow speed: play spoken dialogue at study rate, glide over silent gaps (>1.6s) at 1.5x (VOD only)
    if (!heldSpeed && !liveMode && S.set.smartSpeedFlow && !v.paused && clipStopAt < 0) {
      const baseSpd = S.set.dialogueSpeed || 0.9;
      const inSpeech = i >= 0 && t <= lineEnd(i) + 0.35 && !V.lines[i].isInstrumental;
      const nextLn = V.lines[i + 1];
      const longGap = !inSpeech && (!nextLn || nextLn.s - t >= 1.4);
      const wantRate = longGap ? 1.5 : baseSpd;
      if (Math.abs(v.playbackRate - wantRate) > 0.04) v.playbackRate = wantRate;
    }

    trackWatched(v, t, i);
    if (i !== V.cur) {
      V._activeDueRecall = null;
      V.cur = i;
      revealedIndex = -1;
      drawLine(i);
      markCur(i);
      if (i >= 0 && i % 4 === 0) prefetchUpcomingDicts(i);
    } else if (livePair < 0 && i >= 0 && t > lineEnd(i) + 1.5 && ov && ov.childNodes.length) {
      drawLine(-1);
    } else if (i >= 0 && S.set.on && ov && !ov.childNodes.length && !V.lines[i].isInstrumental && t <= lineEnd(i) + 1.5) {
      drawLine(i);
    }
  }, 80);

  let peekKey = null;
  let peekWasPlaying = false;
  let loopIdx = -1;   // L: repeat one line until you move on
  let peekTimer = null;

  document.addEventListener('keydown', (e) => {
    if (ocrBackEl && e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeBurnedInOcrModal();
      return;
    }
    if (settingsOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeSettingsModal();
      return;
    }
    if (dictOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeDock(true);
      return;
    }
    const tgt0 = e.target;
    const inEditable0 = tgt0 && (tgt0.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt0.tagName));
    if (!inEditable0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && e.key && e.key.toLowerCase() === 'o' && video()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openBurnedInOcrModal();
      return;
    }
    if (!inEditable0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && e.key && e.key.toLowerCase() === 'h' && V && S.set.on && !document.fullscreenElement) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPanelHidden(!S.set.panelHidden);
      return;
    }
    if (!V || !V.lines.length || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    let k = e.key.toLowerCase();
    if (S.set.arrowKeys && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) k = e.key === 'ArrowLeft' ? 'a' : 'd';
    if (!'asdwerlcb[]12'.includes(k) || k.length !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;

    const v = video();
    const c = Math.max(0, V.cur);
    if (k === 'a' || k === 's' || k === 'd') {
      closeDock();
      const targetIdx = k === 'a' ? Math.max(0, c - 1) : k === 's' ? c : Math.min(V.lines.length - 1, c + 1);
      if (loopIdx >= 0 && k !== 's') loopIdx = targetIdx;
      if (k === 's') logEv('replayS', { idx: targetIdx });
      if (v) {
        peekKey = k;
        peekWasPlaying = !v.paused;
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => { if (peekKey === k && v) v.pause(); }, 260);
      }
      seek(V.lines[targetIdx].s);
    } else if (k === 'l') {
      loopRange = null;
      clearRepeatSession(true);
      loopIdx = loopIdx >= 0 ? -1 : c;
      if (loopIdx >= 0 && V.lines[c] && (S.set.repeatCount || S.set.repeatSpeakingGap)) {
        const start=V.lines[c].s;seek(Math.max(0,start-Number(S.set.repeatPadding ?? 0.25)),-1,start);
      }
      drawHead(); drawList();
      toast(loopIdx >= 0 ? 'Repeating this line (L to stop)' : 'Repeat off');
    } else if (k === '[') {
      loopIdx = -1;
      const endLi = loopRange && loopRange.endLi >= c ? loopRange.endLi : Math.min(V.lines.length - 1, c + 1);
      loopRange = { startLi: c, endLi };
      drawHead(); drawList();
      toast(`Loop start: L${c + 1}–L${endLi + 1} (press ] on end line, L to clear)`);
    } else if (k === ']') {
      loopIdx = -1;
      const startLi = loopRange && loopRange.startLi <= c ? loopRange.startLi : Math.max(0, c - 1);
      loopRange = { startLi, endLi: c };
      drawHead(); drawList();
      toast(`Looping lines L${startLi + 1}–L${c + 1} (L to stop)`);
    } else if (k === 'b') {
      cycleBlurMode();
    } else if (k === '1' || k === '2') {
      if (v) {
        S.set.smartSpeedFlow = false;
        const nextR = Math.max(0.5, Math.min(2.0, Math.round((v.playbackRate + (k === '1' ? -0.1 : 0.1)) * 10) / 10));
        v.playbackRate = nextR;
        S.set.dialogueSpeed = nextR;
        save('set'); drawHead();
        toast(`Speed: ${nextR.toFixed(1)}×`);
      }
    } else if (k === 'c') {
      const ln = V.lines[c];
      if (ln) {
        const txt = ln.t + (transFor(ln) ? '\n' + transFor(ln) : '');
        // Copy inside the key press itself (works where the clipboard API is refused), then try the clipboard API.
        let ok = false;
        try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e) {}
        if (ok) toast('Line copied');
        else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('Line copied'), () => toast('Copy blocked by the browser'));
        else toast('Copy blocked by the browser');
      }
    } else if (k === 'w') {
      if (v) v.paused ? v.play()?.catch?.(() => {}) : v.pause();
    } else if (k === 'e') {
      revealedIndex = V.cur; logEv('blurReveal', { idx: V.cur });
      if (V.cur >= 0 && V.lines[V.cur]) {
        const revRk = maxRankInLine(V.lines[V.cur]);
        if (revRk) recordImplicitVocabSignal(revRk, false, V.lines[V.cur]);
      }
      drawLine(V.cur);
    } else if (k === 'r') {
      const ln = V.lines[c];
      if (ln && !ln.isInstrumental) {
        saveItem({
          itemType: 'PHRASE', word: ln.t, lemma: ln.t.toLowerCase(), lang: V.lang,
          def: '', line: ln.t, trans: transFor(ln), provenance: V.trProv || 'none',
          t: ln.s, endT: lineEnd(c), videoId: curVidKey(), channelId: V.info.channelId || '', title: V.info.title,
        });
        drawHead(); if (tab === 'saved') drawList(); toast('Line saved (+5 XP)');
      }
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (peekKey && k === peekKey) {
      clearTimeout(peekTimer);
      const v = video();
      if (v && v.paused && peekWasPlaying) v.play()?.catch?.(() => {});
      peekKey = null;
    }
  }, true);

  // ---- Finish analysis after lines arrive ----
  const maybeFetchAnnotations = (myRun) => {
    if (myRun !== run || !V || !V.lines.length || V.annotations) return;
    const hasCjk = V.lines.some((l) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(l.t)) || /^(ja|zh|cn|yue|ko)/.test(V.lang || '');
    if (hasCjk && companionHealth && companionHealth.ok) {
      V.annotations = []; // mark in-flight
      comp('/annotate', { lines: V.lines.map((l) => l.t), lang: V.lang || S.set.asrLangHint || 'mixed' }).then((r) => {
        if (myRun === run && r && r.ok && r.lines) {
          V.annotations = r.lines;
          if (tab === 'lines') drawList();
          if (V.cur >= 0) drawLine(V.cur);
        } else if (myRun === run) {
          V.annotations = null;
        }
      });
    }
  };

  const finishLoadAnalysis = async (myRun, passiveLive = false) => {
    if (!V || !V.lines.length) return;
    V.yueByText = false;
    if (normLangCode(V.lang) === 'zh') {
      const ls = V.lines.slice(0, 400);
      V.yueByText = ls.filter((l) => /[嘅咗唔佢冇喺噉嗰咩啲嚟睇攞]/.test(l.t || '')).length / Math.max(1, ls.length) >= 0.15;
    }
    const norm = normLangCode(V.lang);
    const base = norm;
    const isCjk = SS_IDIOMS.isCjkLang ? SS_IDIOMS.isCjkLang(norm) : /^(zh|yue|ja|ko)$/.test(norm);
    const rankKey = norm;
    const tokenLang = !isCjk ? norm : '';
    const tlNorm = normLangCode(S.set.tl || 'en');
    const needReadDict = /^(ja|zh|yue|ko|tl|ru)$/.test(norm);
    const [bands, ranks, feJson, formsJson, glossSidecar, readJson, glStore] = await Promise.all([
      loadData(`bands_${rankKey}.json`),
      loadData(`ranks_${rankKey}.json`),
      tokenLang ? loadData(`fe_${tokenLang}.json`) : Promise.resolve(null),
      tokenLang && tokenLang !== 'en' ? loadData(`forms_${tokenLang}.json`) : Promise.resolve(null),
      loadNxnSidecar(norm, tlNorm),
      needReadDict ? loadData(`read_${norm}.json`) : Promise.resolve(null),
      SS_STORE.getGlossary(curVidKey(), V.info.channelId),
    ]);
    if (myRun !== run) return;

    const normBands = (bands && bands.items && typeof bands.items === 'object' && !Array.isArray(bands.items)) ? bands.items : bands;
    const normRanks = (ranks && ranks.items && typeof ranks.items === 'object' && !Array.isArray(ranks.items)) ? ranks.items : ranks;
    V.ranks = normRanks;
    V._glossSidecar = glossSidecar || null;
    V._nxnSidecars = V._nxnSidecars || {};
    if (glossSidecar) V._nxnSidecars[tlNorm] = glossSidecar;
    V.readDict = readJson && window.SS_READINGS && SS_READINGS.normalizeReadDict
      ? SS_READINGS.normalizeReadDict(readJson)
      : (readJson || null);
    V.readDictRich = readJson && window.SS_READINGS && SS_READINGS.normalizeRichReadDict
      ? SS_READINGS.normalizeRichReadDict(readJson)
      : null;
    if (base === 'en' && normRanks && SS_LANG.setLexicon) SS_LANG.setLexicon(normRanks);
    if (formsJson && SS_LANG.setForms) SS_LANG.setForms(tokenLang, formsJson);
    V.L = SS_LANG.get(norm);
    V._gender = null;
    const genderJson = GENDER_LANGS.has(norm) ? await loadData(`gender_${norm}.json`) : null;
    if (myRun !== run) return;
    if (genderJson) {
      const map = new Map();
      for (const k of ['m2', 'f2', 'n2', 'm', 'f', 'n']) for (const w of (genderJson[k] || '').split('|')) if (w) map.set(w, k);
      V._gender = { lang: norm, map };
    }

    const activeLines = V.lines.map((l) => (l.isInstrumental ? Object.assign({}, l, { t: '' }) : l));
    // 12-language FE loader: ja / ko / zh / yue use character-stem matcher; en / es / fr / de / pt / it / ru / tl use 4-family token matcher.
    const cjkFiles = isCjk ? SS_IDIOMS.cjkFeFiles(norm) : [];
    let feIndex = null;
    if (tokenLang && feJson) {
      feIndex = SS_IDIOMS.buildFeIndex(feJson, normRanks, tokenLang);
      if (tokenLang === 'en' && !V._enGloss) V._enGloss = (await loadData('fe_en_gloss.json')) || { items: {} };
    } else if (cjkFiles.length) {
      feIndex = SS_IDIOMS.buildCjkIndex(await Promise.all(cjkFiles.map(loadData)));
    }
    if (myRun !== run) return;
    V.analysis = SS_IDIOMS.analyzeVideo(activeLines, V.L, V.lang || 'en', normBands || null, normRanks || null, S.words, feIndex, {
      coverThreshold: S.set.coverThreshold || 0.85,
      vocabLevel: curVocabLevel(V.lang || 'en'),
    });
    if (base === 'en' && V._enGloss && V._enGloss.items) {
      for (const fe of V.analysis.allFEs || []) {
        const g = V._enGloss.items[(fe.display || '').toLowerCase()];
        if (g) { fe.gloss = fe.gloss || g[0] || ''; fe.glossZh = fe.glossZh || g[1] || ''; }
      }
    }
    // Link extra.eq.zh items (e.g. fe_ko's 2,312 사자성어 & KRDict idioms) to their chengyu meaning in fe_zh.json
    if ((V.analysis.allFEs || []).some((fe) => fe.eq && fe.eq.zh)) {
      await ensureZhChengyuMap();
      if (myRun !== run) return;
      for (const fe of V.analysis.allFEs || []) {
        if (fe.eq && fe.eq.zh) {
          const zhHit = lookupZhChengyu(fe.eq.zh);
          if (zhHit) fe._zhEq = zhHit;
        }
      }
    }
    const chTerms = (glStore.channel && glStore.channel.terms) || [];
    const vidTerms = (glStore.video && glStore.video.terms) || [];
    V.glossaryTerms = mergeGlossaryTerms(chTerms, vidTerms);
    V.pieMap = (glStore.video && glStore.video.pieMap) || V.pieMap || {};
    V.extraFes = (glStore.video && glStore.video.extraFes) || V.extraFes || [];

    V.annotations = null;
    if (!passiveLive) {
      maybeFetchAnnotations(myRun);
      maybeLocalizeTargetFeGlosses(myRun);
    }

    SS_STORE.recordEncounters(curVidKey(), V.info.title, V.analysis.allFEs, V.lines, transFor);
    refreshSceneFrequency(V);
    applyVisualPrefs();
    prefetchUpcomingDicts(Math.max(0, V.cur));
    drawHead();
    drawList();
    if (V.cur >= 0) drawLine(V.cur);
  };

  const resolveTargetLang = (want, opts) => {
    if (!want || !opts || !opts.length) return want || '';
    const w = want.toLowerCase();
    const exact = opts.find((o) => o[0] === want) || opts.find((o) => o[0].toLowerCase() === w);
    if (exact) return exact[0];
    const pref = opts.find((o) => sameTranslationLanguage(o[0], want));
    return pref ? pref[0] : want;
  };

  const maybeAutoTranslate = (myRun) => {
    if (myRun !== run || !V || !V.lines.length || V.loadingPublisherPair || S.set.autoAiTranslate === false) return;
    const hasCompMt = !!(companionHealth && companionHealth.plamo);
    const subSvc = (S.set.sceneServices && S.set.sceneServices.subtitle) || 'auto';
    if (!hasCompMt && subSvc === 'auto' && V.tr && V.tr.length) return;   // keep existing translation unless Local AI or explicit scene service is active
    const tl = S.set.tl;
    if (!tl || sameTranslationLanguage(tl, V.yueByText ? 'yue' : V.lang)) return;
    if (V.trProv === 'Human' && !S.set.showDualHumanAi && !S.set.preferAiOverHuman) return;
    const key = tl + '|' + (hasCompMt || subSvc !== 'auto' ? (subSvc !== 'auto' ? `svc:${subSvc}` : (S.set.mtModel || 'plamo-2b')) : 'web-mt');
    if (V._aiTranslatedFor === key || V._aiTranslating === key) return;
    V._aiTranslating = key;
    runPlamoTranslate(true, myRun).finally(() => { if (V) V._aiTranslating = ''; });
  };

  // ---- Load a video (defers background YouTube tabs until focused to keep multi-tab GPU/CPU at 0%) ----
  let deferredVisListener = null;
  const load = async () => {
    restoreHeldSpeed();
    const my = ++run;
    clearRepeatSession();
    asrState.active = false;
    if (deferredVisListener) {
      document.removeEventListener('visibilitychange', deferredVisListener);
      deferredVisListener = null;
    }
    const activeSite = getActiveSite();
    if (!activeSite) { teardown(); return; }
    if (document.visibilityState === 'hidden') {
      deferredVisListener = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', deferredVisListener);
          deferredVisListener = null;
          load();
        }
      };
      document.addEventListener('visibilitychange', deferredVisListener);
      return;
    }
    const want = activeSite.rawVideoId ? activeSite.rawVideoId(location) : '';
    let info = null;
    for (let i = 0; i < 40 && my === run; i++) {
      info = await ask('info', null, 2000);
      if (info && info.videoId && (!want || info.videoId === want || String(info.videoId).startsWith(want))) break;
      info = null;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (my !== run || !info || !ensureUI()) return;

    const DEFAULT_TL_OPTS = [
      ['en', 'English'],
      ['zh-Hant', 'Chinese (Traditional)'],
      ['zh-Hans', 'Chinese (Simplified)'],
      ['yue', 'Cantonese (粵語)'],
      ['ja', 'Japanese'],
      ['ko', 'Korean'],
      ['es', 'Spanish'],
      ['fr', 'French'],
      ['de', 'German'],
      ['pt', 'Portuguese'],
      ['it', 'Italian'],
      ['ru', 'Russian'],
      ['tl', 'Tagalog (Filipino)'],
      ['vi', 'Vietnamese'],
      ['th', 'Thai'],
    ];
    const ytTlOpts = (info.tlangs || []).map((t) => [t.lang, t.name]);
    const rawTlOpts = ytTlOpts.length
      ? ytTlOpts.concat(DEFAULT_TL_OPTS.filter(([code]) => !ytTlOpts.some(([yc]) => yc.toLowerCase() === code.toLowerCase())))
      : DEFAULT_TL_OPTS;
    if (S.set.tl && !rawTlOpts.some(([code]) => code === S.set.tl)) rawTlOpts.push([S.set.tl, S.set.tl]);

    const vKey = normSiteVidKey(info.videoId, activeSite);
    loopIdx = -1;
    loopRange = null;
    pumpState = null;
    watchAcc = { li: -1, acc: 0, lastT: 0 };
    V = {
      site: activeSite,
      videoKey: vKey,
      info, lines: [], tr: null, humanTr: null, aiTr: null, aiTrProv: '', cur: -1, lang: '', L: SS_LANG.get(''),
      tlOpts: rawTlOpts, subOffset: 0,
      msg: 'Loading subtitles…', srcProv: '', trProv: '', analysis: null, drills: null,
      glossaryTerms: [], pieMap: {}, acousticWpm: 0, annotations: null,
      _aiTranslatedFor: '', _aiTranslating: '',
    };
    closeDock();

    const noTracks = !info.tracks || !info.tracks.length;
    const isLive = isLiveContext();
    const healthReady = comp('/health', null, 'GET', 1500).then((hRes) => {
      if (my === run) {
        companionHealth = hRes && hRes.ok ? hRes : null;
        if (noTracks && !isLive && !V.frameWatch && !V.lines.length && !asrState.active && companionHealth && companionHealth.ok && S.set.autoTranscribeMissing !== false && S.set.gpuProfile !== 'zero_gpu') {
          runLocalASR(true);
        } else {
          maybeFetchAnnotations(my);
          maybeAutoTranslate(my);
        }
        drawHead();
        drawList();
      }
    });

    if (isLive || noTracks) {
      if (isLive) {
        V.lang = info.lang || activeSite.defaultLang || S.set.asrLangHint || '';
        V.L = SS_LANG.get(V.lang);
        V.msg = `Live stream ready on ${activeSite.name} — watching CC automatically, or choose Live bilingual captions for audio recognition.`;
        startLiveDomObserver(false);
        applyVisualPrefs();
        drawHead();
        drawList();
        return;
      }
      V.msg = `No ${activeSite.name} text track found — starting Local AI Transcription automatically when Companion is online…`;
      applyVisualPrefs();
      drawHead();
      drawList();
      return;
    }

    const asr = info.tracks.find((t) => t.auto || t.kind === 'asr');
    const baseOf = (l) => (window.SS_IDIOMS && SS_IDIOMS.normLang ? SS_IDIOMS.normLang(l) : String(l || '').toLowerCase().split('-')[0]);
    const titleTxt = (info.title || '') + ' ' + (info.description || '').slice(0, 200);
    const spoken = (info.lang ? baseOf(info.lang) : '')
      || (asr ? baseOf(asr.lang) : '')
      || (/[぀-ヿ]/.test(titleTxt) ? 'ja'
        : /[가-힣]/.test(titleTxt) ? 'ko'
        : /[一-鿿]/.test(info.title || '') ? 'zh'
        : '');
    const isFullHuman = (t) => !t.auto && t.kind !== 'asr' && t.kind !== 'forced';
    const pick = info.tracks.find((t) => sameVidKey(S.set.trackVid, vKey) && trackKey(t) === S.set.trackKey)
      || (spoken && info.tracks.find((t) => isFullHuman(t) && baseOf(t.lang) === spoken))
      || (spoken && info.tracks.find((t) => t.kind !== 'forced' && baseOf(t.lang) === spoken))
      || info.tracks.find((t) => isFullHuman(t) && t.lang === S.set.lang)
      || info.tracks.find((t) => t.kind !== 'forced' && t.lang === S.set.lang)
      || info.tracks.find((t) => isFullHuman(t))
      || info.tracks.find((t) => t.kind !== 'forced')
      || info.tracks[0];

    V.lang = pick.lang;
    V.trackKey = trackKey(pick);
    V.L = SS_LANG.get(pick.lang);
    V.srcProv = (pick.auto || pick.kind === 'asr') ? `${activeSite.id === 'yt' ? 'YT' : activeSite.name} Auto` : 'Human';
    applyVisualPrefs();
    drawHead();
    drawList();

    let lines = await ask('subs', { videoId: info.videoId, trackId: pick.id, track: pick, tlang: '', mergeClauses: S.set.mergeClauses !== false }, 20000);
    if (my !== run) return;
    const adOn = () => !!(activeSite.isAd && activeSite.isAd());
    if (!lines && adOn()) {
      V.msg = 'Waiting for the ad to finish…'; drawList();
      for (let w = 0; w < 1800 && adOn() && my === run; w++) await new Promise((r) => setTimeout(r, 500));
      if (my !== run) return;
      V.msg = ''; await new Promise((r) => setTimeout(r, 800));
      lines = await ask('subs', { videoId: info.videoId, trackId: pick.id, track: pick, tlang: '', mergeClauses: S.set.mergeClauses !== false }, 20000);
      if (my !== run) return;
    }
    const captionRetryAt = !lines?.length && activeSite.id === 'yt' ? await ask('captionRetryAt') : 0;
    if (my !== run) return;
    if (captionRetryAt > Date.now()) {
      V.msg = 'YouTube temporarily limited caption requests. You can transcribe the video audio while publisher captions are unavailable.';
      drawList();
      await healthReady;
      if (my !== run) return;
      if (companionHealth?.ok && S.set.autoTranscribeMissing !== false && S.set.gpuProfile !== 'zero_gpu' && !asrState.active) {
        await runLocalASR(true);
      }
      return;
    }
    if (!lines?.length && activeSite.id === 'yt' && isFullHuman(pick)) {
      V.msg = 'Loading publisher captions…';
      drawList();
      lines = await recoverPublisherTrack(activeSite, info, pick);
    }
    if (my !== run) return;
    if (!lines?.length) {
      V.msg = `Could not fetch subtitles from ${activeSite.name}. Drop a subtitle file on the video (for example, episode.ko.srt), enable native captions and reload, or transcribe the audio above.`;
      drawList();
      return;
    }

    V.loadingPublisherPair = true;
    V.lines = prepareLines(lines);
    await loadTrackSync(V,pick);
    if (my !== run) return;
    void loadCaptionEdits(V);
    V.msg = '';
    const analysisReady = finishLoadAnalysis(my);

    const tl = S.set.tl;
    if (tl && !sameTranslationLanguage(tl, V.yueByText ? 'yue' : pick.lang)) {
      const selected = S.set.translationTrackVideo === vKey && S.set.translationTrackLanguage === tl ? S.set.translationTrack : '';
      const publisherTracks = info.tracks.filter(t => t !== pick && isFullHuman(t) && sameTranslationLanguage(t.lang, tl));
      const human = selected !== 'machine' && (selected || S.set.preferHumanSubs !== false)
        ? publisherTracks.find(t => trackKey(t) === selected) || publisherTracks.find(t => t.lang === tl) || publisherTracks[0]
        : null;
      let tr = null;
      if (human) {
        tr = await ask('subs', { videoId: info.videoId, trackId: human.id, track: human, tlang: '', mergeClauses: S.set.mergeClauses !== false }, 20000);
        if (my !== run) return;
        if (!tr?.length) tr = await recoverPublisherTrack(activeSite, info, human);
        if (my !== run) return;
        if (!tr?.length) tr = null;
        if (tr) { V.humanTr = tr; V.trProv = 'Human'; V.sameTiming = false; }
      }
      const subSvc = (S.set.sceneServices && S.set.sceneServices.subtitle) || 'auto';
      const aiWillRun = S.set.autoAiTranslate !== false && ((companionHealth && companionHealth.plamo) || subSvc === 'free_web' || subSvc === 'browser_api' || subSvc === 'custom_openai');
      const preferCustomAi = S.set.preferCustomYtMt !== false && aiWillRun;
      if (!tr && pick.translatable && !preferCustomAi) {
        tr = await ask('subs', { videoId: info.videoId, trackId: pick.id, track: pick, tlang: resolveTargetLang(tl, ytTlOpts), mergeClauses: S.set.mergeClauses !== false }, 20000);
        if (my !== run) return;
        if (tr) { V.trProv = 'YT MT'; V.sameTiming = tr.length === lines.length; }
      }
      if (my !== run) return;
      if (tr) {
        V.tr = tr;
        drawList();
        if (V.cur >= 0) drawLine(V.cur);
      }
    }
    V.loadingPublisherPair = false;
    V.previewRequests = new WeakSet();
    V.previewTranslations = new WeakMap();
    V.allowPreviewTranslation = !!(tl && !V.tr?.length && S.set.autoAiTranslate !== false && !sameTranslationLanguage(tl, V.yueByText ? 'yue' : V.lang));
    if (V.cur >= 0) drawLine(V.cur);
    await analysisReady;
    if (my !== run) return;
    maybeAutoTranslate(my);
    loadThirdLang(my, info, pick);
  };

  // Third subtitle language: a human track in that language, else YouTube's own translation, else the local translator.
  async function recoverPublisherTrack(site, info, track) {
    if (site?.id !== 'yt' || track.auto || track.kind === 'asr' || track.kind === 'forced') return null;
    if (await ask('captionRetryAt') > Date.now()) return null;
    const result = await comp('/youtube/publisher-captions', {
      video_id: info.videoId, language: track.lang
    }, 'POST', 30000);
    if (!result?.ok || result.language !== track.lang || !result.json3) return null;
    const cues = SS_PARSE.parseJson3(result.json3, {
      isAsr: false, mergeClauses: S.set.mergeClauses !== false
    });
    return cues.length ? cues : null;
  }

  const loadThirdLang = async (my, info, pick) => {
    V.tr2 = null; V.tr2Prov = ''; V.tr2Same = false;
    const tl2 = S.set.tl2;
    if (!tl2) return;
    if (sameTranslationLanguage(tl2, pick.lang) || sameTranslationLanguage(tl2, S.set.tl)) return;
    const human = info.tracks.find((t) => t !== pick && !t.auto && sameTranslationLanguage(t.lang, tl2));
    let tr = null;
    if (human) {
      tr = await ask('subs', { videoId: info.videoId, trackId: human.id, track: human, tlang: '' }, 20000);
      if (tr) { V.tr2Prov = 'Human'; V.tr2Same = false; }
    }
    if (!tr && pick.translatable) {
      tr = await ask('subs', { videoId: info.videoId, trackId: pick.id, track: pick, tlang: resolveTargetLang(tl2, (info.tlangs || []).map(t => [t.lang, t.name])) }, 20000);
      if (tr) { V.tr2Prov = 'YT MT'; V.tr2Same = tr.length === V.lines.length; }
    }
    if (my !== run) return;
    if (tr) { V.tr2 = tr; drawList(); if (V.cur >= 0) drawLine(V.cur); return; }
    if (!(companionHealth && companionHealth.plamo)) return;
    const vid = info.videoId;
    const out = V.lines.map((l) => ({ s: l.s, d: l.d || 0, t: '' }));
    for (let a = 0; a < V.lines.length; a += 60) {
      const slice = V.lines.slice(a, a + 60);
      const gl2 = buildSliceGlossary(a, Math.min(V.lines.length - 1, a + 59), tl2);
      const r = await comp('/translate', {
        lines: slice.map((l) => ({ s: l.s, d: l.d || 0, t: l.t })), target_lang: tl2, glossary: gl2, merge_clauses: S.set.mergeClauses !== false,
        title: (V.info && V.info.title) || '', author: (V.info && V.info.author) || '',
        model: S.set.mtModel || 'plamo-2b', device: S.set.mtDevice || 'gpu', use_history: true,
      }, 'POST', 120000);
      if (my !== run || !V || !V.info || V.info.videoId !== vid) return;
      if (!r || !r.ok || !Array.isArray(r.translations)) { if (r && r.error) toast('Third language: ' + r.error); return; }
      slice.forEach((l, k) => { out[a + k].t = r.translations[k] || ''; });
      V.tr2 = out; V.tr2Same = true; V.tr2Prov = r.model || 'Local AI';
      drawList(); if (V.cur >= 0) drawLine(V.cur);
    }
  };

  // ---- YouTube Search CC filter + Translated Study-Language Search (LR_NOTES §8.8) ----
  const ensureSearchCcBtn = () => {
    const hs = getHostSite();
    if (!hs || !hs.features || !hs.features.search) return;
    const end = document.querySelector('ytd-masthead #end, #center');
    const searchBox = document.querySelector('ytd-searchbox, #search-form');
    if (!searchBox || document.getElementById('ss-cc-search')) return;
    const pillStyle = {
      marginLeft: '6px', padding: '5px 9px', borderRadius: '999px', border: '1px solid rgba(232,131,58,.5)',
      background: 'rgba(232,131,58,.15)', color: '#ff9c54', font: '600 11.5px "Segoe UI",sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
    };
    const getSearchInput = () => document.querySelector('input#search, input[name="search_query"]');
    const wrap = h('span', { id: 'ss-cc-search', style: { display: 'inline-flex', alignItems: 'center' } },
      h('button', {
        title: 'Search YouTube filtered to videos with Subtitles/CC',
        style: pillStyle,
        onclick: (e) => {
          e.preventDefault();
          const inp = getSearchInput();
          const q = (inp && inp.value.trim()) || new URLSearchParams(location.search).get('search_query') || '';
          if (!q) { toast('Type a search term in YouTube first'); return; }
          location.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIoAQ%3D%3D';
        },
      }, 'CC Search'),
      h('button', {
        title: 'Translate your search query into your study language via Local AI and search subtitled videos',
        style: Object.assign({}, pillStyle, { borderColor: 'rgba(45,212,191,.5)', background: 'rgba(45,212,191,.14)', color: '#2dd4bf' }),
        onclick: async (e) => {
          e.preventDefault();
          const inp = getSearchInput();
          const q = (inp && inp.value.trim()) || new URLSearchParams(location.search).get('search_query') || '';
          if (!q) { toast('Type a search term in YouTube first'); return; }
          const studyLang = S.set.asrLangHint && S.set.asrLangHint !== 'mixed' ? S.set.asrLangHint : (S.set.lang || 'ja');
          const r = await comp('/translate_text', { paragraphs: [q], target_lang: studyLang, model: S.set.mtModel || 'plamo-2b', device: S.set.mtDevice || 'gpu' }, 'POST', 12000);
          const trQ = (r && r.ok && Array.isArray(r.translations) && r.translations[0]) ? r.translations[0].trim() : q;
          if (inp && trQ !== q) inp.value = trQ;
          location.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(trQ) + '&sp=EgIoAQ%3D%3D';
        },
      }, 'Study Search'));
    if (searchBox.parentElement) searchBox.parentElement.insertBefore(wrap, searchBox.nextSibling);
    else if (end) end.prepend(wrap);
  };

  // ---- Dev Auto-Reload (watches ../ext changes via Companion :8787 /ext_mtime) ----
  let reloadScheduled = false;
  const reloadAtCurrentTime = () => {
    if (reloadScheduled) return;
    reloadScheduled = true;
    toast('Phrasebound updated — reloading tab at current timestamp…');
    setTimeout(() => {
      try {
        const u = new URL(location.href);
        const v = video();
        if (v && v.currentTime > 3) u.searchParams.set('t', Math.floor(v.currentTime) + 's');
        location.replace(u.toString());
      } catch (e) { location.reload(); }
    }, 750);
  };

  const checkDevHotReload = () => {
    if (reloadScheduled || liveState.active && liveState.mode === 'asr' || S.set.devAutoReload === false || document.visibilityState !== 'visible') return;
    try {
      chrome.runtime.sendMessage({ op: 'checkExtReload', url: S.set.companionUrl }, (r) => {
        if (chrome.runtime.lastError) {
          if (/invalidated/i.test(chrome.runtime.lastError.message || '')) reloadAtCurrentTime();
          return;
        }
        if (r && r.reloading) reloadAtCurrentTime();
      });
    } catch (e) {
      if (/invalidated/i.test(String(e && e.message || e))) reloadAtCurrentTime();
    }
  };

  // ---- Boot ----
  SS_STORE.loadAll().then((loaded) => {
    S = loaded;
    chrome.runtime.sendMessage({ op: 'setCompanionUrl', url: S.set.companionUrl });
    ensureSearchCcBtn();
    load();
    const hostSite = getHostSite() || DEFAULT_YT_SITE;
    if (hostSite && typeof hostSite.onNavigate === 'function') {
      hostSite.onNavigate(() => { ensureSearchCcBtn(); load(); });
    }
    window.addEventListener('focus', checkDevHotReload);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDevHotReload(); });
    setInterval(checkDevHotReload, 5000);
  });

  // Search-Results & Feed Comprehension / Script Badges (YouTube /results & Bilibili search cards)
  const decorateSearchThumbnails = () => {
    if (S && S.set && S.set.searchBadges === false) return;
    const isYtSearch = location.hostname.includes('youtube.com') && (location.pathname === '/results' || location.pathname === '/');
    const isBili = location.hostname.includes('bilibili.com');
    if (!isYtSearch && !isBili) return;
    const cards = document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer, .bili-video-card');
    if (!cards.length) return;
    cards.forEach((card) => {
      if (card.hasAttribute('data-ss-badged')) return;
      const titleEl = card.querySelector('#video-title, .bili-video-card__info--tit');
      const thumbEl = card.querySelector('ytd-thumbnail, .bili-video-card__image--wrap');
      if (!titleEl || !thumbEl) return;
      const titleTxt = (titleEl.textContent || '').trim();
      if (titleTxt.length < 4) return;
      card.setAttribute('data-ss-badged', '1');
      let label = '';
      let cls = 'ss-thumb-badge';
      if (/[係唔嘅咁咗嚟冇睇畀諗點樣乜嘢]/.test(titleTxt)) { label = '粵 YUE'; cls += ' ss-tb-cjk'; }
      else if (/[\u3040-\u30ff]/.test(titleTxt)) { label = '日本語 JA'; cls += ' ss-tb-cjk'; }
      else if (/[\uac00-\ud7af]/.test(titleTxt)) { label = '한국어 KO'; cls += ' ss-tb-cjk'; }
      else if (/[\u3400-\u9fff]/.test(titleTxt)) { label = '中文 ZH'; cls += ' ss-tb-cjk'; }
      else if (/[\u0400-\u04ff]/.test(titleTxt)) { label = 'РУС RU'; cls += ' ss-tb-cjk'; }
      if (!label) return;
      if (getComputedStyle(thumbEl).position === 'static') thumbEl.style.position = 'relative';
      thumbEl.appendChild(h('span', { class: cls, title: 'Language estimated from the video title' }, label));
    });
  };
  setInterval(decorateSearchThumbnails, 2600);
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyO' || (e.key || '').toLowerCase() === 'o')) {
      if (video()) { e.preventDefault(); captureHardsubOcr(); }
    }
  }, true);
  try {
    chrome.runtime.onMessage.addListener((m, _s, send) => {
      if (m && m.op === 'ssTriggerOcr') { captureHardsubOcr(); if (send) send({ ok: true }); }
    });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area && area !== 'local') return;
        if (V?.editStorageKey && changes[V.editStorageKey]) {
          V.captionEdits = changes[V.editStorageKey].newValue || {};
          drawList(); if (V.cur >= 0) drawLine(V.cur);
        }
        if ((changes?.ss_items || changes?.ss_review) && typeof SS_STORE.loadReviews === 'function') {
          SS_STORE.loadReviews().then(({ items }) => {
            S.items = items;
            if (V?.cur >= 0) drawLine(V.cur);
            if ((tab === 'review' || tab === 'recall') && listEl) { drawHead(); drawList(); }
          }).catch(() => {});
        }
        if ((!area || area === 'local') && changes && changes.ss_set && changes.ss_set.newValue) {
          const prev = S.set || {};
          const nv = changes.ss_set.newValue;
          S.set = Object.assign({}, prev, nv);
          S.set.vocabLevelsByLang = Object.assign({}, nv.vocabLevelsByLang || {}, pendingVocabLevels);
          if (nv.companionUrl && nv.companionUrl !== prev.companionUrl) {
            chrome.runtime.sendMessage({ op: 'setCompanionUrl', url: S.set.companionUrl });
          }
          if (nv.cleanStageNoise !== prev.cleanStageNoise && V && V.lines && V.lines.length) {
            V.lines = prepareLines(V.lines);
          }
          applyVisualPrefs();
          if (V && V.cur >= 0) drawLine(V.cur);
          if (nv.uiMode !== prev.uiMode || nv.idiomHistory !== prev.idiomHistory || nv.transAboveOrig !== prev.transAboveOrig || nv.cleanStageNoise !== prev.cleanStageNoise || JSON.stringify(nv.subStyle || null) !== JSON.stringify(prev.subStyle || null)) {
            drawHead();
            drawList();
          }
          if (typeof nv.tl === 'string' && nv.tl !== prev.tl && V) {
            V.tr = V.humanTr = V.aiTr = V.tr2 = null;
            load();
          }
        }
      });
    }
  } catch (_) {}

})();
