// Bilibili content-world site profile (www.bilibili.com/video/* and /bangumi/play/*).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const NATIVE_SEL = '.bpx-player-subtitle-wrap, .bilibili-player-video-subtitle';

  const extractRawKey = (loc) => {
    const l = loc || G.location;
    const p = String((l && l.pathname) || '');
    const epM = p.match(/\/bangumi\/play\/(ep\d+|ss\d+)/i);
    if (epM) return epM[1];
    const bvM = p.match(/\/video\/(BV[A-Za-z0-9]+|av\d+)/i);
    if (!bvM) return '';
    let part = '';
    try {
      const pn = new URLSearchParams((l && l.search) || '').get('p');
      if (pn && pn !== '1') part = `_p${pn}`;
    } catch (e) {}
    return bvM[1] + part;
  };

  G.SS_SITES.register({
    id: 'bili',
    name: 'Bilibili',
    nativeSelector: NATIVE_SEL,
    isHost: (loc) => /(^|\.)bilibili\.com$/i.test(G.SS_SITES.hostOf(loc)),
    match: (loc) => {
      const l = loc || G.location;
      if (!l || !/(^|\.)bilibili\.com$/i.test(G.SS_SITES.hostOf(l))) return false;
      return /^\/(?:video|bangumi\/play)\//i.test(l.pathname || '');
    },
    isShorts: () => false,
    video: () => G.SS_SITES.pickMainVideo(
      document,
      ['.bpx-player-video-wrap video', '#bilibili-player video', '.bilibili-player-video video'],
      ['.bpx-player-mini-warp', '.van-framepreview', '.video-page-card-small']
    ),
    container: () => {
      if (document.fullscreenElement) return document.fullscreenElement;
      return document.querySelector('.bpx-player-video-area')
        || document.querySelector('.bpx-player-container')
        || document.querySelector('#bilibili-player')
        || document.body;
    },
    controlsTarget: () => document.querySelector('.bpx-player-control-bottom-right:has(> .bpx-player-ctrl-btn)')
      || document.querySelector('.bpx-player-control-bottom-right'),
    inlineSidebar: () => document.querySelector('.right-container-inner') || document.querySelector('#danmukuBox'),
    rawVideoId: (loc) => extractRawKey(loc),
    videoKey: (rawId) => {
      const id = String(rawId || extractRawKey() || '').replace(/^bili:/, '');
      return id ? `bili:${id}` : '';
    },
    videoUrl: (rawId, tSec) => {
      const clean = String(rawId || '').replace(/^bili:/, '');
      const base = /^ep\d+|^ss\d+/i.test(clean)
        ? `https://www.bilibili.com/bangumi/play/${clean}`
        : `https://www.bilibili.com/video/${clean.split('_')[0]}`;
      const part = clean.match(/_p([1-9]\d*)(?:_|$)/);
      return `${base}?${part ? 'p=' + part[1] + '&' : ''}t=${Math.floor(tSec || 0)}`;
    },
    onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
    isAd: () => false,
    seek: (sec) => {
      const v = G.SS_SITES.byId('bili').video();
      if (v) v.currentTime = Math.max(0, sec) + 0.01;
    },
    nativeOff: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-bili', NATIVE_SEL, true);
      return G.SS_SITES.ask('nativeOff');
    },
    nativeOn: () => {
      G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-bili', NATIVE_SEL, false);
      return G.SS_SITES.ask('nativeOn');
    },
    features: { search: false, shorts: false, recommendations: false, stageLayout: true, ytMt: false },
  });
})();
