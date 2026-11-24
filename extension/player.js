/**
 * Subtitle Study — Standalone Local Video & Subtitle Study Player (player.js)
 * Clean-room Manifest V3 module: pure vanilla JS, strict DOM node construction.
 * Exports parsers & SRT exporter on `globalThis.SS_LOCAL_PLAYER` for Node testing.
 */
(function (root) {
  'use strict';

  const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '',
  };

  function roundMillis(seconds) {
    return Math.round(seconds * 1000) / 1000;
  }

  function decodeHtmlEntities(input) {
    return String(input || '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity) => {
      if (entity.charAt(0) === '#') {
        const isHex = entity.charAt(1) === 'x' || entity.charAt(1) === 'X';
        const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
        if (!Number.isNaN(code) && code > 0 && code <= 0x10ffff) {
          try { return String.fromCodePoint(code); } catch (_) { return full; }
        }
        return full;
      }
      const lower = entity.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : full;
    });
  }

  function cleanMarkupText(raw) {
    const withoutTags = String(raw || '').replace(/\{\\[^}]*\}/g, '').replace(/<[^>]*>/g, '');
    return decodeHtmlEntities(withoutTags)
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }

  function parseSrtOrVttTimestamp(token, allowOptionalHours) {
    const cleaned = String(token || '').trim();
    const fullMatch = /^(\d{1,3}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/.exec(cleaned);
    if (fullMatch) {
      return parseInt(fullMatch[1], 10) * 3600 + parseInt(fullMatch[2], 10) * 60 +
        parseInt(fullMatch[3], 10) + parseInt(fullMatch[4].padEnd(3, '0'), 10) / 1000;
    }
    if (allowOptionalHours) {
      const shortMatch = /^([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/.exec(cleaned);
      if (shortMatch) {
        return parseInt(shortMatch[1], 10) * 60 + parseInt(shortMatch[2], 10) +
          parseInt(shortMatch[3].padEnd(3, '0'), 10) / 1000;
      }
    }
    return NaN;
  }

  function parseSrt(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return [];
    const blocks = normalized.split(/\n{2,}/);
    const cues = [];
    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].split('\n').map((l) => l.trimEnd());
      const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
      if (timeLineIdx === -1) continue;
      const arrowParts = lines[timeLineIdx].split('-->');
      if (arrowParts.length < 2) continue;
      const startSec = parseSrtOrVttTimestamp(arrowParts[0].trim(), false);
      const endSec = parseSrtOrVttTimestamp(arrowParts[1].trim().split(/\s+/)[0], false);
      if (Number.isNaN(startSec) || Number.isNaN(endSec)) continue;
      const cleanBody = cleanMarkupText(lines.slice(timeLineIdx + 1).join('\n'));
      if (!cleanBody) continue;
      cues.push({ s: roundMillis(startSec), d: roundMillis(Math.max(0, endSec - startSec)), t: cleanBody });
    }
    return cues;
  }

  function parseVtt(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return [];
    const blocks = normalized.split(/\n{2,}/);
    const cues = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;
      if (i === 0 && /^WEBVTT(?:\s|$)/i.test(block) && !block.includes('-->')) continue;
      const firstLine = block.split('\n')[0].trim();
      if (/^(STYLE|REGION|NOTE)(?:\s|$)/i.test(firstLine) && !firstLine.includes('-->')) continue;
      const lines = block.split('\n');
      const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
      if (timeLineIdx === -1) continue;
      const arrowParts = lines[timeLineIdx].split('-->');
      if (arrowParts.length < 2) continue;
      const startSec = parseSrtOrVttTimestamp(arrowParts[0].trim().split(/\s+/)[0], true);
      const endSec = parseSrtOrVttTimestamp(arrowParts[1].trim().split(/\s+/)[0], true);
      if (Number.isNaN(startSec) || Number.isNaN(endSec)) continue;
      const cleanBody = cleanMarkupText(lines.slice(timeLineIdx + 1).join('\n'));
      if (!cleanBody) continue;
      cues.push({ s: roundMillis(startSec), d: roundMillis(Math.max(0, endSec - startSec)), t: cleanBody });
    }
    return cues;
  }

  function parseAssTimestamp(token) {
    const m = /^(\d+):([0-5]?\d):([0-5]?\d)[.:](\d{1,3})$/.exec(String(token || '').trim());
    if (!m) return NaN;
    const fracRaw = m[4];
    const fracSec = fracRaw.length === 3 ? parseInt(fracRaw, 10) / 1000 : parseInt(fracRaw.padEnd(2, '0'), 10) / 100;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + fracSec;
  }

  function splitWithRemainder(input, delimiter, maxSplits) {
    const out = [];
    let start = 0;
    for (let i = 0; i < maxSplits; i++) {
      const idx = input.indexOf(delimiter, start);
      if (idx === -1) { out.push(input.slice(start)); return out; }
      out.push(input.slice(start, idx));
      start = idx + delimiter.length;
    }
    out.push(input.slice(start));
    return out;
  }

  function cleanAssDialogueText(rawText) {
    let working = String(rawText || '');
    working = working.replace(/\{[^}]*\\p[1-9]\d*[^}]*\}[\s\S]*?(?:\{[^}]*\\p0[^}]*\}|$)/g, '');
    working = working.replace(/\{[^}]*\}/g, '');
    working = working.replace(/\\h/g, ' ').replace(/\\[Nn]/g, '\n');
    return working.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  }

  function parseAss(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) return [];
    const lines = normalized.split('\n');
    let inEvents = false;
    let formatCols = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const cues = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';')) continue;
      if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
      if (!inEvents) continue;
      if (/^format\s*:/i.test(line)) {
        const parsedCols = line.slice(line.indexOf(':') + 1).split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
        if (parsedCols.length >= 3) formatCols = parsedCols;
        continue;
      }
      if (/^dialogue\s*:/i.test(line)) {
        const payload = lines[i].slice(lines[i].indexOf(':') + 1).trimStart();
        const parts = splitWithRemainder(payload, ',', formatCols.length - 1);
        if (parts.length < formatCols.length) continue;
        const startIdx = formatCols.indexOf('start');
        const endIdx = formatCols.indexOf('end');
        const textIdx = formatCols.indexOf('text');
        if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;
        const startSec = parseAssTimestamp(parts[startIdx]);
        const endSec = parseAssTimestamp(parts[endIdx]);
        if (Number.isNaN(startSec) || Number.isNaN(endSec)) continue;
        const cleanBody = cleanAssDialogueText(parts[textIdx]);
        if (!cleanBody) continue;
        cues.push({ s: roundMillis(startSec), d: roundMillis(Math.max(0, endSec - startSec)), t: cleanBody });
      }
    }
    return cues;
  }

  function formatSrtTimestamp(seconds) {
    const clampedMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const hh = Math.floor(clampedMs / 3600000);
    const mm = Math.floor((clampedMs % 3600000) / 60000);
    const ss = Math.floor((clampedMs % 60000) / 1000);
    const ms = clampedMs % 1000;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' +
      String(ss).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
  }

  function formatShortClock(seconds) {
    const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  function unwrapSecondaryEntry(val) {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'object') return String(val.translation ?? val.t ?? val.text ?? '').trim();
    return String(val).trim();
  }

  function resolveSecondaryForCue(cue, idx, secondaryMap) {
    if (!secondaryMap) return '';
    if (secondaryMap instanceof Map) {
      for (const k of [idx, String(idx), cue.id, cue.s, cue.t]) {
        if (k !== undefined && secondaryMap.has(k)) return unwrapSecondaryEntry(secondaryMap.get(k));
      }
      return '';
    }
    if (Array.isArray(secondaryMap)) {
      if (secondaryMap.length === 0) return '';
      if (typeof secondaryMap[0] === 'string') return unwrapSecondaryEntry(secondaryMap[idx]);
      const cueStart = cue.s, cueEnd = cue.s + (cue.d || 0), mid = (cueStart + cueEnd) / 2;
      const matched = [];
      for (let i = 0; i < secondaryMap.length; i++) {
        const sc = secondaryMap[i];
        if (!sc || typeof sc !== 'object') continue;
        const scStart = Number(sc.s) || 0, scEnd = scStart + (Number(sc.d) || 0);
        if ((mid >= scStart - 0.15 && mid <= scEnd + 0.15) || (Math.min(cueEnd, scEnd) - Math.max(cueStart, scStart) > 0.2)) {
          const txt = unwrapSecondaryEntry(sc);
          if (txt && !matched.includes(txt)) matched.push(txt);
        }
      }
      return matched.join('\n');
    }
    if (typeof secondaryMap === 'object') {
      for (const k of [idx, String(idx), cue.id, cue.s, cue.t]) {
        if (k !== undefined && Object.prototype.hasOwnProperty.call(secondaryMap, k)) return unwrapSecondaryEntry(secondaryMap[k]);
      }
    }
    return '';
  }

  function exportBilingualSrt(primaryCues, secondaryMap) {
    if (!Array.isArray(primaryCues) || primaryCues.length === 0) return '';
    const blocks = [];
    let seq = 1;
    for (let i = 0; i < primaryCues.length; i++) {
      const cue = primaryCues[i];
      if (!cue || !String(cue.t || '').trim()) continue;
      const startSec = Number(cue.s) || 0;
      const endSec = startSec + Math.max(0.05, Number(cue.d) || 0);
      const primaryText = String(cue.t).trim();
      const secondaryText = resolveSecondaryForCue(cue, i, secondaryMap);
      const body = secondaryText && secondaryText !== primaryText ? `${primaryText}\n${secondaryText}` : primaryText;
      blocks.push(`${seq}\n${formatSrtTimestamp(startSec)} --> ${formatSrtTimestamp(endSec)}\n${body}`);
      seq += 1;
    }
    return blocks.length > 0 ? blocks.join('\n\n') + '\n' : '';
  }

  function parseSubtitleByFilename(filename, text) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.vtt')) return parseVtt(text);
    if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return parseAss(text);
    if (lower.endsWith('.srt')) return parseSrt(text);
    const trimmed = String(text || '').replace(/^\uFEFF/, '').trimStart();
    if (/^WEBVTT/i.test(trimmed)) return parseVtt(text);
    if (/\[events\]/i.test(trimmed) && /dialogue\s*:/i.test(trimmed)) return parseAss(text);
    return parseSrt(text);
  }

  function detectCueIdioms(text, langCode, tlCode) {
    const idiomsApi = root.SS_IDIOMS;
    const langApi = root.SS_LANG;
    if (!idiomsApi || !text) return [];
    const normalizedLang = idiomsApi.normLang ? idiomsApi.normLang(langCode) : (langApi && langApi.normalizeLang ? langApi.normalizeLang(langCode) : langCode);
    let rawMatches = null;
    if (typeof idiomsApi.findInText === 'function') {
      try {
        const res = idiomsApi.findInText(text, tlCode || 'en', normalizedLang);
        if (Array.isArray(res) && res.length) rawMatches = res;
      } catch (_) {}
    }
    if (!rawMatches) {
      const candidateFns = ['findMatches', 'matchLine', 'matchText', 'detect', 'scan', 'match', 'extract'];
      for (const fnName of candidateFns) {
        if (typeof idiomsApi[fnName] === 'function') {
          try {
            rawMatches = idiomsApi[fnName](text, normalizedLang, langApi);
            if (Array.isArray(rawMatches) && rawMatches.length) break;
          } catch (_) { rawMatches = null; }
        }
      }
    }
    if (!Array.isArray(rawMatches) || rawMatches.length === 0) return [];
    const normalized = [];
    for (let i = 0; i < rawMatches.length; i++) {
      const m = rawMatches[i];
      if (!m || typeof m !== 'object') continue;
      const phrase = String(m.phrase || m.display || m.canonical || m.expr || m.lemma || m.surface || m.text || '').trim();
      const meaning = String(m.meaning || m.gloss || m.glossEn || m.def || m.definition || m.translation || '').trim();
      const spans = [];
      if (Array.isArray(m.anchorRanges) && m.anchorRanges.length) {
        for (const sp of m.anchorRanges) {
          if (Array.isArray(sp) && sp.length >= 2 && sp[1] > sp[0]) spans.push([Number(sp[0]), Number(sp[1])]);
        }
      } else if (Array.isArray(m.spans)) {
        for (const sp of m.spans) {
          if (Array.isArray(sp) && sp.length >= 2 && sp[1] > sp[0]) spans.push([Number(sp[0]), Number(sp[1])]);
          else if (sp && typeof sp.start === 'number' && typeof sp.end === 'number' && sp.end > sp.start) spans.push([sp.start, sp.end]);
        }
      } else if (typeof m.start === 'number' && typeof m.end === 'number' && m.end > m.start) {
        spans.push([m.start, m.end]);
      } else {
        const needle = String(m.surface || m.matched || phrase);
        if (needle) {
          const pos = text.toLowerCase().indexOf(needle.toLowerCase());
          if (pos !== -1) spans.push([pos, pos + needle.length]);
        }
      }
      if (phrase || spans.length > 0) {
        normalized.push({ id: m.id || `${phrase || 'idiom'}_${i}`, phrase: phrase || (spans[0] ? text.slice(spans[0][0], spans[0][1]) : ''), meaning, spans });
      }
    }
    return normalized;
  }

  function appendPlayerRtNode(txt) {
    const rt = document.createElement('rt');
    for (const sg of String(txt || '').split(/([ꜜ‾])/)) {
      if (!sg) continue;
      if (sg === 'ꜜ' || sg === '‾') {
        const pm = document.createElement('span');
        pm.className = 'pl-pitch-mark';
        pm.textContent = sg;
        rt.append(pm);
      } else {
        rt.append(document.createTextNode(sg));
      }
    }
    return rt;
  }

  function appendCueWordsWithAids(targetEl, segText, aidOpts) {
    const L = root.SS_LANG;
    const RD = root.SS_READINGS;
    const lgRaw = String((aidOpts && aidOpts.lang) || '').toLowerCase();
    const normLg = lgRaw === 'yue' ? 'yue' : (lgRaw === 'fil' || lgRaw === 'tgl' ? 'tl' : lgRaw.split(/[-_]/)[0]);
    if (!L || !RD || !aidOpts || (!aidOpts.rubyEnabled && !aidOpts.posEnabled) || !/^(ja|zh|yue|ko|ru|tl)$/.test(normLg)) {
      targetEl.append(document.createTextNode(segText));
      return;
    }
    let toks = L.get(normLg).split(segText);
    if ((normLg === 'yue' || normLg === 'zh') && aidOpts.richDict && typeof RD.mergeCjkDictTokens === 'function') {
      toks = RD.mergeCjkDictTokens(toks, normLg, aidOpts.richDict, null);
    }
    for (const tk of toks) {
      if (!tk.word) {
        targetEl.append(document.createTextNode(tk.w));
        continue;
      }
      const aid = typeof RD.lookupTokenAid === 'function'
        ? RD.lookupTokenAid(tk.w, normLg, aidOpts.richDict, { mode: aidOpts.readingAidMode || 'romaji', showPitchAccent: aidOpts.showPitchAccent !== false })
        : null;
      const sp = document.createElement('span');
      sp.className = 'pl-tok';
      if (aidOpts.rubyEnabled && aid && (aid.stress || (aid.reading && !Array.isArray(aid.reading) && (normLg === 'ru' || normLg === 'tl')))) {
        sp.textContent = aid.stress || aid.reading;
        targetEl.append(sp);
        continue;
      }
      if (aidOpts.posEnabled && aid && (aid.pos === 'n' || aid.pos === 'v' || aid.pos === 'a')) {
        sp.classList.add('pl-pos-' + aid.pos);
      }
      if (aidOpts.rubyEnabled && aid && Array.isArray(aid.reading) && aid.reading.length) {
        for (const [b, r] of aid.reading) {
          if (r) {
            const rb = document.createElement('ruby');
            rb.className = 'pl-ruby';
            rb.append(document.createTextNode(b || ''), appendPlayerRtNode(r));
            sp.append(rb);
          } else if (b) {
            sp.append(document.createTextNode(b));
          }
        }
      } else if (aidOpts.rubyEnabled && aid && typeof aid.reading === 'string' && aid.reading) {
        const rb = document.createElement('ruby');
        rb.className = 'pl-ruby';
        rb.append(document.createTextNode(tk.w), appendPlayerRtNode(aid.reading));
        sp.append(rb);
      } else {
        sp.textContent = tk.w;
      }
      targetEl.append(sp);
    }
  }

  function appendStyledCueText(container, text, matches, onIdiomClick, aidOpts) {
    container.replaceChildren();
    if (!text) return;
    if (!Array.isArray(matches) || matches.length === 0) {
      appendCueWordsWithAids(container, text, aidOpts);
      return;
    }
    const flatIntervals = [];
    for (const m of matches) {
      for (const [start, end] of m.spans) {
        if (start >= 0 && end <= text.length && end > start) flatIntervals.push({ start, end, match: m });
      }
    }
    if (flatIntervals.length === 0) {
      appendCueWordsWithAids(container, text, aidOpts);
      return;
    }
    flatIntervals.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    let cursor = 0;
    for (const seg of flatIntervals) {
      if (seg.start < cursor) continue;
      if (seg.start > cursor) appendCueWordsWithAids(container, text.slice(cursor, seg.start), aidOpts);
      const span = document.createElement('span');
      span.className = 'ss-idiom-hit';
      appendCueWordsWithAids(span, text.slice(seg.start, seg.end), aidOpts);
      span.title = seg.match.meaning ? `${seg.match.phrase}: ${seg.match.meaning}` : seg.match.phrase;
      if (typeof onIdiomClick === 'function') {
        span.addEventListener('click', (ev) => { ev.stopPropagation(); onIdiomClick(seg.match); });
      }
      container.append(span);
      cursor = seg.end;
    }
    if (cursor < text.length) appendCueWordsWithAids(container, text.slice(cursor), aidOpts);
  }

  function initDomPlayer() {
    if (typeof document === 'undefined') return;
    const appRoot = document.getElementById('appRoot');
    if (!appRoot) return;
    const id = (x) => document.getElementById(x);
    const els = {
      mediaTitleLabel: id('mediaTitleLabel'), sourceLangSelect: id('sourceLangSelect'), targetLangSelect: id('targetLangSelect'),
      autoTranslateToggle: id('autoTranslateToggle'), translateTrackBtn: id('translateTrackBtn'), exportSrtBtn: id('exportSrtBtn'),
      rubyAidBtn: id('rubyAidBtn'), posAidBtn: id('posAidBtn'),
      dropZone: id('dropZone'), videoFileInput: id('videoFileInput'), primarySubInput: id('primarySubInput'), secondarySubInput: id('secondarySubInput'),
      videoFileStatus: id('videoFileStatus'), primarySubStatus: id('primarySubStatus'), secondarySubStatus: id('secondarySubStatus'),
      videoEl: id('videoEl'), emptyStageOverlay: id('emptyStageOverlay'), overlayPrimary: id('overlayPrimary'), overlaySecondary: id('overlaySecondary'),
      prevCueBtn: id('prevCueBtn'), replayCueBtn: id('replayCueBtn'), nextCueBtn: id('nextCueBtn'),
      playPauseBtn: id('playPauseBtn'), playPauseLabel: id('playPauseLabel'),
      statusBanner: id('statusBanner'), tabTranscriptBtn: id('tabTranscriptBtn'), tabIdiomsBtn: id('tabIdiomsBtn'),
      transcriptCountBadge: id('transcriptCountBadge'), idiomsCountBadge: id('idiomsCountBadge'),
      panelTranscript: id('panelTranscript'), panelIdioms: id('panelIdioms'),
      transcriptEmptyMsg: id('transcriptEmptyMsg'), idiomsEmptyMsg: id('idiomsEmptyMsg'),
      transcriptList: id('transcriptList'), idiomsList: id('idiomsList'),
    };

    const state = {
      videoObjectUrl: null, videoBaseName: 'subtitles', primaryCues: [], secondaryCues: [], secondaryMap: new Map(),
      cueIdiomMatches: [], allIdiomOccurrences: [], activeCueIndex: -1,
      inFlightCueIds: new Set(), isBatchTranslating: false, cueRowEls: [], idiomCardEls: new Map(),
      rubyEnabled: true, posEnabled: true, showPitchAccent: true, readingAidMode: 'romaji', readDicts: {},
    };

    const getAidOpts = () => {
      const lang = els.sourceLangSelect.value;
      const norm = lang === 'yue' ? 'yue' : (lang === 'fil' || lang === 'tgl' ? 'tl' : String(lang || '').toLowerCase().split(/[-_]/)[0]);
      return {
        lang,
        richDict: state.readDicts[norm] || null,
        rubyEnabled: !!state.rubyEnabled,
        posEnabled: !!state.posEnabled,
        readingAidMode: state.readingAidMode || 'romaji',
        showPitchAccent: state.showPitchAccent !== false,
      };
    };

    const syncAidBtns = () => {
      if (els.rubyAidBtn) {
        els.rubyAidBtn.textContent = state.rubyEnabled ? 'Ruby: On' : 'Ruby: Off';
        els.rubyAidBtn.classList.toggle('is-active', !!state.rubyEnabled);
      }
      if (els.posAidBtn) {
        els.posAidBtn.textContent = state.posEnabled ? 'POS: On' : 'POS: Off';
        els.posAidBtn.classList.toggle('is-active', !!state.posEnabled);
      }
      if (els.overlayPrimary) els.overlayPrimary.classList.toggle('pl-pos-on', !!state.posEnabled);
      if (els.transcriptList) els.transcriptList.classList.toggle('pl-pos-on', !!state.posEnabled);
    };

    async function ensurePlayerAssets(langCode, tlCode) {
      const norm = langCode === 'yue' ? 'yue' : (langCode === 'fil' || langCode === 'tgl' ? 'tl' : String(langCode || '').toLowerCase().split(/[-_]/)[0]);
      if (root.SS_IDIOMS && typeof root.SS_IDIOMS.ensureWebFeIndex === 'function') {
        try { await root.SS_IDIOMS.ensureWebFeIndex(norm, tlCode || 'en'); } catch (_) {}
      }
      if (/^(ja|zh|yue|ko|ru|tl)$/.test(norm) && state.readDicts[norm] === undefined) {
        const file = `read_${norm}.json`;
        let raw = null;
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL && typeof fetch === 'function') {
            const resp = await fetch(chrome.runtime.getURL(`data/${file}`));
            if (resp && resp.ok) raw = await resp.json();
          }
        } catch (_) {}
        if (!raw && typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          raw = await new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage({ op: 'loadExtData', file }, (r) => resolve(r && r.ok ? r.data : null));
            } catch (_) { resolve(null); }
          });
        }
        state.readDicts[norm] = raw && root.SS_READINGS && typeof root.SS_READINGS.normalizeRichReadDict === 'function'
          ? root.SS_READINGS.normalizeRichReadDict(raw)
          : (raw || null);
      }
      if (state.primaryCues.length > 0) {
        recomputeIdioms();
        renderIdiomsSidebar();
        renderTranscriptList();
        renderActiveOverlay(state.activeCueIndex);
      }
    }

    const setStatus = (msg) => { els.statusBanner.textContent = msg; };

    function sendTranslateBatchMessage(segments) {
      const payload = { op: 'translateBatch', source_lang: els.sourceLangSelect.value, target_lang: els.targetLangSelect.value, segments };
      return sendPlayerMessage(payload);
    }

    function sendPlayerMessage(payload) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          try {
            chrome.runtime.sendMessage(payload, (response) => {
              if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
              resolve(response || { ok: false, error: 'Empty background response' });
            });
            return;
          } catch (err) { resolve({ ok: false, error: String((err && err.message) || err) }); return; }
        }
        resolve({ ok: false, error: 'Extension background runtime unavailable' });
      });
    }

    function switchSidebarTab(tabName) {
      const isTranscript = tabName === 'transcript';
      els.tabTranscriptBtn.classList.toggle('is-active', isTranscript);
      els.tabTranscriptBtn.setAttribute('aria-selected', String(isTranscript));
      els.tabIdiomsBtn.classList.toggle('is-active', !isTranscript);
      els.tabIdiomsBtn.setAttribute('aria-selected', String(!isTranscript));
      els.panelTranscript.classList.toggle('is-hidden', !isTranscript);
      els.panelIdioms.classList.toggle('is-hidden', isTranscript);
    }

    function focusIdiomInSidebar(matchObj, cueIdx) {
      switchSidebarTab('idioms');
      const key = `${cueIdx}:${matchObj.id}`;
      for (const [k, card] of state.idiomCardEls.entries()) card.classList.toggle('is-highlighted', k === key);
      const targetCard = state.idiomCardEls.get(key);
      if (targetCard) showIdiomStudy(targetCard, matchObj, state.primaryCues[cueIdx].t);
      if (targetCard && typeof targetCard.scrollIntoView === 'function') targetCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function showIdiomStudy(card, match, line) {
      if (!globalThis.SS_LOCAL_STUDY || card.querySelector('.ss-local-study')) return;
      const surface = (match.spans || []).map(([start, end]) => line.slice(start, end)).join(' ');
      card.append(globalThis.SS_LOCAL_STUDY.create(document, {
        buttonClass: 'ss-btn',
        request: mode => sendPlayerMessage({ op: 'companion', path: '/explain', method: 'POST', timeoutMs: 120000,
          body: { word: surface || match.phrase, lemma: match.phrase, line, mode,
            source_lang: els.sourceLangSelect.value, target_lang: els.targetLangSelect.value } }),
      }));
    }

    function recomputeIdioms() {
      const lang = els.sourceLangSelect.value;
      const tl = els.targetLangSelect ? els.targetLangSelect.value : 'en';
      state.cueIdiomMatches = new Array(state.primaryCues.length);
      state.allIdiomOccurrences = [];
      for (let i = 0; i < state.primaryCues.length; i++) {
        const cue = state.primaryCues[i];
        const matches = detectCueIdioms(cue.t, lang, tl);
        state.cueIdiomMatches[i] = matches;
        for (const m of matches) state.allIdiomOccurrences.push({ cueIndex: i, cueTime: cue.s, cueText: cue.t, match: m });
      }
    }

    function getSecondaryTextForIndex(idx) {
      if (idx < 0 || idx >= state.primaryCues.length) return '';
      if (state.secondaryMap.has(idx)) return state.secondaryMap.get(idx) || '';
      if (state.secondaryCues.length > 0) return resolveSecondaryForCue(state.primaryCues[idx], idx, state.secondaryCues);
      return '';
    }

    function renderIdiomsSidebar() {
      els.idiomsList.replaceChildren();
      state.idiomCardEls.clear();
      els.idiomsCountBadge.textContent = String(state.allIdiomOccurrences.length);
      if (state.allIdiomOccurrences.length === 0) { els.idiomsEmptyMsg.classList.remove('is-hidden'); return; }
      els.idiomsEmptyMsg.classList.add('is-hidden');
      const frag = document.createDocumentFragment();
      for (const occ of state.allIdiomOccurrences) {
        const card = document.createElement('div');
        card.className = 'ss-idiom-card';
        const header = document.createElement('div');
        header.className = 'ss-idiom-header';
        const phraseEl = document.createElement('span');
        phraseEl.className = 'ss-idiom-phrase';
        phraseEl.textContent = occ.match.phrase;
        const timeEl = document.createElement('span');
        timeEl.className = 'ss-idiom-time';
        timeEl.textContent = formatShortClock(occ.cueTime);
        header.append(phraseEl, timeEl);
        card.append(header);
        if (occ.match.meaning) {
          const meaningEl = document.createElement('div');
          meaningEl.className = 'ss-idiom-meaning';
          meaningEl.textContent = occ.match.meaning;
          card.append(meaningEl);
        }
        const sampleEl = document.createElement('div');
        sampleEl.className = 'ss-idiom-sample';
        sampleEl.textContent = occ.cueText;
        card.append(sampleEl);
        card.addEventListener('click', (event) => {
          if (event.target.closest('.ss-local-study')) return;
          seekToCue(occ.cueIndex, true);
          showIdiomStudy(card, occ.match, occ.cueText);
        });
        state.idiomCardEls.set(`${occ.cueIndex}:${occ.match.id}`, card);
        frag.append(card);
      }
      els.idiomsList.append(frag);
    }

    function renderTranscriptList() {
      els.transcriptList.replaceChildren();
      state.cueRowEls = [];
      els.transcriptCountBadge.textContent = String(state.primaryCues.length);
      const hasCues = state.primaryCues.length > 0;
      els.transcriptEmptyMsg.classList.toggle('is-hidden', hasCues);
      els.translateTrackBtn.disabled = !hasCues || state.isBatchTranslating;
      els.exportSrtBtn.disabled = !hasCues;
      if (!hasCues) return;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < state.primaryCues.length; i++) {
        const cue = state.primaryCues[i];
        const row = document.createElement('div');
        row.className = 'ss-cue-row' + (i === state.activeCueIndex ? ' is-active' : '');
        const timeCol = document.createElement('div');
        timeCol.className = 'ss-cue-time';
        timeCol.textContent = formatShortClock(cue.s);
        const bodyCol = document.createElement('div');
        bodyCol.className = 'ss-cue-body';
        const priLine = document.createElement('div');
        priLine.className = 'ss-cue-primary';
        appendStyledCueText(priLine, cue.t, state.cueIdiomMatches[i], (m) => focusIdiomInSidebar(m, i), getAidOpts());
        const secLine = document.createElement('div');
        secLine.className = 'ss-cue-secondary';
        secLine.textContent = getSecondaryTextForIndex(i);
        bodyCol.append(priLine, secLine);
        globalThis.SS_LITERARY?.append(bodyCol, els.sourceLangSelect.value, cue.t);
        row.append(timeCol, bodyCol);
        row.addEventListener('click', () => seekToCue(i, true));
        state.cueRowEls.push({ row, secLine });
        frag.append(row);
      }
      els.transcriptList.append(frag);
    }

    function refreshRowSecondary(idx) {
      const entry = state.cueRowEls[idx];
      if (entry) entry.secLine.textContent = getSecondaryTextForIndex(idx);
    }

    async function maybeAutoTranslateAround(centerIdx) {
      if (!els.autoTranslateToggle.checked || centerIdx < 0) return;
      const windowSegments = [];
      const endBound = Math.min(state.primaryCues.length, centerIdx + 4);
      for (let i = centerIdx; i < endBound; i++) {
        if (getSecondaryTextForIndex(i) || state.inFlightCueIds.has(i)) continue;
        state.inFlightCueIds.add(i);
        windowSegments.push({ id: i, text: state.primaryCues[i].t });
      }
      if (windowSegments.length === 0) return;
      const res = await sendTranslateBatchMessage(windowSegments);
      for (const seg of windowSegments) state.inFlightCueIds.delete(seg.id);
      if (res && res.ok && Array.isArray(res.translations)) {
        for (const item of res.translations) {
          const idx = Number(item.id);
          if (!Number.isNaN(idx) && item.translation) {
            state.secondaryMap.set(idx, item.translation);
            refreshRowSecondary(idx);
          }
        }
        renderActiveOverlay(state.activeCueIndex);
      }
    }

    function renderActiveOverlay(idx) {
      if (idx < 0 || idx >= state.primaryCues.length) {
        els.overlayPrimary.replaceChildren();
        els.overlaySecondary.textContent = '';
        return;
      }
      const cue = state.primaryCues[idx];
      appendStyledCueText(els.overlayPrimary, cue.t, state.cueIdiomMatches[idx], (m) => {
        els.videoEl.pause();
        focusIdiomInSidebar(m, idx);
      }, getAidOpts());
      els.overlaySecondary.textContent = getSecondaryTextForIndex(idx);
    }

    function findCueIndexAtTime(t) {
      for (let i = 0; i < state.primaryCues.length; i++) {
        const c = state.primaryCues[i];
        if (t >= c.s && t <= c.s + Math.max(0.15, c.d)) return i;
      }
      return -1;
    }

    function findNearestOrPreviousCueIndex(t) {
      if (state.primaryCues.length === 0) return -1;
      let candidate = 0;
      for (let i = 0; i < state.primaryCues.length; i++) {
        if (state.primaryCues[i].s <= t + 0.05) candidate = i;
        else break;
      }
      return candidate;
    }

    function setActiveCueIndex(nextIdx) {
      if (nextIdx === state.activeCueIndex) return;
      if (state.activeCueIndex >= 0 && state.cueRowEls[state.activeCueIndex]) {
        state.cueRowEls[state.activeCueIndex].row.classList.remove('is-active');
      }
      state.activeCueIndex = nextIdx;
      if (nextIdx >= 0 && state.cueRowEls[nextIdx]) {
        const activeRow = state.cueRowEls[nextIdx].row;
        activeRow.classList.add('is-active');
        if (typeof activeRow.scrollIntoView === 'function') activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      renderActiveOverlay(nextIdx);
      if (nextIdx >= 0) maybeAutoTranslateAround(nextIdx);
    }

    function syncPlaybackTick() {
      const now = els.videoEl.currentTime || 0;
      setActiveCueIndex(findCueIndexAtTime(now));
    }

    let rafHandle = 0;
    function startRafLoop() {
      cancelAnimationFrame(rafHandle);
      const step = function () {
        syncPlaybackTick();
        if (!els.videoEl.paused && !els.videoEl.ended) rafHandle = requestAnimationFrame(step);
      };
      rafHandle = requestAnimationFrame(step);
    }

    function seekToCue(targetIdx, autoPlayAfterSeek) {
      if (state.primaryCues.length === 0) return;
      const clamped = Math.max(0, Math.min(state.primaryCues.length - 1, targetIdx));
      els.videoEl.currentTime = state.primaryCues[clamped].s;
      setActiveCueIndex(clamped);
      if (autoPlayAfterSeek && els.videoEl.src) els.videoEl.play().catch(() => {});
    }

    function togglePlayPause() {
      if (!els.videoEl.src) return;
      if (els.videoEl.paused) {
        els.videoEl.play().catch(() => {});
      } else els.videoEl.pause();
    }

    function loadVideoFile(file) {
      if (!file) return;
      if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
      state.videoObjectUrl = URL.createObjectURL(file);
      state.videoBaseName = file.name.replace(/\.[^.]+$/, '') || 'subtitles';
      els.videoEl.src = state.videoObjectUrl;
      els.emptyStageOverlay.classList.add('is-hidden');
      els.mediaTitleLabel.textContent = file.name;
      els.videoFileStatus.textContent = file.name;
      els.videoFileStatus.classList.add('is-loaded');
      setStatus(`Loaded video: ${file.name}`);
    }

    async function loadPrimarySubtitleFile(file) {
      if (!file) return;
      const text = await file.text();
      state.primaryCues = parseSubtitleByFilename(file.name, text);
      state.secondaryMap.clear();
      state.activeCueIndex = -1;
      recomputeIdioms();
      renderTranscriptList();
      renderIdiomsSidebar();
      syncPlaybackTick();
      els.primarySubStatus.textContent = `${file.name} (${state.primaryCues.length} cues)`;
      els.primarySubStatus.classList.add('is-loaded');
      setStatus(`Loaded ${state.primaryCues.length} primary cues from ${file.name}`);
      ensurePlayerAssets(els.sourceLangSelect.value, els.targetLangSelect.value);
    }

    async function loadSecondarySubtitleFile(file) {
      if (!file) return;
      const text = await file.text();
      state.secondaryCues = parseSubtitleByFilename(file.name, text);
      for (let i = 0; i < state.primaryCues.length; i++) refreshRowSecondary(i);
      renderActiveOverlay(state.activeCueIndex);
      els.secondarySubStatus.textContent = `${file.name} (${state.secondaryCues.length} cues)`;
      els.secondarySubStatus.classList.add('is-loaded');
      setStatus(`Loaded ${state.secondaryCues.length} secondary cues from ${file.name}`);
    }

    async function translateEntireTrackLocally() {
      if (state.primaryCues.length === 0 || state.isBatchTranslating) return;
      state.isBatchTranslating = true;
      els.translateTrackBtn.disabled = true;
      const CHUNK_SIZE = 24;
      let translatedCount = 0;
      try {
        for (let offset = 0; offset < state.primaryCues.length; offset += CHUNK_SIZE) {
          const slice = state.primaryCues.slice(offset, offset + CHUNK_SIZE);
          const segments = slice.map((c, j) => ({ id: offset + j, text: c.t }));
          setStatus(`Translating cues ${offset + 1}–${offset + segments.length} of ${state.primaryCues.length}...`);
          let res = await sendTranslateBatchMessage(segments);
          if (!res || !res.ok || !Array.isArray(res.translations)) {
            const wt = await new Promise((resolve) => {
              if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
              try {
                chrome.runtime.sendMessage({
                  op: 'webTranslate',
                  texts: slice.map((c) => c.t),
                  sl: (els.sourceLangSelect && els.sourceLangSelect.value) || 'auto',
                  tl: (els.targetLangSelect && els.targetLangSelect.value) || 'en',
                }, (r) => resolve(r || null));
              } catch (_) { resolve(null); }
            });
            if (wt && wt.ok && Array.isArray(wt.translations)) {
              res = {
                ok: true,
                translations: slice.map((c, j) => ({ id: offset + j, translation: wt.translations[j] || '' })),
              };
            }
          }
          if (!res || !res.ok || !Array.isArray(res.translations)) {
            setStatus(`Translation stopped: ${(res && res.error) || 'Translation service unavailable'}`);
            break;
          }
          for (const item of res.translations) {
            const idx = Number(item.id);
            if (!Number.isNaN(idx) && typeof item.translation === 'string') {
              state.secondaryMap.set(idx, item.translation);
              refreshRowSecondary(idx);
              translatedCount += 1;
            }
          }
          renderActiveOverlay(state.activeCueIndex);
        }
        if (translatedCount > 0) setStatus(`Translated ${translatedCount} cues into ${els.targetLangSelect.value.toUpperCase()}`);
      } finally {
        state.isBatchTranslating = false;
        els.translateTrackBtn.disabled = state.primaryCues.length === 0;
      }
    }

    function triggerExportBilingualSrt() {
      if (state.primaryCues.length === 0) return;
      const srtContent = exportBilingualSrt(state.primaryCues, state.secondaryMap.size > 0 ? state.secondaryMap : state.secondaryCues);
      if (!srtContent) return;
      const url = URL.createObjectURL(new Blob([srtContent], { type: 'application/x-subrip;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.videoBaseName}.bilingual.srt`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Exported ${state.videoBaseName}.bilingual.srt`);
    }

    async function handleDroppedFiles(fileList) {
      const subFiles = [];
      for (const f of Array.from(fileList || [])) {
        const lower = f.name.toLowerCase();
        if (/\.(mp4|webm|mkv)$/i.test(lower) || f.type.startsWith('video/')) loadVideoFile(f);
        else if (/\.(srt|vtt|ass|ssa)$/i.test(lower)) subFiles.push(f);
      }
      if (subFiles.length >= 1) await loadPrimarySubtitleFile(subFiles[0]);
      if (subFiles.length >= 2) await loadSecondarySubtitleFile(subFiles[1]);
    }

    els.videoFileInput.addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) loadVideoFile(e.target.files[0]); });
    els.primarySubInput.addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) loadPrimarySubtitleFile(e.target.files[0]); });
    els.secondarySubInput.addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) loadSecondarySubtitleFile(e.target.files[0]); });
    els.sourceLangSelect.addEventListener('change', () => {
      ensurePlayerAssets(els.sourceLangSelect.value, els.targetLangSelect.value);
      if (state.primaryCues.length > 0) {
        recomputeIdioms(); renderTranscriptList(); renderIdiomsSidebar(); renderActiveOverlay(state.activeCueIndex);
      }
    });
    if (els.targetLangSelect) {
      els.targetLangSelect.addEventListener('change', () => ensurePlayerAssets(els.sourceLangSelect.value, els.targetLangSelect.value));
    }
    if (els.rubyAidBtn) {
      els.rubyAidBtn.addEventListener('click', () => {
        state.rubyEnabled = !state.rubyEnabled;
        syncAidBtns();
        renderTranscriptList();
        renderActiveOverlay(state.activeCueIndex);
      });
    }
    if (els.posAidBtn) {
      els.posAidBtn.addEventListener('click', () => {
        state.posEnabled = !state.posEnabled;
        syncAidBtns();
        renderTranscriptList();
        renderActiveOverlay(state.activeCueIndex);
      });
    }
    syncAidBtns();
    ensurePlayerAssets(els.sourceLangSelect.value, els.targetLangSelect.value);
    els.translateTrackBtn.addEventListener('click', translateEntireTrackLocally);
    els.exportSrtBtn.addEventListener('click', triggerExportBilingualSrt);
    els.prevCueBtn.addEventListener('click', () => seekToCue((state.activeCueIndex >= 0 ? state.activeCueIndex : findNearestOrPreviousCueIndex(els.videoEl.currentTime || 0)) - 1, true));
    els.replayCueBtn.addEventListener('click', () => seekToCue(state.activeCueIndex >= 0 ? state.activeCueIndex : findNearestOrPreviousCueIndex(els.videoEl.currentTime || 0), true));
    els.nextCueBtn.addEventListener('click', () => seekToCue((state.activeCueIndex >= 0 ? state.activeCueIndex : findNearestOrPreviousCueIndex(els.videoEl.currentTime || 0)) + 1, true));
    els.playPauseBtn.addEventListener('click', togglePlayPause);
    els.tabTranscriptBtn.addEventListener('click', () => switchSidebarTab('transcript'));
    els.tabIdiomsBtn.addEventListener('click', () => switchSidebarTab('idioms'));
    els.videoEl.addEventListener('play', () => { els.playPauseLabel.textContent = 'Pause'; startRafLoop(); });
    els.videoEl.addEventListener('pause', () => { els.playPauseLabel.textContent = 'Play'; cancelAnimationFrame(rafHandle); });
    els.videoEl.addEventListener('timeupdate', syncPlaybackTick);
    els.videoEl.addEventListener('seeked', syncPlaybackTick);

    for (const target of [els.dropZone, document.body]) {
      target.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.classList.add('is-dragover'); });
      target.addEventListener('dragleave', (e) => { if (e.target === target) els.dropZone.classList.remove('is-dragover'); });
      target.addEventListener('drop', (e) => {
        e.preventDefault();
        els.dropZone.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) handleDroppedFiles(e.dataTransfer.files);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === 'a') { e.preventDefault(); els.prevCueBtn.click(); }
      else if (key === 's') { e.preventDefault(); els.replayCueBtn.click(); }
      else if (key === 'd') { e.preventDefault(); els.nextCueBtn.click(); }
      else if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); togglePlayPause(); }
    });
  }

  const exportedApi = { parseSrt, parseVtt, parseAss, exportBilingualSrt, detectCueIdioms, formatSrtTimestamp };
  root.SS_LOCAL_PLAYER = exportedApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = exportedApi;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDomPlayer);
    else initDomPlayer();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
