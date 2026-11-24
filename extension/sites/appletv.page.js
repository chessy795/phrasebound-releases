// Apple TV+ MAIN-world HLS subtitle rendition & MusicKit player adapter (tv.apple.com).
// Captures HLS master playlists (#EXT-X-MEDIA:TYPE=SUBTITLES across ~40 human languages),
// stitches segmented WebVTT via SS_PARSE.parseHlsVttSegments, and seeks cleanly via MusicKit.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssAppleTvPage) return;
  G.__ssAppleTvPage = true;

  let latestMaster = null;
  const subCuesCache = new Map();

  const parseM3u8Attrs = (attrLine) => {
    const out = {};
    const re = /([A-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/gi;
    let m;
    while ((m = re.exec(attrLine))) {
      out[m[1].toUpperCase()] = m[2] != null ? m[2] : (m[3] || '');
    }
    return out;
  };

  const normAtvLang = (code) => {
    const low = String(code || '').trim().toLowerCase().replace(/_/g, '-');
    if (!low) return '';
    if (low === 'yue' || low === 'zh-hk' || low === 'cmn-hk') return 'yue';
    if (low === 'zh-hant' || low === 'zh-tw' || low === 'cmn-hant') return 'zh-Hant';
    if (low === 'zh-hans' || low === 'zh-cn' || low === 'cmn-hans') return 'zh-Hans';
    if (low.startsWith('fil')) return 'tl';
    return low.split('-')[0];
  };

  const extractAtvId = () => {
    const p = String((G.location && G.location.pathname) || '');
    const umc = p.match(/(umc\.cmc\.[A-Za-z0-9]+)/);
    if (umc) return umc[1];
    const m = p.match(/\/(?:watch|movie|episode|show)\/([A-Za-z0-9._-]{4,})/);
    return m ? m[1] : 'atv_active';
  };

  const parseMasterM3u8 = (txt, masterUrl) => {
    const body = String(txt || '');
    if (!body.includes('#EXT-X-MEDIA')) return null;
    const subByKey = new Map();
    let audioLang = '';
    for (const raw of body.split(/\r?\n/)) {
      const ln = raw.trim();
      if (!ln.startsWith('#EXT-X-MEDIA:')) continue;
      const attrs = parseM3u8Attrs(ln.slice('#EXT-X-MEDIA:'.length));
      const type = (attrs.TYPE || '').toUpperCase();
      if (type === 'AUDIO') {
        const al = normAtvLang(attrs.LANGUAGE);
        if (al && (!audioLang || attrs.DEFAULT === 'YES')) audioLang = al;
        continue;
      }
      if (type !== 'SUBTITLES' || !attrs.URI) continue;
      const rawLang = attrs.LANGUAGE || 'en';
      const lang = normAtvLang(rawLang);
      const name = attrs.NAME || rawLang;
      const isForced = attrs.FORCED === 'YES' || /forced/i.test(name);
      const isSdh = !isForced && (String(attrs.CHARACTERISTICS || '').includes('transcribes-spoken-dialog') || /sdh|\[cc\]/i.test(name));
      const kind = isForced ? 'forced' : (isSdh ? 'sdh' : 'human');
      let uri = attrs.URI;
      try { uri = new URL(attrs.URI, masterUrl || G.location.href).toString(); } catch (e) {}
      const key = `${rawLang.toLowerCase()}|${kind}`;
      if (subByKey.has(key)) continue;
      subByKey.set(key, {
        id: `${rawLang}:${kind}:${subByKey.size}`,
        lang,
        rawLang,
        label: name,
        name,
        kind,
        auto: false,
        url: uri,
        baseUrl: uri,
        translatable: false,
      });
    }
    const tracks = [...subByKey.values()].filter((t) => t.kind !== 'forced');
    if (!tracks.length) return null;
    latestMaster = { contentId: extractAtvId(), masterUrl, audioLang, tracks };
    return latestMaster;
  };

  const of = G.fetch ? G.fetch.bind(G) : null;
  if (of) {
    G.fetch = async function (input, init) {
      const resp = await of(input, init);
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\.m3u8(?:\?|$)/i.test(u)) {
          resp.clone().text().then((t) => {
            if (t && t.includes('#EXT-X-MEDIA')) parseMasterM3u8(t, u);
          }).catch(() => {});
        }
      } catch (e) {}
      return resp;
    };
  }

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
    const xo = XMLHttpRequest.prototype.open;
    const xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__ssAtvUrl = String(u || '');
      return xo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const u = this.__ssAtvUrl || '';
      if (/\.m3u8(?:\?|$)/i.test(u)) {
        this.addEventListener('load', () => {
          try {
            if (typeof this.responseText === 'string' && this.responseText.includes('#EXT-X-MEDIA')) {
              parseMasterM3u8(this.responseText, u);
            }
          } catch (e) {}
        });
      }
      return xs.apply(this, arguments);
    };
  }

  const fetchAtvSubs = async (playlistUrl) => {
    if (subCuesCache.has(playlistUrl)) return subCuesCache.get(playlistUrl);
    if (!of || !G.SS_PARSE) return null;
    const r = await of(playlistUrl, { credentials: 'omit' });
    if (!r.ok) return null;
    const body = await r.text();
    if (!body) return null;
    if (/^WEBVTT\b/i.test(body.trim())) {
      const cues = G.SS_PARSE.parseVtt(body).map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
      subCuesCache.set(playlistUrl, cues);
      return cues;
    }
    const segUrls = [];
    for (const raw of body.split(/\r?\n/)) {
      const ln = raw.trim();
      if (!ln || ln.startsWith('#')) continue;
      try { segUrls.push(new URL(ln, playlistUrl).toString()); } catch (e) { segUrls.push(ln); }
    }
    if (!segUrls.length) return null;
    const segTexts = new Array(segUrls.length).fill('');
    let cursor = 0;
    const worker = async () => {
      while (cursor < segUrls.length) {
        const idx = cursor++;
        try {
          const sr = await of(segUrls[idx], { credentials: 'omit' });
          if (sr.ok) segTexts[idx] = await sr.text();
        } catch (e) {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, segUrls.length) }, worker));
    const merged = G.SS_PARSE.parseHlsVttSegments(segTexts.filter(Boolean));
    const cues = merged.map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
    if (cues.length) subCuesCache.set(playlistUrl, cues);
    return cues;
  };

  const NATIVE_SEL = '.apple-tv-plus-subtitles, amp-subtitles, .vjs-text-track-display, [class*="subtitles-container"]';

  const getInfo = () => {
    const rec = latestMaster;
    const vEl = typeof document !== 'undefined' && document.querySelector ? document.querySelector('dialog[open] video, amp-video-player video, video') : null;
    return {
      site: 'atv',
      videoId: (rec && rec.contentId) || extractAtvId(),
      title: ((typeof document !== 'undefined' && document.title) || 'Apple TV+').replace(/\s*[|-]\s*Apple TV\+.*$/i, '').trim(),
      durationSec: vEl && Number.isFinite(vEl.duration) ? Math.round(vEl.duration) : 0,
      lang: (rec && rec.audioLang) || '',
      tracks: (rec && rec.tracks) || [],
      tlangs: [],
    };
  };

  if (G.SS_SITES && G.SS_SITES.servePage) {
    G.SS_SITES.servePage('atv', {
      info: () => getInfo(),
      tracks: () => (getInfo().tracks) || [],
      subs: async (m) => {
        const tracks = getInfo().tracks || [];
        let trk = m.track || null;
        if (!trk && m.trackId) trk = tracks.find((t) => t.id === m.trackId || t.lang === m.trackId) || null;
        const u = trk && (trk.url || trk.baseUrl);
        return u ? await fetchAtvSubs(u) : null;
      },
      nativeOff: () => G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-atv', NATIVE_SEL, true),
      nativeOn: () => G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-atv', NATIVE_SEL, false),
      seek: (m) => {
        const targetSec = Math.max(0, Number(m.sec || 0));
        try {
          const mk = G.MusicKit && typeof G.MusicKit.getInstance === 'function' ? G.MusicKit.getInstance() : null;
          if (mk && typeof mk.seekToTime === 'function') {
            mk.seekToTime(targetSec);
            return true;
          }
        } catch (e) {}
        const v = typeof document !== 'undefined' && document.querySelector ? document.querySelector('dialog[open] video, amp-video-player video, video') : null;
        if (v) { v.currentTime = targetSec + 0.01; return true; }
        return false;
      },
    });
  }
})();
