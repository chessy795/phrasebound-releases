/**
 * Subtitle Study — select.js
 * Clean-room Manifest V3 content script for selection lookup, idiom chips,
 * multi-model comparison, exact-chord hover / Ctrl+Click paragraph bilingual
 * injection, Full-Page (Alt+P) & Article-Only (Alt+A) bilingual mode, and
 * Tab-to-accept input translation preview.
 *
 * Strict Trusted-Types CSP safe: 100% DOM node APIs (createElement, textContent,
 * appendChild). Zero external dependencies, zero build step.
 */
(function (root) {
  'use strict';

  /* ==========================================================================
   * 1. Configuration & State
   * ========================================================================== */

  var DEFAULT_CFG = {
    tl: 'en',
    mtModel: 'plamo-2b',
    model: 'plamo-2b',
    mtDevice: 'gpu',
    device: 'gpu',
    companionUrl: 'http://127.0.0.1:8787',
    selectTranslate: true,
    shiftHoverScan: true,
    webRareWords: false,  // opt-in, stored as webRareWordsOn
    webHighlightSaved: true,
    webReaderAid: true,
    autoWebReadings: false,
    posColors: true,
    readingAid: 'romaji',
    showPitchAccent: true,
    webIPlusOneMode: 'off',
    l1WeaveRatio: 0.08,
    webDisplayMode: 'tr_only',
    webTranslationStyle: 'native',
    webBorderless: false,
    webBlurTr: false,
    useChromeBuiltinTranslator: true,
    // Cloud MT (Google/Microsoft) only when the user picks it or turns this on (audit 2026-11-23).
    cloudFallback: false,
    autoTranslateHosts: {},
    // Whole-page auto-translate is opt-in (stored as autoTranslateWeb; the old autoTranslateForeign key is ignored).
    autoTranslateForeign: false,
    autoTranslateScope: 'full',
    neverTranslateHosts: [],
    skipAutoTranslateLangs: [],
    showFloatingFab: true,
    fabSide: 'right',
    fabCompact: false,
    fabTheme: 'system',
    fabOpacity: 0.82,
    fabHoverDelay: 140,
    fabClickMode: 'article',
    fabHideDomains: [],
    webKeys: null,
    inputTripleSpace: true,
    sceneServices: {},
    webMtProvider: 'google',
    webMtFallback: true,
    customApi: {},
    autoDetectVideo: false,
    autoCalibrateLevel: true,
    incidentalFsrs: true,
    fsrsRetention: 0.9,
    vocabLevel: 2000,
    vocabLevelsByLang: {},
    siteRules: { include: '', exclude: '' },
    glossary: {}
  };

  var WEB_KEYS = { article: 'a', full: 'p', compare: 'd', input: 't', view: 'b', glosses: 'i', weave: 'w', picker: 's' };
  var WEB_TARGETS = [
    ['en', 'English'], ['zh-Hant', '繁體中文'], ['zh-Hans', '简体中文'], ['yue', '粵語'],
    ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español'], ['fr', 'Français'],
    ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['ru', 'Русский'], ['tl', 'Tagalog']
  ];
  var cfg = assignObj({}, DEFAULT_CFG);

  function webShortcutKey(action) {
    var key = cfg.webKeys && cfg.webKeys[action];
    return typeof key === 'string' && /^(?:[a-np-z])?$/.test(key) ? key : WEB_KEYS[action];
  }

  var MAX_LRU = 128;
  var BATCH_SIZE = 10;
  var HOVER_DELAY_MS = 260;

  var BLOCK_HOVER_SELECTOR = 'p, li, blockquote, h2, h3, td';
  var FEED_POST_SELECTOR = '[data-testid="tweetText"]';
  var SEARCH_RESULT_TEXT = 'h3, .VwiC3b, [data-sncf]';
  var PAGE_BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, summary, th, figcaption, ' + FEED_POST_SELECTOR + ', [slot="text-body"], .commtext';
  var ARTICLE_ROOT_SELECTOR = 'article, main, [role="main"], .post-content, .article-body';
  var DEFAULT_EXCLUDE_SELECTOR = [
    'nav', 'header', 'footer', 'pre', 'code', '.notranslate', '[translate="no"]',
    'script', 'style', 'noscript', 'svg', 'math', 'textarea', 'input', 'select',
    '#ss-panel', '#ss-overlay', '.ss-pop', '[data-ss-select]', '[data-ss-page-tr]',
    '[data-ss-input-preview]', '[data-ss-toast]', '[data-ss-picker]', '[data-ss-saved-hl]', '[data-ss-i1-chip]', '[data-ss-weave]', '[data-ss-crop-ocr]', '[data-ss-fab]', '[data-ss-autovid-ov]'
  ].join(', ');
  var UI_IGNORE_SELECTOR = '#ss-panel, #ss-dict-dock, #ss-overlay, .ss-pop, [data-ss-select], [data-ss-page-tr], [data-ss-input-preview], [data-ss-toast], [data-ss-picker], [data-ss-crop-ocr], [data-ss-fab], [data-ss-autovid-ov]';

  function assignObj(target, src) {
    if (!src || typeof src !== 'object') return target;
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (src[k] !== undefined) target[k] = src[k];
    }
    return target;
  }

  function applySettings(raw) {
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.tl === 'string' && raw.tl.trim()) cfg.tl = raw.tl.trim();
    var m = raw.mtModel || raw.model;
    if (typeof m === 'string' && m.trim()) {
      cfg.mtModel = m.trim();
      cfg.model = m.trim();
    }
    var d = raw.mtDevice || raw.device;
    if (typeof d === 'string' && d.trim()) {
      cfg.mtDevice = d.trim();
      cfg.device = d.trim();
    }
    if (typeof raw.companionUrl === 'string' && raw.companionUrl.trim()) {
      cfg.companionUrl = raw.companionUrl.trim();
    }
    if (typeof raw.selectTranslate === 'boolean') {
      cfg.selectTranslate = raw.selectTranslate;
    }
    if (raw.siteRules && typeof raw.siteRules === 'object') {
      cfg.siteRules = raw.siteRules;
    }
    if (raw.glossary && typeof raw.glossary === 'object') {
      cfg.glossary = raw.glossary;
    }
    cfg.webRareWords = raw.webRareWordsOn === true;
    if (typeof raw.shiftHoverScan === 'boolean') cfg.shiftHoverScan = raw.shiftHoverScan;
    if (typeof raw.webHighlightSaved === 'boolean') cfg.webHighlightSaved = raw.webHighlightSaved;
    if (typeof raw.webReaderAid === 'boolean') cfg.webReaderAid = raw.webReaderAid;
    cfg.autoWebReadings = raw.autoWebReadings === true;
    if (typeof raw.posColors === 'boolean') cfg.posColors = raw.posColors;
    if (typeof raw.readingAid === 'string' && raw.readingAid) cfg.readingAid = raw.readingAid;
    if (typeof raw.showPitchAccent === 'boolean') cfg.showPitchAccent = raw.showPitchAccent;
    if (typeof raw.webIPlusOneMode === 'string') cfg.webIPlusOneMode = raw.webIPlusOneMode;
    if (typeof raw.l1WeaveRatio === 'number') cfg.l1WeaveRatio = Math.min(0.5, Math.max(0.01, raw.l1WeaveRatio));
    cfg.webDisplayMode = raw.webDisplayMode === 'bilingual' ? 'bilingual' : 'tr_only';
    cfg.webTranslationStyle = raw.webTranslationStyle === 'panel' ? 'panel' : 'native';
    if (typeof raw.webBorderless === 'boolean') cfg.webBorderless = raw.webBorderless;
    if (typeof raw.webBlurTr === 'boolean') cfg.webBlurTr = raw.webBlurTr;
    if (typeof raw.useChromeBuiltinTranslator === 'boolean') cfg.useChromeBuiltinTranslator = raw.useChromeBuiltinTranslator;
    if (typeof raw.cloudFallback === 'boolean') cfg.cloudFallback = raw.cloudFallback;
    if (raw.autoTranslateHosts && typeof raw.autoTranslateHosts === 'object') cfg.autoTranslateHosts = raw.autoTranslateHosts;
    if (typeof raw.showFloatingFab === 'boolean') cfg.showFloatingFab = raw.showFloatingFab;
    if (raw.fabSide === 'left' || raw.fabSide === 'right') cfg.fabSide = raw.fabSide;
    if (typeof raw.fabCompact === 'boolean') cfg.fabCompact = raw.fabCompact;
    cfg.fabTheme = raw.fabTheme === 'dark' || raw.fabTheme === 'light' ? raw.fabTheme : 'system';
    if (typeof raw.fabOpacity === 'number') cfg.fabOpacity = Math.min(1, Math.max(0.15, raw.fabOpacity));
    if (typeof raw.fabHoverDelay === 'number') cfg.fabHoverDelay = Math.min(1200, Math.max(40, raw.fabHoverDelay));
    if (typeof raw.fabClickMode === 'string') cfg.fabClickMode = raw.fabClickMode;
    if (Array.isArray(raw.fabHideDomains)) cfg.fabHideDomains = raw.fabHideDomains;
    cfg.webKeys = raw.webKeys && typeof raw.webKeys === 'object' ? raw.webKeys : null;
    if (typeof raw.inputTripleSpace === 'boolean') cfg.inputTripleSpace = raw.inputTripleSpace;
    if (raw.sceneServices && typeof raw.sceneServices === 'object') cfg.sceneServices = raw.sceneServices;
    cfg.webMtProvider = raw.webMtProvider === 'microsoft' ? 'microsoft' : 'google';
    cfg.webMtFallback = raw.webMtFallback !== false;
    if (raw.customApi && typeof raw.customApi === 'object') cfg.customApi = raw.customApi;
    if (typeof raw.autoDetectVideo === 'boolean') cfg.autoDetectVideo = raw.autoDetectVideo;
    if (typeof raw.autoCalibrateLevel === 'boolean') cfg.autoCalibrateLevel = raw.autoCalibrateLevel;
    if (typeof raw.incidentalFsrs === 'boolean') cfg.incidentalFsrs = raw.incidentalFsrs;
    if (typeof raw.fsrsRetention === 'number') cfg.fsrsRetention = raw.fsrsRetention;
    if (typeof raw.vocabLevel === 'number') cfg.vocabLevel = raw.vocabLevel;
    if (raw.vocabLevelsByLang && typeof raw.vocabLevelsByLang === 'object') cfg.vocabLevelsByLang = raw.vocabLevelsByLang;
    if (typeof raw.ocrUrl === 'string') cfg.ocrUrl = raw.ocrUrl;
    if (typeof raw.ocrKey === 'string') cfg.ocrKey = raw.ocrKey;
    if (typeof raw.ocrModel === 'string') cfg.ocrModel = raw.ocrModel;
    cfg.autoTranslateForeign = raw.autoTranslateWeb === true;
    if (raw.autoTranslateScope === 'full' || raw.autoTranslateScope === 'article' || raw.autoTranslateScope === 'smart_i1') cfg.autoTranslateScope = raw.autoTranslateScope;
    if (Array.isArray(raw.neverTranslateHosts)) cfg.neverTranslateHosts = raw.neverTranslateHosts;
    if (Array.isArray(raw.skipAutoTranslateLangs)) cfg.skipAutoTranslateLangs = raw.skipAutoTranslateLangs;
  }

  var TRAD_ONLY_RE = /[體國學們這說會對時過發開關點經現實種進樣動還應問題機長書見語電車門馬魚鳥風雲龍愛歲義萬與專業東兩嚴個豐臨為麗舉麼樂習鄉買亂爭於虧產親億僅從倉價眾優偉傳傷倫偽灣廣環續論轉質構結間將編]/g;
  var SIMP_ONLY_RE = /[体国学们这说会对时过发开关点经现实种进样动还应问题机长书见语电车门马鱼鸟风云龙爱岁义万与专业东两严个丰临为丽举么乐习乡买乱争于亏产亲亿仅从仓价众优伟传伤伦伪湾广环续论转质构结间将编]/g;
  var WEB_APP_SKIP_HOSTS = [
    'localhost', '127.0.0.1', 'docs.google.com', 'sheets.google.com', 'slides.google.com',
    'mail.google.com', 'calendar.google.com', 'drive.google.com', 'meet.google.com',
    'figma.com', 'canva.com', 'codepen.io', 'codesandbox.io', 'stackblitz.com', 'replit.com'
  ];

  function hostMatchesList(host, list) {
    var hk = String(host || '').trim().toLowerCase();
    if (!hk || !Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      var pat = String(list[i] || '').trim().toLowerCase();
      if (!pat) continue;
      if (hk === pat || (hk.length > pat.length && hk.slice(-(pat.length + 1)) === '.' + pat)) return true;
    }
    return false;
  }

  function normLangPair(code) {
    if (root.SS_LANG?.translationLanguageKey) return root.SS_LANG.translationLanguageKey(code);
    var c = String(code || '').trim().toLowerCase().replace(/_/g, '-');
    if (!c) return '';
    if (/^zh[-_]*(tw|hk|mo|hant)/.test(c)) return 'zh-hant';
    if (/^zh/.test(c)) return 'zh-hans';
    if (c === 'fil' || c === 'tgl') return 'tl';
    return c.split('-')[0];
  }

  function detectPageLanguageSmart(sampleText, htmlLangAttr) {
    var clean = String(sampleText || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/`[^`]+`/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return '';
    var letters = clean.match(/\p{L}/gu) || [];
    if (letters.length < 40) return '';
    var total = letters.length;
    var hangul = (clean.match(/[\uac00-\ud7af]/g) || []).length;
    if (hangul / total >= 0.12) return 'ko';
    var kana = (clean.match(/[\u3040-\u30ff]/g) || []).length;
    if (kana / total >= 0.06) return 'ja';
    var cyr = (clean.match(/[\u0400-\u04ff]/g) || []).length;
    if (cyr / total >= 0.18) return 'ru';
    var han = (clean.match(/[\u3400-\u9fff]/g) || []).length;
    if (han / total >= 0.15) {
      var yue = (clean.match(/[嘅喺咁噉咗冇係唔嚟畀俾搵諗睇攞仲晒哂喎囉㗎咩啲]/g) || []).length;
      if (yue >= 2) return 'yue';
      var tradHits = (clean.match(TRAD_ONLY_RE) || []).length;
      var simpHits = (clean.match(SIMP_ONLY_RE) || []).length;
      if (tradHits > simpHits || (tradHits === simpHits && /hant|tw|hk|mo/i.test(String(htmlLangAttr || '')))) {
        return 'zh-Hant';
      }
      return 'zh-Hans';
    }
    if (root && root.SS_LANG && typeof root.SS_LANG.detectLang === 'function') {
      return root.SS_LANG.detectLang([clean], '');
    }
    return 'en';
  }

  function shouldAutoTranslatePage(meta) {
    var m = meta || {};
    var protocol = String(m.protocol || '');
    if (!protocol || !/^https?:$/i.test(protocol)) return { translate: false, reason: 'non_http' };
    var hk = String(m.host || '').trim().toLowerCase();
    if (m.sessionDismissed) return { translate: false, reason: 'session_dismissed' };
    var pinned = hk && m.autoTranslateHosts && m.autoTranslateHosts[hk];
    var det = detectPageLanguageSmart(m.sampleText || '', m.htmlLang || '');
    var tl = m.tl || cfg.tl || 'zh-Hant';
    var detPair = normLangPair(det);
    var tlPair = normLangPair(tl);
    if (detPair && tlPair && (detPair === tlPair || (detPair.startsWith('zh-') && tlPair.startsWith('zh-')))) {
      return { translate: false, reason: 'same_language', detectedLang: det };
    }
    if (pinned === 'article' || pinned === 'full' || pinned === 'smart_i1') {
      if (!det) return { translate: false, reason: 'insufficient_prose', retryHydration: true };
      return { translate: true, reason: 'pinned_host', scope: pinned, detectedLang: det };
    }
    if (m.isConfiguredVideoSite) return { translate: false, reason: 'video_site' };
    if (hostMatchesList(hk, m.neverTranslateHosts)) return { translate: false, reason: 'never_host' };
    if (hostMatchesList(hk, WEB_APP_SKIP_HOSTS) || m.hasCodeEditorApp) return { translate: false, reason: 'webapp_guard' };
    if (m.autoTranslateForeign === false) return { translate: false, reason: 'disabled' };
    if (!det) return { translate: false, reason: 'insufficient_prose', retryHydration: true };
    var skips = Array.isArray(m.skipAutoTranslateLangs) ? m.skipAutoTranslateLangs : [];
    var detBase = det.toLowerCase().split('-')[0];
    for (var i = 0; i < skips.length; i++) {
      var sk = String(skips[i] || '').trim().toLowerCase();
      if (!sk) continue;
      if (sk === detPair || sk === detBase || normLangPair(sk) === detPair) {
        return { translate: false, reason: 'skipped_language', detectedLang: det };
      }
    }
    var scope = (m.autoTranslateScope === 'article' || m.autoTranslateScope === 'smart_i1') ? m.autoTranslateScope : 'full';
    return { translate: true, reason: 'foreign_language', detectedLang: det, scope: scope };
  }

  function computeInlineRetrievability(it, nowMs) {
    return root.SS_STORE && it ? root.SS_STORE.itemRetrievability(it, nowMs) : 1;
  }

  function findWebEpisodicMemory(queryText, items, traces, curDocTitle, url, lang) {
    return root.SS_STORE ? root.SS_STORE.findEpisodicMemory(queryText, items, traces, '', {
      title: curDocTitle, url: url, lang: lang
    }) : null;
  }

  function extractDomainEntities(srcText, trText, entityMap) {
    var map = entityMap && typeof entityMap === 'object' ? entityMap : Object.create(null);
    var src = String(srcText || '').trim();
    var tr = String(trText || '').trim();
    if (!src || !tr) return map;
    var srcQuotes = [];
    var trQuotes = [];
    var qRe = /[《「]([^》」]{2,18})[》」]/g;
    var m;
    while ((m = qRe.exec(src))) srcQuotes.push(m[1]);
    qRe.lastIndex = 0;
    while ((m = qRe.exec(tr))) trQuotes.push(m[1]);
    if (srcQuotes.length === trQuotes.length && srcQuotes.length > 0 && srcQuotes.length <= 2) {
      for (var q = 0; q < srcQuotes.length; q++) {
        if (srcQuotes[q] && trQuotes[q] && srcQuotes[q] !== trQuotes[q] && Object.keys(map).length < 24) {
          map[srcQuotes[q]] = trQuotes[q];
        }
      }
    }
    if (src.length <= 42 && tr.length <= 42 && !/[.!?。！？]/.test(src)) {
      var capM = src.match(/^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2}$/);
      if (capM && tr !== src && Object.keys(map).length < 24) {
        map[capM[0]] = tr;
      }
    }
    return map;
  }

  /* ==========================================================================
   * 2. Luhn Validation, Code/Math {vN} & PII Masking / Fuzzy Restoration
   * ========================================================================== */

  /**
   * Validates a 13-19 digit PAN string using the ISO/IEC 7812 Luhn algorithm.
   * Accepts optional spaces or hyphens between digit groups.
   */
  function luhnCheck(input) {
    if (typeof input !== 'string' && typeof input !== 'number') return false;
    var cleaned = String(input).replace(/[\s-]+/g, '');
    if (!/^\d{13,19}$/.test(cleaned)) return false;
    if (/^0+$/.test(cleaned)) return false;

    var sum = 0;
    var shouldDouble = false;
    for (var i = cleaned.length - 1; i >= 0; i--) {
      var digit = cleaned.charCodeAt(i) - 48;
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return (sum % 10) === 0;
  }

  function trimTrailingUrlPunct(url) {
    var end = url.length;
    while (end > 0) {
      var ch = url.charAt(end - 1);
      if (/[.,!?;:]/.test(ch)) {
        end--;
      } else if (ch === ')') {
        var slice = url.slice(0, end);
        var opens = (slice.match(/\(/g) || []).length;
        var closes = (slice.match(/\)/g) || []).length;
        if (closes > opens) end--;
        else break;
      } else if (ch === ']') {
        var sliceB = url.slice(0, end);
        var opensB = (sliceB.match(/\[/g) || []).length;
        var closesB = (sliceB.match(/\]/g) || []).length;
        if (closesB > opensB) end--;
        else break;
      } else {
        break;
      }
    }
    return { core: url.slice(0, end), suffix: url.slice(end) };
  }

  /**
   * Masks inline code (`...`), inline math ($...$), and URLs (http/https) as {v0}, {v1}, ...
   * Masks OpenAI/GitHub/AWS secrets, emails, and Luhn-valid 13-19 digit credit cards
   * as __PII_0__, __PII_1__, ... locally before network calls.
   */
  function maskText(str, seedMap) {
    var input = typeof str === 'string' ? str : String(str == null ? '' : str);
    var map = {};
    if (seedMap && typeof seedMap === 'object') {
      if (seedMap instanceof Map) {
        seedMap.forEach(function (v, k) { map[k] = v; });
      } else {
        assignObj(map, seedMap);
      }
    }
    if (!input) return { text: '', map: map };

    var vIdx = 0;
    var existingV = input.match(/\{v(\d+)\}/g) || [];
    for (var ev = 0; ev < existingV.length; ev++) {
      var vn = parseInt(existingV[ev].slice(2, -1), 10);
      if (vn >= vIdx) vIdx = vn + 1;
    }
    var mapKeys = Object.keys(map);
    for (var mk = 0; mk < mapKeys.length; mk++) {
      var vm = /^\{v(\d+)\}$/.exec(mapKeys[mk]);
      if (vm) {
        var vmn = parseInt(vm[1], 10);
        if (vmn >= vIdx) vIdx = vmn + 1;
      }
    }

    var piiIdx = 0;
    var existingP = input.match(/__PII_(\d+)__/g) || [];
    for (var ep = 0; ep < existingP.length; ep++) {
      var pn = parseInt(existingP[ep].slice(6, -2), 10);
      if (pn >= piiIdx) piiIdx = pn + 1;
    }
    for (var pk = 0; pk < mapKeys.length; pk++) {
      var pm = /^__PII_(\d+)__$/.exec(mapKeys[pk]);
      if (pm) {
        var pmn = parseInt(pm[1], 10);
        if (pmn >= piiIdx) piiIdx = pmn + 1;
      }
    }

    // Step 1: Mask inline code, inline math, and URLs as {vN}
    // Preserve existing {vN} tokens from DOM extraction untouched.
    var codeMathUrlRe = /\{v\d+\}|`[^`]+`|\$(?!\s)[^$\n]*?\S\$|\$[^$\s]\$|https?:\/\/\S+/g;
    var out = input.replace(codeMathUrlRe, function (match) {
      if (/^\{v\d+\}$/.test(match)) return match;
      if (match.indexOf('http://') === 0 || match.indexOf('https://') === 0) {
        var parts = trimTrailingUrlPunct(match);
        if (!parts.core || parts.core === 'http://' || parts.core === 'https://') return match;
        var uTok = '{v' + (vIdx++) + '}';
        map[uTok] = parts.core;
        return uTok + parts.suffix;
      }
      var tok = '{v' + (vIdx++) + '}';
      map[tok] = match;
      return tok;
    });

    // Catch remaining $...$ math expressions while skipping currency pairs like "$10 and $25"
    out = out.replace(/\$[^$\n]+\$/g, function (match) {
      if (/^\$\d+(?:[.,]\d+)?\s+.*\s+\$$/.test(match)) return match;
      var tok = '{v' + (vIdx++) + '}';
      map[tok] = match;
      return tok;
    });

    // Step 2: Mask API tokens (OpenAI sk-*, GitHub ghp_*/github_pat_*, AWS AKIA*/ASIA*)
    var tokenRe = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g;
    out = out.replace(tokenRe, function (match) {
      var tok = '__PII_' + (piiIdx++) + '__';
      map[tok] = match;
      return tok;
    });

    // Step 3: Mask email addresses
    var emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    out = out.replace(emailRe, function (match) {
      var tok = '__PII_' + (piiIdx++) + '__';
      map[tok] = match;
      return tok;
    });

    // Step 4: Mask 13-19 digit Luhn-validated credit card numbers
    var ccCandidateRe = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
    out = out.replace(ccCandidateRe, function (match) {
      if (!luhnCheck(match)) return match;
      var tok = '__PII_' + (piiIdx++) + '__';
      map[tok] = match;
      return tok;
    });

    return { text: out, map: map };
  }

  function lookupMapEntry(mapObj, canonicalKey, altKey) {
    if (!mapObj) return undefined;
    if (mapObj instanceof Map) {
      if (mapObj.has(canonicalKey)) return mapObj.get(canonicalKey);
      if (altKey && mapObj.has(altKey)) return mapObj.get(altKey);
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(mapObj, canonicalKey)) {
      return mapObj[canonicalKey];
    }
    if (altKey && Object.prototype.hasOwnProperty.call(mapObj, altKey)) {
      return mapObj[altKey];
    }
    return undefined;
  }

  /**
   * Restores {vN} and __PII_N__ tokens while tolerating LLM mangling:
   * - Extra spaces: "{ v0 }", "{ V 0 }", "__ PII_0 __", "_ pii _ 0 _"
   * - Case changes: "{V0}", "__pii_0__"
   * - Single/triple/fullwidth underscores or braces: "_PII_0_", "｛v0｝", "__PII0__"
   */
  function restoreText(str, mapOrResult) {
    var input = typeof str === 'string' ? str : String(str == null ? '' : str);
    if (!input || !mapOrResult) return input;
    var mapObj = (mapOrResult && typeof mapOrResult === 'object' && mapOrResult.map &&
      !(mapOrResult instanceof Map) && !Object.prototype.hasOwnProperty.call(mapOrResult, '{v0}') &&
      !Object.prototype.hasOwnProperty.call(mapOrResult, '__PII_0__'))
      ? mapOrResult.map
      : mapOrResult;

    var cur = input;
    for (var pass = 0; pass < 2; pass++) {
      var prev = cur;

      // Restore {vN} variants (ASCII or fullwidth braces, optional whitespace, case-insensitive)
      cur = cur.replace(/[{\uFF5B]\s*v\s*(\d+)\s*[}\uFF5D]/gi, function (full, idx) {
        var val = lookupMapEntry(mapObj, '{v' + idx + '}', 'v' + idx);
        return val !== undefined ? String(val) : full;
      });

      // Restore __PII_N__ variants (1-3 ASCII/fullwidth underscores, optional spaces, case-insensitive)
      cur = cur.replace(/[_\uFF3F]{1,3}\s*pii\s*[_\uFF3F]?\s*(\d+)\s*[_\uFF3F]{1,3}/gi, function (full, idx) {
        var val = lookupMapEntry(mapObj, '__PII_' + idx + '__', 'PII_' + idx);
        return val !== undefined ? String(val) : full;
      });

      if (cur === prev) break;
    }
    return cur;
  }

  /* ==========================================================================
   * 3. DOM Paragraph Extraction with {vN} Inline Element Replacement
   * ========================================================================== */

  function nodeHasAttr(node, attr) {
    if (!node) return false;
    if (typeof node.hasAttribute === 'function') return node.hasAttribute(attr);
    return Boolean(node.attributes && Object.prototype.hasOwnProperty.call(node.attributes, attr));
  }

  function nodeGetAttr(node, attr) {
    if (!node) return null;
    if (typeof node.getAttribute === 'function') return node.getAttribute(attr);
    if (node.attributes && Object.prototype.hasOwnProperty.call(node.attributes, attr)) {
      return node.attributes[attr];
    }
    return null;
  }

  function nodeHasClass(node, cls) {
    if (!node) return false;
    if (node.classList && typeof node.classList.contains === 'function') {
      return node.classList.contains(cls);
    }
    var cn = typeof node.className === 'string' ? node.className : (nodeGetAttr(node, 'class') || '');
    return (' ' + cn + ' ').indexOf(' ' + cls + ' ') !== -1;
  }

  function readPlainNodeText(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return node.nodeValue != null ? String(node.nodeValue) : (node.textContent || '');
    }
    if (typeof node.textContent === 'string') return node.textContent;
    var children = node.childNodes || [];
    var acc = '';
    for (var i = 0; i < children.length; i++) {
      acc += readPlainNodeText(children[i]);
    }
    return acc;
  }

  /**
   * Cleanly extracts text from a DOM paragraph/block element while:
   * - Replacing <code>, <kbd>, <math>, and [data-math] elements with {v0}, {v1}, ...
   *   before reading textContent
   * - Coalescing plain inline tags (<a>, <b>, <i>, <em>, <strong>, <span>, etc.)
   *   seamlessly into a single paragraph string
   * - Ignoring injected [data-ss-page-tr] / .ss-pop / script / style nodes.
   */
  function extractBlockWithPlaceholders(blockEl) {
    var map = {};
    if (!blockEl) return { text: '', map: map };

    var vIdx = 0;
    var chunks = [];

    function walk(node) {
      if (!node) return;
      var nt = node.nodeType;
      if (nt === 3) {
        var raw = node.nodeValue != null ? String(node.nodeValue) : (node.textContent || '');
        chunks.push(raw.replace(/[\t\r\n ]+/g, ' '));
        return;
      }
      if (nt !== 1) return;

      var tag = String(node.tagName || node.nodeName || '').toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'rt' || tag === 'rp') return;
      if (nodeHasAttr(node, 'data-ss-page-tr') || nodeHasAttr(node, 'data-ss-select') ||
          nodeHasAttr(node, 'data-ss-input-preview') || nodeHasClass(node, 'ss-pop')) {
        return;
      }

      if (tag === 'br') {
        chunks.push('\n');
        return;
      }

      if (tag === 'code' || tag === 'kbd' || tag === 'math' || nodeHasAttr(node, 'data-math')) {
        var mathAttr = nodeGetAttr(node, 'data-math');
        var innerTxt = readPlainNodeText(node);
        var preserved = (innerTxt && innerTxt.trim()) ? innerTxt : (mathAttr || innerTxt || '');
        if (!preserved) return;
        var tok = '{v' + (vIdx++) + '}';
        map[tok] = preserved;
        chunks.push(tok);
        return;
      }

      var children = node.childNodes || [];
      for (var i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    }

    var topChildren = blockEl.childNodes;
    if (topChildren && topChildren.length > 0) {
      for (var c = 0; c < topChildren.length; c++) {
        walk(topChildren[c]);
      }
    } else if (typeof blockEl.textContent === 'string') {
      chunks.push(blockEl.textContent.replace(/[\t\r\n ]+/g, ' '));
    }

    var joined = chunks.join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return { text: joined, map: map };
  }

  /* ==========================================================================
   * 4. In-Memory 128-Entry LRU Cache & Background Messaging Helpers
   * ========================================================================== */

  function createLRUCache(limit) {
    var max = limit || MAX_LRU;
    var store = new Map();
    return {
      get: function (key) {
        if (!store.has(key)) return undefined;
        var val = store.get(key);
        store.delete(key);
        store.set(key, val);
        return val;
      },
      set: function (key, value) {
        if (store.has(key)) store.delete(key);
        else if (store.size >= max) {
          var oldestKey = store.keys().next().value;
          store.delete(oldestKey);
        }
        store.set(key, value);
      },
      has: function (key) {
        return store.has(key);
      },
      get size() {
        return store.size;
      },
      clear: function () {
        store.clear();
      }
    };
  }

  var trLru = createLRUCache(MAX_LRU);

  function sendBgMessage(payload, fallbackTimeoutMs) {
    return new Promise(function (resolve) {
      var ch = (typeof chrome !== 'undefined' && chrome) ? chrome : (root && root.chrome);
      if (!ch || !ch.runtime || typeof ch.runtime.sendMessage !== 'function') {
        resolve(null);
        return;
      }
      var settled = false;
      var timer = null;
      if (fallbackTimeoutMs && fallbackTimeoutMs > 0) {
        timer = setTimeout(function () {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        }, fallbackTimeoutMs);
      }
      function finish(val) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(val === undefined ? null : val);
      }
      try {
        var maybePromise = ch.runtime.sendMessage(payload, function (resp) {
          var lastErr = ch.runtime && ch.runtime.lastError;
          if (lastErr) {
            finish(null);
            return;
          }
          finish(resp);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(finish, function () { finish(null); });
        }
      } catch (_err) {
        finish(null);
      }
    });
  }

  function glossaryPairs(glossary) {
    return Array.isArray(glossary) ? glossary.map(entry => [entry?.src, entry?.dst]) : Object.entries(glossary || {});
  }

  function orderedGlossary(glossary) {
    return Object.fromEntries(glossaryPairs(glossary)
      .filter(([source, target]) => typeof source === 'string' && source && typeof target === 'string' && target)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }

  // Page text may leave the machine only when the user chose a cloud service for this scene
  // or switched on cloud fallback. Local model, then Chrome's on-device Translator, come first.
  function cloudAllowed(route) {
    return route.choice === 'free_web' || route.choice === 'custom_openai' || cfg.cloudFallback === true;
  }

  function resolveTranslationRoute(options) {
    const choice = options.localOnly ? 'local_only' : (cfg.sceneServices[options.scene] || 'auto');
    const localModels = {
      local_plamo2b: 'plamo-2b', local_index2b: 'index-2b',
      local_gemma_e4b: 'gemma-e4b', local_hymt7b: 'hy-mt2-7b'
    };
    return {
      choice, model: localModels[choice] || options.model || cfg.model,
      device: options.device || cfg.mtDevice, companionUrl: cfg.companionUrl,
      customApi: cfg.customApi, provider: cfg.webMtProvider, fallback: cfg.webMtFallback
    };
  }

  async function cacheScope(route, targetLang, context, glossary, batch) {
    if (route.choice === 'free_web') {
      context = '';
      glossary = null;
    }
    const identity = JSON.stringify([batch, route.choice, targetLang, route.model,
      route.device, route.companionUrl, route.customApi?.baseUrl, route.customApi?.model,
      route.provider, route.fallback, context, glossary]);
    // On insecure HTTP pages WebCrypto may be unavailable. Keep exact identities in memory there.
    if (!root.crypto?.subtle) return 'memory:' + identity;
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return 'mt-v3:' + hex;
  }

  function makeCacheKey(scope, maskedText, mapObj) {
    const placeholders = Object.keys(mapObj || {}).sort()
      .filter(key => key.startsWith('{v')).map(key => [key, mapObj[key]]);
    return scope + JSON.stringify([maskedText, placeholders]);
  }

  function webTranslationRequest(texts, targetLang, route) {
    return { op: 'webTranslate', texts, sl: 'auto', tl: targetLang,
      provider: route.provider, fallback: route.fallback };
  }

  function isPreferredWebResult(reply, index, route) {
    return !reply.providers || reply.providers[index] === route.provider;
  }

  function trCacheGet(key) {
    var mem = trLru.get(key);
    if (mem !== undefined) return Promise.resolve(mem);
    if (key.startsWith('memory:')) return Promise.resolve(null);
    return sendBgMessage({ op: 'trCacheGet', key: key }, 600).then(function (resp) {
      var val = null;
      if (typeof resp === 'string' && resp) {
        val = resp;
      } else if (resp && typeof resp === 'object') {
        if (typeof resp.value === 'string' && resp.value) val = resp.value;
        else if (typeof resp.translation === 'string' && resp.translation) val = resp.translation;
      }
      if (val) trLru.set(key, val);
      return val;
    });
  }

  function trCacheSet(key, value) {
    if (!key || typeof value !== 'string' || !value) return;
    trLru.set(key, value);
    if (!key.startsWith('memory:')) sendBgMessage({ op: 'trCacheSet', key: key, value: value }, 1500);
  }

  function getDocTitle() {
    var d = (typeof document !== 'undefined' && document) ? document : (root && root.document);
    if (d && typeof d.title === 'string') {
      return d.title;
    }
    return '';
  }

  function extractTranslatedString(resp) {
    if (!resp || resp.ok === false) return null;
    if (typeof resp.translation === 'string') return resp.translation;
    if (typeof resp.text === 'string') return resp.text;
    if (resp.data && typeof resp.data === 'object') {
      if (typeof resp.data.translation === 'string') return resp.data.translation;
      if (typeof resp.data.text === 'string') return resp.data.text;
    }
    if (typeof resp.result === 'string') return resp.result;
    return null;
  }


  /**
   * Captionary + Read Frog inspired untrusted <context> wrapper:
   * Prevents webpage prompt-injection breakouts while supplying page title + Markdown digest for polysemy.
   */
  function sanitizeUntrustedContext(title, summary) {
    var cleanTitle = String(title || '').replace(/<\/?context[^>]*>/gi, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
    var cleanSum = String(summary || '').replace(/<\/?context[^>]*>/gi, '').replace(/\s+/g, ' ').trim().slice(0, 320);
    if (!cleanTitle && !cleanSum) return '';
    var inner = [];
    if (cleanTitle) inner.push('Title: ' + cleanTitle);
    if (cleanSum) inner.push('Digest: ' + cleanSum);
    return '<context untrusted="true">\n' + inner.join('\n') + '\n</context>';
  }

  /**
   * Captionary-inspired Chrome Built-in On-Device Translator API waterfall fallback (zero cloud / zero cost).
   */
  function tryChromeBuiltinTranslate(text, sourceLang, targetLang, globalScope) {
    var g = globalScope || (typeof globalThis !== 'undefined' ? globalThis : root);
    if (!cfg.useChromeBuiltinTranslator || !text || !String(text).trim()) return Promise.resolve(null);
    var TranslatorApi = (g && g.Translator) || (g && g.ai && g.ai.translator);
    if (!TranslatorApi || typeof TranslatorApi.create !== 'function') return Promise.resolve(null);
    var rawTxt = String(text);
    var dst = String(targetLang || cfg.tl || 'en').replace(/^zh-(TW|HK)$/i, 'zh-Hant');
    var src = (sourceLang && sourceLang !== 'auto') ? String(sourceLang).split('-')[0] : '';
    if (!src) {
      if (/[\u3040-\u30ff]/.test(rawTxt)) src = 'ja';
      else if (/[\uac00-\ud7af]/.test(rawTxt)) src = 'ko';
      else if (/[\u0400-\u04ff]/.test(rawTxt)) src = 'ru';
      else if (/[\u3400-\u9fff]/.test(rawTxt)) src = 'zh';
      else if (root && root.SS_LANG && typeof root.SS_LANG.detectLang === 'function') {
        var det = root.SS_LANG.detectLang([rawTxt], '');
        if (det && (det !== 'en' || (dst !== 'en' && /[A-Za-z]{3,}/.test(rawTxt)))) src = String(det).split('-')[0];
      }
    }
    if (!src || src === dst) return Promise.resolve(null);
    try {
      return TranslatorApi.create({ sourceLanguage: src, targetLanguage: dst }).then(function (inst) {
        if (!inst || typeof inst.translate !== 'function') return null;
        return inst.translate(rawTxt);
      }).then(function (res) {
        return (typeof res === 'string' && res.trim()) ? res.trim() : null;
      }, function () { return null; });
    } catch (_e) {
      return Promise.resolve(null);
    }
  }

  /**
   * MIT illa-helper inspired Dual-Layer Phrase Constituent Extractor:
   * Splits a multi-word expression or CJK phrase into inspectable constituent word tokens.
   */
  function extractConstituentTokens(phraseText) {
    var raw = String(phraseText || '').trim();
    if (!raw || raw.length > 120) return [];
    var langApi = root && root.SS_LANG;
    var hasCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(raw);
    var tokens = [];
    var seen = Object.create(null);
    if (langApi && typeof langApi.get === 'function') {
      var code = /[\u3040-\u30ff]/.test(raw) ? 'ja' : /[\uac00-\ud7af]/.test(raw) ? 'ko' : hasCjk ? 'zh' : 'en';
      var L = langApi.get(code);
      var parts = L.split(raw);
      for (var i = 0; i < parts.length; i++) {
        var tk = parts[i];
        if (!tk || !tk.word) continue;
        var w = tk.w.trim();
        if (!w || (!hasCjk && w.length < 2)) continue;
        var lem = L.lemma ? L.lemma(w) : w.toLowerCase();
        if (seen[lem]) continue;
        seen[lem] = 1;
        tokens.push({ word: w, lemma: lem });
      }
    } else {
      var words = hasCjk ? Array.from(raw).filter(function (c) { return /\S/.test(c); }) : raw.split(/\s+/);
      for (var j = 0; j < words.length; j++) {
        var clean = words[j].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!clean) continue;
        var key = clean.toLowerCase();
        if (seen[key]) continue;
        seen[key] = 1;
        tokens.push({ word: clean, lemma: key });
      }
    }
    return tokens.length >= 2 ? tokens.slice(0, 8) : [];
  }

  /**
   * Clean-room Yomitan-inspired Shift-hover point scanner:
   * Given a text string and character offset under the pointer, prioritizes any formulaic expression
   * covering the cursor before falling back to the exact word/compound token at charOffset.
   */
  function scanPointTextWindow(fullText, charOffset, langHint, tlHint) {
    var str = String(fullText || '');
    if (!str || charOffset < 0 || charOffset >= str.length) return null;
    if (/\s/.test(str.charAt(charOffset))) return null;

    var winStart = Math.max(0, charOffset - 36);
    var winEnd = Math.min(str.length, charOffset + 48);
    // Expand gently to word boundaries on spaced scripts
    while (winStart > 0 && /[^\s.!?。！？\n]/.test(str.charAt(winStart - 1)) && (charOffset - winStart) < 56) winStart--;
    while (winEnd < str.length && /[^\s.!?。！？\n]/.test(str.charAt(winEnd)) && (winEnd - charOffset) < 64) winEnd++;

    var slice = str.slice(winStart, winEnd);
    var relOff = charOffset - winStart;

    // 1. Check SS_IDIOMS for any FE span covering relOff (longest surface wins)
    var idiomApi = root && root.SS_IDIOMS;
    if (idiomApi && typeof idiomApi.findInText === 'function') {
      try {
        var hits = idiomApi.findInText(slice, tlHint || cfg.tl, langHint || '');
        var covering = [];
        for (var h = 0; h < (hits || []).length; h++) {
          var it = hits[h];
          var hs = typeof it.start === 'number' ? it.start : slice.indexOf(it.match || it.phrase || '');
          var surf = it.match || it.surface || it.phrase || '';
          var he = typeof it.end === 'number' ? it.end : (hs >= 0 ? hs + surf.length : -1);
          if (hs >= 0 && he > hs && relOff >= hs && relOff < he) {
            covering.push({ hit: it, start: winStart + hs, end: winStart + he, len: he - hs });
          }
        }
        if (covering.length > 0) {
          covering.sort(function (a, b) { return b.len - a.len; });
          var best = covering[0];
          var surfaceStr = str.slice(best.start, best.end);
          return {
            surface: surfaceStr,
            canonical: best.hit.canonical || best.hit.phrase || surfaceStr,
            gloss: best.hit.gloss || '',
            isFe: true,
            start: best.start,
            end: best.end,
            constituents: extractConstituentTokens(surfaceStr)
          };
        }
      } catch (_e) {}
    }

    // 2. Fallback: exact word / CJK compound covering relOff
    var hasCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(slice);
    var langApi = root && root.SS_LANG;
    if (langApi && typeof langApi.get === 'function') {
      var code = langHint || (/[\u3040-\u30ff]/.test(slice) ? 'ja' : /[\uac00-\ud7af]/.test(slice) ? 'ko' : hasCjk ? 'zh' : 'en');
      var L = langApi.get(code);
      var toks = L.split(slice);
      var pos = 0;
      for (var t = 0; t < toks.length; t++) {
        var tk = toks[t];
        var t0 = pos;
        var t1 = t0 + tk.w.length;
        pos = t1;
        if (tk.word && relOff >= t0 && relOff < t1) {
          var wSurf = slice.slice(t0, t1);
          return {
            surface: wSurf,
            canonical: L.lemma ? L.lemma(wSurf) : wSurf.toLowerCase(),
            gloss: '',
            isFe: false,
            start: winStart + t0,
            end: winStart + t1,
            constituents: extractConstituentTokens(wSurf)
          };
        }
      }
    }

    // 3. Unicode letter/number run fallback
    var s0 = charOffset;
    var s1 = charOffset + 1;
    var wordCharRe = /[\p{L}\p{N}'’-]/u;
    if (!wordCharRe.test(str.charAt(charOffset))) return null;
    if (hasCjk && /[\u3400-\u9fff]/.test(str.charAt(charOffset))) {
      s1 = Math.min(str.length, charOffset + 2);
    } else {
      while (s0 > 0 && wordCharRe.test(str.charAt(s0 - 1))) s0--;
      while (s1 < str.length && wordCharRe.test(str.charAt(s1))) s1++;
    }
    var fallbackSurf = str.slice(s0, s1);
    return {
      surface: fallbackSurf,
      canonical: fallbackSurf.toLowerCase(),
      gloss: '',
      isFe: false,
      start: s0,
      end: s1,
      constituents: []
    };
  }

  /**
   * MIT illa-helper + Fluent Tab inspired L1->L2 comprehensible-input replacement planner:
   * Finds non-overlapping whole-word L1 matches from the user's saved study items (up to ratio budget)
   * while skipping any item already marked 'known' in wordsMap.
   */
  function selectL1WeaveCandidates(text, savedItems, wordsMap, ratio) {
    var src = String(text || '');
    if (!src || src.length < 12 || !Array.isArray(savedItems) || savedItems.length === 0) return [];
    var r = typeof ratio === 'number' ? Math.min(0.5, Math.max(0.01, ratio)) : 0.08;
    var maxSwaps = Math.max(1, Math.floor((src.split(/\s+/).length || Math.ceil(src.length / 4)) * r));
    var wMap = wordsMap || {};

    var pairs = [];
    for (var i = 0; i < savedItems.length; i++) {
      var it = savedItems[i];
      if (!it || !it.word) continue;
      var l2Word = String(it.word).trim();
      var l2Lem = String(it.lemma || l2Word).toLowerCase();
      var lg = String(it.lang || 'en').toLowerCase().split('-')[0];
      if (wMap[lg + '|' + l2Lem] === 'known' || wMap[l2Lem] === 'known') continue;

      // Candidate L1 triggers: short clean glosses/translations or cross-lingual equivalents
      var triggers = [];
      if (it.eq && typeof it.eq === 'object') {
        var eqKeys = Object.keys(it.eq);
        for (var k = 0; k < eqKeys.length; k++) {
          var v = it.eq[eqKeys[k]];
          if (Array.isArray(v)) triggers = triggers.concat(v);
          else if (typeof v === 'string') triggers.push(v);
        }
      }
      if (typeof it.def === 'string') triggers.push(it.def.split(/[;；,，/·(（]/)[0]);
      if (typeof it.trans === 'string' && it.trans.length <= 28) triggers.push(it.trans);

      for (var t = 0; t < triggers.length; t++) {
        var trig = String(triggers[t] || '').replace(/^to\s+/i, '').trim();
        if (trig.length < 3 || trig.length > 32 || trig.toLowerCase() === l2Word.toLowerCase()) continue;
        pairs.push({
          l1Trigger: trig,
          l2Target: l2Word,
          lemma: l2Lem,
          lang: lg,
          reading: it.reading || '',
          def: it.def || it.trans || trig
        });
      }
    }
    if (pairs.length === 0) return [];
    pairs.sort(function (a, b) { return b.l1Trigger.length - a.l1Trigger.length; });

    var chosen = [];
    var occupied = [];
    function overlaps(s, e) {
      for (var o = 0; o < occupied.length; o++) {
        if (s < occupied[o][1] && e > occupied[o][0]) return true;
      }
      return false;
    }

    for (var p = 0; p < pairs.length && chosen.length < maxSwaps; p++) {
      var pr = pairs[p];
      var esc = pr.l1Trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var isCjkTrig = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(pr.l1Trigger);
      var re = isCjkTrig ? new RegExp(esc, 'i') : new RegExp('(^|[^\\p{L}\\p{N}])(' + esc + ')(?=$|[^\\p{L}\\p{N}])', 'iu');
      var m = re.exec(src);
      if (!m) continue;
      var matchStart = isCjkTrig ? m.index : (m.index + m[1].length);
      var matchStr = isCjkTrig ? m[0] : m[2];
      var matchEnd = matchStart + matchStr.length;
      if (overlaps(matchStart, matchEnd)) continue;
      occupied.push([matchStart, matchEnd]);
      chosen.push({
        start: matchStart,
        end: matchEnd,
        original: matchStr,
        l2Target: pr.l2Target,
        lemma: pr.lemma,
        lang: pr.lang,
        reading: pr.reading,
        def: pr.def
      });
    }
    chosen.sort(function (a, b) { return a.start - b.start; });
    return chosen;
  }

  /**
   * Translates a single text string with {vN} + PII masking, LRU + trCacheGet/Set,
   * and fuzzy placeholder restoration.
   */
  async function translateSingleText(rawText, opts, seedMap) {
    var options = opts || {};
    var targetLang = options.targetLang || cfg.tl;
    var route = resolveTranslationRoute(options);
    var context = options.context || '';
    var title = options.title != null ? options.title : getDocTitle();

    var masked = maskText(rawText, seedMap);
    if (!masked.text.trim()) {
      return Promise.resolve({ ok: true, text: restoreText(masked.text, masked.map), cached: true, latencyMs: 0 });
    }

    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var promptContext = sanitizeUntrustedContext(title, context);
    var scope = await cacheScope(route, targetLang, promptContext, null, false);
    var cacheKey = makeCacheKey(scope, masked.text, masked.map);
    var lookupPromise = options.bypassCache ? Promise.resolve(null) : trCacheGet(cacheKey);
    var svcChoice = route.choice;

    var runWebFallback = async function (errFallback) {
      var onDevice = await tryChromeBuiltinTranslate(masked.text, 'auto', targetLang).catch(function () { return null; });
      if (onDevice) return { ok: true, text: restoreText(onDevice, masked.map), cached: false, provider: 'chrome-on-device', latencyMs: 0 };
      if (!cloudAllowed(route)) return { ok: false, error: String(errFallback || 'Local translation unavailable. Start the companion, or allow cloud translation in Options.'), text: '' };
      return sendBgMessage(webTranslationRequest([masked.text], targetLang, route), 26000).then(function (wr) {
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var wtr = wr && wr.ok && Array.isArray(wr.translations) ? wr.translations[0] : '';
        if (wtr) {
          if (svcChoice === 'free_web' && isPreferredWebResult(wr, 0, route)) trCacheSet(cacheKey, wtr);
          return { ok: true, text: restoreText(wtr, masked.map), cached: false, provider: wr.provider || 'web-mt', latencyMs: Math.max(0, Math.round(now - t0)) };
        }
        return { ok: false, error: String(wr?.error || errFallback || 'Translation unavailable'), text: '', latencyMs: Math.max(0, Math.round(now - t0)) };
      });
    };

    return lookupPromise.then(function (cachedVal) {
      if (typeof cachedVal === 'string' && cachedVal) {
        var nowCached = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        return {
          ok: true,
          text: restoreText(cachedVal, masked.map),
          cached: true,
          latencyMs: Math.max(0, Math.round(nowCached - t0))
        };
      }

      if (svcChoice === 'free_web') {
        return runWebFallback('');
      }
      if (svcChoice === 'browser_api') {
        return tryChromeBuiltinTranslate(masked.text, 'auto', targetLang).then(function (builtinTr) {
          var nowB = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (builtinTr) {
            trCacheSet(cacheKey, builtinTr);
            return { ok: true, text: restoreText(builtinTr, masked.map), cached: false, provider: 'chrome-ai', latencyMs: Math.max(0, Math.round(nowB - t0)) };
          }
          return runWebFallback('');
        });
      }
      if (svcChoice === 'custom_openai') {
        return sendBgMessage({
          op: 'customTranslate',
          text: masked.text,
          tl: targetLang,
          customApi: route.customApi || null,
          timeoutMs: 25000
        }, 26000).then(function (cr) {
          var nowC = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (cr && cr.ok && cr.translation) {
            trCacheSet(cacheKey, cr.translation);
            return { ok: true, text: restoreText(cr.translation, masked.map), cached: false, provider: cr.model || 'custom-api', latencyMs: Math.max(0, Math.round(nowC - t0)) };
          }
          return runWebFallback(cr && cr.error);
        });
      }

      return sendBgMessage({
        op: 'companion',
        path: '/translate_text',
        body: {
          text: masked.text,
          target_lang: targetLang,
          context: promptContext,
          title: title,
          model: route.model,
          device: route.device
        },
        method: 'POST',
        timeoutMs: 60000,
        url: route.companionUrl
      }, 62000).then(function (resp) {
        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var tr = extractTranslatedString(resp);
        if (!tr || !tr.trim()) {
          if (options.localOnly) {
            return { ok: false, error: (resp && (resp.error || resp.message)) || 'Local model unavailable', latencyMs: Math.max(0, Math.round(now - t0)) };
          }
          return tryChromeBuiltinTranslate(masked.text, 'auto', targetLang).then(function (builtinTr) {
            if (builtinTr) {
              return { ok: true, text: restoreText(builtinTr, masked.map), cached: false, provider: 'chrome-ai', latencyMs: Math.max(0, Math.round(now - t0)) };
            }
            return runWebFallback(resp && (resp.error || resp.message));
          });
        }
        trCacheSet(cacheKey, tr);
        return {
          ok: true,
          text: restoreText(tr, masked.map),
          model: resp.model,
          cached: false,
          latencyMs: Math.max(0, Math.round(now - t0))
        };
      });
    });
  }

  /**
   * Translates a batch of prepared segments [{ id, rawText, seedMap }] via /translate_batch,
   * checking LRU + trCacheGet first and gracefully falling back to parallel /translate_text
   * whenever /translate_batch returns !r || !r.ok || !Array.isArray(r.translations).
   */
  async function translateSegmentsBatch(items, opts, sendFnOverride) {
    var sendFn = sendFnOverride || sendBgMessage;
    var options = opts || {};
    var targetLang = options.targetLang || cfg.tl;
    var route = resolveTranslationRoute(options);
    var title = options.title != null ? options.title : getDocTitle();
    var summary = options.summary || '';
    var glossary = orderedGlossary(options.glossary || cfg.glossary);
    var promptContext = sanitizeUntrustedContext(title, summary);
    var scope = await cacheScope(route, targetLang, promptContext, glossary, true);

    var prepared = items.map(function (item, idx) {
      var id = item.id != null ? String(item.id) : String(idx);
      var rawStr = item.rawText != null ? item.rawText : item.text;
      var masked = maskText(rawStr, item.seedMap);
      var cacheKey = makeCacheKey(scope, masked.text, masked.map);
      return {
        id: id,
        rawText: rawStr,
        seedMap: item.seedMap,
        maskedText: masked.text,
        map: masked.map,
        cacheKey: cacheKey,
        result: null
      };
    });

    return Promise.all(prepared.map(function (p) {
      if (!p.maskedText.trim()) {
        p.result = restoreText(p.maskedText, p.map);
        return Promise.resolve();
      }
      if (sendFnOverride) {
        var memOnly = trLru.get(p.cacheKey);
        if (memOnly !== undefined) p.result = restoreText(memOnly, p.map);
        return Promise.resolve();
      }
      return trCacheGet(p.cacheKey).then(function (cached) {
        if (typeof cached === 'string' && cached) {
          p.result = restoreText(cached, p.map);
          if (options.onCached) options.onCached(p.id, p.result);
        }
      });
    })).then(function () {
      var misses = prepared.filter(function (p) { return p.result === null; });
      if (misses.length === 0) {
        var hitMap = {};
        for (var h = 0; h < prepared.length; h++) hitMap[prepared[h].id] = prepared[h].result;
        return hitMap;
      }

      var batchScene = route.choice;
      if (!sendFnOverride && batchScene === 'free_web') {
        return sendFn(webTranslationRequest(misses.map(m => m.maskedText), targetLang, route), 45000).then(function (wr) {
          var trs = wr && wr.ok && Array.isArray(wr.translations) ? wr.translations : [];
          for (var wi = 0; wi < misses.length; wi++) {
            var wt = trs[wi];
            if (wt) {
              if (isPreferredWebResult(wr, wi, route)) trCacheSet(misses[wi].cacheKey, wt);
              misses[wi].result = restoreText(wt, misses[wi].map);
            }
          }
          var outWeb = {};
          for (var wj = 0; wj < prepared.length; wj++) outWeb[prepared[wj].id] = prepared[wj].result;
          return outWeb;
        });
      }
      if (!sendFnOverride && batchScene === 'custom_openai') {
        return sendFn({
          op: 'customTranslate',
          texts: misses.map(function (m) { return m.maskedText; }),
          tl: targetLang,
          customApi: route.customApi || null,
          timeoutMs: 35000
        }, 37000).then(function (cr) {
          var trsC = cr && cr.ok && Array.isArray(cr.translations) ? cr.translations : [];
          var rem = [];
          for (var ci = 0; ci < misses.length; ci++) {
            var ct = trsC[ci];
            if (ct) {
              trCacheSet(misses[ci].cacheKey, ct);
              misses[ci].result = restoreText(ct, misses[ci].map);
            } else {
              rem.push(misses[ci]);
            }
          }
          if (!rem.length) {
            var outCust = {};
            for (var cj = 0; cj < prepared.length; cj++) outCust[prepared[cj].id] = prepared[cj].result;
            return outCust;
          }
          return sendFn(webTranslationRequest(rem.map(m => m.maskedText), targetLang, route), 45000).then(function (wrC) {
            var wTrs = wrC && wrC.ok && Array.isArray(wrC.translations) ? wrC.translations : [];
            for (var ri = 0; ri < rem.length; ri++) {
              if (wTrs[ri]) {
                rem[ri].result = restoreText(wTrs[ri], rem[ri].map);
              }
            }
            var outCust2 = {};
            for (var ck = 0; ck < prepared.length; ck++) outCust2[prepared[ck].id] = prepared[ck].result;
            return outCust2;
          });
        });
      }
      if (!sendFnOverride && batchScene === 'browser_api') {
        var bCursor = 0;
        var workerCount = Math.min(4, misses.length);
        var bWorkers = [];
        for (var bw = 0; bw < workerCount; bw++) {
          bWorkers.push((function runWorker() {
            if (bCursor >= misses.length) return Promise.resolve();
            var m = misses[bCursor++];
            return translateSingleText(m.rawText, {
              scene: options.scene,
              targetLang: targetLang,
              title: title,
              context: summary,
              bypassCache: true
            }, m.seedMap).then(function (r) {
              if (r && r.ok && r.text) m.result = r.text;
            }).then(runWorker);
          })());
        }
        return Promise.all(bWorkers).then(function () {
          var outSc = {};
          for (var sj = 0; sj < prepared.length; sj++) outSc[prepared[sj].id] = prepared[sj].result;
          return outSc;
        });
      }
      var batchSegments = misses.map(function (m) {
        return { id: m.id, text: m.maskedText };
      });

      async function recoverMissing(subset) {
        if (sendFnOverride || options.localOnly) return fallbackParallel(subset);
        const remote = [];
        for (const item of subset) {
          const translated = await tryChromeBuiltinTranslate(item.maskedText, 'auto', targetLang);
          if (translated) {
            item.result = restoreText(translated, item.map);
          } else remote.push(item);
        }
        if (!remote.length) return;
        if (!cloudAllowed(route)) { await fallbackParallel(remote); return; }
        const reply = await sendFn(webTranslationRequest(remote.map(item => item.maskedText), targetLang, route), 45000);
        const remaining = [];
        remote.forEach((item, i) => {
          const text = reply?.translations?.[i];
          if (typeof text === 'string' && text.trim()) {
            item.result = restoreText(text, item.map);
          } else remaining.push(item);
        });
        if (remaining.length) await fallbackParallel(remaining);
      }
      function fallbackParallel(subset) {
        return Promise.all(subset.map(function (m) {
          return sendFn({
            op: 'companion',
            path: '/translate_text',
            body: {
              text: m.maskedText,
              target_lang: targetLang,
              context: promptContext,
              title: title,
              model: route.model,
              device: route.device
            },
            method: 'POST',
            timeoutMs: 60000,
            url: route.companionUrl
          }, 62000).then(function (r) {
            var tr = extractTranslatedString(r);
            if (tr != null) {
              // The legacy single endpoint does not receive glossary instructions.
              if (Object.keys(glossary).length === 0) {
                if (!sendFnOverride) trCacheSet(m.cacheKey, tr);
                else trLru.set(m.cacheKey, tr);
              }
              m.result = restoreText(tr, m.map);
            } else {
              m.result = '';
            }
          });
        }));
      }

      return sendFn({
        op: 'companion',
        path: '/translate_batch',
        body: {
          segments: batchSegments,
          target_lang: targetLang,
          title: title,
          summary: promptContext,
          glossary: glossary,
          model: route.model,
          device: route.device,
          think: false
        },
        method: 'POST',
        timeoutMs: 60000,
        url: route.companionUrl
      }, 62000).then(function (r) {
        if (!r || !r.ok || !Array.isArray(r.translations)) {
          return recoverMissing(misses);
        }

        var byId = {};
        for (var i = 0; i < r.translations.length; i++) {
          var entry = r.translations[i];
          if (typeof entry === 'string') {
            if (misses[i]) byId[misses[i].id] = entry;
          } else if (entry && typeof entry === 'object') {
            var eid = entry.id != null ? String(entry.id) : (misses[i] ? misses[i].id : '');
            var etxt = typeof entry.translation === 'string' ? entry.translation
              : (typeof entry.text === 'string' ? entry.text : null);
            if (eid && etxt != null) byId[eid] = etxt;
          }
        }

        const failedIds = new Set((r.failed_ids || []).map(String));
        var unresolved = [];
        for (var j = 0; j < misses.length; j++) {
          var m = misses[j];
          if (!failedIds.has(String(m.id)) && typeof byId[m.id] === 'string' && byId[m.id].trim()) {
            var rawTr = byId[m.id];
            if (!sendFnOverride) trCacheSet(m.cacheKey, rawTr);
            else trLru.set(m.cacheKey, rawTr);
            m.result = restoreText(rawTr, m.map);
          } else {
            unresolved.push(m);
          }
        }

        if (unresolved.length > 0) {
          return recoverMissing(unresolved);
        }
        return null;
      }).then(function () {
        var outMap = {};
        for (var k = 0; k < prepared.length; k++) {
          outMap[prepared[k].id] = prepared[k].result || '';
        }
        return outMap;
      });
    });
  }

  function webpageRoutingSettingsKey() {
    return JSON.stringify([cfg.tl, resolveTranslationRoute({ scene: 'webpage' }).choice,
      cfg.model, cfg.mtDevice, cfg.companionUrl, cfg.webMtProvider, cfg.webMtFallback,
      cfg.customApi, cfg.useChromeBuiltinTranslator, orderedGlossary(cfg.glossary)]);
  }

  function buildCompareModels(activeModel) {
    var active = String(activeModel || cfg.model || '').trim();
    var candidates = ['plamo-2b', 'hy-mt2', 'index-2b', 'translategemma-4b'];
    var families = [/^plamo-/, /^hy-?mt/, /^index-?/, /^trans(?:late)?gemma/];
    var alreadyRepresented = families.findIndex(function (pattern) { return pattern.test(active); });
    return active ? [active].concat(candidates.filter(function (_, i) { return i !== alreadyRepresented; })) : candidates;
  }

  var STUDY_ACTIONS = [
    { id: 'explain', label: 'Explain', promptHint: 'Explain meaning and idiomatic usage in context.' },
    { id: 'grammar', label: 'Grammar', promptHint: 'Break down clause syntax, morphology, and particles.' },
    { id: 'register', label: 'Register', promptHint: 'Analyze formality, politeness level, and pragmatic tone.' },
    { id: 'chunks', label: 'Chunks', promptHint: 'Extract reusable collocations and formulaic patterns.' }
  ];

  function splitTtsChunks(text, maxLen) {
    var limit = maxLen || 180;
    var raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return [];
    var parts = raw.match(/[^.!?。！？；;\n]+[.!?。！？；;\n]*/g) || [raw];
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (!seg) continue;
      while (seg.length > limit) {
        var cut = seg.lastIndexOf(' ', limit);
        if (cut < Math.floor(limit * 0.4)) cut = limit;
        out.push(seg.slice(0, cut).trim());
        seg = seg.slice(cut).trim();
      }
      if (seg) out.push(seg);
    }
    return out;
  }

  function detectTtsLang(text, fallbackLang) {
    var s = String(text || '');
    if (/[぀-ヿ]/.test(s)) return 'ja-JP';
    if (/[가-힯]/.test(s)) return 'ko-KR';
    if (/[㐀-鿿]/.test(s)) {
      return /[係唔嘅咁咗嚟冇睇畀諗點樣乜嘢]/.test(s) ? 'zh-HK' : 'zh-CN';
    }
    if (/[Ѐ-ӿ]/.test(s)) return 'ru-RU';
    if (/[äöüß]/i.test(s)) return 'de-DE';
    if (/[çœæ]/i.test(s)) return 'fr-FR';
    if (/[ñ¿¡]/i.test(s)) return 'es-ES';
    if (/[ãõ]/i.test(s)) return 'pt-BR';
    var fb = String(fallbackLang || 'en').toLowerCase();
    if (fb === 'yue') return 'zh-HK';
    if (fb.indexOf('zh') === 0) return fb.indexOf('hant') !== -1 ? 'zh-TW' : 'zh-CN';
    if (fb === 'tl' || fb === 'fil') return 'fil-PH';
    return 'en-US';
  }

  function isStableClassToken(cls) {
    if (!cls || cls.length < 2 || cls.length > 42) return false;
    if (/^(ss-|active|hover|focus|selected|open|show|hidden|js-)/i.test(cls)) return false;
    if (/^[a-z]{1,3}-[0-9a-f]{5,}$/i.test(cls) || /^css-[a-z0-9]+$/i.test(cls) || /^sc-[a-zA-Z0-9]+$/.test(cls)) return false;
    if ((cls.match(/\d/g) || []).length >= 4) return false;
    return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(cls);
  }

  function cssEscapeSimple(ident) {
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
      return CSS.escape(ident);
    }
    return String(ident || '').replace(/([^a-zA-Z0-9_-])/g, '\$1');
  }

  function buildSingleElementStep(el) {
    if (!el || el.nodeType !== 1) return '';
    var tag = String(el.tagName || 'div').toLowerCase();
    var id = el.id || (el.getAttribute && el.getAttribute('id')) || '';
    if (id && isStableClassToken(id)) {
      return '#' + cssEscapeSimple(id);
    }
    var role = el.getAttribute && el.getAttribute('role');
    if (role && /^[a-z-]+$/i.test(role) && (tag === 'div' || tag === 'section' || tag === 'aside' || tag === 'nav')) {
      return tag + '[role="' + role + '"]';
    }
    var rawCls = typeof el.className === 'string'
      ? el.className
      : ((el.getAttribute && el.getAttribute('class')) || '');
    var tokens = rawCls.split(/\s+/).filter(isStableClassToken);
    if (tokens.length > 0) {
      return tag + '.' + tokens.slice(0, 2).map(cssEscapeSimple).join('.');
    }
    return tag;
  }

  function buildStableCssSelector(el, maxDepth) {
    if (!el || el.nodeType !== 1) return '';
    var depthLimit = typeof maxDepth === 'number' && maxDepth >= 1 ? maxDepth : 2;
    var parts = [];
    var cur = el;
    var steps = 0;
    while (cur && cur.nodeType === 1 && steps < depthLimit) {
      var tag = String(cur.tagName || '').toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      var step = buildSingleElementStep(cur);
      if (!step) break;
      parts.unshift(step);
      if (step.charAt(0) === '#') break;
      cur = cur.parentElement;
      steps++;
    }
    return parts.join(' > ') || String(el.tagName || 'div').toLowerCase();
  }

  /* ==========================================================================
   * 5. Trusted-Types Safe DOM Builders & Styles
   * ========================================================================== */

  function clearChildren(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function makeEl(doc, tag, props, children) {
    var d = doc || (typeof document !== 'undefined' ? document : root.document);
    var node = d.createElement(tag);
    if (props) {
      var keys = Object.keys(props);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = props[k];
        if (v == null) continue;
        if (k === 'className') {
          node.className = v;
        } else if (k === 'text') {
          node.textContent = String(v);
        } else if (k === 'style' && typeof v === 'object') {
          assignObj(node.style, v);
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (Array.isArray(children)) {
      for (var c = 0; c < children.length; c++) {
        var ch = children[c];
        if (ch == null) continue;
        if (typeof ch === 'string') node.appendChild(d.createTextNode(ch));
        else node.appendChild(ch);
      }
    }
    return node;
  }

  var POPUP_SHADOW_CSS = [
    ':host { all: initial; position: fixed; z-index: 2147483646; color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans CJK TC", sans-serif; color: #181c20; }',
    '.ss-card { width: min(580px, calc(100vw - 24px)); max-height: min(78vh, 640px); overflow-y: auto; background: #ffffff; border: 1px solid rgba(24, 28, 32, 0.14); border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16); padding: 10px 12px; box-sizing: border-box; font-size: 13.5px; line-height: 1.5; }',
    '.ss-card.ss-wide { width: min(780px, calc(100vw - 24px)); }',
    '.ss-topbar { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(24, 28, 32, 0.10); }',
    '.ss-icon-btn { display:inline-grid; place-items:center; min-width:30px; min-height:30px; vertical-align:middle; }',
    '.ss-explain-src { margin-top:6px; font-size:12px; color:#6b7280; } .ss-explain-guess { color:#b45309; }',
    '.ss-icon-btn.ss-icon-text { display:inline-flex; align-items:center; gap:4px; padding:0 8px; font-size:13px; }',
    '.ss-orig .ss-icon-btn,.ss-tr-main .ss-icon-btn { margin-inline-end:6px; }',
    '.ss-tr-main rt { font-size:.68em; opacity:.8; user-select:none; }',
    '.ss-read-line { font-size: 14px; line-height: 1.55; color: #6b7280; margin-top: 4px; white-space: normal; user-select: text; }',
    '.ss-tr-main ruby { ruby-position:over; }',
    '.ss-spacer { flex: 1 1 auto; }',
    '.ss-btn { appearance: none; border: 1px solid rgba(24, 28, 32, 0.14); background: #f3f4f6; color: #1f2937; border-radius: 6px; padding: 3px 8px; font-size: 11.5px; font-weight: 500; cursor: pointer; line-height: 1.35; transition: background 0.12s ease, border-color 0.12s ease; }',
    '.ss-btn:hover { background: #e5e7eb; border-color: rgba(24, 28, 32, 0.24); }',
    '.ss-btn.ss-active { background: #0f5c5c; border-color: #0f5c5c; color: #ffffff; }',
    '.ss-btn-close { padding: 3px 7px; font-weight: 600; color: #6b7280; background: transparent; border-color: transparent; }',
    '.ss-btn-close:hover { color: #111827; background: #f3f4f6; }',
    '.ss-orig { background: #f6f7f8; border-left: 2px solid #0f5c5c; border-radius: 4px; padding: 6px 9px; margin-bottom: 10px; font-size: 16px; line-height: 1.55; color: #374151; white-space: pre-wrap; word-break: break-word; }',
    '.ss-orig[hidden] { display: none; }',
    '.ss-idiom-hl { background: rgba(217, 119, 6, 0.14); color: inherit; border-bottom: 1.5px solid #d97706; border-radius: 2px; padding: 0 2px; }',
    '.ss-tr-main { font-size: 17px; line-height: 1.6; color: #111827; white-space: pre-wrap; word-break: break-word; min-height: 20px; }',
    '.ss-muted { color: #6b7280; font-size: 12px; }',
    '.ss-err { color: #b91c1c; font-size: 12.5px; }',
    '.ss-compare-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 8px; margin-top: 8px; }',
    '.ss-compare-col { background: #f8f9fa; border: 1px solid rgba(24, 28, 32, 0.10); border-radius: 7px; padding: 8px; display: flex; flex-direction: column; gap: 5px; }',
    '.ss-compare-hdr { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #0f5c5c; font-weight: 600; border-bottom: 1px solid rgba(24, 28, 32, 0.08); padding-bottom: 4px; }',
    '.ss-latency { color: #6b7280; font-weight: 400; font-variant-numeric: tabular-nums; }',
    '.ss-compare-body { font-size: 12.5px; color: #1f2937; white-space: pre-wrap; word-break: break-word; }',
    '.ss-explain-box { margin-top: 9px; padding: 8px 10px; background: rgba(15, 92, 92, 0.07); border: 1px solid rgba(15, 92, 92, 0.22); border-radius: 7px; font-size: 12.5px; color: #1f2937; white-space: pre-wrap; word-break: break-word; }',
    '.ss-explain-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #0f5c5c; margin-bottom: 4px; }',
    '.ss-chips-wrap { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; padding-top: 7px; border-top: 1px solid rgba(24, 28, 32, 0.10); }',
    '.ss-idiom-chip { appearance: none; border: 1px solid rgba(180, 83, 9, 0.30); background: rgba(217, 119, 6, 0.08); color: #92400e; border-radius: 5px; padding: 2px 7px; font-size: 11px; cursor: pointer; }',
    '.ss-idiom-chip:hover { background: rgba(217, 119, 6, 0.16); }',
    '.ss-action-strip { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }',
    '.ss-act-pill { appearance: none; border: 1px solid rgba(24, 28, 32, 0.14); background: #f8f9fa; color: #374151; border-radius: 5px; padding: 2px 7px; font-size: 11px; cursor: pointer; }',
    '.ss-act-pill.ss-active { background: #0f5c5c; border-color: #0f5c5c; color: #ffffff; font-weight: 600; }',
    '.ss-substrip { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 7px; padding-top: 6px; border-top: 1px dashed rgba(24, 28, 32, 0.14); }',
    '.ss-subword { appearance: none; border: 1px solid rgba(15, 92, 92, 0.26); background: #f3f4f6; color: #0f5c5c; border-radius: 5px; padding: 1px 6px; font-size: 11px; cursor: pointer; }',
    '.ss-subword:hover, .ss-subword.ss-active { background: #0f5c5c; color: #fff; }',
    '.ss-subdef { width: 100%; font-size: 11.5px; color: #374151; background: #f6f7f8; border-radius: 5px; padding: 5px 8px; margin-top: 4px; }',
    '.ss-copy-hint { font-size: 11px; color: #92400e; margin-top: 5px; }',
    '.ss-sel-episodic { margin: 4px 0 7px; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(15, 92, 92, 0.28); background: rgba(15, 92, 92, 0.08); color: #0f5c5c; font-size: 11.5px; line-height: 1.35; cursor: pointer; }',
    '.ss-sel-episodic:hover { background: rgba(15, 92, 92, 0.14); }',
    '.ss-btn-save { border-color: rgba(15, 92, 92, 0.35); color: #0f5c5c; }',
    '.ss-btn-known { border-color: rgba(22, 163, 74, 0.35); color: #166534; }',
    '.ss-dict-wrap { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(24, 28, 32, 0.10); }',
    '.ss-dict-wrap[hidden] { display: none; }',
    '.ss-dict-hdr { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; margin-bottom: 5px; }',
    '.ss-dict-head { font-size: 16px; font-weight: 700; color: #111827; }',
    '.ss-dict-reading { font-size: 12px; color: #0f5c5c; background: rgba(15, 92, 92, 0.08); border-radius: 4px; padding: 1px 6px; font-weight: 500; }',
    '.ss-dict-note { font-size: 11px; color: #6b7280; background: #f3f4f6; border-radius: 4px; padding: 1px 6px; }',
    '.ss-dict-src { margin-top: 5px; }',
    '.ss-dict-src-lbl { font-size: 10.5px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }',
    '.ss-dict-entry { margin: 3px 0; }',
    '.ss-dict-pos { display: inline-block; font-size: 10.5px; font-weight: 600; color: #0f5c5c; border: 1px solid rgba(15, 92, 92, 0.25); border-radius: 4px; padding: 0 5px; margin-right: 5px; text-transform: lowercase; }',
    '.ss-dict-defs { margin: 2px 0 0 16px; padding: 0; font-size: 12.5px; color: #1f2937; }',
    '.ss-dict-defs li { margin: 1px 0; }',
    '.ss-tr-lbl { font-size: 10.5px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }',
    '.ss-ex-wrap { margin-top: 7px; padding-top: 6px; border-top: 1px dashed rgba(24, 28, 32, 0.12); font-size: 12px; }',
    '.ss-ex-pair { margin: 3px 0; line-height: 1.4; }',
    '.ss-ex-src { color: #1f2937; }',
    '.ss-ex-tr { color: #6b7280; }',
    '@media (prefers-color-scheme: dark) {',
    '  :host { color: #e8eaed; }',
    '  .ss-card { background: #1d2025; border-color: rgba(255,255,255,0.12); box-shadow: 0 14px 36px rgba(0,0,0,0.48); }',
    '  .ss-topbar { border-bottom-color: rgba(255,255,255,0.10); }',
    '  .ss-btn { background: #282c33; border-color: rgba(255,255,255,0.12); color: #e2e5ea; }',
    '  .ss-btn:hover { background: #323740; border-color: rgba(255,255,255,0.22); }',
    '  .ss-btn-close:hover { background: #2c3038; color: #ffffff; }',
    '  .ss-orig { background: #242830; border-left-color: #2a8c82; color: #d1d5db; }',
    '  .ss-tr-main { color: #f3f4f6; }',
    '  .ss-read-line { color: #9ca3af; }',
    '  .ss-muted { color: #9ca3af; }',
    '  .ss-err { color: #f87171; }',
    '  .ss-compare-col { background: #242830; border-color: rgba(255,255,255,0.10); }',
    '  .ss-compare-hdr { color: #5ec4be; border-bottom-color: rgba(255,255,255,0.08); }',
    '  .ss-compare-body { color: #e5e7eb; }',
    '  .ss-explain-box { background: rgba(23,120,116,0.14); border-color: rgba(45,168,160,0.28); color: #e5e7eb; }',
    '  .ss-explain-title { color: #5ec4be; }',
    '  .ss-idiom-chip { border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.12); color: #fcd34d; }',
    '  .ss-act-pill { background: #242830; border-color: rgba(255,255,255,0.12); color: #d1d5db; }',
    '  .ss-act-pill.ss-active { background: #177874; border-color: #177874; }',
    '  .ss-subword { background: #242830; border-color: rgba(255,255,255,0.14); color: #7dd3c8; }',
    '  .ss-subdef { background: #242830; color: #d1d5db; }',
    '  .ss-copy-hint { color: #fcd34d; }',
    '  .ss-sel-episodic { background: rgba(23, 120, 116, 0.20); border-color: rgba(94, 196, 190, 0.35); color: #7dd3c8; }',
    '  .ss-btn-save { border-color: rgba(94,196,190,0.38); color: #7dd3c8; }',
    '  .ss-btn-known { border-color: rgba(74,222,128,0.36); color: #86efac; }',
    '  .ss-dict-wrap { border-bottom-color: rgba(255,255,255,0.10); }',
    '  .ss-dict-head { color: #f3f4f6; }',
    '  .ss-dict-reading { color: #7dd3c8; background: rgba(23, 120, 116, 0.22); }',
    '  .ss-dict-note { color: #9ca3af; background: #262a31; }',
    '  .ss-dict-src-lbl, .ss-tr-lbl { color: #9ca3af; }',
    '  .ss-dict-pos { color: #7dd3c8; border-color: rgba(94, 196, 190, 0.34); }',
    '  .ss-dict-defs { color: #e5e7eb; }',
    '  .ss-ex-wrap { border-top-color: rgba(255,255,255,0.10); }',
    '  .ss-ex-src { color: #e5e7eb; }',
    '  .ss-ex-tr { color: #9ca3af; }',
    '}'
  ].join('\n');

  var RULE_PICKER_CSS = [
    ':host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.ss-pk-box { position: fixed; border: 2px solid #0f5c5c; background: rgba(15, 92, 92, 0.10); border-radius: 5px; pointer-events: none; transition: all 0.06s ease-out; }',
    '.ss-pk-hud { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: #1b1e23; color: #f3f4f6; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 9px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.42); padding: 10px 13px; display: flex; flex-direction: column; gap: 7px; min-width: min(460px, calc(100vw - 24px)); max-width: calc(100vw - 24px); }',
    '.ss-pk-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
    '.ss-pk-title { font-size: 12px; font-weight: 600; color: #f3f4f6; }',
    '.ss-pk-code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #262a31; color: #e5e7eb; padding: 4px 8px; border-radius: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.ss-pk-btns { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
    '.ss-pk-btn { appearance: none; border: 1px solid rgba(255, 255, 255, 0.14); background: #262a31; color: #e5e7eb; border-radius: 6px; padding: 4px 9px; font-size: 11.5px; font-weight: 600; cursor: pointer; }',
    '.ss-pk-btn:hover { background: #31363f; }',
    '.ss-pk-exc { background: #7f1d1d; border-color: #b91c1c; color: #fee2e2; }',
    '.ss-pk-inc { background: #0f5c5c; border-color: #177874; color: #ffffff; }',
    '.ss-pk-meta { font-size: 11px; color: #9ca3af; }'
  ].join('\n');

  var INPUT_PREVIEW_CSS = [
    ':host { all: initial; position: fixed; z-index: 2147483646; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.ss-ip-chip { max-width: min(460px, calc(100vw - 24px)); background: #1d2025; color: #f3f4f6; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 7px; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.36); padding: 7px 10px; font-size: 13px; line-height: 1.4; }',
    '.ss-ip-text { color: #f3f4f6; white-space: pre-wrap; word-break: break-word; margin-bottom: 4px; }',
    '.ss-ip-hint { font-size: 11px; color: #9ca3af; }'
  ].join('\n');

  var PAGE_INJECT_STYLE_ID = 'ss-page-tr-style';
  var PAGE_INJECT_CSS = [
    '::highlight(ss-rare-word) { text-decoration: underline dotted; text-decoration-color: currentColor; }',
    '[data-ss-page-tr="1"] { display: block; margin: 4px 0 8px 0; padding: 3px 0 3px 9px; border-left: 2px solid rgba(15, 92, 92, 0.42); background: rgba(15, 23, 42, 0.025); border-radius: 0 4px 4px 0; color: inherit; opacity: 0.90; font-size: 0.94em; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }',
    '@media (prefers-color-scheme: dark) { [data-ss-page-tr="1"] { background: rgba(255, 255, 255, 0.035); border-left-color: rgba(94, 196, 190, 0.48); } }',
    '[data-ss-page-tr="1"][data-ss-loading="1"] { opacity: 0.55; font-style: italic; }',
    'html[data-ss-web-borderless="1"] [data-ss-page-tr="1"] { border-left: none !important; background: transparent !important; padding-left: 0 !important; padding-right: 0 !important; }',
    'html[data-ss-web-style="native"] [data-ss-page-tr="1"] { border: 0; background: transparent; padding: 0; margin: 2px 0 0; border-radius: 0; opacity: 1; font: inherit; letter-spacing: inherit; color: inherit; white-space: normal; overflow-wrap: anywhere; }',
    'html[data-ss-web-style="native"] [data-ss-page-tr="1"]:not([data-ss-search-tr]) { color: var(--ss-source-color, inherit); font-family: var(--ss-source-family, inherit); font-size: var(--ss-source-size, inherit); font-weight: var(--ss-source-weight, inherit); font-style: var(--ss-source-style, inherit); line-height: var(--ss-source-leading, inherit); letter-spacing: var(--ss-source-spacing, inherit); }',
    '[data-ss-page-tr="1"][data-ss-search-tr][data-ss-loading="1"] { display: none; }',
    'html[data-ss-web-blur="1"] [data-ss-page-tr="1"] { filter: blur(4.5px); transition: filter 0.16s ease; }',
    'html[data-ss-web-blur="1"] [data-ss-page-tr="1"]:hover { filter: none; }',
    'html[data-ss-web-tronly="1"] [data-ss-has-tr="1"]:not([data-ss-inplace="1"]) { font-size: 0 !important; line-height: 0 !important; }',
    'html[data-ss-web-tronly="1"] [data-ss-has-tr="1"]:not([data-ss-inplace="1"]) > [data-ss-page-tr="1"] { font-size: 16px !important; line-height: 1.6 !important; border-left: none !important; background: transparent !important; padding: 0 !important; margin: 0 !important; }',
    '[data-ss-saved-hl="1"] { background: rgba(15, 92, 92, 0.13); border-bottom: 1.5px solid #0f5c5c; border-radius: 2px; padding: 0 2px; cursor: pointer; }',
    '[data-ss-due-fsrs="1"] { background: rgba(217, 119, 6, 0.18) !important; border-bottom: 2px dotted #d97706 !important; }',
    '[data-ss-i1-chip="1"] { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 4px; border: 1px solid rgba(15, 92, 92, 0.25); background: rgba(15, 92, 92, 0.08); color: #0f5c5c; font-size: 0.80em; vertical-align: baseline; cursor: pointer; }',
    '@media (prefers-color-scheme: dark) { [data-ss-i1-chip="1"] { color: #7dd3c8; border-color: rgba(125, 211, 200, 0.30); background: rgba(23, 120, 116, 0.18); } }',
    '[data-ss-weave="1"] { background: rgba(217, 119, 6, 0.12); border-bottom: 1.5px dashed #b45309; border-radius: 2px; padding: 0 2px; cursor: pointer; font-weight: 500; }',
    'html[data-ss-web-blur="1"] [data-ss-weave="1"] { filter: blur(3px); transition: filter 0.15s ease; }',
    'html[data-ss-web-blur="1"] [data-ss-weave="1"]:hover { filter: none; }',
    '[data-ss-retire-btn="1"] { display: inline-block; margin-left: 3px; padding: 0 4px; font-size: 0.75em; border-radius: 3px; background: rgba(22, 163, 74, 0.16); color: #166534; cursor: pointer; user-select: none; }',
    '[data-ss-web-fe="1"] { border-bottom: 2px dotted rgba(217, 119, 6, 0.78); border-radius: 2px; cursor: help; }',
    'ruby.ss-web-ruby { ruby-position: over; ruby-align: center; margin: 0 1px; }',
    'ruby.ss-web-ruby rt { font-size: 0.54em; color: #475569; font-weight: 500; user-select: none; padding-bottom: 1px; }',
    '.ss-web-pitch { color: #d97706; font-weight: 700; }',
    'html[data-ss-web-pos="1"] .ss-web-tok.ss-web-pos-n { color: #166534; }',
    'html[data-ss-web-pos="1"] .ss-web-tok.ss-web-pos-v { color: #1d4ed8; }',
    'html[data-ss-web-pos="1"] .ss-web-tok.ss-web-pos-a { color: #b45309; }',
    '@media (prefers-color-scheme: dark) { ruby.ss-web-ruby rt { color: #cbd5e1; } .ss-web-pitch { color: #fbbf24; } [data-ss-web-fe="1"] { border-bottom-color: rgba(251, 191, 36, 0.72); } html[data-ss-web-pos="1"] .ss-web-tok.ss-web-pos-n { color: #86efac; } html[data-ss-web-pos="1"] .ss-web-tok.ss-web-pos-v { color: #93c5fd; } html[data-ss-web-pos="1"] .ss-web-tok.ss-web-pos-a { color: #fcd34d; } }',
    'html[data-ss-web-tronly="1"] [data-ss-has-tr="1"] [data-ss-web-aid="1"] { font-size: 0 !important; line-height: 0 !important; }'
  ].join('\n');

  var FLOATING_TOOLS_CSS = [
    ':host { color-scheme: light dark; }',
    '.ss-fab-toggle { appearance: none; display: grid; place-content: center; gap: 4px; padding: 0; border: 1px solid #52647d; border-radius: 14px; background: #18263b; color: #edf5ff; box-shadow: 0 3px 12px #0b162b38; cursor: pointer; touch-action: none; transition: opacity 140ms, background 140ms; }',
    '.ss-fab-toggle:hover, .ss-fab-toggle[aria-expanded="true"] { background: #263b58; }',
    '.ss-fab-toggle[data-translated="1"] { border-color: #83d8bd; box-shadow: 0 0 0 2px #83d8bd44, 0 3px 12px #0b162b38; }',
    '.ss-fab-toggle span { display: block; width: 17px; height: 3px; border-radius: 8px; background: currentColor; }',
    '.ss-fab-toggle span + span { width: 12px; justify-self: end; background: #83d8bd; }',
    '.ss-fab-menu { --surface: #fff; --ink: #16263b; --subtle: #5b697b; --line: #dce4ec; --hover: #eef3f8; --accent: #126450; --active: #e0f5ec; position: absolute; display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; width: 240px; max-width: calc(100vw - 76px); max-height: calc(100vh - 16px); overflow: auto; padding: 8px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); color: var(--ink); box-shadow: 0 8px 30px #0b162b2b; font: 500 13px/1.35 system-ui, sans-serif; text-align: start; }',
    '.ss-fab-menu[hidden] { display: none; }',
    '.ss-fab-item, .ss-fab-menu summary { box-sizing: border-box; border: 0; border-radius: 8px; padding: 8px 9px; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer; }',
    '.ss-fab-item:hover, .ss-fab-menu summary:hover { background: var(--hover); }',
    '.ss-fab-menu button:focus-visible, .ss-fab-toggle:focus-visible, .ss-fab-menu summary:focus-visible { outline: 2px solid #38ae97; outline-offset: -2px; }',
    '.ss-fab-primary { background: var(--active); color: var(--accent); font-weight: 700; }',
    '.ss-fab-primary:hover { background: var(--active); text-decoration: underline; }',
    '.ss-fab-language { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; padding: 5px 9px; color: var(--subtle); }',
    '.ss-fab-language select { width: 100%; min-width: 0; padding: 5px 7px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 7px; font: inherit; }',
    '.ss-fab-language select:focus-visible { outline: 2px solid #38ae97; outline-offset: -2px; }',
    '.ss-fab-replace { display:flex; align-items:center; justify-content:space-between; gap:8px; }',
    '.ss-fab-replace::after { content:""; width:27px; height:16px; flex:none; border-radius:12px; background:radial-gradient(circle at 8px 50%,white 5px,transparent 6px),#606874; }',
    '.ss-fab-replace[aria-checked="true"]::after { background:radial-gradient(circle at 19px 50%,white 5px,transparent 6px),#087f79; }',
    '.ss-fab-readings { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
    '.ss-fab-readings::after { content: "Off"; color: var(--subtle); font-size: 11px; }',
    '.ss-fab-readings[aria-pressed="true"]::after { content: "On"; color: var(--accent); font-weight: 700; }',
    '.ss-fab-settings { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); color: var(--subtle); }',
    '.ss-fab-settings button { display: block; width: 100%; }',
    ':host([data-theme="light"]) { color-scheme: light; }',
    ':host([data-theme="dark"]) { color-scheme: dark; }',
    ':host([data-theme="dark"]) .ss-fab-menu { --surface: #182436; --ink: #eef5fc; --subtle: #acbdce; --line: #39485b; --hover: #27374c; --accent: #96e4cc; --active: #214638; }',
    '@media (prefers-color-scheme: dark) { :host([data-theme="system"]) .ss-fab-menu { --surface: #182436; --ink: #eef5fc; --subtle: #acbdce; --line: #39485b; --hover: #27374c; --accent: #96e4cc; --active: #214638; } }',
    '@media (prefers-reduced-motion: reduce) { .ss-fab-toggle { transition: none; } }'
  ].join('\n');

  /* ==========================================================================
   * 6. Browser Runtime Integration (Guarded for Clean Node Execution)
   * ========================================================================== */

  function initBrowserRuntime() {
    var win = (typeof window !== 'undefined' && window) ? window : root.window;
    var doc = (typeof document !== 'undefined' && document) ? document : root.document;
    if (!win || !doc || typeof doc.addEventListener !== 'function') {
      return;
    }
    if (win.__SS_SELECT_ACTIVE__) return;
    win.__SS_SELECT_ACTIVE__ = true;
    var embedded = Boolean(win.top && win.top !== win);
    var embeddedSyncRevision = 0;
    var scopePublished = null;
    var scopeUpdates = Promise.resolve();

    function publishEmbeddedScope(scope) {
      if (embedded || scope === scopePublished) return;
      scopePublished = scope;
      scopeUpdates = scopeUpdates.then(function () {
        return sendBgMessage({ op: 'ssSetWebScope', mode: scope }, 4000);
      });
    }

    function syncEmbeddedScope() {
      var revision = ++embeddedSyncRevision;
      sendBgMessage({ op: 'ssGetWebScope' }, 4000).then(function (res) {
        if (revision !== embeddedSyncRevision || !res || !res.ok) return;
        var scope = hostMatchesList(getHostKey(), cfg.neverTranslateHosts) ? null : res.mode;
        if (scope) startPageBilingualMode(scope, { synchronize: true, silentToast: true });
        else if (pageModeState.mode) teardownPageBilingual(true);
      });
    }

    function pageModeShortcut(scope) {
      if (embedded) sendBgMessage({ op: 'ssEmbeddedShortcut', action: scope === 'article' ? 'ssToggleArticle' : 'ssToggleFullPage' }, 4000);
      else startPageBilingualMode(scope);
    }

    var raf = typeof win.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : function (cb) { return setTimeout(cb, 0); };


    var savedStudyState = { words: {}, items: [], traces: [] };
    var domainEntityMap = Object.create(null);
    try {
      var rawEnt = win.sessionStorage && win.sessionStorage.getItem('ss_dom_entities_v1');
      if (rawEnt) assignObj(domainEntityMap, JSON.parse(rawEnt));
    } catch (_entErr) {}
    function persistDomainEntityCache() {
      try {
        if (win.sessionStorage) win.sessionStorage.setItem('ss_dom_entities_v1', JSON.stringify(domainEntityMap));
      } catch (_eS) {}
    }

    var webReadDictCache = Object.create(null);
    var webAidPatches = new Map();
    var translatedWebAidLang = new WeakMap();
    var webAidRevision = 0;
    var originalReadingsOverride = null;
    var originalAidObservers = null;
    var translatedReadingsOverride = null;
    var webRankCache = Object.create(null);
    function ensureWebRanks(lang) {
      if (!/^(en|zh|yue|ja|ko|es|fr|de|pt|it|ru|tl)$/.test(lang)) return Promise.resolve(null);
      if (!webRankCache[lang]) {
        webRankCache[lang] = sendBgMessage({ op: 'loadExtData', file: 'ranks_' + lang + '.json' }, 4000).then(function (r) {
          if (!r || !r.ok || !r.data) {
            delete webRankCache[lang];
            return null;
          }
          return typeof r.data.items === 'object' && r.data.items ? r.data.items : r.data;
        });
      }
      return webRankCache[lang];
    }

    function normWebReadLang(lg) {
      var s = String(lg || '').toLowerCase().trim();
      if (!s) return '';
      if (s === 'yue' || s === 'zh-hk') return 'yue';
      if (s.indexOf('zh') === 0) return 'zh';
      if (s === 'fil' || s === 'tgl') return 'tl';
      return s.split(/[-_]/)[0];
    }

    function ensureWebReadDict(lg) {
      var norm = normWebReadLang(lg);
      if (!/^(ja|zh|yue|ko|ru|tl)$/.test(norm)) return Promise.resolve(null);
      if (webReadDictCache[norm]) return webReadDictCache[norm];
      var p = sendBgMessage({ op: 'loadExtData', file: 'read_' + norm + '.json' }, 4000).then(function (r) {
        var raw = r && r.ok ? r.data : null;
        return raw && win.SS_READINGS ? win.SS_READINGS.normalizeRichReadDict(raw) : null;
      }).catch(function () { return null; }).then(function (dict) {
        if (!dict) delete webReadDictCache[norm];
        return dict;
      });
      webReadDictCache[norm] = p;
      return p;
    }

    function webReadingsVisible() {
      if (!pageModeState.mode) {
        return originalReadingsOverride ?? (cfg.autoWebReadings && cfg.webReaderAid !== false && cfg.readingAid !== 'off');
      }
      if (translatedReadingsOverride != null) return translatedReadingsOverride;
      return cfg.webReaderAid !== false && cfg.readingAid !== 'off';
    }

    function webAidSettingsKey() {
      return [cfg.autoWebReadings, cfg.webReaderAid, cfg.readingAid, cfg.posColors, cfg.showPitchAccent, cfg.webDisplayMode, cfg.tl].join('|');
    }

    function blockReadingLanguage(block, text, fallback, mixedPage) {
      var tagged = safeClosest(block, '[lang]');
      var declared = normWebReadLang(tagged && tagged.getAttribute('lang'));
      if (/^(en|zh|yue|ja|ko|es|fr|de|pt|it|ru|tl)$/.test(declared)) {
        if (!mixedPage || (tagged !== doc.documentElement && tagged !== doc.body) ||
            /^(ja|zh|yue|ko|ru)$/.test(declared)) return declared;
        const scriptLetters = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/g)?.length || 0;
        const letters = text.match(/\p{L}/gu)?.length || 0;
        if (scriptLetters < 2 || scriptLetters * 2 < letters) return declared;
      }
      if (/[\u3040-\u30ff]/.test(text)) return 'ja';
      if (/[\uac00-\ud7af]/.test(text)) return 'ko';
      if (/[\u0400-\u04ff]/.test(text)) return 'ru';
      if (/[\u3400-\u9fff]/.test(text)) return /[係唔嘅咁咗嚟冇睇]/.test(text) ? 'yue' : 'zh';
      return normWebReadLang(fallback) || 'en';
    }

    function makeWebRtNode(txt) {
      var rt = doc.createElement('rt');
      var segs = String(txt || '').split(/([ꜜ‾])/);
      for (var i = 0; i < segs.length; i++) {
        var sg = segs[i];
        if (!sg) continue;
        if (sg === 'ꜜ' || sg === '‾') rt.appendChild(makeEl(doc, 'span', { className: 'ss-web-pitch', text: sg }));
        else rt.appendChild(doc.createTextNode(sg));
      }
      return rt;
    }

    function webReadingLine(text, lg, dict) {
      var L = win.SS_LANG, RD = win.SS_READINGS;
      if (!L || !RD || !dict) return '';
      var toks = L.get(lg).split(text);
      if ((lg === 'yue' || lg === 'zh') && typeof RD.mergeCjkDictTokens === 'function') toks = RD.mergeCjkDictTokens(toks, lg, dict, null);
      var mode = cfg.readingAid && cfg.readingAid !== 'off' ? cfg.readingAid : 'romaji';
      var out = [], any = false;
      for (var i = 0; i < toks.length; i++) {
        var tk = toks[i];
        if (!tk.word) { var pn = String(tk.w).trim(); if (pn) out.push(pn); continue; }
        var aid = RD.lookupTokenAid(tk.w, lg, dict, { mode: mode, showPitchAccent: false });
        var r = '';
        if (aid && Array.isArray(aid.reading)) r = aid.reading.map(function (x) { return x[1] || x[0] || ''; }).join('');
        else if (aid && typeof aid.reading === 'string') r = aid.reading;
        if (r && r !== tk.w) any = true;
        if (r && (lg === 'zh' || lg === 'yue')) r = r.replace(/\s+/g, '');   // one word, one group: dim2joeng2, niúnǎi
        out.push(lg === 'zh' ? (r || tk.w).toLowerCase() : (r || tk.w));   // CEDICT surname readings come capitalised
      }
      return any ? out.join(' ').replace(/ ([,.!?;:，。！？；：、）」』)])/g, '$1').replace(/([（「『(]) /g, '$1') : '';
    }

    function appendWebTokensToParent(parentEl, segText, normLg, richDict, wantAid) {
      var L = win.SS_LANG;
      var RD = win.SS_READINGS;
      var wantPos = cfg.posColors !== false;
      if (!L || !RD || !richDict || (!wantAid && !wantPos)) {
        parentEl.appendChild(doc.createTextNode(segText));
        return;
      }
      var toks = L.get(normLg).split(segText);
      if ((normLg === 'yue' || normLg === 'zh') && richDict && typeof RD.mergeCjkDictTokens === 'function') {
        toks = RD.mergeCjkDictTokens(toks, normLg, richDict, null);
      }
      for (var i = 0; i < toks.length; i++) {
        var tk = toks[i];
        if (!tk.word) {
          parentEl.appendChild(doc.createTextNode(tk.w));
          continue;
        }
        var mode = cfg.readingAid && cfg.readingAid !== 'off' ? cfg.readingAid : 'romaji';
        var aid = RD.lookupTokenAid(tk.w, normLg, richDict, { mode: mode, showPitchAccent: cfg.showPitchAccent !== false });
        var sp = doc.createElement('span');
        sp.className = 'ss-web-tok';
        sp.setAttribute('data-ss-web-aid', '1');
        if (wantPos && aid && (aid.pos === 'n' || aid.pos === 'v' || aid.pos === 'a')) {
          sp.classList.add('ss-web-pos-' + aid.pos);
        }
        if (wantAid && aid && aid.stress) {
          sp.textContent = aid.stress;
        } else if (wantAid && aid && Array.isArray(aid.reading) && aid.reading.length) {
          for (var p = 0; p < aid.reading.length; p++) {
            var b = aid.reading[p][0] || '';
            var r = aid.reading[p][1] || '';
            if (r) {
              var rb = doc.createElement('ruby');
              rb.className = 'ss-web-ruby';
              rb.appendChild(doc.createTextNode(b));
              rb.appendChild(makeWebRtNode(r));
              sp.appendChild(rb);
            } else if (b) {
              sp.appendChild(doc.createTextNode(b));
            }
          }
        } else if (wantAid && aid && typeof aid.reading === 'string' && aid.reading) {
          var rb2 = doc.createElement('ruby');
          rb2.className = 'ss-web-ruby';
          rb2.appendChild(doc.createTextNode(tk.w));
          rb2.appendChild(makeWebRtNode(aid.reading));
          sp.appendChild(rb2);
        } else {
          sp.textContent = tk.w;
        }
        parentEl.appendChild(sp);
      }
    }

    function buildWebAidFragment(segText, normLg, feHits, richDict, wantAid) {
      var frag = doc.createDocumentFragment();
      var spans = [];
      var leadingSpace = segText.length - segText.trimStart().length;
      if (Array.isArray(feHits)) {
        for (var i = 0; i < feHits.length; i++) {
          var it = feHits[i];
          var pat = (it && (it.surface || it.phrase || it.canonical)) || '';
          if (!pat || pat.length < 2) continue;
          var idx = Number.isInteger(it.start) ? it.start + leadingSpace : -1;
          if (idx < 0 || segText.slice(idx, idx + pat.length) !== pat) idx = segText.indexOf(pat);
          if (idx >= 0) spans.push({ start: idx, end: idx + pat.length, fe: it });
        }
      }
      spans.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
      var cur = 0;
      for (var j = 0; j < spans.length; j++) {
        var sp = spans[j];
        if (sp.start < cur) continue;
        if (sp.start > cur) appendWebTokensToParent(frag, segText.slice(cur, sp.start), normLg, richDict, wantAid);
        var feSpan = doc.createElement('span');
        feSpan.setAttribute('data-ss-web-fe', '1');
        feSpan.setAttribute('data-ss-web-aid', '1');
        feSpan.title = (sp.fe.canonical || sp.fe.phrase || '') + (sp.fe.gloss ? (' — ' + sp.fe.gloss) : '');
        appendWebTokensToParent(feSpan, segText.slice(sp.start, sp.end), normLg, richDict, wantAid);
        frag.appendChild(feSpan);
        cur = sp.end;
      }
      if (cur < segText.length) appendWebTokensToParent(frag, segText.slice(cur), normLg, richDict, wantAid);
      return frag;
    }

    function annotateWebBlockWithAids(block, lang, richDict, wantAid, includePhrases) {
      if (!block.isConnected || webAidPatches.has(block) || block.isContentEditable) return;
      var hasFeApi = includePhrases && win.SS_IDIOMS && typeof win.SS_IDIOMS.findInText === 'function';
      if (!hasFeApi && !richDict) return;

      var textNodes = [];
      var walkNodes = function (node) {
        if (!node || !node.childNodes) return;
        for (var i = 0; i < node.childNodes.length; i++) {
          var ch = node.childNodes[i];
          if (ch.nodeType === 3) {
            if (ch.nodeValue && ch.nodeValue.trim().length >= 2) textNodes.push(ch);
          } else if (ch.nodeType === 1) {
            var tag = ch.tagName ? ch.tagName.toLowerCase() : '';
            if (/^(ruby|code|pre|script|style|kbd|math|svg|button|textarea|input|select)$/.test(tag) || ch.isContentEditable) continue;
            if (ch.getAttribute && (ch.getAttribute('data-ss-page-tr') || ch.getAttribute('data-ss-saved-hl') || ch.getAttribute('data-ss-weave') || ch.getAttribute('data-ss-i1-chip') || ch.getAttribute('data-ss-web-aid'))) continue;
            walkNodes(ch);
          }
        }
      };
      walkNodes(block);
      if (!textNodes.length) return;

      var patches = [];
      for (var t = 0; t < textNodes.length; t++) {
        var tn = textNodes[t];
        var str = tn.nodeValue;
        var feHits = hasFeApi ? win.SS_IDIOMS.findInText(str, cfg.tl, lang) : [];
        if (!feHits.length && (!richDict || !/\p{L}/u.test(str))) continue;
        var frag = buildWebAidFragment(str, lang, feHits, richDict, wantAid);
        var wrapper = makeEl(doc, 'span', { 'data-ss-web-aid': '1' });
        wrapper.appendChild(frag);
        tn.parentNode.replaceChild(wrapper, tn);
        patches.push({ original: tn, wrapper: wrapper });
      }
      if (patches.length) webAidPatches.set(block, patches);
    }

    function clearWebBlockAids() {
      webAidRevision++;
      webAidPatches.forEach(function (patches, block) {
        for (var i = 0; i < patches.length; i++) {
          var patch = patches[i];
          if (block.contains(patch.wrapper)) patch.wrapper.parentNode.replaceChild(patch.original, patch.wrapper);
        }
      });
      webAidPatches.clear();
    }

    function scheduleWebBlockAids(block, lang, includePhrases = true) {
      var revision = webAidRevision;
      var wantAid = webReadingsVisible();
      var readings = wantAid || cfg.posColors !== false ? ensureWebReadDict(lang) : null;
      var phrases = includePhrases && win.SS_IDIOMS && typeof win.SS_IDIOMS.ensureWebFeIndex === 'function'
        ? win.SS_IDIOMS.ensureWebFeIndex(lang, cfg.tl).catch(function () {})
        : null;
      Promise.all([readings, phrases]).then(function (results) {
        if (revision !== webAidRevision || block.getAttribute('data-ss-inplace') === '1') return;
        annotateWebBlockWithAids(block, lang, results[0], wantAid, includePhrases);
      });
    }

    function stopOriginalReadings() {
      originalAidObservers?.visibility?.disconnect();
      originalAidObservers?.changes?.disconnect();
      originalAidObservers = null;
    }

    function startOriginalReadings() {
      if (originalAidObservers || !doc.body || embedded || !webReadingsVisible() ||
          typeof win.SS_READINGS?.lookupTokenAid !== 'function') return;
      var queued = new WeakSet();
      var manual = originalReadingsOverride === true;
      var rules = resolveActiveSiteRules();
      var observeBlock = function (block) {
        const text = extractBlockWithPlaceholders(block).text;
        const lang = blockReadingLanguage(block, text, '', !manual);
        if (manual || /^(ja|zh|yue|ko|ru|tl)$/.test(lang)) scheduleWebBlockAids(block, lang, manual);
      };
      var visibility = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
        if (originalAidObservers?.visibility !== visibility) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          visibility.unobserve(entry.target);
          observeBlock(entry.target);
        }
      }, { rootMargin: '180px 0px' }) : null;
      function observeSubtree(scope) {
        for (const block of collectTranslatableBlocks(scope, rules)) {
          if (queued.has(block)) continue;
          queued.add(block);
          if (visibility) visibility.observe(block);
          else observeBlock(block);
        }
      }
      var changes = typeof win.MutationObserver === 'function' ? new win.MutationObserver(records => {
        if (originalAidObservers?.changes !== changes) return;
        let roots;
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && !isOurInjectedNode(node) &&
                !safeClosest(node, '[data-ss-web-aid]')) {
              roots ??= pageTranslationRoots('article');
              if (roots.some(scope => scope.contains(node) || node.contains(scope))) observeSubtree(node);
            }
          }
        }
        if (records.some(record => [...record.removedNodes].some(node => node.nodeType === 1 && !node.hasAttribute('data-ss-web-aid')))) {
          for (const block of webAidPatches.keys()) if (!block.isConnected) webAidPatches.delete(block);
        }
      }) : null;
      originalAidObservers = { visibility, changes };
      pageTranslationRoots('article').forEach(observeSubtree);
      changes?.observe(doc.body, { subtree: true, childList: true });
    }

    function refreshWebAidView() {
      stopOriginalReadings();
      clearWebBlockAids();
      applyDisplayModeForAll();
      if (pageModeState.mode && cfg.webDisplayMode === 'bilingual') {
        pageModeState.ownedTranslations.forEach(function (_translation, block) {
          var lang = translatedWebAidLang.get(block);
          if (lang && block.isConnected) scheduleWebBlockAids(block, lang);
        });
      } else if (!pageModeState.mode && webReadingsVisible()) {
        ensurePageStyleInjected();
        startOriginalReadings();
      }
    }
    function syncWebHtmlFlags() {
      var rootEl = doc.documentElement;
      if (!rootEl || !rootEl.setAttribute) return;
      rootEl.setAttribute('data-ss-web-style', cfg.webTranslationStyle);
      if (cfg.webBorderless) rootEl.setAttribute('data-ss-web-borderless', '1');
      else rootEl.removeAttribute('data-ss-web-borderless');
      if (cfg.webBlurTr) rootEl.setAttribute('data-ss-web-blur', '1');
      else rootEl.removeAttribute('data-ss-web-blur');
      if (cfg.webDisplayMode === 'tr_only') rootEl.setAttribute('data-ss-web-tronly', '1');
      else rootEl.removeAttribute('data-ss-web-tronly');
      rootEl.setAttribute('data-ss-web-pos', cfg.posColors !== false ? '1' : '0');
    }

    function setWebDisplayMode(mode) {
      cfg.webDisplayMode = mode;
      syncWebHtmlFlags();
      refreshWebAidView();
      saveSettingPatch({ webDisplayMode: mode });
      syncFloatingFab();
    }

    function persistWordStatus(lemmaOrWord, status, fullItem, language) {
      var cleanW = String(lemmaOrWord || '').trim();
      if (!cleanW) return;
      var low = cleanW.toLowerCase();
      var guessLg = normWebReadLang(language || pageModeState.detectedLang || doc.documentElement.lang || detectTtsLang(cleanW, 'en'));
      savedStudyState.words[guessLg + '|' + low] = status;
      savedStudyState.words[low] = status;
      var updates = { ss_words: savedStudyState.words };
      if (status === 'learning' && fullItem) {
        var exists = savedStudyState.items.some(function (x) {
          return normWebReadLang(x.lang || 'en') === guessLg && String(x.word || '').toLowerCase() === low;
        });
        if (!exists) {
          savedStudyState.items.push({
            id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            itemType: fullItem.isFe ? 'FE' : 'WORD',
            word: cleanW,
            lemma: low,
            lang: guessLg,
            def: fullItem.def || '',
            line: fullItem.line || '',
            trans: fullItem.trans || '',
            title: getDocTitle(),
            sourceUrl: win.location.href,
            at: new Date().toISOString()
          });
          updates.ss_items = savedStudyState.items;
        }
      }
      if (ch && ch.storage && ch.storage.local && typeof ch.storage.local.set === 'function') {
        try {
          ch.storage.local.set(updates);
        } catch (_e) {}
      }
    }

    function retireKnownOnPage(lemmaLower) {
      if (!doc.querySelectorAll || !lemmaLower) return;
      var nodes = doc.querySelectorAll('[data-ss-lemma]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if ((el.getAttribute('data-ss-lemma') || '').toLowerCase() === lemmaLower) {
          var origTxt = el.getAttribute('data-ss-orig-text') || el.firstChild && el.firstChild.textContent || el.textContent;
          if (el.parentNode) el.parentNode.replaceChild(doc.createTextNode(origTxt), el);
        }
      }
    }

    var sessionDismissedHost = '';
    var lastAutoUrl = '';
    var fabState = {
      host: null, ball: null, menu: null,
      btnTr: null, btnMode: null, btnScope: null, btnAuto: null, btnNeverAuto: null, btnReadings: null,
      targetLanguage: null,
      side: null, topPx: null, openTimer: null, closeTimer: null
    };
    function getHostKey() {
      return (win.location && win.location.hostname ? String(win.location.hostname) : '').toLowerCase();
    }
    function saveSettingPatch(patch) {
      if (!ch || !ch.storage || !ch.storage.local) return;
      try {
        ch.storage.local.get(['ss_set'], function (res) {
          var next = Object.assign({}, (res && res.ss_set) || {}, patch, { _updatedAt: Date.now() });
          ch.storage.local.set({ ss_set: next });
        });
      } catch (_e) {}
    }
    function isFabHiddenByRule() {
      var hk = getHostKey();
      if (!hk || !Array.isArray(cfg.fabHideDomains)) return false;
      for (var i = 0; i < cfg.fabHideDomains.length; i++) {
        var pat = String(cfg.fabHideDomains[i] || '').trim().toLowerCase();
        if (pat && (hk === pat || hk.slice(-(pat.length + 1)) === '.' + pat)) return true;
      }
      return false;
    }
    function runFabPrimaryAction() {
      if (cfg.fabClickMode === 'reader') {
        sendBgMessage({ op: 'openReader' });
        return;
      }
      startPageBilingualMode(pageModeState.mode || (cfg.fabClickMode === 'full' ? 'full' : cfg.pageBilingualScope || 'article'));
    }
    function layoutFloatingBall() {
      if (!fabState.host || !fabState.ball) return;
      fabState.host.setAttribute('data-theme', cfg.fabTheme);
      var h = win.innerHeight || 720;
      var size = cfg.fabCompact ? 34 : 42;
      var y = Math.max(8, Math.min(h - size - 8, fabState.topPx == null ? h - 164 : fabState.topPx));
      fabState.topPx = y;
      var isLeft = (fabState.side || cfg.fabSide) === 'left';
      fabState.ball.style.width = size + 'px';
      fabState.ball.style.height = size + 'px';
      fabState.host.style.top = y + 'px';
      fabState.host.style.left = isLeft ? '12px' : 'auto';
      fabState.host.style.right = isLeft ? 'auto' : '12px';
      var menu = fabState.menu;
      fabState.ball.style.opacity = menu.hidden && !pageModeState.mode ? String(cfg.fabOpacity) : '1';
      if (!menu.hidden) {
        var offset = (size + 9) + 'px';
        menu.style.left = isLeft ? offset : 'auto';
        menu.style.right = isLeft ? 'auto' : offset;
        menu.style.top = Math.max(8 - y, Math.min(0, h - 8 - y - menu.offsetHeight)) + 'px';
      }
    }
    function syncFloatingFab() {
      if (!cfg.showFloatingFab || isFabHiddenByRule()) {
        if (fabState.host) {
          setFloatingMenuVisible(false);
          fabState.host.remove();
          fabState.host = null;
          fabState.ball = null;
        }
        return;
      }
      if (!fabState.ball) return;
      var active = !!pageModeState.mode;
      var translationAction = active ? 'Show original' : 'Translate page';
      var primaryAction = cfg.fabClickMode === 'reader' ? 'Open Study Reader' : translationAction;
      fabState.ball.setAttribute('data-translated', active ? '1' : '0');
      fabState.ball.setAttribute('aria-label', primaryAction + ' · Phrasebound');
      fabState.ball.title = primaryAction + ' (hover or press ↓ for page tools)';
      fabState.btnTr.textContent = translationAction;
      var picker = fabState.targetLanguage;
      var legacyOption = picker.querySelector('[data-saved-target]');
      if (legacyOption && legacyOption.value !== cfg.tl) legacyOption.remove();
      if (![...picker.options].some(option => option.value === cfg.tl)) {
        picker.appendChild(makeEl(doc, 'option', { value: cfg.tl, text: cfg.tl, 'data-saved-target': '1' }));
      }
      if (picker.value !== cfg.tl) picker.value = cfg.tl;
      fabState.btnReadings.setAttribute('aria-pressed', String(webReadingsVisible() && (!active || cfg.webDisplayMode === 'bilingual')));
      fabState.btnMode.setAttribute('aria-checked', String(cfg.webDisplayMode === 'tr_only'));
      fabState.btnScope.textContent = (pageModeState.mode || cfg.pageBilingualScope) === 'full' ? 'Scope: Whole page' : 'Scope: Article';
      var host = getHostKey();
      fabState.btnAuto.textContent = cfg.autoTranslateHosts && cfg.autoTranslateHosts[host] ? '✓ Always translate this site' : 'Always translate this site';
      fabState.btnNeverAuto.textContent = hostMatchesList(host, cfg.neverTranslateHosts) ? '✓ Never auto-translate this site' : 'Never auto-translate this site';
      layoutFloatingBall();
    }
    function toggleAutoHost() {
      var hk = getHostKey();
      if (!hk) return;
      var nextHosts = Object.assign({}, cfg.autoTranslateHosts || {});
      if (nextHosts[hk]) {
        delete nextHosts[hk];
        showToast('Phrasebound · Auto-translate disabled for ' + hk);
      } else {
        nextHosts[hk] = pageModeState.mode || cfg.pageBilingualScope || 'article';
        showToast('Phrasebound · Always translate ' + hk);
      }
      cfg.autoTranslateHosts = nextHosts;
      saveSettingPatch({ autoTranslateHosts: nextHosts });
      syncFloatingFab();
    }
    function setFloatingMenuVisible(show) {
      if (!fabState.ball || !fabState.menu) return;
      clearTimeout(fabState.openTimer);
      clearTimeout(fabState.closeTimer);
      fabState.openTimer = null;
      fabState.closeTimer = null;
      fabState.menu.hidden = !show;
      fabState.ball.setAttribute('aria-expanded', String(show));
      layoutFloatingBall();
    }
    function ensureFloatingFab() {
      if (embedded || !cfg.showFloatingFab || isFabHiddenByRule() || fabState.host || !doc.body || typeof doc.createElement !== 'function') return;
      if (doc.getElementById && doc.getElementById('ss-panel')) return;
      if (!win.location || !/^https?:$/i.test(String(win.location.protocol || ''))) return;
      if (typeof doc.body.appendChild !== 'function') return;

      var host = makeEl(doc, 'div', { 'data-ss-fab': '1' });
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483644;user-select:none;';
      var shadow = host.attachShadow({ mode: 'open' });
      shadow.appendChild(makeEl(doc, 'style', { text: FLOATING_TOOLS_CSS }));
      var ball = makeEl(doc, 'button', {
        type: 'button', className: 'ss-fab-toggle', 'aria-controls': 'ss-page-tools', 'aria-expanded': 'false'
      });
      ball.appendChild(makeEl(doc, 'span', { 'aria-hidden': 'true' }));
      ball.appendChild(makeEl(doc, 'span', { 'aria-hidden': 'true' }));

      var menu = makeEl(doc, 'div', {
        id: 'ss-page-tools', className: 'ss-fab-menu', role: 'group', 'aria-label': 'Phrasebound page tools'
      });
      menu.hidden = true;

      var mkItem = function (label, extraClass) {
        return makeEl(doc, 'button', { type: 'button', text: label, className: 'ss-fab-item' + (extraClass ? ' ' + extraClass : '') });
      };
      var btnTr = mkItem('Translate page', 'ss-fab-primary');
      var btnReadings = mkItem('Reading aids', 'ss-fab-readings');
      var btnReader = mkItem('Open Study Reader');
      var btnWake = mkItem('Wake Companion');
      var btnMode = mkItem('Replace original text', 'ss-fab-replace');
      btnMode.setAttribute('role','switch');
      btnMode.title = 'Turn off to show the original and translation together';
      var btnScope = mkItem('Scope: Article');
      var btnAuto = mkItem('Always translate this site');
      var btnNeverAuto = mkItem('Never auto-translate this site');
      var btnI1 = mkItem('Word glosses (i+1)');
      var btnOpts = mkItem('Settings and services');
      var btnHideSite = mkItem('Hide on this site');
      var targetPicker = makeEl(doc, 'select');
      WEB_TARGETS.forEach(([code, name]) => targetPicker.appendChild(makeEl(doc, 'option', { value: code, text: name })));
      var targetLabel = makeEl(doc, 'label', { className: 'ss-fab-language' }, [
        makeEl(doc, 'span', { text: 'Translate to' }), targetPicker
      ]);
      targetPicker.addEventListener('change', () => saveSettingPatch({ tl: targetPicker.value }));

      btnTr.addEventListener('click', function () {
        setFloatingMenuVisible(false);
        startPageBilingualMode(pageModeState.mode || cfg.pageBilingualScope || 'article');
        syncFloatingFab();
      });
      btnReadings.addEventListener('click', function () {
        if (!pageModeState.mode) {
          originalReadingsOverride = !webReadingsVisible();
        } else if (cfg.webDisplayMode !== 'bilingual') {
          translatedReadingsOverride = true;
          setWebDisplayMode('bilingual');
          return;
        } else {
          translatedReadingsOverride = !webReadingsVisible();
        }
        refreshWebAidView();
        syncFloatingFab();
      });
      btnReader.addEventListener('click', function () {
        setFloatingMenuVisible(false);
        sendBgMessage({ op: 'openReader' });
      });
      btnWake.addEventListener('click', async function () {
        btnWake.disabled = true;
        btnWake.textContent = 'Waking Companion…';
        btnWake.setAttribute('aria-busy', 'true');
        const result = await sendBgMessage({ op: 'wakeCompanion', url: cfg.companionUrl }, 20000);
        btnWake.disabled = false;
        btnWake.removeAttribute('aria-busy');
        if (result?.health) {
          btnWake.textContent = 'Companion is ready';
          showToast('Companion is ready');
        } else {
          btnWake.textContent = result?.ok ? 'Check Companion' : 'Retry Wake Companion';
          showToast(result?.ok ? 'Companion started. Check again in a moment.' : (result?.error || 'Companion did not respond'));
        }
      });
      btnMode.addEventListener('click', function () {
        setWebDisplayMode(cfg.webDisplayMode === 'tr_only' ? 'bilingual' : 'tr_only');
        showToast(cfg.webDisplayMode === 'tr_only' ? 'In-Place Translation-Only ON (Links preserved)' : 'Bilingual Mode ON');
      });
      btnScope.addEventListener('click', function () {
        var nextScope = (pageModeState.mode || cfg.pageBilingualScope) === 'full' ? 'article' : 'full';
        cfg.pageBilingualScope = nextScope;
        saveSettingPatch({ pageBilingualScope: nextScope });
        if (pageModeState.mode) {
          teardownPageBilingual(true);
          startPageBilingualMode(nextScope);
        }
        syncFloatingFab();
      });
      btnAuto.addEventListener('click', toggleAutoHost);
      btnNeverAuto.addEventListener('click', function () {
        var hk = getHostKey();
        if (!hk) return;
        var next = Array.isArray(cfg.neverTranslateHosts) ? cfg.neverTranslateHosts.slice() : [];
        var idx = next.indexOf(hk);
        if (idx >= 0) {
          next.splice(idx, 1);
          showToast('Removed ' + hk + ' from Never Auto-Translate list');
        } else {
          next.push(hk);
          if (pageModeState.mode) teardownPageBilingual(true);
          showToast('Never auto-translate ' + hk);
        }
        cfg.neverTranslateHosts = next;
        saveSettingPatch({ neverTranslateHosts: next });
        syncFloatingFab();
      });
      btnI1.addEventListener('click', function () { setFloatingMenuVisible(false); toggleSelectiveIPlusOneGloss(); });
      btnOpts.addEventListener('click', function () { setFloatingMenuVisible(false); sendBgMessage({ op: 'openOptions' }); });
      btnHideSite.addEventListener('click', function () {
        var hk = getHostKey();
        if (hk) {
          var nextList = Array.isArray(cfg.fabHideDomains) ? cfg.fabHideDomains.slice() : [];
          if (nextList.indexOf(hk) < 0) nextList.push(hk);
          cfg.fabHideDomains = nextList;
          saveSettingPatch({ fabHideDomains: nextList });
          showToast('Floating ball hidden on ' + hk + ' (restore in Options)');
        }
        syncFloatingFab();
      });

      menu.appendChild(btnTr);
      menu.appendChild(targetLabel);
      menu.appendChild(btnMode);
      menu.appendChild(btnReadings);
      menu.appendChild(btnWake);
      var options = makeEl(doc, 'details', { className: 'ss-fab-settings' });
      options.appendChild(makeEl(doc, 'summary', { text: 'Page and site settings' }));
      [btnScope, btnAuto, btnNeverAuto, btnI1, btnOpts, btnReader, btnHideSite].forEach(function (button) { options.appendChild(button); });
      options.addEventListener('toggle', layoutFloatingBall);
      menu.appendChild(options);

      // Drag vertically / snap left-or-right edge vs clean click
      var dragMoved = false;
      var dragging = false;
      var lastPointerUpAt = 0;
      var touchHoldTimer = null;
      var touchHeld = false;
      var startX = 0, startY = 0, origTop = 0;
      ball.addEventListener('pointerdown', function (ev) {
        if (ev.button !== undefined && ev.button !== 0) return;
        dragging = true;
        dragMoved = false;
        touchHeld = false;
        startX = ev.clientX || 0;
        startY = ev.clientY || 0;
        origTop = fabState.topPx || 180;
        if (ball.setPointerCapture) { try { ball.setPointerCapture(ev.pointerId); } catch (_) {} }
        if (ev.pointerType === 'touch') {
          touchHoldTimer = setTimeout(function () {
            touchHeld = true;
            setFloatingMenuVisible(true);
          }, 500);
        }
      });
      ball.addEventListener('pointermove', function (ev) {
        if (!dragging) return;
        var dx = (ev.clientX || 0) - startX;
        var dy = (ev.clientY || 0) - startY;
        if (!dragMoved && Math.abs(dx) + Math.abs(dy) < 5) return;
        dragMoved = true;
        clearTimeout(touchHoldTimer);
        setFloatingMenuVisible(false);
        fabState.topPx = origTop + dy;
        var vw = win.innerWidth || 1200;
        fabState.side = (ev.clientX || 0) < vw / 2 ? 'left' : 'right';
        layoutFloatingBall();
      });
      ball.addEventListener('pointerup', function () {
        if (!dragging) return;
        dragging = false;
        clearTimeout(touchHoldTimer);
        lastPointerUpAt = Date.now();
        if (dragMoved) {
          if (ch && ch.storage && ch.storage.local) {
            try {
              ch.storage.local.set({ ss_fab_pos: { side: fabState.side, topPx: fabState.topPx, sideSetting: cfg.fabSide } });
            } catch (_) {}
          }
          return;
        }
        if (touchHeld) return;
        setFloatingMenuVisible(false);
        runFabPrimaryAction();
      });
      ball.addEventListener('pointercancel', function () {
        dragging = false;
        clearTimeout(touchHoldTimer);
      });
      ball.addEventListener('click', function (ev) {
        if (ev.detail !== 0 && Date.now() - lastPointerUpAt < 350) return;
        setFloatingMenuVisible(false);
        runFabPrimaryAction();
      });

      host.addEventListener('pointerenter', function (ev) {
        if (ev.pointerType === 'touch' || dragging) return;
        if (fabState.closeTimer) { clearTimeout(fabState.closeTimer); fabState.closeTimer = null; }
        if (!fabState.openTimer && menu.hidden) {
          fabState.openTimer = setTimeout(function () { setFloatingMenuVisible(true); }, cfg.fabHoverDelay);
        }
      });
      host.addEventListener('pointerleave', function (ev) {
        if (ev.pointerType === 'touch') return;
        if (fabState.openTimer) { clearTimeout(fabState.openTimer); fabState.openTimer = null; }
        if (fabState.closeTimer) clearTimeout(fabState.closeTimer);
        fabState.closeTimer = setTimeout(function () {
          fabState.closeTimer = null;
          if (!menu.contains(shadow.activeElement)) setFloatingMenuVisible(false);
        }, 280);
      });
      ball.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        if (ev.pointerType === 'touch') {
          clearTimeout(touchHoldTimer);
          touchHeld = true;
          setFloatingMenuVisible(true);
        } else {
          setFloatingMenuVisible(menu.hidden);
        }
      });
      ball.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        setFloatingMenuVisible(true);
        btnTr.focus();
      });
      shadow.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape' || menu.hidden) return;
        ev.stopPropagation();
        setFloatingMenuVisible(false);
        ball.focus();
      });
      shadow.addEventListener('focusout', function (ev) {
        if (ev.relatedTarget && !shadow.contains(ev.relatedTarget)) setFloatingMenuVisible(false);
      });

      shadow.appendChild(ball);
      shadow.appendChild(menu);
      doc.body.appendChild(host);
      fabState.host = host;
      fabState.ball = ball;
      fabState.menu = menu;
      fabState.btnTr = btnTr;
      fabState.btnMode = btnMode;
      fabState.btnScope = btnScope;
      fabState.btnAuto = btnAuto;
      fabState.btnNeverAuto = btnNeverAuto;
      fabState.btnReadings = btnReadings;
      fabState.targetLanguage = targetPicker;
      syncFloatingFab();
    }

    var autoVidState = { timer: null, lastCue: '', lastVideo: null, ov: null };
    function cleanupAutoDetectVideoOverlay() {
      if (autoVidState.timer) { clearInterval(autoVidState.timer); autoVidState.timer = null; }
      if (autoVidState.ov && autoVidState.ov.parentNode) {
        try { autoVidState.ov.parentNode.removeChild(autoVidState.ov); } catch (_e) {}
      }
      autoVidState.ov = null;
      autoVidState.lastCue = '';
      autoVidState.lastVideo = null;
    }
    function syncAutoDetectVideoWatcher() {
      if (embedded) return;
      var rootEl = doc.documentElement;
      if (!cfg.autoDetectVideo || (rootEl && rootEl.hasAttribute && rootEl.hasAttribute('data-ss-site'))) {
        cleanupAutoDetectVideoOverlay();
        return;
      }
      if (autoVidState.timer || !doc.querySelectorAll) return;
      autoVidState.timer = setInterval(function () {
        if (!cfg.autoDetectVideo || (rootEl && rootEl.hasAttribute && rootEl.hasAttribute('data-ss-site'))) {
          cleanupAutoDetectVideoOverlay();
          return;
        }
        var vids = doc.querySelectorAll('video');
        var activeVid = null;
        var cueText = '';
        for (var vi = 0; vi < vids.length; vi++) {
          var v = vids[vi];
          if (!v || !v.textTracks || v.paused || v.readyState < 2) continue;
          for (var ti = 0; ti < v.textTracks.length; ti++) {
            var tt = v.textTracks[ti];
            if (!tt || (tt.mode !== 'showing' && tt.mode !== 'hidden') || !tt.activeCues || !tt.activeCues.length) continue;
            var parts = [];
            for (var ci = 0; ci < tt.activeCues.length; ci++) {
              var rawC = String(tt.activeCues[ci].text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (rawC) parts.push(rawC);
            }
            var joined = parts.join(' ').trim();
            if (joined) { activeVid = v; cueText = joined; break; }
          }
          if (activeVid) break;
        }
        if (!activeVid || !cueText) {
          if (autoVidState.ov) autoVidState.ov.hidden = true;
          autoVidState.lastCue = '';
          return;
        }
        if (cueText === autoVidState.lastCue && autoVidState.lastVideo === activeVid) return;
        autoVidState.lastCue = cueText;
        autoVidState.lastVideo = activeVid;
        var host = activeVid.parentElement || doc.body;
        if (!autoVidState.ov || autoVidState.ov.parentNode !== host) {
          if (autoVidState.ov && autoVidState.ov.parentNode) {
            try { autoVidState.ov.parentNode.removeChild(autoVidState.ov); } catch (_e2) {}
          }
          var ov = doc.createElement('div');
          ov.setAttribute('data-ss-autovid-ov', '1');
          ov.style.cssText = 'position:absolute;left:50%;bottom:8%;transform:translateX(-50%);max-width:86%;padding:6px 12px;border-radius:8px;background:rgba(10,12,18,0.84);color:#f8fafc;font:600 15px/1.35 -apple-system,sans-serif;text-align:center;z-index:2147483640;pointer-events:none;';
          var lineOrig = doc.createElement('div');
          var lineTr = doc.createElement('div');
          lineTr.style.cssText = 'font-weight:400;font-size:13px;color:#dbe4f3;margin-top:2px;';
          ov.appendChild(lineOrig);
          ov.appendChild(lineTr);
          if (host && host.style && host.style.position === '') host.style.position = 'relative';
          host.appendChild(ov);
          autoVidState.ov = ov;
        }
        autoVidState.ov.hidden = false;
        autoVidState.ov.firstChild.textContent = cueText;
        autoVidState.ov.lastChild.textContent = '';
        translateSingleText(cueText, { scene: 'subtitle', targetLang: cfg.tl }).then(function (r) {
          if (autoVidState.ov && autoVidState.lastCue === cueText && r && r.ok && r.text) {
            autoVidState.ov.lastChild.textContent = r.text;
          }
        });
      }, 2500);
    }

    function resolveDefaultBrowserTargetLang() {
      var navLang = String((win.navigator && win.navigator.language) || '').toLowerCase();
      if (/zh[-_]*(tw|hk|mo|hant)/.test(navLang)) return 'zh-Hant';
      if (/^zh/.test(navLang)) return 'zh-Hans';
      var m = navLang.match(/^(en|ja|ko|yue|es|fr|de|pt|it|ru|tl|fil)\b/);
      if (m) return m[1] === 'fil' ? 'tl' : m[1];
      return 'zh-Hant';
    }

    function evaluateSmartAutoTranslate(attempt) {
      if (embedded || !win.location || !/^https?:$/i.test(String(win.location.protocol || '')) || !doc.body || pageModeState.mode) return;
      var hk = getHostKey();
      var rootEl = doc.documentElement;
      var isVid = Boolean(
        (rootEl && rootEl.getAttribute && rootEl.getAttribute('data-ss-site')) ||
        (doc.getElementById && doc.getElementById('ss-panel')) ||
        /^(www\.)?(youtube\.com|netflix\.com|bilibili\.com|live\.bilibili\.com|twitch\.tv|disneyplus\.com|primevideo\.com|chzzk\.naver\.com|kick\.com)$/i.test(hk)
      );
      var sampleParts = [];
      var totalLen = 0;
      if (doc.querySelectorAll) {
        var sampleNodes = doc.querySelectorAll('article p, main p, p, h1, h2, li, [data-testid="tweetText"], .markdown-body');
        for (var si = 0; si < sampleNodes.length && sampleParts.length < 24 && totalLen < 1800; si++) {
          var sn = sampleNodes[si];
          if (!sn || safeClosest(sn, 'nav, header, footer, pre, code, .notranslate, [data-ss-page-tr], [data-ss-fab]')) continue;
          var st = String(sn.textContent || '').replace(/\s+/g, ' ').trim();
          if (st.length < 15) continue;
          sampleParts.push(st);
          totalLen += st.length;
        }
      }
      var sampleText = sampleParts.join(' ').slice(0, 1800);
      var hasEditor = Boolean(doc.querySelector && doc.querySelector('.monaco-editor, .cm-editor, .ace_editor') && sampleText.length < 220);
      var decision = shouldAutoTranslatePage({
        host: hk,
        protocol: win.location.protocol,
        isConfiguredVideoSite: isVid,
        hasCodeEditorApp: hasEditor,
        sampleText: sampleText,
        htmlLang: rootEl && rootEl.getAttribute ? (rootEl.getAttribute('lang') || '') : '',
        tl: cfg.tl,
        autoTranslateForeign: cfg.autoTranslateForeign,
        autoTranslateHosts: cfg.autoTranslateHosts,
        neverTranslateHosts: cfg.neverTranslateHosts,
        skipAutoTranslateLangs: cfg.skipAutoTranslateLangs,
        autoTranslateScope: cfg.autoTranslateScope,
        sessionDismissed: sessionDismissedHost === hk
      });
      if (decision.translate) {
        startPageBilingualMode(decision.scope || 'full', {
          silentToast: true,
          detectedLang: decision.detectedLang || '',
          autoStarted: true
        });
        syncFloatingFab();
      } else if (decision.retryHydration && (attempt || 0) < 1) {
        var rt = setTimeout(function () { evaluateSmartAutoTranslate(1); }, 1000);
        if (rt && typeof rt.unref === 'function') rt.unref();
      }
    }

    // Load & watch Chrome storage ss_set + saved floating ball edge position
    var ch = (typeof chrome !== 'undefined' && chrome) ? chrome : win.chrome;
    if (ch && ch.storage && ch.storage.local && typeof ch.storage.local.get === 'function') {
      try {
        ch.storage.local.get(['ss_set', 'ss_words', 'ss_items', 'ss_review', 'ss_study_traces_v1', 'ss_fab_pos'], function (res) {
          if (res && res.ss_set) applySettings(res.ss_set);
          if (!(res && res.ss_set && typeof res.ss_set.tl === 'string' && res.ss_set.tl.trim())) {
            cfg.tl = resolveDefaultBrowserTargetLang();
          }
          if (res && res.ss_words && typeof res.ss_words === 'object') savedStudyState.words = res.ss_words;
          if (res && Array.isArray(res.ss_items)) savedStudyState.items = root.SS_STORE?.projectReviews
            ? root.SS_STORE.projectReviews(res.ss_items, res.ss_review) : res.ss_items;
          if (res && Array.isArray(res.ss_study_traces_v1)) savedStudyState.traces = res.ss_study_traces_v1;
          if (res && res.ss_fab_pos && typeof res.ss_fab_pos === 'object') {
            var pos = res.ss_fab_pos;
            if ((!pos.sideSetting || pos.sideSetting === cfg.fabSide) && (pos.side === 'left' || pos.side === 'right')) fabState.side = pos.side;
            if (Number.isFinite(pos.topPx)) fabState.topPx = pos.topPx;
          }
          syncRareWords();
          syncWebHtmlFlags();
          ensureFloatingFab();
          syncAutoDetectVideoWatcher();
          if (embedded) syncEmbeddedScope();
          if (win.location && /^https?:$/i.test(String(win.location.protocol || ''))) {
            var autoTm = setTimeout(function () {
              lastAutoUrl = String((win.location && win.location.href) || '');
              evaluateSmartAutoTranslate(0);
              if (!pageModeState.mode && webReadingsVisible()) refreshWebAidView();
            }, 240);
            if (autoTm && typeof autoTm.unref === 'function') autoTm.unref();
            if (cfg.webHighlightSaved) {
              var glowTm = setTimeout(runSavedWordbookGlow, 350);
              if (glowTm && typeof glowTm.unref === 'function') glowTm.unref();
            }
          }
        });
      } catch (_e) { /* ignore */ }
    }
    if (win.location && /^https?:$/i.test(String(win.location.protocol || '')) && typeof win.addEventListener === 'function') {
      var onRouteMaybeChanged = function () {
        var curHref = String((win.location && win.location.href) || '');
        if (!curHref || curHref === lastAutoUrl) return;
        lastAutoUrl = curHref;
        if (pageModeState.autoStarted) teardownPageBilingual(true);
        var rt2 = setTimeout(function () {
          evaluateSmartAutoTranslate(0);
          if (!pageModeState.mode && webReadingsVisible()) refreshWebAidView();
        }, 450);
        if (rt2 && typeof rt2.unref === 'function') rt2.unref();
      };
      win.addEventListener('popstate', onRouteMaybeChanged);
      win.addEventListener('hashchange', onRouteMaybeChanged);
      win.addEventListener('resize', layoutFloatingBall);
      doc.addEventListener('pointerdown', function (ev) {
        if (fabState.host && ev.target !== fabState.host) setFloatingMenuVisible(false);
      });
      doc.addEventListener('click', function () {
        var rt3 = setTimeout(onRouteMaybeChanged, 550);
        if (rt3 && typeof rt3.unref === 'function') rt3.unref();
      }, { passive: true, capture: true });
    }
    if (ch && ch.storage && ch.storage.onChanged && typeof ch.storage.onChanged.addListener === 'function') {
      try {
        ch.storage.onChanged.addListener(function (changes, area) {
          if (!area || area === 'local' || area === 'sync') {
            if (changes && changes.ss_set && changes.ss_set.newValue) {
              var prevAuto = cfg.autoTranslateForeign;
              var prevTarget = cfg.tl;
              var prevFabSide = cfg.fabSide;
              var prevAidSettings = webAidSettingsKey();
              var prevWebReaderAid = cfg.webReaderAid;
              var prevReadingMode = cfg.readingAid;
              var prevAutoReadings = cfg.autoWebReadings;
              var previousRoute = webpageRoutingSettingsKey();
              applySettings(changes.ss_set.newValue);
              if (prevAutoReadings !== cfg.autoWebReadings || prevWebReaderAid !== cfg.webReaderAid) {
                originalReadingsOverride = null;
              }
              if (prevFabSide !== cfg.fabSide) fabState.side = null;
              if (prevWebReaderAid !== cfg.webReaderAid || prevReadingMode !== cfg.readingAid) translatedReadingsOverride = null;
              syncWebHtmlFlags();
              if (prevAidSettings !== webAidSettingsKey()) refreshWebAidView();
              ensureFloatingFab();
              syncFloatingFab();
              syncAutoDetectVideoWatcher();
              if (prevAuto !== cfg.autoTranslateForeign) {
                if (!cfg.autoTranslateForeign && pageModeState.autoStarted) teardownPageBilingual(true);
              }
              if (prevTarget !== cfg.tl && pageModeState.autoStarted) teardownPageBilingual(true);
              if (!pageModeState.mode && (prevTarget !== cfg.tl || prevAuto !== cfg.autoTranslateForeign)) {
                evaluateSmartAutoTranslate(0);
              } else if (pageModeState.mode && previousRoute !== webpageRoutingSettingsKey()) {
                startPageBilingualMode(pageModeState.smartI1 ? 'smart_i1' : pageModeState.mode, {
                  synchronize: true, refresh: true, autoStarted: pageModeState.autoStarted, detectedLang: pageModeState.detectedLang
                });
              }
              if (embedded) syncEmbeddedScope();
            }
            if (changes && changes.ss_words && changes.ss_words.newValue) savedStudyState.words = changes.ss_words.newValue;
            if (changes?.ss_words || changes?.ss_set) syncRareWords();
            if (changes && (changes.ss_items || changes.ss_review)) ch.storage.local.get(['ss_items', 'ss_review'], function (res) {
              var items = Array.isArray(res?.ss_items) ? res.ss_items : [];
              savedStudyState.items = root.SS_STORE?.projectReviews ? root.SS_STORE.projectReviews(items, res.ss_review) : items;
              var highlights = doc.querySelectorAll ? doc.querySelectorAll('[data-ss-card-id]') : [];
              for (var hi = 0; hi < highlights.length; hi++) {
                var el = highlights[hi];
                var itemId = el.getAttribute('data-ss-card-id');
                var item = savedStudyState.items.find(function (it) { return String(it.id) === itemId; });
                if (item && cfg.incidentalFsrs && root.SS_STORE && root.SS_STORE.isRecallDue(item, cfg.fsrsRetention)) el.setAttribute('data-ss-due-fsrs', '1');
                else el.removeAttribute('data-ss-due-fsrs');
              }
              if (cfg.webHighlightSaved) runSavedWordbookGlow();
            });
            if (changes && changes.ss_study_traces_v1 && Array.isArray(changes.ss_study_traces_v1.newValue)) savedStudyState.traces = changes.ss_study_traces_v1.newValue;
          }
        });
      } catch (_e2) { /* ignore */ }
    }

    function ensurePageStyleInjected(block) {
      var scope = block && block.getRootNode?.();
      if (scope?.host) {
        if (!scope.querySelector('#' + PAGE_INJECT_STYLE_ID)) {
          scope.appendChild(makeEl(doc, 'style', { id: PAGE_INJECT_STYLE_ID, text: PAGE_INJECT_CSS }));
        }
        return;
      }
      if (doc.getElementById && doc.getElementById(PAGE_INJECT_STYLE_ID)) return;
      var target = doc.head || doc.documentElement || doc.body;
      if (!target || typeof target.appendChild !== 'function') return;
      var st = makeEl(doc, 'style', { id: PAGE_INJECT_STYLE_ID, text: PAGE_INJECT_CSS });
      target.appendChild(st);
    }

    function isEditableElement(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      var ce = el.getAttribute && el.getAttribute('contenteditable');
      return ce === '' || ce === 'true' || ce === 'plaintext-only';
    }

    function safeMatches(el, selector) {
      if (!el || el.nodeType !== 1 || !selector) return false;
      var fn = el.matches || el.webkitMatchesSelector;
      if (typeof fn !== 'function') return false;
      try {
        return fn.call(el, selector);
      } catch (_err) {
        return false;
      }
    }

    function safeClosest(el, selector) {
      if (!el || !selector) return null;
      var cur = el.nodeType === 1 ? el : el.parentElement;
      if (!cur) return null;
      if (typeof cur.closest === 'function') {
        try {
          return cur.closest(selector);
        } catch (_err) {
          return null;
        }
      }
      while (cur && cur.nodeType === 1) {
        if (safeMatches(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    function eventTouchesIgnoredUI(ev) {
      var path = typeof ev.composedPath === 'function' ? ev.composedPath() : [ev.target];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (!n || n.nodeType !== 1) continue;
        if (isEditableElement(n)) return true;
        if (safeMatches(n, UI_IGNORE_SELECTOR)) return true;
      }
      return false;
    }

    function eventTouchesPopup(ev) {
      if (!popupState.host) return false;
      var path = typeof ev.composedPath === 'function' ? ev.composedPath() : [ev.target];
      for (var i = 0; i < path.length; i++) {
        if (path[i] === popupState.host) return true;
      }
      return false;
    }

    /* ----------------------------------------------------------------------
     * Toast Feedback (for Alt+P / Alt+A mode switches)
     * ---------------------------------------------------------------------- */
    var toastHost = null;
    var toastTimer = null;

    function showToast(msg) {
      if (!doc.body) return;
      if (toastHost && toastHost.parentNode) toastHost.parentNode.removeChild(toastHost);
      if (toastTimer) clearTimeout(toastTimer);

      toastHost = makeEl(doc, 'div', { 'data-ss-toast': '1' });
      var sr = toastHost.attachShadow({ mode: 'open' });
      var st = makeEl(doc, 'style', {
        text: ':host { all: initial; position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; } .t { background: #1c1f24; color: #f3f4f6; border: 1px solid rgba(255,255,255,0.14); border-radius: 7px; padding: 6px 12px; font-size: 12.5px; box-shadow: 0 6px 20px rgba(0,0,0,0.28); }'
      });
      var box = makeEl(doc, 'div', { className: 't', text: msg });
      sr.appendChild(st);
      sr.appendChild(box);
      doc.body.appendChild(toastHost);
      toastTimer = setTimeout(function () {
        if (toastHost && toastHost.parentNode) toastHost.parentNode.removeChild(toastHost);
        toastHost = null;
      }, 2100);
    }

    /* ----------------------------------------------------------------------
     * Feature 2: Selection Popup (Shadow DOM [data-ss-select])
     * ---------------------------------------------------------------------- */
    var popupState = {
      host: null,
      shadow: null,
      reqId: 0,
      selectedText: '',
      surroundingLine: '',
      currentTranslation: '',
      showingOriginal: false,
      compareOpen: false,
      anchorRect: null
    };

    var lastMouseX = 120;
    var lastMouseY = 120;

    var ttsSpeaking = false;
    var speechGeneration = 0;
    let hostedContext = null;
    const speechBuffers = new Map();
    let speechBufferBytes = 0;
    const maxSpeechBufferBytes = 8 * 1024 * 1024;
    async function hostedBuffer(ctx, lang, chunk) {
      const key = JSON.stringify([lang, chunk]);
      const cached = speechBuffers.get(key);
      if (cached) {
        speechBuffers.delete(key);
        speechBuffers.set(key, cached);
        return cached.buffer;
      }
      const reply = await sendBgMessage({op:'hostedSpeech', lang, text:chunk}, 15000);
      if (!reply?.ok) throw Error('Hosted speech unavailable');
      const bytes = Uint8Array.from(win.atob(reply.audio), c => c.charCodeAt(0));
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      const size = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      if (size <= maxSpeechBufferBytes && !speechBuffers.has(key)) {
        while (speechBufferBytes + size > maxSpeechBufferBytes) {
          const oldest = speechBuffers.keys().next().value;
          speechBufferBytes -= speechBuffers.get(oldest).size;
          speechBuffers.delete(oldest);
        }
        speechBuffers.set(key, {buffer,size});
        speechBufferBytes += size;
      }
      return buffer;
    }

    function stopSpeech() {
      speechGeneration++;
      if (hostedContext) {
        hostedContext.close().catch(function () {});
        hostedContext = null;
      }
      ttsSpeaking = false;
      try {
        if (win.speechSynthesis && typeof win.speechSynthesis.cancel === 'function') {
          win.speechSynthesis.cancel();
        }
      } catch (_e) {}
    }

    function speakTextChunked(text, onDone, sourceLang, allowHosted) {
      if (!allowHosted && (!win.speechSynthesis || typeof win.SpeechSynthesisUtterance !== 'function')) {
        if (onDone) onDone();
        return false;
      }
      stopSpeech();
      var chunks = splitTtsChunks(text, 180);
      if (chunks.length === 0) {
        if (onDone) onDone();
        return false;
      }
      ttsSpeaking = true;
      const requested = sourceLang || detectTtsLang(text, 'en');
      const voiceLang = ({yue:'zh-HK', ja:'ja-JP', ko:'ko-KR', tl:'fil-PH'})[requested] || requested;
      const key = tag => String(tag).toLowerCase().replace(/_/g, '-');
      const cantonese = tag => /^(yue(?:-|$)|zh-(?:yue(?:-|$)|(?:hant-)?(?:hk|mo)(?:-|$)))/.test(key(tag));
      const voices = win.speechSynthesis?.getVoices?.() || [];
      let voice = voices.find(v => key(v.lang) === key(voiceLang));
      if (!voice) voice = voices.find(v => cantonese(voiceLang) ? cantonese(v.lang)
        : !cantonese(v.lang) && key(v.lang).split('-')[0] === key(voiceLang).split('-')[0]);
      if (!allowHosted && !voice && voices.length) {
        ttsSpeaking = false;
        if (onDone) onDone('No '+voiceLang+' voice available on this device.');
        return false;
      }
      var generation = speechGeneration;
      var idx = 0;
      let nextAudio;
      async function playHosted(chunk) {
        try {
          const ctx = hostedContext || (hostedContext = new win.AudioContext());
          await ctx.resume();
          if (generation !== speechGeneration) return;
          const buffer = await (nextAudio || hostedBuffer(ctx, requested, chunk));
          nextAudio = null;
          if (!buffer) throw Error('Hosted speech unavailable');
          if (generation !== speechGeneration) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.onended = playNext;
          source.start();
          if (idx < chunks.length) nextAudio = hostedBuffer(ctx, requested, chunks[idx]).catch(() => null);
        } catch (_) {
          if (generation !== speechGeneration) return;
          if (voice && win.SpeechSynthesisUtterance) {
            allowHosted = false;
            playDevice(chunk);
            return;
          }
          stopSpeech();
          if (onDone) onDone('Audio unavailable. Tap the speaker to retry.');
        }
      }
      function playNext() {
        if (generation !== speechGeneration) return;
        if (!ttsSpeaking || idx >= chunks.length) {
          stopSpeech();
          if (onDone) onDone();
          return;
        }
        const chunk = chunks[idx++];
        if (allowHosted) playHosted(chunk);
        else playDevice(chunk);
      }
      function playDevice(chunk) {
        var utt = new win.SpeechSynthesisUtterance(chunk);
        if (voice) utt.voice = voice;
        utt.lang = voice?.lang || voiceLang;
        utt.onend = playNext;
        utt.onerror = function () { if (generation !== speechGeneration) return; ttsSpeaking = false; if (onDone) onDone('Could not play the '+voiceLang+' voice.'); };
        win.speechSynthesis.speak(utt);
      }
      playNext();
      return true;
    }

    function closeSelectionPopup() {
      popupState.reqId++;
      stopSpeech();
      if (popupState.host && popupState.host.parentNode) {
        popupState.host.parentNode.removeChild(popupState.host);
      }
      popupState.host = null;
      popupState.shadow = null;
      popupState.compareOpen = false;
    }

    function extractSurroundingSentence(sel, selectedStr) {
      if (!sel || sel.rangeCount === 0) return selectedStr;
      var range = sel.getRangeAt(0);
      var container = range.commonAncestorContainer;
      var block = safeClosest(container, 'p, li, blockquote, td, h1, h2, h3, h4, div, article, section') ||
                  (container && container.nodeType === 1 ? container : (container && container.parentElement));
      if (!block) return selectedStr;
      var full = (block.textContent || '').replace(/\s+/g, ' ').trim();
      if (!full) return selectedStr;
      if (full.length <= 300) return full;

      var normSel = selectedStr.replace(/\s+/g, ' ').trim();
      var idx = full.indexOf(normSel);
      if (idx === -1) return full.slice(0, 300);

      var start = Math.max(0, idx - 110);
      var end = Math.min(full.length, idx + normSel.length + 110);
      while (start > 0 && !/[.!?。！？\n]/.test(full.charAt(start - 1)) && (idx - start) < 160) {
        start--;
      }
      while (end < full.length && !/[.!?。！？\n]/.test(full.charAt(end)) && (end - (idx + normSel.length)) < 160) {
        end++;
      }
      return full.slice(start, end).trim();
    }

    function findIdiomMatches(text) {
      var api = win.SS_IDIOMS;
      if (!api || typeof api.findInText !== 'function' || !text) return [];
      try {
        var res = api.findInText(text, cfg.tl);
        return Array.isArray(res) ? res : [];
      } catch (_err) {
        return [];
      }
    }

    function buildHighlightedSourceNode(srcText, idioms) {
      var container = makeEl(doc, 'div', { className: 'ss-orig' });
      if (!idioms || idioms.length === 0) {
        container.textContent = srcText;
        return container;
      }

      var spans = [];
      var lowerSrc = srcText.toLowerCase();
      for (var i = 0; i < idioms.length; i++) {
        var item = idioms[i];
        var s = -1;
        var e = -1;
        if (item && typeof item === 'object') {
          if (typeof item.start === 'number' && typeof item.end === 'number' && item.end > item.start) {
            s = item.start;
            e = item.end;
          } else if (typeof item.index === 'number' && typeof item.length === 'number' && item.length > 0) {
            s = item.index;
            e = item.index + item.length;
          } else {
            var surface = item.match || item.surface || item.phrase || item.form || item.text || item.canonical || '';
            if (typeof surface === 'string' && surface.trim()) {
              var pos = lowerSrc.indexOf(surface.trim().toLowerCase());
              if (pos !== -1) {
                s = pos;
                e = pos + surface.trim().length;
              }
            }
          }
        } else if (typeof item === 'string' && item.trim()) {
          var spos = lowerSrc.indexOf(item.trim().toLowerCase());
          if (spos !== -1) {
            s = spos;
            e = spos + item.trim().length;
          }
        }
        if (s >= 0 && e > s && e <= srcText.length) {
          spans.push({ start: s, end: e });
        }
      }

      if (spans.length === 0) {
        container.textContent = srcText;
        return container;
      }

      spans.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
      var cursor = 0;
      for (var j = 0; j < spans.length; j++) {
        var sp = spans[j];
        if (sp.start < cursor) continue;
        if (sp.start > cursor) {
          container.appendChild(doc.createTextNode(srcText.slice(cursor, sp.start)));
        }
        container.appendChild(makeEl(doc, 'mark', {
          className: 'ss-idiom-hl',
          text: srcText.slice(sp.start, sp.end)
        }));
        cursor = sp.end;
      }
      if (cursor < srcText.length) {
        container.appendChild(doc.createTextNode(srcText.slice(cursor)));
      }
      return container;
    }

    function formatExplanationText(resp) {
      if (!resp || resp.ok === false) {
        return (resp && (resp.error || resp.message)) || 'Explanation unavailable.';
      }
      if (typeof resp.explanation === 'string' && resp.explanation.trim()) return resp.explanation.trim();
      if (typeof resp.text === 'string' && resp.text.trim()) return resp.text.trim();
      var parts = [];
      if (resp.pos) parts.push('[' + resp.pos + ']');
      if (resp.meaning || resp.gloss || resp.definition) {
        parts.push(String(resp.meaning || resp.gloss || resp.definition));
      }
      if (resp.nuance || resp.notes || resp.grammar) {
        parts.push(String(resp.nuance || resp.notes || resp.grammar));
      }
      if (Array.isArray(resp.examples) && resp.examples.length > 0) {
        parts.push('Examples:\n• ' + resp.examples.slice(0, 2).join('\n• '));
      }
      return parts.join('\n') || 'No explanation returned.';
    }

    function positionFloatingHost(host, rect) {
      if (!host) return;
      var vw = win.innerWidth || (doc.documentElement && doc.documentElement.clientWidth) || 1024;
      var vh = win.innerHeight || (doc.documentElement && doc.documentElement.clientHeight) || 768;
      var r = (rect && (rect.width > 0 || rect.height > 0))
        ? rect
        : { left: lastMouseX, right: lastMouseX, top: lastMouseY, bottom: lastMouseY, width: 0, height: 0 };

      var initLeft = Math.max(12, Math.min(r.left, vw - 320));
      var initTop = Math.min(vh - 80, r.bottom + 8);
      host.style.left = Math.round(initLeft) + 'px';
      host.style.top = Math.round(Math.max(12, initTop)) + 'px';

      raf(function () {
        if (!host || !host.isConnected) return;
        var box = typeof host.getBoundingClientRect === 'function'
          ? host.getBoundingClientRect()
          : { width: 320, height: 120 };
        var finalLeft = r.left;
        if (finalLeft + box.width > vw - 12) finalLeft = vw - box.width - 12;
        if (finalLeft < 12) finalLeft = 12;

        var finalTop = r.bottom + 8;
        if (finalTop + box.height > vh - 12 && r.top - box.height - 8 >= 12) {
          finalTop = r.top - box.height - 8;
        } else if (finalTop + box.height > vh - 12) {
          finalTop = Math.max(12, vh - box.height - 12);
        }
        host.style.left = Math.round(finalLeft) + 'px';
        host.style.top = Math.round(finalTop) + 'px';
      });
    }

    function copyTextToClipboard(str) {
      if (!str) return Promise.resolve(false);
      var nav = win.navigator || (typeof navigator !== 'undefined' ? navigator : null);
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        return nav.clipboard.writeText(str).then(function () { return true; }, function () { return false; });
      }
      try {
        var ta = makeEl(doc, 'textarea', {
          style: { position: 'fixed', left: '-9999px', top: '0', opacity: '0' }
        });
        ta.value = str;
        doc.body.appendChild(ta);
        if (typeof ta.select === 'function') ta.select();
        var ok = doc.execCommand && doc.execCommand('copy');
        doc.body.removeChild(ta);
        return Promise.resolve(Boolean(ok));
      } catch (_e) {
        return Promise.resolve(false);
      }
    }

    function openSelectionPopup(selectedText, surroundingLine, anchorRect, startInCompare, recallItem, scanInfo, explicitSelection) {
      closeSelectionPopup();
      if (!doc.body) return;

      var reqId = ++popupState.reqId;
      popupState.selectedText = selectedText;
      popupState.surroundingLine = surroundingLine || selectedText;
      popupState.scanNode = scanInfo?.node || null;
      popupState.currentTranslation = '';
      popupState.showingOriginal = true;
      popupState.compareOpen = false;
      popupState.anchorRect = anchorRect;

      var host = makeEl(doc, 'div', {
        'data-ss-select': '1',
        className: 'ss-pop'
      });
      var shadow = host.attachShadow({ mode: 'open' });
      var styleNode = makeEl(doc, 'style', { text: POPUP_SHADOW_CSS });
      var card = makeEl(doc, 'div', { className: 'ss-card' });

      var idioms = findIdiomMatches(selectedText);
      var origBox = buildHighlightedSourceNode(selectedText, idioms);
      origBox.hidden = !popupState.showingOriginal;

      var mainTrBox = makeEl(doc, 'div', { className: 'ss-tr-main' }, [
        makeEl(doc, 'span', { className: 'ss-muted', text: 'Translating…' })
      ]);
      mainTrBox.hidden = Boolean(scanInfo);
      var compareHolder = makeEl(doc, 'div');
      var explainHolder = makeEl(doc, 'div');

      var btnOrig = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn',
        text: 'Original',
        onClick: function () {
          popupState.showingOriginal = !popupState.showingOriginal;
          origBox.hidden = !popupState.showingOriginal;
          btnOrig.setAttribute('aria-expanded', String(popupState.showingOriginal));
          btnOrig.classList.toggle('ss-active', popupState.showingOriginal);
        }
      });

      var activeActionMode = 'explain';
      function runExplain(targetTerm, actionMode, auto) {
        var modeId = actionMode || activeActionMode || 'explain';
        activeActionMode = modeId;
        var actionDef = STUDY_ACTIONS[0];
        for (var a = 0; a < STUDY_ACTIONS.length; a++) {
          if (STUDY_ACTIONS[a].id === modeId) actionDef = STUDY_ACTIONS[a];
        }
        var wordToExplain = (typeof targetTerm === 'string' && targetTerm.trim()) ? targetTerm.trim() : selectedText;
        btnExplain.classList.add('ss-active');
        clearChildren(explainHolder);

        var strip = makeEl(doc, 'div', { className: 'ss-action-strip' });
        STUDY_ACTIONS.forEach(function (act) {
          strip.appendChild(makeEl(doc, 'button', {
            type: 'button',
            className: 'ss-act-pill' + (act.id === modeId ? ' ss-active' : ''),
            text: act.label,
            onClick: function () { runExplain(wordToExplain, act.id); }
          }));
        });

        var contentNode = makeEl(doc, 'div', { className: 'ss-muted', text: 'Analyzing ' + actionDef.label.toLowerCase() + '…' });
        var expBox = makeEl(doc, 'div', { className: 'ss-explain-box' }, [
          strip,
          makeEl(doc, 'div', { className: 'ss-explain-title', text: actionDef.label + ' · ' + wordToExplain }),
          contentNode
        ]);
        explainHolder.appendChild(expBox);

        sendBgMessage({
          op: 'companion',
          path: '/explain',
          body: {
            word: wordToExplain,
            lemma: wordToExplain === selectedText ? lookupLemma : wordToExplain,
            line: popupState.surroundingLine,
            mode: modeId,
            task_hint: actionDef.promptHint,
            target_lang: cfg.tl,
            source_lang: sourceLang,
            title: getDocTitle(),
            idiom_senses: (idioms || []).filter(function (it) {
              var lb = it && typeof it === 'object' ? (it.canonical || it.phrase || it.lemma || it.form || it.match || it.text || '') : '';
              return lb && (it.gloss || it.meaning) && wordToExplain.toLowerCase().indexOf(String(lb).toLowerCase()) !== -1;
            }).map(function (it) { return String(it.gloss || it.meaning); }).slice(0, 4)
          },
          method: 'POST',
          timeoutMs: 60000,
          url: cfg.companionUrl
        }, 62000).then(function (resp) {
          if (popupState.reqId !== reqId || !contentNode.isConnected) return;
          contentNode.classList.remove('ss-muted');
          if (!resp?.ok || resp.contextual !== true) {
            if (auto) { expBox.remove(); btnExplain.classList.remove('ss-active'); positionFloatingHost(host, popupState.anchorRect); return; }
            contentNode.textContent = /fetch|network|ECONN/i.test(resp?.error || '')
              ? 'The free offline AI is not running. Open the Phrasebound toolbar popup to start or install it.'
              : (resp?.error || 'Local explanation unavailable. Select the action again to retry.');
          } else {
            contentNode.textContent = formatExplanationText(resp).replace(/\*\*([^*\n]+)\*\*/g, '$1');
            if (modeId === 'explain') {
              expBox.appendChild(makeEl(doc, 'div', {
                className: 'ss-explain-src' + (resp.grounded ? '' : ' ss-explain-guess'),
                text: resp.grounded && resp.sources && resp.sources.length
                  ? 'Based on: ' + resp.sources.join(', ')
                  : 'No dictionary entry found. This is the AI\u2019s guess, so double-check it.'
              }));
            }
          }
          positionFloatingHost(host, popupState.anchorRect);
        });
      }

      const icons = {
        listen: 'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',
        stop: 'M6 6h12v12H6z', save: 'M6 3h12v18l-6-4-6 4z',
        original:'M2 12Q12 -3 22 12Q12 27 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
        compare:'M3 4h18v16H3z M12 4v16',
        known: 'm4 12 5 5L20 6', copy: 'M8 8h12v13H8z M16 5V3H4v14h1'
      };
      function setIcon(button, name, label, text, filled) {
        button.title = label;
        button.setAttribute('aria-label', label);
        button.classList.add('ss-icon-btn');
        clearChildren(button);
        const ns = 'http://www.w3.org/2000/svg';
        const svg = doc.createElementNS(ns, 'svg');
        for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:17,height:17,
          fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linejoin':'round',
          'stroke-linecap':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
        const path = doc.createElementNS(ns, 'path');
        path.setAttribute('d', icons[name]);
        svg.appendChild(path);
        if (filled) svg.setAttribute('fill', 'currentColor');
        button.appendChild(svg);
        if (text) { button.classList.add('ss-icon-text'); button.appendChild(makeEl(doc, 'span', { text: text })); }
      }
      const audioStatus = makeEl(doc, 'div', {className:'ss-muted', role:'status'});
      win.speechSynthesis?.getVoices?.();
      let resetAudio = null;
      function readAloudButton(text, language, label) {
        const button = makeEl(doc, 'button', {type:'button', className:'ss-btn'});
        function reset(message) {
          audioStatus.textContent = message || '';
          setIcon(button, 'listen', label);
          resetAudio = null;
        }
        setIcon(button, 'listen', label);
        button.title = label + ' · Uses Google audio when a device voice is unavailable';
        button.onclick = function () {
          audioStatus.textContent = '';
          const wasPlaying = resetAudio === reset && ttsSpeaking;
          if (resetAudio) resetAudio();
          stopSpeech();
          if (wasPlaying) return;
          setIcon(button, 'stop', 'Stop reading aloud');
          resetAudio = reset;
          speakTextChunked(text, reset, language, true);
        };
        return button;
      }

      var btnExplain = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn',
        text: 'Explain',
        title: 'Explain, grammar, register and chunks (runs on your own computer)',
        onClick: function () { runExplain(selectedText, activeActionMode); }
      });

      function runCompare() {
        popupState.compareOpen = !popupState.compareOpen;
        btnCompare.setAttribute('aria-expanded', String(popupState.compareOpen));
        btnCompare.classList.toggle('ss-active', popupState.compareOpen);
        card.classList.toggle('ss-wide', popupState.compareOpen);
        clearChildren(compareHolder);
        if (!popupState.compareOpen) return;

        var models = buildCompareModels(cfg.model);
        var grid = makeEl(doc, 'div', { className: 'ss-compare-grid' });
        compareHolder.appendChild(grid);

        models.forEach(function (mdl) {
          var latSpan = makeEl(doc, 'span', { className: 'ss-latency', text: '…' });
          var bodyDiv = makeEl(doc, 'div', { className: 'ss-compare-body ss-muted', text: 'Querying ' + mdl + '…' });
          var modelLabel = makeEl(doc, 'span', { text: mdl });
          var col = makeEl(doc, 'div', { className: 'ss-compare-col' }, [
            makeEl(doc, 'div', { className: 'ss-compare-hdr' }, [
              modelLabel,
              latSpan
            ]),
            bodyDiv
          ]);
          grid.appendChild(col);

          translateSingleText(selectedText, {
            model: mdl,
            context: popupState.surroundingLine,
            bypassCache: true,
            localOnly: true
          }).then(function (res) {
            if (popupState.reqId !== reqId) return;
            latSpan.textContent = res.latencyMs + ' ms';
            bodyDiv.classList.remove('ss-muted');
            if (res.ok) {
              if (res.model) modelLabel.textContent = res.model;
              bodyDiv.textContent = res.text;
            } else {
              bodyDiv.classList.add('ss-err');
              bodyDiv.textContent = res.error || 'Failed';
            }
          });
        });
        positionFloatingHost(host, popupState.anchorRect);
      }

      var btnCompare = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn',
        text: 'Compare' + (webShortcutKey('compare') ? ' (Alt+' + webShortcutKey('compare').toUpperCase() + ')' : ''),
        onClick: runCompare
      });

      var btnSaveWord = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn ss-btn-save',
        text: '+ Save',
        title: 'Save to Subtitle Study wordbook & cross-web highlighter',
        onClick: function () {
          persistWordStatus(selectedText, 'learning', {
            isFe: idioms.length > 0 || selectedText.indexOf(' ') !== -1,
            def: popupState.currentTranslation,
            line: popupState.surroundingLine,
            trans: popupState.currentTranslation
          }, sourceLang);
          setIcon(btnSaveWord, 'save', 'Saved to your wordbook', 'Saved', true);
          btnSaveWord.classList.add('ss-active');
        }
      });

      var btnMarkKnown = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn ss-btn-known',
        text: '✓ Known',
        title: 'Mark as Known and retire inline highlights on this page',
        onClick: function () {
          persistWordStatus(selectedText, 'known', null, sourceLang);
          retireKnownOnPage(selectedText.trim().toLowerCase());
          setIcon(btnMarkKnown, 'known', 'Marked as known: highlights retired', 'Known');
          btnMarkKnown.classList.add('ss-active');
        }
      });

      var btnCopy = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn',
        text: 'Copy',
        onClick: function () {
          copyTextToClipboard(popupState.currentTranslation || selectedText).then(function (ok) {
            setIcon(btnCopy, ok ? 'known' : 'copy', ok ? 'Copied' : 'Copy');
            setTimeout(function () { setIcon(btnCopy, 'copy', 'Copy'); }, 1200);
          });
        }
      });

      var btnClose = makeEl(doc, 'button', {
        type: 'button',
        className: 'ss-btn ss-btn-close',
        'aria-label': 'Close',
        text: '✕',
        onClick: closeSelectionPopup
      });

      var btnTranslate = scanInfo ? makeEl(doc, 'button', {
        type: 'button', className: 'ss-btn', text: 'Translate', onClick: runTranslation,
      }) : null;
      var btnExamples = scanInfo ? makeEl(doc, 'button', {
        type: 'button', className: 'ss-btn', text: 'Examples', onClick: requestExamples,
      }) : null;
      setIcon(btnOrig, 'original', 'Original');
      btnOrig.setAttribute('aria-expanded', String(popupState.showingOriginal)); btnOrig.classList.toggle('ss-active', popupState.showingOriginal);
      const compareTip = btnCompare.textContent;
      setIcon(btnCompare, 'compare', 'Compare translations');
      btnCompare.title = compareTip;
      btnCompare.setAttribute('aria-expanded','false');
      setIcon(btnCopy, 'copy', 'Copy');
      setIcon(btnSaveWord, 'save', 'Save to your wordbook to review later', 'Save');
      setIcon(btnMarkKnown, 'known', 'I know this: stop highlighting it', 'I know it');
      var topBar = makeEl(doc, 'div', { className: 'ss-topbar' }, [
        btnOrig,
        btnExplain,
        btnExamples,
        btnTranslate,
        btnCompare,
        btnSaveWord,
        btnMarkKnown,
        btnCopy,
        makeEl(doc, 'span', { className: 'ss-spacer' }),
        btnClose
      ]);

      var dictWrap = makeEl(doc, 'div', { className: 'ss-dict-wrap' });
      dictWrap.hidden = true;
      var trLabelNode = makeEl(doc, 'div', { className: 'ss-tr-lbl', text: 'Translation' });
      trLabelNode.hidden = true;
      var exWrap = makeEl(doc, 'div', { className: 'ss-ex-wrap' });
      exWrap.hidden = true;

      var episodicMem = findWebEpisodicMemory(selectedText, savedStudyState.items, savedStudyState.traces, getDocTitle(),
        win.location.href, pageModeState.detectedLang || doc.documentElement.lang);
      var episodicNode = null;
      if (episodicMem) {
        var epWhen = episodicMem.daysAgo === 0 ? 'today' : (episodicMem.daysAgo + 'd ago');
        var episodeUrl = episodicMem.sourceUrl || (episodicMem.videoKey.indexOf('yt:') === 0
          ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(episodicMem.videoKey.slice(3)) + '&t=' + Math.floor(episodicMem.t || 0) + 's' : '');
        episodicNode = makeEl(doc, episodeUrl ? 'a' : 'div', {
          className: 'ss-sel-episodic',
          title: episodicMem.contextLine || episodicMem.title,
          href: episodeUrl || null,
          target: episodeUrl ? '_blank' : null,
          rel: episodeUrl ? 'noopener noreferrer' : null,
          text: '↺ Seen ' + epWhen + (episodicMem.site ? ' on ' + episodicMem.site : '') + ' in “' +
            String(episodicMem.title || '').slice(0, 42) + '”' + (episodicMem.contextLine ? (' — “' + episodicMem.contextLine.slice(0, 56) + '”') : '')
        });
      }

      card.appendChild(topBar);
      if (episodicNode) card.appendChild(episodicNode);
      card.appendChild(origBox);
      card.appendChild(dictWrap);
      const sourceNode = scanInfo?.node || win.getSelection?.()?.anchorNode;
      const sourceBlock = sourceNode?.nodeType === 1 ? sourceNode : sourceNode?.parentElement;
      const sourceLang = scanInfo?.lang || blockReadingLanguage(sourceBlock, surroundingLine || selectedText,
        cfg.sourceLang === 'auto' ? (pageModeState.detectedLang || doc.documentElement.lang) : cfg.sourceLang, true);
      origBox.prepend(readAloudButton(selectedText, sourceLang, 'Read original aloud'));
      globalThis.SS_LITERARY?.append(card, sourceLang, selectedText, surroundingLine);
      const historyBox = makeEl(doc,'details',{},[makeEl(doc,'summary',{text:'Highlight history'})]);
      const historyStatus = makeEl(doc,'div',{'aria-live':'polite'});
      const historyToggle = makeEl(doc,'button',{type:'button',text:'Remember highlights'});
      let remember=false;
      const post=sourceBlock?.closest('article')?.querySelector('a[href*="/status/"] time')?.closest('a')?.href;
      function recordHighlight(term,context){
        return sendBgMessage({op:'highlightsRecord',term,context,lang:sourceLang,post,title:doc.title},4000).then(response=>{
          if (!response?.ok) return;
          historyStatus.textContent=response.count+' lookup'+(response.count===1?'':'s')+' here.';
          if(response.earlier){
            const a=makeEl(doc,'a',{text:'Earlier highlight · '+response.earlier.title});
            a.href=response.earlier.url;a.target='_blank';a.rel='noopener noreferrer';
            historyStatus.append(' ',a,makeEl(doc,'p',{text:response.earlier.context}));
            historyBox.open=true;
          }
        });
      }
      if(explicitSelection && !ch.extension?.inIncognitoContext){
        const manage=makeEl(doc,'a',{text:'Search history'});manage.href=ch.runtime.getURL('review.html#highlight-history');manage.target='_blank';manage.rel='noopener noreferrer';
        historyBox.append(historyToggle,' ',manage,historyStatus);
        const setRemember=value=>{remember=value;historyToggle.textContent=value?'Pause highlight history':'Remember highlights';};
        historyToggle.disabled=true;
        sendBgMessage({op:'highlightsState'},3000).then(res=>{
          historyToggle.disabled=!res?.ok;setRemember(Boolean(res?.enabled));
          if(remember)recordHighlight(selectedText,surroundingLine);
        });
        historyToggle.onclick=async()=>{
          historyToggle.disabled=true;
          const res=await sendBgMessage({op:'highlightsEnable',enabled:!remember},3000);
          historyToggle.disabled=false;
          if(res?.ok){setRemember(res.enabled);if(remember)recordHighlight(selectedText,surroundingLine);}
        };
      }
      card.appendChild(trLabelNode);
      card.appendChild(mainTrBox);
      card.appendChild(audioStatus);
      if (recallItem) {
        var recallControls = makeEl(doc, 'div', { className: 'ss-topbar', role: 'group', 'aria-label': 'Rate your recall' });
        var recallPending = false;
        ['Again', 'Hard', 'Good', 'Easy'].forEach(function (label) {
          recallControls.appendChild(makeEl(doc, 'button', {
            type: 'button', className: 'ss-btn', text: label,
            onClick: function () {
              if (recallPending) return;
              recallPending = true;
              sendBgMessage({
                op: 'reviewStudyItem', id: String(recallItem.id), rating: label.toLowerCase(),
                timestamp: root.SS_STORE.reviewTimestamp(recallItem)
              }, 4000).then(function (result) {
                recallPending = false;
                if (result && result.ok) recallControls.textContent = 'Review saved';
                else showToast('Review changed or could not be saved');
              });
            }
          }));
        });
        card.appendChild(recallControls);
      }
      card.appendChild(exWrap);
      card.appendChild(compareHolder);
      card.appendChild(explainHolder);
      if (historyBox.firstChild !== historyBox.lastChild) card.appendChild(historyBox);  // history sits at the bottom

      function renderDictionarySources(sources, wordText) {
        if (!sources.length) return;
        clearChildren(dictWrap);
        dictWrap.hidden = false;
        trLabelNode.hidden = mainTrBox.hidden;
        var s0 = sources[0];
        var e0 = (s0.entries && s0.entries[0]) || {};
        var headword = e0.head || s0.word || wordText;
        var hdr = makeEl(doc, 'div', { className: 'ss-dict-hdr' }, [
          makeEl(doc, 'span', { className: 'ss-dict-head', text: headword })
        ]);
        if (e0.reading) hdr.appendChild(makeEl(doc, 'span', { className: 'ss-dict-reading', text: e0.reading }));
        if (headword !== wordText) hdr.appendChild(makeEl(doc, 'span', { className: 'ss-dict-note', text: 'In text: ' + wordText }));
        var noteClean = String(s0.note || '').replace(/^offline pack\s*·?\s*/i, '').trim();
        if (noteClean) hdr.appendChild(makeEl(doc, 'span', { className: 'ss-dict-note', text: noteClean }));
        dictWrap.appendChild(hdr);

        var more = makeEl(doc, 'details', {}, [makeEl(doc, 'summary', { text: 'Other dictionary sources' })]);
        for (var si = 0; si < Math.min(3, sources.length); si++) {
          var src = sources[si];
          var entries = Array.isArray(src.entries) ? src.entries : [];
          if (!entries.length) continue;
          var srcBox = makeEl(doc, 'div', { className: 'ss-dict-src' });
          srcBox.appendChild(makeEl(doc, 'div', { className: 'ss-dict-src-lbl', text: src.name || 'Dictionary' }));
          for (var ei = 0; ei < Math.min(3, entries.length); ei++) {
            var ent = entries[ei];
            var defs = Array.isArray(ent.defs) ? ent.defs : [];
            if (!defs.length) continue;
            var eRow = makeEl(doc, 'div', { className: 'ss-dict-entry' });
            if (ent.pos) eRow.appendChild(makeEl(doc, 'span', { className: 'ss-dict-pos', text: ent.pos }));
            var ol = makeEl(doc, 'ol', { className: 'ss-dict-defs' });
            for (var di = 0; di < Math.min(4, defs.length); di++) {
              ol.appendChild(makeEl(doc, 'li', { text: defs[di] }));
            }
            eRow.appendChild(ol);
            srcBox.appendChild(eRow);
          }
          (si === 0 ? dictWrap : more).appendChild(srcBox);
        }
        if (more.children.length > 1) dictWrap.appendChild(more);
      }

      var chipsWrap = makeEl(doc, 'div', { className: 'ss-chips-wrap' });
      var renderIdiomChipsList = function (list) {
        clearChildren(chipsWrap);
        for (var k = 0; k < list.length; k++) {
          (function (idiomEntry) {
            var label = typeof idiomEntry === 'string'
              ? idiomEntry
              : (idiomEntry.canonical || idiomEntry.phrase || idiomEntry.lemma || idiomEntry.form || idiomEntry.match || idiomEntry.text || '');
            if (!label) return;
            var gloss = (idiomEntry && typeof idiomEntry === 'object')
              ? (idiomEntry.gloss || idiomEntry.meaning || '')
              : '';
            var chipText = gloss ? (label + ' · ' + gloss) : label;
            var chip = makeEl(doc, 'button', {
              type: 'button',
              className: 'ss-idiom-chip',
              text: chipText,
              onClick: function () { if(explicitSelection && remember) recordHighlight(label,selectedText); runExplain(label); }
            });
            chipsWrap.appendChild(chip);
          })(list[k]);
        }
        chipsWrap.hidden = !chipsWrap.firstChild;
      };
      if (idioms.length > 0) {
        renderIdiomChipsList(idioms);
        if (chipsWrap.firstChild) card.appendChild(chipsWrap);
      } else {
        chipsWrap.hidden = true;
        card.appendChild(chipsWrap);
        if (win.SS_IDIOMS && typeof win.SS_IDIOMS.findInTextAsync === 'function') {
          win.SS_IDIOMS.findInTextAsync(selectedText, cfg.tl).then(function (asyncHits) {
            if (popupState.reqId !== reqId || !Array.isArray(asyncHits) || !asyncHits.length) return;
            renderIdiomChipsList(asyncHits);
            positionFloatingHost(host, popupState.anchorRect);
          }).catch(function () {});
        }
      }

      // Dual-Layer Phrase Constituent Word Sub-Strip (MIT illa-helper inspired)
      var constituents = extractConstituentTokens(selectedText);
      if (constituents.length >= 2) {
        var subDefBox = makeEl(doc, 'div', { className: 'ss-subdef' });
        subDefBox.hidden = true;
        var subStrip = makeEl(doc, 'div', { className: 'ss-substrip' }, [
          makeEl(doc, 'span', { className: 'ss-muted', text: 'Words:' })
        ]);
        constituents.forEach(function (ct) {
          var wBtn = makeEl(doc, 'button', {
            type: 'button',
            className: 'ss-subword',
            text: ct.word,
            onClick: function () {
              if(explicitSelection && remember) recordHighlight(ct.word,selectedText);
              subDefBox.hidden = false;
              subDefBox.textContent = 'Looking up ' + ct.word + '…';
              sendBgMessage({ op: 'define', words: [ct.word, ct.lemma], lang: 'auto', tl: cfg.tl }, 4000).then(function (dRes) {
                if (popupState.reqId !== reqId) return;
                if (dRes && Array.isArray(dRes.entries) && dRes.entries.length > 0) {
                  var e0 = dRes.entries[0];
                  var defs = (e0.defs || []).slice(0, 2).join('; ');
                  subDefBox.textContent = ct.word + (dRes.reading ? (' [' + dRes.reading + ']') : '') + (e0.pos ? (' (' + e0.pos + ')') : '') + ': ' + defs;
                } else {
                  translateSingleText(ct.word, { context: selectedText }).then(function (tRes) {
                    if (popupState.reqId !== reqId) return;
                    subDefBox.textContent = ct.word + ' → ' + (tRes.ok ? tRes.text : 'No offline entry');
                  });
                }
              });
            }
          });
          subStrip.appendChild(wBtn);
        });
        subStrip.appendChild(subDefBox);
        card.appendChild(subStrip);
      }

      var copyHintNode = makeEl(doc, 'div', { className: 'ss-copy-hint' });
      copyHintNode.hidden = true;
      card.appendChild(copyHintNode);
      popupState.copyArmed = false;
      popupState.copyHintNode = copyHintNode;

      shadow.appendChild(styleNode);
      shadow.appendChild(card);
      doc.body.appendChild(host);

      popupState.host = host;
      popupState.shadow = shadow;
      popupState.triggerCompare = runCompare;
      positionFloatingHost(host, anchorRect);

      var cleanSel = String(selectedText || '').trim();
      var spaceTokens = cleanSel.split(/\s+/).filter(Boolean);
      var isWordQuery = Boolean(scanInfo) || (spaceTokens.length <= 4 && cleanSel.length <= 32);
      var lookup = win.SS_LANG?.get(sourceLang);
      var lookupLemma = scanInfo?.canonical || (isWordQuery && lookup?.lemma?.(cleanSel)) || cleanSel;
      var examplesPending = false;

      if (isWordQuery && cleanSel.length >= 1) {
        var strippedWord = cleanSel.replace(/^[("'“‘「『《（【]+|[)"'”’」』》）】.,!?;:。、！？；：]+$/g, '') || cleanSel;
        var wordCands = [...new Set([strippedWord, lookupLemma, cleanSel].filter(Boolean))];
        var fastSources = [], fullSources = [];
        var refreshDictionary = function () {
          var seen = new Set();
          var sources = [...fastSources, ...fullSources].filter(function (source) {
            if (!source.entries?.length || seen.has(source.id || source.name)) return false;
            seen.add(source.id || source.name);
            return true;
          });
          renderDictionarySources(sources, strippedWord);
          positionFloatingHost(host, popupState.anchorRect);
        };
        sendBgMessage({ op: 'defineAll', words: wordCands, lang: sourceLang, tl: cfg.tl, packsOnly: true }, 2500).then(function (fastDef) {
          if (popupState.reqId !== reqId) return;
          fastSources = fastDef?.sources || [];
          if (scanInfo && !fastSources.length) {
            dictWrap.hidden = false;
            dictWrap.textContent = scanInfo.gloss || 'No bundled dictionary entry. Use Study to explain the line.';
          }
          refreshDictionary();
        });
        sendBgMessage({ op: 'defineAll', words: wordCands, lang: sourceLang, tl: cfg.tl, noOnline: Boolean(scanInfo) }, 5500).then(function (fullDef) {
          if (popupState.reqId !== reqId) return;
          fullSources = fullDef?.sources || [];
          refreshDictionary();
        });
        if (!scanInfo) requestExamples();
      }

      function requestExamples() {
        if (examplesPending || exWrap.querySelector('.ss-ex-pair')) return;
        examplesPending = true;
        if (scanInfo) {
          exWrap.hidden = false;
          exWrap.textContent = 'Finding examples…';
        }
        sendBgMessage({ op: 'examples', query: lookupLemma || cleanSel, lang: sourceLang, tl: cfg.tl }, 5500).then(function (exRes) {
          if (popupState.reqId !== reqId) return;
          examplesPending = false;
          if (!exRes?.ok || !exRes.items?.length) {
            if (scanInfo) exWrap.textContent = 'No examples found in Tatoeba.';
            positionFloatingHost(host, popupState.anchorRect);
            return;
          }
          clearChildren(exWrap);
          exWrap.hidden = false;
          exWrap.appendChild(makeEl(doc, 'div', { className: 'ss-dict-src-lbl', text: 'Examples (Tatoeba)' }));
          for (var xi = 0; xi < Math.min(2, exRes.items.length); xi++) {
            const exIt = exRes.items[xi];
            exWrap.appendChild(makeEl(doc, 'div', { className: 'ss-ex-pair' }, [
              makeEl(doc, 'button', { type: 'button', className: 'ss-btn ss-ex-src', text: exIt.text,
                title: 'Speak example', onClick: () => speakTextChunked(exIt.text, null, sourceLang) }),
              exIt.trans ? makeEl(doc, 'div', { className: 'ss-ex-tr', text: exIt.trans }) : null
            ]));
          }
          positionFloatingHost(host, popupState.anchorRect);
        });
      }

      let translationRun = 0;
      function runTranslation() {
        const run = ++translationRun;
        const target = cfg.tl;
        mainTrBox.hidden = false;
        trLabelNode.hidden = dictWrap.hidden;
        mainTrBox.textContent = 'Translating…';
        return translateSingleText(selectedText, { context: popupState.surroundingLine, scene: 'selection' }).then(function (res) {
          if (popupState.reqId !== reqId || run !== translationRun) return;
          clearChildren(mainTrBox);
          if (res.ok) {
            popupState.currentTranslation = res.text;
            const line = makeEl(doc, 'span', {lang:target, text:res.text});
            mainTrBox.appendChild(readAloudButton(res.text, target, 'Read translation aloud'));
            mainTrBox.appendChild(line);
            const lang = normWebReadLang(target);
            if (cfg.webReaderAid !== false && cfg.readingAid !== 'off') {
              ensureWebReadDict(lang).then(function (dict) {
                if (!dict || !line.isConnected || run !== translationRun) return;
                if (/^(zh|yue|ja|ko)$/.test(lang) && res.text.length > 6) {
                  // Whole sentences: reading on its own line under the text, not crammed above each character.
                  const reading = webReadingLine(res.text, lang, dict);
                  if (reading) mainTrBox.appendChild(makeEl(doc, 'div', { className: 'ss-read-line', lang: lang + '-Latn', text: reading }));
                  positionFloatingHost(host, popupState.anchorRect);
                  return;
                }
                const fragment = doc.createDocumentFragment();
                appendWebTokensToParent(fragment, res.text, lang, dict, true);
                line.replaceChildren(fragment);
                positionFloatingHost(host, popupState.anchorRect);
              });
            }
          } else {
            mainTrBox.appendChild(makeEl(doc, 'span', {
              className: 'ss-err',
              text: res.error || 'Translation unavailable'
            }));
          }
          positionFloatingHost(host, popupState.anchorRect);
        });
      }
      // Explain needs a different local model; start it after the translation so the two never queue against each other.
      var autoExplain = function () { if (!startInCompare && !recallItem && host.isConnected) runExplain(selectedText, 'explain', true); };
      if (!scanInfo) Promise.resolve(runTranslation()).then(autoExplain, autoExplain);
      else autoExplain();

      if (startInCompare) {
        runCompare();
      }
    }

    function getCleanSelectionInfo() {
      var sel = win.getSelection ? win.getSelection() : null;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
      var raw = sel.toString();
      var trimmed = raw ? raw.trim() : '';
      if (!trimmed || trimmed.length > 3000) return null;
      var anchorEl = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (anchorEl && (isEditableElement(anchorEl) || safeClosest(anchorEl, UI_IGNORE_SELECTOR))) {
        return null;
      }
      var range = sel.getRangeAt(0);
      var rect = typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : { left: lastMouseX, right: lastMouseX, top: lastMouseY, bottom: lastMouseY, width: 10, height: 10 };
      var line = extractSurroundingSentence(sel, trimmed);
      return { text: trimmed, line: line, rect: rect };
    }

    var selectionTimer = null;
    function scheduleSelectionCheck() {
      if (!cfg.selectTranslate) return;
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(function () {
        var info = getCleanSelectionInfo();
        if (!info) return;
        if (popupState.host && popupState.selectedText === info.text) return;
        openSelectionPopup(info.text, info.line, info.rect, false, null, null, true);
      }, 20);
    }

    doc.addEventListener('mouseup', function (ev) {
      lastMouseX = ev.clientX || 0;
      lastMouseY = ev.clientY || 0;
      if (ev.button !== undefined && ev.button !== 0) return;
      if (eventTouchesPopup(ev) || eventTouchesIgnoredUI(ev)) return;
      scheduleSelectionCheck();
    }, true);

    doc.addEventListener('mousedown', function (ev) {
      lastMouseX = ev.clientX || 0;
      lastMouseY = ev.clientY || 0;
      if (popupState.host && !eventTouchesPopup(ev)) {
        closeSelectionPopup();
      }
      if (ev.ctrlKey) {
        abortPendingHover();
      }
    }, true);

    /* ----------------------------------------------------------------------
     * Feature 3: Exact-Chord Hover (260ms Ctrl alone) & Ctrl+Click Bilingual
     * ---------------------------------------------------------------------- */
    var blockTrMap = new WeakMap();
    var hoveredBlock = null;
    var hoverTimer = null;
    var ctrlAloneHeld = false;

    function isGoogleSearch() {
      return /^(?:www\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/i.test(getHostKey()) &&
        win.location?.pathname === '/search';
    }

    function isSearchResultBlock(block) {
      return isGoogleSearch() && safeMatches(block, SEARCH_RESULT_TEXT) &&
        !!safeClosest(block, '#search, #rso') &&
        (!safeMatches(block, 'h3') || !!safeClosest(block, 'a[href]'));
    }

    function findExistingBlockTr(block) {
      if (!block) return null;
      var mapped = blockTrMap.get(block);
      if (mapped && mapped.isConnected) return mapped;
      var next = block.nextElementSibling;
      if (next && next.getAttribute && next.getAttribute('data-ss-page-tr') === '1' &&
          next.getAttribute('data-ss-inline-owner') === '1') {
        return next;
      }
      var childTr = block.querySelector && block.querySelector(':scope > [data-ss-page-tr="1"]');
      return childTr || null;
    }

    function insertBlockTrNode(block, trDiv) {
      ensurePageStyleInjected(block);
      trDiv.setAttribute('dir', 'auto');
      trDiv.setAttribute('lang', cfg.tl);
      var tag = (block.tagName || '').toLowerCase();
      if (isSearchResultBlock(block)) {
        // A sibling of the title can land above it in Google's reversed link layout.
        trDiv.setAttribute('data-ss-search-tr', '1');
        block.appendChild(trDiv);
      } else if (tag === 'td' || tag === 'th' || tag === 'li') {
        block.appendChild(trDiv);
      } else if (block.parentNode) {
        trDiv.setAttribute('data-ss-inline-owner', '1');
        if (typeof block.insertAdjacentElement === 'function') {
          block.insertAdjacentElement('afterend', trDiv);
        } else {
          block.parentNode.insertBefore(trDiv, block.nextSibling || null);
        }
      } else {
        block.appendChild(trDiv);
      }
      if (trDiv.parentNode !== block && typeof win.getComputedStyle === 'function') {
        const style = win.getComputedStyle(block);
        for (const [name, value] of Object.entries({
          color: style.color, family: style.fontFamily, size: style.fontSize,
          weight: style.fontWeight, style: style.fontStyle, leading: style.lineHeight,
          spacing: style.letterSpacing
        })) if (value) trDiv.style.setProperty('--ss-source-' + name, value);
      }
      blockTrMap.set(block, trDiv);
    }

    function injectOrToggleSingleBlock(block, forceInjectOnly, pageOwned) {
      if (!block || !block.isConnected) return;
      ensurePageStyleInjected();

      var existing = findExistingBlockTr(block);
      if (existing) {
        if (forceInjectOnly) return;
        var recOld = inPlaceBlockMap.get(block);
        if (recOld && recOld.runs) {
          for (var oi = 0; oi < recOld.runs.length; oi++) {
            recOld.runs[oi].tn.nodeValue = recOld.runs[oi].orig;
          }
          inPlaceBlockMap.delete(block);
        }
        if (block.removeAttribute) {
          block.removeAttribute('data-ss-inplace');
          block.removeAttribute('data-ss-has-tr');
        }
        if (existing.parentNode) existing.parentNode.removeChild(existing);
        blockTrMap.delete(block);
        return;
      }

      var extracted = extractBlockWithPlaceholders(block);
      if (!extracted.text || extracted.text.length < 2) return;
      var inlineRuns = collectBlockTextNodes(block);

      var trDiv = makeEl(doc, isSearchResultBlock(block) ? 'span' : 'div', {
        'data-ss-page-tr': '1',
        'data-ss-loading': '1',
        text: 'Translating…'
      });
      if (pageOwned) trDiv.setAttribute('data-ss-mode-owned', '1');
      insertBlockTrNode(block, trDiv);

      var singleItems = [{ id: 'b0', rawText: extracted.text, seedMap: extracted.map }];
      if (inlineRuns.length >= 2 && inlineRuns.length <= 5) {
        for (var si = 0; si < inlineRuns.length; si++) {
          singleItems.push({ id: 'r_' + si, rawText: inlineRuns[si].core, seedMap: {} });
        }
      }
      if (singleItems.length === 1) {
        translateSingleText(extracted.text, { scene: 'hover' }, extracted.map).then(function (res) {
          if (!trDiv.isConnected) return;
          trDiv.removeAttribute('data-ss-loading');
          if (res.ok && res.text) {
            trDiv.textContent = res.text;
            if (block.setAttribute) block.setAttribute('data-ss-has-tr', '1');
            if (inlineRuns.length === 1) {
              inlineRuns[0].tr = res.text;
              inPlaceBlockMap.set(block, { runs: inlineRuns });
              inPlaceBlockList.push(block);
              applyBlockDisplayMode(block, trDiv);
            }
          } else {
            trDiv.textContent = res.error || 'Translation failed';
          }
        });
      } else {
        translateSegmentsBatch(singleItems, { title: getDocTitle(), summary: pageModeState.summary, scene: 'hover' }).then(function (resMap) {
          if (!trDiv.isConnected) return;
          trDiv.removeAttribute('data-ss-loading');
          var mainTr = resMap && resMap.b0;
          if (mainTr) {
            trDiv.textContent = mainTr;
            if (block.setAttribute) block.setAttribute('data-ss-has-tr', '1');
            if (inlineRuns.every(function (_r, k) { return !!(resMap && resMap['r_' + k]); })) {
              for (var k = 0; k < inlineRuns.length; k++) inlineRuns[k].tr = resMap['r_' + k];
              inPlaceBlockMap.set(block, { runs: inlineRuns });
              inPlaceBlockList.push(block);
            }
            applyBlockDisplayMode(block, trDiv);
          } else {
            trDiv.textContent = 'Translation failed';
          }
        });
      }
    }

    function abortPendingHover() {
      ctrlAloneHeld = false;
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    }

    function armHoverTimerForBlock(block) {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (!ctrlAloneHeld || !block) return;
      if (getCleanSelectionInfo()) {
        abortPendingHover();
        return;
      }
      hoverTimer = setTimeout(function () {
        hoverTimer = null;
        if (!ctrlAloneHeld || !hoveredBlock || hoveredBlock !== block) return;
        if (getCleanSelectionInfo()) return;
        injectOrToggleSingleBlock(block, false, false);
      }, HOVER_DELAY_MS);
    }

    function resolveHoverCandidate(target) {
      if (!target || target.nodeType !== 1) return null;
      if (isEditableElement(target) || safeClosest(target, UI_IGNORE_SELECTOR)) return null;
      return safeClosest(target, BLOCK_HOVER_SELECTOR);
    }

    doc.addEventListener('mousemove', function (ev) {
      lastMouseX = ev.clientX || 0;
      lastMouseY = ev.clientY || 0;
      var cand = resolveHoverCandidate(ev.target);
      if (cand !== hoveredBlock) {
        hoveredBlock = cand;
        if (ctrlAloneHeld) {
          if (ev.altKey || ev.shiftKey || ev.metaKey || !ev.ctrlKey) {
            abortPendingHover();
          } else {
            armHoverTimerForBlock(hoveredBlock);
          }
        }
      }
    }, { passive: true, capture: true });

    doc.addEventListener('selectionchange', function () {
      if (hoverTimer) {
        var sel = win.getSelection ? win.getSelection() : null;
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          abortPendingHover();
        }
      }
    });

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('blur', abortPendingHover);
    }
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) abortPendingHover();
    });

    doc.addEventListener('click', function (ev) {
      if (!ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return;
      if (eventTouchesIgnoredUI(ev)) return;
      if (safeClosest(ev.target, 'a[href], button')) return;
      var sel = win.getSelection ? win.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

      var block = resolveHoverCandidate(ev.target);
      if (!block) return;
      abortPendingHover();
      ev.preventDefault();
      ev.stopPropagation();
      injectOrToggleSingleBlock(block, false, false);
    }, true);

    /* ----------------------------------------------------------------------
     * Feature 4: Full-Page (Alt+P) & Article-Only (Alt+A) Bilingual Mode
     * ---------------------------------------------------------------------- */
    var pageModeState = {
      mode: null, // null | 'full' | 'article'
      smartI1: false,
      fastFeed: false,
      fastSearch: false,
      feedSources: new WeakMap(),
      autoStarted: false,
      detectedLang: '',
      sessionId: 0,
      io: null,
      mo: null,
      roots: [],
      observedSet: new WeakSet(),
      translatedSet: new WeakSet(),
      queue: [],
      flushTimer: null,
      inFlightBatches: 0,
      ownedTranslations: new Map(),
      ownedStudyChips: new Set(),
      summary: ''
    };

    function resolveActiveSiteRules() {
      var raw = cfg.siteRules;
      if (!raw || typeof raw !== 'object') return { include: '', exclude: '' };
      var host = (win.location && win.location.hostname) ? win.location.hostname : '';
      var inc = [];
      var exc = [];

      function pushRule(r) {
        if (!r || typeof r !== 'object') return;
        if (Array.isArray(r.include)) inc.push(r.include.filter(Boolean).join(', '));
        else if (typeof r.include === 'string' && r.include.trim()) inc.push(r.include.trim());
        if (Array.isArray(r.exclude)) exc.push(r.exclude.filter(Boolean).join(', '));
        else if (typeof r.exclude === 'string' && r.exclude.trim()) exc.push(r.exclude.trim());
      }

      if ('include' in raw || 'exclude' in raw) {
        pushRule(raw);
      }
      if (host && raw[host] && typeof raw[host] === 'object') {
        pushRule(raw[host]);
      }
      if (Array.isArray(raw)) {
        for (var i = 0; i < raw.length; i++) {
          var entry = raw[i];
          if (entry && (!entry.host || (host && host.indexOf(entry.host) !== -1))) {
            pushRule(entry);
          }
        }
      }
      return {
        include: inc.filter(Boolean).join(', '),
        exclude: exc.filter(Boolean).join(', ')
      };
    }

    function isExcludedBlock(el, rules) {
      if (!el || el.nodeType !== 1) return true;
      if (safeClosest(el, '[hidden], [inert], [aria-hidden="true"], dialog:not([open]), [contenteditable]:not([contenteditable="false"])')) return true;
      if (safeClosest(el, 'script, style, noscript, svg, textarea, input, select, [data-ss-page-tr], [data-ss-select], [data-ss-fab], .ss-pop, #ss-panel, #ss-overlay')) {
        return true;
      }
      if (rules.exclude && safeClosest(el, rules.exclude)) return true;
      if (rules.include && safeClosest(el, rules.include)) {
        return false;
      }
      if (safeClosest(el, DEFAULT_EXCLUDE_SELECTOR)) return true;
      return false;
    }

    function computePageSummary(roots) {
      var parts = [];
      var meta = doc.querySelector && doc.querySelector('meta[name="description"], meta[property="og:description"]');
      if (meta) {
        var c = meta.getAttribute('content');
        if (c && c.trim()) parts.push(c.trim());
      }
      for (var r = 0; r < roots.length && parts.join(' ').length < 320; r++) {
        var ps = roots[r].querySelectorAll ? roots[r].querySelectorAll('p, h1, h2') : [];
        for (var i = 0; i < ps.length && parts.join(' ').length < 320; i++) {
          var t = (ps[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length >= 20) parts.push(t);
        }
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    }

    function hasNestedCandidateBlock(el) {
      var tag = (el.tagName || '').toLowerCase();
      if (tag !== 'li' && tag !== 'blockquote' && tag !== 'td') return false;
      return Boolean(el.querySelector && el.querySelector('p'));
    }

    function collectTranslatableBlocks(rootNode, rules, onShadowRoot) {
      if (!rootNode || !rootNode.querySelectorAll) return [];
      if (isGoogleSearch()) {
        const nodes = [rootNode, ...rootNode.querySelectorAll(SEARCH_RESULT_TEXT)];
        if (rules.include) {
          try { nodes.push(...rootNode.querySelectorAll(rules.include)); } catch (_) {}
        }
        return [...new Set(nodes)].filter(el => {
          const forced = rules.include && safeMatches(el, rules.include);
          if ((!forced && !isSearchResultBlock(el)) || isExcludedBlock(el, rules)) return false;
          // Google can nest a snippet marker in a snippet wrapper. Use the innermost unit.
          if (!forced && el.querySelector(SEARCH_RESULT_TEXT)) return false;
          return (el.textContent || '').trim().length >= 2;
        });
      }
      var combinedSelector = rules.include
        ? (PAGE_BLOCK_SELECTOR + ', ' + rules.include)
        : PAGE_BLOCK_SELECTOR;

      var result = [];
      var visited = new Set();
      function scanHost(el) {
        if (!el.shadowRoot || isOurInjectedNode(el) || isExcludedBlock(el, rules)) return;
        if (onShadowRoot) onShadowRoot(el.shadowRoot);
        scanRoot(el.shadowRoot);
      }
      function scanRoot(scope) {
        if (!scope || !scope.querySelectorAll) return;
        var nodeList;
        try {
          nodeList = scope.querySelectorAll(combinedSelector);
        } catch (_e) {
          nodeList = scope.querySelectorAll(PAGE_BLOCK_SELECTOR);
        }
        if (scope.nodeType === 1 && safeMatches(scope, combinedSelector) && !isExcludedBlock(scope, rules) && !visited.has(scope)) {
          visited.add(scope);
          result.push(scope);
        }
        for (var i = 0; i < nodeList.length; i++) {
          var el = nodeList[i];
          if (visited.has(el) || isExcludedBlock(el, rules) || hasNestedCandidateBlock(el)) continue;
          var textProbe = (el.textContent || '').trim();
          if (textProbe.length < 2) continue;
          visited.add(el);
          result.push(el);
        }
        // Scan leaf <div> prose containers (e.g. modern SPAs / comment threads using <div> instead of <p>)
        try {
          var divs = scope.querySelectorAll('div');
          var divLimit = Math.min(divs.length, 1200);
          for (var d = 0; d < divLimit; d++) {
            var dv = divs[d];
            if (visited.has(dv) || isExcludedBlock(dv, rules)) continue;
            if (safeClosest(dv, 'button, a, [role="navigation"], [role="menu"], [role="toolbar"]')) continue;
            if (dv.querySelector && dv.querySelector('p, div, ul, ol, table, section, article, main, form, nav, header, footer, aside, pre, blockquote, h1, h2, h3, h4, h5, h6')) continue;
            var dTxt = (dv.textContent || '').replace(/\s+/g, ' ').trim();
            if (dTxt.length < 28 || dTxt.length > 1800) continue;
            if (!/\s/.test(dTxt) && !/[。！？，、]/.test(dTxt)) continue;
            visited.add(dv);
            result.push(dv);
          }
        } catch (_ed) {}
        // Traverse open Shadow DOM roots (Reddit shreddit-*, Lit/Web Components, modern SPAs)
        try {
          var allEls = scope.querySelectorAll('*');
          for (var j = 0; j < allEls.length; j++) scanHost(allEls[j]);
          if (scope.nodeType === 1) scanHost(scope);
        } catch (_e2) {}
      }
      scanRoot(rootNode);
      return result;
    }

    function collectBlockTextNodes(blockEl) {
      var runs = [];
      if (!blockEl) return runs;
      var walk = function (node) {
        if (!node) return;
        if (node.nodeType === 3) {
          var raw = node.nodeValue != null ? String(node.nodeValue) : '';
          var m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
          var core = m ? m[2] : raw.trim();
          if (core.length >= 1 && /[\p{L}\p{N}]/u.test(core)) {
            runs.push({ tn: node, orig: raw, lead: m ? m[1] : '', core: core, trail: m ? m[3] : '', tr: '' });
          }
          return;
        }
        if (node.nodeType !== 1) return;
        var tag = String(node.tagName || node.nodeName || '').toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'ruby' ||
            tag === 'code' || tag === 'kbd' || tag === 'math' || tag === 'svg') return;
        if (nodeHasAttr(node, 'data-math') || nodeHasAttr(node, 'data-ss-page-tr') ||
            nodeHasAttr(node, 'data-ss-select') || nodeHasAttr(node, 'data-ss-input-preview') ||
            nodeHasClass(node, 'ss-pop')) return;
        var chs = node.childNodes || [];
        for (var i = 0; i < chs.length; i++) walk(chs[i]);
      };
      walk(blockEl);
      return runs;
    }

    var inPlaceBlockMap = new WeakMap();
    var inPlaceBlockList = [];
    function applyBlockDisplayMode(block, trDiv) {
      var rec = block ? inPlaceBlockMap.get(block) : null;
      var wantInPlace = cfg.webDisplayMode === 'tr_only';
      if (wantInPlace && rec && rec.runs && rec.runs.length && (rec.whole || rec.runs.every(function (r) { return !!r.tr; }))) {
        for (var i = 0; i < rec.runs.length; i++) {
          var r = rec.runs[i];
          r.tn.nodeValue = r.lead + r.tr + r.trail;
        }
        if (block.setAttribute) block.setAttribute('data-ss-inplace', '1');
        if (trDiv && trDiv.style) trDiv.style.display = 'none';
      } else {
        if (rec && rec.runs) {
          for (var j = 0; j < rec.runs.length; j++) {
            rec.runs[j].tn.nodeValue = rec.runs[j].orig;
          }
        }
        if (block && block.removeAttribute) block.removeAttribute('data-ss-inplace');
        if (trDiv && trDiv.style) trDiv.style.display = '';
      }
    }
    function applyDisplayModeForAll() {
      var kept = [];
      for (var i = 0; i < inPlaceBlockList.length; i++) {
        var b = inPlaceBlockList[i];
        if (!b || !b.isConnected) continue;
        kept.push(b);
        applyBlockDisplayMode(b, findExistingBlockTr(b));
      }
      inPlaceBlockList = kept;
    }

    function teardownPageBilingual(removeDomNodes, replacing) {
      if (!replacing) publishEmbeddedScope(null);
      pageModeState.sessionId++;
      pageModeState.inFlightBatches = 0;
      stopOriginalReadings();
      clearWebBlockAids();
      translatedReadingsOverride = null;
      translatedWebAidLang = new WeakMap();
      pageModeState.mode = null;
      pageModeState.smartI1 = false;
      pageModeState.fastFeed = false;
      pageModeState.fastSearch = false;
      pageModeState.feedSources = new WeakMap();
      pageModeState.autoStarted = false;
      pageModeState.detectedLang = '';
      if (pageModeState.flushTimer) {
        clearTimeout(pageModeState.flushTimer);
        pageModeState.flushTimer = null;
      }
      if (pageModeState.io) {
        pageModeState.io.disconnect();
        pageModeState.io = null;
      }
      if (pageModeState.mo) {
        pageModeState.mo.disconnect();
        pageModeState.mo = null;
      }
      pageModeState.queue = [];
      pageModeState.roots = [];
      pageModeState.observedSet = new WeakSet();
      pageModeState.translatedSet = new WeakSet();

      if (removeDomNodes) {
        for (var ip = 0; ip < inPlaceBlockList.length; ip++) {
          var ipBlk = inPlaceBlockList[ip];
          var rec = ipBlk ? inPlaceBlockMap.get(ipBlk) : null;
          if (rec && rec.runs) {
            for (var ri = 0; ri < rec.runs.length; ri++) {
              rec.runs[ri].tn.nodeValue = rec.runs[ri].orig;
            }
          }
          if (ipBlk && ipBlk.removeAttribute) {
            ipBlk.removeAttribute('data-ss-inplace');
            ipBlk.removeAttribute('data-ss-has-tr');
          }
        }
        inPlaceBlockMap = new WeakMap();
        inPlaceBlockList = [];
      }
      syncFloatingFab();

      if (removeDomNodes) {
        pageModeState.ownedTranslations.forEach(function (node, owner) {
          if (owner && owner.removeAttribute) owner.removeAttribute('data-ss-has-tr');
          if (node.parentNode) node.parentNode.removeChild(node);
        });
        pageModeState.ownedTranslations.clear();
        pageModeState.ownedStudyChips.forEach(function (chip) { chip.remove(); });
        pageModeState.ownedStudyChips.clear();
      }
      if (!replacing && webReadingsVisible()) refreshWebAidView();
    }

    function pumpBatchQueue() {
      if (!pageModeState.mode) return;
      if (pageModeState.fastFeed && pageModeState.queue.length > 0) {
        var tweets = [[], []];
        var otherBlocks = [];
        for (var block of pageModeState.queue) {
          if (safeMatches(block, FEED_POST_SELECTOR)) {
            var rect = block.getBoundingClientRect();
            var visible = rect.bottom > 0 && rect.top < win.innerHeight;
            tweets[visible ? 0 : 1].push(block);
          } else otherBlocks.push(block);
        }
        var groups = tweets.concat([otherBlocks]);
        for (var group of groups) {
          while (pageModeState.inFlightBatches < 3 && group.length > 0) {
            runPageBatchChunk(group.splice(0, BATCH_SIZE), pageModeState.sessionId);
          }
        }
        pageModeState.queue = tweets[0].concat(tweets[1], otherBlocks);
        return;
      }
      while (pageModeState.inFlightBatches < 3 && pageModeState.queue.length > 0) {
        var chunk = pageModeState.queue.splice(0, BATCH_SIZE);
        runPageBatchChunk(chunk, pageModeState.sessionId);
      }
    }

    function runPageBatchChunk(blocks, sessionId) {
      var fastFeed = pageModeState.fastFeed;
      var fastPage = fastFeed || pageModeState.fastSearch;
      var validItems = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b || !b.isConnected) continue;
        if (findExistingBlockTr(b)) continue;
        var ext = extractBlockWithPlaceholders(b);
        if (!ext.text || ext.text.length < 2) continue;

        var searchResult = isSearchResultBlock(b);
        var inlineRuns = collectBlockTextNodes(b);
        var replaceWhole = searchResult && inlineRuns.length === 1 &&
          !b.querySelector('a, button, ruby, code, kbd, math, [data-math], [contenteditable]');
        var placeholder = makeEl(doc, searchResult ? 'span' : 'div', {
          'data-ss-page-tr': '1',
          'data-ss-mode-owned': '1',
          'data-ss-loading': '1',
          text: '…'
        });
        insertBlockTrNode(b, placeholder);
        pageModeState.ownedTranslations.set(b, placeholder);
        if (fastFeed) pageModeState.feedSources.set(b, ext.text);
        var mainId = 'b_' + validItems.length;
        validItems.push({
          id: mainId,
          rawText: ext.text,
          seedMap: ext.map,
          block: b,
          trDiv: placeholder,
          inlineRuns: inlineRuns,
          replaceWhole: replaceWhole
        });
      }

      if (validItems.length === 0) return;

      pageModeState.inFlightBatches++;
      var learningWords = [];
      if (pageModeState.smartI1 && savedStudyState && savedStudyState.words) {
        var wKeys = Object.keys(savedStudyState.words);
        for (var wk = 0; wk < wKeys.length && learningWords.length < 80; wk++) {
          if (savedStudyState.words[wKeys[wk]] === 'learning') {
            var bareW = wKeys[wk].indexOf('|') >= 0 ? wKeys[wk].split('|').slice(1).join('|') : wKeys[wk];
            if (bareW && bareW.length >= 2) learningWords.push(bareW.toLowerCase());
          }
        }
      }

      var skipHints = fastPage || (!pageModeState.smartI1 && cfg.sceneServices.webpage === 'free_web');
      var phraseHints = skipHints ? Promise.resolve(null) : sendBgMessage({
        op: 'matchTextIdioms',
        texts: validItems.map(function (v) { return v.rawText; }),
        tl: cfg.tl,
        model: cfg.mtModel
      }, 2200);
      phraseHints.then(async function (feRes) {
        var scaffoldLang = normWebReadLang(pageModeState.detectedLang || (feRes && feRes.detectedLang) || 'en');
        var ranks = pageModeState.smartI1 ? await ensureWebRanks(scaffoldLang) : null;
        if (pageModeState.sessionId !== sessionId) return;
        var activeItems = [];
        var batchPayload = [];
        for (var vi = 0; vi < validItems.length; vi++) {
          var vit = validItems[vi];
          if (!vit.trDiv.isConnected) continue;
          var paraFes = (feRes && feRes.byPara && feRes.byPara[vi]) || [];
          if (pageModeState.smartI1) {
            var lowRaw = vit.rawText.toLowerCase();
            var wc = vit.rawText.trim().split(/\s+/).length;
            var cjkUnits = /[\u3040-\u9fff\uac00-\ud7af]/.test(vit.rawText) ? Array.from(vit.rawText.replace(/\s+/g, '')).length / 2 : 0;
            var hasSaved = learningWords.some(function (lw) { return lowRaw.indexOf(lw) !== -1; });
            var level = root.SS_STORE ? root.SS_STORE.getLangVocabLevel(cfg, scaffoldLang) : cfg.vocabLevel;
            var rec = (win.SS_IDIOMS && typeof win.SS_IDIOMS.recommendBlockScaffold === 'function')
              ? win.SS_IDIOMS.recommendBlockScaffold(vit.rawText, scaffoldLang, ranks, savedStudyState.words, level)
              : null;
            var isEasyProse = (rec && rec.tier === 'pure_l2') || (!ranks && Math.max(wc, cjkUnits) <= 18);
            if (paraFes.length === 0 && isEasyProse && !hasSaved) {
              vit.trDiv.remove();
              pageModeState.ownedTranslations.delete(vit.block);
              continue;
            }
            if (rec && rec.tier === 'selective_i1' && paraFes.length > 0 && !hasSaved && vit.rawText.length <= 180) {
              for (var pf = 0; pf < Math.min(2, paraFes.length); pf++) {
                var pfe = paraFes[pf];
                var pLbl = pfe.display || pfe.surface || '';
                var pGl = pfe.meaning || '';
                if (!pLbl || !pGl) continue;
                var chip = makeEl(doc, 'span', {
                  'data-ss-i1-chip': '1',
                  title: pLbl + ': ' + pGl,
                  text: pLbl + ' → ' + pGl.slice(0, 34)
                });
                vit.block.appendChild(chip);
                pageModeState.ownedStudyChips.add(chip);
              }
              vit.trDiv.remove();
              pageModeState.ownedTranslations.delete(vit.block);
              continue;
            }
          }
          var runIds = [];
          batchPayload.push({ id: vit.id, rawText: vit.rawText, seedMap: vit.seedMap });
          if (!vit.replaceWhole && vit.inlineRuns.length >= 2) {
            for (var ri = 0; ri < vit.inlineRuns.length; ri++) {
              var rid = vit.id + '_r_' + ri;
              runIds.push(rid);
              batchPayload.push({ id: rid, rawText: vit.inlineRuns[ri].core, seedMap: {} });
            }
          }
          vit.runIds = runIds;
          activeItems.push(vit);
        }

        if (activeItems.length === 0) {
          pageModeState.inFlightBatches = Math.max(0, pageModeState.inFlightBatches - 1);
          pumpBatchQueue();
          return;
        }

        var mergedBatchGloss = [];
        var gSeen = Object.create(null);
        var pushGl = function (src, dst) {
          if (!src || !dst) return;
          var k = String(src).toLowerCase();
          if (gSeen[k]) return;
          gSeen[k] = 1;
          mergedBatchGloss.push({ src: src, dst: dst });
        };
        for (var [source, target] of glossaryPairs(cfg.glossary)) pushGl(source, target);
        if (feRes && Array.isArray(feRes.glossary)) {
          for (var gi0 = 0; gi0 < feRes.glossary.length; gi0++) pushGl(feRes.glossary[gi0].src, feRes.glossary[gi0].dst);
        }
        var domKeys = skipHints ? [] : Object.keys(domainEntityMap);
        for (var dk = 0; dk < domKeys.length; dk++) pushGl(domKeys[dk], domainEntityMap[domKeys[dk]]);

        var entChanged = false;
        function showTranslation(item, translated, resMap) {
          if (item.rendered || !item.trDiv.isConnected || pageModeState.sessionId !== sessionId) return;
          item.rendered = true;
          if (item.trDiv.hasAttribute('data-ss-search-tr') &&
              item.rawText.replace(/\s+/g, ' ').trim() === translated.replace(/\s+/g, ' ').trim()) {
            item.trDiv.remove();
            pageModeState.ownedTranslations.delete(item.block);
            return;
          }
          item.trDiv.removeAttribute('data-ss-loading');
          if (!skipHints) {
            var prevEntCount = Object.keys(domainEntityMap).length;
            extractDomainEntities(item.rawText, translated, domainEntityMap);
            if (Object.keys(domainEntityMap).length !== prevEntCount) entChanged = true;
          }
          item.trDiv.textContent = translated;
          item.block.setAttribute('data-ss-has-tr', '1');
          if (item.replaceWhole || item.inlineRuns.length === 1) {
            item.inlineRuns[0].tr = translated;
            inPlaceBlockMap.set(item.block, { runs: item.inlineRuns, whole: item.replaceWhole });
            inPlaceBlockList.push(item.block);
          } else if (item.runIds.length > 0 && item.runIds.every(function (rid) { return !!(resMap && resMap[rid]); })) {
            for (var k = 0; k < item.inlineRuns.length; k++) {
              item.inlineRuns[k].tr = resMap[item.runIds[k]];
            }
            inPlaceBlockMap.set(item.block, { runs: item.inlineRuns });
            inPlaceBlockList.push(item.block);
          }
          applyBlockDisplayMode(item.block, item.trDiv);
          var aidLang = blockReadingLanguage(item.block, item.rawText, scaffoldLang);
          translatedWebAidLang.set(item.block, aidLang);
          if (cfg.webDisplayMode === 'bilingual') {
            if (fastPage) {
              setTimeout(function () {
                if (item.trDiv.isConnected && pageModeState.sessionId === sessionId) scheduleWebBlockAids(item.block, aidLang);
              }, 0);
            } else scheduleWebBlockAids(item.block, aidLang);
          }
        }

        translateSegmentsBatch(batchPayload, {
          title: getDocTitle(),
          summary: pageModeState.summary,
          glossary: mergedBatchGloss,
          scene: 'webpage',
          onCached: function (id, text) {
            var item = activeItems.find(function (candidate) { return candidate.id === id; });
            if (!item || !item.trDiv.isConnected || pageModeState.sessionId !== sessionId) return;
            if (item.runIds.length === 0) showTranslation(item, text);
            else if (cfg.webDisplayMode === 'bilingual') {
              // Display the full sentence while its inline runs finish for translation-only mode.
              item.trDiv.textContent = text;
              item.trDiv.removeAttribute('data-ss-loading');
            }
          }
        }).then(function (resMap) {
          if (pageModeState.sessionId !== sessionId) return;
          pageModeState.inFlightBatches = Math.max(0, pageModeState.inFlightBatches - 1);

          for (var j = 0; j < activeItems.length; j++) {
            var it = activeItems[j];
            if (it.rendered || !it.trDiv.isConnected) continue;
            var translated = resMap && resMap[it.id];
            if (translated) {
              showTranslation(it, translated, resMap);
            } else {
              if (it.trDiv.parentNode) it.trDiv.parentNode.removeChild(it.trDiv);
              pageModeState.ownedTranslations.delete(it.block);
            }
          }
          if (entChanged) persistDomainEntityCache();
          pumpBatchQueue();
        });
      });
    }

    function enqueueVisibleBlock(block) {
      if (!block || pageModeState.translatedSet.has(block)) return;
      pageModeState.translatedSet.add(block);
      var inViewport = false;
      if (!pageModeState.fastFeed && typeof block.getBoundingClientRect === 'function') {
        try {
          var rect = block.getBoundingClientRect();
          var vh = win.innerHeight || 800;
          if (rect && rect.bottom >= -40 && rect.top <= vh + 140) inViewport = true;
        } catch (_er) {}
      }
      if (inViewport) pageModeState.queue.unshift(block);
      else pageModeState.queue.push(block);
      if (!pageModeState.flushTimer) {
        pageModeState.flushTimer = setTimeout(function () {
          pageModeState.flushTimer = null;
          pumpBatchQueue();
        }, pageModeState.fastFeed || pageModeState.fastSearch ? 0 : 45);
      }
    }

    function isOurInjectedNode(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.hasAttribute('data-ss-page-tr') || node.hasAttribute('data-ss-select') ||
          node.hasAttribute('data-ss-fab') || node.hasAttribute('data-ss-input-preview') ||
          node.hasAttribute('data-ss-toast') || node.hasAttribute('data-ss-picker') || node.hasAttribute('data-ss-web-aid') ||
          node.hasAttribute('data-ss-i1-chip') ||
          node.id === PAGE_INJECT_STYLE_ID) {
        return true;
      }
      return Boolean(safeClosest(node, '[data-ss-page-tr], [data-ss-select], [data-ss-input-preview], [data-ss-toast], [data-ss-picker]'));
    }

    /* ----------------------------------------------------------------------
     * Feature 6: Visual On-Page DOM CSS Rule Picker (Alt+S / Popup Trigger)
     * ---------------------------------------------------------------------- */
    var pickerState = {
      active: false,
      host: null,
      boxEl: null,
      codeEl: null,
      metaEl: null,
      baseTarget: null,
      ancestorOffset: 0,
      currentSelector: ''
    };

    function currentTargetForPicker() {
      var cur = pickerState.baseTarget;
      var steps = pickerState.ancestorOffset;
      while (cur && steps > 0 && cur.parentElement &&
             cur.parentElement !== doc.body && cur.parentElement !== doc.documentElement) {
        cur = cur.parentElement;
        steps--;
      }
      return cur;
    }

    function countMatchesSafe(selector) {
      if (!selector || !doc.querySelectorAll) return 0;
      try { return doc.querySelectorAll(selector).length; } catch (_e) { return 0; }
    }

    function refreshPickerOverlay() {
      if (!pickerState.active || !pickerState.boxEl) return;
      var el = currentTargetForPicker();
      if (!el || typeof el.getBoundingClientRect !== 'function') {
        pickerState.boxEl.style.display = 'none';
        pickerState.currentSelector = '';
        if (pickerState.codeEl) pickerState.codeEl.textContent = 'Hover any block on this page…';
        if (pickerState.metaEl) pickerState.metaEl.textContent = 'Move pointer to inspect';
        return;
      }
      var r = el.getBoundingClientRect();
      pickerState.boxEl.style.display = 'block';
      pickerState.boxEl.style.left = Math.round(r.left) + 'px';
      pickerState.boxEl.style.top = Math.round(r.top) + 'px';
      pickerState.boxEl.style.width = Math.max(8, Math.round(r.width)) + 'px';
      pickerState.boxEl.style.height = Math.max(8, Math.round(r.height)) + 'px';

      var sel = buildStableCssSelector(el, 2);
      pickerState.currentSelector = sel;
      var cnt = countMatchesSafe(sel);
      if (pickerState.codeEl) pickerState.codeEl.textContent = sel;
      if (pickerState.metaEl) pickerState.metaEl.textContent = cnt + ' match' + (cnt === 1 ? '' : 'es') + ' · [ ↑ / ] ↓ depth';
    }

    function saveDomainSiteRule(kind, selector) {
      var host = (win.location && win.location.hostname) ? win.location.hostname : 'default';
      if (!cfg.siteRules || typeof cfg.siteRules !== 'object' || Array.isArray(cfg.siteRules)) {
        cfg.siteRules = {};
      }
      if (kind === 'reset') {
        delete cfg.siteRules[host];
      } else if (selector) {
        var cur = cfg.siteRules[host] && typeof cfg.siteRules[host] === 'object'
          ? cfg.siteRules[host]
          : { include: '', exclude: '' };
        var prevList = String(cur[kind] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (prevList.indexOf(selector) === -1) prevList.push(selector);
        cur[kind] = prevList.join(', ');
        cfg.siteRules[host] = cur;
      }
      if (ch && ch.storage && ch.storage.local && typeof ch.storage.local.get === 'function') {
        try {
          ch.storage.local.get(['ss_set'], function (res) {
            var sObj = (res && res.ss_set && typeof res.ss_set === 'object') ? res.ss_set : {};
            sObj.siteRules = cfg.siteRules;
            ch.storage.local.set({ ss_set: sObj });
          });
        } catch (_e) {}
      }
    }

    function stopVisualRulePicker() {
      pickerState.active = false;
      pickerState.baseTarget = null;
      pickerState.ancestorOffset = 0;
      if (pickerState.host && pickerState.host.parentNode) {
        pickerState.host.parentNode.removeChild(pickerState.host);
      }
      pickerState.host = null;
      pickerState.boxEl = null;
      pickerState.codeEl = null;
      pickerState.metaEl = null;
    }

    function startVisualRulePicker() {
      if (pickerState.active) {
        stopVisualRulePicker();
        showToast('Phrasebound · Rule Picker closed');
        return;
      }
      if (!doc.body) return;
      closeSelectionPopup();
      pickerState.active = true;
      pickerState.ancestorOffset = 0;

      var host = makeEl(doc, 'div', { 'data-ss-picker': '1' });
      var sr = host.attachShadow({ mode: 'open' });
      var st = makeEl(doc, 'style', { text: RULE_PICKER_CSS });
      var boxEl = makeEl(doc, 'div', { className: 'ss-pk-box', style: { display: 'none' } });
      var codeEl = makeEl(doc, 'div', { className: 'ss-pk-code', text: 'Hover any element on this page…' });
      var metaEl = makeEl(doc, 'span', { className: 'ss-pk-meta', text: 'Click a page element to lock selection' });

      var btnUp = makeEl(doc, 'button', {
        type: 'button', className: 'ss-pk-btn', text: '↑ Parent',
        onClick: function () { pickerState.ancestorOffset = Math.min(8, pickerState.ancestorOffset + 1); refreshPickerOverlay(); }
      });
      var btnDown = makeEl(doc, 'button', {
        type: 'button', className: 'ss-pk-btn', text: '↓ Child',
        onClick: function () { pickerState.ancestorOffset = Math.max(0, pickerState.ancestorOffset - 1); refreshPickerOverlay(); }
      });
      var btnExclude = makeEl(doc, 'button', {
        type: 'button', className: 'ss-pk-btn ss-pk-exc', text: 'Keep Original (Exclude)',
        onClick: function () {
          if (!pickerState.currentSelector) return;
          saveDomainSiteRule('exclude', pickerState.currentSelector);
          showToast('Saved Keep-Original: ' + pickerState.currentSelector);
          stopVisualRulePicker();
        }
      });
      var btnInclude = makeEl(doc, 'button', {
        type: 'button', className: 'ss-pk-btn ss-pk-inc', text: 'Force Translate (Include)',
        onClick: function () {
          if (!pickerState.currentSelector) return;
          saveDomainSiteRule('include', pickerState.currentSelector);
          showToast('Saved Force-Translate: ' + pickerState.currentSelector);
          stopVisualRulePicker();
        }
      });
      var btnReset = makeEl(doc, 'button', {
        type: 'button', className: 'ss-pk-btn', text: 'Reset Site',
        onClick: function () {
          saveDomainSiteRule('reset', '');
          showToast('Cleared custom rules for this domain');
          stopVisualRulePicker();
        }
      });
      var btnCancel = makeEl(doc, 'button', {
        type: 'button', className: 'ss-pk-btn', text: '✕ Esc',
        onClick: stopVisualRulePicker
      });

      var hud = makeEl(doc, 'div', { className: 'ss-pk-hud' }, [
        makeEl(doc, 'div', { className: 'ss-pk-top' }, [
          makeEl(doc, 'span', { className: 'ss-pk-title', text: 'Site Translation Rule Picker (' + ((win.location && win.location.hostname) || 'local') + ')' }),
          metaEl
        ]),
        codeEl,
        makeEl(doc, 'div', { className: 'ss-pk-btns' }, [btnUp, btnDown, btnExclude, btnInclude, btnReset, btnCancel])
      ]);

      sr.appendChild(st);
      sr.appendChild(boxEl);
      sr.appendChild(hud);
      doc.body.appendChild(host);

      pickerState.host = host;
      pickerState.boxEl = boxEl;
      pickerState.codeEl = codeEl;
      pickerState.metaEl = metaEl;
    }

    doc.addEventListener('mousemove', function (ev) {
      if (!pickerState.active || pickerState.locked) return;
      var t = ev.target;
      if (!t || t.nodeType !== 1 || t === pickerState.host || safeClosest(t, UI_IGNORE_SELECTOR)) return;
      if (t !== pickerState.baseTarget) {
        pickerState.baseTarget = t;
        pickerState.ancestorOffset = 0;
        refreshPickerOverlay();
      }
    }, { passive: true, capture: true });

    doc.addEventListener('click', function (ev) {
      if (!pickerState.active) return;
      var path = typeof ev.composedPath === 'function' ? ev.composedPath() : [ev.target];
      for (var i = 0; i < path.length; i++) {
        if (path[i] === pickerState.host) return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      pickerState.locked = !pickerState.locked;
      if (pickerState.metaEl && pickerState.locked) {
        pickerState.metaEl.textContent = 'Locked · Choose Keep Original or Force Translate';
      } else {
        refreshPickerOverlay();
      }
    }, true);

    function pageTranslationRoots(scope) {
      if (scope !== 'article') return [doc.body];
      var found = Array.prototype.slice.call(doc.querySelectorAll(ARTICLE_ROOT_SELECTOR));
      var articles = found.filter(function (el) { return safeMatches(el, 'article, .post-content, .article-body'); });
      var candidates = articles.length ? articles : found;
      if (!candidates.length) return [doc.body];
      return candidates.filter(function (el) {
        return !candidates.some(function (outer) { return outer !== el && outer.contains(el); });
      });
    }

    function startPageBilingualMode(targetMode, opts) {
      var o = opts || {};
      var effMode = targetMode === 'smart_i1' ? 'full' : targetMode;
      if (o.synchronize && !o.refresh && pageModeState.mode === effMode && pageModeState.smartI1 === (targetMode === 'smart_i1')) return;
      if (!o.synchronize && pageModeState.mode === effMode) {
        sessionDismissedHost = getHostKey();
        teardownPageBilingual(true);
        showToast('Phrasebound · Page Bilingual OFF');
        return;
      }

      teardownPageBilingual(true, true);
      if (!doc.body) return;

      pageModeState.mode = effMode;
      pageModeState.smartI1 = targetMode === 'smart_i1';
      var fastFeed = !pageModeState.smartI1 && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(getHostKey());
      pageModeState.fastFeed = fastFeed;
      pageModeState.fastSearch = !pageModeState.smartI1 && isGoogleSearch();
      pageModeState.autoStarted = !!o.autoStarted;
      pageModeState.detectedLang = o.detectedLang || '';
      publishEmbeddedScope(effMode === 'full' ? targetMode : null);
      syncFloatingFab();
      var sessionId = pageModeState.sessionId;
      var rules = resolveActiveSiteRules();

      var roots = pageTranslationRoots(effMode);
      pageModeState.roots = roots;
      pageModeState.summary = fastFeed || pageModeState.fastSearch ? '' : computePageSummary(roots);

      var IO = win.IntersectionObserver || (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : null);
      var io = IO ? new IO(function (entries) {
        if (pageModeState.sessionId !== sessionId) return;
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            io.unobserve(entry.target);
            enqueueVisibleBlock(entry.target);
          }
        }
      }, { rootMargin: fastFeed ? '250px 0px ' + Math.max(900, win.innerHeight) + 'px' : '900px 0px' }) : null;
      pageModeState.io = io;

      var observedRoots = new WeakSet();
      var mo = null;
      var observation = { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'inert'] };
      if (fastFeed) observation.characterData = true;
      function observeRoot(scope) {
        if (!mo || observedRoots.has(scope)) return;
        observedRoots.add(scope);
        mo.observe(scope, observation);
      }
      function withinPageRoots(node) {
        for (var current = node; current; current = current.getRootNode?.().host) {
          if (roots.some(function (scope) { return scope.contains(current); })) return true;
        }
        return false;
      }
      function observeBlocksInSubtree(subtreeRoot) {
        var blocks = collectTranslatableBlocks(subtreeRoot, rules, observeRoot);
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          // The feed can reuse an existing post element for different text.
          var source = pageModeState.feedSources.get(b);
          const rec = inPlaceBlockMap.get(b);
          const replaced = b.hasAttribute('data-ss-inplace');
          const changed = source && (replaced && rec
            ? rec.runs.some(r => !b.contains(r.tn) || r.tn.nodeValue !== r.lead + r.tr + r.trail)
            : extractBlockWithPlaceholders(b).text !== source);
          if (changed) {
            if (replaced && rec) {
              for (const r of rec.runs) {
                if (b.contains(r.tn) && r.tn.nodeValue === r.lead + r.tr + r.trail) r.tn.nodeValue = r.orig;
              }
            }
            b.removeAttribute('data-ss-inplace');
            pageModeState.ownedTranslations.get(b)?.remove();
            pageModeState.ownedTranslations.delete(b);
            pageModeState.feedSources.delete(b);
            pageModeState.observedSet.delete(b);
            pageModeState.translatedSet.delete(b);
            inPlaceBlockMap.delete(b);
            b.removeAttribute('data-ss-has-tr');
          }
          if (!pageModeState.observedSet.has(b)) {
            pageModeState.observedSet.add(b);
            if (io) io.observe(b);
            else enqueueVisibleBlock(b);
          }
        }
      }

      // Revisit content revealed by a dialog, disclosure, or overlay after translation starts.
      var MO = win.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (MO) {
        var pendingSubtrees = new Set();
        var removedBlocks = false;
        var moDebounce = null;
        mo = new MO(function (mutations) {
          if (pageModeState.sessionId !== sessionId) return;
          for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (isOurInjectedNode(m.target)) continue;
            if (m.type === 'attributes') pendingSubtrees.add(m.target);
            if (fastFeed) {
              var post = safeClosest(m.target, FEED_POST_SELECTOR);
              if (post) pendingSubtrees.add(post);
            }
            for (var removed of m.removedNodes || []) {
              if (removed.nodeType === 1 && !isOurInjectedNode(removed)) removedBlocks = true;
            }
            var added = m.addedNodes || [];
            for (var j = 0; j < added.length; j++) {
              var n = added[j];
              if (n.nodeType !== 1) continue;
              if (isOurInjectedNode(n)) continue;
              pendingSubtrees.add(n);
            }
          }
          if (!pendingSubtrees.size && !removedBlocks) return;
          if (moDebounce) clearTimeout(moDebounce);
          moDebounce = setTimeout(function () {
            moDebounce = null;
            if (pageModeState.sessionId !== sessionId) return;
            var batch = Array.from(pendingSubtrees);
            pendingSubtrees.clear();
            if (removedBlocks) {
              removedBlocks = false;
              pageModeState.ownedTranslations.forEach(function (translation, owner) {
                if (owner.isConnected) return;
                translation.remove();
                pageModeState.ownedTranslations.delete(owner);
                pageModeState.io?.unobserve(owner);
                pageModeState.observedSet.delete(owner);
                pageModeState.translatedSet.delete(owner);
              });
              pageModeState.ownedStudyChips.forEach(function (chip) {
                if (!chip.isConnected) pageModeState.ownedStudyChips.delete(chip);
              });
            }
            var previous = roots;
            roots = pageTranslationRoots(effMode);
            pageModeState.roots = roots;
            var fresh = roots.filter(function (root) { return previous.indexOf(root) < 0; });
            if (fresh.length) {
              pageModeState.summary = fastFeed || pageModeState.fastSearch ? '' : computePageSummary(roots);
              fresh.forEach(observeBlocksInSubtree);
            }
            for (var k = 0; k < batch.length; k++) {
              var subtree = batch[k];
              if (subtree.isConnected && withinPageRoots(subtree)) observeBlocksInSubtree(subtree);
            }
          }, fastFeed ? 0 : 160);
        });
        pageModeState.mo = mo;

        observeRoot(doc.body);
      }
      roots.forEach(observeBlocksInSubtree);

      if (!o.silentToast) {
        showToast(targetMode === 'article'
          ? 'Subtitle Study · Article Bilingual ON'
          : (targetMode === 'smart_i1' ? 'Phrasebound · Smart Learner Mode ON' : 'Subtitle Study · Full-Page Bilingual ON'));
      }
    }

    /* ----------------------------------------------------------------------
     * Feature 5: Tab-to-Accept Input-Box Translation Preview
     * ---------------------------------------------------------------------- */
    var inputPreviewState = {
      host: null,
      targetInput: null,
      reqId: 0,
      readyTranslation: null,
      replaceRange: null,
      committing: false
    };

    function isSupportedTextInput(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'textarea') return !el.readOnly && !el.disabled;
      if (tag === 'input') {
        var t = (el.getAttribute('type') || el.type || 'text').toLowerCase();
        return t === 'text' && !el.readOnly && !el.disabled;
      }
      return false;
    }

    function dismissInputPreview() {
      inputPreviewState.reqId++;
      inputPreviewState.readyTranslation = null;
      inputPreviewState.targetInput = null;
      inputPreviewState.replaceRange = null;
      if (inputPreviewState.host && inputPreviewState.host.parentNode) {
        inputPreviewState.host.parentNode.removeChild(inputPreviewState.host);
      }
      inputPreviewState.host = null;
    }

    function commitInputTranslation() {
      var el = inputPreviewState.targetInput;
      var tr = inputPreviewState.readyTranslation;
      if (!el || typeof tr !== 'string' || !tr) return false;

      var nextVal = tr;
      var range = inputPreviewState.replaceRange;
      if (range && typeof range.start === 'number' && typeof range.end === 'number') {
        var cur = el.value || '';
        nextVal = cur.slice(0, range.start) + tr + cur.slice(range.end);
      }

      inputPreviewState.committing = true;
      try {
        var proto = (el.tagName || '').toLowerCase() === 'textarea'
          ? win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype
          : win.HTMLInputElement && win.HTMLInputElement.prototype;
        var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
          desc.set.call(el, nextVal);
        } else {
          el.value = nextVal;
        }
        if (typeof el.setSelectionRange === 'function') {
          var caret = range ? (range.start + tr.length) : nextVal.length;
          el.setSelectionRange(caret, caret);
        }
        var EvCtor = win.Event || Event;
        el.dispatchEvent(new EvCtor('input', { bubbles: true }));
      } finally {
        inputPreviewState.committing = false;
        dismissInputPreview();
      }
      return true;
    }

    function triggerInputPreview(inputEl, viaSlashCommand) {
      if (!isSupportedTextInput(inputEl) || !doc.body) return;
      var fullVal = inputEl.value || '';
      var srcText = '';
      var replaceRange = null;

      if (viaSlashCommand) {
        srcText = fullVal.replace(/(?:\/\/tr\s*| {3})$/, '').trim();
        replaceRange = null;
      } else if (typeof inputEl.selectionStart === 'number' &&
                 typeof inputEl.selectionEnd === 'number' &&
                 inputEl.selectionEnd > inputEl.selectionStart) {
        srcText = fullVal.slice(inputEl.selectionStart, inputEl.selectionEnd).trim();
        replaceRange = { start: inputEl.selectionStart, end: inputEl.selectionEnd };
      } else {
        srcText = fullVal.replace(/(?:\/\/tr\s*| {3})$/, '').trim();
      }

      if (!srcText) {
        dismissInputPreview();
        return;
      }

      dismissInputPreview();
      var reqId = ++inputPreviewState.reqId;
      inputPreviewState.targetInput = inputEl;
      inputPreviewState.replaceRange = replaceRange;

      var host = makeEl(doc, 'div', { 'data-ss-input-preview': '1' });
      var shadow = host.attachShadow({ mode: 'open' });
      var st = makeEl(doc, 'style', { text: INPUT_PREVIEW_CSS });
      var trLine = makeEl(doc, 'div', { className: 'ss-ip-text', text: 'Translating…' });
      var hintLine = makeEl(doc, 'div', {
        className: 'ss-ip-hint',
        text: 'Press Tab to replace · Esc to dismiss'
      });
      var chip = makeEl(doc, 'div', { className: 'ss-ip-chip' }, [trLine, hintLine]);
      shadow.appendChild(st);
      shadow.appendChild(chip);
      doc.body.appendChild(host);
      inputPreviewState.host = host;

      var inputRect = typeof inputEl.getBoundingClientRect === 'function'
        ? inputEl.getBoundingClientRect()
        : { left: 20, right: 220, top: 20, bottom: 48, width: 200, height: 28 };
      positionFloatingHost(host, inputRect);

      translateSingleText(srcText, { title: getDocTitle(), scene: 'input' }).then(function (res) {
        if (inputPreviewState.reqId !== reqId) return;
        if (res.ok && res.text) {
          inputPreviewState.readyTranslation = res.text;
          trLine.textContent = res.text;
        } else {
          trLine.textContent = res.error || 'Translation unavailable';
        }
        positionFloatingHost(host, inputRect);
      });
    }

    doc.addEventListener('input', function (ev) {
      if (inputPreviewState.committing) return;
      var t = ev.target;
      if (!isSupportedTextInput(t)) return;
      var val = t.value || '';
      if (val.slice(-5) === '//tr ' || (cfg.inputTripleSpace !== false && val.slice(-3) === '   ' && val.trim().length >= 3)) {
        triggerInputPreview(t, true);
      } else if (inputPreviewState.host && inputPreviewState.targetInput === t) {
        dismissInputPreview();
      }
    }, true);

    doc.addEventListener('focusout', function (ev) {
      if (inputPreviewState.host && ev.target === inputPreviewState.targetInput) {
        setTimeout(function () {
          if (doc.activeElement !== inputPreviewState.targetInput) {
            dismissInputPreview();
          }
        }, 120);
      }
    }, true);


    /* ----------------------------------------------------------------------
     * Feature 7: Yomitan-Style Shift-Hover Zero-Selection Point Lookup
     * ---------------------------------------------------------------------- */
    var shiftHoverTimer = null;
    var lastShiftPointKey = '';

    function resolveCaretAtPoint(clientX, clientY) {
      if (typeof doc.caretPositionFromPoint === 'function') {
        try {
          var pos = doc.caretPositionFromPoint(clientX, clientY);
          if (pos && pos.offsetNode && pos.offsetNode.nodeType === 3) {
            return { node: pos.offsetNode, offset: pos.offset };
          }
        } catch (_e) {}
      }
      if (typeof doc.caretRangeFromPoint === 'function') {
        try {
          var rng = doc.caretRangeFromPoint(clientX, clientY);
          if (rng && rng.startContainer && rng.startContainer.nodeType === 3) {
            return { node: rng.startContainer, offset: rng.startOffset };
          }
        } catch (_e2) {}
      }
      return null;
    }

    // Paint DOM ranges so underlining does not move or replace the site's text nodes.
    let rareScan = null;
    function syncRareWords() {
      if (!win.CSS?.highlights || !win.Highlight || !win.IntersectionObserver || !doc.body) return;
      const settingsKey = JSON.stringify([cfg.webRareWords,cfg.vocabLevel,cfg.vocabLevelsByLang,cfg.tl]);
      if (rareScan?.key === settingsKey && rareScan.words === savedStudyState.words) return;
      rareScan?.stop();
      rareScan = null;
      if (!cfg.webRareWords) return;
      const selector = PAGE_BLOCK_SELECTOR;
      const ignore = UI_IGNORE_SELECTOR + ',#ss-ov,nav,header,footer,button,input,textarea,select,pre,code,rt,script,style,[contenteditable]:not([contenteditable="false"])';
      const paint = new win.Highlight();
      const byNode = new WeakMap();
      const visible = new Map();
      let stopped = false;
      win.CSS.highlights.set('ss-rare-word',paint);
      ensurePageStyleInjected();
      function clear(state) {
        for (const hit of state.hits) {
          paint.delete(hit.range);
          byNode.delete(hit.range.startContainer);
        }
        state.hits = [];
      }
      async function scan(block,state) {
        const version = ++state.version;
        clear(state);
        const walker = doc.createTreeWalker(block,win.NodeFilter.SHOW_TEXT);
        for (let node=walker.nextNode(); node; node=walker.nextNode()) {
          const el = node.parentElement;
          if (!el || el.closest(ignore) || el.closest(selector)!==block || !/\p{L}/u.test(node.data)) continue;
          const lang = el.closest('[data-ss-inplace]') ? normWebReadLang(cfg.tl)
            : blockReadingLanguage(el,node.data,pageModeState.detectedLang,true);
          const ranks = await ensureWebRanks(lang);
          if (stopped || visible.get(block)!==state || version!==state.version) return;
          if (!ranks || !node.isConnected || !block.contains(node)) continue;
          const language = win.SS_LANG?.get(lang);
          if (!language) continue;
          const level = win.SS_STORE?.getLangVocabLevel(cfg,lang) || cfg.vocabLevel;
          const hits = [];
          let offset = 0;
          for (const token of language.split(node.data)) {
            const start = offset;
            offset += token.w.length;
            if (!token.word || !/\p{L}/u.test(token.w)) continue;
            const word = token.w.toLowerCase();
            const lemma = language.lemma(word) || word;
            const rank = ranks[lemma] || ranks[word];
            if (!(rank > level)) continue;
            const words = savedStudyState.words;
            if ([word,lemma].some(k => (words[lang+'|'+k] ?? words[k]) === 'known')) continue;
            const range = doc.createRange();
            range.setStart(node,start);
            range.setEnd(node,offset);
            const hit = {range,lang,lemma};
            hits.push(hit);
            state.hits.push(hit);
            paint.add(range);
          }
          if (hits.length) byNode.set(node,hits);
        }
      }
      const viewport = new win.IntersectionObserver(entries=>{
        for (const {target,isIntersecting} of entries) {
          const previous = visible.get(target);
          if (previous) clear(previous);
          visible.delete(target);
          if (isIntersecting && target.isConnected) {
            const state = {version:0,hits:[]};
            visible.set(target,state);
            scan(target,state);
          }
        }
      },{rootMargin:'100px'});
      function observe(el) {
        if (el.closest(ignore)) return;
        if (el.matches(selector)) viewport.observe(el);
        el.querySelectorAll(selector).forEach(n=>{if(!n.closest(ignore)) viewport.observe(n);});
      }
      const changes = new win.MutationObserver(records=>{
        const dirty = new Set();
        for (const rec of records) {
          const el = rec.target.nodeType===1 ? rec.target : rec.target.parentElement;
          if (!el || el.closest(ignore)) continue;
          dirty.add(el.closest(selector));
          for (const added of rec.addedNodes) if (added.nodeType===1) observe(added);
        }
        for (const block of dirty) if (visible.has(block)) scan(block,visible.get(block));
        for (const [block,state] of visible) if (!block.isConnected) {
          clear(state); visible.delete(block); viewport.unobserve(block);
        }
      });
      rareScan = {key:settingsKey,words:savedStudyState.words,byNode,stop(){
        stopped=true;viewport.disconnect();changes.disconnect();win.CSS.highlights.delete('ss-rare-word');
      }};
      observe(doc.body);
      changes.observe(doc.body,{childList:true,characterData:true,subtree:true});
    }

    function hoverRareWord(x,y) {
      if (!rareScan || pickerState.active || !win.getSelection()?.isCollapsed) return;
      const caret = resolveCaretAtPoint(x,y);
      for (const hit of rareScan.byNode.get(caret?.node) || []) {
        const rect = [...hit.range.getClientRects()].find(r => x>=r.left && x<=r.right && y>=r.top && y<=r.bottom);
        if (!rect) continue;
        const term = hit.range.toString();
        if (!term || (popupState.host && popupState.scanNode===caret.node && popupState.selectedText===term)) return;
        const line = caret.node.parentElement?.closest(PAGE_BLOCK_SELECTOR)?.textContent || term;
        openSelectionPopup(term,line.trim().slice(0,500),rect,false,null,{lang:hit.lang,canonical:hit.lemma,node:caret.node});
        return;
      }
    }

    function runShiftPointLookup(clientX, clientY) {
      if (!cfg.shiftHoverScan || pickerState.active) return;
      var sel = win.getSelection ? win.getSelection() : null;
      if (sel && !sel.isCollapsed) return;

      var hit = resolveCaretAtPoint(clientX, clientY);
      if (!hit || !hit.node || !hit.node.parentElement) return;
      if (isEditableElement(hit.node.parentElement) || safeClosest(hit.node.parentElement, UI_IGNORE_SELECTOR)) return;

      var rawNodeText = hit.node.nodeValue || '';
      var blk = safeClosest(hit.node.parentElement, 'p, li, blockquote, td, h1, h2, h3, div') || hit.node.parentElement;
      var lineCtx = ((blk && blk.textContent) || rawNodeText).replace(/\s+/g, ' ').trim().slice(0, 280);
      var lang = blockReadingLanguage(hit.node.parentElement, lineCtx, pageModeState.detectedLang, true);
      var scan = scanPointTextWindow(rawNodeText, hit.offset, lang, cfg.tl);
      if (!scan || !scan.surface) return;
      if (!lineCtx.includes(scan.surface)) lineCtx = rawNodeText.slice(Math.max(0, scan.start - 90), scan.end + 150).trim();

      var pointKey = scan.surface + '@' + scan.start;
      if (popupState.host && lastShiftPointKey === pointKey && popupState.scanNode === hit.node) return;
      lastShiftPointKey = pointKey;

      var rect = { left: clientX, right: clientX + 16, top: clientY - 8, bottom: clientY + 12, width: 16, height: 20 };
      if (typeof doc.createRange === 'function') {
        try {
          var r = doc.createRange();
          r.setStart(hit.node, Math.max(0, scan.start));
          r.setEnd(hit.node, Math.min(rawNodeText.length, scan.end));
          var rr = r.getBoundingClientRect();
          if (rr && (rr.width > 0 || rr.height > 0)) rect = rr;
        } catch (_e3) {}
      }

      openSelectionPopup(scan.surface, lineCtx, rect, false, null, { ...scan, lang, node: hit.node });
    }

    doc.addEventListener('mousemove', function (ev) {
      lastMouseX = ev.clientX || 0;
      lastMouseY = ev.clientY || 0;
      if (shiftHoverTimer) clearTimeout(shiftHoverTimer);
      if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.buttons || eventTouchesPopup(ev) || eventTouchesIgnoredUI(ev)) return;
      if (!ev.shiftKey) {
        if (rareScan && rareScan.byNode.has(resolveCaretAtPoint(ev.clientX,ev.clientY)?.node)) {
          const {clientX,clientY}=ev;
          shiftHoverTimer=setTimeout(()=>hoverRareWord(clientX,clientY),240);
        }
        return;
      }
      if (!cfg.shiftHoverScan) return;
      var cx = ev.clientX;
      var cy = ev.clientY;
      if (shiftHoverTimer) clearTimeout(shiftHoverTimer);
      shiftHoverTimer = setTimeout(function () {
        shiftHoverTimer = null;
        runShiftPointLookup(cx, cy);
      }, 85);
    }, { passive: true, capture: true });

    /* ----------------------------------------------------------------------
     * Feature 8: Bidirectional i+1 Web Immersion (Saved-FE Glow, L2 Gloss, L1->L2 Weave & 1-Click Known)
     * ---------------------------------------------------------------------- */
    function collectCleanTextNodes(rootEl, maxNodes) {
      var out = [];
      if (!rootEl || !doc.createTreeWalker) return out;
      var limit = maxNodes || 450;
      var tw = doc.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */, null);
      var n;
      while ((n = tw.nextNode()) && out.length < limit) {
        var p = n.parentElement;
        if (!p) continue;
        if (isEditableElement(p) || safeClosest(p, DEFAULT_EXCLUDE_SELECTOR) || safeClosest(p, '[data-ss-saved-hl], [data-ss-weave], [data-ss-i1-chip]')) continue;
        if ((n.nodeValue || '').trim().length >= 3) out.push(n);
      }
      return out;
    }

    function runSavedWordbookGlow() {
      if (!doc.body) return 0;
      ensurePageStyleInjected();
      var targets = [];
      var seen = Object.create(null);
      for (var i = 0; i < savedStudyState.items.length; i++) {
        var it = savedStudyState.items[i];
        var w = String((it && it.word) || '').trim();
        if (w.length < 2 || w.length > 48) continue;
        var low = w.toLowerCase();
        var lg = String(it.lang || 'en').toLowerCase().split('-')[0];
        if (savedStudyState.words[lg + '|' + low] === 'known' || savedStudyState.words[low] === 'known') continue;
        if (seen[low]) continue;
        seen[low] = 1;
        var isDueFsrs = !!it.id && cfg.incidentalFsrs && root.SS_STORE && root.SS_STORE.isRecallDue(it, cfg.fsrsRetention);
        targets.push({ word: w, lemma: low, def: it.def || it.trans || '', isDue: isDueFsrs, id: it.id });
      }
      if (targets.length === 0) return 0;
      targets.sort(function (a, b) { return b.word.length - a.word.length; });

      var textNodes = collectCleanTextNodes(doc.body, 320);
      var count = 0;
      for (var tnIdx = 0; tnIdx < textNodes.length && count < 60; tnIdx++) {
        var tn = textNodes[tnIdx];
        var val = tn.nodeValue || '';
        for (var t = 0; t < targets.length; t++) {
          var tg = targets[t];
          var esc = tg.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          var isCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(tg.word);
          var re = isCjk ? new RegExp(esc, 'i') : new RegExp('(^|[^\\p{L}\\p{N}])(' + esc + ')(?=$|[^\\p{L}\\p{N}])', 'iu');
          var m = re.exec(val);
          if (!m) continue;
          var s0 = isCjk ? m.index : (m.index + m[1].length);
          var matchedStr = isCjk ? m[0] : m[2];
          var s1 = s0 + matchedStr.length;

          var frag = doc.createDocumentFragment();
          if (s0 > 0) frag.appendChild(doc.createTextNode(val.slice(0, s0)));
          var span = makeEl(doc, 'span', {
            'data-ss-saved-hl': '1',
            'data-ss-card-id': tg.id,
            'data-ss-due-fsrs': tg.isDue ? '1' : null,
            'data-ss-lemma': tg.lemma,
            'data-ss-orig-text': matchedStr,
            title: tg.isDue
              ? 'Due for recall · click to check the meaning and rate your recall'
              : ((tg.def ? (tg.word + ' — ' + tg.def + ' · ') : '') + 'Click to inspect · Click ✓ to retire as Known')
          }, [matchedStr]);
          span.addEventListener('click', (function (surf, ctxVal, spanRef, cardId) {
            return function (ev) {
              ev.stopPropagation();
              var item = savedStudyState.items.find(function (it) { return String(it.id) === String(cardId); });
              var due = item && cfg.incidentalFsrs && root.SS_STORE && root.SS_STORE.isRecallDue(item, cfg.fsrsRetention);
              openSelectionPopup(surf, ctxVal, spanRef.getBoundingClientRect(), false, due ? item : null);
            };
          })(matchedStr, val, span, tg.id));
          var retireBtn = makeEl(doc, 'span', {
            'data-ss-retire-btn': '1',
            title: 'Mark as Known',
            text: '✓'
          });
          retireBtn.addEventListener('click', (function (lem, surf) {
            return function (ev) {
              ev.stopPropagation();
              persistWordStatus(surf, 'known');
              retireKnownOnPage(lem);
              showToast('Marked Known: ' + surf);
            };
          })(tg.lemma, matchedStr));
          span.appendChild(retireBtn);
          frag.appendChild(span);
          if (s1 < val.length) frag.appendChild(doc.createTextNode(val.slice(s1)));
          if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
          count++;
          break;
        }
      }
      return count;
    }

    function clearIPlusOneDecorations() {
      if (!doc.querySelectorAll) return;
      var chips = doc.querySelectorAll('[data-ss-i1-chip="1"]');
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].parentNode) chips[i].parentNode.removeChild(chips[i]);
      }
      var weaves = doc.querySelectorAll('[data-ss-weave="1"]');
      for (var j = 0; j < weaves.length; j++) {
        var w = weaves[j];
        var orig = w.getAttribute('data-ss-orig-text') || w.textContent;
        if (w.parentNode) w.parentNode.replaceChild(doc.createTextNode(orig), w);
      }
    }

    function toggleSelectiveIPlusOneGloss() {
      ensurePageStyleInjected();
      if (cfg.webIPlusOneMode === 'l2_gloss') {
        cfg.webIPlusOneMode = 'off';
        clearIPlusOneDecorations();
        showToast('Phrasebound · Selective i+1 Gloss OFF');
        return;
      }
      clearIPlusOneDecorations();
      cfg.webIPlusOneMode = 'l2_gloss';
      var blocks = collectTranslatableBlocks(doc.body, resolveActiveSiteRules()).slice(0, 80);
      var added = 0;
      for (var i = 0; i < blocks.length && added < 45; i++) {
        var b = blocks[i];
        var txt = (b.textContent || '').trim();
        if (txt.length < 15) continue;
        var hits = findIdiomMatches(txt);
        for (var h = 0; h < Math.min(2, hits.length); h++) {
          var hit = hits[h];
          var label = hit.canonical || hit.phrase || hit.match || '';
          var gloss = hit.gloss || '';
          if (!label || !gloss) continue;
          var chip = makeEl(doc, 'span', {
            'data-ss-i1-chip': '1',
            title: label + ': ' + gloss,
            text: label + ' → ' + gloss.slice(0, 36)
          });
          chip.addEventListener('click', (function (lbl, lineStr, elRef) {
            return function (ev) {
              ev.stopPropagation();
              openSelectionPopup(lbl, lineStr, elRef.getBoundingClientRect(), false);
            };
          })(label, txt, chip));
          b.appendChild(chip);
          added++;
        }
      }
      showToast('Phrasebound · Selective i+1 Idiom Gloss ON (' + added + ' hints)');
    }

    function toggleL1ToL2WeaveMode() {
      ensurePageStyleInjected();
      if (cfg.webIPlusOneMode === 'l1_weave') {
        cfg.webIPlusOneMode = 'off';
        clearIPlusOneDecorations();
        showToast('Phrasebound · L1→L2 Weave OFF');
        return;
      }
      clearIPlusOneDecorations();
      cfg.webIPlusOneMode = 'l1_weave';
      var tNodes = collectCleanTextNodes(doc.body, 280);
      var swapped = 0;
      for (var i = 0; i < tNodes.length && swapped < 40; i++) {
        var tn = tNodes[i];
        var val = tn.nodeValue || '';
        var cands = selectL1WeaveCandidates(val, savedStudyState.items, savedStudyState.words, cfg.l1WeaveRatio);
        if (!cands.length) continue;
        var frag = doc.createDocumentFragment();
        var cursor = 0;
        for (var c = 0; c < cands.length; c++) {
          var cd = cands[c];
          if (cd.start > cursor) frag.appendChild(doc.createTextNode(val.slice(cursor, cd.start)));
          var wSpan = makeEl(doc, 'span', {
            'data-ss-weave': '1',
            'data-ss-lemma': cd.lemma,
            'data-ss-orig-text': cd.original,
            title: 'Original: ' + cd.original + (cd.reading ? (' [' + cd.reading + ']') : '') + ' · Click to hear/study · Click ✓ when learned'
          }, [cd.l2Target]);
          wSpan.addEventListener('click', (function (itemRef, spanRef, ctxStr) {
            return function (ev) {
              ev.stopPropagation();
              speakTextChunked(itemRef.l2Target);
              openSelectionPopup(itemRef.l2Target, ctxStr, spanRef.getBoundingClientRect(), false);
            };
          })(cd, wSpan, val));
          var okBtn = makeEl(doc, 'span', {
            'data-ss-retire-btn': '1',
            title: 'Mark Learned (restore original & advance i+1)',
            text: '✓'
          });
          okBtn.addEventListener('click', (function (itemRef) {
            return function (ev) {
              ev.stopPropagation();
              persistWordStatus(itemRef.l2Target, 'known');
              retireKnownOnPage(itemRef.lemma);
              showToast('Mastered: ' + itemRef.l2Target);
            };
          })(cd));
          wSpan.appendChild(okBtn);
          frag.appendChild(wSpan);
          cursor = cd.end;
          swapped++;
        }
        if (cursor < val.length) frag.appendChild(doc.createTextNode(val.slice(cursor)));
        if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
      }
      showToast(swapped > 0
        ? ('Subtitle Study · L1→L2 Weave ON (' + swapped + ' expressions woven)')
        : 'Save words/idioms from videos first to weave them into L1 reading');
    }

    /* ----------------------------------------------------------------------
     * Feature 9: Drag-Box Region OCR (Alt+Shift+O, Pot-Desktop / WuPage style)
     * ---------------------------------------------------------------------- */
    var cropOcrState = { host: null, startX: 0, startY: 0, dragging: false };

    function stopRegionOcrSelector() {
      cropOcrState.dragging = false;
      if (cropOcrState.host && cropOcrState.host.parentNode) {
        cropOcrState.host.parentNode.removeChild(cropOcrState.host);
      }
      cropOcrState.host = null;
    }

    function startRegionOcrSelector() {
      if (cropOcrState.host) {
        stopRegionOcrSelector();
        return;
      }
      if (!doc.body) return;
      closeSelectionPopup();

      var host = makeEl(doc, 'div', { 'data-ss-crop-ocr': '1' });
      var sr = host.attachShadow({ mode: 'open' });
      var st = makeEl(doc, 'style', {
        text: ':host { all: initial; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(2, 6, 23, 0.25); font-family: system-ui, sans-serif; } .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #f8fafc; padding: 6px 14px; border-radius: 999px; font-size: 12.5px; border: 1px solid rgba(56,189,248,0.45); pointer-events: none; } .rect { position: fixed; border: 2px solid #2dd4bf; background: rgba(45, 212, 191, 0.14); display: none; pointer-events: none; }'
      });
      var hint = makeEl(doc, 'div', { className: 'hint', text: 'Drag around any image, manga bubble, or slide text for Local OCR · Esc to cancel' });
      var box = makeEl(doc, 'div', { className: 'rect' });
      sr.appendChild(st);
      sr.appendChild(hint);
      sr.appendChild(box);
      doc.body.appendChild(host);
      cropOcrState.host = host;

      host.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        cropOcrState.dragging = true;
        cropOcrState.startX = ev.clientX;
        cropOcrState.startY = ev.clientY;
        box.style.display = 'block';
        box.style.left = ev.clientX + 'px';
        box.style.top = ev.clientY + 'px';
        box.style.width = '1px';
        box.style.height = '1px';
      });
      host.addEventListener('mousemove', function (ev) {
        if (!cropOcrState.dragging) return;
        var x0 = Math.min(cropOcrState.startX, ev.clientX);
        var y0 = Math.min(cropOcrState.startY, ev.clientY);
        var w = Math.abs(ev.clientX - cropOcrState.startX);
        var h = Math.abs(ev.clientY - cropOcrState.startY);
        box.style.left = x0 + 'px';
        box.style.top = y0 + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
      });
      host.addEventListener('mouseup', function (ev) {
        if (!cropOcrState.dragging) return;
        var x0 = Math.min(cropOcrState.startX, ev.clientX);
        var y0 = Math.min(cropOcrState.startY, ev.clientY);
        var w = Math.abs(ev.clientX - cropOcrState.startX);
        var h = Math.abs(ev.clientY - cropOcrState.startY);
        stopRegionOcrSelector();
        if (w < 14 || h < 14) return;
        var anchorRect = { left: x0, right: x0 + w, top: y0, bottom: y0 + h, width: w, height: h };
        showToast('Capturing region for Local OCR…');
        sendBgMessage({ op: 'captureTabCrop' }, 6000).then(function (cap) {
          if (!cap || !cap.ok || !cap.dataUrl) {
            showToast((cap && cap.error) || 'Tab screenshot unavailable');
            return;
          }
          var img = new win.Image();
          img.onload = function () {
            var dpr = win.devicePixelRatio || 1;
            var canvas = doc.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, Math.round(x0 * dpr), Math.round(y0 * dpr), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
            var croppedUrl = canvas.toDataURL('image/png');
            sendBgMessage({
              op: 'ocrFrame',
              imageDataUrl: croppedUrl,
              tl: cfg.tl,
              url: cfg.companionUrl,
              ocrUrl: cfg.ocrUrl,
              ocrKey: cfg.ocrKey,
              ocrModel: cfg.ocrModel
            }, 57000).then(function (ocr) {
              var ocrText = (ocr && (ocr.text || ocr.ocr_text)) || '';
              if (!ocr || !ocr.ok || !ocrText.trim()) {
                showToast((ocr && ocr.error) || 'No text detected in selected region');
                return;
              }
              openSelectionPopup(ocrText.trim(), ocrText.trim(), anchorRect, false);
            });
          };
          img.src = cap.dataUrl;
        });
      });
    }

    /* ----------------------------------------------------------------------
     * Unified Keyboard Handler (Shortcuts, Chords, Esc, Shift-Selection, Tab)
     * ---------------------------------------------------------------------- */
    doc.addEventListener('keydown', function (ev) {
      // 1. Input Preview Tab / Escape handling
      if (inputPreviewState.host && doc.activeElement === inputPreviewState.targetInput) {
        if (ev.key === 'Tab' && inputPreviewState.readyTranslation) {
          ev.preventDefault();
          ev.stopPropagation();
          commitInputTranslation();
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          dismissInputPreview();
          return;
        }
      }

      // 2. Escape or [ / ] in Visual Rule Picker, or Escape closes selection popup
      if (pickerState.active) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          stopVisualRulePicker();
          return;
        }
        if (ev.key === '[') {
          ev.preventDefault();
          pickerState.ancestorOffset = Math.min(8, pickerState.ancestorOffset + 1);
          refreshPickerOverlay();
          return;
        }
        if (ev.key === ']') {
          ev.preventDefault();
          pickerState.ancestorOffset = Math.max(0, pickerState.ancestorOffset - 1);
          refreshPickerOverlay();
          return;
        }
      }
      if (cropOcrState.host && ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        stopRegionOcrSelector();
        return;
      }
      if (popupState.host && !isEditableElement(doc.activeElement) && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        var pk = (ev.key || '').toLowerCase();
        if (pk === 'c' && !popupState.copyArmed) {
          ev.preventDefault();
          popupState.copyArmed = true;
          if (popupState.copyHintNode) {
            popupState.copyHintNode.hidden = false;
            popupState.copyHintNode.textContent = 'Quick Copy: [w] word · [y] Anki TSV · [e] entry · [z] cloze';
          }
          return;
        }
        if (popupState.copyArmed && (pk === 'w' || pk === 'y' || pk === 'e' || pk === 'z')) {
          ev.preventDefault();
          popupState.copyArmed = false;
          var wTxt = popupState.selectedText || '';
          var trTxt = popupState.currentTranslation || '';
          var lnTxt = popupState.surroundingLine || '';
          var outCopy = wTxt;
          if (pk === 'y') outCopy = [wTxt, trTxt, lnTxt].map(function (x) { return String(x || '').replace(/\t|\r?\n/g, ' ').trim(); }).join('\t');
          else if (pk === 'e') outCopy = wTxt + (trTxt ? (' — ' + trTxt) : '') + (lnTxt && lnTxt !== wTxt ? ('\nExample: ' + lnTxt) : '');
          else if (pk === 'z') outCopy = (lnTxt ? lnTxt.replace(wTxt, '[' + wTxt + ']') : ('[' + wTxt + ']')) + (trTxt ? (' — ' + trTxt) : '');
          copyTextToClipboard(outCopy).then(function (ok) {
            if (popupState.copyHintNode) {
              popupState.copyHintNode.textContent = ok ? ('✓ Copied (' + pk.toUpperCase() + ')') : 'Clipboard unavailable';
              setTimeout(function () { if (popupState.copyHintNode) popupState.copyHintNode.hidden = true; }, 1200);
            }
          });
          return;
        }
        popupState.copyArmed = false;
        if (popupState.copyHintNode) popupState.copyHintNode.hidden = true;
      }
      if (ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && ((ev.code || '') === 'KeyO' || (ev.key || '').toLowerCase() === 'o')) {
        ev.preventDefault();
        ev.stopPropagation();
        if (embedded) sendBgMessage({ op: 'ssEmbeddedShortcut', action: 'ssStartRegionOcr' }, 4000);
        else startRegionOcrSelector();
        return;
      }
      if (ev.key === 'Escape' && popupState.host) {
        closeSelectionPopup();
      }

      // 3. Exact-Chord Hover tracking: strictly Ctrl alone for 260ms
      if (ev.key === 'Control') {
        if (ev.altKey || ev.shiftKey || ev.metaKey) {
          abortPendingHover();
        } else if (!ev.repeat) {
          ctrlAloneHeld = true;
          if (hoveredBlock) armHoverTimerForBlock(hoveredBlock);
        }
      } else if (ctrlAloneHeld || hoverTimer) {
        abortPendingHover();
      }

      // Webpage shortcuts use the exact Alt+letter chord selected in settings.
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.repeat) {
        var keyLower = (ev.key || '').toLowerCase();
        if (!/^[a-z]$/.test(keyLower)) keyLower = (ev.code || '').replace(/^Key([A-Z])$/, '$1').toLowerCase();
        var matchesKey = function (action) {
          return keyLower !== '' && keyLower === webShortcutKey(action);
        };

        if (matchesKey('input')) {
          var active = doc.activeElement;
          if (isSupportedTextInput(active)) {
            ev.preventDefault();
            ev.stopPropagation();
            triggerInputPreview(active, false);
            return;
          }
        }

        if (matchesKey('compare')) {
          if (popupState.host && typeof popupState.triggerCompare === 'function') {
            ev.preventDefault();
            ev.stopPropagation();
            popupState.triggerCompare();
            return;
          }
          var selInfo = getCleanSelectionInfo();
          if (selInfo) {
            ev.preventDefault();
            ev.stopPropagation();
            openSelectionPopup(selInfo.text, selInfo.line, selInfo.rect, true, null, null, true);
            return;
          }
        }

        if (!isEditableElement(doc.activeElement)) {
          if (matchesKey('full')) {
            ev.preventDefault();
            ev.stopPropagation();
            pageModeShortcut('full');
            return;
          }
          if (matchesKey('article')) {
            ev.preventDefault();
            ev.stopPropagation();
            pageModeShortcut('article');
            return;
          }
          if (matchesKey('view')) {
            ev.preventDefault();
            ev.stopPropagation();
            setWebDisplayMode(cfg.webDisplayMode === 'tr_only' ? 'bilingual' : 'tr_only');
            showToast(cfg.webDisplayMode === 'tr_only' ? 'In-Place Translation-Only ON (Links preserved)' : 'Bilingual Mode ON');
            return;
          }
          if (matchesKey('glosses')) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleSelectiveIPlusOneGloss();
            return;
          }
          if (matchesKey('weave')) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleL1ToL2WeaveMode();
            return;
          }
          if (matchesKey('picker')) {
            ev.preventDefault();
            ev.stopPropagation();
            startVisualRulePicker();
            return;
          }
        }
      }
    }, true);

    doc.addEventListener('keyup', function (ev) {
      if (ev.key === 'Control' || !ev.ctrlKey) {
        abortPendingHover();
      }
      if (ev.key === 'Shift' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        if (!eventTouchesIgnoredUI(ev)) {
          scheduleSelectionCheck();
        }
      }
    }, true);

    /* ----------------------------------------------------------------------
     * Feature 5: In-Place Canvas Image Translation & Toggle/Restore
     * ---------------------------------------------------------------------- */
    var imageOverlayMap = new WeakMap();

    function sampleImageBoxColors(ctx, x, y, w, h, imgW, imgH) {
      var lx = Math.max(0, Math.floor(x));
      var ty = Math.max(0, Math.floor(y));
      var rw = Math.min(imgW - lx, Math.max(1, Math.ceil(w)));
      var rh = Math.min(imgH - ty, Math.max(1, Math.ceil(h)));
      try {
        var data = ctx.getImageData(lx, ty, rw, rh).data;
        var buckets = Object.create(null);
        var bestKey = '';
        var bestCount = 0;
        var bestChannels = [255, 255, 255];
        for (var i = 0; i < data.length; i += 4) {
          var p = i / 4;
          var px = p % rw;
          var py = Math.floor(p / rw);
          var isEdge = py === 0 || py === rh - 1 || px === 0 || px === rw - 1;
          if (!isEdge || data[i + 3] < 24) continue;
          var r = data[i], g = data[i + 1], b = data[i + 2];
          var key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
          var rec = buckets[key] || { count: 0, sr: 0, sg: 0, sb: 0 };
          rec.count++;
          rec.sr += r; rec.sg += g; rec.sb += b;
          buckets[key] = rec;
          if (rec.count > bestCount) {
            bestCount = rec.count;
            bestKey = key;
            bestChannels = [Math.round(rec.sr / rec.count), Math.round(rec.sg / rec.count), Math.round(rec.sb / rec.count)];
          }
        }
        var luma = 0.299 * bestChannels[0] + 0.587 * bestChannels[1] + 0.114 * bestChannels[2];
        return {
          background: 'rgb(' + bestChannels[0] + ',' + bestChannels[1] + ',' + bestChannels[2] + ')',
          foreground: luma > 140 ? '#181c20' : '#f6f7f8'
        };
      } catch (_e) {
        return null;
      }
    }

    function wrapCanvasLines(ctx, text, maxWidth) {
      var lines = [];
      var paras = String(text || '').split(/\r?\n/);
      for (var p = 0; p < paras.length; p++) {
        var words = paras[p].match(/\s+|[^\s]+/g) || [''];
        var line = '';
        for (var w = 0; w < words.length; w++) {
          var tok = words[w];
          if (ctx.measureText(line + tok).width <= maxWidth) {
            line += tok;
            continue;
          }
          if (line.trim()) lines.push(line.replace(/\s+$/, ''));
          line = '';
          var chars = Array.from(tok.replace(/^\s+/, ''));
          for (var c = 0; c < chars.length; c++) {
            if (line && ctx.measureText(line + chars[c]).width > maxWidth) {
              lines.push(line);
              line = '';
            }
            line += chars[c];
          }
        }
        if (line.trim() || !lines.length) lines.push(line.replace(/\s+$/, ''));
      }
      return lines;
    }

    function renderTranslatedImageOverlay(imgEl, regions, fallbackDataUrl) {
      if (!imgEl || !Array.isArray(regions) || !regions.length || !doc.createElement) return false;
      var w = imgEl.naturalWidth || (imgEl.getBoundingClientRect ? Math.round(imgEl.getBoundingClientRect().width) : 0);
      var h = imgEl.naturalHeight || (imgEl.getBoundingClientRect ? Math.round(imgEl.getBoundingClientRect().height) : 0);
      if (w < 8 || h < 8) return false;

      var existing = imageOverlayMap.get(imgEl);
      if (existing && existing.canvas) {
        try { existing.canvas.remove(); } catch (_e) {}
        if (existing.badge) { try { existing.badge.remove(); } catch (_e2) {} }
      }

      var canvas = doc.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.setAttribute('data-ss-img-canvas', '1');
      var ctx = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;
      if (!ctx) return false;

      var paintWithSource = function (drawSrc) {
        ctx.drawImage(drawSrc, 0, 0, w, h);
        var rects = regions.map(function (reg) {
          var b = reg.box || [0, 0, 100, 50];
          var rx = (Number(b[0]) || 0) * w / 1000;
          var ry = (Number(b[1]) || 0) * h / 1000;
          var rw = Math.max(8, (Number(b[2]) || 100) * w / 1000);
          var rh = Math.max(8, (Number(b[3]) || 40) * h / 1000);
          return { rx: rx, ry: ry, rw: rw, rh: rh, tr: String(reg.translation || reg.text || ''), palette: sampleImageBoxColors(ctx, rx, ry, rw, rh, w, h) };
        });

        for (var i = 0; i < rects.length; i++) {
          var r = rects[i];
          if (!r.tr) continue;
          var pal = r.palette || { background: '#ffffff', foreground: '#181c20' };
          var pad = Math.max(2, Math.min(6, r.rw * 0.03));
          ctx.save();
          ctx.fillStyle = pal.background;
          ctx.fillRect(r.rx, r.ry, r.rw, r.rh);
          ctx.fillStyle = pal.foreground;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          var availW = Math.max(8, r.rw - pad * 2);
          var availH = Math.max(8, r.rh - pad * 2);
          var lo = 8, hi = Math.max(10, Math.floor(availH * 0.85)), bestSz = 9, bestLines = [r.tr];
          for (var iter = 0; iter < 10; iter++) {
            var mid = (lo + hi) / 2;
            ctx.font = '600 ' + mid + 'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
            var candLines = wrapCanvasLines(ctx, r.tr, availW);
            var totalH = candLines.length * mid * 1.2;
            var fitsW = candLines.every(function (ln) { return ctx.measureText(ln).width <= availW; });
            if (totalH <= availH && fitsW) {
              bestSz = mid; bestLines = candLines; lo = mid;
            } else {
              hi = mid;
            }
          }
          ctx.font = '600 ' + bestSz + 'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
          var startY = r.ry + pad + Math.max(0, (availH - bestLines.length * bestSz * 1.2) / 2);
          for (var li = 0; li < bestLines.length; li++) {
            ctx.fillText(bestLines[li], r.rx + pad, startY + li * bestSz * 1.2);
          }
          ctx.restore();
        }

        var ir = imgEl.getBoundingClientRect ? imgEl.getBoundingClientRect() : { left: 0, top: 0, width: w, height: h };
        canvas.style.cssText = 'position:fixed;left:' + ir.left + 'px;top:' + ir.top + 'px;width:' + ir.width + 'px;height:' + ir.height + 'px;z-index:2147483642;pointer-events:none;border-radius:4px;';
        var badge = doc.createElement('button');
        badge.type = 'button';
        badge.setAttribute('data-ss-img-badge', '1');
        badge.textContent = 'Restore Image';
        badge.style.cssText = 'position:fixed;left:' + (ir.left + 6) + 'px;top:' + (ir.top + 6) + 'px;z-index:2147483643;background:#1c1f24;color:#f3f4f6;border:1px solid rgba(255,255,255,0.18);border-radius:5px;padding:2px 7px;font:600 11px/1.3 -apple-system,sans-serif;cursor:pointer;';

        var rec = { canvas: canvas, badge: badge, showing: true };
        var syncOverlayPos = function () {
          if (!imgEl.isConnected) { canvas.remove(); badge.remove(); return; }
          var nr = imgEl.getBoundingClientRect();
          canvas.style.left = nr.left + 'px';
          canvas.style.top = nr.top + 'px';
          canvas.style.width = nr.width + 'px';
          canvas.style.height = nr.height + 'px';
          badge.style.left = (nr.left + 6) + 'px';
          badge.style.top = (nr.top + 6) + 'px';
        };
        badge.addEventListener('click', function () {
          rec.showing = !rec.showing;
          canvas.style.display = rec.showing ? 'block' : 'none';
          badge.textContent = rec.showing ? 'Restore Image' : 'Show Translation';
        });
        if (typeof win.addEventListener === 'function') {
          win.addEventListener('scroll', syncOverlayPos, true);
          win.addEventListener('resize', syncOverlayPos);
        }
        doc.body.appendChild(canvas);
        doc.body.appendChild(badge);
        imageOverlayMap.set(imgEl, rec);
      };

      try {
        ctx.drawImage(imgEl, 0, 0, w, h);
        ctx.getImageData(0, 0, 1, 1);
        paintWithSource(imgEl);
        return true;
      } catch (_corsErr) {
        if (fallbackDataUrl && typeof win.Image === 'function') {
          var dec = new win.Image();
          dec.onload = function () { paintWithSource(dec); };
          dec.src = fallbackDataUrl;
          return true;
        }
        return false;
      }
    }

    function toggleExistingTranslatedImage(srcUrl) {
      if (!doc.querySelectorAll || !srcUrl) return false;
      var imgs = doc.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].src === srcUrl || imgs[i].currentSrc === srcUrl) {
          var rec = imageOverlayMap.get(imgs[i]);
          if (rec && rec.canvas && rec.canvas.isConnected) {
            rec.showing = !rec.showing;
            rec.canvas.style.display = rec.showing ? 'block' : 'none';
            if (rec.badge) rec.badge.textContent = rec.showing ? 'Restore Image' : 'Show Translation';
            return true;
          }
        }
      }
      return false;
    }

    if (ch && ch.runtime && ch.runtime.onMessage && typeof ch.runtime.onMessage.addListener === 'function') {
      try {
        ch.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
          if (!msg || typeof msg !== 'object') return false;
          if (msg.op === 'ssSyncEmbeddedScope') {
            if (embedded) syncEmbeddedScope();
            return false;
          }
          if (msg.op === 'ssToggleFullPage') {
            startPageBilingualMode('full');
            if (sendResponse) sendResponse({ ok: true, mode: pageModeState.mode });
            return false;
          }
          if (msg.op === 'ssToggleArticle') {
            startPageBilingualMode('article');
            if (sendResponse) sendResponse({ ok: true, mode: pageModeState.mode });
            return false;
          }
          if (msg.op === 'ssToggleTrOnly') {
            setWebDisplayMode(cfg.webDisplayMode === 'tr_only' ? 'bilingual' : 'tr_only');
            showToast(cfg.webDisplayMode === 'tr_only' ? 'In-Place Translation-Only ON' : 'Bilingual Mode ON');
            if (sendResponse) sendResponse({ ok: true, webDisplayMode: cfg.webDisplayMode });
            return false;
          }
          if (msg.op === 'ssToggleBorderless') {
            cfg.webBorderless = !cfg.webBorderless;
            syncWebHtmlFlags();
            showToast(cfg.webBorderless ? 'Clean Borderless Typography ON' : 'Bordered Translation Blocks ON');
            if (sendResponse) sendResponse({ ok: true, webBorderless: cfg.webBorderless });
            return false;
          }
          if (msg.op === 'ssToggleWebBlur') {
            cfg.webBlurTr = !cfg.webBlurTr;
            syncWebHtmlFlags();
            showToast(cfg.webBlurTr ? 'Blur-Until-Hover Recall ON' : 'Blur-Until-Hover OFF');
            if (sendResponse) sendResponse({ ok: true, webBlurTr: cfg.webBlurTr });
            return false;
          }
          if (msg.op === 'ssToggleIPlusOneGloss') {
            toggleSelectiveIPlusOneGloss();
            if (sendResponse) sendResponse({ ok: true, mode: cfg.webIPlusOneMode });
            return false;
          }
          if (msg.op === 'ssToggleL1Weave') {
            toggleL1ToL2WeaveMode();
            if (sendResponse) sendResponse({ ok: true, mode: cfg.webIPlusOneMode });
            return false;
          }
          if (msg.op === 'ssStartRegionOcr') {
            startRegionOcrSelector();
            if (sendResponse) sendResponse({ ok: true });
            return false;
          }
          if (msg.op === 'ssToggleImageIfTranslated') {
            var togRes = toggleExistingTranslatedImage(msg.srcUrl);
            if (sendResponse) sendResponse({ toggled: togRes });
            return false;
          }
          if (msg.op === 'ssShowImageOcrResult') {
            if (!msg.ok || (!msg.text && !(Array.isArray(msg.regions) && msg.regions.length))) {
              showToast(msg.error || 'No text detected in image');
            } else {
              var imgs = doc.querySelectorAll ? doc.querySelectorAll('img') : [];
              var matchImg = null;
              var targetRect = null;
              for (var im = 0; im < imgs.length; im++) {
                if (imgs[im].src === msg.srcUrl || imgs[im].currentSrc === msg.srcUrl) {
                  matchImg = imgs[im];
                  targetRect = imgs[im].getBoundingClientRect();
                  break;
                }
              }
              var painted = false;
              if (matchImg && Array.isArray(msg.regions) && msg.regions.length) {
                painted = renderTranslatedImageOverlay(matchImg, msg.regions, msg.dataUrl);
              }
              if (!painted && msg.text) {
                openSelectionPopup(msg.text.trim(), msg.text.trim(), targetRect, false);
              }
            }
            if (sendResponse) sendResponse({ ok: true });
            return false;
          }
          if (msg.op === 'ssExtractReaderPayload') {
            var rRoots = Array.prototype.slice.call(doc.querySelectorAll(ARTICLE_ROOT_SELECTOR));
            var mainRoot = rRoots.find(function (el) { return (el.textContent || '').trim().length >= 120; }) || doc.body;
            var rBlocks = collectTranslatableBlocks(mainRoot, resolveActiveSiteRules());
            var mdLines = ['# ' + (getDocTitle() || 'Web Article'), ''];
            for (var rb = 0; rb < rBlocks.length; rb++) {
              var tag = (rBlocks[rb].tagName || '').toLowerCase();
              var tx = (rBlocks[rb].textContent || '').replace(/\s+/g, ' ').trim();
              if (!tx) continue;
              if (tag === 'h1' || tag === 'h2' || tag === 'h3') mdLines.push('## ' + tx);
              else mdLines.push(tx);
              mdLines.push('');
            }
            if (sendResponse) sendResponse({ title: getDocTitle() || 'Web Article', text: mdLines.join('\n'), url: (win.location && win.location.href) || '' });
            return false;
          }
          if (msg.op === 'ssReevalAutoTranslate') {
            sessionDismissedHost = '';
            if (ch && ch.storage && ch.storage.local && typeof ch.storage.local.get === 'function') {
              ch.storage.local.get(['ss_set'], function (res) {
                if (res && res.ss_set) applySettings(res.ss_set);
                if (!cfg.autoTranslateForeign && pageModeState.autoStarted) {
                  teardownPageBilingual(true);
                } else if (cfg.autoTranslateForeign && !pageModeState.mode) {
                  evaluateSmartAutoTranslate(0);
                }
              });
            }
            if (sendResponse) sendResponse({ ok: true });
            return false;
          }
          if (msg.op === 'ssStartRulePicker') {
            startVisualRulePicker();
            if (sendResponse) sendResponse({ ok: true, active: pickerState.active });
            return false;
          }
          return false;
        });
      } catch (_e3) { /* ignore */ }
    }
  }

  initBrowserRuntime();

  /* ==========================================================================
   * 7. Node.js & Global Test Hook Exports
   * ========================================================================== */

  var exportedApi = {
    maskText: maskText,
    restoreText: restoreText,
    luhnCheck: luhnCheck,
    extractBlockWithPlaceholders: extractBlockWithPlaceholders,
    buildStableCssSelector: buildStableCssSelector,
    splitTtsChunks: splitTtsChunks,
    detectTtsLang: detectTtsLang,
    STUDY_ACTIONS: STUDY_ACTIONS,
    sanitizeUntrustedContext: sanitizeUntrustedContext,
    tryChromeBuiltinTranslate: tryChromeBuiltinTranslate,
    extractConstituentTokens: extractConstituentTokens,
    scanPointTextWindow: scanPointTextWindow,
    selectL1WeaveCandidates: selectL1WeaveCandidates,
    detectPageLanguageSmart: detectPageLanguageSmart,
    shouldAutoTranslatePage: shouldAutoTranslatePage,
    computeInlineRetrievability: computeInlineRetrievability,
    findWebEpisodicMemory: findWebEpisodicMemory,
    extractDomainEntities: extractDomainEntities,
    _internal: {
      createLRUCache: createLRUCache,
      translateSegmentsBatch: translateSegmentsBatch,
      buildCompareModels: buildCompareModels,
      buildStableCssSelector: buildStableCssSelector,
      splitTtsChunks: splitTtsChunks,
      detectTtsLang: detectTtsLang,
      applySettings: applySettings,
      initBrowserRuntime: initBrowserRuntime
    }
  };

  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = exportedApi;
  }
  if (root && root.__SS_TEST__) {
    root.__SS_SELECT_EXPORTS__ = exportedApi;
    assignObj(root.__SS_TEST__, exportedApi);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
