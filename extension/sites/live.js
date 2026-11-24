// Table-driven Live Stream site profiles: Twitch, Bilibili Live, Naver CHZZK, SOOP, Kick, Facebook Live, TikTok Live.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (!G.SS_SITES) return;

  const LIVE_SPECS = [
    {
      id:'dw', name:'DW English', hostRe:/^www\.dw\.com$/i, defaultLang:'en',
      matchPath:p=>/^\/en\/live-tv\/channel-english\/?$/.test(p), isLivePath:()=>true,
      nativeSelector:'.vjs-text-track-display',liveCaptionSelectors:['.vjs-text-track-cue'],
      videoSelectors:['video'],containerSelectors:[],controlsSelectors:[],sidebarSelectors:[],
      rawId:()=>'channel-english',urlOf:()=>'https://www.dw.com/en/live-tv/channel-english',
    },
    {
      id: 'tw',
      name: 'Twitch',
      hostRe: /(^|\.)twitch\.tv$/i,
      nativeSelector: '.player-captions-container, [data-a-target="player-captions-container"]',
      liveCaptionSelectors: ['[data-a-target="player-caption-text"]', '.player-captions-container span', '.captions-text'],
      matchPath: (p) => {
        const clean = p.replace(/^\/+|\/+$/g, '');
        if (!clean || /^(directory|downloads|jobs|turbo|wallet|settings|inventory|drops|subscriptions)\b/i.test(clean)) return false;
        return /^videos\/\d+/i.test(clean) || /^[^/]+(?:\/clip\/[^/]+)?$/i.test(clean);
      },
      isLivePath: (p) => !/^\/(?:videos\/|[^/]+\/clip\/)/i.test(p),
      videoSelectors: ['.video-player__container video', '[data-a-target="video-player"] video', 'video'],
      containerSelectors: ['[data-a-target="video-player"]', '.video-player__container'],
      controlsSelectors: ['.player-controls__right-control-group', '[data-a-target="player-controls-right-group"]'],
      sidebarSelectors: ['.right-column__toggle-visibility', '[data-a-target="right-column-chat-bar"]', '.stream-chat'],
      rawId: (loc) => {
        const p = String((loc && loc.pathname) || '').replace(/^\/+|\/+$/g, '');
        const vm = p.match(/^videos\/(\d+)/i);
        if (vm) return `vod_${vm[1]}`;
        return (p.split('/')[0] || '').toLowerCase();
      },
      urlOf: (id, tSec) => (/^vod_/.test(id)
        ? `https://www.twitch.tv/videos/${id.slice(4)}?t=${Math.floor(tSec || 0)}s`
        : `https://www.twitch.tv/${encodeURIComponent(id)}`),
    },
    {
      id: 'blive',
      name: 'Bilibili Live',
      hostRe: /^live\.bilibili\.com$/i,
      nativeSelector: '.bilibili-live-player-video-subtitle, .live-player-subtitle',
      liveCaptionSelectors: ['.bilibili-live-player-video-subtitle', '.live-player-subtitle'],
      matchPath: (p) => /^\/(?:blanc\/)?\d+/i.test(p),
      isLivePath: () => true,
      videoSelectors: ['#live-player video', '.live-player-mounter video', 'video'],
      containerSelectors: ['#live-player', '.live-player-mounter', '.player-section'],
      controlsSelectors: ['.live-player-mounter .right-area', '.bilibili-live-player-video-controller .right-area'],
      sidebarSelectors: ['#aside-area-vm', '.chat-history-panel'],
      rawId: (loc) => {
        const m = String((loc && loc.pathname) || '').match(/^\/(?:blanc\/)?(\d+)/);
        return m ? m[1] : '';
      },
      urlOf: (id) => `https://live.bilibili.com/${encodeURIComponent(id)}`,
      defaultLang: 'zh',
    },
    {
      id: 'cz',
      name: 'CHZZK',
      hostRe: /(^|\.)chzzk\.naver\.com$/i,
      nativeSelector: '.pzp-pc__subtitle, .pzp-pc__caption, [class*="subtitle_display"], [class*="caption_text"]',
      liveCaptionSelectors: ['.pzp-pc__subtitle', '[class*="subtitle_display"]', '[class*="caption"] span'],
      matchPath: (p) => /^\/(?:live|video)\/[A-Za-z0-9_-]+/i.test(p),
      isLivePath: (p) => /^\/live\//i.test(p),
      videoSelectors: ['.webplayer-internal-video', '#live_player_layout video', '[class*="live_player"] video', 'video'],
      containerSelectors: ['#live_player_layout', '[class*="live_player"]', '.pzp-pc'],
      controlsSelectors: ['.pzp-pc__bottom-buttons-right', '[class*="control_right"]'],
      sidebarSelectors: ['[class*="live_chatting_container"]', 'aside'],
      rawId: (loc) => {
        const m = String((loc && loc.pathname) || '').match(/^\/(?:live|video)\/([A-Za-z0-9_-]+)/);
        return m ? m[1] : '';
      },
      urlOf: (id) => `https://chzzk.naver.com/live/${encodeURIComponent(id)}`,
      defaultLang: 'ko',
    },
    {
      id: 'soop',
      name: 'SOOP Live',
      hostRe: /(^|\.)sooplive\.co\.kr$/i,
      nativeSelector: '.subtitle_layer, .caption_area',
      liveCaptionSelectors: ['.subtitle_layer', '.caption_area'],
      matchPath: (p) => /^\/[^/]+/i.test(p) && !/^\/(?:login|support|notice)/i.test(p),
      isLivePath: (p, l) => /^play\./i.test(G.SS_SITES.hostOf(l)) || !/vod/i.test(p),
      videoSelectors: ['#livePlayer video', '#videoLayer video', '.player_area video', 'video'],
      containerSelectors: ['#livePlayer', '#player_area', '#videoLayer'],
      controlsSelectors: ['.ctrl_right', '.right_ctrl'],
      sidebarSelectors: ['#chatting_area', '.chat_area'],
      rawId: (loc) => String((loc && loc.pathname) || '').replace(/^\/+|\/+$/g, '').split('/').slice(0, 2).join('_'),
      urlOf: (id) => `https://play.sooplive.co.kr/${id.replace('_', '/')}`,
      defaultLang: 'ko',
    },
    {
      id: 'kk',
      name: 'Kick',
      hostRe: /(^|\.)kick\.com$/i,
      nativeSelector: '.vjs-text-track-display',
      liveCaptionSelectors: ['.vjs-text-track-display', '[data-testid="caption-text"]'],
      matchPath: (p) => {
        const clean = p.replace(/^\/+|\/+$/g, '');
        return !!clean && !/^(browse|categories|following|transactions|dashboard|settings)\b/i.test(clean);
      },
      isLivePath: (p) => !/\/videos\//i.test(p),
      videoSelectors: ['#video-player video', '#video-holder video', '.vjs-tech', 'video'],
      containerSelectors: ['#video-player', '#video-holder', '.video-js'],
      controlsSelectors: ['.vjs-control-bar'],
      sidebarSelectors: ['#channel-chatroom'],
      rawId: (loc) => String((loc && loc.pathname) || '').replace(/^\/+|\/+$/g, '').split('/')[0] || '',
      urlOf: (id) => `https://kick.com/${encodeURIComponent(id)}`,
    },
    {
      id: 'fb',
      name: 'Facebook Live',
      hostRe: /(^|\.)(facebook\.com|fb\.watch)$/i,
      nativeSelector: '[data-testid="captions-container"]',
      liveCaptionSelectors: ['[data-testid="captions-container"]', '[data-pagelet="TahoeVideo"] [aria-live="polite"]'],
      matchPath: (p, l) => {
        if (/fb\.watch$/i.test(G.SS_SITES.hostOf(l))) return p.length > 1;
        return /\/(?:videos|live|watch|reel)\b/i.test(p) || /(?:\?|&)v=\d+/i.test(String((l && l.search) || ''));
      },
      isLivePath: (p) => /\/live\b/i.test(p),
      videoSelectors: ['[role="main"] video', 'video'],
      containerSelectors: ['[data-pagelet="TahoeVideo"]', '[role="main"] [data-visualcompletion]', 'div'],
      controlsSelectors: [],
      sidebarSelectors: [],
      rawId: (loc) => {
        const p = String((loc && loc.pathname) || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
        try {
          const v = new URLSearchParams((loc && loc.search) || '').get('v');
          if (v) return v;
        } catch (e) {}
        return p.slice(0, 64) || 'fb_live';
      },
      urlOf: (id) => `https://www.facebook.com/watch/?v=${encodeURIComponent(id)}`,
    },
    {
      id: 'tt',
      name: 'TikTok Live',
      hostRe: /(^|\.)tiktok\.com$/i,
      nativeSelector: '[data-e2e="live-captions"]',
      liveCaptionSelectors: ['[data-e2e="live-captions"]'],
      matchPath: (p) => /^\/@[^/]+\/live\b/i.test(p),
      isLivePath: () => true,
      videoSelectors: ['[data-e2e="feed-video"] video', 'main video', 'video'],
      containerSelectors: ['[data-e2e="feed-video"]', 'main'],
      controlsSelectors: [],
      sidebarSelectors: [],
      rawId: (loc) => {
        const m = String((loc && loc.pathname) || '').match(/^\/@([^/]+)/);
        return m ? m[1] : 'live';
      },
      urlOf: (id) => `https://www.tiktok.com/@${encodeURIComponent(id)}/live`,
    },
  ];

  const queryFirst = (selectors) => {
    if (typeof document === 'undefined' || !document.querySelector) return null;
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  };

  for (const spec of LIVE_SPECS) {
    G.SS_SITES.register({
      id: spec.id,
      name: spec.name,
      nativeSelector: spec.nativeSelector,
      liveCaptionSelectors: spec.liveCaptionSelectors,
      defaultLang: spec.defaultLang || '',
      isHost: (loc) => spec.hostRe.test(G.SS_SITES.hostOf(loc)),
      match: (loc) => {
        const l = loc || G.location;
        if (!l || !spec.hostRe.test(G.SS_SITES.hostOf(l))) return false;
        return spec.matchPath(String(l.pathname || '/'), l);
      },
      isShorts: () => false,
      isLive: (loc) => spec.isLivePath(String(((loc || G.location || {}).pathname) || '/'), loc || G.location),
      video: () => G.SS_SITES.pickMainVideo(document, spec.videoSelectors, ['[aria-hidden="true"]', '.ad-container']),
      container: () => {
        if (typeof document !== 'undefined' && document.fullscreenElement) return document.fullscreenElement;
        const c = queryFirst(spec.containerSelectors);
        if (c && spec.containerSelectors[0] !== 'div') return c;
        const v = G.SS_SITES.pickMainVideo(document, spec.videoSelectors, []);
        return (v && v.parentElement) || (typeof document !== 'undefined' ? document.body : null);
      },
      controlsTarget: () => queryFirst(spec.controlsSelectors),
      inlineSidebar: () => queryFirst(spec.sidebarSelectors),
      rawVideoId: (loc) => spec.rawId(loc || G.location),
      videoKey: (rawId) => {
        const clean = String(rawId || spec.rawId(G.location) || '').replace(new RegExp(`^${spec.id}:`), '');
        return clean ? `${spec.id}:${clean}` : '';
      },
      videoUrl: (rawId, tSec) => spec.urlOf(String(rawId || '').replace(new RegExp(`^${spec.id}:`), ''), tSec),
      onNavigate: (cb) => G.SS_SITES.watchUrlChanges(G, document, cb),
      isAd: () => false,
      seek: (sec) => {
        const v = G.SS_SITES.pickMainVideo(document, spec.videoSelectors, []);
        if (v) v.currentTime = Math.max(0, sec) + 0.01;
      },
      nativeOff: () => {
        G.SS_SITES.setNativeCaptionHidden(document, `ss-hide-native-${spec.id}`, spec.nativeSelector, true);
        return true;
      },
      nativeOn: () => {
        G.SS_SITES.setNativeCaptionHidden(document, `ss-hide-native-${spec.id}`, spec.nativeSelector, false);
        return true;
      },
      features: { search: false, shorts: false, recommendations: false, stageLayout: false, ytMt: false, live: true },
    });
  }
})();
