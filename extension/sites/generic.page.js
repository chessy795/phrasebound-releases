// Generic HTML5 <video> & <track> MAIN-world subtitle extractor (Coursera, Udemy, TED, edX, Khan Academy).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssGenericPage) return;
  G.__ssGenericPage = true;

  const findVideo = () => (typeof document !== 'undefined' && G.SS_SITES)
    ? G.SS_SITES.pickMainVideo(document, ['video'], [])
    : null;

  const collectHtml5Tracks = (v) => {
    if (!v) return [];
    const out = [];
    const trackEls = v.querySelectorAll ? Array.from(v.querySelectorAll('track')) : [];
    trackEls.forEach((el, idx) => {
      const kind = String(el.kind || 'subtitles').toLowerCase();
      if (kind !== 'subtitles' && kind !== 'captions') return;
      const rawLang = el.srclang || 'en';
      const lang = rawLang.toLowerCase().split(/[-_]/)[0];
      const label = el.label || rawLang.toUpperCase();
      const src = el.src || '';
      out.push({
        id: `dom:${rawLang}:${idx}`,
        lang,
        rawLang,
        label,
        name: label,
        kind: kind === 'captions' ? 'sdh' : 'human',
        auto: false,
        url: src,
        baseUrl: src,
        domIdx: idx,
      });
    });
    if (!out.length && v.textTracks && v.textTracks.length) {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i];
        if (!tt || (tt.kind !== 'subtitles' && tt.kind !== 'captions')) continue;
        const rawLang = tt.language || 'en';
        out.push({
          id: `tt:${rawLang}:${i}`,
          lang: rawLang.toLowerCase().split(/[-_]/)[0],
          rawLang,
          label: tt.label || rawLang.toUpperCase(),
          name: tt.label || rawLang.toUpperCase(),
          kind: tt.kind === 'captions' ? 'sdh' : 'human',
          auto: false,
          url: '',
          ttIdx: i,
        });
      }
    }
    return out;
  };

  const readCuesFromTrack = async (v, trk) => {
    if (!v || !trk) return null;
    if (trk.url && G.fetch && G.SS_PARSE) {
      try {
        const r = await G.fetch(trk.url);
        if (r.ok) {
          const txt = await r.text();
          const parsed = G.SS_PARSE.parseAuto(txt);
          if (parsed && parsed.length) {
            return parsed.map((c) => Object.assign({}, c, { d: Math.round(((c.e || (c.s + 2.5)) - c.s) * 1000) / 1000 }));
          }
        }
      } catch (e) {}
    }
    const idx = trk.ttIdx != null ? trk.ttIdx : trk.domIdx;
    const tt = v.textTracks && v.textTracks[idx];
    if (tt && tt.cues && tt.cues.length) {
      const cues = [];
      for (let i = 0; i < tt.cues.length; i++) {
        const c = tt.cues[i];
        const t = String(c.text || '').replace(/<[^>]+>/g, '').trim();
        if (!t) continue;
        cues.push({
          t,
          s: Number(c.startTime || 0),
          e: Number(c.endTime || (c.startTime + 2.5)),
          d: Math.max(0.2, Math.round(((c.endTime || (c.startTime + 2.5)) - c.startTime) * 1000) / 1000),
        });
      }
      return cues;
    }
    return null;
  };

  const getInfo = () => {
    const v = findVideo();
    if (!v) return null;
    const tracks = collectHtml5Tracks(v);
    const host = (G.location && G.location.hostname || 'site').replace(/^www\./i, '');
    const path = String((G.location && G.location.pathname) || '/').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'video';
    return {
      site: 'gen',
      videoId: `${host}_${path}`,
      title: (typeof document !== 'undefined' && document.title) || 'HTML5 Video',
      durationSec: Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
      lang: (tracks[0] && tracks[0].lang) || '',
      tracks,
      tlangs: [],
    };
  };

  if (G.SS_SITES && G.SS_SITES.servePage) {
    G.SS_SITES.servePage('gen', {
      info: () => getInfo(),
      tracks: () => {
        const inf = getInfo();
        return (inf && inf.tracks) || [];
      },
      subs: async (m) => {
        const v = findVideo();
        const tracks = collectHtml5Tracks(v);
        let trk = m.track || null;
        if (!trk && m.trackId) trk = tracks.find((t) => t.id === m.trackId || t.lang === m.trackId) || null;
        return await readCuesFromTrack(v, trk || tracks[0]);
      },
      nativeOff: () => {
        const v = findVideo();
        if (v && v.textTracks) {
          for (let i = 0; i < v.textTracks.length; i++) {
            if (v.textTracks[i].mode === 'showing') v.textTracks[i].mode = 'hidden';
          }
        }
        return true;
      },
      nativeOn: () => true,
      seek: (m) => {
        const v = findVideo();
        if (v) { v.currentTime = Math.max(0, Number(m.sec || 0)) + 0.01; return true; }
        return false;
      },
    });
  }
})();
