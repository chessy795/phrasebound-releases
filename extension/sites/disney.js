// Disney+ content-world site profile (www.disneyplus.com/*/play/* and /video/*).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const NATIVE_SEL = '.dss-hls-subtitle-overlay, .dss-subtitle-renderer-cue, .hive-subtitle-renderer, .shaka-text-container';

  const extractContentId = (loc) => {
    const l = loc || G.location;
    const m = String((l && l.pathname) || '').match(/\/(?:play|video)\/([A-Za-z0-9-]{4,})/);
    return m ? m[1] : '';
  };

  const findDisneyVideo = () => {
    const main = G.SS_SITES.pickMainVideo(
      document,
      ['.btm-media-player video', '#hudson-wrapper video', 'dss-hls-player video'],
      ['[data-testid="hero-carousel"]', '.background-video', '.ad-video-player']
    );
    if (main) return main;
    if (document.querySelectorAll) {
      for (const el of document.querySelectorAll('dss-hls-player, btm-media-player, #hudson-wrapper')) {
        if (el && el.shadowRoot && el.shadowRoot.querySelector) {
          const sv = el.shadowRoot.querySelector('video');
          if (sv) return sv;
        }
      }
    }
    return null;
  };

  G.SS_SITES.register({
    id: 'dp',
    name: 'Disney+',
    nativeSelector: NATIVE_SEL,
    isHost: (loc) => /(^|\.)disneyplus\.com$/i.test(G.SS_SITES.hostOf(loc)),
    match: (loc) => {
      const l = loc || G.location;
      if (!l || !/(^|\.)disneyplus\.com$/i.test(G.SS_SITES.hostOf(l))) return false;
      return /\/(?:play|video)\/[A-Za-z0-9-]{4,}/.test(String(l.pathname || ''));
    },
    isShorts: () => false,
    video: () => findDisneyVideo(),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      return document.querySelector('.btm-media-player')
        || document.querySelector('#hudson-wrapper')
        || document.querySelector('#app_body_content')
        || document.body;
    },
    controlsTarget: () => null,
    inlineSidebar: () => null,
    rawVideoId: (loc) => extractContentId(loc),
    videoKey: (rawId) => {
      const id = String(rawId || extractContentId() || '').replace(/^dp:/, '');
      return id ? `dp:${id}` : '';
    },
    videoUrl: (rawId, tSec) => {
      const id = String(rawId || '').replace(/^dp:/, '');
      return `https://www.disneyplus.com/play/${encodeURIComponent(id)}?t=${Math.floor(tSec || 0)}`;
    },
    onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
    isAd: () => !!document.querySelector('.ad-badge-overlay, [data-testid="ad-badge"]'),
    seek: (sec) => {
      const v = findDisneyVideo();
      if (v) v.currentTime = Math.max(0, sec) + 0.01;
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-dp', NATIVE_SEL, true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-dp', NATIVE_SEL, false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: { search: false, shorts: false, recommendations: false, stageLayout: true, ytMt: false },
  });
})();
