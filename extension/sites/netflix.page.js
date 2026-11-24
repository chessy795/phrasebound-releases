// Netflix MAIN-world subtitle & player adapter (www.netflix.com/watch/*).
// Captures timedtexttracks[] & original audio language by wrapping JSON.parse at document_start,
// prefers WebVTT then IMSC1.1/TTML/DFXP, and seeks safely via Netflix's session videoPlayer API (avoiding M7375).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssNfPage) return;
  G.__ssNfPage = true;

  const manifests = new Map(); // movieId (string) -> { movieId, tracks, audioLang, durationSec }
  let latestManifest = null;

  const FORMAT_PREF = [
    'webvtt-lssdh-ios8',
    'webvtt-lssdh-ios',
    'imsc1.1',
    'dfxp-ls-sdh',
    'simplesdh',
    'nflx-cmisc',
  ];

  const extractUrls = (dlObj) => {
    if (!dlObj || typeof dlObj !== 'object') return [];
    const urls = [];
    if (Array.isArray(dlObj.urls)) {
      for (const u of dlObj.urls) if (u && u.url) urls.push(u.url);
    }
    if (dlObj.downloadUrls && typeof dlObj.downloadUrls === 'object') {
      for (const v of Object.values(dlObj.downloadUrls)) {
        if (typeof v === 'string' && /^https?:/i.test(v)) urls.push(v);
      }
    }
    return urls;
  };

  const inspectManifestObj = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    // Check direct or nested result.timedtexttracks
    const root = Array.isArray(obj.timedtexttracks) ? obj : (obj.result && Array.isArray(obj.result.timedtexttracks) ? obj.result : null);
    if (!root) return;

    const movieId = String(root.movieId || obj.movieId || (location.pathname.match(/\/watch\/(\d+)/) || [])[1] || '');
    const tracks = [];

    for (let idx = 0; idx < root.timedtexttracks.length; idx++) {
      const t = root.timedtexttracks[idx];
      if (!t || t.isNoneTrack || !t.language) continue;
      const dls = t.ttDownloadables || {};
      let chosenFmt = '';
      let urls = [];
      for (const fmt of FORMAT_PREF) {
        const u = extractUrls(dls[fmt]);
        if (u.length) { chosenFmt = fmt; urls = u; break; }
      }
      if (!urls.length) {
        for (const [fmt, val] of Object.entries(dls)) {
          const u = extractUrls(val);
          if (u.length) { chosenFmt = fmt; urls = u; break; }
        }
      }
      if (!urls.length) continue;

      const isForced = !!t.isForcedNarrative || t.rawTrackType === 'forcednarrative';
      const isSdh = !isForced && (t.rawTrackType === 'closedcaptions' || /\[cc\]|\bsdh\b/i.test(t.languageDescription || ''));
      const kind = isForced ? 'forced' : (isSdh ? 'sdh' : 'human');
      const label = (t.languageDescription || t.language) + (isForced ? ' (Forced)' : '');
      tracks.push({
        id: String(t.new_track_id || `${t.language}:${kind}:${idx}`),
        lang: t.language,
        label,
        name: label,
        kind,
        auto: false,
        format: chosenFmt,
        url: urls[0],
        urls,
        baseUrl: urls[0],
        translatable: false,
      });
    }

    // Detect original spoken audio language from audio_tracks when exposed
    let audioLang = '';
    const audioArr = root.audio_tracks || root.audioTracks || [];
    if (Array.isArray(audioArr)) {
      const orig = audioArr.find((a) => a && (a.isNative || /original/i.test(a.languageDescription || '') || a.rawTrackType === 'primary'))
        || audioArr[0];
      if (orig && orig.language) audioLang = orig.language;
    }

    const rec = {
      movieId,
      tracks,
      audioLang,
      durationSec: root.duration ? Math.round(Number(root.duration) / 1000) : 0,
    };
    latestManifest = rec;
    if (movieId) manifests.set(movieId, rec);
  };

  // Wrap JSON.parse safely at document_start to catch encrypted/MSL manifest payloads decoded by Cadmium player
  const origJsonParse = G.JSON.parse;
  G.JSON.parse = function () {
    const val = origJsonParse.apply(this, arguments);
    try {
      if (val && typeof val === 'object') inspectManifestObj(val);
    } catch (e) {}
    return val;
  };

  const currentMovieId = () => (String(location.pathname || '').match(/\/watch\/(\d+)/) || [])[1] || '';

  const readTitleFromNetflixState = (mid) => {
    try {
      const titleNode = document.querySelector('[data-uia="video-title"]');
      if (titleNode && titleNode.textContent && titleNode.textContent.trim()) {
        return titleNode.textContent.replace(/\s+/g, ' ').trim();
      }
      const state = G.netflix && G.netflix.appContext && G.netflix.appContext.state;
      const meta = state && state.playerApp && state.playerApp.getState && state.playerApp.getState();
      const vm = meta && meta.videoPlayer && meta.videoPlayer.videoMetadata && meta.videoPlayer.videoMetadata[mid];
      if (vm && vm._video && vm._video.title) return vm._video.title;
    } catch (e) {}
    return (document.title || 'Netflix').replace(/\s*-\s*Netflix.*$/i, '').trim();
  };

  const getNetflixPlayer = () => {
    try {
      const vp = G.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const sids = (vp.getAllPlayerSessionIds && vp.getAllPlayerSessionIds()) || [];
      const watchSid = sids.find((s) => String(s).startsWith('watch')) || sids[0];
      return watchSid ? vp.getVideoPlayerBySessionId(watchSid) : null;
    } catch (e) {
      return null;
    }
  };

  const getInfo = () => {
    const mid = currentMovieId();
    const rec = (mid && manifests.get(mid)) || latestManifest;
    if (!rec || !rec.tracks || !rec.tracks.length) {
      if (!mid) return null;
      const v = document.querySelector('.watch-video video, video');
      if (!v) return null;
      return {
        site: 'nf',
        videoId: mid,
        title: readTitleFromNetflixState(mid),
        durationSec: Math.round(v.duration || 0),
        lang: '',
        tracks: [],
        tlangs: [],
      };
    }
    // Order non-forced human tracks ahead of forced narratives so spoken track pick never picks a 12-line forced track
    const orderedTracks = rec.tracks.slice().sort((a, b) => (a.kind === 'forced' ? 1 : 0) - (b.kind === 'forced' ? 1 : 0));
    return {
      site: 'nf',
      videoId: mid || rec.movieId,
      title: readTitleFromNetflixState(mid || rec.movieId),
      durationSec: rec.durationSec || 0,
      lang: rec.audioLang || '',
      tracks: orderedTracks,
      tlangs: [],
    };
  };

  const of = G.fetch ? G.fetch.bind(G) : null;

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
        trk = tracks.find((t) => t.id === m.trackId || t.lang === m.trackId) || null;
      }
      if (!trk || !of) return null;
      const urls = Array.isArray(trk.urls) && trk.urls.length ? trk.urls : [trk.url || trk.baseUrl].filter(Boolean);
      for (const u of urls) {
        try {
          const r = await of(u, { credentials: 'omit' });
          if (!r.ok) continue;
          const txt = await r.text();
          if (!txt) continue;
          const cues = G.SS_PARSE
            ? (/webvtt/i.test(trk.format || '') || /^WEBVTT/i.test(txt.trim()) ? G.SS_PARSE.parseVtt(txt) : G.SS_PARSE.parseTtml(txt))
            : [];
          if (cues.length) {
            return cues.map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
          }
        } catch (e) {}
      }
      return null;
    },
    nativeOff: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-nf', '.player-timedtext', true);
      return true;
    },
    nativeOn: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-nf', '.player-timedtext', false);
      return true;
    },
    seek: (m) => {
      const sec = Math.max(0, Number(m.sec || 0));
      const p = getNetflixPlayer();
      if (p && typeof p.seek === 'function') {
        p.seek(Math.round(sec * 1000));
        return true;
      }
      return false;
    },
  };

  if (G.SS_SITES && G.SS_SITES.servePage) G.SS_SITES.servePage('nf', handlers);
})();
