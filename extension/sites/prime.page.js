// Prime Video MAIN-world subtitle & player adapter (www.primevideo.com/*, www.amazon.*/gp/video/*).
// Intercepts GetPlaybackResources JSON responses (subtitleUrls[], forcedNarratives[], audioTracks[], catalogMetadata),
// parses TTML2/DFXP/WebVTT via SS_PARSE, and exposes original spoken language + title metadata.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssPrimePage) return;
  G.__ssPrimePage = true;

  const resourcesByAsin = new Map();
  let latestResource = null;

  const normPvLang = (code) => {
    const raw = String(code || '').trim();
    if (!raw) return '';
    const low = raw.toLowerCase().replace(/_/g, '-');
    if (low === 'yue' || low === 'zh-hk' || low.includes('cantonese')) return 'yue';
    if (low === 'zh-hant' || low === 'zh-tw' || low === 'cmn-hant') return 'zh-Hant';
    if (low === 'zh-hans' || low === 'zh-cn' || low === 'cmn-hans') return 'zh-Hans';
    const parts = low.split('-');
    if (parts[0] === 'fil') return 'tl';
    return parts.length > 1 && parts[0] === 'zh' ? raw : parts[0];
  };

  const formatScore = (fmt) => {
    const f = String(fmt || '').toLowerCase();
    if (f.includes('vtt')) return 3;
    if (f.includes('ttml')) return 2;
    if (f.includes('dfxp')) return 1;
    return 0;
  };

  const inspectPlaybackResources = (obj, reqUrl = '') => {
    if (!obj || typeof obj !== 'object') return;
    const hasSubs = Array.isArray(obj.subtitleUrls) || Array.isArray(obj.forcedNarratives);
    const subRoot = hasSubs
      ? obj
      : (obj.playbackResources && (Array.isArray(obj.playbackResources.subtitleUrls) || Array.isArray(obj.playbackResources.forcedNarratives))
          ? obj.playbackResources
          : null);
    if (!subRoot) return;

    const cat = (subRoot.catalogMetadata && subRoot.catalogMetadata.catalog)
      || (obj.catalogMetadata && obj.catalogMetadata.catalog)
      || {};
    let asin = String(
      cat.id
      || (subRoot.returnedTitleRendition && subRoot.returnedTitleRendition.asin)
      || ''
    );
    if (!asin && reqUrl) {
      try {
        const q = new URL(reqUrl, location.origin).searchParams;
        asin = q.get('asin') || q.get('titleId') || '';
      } catch (e) {}
    }

    const rawSubs = [
      ...(Array.isArray(subRoot.subtitleUrls) ? subRoot.subtitleUrls.map((s) => ({ raw: s, forced: false })) : []),
      ...(Array.isArray(subRoot.forcedNarratives) ? subRoot.forcedNarratives.map((s) => ({ raw: s, forced: true })) : []),
    ];

    const byKey = new Map();
    rawSubs.forEach(({ raw, forced }, idx) => {
      if (!raw || !raw.url || !raw.languageCode) return;
      const lang = normPvLang(raw.languageCode);
      const rawType = String(raw.type || '').toLowerCase();
      const disp = String(raw.displayName || raw.languageCode || lang);
      const isForced = forced || rawType === 'forced' || /forced/i.test(disp);
      const isSdh = !isForced && (rawType === 'sdh' || rawType === 'sh' || rawType === 'sfx' || /\[cc\]|\bsdh\b/i.test(disp));
      const kind = isForced ? 'forced' : (isSdh ? 'sdh' : 'human');
      const dedupeKey = `${raw.languageCode.toLowerCase()}|${kind}`;
      const prev = byKey.get(dedupeKey);
      if (prev && formatScore(prev.format) >= formatScore(raw.format)) return;

      const label = disp + (isForced && !/forced/i.test(disp) ? ' (Forced)' : '');
      byKey.set(dedupeKey, {
        id: String(raw.timedTextTrackId || `${lang}:${kind}:${idx}`),
        lang,
        rawLang: raw.languageCode,
        label,
        name: label,
        kind,
        auto: false,
        format: raw.format || 'TTMLv2',
        url: raw.url,
        baseUrl: raw.url,
        translatable: false,
      });
    });

    const tracks = [...byKey.values()].sort((a, b) => (a.kind === 'forced' ? 1 : 0) - (b.kind === 'forced' ? 1 : 0));

    let audioLang = '';
    const audioTracks = subRoot.audioTracks
      || (subRoot.catalogMetadata && subRoot.catalogMetadata.playback && subRoot.catalogMetadata.playback.audioTracks)
      || [];
    if (Array.isArray(audioTracks) && audioTracks.length) {
      const orig = audioTracks.find((a) => a && (a.isOriginal || /original/i.test(a.displayName || '') || a.isDefault))
        || audioTracks[0];
      if (orig && orig.languageCode) audioLang = normPvLang(orig.languageCode);
    }

    const rec = {
      asin,
      title: cat.title || '',
      durationSec: Number(cat.runtimeSeconds || 0),
      audioLang,
      tracks,
    };
    latestResource = rec;
    if (asin) resourcesByAsin.set(asin, rec);
  };

  const of = G.fetch ? G.fetch.bind(G) : null;
  if (of) {
    G.fetch = async function (input, init) {
      const resp = await of(input, init);
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/GetPlaybackResources|playback/i.test(u)) {
          resp.clone().json().then((j) => inspectPlaybackResources(j, u)).catch(() => {});
        }
      } catch (e) {}
      return resp;
    };
  }

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
    const xo = XMLHttpRequest.prototype.open;
    const xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__ssPvUrl = String(u || '');
      return xo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const u = this.__ssPvUrl || '';
      if (/GetPlaybackResources|playback/i.test(u)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseText && this.responseText[0] === '{') {
              inspectPlaybackResources(JSON.parse(this.responseText), u);
            }
          } catch (e) {}
        });
      }
      return xs.apply(this, arguments);
    };
  }

  const extractUrlAsin = () => {
    const p = String(location.pathname || '');
    const m = p.match(/\/(?:detail|dp|gp\/video\/detail)\/([A-Z0-9]{10,})/i);
    if (m) return m[1];
    try {
      const q = new URLSearchParams(location.search || '');
      return q.get('asin') || q.get('gti') || '';
    } catch (e) {
      return '';
    }
  };

  const readDomTitle = () => {
    const t1 = document.querySelector('.atvwebplayersdk-title-text');
    const t2 = document.querySelector('.atvwebplayersdk-subtitle-text');
    const parts = [t1 && t1.textContent && t1.textContent.trim(), t2 && t2.textContent && t2.textContent.trim()].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return (document.title || 'Prime Video').replace(/\s*[-|]\s*(?:Prime Video|Amazon).*$/i, '').trim();
  };

  const getInfo = () => {
    const urlAsin = extractUrlAsin();
    const rec = (urlAsin && resourcesByAsin.get(urlAsin)) || latestResource;
    const vid = (rec && rec.asin) || urlAsin;
    if (!vid && (!rec || !rec.tracks.length)) return null;
    const vEl = document.querySelector('.webPlayerSDKContainer video, #dv-web-player video, video');
    return {
      site: 'pv',
      videoId: vid || 'pv_active',
      title: (rec && rec.title) || readDomTitle(),
      durationSec: (rec && rec.durationSec) || (vEl && Number.isFinite(vEl.duration) ? Math.round(vEl.duration) : 0),
      lang: (rec && rec.audioLang) || '',
      tracks: (rec && rec.tracks) || [],
      tlangs: [],
    };
  };

  const NATIVE_SEL = '.atvwebplayersdk-captions-overlay, .persistentPanel .f35bt6a, .timedTextBackground';

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
      if (!u || !of) return null;
      const r = await of(u, { credentials: 'omit' });
      if (!r.ok) return null;
      const txt = await r.text();
      if (!txt || !G.SS_PARSE) return null;
      const cues = /^WEBVTT/i.test(txt.trim()) ? G.SS_PARSE.parseVtt(txt) : G.SS_PARSE.parseTtml(txt);
      return cues.map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
    },
    nativeOff: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-pv', NATIVE_SEL, true);
      return true;
    },
    nativeOn: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-pv', NATIVE_SEL, false);
      return true;
    },
    seek: (m) => {
      const v = G.SS_SITES
        ? G.SS_SITES.pickMainVideo(
            document,
            ['.webPlayerSDKContainer video', '.atvwebplayersdk-video-surface video', '#dv-web-player video'],
            ['.dv-dp-node-trailer', '[data-testid="hero-video"]', '.atvwebplayersdk-ad-container']
          )
        : document.querySelector('.webPlayerSDKContainer video, video');
      if (v) {
        v.currentTime = Math.max(0, Number(m.sec || 0)) + 0.01;
        return true;
      }
      return false;
    },
  };

  if (G.SS_SITES && G.SS_SITES.servePage) G.SS_SITES.servePage('pv', handlers);
})();
