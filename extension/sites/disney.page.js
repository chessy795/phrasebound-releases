// Disney+ MAIN-world subtitle & player adapter (www.disneyplus.com/*/play/* and /video/*).
// Hooks fetch/XHR for HLS master playlists (.m3u8), extracts #EXT-X-MEDIA:TYPE=SUBTITLES and TYPE=AUDIO,
// fetches segmented WebVTT playlists in bounded parallel batches, and merges/dedupes via SS_PARSE.parseHlsVttSegments.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssDisneyPage) return;
  G.__ssDisneyPage = true;

  const playlistsByContentId = new Map();
  let latestMaster = null;
  const subCuesCache = new Map(); // mediaPlaylistUrl -> [{ t, s, e, d }]

  const parseM3u8Attrs = (attrLine) => {
    const out = {};
    const re = /([A-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/gi;
    let m;
    while ((m = re.exec(attrLine))) {
      out[m[1].toUpperCase()] = m[2] != null ? m[2] : (m[3] || '');
    }
    return out;
  };

  const normDpLang = (code) => {
    const raw = String(code || '').trim();
    if (!raw) return '';
    const low = raw.toLowerCase().replace(/_/g, '-');
    if (low === 'yue' || low === 'zh-hk' || low === 'cmn-hk') return 'yue';
    if (low === 'zh-hant' || low === 'zh-tw' || low === 'cmn-hant' || low === 'cmn-tw') return 'zh-Hant';
    if (low === 'zh-hans' || low === 'zh-cn' || low === 'cmn-hans' || low === 'cmn-cn') return 'zh-Hans';
    if (low.startsWith('fil')) return 'tl';
    return low.split('-')[0];
  };

  const currentContentId = () => {
    const p = String(location.pathname || '');
    const m = p.match(/\/(?:play|video)\/([A-Za-z0-9-]{6,})/);
    return m ? m[1] : '';
  };

  const parseMasterM3u8 = (m3u8Text, masterUrl) => {
    const txt = String(m3u8Text || '');
    if (!txt.includes('#EXT-X-MEDIA')) return null;

    const lines = txt.split(/\r?\n/);
    const subByKey = new Map();
    let audioLang = '';

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln.startsWith('#EXT-X-MEDIA:')) continue;
      const attrs = parseM3u8Attrs(ln.slice('#EXT-X-MEDIA:'.length));
      const type = (attrs.TYPE || '').toUpperCase();

      if (type === 'AUDIO') {
        const aLang = normDpLang(attrs.LANGUAGE || attrs['ASSOC-LANGUAGE']);
        const isOrig = /original/i.test(attrs.NAME || '') || attrs.DEFAULT === 'YES';
        if (aLang && (isOrig || !audioLang)) audioLang = aLang;
        continue;
      }

      if (type !== 'SUBTITLES' || !attrs.URI) continue;
      const rawLang = attrs.LANGUAGE || 'en';
      const lang = normDpLang(rawLang);
      const name = attrs.NAME || rawLang;
      const isForced = attrs.FORCED === 'YES' || /forced/i.test(name);
      const chars = attrs.CHARACTERISTICS || '';
      const isSdh = !isForced && (chars.includes('transcribes-spoken-dialog') || chars.includes('describes-music-and-sound') || /\[cc\]|\bsdh\b/i.test(name));
      const kind = isForced ? 'forced' : (isSdh ? 'sdh' : 'human');

      let resolvedUri = attrs.URI;
      try { resolvedUri = new URL(attrs.URI, masterUrl || location.href).toString(); } catch (e) {}

      const dedupeKey = `${rawLang.toLowerCase()}|${kind}|${name.toLowerCase()}`;
      if (subByKey.has(dedupeKey)) continue;

      const label = name + (isForced && !/forced/i.test(name) ? ' (Forced)' : '');
      subByKey.set(dedupeKey, {
        id: `${rawLang}:${kind}:${subByKey.size}`,
        lang,
        rawLang,
        label,
        name: label,
        kind,
        auto: false,
        url: resolvedUri,
        baseUrl: resolvedUri,
        translatable: false,
      });
    }

    const tracks = [...subByKey.values()].sort((a, b) => (a.kind === 'forced' ? 1 : 0) - (b.kind === 'forced' ? 1 : 0));
    if (!tracks.length) return null;

    const cid = currentContentId();
    const rec = { contentId: cid, masterUrl, audioLang, tracks };
    latestMaster = rec;
    if (cid) playlistsByContentId.set(cid, rec);
    return rec;
  };

  const parseMediaSegmentUrls = (mediaM3u8Text, playlistUrl) => {
    const lines = String(mediaM3u8Text || '').split(/\r?\n/);
    const segUrls = [];
    for (const raw of lines) {
      const ln = raw.trim();
      if (!ln || ln.startsWith('#')) continue;
      try {
        segUrls.push(new URL(ln, playlistUrl).toString());
      } catch (e) {
        segUrls.push(ln);
      }
    }
    return segUrls;
  };

  const of = G.fetch ? G.fetch.bind(G) : null;
  if (of) {
    G.fetch = async function (input, init) {
      const resp = await of(input, init);
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\.m3u8(?:\?|$)/i.test(u)) {
          resp.clone().text().then((txt) => {
            if (txt && txt.includes('#EXT-X-MEDIA')) parseMasterM3u8(txt, u);
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
      this.__ssDpUrl = String(u || '');
      return xo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const u = this.__ssDpUrl || '';
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

  const readTitle = () => {
    const t = document.querySelector('.title-field, [data-testid="browser-page-title"], .btm-media-overlays-container .title-field');
    const sub = document.querySelector('.subtitle-field');
    const parts = [t && t.textContent && t.textContent.trim(), sub && sub.textContent && sub.textContent.trim()].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return (document.title || 'Disney+').replace(/\s*\|\s*Disney\+.*$/i, '').trim();
  };

  const findVideoDeep = (root = document) => {
    if (!root || !root.querySelectorAll) return null;
    const direct = root.querySelector('.btm-media-player video, #hudson-wrapper video, dss-hls-player video, video');
    if (direct) return direct;
    for (const el of root.querySelectorAll('*')) {
      if (el && el.shadowRoot) {
        const hit = findVideoDeep(el.shadowRoot);
        if (hit) return hit;
      }
    }
    return null;
  };

  const getInfo = () => {
    const cid = currentContentId();
    const rec = (cid && playlistsByContentId.get(cid)) || latestMaster;
    if (!cid && (!rec || !rec.tracks.length)) return null;
    const vEl = findVideoDeep(document);
    return {
      site: 'dp',
      videoId: cid || (rec && rec.contentId) || 'dp_active',
      title: readTitle(),
      durationSec: vEl && Number.isFinite(vEl.duration) ? Math.round(vEl.duration) : 0,
      lang: (rec && rec.audioLang) || '',
      tracks: (rec && rec.tracks) || [],
      tlangs: [],
    };
  };

  const fetchSegmentedTrack = async (playlistUrl) => {
    if (subCuesCache.has(playlistUrl)) return subCuesCache.get(playlistUrl);
    if (!of || !G.SS_PARSE) return null;

    const r = await of(playlistUrl, { credentials: 'omit' });
    if (!r.ok) return null;
    const body = await r.text();
    if (!body) return null;

    // Single monolithic VTT file case
    if (/^WEBVTT\b/i.test(body.trim())) {
      const cues = G.SS_PARSE.parseVtt(body).map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
      subCuesCache.set(playlistUrl, cues);
      return cues;
    }

    const segUrls = parseMediaSegmentUrls(body, playlistUrl);
    if (!segUrls.length) return null;

    const segTexts = new Array(segUrls.length).fill('');
    const CONCURRENCY = 8;
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
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segUrls.length) }, worker));

    const merged = G.SS_PARSE.parseHlsVttSegments(segTexts.filter(Boolean));
    const cues = merged.map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
    if (cues.length) subCuesCache.set(playlistUrl, cues);
    return cues;
  };

  const NATIVE_SEL = '.dss-hls-subtitle-overlay, .dss-subtitle-renderer-cue, .hive-subtitle-renderer, .shaka-text-container';

  const handlers = {
    info: () => getInfo(),
    tracks: () => {
      const inf = getInfo();
      return (inf && inf.tracks) || [];
    },
    subs: async (m) => {
      const inf = getInfo();
      const tracks = (inf && inf.tracks) || [];
      let trk = m.track || null;
      if (!trk && m.trackId) {
        trk = tracks.find((t) => t.id === m.trackId || t.lang === m.trackId || t.rawLang === m.trackId) || null;
      }
      const u = trk && (trk.url || trk.baseUrl);
      if (!u) return null;
      return await fetchSegmentedTrack(u);
    },
    nativeOff: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-dp', NATIVE_SEL, true);
      return true;
    },
    nativeOn: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-dp', NATIVE_SEL, false);
      return true;
    },
    seek: (m) => {
      const v = findVideoDeep(document);
      if (v) {
        v.currentTime = Math.max(0, Number(m.sec || 0)) + 0.01;
        return true;
      }
      return false;
    },
  };

  if (G.SS_SITES && G.SS_SITES.servePage) G.SS_SITES.servePage('dp', handlers);
})();
