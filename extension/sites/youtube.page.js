// YouTube MAIN-world subtitle & player adapter (Watch #movie_player + Shorts #shorts-player).
// Supports player track discovery, rate-limit backoff,
// ASR word-rolling sentence merge, and YouTube tlang machine translation.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssYtPage) return;
  G.__ssYtPage = true;

  const pot = {};
  const seenUrl = {};
  const refreshedOnce = new Set();
  let retryAt = 0;

  const note = (u) => {
    try {
      if (typeof u !== 'string' || !u.includes('/timedtext')) return;
      const q = new URL(u, location.origin).searchParams;
      const v = q.get('v');
      if (!v) return;
      seenUrl[v] = u;
      if (q.get('pot')) pot[v] = q.get('pot');
    } catch (e) {}
  };

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
    const xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      note(String(u));
      return xo.apply(this, arguments);
    };
  }
  const of = G.fetch ? G.fetch.bind(G) : null;
  if (of) {
    G.fetch = function (r) {
      try { note(typeof r === 'string' ? r : r && r.url); } catch (e) {}
      return of.apply(this, arguments);
    };
  }

  const player = () => {
    if (location.pathname.startsWith('/shorts/')) {
      const sp = document.getElementById('shorts-player')
        || document.querySelector('ytd-reel-video-renderer[is-active] .html5-video-player')
        || document.querySelector('#shorts-container .html5-video-player');
      if (sp) return sp;
    }
    return document.getElementById('movie_player');
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const scanPast = () => {
    try {
      for (const e of performance.getEntriesByType('resource')) note(e.name);
    } catch (e) {}
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) note(e.name);
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  const rawPlayerInfo = () => {
    const p = player();
    let pr = null;
    try { pr = p && p.getPlayerResponse && p.getPlayerResponse(); } catch (e) {}
    if (!pr) return null;
    const list = (pr.captions && pr.captions.playerCaptionsTracklistRenderer) || {};
    const name = (n) => (n && (n.simpleText || (n.runs || []).map((x) => x.text).join(''))) || '';
    const vd = pr.videoDetails || {};
    const rawTracks = (list.captionTracks || []).map((t, idx) => {
      const isAsr = t.kind === 'asr';
      const label = name(t.name);
      return {
        id: t.vssId || `${t.languageCode}:${isAsr ? 'asr' : 'human'}:${idx}`,
        lang: t.languageCode,
        label,
        name: label,
        kind: isAsr ? 'asr' : (/sdh|cc/i.test(label) ? 'sdh' : 'human'),
        auto: isAsr,
        vss: t.vssId,
        url: t.baseUrl,
        baseUrl: t.baseUrl,
        translatable: !!t.isTranslatable,
      };
    });
    const asrTrack = rawTracks.find((t) => t.auto);
    const audioLang = (asrTrack && asrTrack.lang) || '';
    return {
      site: 'yt',
      videoId: vd.videoId || '',
      title: vd.title || '',
      durationSec: Number(vd.lengthSeconds || 0),
      isLive: !!(vd.isLive || vd.isLiveContent || (p && p.classList && p.classList.contains('ytp-live'))),
      lang: audioLang,
      channelId: vd.channelId || '',
      author: vd.author || '',
      description: (vd.shortDescription || '').slice(0, 1200),
      tracks: rawTracks,
      tlangs: (list.translationLanguages || []).map((t) => ({ lang: t.languageCode, name: name(t.languageName) })),
    };
  };

  const wake = async (vid, lang, forceRefresh = false) => {
    if (forceRefresh) {
      delete pot[vid];
      delete seenUrl[vid];
    } else {
      if (!seenUrl[vid]) scanPast();
      if (pot[vid] || seenUrl[vid]) return;
    }
    const p = player();
    if (!p) return;
    try {
      p.loadModule?.('captions');
      if (p.isSubtitlesOn && !p.isSubtitlesOn()) p.toggleSubtitlesOn?.();
      p.setOption?.('captions', 'track', { languageCode: lang });
    } catch (e) {}
    const maxLoops = forceRefresh ? 12 : 40;
    for (let i = 0; i < maxLoops && !seenUrl[vid]; i++) {
      await sleep(250);
      if (i % 4 === 3) scanPast();
    }
  };

  const parseTimedText = (txt, isAsr, mergeClauses = true) => {
    if (G.SS_PARSE && G.SS_PARSE.parseJson3) {
      const cues = G.SS_PARSE.parseJson3(txt, { isAsr, keepConf: true, mergeClauses });
      return cues.map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
    }
    const j = JSON.parse(txt);
    const out = [];
    for (const ev of j.events || []) {
      if (!ev.segs) continue;
      const t = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const s = (ev.tStartMs || 0) / 1000;
      const d = (ev.dDurationMs || 2500) / 1000;
      out.push({ t, s, e: Math.round((s + d) * 1000) / 1000, d });
    }
    return out;
  };

  const tryFetchUrls = async (vid, track, tlang, mergeClauses = true) => {
    if (!of || !track || !(track.baseUrl || track.url)) return { lines: null, saw429: false };
    const base = new URL(track.baseUrl || track.url, location.origin);
    const tries = [];
    if (seenUrl[vid]) {
      const a = new URL(seenUrl[vid], location.origin);
      for (const k of ['lang', 'kind', 'name']) {
        a.searchParams.delete(k);
        if (base.searchParams.get(k) != null) a.searchParams.set(k, base.searchParams.get(k));
      }
      tries.push(a);
    }
    if (pot[vid]) {
      const a = new URL(base);
      a.searchParams.set('c', 'WEB');
      a.searchParams.set('pot', pot[vid]);
      tries.push(a);
    }
    tries.push(base);

    const requested = new Set();
    for (const x of tries) {
      x.searchParams.delete('tlang');
      x.searchParams.delete('fmt');
      x.searchParams.set('fmt', 'json3');
      if (tlang) x.searchParams.set('tlang', tlang);
      try {
        if (Date.now() < retryAt) return { lines: null, saw429: true };
        if (requested.has(x.href)) continue;
        requested.add(x.href);
        const r = await of(x.href, { credentials: 'include' });
        if (r.status === 429) {
          const header = r.headers.get('Retry-After')?.trim();
          const until = header && /^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : Date.parse(header);
          retryAt = Math.max(retryAt, Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60000);
          return { lines: null, saw429: true };
        }
        if (!r.ok) continue;
        const txt = await r.text();
        if (!txt) continue;
        const lines = parseTimedText(txt, !!(track.auto || track.kind === 'asr') && !tlang, mergeClauses);
        if (lines.length) return { lines, saw429: false };
      } catch (e) {}
    }
    return { lines: null, saw429: false };
  };

  const getSubs = async (vid, track, tlang, mergeClauses = true) => {
    let first = await tryFetchUrls(vid, track, tlang, mergeClauses);
    if (first.lines || first.saw429) return first.lines;
    if (vid && !refreshedOnce.has(vid)) {
      refreshedOnce.add(vid);
      await sleep(1000);
      await wake(vid, track.lang, true);
      first = await tryFetchUrls(vid, track, tlang, mergeClauses);
    }
    return first.lines;
  };

  const handlers = {
    info: () => rawPlayerInfo(),
    captionRetryAt: () => Date.now() < retryAt ? retryAt : 0,
    tracks: () => {
      const inf = rawPlayerInfo();
      return (inf && inf.tracks) || [];
    },
    subs: async (m) => {
      const inf = rawPlayerInfo();
      const vid = m.videoId || (inf && inf.videoId) || '';
      let trk = m.track || null;
      if (!trk && m.trackId && inf && inf.tracks) {
        trk = inf.tracks.find((t) => t.id === m.trackId || t.vss === m.trackId || t.lang === m.trackId) || null;
      }
      if (!trk || (inf?.videoId && inf.videoId !== vid)) return null;
      // Read this player's exact native track when the browser exposes loaded cues.
      if (!m.tlang && inf?.videoId === vid && trk.vss) {
        const video = player()?.querySelector('video');
        const native = Array.from(video?.textTracks || []).find(t =>
          t.id === trk.vss && t.language === trk.lang && ['captions','subtitles'].includes(t.kind));
        const cues = Array.from(native?.cues || []).filter(c => Number.isFinite(c.startTime) &&
          Number.isFinite(c.endTime) && c.endTime > c.startTime && c.text?.trim());
        if (cues.length) return cues.map(c => ({
          s:c.startTime, e:c.endTime, d:c.endTime-c.startTime, t:c.getCueAsHTML?.().textContent || c.text
        }));
      }
      if (Date.now() < retryAt) return null;
      await wake(vid, trk.lang, false);
      return await getSubs(vid, trk, m.tlang || '', m.mergeClauses !== false);
    },
    nativeOff: () => {
      try { const p = player(); if (p && p.unloadModule) p.unloadModule('captions'); } catch (e) {}
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-yt', '.ytp-caption-window-container', true);
      return true;
    },
    nativeOn: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-yt', '.ytp-caption-window-container', false);
      try { const p = player(); if (p && p.loadModule) p.loadModule('captions'); } catch (e) {}
      return true;
    },
    seek: (m) => {
      const sec = Math.max(0, Number(m.sec || 0));
      try {
        const p = player();
        if (p && typeof p.seekTo === 'function') {
          p.seekTo(sec, true);
          return true;
        }
      } catch (e) {}
      const v = document.querySelector('#movie_player video, #shorts-player video, video');
      if (v) { v.currentTime = sec + 0.01; return true; }
      return false;
    },
  };

  if (G.SS_SITES && G.SS_SITES.servePage) {
    G.SS_SITES.servePage('yt', handlers);
  } else {
    G.addEventListener('message', async (e) => {
      const m = e && e.data;
      if (e.source !== G || !m || m.ss !== 'req') return;
      const reply = (data) => G.postMessage({ ss: 'res', id: m.id, data }, location.origin);
      try {
        const fn = handlers[m.op];
        reply(fn ? await fn(m) : null);
      } catch (err) {
        reply(null);
      }
    });
  }
})();
