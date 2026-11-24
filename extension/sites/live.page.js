// Live Stream MAIN-world adapter (Twitch, Bilibili Live, Naver CHZZK, SOOP, Kick, Facebook Live, TikTok Live).
// Exposes live stream metadata (site, videoId, title, author, isLive, default lang, <track>/textTracks if present) via SS_SITES.servePage.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssLivePage) return;
  G.__ssLivePage = true;

  const HOST_SPEC = [
    {id:'dw',re:/^www\.dw\.com$/i,lang:'en',titleSel:['h1'],authorSel:[]},
    { id: 'tw', re: /(^|\.)twitch\.tv$/i, lang: '', titleSel: ['[data-a-target="stream-title"]', 'h2[title]', 'h1'], authorSel: ['h1.tw-title', '[data-a-target="user-channel-header-item"]'] },
    { id: 'blive', re: /^live\.bilibili\.com$/i, lang: 'zh', titleSel: ['.live-title .text', '.room-info-down-row .title-label'], authorSel: ['.room-owner-username', '.upper-name'] },
    { id: 'cz', re: /(^|\.)chzzk\.naver\.com$/i, lang: 'ko', titleSel: ['[class*="video_information_title"]', 'h2'], authorSel: ['[class*="name_text"]'] },
    { id: 'soop', re: /(^|\.)sooplive\.co\.kr$/i, lang: 'ko', titleSel: ['.broadcast_title', 'h2'], authorSel: ['.nickname', '.bj_name'] },
    { id: 'kk', re: /(^|\.)kick\.com$/i, lang: '', titleSel: ['[data-testid="stream-title"]', 'h1'], authorSel: ['[data-testid="channel-username"]', 'a[href^="/"] span'] },
    { id: 'fb', re: /(^|\.)(facebook\.com|fb\.watch)$/i, lang: '', titleSel: ['h1', '[role="main"] span[dir="auto"]'], authorSel: ['h2 a'] },
    { id: 'tt', re: /(^|\.)tiktok\.com$/i, lang: '', titleSel: ['[data-e2e="live-room-title"]', 'h1'], authorSel: ['[data-e2e="live-author-nickname"]'] },
  ];

  const firstText = (sels) => {
    if (typeof document === 'undefined' || !document.querySelector) return '';
    for (const s of sels || []) {
      try {
        const el = document.querySelector(s);
        const t = el && el.textContent ? el.textContent.trim() : '';
        if (t) return t;
      } catch (e) {}
    }
    return '';
  };

  const detectSpec = () => {
    const h = (G.SS_SITES && G.SS_SITES.hostOf(G.location)) || (G.location && G.location.hostname) || '';
    return HOST_SPEC.find((s) => s.re.test(h)) || { id: 'tw', lang: '', titleSel: [], authorSel: [] };
  };

  const extractId = (spec) => {
    const p = String((G.location && G.location.pathname) || '').replace(/^\/+|\/+$/g, '');
    if (spec.id === 'dw') return 'channel-english';
    if (spec.id === 'blive') {
      const m = p.match(/^(?:blanc\/)?(\d+)/);
      return m ? m[1] : p;
    }
    if (spec.id === 'cz') {
      const m = p.match(/^(?:live|video)\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : p;
    }
    if (spec.id === 'tw') {
      const vm = p.match(/^videos\/(\d+)/i);
      return vm ? `vod_${vm[1]}` : (p.split('/')[0] || '').toLowerCase();
    }
    if (spec.id === 'fb') {
      try {
        const v = new URLSearchParams((G.location && G.location.search) || '').get('v');
        if (v) return v;
      } catch (e) {}
    }
    if (spec.id === 'tt') {
      const m = p.match(/^@([^/]+)/);
      return m ? m[1] : p;
    }
    return p.split('/')[0] || p || 'live';
  };

  const collectTextTracks = () => {
    if (typeof document === 'undefined' || !document.querySelector) return [];
    const v = (G.SS_SITES && G.SS_SITES.pickMainVideo(document, ['video'], [])) || document.querySelector('video');
    if (!v || !v.textTracks) return [];
    const tracks = [];
    for (let i = 0; i < v.textTracks.length; i++) {
      const tt = v.textTracks[i];
      if (!tt || (tt.kind !== 'subtitles' && tt.kind !== 'captions')) continue;
      const rawLang = tt.language || 'en';
      tracks.push({
        id: `tt:${rawLang}:${i}`,
        lang: rawLang.toLowerCase().split(/[-_]/)[0],
        label: tt.label || rawLang.toUpperCase(),
        kind: 'captions',
        auto: false,
        ttIdx: i,
      });
    }
    return tracks;
  };

  const computeIsLive = (spec) => {
    const p = String((G.location && G.location.pathname) || '/');
    const h = String((G.location && G.location.hostname) || '');
    if (spec.id === 'tw') return !/^\/(?:videos\/|[^/]+\/clip\/)/i.test(p);
    if (spec.id === 'cz') return /^\/live\//i.test(p);
    if (spec.id === 'kk') return !/\/videos\//i.test(p);
    if (spec.id === 'fb') return /\/live\b/i.test(p);
    if (spec.id === 'soop') return /^play\./i.test(h) || !/vod/i.test(p);
    return true;
  };

  const handlers = {
    info: () => {
      const spec = detectSpec();
      const rawTitle = firstText(spec.titleSel) || (typeof document !== 'undefined' ? document.title : '') || spec.id.toUpperCase();
      return {
        site: spec.id,
        videoId: extractId(spec),
        title: rawTitle.slice(0, 140),
        author: firstText(spec.authorSel),
        lang: spec.lang,
        isLive: computeIsLive(spec),
        tracks: collectTextTracks(),
        tlangs: [],
      };
    },
    tracks: () => collectTextTracks(),
    subs: (m) => {
      if (typeof document === 'undefined') return null;
      const v = (G.SS_SITES && G.SS_SITES.pickMainVideo(document, ['video'], [])) || document.querySelector('video');
      if (!v || !v.textTracks || !v.textTracks.length) return null;
      const tracks = collectTextTracks();
      let trk = (m && m.track) || null;
      if (!trk && m && m.trackId) trk = tracks.find((t) => t.id === m.trackId || t.lang === m.trackId) || null;
      const ttIdx = trk && trk.ttIdx != null ? trk.ttIdx : (tracks[0] ? tracks[0].ttIdx : 0);
      const tt = v.textTracks[ttIdx];
      if (!tt || !tt.cues || !tt.cues.length) return null;
      const cues = [];
      for (let i = 0; i < tt.cues.length; i++) {
        const c = tt.cues[i];
        const t = String(c.text || '').replace(/<[^>]+>/g, '').trim();
        if (!t) continue;
        const s = Number(c.startTime || 0);
        const e = Number(c.endTime || (s + 2.5));
        cues.push({ t, s, e, d: Math.max(0.2, Math.round((e - s) * 1000) / 1000) });
      }
      return cues.length ? cues : null;
    },
    nativeOff: () => true,
    nativeOn: () => true,
  };

  if (G.SS_SITES && G.SS_SITES.servePage) G.SS_SITES.servePage('live', handlers);
})();
