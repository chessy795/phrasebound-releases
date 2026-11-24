// Netflix content-world site profile (www.netflix.com/watch/*).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const NATIVE_SEL = '.player-timedtext';

  const extractMovieId = (loc) => {
    const l = loc || G.location;
    const m = String((l && l.pathname) || '').match(/^\/watch\/(\d+)/);
    return m ? m[1] : '';
  };

  G.SS_SITES.register({
    id: 'nf',
    name: 'Netflix',
    nativeSelector: NATIVE_SEL,
    isHost: (loc) => /(^|\.)netflix\.com$/i.test(G.SS_SITES.hostOf(loc)),
    match: (loc) => {
      const l = loc || G.location;
      if (!l || !/(^|\.)netflix\.com$/i.test(G.SS_SITES.hostOf(l))) return false;
      return String(l.pathname || '').startsWith('/watch');
    },
    isShorts: () => false,
    video: () => G.SS_SITES.pickMainVideo(
      document,
      ['.watch-video video', '.NFPlayer video'],
      ['.billboard-row', '.previewModal--player_container', '.lolomo']
    ),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      return document.querySelector('.watch-video--player-view')
        || document.querySelector('.watch-video')
        || document.querySelector('.NFPlayer')
        || document.body;
    },
    controlsTarget: () => null,
    inlineSidebar: () => null,
    rawVideoId: (loc) => extractMovieId(loc),
    videoKey: (rawId) => {
      const id = String(rawId || extractMovieId() || '').replace(/^nf:/, '');
      return id ? `nf:${id}` : '';
    },
    videoUrl: (rawId, tSec) => {
      const id = String(rawId || '').replace(/^nf:/, '');
      return `https://www.netflix.com/watch/${encodeURIComponent(id)}?t=${Math.floor(tSec || 0)}`;
    },
    onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
    isAd: () => !!document.querySelector('[data-uia="ads-info-container"], .watch-video--ad-info'),
    seek: (sec) => {
      // Never write video.currentTime directly on Netflix (causes error M7375); delegate to Cadmium player API in page world
      G.SS_SITES.ask('seek', { sec: Math.max(0, sec) }, 3000);
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-nf', NATIVE_SEL, true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-nf', NATIVE_SEL, false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: { search: false, shorts: false, recommendations: false, stageLayout: true, ytMt: false },
  });
})();
