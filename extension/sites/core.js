// Shared multi-site registry & MAIN <-> ISOLATED postMessage protocol (ss:'req' / ss:'res').
// Works in both content world (site registration, active site lookup, ask(), fullscreen mount)
// and MAIN page world (servePage() responder + style-based native caption hider).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.SS_SITES) return;

  const profiles = [];
  const ID_ALIASES = {
    youtube: 'yt',
    yt: 'yt',
    bilibili: 'bili',
    bili: 'bili',
    netflix: 'nf',
    nf: 'nf',
    prime: 'pv',
    primevideo: 'pv',
    pv: 'pv',
    disney: 'dp',
    disneyplus: 'dp',
    dp: 'dp',
    appletv: 'atv',
    atv: 'atv',
    twitch: 'tw',
    tw: 'tw',
    bili_live: 'blive',
    blive: 'blive',
    chzzk: 'cz',
    cz: 'cz',
    soop: 'soop',
    afreeca: 'soop',
    kick: 'kk',
    kk: 'kk',
    facebook: 'fb',
    fb: 'fb',
    tiktok: 'tt',
    tt: 'tt',
    generic: 'gen',
    gen: 'gen',
  };

  let seq = 0;
  const waits = new Map();
  let bridgeBound = false;

  const hostOf = (loc) => {
    const l = loc || G.location || {};
    if (l.hostname) return String(l.hostname);
    const src = String(l.origin || l.href || '');
    const m = src.match(/^https?:\/\/([^/:?#]+)/i);
    return m ? m[1] : '';
  };

  const ensureContentBridge = () => {
    if (bridgeBound || typeof G.addEventListener !== 'function') return;
    bridgeBound = true;
    G.addEventListener('message', (e) => {
      const m = e && e.data;
      if (!m || m.ss !== 'res') return;
      if (typeof window !== 'undefined' && e.source && e.source !== window) return;
      const w = waits.get(m.id);
      if (w) {
        waits.delete(m.id);
        w(m.data);
      }
    });
  };

  // Send request from content script -> MAIN-world *.page.js
  const ask = (op, extra = null, ms = 12000) => {
    ensureContentBridge();
    return new Promise((res) => {
      const id = ++seq;
      waits.set(id, res);
      const origin = (G.location && G.location.origin && G.location.origin !== 'null') ? G.location.origin : '*';
      G.postMessage(Object.assign({ ss: 'req', id, op }, extra || {}), origin);
      setTimeout(() => {
        if (waits.has(id)) {
          waits.delete(id);
          res(null);
        }
      }, ms);
    });
  };

  // Register a MAIN-world *.page.js responder for op: info | tracks | subs | nativeOff | nativeOn | seek
  const servePage = (siteId, handlers) => {
    if (G.__ssPageServed === siteId) return;
    G.__ssPageServed = siteId;
    if (typeof G.addEventListener !== 'function') return;
    G.addEventListener('message', async (e) => {
      const m = e && e.data;
      if (!m || m.ss !== 'req') return;
      if (typeof window !== 'undefined' && e.source && e.source !== window) return;
      const origin = (G.location && G.location.origin && G.location.origin !== 'null') ? G.location.origin : '*';
      const reply = (data) => G.postMessage({ ss: 'res', id: m.id, site: siteId, data }, origin);
      try {
        const fn = handlers && handlers[m.op];
        if (typeof fn === 'function') {
          const out = await fn(m);
          reply(out === undefined ? null : out);
        } else {
          reply(null);
        }
      } catch (err) {
        reply(null);
      }
    });
  };

  // Hide or restore a site's native caption DOM container cleanly via a dedicated <style> tag + inline display toggle
  const setNativeCaptionHidden = (doc, styleId, selector, hide) => {
    if (!doc) return false;
    try {
      let st = doc.getElementById ? doc.getElementById(styleId) : null;
      if (hide) {
        if (!st && doc.createElement && (doc.head || doc.documentElement || doc.body)) {
          st = doc.createElement('style');
          st.id = styleId;
          st.textContent = `${selector} { display: none !important; visibility: hidden !important; opacity: 0 !important; }`;
          (doc.head || doc.documentElement || doc.body).append(st);
        }
      } else if (st && st.remove) {
        st.remove();
      }
      const nodes = doc.querySelectorAll ? doc.querySelectorAll(selector) : [];
      for (const n of nodes) {
        if (n && n.style) n.style.display = hide ? 'none' : '';
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  // Pick the active main feature <video>, ignoring small preview/trailer/ad videos
  const pickMainVideo = (doc, rootSelectors = [], ignoreSelectors = []) => {
    if (!doc || !doc.querySelectorAll) return null;
    const isIgnored = (el) => {
      for (const sel of ignoreSelectors) {
        if (el.closest && el.closest(sel)) return true;
      }
      return false;
    };
    let candidates = [];
    for (const sel of rootSelectors) {
      const found = doc.querySelectorAll(sel);
      for (const v of found) {
        if (v && String(v.tagName || '').toUpperCase() === 'VIDEO' && !isIgnored(v)) candidates.push(v);
      }
      if (candidates.length) break;
    }
    if (!candidates.length) {
      for (const v of doc.querySelectorAll('video')) {
        if (!isIgnored(v)) candidates.push(v);
      }
    }
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const areaOf = (v) => {
      const r = v.getBoundingClientRect ? v.getBoundingClientRect() : null;
      const w = (r && r.width) || v.videoWidth || v.clientWidth || 0;
      const h = (r && r.height) || v.videoHeight || v.clientHeight || 0;
      return w * h;
    };
    candidates.sort((a, b) => {
      const aActive = (!a.paused || a.readyState >= 2) ? 1 : 0;
      const bActive = (!b.paused || b.readyState >= 2) ? 1 : 0;
      return (bActive - aActive) || (areaOf(b) - areaOf(a));
    });
    return candidates[0];
  };

  // Generic SPA URL/history watcher for sites that pushState/replaceState across episodes
  const watchUrlChanges = (win, doc, cb) => {
    let lastHref = (win.location && win.location.href) || '';
    const check = () => {
      const cur = (win.location && win.location.href) || '';
      if (cur !== lastHref) {
        lastHref = cur;
        cb(cur);
      }
    };
    const onPop = () => check();
    if (win.addEventListener) win.addEventListener('popstate', onPop);
    const timer = win.setInterval ? win.setInterval(check, 600) : null;
    return () => {
      if (win.removeEventListener) win.removeEventListener('popstate', onPop);
      if (timer && win.clearInterval) win.clearInterval(timer);
    };
  };

  // Prefix storage keys by site ('yt:<id>', 'nf:<id>', 'bili:<id>', 'pv:<id>', 'dp:<id>', 'atv:<id>', 'gen:<id>')
  const namespaceKey = (siteId, rawVideoId) => {
    const v = String(rawVideoId || '').trim();
    if (!v) return '';
    if (/^(yt|nf|pv|dp|bili|atv|gen|tw|blive|cz|soop|kk|fb|tt):/.test(v)) return v;
    const canon = ID_ALIASES[String(siteId || 'yt').toLowerCase()] || siteId || 'yt';
    return `${canon}:${v}`;
  };

  const resolveVideoUrl = (videoKeyOrId, tSec = 0) => {
    const raw = String(videoKeyOrId || '').trim();
    if (!raw) return '';
    const sec = Math.floor(Math.max(0, Number(tSec || 0)));
    const m = raw.match(/^(yt|nf|pv|dp|bili|atv|gen|tw|blive|cz|soop|kk|fb|tt):(.+)$/);
    const pfx = m ? m[1] : 'yt';
    const id = m ? m[2] : raw;
    const prof = byId(pfx);
    if (prof && typeof prof.videoUrl === 'function') return prof.videoUrl(id, sec);
    if (pfx === 'nf') return `https://www.netflix.com/watch/${encodeURIComponent(id)}?t=${sec}`;
    if (pfx === 'bili') {
      const base = /^(?:ep|ss)\d+/i.test(id)
        ? `https://www.bilibili.com/bangumi/play/${id}`
        : `https://www.bilibili.com/video/${id.split('_')[0]}`;
      const part = id.match(/_p([1-9]\d*)(?:_|$)/);
      return `${base}?${part ? 'p=' + part[1] + '&' : ''}t=${sec}`;
    }
    if (pfx === 'pv') return `https://www.primevideo.com/detail/${encodeURIComponent(id)}?t=${sec}`;
    if (pfx === 'dp') return `https://www.disneyplus.com/play/${encodeURIComponent(id)}?t=${sec}`;
    if (pfx === 'atv') return `https://tv.apple.com/watch/${encodeURIComponent(id)}?t=${sec}`;
    if (pfx === 'tw') return `https://www.twitch.tv/${encodeURIComponent(id)}`;
    if (pfx === 'blive') return `https://live.bilibili.com/${encodeURIComponent(id)}`;
    if (pfx === 'cz') return `https://chzzk.naver.com/live/${encodeURIComponent(id)}`;
    if (pfx === 'soop') return `https://play.sooplive.co.kr/${encodeURIComponent(id)}`;
    if (pfx === 'kk') return `https://kick.com/${encodeURIComponent(id)}`;
    if (pfx === 'fb') return `https://www.facebook.com/${id}`;
    if (pfx === 'tt') return `https://www.tiktok.com/${id}`;
    if (pfx === 'gen') return `#t=${sec}`;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${sec}s`;
  };

  const register = (profile) => {
    if (!profile || !profile.id) return profile;
    const canonId = ID_ALIASES[String(profile.id).toLowerCase()] || profile.id;
    const existingIdx = profiles.findIndex((p) => p.id === canonId);
    const normalized = Object.assign({
      features: { search: false, shorts: false, recommendations: false, stageLayout: false, ytMt: false },
      isAd: () => false,
      seek: (sec) => {
        const v = normalized.video();
        if (v) v.currentTime = Math.max(0, sec) + 0.01;
      },
      nativeOff: () => ask('nativeOff'),
      nativeOn: () => ask('nativeOn'),
    }, profile, { id: canonId });
    if (existingIdx >= 0) profiles[existingIdx] = normalized;
    else profiles.push(normalized);
    return normalized;
  };

  const current = (loc) => {
    const l = loc || G.location;
    if (!l) return null;
    for (const p of profiles) {
      try {
        if (p.match(l)) return p;
      } catch (e) {}
    }
    return null;
  };

  const byHost = (loc) => {
    const l = loc || G.location;
    if (!l) return null;
    for (const p of profiles) {
      try {
        if (p.isHost && p.isHost(l)) return p;
      } catch (e) {}
    }
    return null;
  };

  const byId = (id) => {
    const canon = ID_ALIASES[String(id || '').toLowerCase()] || id;
    return profiles.find((p) => p.id === canon) || null;
  };

  const api = {
    register,
    current,
    byHost,
    byId,
    hostOf,
    list: () => profiles.slice(),
    ask,
    servePage,
    setNativeCaptionHidden,
    pickMainVideo,
    watchUrlChanges,
    namespaceKey,
    resolveVideoUrl,
  };

  G.SS_SITES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
