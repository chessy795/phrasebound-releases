// Generic HTML5 & MOOC Video Site Profile (Coursera, Udemy, TED, edX, Khan Academy, or on-demand HTML5 <video>).
// Inspired by MIT-licensed asbplayer generic fallback & Trancy MOOC support.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const MOOC_HOST_RE = /(^|\.)(coursera\.org|udemy\.com|ted\.com|edx\.org|khanacademy\.org)$/i;
  const NATIVE_SEL = '.vjs-text-track-display, [data-purpose="captions-cue-text"], .rc-VideoControlsContainer .captions, .mejs__captions-layer';

  const slugVideoId = (loc) => {
    const l = loc || G.location || {};
    const host = G.SS_SITES.hostOf(l).replace(/^www\./i, '');
    const path = String(l.pathname || '/').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'video';
    return `${host}_${path}`;
  };

  const findMainHtml5Video = () => G.SS_SITES.pickMainVideo(
    document,
    ['.video-js video', '[data-purpose="video-display"] video', 'main video', 'video'],
    ['[aria-hidden="true"]', '.ad-container']
  );

  G.SS_SITES.register({
    id: 'gen',
    name: 'HTML5 Video',
    nativeSelector: NATIVE_SEL,
    isHost: (loc) => MOOC_HOST_RE.test(G.SS_SITES.hostOf(loc)),
    match: (loc) => {
      const l = loc || G.location;
      if (!l) return false;
      if (MOOC_HOST_RE.test(G.SS_SITES.hostOf(l))) {
        return !!(typeof document === 'undefined' || !document.querySelector || findMainHtml5Video() || /\/(lecture|learn|talks|course|watch|v)\b/i.test(String(l.pathname || '')));
      }
      return !!(G.__ssForceGenericVideo);
    },
    isShorts: () => false,
    video: () => findMainHtml5Video(),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      const v = findMainHtml5Video();
      return (v && (v.closest('.video-js, [data-purpose="video-player"], .rc-VideoMiniPlayer') || v.parentElement)) || document.body;
    },
    controlsTarget: () => null,
    inlineSidebar: () => null,
    rawVideoId: (loc) => slugVideoId(loc),
    videoKey: (rawId) => {
      const id = String(rawId || slugVideoId() || '').replace(/^gen:/, '');
      return id ? `gen:${id}` : '';
    },
    videoUrl: (_rawId, tSec) => {
      const base = (G.location && G.location.href ? G.location.href.split('#')[0] : '');
      return `${base}#t=${Math.floor(tSec || 0)}`;
    },
    onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
    isAd: () => false,
    seek: (sec) => {
      const v = findMainHtml5Video();
      if (v) v.currentTime = Math.max(0, sec) + 0.01;
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-gen', NATIVE_SEL, true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-gen', NATIVE_SEL, false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: { search: false, shorts: false, recommendations: false, stageLayout: false, ytMt: false },
  });
})();
