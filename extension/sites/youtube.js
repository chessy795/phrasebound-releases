// YouTube content-world site profile (Watch + Shorts + Masthead search + Split-Stage).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const isShortsLoc = (loc) => {
    const l = loc || G.location;
    return !!(l && typeof l.pathname === 'string' && l.pathname.startsWith('/shorts/'));
  };

  const getPlayerEl = () => {
    if (isShortsLoc()) {
      return document.getElementById('shorts-player')
        || document.querySelector('ytd-reel-video-renderer[is-active] .html5-video-player')
        || document.querySelector('#shorts-container .html5-video-player');
    }
    return document.getElementById('movie_player');
  };

  G.SS_SITES.register({
    id: 'yt',
    name: 'YouTube',
    nativeSelector: '.ytp-caption-window-container',
    isHost: (loc) => /(^|\.)youtube\.com$/i.test(G.SS_SITES.hostOf(loc)),
    match: (loc) => {
      const l = loc || G.location;
      if (!l || !/(^|\.)youtube\.com$/i.test(G.SS_SITES.hostOf(l))) return false;
      const p = String(l.pathname || '');
      return p === '/watch' || p.startsWith('/shorts/') || p.startsWith('/live/');
    },
    isShorts: () => isShortsLoc(),
    isLive: (loc) => {
      const l = loc || G.location;
      if (l && String(l.pathname || '').startsWith('/live/')) return true;
      if (typeof document !== 'undefined') {
        const b = document.querySelector('#movie_player .ytp-live-badge');
        if (b && b.offsetParent !== null && !b.hasAttribute('disabled')) return true;
        const p = document.getElementById('movie_player');
        if (p && p.classList && p.classList.contains('ytp-live')) return true;
      }
      return false;
    },
    liveCaptionSelectors: ['.ytp-caption-segment', '.captions-text'],
    video: () => {
      const pc = getPlayerEl();
      return (pc && pc.querySelector('video')) || document.querySelector('#movie_player video');
    },
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      return getPlayerEl() || document.body;
    },
    controlsTarget: () => {
      const pc = getPlayerEl();
      return pc && pc.querySelector('.ytp-right-controls');
    },
    inlineSidebar: () => document.querySelector('#secondary-inner') || document.querySelector('#secondary'),
    rawVideoId: (loc) => {
      const l = loc || G.location;
      const sm = String((l && l.pathname) || '').match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{6,})/);
      if (sm) return sm[1];
      try {
        return new URLSearchParams((l && l.search) || '').get('v') || '';
      } catch (e) {
        return '';
      }
    },
    videoKey: (rawId) => {
      const id = String(rawId || G.SS_SITES.byId('yt').rawVideoId() || '').replace(/^yt:/, '');
      return id ? `yt:${id}` : '';
    },
    videoUrl: (rawId, tSec) => {
      const id = String(rawId || '').replace(/^yt:/, '');
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.floor(tSec || 0)}s`;
    },
    onNavigate: (cb) => {
      const handler = () => cb();
      document.addEventListener('yt-navigate-finish', handler);
      const unsubUrl = G.SS_SITES.watchUrlChanges(G, document, handler);
      return () => {
        document.removeEventListener('yt-navigate-finish', handler);
        unsubUrl();
      };
    },
    isAd: () => {
      const p = document.getElementById('movie_player');
      return !!(p && p.classList && p.classList.contains('ad-showing'));
    },
    seek: (sec) => {
      const p = getPlayerEl();
      const v = (p && p.querySelector('video')) || document.querySelector('#movie_player video');
      if (v) v.currentTime = Math.max(0, sec) + 0.01;
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-yt', '.ytp-caption-window-container', true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-yt', '.ytp-caption-window-container', false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: {
      search: true,
      shorts: true,
      recommendations: true,
      stageLayout: true,
      ytMt: true,
    },
  });
})();
