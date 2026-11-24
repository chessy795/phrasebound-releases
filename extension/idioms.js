// IdiomsTube pedagogical engine (Lin 2022 ReCALL; Lin 2025 corpus chapter; other heuristics are our own)
// + Language Reactor personal coverage, deceptive transparency detection, syntactic boundaries,
// 12-language 4-family matching (CJK/Hangul · Germanic V2 separable brackets · Romance clitics/negation · Slavic/Tagalog),
// MAGPIE empirical idiom_prior gating, N×N lazy gloss sidecar resolver, & ASR abstention.
(typeof window !== "undefined" ? window : globalThis).SS_IDIOMS = (typeof globalThis !== "undefined" && globalThis.SS_IDIOMS) || (() => {
  const _feCache = new WeakMap();
  const _cjkCache = new WeakMap();

  const PARTICLES = new Set(['up', 'down', 'in', 'out', 'on', 'off', 'away', 'back', 'over', 'through', 'around', 'apart', 'aside', 'forth']);
  // English typed slots (Claude, round 3): <poss> one possessive (+ optional "own"), <refl> a reflexive, <obj> 1-3 words.
  const POSS_WORDS = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their', "one's", "someone's", "somebody's"]);
  const REFL_WORDS = new Set(['myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves', 'oneself']);
  const PERSON_WORDS = new Set([
    'me', 'you', 'him', 'her', 'us', 'them', 'one', 'someone', 'somebody', 'anyone', 'anybody', 'everyone', 'everybody',
    'no one', 'nobody', 'who', 'whom', 'man', 'woman', 'guy', 'girl', 'boy', 'kid', 'child', 'person', 'people',
    'friend', 'boss', 'doctor', 'father', 'mother', 'dad', 'mom', 'brother', 'sister', 'husband', 'wife', 'son', 'daughter',
    ...REFL_WORDS,
  ]);
  const isSlot = (p) => p === '*' || p === '**' || p === '<poss>' || p === '<refl>' || p === '<obj>' || p === '<person>';
  // English phrasal verbs only split around an object with these adverb particles ("pick it up", not "pick a spot on").
  const SEPARABLE = new Set(['up', 'down', 'out', 'off', 'away', 'back', 'over', 'around', 'apart', 'aside', 'forth', 'together']);
  const MOTION_VERBS = new Set(['run', 'go', 'come', 'walk', 'sit', 'stand', 'lie', 'live', 'stay', 'sleep', 'work', 'play', 'swim', 'fly', 'jump', 'drive', 'ride']);
  const SPATIAL_PREP = new Set(['in', 'on']);
  const NON_OBJ_FOLLOWERS = new Set(['and', 'or', 'but', 'so', 'then', 'too', 'again', 'now', 'here', 'there', 'when', 'where', 'while', 'because']);
  const CLAUSE_BREAK_WORDS = new Set([
    'because', 'although', 'though', 'while', 'unless', 'whereas', 'however',
    'but', 'and', 'or', 'if', 'when', 'that', 'which', 'who', 'where',
  ]);
  const DE_CLAUSE_BREAK = new Set(['und', 'oder', 'aber', 'denn', 'sondern', 'weil', 'dass', 'ob', 'wenn', 'als', 'obwohl', 'während', 'bevor', 'nachdem', 'damit']);
  const SKIP_BLOCKERS = new Set(['of', 'from', 'with', 'to', 'in', 'on', 'at', 'for', 'by', 'is', 'are', 'was', 'were']);
  const HARD_PUNCT_RE = /[.;:!?—–()\[\]\n"«»„“]/;
  const COMMA_RE = /[,]/;

  // German separable verb prefixes (longest-first) for V2 clause-end bracket generation
  const DE_SEP_PREFIXES = [
    'zurück', 'zusammen', 'weiter', 'wieder', 'heraus', 'herein', 'herum', 'herunter', 'hinauf', 'hinaus', 'hinein',
    'vorbei', 'davon', 'dabei', 'daran', 'darauf', 'daraus',
    'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'fest', 'frei', 'her', 'hin', 'los', 'mit', 'nach', 'rein', 'raus', 'rum',
    'vor', 'weg', 'zu', 'um', 'durch',
    // adverb/adjective particles (stattfinden, wahrnehmen, totschweigen, großziehen, guttun, fertigmachen)
    'statt', 'wahr', 'fern', 'hoch', 'voran', 'voraus', 'zurecht', 'hinterher', 'entgegen', 'nieder', 'dar', 'hinweg',
    'herbei', 'drauflos', 'kaputt', 'schief', 'tot', 'lieb', 'kurz', 'groß', 'gut', 'fertig', 'dicht', 'quer', 'rückwärts', 'kennen',
  ];
  const DE_REFL_PRON = new Set(['mich', 'dich', 'sich', 'uns', 'euch', 'mir', 'dir']);
  const DE_INDEF_OBJ = new Set(['jemandem', 'jemanden', 'jemand', 'jmdm', 'jmdn', 'etwas', 'etw', 'einen', 'einem']);

  // Romance transparent clitic / negation / auxiliary tokens skipped across discontinuous MWE spans
  const ROMANCE_CLITICS = {
    fr: new Set(['me', 'te', 'se', 'le', 'la', 'les', 'lui', 'leur', 'nous', 'vous', 'y', 'en', 'ce', "m'", "t'", "s'", "l'", "n'", 'ne']),
    es: new Set(['me', 'te', 'se', 'le', 'les', 'lo', 'la', 'los', 'las', 'nos', 'os']),
    pt: new Set(['me', 'te', 'se', 'lhe', 'lhes', 'nos', 'vos', 'o', 'a', 'os', 'as']),
    it: new Set(['mi', 'ti', 'si', 'ci', 'vi', 'lo', 'la', 'li', 'le', 'gli', 'ne', 'ce', 'se', "m'", "t'", "s'", "l'", "c'", "n'"]),
  };
  const ROMANCE_NEG_ADV = {
    fr: new Set(['ne', "n'", 'pas', 'plus', 'jamais', 'rien', 'guère', 'point', 'vraiment', 'bien', 'tout', 'même', 'encore', 'déjà', 'trop']),
    es: new Set(['no', 'nunca', 'jamás', 'tampoco', 'ya', 'muy', 'tan', 'más', 'bien', 'realmente']),
    pt: new Set(['não', 'nunca', 'jamais', 'já', 'bem', 'muito', 'mais', 'mesmo', 'realmente']),
    it: new Set(['non', 'mai', 'più', 'mica', 'proprio', 'davvero', 'veramente', 'affatto', 'già', 'ancora', 'molto', 'bene']),
    ru: new Set(['не', 'ни', 'же', 'ли', 'бы', 'уже', 'мне', 'тебе', 'ему', 'ей', 'нам', 'вам', 'им', 'себе']),
    tl: new Set(['ko', 'mo', 'ka', 'niya', 'namin', 'natin', 'ninyo', 'nila', 'siya', 'ako', 'ba', 'pa', 'na', 'nga', 'lang', 'lamang', 'din', 'rin', 'daw', 'raw', 'po', 'ho', 'pala', 'naman', 'muna', 'sana']),
  };
  const ROMANCE_AUX_LEMMAS = {
    fr: new Set(['être', 'avoir', 'aller', 'venir']),
    es: new Set(['estar', 'haber', 'ir', 'seguir', 'andar']),
    pt: new Set(['estar', 'ter', 'haver', 'ir']),
    it: new Set(['essere', 'avere', 'stare', 'andare']),
  };

  // CJK gap & separable VO aspect constants
  const CJK_GAP_STOP = /[，。！？；：、,.!?—–()\[\]「」『』"'\n\r]/;
  const VO_ASPECT_CHARS = new Set(['咗', '左', '緊', '紧', '過', '过', '埋', '晒', '哂', '返', '番', '住', '親', '亲', '了', '着']);
  const YUE_VARIANT_PAIRS = [
    ['越', '愈'], ['愈', '越'],
    ['返', '番'], ['番', '返'],
    ['晒', '哂'], ['哂', '晒'],
    ['嘅', '既'], ['咗', '左'],
    ['嚟', '黎'], ['俾', '畀'],
    ['咁', '噉'], ['冇', '無'],
    ['諗', '稔'], ['係', '系'],
  ];
  const HAN_ONLY_RE = /^[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]+$/u;
  const HAN_START_RE = /^[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/u;
  const VO_LEAD_VERBS = new Set(Array.from(
    '食吃打落睇看執爆發放瞓睡煲篤甩出撳過搵找賣買拍吊收跳傾講說揸拿捉埋拉搭起開關走跑行轉返回劏殺入搞做扮攞拗砌洗穿戴扯擔孭托遊扒扭曬插交彈夾啪撥剝度問攝踩踏見車摱拖掛請衝釘掟頂中坐鬥耍嘆餵飲喝散標炒溝屙晾抹掹借擺燉浸摸捱咬拋剃佗撬揩撞吹捧擦潑背揹抱抬舉丟掉偷搶騙呃氹哄追趕留守破拆搬推搖揮踢騎企站躺靠領帶送還欠賺蝕賠輸贏爭救幫扶養造寫畫讀聽聞唱笑喊哭罵鬧讚誇求拜祭敬愛恨怕驚想念記忘信疑學教練試用使花費慳省儲蓄租當鎖封塞堵通建裝修補改換移調排拾撿尋逃飛爬游潛闖進退升跌停歇醒病醫治嫁娶辭包攬負受享吞吐嚼舐吸望答應叫扑揼斬切割刺縫織掃刷煮煎炸蒸焗炆醃斟倒盛載袋拎攬錫惜嚇賭除脫笠綁紮擲射立製抄印諗估計嬲怨怪責罰賞玩整弄幹辦管陪跟迎撞遇碰識認結聚'
  ));
  const VO_NON_OBJ_SECOND = new Set(Array.from('唔不沒冇得到晒哂返番埋落起出入開完好死實定住緊咗左過过了着嚟黎'));
  const VO_BAD_PREFIX = new Set(Array.from('唔冇不無亞一二三四五六七八九十百千萬半全老阿大細好真幾最'));
  const EN_SUBJ_PRONOUNS = new Set(['one', 'i', 'you', 'he', 'she', 'we', 'they', 'someone', 'somebody']);

  // General syntactic & concrete physical domain anchors for English literalness disambiguation (instance-level litRisk)
  const LIT_SPATIAL_POST = new Set(['in', 'into', 'on', 'onto', 'at', 'around', 'near', 'inside', 'through', 'under', 'across', 'behind', 'beside']);
  const LIT_CONCRETE_SPATIAL_HEADS = new Set([
    'carpet', 'rug', 'floor', 'shelf', 'shelves', 'table', 'wall', 'ceiling', 'seat', 'wheel', 'plug', 'socket',
    'book', 'books', 'black', 'white', 'high', 'low', 'way', 'tree', 'trees', 'stars', 'moon', 'sun', 'gas',
    'level', 'picture', 'dark', 'hot', 'water', 'fire', 'ice', 'bridge', 'door', 'window', 'hat', 'shoes', 'day',
    'pieces', 'piece', 'cards', 'card', 'blood', 'market', 'fog', 'lost',
  ]);
  const LIT_CONTEXT_DOMAINS = {
    spatial: new Set([
      'floor', 'room', 'rooms', 'hall', 'hallway', 'stairs', 'wall', 'walls', 'ceiling', 'door', 'doors',
      'window', 'windows', 'table', 'chair', 'bed', 'bath', 'sink', 'drain', 'socket', 'plug', 'cord',
      'cable', 'wire', 'vacuum', 'stain', 'carpet', 'rug', 'sweep', 'wash', 'cleaned', 'clean', 'sit',
      'sat', 'sitting', 'stand', 'stood', 'standing', 'lie', 'lay', 'lying', 'walk', 'walked', 'step',
      'stepped', 'shelf', 'drawer', 'cupboard', 'cabinet', 'ladder', 'branch', 'branches', 'climb', 'climbed',
      'driver', 'passenger', 'car', 'vehicle', 'steering', 'library', 'pages', 'chapter', 'published', 'bookcase',
      'author', 'novel', 'edition', 'textbook', 'pottery', 'glass', 'wood', 'metal', 'coins', 'paper', 'bent',
    ]),
    visualPrint: new Set([
      'photo', 'photos', 'photograph', 'photographs', 'film', 'films', 'movie', 'camera', 'television',
      'tv', 'print', 'printed', 'printing', 'page', 'pages', 'ink', 'paint', 'painted', 'color', 'colour',
      'colors', 'colours', 'dressed', 'wearing', 'wore', 'shirt', 'suit', 'dress', 'jacket', 'skirt',
      'tiles', 'paper', 'shot', 'shots', 'screen', 'frame', 'portrait', 'drawing', 'white', 'black', 'grey', 'gray',
    ]),
    measure: new Set([
      'inches', 'inch', 'feet', 'foot', 'meters', 'metres', 'miles', 'kilometers', 'degrees', 'percent',
      'temperature', 'temperatures', 'pressure', 'altitude', 'tide', 'tides', 'sea', 'ground', 'ceiling', 'floor',
      'frequency', 'frequencies', 'voltage', 'amplitude', 'prices', 'rates', 'levels', 'water', 'tank', 'fuel', 'petrol',
      'income', 'incomes', 'risk', 'risks', 'cost', 'costs', 'wage', 'wages', 'quality', 'volume', 'speed', 'season',
      'points', 'notes', 'end', 'ends', 'medium', 'general', 'long', 'busy', 'working', 'school', 'shift', 'evening',
      'night', 'morning', 'afternoon', 'week', 'month', 'year', 'weekend', 'summer', 'winter', 'match', 'game',
    ]),
    skyNature: new Set([
      'sky', 'night', 'telescope', 'planet', 'planets', 'galaxy', 'constellation', 'orbit', 'space',
      'forest', 'woods', 'jungle', 'trail', 'path', 'map', 'maps', 'compass', 'bark', 'leaves', 'trunk',
      'radio', 'instructions', 'directions', 'prevent', 'easily', 'maze', 'mist', 'cloud', 'clouds', 'driving',
    ]),
  };
  const ALL_LIT_ANCHORS = new Set([
    ...LIT_CONTEXT_DOMAINS.spatial,
    ...LIT_CONTEXT_DOMAINS.visualPrint,
    ...LIT_CONTEXT_DOMAINS.measure,
    ...LIT_CONTEXT_DOMAINS.skyNature,
  ]);
  const DETERMINER_START = new Set(['the', 'a', 'an']);
  const inferContextualLitRisk = (wordToks, hitWordIdxs, cand) => {
    const firstIdx = hitWordIdxs[0];
    const lastIdx = hitWordIdxs[hitWordIdxs.length - 1];
    const parts = cand.parts || [];
    const nextTok = lastIdx + 1 < wordToks.length ? wordToks[lastIdx + 1] : null;
    const prevTok = firstIdx - 1 >= 0 ? wordToks[firstIdx - 1] : null;
    const prev2Tok = firstIdx - 2 >= 0 ? wordToks[firstIdx - 2] : null;
    const dispLow = String(cand.display || '').toLowerCase();

    // 1. Post-NP genitive/partitive 'of' following [prep? + DET + NOUN] idioms ("on the level of...", "at the end of the busy day")
    if (
      parts.length >= 2 &&
      !parts.includes('of') &&
      DETERMINER_START.has(parts[parts.length - 2]) &&
      nextTok && !nextTok.hardPunctBefore && !nextTok.commaBefore &&
      (nextTok.low === 'of' || (LIT_SPATIAL_POST.has(nextTok.low) && parts.length <= 3))
    ) {
      return true;
    }

    // 2. Imperative vs literal 'get lost' (imperative idiom stands alone; literal appears with modals, inflections, or destinations)
    if (dispLow === 'get lost') {
      const headLow = wordToks[firstIdx] ? wordToks[firstIdx].low : '';
      if (headLow !== 'get') return true;
      if (nextTok && !nextTok.hardPunctBefore && !nextTok.commaBefore && LIT_SPATIAL_POST.has(nextTok.low)) return true;
      if (prevTok && !wordToks[firstIdx].hardPunctBefore && /^(if|when|we|they|you|he|she|could|might|may|would|will|can|easily|never|always|often|sometimes|to|from|in)$/.test(prevTok.low)) {
        return true;
      }
      if (prev2Tok && /^(could|might|may|would|prevent|if|until|when)$/.test(prev2Tok.low)) return true;
    }

    // 3. Literal binomial modifier usage ("high and low [pressure/tide/risk/costs/end]", "between high and low")
    if (dispLow === 'high and low' || dispLow === 'in black and white') {
      if (prevTok && /^(between|both|from|in|on|with|the|a)$/.test(prevTok.low) && dispLow === 'high and low') return true;
      if (nextTok && !nextTok.hardPunctBefore && !nextTok.commaBefore && ALL_LIT_ANCHORS.has(nextTok.low)) return true;
    }

    // 4. Concrete physical domain cohesion: expression contains concrete noun/spatial/color word AND +/-6 window has physical anchor
    const hitSet = new Set(hitWordIdxs);
    const hasConcreteHead = parts.some((p) => LIT_CONCRETE_SPATIAL_HEADS.has(String(p).replace(/^=/, '')));
    if (hasConcreteHead) {
      const wStart = Math.max(0, firstIdx - 6);
      const wEnd = Math.min(wordToks.length - 1, lastIdx + 6);
      for (let k = wStart; k <= wEnd; k++) {
        if (hitSet.has(k)) continue;
        const t = wordToks[k];
        if (!t) continue;
        if (ALL_LIT_ANCHORS.has(t.low) || ALL_LIT_ANCHORS.has(t.lem)) return true;
      }
    }
    return false;
  };

  // Normalize BCP-47 tags across all 12 languages ('yue' distinct from 'zh', 'fil'/'tgl' -> 'tl').
  const normLang = (lang) => {
    const raw = String(lang || 'en').trim().toLowerCase().replace(/_/g, '-');
    if (!raw) return 'en';
    if (raw === 'yue' || raw.startsWith('yue-') || raw === 'zh-hk' || raw === 'zh-yue' || raw.endsWith('-hk') || raw.includes('-yue')) return 'yue';
    const base = raw.split('-')[0];
    if (base === 'cn' || base === 'cmn' || base === 'zho') return 'zh';
    if (base === 'fil' || base === 'tgl') return 'tl';
    if (base === 'spa') return 'es';
    if (base === 'fra' || base === 'fre') return 'fr';
    if (base === 'deu' || base === 'ger') return 'de';
    if (base === 'por') return 'pt';
    if (base === 'ita') return 'it';
    if (base === 'rus') return 'ru';
    if (base === 'jpn') return 'ja';
    if (base === 'kor') return 'ko';
    return base || 'en';
  };

  const isCjkLang = (lang) => /^(?:zh|yue|ja|ko)$/.test(normLang(lang));

  // Full 12-language x 9-layer native phraseological terminology (熟语 / 熟語 / 숙어 / fraseología / Phraseologismen / фразеологизмы / sawikain)
  const NATIVE_LABELS = {
    zh:  { classical: '成语', proverb: '谚语 / 俗语', idiom: '惯用语', riddle: '歇后语', slang: '流行语', social: '客套话', frame: '句式', colloc: '搭配' },
    yue: { classical: '成語', proverb: '俗語 / 諺語', idiom: '慣用語', riddle: '歇後語', slang: '俚語 / 潮語', social: '客套話', frame: '句式', colloc: '搭配' },
    ja:  { classical: '四字熟語 / 故事成語', proverb: 'ことわざ', idiom: '慣用句', slang: '若者言葉', social: '決まり文句 / 挨拶', frame: '文型', colloc: '連語' },
    ko:  { classical: '사자성어 / 고사성어', proverb: '속담', idiom: '관용구', slang: '신조어', social: '인사말', frame: '문형', colloc: '연어' },
    en:  { classical: 'classical allusion', proverb: 'proverb', idiom: 'idiom', riddle: 'Wellerism', phrasal: 'phrasal verb', slang: 'slang', social: 'social formula', frame: 'sentence frame', colloc: 'collocation' },
    es:  { classical: 'latinismo', proverb: 'refrán', idiom: 'modismo / locución', slang: 'jerga juvenil', social: 'fórmula de cortesía', frame: 'estructura', colloc: 'colocación' },
    fr:  { classical: 'locution latine', proverb: 'proverbe / dicton', idiom: 'expression idiomatique', slang: 'argot / verlan', social: 'formule de politesse', frame: 'tournure', colloc: 'collocation' },
    de:  { classical: 'geflügelte Worte', proverb: 'Sprichwort', idiom: 'Redewendung', riddle: 'Sagwort', phrasal: 'trennbares Verb', slang: 'Jugendsprache', social: 'Höflichkeitsformel', frame: 'Satzmuster', colloc: 'Kollokation' },
    pt:  { classical: 'latinismo', proverb: 'provérbio / ditado', idiom: 'expressão idiomática', slang: 'gíria', social: 'fórmula de cortesia', frame: 'estrutura', colloc: 'colocação' },
    it:  { classical: 'locuzione latina', proverb: 'proverbio', idiom: 'modo di dire', slang: 'gergo giovanile', social: 'formula di cortesia', frame: 'costrutto', colloc: 'collocazione' },
    ru:  { classical: 'крылатые выражения', proverb: 'пословица / поговорка', idiom: 'фразеологизм', slang: 'сленг', social: 'речевой этикет', frame: 'конструкция', colloc: 'словосочетание' },
    tl:  { proverb: 'salawikain', idiom: 'sawikain / idyoma', slang: 'balbal', social: 'magalang na pananalita', frame: 'balangkas', colloc: 'kolokasyon' },
  };

  const resolveNativeLabel = (layer, type, langCode, explicitNative = '') => {
    if (explicitNative) return explicitNative;
    const lg = normLang(langCode || 'en');
    const tbl = NATIVE_LABELS[lg] || NATIVE_LABELS.en;
    const s = `${layer || ''} ${type || ''}`.toLowerCase();
    if (/classical|allusion|chengyu|yojijukugo|sajaseongeo|winged|latinism|成语|成語|四字熟語|故事成語|사자성어|고사성어|крылат|geflügelt/.test(s)) return tbl.classical || tbl.idiom || '';
    if (/riddle|xiehouyu|wellerism|sagwort|歇后语|歇後語/.test(s)) return tbl.riddle || tbl.proverb || '';
    if (/proverb|saying|refrán|sprichwort|ditado|пословиц|поговорк|salawikain|谚语|諺語|ことわざ|속담/.test(s)) return tbl.proverb || '';
    if (/phrasal|trennbar/.test(s) && tbl.phrasal) return tbl.phrasal;
    if (/slang|argot|verlan|jerga|jugendsprache|gíria|gergo|сленг|balbal|潮語|俚語|流行语|若者言葉|신조어/.test(s)) return tbl.slang || '';
    if (/social|set phrase|greeting|courtesy|politesse|cortesía|cortesia|höflichkeit|этикет|magalang|客套|挨拶|決まり文句|인사말/.test(s)) return tbl.social || '';
    if (/frame|pattern|construction|estructura|tournure|satzmuster|costrutto|конструкц|句式|文型|문형/.test(s)) return tbl.frame || '';
    if (/colloc|lvc|light verb|kollokation|словосочетан|kolokasyon|搭配|連語|연어/.test(s)) return tbl.colloc || '';
    return tbl.idiom || '';
  };

  // Canonical 4-bucket layer classifier across all 12 languages
  const classifyLayer = (layer, type) => {
    const l = String(layer || '').toLowerCase();
    const t = String(type || '').toLowerCase();
    const s = l + ' ' + t;
    if (l === 'frame' || /frame|pattern|construction|snowclone|correlative|estructura|tournure|satzmuster|costrutto|конструкц|句式|文型|문형/.test(s)) return 'frame';
    if (l === 'collocation' || /collocation|colocación|kollokation|colocação|collocazione|словосочетан|kolokasyon|lvc|light verb|搭配|連語|연어/.test(s)) return 'colloc';
    if (l === 'slang' || l === 'social' || l === 'set phrase' || /slang|social|set phrase|cultural|greeting|discourse|argot|verlan|jerga|jugendsprache|gíria|gergo|сленг|balbal|politesse|cortesía|cortesia|höflichkeit|этикет|magalang|挨拶|決まり文句|若者言葉|신조어|인사말|俚|潮語|流行语|客套/.test(s)) return 'slang';
    return 'idiom';
  };

  const BUNDLE_LAYERS = new Set(['frame', 'collocation']);
  const isBundleType = (layer, type) =>
    BUNDLE_LAYERS.has(layer || '') || BUNDLE_LAYERS.has(type || '') || /frame|collocation/i.test(type || '');

// Reviewed constructions supplement the generated packs. Keep the displayed
  // span specific enough to explain the construction or its contextual sense.
  const hasKoreanFutureEnding = text => {
    const final = text.split(/\s/u, 1)[0].at(-1);
    return final && (final.charCodeAt(0) - 0xAC00) % 28 === 8;
  };
  const REVIEWED_EXPRESSIONS = {
    ko: [
      ['-다 보면', 'frame', /(?<![가-힣])[가-힣]{1,10}다\s+보면(?![가-힣])/gu, 'When you keep doing something, a result tends to follow.'],
      ['N에 따르면', 'frame', /(?<![가-힣])[가-힣]{1,14}\s*에\s+따르면(?![가-힣])/gu, 'According to the source cited.'],
      ['-(으)ㄹ 줄 알다', 'frame', /(?<![가-힣])[가-힣]{1,11}\s+줄\s+알(?:아요|아|았[가-힣]*|게\s+되[가-힣]*|다)(?![가-힣])/gu, 'Know how to do something, or expect that something will happen. Check the surrounding dialogue.', hasKoreanFutureEnding],
      ['-는 줄 알다', 'frame', /(?<![가-힣])[가-힣]{1,10}는\s+줄\s+알았[가-힣]*/gu, 'Thought that something was the case.'],
      ['스트레스가 풀리다', 'collocation', /스트레스[가도]\s+풀[가-힣]+/gu, 'Stress eases or wears off.'],
      ['스트레스를 풀다', 'collocation', /스트레스(?:를|도)\s+풀(?:다|어[가-힣]*|었[가-힣]*|고|면)(?![가-힣])/gu, 'Relieve stress.'],
      ['원하는 만큼', 'frame', /(?<![가-힣])원하는\s+만큼(?![가-힣])/gu, 'As much as someone wants.'],
      ['-(으)ㄹ 수 있다', 'frame', /(?<![가-힣])[가-힣]{1,11}\s+수(?:도|는)?\s+있(?:다|어요|어|습니다|죠|게|고|었[가-힣]*)(?![가-힣])/gu, 'Can or may, depending on context.', hasKoreanFutureEnding],
    ],
    tl: [
      ['tuloy po kayo', 'social', /\btuloy\s+(?:po\s+)?kayo\b/giu, 'Please come in. Po makes the invitation polite.'],
      ['nga pala', 'social', /\bnga\s+pala\b/giu, 'By the way. Introduces something just remembered.'],
      ['di ba', 'social', /\b(?:hindi|di)\s+ba(?=\s*[?!.,…]?\s*$)/giu, 'Right? Invites the listener to confirm something.'],
      ['hindi lang … din/rin', 'frame', /\bhindi\s+(?:(?:ko|mo|niya|natin|namin|ninyo|nila|siya|kami|tayo|kayo|sila)\s+)?(?:lang|lamang)\b[^.!?;\n]{3,105}?\b(?:din|rin)\b/giu, 'Not only the first thing. The second also applies.'],
      ['gawa sa', 'frame', /\bgawa\s+sa\s+(?:kahoy|plastik|buhangin|bakal|papel|salamin|bato|tela|luwad|metal|ginto|karton|semento)\b/giu, 'Made from the material named.'],
      ['sa murang edad', 'collocation', /\bsa\s+murang\s+edad\b/giu, 'At a young age.'],
      ['kung paano', 'frame', /\bkung\s+paano\b/giu, 'How something is done or happens.'],
      ['oo nga', 'social', /\boo\s+nga\b/giu, 'Acknowledges or agrees with what was just said.'],
    ],
    es: [
      ['por lo que', 'frame', /\bpor\s+lo\s+que\b(?!\s+(?:sea|sé|sepa|parece|dices?|veo|más|me\s+(?:dices|cuentas))\b)/giu, 'Which is why. Introduces a consequence.',
        (surface, text, start) => start === 0 || /[,;.!?]\s*$/u.test(text.slice(0, start))],
    ],
    fr: [
      ['faire du porte-à-porte', 'collocation', /\b(?:faire|fait|fais|faisons|font|faisait)\s+du\s+porte[-\s]+à[-\s]+porte\b/giu, 'Go from door to door.'],
      ['en face de', 'frame', /\ben\s+face\s+(?:de\b|du\b|des\b|d['’])/giu, 'In front of or in the immediate presence of someone or something.'],
    ],
    de: [
      ['Sprung ins kalte Wasser', 'idiom', /\bSprung\s+ins\s+kalte\s+Wasser\b/gu, 'A leap into an unfamiliar situation without much preparation.'],
      ['am Laufen halten', 'collocation', /\b(?:am\s+Laufen\s+(?:zu\s+)?halten|[Hh](?:ält|alte|alten|ielt|ielten)\s+[^.!?,;\n]{2,65}\s+am\s+Laufen)\b/gu, 'Keep something running.'],
    ],
    pt: [
      ['ter tudo a ver', 'idiom', /\b(?:ter|tem|têm|tinha|tinham|teve|tiveram)\s+tudo\s+a\s+ver\b/giu, 'Be strongly related or relevant.'],
    ],
    it: [
      ['valere la pena', 'idiom', /\b(?:ne\s+)?(?:vale|valga|valeva|valere|valerne)(?:\s+(?:davvero|proprio|ancora|assolutamente))?\s+la\s+pena\b/giu, 'Be worth the effort.'],
    ],
    ru: [
      ['без обид', 'social', /(?<![\p{L}\p{M}])без\s+обид(?![\p{L}\p{M}])/giu, 'No hard feelings. Used to soften what is said.'],
      ['вряд ли', 'frame', /(?<![\p{L}\p{M}])вряд\s+ли(?![\p{L}\p{M}])/giu, 'Unlikely. Expresses doubt.'],
    ],
    zh: [['越来越', 'frame', /越[来來]越/gu, 'Increasingly. More and more.']],
    yue: [['對…嚟講', 'frame', /[對对](?:我|你|佢|我哋|你哋|佢哋)[嚟來]講/gu, 'From the named person’s point of view.']],
    ja: [['〜というより', 'frame', /というより/gu, 'Rather than describing it as the first thing, the speaker prefers a different description.']],
  };

  const checkReviewedSurface = (lang, display, surface, text, start, end) => {
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end).trimStart();
    if (lang === 'es') {
      if (display === 'qué va') return /^qué\s+va$/iu.test(surface) &&
        (/[.!?¡¿:—]$/u.test(before) || !before) && (!after || /^[.!?,;…]/u.test(after));
      if (display === 'por qué' || display === 'para qué') return surface.toLowerCase().replace(/\s+/g, ' ') === display;
      if (display === 'qué te digo') return /^qué\s+te\s+digo$/iu.test(surface.normalize('NFC'));
      if (display === 'qué se dice') return /^qué\s+se\s+dice$/iu.test(surface.normalize('NFC'));
      if (display === 'de uñas') return /^de\s+uñas$/iu.test(surface);
    }
    if (lang === 'it' && display === 'di fatto') return /^di\s+fatto$/iu.test(surface);
    if (lang === 'pt') {
      if (display === 'é que') return /^é\s+que$/iu.test(surface);
      if (display === 'quer saber') return /^quer\s+saber$/iu.test(surface) && after.startsWith('?');
    }
    return true;
  };

  const appendReviewedExpressions = (text, lang, hits, rawStarts = null) => {
    const rules = REVIEWED_EXPRESSIONS[lang];
    if (!rules && lang !== 'en') return hits;
    const out = hits.map(h => {
      if (lang !== 'en' || h.display !== 'no way') return h;
      const rest = text.slice(h.charEnd);
      if (!/^[!…]+\s+.{2,110}\?\s*$/u.test(rest)) return h;
      return {...h, gloss: 'An exclamation of surprise or disbelief.', glossMap: null, contextualGloss: true};
    });
    for (const [display, type, pattern, gloss, accepts] of rules || []) {
      for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (accepts && !accepts(match[0], text, start)) continue;
        const startRaw = rawStarts ? rawStarts.indexOf(start) : -1;
        const nextRaw = rawStarts ? rawStarts.findIndex(pos => pos >= end) : -1;
        if (rawStarts && startRaw < 0) continue;
        const endRaw = rawStarts ? (nextRaw < 0 ? rawStarts.length : nextRaw) - 1 : -1;
        // Prefer a reviewed occurrence over overlapping fragments of that occurrence.
        // Do not hide a full match that extends beyond the construction.
        if (out.some(h => h.charStart <= start && h.charEnd >= end && (h.charStart < start || h.charEnd > end))) continue;
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].charStart >= start && out[i].charEnd <= end) out.splice(i, 1);
        }
        out.push({
          pattern: display, display, surface: match[0], type, layer: type, bucket: classifyLayer(type, type),
          native: resolveNativeLabel(type, type, lang), gloss, glossZh: '', reading: '', lit: '', eq: null,
          charStart: start, charEnd: end, startRaw, endRaw, anchorRanges: [[start, end]],
          litRawSet: new Set(), isBundle: false, litRisk: false, maxBand: 3, priority: 20, deceptive: false,
        });
      }
    }
    return out.sort((a, b) => a.charStart - b.charStart);
  };



  const CORE_EXPRESSIONS_EN = [
    ['in the distance', 'in the distance', 'collocation', 18.0, 2],
    ['up ahead', 'up ahead', 'collocation', 17.5, 2],
    ['think to oneself', 'think to oneself', 'collocation', 18.5, 2],
    ['think to myself', 'think to myself', 'collocation', 18.5, 2],
    ['think to yourself', 'think to yourself', 'collocation', 18.5, 2],
    ['think to himself', 'think to himself', 'collocation', 18.5, 2],
    ['think to herself', 'think to herself', 'collocation', 18.5, 2],
    ['grow dim', 'grow dim', 'collocation', 16.0, 3],
    ['grow heavy', 'grow heavy', 'collocation', 16.0, 2],
    ['stop for the night', 'stop for the night', 'collocation', 16.5, 2],
    ['mission bell', 'mission bell', 'cultural phrase', 15.5, 4],
    ['all of a sudden', 'all of a sudden', 'idiom', 21.0, 2],
    ['by the way', 'by the way', 'idiom', 22.0, 1],
    ['on the other hand', 'on the other hand', 'idiom', 21.0, 2],
    ['at the end of the day', 'at the end of the day', 'idiom', 20.5, 2],
    ['in the middle of', 'in the middle of', 'collocation', 19.0, 2],
    ['right away', 'right away', 'idiom', 20.0, 2],
    ['make sense', 'make sense', 'collocation', 21.0, 2],
    ['take place', 'take place', 'collocation', 20.0, 2],
    ['pay attention', 'pay attention', 'collocation', 20.5, 2],
    ['end up', 'end up', 'phrasal', 21.5, 2],
    ['turn out', 'turn out', 'phrasal', 21.0, 2],
    ['work out', 'work out', 'phrasal', 21.0, 2],
    ['figure out', 'figure out', 'phrasal', 22.0, 2],
    ['find out', 'find out', 'phrasal', 22.0, 1],
    ['show up', 'show up', 'phrasal', 20.5, 2],
    ['hang out', 'hang out', 'phrasal', 20.0, 2],
    ['point out', 'point out', 'phrasal', 20.0, 2],
    ['carry on', 'carry on', 'phrasal', 19.5, 2],
    ['look forward to', 'look forward to', 'phrasal', 20.5, 2],
    ['get used to', 'get used to', 'collocation', 20.5, 2],
    ['for good', 'for good', 'idiom', 19.5, 2],
    ['out of nowhere', 'out of nowhere', 'idiom', 19.5, 2],
    ['deep down', 'deep down', 'idiom', 18.5, 2],
  ];

  const isDeceptive = (type, maxBand, opacity = 0) =>
    opacity >= 1.2 || ((type === 'idiom' || type === 'proverb' || type === 'frame') && Number(maxBand || 5) <= 2);

  const COMMON_RANK = 250;
  const CORE_PATTERNS = new Set(CORE_EXPRESSIONS_EN.map((r) => r[0]));
  const WAY_CLAUSE = new Set(['i', 'you', 'he', 'she', 'we', 'they', 'it', 'that', 'this', 'people', 'things', 'my', 'your', 'his', 'her', 'their', 'our', 'the', 'a', 'some', 'someone', 'somebody']);
  const LITERAL_AFTER = { 'by the way': WAY_CLAUSE, 'in the way': WAY_CLAUSE };

  // Convert a display/key string in any non-CJK language into lemmatized pattern parts (preserving '*' / '…' / '...' wildcards)
  const patternizePhrase = (rawStr, L, langCode) => {
    const norm = String(rawStr || '')
      .trim()
      .replace(/…+|\.{2,}/g, ' * ')
      .replace(/\b(?:someone|somebody|sb\.?|algo|alguien|quelqu'un|qqn|qualcuno|alguém|jemandem|jemanden|jemand|jmdm\.?|jmdn\.?|etwas|etw\.?|кто-то|кому-то|что-то)\b/giu, '*');
    const chunks = norm.split(/\s+/).filter(Boolean);
    const parts = [];
    for (const ch of chunks) {
      if (ch === '*' || ch === '**') {
        if (parts[parts.length - 1] !== '*') parts.push('*');
        continue;
      }
      const subToks = L ? L.split(ch) : [{ w: ch, word: true }];
      for (const st of subToks) {
        if (!st.word) continue;
        const low = st.w.toLowerCase().replace(/’/g, "'");
        if (langCode && ROMANCE_CLITICS[langCode] && ROMANCE_CLITICS[langCode].has(low) && /^(?:se|s'|si|me|te)$/.test(low)) {
          // Reflexive pronoun on citation infinitives (e.g. "s'en foutre", "se mettre", "darse cuenta"):
          // keep 'en'/'y'/'ce'/'la' lexical clitics, make pure reflexive 'se'/'s'' optional in speech!
          continue;
        }
        if (langCode === 'de' && (low === 'sich' || DE_INDEF_OBJ.has(low))) {
          if (parts[parts.length - 1] !== '*') parts.push('*');
          continue;
        }
        // Tagalog: a phrase word that is already a root ("kita", "alam") must match as written, or the affix-stripping
        // lemmatizer lets "kita mo" match "ipakita mo"; affixed verb forms ("magsunog") still match any inflection by root
        const lm = L ? L.lemma(st.w) : low;
        parts.push(langCode === 'tl' && lm === low ? '=' + low : lm);
      }
    }
    // Trim leading/trailing '*' slots
    while (parts[0] === '*') parts.shift();
    while (parts[parts.length - 1] === '*') parts.pop();
    return parts;
  };

  // Split a German separable verb lemma ("vorstellen" -> ["vor", "stellen"], "aufnehmen" -> ["auf", "nehmen"])
  const splitGermanSepVerb = (verbLemma) => {
    const v = String(verbLemma || '').toLowerCase();
    if (!v || v === 'zuhaben' || v === 'zusein') return null;
    for (const pfx of DE_SEP_PREFIXES) {
      if (v.length >= pfx.length + 4 && v.startsWith(pfx) && v.endsWith('en')) {
        const base = v.slice(pfx.length);
        if (base.length >= 4 && !(base.startsWith('ge') && base.length < 5)) return [pfx, base];
      }
    }
    return null;
  };

  // Universal token-based FE indexer across English, German, Romance (es/fr/pt/it), Russian (ru), and Tagalog (tl).
  // Supports BOTH:
  //   - Legacy/English 5-6 tuple: [pattern, display, type, priority, maxBand, extra?]
  //   - Unified 8-tuple (Claude's multilingual schema): [display, type, priority, reading, gloss_en, gloss_zh, keys, extra]
  const buildFeIndex = (feJson, ranks, lang = 'en') => {
    const langCode = normLang((feJson && feJson.meta && feJson.meta.lang) || lang || 'en');
    if (feJson && _feCache.has(feJson)) return _feCache.get(feJson);
    const LANG = typeof SS_LANG !== 'undefined' ? SS_LANG : globalThis.SS_LANG;
    const L = LANG ? LANG.get(langCode) : null;

    const byFirst = new Map();
    const seenKey = new Set();
    const rawItems = (feJson && feJson.items) || [];
    const allRows = langCode === 'en' ? [...rawItems, ...CORE_EXPRESSIONS_EN] : rawItems;

    const pushParts = (parts, metaObj, opts = {}) => {
      if (!parts || parts.length < (opts.single ? 1 : 2)) return;
      const firstRaw = String(parts[0] || '');
      const first = firstRaw.replace(/^=/, '');
      if (!first || isSlot(parts[0])) return;
      const sig = `${metaObj.display}||${parts.join(' ')}||${opts.deBracket ? 1 : 0}`;
      if (seenKey.has(sig)) return;
      seenKey.add(sig);

      const fixedCount = parts.filter((p) => !isSlot(p)).length;
      const entry = Object.assign({}, metaObj, {
        parts,
        fixedCount,
        deBracket: !!opts.deBracket,
        lead: opts.lead || '',
        allowComma: /,/.test(metaObj.display || ''),
      });
      let arr = byFirst.get(first);
      if (!arr) byFirst.set(first, (arr = []));
      arr.push(entry);
      if (ROMANCE_LANGS.has(langCode) && firstRaw[0] !== '=') {
        const firstFold = foldAccents(first);
        if (firstFold && firstFold !== first) {
          let fArr = byFirst.get(firstFold);
          if (!fArr) byFirst.set(firstFold, (fArr = []));
          fArr.push(entry);
        }
      }
    };

    for (const row of allRows) {
      if (!Array.isArray(row) || row.length < 3) continue;
      // Detect unified 8-tuple vs English 5/6-tuple:
      // In 8-tuple, row[2] is numeric priority; in 5/6-tuple, row[2] is string type and row[3] is numeric priority.
      const isUnified8 = typeof row[2] === 'number';
      let rawPatterns = [];
      let display = '';
      let type = 'idiom';
      let priority = 18;
      let maxBand = 3;
      let reading = '';
      let glossEn = '';
      let glossZh = '';
      let ex = {};
      let rowLead = '';

      if (isUnified8) {
        const [disp, tp, pri, rd, gEn, gZh, keys, extra] = row;
        display = disp || '';
        type = tp || 'idiom';
        priority = Number(pri || 18);
        reading = rd || '';
        glossEn = gEn || '';
        glossZh = gZh || '';
        ex = extra && typeof extra === 'object' ? extra : {};
        maxBand = Number(ex.maxBand || 3);
        const keyList = Array.isArray(keys) && keys.length ? keys : [display];
        const acceptPts = (pts, rawSrc) => {
          if (pts.length >= 2) {
            rawPatterns.push(pts);
          } else if (langCode === 'de' && pts.length === 1 && splitGermanSepVerb(pts[0])) {
            rawPatterns.push(pts);
            if (/\bsich\b/i.test(rawSrc || '')) rawPatterns.push(['sich', '*', pts[0]]);
          }
        };
        for (const k of keyList) acceptPts(patternizePhrase(k, L, langCode), k);
        acceptPts(patternizePhrase(display, L, langCode), display);
      } else {
        const [pat, disp, tp, pri, mb, extra] = row;
        display = disp || pat || '';
        type = tp || 'idiom';
        priority = Number(pri || 18);
        maxBand = Number(mb || 3);
        ex = extra && typeof extra === 'object' ? extra : {};
        glossEn = ex.gloss_en || ex.gloss || '';
        glossZh = ex.gloss_zh || '';
        reading = ex.reading || '';
        let parts = String(pat || '').trim().split(/\s+/).filter(Boolean);
        // If non-English row supplied raw unlemmatized pattern, normalize via L
        if (langCode !== 'en' && L) {
          const normPts = patternizePhrase(pat || display, L, langCode);
          if (normPts.length >= 2) parts = normPts;
        }
        // Two very common words (go to, it is) are noise, unless the row is a social formula (=thank =you, =you =know)
        if (langCode === 'en' && ranks && parts.length === 2 && !CORE_PATTERNS.has(pat) && type !== 'social' && parts.every((p) => {
          if (p === '*') return true;
          const c = p.replace(/^=/, '').toLowerCase();
          const cw = c === "won't" ? 'will' : c === "can't" ? 'can' : c.replace(/n't$/, '');
          return ranks[cw] && ranks[cw] <= COMMON_RANK;
        })) {
          continue;
        }
        if (langCode === 'en' && (parts[0] === '<poss>' || parts[0] === '<refl>' || parts[0] === '<obj>' || parts[0] === '<person>')) {
          rowLead = parts[0];
          parts = parts.slice(1);
        }
        if (langCode === 'en' && type === 'phrasal' && parts.length === 2 && SEPARABLE.has(parts[1])) {
          parts = [parts[0], '*', parts[1]];
        }
        if (parts.length >= 2) rawPatterns.push(parts);
      }

      if (!display || !rawPatterns.length) continue;

      // These dictionary entries are common discourse markers.
      const discourse = (langCode === 'fr' && display === 'en fait') || (langCode === 'it' && display === 'di fatto');
      if (discourse) type = 'discourse';
      const layer = discourse ? 'set phrase' : (ex.layer || '');
      const isBundle = isBundleType(layer, type);
      const bucket = classifyLayer(layer, type);
      const idiomPrior = typeof ex.idiom_prior === 'number' ? ex.idiom_prior : null;
      const opacity = typeof ex.opacity === 'number' ? ex.opacity : 0;

      const baseMeta = {
        pattern: isUnified8 ? display.toLowerCase() : String(row[0] || display).toLowerCase(),
        display,
        lang: langCode,
        type,
        layer,
        bucket,
        eq: ex.eq || null,
        lit: ex.lit || '',
        native: resolveNativeLabel(layer, type, langCode, ex.native),
        reading,
        gloss: glossEn,
        glossZh,
        glossMap: ex.gloss && typeof ex.gloss === 'object' ? ex.gloss : null,
        litRisk: Boolean(ex.lit_risk),
        senses: Array.isArray(ex.senses) ? ex.senses : null,
        idiomPrior,
        opacity,
        priority,
        maxBand,
        isBundle,
      };

      for (const pts of rawPatterns) {
        pushParts(pts, baseMeta, { deBracket: false, lead: rowLead });

        // German V2 separable-verb & verb-final idiom inversion:
        // 1) Pure separable verb ("vorstellen" -> ["stellen", "**", "vor"], or ["sich", "vorstellen"] -> ["stellen", "**", "vor"])
        // 2) Verb-final German idiom ("auf den arm nehmen" -> V2 main clause "nehmen ** auf der arm")
        if (langCode === 'de') {
          const last = pts[pts.length - 1];
          const sep = splitGermanSepVerb(last);
          if (sep) {
            const [pfx, baseV] = sep;
            const mid = pts.slice(0, -1).filter((x) => x !== '*');
            // V2 order: baseVerb + '**' (0..10 clause words) + mid + pfx
            const v2 = mid.length ? [baseV, '**', ...mid, pfx] : [baseV, '**', pfx];
            pushParts(v2, baseMeta, { deBracket: true });
          } else if (last && (/(?:en|[lr]n)$/.test(last) || last === 'sein' || last === 'tun') && pts.length >= 3) {   // sein/tun/ändern too
            // Clause-initial V2 inversion for verb-final idioms ("auf den Arm nehmen" -> "nimmt [mich] auf den Arm")
            const objChain = pts.slice(0, -1);
            // sein/tun only with a fully lexical chain: "bei jemandem sein" would fire on any "ist bei ..."
            const slotty = objChain.some((x) => /^(?:jemand\w*|etwas|etw|jmd\w*|sich|\*+|<.*>)$/.test(x));
            if (!((last === 'sein' || last === 'tun') && slotty)) pushParts([last, '*', ...objChain], baseMeta, { deBracket: true });
          }
        }
      }
    }

    // Also allow single-word German separable verbs supplied in unified 8-tuple (e.g. display="vormachen" or "reinfallen")
    if (langCode === 'de') {
      for (const row of allRows) {
        const isU8 = typeof row[2] === 'number';
        const disp = isU8 ? row[0] : row[1];
        if (!disp || /\s/.test(disp.trim())) continue;
        const sep = splitGermanSepVerb(disp.trim().toLowerCase());
        if (!sep) continue;
        const tp = isU8 ? row[1] : row[2];
        const pri = Number(isU8 ? row[2] : row[3]) || 18;
        const ex = (isU8 ? row[7] : row[5]) || {};
        const meta = {
          pattern: disp.toLowerCase(),
          display: disp,
          lang: 'de',
          type: tp || 'phrasal',
          layer: ex.layer || 'idiom',
          bucket: classifyLayer(ex.layer, tp),
          eq: ex.eq || null,
          lit: ex.lit || '',
          native: resolveNativeLabel(ex.layer || 'idiom', tp || 'phrasal', 'de', ex.native),
          reading: isU8 ? (row[3] || '') : '',
          gloss: isU8 ? (row[4] || '') : (ex.gloss || ''),
          glossZh: isU8 ? (row[5] || '') : '',
          glossMap: ex.gloss && typeof ex.gloss === 'object' ? ex.gloss : null,
          litRisk: Boolean(ex.lit_risk),
          idiomPrior: typeof ex.idiom_prior === 'number' ? ex.idiom_prior : null,
          opacity: typeof ex.opacity === 'number' ? ex.opacity : 0,
          priority: pri,
          maxBand: Number(ex.maxBand || 3),
          isBundle: false,
        };
        // joined forms (stattfinden, zurückgegeben, wegzugehen) lemmatize to the infinitive: match them as one token
        pushParts([disp.toLowerCase()], meta, { single: true });
        pushParts([sep[1], '**', sep[0]], meta, { deBracket: true });
      }
    }

    for (const arr of byFirst.values()) {
      arr.sort((a, b) => b.fixedCount - a.fixedCount || b.priority - a.priority);
    }
    byFirst._lang = langCode;
    if (feJson) _feCache.set(feJson, byFirst);
    return byFirst;
  };

  // Expand safe Cantonese orthographic variants on a string (only called for Cantonese entries).
  const expandYueVariants = (str) => {
    const out = new Set([str]);
    for (const [a, b] of YUE_VARIANT_PAIRS) {
      if (!str.includes(a)) continue;
      for (const cur of [...out]) {
        if (cur.includes(a) && out.size < 12) out.add(cur.split(a).join(b));
      }
    }
    return [...out];
  };

  const parseCjkSegments = (raw) => {
    if (!raw) return null;
    const cleaned = raw.replace(/^[〜~….*XＹY\s]+|[….*XＹY\s]+$/g, '');
    if (!cleaned) return null;
    const parts = cleaned.split(/(?:…+|\.{2,}|\*+|(?<=[\u3400-\u9fff])[XYAB](?=[\u3400-\u9fff]))/u).filter(Boolean);
    if (parts.length >= 2 && parts.every((p) => p.length >= 1)) return parts;
    return null;
  };

  // Japanese, Chinese, Cantonese and Korean lists: [display, type, priority, reading, gloss_en, gloss_zh, keys, extra].
  const buildCjkIndex = (feJsons) => {
    const list = (feJsons || []).filter(Boolean);
    if (!list.length) return null;
    const ck = list[0];
    const hit = _cjkCache.get(ck);
    if (hit && hit.n === list.length) return hit.idx;
    const byFirst = new Map();
    const seen = new Map();

    const pushEntry = (firstChar, obj) => {
      if (!firstChar) return;
      let arr = byFirst.get(firstChar);
      if (!arr) byFirst.set(firstChar, (arr = []));
      arr.push(obj);
      const bucketRefs = seen.get(obj.display);
      if (bucketRefs) bucketRefs.push(obj);
    };

    for (const fj of list) {
      const fjLang = (fj.meta && fj.meta.lang) || '';
      for (const row of fj.items || []) {
        const [display, type, priority, reading, glossEn, glossZh, keys, extra] = row;
        if (!display) continue;
        if (seen.has(display)) {
          const ex2 = extra && typeof extra === 'object' ? extra : {};
          for (const prev of seen.get(display)) {
            if (!prev.gloss && glossEn) prev.gloss = glossEn;
            if (!prev.glossZh && glossZh) prev.glossZh = glossZh;
            if (!prev.hanja && ex2.hanja) prev.hanja = ex2.hanja;
            if (!prev.reading && (reading || ex2.hanja)) prev.reading = reading || ex2.hanja;
            if (!prev.lit && ex2.lit) prev.lit = ex2.lit;
            if (!prev.eq && ex2.eq) prev.eq = ex2.eq;
            if (!prev.defJa && ex2.def_ja) prev.defJa = ex2.def_ja;
            if (!prev.defKo && ex2.def_ko) prev.defKo = ex2.def_ko;
            if (!prev.glossMap && ex2.gloss && typeof ex2.gloss === 'object') prev.glossMap = ex2.gloss;
            if (!prev.falseFriend && (ex2.false_friend || ex2.zh_diff)) prev.falseFriend = ex2.false_friend || ex2.zh_diff;
            if (!prev.litRisk && ex2.lit_risk) prev.litRisk = true;
          }
          continue;
        }
        const createdRefs = [];
        seen.set(display, createdRefs);
        const ex = extra && typeof extra === 'object' ? extra : {};
        const layer = ex.layer || '';
        const hanja = ex.hanja || '';
        const mergedReading = reading && hanja && reading !== hanja ? `${hanja} · ${reading}` : (reading || hanja || '');
        const isYueEntry = fjLang === 'yue' || /cantonese/i.test(type || '');
        const isZhOrYue = isYueEntry || fjLang === 'zh';
        const isBundle = isBundleType(layer, type);
        const bucket = classifyLayer(layer, type);

        const candBase = {
          pattern: display,
          display,
          type,
          layer,
          bucket,
          native: resolveNativeLabel(layer, type, fjLang || (isYueEntry ? 'yue' : 'zh'), ex.native),
          lit: ex.lit || '',
          eq: ex.eq || null,
          hanja,
          defJa: ex.def_ja || '',
          defKo: ex.def_ko || '',
          glossMap: ex.gloss && typeof ex.gloss === 'object' ? ex.gloss : null,
          litRisk: Boolean(ex.lit_risk),
          register: ex.register || '',
          standalone: Boolean(ex.standalone),
          falseFriend: ex.false_friend || ex.zh_diff || '',
          isBundle,
          priority,
          maxBand: 4,
          reading: mergedReading,
          gloss: glossEn || '',
          glossZh: glossZh || '',
        };

        const dispSegs = parseCjkSegments(display);
        const rawKeys = Array.isArray(keys) ? keys : [];

        if (dispSegs) {
          const segVariants = isYueEntry
            ? expandYueVariants(dispSegs.join('\u0000')).map((s) => s.split('\u0000'))
            : [dispSegs];
          const fixedLen = dispSegs.reduce((acc, s) => acc + s.length, 0);
          for (const segs of segVariants) {
            pushEntry(segs[0][0], Object.assign({ key: segs[0], segments: segs, sortLen: fixedLen + 1, allowVoAspect: false }, candBase));
          }
        }

        const ks = new Set();
        const koAddedKeys = new Set();
        // Korean keys keep the display's shape: same number of words, and the last word is the display's last
        // word or its stem without 다 (설득할 수 있 for 설득할 수 있다). Shortened keys (설득할 수, 적도 없는,
        // 말아야 할 for 말아야 할지) matched 설득할 수는 없어, 강요한 적도 없는데, 할 텐데.
        // Optional parts in brackets give two shapes: 가뭄에 콩 나듯 (한다) -> 가뭄에 콩 나듯 / 가뭄에 콩 나듯 한다.
        const koShapes = fjLang === 'ko'
          ? [display.replace(/\s*\([^)]*\)/g, ''), display.replace(/[()]/g, '')].map((s) => s.trim().split(/\s+/))
          : null;
        const koShapeOk = (kw) => koShapes.some((dw) => {
          const kl = kw[kw.length - 1], dl = dw[dw.length - 1];
          const matchingPrefix = kw.length === dw.length && kw.slice(0, -1).every((part, i) => part === dw[i]);
          const knownInflection = matchingPrefix && dl.endsWith('다') && KO_IDIOM_ENDINGS.get(dl.slice(0, -1))?.includes(kl);
          return kw.length === dw.length && (kl === dl || (kl.length >= 2 && dl.startsWith(kl)) || (dl.endsWith('다') && kl === dl.slice(0, -1)) || knownInflection);
        });
        for (const k of rawKeys) {
          if (!k) continue;
          const stripped = k.replace(/^[〜~….*X\s]+|[….*X\s]+$/g, '');
          if (!stripped) continue;
          if (dispSegs && !parseCjkSegments(stripped)) continue;
          if (koShapes && !/[~〜…*X]/.test(display) && !koShapeOk(stripped.split(/\s+/))) continue;
          if (isYueEntry) {
            for (const v of expandYueVariants(stripped)) ks.add(v);
          } else {
            ks.add(stripped);
            if (fjLang === 'ko' && stripped.length >= 2) {
              const lastK = stripped.slice(-1);
              const pfx = stripped.slice(0, -1);
              if (lastK === '하') {
                for (const sfx of ['해', '했', '할', '한']) ks.add(pfx + sfx);
              } else if (KO_CONTR_MAP[lastK]) {
                for (const sfx of KO_CONTR_MAP[lastK]) ks.add(pfx + sfx);
              }
            }
          }
          // Spaceless variant only for CJK scripts without word spaces (never collapse Korean word spaces!)
          if (stripped.includes(' ') && fjLang !== 'ko') ks.add(stripped.replace(/\s+/g, ''));
        }
        const cleanDisp = display.replace(/^[〜~….*X\s]+|[….*X\s]+$/g, '');
        if (!dispSegs && cleanDisp.length >= 2) {
          if (isYueEntry) for (const v of expandYueVariants(cleanDisp)) ks.add(v);
          else ks.add(cleanDisp);
        }
        if (koShapes && !dispSegs && bucket === 'idiom' && !/[~〜…*X]/.test(display)) {
          for (const words of koShapes) {
            if (words.length < 2 || !words.at(-1).endsWith('다')) continue;
            const stem = words.at(-1).slice(0, -1);
            const prefix = words.slice(0, -1).join(' ') + ' ';
            for (const form of KO_IDIOM_ENDINGS.get(stem) || []) {
              const key = prefix + form;
              koAddedKeys.add(key);
              ks.add(key);
            }
          }
        }

        const isProverbOrChengyu =
          layer === 'proverb' ||
          layer === 'riddle saying' ||
          layer === 'frame' ||
          layer === 'collocation' ||
          /proverb|chengyu|xiehouyu|yojijukugo|frame|collocation/i.test(type || '') ||
          /成语|成語|諺語|谚语|歇後語|歇后语|四字熟語|사자성어/.test(ex.native || '');
        const hasExplicitVo = Boolean(ex.vo);

        for (const key of ks) {
          const kSegs = parseCjkSegments(key);
          if (kSegs) {
            const fixedLen = kSegs.reduce((acc, s) => acc + s.length, 0);
            pushEntry(kSegs[0][0], Object.assign({ key: kSegs[0], segments: kSegs, sortLen: fixedLen + 1, allowVoAspect: false }, candBase));
          } else {
            const isBaseStem = key.length >= 2 && key.length === cleanDisp.length;
            const validVerbHead = HAN_START_RE.test(key[0]) && !VO_BAD_PREFIX.has(key[0]) && !VO_ASPECT_CHARS.has(key[1]);
            const is3CharVerbIdiom =
              key.length === 3 &&
              HAN_ONLY_RE.test(key) &&
              (layer === 'idiom' || layer === 'slang' || /idiom|slang/i.test(type || '')) &&
              VO_LEAD_VERBS.has(key[0]) &&
              !VO_NON_OBJ_SECOND.has(key[1]) &&
              key[0] !== key[1] &&
              key[1] !== key[2];
            const allowVoAspect =
              isZhOrYue &&
              !isProverbOrChengyu &&
              isBaseStem &&
              validVerbHead &&
              (hasExplicitVo || is3CharVerbIdiom);
            const koBounded = koAddedKeys.has(key) || (fjLang === 'ko' && Boolean(ex.require_end_boundary));
            pushEntry(key[0], Object.assign({ key, segments: null, sortLen: key.length, allowVoAspect, koBounded }, candBase));
          }
        }
      }
    }
    for (const arr of byFirst.values()) {
      arr.sort((a, b) => b.sortLen - a.sortLen || (a.isBundle === b.isBundle ? 0 : a.isBundle ? 1 : -1) || b.priority - a.priority);
    }
    const idx = { cjk: true, byFirst, reviewedLang: ck.meta?.schema ? normLang(ck.meta.lang) : '' };
    _cjkCache.set(ck, { n: list.length, idx });
    return idx;
  };

  const matchGappedSegments = (text, pos, segs, si) => {
    const seg = segs[si];
    if (!text.startsWith(seg, pos)) return null;
    const afterSeg = pos + seg.length;
    if (si === segs.length - 1) {
      return { end: afterSeg, ranges: [[pos, afterSeg]] };
    }
    const maxGap = 6;
    for (let gap = 1; gap <= maxGap && afterSeg + gap <= text.length; gap++) {
      const ch = text[afterSeg + gap - 1];
      if (CJK_GAP_STOP.test(ch)) break;
      const next = matchGappedSegments(text, afterSeg + gap, segs, si + 1);
      if (next) {
        return { end: next.end, ranges: [[pos, afterSeg], ...next.ranges] };
      }
    }
    return null;
  };

  const KO_CONTR_MAP = {
    '되': ['돼', '됐'],
    '오': ['와', '왔'],
    '보': ['봐', '봤'],
    '주': ['줘', '줬'],
    '쓰': ['써', '썼'],
    '끄': ['꺼', '껐'],
    '치': ['쳐', '쳤'],
    '지': ['져', '졌'],
    '기': ['겨', '겼'],
    '리': ['려', '렸'],
    '떼': ['뗐'],
    '세': ['셌'],
    '메': ['멨'],
  };

  const JA_COMPOUND_HEADS = new Set([
    '本気', '人気', '元気', '病気', '空気', '電気', '天気', '勇気', '平気', '短気', '正気', '気持', '気分',
    '注目', '人目', '役目', '目的', '上手', '下手', '苦手', '相手', '選手', '助手', '拍手', '握手', '勝手',
    '入口', '出口', '窓口', '早口', '悪口', '満足', '不足', '遠足', '先頭', '安心', '中心', '感心', '熱心',
    '関心', '洗顔', '笑顔', '大声', '小声', '協力', '努力', '実力', '魅力', '暴力', '電力', '空腹', '立腹',
  ]);
  const JA_TAIL_EXT_RE = /^(?:った|って|いた|いて|いだ|いで|んだ|んで|した|して|しない|しないで|せず|た|て|ない|なかった|なく|ます|ました|ません|ちゃう|ちゃった|じゃう|じゃった|ている|てる|ていた|てた|られる|れる|させる|せる|よう|ろ)/;
  // Only extend anchored multiword idioms with these attested verb/adjective forms.
  const KO_IDIOM_ENDINGS = new Map([
    ['나서', ['나섰', '나선', '나설']],
    ['막히', ['막혀', '막혔', '막힌', '막힐']],
    ['무겁', ['무거워', '무거웠', '무거운', '무거울']],
    ['내두르', ['내둘러', '내둘렀']],
    ['트이', ['트여', '트였', '트인', '트일']],
    ['죽이', ['죽여', '죽였', '죽인', '죽일']],
    ['걸리', ['걸려', '걸렸', '걸린', '걸릴']],
    ['뜨', ['떠', '떴', '뜬', '뜰']],
    ['빠르', ['빨라', '빨랐', '빠른', '빠를']],
  ]);
  const KO_TAIL_EXT_RE = /^(?:[았었](?:어요|어|다|는데|고|죠|으면|다고|더니|음|지만|습니다)?|아서|어서|어요|아요|으니까|니까|으니|니|습니다|잖아요|잖아|네요|는데|으면서|면서|으며|으면|지만|다가|다고|은|는|을|어|아|고|서|면|다|지|죠|요)(?=$|[^가-힣])/;
  // A clause linking foot width to choosing or wearing shoes usually uses the literal sense.
  const KO_LITERAL_WIDE_FOOT_RE = /^(?:어서(?:인지)?|으니|은데)\s+[^.!?。！？\n]{0,28}(?:신발|구두|운동화)[^.!?。！？\n]{0,14}(?:신|맞|골|사)/;

  const matchCjk = (text, idx, allowBundles = true) => {
    const out = [];
    if (!text || !idx) return out;
    const hasKana = /[\u3040-\u30ff]/.test(text);
    for (let i = 0; i < text.length; i++) {
      const cands = idx.byFirst.get(text[i]);
      if (!cands) continue;
      // Word boundaries: a Korean expression starts an eojeol (not 할 inside 위험할), and in Japanese text a
      // kanji-initial single-kanji+particle idiom does not fire inside a lexical kanji compound (本気にする != 気にする).
      const prev = i > 0 ? text[i - 1] : '';
      if (prev && /[\uac00-\ud7a3]/.test(prev) && /[\uac00-\ud7a3]/.test(text[i])) continue;
      const prevIsKanji = !!(hasKana && prev && /[\u3400-\u9fff\u3005]/.test(prev) && /[\u3400-\u9fff]/.test(text[i]));
      let matched = null;
      for (const c of cands) {
        if (!allowBundles && c.isBundle) continue;
        if (prevIsKanji && JA_COMPOUND_HEADS.has(prev + text[i]) && /^[\u3400-\u9fff][がをにへでともはの]/.test(c.display)) continue;
        if (c.segments) {
          const g = matchGappedSegments(text, i, c.segments, 0);
          if (!g) continue;
          matched = { c, surface: text.slice(i, g.end), end: g.end, anchorRanges: g.ranges };
          break;
        }
        if (text.startsWith(c.key, i)) {
          const end = i + c.key.length;
          if (c.koBounded && /[가-힣]/.test(text[end] || '') && !KO_TAIL_EXT_RE.test(text.slice(end))) continue;
          if (c.display === '발이 넓다' && KO_LITERAL_WIDE_FOOT_RE.test(text.slice(end))) continue;
          if (c.standalone && (/[^\s、。！？「」『』…!?.,―—]/u.test(prev)
            || /[^\s、。！？「」『』…!?.,―—]/u.test(text[end] || ''))) continue;
          matched = { c, surface: c.key, end, anchorRanges: [[i, end]] };
          break;
        }
        if (c.allowVoAspect && i + 1 < text.length && VO_ASPECT_CHARS.has(text[i + 1]) && text.startsWith(c.key.slice(1), i + 2)) {
          const end = i + c.key.length + 1;
          matched = { c, surface: text.slice(i, end), end, anchorRanges: [[i, i + 1], [i + 2, end]] };
          break;
        }
      }
      // Korean negation guards (run on raw stem boundary before tail extension)
      if (matched && /[가-힣]/.test(matched.c.display)) {
        const rest = text.slice(matched.end, matched.end + 14);
        if (matched.c.display === '말도 안' && !/^\s*(?:되|돼|될|된|됐)/.test(rest)) {
          matched = null;
        } else if (!/않|없|못|안 |아니|말/.test(matched.c.display) && /^(?:는|은|도|가|이|조차|만|리가|리도|수도|수가|수)?\s*(?:지\s*)?(?:않|없|못하|못 |아니)/.test(rest)) {
          matched = null;
        }
      }
      // Extend inflected verb/adjective tails so highlights cover the full conjugated expression
      if (matched && !matched.c.segments) {
        const tailStr = text.slice(matched.end);
        if (hasKana && /[るうくぐすつぬぶむい]$/.test(matched.c.display)) {
          const jm = JA_TAIL_EXT_RE.exec(tailStr);
          if (jm && (matched.c.key.length < matched.c.display.length || !matched.c.display.endsWith('る') || jm[0].length >= 1)) {
            const newEnd = matched.end + jm[0].length;
            matched.end = newEnd;
            matched.surface = text.slice(i, newEnd);
            matched.anchorRanges[matched.anchorRanges.length - 1][1] = newEnd;
          }
        } else if (/[다]$/.test(matched.c.display) && /[가-힣]$/.test(matched.surface)) {
          const km = KO_TAIL_EXT_RE.exec(tailStr);
          if (km) {
            const newEnd = matched.end + km[0].length;
            matched.end = newEnd;
            matched.surface = text.slice(i, newEnd);
            matched.anchorRanges[matched.anchorRanges.length - 1][1] = newEnd;
          }
        }
      }
      if (matched) {
        const { c, surface, end, anchorRanges } = matched;
        out.push({
          pattern: c.pattern,
          display: c.display,
          type: c.type,
          layer: c.layer,
          bucket: c.bucket,
          native: c.native,
          lit: c.lit,
          eq: c.eq,
          hanja: c.hanja || '',
          defJa: c.defJa,
          defKo: c.defKo,
          glossMap: c.glossMap || null,
          litRisk: Boolean(c.litRisk),
          register: c.register,
          falseFriend: c.falseFriend,
          isBundle: c.isBundle,
          priority: c.priority,
          maxBand: c.maxBand,
          deceptive: false,
          surface,
          startRaw: -1,
          endRaw: -1,
          litRawSet: new Set(),
          charStart: i,
          charEnd: end,
          anchorRanges,
          reading: c.reading,
          gloss: c.gloss,
          glossZh: c.glossZh,
        });
        i = end - 1;
      }
    }
    return appendReviewedExpressions(text, idx.reviewedLang, out);
  };

  // Sound parallelism check (Boers & Lindstromberg 2005)
  const foldAccents = (s) => {
    try { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) { return String(s || ''); }
  };
  const ROMANCE_LANGS = new Set(['es', 'fr', 'pt', 'it']);

  const hasSoundParallelism = (display) => {
    const stops = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'for', 'with', 'your', 'one', 'el', 'la', 'los', 'las', 'de', 'del', 'le', 'les', 'du', 'des', 'der', 'die', 'das', 'den', 'dem']);
    const words = (String(display || '').toLowerCase().match(/[\p{L}]+/gu) || []).filter((w) => !stops.has(w) && w.length > 2);
    if (words.length < 2) return '';
    const initials = new Set();
    for (const w of words) {
      if (initials.has(w[0])) return 'alliteration';
      initials.add(w[0]);
    }
    const tails = new Set();
    for (const w of words) {
      const t = w.slice(-3);
      if (tails.has(t)) return 'rhyme';
      tails.add(t);
    }
    return '';
  };

  // Match pattern parts starting at word-token position wi:
  //   - '*'  allows 0..3 intra-clause word tokens (Lin 2022 ReCALL)
  //   - '**' allows 0..10 intra-clause German V2 bracket tokens up to clause punctuation or DE_CLAUSE_BREAK
  //   - Romance (es/fr/pt/it) allows transparent clitic/negation/compound-tense auxiliary skips (e.g. "ne s'en est vraiment pas fait")
  // Contextual Romance homograph tables (Round 4 precision guards)
  const FR_NOMINAL_FAIT_PREV = new Set(['en', 'au', 'du', 'le', 'un', 'ce', 'de', 'par', 'ceci']);
  const FR_NEG_TRIGGERS = new Set([
    'ne', "n'", 'ai', 'as', 'a', 'avons', 'avez', 'ont', 'avais', 'avait', 'avaient', 'aurai', 'aura', 'aurait',
    'suis', 'es', 'est', 'sommes', 'êtes', 'sont', 'étais', 'était', 'étaient', 'sera', 'serait', 'soit',
    'peux', 'peut', 'pouvons', 'peuvent', 'pouvait', 'veux', 'veut', 'voulons', 'veulent', 'voulait',
    'faut', 'fallait', 'dois', 'doit', 'devons', 'doivent', 'sais', 'sait', 'savons', 'savent', 'vais', 'vas', 'va', 'vont',
  ]);
  const FR_STEP_DET = new Set([
    'le', 'un', 'ce', 'du', 'au', 'des', 'les', 'mon', 'ton', 'son', 'notre', 'votre', 'leur',
    'premier', 'faux', 'bon', 'grand', 'petit', 'chaque', 'quelques', 'deux', 'trois',
  ]);
  const ES_NOUN_DET = new Set(['el', 'un', 'del', 'al', 'este', 'ese', 'aquel', 'mi', 'tu', 'su', 'buen', 'mal', 'mejor', 'peor', 'tinto', 'blanco']);
  const PT_DET_FOLLOW = new Set([
    'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'teu', 'tua', 'teus', 'tuas',
    'nosso', 'nossa', 'nossos', 'nossas', 'este', 'esta', 'esse', 'essa', 'aquele', 'aquela',
    'mesmo', 'mesma', 'outro', 'outra', 'qual', 'quais', 'que',
  ]);
  const IT_NOMINAL_FATTO_PREV = new Set(['di', 'il', 'un', 'del', 'nel', 'sul', 'questo', 'quel', 'dal', 'al']);
  const IT_NOMINAL_STATO_PREV = new Set(['lo', 'uno', 'dello', 'nello', 'questo', 'in']);

  const matchFrom = (wordToks, wi, parts, pi, langCode = 'en', cand = null) => {
    if (pi >= parts.length) return [];
    const p = parts[pi];
    // Homograph guards (Gemini v1.0.0): en fait / di fatto / el vino / para / como are not faire / fare / venir / parar / comer
    const gt = wordToks[wi];
    if (gt && p[0] !== '<') {
      const bareP = p[0] === '=' ? p.slice(1) : p;
      // en fait, di fatto keep matching; the display check is built only when a homograph guard applies (hot path)
      if (gt.notVerbLemma && p[0] !== '=' && p === gt.notVerbLemma && gt.low !== p) {
        if (cand && cand._dispSp === undefined) cand._dispSp = ' ' + String(cand.display || '').toLowerCase().replace(/['’]/g, ' ') + ' ';
        if (!(cand && cand._dispSp.includes(' ' + gt.low + ' '))) return null;
      }
      if (langCode === 'fr' && gt.isNegPas && bareP === 'pas' && parts[0] !== 'ne' && parts[0] !== '=ne') return null;
      if (gt.isContractionPelo && (p === 'pelo' || p === '=pelo')) return null;
      // German: in a normally cased line, a lowercase word cannot be the capitalised noun of the idiom (im recht kleinen Haus != im Recht sein)
      if (langCode === 'de' && wordToks._mixed && cand && wi > 0 && !gt.hardPunctBefore && /^[a-zäöüß]/.test(gt.w)) {
        if (!cand._deNouns) cand._deNouns = new Set(String(cand.display || '').split(/\s+/).slice(1).filter((x) => /^[A-ZÄÖÜ]/.test(x)).map((x) => x.toLowerCase()));
        const bare = p.replace(/^=/, '');
        if (cand._deNouns.has(bare) || cand._deNouns.has(gt.low)) return null;
      }
    }
    const brk = (t) => langCode === 'en'
      ? t.hardPunctBefore || t.hyphenBefore || (t.commaBefore && !(cand && cand.allowComma))
      : t.hardPunctBefore;
    if (p === '<poss>' || p === '<refl>') {
      const t = wordToks[wi];
      if (!t || (pi > 0 && brk(t))) return null;
      if (p === '<poss>' ? !(POSS_WORDS.has(t.low) || /^[a-z]+(?:'s|s')$/.test(t.low)) : !REFL_WORDS.has(t.low)) return null;
      const nx = p === '<poss>' && wordToks[wi + 1] && wordToks[wi + 1].low === 'own' ? wi + 2 : wi + 1;
      const rest = matchFrom(wordToks, nx, parts, pi + 1, langCode, cand);
      return rest ? [wi, ...rest] : null;
    }
    if (p === '<person>') {
      const isAnimateHead = (tk) => !!tk && (
        PERSON_WORDS.has(tk.low) ||
        PERSON_WORDS.has(tk.lem) ||
        (/^[A-Z][a-z]{1,}$/.test(tk.w) && !DETERMINER_START.has(tk.low) && !CLAUSE_BREAK_WORDS.has(tk.low))
      );
      const t0 = wordToks[wi];
      if (!t0 || (pi > 0 && brk(t0)) || CLAUSE_BREAK_WORDS.has(t0.low) || SKIP_BLOCKERS.has(t0.low)) return null;
      if (pi === parts.length - 1) {
        if (isAnimateHead(t0)) return [];
        const t1 = wordToks[wi + 1];
        if (t1 && !brk(t1) && /^(?:a|an|the|this|that|my|your|his|her|our|their)$/.test(t0.low) && isAnimateHead(t1)) return [];
        return null;
      }
      for (let skip = 1; skip <= 2 && wi + skip <= wordToks.length; skip++) {
        const sk = wordToks[wi + skip - 1];
        if (brk(sk) || CLAUSE_BREAK_WORDS.has(sk.low) || (skip === 1 && SKIP_BLOCKERS.has(sk.low))) break;
        const okAnim = skip === 1
          ? isAnimateHead(sk)
          : (/^(?:a|an|the|this|that|my|your|his|her|our|their)$/.test(wordToks[wi].low) && isAnimateHead(sk));
        if (!okAnim) continue;
        if (wi + skip < wordToks.length && brk(wordToks[wi + skip])) continue;
        const rest = matchFrom(wordToks, wi + skip, parts, pi + 1, langCode, cand);
        if (rest) return rest;
      }
      return null;
    }
    if (p === '<obj>') {
      if (pi === parts.length - 1) {   // trailing object: one word must follow in the same clause
        const t = wordToks[wi];
        return t && !brk(t) && !CLAUSE_BREAK_WORDS.has(t.low) ? [] : null;
      }
      for (let skip = 1; skip <= 3 && wi + skip <= wordToks.length; skip++) {
        const sk = wordToks[wi + skip - 1];
        if (brk(sk) || CLAUSE_BREAK_WORDS.has(sk.low) || (skip === 1 && SKIP_BLOCKERS.has(sk.low))) break;
        if (wi + skip < wordToks.length && brk(wordToks[wi + skip])) continue;
        const rest = matchFrom(wordToks, wi + skip, parts, pi + 1, langCode, cand);
        if (rest) return rest;
      }
      return null;
    }

    if (p === '**') {
      for (let skip = 0; skip <= 10 && wi + skip < wordToks.length; skip++) {
        if (skip > 0) {
          const sk = wordToks[wi + skip - 1];
          if (sk.hardPunctBefore || sk.commaBefore || DE_CLAUSE_BREAK.has(sk.low)) break;
          if (pi + 1 < parts.length && (wordToks[wi + skip].hardPunctBefore || wordToks[wi + skip].commaBefore || DE_CLAUSE_BREAK.has(wordToks[wi + skip].low))) break;
        }
        const rest = matchFrom(wordToks, wi + skip, parts, pi + 1, langCode, cand);
        if (rest) return rest;
      }
      return null;
    }

    if (p === '*') {
      for (let skip = 0; skip <= 3 && wi + skip < wordToks.length; skip++) {
        if (skip > 0) {
          const sk = wordToks[wi + skip - 1];
          if (sk.hardPunctBefore || sk.commaBefore) break;
          if (langCode === 'en') {
            if (CLAUSE_BREAK_WORDS.has(sk.low) || SKIP_BLOCKERS.has(sk.low)) break;
            if (/ing$/.test(sk.low) && skip >= 2) break;
          } else if (langCode === 'de' && DE_CLAUSE_BREAK.has(sk.low)) {
            break;
          }
          if (pi + 1 < parts.length && (wordToks[wi + skip].hardPunctBefore || wordToks[wi + skip].commaBefore)) continue;
        }
        const rest = matchFrom(wordToks, wi + skip, parts, pi + 1, langCode, cand);
        if (rest) return rest;
      }
      return null;
    }

    if (wi >= wordToks.length) return null;
    if (pi > 0 && brk(wordToks[wi])) return null;

    // Romance transparent bridge: allow skipping up to 2 negation adverbs, clitic pronouns, or compound auxiliaries between matched parts
    if (pi > 0 && ROMANCE_NEG_ADV[langCode]) {
      const curTok = wordToks[wi];
      const isTransparent =
        ROMANCE_NEG_ADV[langCode].has(curTok.low) ||
        (ROMANCE_CLITICS[langCode] && ROMANCE_CLITICS[langCode].has(curTok.low) && curTok.lem !== p && curTok.low !== p) ||
        (ROMANCE_AUX_LEMMAS[langCode] && ROMANCE_AUX_LEMMAS[langCode].has(curTok.lem) && curTok.lem !== p && curTok.low !== p);
      if (isTransparent && !curTok.commaBefore) {
        const skipped = matchFrom(wordToks, wi + 1, parts, pi, langCode, cand);
        if (skipped) return skipped;
      }
    }

    const tokMatch =
      (p[0] === '=' ? wordToks[wi].low === p.slice(1) : wordToks[wi].lem === p) ||
      wordToks[wi].low === p ||
      (ROMANCE_LANGS.has(langCode) && p[0] !== '=' && (
        foldAccents(wordToks[wi].lem) === foldAccents(p) ||
        foldAccents(wordToks[wi].low) === foldAccents(p)
      )) ||
      (langCode === 'en' && p.length >= 3 && /[lsfz]$/.test(p) && wordToks[wi].lem === p + p[p.length - 1]) ||
      (langCode === 'en' && parts.length >= 4 && p === 'one' && EN_SUBJ_PRONOUNS.has(wordToks[wi].low)) ||
      (langCode === 'en' && parts.length >= 4 && p === 'can' && wordToks[wi].low === 'could');
    if (!tokMatch) return null;
    const rest = matchFrom(wordToks, wi + 1, parts, pi + 1, langCode, cand);
    if (!rest) return null;
    return [wi, ...rest];
  };

  // Scan one line's split tokens for syntactically bounded FEs across EN, DE, ES, FR, PT, IT, RU, TL.
  const matchTokens = (tokens, L, feIndex, opts = {}) => {
    if (!feIndex || !tokens || !tokens.length) return [];
    const langCode = normLang((L && L.code) || feIndex._lang || 'en');
    const minIdiomPrior = opts.minIdiomPrior != null ? opts.minIdiomPrior : 0.18;

    const rawStarts = [];
    let off = 0;
    for (const tk of tokens) { rawStarts.push(off); off += tk.w.length; }
    const wordToks = [];
    let between = '';
    for (let rawIdx = 0; rawIdx < tokens.length; rawIdx++) {
      const tk = tokens[rawIdx];
      if (!tk.word) {
        between += tk.w;
      } else {
        wordToks.push({
          rawIdx,
          lem: L.lemma(tk.w),
          low: tk.w.toLowerCase().replace(/’/g, "'"),
          w: tk.w,
          hardPunctBefore: HARD_PUNCT_RE.test(between),
          commaBefore: COMMA_RE.test(between),
          hyphenBefore: /^[-\u2010]$/.test(between),
        });
        between = '';
      }
    }
    if (wordToks.length < 2) return [];
    if (langCode === 'de') {   // mixed case = normal orthography (not an all-lowercase ASR track, not Title Case)
      const mid = wordToks.filter((t, i) => i > 0 && !t.hardPunctBefore);
      const up = mid.filter((t) => /^[A-ZÄÖÜ]/.test(t.w)).length;
      wordToks._mixed = mid.length > 0 && up > 0 && !(mid.length >= 4 && up / mid.length > 0.65);
    }
    if (langCode === 'fr' || langCode === 'es' || langCode === 'pt' || langCode === 'it') {
      for (let i = 0; i < wordToks.length; i++) {
        const wt = wordToks[i];
        const prev1 = i > 0 && !wt.hardPunctBefore ? wordToks[i - 1].low : '';
        const prev2 = i > 1 && !wt.hardPunctBefore && !wordToks[i - 1].hardPunctBefore ? wordToks[i - 2].low : '';
        const prev3 = i > 2 && !wt.hardPunctBefore && !wordToks[i - 1].hardPunctBefore && !wordToks[i - 2].hardPunctBefore ? wordToks[i - 3].low : '';
        const next1 = i + 1 < wordToks.length && !wordToks[i + 1].hardPunctBefore ? wordToks[i + 1].low : '';
        const next2 = i + 2 < wordToks.length && !wordToks[i + 1].hardPunctBefore && !wordToks[i + 2].hardPunctBefore ? wordToks[i + 2].low : '';
        if (langCode === 'fr') {
          if (wt.low === 'fait' && (FR_NOMINAL_FAIT_PREV.has(prev1) || (prev1 === 'à' && prev2 === 'tout'))) wt.notVerbLemma = 'faire';
          if (
            wt.low === 'pas' &&
            !(next1 === 'à' && next2 === 'pas') &&
            !FR_STEP_DET.has(prev1) &&
            (FR_NEG_TRIGGERS.has(prev1) || prev2 === 'ne' || prev2 === "n'" || prev3 === 'ne' || prev3 === "n'")
          ) {
            wt.isNegPas = true;
          }
        } else if (langCode === 'es') {
          if (wt.low === 'vino' && ES_NOUN_DET.has(prev1)) wt.notVerbLemma = 'venir';
          else if (wt.low === 'traje' && ES_NOUN_DET.has(prev1)) wt.notVerbLemma = 'traer';
          else if (wt.low === 'para' && next1 !== 'de') wt.notVerbLemma = 'parar';
          else if (wt.low === 'como' && prev1 !== 'yo') wt.notVerbLemma = 'comer';
        } else if (langCode === 'pt') {
          if (/^pel[oa]s?$/.test(wt.low) && PT_DET_FOLLOW.has(next1)) wt.isContractionPelo = true;
          else if (wt.low === 'para' && next1 !== 'de') wt.notVerbLemma = 'parar';
          else if (wt.low === 'como' && prev1 !== 'eu') wt.notVerbLemma = 'comer';
        } else if (langCode === 'it') {
          if (wt.low === 'fatto' && IT_NOMINAL_FATTO_PREV.has(prev1)) wt.notVerbLemma = 'fare';
          else if (wt.low === 'stato' && IT_NOMINAL_STATO_PREV.has(prev1)) wt.notVerbLemma = 'essere';
        }
      }
    }
    const matches = [];
    const text = tokens.map(t => t.w).join('');
    const usedWord = new Set();

    for (let wi = 0; wi < wordToks.length; wi++) {
      if (usedWord.has(wi)) continue;
      // Check both lemmatized head and raw lowercase head (handles French/Italian clitic-headed idioms like "y aller", "en avoir marre")
      const candsLem = feIndex.get(wordToks[wi].lem) || [];
      const candsLow = wordToks[wi].low !== wordToks[wi].lem ? (feIndex.get(wordToks[wi].low) || []) : [];
      let candsFold = [];
      if (!candsLem.length && !candsLow.length && ROMANCE_LANGS.has(langCode)) {
        const fLow = foldAccents(wordToks[wi].low);
        const fLem = foldAccents(wordToks[wi].lem);
        if (fLow !== wordToks[wi].low) candsFold = feIndex.get(fLow) || [];
        if (!candsFold.length && fLem !== wordToks[wi].lem) candsFold = feIndex.get(fLem) || [];
      }
      const cands = candsLow.length ? [...candsLem, ...candsLow] : (candsLem.length ? candsLem : candsFold);

      // Also support Romance compound-tense idioms where 'en'/'y' precedes an auxiliary before the main verb ("s'en est pas fait" -> head verb 'faire' is at wi+3, 'en' at wi!)
      let romEnCands = [];
      if ((langCode === 'fr' || langCode === 'it') && (wordToks[wi].low === 'en' || wordToks[wi].low === 'y' || wordToks[wi].low === 'ci' || wordToks[wi].low === 'ce')) {
        for (let look = 1; look <= 4 && wi + look < wordToks.length; look++) {
          const t2 = wordToks[wi + look];
          if (t2.hardPunctBefore || t2.commaBefore) break;
          const vCands = feIndex.get(wordToks[wi].low) || [];
          if (vCands.length) { romEnCands = vCands; break; }
        }
      }
      const allCands = romEnCands.length ? [...cands, ...romEnCands] : cands;
      if (!allCands.length) continue;

      for (const cand of allCands) {
        // Empirical MAGPIE idiom_prior gate: suppress ultra-literal traps (<0.18) unless explicitly bypassed
        if (cand.idiomPrior != null && cand.idiomPrior < minIdiomPrior) continue;

        let hitWordIdxs = matchFrom(wordToks, wi, cand.parts, 0, langCode, cand);
        if (hitWordIdxs && cand.lead) {
          const pv = wordToks[wi - 1], here = wordToks[wi];
          const okLead = pv && !here.hardPunctBefore && !here.commaBefore &&
            (cand.lead === '<poss>' ? POSS_WORDS.has(pv.low) || /^[a-z]+(?:'s|s')$/.test(pv.low) || (pv.low === 'own' && wordToks[wi - 2] && POSS_WORDS.has(wordToks[wi - 2].low))
              : cand.lead === '<refl>' ? REFL_WORDS.has(pv.low)
              : cand.lead === '<person>' ? (PERSON_WORDS.has(pv.low) || PERSON_WORDS.has(pv.lem) || /^[A-Z][a-z]{1,}$/.test(pv.w))
              : !CLAUSE_BREAK_WORDS.has(pv.low));
          hitWordIdxs = okLead ? ((cand.lead === '<obj>' || cand.lead === '<person>') ? hitWordIdxs : [wi - 1, ...hitWordIdxs]) : null;
        }
        // one-token hits only for joined German particle verbs (stattfinden, zurückgegeben)
        if (!hitWordIdxs || hitWordIdxs.length < (cand.parts.length === 1 ? 1 : 2)) continue;

        let instLitRisk = Boolean(cand.litRisk);
        if (langCode === 'en') {
          const litAfter = LITERAL_AFTER[cand.pattern];
          if (litAfter) {
            const nx = wordToks[hitWordIdxs[hitWordIdxs.length - 1] + 1];
            if (nx && !nx.hardPunctBefore && !nx.commaBefore && litAfter.has(nx.low)) continue;
          }
          if (
            cand.type === 'phrasal' &&
            cand.parts.length === 3 &&
            cand.parts[1] === '*' &&
            MOTION_VERBS.has(cand.parts[0]) &&
            SPATIAL_PREP.has(cand.parts[2])
          ) {
            const lastIdx = hitWordIdxs[hitWordIdxs.length - 1];
            const nextTok = wordToks[lastIdx + 1];
            if (hitWordIdxs[1] - hitWordIdxs[0] === 1 && nextTok && !nextTok.hardPunctBefore && !nextTok.commaBefore && !NON_OBJ_FOLLOWERS.has(nextTok.low)) {
              continue;
            }
          }
          if (!instLitRisk && inferContextualLitRisk(wordToks, hitWordIdxs, cand)) {
            instLitRisk = true;
          }
        }

        // German V2 bracket ending in a separable particle: the particle closes the clause, so it must be followed
        // by line end, punctuation, a zu-infinitive or a clause break. Otherwise it is a preposition ("Angst vor dir").
        if (langCode === 'de' && cand.deBracket &&
            DE_SEP_PREFIXES.includes(cand.parts[cand.parts.length - 1])) {
          const nx = wordToks[hitWordIdxs[hitWordIdxs.length - 1] + 1];
          if (nx && !nx.hardPunctBefore && !nx.commaBefore && nx.low !== 'zu' && !DE_CLAUSE_BREAK.has(nx.low)) continue;
        }

        if (hitWordIdxs.some((x) => usedWord.has(x))) continue;
        const startRaw = wordToks[hitWordIdxs[0]].rawIdx;
        const endRaw = wordToks[hitWordIdxs[hitWordIdxs.length - 1]].rawIdx;
        const charStart = rawStarts[startRaw];
        const charEnd = rawStarts[endRaw] + tokens[endRaw].w.length;
        const surface = text.slice(charStart, charEnd);
        if (!checkReviewedSurface(langCode, cand.display.toLowerCase(), surface, text, charStart, charEnd)) continue;
        // For wide German V2 brackets ('**'), reserve only the matched anchor words so inner idioms/words can still match!
        if (cand.deBracket) {
          for (const x of hitWordIdxs) usedWord.add(x);
        } else {
          for (let k = hitWordIdxs[0]; k <= hitWordIdxs[hitWordIdxs.length - 1]; k++) usedWord.add(k);
        }

        // Include German reflexive pronoun immediately after V2 verb in anchorRanges when reflexive idiom matched ("stellt sich ... vor")
        const anchorWordIdxs = hitWordIdxs.slice();
        if (langCode === 'de' && cand.deBracket && hitWordIdxs[0] + 1 < wordToks.length) {
          const maybeRefl = wordToks[hitWordIdxs[0] + 1];
          if (DE_REFL_PRON.has(maybeRefl.low) && !anchorWordIdxs.includes(hitWordIdxs[0] + 1)) {
            anchorWordIdxs.splice(1, 0, hitWordIdxs[0] + 1);
          }
        }

        const anchorRanges = anchorWordIdxs.map((x) => {
          const ri = wordToks[x].rawIdx;
          return [rawStarts[ri], rawStarts[ri] + tokens[ri].w.length];
        });
        matches.push({
          pattern: cand.pattern,
          display: cand.display,
          type: cand.type,
          layer: cand.layer || cand.type,
          bucket: cand.bucket || classifyLayer(cand.layer, cand.type),
          native: cand.native || '',
          lit: cand.lit || '',
          eq: cand.eq || null,
          reading: cand.reading || '',
          gloss: cand.gloss || '',
          glossZh: cand.glossZh || '',
          glossMap: cand.glossMap || null,
          litRisk: instLitRisk,
          senses: cand.senses || null,
          idiomPrior: cand.idiomPrior,
          opacity: cand.opacity || 0,
          defJa: '',
          defKo: '',
          register: '',
          falseFriend: '',
          isBundle: cand.isBundle,
          priority: cand.priority,
          maxBand: cand.maxBand,
          deceptive: isDeceptive(cand.type, cand.maxBand, cand.opacity),
          surface,
          startRaw,
          endRaw,
          charStart: rawStarts[startRaw],
          charEnd: rawStarts[endRaw] + tokens[endRaw].w.length,
          anchorRanges,
          litRawSet: new Set(anchorWordIdxs.map((x) => wordToks[x].rawIdx)),
        });
        break;
      }
    }
    return appendReviewedExpressions(text, langCode, matches, rawStarts);
  };

  // ---------------------------------------------------------------------------
  // Universal N×N ("Vice-Versa") Gloss Resolver across all 12 Languages
  // ---------------------------------------------------------------------------
  // Priority:
  //  1) Lazy sidecar `gloss_<src>_<ui>.json` (`sidecarMap`: string | [meaning, lit] | { gloss, lit })
  //  2) Inline `fe.glossMap[ui]` or native language fields (`glossZh`, `defJa`, `defKo`, `gloss` for `en`)
  //  3) Cross-lingual `fe.eq[ui]` (or `fe_zh` chengyu gloss when `ui` is `zh`/`yue`/`en`)
  //  4) Fallback to `en` / `zh` / native definition (flagging `needsL1Mt = true` so UI can auto-translate via companion!)
  const resolveFeGloss = (fe, uiLangCode = 'en', opts = {}) => {
    if (!fe) return { text: '', lang: 'en', needsMt: false };
    if (fe.contextualGloss && normLang(uiLangCode) === 'en') return {text: fe.gloss, lang: 'en', needsMt: false};
    const uiRaw = String(uiLangCode || 'en').toLowerCase();
    const ui = normLang(uiRaw);
    const sidecar = (opts.sidecar && opts.sidecar.items) || opts.sidecar || null;
    const enGlossMap = (opts.enGlossMap && opts.enGlossMap.items) || opts.enGlossMap || null;
    const zhEq = opts.zhEq || fe._zhEq || null;

    // 1. Dedicated N×N sidecar (`gloss_<src>_<ui>.json`)
    if (sidecar) {
      const k1 = String(fe.display || '').toLowerCase();
      const k2 = String(fe.pattern || '').toLowerCase();
      const sHit = sidecar[fe.display] || sidecar[k1] || sidecar[fe.pattern] || sidecar[k2];
      if (sHit) {
        const txt = Array.isArray(sHit) ? sHit[0] : (typeof sHit === 'string' ? sHit : (sHit.g || sHit.gloss || sHit.meaning || ''));
        if (txt) return { text: txt, lang: ui, needsMt: false };
      }
    }

    // 2. Inline multilingual gloss dictionary (`extra.gloss[ui]`)
    if (fe.glossMap && typeof fe.glossMap === 'object') {
      const mHit = fe.glossMap[uiRaw] || fe.glossMap[ui];
      if (mHit) return { text: String(mHit), lang: ui, needsMt: false };
    }

    // 3. Legacy `fe_en_gloss.json` ([enGloss, zhGloss] or object)
    let enFallback = fe.gloss || '';
    let zhFallback = fe.glossZh || '';
    if (enGlossMap) {
      const eg = enGlossMap[String(fe.display || '').toLowerCase()] || enGlossMap[String(fe.pattern || '').toLowerCase()];
      if (Array.isArray(eg)) {
        enFallback = enFallback || eg[0] || '';
        zhFallback = zhFallback || eg[1] || '';
      } else if (eg && typeof eg === 'object') {
        if (eg[ui]) return { text: String(eg[ui]), lang: ui, needsMt: false };
        enFallback = enFallback || eg.en || eg.gloss || '';
        zhFallback = zhFallback || eg.zh || '';
      } else if (typeof eg === 'string') {
        enFallback = enFallback || eg;
      }
    }

    // 4. Direct match on existing dedicated fields
    const zEn = (zhEq && zhEq.glossEn) || '';
    const zZh = (zhEq && zhEq.glossZh) || '';
    if (ui === 'en' && (enFallback || zEn)) return { text: enFallback || zEn, lang: 'en', needsMt: false };
    if ((ui === 'zh' || ui === 'yue') && (zhFallback || zZh)) return { text: zhFallback || zZh, lang: 'zh', needsMt: false };
    if (ui === 'ja' && fe.defJa) return { text: fe.defJa, lang: 'ja', needsMt: false };
    if (ui === 'ko' && fe.defKo) return { text: fe.defKo, lang: 'ko', needsMt: false };

    // 5. Cross-lingual equivalent in learner's exact L1 (`extra.eq[ui]`)
    if (fe.eq && typeof fe.eq === 'object') {
      const eqVal = fe.eq[uiRaw] || fe.eq[ui] || (ui === 'yue' ? fe.eq.zh : null);
      if (eqVal) {
        const cleanEq = Array.isArray(eqVal) ? eqVal[0] : String(eqVal).split(/[；;]/)[0].trim();
        if (cleanEq) {
          const pivot = enFallback || zEn || zhFallback || zZh;
          return { text: pivot && ui !== 'en' ? `≈ ${cleanEq} (${pivot})` : cleanEq, lang: ui, needsMt: false };
        }
      }
    }

    // 6. Pivot fallback (marks needsMt: true when UI language != pivot language so companion can localize on demand)
    const bestPivot = enFallback || zEn || zhFallback || zZh || fe.defJa || fe.defKo || '';
    const pivotLang = (enFallback || zEn) ? 'en' : (zhFallback || zZh) ? 'zh' : fe.defJa ? 'ja' : fe.defKo ? 'ko' : '';
    return {
      text: bestPivot,
      lang: pivotLang || 'en',
      needsMt: Boolean(bestPivot && pivotLang && pivotLang !== ui && !(ui === 'yue' && pivotLang === 'zh')),
    };
  };

  const COVER_STEPS = [0.8, 0.9, 0.95, 0.98];
  const KNOW_SLOPE = 3.3;
  const pKnown = (rank, level) => (rank ? 1 / (1 + Math.pow(rank / level, KNOW_SLOPE)) : 0);

  const estimateLevel = (wordsMap, ranks, lang = 'en') => {
    if (!ranks) return null;
    const prefix = normLang(lang) + '|';
    const legacyPrefix = String(lang).split('-')[0].toLowerCase() + '|';
    const obs = [];
    for (const k in wordsMap) {
      const pLen = k.startsWith(prefix) ? prefix.length : (k.startsWith(legacyPrefix) ? legacyPrefix.length : 0);
      if (!pLen) continue;
      const st = wordsMap[k]; if (st !== 'known' && st !== 'learning') continue;
      const r = ranks[k.slice(pLen)]; if (r) obs.push([r, st === 'known']);
    }
    const nK = obs.filter((o) => o[1]).length, nL = obs.length - nK;
    if (obs.length < 12 || nK < 3 || nL < 3) return null;
    let best = 0, bestLL = -Infinity;
    for (let lv = 250; lv <= 30000; lv = Math.round(lv * 1.08)) {
      let ll = 0;
      for (const [r, k] of obs) { const p = Math.min(0.98, Math.max(0.02, pKnown(r, lv))); ll += Math.log(k ? p : 1 - p); }
      if (ll > bestLL) { bestLL = ll; best = lv; }
    }
    return { level: best, marks: obs.length, known: nK, learning: nL };
  };

  const vocabFit = (lineTokens, L, lang, ranks, wordsMap, vocabLevel = 2000) => {
    if (!ranks || !lineTokens) return null;
    const prefix = normLang(lang) + '|';
    const legacyPrefix = String(lang).split('-')[0].toLowerCase() + '|';
    const statusOf = (lem) => wordsMap[prefix + lem] || (legacyPrefix !== prefix ? wordsMap[legacyPrefix + lem] : '') || '';
    const rankOf = (low, lem) => { const a = ranks[low] || 0, b = ranks[lem] || 0; return a && b ? Math.min(a, b) : (a || b); };
    const cap = new Map();
    let midAll = 0, midUpAll = 0;
    if (!L.noSpace) {
      for (const toks of lineTokens) {
        let first = true;
        for (const tk of toks) {
          if (!tk.word) { if (/[.!?([]/.test(tk.w)) first = true; continue; }
          const low = tk.w.toLowerCase();
          if (!first && low.length > 1 && !/^i['’]/.test(low)) {
            const c = cap.get(low) || { mid: 0, up: 0 };
            c.mid++; midAll++;
            if (/^[\p{Lu}][^\p{Lu}]*$/u.test(tk.w)) { c.up++; midUpAll++; }
            cap.set(low, c);
          }
          first = false;
        }
      }
    }
    const names = new Set();
    const titleCase = midAll >= 20 && midUpAll / midAll > 0.3;
    if (!L.noSpace && !/^de/.test(normLang(lang)) && !titleCase) {
      for (const [w, c] of cap) if (c.mid >= 2 && c.up / c.mid >= 0.75) names.add(w);
    }

    let knownAbove = 0;
    for (const k in wordsMap) {
      if ((k.startsWith(prefix) || k.startsWith(legacyPrefix)) && wordsMap[k] === 'known') {
        const w = k.slice(k.indexOf('|') + 1);
        const r = ranks[w] || 0;
        if (!r || r > vocabLevel) knownAbove++;
      }
    }
    const learnCut = Math.ceil(Math.min(19999, (vocabLevel + knownAbove + 57) * 2));

    let total = 0, familiar = 0, learning = 0, nameTok = 0;
    const cands = new Map();
    const minLemmaLen = L.noSpace ? 1 : 2;
    for (let li = 0; li < lineTokens.length; li++) {
      for (const tk of lineTokens[li]) {
        if (!tk.word) continue;
        const low = tk.w.toLowerCase();
        const lem = L.lemma(tk.w);
        const st = statusOf(lem);
        total++;
        if (st === 'known') { familiar++; continue; }
        if (st === 'learning') { learning++; continue; }
        if (st === 'skipped') continue;
        if (names.has(low)) { familiar++; nameTok++; continue; }
        if (/['’]/.test(tk.w)) { familiar += pKnown(rankOf(low.replace(/['’].*$/, ''), '') || 1, vocabLevel); continue; }
        const rk = rankOf(low, lem);
        const p = pKnown(rk, vocabLevel);
        familiar += p;
        if ((rk && rk <= vocabLevel) || lem.length < minLemmaLen) continue;
        let c = cands.get(lem);
        if (!c) { c = { lemma: lem, sample: L.noSpace ? tk.w : tk.w.toLowerCase(), count: 0, miss: 0, rank: rk || 99999, firstLi: li }; cands.set(lem, c); }
        c.count++;
        c.miss += 1 - p;
      }
    }
    if (!total) return null;
    const queued = familiar + learning;
    const target = COVER_STEPS.find((s) => s > queued / total) || 0;
    const score = (c) => c.miss + Math.min(5, learnCut / Math.max(1, c.rank));
    const pool = [...cands.values()].filter((c) => c.rank <= learnCut || c.count >= 3).sort((a, b) => score(b) - score(a));
    const suggested = [];
    let after = queued;
    if (target) {
      for (const c of pool) {
        if (after / total >= target || suggested.length >= 20) break;
        suggested.push(c);
        after += c.miss;
      }
    }
    const pct = (n) => Math.round((n / total) * 1000) / 10;
    return {
      total, familiar, learning, nameTokens: nameTok, learnCut, vocabLevel,
      names: [...names],
      coveragePct: pct(familiar), queuedPct: pct(queued), afterPct: pct(after),
      target: Math.round(target * 100), reached: target ? after / total >= target : true,
      suggested,
      pool: pool.slice(0, 40),
    };
  };

  // Captionary / OpenSubtitles 4-tier word-frequency band classifier (<=2k core, 2k-8k mid, 8k-20k low, >20k rare)
  const classifyFreqBand = (rank, coreCut = 2000) => {
    const r = Number(rank || 0);
    if (!r || r <= 0 || r >= 99999) return 'rare_20k';
    if (r <= coreCut) return 'core';
    if (r <= 8000) return 'b2k_8k';
    if (r <= 20000) return 'b8k_20k';
    return 'rare_20k';
  };

  // Migaku-style 1T (i+1) Gold Sentence detector: flags lines with >=3 words and EXACTLY ONE unknown lexical or FE target
  const analyzeSentence1T = (toks, matches, L, lang, ranks, wordsMap, vocabLevel = 2000) => {
    const list = Array.isArray(toks) ? toks : (L && L.split ? L.split(String(toks || '')) : []);
    const langPfx = normLang(lang) + '|';
    const legPfx = String(lang || 'en').split('-')[0].toLowerCase() + '|';
    const nonBundleHits = (matches || []).filter((m) => m && !m.isBundle);
    const feAnchorCharSet = new Set();
    let curOff = 0;
    const tokenSpans = [];
    for (let i = 0; i < list.length; i++) {
      const tk = list[i];
      const c0 = curOff;
      const c1 = c0 + (tk.w ? tk.w.length : 0);
      curOff = c1;
      tokenSpans.push([c0, c1]);
    }
    for (const m of nonBundleHits) {
      const ranges = m.anchorRanges && m.anchorRanges.length
        ? m.anchorRanges
        : (m.charStart != null ? [[m.charStart, m.charEnd != null ? m.charEnd : m.charStart + String(m.surface || '').length]] : []);
      for (const [r0, r1] of ranges) {
        for (let k = r0; k < r1; k++) feAnchorCharSet.add(k);
      }
    }

    let wordCount = 0;
    const unknownLemmas = new Set();
    let unknownSample = '';
    for (let i = 0; i < list.length; i++) {
      const tk = list[i];
      if (!tk || !tk.word) continue;
      wordCount++;
      const low = tk.w.toLowerCase();
      if (/^[0-9]+$/.test(low) || /['’]/.test(tk.w)) continue;
      if ((L && typeof L.isStop === 'function' && L.isStop(low)) || (L && L.stop && L.stop.has && L.stop.has(low))) continue;
      if (i > 0 && /^[A-Z][a-zA-Z0-9-]{2,}$/.test(tk.w)) continue;
      const lem = L && L.lemma ? L.lemma(tk.w) : low;
      const minLen = L && L.noSpace ? 1 : 3;
      if (lem.length < minLen) continue;
      const st = (wordsMap && (wordsMap[langPfx + lem] || wordsMap[legPfx + lem])) || '';
      if (st === 'known') continue;
      const r = (ranks && (ranks[low] || ranks[lem])) || (ranks ? 99999 : 1);
      const isUnk = st === 'learning' || (ranks ? r > vocabLevel : false);
      if (!isUnk) continue;
      const [c0, c1] = tokenSpans[i];
      let insideSingleFe = false;
      if (nonBundleHits.length === 1) {
        for (let p = c0; p < c1; p++) {
          if (feAnchorCharSet.has(p)) { insideSingleFe = true; break; }
        }
        if (!insideSingleFe && nonBundleHits[0].litRawSet && nonBundleHits[0].litRawSet.has(i)) {
          insideSingleFe = true;
        }
      }
      if (!insideSingleFe) {
        unknownLemmas.add(lem);
        if (!unknownSample) unknownSample = tk.w;
      }
    }

    if (wordCount < 3) {
      return { is1T: false, kind: '', target: '', display: '', unknownCount: unknownLemmas.size, feCount: nonBundleHits.length };
    }
    if (nonBundleHits.length === 1 && unknownLemmas.size === 0) {
      const fe = nonBundleHits[0];
      return {
        is1T: true,
        kind: 'fe',
        target: fe.pattern || fe.display || fe.surface || '',
        display: fe.display || fe.surface || '',
        unknownCount: 0,
        feCount: 1,
      };
    }
    if (nonBundleHits.length === 0 && unknownLemmas.size === 1) {
      const targetLem = [...unknownLemmas][0];
      return {
        is1T: true,
        kind: 'word',
        target: targetLem,
        display: unknownSample || targetLem,
        unknownCount: 1,
        feCount: 0,
      };
    }
    return {
      is1T: false,
      kind: '',
      target: '',
      display: '',
      unknownCount: unknownLemmas.size,
      feCount: nonBundleHits.length,
    };
  };

  const analyzeVideo = (lines, L, lang, bands, ranks, wordsMap, feIndex, opts = {}) => {
    const rateEdges = opts.rateEdges || [130, 160, 190, 220];
    const coverThreshold = opts.coverThreshold || 0.85;
    const vocabLevel = opts.vocabLevel || 2000;
    const maxTargets = opts.maxTargets || 7;

    const rates = [];
    const bandCounts = {};
    let totalTokens = 0;
    let knownTokens = 0;
    let familiarTokens = 0;
    let lowConfLines = 0;
    const lineTokens = [];
    const lineMatches = [];
    const line1T = [];
    const gold1TLines = [];
    const feAgg = new Map();
    const wordFreqInVid = new Map();
    const propCandidates = new Map();
    const normCodeVal = normLang(lang);
    const langPrefix = normCodeVal + '|';
    const legacyPrefix = String(lang).split('-')[0].toLowerCase() + '|';

    for (let li = 0; li < lines.length; li++) {
      const ln = lines[li];
      const conf = ln.conf != null ? ln.conf : 1.0;
      const isLowConf = conf < 0.55;
      if (isLowConf) lowConfLines++;

      const toks = L.split(ln.t || '');
      lineTokens.push(toks);
      let wc = 0;
      let nonFirstIdx = 0;
      for (const tk of toks) {
        if (!tk.word) continue;
        wc++;
        totalTokens++;
        const low = tk.w.toLowerCase();
        const lem = L.lemma(tk.w);
        const status = (wordsMap && (wordsMap[langPrefix + lem] || wordsMap[legacyPrefix + lem])) || '';
        const r = (ranks && (ranks[low] || ranks[lem])) || 99999;
        if (status === 'known') {
          knownTokens++;
          familiarTokens++;
        } else if (r <= vocabLevel && status !== 'learning') {
          familiarTokens++;
        }
        const b = (bands && (bands[lem] || bands[low])) || 99;
        bandCounts[b] = (bandCounts[b] || 0) + 1;

        if (nonFirstIdx > 0 && normCodeVal !== 'de' && /^[\p{Lu}][\p{L}\p{N}-]{2,}$/u.test(tk.w)) {
          propCandidates.set(tk.w, (propCandidates.get(tk.w) || 0) + 1);
        }
        nonFirstIdx++;

        const minLen = L.noSpace ? 1 : 3;
        if (lem.length >= minLen) {
          let wObj = wordFreqInVid.get(lem);
          if (!wObj) {
            wObj = { lemma: lem, sample: L.noSpace ? tk.w : low, rank: r, band: b, count: 0, firstLi: li, status };
            wordFreqInVid.set(lem, wObj);
          }
          wObj.count++;
        }
      }

      const cueDur = ln.d != null ? ln.d : (ln.e != null ? Math.max(0, ln.e - ln.s) : 0);
      if (cueDur >= 0.9 && wc >= 3) {
        rates.push((wc / cueDur) * 60);
      }

      if (isLowConf) {
        lineMatches.push([]);
        line1T.push({ is1T: false, kind: '', target: '', display: '', unknownCount: 0, feCount: 0 });
        continue;
      }

      const hits = feIndex ? (feIndex.cjk ? matchCjk(ln.t, feIndex) : matchTokens(toks, L, feIndex, opts)) : [];
      if (feIndex && feIndex.cjk && hits.length && toks.map((x) => x.w).join('') === ln.t) {
        const starts = [];
        let off = 0;
        for (const tk of toks) { starts.push(off); off += tk.w.length; }
        for (const m of hits) {
          const a0 = m.charStart, a1 = m.charStart + m.surface.length;
          const idxs = [];
          const anchorIdxs = [];
          const ranges = m.anchorRanges || [[a0, a1]];
          for (let r = 0; r < toks.length; r++) {
            const t0 = starts[r], t1 = t0 + toks[r].w.length;
            if (t0 < a1 && t1 > a0) idxs.push(r);
            if (toks[r].word && ranges.some(([r0, r1]) => t0 < r1 && t1 > r0)) anchorIdxs.push(r);
          }
          if (idxs.length) {
            m.startRaw = idxs[0];
            m.endRaw = idxs[idxs.length - 1];
            m.litRawSet = new Set(anchorIdxs.length ? anchorIdxs : idxs.filter((r) => toks[r].word));
          }
        }
      }
      lineMatches.push(hits);
      const oneT = analyzeSentence1T(toks, hits, L, lang, ranks, wordsMap, vocabLevel);
      line1T.push(oneT);
      if (oneT.is1T) {
        gold1TLines.push({
          li,
          t: ln.s,
          line: ln.t,
          kind: oneT.kind,
          target: oneT.target,
          display: oneT.display,
        });
      }
      const cueEndT = ln.e != null ? ln.e : ln.s + (ln.d || 3);
      for (const m of hits) {
        let agg = feAgg.get(m.pattern);
        if (!agg) {
          const soundCue = hasSoundParallelism(m.display);
          agg = {
            pattern: m.pattern,
            display: m.display,
            type: m.type,
            layer: m.layer || '',
            bucket: m.bucket || classifyLayer(m.layer, m.type),
            native: m.native || '',
            lit: m.lit || '',
            eq: m.eq || null,
            hanja: m.hanja || '',
            defJa: m.defJa || '',
            defKo: m.defKo || '',
            glossMap: m.glossMap || null,
            litRisk: Boolean(m.litRisk),
            senses: m.senses || null,
            idiomPrior: m.idiomPrior != null ? m.idiomPrior : null,
            opacity: m.opacity || 0,
            register: m.register || '',
            falseFriend: m.falseFriend || '',
            isBundle: !!m.isBundle,
            priority: Math.round((m.priority + (m.deceptive ? 1.2 : 0)) * 100) / 100,
            maxBand: m.maxBand,
            deceptive: m.deceptive,
            soundCue,
            reading: m.reading || '',
            gloss: m.gloss || '',
            glossZh: m.glossZh || '',
            count: 0,
            occurrences: [],
          };
          feAgg.set(m.pattern, agg);
        }
        agg.count++;
        agg.occurrences.push({
          li,
          t: ln.s,
          endT: ln.s + (ln.d || 3),
          line: ln.t,
          surface: m.surface,
          anchorRanges: m.anchorRanges || null,
          conf,
        });
      }
    }

    rates.sort((a, b) => a - b);
    const wpm = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
    const p90Wpm = rates.length ? rates[Math.min(rates.length - 1, Math.floor(rates.length * 0.9))] : 0;
    const fastLinesPct = rates.length ? Math.round((rates.filter((r) => r >= 190).length / rates.length) * 100) : 0;
    const rateBand = wpm ? 1 + rateEdges.filter((x) => wpm >= x).length : 0;

    let vocabBand = 0;
    if (bands && totalTokens) {
      let acc = 0;
      for (let b = 1; b <= 5; b++) {
        acc += bandCounts[b] || 0;
        if (acc / totalTokens >= coverThreshold) {
          vocabBand = b;
          break;
        }
      }
      if (!vocabBand) vocabBand = 5;
    }

    const bandPct = {};
    if (totalTokens) {
      for (const b of [1, 2, 3, 4, 5, 99]) {
        bandPct[b === 99 ? 'other' : 'b' + b] = Math.round(((bandCounts[b] || 0) / totalTokens) * 100);
      }
    }

    const knownPct = totalTokens ? Math.round((knownTokens / totalTokens) * 100) : 0;
    let levelLabel = '';
    if (knownTokens > 0 && totalTokens > 0) {
      levelLabel = knownPct >= 90 ? 'Easy' : knownPct >= 75 ? 'Challenging' : 'Hard';
    } else if (vocabBand) {
      levelLabel = vocabBand <= 2 ? 'Easy' : vocabBand === 3 ? 'Challenging' : 'Hard';
    }

    const fit = vocabFit(lineTokens, L, lang, ranks, wordsMap, vocabLevel);
    const allWordsInVid = [...wordFreqInVid.values()];
    const toLearn = fit ? fit.pool : allWordsInVid
      .filter((x) => x.rank > vocabLevel || x.status === 'learning')
      .sort((a, b) => {
        const sa = (a.count * 2) / Math.log2(a.rank + 4) + (a.status === 'learning' ? 1 : 0);
        const sb = (b.count * 2) / Math.log2(b.rank + 4) + (b.status === 'learning' ? 1 : 0);
        return sb - sa;
      })
      .slice(0, 40);

    const allFEs = [...feAgg.values()].sort(
      (a, b) => (a.isBundle === b.isBundle ? 0 : a.isBundle ? 1 : -1)
        || (a.litRisk === b.litRisk ? 0 : a.litRisk ? 1 : -1)   // literal-prone entries after the rest (Gemini v0.7.0)
        || b.priority - a.priority || b.count - a.count
    );
    const nonBundleFEs = allFEs.filter((x) => !x.isBundle);
    const targetFEs = (nonBundleFEs.length >= maxTargets ? nonBundleFEs : allFEs).slice(0, maxTargets);

    const personalized = knownTokens > 0;
    const baseCovered = fit ? fit.familiar : familiarTokens;
    const feGainLemmas = new Set();
    let feGainTokens = 0;
    for (const fe of targetFEs) {
      const toks = fe.pattern.split(/\s+/).filter((t) => t && t !== '*' && t !== '**');
      for (const t of toks) {
        if (!feGainLemmas.has(t)) {
          feGainLemmas.add(t);
          const rec = wordFreqInVid.get(t);
          if (rec && (rec.rank > vocabLevel || rec.status === 'learning')) feGainTokens += rec.count;
        }
      }
    }
    let wordGainTokens = 0;
    for (const w of toLearn.slice(0, 8)) {
      if (!feGainLemmas.has(w.lemma) && (w.rank > vocabLevel || w.status === 'learning')) {
        wordGainTokens += w.count;
      }
    }
    const baseCovPct = totalTokens ? Math.min(100, Math.round((baseCovered / totalTokens) * 1000) / 10) : 0;
    const iPlusOnePct = totalTokens
      ? Math.min(100, Math.round(((baseCovered + feGainTokens + wordGainTokens) / totalTokens) * 1000) / 10)
      : 0;
    const iPlusOneStatus = baseCovPct >= 95 ? 'review' : baseCovPct >= 82 ? 'sweet_spot' : 'stretch';

    const rareTerms = allWordsInVid
      .filter((x) => x.rank >= 8000 || x.count >= 2)
      .sort((a, b) => b.count - a.count || b.rank - a.rank)
      .slice(0, 25)
      .map((x) => x.sample);
    const propList = [...propCandidates.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .slice(0, 25)
      .map((x) => x[0]);
    const glossaryCandidates = [...new Set([...propList, ...nonBundleFEs.slice(0, 15).map((x) => x.display), ...rareTerms])].slice(0, 60);

    // Prioritize ambiguous / medium-idiom_prior expressions for /prepass PIE disambiguation
    const pieSorted = nonBundleFEs.slice().sort((a, b) => {
      const aAmb = a.idiomPrior != null && a.idiomPrior < 0.75 ? 1 : 0;
      const bAmb = b.idiomPrior != null && b.idiomPrior < 0.75 ? 1 : 0;
      // lit_risk entries first too, so their literal uses get checked (Gemini v0.7.0)
      return bAmb - aAmb || (b.litRisk ? 1 : 0) - (a.litRisk ? 1 : 0) || b.priority - a.priority;
    });
    const pieInstances = pieSorted
      .slice(0, maxTargets)
      .map((fe) => {
        const o = fe.occurrences[0];
        return o ? { pattern: fe.pattern, display: fe.display, surface: o.surface, line: o.line, litRisk: fe.litRisk } : null;
      })
      .filter(Boolean);

    return {
      diff: {
        wpm: Math.round(wpm),
        p90Wpm: Math.round(p90Wpm),
        fastLinesPct,
        rate: rateBand,
        vocab: vocabBand,
        bandPct,
        knownPct,
        baseCovPct,
        vocabLevel,
        learnCut: fit ? fit.learnCut : 0,
        iPlusOnePct,
        iPlusOneStatus,
        personalized,
        knownTokens,
        totalTokens,
        lowConfLines,
        levelLabel,
        highDifficulty: rateBand >= 4 || vocabBand >= 4,
        gold1TCount: gold1TLines.length,
      },
      lineTokens,
      lineMatches,
      line1T,
      gold1TLines,
      allFEs,
      targetFEs,
      toLearn,
      allWords: allWordsInVid,
      fit,
      glossaryCandidates,
      pieInstances,
    };
  };

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const blankPhraseInLine = (line, surface, display = '', mask = '________', anchorRanges = null) => {
    const rawLine = String(line || '');
    const surf = String(surface || '').trim();
    if (!rawLine || !surf) return rawLine;
    // If multi-segment anchorRanges exist (e.g. German V2 separable bracket or CJK gapped frame), blank only the anchors!
    if (Array.isArray(anchorRanges) && anchorRanges.length >= 2) {
      const sorted = anchorRanges.slice().sort((a, b) => a[0] - b[0]);
      if (sorted[0][0] >= 0 && sorted[sorted.length - 1][1] <= rawLine.length) {
        let out = '';
        let pos = 0;
        for (const [r0, r1] of sorted) {
          if (r0 < pos) continue;
          out += rawLine.slice(pos, r0) + '____';
          pos = r1;
        }
        out += rawLine.slice(pos);
        return out;
      }
    }
    const directRe = new RegExp(escRe(surf), 'i');
    if (directRe.test(rawLine)) return rawLine.replace(directRe, mask);
    const segs = parseCjkSegments(surf) || parseCjkSegments(display);
    if (segs && segs.length >= 2) {
      const gapPat = segs.map(escRe).join('(.{1,8}?)');
      const gRe = new RegExp(gapPat, 'i');
      if (gRe.test(rawLine)) {
        return rawLine.replace(gRe, (...args) => {
          const mid = args.slice(1, segs.length);
          const out = [];
          for (let i = 0; i < segs.length; i++) {
            out.push('＿＿');
            if (i < mid.length) out.push(mid[i]);
          }
          return out.join('');
        });
      }
    }
    return `${rawLine}  [ ${mask} ]`;
  };

  const generateDrills = (targetFEs, allFEs, lines, transForFn, pieMap = {}) => {
    const pool = (targetFEs && targetFEs.length ? targetFEs : allFEs) || [];
    const eligible = [];
    for (const fe of pool) {
      const pie = pieMap && pieMap[fe.pattern];
      if (pie && pie.usage === 'literal') continue;
      const occ = (fe.occurrences || []).find((o) => {
        const lineConf = o.conf != null ? o.conf : (lines[o.li] && lines[o.li].conf);
        return lineConf == null || lineConf >= 0.55;
      });
      if (occ) eligible.push({ fe, occ });
      if (eligible.length >= 6) break;
    }
    if (!eligible.length) return { cloze: [], spelling: [], recall: [], speaking: [] };

    const distractorPool = allFEs.length >= 4 ? allFEs : pool;
    const cloze = [];
    const spelling = [];
    const recall = [];
    const speaking = [];

    eligible.forEach(({ fe, occ }, idx) => {
      const ln = lines[occ.li];
      const trans = transForFn ? transForFn(ln) : '';
      const blanked = blankPhraseInLine(occ.line, occ.surface, fe.display, '________', occ.anchorRanges);

      const others = distractorPool
        .filter((x) => x.pattern !== fe.pattern)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map((x) => (x.occurrences && x.occurrences[0] && x.occurrences[0].surface) || x.display);
      const options = [occ.surface, ...others].sort(() => 0.5 - Math.random());

      cloze.push({
        id: 'c_' + idx,
        pattern: fe.pattern,
        display: fe.display,
        answer: occ.surface,
        prompt: blanked,
        trans,
        options,
        t: occ.t,
        endT: occ.endT,
      });

      spelling.push({
        id: 's_' + idx,
        pattern: fe.pattern,
        display: fe.display,
        answer: occ.surface,
        prompt: blanked,
        trans,
        t: occ.t,
        endT: occ.endT,
      });

      const trimmedSurf = occ.surface.trim();
      const surfWords = trimmedSurf.split(/\s+/);
      let cuePrefix = '';
      let expectedTail = '';
      let recallMask = '________';
      if (surfWords.length > 1) {
        const half = Math.max(1, Math.ceil(surfWords.length / 2));
        cuePrefix = surfWords.slice(0, half).join(' ');
        expectedTail = surfWords.slice(half).join(' ') || trimmedSurf;
        recallMask = `${cuePrefix} ________`;
      } else {
        const chars = Array.from(trimmedSurf);
        if (chars.length >= 2) {
          const half = Math.max(1, Math.floor(chars.length / 2));
          cuePrefix = chars.slice(0, half).join('');
          expectedTail = chars.slice(half).join('');
          recallMask = `${cuePrefix}${'＿'.repeat(Math.max(2, chars.length - half))}`;
        } else {
          cuePrefix = '';
          expectedTail = trimmedSurf;
        }
      }
      const recallPrompt = blankPhraseInLine(occ.line, occ.surface, fe.display, recallMask);

      recall.push({
        id: 'r_' + idx,
        pattern: fe.pattern,
        display: fe.display,
        fullSurface: occ.surface,
        cuePrefix,
        expectedTail,
        prompt: recallPrompt,
        trans,
        t: occ.t,
        endT: occ.endT,
      });

      speaking.push({
        id: 'p_' + idx,
        pattern: fe.pattern,
        display: fe.display,
        target: occ.surface,
        line: occ.line,
        trans,
        t: occ.t,
        endT: occ.endT,
      });
    });

    return { cloze, spelling, recall, speaking };
  };

  // Lazy on-demand webpage FE index cache for select.js & player.js
  const _webFeIndexes = {};
  const _webFeLoading = {};
  const detectTextLangQuick = (text) => {
    const s = String(text || '');
    if (/[\u3040-\u30ff]/.test(s)) return 'ja';
    if (/[\uac00-\ud7af]/.test(s)) return 'ko';
    if (/[\u3400-\u9fff]/.test(s)) return /[係唔嘅咁咗嚟冇睇畀諗點樣乜嘢]/.test(s) ? 'yue' : 'zh';
    if (/[\u0400-\u04ff]/.test(s)) return 'ru';
    if (/[äöüß]/i.test(s) || /\b(nicht|ist|sich|und|eine|auf|für|dass)\b/i.test(s)) return 'de';
    if (/[çœæ]/i.test(s) || /\b(les|des|une|pas|dans|avec|c'est|qu')/i.test(s)) return 'fr';
    if (/[ñ¿¡]/i.test(s) || /\b(los|las|pero|está|qué)\b/i.test(s)) return 'es';
    if (/[ãõ]/i.test(s) || /\b(não|uma|são|você|isso)\b/i.test(s)) return 'pt';
    if (/\b(gli|sono|della|nella|questo|anche|perché)\b/i.test(s)) return 'it';
    if (/\b(ang|mga|nang|hindi|siya|kasi|naman)\b/i.test(s)) return 'tl';
    return 'en';
  };

  const fetchExtJsonSafe = (relFile) => {
    const clean = String(relFile || '').replace(/^data\//, '');
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ op: 'loadExtData', file: clean }, (resp) => {
            if (resp && resp.ok && resp.data != null) { resolve(resp.data); return; }
            if (typeof chrome.runtime.getURL === 'function' && typeof fetch === 'function' &&
                typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
              fetch(chrome.runtime.getURL('data/' + clean)).then((r) => (r.ok ? r.json() : null)).then(resolve, () => resolve(null));
              return;
            }
            resolve(null);
          });
        } catch (_) { resolve(null); }
      });
    }
    return Promise.resolve(null);
  };

  const _webSidecars = {};
  const _webSidecarLoading = {};
  const loadWebSidecar = (srcLang, uiLang) => {
    const s = normLang(srcLang || 'en');
    const u = normLang(uiLang || 'en');
    if (!s || !u || s === u) return Promise.resolve(null);
    const ck = `${s}_${u}`;
    if (Object.prototype.hasOwnProperty.call(_webSidecars, ck)) return Promise.resolve(_webSidecars[ck]);
    if (Object.prototype.hasOwnProperty.call(_webSidecarLoading, ck)) return _webSidecarLoading[ck];
    if (typeof chrome === 'undefined' || !chrome.runtime) return Promise.resolve(null);
    _webSidecarLoading[ck] = fetchExtJsonSafe(`gloss_${s}_${u}.json`)
      .then((d) => { _webSidecars[ck] = d || null; return _webSidecars[ck]; })
      .finally(() => { delete _webSidecarLoading[ck]; });
    return _webSidecarLoading[ck];
  };

  const cjkFeFiles = (lang) => lang === 'yue' ? ['fe_yue.json', 'fe_zh.json']
    : lang === 'ja' || lang === 'ko' ? [`fe_${lang}.json`, `fe_${lang}_study.json`] : [`fe_${lang}.json`];

  const ensureWebFeIndex = (lang) => {
    const l = normLang(lang || 'en');
    if (Object.prototype.hasOwnProperty.call(_webFeIndexes, l) && _webFeIndexes[l]) return Promise.resolve(_webFeIndexes[l]);
    if (Object.prototype.hasOwnProperty.call(_webFeLoading, l) && _webFeLoading[l]) return _webFeLoading[l];
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return Promise.resolve(null);
    }
    const isCjk = /^(zh|yue|ja|ko)$/.test(l);
    const files = isCjk ? cjkFeFiles(l) : [`fe_${l}.json`];
    _webFeLoading[l] = Promise.all(files.map(fetchExtJsonSafe))
      .then(async (jsons) => {
        const valid = jsons.filter(Boolean);
        if (!valid.length) return null;
        let idx = null;
        if (isCjk) {
          idx = buildCjkIndex(valid);
        } else {
          const [rj, formsData, eg] = await Promise.all([
            fetchExtJsonSafe(`ranks_${l}.json`),
            l !== 'en' ? fetchExtJsonSafe(`forms_${l}.json`) : Promise.resolve(null),
            l === 'en' ? fetchExtJsonSafe('fe_en_gloss.json') : Promise.resolve(null),
          ]);
          const langRanks = (rj && rj.items && typeof rj.items === 'object' && !Array.isArray(rj.items)) ? rj.items : rj;
          const langHub = (typeof globalThis !== 'undefined' && globalThis.SS_LANG) ? globalThis.SS_LANG : null;
          if (l === 'en' && langRanks && langHub && typeof langHub.setLexicon === 'function') {
            langHub.setLexicon(langRanks);
          }
          if (formsData && langHub && typeof langHub.setForms === 'function') {
            langHub.setForms(l, formsData);
          }
          idx = buildFeIndex(valid[0], langRanks || null, l);
          if (l === 'en' && idx && eg && eg.items) idx._enGloss = eg.items;
        }
        _webFeIndexes[l] = idx;
        return idx;
      })
      .finally(() => { delete _webFeLoading[l]; });
    return _webFeLoading[l];
  };

  const setWebFeIndexForTest = (lang, idx) => { _webFeIndexes[normLang(lang)] = idx; };
  const findInText = (text, uiLang = 'en', explicitSrcLang = '', options = {}) => {
    const s = String(text || '').trim();
    if (!s) return [];
    const srcLang = explicitSrcLang ? normLang(explicitSrcLang) : detectTextLangQuick(s);
    const idx = _webFeIndexes[srcLang];
    if (!idx) {
      ensureWebFeIndex(srcLang);
      loadWebSidecar(srcLang, uiLang);
      return [];
    }
    const sidecar = _webSidecars[`${srcLang}_${normLang(uiLang || 'en')}`] || null;
    if (!sidecar && normLang(uiLang || 'en') !== srcLang) loadWebSidecar(srcLang, uiLang);
    if (idx.cjk) {
      const hits = matchCjk(s, idx, srcLang === 'ja' && options.patterns === true);
      return (hits || []).filter((h) => !h.isBundle || h.bucket === 'frame').sort((a, b) => (a.litRisk ? 1 : 0) - (b.litRisk ? 1 : 0)).map((h) => {
        const surf = h.surface || h.display || '';
        return {
          phrase: h.display,
          canonical: h.display,
          surface: surf,
          start: h.charStart,
          end: typeof h.charEnd === 'number' ? h.charEnd : (typeof h.charStart === 'number' ? h.charStart + surf.length : undefined),
          anchorRanges: h.anchorRanges || null,
          reading: h.reading || '',
          bucket: h.bucket,
          type: h.type || '',
          native: h.native || '',
          litRisk: Boolean(h.litRisk),
          gloss: resolveFeGloss(h, uiLang, { sidecar }).text || h.gloss || h.glossZh || '',
        };
      });
    }
    const langHub = (typeof globalThis !== 'undefined' && globalThis.SS_LANG) ? globalThis.SS_LANG : null;
    if (!langHub || typeof langHub.get !== 'function') return [];
    const L = langHub.get(srcLang);
    const toks = L.split(s);
    const matches = matchTokens(toks, L, idx);
    return (matches || []).filter((m) => !m.isBundle).sort((a, b) => (a.litRisk ? 1 : 0) - (b.litRisk ? 1 : 0)).map((m) => {
      if (srcLang === 'en' && idx._enGloss && !m.gloss) {
        const eg = idx._enGloss[String(m.display || '').toLowerCase()];
        if (Array.isArray(eg)) { m.gloss = eg[0] || ''; m.glossZh = eg[1] || ''; }
      }
      const surface = m.surface || m.display || '';
      const pos = typeof m.charStart === 'number' ? m.charStart : s.toLowerCase().indexOf(String(surface).toLowerCase());
      return {
        phrase: m.display,
        canonical: m.display,
        surface,
        start: pos >= 0 ? pos : undefined,
        end: typeof m.charEnd === 'number' ? m.charEnd : (pos >= 0 ? pos + surface.length : undefined),
        anchorRanges: m.anchorRanges || null,
        reading: m.reading || '',
        bucket: m.bucket,
        type: m.type || '',
        native: m.native || '',
        litRisk: Boolean(m.litRisk),
        gloss: resolveFeGloss(m, uiLang, { sidecar, enGlossMap: idx._enGloss || null }).text || m.gloss || '',
      };
    });
  };

  const findInTextAsync = async (text, uiLang = 'en', explicitSrcLang = '') => {
    const s = String(text || '').trim();
    if (!s) return [];
    const srcLang = explicitSrcLang ? normLang(explicitSrcLang) : detectTextLangQuick(s);
    await Promise.all([ensureWebFeIndex(srcLang), loadWebSidecar(srcLang, uiLang)]);
    return findInText(s, uiLang, srcLang);
  };

  const recommendBlockScaffold = (text, lang = 'en', ranks = null, wordsMap = {}, vocabLevel = 2000, feIndex = null) => {
    const raw = String(text || '').trim();
    if (!raw) return { tier: 'pure_l2', coverage: 1, totalWords: 0, unknownWords: [], idioms: [], idiomCount: 0 };
    const normCode = normLang(lang || 'en');
    const langHub = typeof SS_LANG !== 'undefined' ? SS_LANG : globalThis.SS_LANG;
    const L = langHub && typeof langHub.get === 'function' ? langHub.get(normCode) : null;
    const toks = L ? L.split(raw) : raw.split(/(\s+)/).map((w) => ({ w, word: !/^\s+$/.test(w) && /\p{L}/u.test(w) }));
    const pfx = normCode + '|';
    const legPfx = String(lang || 'en').split('-')[0].toLowerCase() + '|';

    let feHits = [];
    if (feIndex) {
      feHits = feIndex.cjk ? matchCjk(raw, feIndex) : matchTokens(toks, L || { code: normCode, split: () => toks, lemma: (x) => x.toLowerCase() }, feIndex);
    } else if (_webFeIndexes[normCode]) {
      const wIdx = _webFeIndexes[normCode];
      feHits = wIdx.cjk ? matchCjk(raw, wIdx) : matchTokens(toks, L || { code: normCode, split: () => toks, lemma: (x) => x.toLowerCase() }, wIdx);
    }
    const meaningfulFEs = (feHits || []).filter((m) => m && !m.isBundle && !m.litRisk);

    let totalWords = 0;
    let knownScore = 0;
    const unknownWords = [];
    const seenUnk = new Set();
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (!tk || !tk.word) continue;
      const w = tk.w;
      const low = w.toLowerCase();
      if (/^[0-9]+$/.test(low)) continue;
      const lem = L && L.lemma ? L.lemma(w) : low;
      totalWords++;
      const st = (wordsMap && (wordsMap[pfx + lem] || wordsMap[legPfx + lem])) || '';
      if (st === 'known') {
        knownScore += 1;
        continue;
      }
      if (st === 'learning') {
        if (!seenUnk.has(lem)) { seenUnk.add(lem); unknownWords.push({ word: w, lemma: lem, rank: (ranks && (ranks[low] || ranks[lem])) || 0, status: st }); }
        continue;
      }
      if (i > 0 && normCode !== 'de' && /^[A-Z][a-z]{2,}$/.test(w)) {
        knownScore += 1;
        continue;
      }
      const r = ranks ? (ranks[low] || ranks[lem] || 0) : 0;
      if (ranks) {
        const effRank = r > 0 ? r : (lem.length >= (L && L.noSpace ? 1 : 3) ? 99999 : 500);
        const p = pKnown(effRank, vocabLevel);
        knownScore += p;
        if (effRank > vocabLevel && !seenUnk.has(lem) && lem.length >= (L && L.noSpace ? 1 : 2)) {
          seenUnk.add(lem);
          unknownWords.push({ word: w, lemma: lem, rank: effRank, status: 'new' });
        }
      } else {
        // Without a rank lexicon, treat frequent/short tokens as known unless explicitly learning
        knownScore += (low.length <= 4 ? 0.98 : 0.9);
      }
    }
    unknownWords.sort((a, b) => (b.rank || 0) - (a.rank || 0));
    const coverage = totalWords > 0 ? Math.min(1, Math.round((knownScore / totalWords) * 1000) / 1000) : 1;
    const idiomCount = meaningfulFEs.length;
    let tier = 'selective_i1';
    if (coverage < 0.88) tier = 'full_bilingual';
    else if (coverage > 0.97 && unknownWords.length === 0 && idiomCount === 0) tier = 'pure_l2';
    return {
      tier,
      coverage,
      totalWords,
      unknownWords: unknownWords.slice(0, 3),
      idioms: meaningfulFEs.slice(0, 3),
      idiomCount,
    };
  };

  return {
    normLang,
    findInText,
    findInTextAsync,
    setWebFeIndexForTest,
    ensureWebFeIndex,
    resolveNativeLabel,
    NATIVE_LABELS,
    isCjkLang,
    classifyLayer,
    patternizePhrase,
    splitGermanSepVerb,
    resolveFeGloss,
    blankPhraseInLine,
    buildFeIndex,
    buildCjkIndex,
    cjkFeFiles,
    matchCjk,
    matchTokens,
    classifyFreqBand,
    analyzeSentence1T,
    analyzeVideo,
    vocabFit,
    recommendBlockScaffold,
    estimateLevel,
    pKnown,
    generateDrills,
    isDeceptive,
    isBundleType,
  };
})();

if (typeof globalThis !== "undefined" && typeof window !== "undefined" && window.SS_IDIOMS) globalThis.SS_IDIOMS = window.SS_IDIOMS;
