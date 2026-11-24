// Unified state & IndexedDB storage with automatic migration from v0 chrome.storage.local.
// Manages saved words/phrases/FEs, site-namespaced per-video keys (yt:<id>, bili:<id>, nf:<id>, pv:<id>, dp:<id>, atv:<id>, gen:<id>)
// with transparent legacy YouTube key fallback, empirical FSRS-6 spaced-repetition scheduling (MIT ts-fsrs equations),
// 3-construct mastery, multimodal concordance, per-video/per-channel glossaries, ablation profiles, XP, and telemetry.
(typeof window !== 'undefined' ? window : globalThis).SS_STORE = (() => {
  const DB_NAME = 'subtitle_study_db';
  const DB_VER = 1;
  const STORES = ['kv', 'encounters', 'glossaries', 'research'];

  const SITE_KEY_RE = /^(yt|nf|pv|dp|bili|atv|gen|tw|blive|cz|soop|kk|fb|tt):/;
  const normVidKey = (videoId) => {
    const raw = String(videoId || '').trim();
    if (!raw) return '';
    return SITE_KEY_RE.test(raw) ? raw : `yt:${raw}`;
  };
  const legacyYtId = (videoId) => {
    const nk = normVidKey(videoId);
    return nk.startsWith('yt:') ? nk.slice(3) : '';
  };
  const sameVideoKey = (a, b) => {
    if (!a || !b) return false;
    return normVidKey(a) === normVidKey(b);
  };

  const openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const idbGet = async (storeName, key) => {
    try {
      const db = await openDB();
      return await new Promise((res) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(undefined);
      });
    } catch (e) { return undefined; }
  };

  const idbSet = async (storeName, key, val) => {
    try {
      const db = await openDB();
      return await new Promise((res) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(val, key);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      });
    } catch (e) { return false; }
  };

  const idbAll = async (storeName) => {
    try {
      const db = await openDB();
      return await new Promise((res) => {
        const out = {};
        const tx = db.transaction(storeName, 'readonly');
        const cur = tx.objectStore(storeName).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) { out[c.key] = c.value; c.continue(); }
          else res(out);
        };
        cur.onerror = () => res(out);
      });
    } catch (e) { return {}; }
  };

  const DAY_MS = 86400000;
  const MINUTE_MS = 60000;
  const REVIEW_GRADES = ['again', 'hard', 'good', 'easy'];

  // FSRS-6 default 21-parameter weight vector (MIT open-spaced-repetition/ts-fsrs)
  const FSRS6_W = [
    0.212, 1.2931, 2.3065, 8.2956,
    6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658,
    0.1542,
  ];

  const clampDifficulty = (d) => Math.min(10, Math.max(1, d));
  const clampStability = (s) => Math.min(36500, Math.max(0.001, s));

  const fsrsRetrievability = (elapsedDays, stabilityDays, w = FSRS6_W) => {
    const s = clampStability(Number(stabilityDays) || 1);
    const t = Math.max(0, Number(elapsedDays || 0));
    if (t <= 0) return 1;
    const decay = w[20] || 0.1542;
    const factor = Math.pow(0.9, -1 / decay) - 1;
    return Math.pow(1 + factor * (t / s), -decay);
  };

  const fsrsNextInterval = (stabilityDays, requestRetention = 0.9, w = FSRS6_W) => {
    const s = clampStability(Number(stabilityDays) || 1);
    const r = Math.min(0.99, Math.max(0.7, Number(requestRetention || 0.9)));
    const decay = w[20] || 0.1542;
    const factor = Math.pow(0.9, -1 / decay) - 1;
    const raw = (s / factor) * (Math.pow(r, -1 / decay) - 1);
    return Math.min(36500, Math.max(1, Math.round(raw)));
  };

  const normalizeFsrsGrade = (passedOrRating) => {
    if (typeof passedOrRating === 'boolean') return passedOrRating ? 3 : 1;
    if (typeof passedOrRating === 'number') {
      const g = Math.round(passedOrRating);
      return Math.min(4, Math.max(1, g));
    }
    const key = String(passedOrRating || '').trim().toLowerCase();
    if (key === 'again' || key === 'fail') return 1;
    if (key === 'hard') return 2;
    if (key === 'easy') return 4;
    return 3;
  };

  const PROFILES = {
    full: { enhanceFE: true, contrastiveGloss: true, drills: true, blurAllowed: true },
    control_plain: { enhanceFE: false, contrastiveGloss: false, drills: false, blurAllowed: true },
    enhancement_only: { enhanceFE: true, contrastiveGloss: false, drills: false, blurAllowed: true },
    contrastive_gloss: { enhanceFE: true, contrastiveGloss: true, drills: false, blurAllowed: true },
    retrieval_consolidation: { enhanceFE: true, contrastiveGloss: false, drills: true, blurAllowed: true },
  };

  const LEVELS = [
    [0, 'Idiom Newbie'],
    [100, 'Idiom Rookie'],
    [350, 'Idiom Trainee'],
    [800, 'Idiom Specialist'],
    [1600, 'Master of Idioms'],
  ];

  const levelFor = (xp) => {
    let cur = LEVELS[0];
    for (const lv of LEVELS) if (xp >= lv[0]) cur = lv;
    return cur[1];
  };

  const computeInitialDifficulty = (it = {}) => {
    if (typeof it.p10Reps === 'number') {
      return Math.round(Math.min(10, Math.max(1, it.p10Reps)) * 100) / 100;
    }
    const wordCount = (String(it.lemma || it.word || '').trim().split(/\s+/).filter(Boolean).length) || 1;
    let d = 5.0;
    d += 0.4 * Math.max(0, wordCount - 2);
    d += 0.35 * ((it.maxBand || 3) - 2);
    if (it.deceptive) d += 1.0;
    if (it.soundCue) d -= 0.8;
    return Math.round(Math.min(9.5, Math.max(1.5, d)) * 100) / 100;
  };

  const reviewId = (it) => String(it.id || JSON.stringify([it.lang || '', it.lemma || it.word || '', it.at || '', it.videoId || '', it.t || 0]));
  const reviewStage = (it) => it.reviewStage || (it.reps > 0 || it.lapses > 0 || it.lastRating ? 'review' : 'new');

  const initItemSchedule = (it, now = Date.now()) => {
    const difficulty = Number.isFinite(it.difficulty) ? clampDifficulty(it.difficulty) : computeInitialDifficulty(it);
    const stabilityDays = Number.isFinite(it.stabilityDays)
      ? clampStability(it.stabilityDays)
      : clampStability(Math.max(1.5, FSRS6_W[2] * (1.25 - 0.06 * (difficulty - 5))));
    const mastery = Object.assign({ meaning: 0, form: 0, prosody: 0 }, it.mastery || {});
    const videoId = it && it.videoId ? normVidKey(it.videoId) : (it && it.videoId) || '';
    const stage = reviewStage(it);
    const due = Number(it.nextReviewAt);
    return Object.assign({
      reps: 0,
      lapses: 0,
      lastSeenAt: now,
      retrievability: 1,
      fsrsVer: 6,
    }, it, {
      ...(videoId ? { videoId } : {}), id: reviewId(it), difficulty, stabilityDays, mastery, reviewStage: stage,
      nextReviewAt: stage === 'new' || !Number.isFinite(due) || due <= 0 ? now : due,
    });
  };

  const loadAll = async () => {
    const local = await new Promise((res) => chrome.storage.local.get(['ss_set', 'ss_words', 'ss_items', 'ss_xp', 'ss_feHist', 'ss_review'], res));
    const idbWords = await idbGet('kv', 'words');
    const idbItems = await idbGet('kv', 'items');
    const idbFeHist = await idbGet('kv', 'feHist');
    const idbSetState = await idbGet('kv', 'set');
    const idbXp = await idbGet('kv', 'xp');

    const words = Object.assign({}, idbWords || {}, local.ss_words || {});
    const rawItems = Array.isArray(local.ss_items) ? local.ss_items : (idbItems || []);
    const items = projectReviews(rawItems, local.ss_review);
    const navLang = (navigator.language || 'en').toLowerCase();
    const defaultTl = navLang.startsWith('zh-tw') || navLang.startsWith('zh-hk') || navLang.includes('hant')
      ? 'zh-Hant'
      : navLang.startsWith('zh')
      ? 'zh-Hans'
      : navLang.split('-')[0];

    const setDefaults = {
      lang: '',
      tl: defaultTl,
      blur: false,
      blurUntilHover: false,
      pauseOnSubHover: false,
      freqUnderlines: true,
      condensedPlayback: false,
      on: true,
      dimKnown: false,
      showRuby: true,
      uiMode: 'simple',
      gpuProfile: 'balanced',
      mtModel: 'plamo-2b',
      autoAiTranslate: true,
      useChromeBuiltinTranslator: true,
      cloudFallback: false,
      showDualHumanAi: false,
      layoutMode: 'stage',
      readingAid: 'romaji',
      toneColors: false,
      showPitchAccent: true,
      showStressMarks: false,
      fadeKnownReadings: true,
      genderColors: false,
      posColors: true,
      pitchMarks: true,
      cleanStageNoise: true,
      preferHumanSubs: true,
      preferCustomYtMt: true,
      mergeClauses: true,
      autoDetectVideo: false,
      autoStartCompanion: true,
      asrBackend: 'qwen3_small_vulkan',
      asrLangHint: '',
      autoTranscribeMissing: true,
      uvrVocalIsolation: false,
      uvrMode: 'off',
      darkTheme: true,
      devAutoReload: true,
      overlayScale: 1.0,
      overlayBottom: 5,
      coverThreshold: 0.85,
      vocabLevel: 2000,
      autoCalibrateLevel: true,
      incidentalFsrs: true,
      vocabLevelsByLang: {},
      arrowKeys: false,
      webRareWordsOn: false,
      shiftHoverScan: true,
      webHighlightSaved: true,
      webReaderAid: true,
      webIPlusOneMode: 'off',
      l1WeaveRatio: 0.08,
      webDisplayMode: 'tr_only',
      webBorderless: false,
      webBlurTr: false,
      fsrsRetention: 0.9,
      companionUrl: 'http://127.0.0.1:8787',
      ankiConnectUrl: 'http://127.0.0.1:8765',
      ankiDeck: 'Subtitle Study',
      researchProfile: 'full',
      useCompanionMt: true,
      researchTelemetry: true,
      useBigLlm: false,
      llmUrl: '',
      llmKey: '',
      llmModel: '',
      // Webpage translation, study & frame OCR settings (v0.5.0 clean-room upgrade)
      selectTranslate: true,
      pageHoverMode: 'ctrl',          // 'ctrl' | 'alt' | 'ctrl_click' | 'off'
      pageBilingualScope: 'article',  // 'article' (main prose only) | 'full' (all visible blocks)
      pageBilingualStyle: 'dual',     // 'dual' | 'dim' | 'replace'
      pageIdiomChips: true,           // highlight 5-language fe_*.json idioms in webpage translations
      maskSensitivePii: false,        // checksum-validated local secret/email/card/phone masking
      inputTranslate: true,           // Alt+I / triple-space Tab-to-accept input box translator
      inputTripleSpace: false,
      compareModels: ['plamo-2b', 'index-2b', 'hy-mt2-7b'],
      autoTranslateHosts: {},
      autoTranslateWeb: false,
      autoTranslateScope: 'full',
      neverTranslateHosts: [],
      skipAutoTranslateLangs: [],
      showFloatingFab: true,
      fabCompact: false,
      fabSide: 'right',
      fabOpacity: 0.82,
      fabHoverDelay: 140,
      fabClickMode: 'article',
      fabHideDomains: [],
      sceneServices: {},
      customApi: {},
      subStyle: null,
      siteRules: [],                  // [{ pattern, excludeSelectors, forceSelectors }]
      ocrUrl: '',                     // optional OpenAI-compatible Vision endpoint for burned-in subtitle OCR
      ocrModel: '',
      ocrKey: '',
      openCodeSession: false,         // attach stable x-opencode-session header on custom LLM calls
    };
    const localSet = (local.ss_set && typeof local.ss_set === 'object') ? local.ss_set : {};
    const idbSetObj = (idbSetState && typeof idbSetState === 'object') ? idbSetState : {};
    const localTs = Number(localSet._updatedAt || 0);
    const idbTs = Number(idbSetObj._updatedAt || 0);
    const set = (idbTs > localTs && localTs > 0)
      ? Object.assign({}, setDefaults, localSet, idbSetObj)
      : Object.assign({}, setDefaults, idbSetObj, localSet);
    if (typeof localSet.tl === 'string') set.tl = localSet.tl;
    if (Object.keys(localSet).length > 0 && !(idbTs > localTs && localTs > 0)) {
      idbSet('kv', 'set', set).catch(() => {});
    }

    if (set.trackVid && !SITE_KEY_RE.test(String(set.trackVid))) {
      set.trackVid = normVidKey(set.trackVid);
    }

    if (!set.mt2bDefault) { if (!set.mtModel || set.mtModel === 'plamo-0.8b') set.mtModel = 'plamo-2b'; set.mt2bDefault = true; }
    if (!set.asrSmallDefault) { if (!set.asrBackend || set.asrBackend === 'auto') set.asrBackend = 'qwen3_small_vulkan'; set.asrSmallDefault = true; }
    if (!set.mtModel || typeof set.mtModel !== 'string') set.mtModel = 'plamo-2b';
    if (set.mtDevice !== 'cpu') set.mtDevice = 'gpu';

    if (set.companionUrl === 'http://127.0.0.1:8765') {
      set.companionUrl = 'http://127.0.0.1:8787';
    }
    const xp = Math.max(Number(local.ss_xp || 0), Number(idbXp || 0));
    const feHist = idbFeHist || local.ss_feHist || {};

    return { set, words, items, xp, feHist };
  };

  const saveKey = async (k, val, targetChanged = false) => {
    const toStore = (k === 'set' && val && typeof val === 'object')
      ? Object.assign(val, { _updatedAt: Date.now() })
      : val;
    await idbSet('kv', k, toStore);
    try {
      let value = toStore;
      if (k === 'set' && !targetChanged) {
        const current = await new Promise(resolve => chrome.storage.local.get(['ss_set'], resolve));
        if (typeof current?.ss_set?.tl === 'string') value = { ...toStore, tl: current.ss_set.tl };
      }
      chrome.storage.local.set({ ['ss_' + k]: value });
    } catch (e) {}
  };

  const recordEncounters = async (videoId, title, feList, lines, transForFn) => {
    const vKey = normVidKey(videoId);
    if (!vKey || !feList || !feList.length) return;
    for (const fe of feList) {
      const k = 'fe|' + fe.pattern;
      const existing = (await idbGet('encounters', k)) || [];
      const filtered = existing.filter((x) => !sameVideoKey(x.videoId, vKey));
      const added = fe.occurrences.slice(0, 3).map((o) => ({
        videoId: vKey,
        title,
        t: o.t,
        endT: o.endT,
        line: o.line,
        surface: o.surface,
        trans: transForFn ? transForFn(lines[o.li]) : '',
      }));
      await idbSet('encounters', k, [...added, ...filtered].slice(0, 30));
    }
  };

  const getConcordance = async (key) => (await idbGet('encounters', key)) || [];

  const getGlossary = async (videoId, channelId) => {
    const ch = channelId ? await idbGet('glossaries', 'ch:' + channelId) : null;
    const vKey = normVidKey(videoId);
    let vid = vKey ? await idbGet('glossaries', 'vid:' + vKey) : null;
    if (!vid) {
      const leg = legacyYtId(videoId);
      if (leg) vid = await idbGet('glossaries', 'vid:' + leg);
    }
    return { channel: ch || null, video: vid || null };
  };

  const saveGlossary = async (videoId, channelId, videoGlossary, channelTerms) => {
    const vKey = normVidKey(videoId);
    if (vKey && videoGlossary) await idbSet('glossaries', 'vid:' + vKey, videoGlossary);
    if (channelId && channelTerms && channelTerms.length) {
      const prev = (await idbGet('glossaries', 'ch:' + channelId)) || { channelId, terms: [] };
      const map = new Map(prev.terms.map((t) => [t.src.toLowerCase(), t]));
      for (const t of channelTerms) map.set(t.src.toLowerCase(), t);
      await idbSet('glossaries', 'ch:' + channelId, { channelId, terms: [...map.values()].slice(0, 300), updatedAt: Date.now() });
    }
  };

  const getTrCache = async (videoId, tl, providerKey) => {
    const vKey = normVidKey(videoId);
    if (!vKey || !tl) return null;
    let hit = await idbGet('glossaries', `tr:${vKey}:${tl}:${providerKey || ''}`);
    if (!hit) {
      const leg = legacyYtId(videoId);
      if (leg) hit = await idbGet('glossaries', `tr:${leg}:${tl}:${providerKey || ''}`);
    }
    return hit && Array.isArray(hit.lines) ? hit : null;
  };

  const saveTrCache = async (videoId, tl, providerKey, lines, provLabel) => {
    const vKey = normVidKey(videoId);
    if (!vKey || !tl || !Array.isArray(lines) || !lines.length) return;
    await idbSet('glossaries', `tr:${vKey}:${tl}:${providerKey || ''}`, {
      lines,
      prov: provLabel || providerKey || '',
      at: Date.now(),
    });
  };

  const dueReviews = (items, now = Date.now(), limit = 10) => {
    const due = items.filter((it) => reviewStage(it) === 'new' || !(it.nextReviewAt > now));
    due.sort((a, b) => Number(reviewStage(a) === 'new') - Number(reviewStage(b) === 'new')
      || (a.nextReviewAt || 0) - (b.nextReviewAt || 0));
    return due.slice(0, limit);
  };

  // FSRS-6 memory model plus short learning/relearning steps. Retention applies to day-scale reviews.
  const fsrsSchedule = (item, passedOrRating, dimension = 'meaning', now = Date.now(), requestRetention = 0.9, w = FSRS6_W) => {
    const g = normalizeFsrsGrade(passedOrRating);
    Object.assign(item, initItemSchedule(item, now));
    const stage = item.reviewStage;
    const elapsedDays = Math.max(0, (now - (reviewTimestamp(item) || now)) / DAY_MS);
    const s = item.stabilityDays;
    const d = item.difficulty;
    const R = stage === 'new' ? 1 : fsrsRetrievability(elapsedDays, s, w);
    const initialD = (grade) => w[4] - Math.expm1(w[5] * (grade - 1));
    const dampedD = d - w[6] * (g - 3) * (10 - d) / 9;
    const nextD = stage === 'new' ? initialD(g) : w[7] * initialD(4) + (1 - w[7]) * dampedD;
    let nextS;
    if (stage === 'new') {
      nextS = w[g - 1];
    } else if (elapsedDays < 1) {
      const multiplier = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
      nextS = s * (g >= 2 ? Math.max(1, multiplier) : multiplier);
    } else if (g === 1) {
      const forgotten = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
      nextS = Math.min(s / Math.exp(w[17] * w[18]), forgotten);
    } else {
      // Successful recall FSRS-6 stability S'_r
      const hardPenalty = g === 2 ? w[15] : 1;
      const easyBonus = g === 4 ? w[16] : 1;
      const inc = Math.exp(w[8])
        * (11 - d)
        * Math.pow(s, -w[9])
        * Math.expm1(w[10] * (1 - R))
        * hardPenalty
        * easyBonus;
      nextS = s * (1 + inc);
    }

    item.difficulty = clampDifficulty(nextD);
    item.stabilityDays = clampStability(nextS);
    item.retrievability = R;
    item.lastRating = g;
    item.lastSeenAt = now;
    item.fsrsVer = 6;

    if (g >= 2) {
      item.reps = (item.reps || 0) + 1;
      item.mastery[dimension] = (item.mastery[dimension] || 0) + 1;
    } else if (stage === 'review') {
      item.lapses = (item.lapses || 0) + 1;
    }

    let minutes = 0;
    if (stage === 'new' || stage === 'learning') {
      minutes = g === 1 ? 1 : g === 2 ? 6 : g === 3 && !item.learningStep ? 10 : 0;
      item.reviewStage = minutes ? 'learning' : 'review';
      item.learningStep = minutes && g !== 1 ? 1 : 0;
    } else {
      minutes = g === 1 ? 10 : stage === 'relearning' && g === 2 ? 15 : 0;
      item.reviewStage = minutes ? 'relearning' : 'review';
      item.learningStep = 0;
    }
    const ivlDays = minutes ? minutes * MINUTE_MS / DAY_MS : fsrsNextInterval(item.stabilityDays, requestRetention, w);
    item.intervalDays = ivlDays;
    item.nextReviewAt = now + ivlDays * DAY_MS;
    return item;
  };

  const markReviewed = (item, passedOrRating, dimension = 'meaning', now = Date.now()) =>
    fsrsSchedule(item, passedOrRating, dimension, now, 0.9);

  const reviewTimestamp = (item) => Number(item.lastSeenAt) || Date.parse(item.at) || 0;

  const itemRetrievability = (item, now = Date.now()) => {
    const elapsed = (now - (reviewTimestamp(item) || now)) / DAY_MS;
    return fsrsRetrievability(elapsed, item.stabilityDays || FSRS6_W[2]);
  };

  const isRecallDue = (item, retention = 0.9, now = Date.now()) => {
    if (reviewStage(item) === 'new') return false; // New cards enter from the review queue.
    const scheduled = Number(item.nextReviewAt);
    return scheduled > 0 ? scheduled <= now : itemRetrievability(item, now) < retention;
  };

  // Review writes use a separate key so legacy save/export writes cannot overwrite a grade.
  const projectReviews = (items, review, now = Date.now()) => items.filter(Boolean).map((it) => {
    const id = reviewId(it);
    const schedules = review?.schedules || {};
    const saved = Object.prototype.hasOwnProperty.call(schedules, id) ? schedules[id] : null;
    const card = initItemSchedule({ ...it, ...saved }, reviewTimestamp(it) || now);
    for (const dimension of ['form', 'prosody']) {
      card.mastery[dimension] = Math.max(card.mastery[dimension], Number(it.mastery?.[dimension]) || 0);
    }
    return card;
  });

  const loadReviews = async () => {
    const local = await chrome.storage.local.get(['ss_items', 'ss_set', 'ss_review', 'ss_reviewSettings']);
    const raw = Array.isArray(local.ss_items) ? local.ss_items : (await idbGet('kv', 'items') || []);
    const state = local.ss_review || { schedules: {}, history: [] };
    const configuredRetention = local.ss_reviewSettings?.retention ?? local.ss_set?.fsrsRetention;
    const retention = Math.min(.98, Math.max(.8, Number(configuredRetention) || .9));
    const newLimit = Math.trunc(Math.min(100, Math.max(0, Number(local.ss_reviewSettings?.newLimit ?? 10) || 0)));
    return { items: projectReviews(raw, state), state, retention, newLimit };
  };

  const reviewDeck = (items, history, newLimit, now = Date.now()) => {
    const start = new Date(now).setHours(0, 0, 0, 0);
    const introduced = history.filter((entry) => entry.stage === 'new' && entry.at >= start).length;
    const due = dueReviews(items, now, Infinity);
    const scheduled = due.filter((it) => it.reviewStage !== 'new');
    const fresh = due.filter((it) => it.reviewStage === 'new');
    return { scheduled, fresh: fresh.slice(0, Math.max(0, newLimit - introduced)), remainingNew: fresh.length };
  };

  const scheduleSnapshot = (item) => {
    const fields = ['difficulty', 'stabilityDays', 'retrievability', 'lastRating', 'lastSeenAt',
      'nextReviewAt', 'intervalDays', 'reps', 'lapses', 'mastery', 'reviewStage', 'learningStep', 'fsrsVer'];
    return Object.fromEntries(fields.map((key) => [key, item[key] ?? null]));
  };

  let reviewQueue = Promise.resolve();
  const queueReviewWrite = (action) => {
    const review = reviewQueue.then(action);
    reviewQueue = review.catch(() => {});
    return review;
  };

  const reviewSavedItem = (id, rating, timestamp) => queueReviewWrite(async () => {
    if (typeof id !== 'string' || !id || !REVIEW_GRADES.includes(rating)) return null;
    const { items, state, retention, newLimit } = await loadReviews();
    const item = items.find((candidate) => candidate.id === id);
    const now = Date.now();
    if (!item || reviewTimestamp(item) !== timestamp || item.nextReviewAt > now) return null;
    if (item.reviewStage === 'new' && !reviewDeck(items, state.history, newLimit, now).fresh.some((candidate) => candidate.id === id)) return null;
    const stage = item.reviewStage;
    const previous = scheduleSnapshot(item);
    fsrsSchedule(item, rating, 'meaning', now, retention);
    const schedules = Object.fromEntries(items.filter((card) => Object.prototype.hasOwnProperty.call(state.schedules, card.id))
      .map((card) => [card.id, state.schedules[card.id]]));
    schedules[id] = scheduleSnapshot(item);
    const history = [...state.history.slice(-4999), { id, at: now, rating, stage, intervalDays: item.intervalDays }];
    await chrome.storage.local.set({ ss_review: { schedules, history, undo: { id, at: now, previous } } });
    return item;
  });

  const undoReview = (at) => queueReviewWrite(async () => {
    const { state, items } = await loadReviews();
    if (!state.undo || state.undo.at !== at || !items.some((it) => it.id === state.undo.id)) return false;
    const { id, previous } = state.undo;
    await chrome.storage.local.set({ ss_review: {
      schedules: { ...state.schedules, [id]: previous }, history: state.history.slice(0, -1),
    } });
    return true;
  });

  const containsStudyTerm = (line, term) => {
    if (!term) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(term)) return new RegExp(escaped, 'iu').test(line);
    return new RegExp('(^|[^\\p{L}\\p{M}\\p{N}])' + escaped + '(?=$|[^\\p{L}\\p{M}\\p{N}])', 'iu').test(line);
  };

  const recordConstructMastery = (items, lemmaOrPattern, dimension, passed) => {
    let updated = 0;
    const target = String(lemmaOrPattern || '').toLowerCase();
    if (!target) return 0;
    for (const it of items || []) {
      const lem = String(it.lemma || '').toLowerCase();
      const wd = String(it.word || '').toLowerCase();
      if (lem === target || wd === target) {
        if (!it.mastery) it.mastery = { meaning: 0, form: 0, prosody: 0 };
        if (passed) it.mastery[dimension] = (it.mastery[dimension] || 0) + 1;
        updated++;
      }
    }
    return updated;
  };

  const logEvent = async (enabled, type, payload, profile = 'full') => {
    if (!enabled) return;
    const day = new Date().toISOString().slice(0, 10);
    const cur = (await idbGet('research', day)) || [];
    const normPayload = payload && payload.videoId ? Object.assign({}, payload, { videoId: normVidKey(payload.videoId) }) : payload;
    cur.push({ schemaVer: 2, ts: Date.now(), profile, type, ...normPayload });
    if (cur.length > 2000) cur.shift();
    await idbSet('research', day, cur);
  };

  const exportResearchLog = async () => await idbAll('research');

  const TRACES_KEY = 'ss_study_traces_v1';
  const readLocalTraces = () => new Promise((res) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([TRACES_KEY], (r) => res((r && Array.isArray(r[TRACES_KEY])) ? r[TRACES_KEY] : []));
      } else {
        res([]);
      }
    } catch (_) { res([]); }
  });

  const normLangSimple = (lang) => {
    if (typeof SS_LANG !== 'undefined' && SS_LANG && typeof SS_LANG.normCode === 'function') {
      return SS_LANG.normCode(lang);
    }
    const raw = String(lang || 'en').trim().toLowerCase().replace(/_/g, '-');
    if (raw === 'yue' || raw.endsWith('-hk') || raw.includes('-yue')) return 'yue';
    if (raw === 'fil' || raw === 'tgl') return 'tl';
    return raw.split('-')[0] || 'en';
  };

  const getLangVocabLevel = (setObj, langCode) => {
    const base = Number((setObj && setObj.vocabLevel) || 2000) || 2000;
    const byLang = setObj && setObj.vocabLevelsByLang;
    if (!byLang || typeof byLang !== 'object') return base;
    const lg = normLangSimple(langCode || 'en');
    const val = Number(byLang[lg]);
    return Number.isFinite(val) && val >= 300 ? val : base;
  };

  const updateImplicitLevel = (curLevel, wordRank, understood) => {
    const lv = Math.max(300, Math.min(25000, Number(curLevel || 2000) || 2000));
    const r = Number(wordRank || 0);
    if (!r || r < 80 || r > 45000) return Math.round(lv);
    const p = 1 / (1 + Math.pow(r / lv, 3.3));
    let next = lv;
    if (understood) {
      if (r >= lv * 0.35 && r <= lv * 2.5) next = lv + 5.5 * (1 - p);
    } else {
      if (r <= lv * 3.0) next = lv - 24.0 * p;
    }
    return Math.round(Math.min(25000, Math.max(300, next)));
  };

  const studyUrl = (raw) => {
    try {
      const url = new URL(raw);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
    } catch (_) {}
    return null;
  };

  const studySite = (videoKey, sourceUrl) => {
    const names = { yt: 'YouTube', nf: 'Netflix', bili: 'Bilibili', tw: 'Twitch', dp: 'Disney+', pv: 'Prime Video', atv: 'Apple TV+' };
    return names[videoKey.split(':')[0]] || (sourceUrl && sourceUrl.hostname) || '';
  };

  const findEpisodicMemory = (queryText, items = [], traces = [], excludeVidKey = '', page = {}) => {
    const q = String(queryText || '').trim().toLowerCase();
    if (!q || q.length < 2) return null;
    const now = Date.now();
    const traceByKey = new Map();
    for (const tr of traces || []) {
      if (tr && tr.videoKey) traceByKey.set(normVidKey(tr.videoKey), tr);
    }

    let bestSaved = null;
    for (const it of items || []) {
      if (!it) continue;
      if (excludeVidKey && sameVideoKey(it.videoId, excludeVidKey)) continue;
      const w = String(it.word || '').trim().toLowerCase();
      const lm = String(it.lemma || '').trim().toLowerCase();
      if (w !== q && lm !== q) continue;
      if (page.lang && it.lang && normLangSimple(page.lang) !== normLangSimple(it.lang)) continue;
      const ts = Date.parse(it.at) || reviewTimestamp(it);
      const vk = normVidKey(it.videoId || '');
      const sourceUrl = studyUrl(it.sourceUrl);
      if (!vk && (sourceUrl ? sourceUrl.href === page.url : page.title && it.title === page.title)) continue;
      const tr = traceByKey.get(vk);
      const title = it.title || it.videoTitle || (tr && tr.title) || vk || 'Saved study';
      if (!bestSaved || ts > bestSaved._ts) {
        bestSaved = {
          kind: 'saved',
          videoKey: vk,
          sourceUrl: sourceUrl ? sourceUrl.href : '',
          site: studySite(vk, sourceUrl),
          title,
          t: Number(it.t || 0),
          contextLine: it.line || it.sentence || '',
          daysAgo: ts > 0 ? Math.max(0, Math.floor((now - ts) / DAY_MS)) : 0,
          item: it,
          _ts: ts,
        };
      }
    }
    if (bestSaved) {
      delete bestSaved._ts;
      return bestSaved;
    }

    for (const tr of traces || []) {
      if (!tr || !tr.videoKey) continue;
      if (excludeVidKey && sameVideoKey(tr.videoKey, excludeVidKey)) continue;
      if (page.lang && tr.lang && normLangSimple(page.lang) !== normLangSimple(tr.lang)) continue;
      const feMatch = Array.isArray(tr.topFEs) && tr.topFEs.some((fe) => String(fe || '').toLowerCase() === q);
      const cueHit = Array.isArray(tr.struggledCues) && tr.struggledCues.find((c) => containsStudyTerm(String((c && c.t) || ''), q));
      if (!feMatch && !cueHit) continue;
      const ts = Number(tr.lastWatchedAt || 0);
      return {
        kind: 'trace',
        videoKey: normVidKey(tr.videoKey),
        site: studySite(normVidKey(tr.videoKey), null),
        title: tr.title || tr.videoKey,
        t: cueHit ? Number(cueHit.s || 0) : 0,
        contextLine: cueHit ? (cueHit.t || '') : '',
        daysAgo: ts > 0 ? Math.max(0, Math.floor((now - ts) / DAY_MS)) : 0,
        item: null,
      };
    }
    return null;
  };

  const getStudyTraces = async (limit = 20) => {
    const idbArr = (await idbGet('kv', TRACES_KEY)) || [];
    const localArr = await readLocalTraces();
    const byKey = new Map();
    for (const src of [localArr, idbArr]) {
      if (!Array.isArray(src)) continue;
      for (const x of src) {
        if (!x || !x.videoKey) continue;
        const vk = normVidKey(x.videoKey);
        const prev = byKey.get(vk);
        if (!prev || (x.lastWatchedAt || 0) >= (prev.lastWatchedAt || 0)) {
          byKey.set(vk, Object.assign({}, x, { videoKey: vk }));
        }
      }
    }
    const list = [...byKey.values()];
    list.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
    return limit > 0 ? list.slice(0, limit) : list;
  };

  const recordStudyTrace = async (patch) => {
    if (!patch || !patch.videoKey) return null;
    const vk = normVidKey(patch.videoKey);
    const list = await getStudyTraces(0);
    const arr = Array.isArray(list) ? list : [];
    const idx = arr.findIndex((x) => sameVideoKey(x.videoKey, vk));
    const now = Date.now();
    const cur = idx >= 0 ? Object.assign({}, arr[idx]) : {
      videoKey: vk,
      title: '',
      author: '',
      site: '',
      lang: '',
      watchedSec: 0,
      playCount: 0,
      trackHash: '',
      summary: '',
      struggledCues: [],
      topFEs: [],
      lastWatchedAt: now,
    };
    if (patch.title) cur.title = String(patch.title).slice(0, 140);
    if (patch.author) cur.author = String(patch.author).slice(0, 80);
    if (patch.site) cur.site = String(patch.site);
    if (patch.lang) cur.lang = String(patch.lang);
    if (typeof patch.addWatchedSec === 'number' && patch.addWatchedSec > 0) {
      cur.watchedSec = Math.round((cur.watchedSec + patch.addWatchedSec) * 10) / 10;
    }
    if (patch.incPlay) cur.playCount = (cur.playCount || 0) + 1;
    if (patch.trackHash) cur.trackHash = String(patch.trackHash);
    if (patch.summary) cur.summary = String(patch.summary).slice(0, 420);
    if (Array.isArray(patch.struggledCues) && patch.struggledCues.length) {
      const merged = new Map((cur.struggledCues || []).map((c) => [Math.round((c.s || 0) / 2), Object.assign({}, c)]));
      for (const sc of patch.struggledCues) {
        if (!sc || !sc.t) continue;
        const bk = Math.round((sc.s || 0) / 2);
        const ex = merged.get(bk);
        if (ex) {
          ex.count = Math.max(ex.count || 1, sc.count || 1);
          if (sc.tr) ex.tr = sc.tr;
        } else {
          merged.set(bk, { s: Math.round((sc.s || 0) * 10) / 10, t: String(sc.t).slice(0, 140), tr: String(sc.tr || '').slice(0, 140), count: sc.count || 1 });
        }
      }
      cur.struggledCues = [...merged.values()].sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 12);
    }
    if (Array.isArray(patch.topFEs) && patch.topFEs.length) {
      const feSet = new Set([...(cur.topFEs || []), ...patch.topFEs.map(String)].filter(Boolean));
      cur.topFEs = [...feSet].slice(0, 12);
    }
    cur.lastWatchedAt = now;
    if (idx >= 0) arr[idx] = cur;
    else arr.push(cur);
    arr.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
    if (arr.length > 120) arr.length = 120;
    await idbSet('kv', TRACES_KEY, arr);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [TRACES_KEY]: arr });
      }
    } catch (_) {}
    return cur;
  };

  return {
    FSRS6_W, PROFILES, normVidKey, sameVideoKey, loadAll, saveKey, recordEncounters, getConcordance,
    getGlossary, saveGlossary, getTrCache, saveTrCache, dueReviews, markReviewed, fsrsSchedule,
    fsrsRetrievability, fsrsNextInterval, normalizeFsrsGrade, recordConstructMastery,
    reviewTimestamp, reviewId, itemRetrievability, isRecallDue, reviewSavedItem, containsStudyTerm,
    projectReviews, loadReviews, reviewDeck, undoReview,
    computeInitialDifficulty, initItemSchedule, levelFor, logEvent, exportResearchLog,
    getStudyTraces, recordStudyTrace, getLangVocabLevel, updateImplicitLevel, findEpisodicMemory,
  };
})();
