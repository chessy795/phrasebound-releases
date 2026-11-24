// Phonological & Orthographic Reading-Aid Engine (Round 4 — 12-Language Suite)
// Supports:
//   1) Flexible static dictionary normalization for ext/data/read_ko.json, read_tl.json, read_ru.json
//   2) Inline stress & diacritic rendering for Russian (сказа́л, ещё — grapheme-safe casing with U+0301)
//      and Tagalog (batà, anó, hindî, walâ — preserving surface casing without shifting source offsets)
//   3) Offline Korean eojeol/stem Revised Romanization lookup from read_ko.json
//   4) Mandarin Zhuyin (注音 / Bopomofo) conversion with Taiwan textbook front neutral-tone dot (˙ㄇㄚ)
//   5) Calm pastel syllable-tone tokenization for Pinyin (1-4+0), Zhuyin (1-4+0), and Cantonese Jyutping (1-6)
//   6) NHK minimal-pair Japanese pitch-accent filter (ꜜ downstep / ‾ flat heiban, on by default)
// Zero innerHTML / outerHTML — 100% Trusted-Types safe.
(typeof window !== 'undefined' ? window : globalThis).SS_READINGS = (() => {
  const _dictCache = new WeakMap();

  const normalizeReadDict = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    if (_dictCache.has(raw)) return _dictCache.get(raw);
    let src = raw;
    if (raw.items && typeof raw.items === 'object') src = raw.items;
    else if (raw.words && typeof raw.words === 'object') src = raw.words;
    else if (raw.entries && typeof raw.entries === 'object') src = raw.entries;

    const out = Object.create(null);
    if (Array.isArray(src)) {
      for (const row of src) {
        if (Array.isArray(row) && row.length >= 2 && row[0] && row[1]) {
          const val = typeof row[1] === 'string' ? row[1] : (row[1].reading || row[1].romaji || row[1].marked || '');
          if (val) out[String(row[0]).toLowerCase()] = String(val);
        }
      }
    } else {
      for (const k of Object.keys(src)) {
        if (k === 'meta' || k === '_meta') continue;
        const v = src[k];
        const val = typeof v === 'string' ? v : (Array.isArray(v) ? v[0] : (v && (v.reading || v.romaji || v.marked || '')));
        if (val && typeof val === 'string') out[k.toLowerCase()] = val;
      }
    }
    _dictCache.set(raw, out);
    return out;
  };

  // Split string into base+combining-mark grapheme units so U+0301 never misaligns letter casing
  const splitBaseGraphemes = (s) => String(s || '').match(/\P{M}\p{M}*/gu) || [];

  const isUpperLetter = (ch) => {
    if (!ch) return false;
    return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
  };

  const transferClusterCase = (origWord, markedWord) => {
    if (!origWord || !markedWord || origWord === markedWord) return markedWord || origWord;
    const hasLower = origWord !== origWord.toUpperCase();
    const hasUpper = origWord !== origWord.toLowerCase();
    if (hasUpper && !hasLower) return markedWord.toUpperCase();
    if (!hasUpper) return markedWord;

    const origG = splitBaseGraphemes(origWord);
    const markG = splitBaseGraphemes(markedWord);
    if (origG.length !== markG.length) {
      if (isUpperLetter(origWord[0])) {
        const first = markG[0] || '';
        return (first ? first[0].toUpperCase() + first.slice(1) : '') + markG.slice(1).join('');
      }
      return markedWord;
    }
    return markG.map((mg, idx) => {
      const og = origG[idx];
      if (og && isUpperLetter(og[0]) && mg) {
        return mg[0].toUpperCase() + mg.slice(1);
      }
      return mg;
    }).join('');
  };

  const TL_ACCENTED_RE = /[àáâèéêìíîòóôùúûÀÁÂÈÉÊÌÍÎÒÓÔÙÚÛ]/;
  const RU_ACUTE_RE = /\u0301/;

  // Apply inline stress/diacritics from read_ru.json or read_tl.json without changing base spelling semantics
  const applyInlineMarks = (word, rawDict, lang) => {
    if (!word || !rawDict) return word;
    const dict = rawDict.meta || rawDict.items || rawDict.words || Array.isArray(rawDict)
      ? normalizeReadDict(rawDict)
      : rawDict;
    if (!dict) return word;

    const code = String(lang || '').toLowerCase().split('-')[0];
    if (code === 'tl' || code === 'fil') {
      if (TL_ACCENTED_RE.test(word)) return word;
      const low = word.toLowerCase();
      const hit = dict[low];
      if (hit && hit !== low) return transferClusterCase(word, hit);
      if (word.includes('-')) {
        let changed = false;
        const parts = word.split('-').map((seg) => {
          const sLow = seg.toLowerCase();
          const sHit = dict[sLow];
          if (sHit && sHit !== sLow) {
            changed = true;
            return transferClusterCase(seg, sHit);
          }
          return seg;
        });
        if (changed) return parts.join('-');
      }
      return word;
    }

    if (code === 'ru') {
      if (RU_ACUTE_RE.test(word)) return word;
      const low = word.toLowerCase();
      const hit = dict[low] || dict[low.replace(/ё/g, 'е')];
      if (hit && hit !== low) return transferClusterCase(word, hit);
      return word;
    }

    return word;
  };

  // Common Korean josa / polite endings for stem+particle fallback when read_ko.json holds dictionary stems
  const KO_SUFFIX_RR = [
    ['으로부터', 'eurobuteo'], ['에서부터', 'eseobuteo'], ['이라서', 'iraseo'], ['라서', 'raseo'],
    ['입니다', 'imnida'], ['습니다', 'seumnida'], ['어요', 'eoyo'], ['아요', 'ayo'], ['해요', 'haeyo'],
    ['네요', 'neyo'], ['군요', 'gunyo'], ['지요', 'jiyo'], ['죠', 'jyo'],
    ['에서', 'eseo'], ['에게', 'ege'], ['한테', 'hante'], ['으로', 'euro'], ['부터', 'buteo'],
    ['까지', 'kkaji'], ['처럼', 'cheoreom'], ['보다', 'boda'], ['마다', 'mada'], ['조차', 'jocha'],
    ['마저', 'majeo'], ['하고', 'hago'], ['이랑', 'irang'], ['랑', 'rang'],
    ['은', 'eun'], ['는', 'neun'], ['이', 'i'], ['가', 'ga'], ['을', 'eul'], ['를', 'reul'],
    ['에', 'e'], ['도', 'do'], ['만', 'man'], ['의', 'ui'], ['와', 'wa'], ['과', 'gwa'], ['로', 'ro'], ['요', 'yo'],
  ];

  const lookupKoReading = (word, rawDict) => {
    if (!word || !rawDict || !/[\uac00-\ud7a3]/.test(word)) return '';
    const dict = rawDict.meta || rawDict.items || rawDict.words || Array.isArray(rawDict)
      ? normalizeReadDict(rawDict)
      : rawDict;
    if (!dict) return '';
    const clean = String(word).trim();
    const direct = dict[clean] || dict[clean.toLowerCase()];
    if (direct) return direct;

    for (const [sfx, rr] of KO_SUFFIX_RR) {
      if (clean.length > sfx.length && clean.endsWith(sfx)) {
        const stem = clean.slice(0, -sfx.length);
        const stemRd = dict[stem];
        if (stemRd) return stemRd + rr;
      }
    }
    return '';
  };

  // ---------------------------------------------------------------------------
  // Mandarin Pinyin -> Zhuyin (注音 / Bopomofo) with Taiwan front neutral dot (˙ㄇㄚ)
  // ---------------------------------------------------------------------------
  const TONE_VOWEL_MAP = {
    'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
    'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
    'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
    'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
    'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
    'ǖ': ['v', 1], 'ǘ': ['v', 2], 'ǚ': ['v', 3], 'ǜ': ['v', 4],
    'ü': ['v', 0], 'ê': ['eh', 0],
  };

  const ZHUYIN_INITIALS = [
    ['zh', 'ㄓ'], ['ch', 'ㄔ'], ['sh', 'ㄕ'],
    ['b', 'ㄅ'], ['p', 'ㄆ'], ['m', 'ㄇ'], ['f', 'ㄈ'],
    ['d', 'ㄉ'], ['t', 'ㄊ'], ['n', 'ㄋ'], ['l', 'ㄌ'],
    ['g', 'ㄍ'], ['k', 'ㄎ'], ['h', 'ㄏ'],
    ['j', 'ㄐ'], ['q', 'ㄑ'], ['x', 'ㄒ'],
    ['r', 'ㄖ'], ['z', 'ㄗ'], ['c', 'ㄘ'], ['s', 'ㄙ'],
  ];

  const ZHUYIN_WHOLE = {
    zhi: 'ㄓ', chi: 'ㄔ', shi: 'ㄕ', ri: 'ㄖ', zi: 'ㄗ', ci: 'ㄘ', si: 'ㄙ',
    yi: 'ㄧ', ya: 'ㄧㄚ', yo: 'ㄧㄛ', ye: 'ㄧㄝ', yai: 'ㄧㄞ', yao: 'ㄧㄠ', you: 'ㄧㄡ',
    yan: 'ㄧㄢ', yin: 'ㄧㄣ', yang: 'ㄧㄤ', ying: 'ㄧㄥ',
    wu: 'ㄨ', wa: 'ㄨㄚ', wo: 'ㄨㄛ', wai: 'ㄨㄞ', wei: 'ㄨㄟ',
    wan: 'ㄨㄢ', wen: 'ㄨㄣ', wang: 'ㄨㄤ', weng: 'ㄨㄥ',
    yu: 'ㄩ', yue: 'ㄩㄝ', yuan: 'ㄩㄢ', yun: 'ㄩㄣ', yong: 'ㄩㄥ',
    er: 'ㄦ', hm: 'ㄏㄇ', hng: 'ㄏㄥ', ng: 'ㄫ', m: 'ㄇ', n: 'ㄋ',
  };

  const ZHUYIN_FINALS = {
    a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', eh: 'ㄝ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ',
    an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', ong: 'ㄨㄥ',
    i: 'ㄧ', ia: 'ㄧㄚ', io: 'ㄧㄛ', ie: 'ㄧㄝ', iai: 'ㄧㄞ', iao: 'ㄧㄠ', iu: 'ㄧㄡ', iou: 'ㄧㄡ',
    ian: 'ㄧㄢ', in: 'ㄧㄣ', iang: 'ㄧㄤ', ing: 'ㄧㄥ', iong: 'ㄩㄥ',
    u: 'ㄨ', ua: 'ㄨㄚ', uo: 'ㄨㄛ', uai: 'ㄨㄞ', ui: 'ㄨㄟ', uei: 'ㄨㄟ',
    uan: 'ㄨㄢ', un: 'ㄨㄣ', uen: 'ㄨㄣ', uang: 'ㄨㄤ', ueng: 'ㄨㄥ',
    v: 'ㄩ', ve: 'ㄩㄝ', ue: 'ㄩㄝ', van: 'ㄩㄢ', vn: 'ㄩㄣ',
  };

  const TONE_MARKS_ZY = { 1: '', 2: 'ˊ', 3: 'ˇ', 4: 'ˋ' };

  const parsePinyinSyllable = (rawSyl) => {
    let s = String(rawSyl || '').trim().toLowerCase().replace(/u:/g, 'v');
    if (!s) return null;
    let tone = 0;
    const numM = s.match(/^([a-züêāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+)([1-50])$/);
    if (numM) {
      s = numM[1];
      const d = Number(numM[2]);
      tone = (d === 5 || d === 0) ? 5 : d;
    }
    let norm = '';
    for (const ch of s) {
      if (TONE_VOWEL_MAP[ch]) {
        norm += TONE_VOWEL_MAP[ch][0];
        if (TONE_VOWEL_MAP[ch][1]) tone = TONE_VOWEL_MAP[ch][1];
      } else {
        norm += ch;
      }
    }
    if (!/^[a-z]+$/.test(norm)) return null;
    if (!tone) tone = 5; // unmarked syllable in context = neutral tone (輕聲)
    return { base: norm, tone };
  };

  const pinyinSyllableToZhuyin = (rawSyl) => {
    const parsed = parsePinyinSyllable(rawSyl);
    if (!parsed) return '';
    let { base, tone } = parsed;
    let erhua = false;
    if (base.length > 2 && base !== 'er' && base.endsWith('r') && !ZHUYIN_WHOLE[base]) {
      erhua = true;
      base = base.slice(0, -1);
    }

    let body = ZHUYIN_WHOLE[base] || '';
    if (!body) {
      let init = '';
      let rest = base;
      for (const [pyI, zyI] of ZHUYIN_INITIALS) {
        if (base.startsWith(pyI)) {
          init = pyI;
          body = zyI;
          rest = base.slice(pyI.length);
          break;
        }
      }
      if ((init === 'j' || init === 'q' || init === 'x') && rest.startsWith('u')) {
        rest = 'v' + rest.slice(1);
      }
      const fin = ZHUYIN_FINALS[rest];
      if (!fin) return '';
      body += fin;
    }
    if (erhua) body += 'ㄦ';
    // Taiwan textbook convention: neutral tone dot sits in front (˙ㄇㄚ), tones 2/3/4 sit after, tone 1 unmarked
    return tone === 5 ? `˙${body}` : `${body}${TONE_MARKS_ZY[tone] || ''}`;
  };

  const pinyinToZhuyin = (pinyinStr) => {
    if (!pinyinStr || typeof pinyinStr !== 'string') return '';
    const tokens = pinyinStr.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    const out = [];
    for (const tk of tokens) {
      // Handle apostrophe-joined syllables like xi'an -> xi + an
      const subs = tk.split(/['’]/).filter(Boolean);
      const conv = subs.map(pinyinSyllableToZhuyin);
      if (conv.some((c) => !c)) return '';
      out.push(conv.join(' '));
    }
    return out.join(' ');
  };

  // ---------------------------------------------------------------------------
  // Tone extraction for calm pastel <rt> coloring (base characters NEVER colored)
  // ---------------------------------------------------------------------------
  const detectPinyinTone = (syl) => {
    const p = parsePinyinSyllable(syl);
    return p ? p.tone : 0;
  };

  const detectZhuyinTone = (syl) => {
    const s = String(syl || '').trim();
    if (!/[\u3105-\u3129\u31a0-\u31ba]/.test(s)) return 0;
    if (s.includes('˙')) return 5;
    if (s.includes('ˊ')) return 2;
    if (s.includes('ˇ')) return 3;
    if (s.includes('ˋ')) return 4;
    return 1;
  };

  const detectJyutpingTone = (syl) => {
    const m = String(syl || '').trim().match(/^[a-z]+([1-6])$/i);
    return m ? Number(m[1]) : 0;
  };

  const inferReadingScheme = (readingStr, modeHint = '', isYue = false) => {
    if (!readingStr || typeof readingStr !== 'string') return '';
    if (modeHint === 'zhuyin' || /[\u3105-\u3129]/.test(readingStr)) return 'zhuyin';
    if (modeHint === 'jyutping' || (isYue && /\b[a-z]+[1-6]\b/i.test(readingStr))) return 'jyutping';
    if (modeHint === 'pinyin' || /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(readingStr)) return 'pinyin';
    if (/\b[a-z]+[1-6]\b/i.test(readingStr) && /\b[a-z]+6\b/i.test(readingStr)) return 'jyutping';
    return '';
  };

  const tokenizeReadingTones = (readingStr, scheme, explicitTones = null) => {
    if (!readingStr || typeof readingStr !== 'string' || !scheme) return null;
    const parts = readingStr.split(/(\s+)/);
    const out = [];
    let sylIdx = 0;
    let anyToned = false;
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        out.push({ text: part, cls: '' });
        continue;
      }
      let tone = Array.isArray(explicitTones) && typeof explicitTones[sylIdx] === 'number'
        ? explicitTones[sylIdx]
        : 0;
      if (!tone) {
        if (scheme === 'jyutping') tone = detectJyutpingTone(part);
        else if (scheme === 'zhuyin') tone = detectZhuyinTone(part);
        else if (scheme === 'pinyin') tone = detectPinyinTone(part);
      }
      sylIdx++;
      if (tone > 0) {
        anyToned = true;
        const cls = scheme === 'jyutping'
          ? `ss-rt-t ss-cant-${tone}`
          : `ss-rt-t ss-tone-${tone === 0 ? 5 : tone}`;
        out.push({ text: part, cls });
      } else {
        out.push({ text: part, cls: '' });
      }
    }
    return anyToned ? out : null;
  };

  // ---------------------------------------------------------------------------
  // NHK Minimal-Pair Japanese Pitch Accent Filter (ꜜ downstep / ‾ flat heiban)
  // ---------------------------------------------------------------------------
  const PITCH_MARKS_RE = /[ꜜ‾]/g;

  const applyPitchPref = (readingOrFuri, showPitch = true) => {
    if (!readingOrFuri) return readingOrFuri;
    if (showPitch) return readingOrFuri;
    if (Array.isArray(readingOrFuri)) {
      return readingOrFuri.map(([txt, kana]) => [txt, typeof kana === 'string' ? kana.replace(PITCH_MARKS_RE, '') : kana]);
    }
    if (typeof readingOrFuri === 'string') {
      return readingOrFuri.replace(PITCH_MARKS_RE, '');
    }
    return readingOrFuri;
  };

  // --- Rich Offline Reader-Aid & POS Engine (JA / ZH / YUE / KO / RU / TL) ---
  const _richCache = new WeakMap();
  const _koTupleRrCache = new WeakMap();
  const _segCache = Object.create(null);

  const HANZI_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const KANJI_RE = /[\u4e00-\u9fff\u3400-\u4dbf々ヶヵ]/;
  const HIRA_RE = /[\u3040-\u309f]/;
  const KATA_RE = /[\u30a0-\u30ff]/;
  const KANA_ONLY_RE = /^[\u3040-\u309f\u30a0-\u30ffー]+$/;
  const HANGUL_RE = /[\uac00-\ud7af]/;
  const HANGUL_ONLY_RE = /^[\uac00-\ud7af]+$/;
  const SMALL_MORA_RE = /^[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]$/;

  const JA_PARTICLES = new Set([
    'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'や', 'の', 'も',
    'から', 'まで', 'より', 'よ', 'ね', 'な', 'か', 'わ', 'ぞ', 'さ',
    'し', 'けど', 'けれど', 'けれども', 'ながら', 'ば', 'たら', 'って',
    'など', 'しか', 'だけ', 'ほど', 'くらい', 'ぐらい', 'こそ', 'さえ',
    'でも', 'のに', 'ので', 'とか', 'ばかり', 'だけ',
  ]);

  const KO_PARTICLES_OFFLINE = [
    '에서부터', '으로부터', '에게서', '한테서', '에서는', '에서도', '에서의',
    '으로는', '으로도', '이라는', '이라고', '처럼', '같이', '까지', '마저',
    '조차', '부터', '에서', '에게', '한테', '으로', '보다', '하고', '이나',
    '이라', '이랑', '와는', '과는', '은', '는', '이', '가', '을', '를',
    '의', '에', '로', '와', '과', '도', '만', '랑', '야',
  ];

  const kataToHira = (s) => String(s || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  const splitMoras = (kana) => {
    const out = [];
    for (const ch of String(kana || '')) {
      if (SMALL_MORA_RE.test(ch) && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  };

  const moraCharOffset = (moras, moraCount) => {
    let n = 0;
    for (let i = 0; i < moraCount && i < moras.length; i++) n += moras[i].length;
    return n;
  };

  const applyJaPitchStr = (hira, pitchNum, showPitch = true) => {
    const s = String(hira || '');
    if (!s || !showPitch || pitchNum == null || !Number.isFinite(pitchNum)) return s;
    const clean = s.replace(PITCH_MARKS_RE, '');
    const moras = splitMoras(clean);
    if (!moras.length) return s;
    if (pitchNum === 0) return clean + '‾';
    if (pitchNum >= 1 && pitchNum <= moras.length) {
      return moras.slice(0, pitchNum).join('') + 'ꜜ' + moras.slice(pitchNum).join('');
    }
    return clean;
  };

  const buildFuriParts = (orig, hira, pitchNum = null, showPitch = true) => {
    const o = String(orig || '');
    const h = String(hira || '').replace(PITCH_MARKS_RE, '');
    if (!o) return [];
    if (!h) return [[o, '']];
    const hasK = KANJI_RE.test(o);
    if (!hasK) return [[o, '']];

    const runs = [];
    for (const ch of o) {
      const isK = KANJI_RE.test(ch);
      if (runs.length && runs[runs.length - 1].isK === isK) runs[runs.length - 1].text += ch;
      else runs.push({ text: ch, isK });
    }

    const moras = splitMoras(h);
    const hasPitch = showPitch && pitchNum != null && Number.isFinite(pitchNum);
    const dropCharPos = hasPitch && pitchNum >= 1 && pitchNum <= moras.length ? moraCharOffset(moras, pitchNum) : -1;

    if (runs.length === 1) {
      return [[o, applyJaPitchStr(h, pitchNum, showPitch)]];
    }

    const hNorm = kataToHira(h);
    let left = 0;
    let right = hNorm.length;
    const spans = runs.map((r) => ({ text: r.text, isK: r.isK, s: 0, e: 0 }));

    let rStart = 0;
    let rEnd = runs.length - 1;
    if (!runs[0].isK) {
      const pre = kataToHira(runs[0].text);
      if (hNorm.startsWith(pre) && hNorm.length > pre.length) {
        spans[0].s = 0;
        spans[0].e = pre.length;
        left = pre.length;
        rStart = 1;
      } else {
        return [[o, applyJaPitchStr(h, pitchNum, showPitch)]];
      }
    }
    if (rEnd >= rStart && !runs[rEnd].isK) {
      const suf = kataToHira(runs[rEnd].text);
      if (hNorm.slice(left).endsWith(suf) && (right - suf.length) > left) {
        spans[rEnd].s = right - suf.length;
        spans[rEnd].e = right;
        right -= suf.length;
        rEnd -= 1;
      } else {
        return [[o, applyJaPitchStr(h, pitchNum, showPitch)]];
      }
    }

    let cur = left;
    let ok = true;
    for (let i = rStart; i <= rEnd; i++) {
      if (runs[i].isK) {
        if (i === rEnd) {
          if (right <= cur) { ok = false; break; }
          spans[i].s = cur;
          spans[i].e = right;
          cur = right;
        }
      } else {
        const anchor = kataToHira(runs[i].text);
        const pos = hNorm.indexOf(anchor, cur + 1);
        if (pos < 0 || pos + anchor.length >= right) {
          ok = false;
          break;
        }
        spans[i - 1].s = cur;
        spans[i - 1].e = pos;
        spans[i].s = pos;
        spans[i].e = pos + anchor.length;
        cur = pos + anchor.length;
      }
    }

    if (!ok) {
      return [[o, applyJaPitchStr(h, pitchNum, showPitch)]];
    }

    return spans.map((sp, idx) => {
      if (!sp.isK) return [sp.text, ''];
      let rt = h.slice(sp.s, sp.e);
      if (hasPitch) {
        if (pitchNum === 0 && idx === spans.length - 1) {
          rt += '‾';
        } else if (dropCharPos > sp.s && dropCharPos <= sp.e) {
          const rel = dropCharPos - sp.s;
          rt = rt.slice(0, rel) + 'ꜜ' + rt.slice(rel);
        }
      }
      return [sp.text, rt];
    });
  };

  const JA_DIGRAPHS = {
    きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
    しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
    ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
    にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
    びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
    みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
    ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
    しぇ: 'she', ちぇ: 'che', じぇ: 'je', てぃ: 'ti', でぃ: 'di', でゅ: 'dyu',
    とぅ: 'tu', どぅ: 'du', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
    ゔぁ: 'va', ゔぃ: 'vi', ゔ: 'vu', ゔぇ: 've', ゔぉ: 'vo',
    くぁ: 'kwa', つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  };

  const JA_MONO = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
    か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
    が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
    ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
    た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
    な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
    は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
    ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
    ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
    や: 'ya', ゆ: 'yu', よ: 'yo',
    ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
    わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o', ん: 'n',
    ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
    ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゔ: 'vu',
  };

  const MACRONS = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

  const kanaToRomaji = (kana, pos = '') => {
    const clean = kataToHira(String(kana || '').replace(PITCH_MARKS_RE, '').trim());
    if (!clean) return '';
    if (pos === 'p') {
      if (clean === 'は') return 'wa';
      if (clean === 'へ') return 'e';
      if (clean === 'を') return 'o';
    }
    let out = '';
    let geminate = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === 'っ') {
        geminate = true;
        continue;
      }
      if (ch === 'ー') {
        if (out.length) {
          const last = out[out.length - 1];
          if (MACRONS[last]) out = out.slice(0, -1) + MACRONS[last];
        }
        continue;
      }
      const di = i + 1 < clean.length ? JA_DIGRAPHS[ch + clean[i + 1]] : '';
      let syl = di || JA_MONO[ch] || '';
      if (di) i++;
      if (!syl) {
        geminate = false;
        out += ch;
        continue;
      }
      if (ch === 'ん') {
        const nextSyl = i + 1 < clean.length ? (JA_DIGRAPHS[clean.slice(i + 1, i + 3)] || JA_MONO[clean[i + 1]] || '') : '';
        if (nextSyl && /^[aiueoy]/.test(nextSyl)) syl = "n'";
      }
      if (geminate) {
        if (syl.startsWith('ch')) syl = 't' + syl;
        else if (/^[bcdfghjklmnpqrstvwxyz]/.test(syl)) syl = syl[0] + syl;
        geminate = false;
      }
      out += syl;
    }
    return out;
  };

  const KO_L = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  const KO_V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
  const KO_T = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
  const KO_L_CODA_NEXT_R = { g: 'n', k: 'k' };

  const hangulToRR = (str) => {
    const chars = Array.from(String(str || ''));
    const syls = chars.map((ch) => {
      const cp = ch.charCodeAt(0);
      if (cp < 0xac00 || cp > 0xd7a3) return { raw: ch };
      const idx = cp - 0xac00;
      const l = Math.floor(idx / 588);
      const v = Math.floor((idx % 588) / 28);
      const t = idx % 28;
      return { l, v, t };
    });
    let out = '';
    for (let i = 0; i < syls.length; i++) {
      const s = syls[i];
      if (s.raw !== undefined) {
        out += s.raw;
        continue;
      }
      const next = syls[i + 1];
      let L = KO_L[s.l];
      const V = KO_V[s.v];
      let T = KO_T[s.t];
      if (next && next.raw === undefined) {
        // Basic intervocalic / nasal assimilation for clean RR
        if (s.t && next.l === 11) {
          // Liaisons: batchim carries over except ㅇ (ng) and ㅎ (h drops)
          const liaisonL = {
            1: 'g', 2: 'kk', 4: 'n', 7: 'd', 8: 'r', 16: 'm', 17: 'b', 19: 's', 20: 'ss',
            22: 'j', 23: 'ch', 24: 'k', 25: 't', 26: 'p',
          };
          if (s.t === 27) {
            T = '';
          } else if (liaisonL[s.t]) {
            next._overrideL = liaisonL[s.t];
            T = '';
          }
        } else if ((s.t === 1 || s.t === 2 || s.t === 24) && (next.l === 2 || next.l === 6)) {
          T = 'ng';
        } else if ((s.t === 17 || s.t === 26) && (next.l === 2 || next.l === 6)) {
          T = 'm';
        } else if ((s.t === 7 || s.t === 19 || s.t === 20 || s.t === 22 || s.t === 23 || s.t === 25) && (next.l === 2 || next.l === 6)) {
          T = 'n';
        } else if (s.t === 8 && next.l === 5) {
          T = 'l';
          next._overrideL = 'l';
        } else if (s.t === 4 && next.l === 5) {
          T = 'l';
          next._overrideL = 'l';
        }
      }
      if (s._overrideL !== undefined) L = s._overrideL;
      void KO_L_CODA_NEXT_R;
      out += L + V + T;
    }
    return out.replace(/([gkdtrmbpsjch])\1{2,}/g, '$1$1');
  };

  const normalizeRichReadDict = (raw) => {
    if (!raw || typeof raw !== 'object') return Object.create(null);
    if (raw.__ssRich) return raw;
    if (_richCache.has(raw)) return _richCache.get(raw);
    const out = Object.create(null);
    Object.defineProperty(out, '__ssRich', { value: true, enumerable: false });
    const src = (raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items)) ? raw.items
      : (raw.words && typeof raw.words === 'object' && !Array.isArray(raw.words)) ? raw.words
      : (raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) ? raw.entries
      : raw;
    let maxLen = 1;
    const add = (k, val) => {
      const key = String(k || '').trim();
      if (!key) return;
      let rec = null;
      if (Array.isArray(val)) {
        const r = String(val[0] || '').trim();
        const v1 = val.length > 1 ? String(val[1] || '').trim() : '';
        const pitch = val.length > 2 && typeof val[2] === 'number' ? val[2] : null;
        if (!r && !v1 && pitch == null) return;
        rec = { r, v1, pitch };
      } else if (typeof val === 'string') {
        const r = val.trim();
        if (!r) return;
        rec = { r, v1: '', pitch: null };
      } else if (val && typeof val === 'object') {
        const r = String(val.hira || val.reading || val.pron || val.r || '').trim();
        const v1 = String(val.pos || val.hanja || val.v1 || '').trim();
        const pitch = typeof val.pitch === 'number' ? val.pitch : null;
        if (!r && !v1 && pitch == null) return;
        rec = { r, v1, pitch };
      }
      if (!rec) return;
      if (key.length > maxLen && key.length <= 24) maxLen = key.length;
      out[key] = rec;
      const low = key.toLowerCase();
      if (low !== key && !out[low]) out[low] = rec;
    };
    if (Array.isArray(src)) {
      for (const row of src) {
        if (Array.isArray(row) && row.length >= 2) add(row[0], row.slice(1));
        else if (row && typeof row === 'object') add(row.word || row.k || row.surface, row);
      }
    } else {
      for (const [k, v] of Object.entries(src)) add(k, v);
    }
    Object.defineProperty(out, '__maxLen', { value: Math.min(16, maxLen), enumerable: false });
    _richCache.set(raw, out);
    return out;
  };

  const _getKoTupleRrMap = (rawDict) => {
    if (!rawDict || typeof rawDict !== 'object') return null;
    if (_koTupleRrCache.has(rawDict)) return _koTupleRrCache.get(rawDict);
    const rich = normalizeRichReadDict(rawDict);
    const strMap = Object.create(null);
    let any = false;
    for (const [k, rec] of Object.entries(rich)) {
      if (!HANGUL_RE.test(k)) continue;
      const rr = rec.r && !HANGUL_RE.test(rec.r) ? rec.r : hangulToRR(rec.r || k);
      if (rr) {
        strMap[k] = rr;
        any = true;
      }
    }
    const res = any ? strMap : null;
    _koTupleRrCache.set(rawDict, res);
    return res;
  };

  const lookupKoReadingRich = (word, rawDict) => {
    const direct = lookupKoReading(word, rawDict);
    if (direct && !HANGUL_RE.test(direct)) return direct;
    if (!word || !rawDict || !HANGUL_RE.test(String(word))) return '';
    const rrMap = _getKoTupleRrMap(rawDict);
    const rrDirect = rrMap ? lookupKoReading(word, rrMap) : '';
    if (rrDirect) return rrDirect;
    return HANGUL_ONLY_RE.test(String(word)) ? hangulToRR(word) : (direct || '');
  };

  const _posFromField = (v1) => (/^[a-z]{1,4}$/i.test(v1 || '') ? String(v1).toLowerCase() : '');

  const _greedyCjkLookup = (orig, rich, scriptRe, joinChar) => {
    if (!orig || orig.length < 2 || !scriptRe.test(orig)) return null;
    const maxL = Math.min(rich.__maxLen || 8, orig.length);
    let i = 0;
    const parts = [];
    let lastPos = '';
    while (i < orig.length) {
      const ch = orig[i];
      if (!scriptRe.test(ch)) {
        if (HIRA_RE.test(ch) || KATA_RE.test(ch)) {
          parts.push(kataToHira(ch));
          i += 1;
          continue;
        }
        return null;
      }
      let hit = null;
      let hitLen = 0;
      for (let len = Math.min(maxL, orig.length - i); len >= 1; len--) {
        const sub = orig.slice(i, i + len);
        const rec = rich[sub];
        if (rec && rec.r) {
          hit = rec;
          hitLen = len;
          break;
        }
      }
      if (!hit) return null;
      parts.push(hit.r);
      const p = _posFromField(hit.v1);
      if (p) lastPos = p;
      i += hitLen;
    }
    if (!parts.length) return null;
    return { r: parts.join(joinChar), pos: lastPos };
  };

  const pickAidReading = (aid, lang, mode = 'romaji', opts = {}) => {
    if (!aid) return '';
    const lg = String(lang || '').toLowerCase().split(/[-_]/)[0];
    const m = String(mode || 'romaji').toLowerCase();
    if (m === 'off') return '';
    const showPitch = opts.showPitchAccent !== false;
    if (lg === 'ja') {
      if (m === 'romaji_latin' || m === 'hepburn') return aid.romaji || '';
      const stripP = (v) => (showPitch ? v : applyPitchPref(v, false));
      // 'romaji' in storage.js / UI ("Ruby: Auto") and 'hira' render Kanji Furigana + Pitch!
      if (aid.hasKanji) {
        if (Array.isArray(aid.furiPitch) && aid.furiPitch.length && showPitch) return aid.furiPitch;
        if (Array.isArray(aid.furi) && aid.furi.length && aid.furi.some((p) => p[1])) return stripP(aid.furi);
        if (aid.hira && aid.hira !== aid.orig) return stripP(aid.hira);
      }
      return '';
    }
    if (lg === 'zh') {
      const py = aid.pinyin || aid.reading || '';
      if (m === 'zhuyin' || m === 'bopomofo') return aid.zhuyin || (py ? pinyinToZhuyin(py) : '');
      return py;
    }
    if (lg === 'yue') {
      return aid.jyutping || aid.reading || '';
    }
    if (lg === 'ko') {
      if (m === 'hanja') return aid.hanja || '';
      if (m === 'pron') return aid.pron || '';
      return aid.romaji || aid.reading || '';
    }
    return aid.reading || '';
  };

  const YUE_CORE_CHARS = {
    係: ['hai6', 'v'], 嘅: ['ge3', 'p'], 咗: ['zo2', 'p'], 喺: ['hai2', 'p'],
    噉: ['gam2', 'd'], 咁: ['gam3', 'd'], 啲: ['di1', 'p'], 嚟: ['lai4', 'v'],
    冇: ['mou5', 'v'], 唔: ['m4', 'd'], 佢: ['keoi5', 'n'], 畀: ['bei2', 'v'],
    睇: ['tai2', 'v'], 諗: ['nam2', 'v'], 嘢: ['je5', 'n'], 乜: ['mat1', ''],
    邊: ['bin1', ''], 仲: ['zung6', 'd'], 晒: ['saai3', 'p'], 喎: ['wo3', 'p'],
    啦: ['laa1', 'p'], 㗎: ['gaa3', 'p'], 吖: ['aa1', 'p'], 啫: ['ze1', 'p'],
    咩: ['me1', 'p'], 囉: ['lo1', 'p'], 緊: ['gan2', 'p'], 完: ['jyun4', 'v'],
    搵: ['wan2', 'v'], 攞: ['lo2', 'v'], 傾: ['king1', 'v'], 講: ['gong2', 'v'],
    聽: ['teng1', 'v'], 食: ['sik6', 'v'], 飲: ['jam2', 'v'], 行: ['haang4', 'v'],
    企: ['kei5', 'v'], 坐: ['co5', 'v'], 瞓: ['fan3', 'v'], 靚: ['leng3', 'a'],
    平: ['peng4', 'a'],
  };
  const YUE_CORE_PRIORITY = new Set(['係', '嘅', '咗', '喺', '噉', '咁', '啲', '嚟', '冇', '唔', '佢', '畀', '睇', '諗', '嘢']);

  const mergeCjkDictTokens = (toks, lang, rawOrRichDict, cutPointsSet) => {
    const rawL = String(lang || '').toLowerCase();
    const lg = rawL === 'yue' ? 'yue' : rawL.split(/[-_]/)[0];
    if (!Array.isArray(toks) || toks.length < 2 || (lg !== 'yue' && lg !== 'zh')) return toks;
    const rich = rawOrRichDict ? normalizeRichReadDict(rawOrRichDict) : null;
    if (!rich) return toks;
    const hasCut = cutPointsSet
      ? (typeof cutPointsSet.has === 'function' ? (p) => cutPointsSet.has(p)
        : Array.isArray(cutPointsSet) ? (p) => cutPointsSet.includes(p)
        : () => false)
      : () => false;

    const offsets = new Array(toks.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < toks.length; i++) offsets[i + 1] = offsets[i] + String(toks[i].w || '').length;

    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const cur = toks[i];
      if (!cur || !cur.word || !HANZI_RE.test(cur.w)) {
        out.push(cur);
        continue;
      }
      let merged = null;
      let mergedSpan = 1;
      for (let span = Math.min(4, toks.length - i); span >= 2; span--) {
        let canMerge = true;
        let joined = '';
        for (let j = 0; j < span; j++) {
          const tj = toks[i + j];
          if (!tj || !tj.word || !HANZI_RE.test(tj.w)) { canMerge = false; break; }
          if (j > 0 && hasCut(offsets[i + j])) { canMerge = false; break; }
          joined += tj.w;
        }
        if (canMerge && rich[joined]) {
          merged = { w: joined, word: true };
          mergedSpan = span;
          break;
        }
      }
      if (merged) {
        out.push(merged);
        i += mergedSpan - 1;
      } else {
        out.push(cur);
      }
    }
    return out;
  };

  const _resolveJaDeinflectHit = (orig, cand, rec) => {
    const dictHira = rec.r || (KANA_ONLY_RE.test(cand.lemma) ? kataToHira(cand.lemma) : '');
    if (!dictHira) return null;
    let lcp = 0;
    const lim = Math.min(orig.length, cand.lemma.length);
    while (lcp < lim && orig[lcp] === cand.lemma[lcp]) lcp++;
    const cutTail = kataToHira(cand.lemma.slice(lcp));
    const origTail = kataToHira(orig.slice(lcp));
    let derived = '';
    if (lcp > 0 && dictHira.endsWith(cutTail)) {
      derived = dictHira.slice(0, dictHira.length - cutTail.length) + origTail;
    } else if (cand.lemma === '来る' && orig.startsWith('来')) {
      if (/^来(ない|られ|よう|い|ず)/.test(orig)) derived = 'こ' + kataToHira(orig.slice(1));
      else if (/^来(た|て|ま|し)/.test(orig)) derived = 'き' + kataToHira(orig.slice(1));
      else if (orig.startsWith('来る')) derived = 'く' + kataToHira(orig.slice(1));
    } else if (cand.lemma === 'する' && !KANJI_RE.test(orig)) {
      derived = kataToHira(orig);
    } else if (cand.lemma.endsWith('する') && orig.length > cand.lemma.length - 2 && orig.startsWith(cand.lemma.slice(0, -2))) {
      const stemHira = dictHira.endsWith('する') ? dictHira.slice(0, -2) : '';
      if (stemHira) derived = stemHira + kataToHira(orig.slice(cand.lemma.length - 2));
    }
    if (!derived) return null;
    const recPos = _posFromField(rec.v1);
    const isVerbKind = cand.kind === 'v' || cand.kind === 'verb';
    const isAdjKind = cand.kind === 'a' || cand.kind === 'adj';
    let score = cand.lemma.length * 0.1;
    if ((isVerbKind && recPos === 'v') || (isAdjKind && recPos === 'a')) score += 10;
    else if (isVerbKind || isAdjKind) score += 3;
    if (cand.cut === 'suru' && !cand.lemma.endsWith('する') && recPos === 'n') score -= 12;
    return {
      hira: derived,
      pos: recPos || (isAdjKind ? 'a' : isVerbKind ? 'v' : ''),
      lemma: cand.lemma,
      score,
    };
  };

  const _collectJaDeinflectQueue = (orig, LANG) => {
    const seen = new Set([orig]);
    const queue = [{ form: orig, depth: 0 }];
    const all = [];
    for (let qi = 0; qi < queue.length && qi < 18; qi++) {
      const cur = queue[qi];
      if (cur.depth >= 3) continue;
      const cands = LANG.jaDeinflectCandidates(cur.form) || [];
      for (const c of cands) {
        if (!c || !c.lemma || c.lemma === cur.form) continue;
        if (!seen.has(c.lemma)) {
          seen.add(c.lemma);
          all.push({ lemma: c.lemma, kind: c.kind || '', cut: c.cut || 0 });
          if (cur.depth + 1 < 3 && (c.kind === 'v' || c.kind === 'verb' || c.kind === 'a' || c.kind === 'adj')) {
            queue.push({ form: c.lemma, depth: cur.depth + 1 });
          }
        }
      }
    }
    return all;
  };

  const lookupTokenAid = (word, lang, rawOrRichDict, opts = {}) => {
    const orig = String(word || '').trim();
    if (!orig) return null;
    const rawL = String(lang || '').toLowerCase();
    const lg = rawL === 'yue' ? 'yue' : rawL.split(/[-_]/)[0];
    const rich = rawOrRichDict ? normalizeRichReadDict(rawOrRichDict) : Object.create(null);
    const showPitch = opts.showPitchAccent !== false;
    const mode = opts.mode || 'romaji';
    const LANG = typeof globalThis !== 'undefined' ? globalThis.SS_LANG : null;

    if (lg === 'ja') {
      const hasKanji = KANJI_RE.test(orig);
      if (!hasKanji && !HIRA_RE.test(orig) && !KATA_RE.test(orig)) return null;
      let hira = '';
      let pos = '';
      let pitch = null;
      let lemma = '';

      if (JA_PARTICLES.has(orig)) {
        hira = kataToHira(orig);
        pos = 'p';
      } else {
        const direct = rich[orig];
        if (direct) {
          hira = direct.r || (KANA_ONLY_RE.test(orig) ? kataToHira(orig) : '');
          pos = _posFromField(direct.v1);
          pitch = direct.pitch;
        } else if (LANG && typeof LANG.jaDeinflectCandidates === 'function' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(orig)) {
          const cands = _collectJaDeinflectQueue(orig, LANG);
          let best = null;
          for (const cand of cands) {
            const rec = rich[cand.lemma];
            if (!rec) continue;
            const hit = _resolveJaDeinflectHit(orig, cand, rec);
            if (!hit) continue;
            if (hit.score < 0 && !rich[cand.lemma + 'する']) continue;
            if (!best || hit.score > best.score) best = hit;
          }
          if (best) {
            hira = best.hira;
            pos = best.pos;
            lemma = best.lemma;
          }
        }
      }

      if (!hira && hasKanji && !HIRA_RE.test(orig) && !KATA_RE.test(orig) && Object.keys(rich).length > 0) {
        const comp = _greedyCjkLookup(orig, rich, KANJI_RE, '');
        if (comp) {
          hira = comp.r;
          if (!pos) pos = comp.pos;
        }
      }

      if (!hira && !hasKanji && KANA_ONLY_RE.test(orig)) {
        hira = kataToHira(orig);
      }
      if (!hira && !pos && pitch == null) return null;

      const furi = hasKanji && hira ? buildFuriParts(orig, hira, null, false) : [[orig, '']];
      const furiPitch = hasKanji && hira && pitch != null ? buildFuriParts(orig, hira, pitch, true) : furi;
      const romaji = kanaToRomaji(hira || orig, pos);
      const aid = {
        orig, pos, hasKanji, hira, romaji, pitch, furi, furiPitch, lemma, reading: '',
      };
      aid.reading = pickAidReading(aid, 'ja', mode, { showPitchAccent: showPitch });
      return aid;
    }

    if (lg === 'zh') {
      if (!HANZI_RE.test(orig)) return null;
      const direct = rich[orig];
      let py = direct ? direct.r : '';
      let pos = direct ? _posFromField(direct.v1) : '';
      if (!py && orig.length >= 2 && Object.keys(rich).length > 0) {
        const comp = _greedyCjkLookup(orig, rich, HANZI_RE, ' ');
        if (comp) {
          py = comp.r;
          if (!pos) pos = comp.pos;
        }
      }
      if (!py && !pos) return null;
      const zy = py ? pinyinToZhuyin(py) : '';
      const aid = { orig, pos, pinyin: py, zhuyin: zy, reading: '' };
      aid.reading = pickAidReading(aid, 'zh', mode, opts);
      return aid;
    }

    if (lg === 'yue') {
      if (!HANZI_RE.test(orig)) return null;
      const core = YUE_CORE_CHARS[orig];
      const direct = (YUE_CORE_PRIORITY.has(orig) && core) ? { r: core[0], v1: core[1] } : (rich[orig] || (core ? { r: core[0], v1: core[1] } : null));
      let jp = direct ? direct.r : '';
      let pos = direct ? _posFromField(direct.v1) : '';
      if (!jp && orig.length >= 2) {
        const comp = _greedyCjkLookup(orig, rich, HANZI_RE, ' ');
        if (comp) {
          jp = comp.r;
          if (!pos) pos = comp.pos;
        } else if (Array.from(orig).every((c) => YUE_CORE_CHARS[c] || (rich[c] && rich[c].r))) {
          const chars = Array.from(orig);
          jp = chars.map((c) => (YUE_CORE_PRIORITY.has(c) && YUE_CORE_CHARS[c] ? YUE_CORE_CHARS[c][0] : (rich[c] ? rich[c].r : YUE_CORE_CHARS[c][0]))).join(' ');
        }
      }
      if (!jp && !pos) return null;
      const aid = { orig, pos, jyutping: jp, reading: jp };
      aid.reading = pickAidReading(aid, 'yue', mode, opts);
      return aid;
    }

    if (lg === 'ko') {
      if (!HANGUL_RE.test(orig)) return null;
      let stem = orig;
      let suffix = '';
      let direct = rich[orig];
      if (!direct && HANGUL_ONLY_RE.test(orig)) {
        for (const p of KO_PARTICLES_OFFLINE) {
          if (orig.length > p.length && orig.endsWith(p)) {
            const cand = orig.slice(0, -p.length);
            if (rich[cand]) {
              stem = cand;
              suffix = p;
              direct = rich[cand];
              break;
            }
          }
        }
      }
      const pron = direct && direct.r && HANGUL_RE.test(direct.r) ? direct.r + suffix : '';
      const hanja = direct && direct.v1 && HANZI_RE.test(direct.v1) ? direct.v1 + suffix : '';
      const rrBase = direct && direct.r
        ? (HANGUL_RE.test(direct.r) ? hangulToRR(direct.r) : direct.r)
        : hangulToRR(stem);
      const romaji = suffix ? rrBase + hangulToRR(suffix) : rrBase;
      const aid = {
        orig,
        pos: direct ? _posFromField(direct.v1) : '',
        pron,
        hanja,
        romaji,
        reading: '',
      };
      aid.reading = pickAidReading(aid, 'ko', mode, opts);
      return aid;
    }

    if (lg === 'ru' || lg === 'tl') {
      let marked = orig;
      if (rawOrRichDict && rawOrRichDict.__ssRich) {
        const low = orig.toLowerCase();
        const rec = rich[low] || (lg === 'ru' ? rich[low.replace(/ё/g, 'е')] : null);
        if (rec && rec.r) marked = applyInlineMarks(orig, { [low]: rec.r }, lg);
      } else {
        marked = applyInlineMarks(orig, rawOrRichDict, lg);
      }
      if (!marked || marked === orig) return null;
      return { orig, pos: '', stress: marked, reading: marked };
    }

    return null;
  };

  const _getSegmenter = (lang) => {
    const rawL = String(lang || '').toLowerCase();
    const loc = rawL === 'yue' ? 'zh-Hant-HK' : (rawL.split(/[-_]/)[0] || 'und');
    if (_segCache[loc] !== undefined) return _segCache[loc];
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        _segCache[loc] = new Intl.Segmenter(loc, { granularity: 'word' });
        return _segCache[loc];
      }
    } catch {}
    _segCache[loc] = null;
    return null;
  };

  const annotateTokensOffline = (tokensOrText, lang, rawOrRichDict, opts = {}) => {
    const rich = rawOrRichDict ? normalizeRichReadDict(rawOrRichDict) : Object.create(null);
    const LANG = typeof globalThis !== 'undefined' ? globalThis.SS_LANG : null;
    let toks = null;
    if (Array.isArray(tokensOrText)) {
      toks = tokensOrText;
    } else {
      const text = String(tokensOrText || '');
      if (!text) return [];
      if (LANG && typeof LANG.get === 'function') {
        toks = LANG.get(lang).split(text);
      } else {
        const seg = _getSegmenter(lang);
        if (seg) {
          toks = [];
          for (const s of seg.segment(text)) toks.push({ w: s.segment, word: !!s.isWordLike });
        } else {
          toks = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]+|[\u3040-\u309f]+|[\u30a0-\u30ffー]+|[\uac00-\ud7af]+|\p{L}+|\s+|./gu) || [text]).map((w) => ({ w, word: /[\p{L}\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(w) }));
        }
      }
    }
    toks = mergeCjkDictTokens(toks, lang, rich, opts.cutPointsSet || null);
    const out = [];
    for (const item of toks) {
      const orig = typeof item === 'string' ? item : String((item && (item.w || item.orig || item.surface || item.text)) || '');
      if (!orig) continue;
      const aid = lookupTokenAid(orig, lang, rich, opts);
      out.push(aid ? Object.assign({ isWord: true }, aid) : { orig, isWord: /[\p{L}\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(orig), pos: '', reading: '' });
    }
    return out;
  };

  return {
    normalizeReadDict,
    normalizeRichReadDict,
    applyInlineMarks,
    lookupKoReading: lookupKoReadingRich,
    pinyinSyllableToZhuyin,
    pinyinToZhuyin,
    detectPinyinTone,
    detectZhuyinTone,
    detectJyutpingTone,
    inferReadingScheme,
    tokenizeReadingTones,
    applyPitchPref,
    kataToHira,
    splitMoras,
    applyJaPitchStr,
    buildFuriParts,
    kanaToRomaji,
    hangulToRR,
    pickAidReading,
    mergeCjkDictTokens,
    lookupTokenAid,
    annotateTokensOffline,
  };
})();

if (typeof globalThis !== 'undefined' && typeof window !== 'undefined' && window.SS_READINGS) {
  globalThis.SS_READINGS = window.SS_READINGS;
}
