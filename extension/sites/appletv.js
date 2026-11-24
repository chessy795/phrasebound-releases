// Apple TV+ content-world site profile (tv.apple.com) — clean-room MV3 adapter.
// Mounts inside Apple's active modal <dialog> so overlay & panel render in the top layer,
// hides native Apple TV+ subtitle containers, and delegates seeking to MusicKit in MAIN world.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const NATIVE_SEL = '.apple-tv-plus-subtitles, amp-subtitles, .vjs-text-track-display, [class*="subtitles-container"]';

  const extractAppleId = (loc) => {
    const l = loc || G.location;
    const p = String((l && l.pathname) || '');
    const m = p.match(/\/(?:umc\.cmc\.[A-Za-z0-9]+)|\/(?:watch|movie|episode|show)\/[^/]+\/([A-Za-z0-9._-]{4,})|\/(?:watch)\/([A-Za-z0-9._-]{4,})/);
    if (!m) {
      const umc = p.match(/(umc\.cmc\.[A-Za-z0-9]+)/);
      return umc ? umc[1] : '';
    }
    return m[1] || m[2] || m[0].replace(/^\/+/, '');
  };

  const findAppleVideo = () => {
    const main = G.SS_SITES.pickMainVideo(
      document,
      ['dialog[open] video', 'amp-video-player video', '.playback-modal video'],
      ['.Lockup video', '.shelf-grid video', '[class*="preview"]']
    );
    if (main) return main;
    if (document.querySelectorAll) {
      for (const el of document.querySelectorAll('amp-video-player, apple-tv-plus-player, dialog[open] *')) {
        if (el && el.shadowRoot && el.shadowRoot.querySelector) {
          const sv = el.shadowRoot.querySelector('video');
          if (sv) return sv;
        }
      }
    }
    return null;
  };

  G.SS_SITES.register({
    id: 'atv',
    name: 'Apple TV+',
    nativeSelector: NATIVE_SEL,
    isHost: (loc) => /(^|\.)tv\.apple\.com$/i.test(G.SS_SITES.hostOf(loc)),
    match: (loc) => {
      const l = loc || G.location;
      if (!l || !/(^|\.)tv\.apple\.com$/i.test(G.SS_SITES.hostOf(l))) return false;
      const p = String(l.pathname || '');
      if (/\/(?:watch|movie|episode|show|sport)\b/i.test(p) || /umc\.cmc\./i.test(p)) return true;
      return !!(typeof document !== 'undefined' && document.querySelector && document.querySelector('dialog[open] video, amp-video-player video'));
    },
    isShorts: () => false,
    video: () => findAppleVideo(),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      return document.querySelector('dialog[open]')
        || document.querySelector('.playback-modal')
        || document.querySelector('amp-video-player')
        || document.body;
    },
    controlsTarget: () => null,
    inlineSidebar: () => null,
    rawVideoId: (loc) => extractAppleId(loc),
    videoKey: (rawId) => {
      const id = String(rawId || extractAppleId() || '').replace(/^atv:/, '');
      return id ? `atv:${id}` : '';
    },
    videoUrl: (rawId, tSec) => {
      const id = String(rawId || '').replace(/^atv:/, '');
      return `https://tv.apple.com/watch/${encodeURIComponent(id)}?t=${Math.floor(tSec || 0)}`;
    },
    onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
    isAd: () => false,
    seek: (sec) => {
      G.SS_SITES.ask('seek', { sec: Math.max(0, sec) }, 3000);
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-atv', NATIVE_SEL, true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-atv', NATIVE_SEL, false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: { search: false, shorts: false, recommendations: false, stageLayout: true, ytMt: false },
  });
})();
