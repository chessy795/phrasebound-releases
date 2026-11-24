// Bilibili MAIN-world subtitle & player adapter (www.bilibili.com/video/* and /bangumi/play/*).
// Intercepts /x/player/wbi/v2 & /x/player/v2 subtitle lists, reads window.__INITIAL_STATE__ for
// bvid/aid/cid & multi-part (?p=2) / bangumi episode switches, normalizes // subtitle URLs, and parses BCC JSON.
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.__ssBiliPage) return;
  G.__ssBiliPage = true;

  // Map key `${bvid || aid}:${cid}` -> raw subtitles[] from Bilibili player API
  const subListCache = new Map();
  let lastInterceptedSubtitles = null;

  const normBiliLang = (lan) => {
    const raw = String(lan || '').trim();
    const low = raw.toLowerCase();
    const stripped = low.replace(/^ai-/, '');
    if (stripped === 'yue' || stripped === 'zh-hk' || stripped.includes('cantonese')) return 'yue';
    if (stripped === 'zh-hant' || stripped === 'zh-tw' || stripped === 'zh-mo') return 'zh-Hant';
    if (stripped === 'zh-hans' || stripped === 'zh-cn' || stripped === 'zh' || stripped === 'cmn') return 'zh-Hans';
    return stripped || 'zh-Hans';
  };

  const toHttpsUrl = (u) => {
    const s = String(u || '').trim();
    if (!s) return '';
    if (s.startsWith('//')) return 'https:' + s;
    if (s.startsWith('http://')) return 'https://' + s.slice(7);
    return s;
  };

  const convertSubList = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t) => t && t.subtitle_url)
      .map((t, idx) => {
        const rawLan = String(t.lan || '');
        const isAsr = rawLan.toLowerCase().startsWith('ai-') || Number(t.ai_type || 0) > 0;
        const lang = normBiliLang(rawLan);
        const label = t.lan_doc || rawLan || lang;
        const url = toHttpsUrl(t.subtitle_url);
        return {
          id: String(t.id_str || t.id || `${rawLan}:${idx}`),
          lang,
          rawLan,
          label,
          name: label,
          kind: isAsr ? 'asr' : 'human',
          auto: isAsr,
          url,
          baseUrl: url,
          translatable: false,
        };
      });
  };

  const capturePlayerJson = (urlStr, dataObj) => {
    try {
      if (!dataObj || typeof dataObj !== 'object') return;
      const d = dataObj.data || dataObj.result || dataObj;
      const subs = d && d.subtitle && (d.subtitle.subtitles || d.subtitle.list);
      if (!Array.isArray(subs)) return;
      const converted = convertSubList(subs);
      lastInterceptedSubtitles = converted;
      if (urlStr) {
        const q = new URL(urlStr, location.origin).searchParams;
        const cid = q.get('cid') || (d && d.cid) || '';
        const bvid = q.get('bvid') || (d && d.bvid) || '';
        const aid = q.get('aid') || (d && d.aid) || '';
        if (cid) {
          if (bvid) subListCache.set(`${bvid}:${cid}`, converted);
          if (aid) subListCache.set(`${aid}:${cid}`, converted);
          subListCache.set(`cid:${cid}`, converted);
        }
      }
    } catch (e) {}
  };

  const of = G.fetch ? G.fetch.bind(G) : null;
  if (of) {
    G.fetch = async function (input, init) {
      const resp = await of(input, init);
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\/x\/player\/(?:wbi\/)?v2|\/pgc\/player\/web\/playurl/i.test(u)) {
          resp.clone().json().then((j) => capturePlayerJson(u, j)).catch(() => {});
        }
      } catch (e) {}
      return resp;
    };
  }

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
    const xo = XMLHttpRequest.prototype.open;
    const xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__ssUrl = String(u || '');
      return xo.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const u = this.__ssUrl || '';
      if (/\/x\/player\/(?:wbi\/)?v2|\/pgc\/player\/web\/playurl/i.test(u)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseText && this.responseText[0] === '{') {
              capturePlayerJson(u, JSON.parse(this.responseText));
            }
          } catch (e) {}
        });
      }
      return xs.apply(this, arguments);
    };
  }

  const resolveCurrentState = () => {
    const st = G.__INITIAL_STATE__ || {};
    const path = String(location.pathname || '');
    const qs = new URLSearchParams(location.search || '');
    const pageNum = Math.max(1, parseInt(qs.get('p') || String(st.p || '1'), 10) || 1);

    // Bangumi / anime / cinema episodes (/bangumi/play/ep12345 or ss12345)
    if (path.startsWith('/bangumi/play')) {
      const ep = st.epInfo || {};
      const media = st.mediaInfo || {};
      const cid = ep.cid || '';
      const bvid = ep.bvid || '';
      const aid = ep.aid || '';
      const epId = ep.id || (path.match(/ep(\d+)/i) || [])[1] || '';
      const videoId = epId ? `ep${epId}` : (bvid && cid ? `${bvid}_${cid}` : bvid || String(aid || ''));
      const title = [media.title, ep.titleFormat, ep.longTitle].filter(Boolean).join(' · ') || document.title || '';
      return { bvid, aid, cid, p: 1, videoId, title, author: (media.upInfo && media.upInfo.uname) || '', durationSec: Math.round((ep.duration || 0) / 1000) };
    }

    // Standard UGC video (/video/BV1xx... or /video/av123...)
    const vd = st.videoData || {};
    const bvid = vd.bvid || st.bvid || (path.match(/\/video\/(BV[A-Za-z0-9]+)/i) || [])[1] || '';
    const aid = vd.aid || st.aid || (path.match(/\/video\/av(\d+)/i) || [])[1] || '';
    const pages = Array.isArray(vd.pages) ? vd.pages : [];
    const curPage = pages[pageNum - 1] || pages[0] || {};
    const cid = curPage.cid || vd.cid || st.cid || '';
    const baseId = bvid || (aid ? `av${aid}` : '');
    const videoId = baseId ? (pages.length > 1 && cid ? `${baseId}_p${pageNum}_${cid}` : baseId) : '';
    const partSuffix = pages.length > 1 && curPage.part ? ` (P${pageNum}: ${curPage.part})` : '';
    const title = (vd.title ? vd.title + partSuffix : '') || document.title.replace(/_哔哩哔哩.*$/, '').trim();
    const author = (vd.owner && vd.owner.name) || '';
    const durationSec = Number(curPage.duration || vd.duration || 0);
    return { bvid, aid, cid, p: pageNum, videoId, title, author, durationSec };
  };

  const fetchTracksForState = async (meta) => {
    const { bvid, aid, cid } = meta;
    if (cid) {
      const hit = (bvid && subListCache.get(`${bvid}:${cid}`))
        || (aid && subListCache.get(`${aid}:${cid}`))
        || subListCache.get(`cid:${cid}`);
      if (hit) return hit;
    }
    if (of && cid && (bvid || aid)) {
      const q = new URLSearchParams();
      if (bvid) q.set('bvid', String(bvid));
      else if (aid) q.set('aid', String(aid));
      q.set('cid', String(cid));
      for (const ep of ['https://api.bilibili.com/x/player/wbi/v2', 'https://api.bilibili.com/x/player/v2']) {
        try {
          const r = await of(`${ep}?${q.toString()}`, { credentials: 'include' });
          if (!r.ok) continue;
          const j = await r.json();
          capturePlayerJson(`${ep}?${q.toString()}`, j);
          const got = subListCache.get(`cid:${cid}`);
          if (got) return got;
        } catch (e) {}
      }
    }
    return lastInterceptedSubtitles || [];
  };

  const getInfo = async () => {
    const meta = resolveCurrentState();
    if (!meta.videoId) return null;
    const tracks = await fetchTracksForState(meta);
    const asr = tracks.find((t) => t.kind === 'asr');
    const lang = (asr && asr.lang) || (tracks[0] && tracks[0].lang) || 'zh-Hans';
    return {
      site: 'bili',
      videoId: meta.videoId,
      title: meta.title,
      author: meta.author,
      channelId: meta.author ? `bili:${meta.author}` : '',
      durationSec: meta.durationSec || 0,
      lang,
      tracks,
      tlangs: [],
    };
  };

  const handlers = {
    info: async () => await getInfo(),
    tracks: async () => {
      const inf = await getInfo();
      return (inf && inf.tracks) || [];
    },
    subs: async (m) => {
      const inf = await getInfo();
      const tracks = (inf && inf.tracks) || [];
      let trk = m.track || null;
      if (!trk && m.trackId) {
        trk = tracks.find((t) => t.id === String(m.trackId) || t.lang === m.trackId || t.rawLan === m.trackId) || null;
      }
      const rawUrl = trk && (trk.url || trk.baseUrl);
      if (!rawUrl || !of) return null;
      const url = toHttpsUrl(rawUrl);
      const r = await of(url, { credentials: 'omit' });
      if (!r.ok) return null;
      const j = await r.json();
      if (G.SS_PARSE && G.SS_PARSE.parseBcc) {
        const cues = G.SS_PARSE.parseBcc(j);
        return cues.map((c) => Object.assign({}, c, { d: Math.round((c.e - c.s) * 1000) / 1000 }));
      }
      return [];
    },
    nativeOff: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-bili', '.bpx-player-subtitle-wrap', true);
      return true;
    },
    nativeOn: () => {
      if (G.SS_SITES) G.SS_SITES.setNativeCaptionHidden(document, 'ss-hide-native-bili', '.bpx-player-subtitle-wrap', false);
      return true;
    },
    seek: (m) => {
      const v = document.querySelector('.bpx-player-video-wrap video, #bilibili-player video, video');
      if (v) {
        v.currentTime = Math.max(0, Number(m.sec || 0)) + 0.01;
        return true;
      }
      return false;
    },
  };

  if (G.SS_SITES && G.SS_SITES.servePage) G.SS_SITES.servePage('bili', handlers);
})();
