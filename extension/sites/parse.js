// Pure, zero-DOM subtitle parsers for YouTube json3, WebVTT, TTML/IMSC/DFXP, Bilibili BCC JSON,
// and HLS-segmented WebVTT (with X-TIMESTAMP-MAP offsets & cross-segment boundary deduplication).
// Output model: [{ t, s, e }] (text, start seconds, end seconds, rounded to 1 ms).
(() => {
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.SS_PARSE) return;

  const roundMs = (sec) => Math.round(Number(sec || 0) * 1000) / 1000;

  const ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    lrm: '',
    rlm: '',
    mdash: '—',
    ndash: '–',
    hellip: '…',
  };

  const decodeEntities = (str) =>
    String(str || '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code) => {
      if (code[0] === '#') {
        const cp = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : m;
      }
      const low = code.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, low) ? ENTITIES[low] : m;
    });

  // CJK characters (Han, Hiragana, Katakana, CJK punctuation/fullwidth; excludes Hangul where words use spaces)
  const CJK_NO_SPACE_RE = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

  const joinSubtitleLines = (lines) => {
    const cleaned = [];
    for (const raw of lines) {
      const s = String(raw || '').replace(/[ \t\r]+/g, ' ').trim();
      if (s) cleaned.push(s);
    }
    if (!cleaned.length) return '';
    let acc = cleaned[0];
    for (let i = 1; i < cleaned.length; i++) {
      const nxt = cleaned[i];
      const prevChar = acc[acc.length - 1];
      const nextChar = nxt[0];
      const noSpace = CJK_NO_SPACE_RE.test(prevChar) && CJK_NO_SPACE_RE.test(nextChar);
      acc += (noSpace ? '' : ' ') + nxt;
    }
    return acc.replace(/\s{2,}/g, ' ').trim();
  };

  // Strip markup tags (VTT <c>, <i>, <v Speaker>, inline timestamps <00:01.000>, ruby <rt>, ASS {\an8}) and join lines.
  const cleanMarkupText = (rawHtml) => {
    let s = String(rawHtml || '');
    // Remove <rt>...</rt> and <rp>...</rp> ruby readings so furigana never concatenates into base kanji
    s = s.replace(/<r[tp]\b[^>]*>[\s\S]*?<\/r[tp]>/gi, '');
    // Remove TTML inline ruby text/delimiter spans (Netflix IMSC1.1: tts:ruby="text" / tts:ruby="delimiter")
    s = s.replace(/<(?:[a-zA-Z0-9_-]+:)?span\b[^>]*\b(?:[a-zA-Z0-9_-]+:)?ruby\s*=\s*["'](?:text|delimiter)["'][^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?span>/gi, '');
    // Convert <br>, <br/>, <tt:br/> breaks to \n
    s = s.replace(/<(?:[a-zA-Z0-9_-]+:)?br\s*\/?>/gi, '\n');
    // Handle WebVTT voice tags <v Speaker Name>text</v> -> text
    s = s.replace(/<v(?:\.[^\s/>]*)?\s+[^>]*>/gi, '');
    // Strip all remaining XML/HTML/VTT tags (including self-closing <tt:span/>, <00:00:01.200>, <c.yellow>, </span>, etc.)
    s = s.replace(/<\/?[a-zA-Z0-9_:-]+(?:\.[^\s/>]*)?(?:\s+[^>]*)?\/?>/g, '');
    s = s.replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, '');
    // Strip ASS/SSA override blocks {\an8}
    s = s.replace(/\{\\[^}]*\}/g, '');
    s = decodeEntities(s);
    return joinSubtitleLines(s.split(/\r?\n/));
  };

  // -------------------------------------------------------------------------
  // 1. YouTube JSON3 Parser (with ASR word-rolling overlap trim & sentence merge)
  // -------------------------------------------------------------------------
  const SENT_END_RE = /[.!?。！？…]["'”’）)]*$/;

  const parseJson3 = (input, opts = {}) => {
    const j = typeof input === 'string' ? JSON.parse(input) : (input || {});
    const events = Array.isArray(j.events) ? j.events : [];
    const raw = [];
    let sawAsrSignal = false;

    for (const ev of events) {
      if (!ev || !Array.isArray(ev.segs)) continue;
      if (ev.aAppend) sawAsrSignal = true;
      let sumConf = 0;
      let nConf = 0;
      const parts = [];
      for (const seg of ev.segs) {
        const u = seg && seg.utf8 != null ? String(seg.utf8) : '';
        if (u === '\n') continue;
        parts.push(u);
        if (typeof (seg && seg.acAsrConf) === 'number') {
          sawAsrSignal = true;
          sumConf += seg.acAsrConf > 1 ? seg.acAsrConf / 255 : seg.acAsrConf;
          nConf++;
        }
        if (seg && seg.tOffsetMs) sawAsrSignal = true;
      }
      const t = joinSubtitleLines(decodeEntities(parts.join('')).split(/\r?\n/));
      if (!t) continue;
      const s = roundMs((ev.tStartMs || 0) / 1000);
      const dur = (ev.dDurationMs != null ? ev.dDurationMs : 2500) / 1000;
      const e = roundMs(s + Math.max(0.05, dur));
      const item = { t, s, e };
      if (opts.keepConf && nConf > 0) {
        item.conf = Math.round((sumConf / nConf) * 100) / 100;
      }
      raw.push(item);
    }

    const isAsr = opts.isAsr != null ? !!opts.isAsr : sawAsrSignal;
    if (!isAsr || raw.length < 2) return raw;

    // Trim overlapping roll-up end times so cue i ends cleanly when cue i+1 starts
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i + 1].s > raw[i].s && raw[i].e > raw[i + 1].s) {
        raw[i].e = roundMs(Math.max(raw[i].s + 0.15, raw[i + 1].s));
      }
    }
    if (opts.mergeClauses === false) return raw;

    const merged = [];
    const hasSpaces = raw.slice(0, 12).some((x) => /[A-Za-z\u0400-\u04ff]/.test(x.t));
    const maxChars = hasSpaces ? 62 : 34;
    for (const cue of raw) {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push(Object.assign({}, cue));
        continue;
      }
      const gap = cue.s - prev.e;
      const totalDur = cue.e - prev.s;
      const canJoin =
        gap <= 0.42 &&
        totalDur <= 6.5 &&
        !SENT_END_RE.test(prev.t) &&
        prev.t.length + cue.t.length + 1 <= maxChars;
      if (canJoin) {
        const sep = hasSpaces && !/\s$/.test(prev.t) && !/^[,.;:!?]/.test(cue.t) ? ' ' : '';
        prev.t = prev.t + sep + cue.t;
        prev.e = roundMs(cue.e);
        if (prev.conf != null && cue.conf != null) prev.conf = Math.min(prev.conf, cue.conf);
      } else {
        merged.push(Object.assign({}, cue));
      }
    }
    return merged;
  };

  // -------------------------------------------------------------------------
  // 2. WebVTT & HLS-Segmented WebVTT Parser (X-TIMESTAMP-MAP + Border Dedupe)
  // -------------------------------------------------------------------------
  const parseVttTimestamp = (ts) => {
    const m = String(ts || '').trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return NaN;
    const hh = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    const ms = parseInt(m[4].padEnd(3, '0'), 10);
    return hh * 3600 + mm * 60 + ss + ms / 1000;
  };

  // Parse RFC 8216 X-TIMESTAMP-MAP header: e.g. X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000 -> +10.0s
  const parseXTimestampMap = (headerBlock) => {
    const m = String(headerBlock || '').match(/X-TIMESTAMP-MAP\s*=\s*([^\r\n]+)/i);
    if (!m) return 0;
    const spec = m[1];
    const mpegM = spec.match(/MPEGTS\s*:\s*(\d+)/i);
    const localM = spec.match(/LOCAL\s*:\s*([0-9:.]+)/i);
    if (!mpegM) return 0;
    const mpegSec = parseInt(mpegM[1], 10) / 90000;
    const localSec = localM ? (parseVttTimestamp(localM[1]) || 0) : 0;
    return mpegSec - localSec;
  };

  const parseVtt = (vttText, opts = {}) => {
    const src = String(vttText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!src.trim()) return [];
    const blocks = src.split(/\n{2,}/);
    let mapOffset = 0;
    const extraOffset = Number(opts.offsetSec || 0);
    const out = [];

    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi].trim();
      if (!blk) continue;
      if (bi === 0 && /^WEBVTT\b/i.test(blk)) {
        mapOffset = parseXTimestampMap(blk);
        // Occasionally a cue immediately follows header lines with only a single \n
        const hdrLines = blk.split('\n');
        const arrowIdx = hdrLines.findIndex((l) => l.includes('-->'));
        if (arrowIdx < 0) continue;
        const subBlk = hdrLines.slice(arrowIdx).join('\n');
        const subCues = parseVtt('WEBVTT\n\n' + subBlk, { offsetSec: mapOffset + extraOffset });
        out.push(...subCues);
        continue;
      }
      if (/^(?:NOTE|STYLE|REGION)\b/i.test(blk)) continue;
      if (/^X-TIMESTAMP-MAP/i.test(blk)) {
        mapOffset = parseXTimestampMap(blk);
        continue;
      }

      const lines = blk.split('\n');
      const arrowLineIdx = lines.findIndex((l) => l.includes('-->'));
      if (arrowLineIdx < 0) continue;

      const timingLine = lines[arrowLineIdx];
      const tm = timingLine.match(/^\s*([0-9:.,]+)\s*-->\s*([0-9:.,]+)/);
      if (!tm) continue;
      const s0 = parseVttTimestamp(tm[1]);
      const e0 = parseVttTimestamp(tm[2]);
      if (!Number.isFinite(s0) || !Number.isFinite(e0)) continue;

      const textBody = lines.slice(arrowLineIdx + 1).join('\n');
      const t = cleanMarkupText(textBody);
      if (!t) continue;

      const s = roundMs(Math.max(0, s0 + mapOffset + extraOffset));
      const e = roundMs(Math.max(s + 0.001, e0 + mapOffset + extraOffset));
      out.push({ t, s, e });
    }
    return out;
  };

  // Concatenate & deduplicate HLS WebVTT segments (Disney+ .m3u8 subtitle streams)
  const parseHlsVttSegments = (segments, opts = {}) => {
    const all = [];
    for (const seg of segments || []) {
      if (!seg) continue;
      const text = typeof seg === 'string' ? seg : seg.text;
      const segOff = typeof seg === 'object' && seg.offsetSec != null ? seg.offsetSec : (opts.offsetSec || 0);
      const cues = parseVtt(text, { offsetSec: segOff });
      all.push(...cues);
    }
    if (!all.length) return [];
    all.sort((a, b) => a.s - b.s || a.e - b.e);

    const deduped = [];
    for (const cue of all) {
      const prev = deduped[deduped.length - 1];
      if (
        prev &&
        prev.t === cue.t &&
        (Math.abs(cue.s - prev.s) <= 0.05 || cue.s <= prev.e + 0.25)
      ) {
        prev.e = roundMs(Math.max(prev.e, cue.e));
      } else {
        deduped.push({ t: cue.t, s: cue.s, e: cue.e });
      }
    }
    return deduped;
  };

  // -------------------------------------------------------------------------
  // 3. TTML / IMSC1.1 / DFXP / TTML2 Parser (Netflix & Prime Video, Zero DOM)
  // -------------------------------------------------------------------------
  const parseTtmlTime = (raw, ctx) => {
    if (raw == null) return NaN;
    const val = String(raw).trim();
    if (!val) return NaN;
    const tickRate = (ctx && ctx.tickRate) || 10000000;
    const fps = (ctx && ctx.fps) || 24;

    // Offset-time: 12500000t, 1500ms, 1.5s, 2m, 1h, 24f
    const offM = val.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/i);
    if (offM) {
      const n = parseFloat(offM[1]);
      const u = offM[2].toLowerCase();
      if (u === 't') return n / tickRate;
      if (u === 'ms') return n / 1000;
      if (u === 's') return n;
      if (u === 'm') return n * 60;
      if (u === 'h') return n * 3600;
      if (u === 'f') return n / fps;
    }

    // Clock-time: HH:MM:SS.mmm or HH:MM:SS:FF (frames)
    const clkM = val.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:[.,](\d+)|:(\d{1,3}))?$/);
    if (clkM) {
      const hh = parseInt(clkM[1], 10);
      const mm = parseInt(clkM[2], 10);
      const ss = parseInt(clkM[3], 10);
      const frac = clkM[4] ? parseFloat('0.' + clkM[4]) : 0;
      const frames = clkM[5] ? parseInt(clkM[5], 10) / fps : 0;
      return hh * 3600 + mm * 60 + ss + frac + frames;
    }
    return NaN;
  };

  const getXmlAttr = (attrStr, localName) => {
    const re = new RegExp(`(?:^|\\s)(?:[a-zA-Z0-9_-]+:)?${localName}\\s*=\\s*["']([^"']*)["']`, 'i');
    const m = String(attrStr || '').match(re);
    return m ? m[1] : null;
  };

  const parseTtml = (xmlText) => {
    const xml = String(xmlText || '');
    if (!xml.trim()) return [];

    const ttOpen = xml.match(/<(?:[a-zA-Z0-9_-]+:)?tt\b([^>]*)>/i);
    const ttAttrs = ttOpen ? ttOpen[1] : '';
    const tickRateAttr = getXmlAttr(ttAttrs, 'tickRate');
    const frameRateAttr = getXmlAttr(ttAttrs, 'frameRate');
    const multAttr = getXmlAttr(ttAttrs, 'frameRateMultiplier');

    const tickRate = tickRateAttr ? parseFloat(tickRateAttr) || 10000000 : 10000000;
    let fps = frameRateAttr ? parseFloat(frameRateAttr) || 24 : 24;
    if (multAttr) {
      const mp = multAttr.trim().split(/\s+/);
      if (mp.length === 2 && Number(mp[1])) fps = (fps * Number(mp[0])) / Number(mp[1]);
    }
    const ctx = { tickRate, fps };

    const rawCues = [];
    const pRe = /<(?:[a-zA-Z0-9_-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?p>/gi;
    let m;
    while ((m = pRe.exec(xml))) {
      const attrs = m[1] || '';
      const inner = m[2] || '';
      const bStr = getXmlAttr(attrs, 'begin');
      const eStr = getXmlAttr(attrs, 'end');
      const dStr = getXmlAttr(attrs, 'dur');
      const s0 = parseTtmlTime(bStr, ctx);
      if (!Number.isFinite(s0)) continue;
      let e0 = parseTtmlTime(eStr, ctx);
      if (!Number.isFinite(e0)) {
        const dur = parseTtmlTime(dStr, ctx);
        e0 = Number.isFinite(dur) ? s0 + dur : s0 + 2.5;
      }
      const t = cleanMarkupText(inner);
      if (!t) continue;
      rawCues.push({ t, s: roundMs(s0), e: roundMs(Math.max(s0 + 0.001, e0)) });
    }

    if (!rawCues.length) return [];
    rawCues.sort((a, b) => a.s - b.s || a.e - b.e);

    // Merge simultaneous multi-region cues (e.g. speaker 1 + speaker 2 at identical [s, e] timestamps)
    const merged = [];
    for (const c of rawCues) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.s - c.s) <= 0.002 && Math.abs(prev.e - c.e) <= 0.002) {
        if (prev.t !== c.t) prev.t = joinSubtitleLines([prev.t, c.t]);
      } else {
        merged.push(c);
      }
    }
    return merged;
  };

  // -------------------------------------------------------------------------
  // 4. Bilibili BCC JSON Parser
  // -------------------------------------------------------------------------
  const parseBcc = (bccInput) => {
    const j = typeof bccInput === 'string' ? JSON.parse(bccInput) : (bccInput || {});
    const body = Array.isArray(j.body) ? j.body : (Array.isArray(j) ? j : []);
    const out = [];
    for (const row of body) {
      if (!row) continue;
      const s0 = Number(row.from != null ? row.from : row.s);
      const e0 = Number(row.to != null ? row.to : row.e);
      if (!Number.isFinite(s0) || !Number.isFinite(e0)) continue;
      const rawContent = row.content != null ? row.content : (row.t || '');
      const t = cleanMarkupText(rawContent);
      if (!t) continue;
      out.push({
        t,
        s: roundMs(s0),
        e: roundMs(Math.max(s0 + 0.001, e0)),
      });
    }
    return out;
  };

  // Auto-detect subtitle format when site CDN serves either WebVTT or TTML/DFXP XML or JSON
  const parseAuto = (payload, opts = {}) => {
    if (!payload) return [];
    if (typeof payload === 'object') {
      if (Array.isArray(payload.events)) return parseJson3(payload, opts);
      if (Array.isArray(payload.body)) return parseBcc(payload);
    }
    const str = String(payload).replace(/^\uFEFF/, '').trim();
    if (!str) return [];
    if (str[0] === '{') {
      const obj = JSON.parse(str);
      if (Array.isArray(obj.events)) return parseJson3(obj, opts);
      if (Array.isArray(obj.body)) return parseBcc(obj);
    }
    if (/^WEBVTT\b/i.test(str) || /^\d*\s*\r?\n?\d{1,2}:\d{2}/.test(str)) {
      return parseVtt(str, opts);
    }
    if (str[0] === '<') {
      return parseTtml(str);
    }
    return [];
  };

  const api = {
    roundMs,
    decodeEntities,
    joinSubtitleLines,
    cleanMarkupText,
    parseJson3,
    parseVtt,
    parseHlsVttSegments,
    parseTtml,
    parseTtmlTime,
    parseBcc,
    parseAuto,
  };

  G.SS_PARSE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
