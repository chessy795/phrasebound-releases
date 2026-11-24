// Prime Video content-world site profile (www.primevideo.com/*, www.amazon.{com,co.uk,co.jp,de}/gp/video/*).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const NATIVE_SEL = '.atvwebplayersdk-captions-overlay, .persistentPanel .f35bt6a, .timedTextBackground';
  const AD_SEL = '.atvwebplayersdk-ad-timer, .atvwebplayersdk-ad-feedback, .fuji-ad-badge, [data-testid="ad-countdown"]';

  const isPrimeHost = (loc) => {
    const h = G.SS_SITES.hostOf(loc);
    return /(^|\.)primevideo\.com$/i.test(h) || /(^|\.)amazon\.(?:com|co\.uk|co\.jp|de)$/i.test(h);
  };

  const extractRawAsin = (loc) => {
    const l = loc || G.location;
    const p = String((l && l.pathname) || '');
    const m = p.match(/\/(?:detail|dp|gp\/video\/detail)\/([A-Z0-9]{10,})/i);
    if (m) return m[1];
    try {
      const q = new URLSearchParams((l && l.search) || '');
      return q.get('asin') || q.get('gti') || '';
    } catch (e) {
      return '';
    }
  };

  G.SS_SITES.register({
    id: 'pv',
    name: 'Prime Video',
    nativeSelector: NATIVE_SEL,
    isHost: (loc) => isPrimeHost(loc),
    match: (loc) => {
      const l = loc || G.location;
      if (!l || !isPrimeHost(l)) return false;
      const p = String(l.pathname || '');
      const h = G.SS_SITES.hostOf(l);
      if (/(^|\.)primevideo\.com$/i.test(h)) {
        return /^\/(?:detail|watch|region\/[^/]+\/detail|storefront)/i.test(p) || !!(typeof document !== 'undefined' && document.querySelector && document.querySelector('.webPlayerSDKContainer video, #dv-web-player video'));
      }
      return /^\/gp\/video\//i.test(p) || /^\/[^/]*\/dp\//i.test(p);
    },
    isShorts: () => false,
    video: () => G.SS_SITES.pickMainVideo(
      document,
      ['.webPlayerSDKContainer video', '.atvwebplayersdk-video-surface video', '#dv-web-player video'],
      ['.dv-dp-node-trailer', '[data-testid="hero-video"]', '.tst-hover-player', '.atvwebplayersdk-ad-container']
    ),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      return document.querySelector('.atvwebplayersdk-overlays-container')
        || document.querySelector('.webPlayerSDKContainer')
        || document.querySelector('#dv-web-player')
        || document.body;
    },
    controlsTarget: () => null,
    inlineSidebar: () => null,
    rawVideoId: (loc) => extractRawAsin(loc),
    videoKey: (rawId) => {
      const id = String(rawId || extractRawAsin() || '').replace(/^pv:/, '');
      return id ? `pv:${id}` : '';
    },
    videoUrl: (rawId, tSec) => {
      const id = String(rawId || '').replace(/^pv:/, '');
      return `https://www.primevideo.com/detail/${encodeURIComponent(id)}?t=${Math.floor(tSec || 0)}`;
    },
    onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
    isAd: () => {
      const nodes = document.querySelectorAll ? document.querySelectorAll(AD_SEL) : [];
      for (const el of nodes) {
        if (!el) continue;
        if (el.style && el.style.display === 'none') continue;
        if (el.offsetParent !== undefined && el.offsetParent === null && !(el.textContent || '').trim()) continue;
        return true;
      }
      return false;
    },
    seek: (sec) => {
      const v = G.SS_SITES.byId('pv').video();
      if (v) v.currentTime = Math.max(0, sec) + 0.01;
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-pv', NATIVE_SEL, true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-pv', NATIVE_SEL, false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: { search: false, shorts: false, recommendations: false, stageLayout: true, ytMt: false },
  });
})();
