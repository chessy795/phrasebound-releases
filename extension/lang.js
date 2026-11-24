// Per-language tokenisation, 4-family lemmatisation, 12-language detection, and sentence merging.
// Hard-capped 12-language flagship roster:
//   1) CJK / Hangul family: zh (Mandarin), yue (Cantonese), ja (Japanese), ko (Korean)
//   2) Germanic family:     en (English), de (German)
//   3) Romance family:      es (Spanish), fr (French), pt (Portuguese), it (Italian)
//   4) Slavic + Austronesian: ru (Russian), tl (Tagalog / Filipino)
// Uses native Intl.Segmenter for CJK/non-space scripts and zero-HTML/Trusted-Types-clean pure JS.
(typeof window !== "undefined" ? window : globalThis).SS_LANG = (typeof globalThis !== "undefined" && globalThis.SS_LANG) || (() => {
  const SUPPORTED_12 = ['en', 'zh', 'yue', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'tl'];
  const SUPPORTED_SET = new Set(SUPPORTED_12);

  const LANG_META = {
    en: { code: 'en', label: 'English', short: 'EN', native: 'English', family: 'germanic', tts: 'en-US' },
    zh: { code: 'zh', label: 'Chinese (Mandarin)', short: 'ZH', native: '中文', family: 'cjk', tts: 'zh-CN' },
    yue: { code: 'yue', label: 'Cantonese', short: 'YUE', native: '粵語', family: 'cjk', tts: 'zh-HK' },
    ja: { code: 'ja', label: 'Japanese', short: 'JA', native: '日本語', family: 'cjk', tts: 'ja-JP' },
    ko: { code: 'ko', label: 'Korean', short: 'KO', native: '한국어', family: 'cjk', tts: 'ko-KR' },
    es: { code: 'es', label: 'Spanish', short: 'ES', native: 'Español', family: 'romance', tts: 'es-ES' },
    fr: { code: 'fr', label: 'French', short: 'FR', native: 'Français', family: 'romance', tts: 'fr-FR' },
    de: { code: 'de', label: 'German', short: 'DE', native: 'Deutsch', family: 'germanic', tts: 'de-DE' },
    pt: { code: 'pt', label: 'Portuguese', short: 'PT', native: 'Português', family: 'romance', tts: 'pt-BR' },
    it: { code: 'it', label: 'Italian', short: 'IT', native: 'Italiano', family: 'romance', tts: 'it-IT' },
    ru: { code: 'ru', label: 'Russian', short: 'RU', native: 'Русский', family: 'slavic', tts: 'ru-RU' },
    tl: { code: 'tl', label: 'Tagalog (Filipino)', short: 'TL', native: 'Tagalog', family: 'austronesian', tts: 'fil-PH' },
  };

  // Normalize any BCP-47 / ISO-639 tag into our canonical code ('yue' distinct from 'zh', 'fil'/'tgl' -> 'tl').
  const normCode = (rawTag) => {
    const raw = String(rawTag || 'en').trim().toLowerCase().replace(/_/g, '-');
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
    if (base === 'eng') return 'en';
    return base || 'en';
  };

  // Translation and subtitle tracks must distinguish Mandarin scripts and Cantonese.
  const translationLanguageKey = (value) => {
    const tag = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (!tag) return '';
    const [base, ...subtags] = tag.split('-');
    if (base === 'yue' || subtags.includes('yue')) return 'yue';
    if (['zh', 'cmn', 'zho', 'cn'].includes(base)) {
      if (subtags.includes('hans')) return 'zh-hans';
      return subtags.some(part => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh-hant' : 'zh-hans';
    }
    return normCode(base);
  };

  // Pluggable external inflection maps (e.g. data/forms_<lang>.json built from Kaikki forms)
  const toNullDict = (src) => {
    if (!src || typeof src !== 'object') return null;
    if (Object.getPrototypeOf(src) === null) return src;
    return Object.assign(Object.create(null), src);
  };
  const hasOwnVal = (obj, key) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
  const _formsByLang = new Map();
  let _enLex = null;
  const setLexicon = (obj) => { _enLex = toNullDict(obj); };
  const setForms = (lang, mapObj) => {
    const c = normCode(lang);
    if (mapObj && typeof mapObj === 'object') {
      const inner = (mapObj.items && typeof mapObj.items === 'object' && !Array.isArray(mapObj.items)) ? mapObj.items : mapObj;
      _formsByLang.set(c, toNullDict(inner));
    }
  };
  const lookupForm = (lang, low) => {
    const m = _formsByLang.get(lang);
    const v = m ? m[low] : '';   // never Object.prototype keys (constructor, toString)
    return typeof v === 'string' ? v : '';
  };

  // ---------------------------------------------------------------------------
  // Family 2A: English Irregulars & Morphological Lemmatiser
  // ---------------------------------------------------------------------------
  const IRREG = {
    am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
    has: 'have', had: 'have', having: 'have',
    does: 'do', did: 'do', done: 'do', doing: 'do',
    went: 'go', gone: 'go', goes: 'go',
    came: 'come', comes: 'come',
    took: 'take', taken: 'take', takes: 'take',
    got: 'get', gotten: 'get', gets: 'get',
    made: 'make', makes: 'make',
    said: 'say', says: 'say',
    saw: 'see', seen: 'see', sees: 'see',
    knew: 'know', known: 'know', knows: 'know',
    thought: 'think', thinks: 'think',
    gave: 'give', given: 'give', gives: 'give',
    found: 'find', finds: 'find',
    told: 'tell', tells: 'tell',
    felt: 'feel', feels: 'feel',
    kept: 'keep', keeps: 'keep',
    left: 'leave', leaves: 'leave',
    brought: 'bring', brings: 'bring',
    began: 'begin', begun: 'begin', begins: 'begin',
    broke: 'break', broken: 'break', breaks: 'break',
    built: 'build', builds: 'build',
    bought: 'buy', buys: 'buy',
    caught: 'catch', catches: 'catch',
    chose: 'choose', chosen: 'choose', chooses: 'choose',
    drank: 'drink', drunk: 'drink', drinks: 'drink',
    drove: 'drive', driven: 'drive', drives: 'drive',
    ate: 'eat', eaten: 'eat', eats: 'eat',
    fell: 'fall', fallen: 'fall', falls: 'fall',
    fought: 'fight', fights: 'fight',
    flew: 'fly', flown: 'fly', flies: 'fly',
    forgot: 'forget', forgotten: 'forget', forgets: 'forget',
    grew: 'grow', grown: 'grow', grows: 'grow',
    held: 'hold', holds: 'hold',
    laid: 'lay', lays: 'lay',
    led: 'lead', leads: 'lead',
    lost: 'lose', loses: 'lose',
    meant: 'mean', means: 'mean',
    met: 'meet', meets: 'meet',
    paid: 'pay', pays: 'pay',
    ran: 'run', runs: 'run',
    sent: 'send', sends: 'send',
    shook: 'shake', shaken: 'shake', shakes: 'shake',
    shot: 'shoot', shoots: 'shoot',
    sang: 'sing', sung: 'sing', sings: 'sing',
    sat: 'sit', sits: 'sit',
    slept: 'sleep', sleeps: 'sleep',
    spoke: 'speak', spoken: 'speak', speaks: 'speak',
    spent: 'spend', spends: 'spend',
    stood: 'stand', stands: 'stand',
    stole: 'steal', stolen: 'steal', steals: 'steal',
    stuck: 'stick', sticks: 'stick',
    struck: 'strike', strikes: 'strike',
    swore: 'swear', sworn: 'swear', swears: 'swear',
    taught: 'teach', teaches: 'teach',
    threw: 'throw', thrown: 'throw', throws: 'throw',
    understood: 'understand', understands: 'understand',
    woke: 'wake', woken: 'wake', wakes: 'wake',
    wore: 'wear', worn: 'wear', wears: 'wear',
    won: 'win', wins: 'win',
    wrote: 'write', written: 'write', writes: 'write',
    lit: 'light', lighting: 'light',
    hung: 'hang', knelt: 'kneel', dwelt: 'dwell',
    rising: 'rise', rose: 'rise', risen: 'rise',
    hid: 'hide', hidden: 'hide',
    bit: 'bite', bitten: 'bite',
    blew: 'blow', blown: 'blow', blows: 'blow',
    drew: 'draw', drawn: 'draw', draws: 'draw',
    tore: 'tear', torn: 'tear', tears: 'tear',
    froze: 'freeze', frozen: 'freeze', freezes: 'freeze',
    beaten: 'beat', beats: 'beat',
    dug: 'dig', digs: 'dig',
    spun: 'spin', spins: 'spin',
    swung: 'swing', swings: 'swing',
    sank: 'sink', sunk: 'sink', sinks: 'sink',
    shrank: 'shrink', shrunk: 'shrink', shrinks: 'shrink',
    rang: 'ring', rung: 'ring', rings: 'ring',
    sprang: 'spring', sprung: 'spring', springs: 'spring',
    slid: 'slide', slides: 'slide',
    swept: 'sweep', sweeps: 'sweep',
    crept: 'creep', creeps: 'creep',
    leapt: 'leap', leaps: 'leap',
    dealt: 'deal', deals: 'deal',
    fed: 'feed', feeds: 'feed',
    bled: 'bleed', fled: 'flee', sped: 'speed',
    wound: 'wind', bound: 'bind', ground: 'grind',
    shut: 'shut', burst: 'burst', split: 'split',
    used: 'use', using: 'use',
    going: 'go', doing: 'do', being: 'be', seeing: 'see', having: 'have', coming: 'come',
    dying: 'die', lying: 'lie', tying: 'tie', eyeing: 'eye',
    gonna: 'go', wanna: 'want', gotta: 'get', kinda: 'kind', sorta: 'sort', outta: 'out',
    gentlemen: 'gentleman', men: 'man', women: 'woman', children: 'child', people: 'person',
    teeth: 'tooth', feet: 'foot', mice: 'mouse', geese: 'goose',
    lives: 'life', wives: 'wife', knives: 'knife', leaves: 'leaf', wolves: 'wolf', thieves: 'thief',
  };

  const en = {
    code: 'en',
    family: 'germanic',
    noSpace: false,
    dict: true,
    split(t) {
      const out = [];
      const re = /[A-Za-z]+(?:['’][A-Za-z]+)*|[^A-Za-z]+/g;
      let m;
      while ((m = re.exec(t))) out.push({ w: m[0], word: /[A-Za-z]/.test(m[0]) });
      return out;
    },
    lemma(w) {
      w = w.toLowerCase().replace(/’/g, "'").replace(/'(s|re|ve|ll|d|m)$/, '').replace(/n't$/, '');
      const ext = lookupForm('en', w);
      if (ext) return ext;
      if (hasOwnVal(IRREG, w)) return IRREG[w];
      if (_enLex && w.length > 4 && /in$/.test(w) && !_enLex[w] && _enLex[w + 'g']) return en.lemma(w + 'g');
      if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (w.length > 5 && /(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
      if (w.length > 3 && /[^s]s$/.test(w) && !/(us|is)$/.test(w)) return w.slice(0, -1);
      if (w.length > 5 && /ing$/.test(w)) {
        let b = w.slice(0, -3);
        if (b.length > 2 && /([^lsfz])\1$/.test(b)) return b.slice(0, -1);
        if (b.length > 3 && /([lsfz])\1$/.test(b) && _enLex && !_enLex[b] && _enLex[b.slice(0, -1)]) return b.slice(0, -1);
        if (_enLex && !_enLex[b] && _enLex[b + 'e']) return b + 'e';
        if (/(ur|us|ov|iv|iz|at|ak|ic|ig|c|v)$/.test(b)) return b + 'e';
        return b;
      }
      if (w.length > 4 && /ed$/.test(w)) {
        if (w.length > 5 && /ied$/.test(w)) return w.slice(0, -3) + 'y';
        let b = w.slice(0, -2);
        if (b.length > 2 && /([^lsfz])\1$/.test(b)) return b.slice(0, -1);
        if (b.length > 3 && /([lsfz])\1$/.test(b) && _enLex && !_enLex[b] && _enLex[b.slice(0, -1)]) return b.slice(0, -1);
        if (_enLex && !_enLex[b] && _enLex[b + 'e']) return b + 'e';
        if (/(ur|us|ov|iv|iz|at|ak|ic|ig|c|v)$/.test(b)) return b + 'e';
        return b;
      }
      return w;
    },
    countWords(t) { return (t.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).length; },
  };

  // ---------------------------------------------------------------------------
  // Family 2B: German (de) Strong/Irregular Verbs + Separable Participles
  // ---------------------------------------------------------------------------
  const DE_SEP_PREFIXES = [
    'zurück', 'zusammen', 'weiter', 'wieder', 'heraus', 'herein', 'herum', 'herunter', 'hinauf', 'hinaus', 'hinein',
    'vorbei', 'entlang', 'gegenüber', 'davon', 'dabei', 'daran', 'darauf', 'daraus', 'darein',
    'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'fest', 'frei', 'her', 'hin', 'los', 'mit', 'nach', 'rein', 'raus', 'rum',
    'vor', 'weg', 'zu', 'um', 'durch', 'über', 'unter',
    'statt', 'wahr', 'fern', 'hoch', 'voran', 'voraus', 'zurecht', 'hinterher', 'entgegen', 'nieder', 'dar', 'hinweg',
    'herbei', 'drauflos', 'kaputt', 'schief', 'tot', 'lieb', 'kurz', 'groß', 'gut', 'fertig', 'dicht', 'quer', 'rückwärts', 'kennen',
  ];

  const DE_IRREG = {
    bin: 'sein', bist: 'sein', ist: 'sein', sind: 'sein', seid: 'sein', war: 'sein', warst: 'sein', waren: 'sein', gewesen: 'sein', wäre: 'sein', wären: 'sein',
    habe: 'haben', hast: 'haben', hat: 'haben', habt: 'haben', hatte: 'haben', hatten: 'haben', gehabt: 'haben', hätte: 'haben', hätten: 'haben',
    werde: 'werden', wirst: 'werden', wird: 'werden', wurde: 'werden', wurden: 'werden', geworden: 'werden', würde: 'werden', würden: 'werden',
    kann: 'können', kannst: 'können', konnte: 'können', konnten: 'können', gekonnt: 'können', könnte: 'können',
    muss: 'müssen', musst: 'müssen', musste: 'müssen', mussten: 'müssen', gemusst: 'müssen', müsste: 'müssen',
    will: 'wollen', willst: 'wollen', wollte: 'wollen', wollten: 'wollen', gewollt: 'wollen',
    soll: 'sollen', sollst: 'sollen', sollte: 'sollen', sollten: 'sollen',
    darf: 'dürfen', darfst: 'dürfen', durfte: 'dürfen', durften: 'dürfen',
    mag: 'mögen', magst: 'mögen', mochte: 'mögen', möchte: 'mögen', möchten: 'mögen',
    nehme: 'nehmen', nimmst: 'nehmen', nimmt: 'nehmen', nahm: 'nehmen', nahmen: 'nehmen', genommen: 'nehmen', nimm: 'nehmen',
    gebe: 'geben', gibst: 'geben', gibt: 'geben', gab: 'geben', gaben: 'geben', gegeben: 'geben', gib: 'geben',
    gehe: 'gehen', gehst: 'gehen', geht: 'gehen', ging: 'gehen', gingen: 'gehen', gegangen: 'gehen',
    komme: 'kommen', kommst: 'kommen', kommt: 'kommen', kam: 'kommen', kamen: 'kommen', gekommen: 'kommen',
    sehe: 'sehen', siehst: 'sehen', sieht: 'sehen', sah: 'sehen', sahen: 'sehen', gesehen: 'sehen', sieh: 'sehen',
    spreche: 'sprechen', sprichst: 'sprechen', spricht: 'sprechen', sprach: 'sprechen', gesprochen: 'sprechen',
    halte: 'halten', hältst: 'halten', hält: 'halten', hielt: 'halten', gehalten: 'halten',
    lasse: 'lassen', lässt: 'lassen', ließ: 'lassen', ließen: 'lassen', gelassen: 'lassen',
    ziehe: 'ziehen', ziehst: 'ziehen', zieht: 'ziehen', zog: 'ziehen', zogen: 'ziehen', gezogen: 'ziehen',
    schlage: 'schlagen', schlägst: 'schlagen', schlägt: 'schlagen', schlug: 'schlagen', geschlagen: 'schlagen',
    falle: 'fallen', fällst: 'fallen', fällt: 'fallen', fiel: 'fallen', fielen: 'fallen', gefallen: 'fallen',
    bringe: 'bringen', bringst: 'bringen', bringt: 'bringen', brachte: 'bringen', brachten: 'bringen', gebracht: 'bringen',
    denke: 'denken', denkst: 'denken', denkt: 'denken', dachte: 'denken', dachten: 'denken', gedacht: 'denken',
    weiß: 'wissen', weißt: 'wissen', wusste: 'wissen', wussten: 'wissen', gewusst: 'wissen',
    stehe: 'stehen', stehst: 'stehen', steht: 'stehen', stand: 'stehen', standen: 'stehen', gestanden: 'stehen',
    liege: 'liegen', liegst: 'liegen', liegt: 'liegen', lag: 'liegen', lagen: 'liegen', gelegen: 'liegen',
    sitze: 'sitzen', sitzt: 'sitzen', saß: 'sitzen', saßen: 'sitzen', gesessen: 'sitzen',
    finde: 'finden', findest: 'finden', findet: 'finden', fand: 'finden', fanden: 'finden', gefunden: 'finden',
    trage: 'tragen', trägst: 'tragen', trägt: 'tragen', trug: 'tragen', getragen: 'tragen',
    fahre: 'fahren', fährst: 'fahren', fährt: 'fahren', fuhr: 'fahren', gefahren: 'fahren',
    laufe: 'laufen', läufst: 'laufen', läuft: 'laufen', lief: 'laufen', gelaufen: 'laufen',
    werfe: 'werfen', wirfst: 'werfen', wirft: 'werfen', warf: 'werfen', geworfen: 'werfen',
    breche: 'brechen', brichst: 'brechen', bricht: 'brechen', brach: 'brechen', gebrochen: 'brechen',
    treffe: 'treffen', triffst: 'treffen', trifft: 'treffen', traf: 'treffen', getroffen: 'treffen',
    helfe: 'helfen', hilfst: 'helfen', hilft: 'helfen', half: 'helfen', geholfen: 'helfen',
    reiße: 'reißen', reißt: 'reißen', riss: 'reißen', gerissen: 'reißen',
    beiße: 'beißen', beißt: 'beißen', biss: 'beißen', gebissen: 'beißen',
    greife: 'greifen', greift: 'greifen', griff: 'greifen', gegriffen: 'greifen',
    pfeife: 'pfeifen', pfeift: 'pfeifen', pfiff: 'pfeifen', gepfiffen: 'pfeifen',
    binde: 'binden', bindet: 'binden', band: 'binden', gebunden: 'binden',
    wickle: 'wickeln', wickelt: 'wickeln', gewickelt: 'wickeln',
    stelle: 'stellen', stellst: 'stellen', stellt: 'stellen', stellte: 'stellen', stellten: 'stellen', gestellt: 'stellen',
    mache: 'machen', machst: 'machen', macht: 'machen', machte: 'machen', machten: 'machen', gemacht: 'machen',
    lege: 'legen', legst: 'legen', legt: 'legen', legte: 'legen', gelegt: 'legen',
    setze: 'setzen', setzt: 'setzen', setzte: 'setzen', gesetzt: 'setzen',
    spiele: 'spielen', spielst: 'spielen', spielt: 'spielen', spielte: 'spielen', gespielt: 'spielen',
    sage: 'sagen', sagst: 'sagen', sagt: 'sagen', sagte: 'sagen', gesagt: 'sagen',
    rede: 'reden', redest: 'reden', redet: 'reden', redete: 'reden', geredet: 'reden',
    höre: 'hören', hörst: 'hören', hört: 'hören', hörte: 'hören', gehört: 'hören',
    kaufe: 'kaufen', kaufst: 'kaufen', kauft: 'kaufen', kaufte: 'kaufen', gekauft: 'kaufen',
    tappe: 'tappen', tappt: 'tappen', tappte: 'tappen', getappt: 'tappen',
    haue: 'hauen', haust: 'hauen', haut: 'hauen', haute: 'hauen', gehauen: 'hauen',
    drücke: 'drücken', drückst: 'drücken', drückt: 'drücken', drückte: 'drücken', gedrückt: 'drücken',
    schau: 'schauen', schaue: 'schauen', schaust: 'schauen', schaut: 'schauen',
    guck: 'gucken', gucke: 'gucken', guckst: 'gucken', guckt: 'gucken',
    einem: 'ein', einen: 'ein', einer: 'ein', eines: 'ein', eine: 'ein',
    dem: 'der', den: 'der', des: 'der', die: 'der', das: 'der',
    meinem: 'mein', meinen: 'mein', meiner: 'mein', meine: 'mein',
    deinem: 'dein', deinen: 'dein', deiner: 'dein', deine: 'dein',
    seinem: 'sein', seinen: 'sein', seiner: 'sein', seine: 'sein',
  };

  // Protected German nouns/adjectives/adverbs that end in -t/-te/-st/-e so weak-verb stripping doesn't mangle them
  const DE_KEEP = new Set([
    'nicht', 'nichts', 'jetzt', 'sonst', 'fast', 'erst', 'selbst', 'oft', 'halt', 'echt', 'ganz', 'kurz',
    'hand', 'wand', 'land', 'sand', 'rand', 'band', 'mund', 'hund', 'grund', 'stunde', 'runde', 'wunde',
    'zeit', 'seite', 'weite', 'leute', 'heute', 'beute', 'welt', 'geld', 'feld', 'held', 'zelt',
    'wort', 'ort', 'fort', 'dort', 'art', 'fahrt', 'bart', 'zart', 'hart',
    'nacht', 'macht', 'acht', 'sicht', 'licht', 'pflicht', 'gericht', 'gesicht', 'gewicht', 'recht', 'weg', 'paar', 'laut',
    'kopf', 'topf', 'zopf', 'arm', 'auge', 'augen', 'ohr', 'ohren', 'nase', 'herz', 'herzen', 'fuß', 'füße', 'bein', 'beine',
    'katze', 'sack', 'nagel', 'tisch', 'stuhl', 'luft', 'lust', 'brust', 'faust', 'angst', 'kunst', 'gunst', 'dienst',
  ]);

  const deLemma = (raw) => {
    const w = raw.toLowerCase();
    const ext = lookupForm('de', w);
    if (ext) return ext;
    if (hasOwnVal(DE_IRREG, w)) return DE_IRREG[w];
    if (DE_KEEP.has(w) || w.length <= 3) return w;

    // Separable participle: vorgestellt -> vor + gestellt -> vorstellen; reingefallen -> rein + gefallen -> reinfallen
    for (const pfx of DE_SEP_PREFIXES) {
      if (w.length >= pfx.length + 5 && w.startsWith(pfx + 'ge')) {
        const tail = w.slice(pfx.length); // e.g. 'gestellt', 'gefallen', 'gemacht'
        const baseVerb = DE_IRREG[tail] || (tail.endsWith('t') && tail.length >= 5 ? tail.slice(2, -1) + 'en' : tail.endsWith('en') ? tail.slice(2) : '');
        // zurückgeben / weggehen are infinitives of ge- verbs, not participles: 'ben' / 'hen' are no verb stems
        if (baseVerb && baseVerb.endsWith('en') && baseVerb.length >= 5) return pfx + baseVerb;
      }
    }
    // Separable zu-infinitive: wegzugehen -> weggehen, anzurühren -> anrühren
    for (const pfx of DE_SEP_PREFIXES) {
      if (pfx !== 'zu' && w.length >= pfx.length + 6 && w.startsWith(pfx + 'zu') && w.endsWith('en')) return pfx + w.slice(pfx.length + 2);
    }
    // Regular ge-...-t participle: gemacht / gekauft / gespielt (skip ge- nouns in DE_KEEP)
    if (w.startsWith('ge') && w.length >= 6 && w.endsWith('t') && !w.endsWith('keit') && !w.endsWith('heit')) {
      const stem = w.slice(2, -1);
      if (stem.length >= 3) return stem + 'en';
    }
    // Common German plural nouns in idioms: Augen -> Auge, Ohren -> Ohr, Daumen -> Daumen, Bären -> Bär
    if (w === 'bären') return 'bär';
    if (w === 'füßen' || w === 'füße') return 'fuß';
    if (w === 'händen' || w === 'hände') return 'hand';
    if (w === 'köpfe' || w === 'köpfen') return 'kopf';
    if (w === 'wänden' || w === 'wände') return 'wand';

    // Weak verb endings (-test, -ten, -te, -st)
    if (w.length >= 6 && w.endsWith('test')) return w.slice(0, -4) + 'en';
    if (w.length >= 6 && w.endsWith('ten') && !w.endsWith('sten') && !w.endsWith('iten')) return w.slice(0, -3) + 'en';
    if (w.length >= 5 && w.endsWith('st') && !w.endsWith('ist') && !w.endsWith('ust') && !w.endsWith('ast')) return w.slice(0, -2) + 'en';
    return w;
  };

  // ---------------------------------------------------------------------------
  // Family 3: Romance (es, fr, pt, it) Clitic / Enclitic & Verb Lemmatisers
  // ---------------------------------------------------------------------------
  const stripAccentsKeepN = (s) =>
    s.replace(/[áàâ]/g, 'a').replace(/[éèê]/g, 'e').replace(/[íìî]/g, 'i').replace(/[óòô]/g, 'o').replace(/[úùû]/g, 'u');

  const ES_IRREG = {
    soy: 'ser', eres: 'ser', es: 'ser', somos: 'ser', sois: 'ser', son: 'ser', era: 'ser', eras: 'ser', éramos: 'ser', eran: 'ser', fui: 'ser', fue: 'ser', fueron: 'ser', sido: 'ser', siendo: 'ser', sea: 'ser', seas: 'ser', sean: 'ser',
    estoy: 'estar', estás: 'estar', está: 'estar', estamos: 'estar', están: 'estar', estaba: 'estar', estaban: 'estar', estuve: 'estar', estuvo: 'estar', estuvieron: 'estar', estés: 'estar', esté: 'estar', estén: 'estar', estado: 'estar', estando: 'estar',
    he: 'haber', has: 'haber', ha: 'haber', hay: 'haber', hemos: 'haber', han: 'haber', había: 'haber', habían: 'haber', hubo: 'haber', haya: 'haber', hayan: 'haber',
    tengo: 'tener', tienes: 'tener', tiene: 'tener', tenemos: 'tener', tienen: 'tener', tenía: 'tener', tuve: 'tener', tuvo: 'tener', tuvieron: 'tener', tenga: 'tener', tengas: 'tener', tenido: 'tener', teniendo: 'tener',
    hago: 'hacer', haces: 'hacer', hace: 'hacer', hacemos: 'hacer', hacen: 'hacer', hacía: 'hacer', hice: 'hacer', hizo: 'hacer', hicieron: 'hacer', haga: 'hacer', hecho: 'hacer', haciendo: 'hacer',
    voy: 'ir', vas: 'ir', va: 'ir', vamos: 'ir', van: 'ir', iba: 'ir', iban: 'ir', vaya: 'ir', vayas: 'ir', vayan: 'ir', yendo: 'ir', ido: 'ir',
    puedo: 'poder', puedes: 'poder', puede: 'poder', podemos: 'poder', pueden: 'poder', podía: 'poder', pude: 'poder', pudo: 'poder', pueda: 'poder', pudiendo: 'poder',
    quiero: 'querer', quieres: 'querer', quiere: 'querer', queremos: 'querer', quieren: 'querer', quería: 'querer', quise: 'querer', quiso: 'querer', quiera: 'querer',
    digo: 'decir', dices: 'decir', dice: 'decir', decimos: 'decir', dicen: 'decir', decía: 'decir', dije: 'decir', dijo: 'decir', dijeron: 'decir', dicho: 'decir', diciendo: 'decir',
    doy: 'dar', das: 'dar', da: 'dar', damos: 'dar', dan: 'dar', daba: 'dar', di: 'dar', dio: 'dar', dieron: 'dar', dé: 'dar', dando: 'dar', dado: 'dar',
    veo: 'ver', ves: 'ver', ve: 'ver', vemos: 'ver', ven: 'ver', veía: 'ver', vi: 'ver', vio: 'ver', vieron: 'ver', visto: 'ver', viendo: 'ver',
    sé: 'saber', sabes: 'saber', sabe: 'saber', sabemos: 'saber', saben: 'saber', sabía: 'saber', supe: 'saber', supo: 'saber', sepa: 'saber',
    pongo: 'poner', pones: 'poner', pone: 'poner', ponemos: 'poner', ponen: 'poner', puse: 'poner', puso: 'poner', puesto: 'poner', poniendo: 'poner',
    salgo: 'salir', sales: 'salir', sale: 'salir', salen: 'salir', salió: 'salir', saliendo: 'salir',
    vengo: 'venir', vienes: 'venir', viene: 'venir', vienen: 'venir', vine: 'venir', vino: 'venir', viniendo: 'venir',
    caigo: 'caer', caes: 'caer', cae: 'caer', caen: 'caer', cayó: 'caer', cayendo: 'caer', caído: 'caer',
    traigo: 'traer', trae: 'traer', traen: 'traer', trajo: 'traer', trayendo: 'traer',
    duermo: 'dormir', duermes: 'dormir', duerme: 'dormir', duermen: 'dormir', durmió: 'dormir', durmiendo: 'dormir',
    muero: 'morir', muere: 'morir', murió: 'morir', muerto: 'morir',
    pierdo: 'perder', pierdes: 'perder', pierde: 'perder', pierden: 'perder', perdió: 'perder',
    empiezo: 'empezar', empieza: 'empezar', empiezan: 'empezar',
    entiendo: 'entender', entiendes: 'entender', entiende: 'entender',
    pienso: 'pensar', piensas: 'pensar', piensa: 'pensar', piensan: 'pensar',
    cuento: 'contar', cuentas: 'contar', cuenta: 'contar', cuentan: 'contar',
    vuelvo: 'volver', vuelves: 'volver', vuelve: 'volver', vuelven: 'volver', vuelto: 'volver',
    juego: 'jugar', juegas: 'jugar', juega: 'jugar', juegan: 'jugar',
    siento: 'sentir', sientes: 'sentir', siente: 'sentir', sienten: 'sentir', sintió: 'sentir',
    pido: 'pedir', pides: 'pedir', pide: 'pedir', piden: 'pedir', pidió: 'pedir', pidiendo: 'pedir',
    sigo: 'seguir', sigues: 'seguir', sigue: 'seguir', siguen: 'seguir', siguió: 'seguir', siguiendo: 'seguir',
    importa: 'importar', importan: 'importar',
    cuesta: 'costar', cuestan: 'costar', costó: 'costar',
    mete: 'meter', metes: 'meter', meto: 'meter', metió: 'meter', metido: 'meter',
    toma: 'tomar', tomas: 'tomar', tomo: 'tomar', tomó: 'tomar', tomando: 'tomar', tomado: 'tomar',
    echa: 'echar', echas: 'echar', echo: 'echar', echó: 'echar', echando: 'echar', echado: 'echar',
    habla: 'hablar', hablas: 'hablar', hablo: 'hablar', habló: 'hablar', hablando: 'hablar',
  };

  const esLemma = (raw) => {
    let w = raw.toLowerCase();
    const ext = lookupForm('es', w);
    if (ext) return ext;
    if (hasOwnVal(ES_IRREG, w)) return ES_IRREG[w];
    if (w.length <= 3) return w;

    // Strip Spanish enclitic pronouns on infinitives & gerunds: tomándomelo -> tomando -> tomar; tomarse -> tomar; echarle -> echar
    const enc = w.match(/^(.{3,}?)(?:melo|mela|melos|melas|telo|tela|telos|telas|selo|sela|selos|selas|noslo|nosla|me|te|se|nos|os|lo|la|los|las|le|les)$/);
    if (enc) {
      const stem = stripAccentsKeepN(enc[1]);
      if (/(?:ar|er|ir)$/.test(stem)) return stem;
      if (stem.endsWith('ando')) return stem.slice(0, -4) + 'ar';
      if (stem.endsWith('iendo')) return ES_IRREG[stem] || (stem.slice(0, -5) + 'er');
    }
    if (w.length >= 6 && w.endsWith('ando')) return w.slice(0, -4) + 'ar';
    if (w.length >= 7 && w.endsWith('iendo')) return w.slice(0, -5) + 'er';
    if (w.length >= 6 && w.endsWith('ado') && !w.endsWith('lado') && w !== 'estado') return w.slice(0, -3) + 'ar';
    if (w.length >= 7 && (w.endsWith('aron') || w.endsWith('aban') || w.endsWith('aste'))) return w.slice(0, -4) + 'ar';
    if (w.length >= 6 && w.endsWith('aba')) return w.slice(0, -3) + 'ar';
    // Plural nouns/adjectives common in idioms (pelos -> pelo, pies -> pie, manos -> mano, ojos -> ojo, narices -> nariz)
    if (w === 'narices') return 'nariz';
    if (w === 'luces') return 'luz';
    if (w === 'veces') return 'vez';
    if (w.length >= 5 && /[^aeiouáéíóú]es$/.test(w) && !/(?:iones|tudes)$/.test(w)) return w.slice(0, -2);
    if (w.length >= 4 && /[aeiou]s$/.test(w) && !/^(?:más|tras|pues|entonces|antes|después|lejos|menos)$/.test(w)) {
      const cand = w.slice(0, -1);
      if (ES_IRREG[w]) return ES_IRREG[w];
      return cand;
    }
    return w;
  };

  const FR_IRREG = {
    suis: 'être', es: 'être', est: 'être', sommes: 'être', êtes: 'être', sont: 'être', étais: 'être', était: 'être', étaient: 'être', été: 'être', soit: 'être', soient: 'être', serai: 'être', sera: 'être', serait: 'être',
    ai: 'avoir', as: 'avoir', a: 'avoir', avons: 'avoir', avez: 'avoir', ont: 'avoir', avais: 'avoir', avait: 'avoir', avaient: 'avoir', eu: 'avoir', ait: 'avoir', aient: 'avoir', aura: 'avoir', aurait: 'avoir', ayant: 'avoir',
    fais: 'faire', fait: 'faire', faisons: 'faire', faites: 'faire', font: 'faire', faisais: 'faire', faisait: 'faire', fera: 'faire', ferait: 'faire', fasse: 'faire', faisant: 'faire',
    vais: 'aller', vas: 'aller', va: 'aller', allons: 'aller', allez: 'aller', vont: 'aller', allais: 'aller', allait: 'aller', allé: 'aller', allée: 'aller', allés: 'aller', ira: 'aller', aille: 'aller',
    peux: 'pouvoir', peut: 'pouvoir', pouvons: 'pouvoir', peuvent: 'pouvoir', pouvais: 'pouvoir', pouvait: 'pouvoir', pu: 'pouvoir', puisse: 'pouvoir', pourra: 'pouvoir', pourrait: 'pouvoir',
    veux: 'vouloir', veut: 'vouloir', voulons: 'vouloir', veulent: 'vouloir', voulais: 'vouloir', voulait: 'vouloir', voulu: 'vouloir', veuille: 'vouloir', voudra: 'vouloir', voudrait: 'vouloir',
    dois: 'devoir', doit: 'devoir', devons: 'devoir', doivent: 'devoir', devais: 'devoir', devait: 'devoir', dû: 'devoir',
    sais: 'savoir', sait: 'savoir', savons: 'savoir', savent: 'savoir', savais: 'savoir', savait: 'savoir', su: 'savoir', sache: 'savoir',
    prends: 'prendre', prend: 'prendre', prenons: 'prendre', prennent: 'prendre', prenais: 'prendre', prenait: 'prendre', pris: 'prendre', prise: 'prendre', prenne: 'prendre',
    mets: 'mettre', met: 'mettre', mettons: 'mettre', mettent: 'mettre', mettais: 'mettre', mettait: 'mettre', mis: 'mettre', mise: 'mettre',
    dis: 'dire', dit: 'dire', disons: 'dire', dites: 'dire', disent: 'dire', disait: 'dire',
    vois: 'voir', voit: 'voir', voyons: 'voir', voient: 'voir', voyait: 'voir', vu: 'voir', vue: 'voir',
    viens: 'venir', vient: 'venir', venons: 'venir', viennent: 'venir', venait: 'venir', venu: 'venir',
    tiens: 'tenir', tient: 'tenir', tenons: 'tenir', tiennent: 'tenir', tenait: 'tenir', tenu: 'tenir',
    fous: 'foutre', fout: 'foutre', foutent: 'foutre', foutu: 'foutre', foutue: 'foutre', foutus: 'foutre',
    bats: 'battre', bat: 'battre', battent: 'battre', battu: 'battre',
    coupe: 'couper', coupes: 'couper', coupent: 'couper', coupé: 'couper',
    tombe: 'tomber', tombes: 'tomber', tombent: 'tomber', tombé: 'tomber', tombée: 'tomber',
    donne: 'donner', donnes: 'donner', donnent: 'donner', donné: 'donner',
    passe: 'passer', passes: 'passer', passent: 'passer', passé: 'passer',
    casse: 'casser', casses: 'casser', cassent: 'casser', cassé: 'casser',
    raconte: 'raconter', racontes: 'raconter', racontent: 'raconter', raconté: 'raconter',
    pose: 'poser', poses: 'poser', posent: 'poser', posé: 'poser',
    tourne: 'tourner', tournes: 'tourner', tournent: 'tourner', tourné: 'tourner',
    cherche: 'chercher', cherches: 'chercher', cherchent: 'chercher', cherché: 'chercher',
    roule: 'rouler', roules: 'rouler', roulent: 'rouler', roulé: 'rouler',
    tire: 'tirer', tires: 'tirer', tirent: 'tirer', tiré: 'tirer',
    jette: 'jeter', jettes: 'jeter', jettent: 'jeter', jeté: 'jeter',
    appelle: 'appeler', appelles: 'appeler', appellent: 'appeler', appelé: 'appeler',
    marque: 'marquer', marques: 'marquer', marquent: 'marquer', marqué: 'marquer',
    franchis: 'franchir', franchit: 'franchir', franchissent: 'franchir', franchi: 'franchir',
    yeux: 'oeil', œil: 'oeil',
    pieds: 'pied', mains: 'main', oreilles: 'oreille', doigts: 'doigt', bras: 'bras', cheveux: 'cheveu',
    chats: 'chat', chiens: 'chien', pommes: 'pomme', salades: 'salade', lapins: 'lapin', clous: 'clou',
  };

  const frLemma = (raw) => {
    let w = raw.toLowerCase().replace(/’/g, "'").replace(/œ/g, 'oe');
    if (/^[ldsnjmtcq]'$/i.test(w)) {
      const c = w[0];
      return c === 'l' ? 'le' : c === 'd' ? 'de' : c === 'n' ? 'ne' : c === 's' ? 'se' : c === 'j' ? 'je' : c === 'c' ? 'ce' : c === 'q' ? 'que' : w;
    }
    if (w === "qu'") return 'que';
    if (w === "jusqu'") return 'jusque';
    const ext = lookupForm('fr', w);
    if (ext) return ext;
    if (hasOwnVal(FR_IRREG, w)) return FR_IRREG[w];
    if (w.length <= 3) return w;
    if (w.length >= 5 && (w.endsWith('ées') || w.endsWith('és'))) return w.replace(/ées?$/, 'er');
    if (w.length >= 4 && w.endsWith('é') && !/^(?:café|côté|été|marché|passé|bébé|clé|pitié|moitié|vérité|liberté|santé|beauté)$/.test(w)) {
      return w.slice(0, -1) + 'er';
    }
    if (w.length >= 6 && w.endsWith('aient')) return w.slice(0, -5) + 'er';
    if (w.length >= 6 && w.endsWith('ions')) return w.slice(0, -4) + 'er';
    if (w.length >= 6 && w.endsWith('eront')) return w.slice(0, -5) + 'er';
    if (w.length >= 5 && w.endsWith('aux') && w !== 'faux') return w.slice(0, -3) + 'al';
    if (w.length >= 5 && /[^sxz]s$/.test(w) && !/^(?:dans|sans|sous|vers|mais|plus|très|toujours|jamais|alors|depuis|après|temps|corps|fois)$/.test(w)) {
      return w.slice(0, -1);
    }
    return w;
  };

  const PT_IRREG = {
    sou: 'ser', és: 'ser', é: 'ser', somos: 'ser', são: 'ser', era: 'ser', eram: 'ser', fui: 'ser', foi: 'ser', foram: 'ser', sido: 'ser', sendo: 'ser', seja: 'ser',
    estou: 'estar', estás: 'estar', está: 'estar', estamos: 'estar', estão: 'estar', estava: 'estar', estavam: 'estar', estive: 'estar', esteve: 'estar', estiveram: 'estar', esteja: 'estar',
    tenho: 'ter', tens: 'ter', tem: 'ter', temos: 'ter', têm: 'ter', tinha: 'ter', tinham: 'ter', tive: 'ter', teve: 'ter', tiveram: 'ter', tido: 'ter', tendo: 'ter',
    faço: 'fazer', fazes: 'fazer', faz: 'fazer', fazemos: 'fazer', fazem: 'fazer', fazia: 'fazer', fiz: 'fazer', fez: 'fazer', fizeram: 'fazer', feito: 'fazer', fazendo: 'fazer',
    vou: 'ir', vais: 'ir', vai: 'ir', vamos: 'ir', vão: 'ir', ia: 'ir', iam: 'ir', indo: 'ir',
    dou: 'dar', dás: 'dar', dá: 'dar', damos: 'dar', dão: 'dar', dava: 'dar', dei: 'dar', deu: 'dar', deram: 'dar', dado: 'dar', dando: 'dar',
    digo: 'dizer', dizes: 'dizer', diz: 'dizer', dizem: 'dizer', disse: 'dizer', disseram: 'dizer', dito: 'dizer',
    posso: 'poder', podes: 'poder', pode: 'poder', podem: 'poder', podia: 'poder', pude: 'poder', pôde: 'poder',
    quero: 'querer', queres: 'querer', quer: 'querer', querem: 'querer', quis: 'querer',
    sei: 'saber', sabes: 'saber', sabe: 'saber', sabem: 'saber', sabia: 'saber', soube: 'saber',
    vejo: 'ver', vês: 'ver', vê: 'ver', veem: 'ver', via: 'ver', vi: 'ver', viu: 'ver', viram: 'ver', visto: 'ver', vendo: 'ver',
    ponho: 'pôr', pões: 'pôr', põe: 'pôr', põem: 'pôr', pus: 'pôr', pôs: 'pôr', posto: 'pôr',
    venho: 'vir', vens: 'vir', vem: 'vir', vêm: 'vir', veio: 'vir', vieram: 'vir',
    bato: 'bater', bates: 'bater', bate: 'bater', batem: 'bater', bateu: 'bater', bateram: 'bater', batendo: 'bater',
    pago: 'pagar', paga: 'pagar', pagou: 'pagar', pagando: 'pagar',
    fico: 'ficar', fica: 'ficar', ficam: 'ficar', ficou: 'ficar', ficando: 'ficar',
    quebro: 'quebrar', quebra: 'quebrar', quebrou: 'quebrar', quebrando: 'quebrar',
    piso: 'pisar', pisa: 'pisar', pisou: 'pisar', pisando: 'pisar',
    engulo: 'engolir', engole: 'engolir', engoliu: 'engolir',
    mãos: 'mão', cães: 'cão', pães: 'pão', pés: 'pé', águas: 'água', botas: 'bota', burros: 'burro', sapos: 'sapo', bolas: 'bola',
  };

  const ptLemma = (raw) => {
    let w = raw.toLowerCase().replace(/’/g, "'");
    // Strip hyphenated Portuguese enclitic pronouns: dar-se -> dar, fazê-lo -> fazer, deu-se -> dar
    if (w.includes('-')) {
      const [stemRaw, clit] = w.split('-', 2);
      if (/^(?:me|te|se|nos|vos|o|a|os|as|lo|la|los|las|no|na|nos|nas|lhe|lhes)$/.test(clit || '')) {
        let st = stemRaw.replace(/á$/, 'ar').replace(/ê$/, 'er').replace(/í$/, 'ir');
        if (hasOwnVal(PT_IRREG, st)) return PT_IRREG[st];
        w = st;
      }
    }
    const ext = lookupForm('pt', w);
    if (ext) return ext;
    if (hasOwnVal(PT_IRREG, w)) return PT_IRREG[w];
    if (w.length <= 3) return w;
    if (w.length >= 6 && w.endsWith('ando')) return w.slice(0, -4) + 'ar';
    if (w.length >= 6 && w.endsWith('endo')) return w.slice(0, -4) + 'er';
    if (w.length >= 6 && w.endsWith('indo')) return w.slice(0, -4) + 'ir';
    if (w.length >= 6 && w.endsWith('aram')) return w.slice(0, -4) + 'ar';
    if (w.length >= 5 && w.endsWith('ou') && w !== 'estou' && w !== 'sou' && w !== 'vou' && w !== 'dou') return w.slice(0, -2) + 'ar';
    if (w.length >= 5 && w.endsWith('ões')) return w.slice(0, -3) + 'ão';
    if (w.length >= 5 && /[aeiou]s$/.test(w) && !/^(?:mais|mas|pois|depois|atrás|apenas|menos|pelos|pelas)$/.test(w)) return w.slice(0, -1);
    return w;
  };

  const IT_IRREG = {
    sono: 'essere', sei: 'essere', è: 'essere', siamo: 'essere', siete: 'essere', ero: 'essere', era: 'essere', erano: 'essere', stato: 'essere', stata: 'essere', stati: 'essere', sia: 'essere', siano: 'essere',
    ho: 'avere', hai: 'avere', ha: 'avere', abbiamo: 'avere', avete: 'avere', hanno: 'avere', avevo: 'avere', aveva: 'avere', avuto: 'avere', abbia: 'avere',
    faccio: 'fare', fai: 'fare', fa: 'fare', facciamo: 'fare', fate: 'fare', fanno: 'fare', faceva: 'fare', fece: 'fare', fatto: 'fare', facendo: 'fare', faccia: 'fare',
    vado: 'andare', vai: 'andare', va: 'andare', andiamo: 'andare', vanno: 'andare', andava: 'andare', andato: 'andare', andando: 'andare', vada: 'andare',
    dico: 'dire', dici: 'dire', dice: 'dire', diciamo: 'dire', dicono: 'dire', diceva: 'dire', disse: 'dire', detto: 'dire', dicendo: 'dire',
    do: 'dare', dai: 'dare', dà: 'dare', diamo: 'dare', danno: 'dare', dava: 'dare', diede: 'dare', dato: 'dare', dando: 'dare',
    posso: 'potere', puoi: 'potere', può: 'potere', possiamo: 'potere', possono: 'potere', poteva: 'potere', potuto: 'potere',
    voglio: 'volere', vuoi: 'volere', vuole: 'volere', vogliamo: 'volere', vogliono: 'volere', voleva: 'volere', voluto: 'volere',
    devo: 'dovere', devi: 'dovere', deve: 'dovere', dobbiamo: 'dovere', devono: 'dovere', doveva: 'dovere', dovuto: 'dovere',
    so: 'sapere', sai: 'sapere', sa: 'sapere', sappiamo: 'sapere', sanno: 'sapere', sapeva: 'sapere', saputo: 'sapere',
    vedo: 'vedere', vedi: 'vedere', vede: 'vedere', vediamo: 'vedere', vedono: 'vedere', vedeva: 'vedere', visto: 'vedere', vedendo: 'vedere',
    vengo: 'venire', vieni: 'venire', viene: 'venire', vengono: 'venire', venne: 'venire', venuto: 'venire',
    prendo: 'prendere', prendi: 'prendere', prende: 'prendere', prendiamo: 'prendere', prendono: 'prendere', prendeva: 'prendere', preso: 'prendere', prendendo: 'prendere',
    metto: 'mettere', metti: 'mettere', mette: 'mettere', mettono: 'mettere', mise: 'mettere', messo: 'mettere', mettendo: 'mettere',
    tengo: 'tenere', tieni: 'tenere', tiene: 'tenere', tengono: 'tenere', tenuto: 'tenere',
    esco: 'uscire', esci: 'uscire', esce: 'uscire', escono: 'uscire', uscito: 'uscire',
    stai: 'stare', sta: 'stare', stiamo: 'stare', stanno: 'stare', stava: 'stare', stando: 'stare',
    taglio: 'tagliare', taglia: 'tagliare', tagliato: 'tagliare',
    getto: 'gettare', getta: 'gettare', gettato: 'gettare',
    bocca: 'bocca', lupo: 'lupo', mani: 'mano', piedi: 'piede', occhi: 'occhio', braccia: 'braccio', gambe: 'gamba',
  };

  const itLemma = (raw) => {
    let w = raw.toLowerCase().replace(/’/g, "'");
    if (/^[ldsnjmtcv]'$/i.test(w)) {
      const c = w[0];
      return c === 'l' ? 'il' : c === 'd' ? 'di' : c === 's' ? 'si' : c === 'c' ? 'ci' : c === 'n' ? 'ne' : w;
    }
    if (w === "un'") return 'uno';
    const ext = lookupForm('it', w);
    if (ext) return ext;
    if (hasOwnVal(IT_IRREG, w)) return IT_IRREG[w];
    if (w.length <= 3) return w;
    // Pronominal / enclitic Italian verbs: farcela -> fare, cavarsela -> cavare, prendersela -> prendere, andarsene -> andare
    const pronom = w.match(/^(.{2,}?)(?:rsela|rsele|rsene|rcela|rci|rsi|rmi|rti|rlo|rla|rli|rle|gli|sene|cela|melo|telo|selo)$/);
    if (pronom) {
      const st = pronom[1];
      if (st === 'fa') return 'fare';
      if (st === 'da') return 'dare';
      if (st === 'sta') return 'stare';
      if (st === 'anda') return 'andare';
      if (/[aei]$/.test(st)) return st + 're';
    }
    if (w.length >= 6 && w.endsWith('ando')) return w.slice(0, -4) + 'are';
    if (w.length >= 6 && w.endsWith('endo')) return IT_IRREG[w] || (w.slice(0, -4) + 'ere');
    if (w.length >= 6 && w.endsWith('ato') && w !== 'stato') return w.slice(0, -3) + 'are';
    if (w.length >= 6 && w.endsWith('ito')) return w.slice(0, -3) + 'ire';
    return w;
  };

  // ---------------------------------------------------------------------------
  // Family 4A: Russian (ru) Cyrillic Normalisation & Core Inflection Lemmatiser
  // ---------------------------------------------------------------------------
  const RU_IRREG = {
    есть: 'быть', был: 'быть', была: 'быть', было: 'быть', были: 'быть', буду: 'быть', будешь: 'быть', будет: 'быть', будут: 'быть',
    вешаю: 'вешать', вешаешь: 'вешать', вешает: 'вешать', вешают: 'вешать', вешай: 'вешать', вешайте: 'вешать', вешал: 'вешать', повесил: 'вешать', повесить: 'вешать',
    лапшу: 'лапша', лапши: 'лапша', уши: 'ухо', ушам: 'ухо', ушах: 'ухо', нос: 'нос', носу: 'нос', носом: 'нос',
    делаю: 'делать', делаешь: 'делать', делает: 'делать', делают: 'делать', делал: 'делать', сделал: 'делать',
    говорю: 'говорить', говоришь: 'говорить', говорит: 'говорить', говорят: 'говорить', сказал: 'говорить',
    иду: 'идти', идешь: 'идти', идет: 'идти', идут: 'идти', шел: 'идти', шла: 'идти', пошли: 'идти',
    беру: 'брать', берешь: 'брать', берет: 'брать', берут: 'брать', взял: 'брать', взяла: 'брать',
    даю: 'давать', даешь: 'давать', дает: 'давать', дают: 'давать', дал: 'дать', дала: 'дать',
    бью: 'бить', бьешь: 'бить', бьет: 'бить', бьют: 'бить', бил: 'бить', баклуши: 'баклуша',
    вожу: 'водить', водишь: 'водить', водит: 'водить', водят: 'водить', водил: 'водить',
    валяю: 'валять', валяешь: 'валять', валяет: 'валять', валяй: 'валять', дурака: 'дурак',
    пускаю: 'пускать', пускает: 'пускать', пустил: 'пускать', пыль: 'пыль', глаза: 'глаз',
    руки: 'рука', руку: 'рука', рукой: 'рука', руках: 'рука', ноги: 'нога', ногу: 'нога', голову: 'голова', головы: 'голова', голове: 'голова',
    воду: 'вода', воды: 'вода', воде: 'вода', водой: 'вода', камень: 'камень', камня: 'камень',
    кота: 'кот', хвост: 'хвост', собаку: 'собака', съел: 'съесть', съела: 'съесть', съели: 'съесть',
    вышел: 'выйти', вышла: 'выйти', вышли: 'выйти', сел: 'сесть', села: 'сесть', лужу: 'лужа',
  };

  const ruLemma = (raw) => {
    let w = raw.replace(/\u0301/g, '').toLowerCase().replace(/ё/g, 'е');
    const ext = lookupForm('ru', w);
    if (ext) return ext;
    if (hasOwnVal(RU_IRREG, w)) return RU_IRREG[w];
    if (w.length <= 3) return w;
    // Strip reflexive -ся / -сь when checking base verb conjugations
    const refl = /(?:ся|сь)$/.test(w);
    const core = refl ? w.slice(0, -2) : w;
    if (RU_IRREG[core]) return RU_IRREG[core] + (refl ? 'ся' : '');
    if (core.length >= 5 && /(?:аю|аешь|ает|аем|аете|ают|ал|ала|али)$/.test(core)) {
      const st = core.replace(/(?:аю|аешь|ает|аем|аете|ают|ал|ала|али)$/, 'ать');
      return st + (refl ? 'ся' : '');
    }
    if (core.length >= 5 && /(?:яю|яешь|яет|яем|яете|яют|ял|яла|яли)$/.test(core)) {
      const st = core.replace(/(?:яю|яешь|яет|яем|яете|яют|ял|яла|яли)$/, 'ять');
      return st + (refl ? 'ся' : '');
    }
    return w;
  };

  // ---------------------------------------------------------------------------
  // Family 4B: Tagalog / Filipino (tl / fil) Austronesian Affix & Reduplication Stemmer
  // ---------------------------------------------------------------------------
  const TL_PROTECT = new Set([
    'ang', 'mga', 'ng', 'nang', 'sa', 'ay', 'at', 'na', 'pa', 'ba', 'po', 'ho', 'ko', 'mo', 'ka',
    'siya', 'kami', 'tayo', 'kayo', 'sila', 'ito', 'iyan', 'iyon', 'dito', 'diyan', 'doon',
    'hindi', 'huwag', 'wala', 'walang', 'may', 'mayroon', 'meron', 'para', 'pero', 'kasi', 'kaya',
    'kung', 'kapag', 'kahit', 'dahil', 'mula', 'hanggang', 'tulad', 'parang', 'lang', 'lamang', 'din', 'rin', 'daw', 'raw', 'pala', 'naman', 'talaga',
    'bahala', 'sige', 'oo', 'bakit', 'salamat', 'ano', 'sino', 'saan', 'kailan', 'paano',
    'anak', 'ama', 'ina', 'mata', 'tainga', 'ilong', 'bibig', 'kamay', 'paa', 'ulo', 'puso', 'dugo', 'balat', 'kilay', 'buto', 'pawis', 'luha', 'mukha', 'palad',
    'tubig', 'apoy', 'hangin', 'lupa', 'ulan', 'araw', 'buwan', 'bituin', 'bato', 'kahoy', 'sibuyas', 'asin', 'bigas', 'kanin', 'isda', 'manok', 'aso', 'pusa', 'kalabaw',
    'bahay', 'buhay', 'patay', 'tulog', 'gising', 'kain', 'inom', 'sabi', 'gawa', 'lakad', 'takbo', 'tingin', 'kita', 'alam', 'isip', 'mahal', 'galit', 'takot', 'hiya', 'sunog', 'kulo', 'lubid', 'tainga',
  ]);

  const TL_IRREG = {
    nagdilang: 'dila', magdilang: 'dila',
    nagsusunog: 'sunog', magsusunog: 'sunog', nagsunog: 'sunog', magsunog: 'sunog',
    kumukulo: 'kulo', kumulo: 'kulo', pakuluin: 'kulo',
    namuti: 'puti', mamuti: 'puti', pumuti: 'puti',
    namula: 'pula', mamula: 'pula', pumula: 'pula',
    naniningalang: 'tingala', maningalang: 'tingala',
    nagbibingi: 'bingi', bingihan: 'bingi',
    nagbubulag: 'bulag', bulagan: 'bulag',
    kumain: 'kain', kakain: 'kain', kumakain: 'kain', kinain: 'kain', kinakain: 'kain', pagkain: 'pagkain',
    uminom: 'inom', iinom: 'inom', umiinom: 'inom', ininom: 'inom',
    sinabi: 'sabi', sinasabi: 'sabi', magsabi: 'sabi', nagsabi: 'sabi', nagsasabi: 'sabi', sasabihin: 'sabi', sabihin: 'sabi',
    ginawa: 'gawa', ginagawa: 'gawa', gumawa: 'gawa', gumagawa: 'gawa', gagawin: 'gawa', gawin: 'gawa',
    tumakbo: 'takbo', tumatakbo: 'takbo', tatakbo: 'takbo',
    lumaki: 'laki', lumalaki: 'laki', malaki: 'laki',
    // Colloquial contractions & nasal d->r stems exposed on OpenSubtitles Tagalog
    sayo: 'iyo', sakin: 'akin', satin: 'atin', samin: 'amin', sanyo: 'inyo', sanila: 'kanila', nasayo: 'iyo',
    meron: 'mayroon', bat: 'bakit', san: 'saan', dun: 'doon', dyan: 'diyan', jan: 'diyan',
    ganun: 'ganoon', ganito: 'ganito', ganon: 'ganoon', kelan: 'kailan', pano: 'paano',
    pede: 'puwede', pwede: 'puwede', wag: 'huwag', di: 'hindi', yung: 'iyon', nung: 'noon',
    marami: 'dami', narito: 'dito', naroon: 'doon', marinig: 'dinig', maramdaman: 'damdam',
  };

  // Frequent vowel-final & -n-final roots that take the -ng / -g enclitic linker
  const TL_LINKER_ROOTS = new Set([
    'ako', 'mo', 'ito', 'buo', 'iba', 'bago', 'kanya', 'kaniya', 'niya', 'dalawa', 'isa', 'tatlo',
    'apat', 'lima', 'anim', 'pito', 'walo', 'siyam', 'sampu', 'wala', 'para', 'tila', 'gawa',
    'totoo', 'una', 'huli', 'kapwa', 'sarili', 'lahat', 'wala', 'marami', 'maganda', 'malaki',
    'maliit', 'mabuti', 'masama', 'mahaba', 'maikli', 'matanda', 'bata', 'bagay', 'aking',
    'akin', 'amin', 'namin', 'atin', 'natin', 'inyo', 'kanila', 'iyon', 'noon', 'ganoon',
    'saan', 'kailan', 'ilan', 'alipin', 'kaibigan', 'bayan', 'daan', 'panahon', 'taon', 'buwan',
  ]);

  const collapseTlRedup = (s) => {
    // CV reduplication: kakain -> kain, susunog -> sunog, tatakbo -> takbo; V redup: aalis -> alis, iinom -> inom
    if (s.length >= 5 && /^[bcdfghjklmnpqrstvwxyz][aeiou]/i.test(s)) {
      const cv = s.slice(0, 2);
      if (s.slice(2, 4) === cv && s.length - 2 >= 4) return s.slice(2);
    }
    if (s.length >= 5 && /^[aeiou]/i.test(s) && s[0] === s[1]) {
      return s.slice(1);
    }
    return s;
  };

  const stripTlMarks = (s) =>
    s.replace(/[àáâ]/g, 'a').replace(/[èéê]/g, 'e').replace(/[ìíî]/g, 'i').replace(/[òóô]/g, 'o').replace(/[ùúû]/g, 'u');

  const tlLemma = (raw) => {
    let w = stripTlMarks(raw.toLowerCase()).replace(/^['’]+|['’]+$/g, '');
    const ext = lookupForm('tl', w);
    if (ext) return ext;
    if (hasOwnVal(TL_IRREG, w)) return TL_IRREG[w];
    if (/['’](?:t|y|ng)$/i.test(w)) {
      const noClit = w.replace(/['’](?:t|y|ng)$/i, '');
      if (hasOwnVal(TL_IRREG, noClit)) return TL_IRREG[noClit];
      if (TL_PROTECT.has(noClit) || TL_LINKER_ROOTS.has(noClit)) return noClit;
      w = noClit;
    }
    if (w === 'walang') return 'wala';
    if (TL_PROTECT.has(w) || w.length <= 3) return w;

    // Strip enclitic linker -ng on vowel-final roots (akong -> ako, itong -> ito, magandang -> maganda)
    if (w.length >= 4 && /[aeiou]ng$/.test(w)) {
      const baseV = w.slice(0, -2);
      if (TL_PROTECT.has(baseV) || TL_LINKER_ROOTS.has(baseV) || /^ma[a-z]{3,}$/.test(baseV)) {
        return TL_IRREG[baseV] || baseV;
      }
    }
    // Strip enclitic -g after -n roots (aking -> akin, aming -> amin, naming -> namin, noong -> noon, iyong -> iyon)
    if (w.length >= 4 && /ng$/.test(w)) {
      const baseN = w.slice(0, -1);
      if (baseN.endsWith('n') && (TL_PROTECT.has(baseN) || TL_LINKER_ROOTS.has(baseN))) {
        return TL_IRREG[baseN] || baseN;
      }
    }

    let cur = w;
    // 1) Strip verbal/actor/focus prefixes (with or without hyphen: nag-aral -> aral, magsunog -> sunog, ipaki- -> ...)
    const pfxRe = /^(?:ipagpa|makipag|nakikipag|pakikipag|makapag|nakapag|pakiki|paki|kaka|magpa|nagpa|pagpa|ipinag|pinag|ipina|pina|magsi|nagsi|maka|naka|mapa|napa|mag|nag|pag|ipag|ipa|mai|nai|um|in|ma|na|pa|i)-?([a-z]{3,})$/;
    const pm = cur.match(pfxRe);
    if (pm && !TL_PROTECT.has(cur)) {
      const cand = collapseTlRedup(pm[1]);
      if (cand.length >= 4 || TL_PROTECT.has(cand)) cur = cand;
    }

    // 2) Strip <um> or <in> infix after initial consonant / consonant cluster (kumain -> kain, sinabi -> sabi, tinamaan -> tamaan)
    const infM = cur.match(/^([bcdfghjklmnpqrstvwxyz]{1,2})(?:um|in)([aeiou][a-z]{2,})$/);
    if (infM && !TL_PROTECT.has(cur)) {
      const cand = collapseTlRedup(infM[1] + infM[2]);
      if (cand.length >= 4 || TL_PROTECT.has(cand)) cur = cand;
    }

    // 3) Collapse CV reduplication on remaining stem (kumukulo -> after <um>: kukulo -> kulo)
    cur = collapseTlRedup(cur);

    // 4) Restore intervocalic r->d when applicable (marami -> dami, narito -> dito)
    if (cur.startsWith('r') && TL_PROTECT.has('d' + cur.slice(1))) {
      cur = 'd' + cur.slice(1);
    }

    // 5) Strip -han / -hin / -an / -in suffix only when resulting stem is >=4 chars or a protected known root
    if (!TL_PROTECT.has(cur) && cur.length >= 6) {
      const sfxM = cur.match(/^([a-z]{4,}?)(?:han|hin|an|in)$/);
      if (sfxM && (TL_PROTECT.has(sfxM[1]) || sfxM[1].length >= 4)) {
        cur = sfxM[1];
      }
    }
    return cur;
  };

  // ---------------------------------------------------------------------------
  // Family 1: Korean (ko) & CJK Segmenter Helpers
  // ---------------------------------------------------------------------------
  const segCache = new Map();
  const getSeg = (code) => {
    if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
    if (!segCache.has(code)) {
      try { segCache.set(code, new Intl.Segmenter(code, { granularity: 'word' })); }
      catch (e) {
        try { segCache.set(code, new Intl.Segmenter('zh-Hant-HK', { granularity: 'word' })); }
        catch (e2) { segCache.set(code, null); }
      }
    }
    return segCache.get(code);
  };

  const noSpaceRe = /^(ja|zh|yue|cn|th|km|lo|my)/;
  const wiktLangs = /^(en|ja|ko|zh|yue|cn|ru|de|fr|es|it|pt|tl|fil|vi|th|ar|nl|pl|tr|uk|id)/;

  const KO_IRREG_MAP = {
    텐데: '터', 터인데: '터', 테니: '터',
    거예요: '것', 거에요: '것', 거요: '것', 거죠: '것', 거야: '것', 건가: '것', 건가요: '것', 건데: '것',
    그건: '그것', 그걸: '그것', 그게: '그것', 그거: '그것',
    이건: '이것', 이걸: '이것', 이게: '이것', 이거: '이것',
    저건: '저것', 저걸: '저것', 저게: '저것', 저거: '저것',
    뭘: '무엇', 뭔: '무엇', 뭐야: '무엇', 뭡니까: '무엇', 뭐예요: '무엇', 뭐라고: '뭐',
    있지: '있다', 있죠: '있다', 있나: '있다', 있다면: '있다', 있다고: '있다', 있소: '있다', 있잖아: '있다', 있잖아요: '있다',
    없지: '없다', 없죠: '없다', 없나: '없다', 없다면: '없다', 없다고: '없다', 없소: '없다', 없잖아: '없다', 없잖아요: '없다',
    될까요: '되다', 될래요: '되다', 됐다: '되다', 됐어: '되다', 됐어요: '되다', 돼요: '되다', 돼: '되다',
    하죠: '하다', 하게: '하다', 하나요: '하다', 합시다: '하다',
  };
  const KO_FUSED_MAP = {
    했: '하', 해: '하', 할: '하', 한: '하', 함: '하',
    왔: '오', 와: '오', 올: '오', 온: '오',
    봤: '보', 봐: '보', 볼: '보', 본: '보',
    됐: '되', 돼: '되', 될: '되', 된: '되',
    줬: '주', 줘: '주', 줄: '주', 준: '주',
    갔: '가', 가: '가', 갈: '가', 간: '가',
    났: '나', 나: '나', 날: '나', 난: '나',
    샀: '사', 탔: '타', 잤: '자', 셨: '시', 였: '이',
  };
  const KO_VERB_RE = /(?:었어요|았어요|였어요|겠어요|겠네요|겠습니다|거든요|잖아요|던데요|는데요|은가요|인가요|을까요|ㄹ까요|건가요|을래요|ㄹ래요|으세요|으려고|으니까|습니다|십니다|ㅂ니다|세요|어요|아요|여요|었어|았어|였어|었다|았다|였다|겠다|겠어|겠지|나요|까요|군요|네요|는데|더니|면서|려고|니까|으나|지만|다면|다고|냐고|자고|잖아|거든|던데|도록|을지|소|오)$/;
  const KO_NOUN_RE = /(?:에서는|에게서|한테서|으로는|에서도|입니다|이었다|이었어|에서|에게|한테|까지|부터|처럼|보다|으로|이라고|라고|이야|이랑|하고|님들|님|들|은|는|이|가|을|를|에|의|도|만|로|와|과|랑|서)$/;

  const koLemma = (s) => {
    const ext = lookupForm('ko', s);
    if (ext) return ext;
    if (hasOwnVal(KO_IRREG_MAP, s)) return KO_IRREG_MAP[s];
    if (s.length >= 2) {
      const hada = s.replace(/(?:했어요|했어|했다|했더니|했는데|했죠|했나|했다면|했다고|해서|해요|해라|해선|해졌|해지|해|합니다|합시다|하니까|하는데|하잖아|하잖아요|하거든|하죠|하게|하고|하며|하면서|하는|할까|할까요|할래|할래요|할)$/, '하다');
      if (hada !== s && hada.length >= 2) return hada;
    }
    // 1) Verbal conjugations -> recover dictionary '+다' form
    const vStem = s.replace(KO_VERB_RE, '');
    if (vStem !== s && vStem.length >= 1) {
      const lastC = vStem.slice(-1);
      if (hasOwnVal(KO_FUSED_MAP, lastC)) return vStem.slice(0, -1) + KO_FUSED_MAP[lastC] + '다';
      const code = lastC.charCodeAt(0) - 0xac00;
      if (code >= 0 && code < 11172) {
        const fin = code % 28;
        if (fin === 4 || fin === 8) {
          const openSyl = String.fromCharCode(0xac00 + code - fin);
          if (hasOwnVal(KO_FUSED_MAP, openSyl)) return vStem.slice(0, -1) + KO_FUSED_MAP[openSyl] + '다';
          return vStem.slice(0, -1) + openSyl + '다';
        }
      }
      return vStem + '다';
    }
    // 2) Noun / particle + honorific (-님/-들) multi-step strip
    let nStem = s;
    for (let pass = 0; pass < 2; pass++) {
      const next = nStem.replace(KO_NOUN_RE, '');
      if (next === nStem || next.length < 1) break;
      nStem = next;
    }
    if (nStem !== s && nStem.length >= 1) return nStem;
    // 3) Fused topic/object coda (-ㄴ/-ㄹ) on 2+ syllable nouns (자넨 -> 자네)
    if (s.length >= 2) {
      const code = s.charCodeAt(s.length - 1) - 0xac00;
      if (code >= 0 && code < 11172) {
        const fin = code % 28;
        if (fin === 4 || fin === 8) {
          return s.slice(0, -1) + String.fromCharCode(0xac00 + code - fin);
        }
      }
    }
    return s;
  };

  // Pure-JS Japanese de-inflection candidates (Yomitan-style ordered stems so read_ja / packs resolve verbs & adjs offline)
  const JA_A_TO_U = { 'か': 'く', 'が': 'ぐ', 'さ': 'す', 'た': 'つ', 'な': 'ぬ', 'ば': 'ぶ', 'ま': 'む', 'ら': 'る', 'わ': 'う' };
  const JA_I_TO_U = { 'き': 'く', 'ぎ': 'ぐ', 'し': 'す', 'ち': 'つ', 'に': 'ぬ', 'び': 'ぶ', 'み': 'む', 'り': 'る', 'い': 'う' };
  const JA_DEINFLECT_RULES = [
    ['ませんでした', 5, ['ます_i', 'ichidan', 'suru']],
    ['ました', 3, ['ます_i', 'ichidan', 'suru']],
    ['ません', 3, ['ます_i', 'ichidan', 'suru']],
    ['ます', 2, ['ます_i', 'ichidan', 'suru']],
    ['くなかった', 5, ['adj_i']],
    ['なかった', 4, ['godan_a', 'ichidan', 'suru', 'kuru']],
    ['かった', 3, ['adj_i']],
    ['くない', 3, ['adj_i']],
    ['くて', 2, ['adj_i']],
    ['ければ', 3, ['adj_i']],
    ['ない', 2, ['godan_a', 'ichidan', 'suru', 'kuru']],
    ['なくて', 3, ['godan_a', 'ichidan', 'suru', 'kuru']],
    ['ている', 3, ['te_form']],
    ['ていた', 3, ['te_form']],
    ['てる', 2, ['te_form']],
    ['てた', 2, ['te_form']],
    ['でいる', 3, ['de_form']],
    ['でいた', 3, ['de_form']],
    ['でる', 2, ['de_form']],
    ['でた', 2, ['de_form']],
    ['てしまう', 4, ['te_form']],
    ['てしまった', 5, ['te_form']],
    ['ちゃった', 4, ['godan_tr', 'ichidan']],
    ['ちゃう', 3, ['godan_tr', 'ichidan']],
    ['じゃった', 4, ['nd_form']],
    ['じゃう', 3, ['nd_form']],
    ['った', 2, ['godan_ru_u_tsu']],
    ['って', 2, ['godan_ru_u_tsu']],
    ['いた', 2, ['godan_ku', 'ichidan']],
    ['いて', 2, ['godan_ku', 'ichidan']],
    ['いだ', 2, ['godan_gu']],
    ['いで', 2, ['godan_gu']],
    ['んだ', 2, ['nd_form']],
    ['んで', 2, ['nd_form']],
    ['した', 2, ['suru', 'godan_su', 'ichidan']],
    ['して', 2, ['suru', 'godan_su', 'ichidan']],
    ['します', 3, ['suru']],
    ['した', 2, ['suru']],
    ['せず', 2, ['suru']],
    ['させる', 3, ['ichidan', 'suru']],
    ['させた', 3, ['ichidan', 'suru']],
    ['られる', 3, ['ichidan', 'kuru']],
    ['られた', 3, ['ichidan', 'kuru']],
    ['た', 1, ['ichidan', 'te_irreg']],
    ['て', 1, ['ichidan', 'te_irreg']],
    ['だ', 1, ['da_irreg']],
    ['で', 1, ['da_irreg']],
    ['く', 1, ['adj_i']],
    ['さ', 1, ['adj_i']],
    ['そう', 2, ['adj_i', 'ichidan']],
  ];

  const expandJaTag = (stem, tag, out) => {
    if (!stem) return;
    if (tag === 'ichidan') out.push({ lemma: stem + 'る', kind: 'v' });
    else if (tag === 'adj_i') out.push({ lemma: stem + 'い', kind: 'a' });
    else if (tag === 'suru') { out.push({ lemma: stem + 'する', kind: 'v' }); out.push({ lemma: stem, kind: 'n' }); }
    else if (tag === 'kuru') out.push({ lemma: stem + '来る', kind: 'v' }, { lemma: stem + 'くる', kind: 'v' });
    else if (tag === 'godan_su') out.push({ lemma: stem + 'す', kind: 'v' });
    else if (tag === 'godan_ku') out.push({ lemma: stem + 'く', kind: 'v' });
    else if (tag === 'godan_gu') out.push({ lemma: stem + 'ぐ', kind: 'v' });
    else if (tag === 'godan_ru_u_tsu' || tag === 'godan_tr') {
      out.push({ lemma: stem + 'る', kind: 'v' }, { lemma: stem + 'う', kind: 'v' }, { lemma: stem + 'つ', kind: 'v' });
    } else if (tag === 'nd_form') {
      out.push({ lemma: stem + 'む', kind: 'v' }, { lemma: stem + 'ぶ', kind: 'v' }, { lemma: stem + 'ぬ', kind: 'v' });
    } else if (tag === 'godan_a') {
      const last = stem.slice(-1), base = stem.slice(0, -1);
      if (JA_A_TO_U[last]) out.push({ lemma: base + JA_A_TO_U[last], kind: 'v' });
    } else if (tag === 'ます_i') {
      const last = stem.slice(-1), base = stem.slice(0, -1);
      if (JA_I_TO_U[last]) out.push({ lemma: base + JA_I_TO_U[last], kind: 'v' });
      if (last === 'し' && base) { out.push({ lemma: base + 'する', kind: 'v' }, { lemma: base, kind: 'n' }); }
      if (last === 'き' && base) out.push({ lemma: base + '来る', kind: 'v' });
      out.push({ lemma: stem + 'る', kind: 'v' });
    } else if (tag === 'te_form') {
      out.push({ lemma: stem + 'る', kind: 'v' });
      if (stem.endsWith('っ')) out.push({ lemma: stem.slice(0, -1) + 'る', kind: 'v' }, { lemma: stem.slice(0, -1) + 'う', kind: 'v' }, { lemma: stem.slice(0, -1) + 'つ', kind: 'v' });
      if (stem.endsWith('い')) out.push({ lemma: stem.slice(0, -1) + 'く', kind: 'v' });
      if (stem.endsWith('し')) {
        out.push({ lemma: stem.slice(0, -1) + 'す', kind: 'v' }, { lemma: stem.slice(0, -1) + 'する', kind: 'v' });
        if (stem.length >= 2) out.push({ lemma: stem.slice(0, -1), kind: 'n' });
      }
    } else if (tag === 'de_form') {
      if (stem.endsWith('い')) out.push({ lemma: stem.slice(0, -1) + 'ぐ', kind: 'v' });
      if (stem.endsWith('ん')) out.push({ lemma: stem.slice(0, -1) + 'む', kind: 'v' }, { lemma: stem.slice(0, -1) + 'ぶ', kind: 'v' }, { lemma: stem.slice(0, -1) + 'ぬ', kind: 'v' });
    }
  };

  const jaDeinflectCandidates = (raw) => {
    const w = String(raw || '').trim();
    if (!w || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(w)) return [];
    const seen = new Set([w]);
    const out = [{ lemma: w, kind: '', cut: 0 }];
    const pushCand = (c, cut) => {
      if (!c || !c.lemma || seen.has(c.lemma)) return;
      seen.add(c.lemma);
      out.push({ lemma: c.lemma, kind: c.kind || '', cut });
    };
    if (w === '行った' || w === '行って' || w === '行ってる' || w === '行っていた') pushCand({ lemma: '行く', kind: 'v' }, w.length - 1);
    if (w === '来た' || w === '来て' || w === '来ない' || w === '来ます') pushCand({ lemma: '来る', kind: 'v' }, w.length - 1);
    if (w === 'した' || w === 'して' || w === 'しない' || w === 'します') pushCand({ lemma: 'する', kind: 'v' }, w.length);
    for (const [sfx, cutLen, tags] of JA_DEINFLECT_RULES) {
      if (w.length > sfx.length && w.endsWith(sfx)) {
        const stem = w.slice(0, -sfx.length);
        const tmp = [];
        for (const t of tags) expandJaTag(stem, t, tmp);
        for (const c of tmp) pushCand(c, cutLen);
      }
    }
    return out;
  };

  const jaLemma = (raw) => {
    const ext = lookupForm('ja', raw);
    if (ext) return ext;
    const cands = jaDeinflectCandidates(raw);
    return cands.length > 1 ? cands[1].lemma : raw;
  };

  // Join Japanese verb/adjective inflected suffixes split by Intl.Segmenter ("聞|い|た" -> "聞いた", "食|べた" -> "食べた")
  const JA_AUX_HEAD_RE = /^(?:べ[たてら]|べられ(?:る|た)?|べさせ(?:る|た|て)?|べま(?:す|した|せん)|べ(?:ない|たい|よう)|ない|なか|なかっ|なく|ます|まし|ません|ました|しま|した|して|しない|せず|たい|たかっ|たく|かっ|ら|られ|られる|られた|させ|させる|させて|てい|ている|ていた|てしまう|てしまった|ちゃう|ちゃった|じゃう|じゃった|かった|くない|くて|くなかった)$/;
  const JA_AUX_CONT_RE = /^(?:[いきぎしじちにちひびみりえけげせぜてでねへべめれ]|っ|ん|く)$/;
  const JA_AUX_TAIL_RE = /^(?:た|だ|て|で|っ|ら|られ|られる|られた|れ|れる|れた|せ|させ|させる|させた|ない|なか|なかっ|なく|なかった|ます|まし|ません|ました|たい|たかっ|たく|る|い|いる|いた|お[くき]|み[るて])$/;
  const JA_STANDALONE_PARTICLE = /^(?:は|が|を|に|へ|と|で|も|の|や|か|よ|ね|な|ぞ|わ|さ|から|まで|より|ほど|だけ|しか|など|って)$/;
  const joinJaInflections = (rawSegs) => {
    const out = [];
    for (let i = 0; i < rawSegs.length; i++) {
      const cur = rawSegs[i];
      if (!cur.word) { out.push(cur); continue; }
      let combined = cur.w;
      while (i + 1 < rawSegs.length && rawSegs[i + 1].word) {
        const nxt = rawSegs[i + 1].w;
        const next2 = (i + 2 < rawSegs.length && rawSegs[i + 2].word) ? rawSegs[i + 2].w : '';
        const hasStem = /[\u4e00-\u9fff]/.test(combined) && !JA_STANDALONE_PARTICLE.test(combined);
        const alreadyGlued = combined.length > cur.w.length;
        const endsInflectStem = /[いきぎしじちにちひびみりえけげせぜてでねへべめれっんく]$/.test(combined);
        const canGlue =
          JA_AUX_HEAD_RE.test(nxt) ||
          ((alreadyGlued || endsInflectStem) && /^(?:た|だ|て|で|ば)$/.test(nxt)) ||
          (alreadyGlued && JA_AUX_TAIL_RE.test(nxt) && (nxt !== 'で' || /ん$/.test(combined))) ||
          (hasStem && JA_AUX_CONT_RE.test(nxt) && next2 && (JA_AUX_HEAD_RE.test(next2) || JA_AUX_TAIL_RE.test(next2) || JA_AUX_CONT_RE.test(next2))) ||
          (hasStem && /^[てで]$/.test(nxt) && (/ん$/.test(combined) || (nxt === 'て' && next2 && /^(?:い|いる|いた|お|み|あ|く|も|し)/.test(next2))));
        if (!canGlue || !hasStem) break;
        combined += nxt;
        i++;
      }
      out.push({ w: combined, word: true });
    }
    return out;
  };

  // Romance apostrophe-elision splitter for French & Italian ("s'en foutre" -> ["s'", " ", "en", " ", "foutre"], "l'ora" -> ["l'", "ora"])
  const splitRomanceElision = (t) => {
    const out = [];
    const re = /(?:qu|jusqu|lorsqu|puisqu|[ldsnjmtcvun])['’](?=[\p{L}])|[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]+/giu;
    let m;
    while ((m = re.exec(t))) {
      out.push({ w: m[0], word: /[\p{L}\p{N}]/u.test(m[0]) });
    }
    return out;
  };

  const modCache = new Map();
  const makeModule = (code) => {
    const normBase = normCode(code);
    if (normBase === 'en') return en;
    if (modCache.has(normBase)) return modCache.get(normBase);

    const isNoSpace = noSpaceRe.test(normBase);
    const segLang = normBase === 'yue' ? 'zh-Hant-HK' : normBase;
    const seg = isNoSpace ? getSeg(segLang) : null;
    const meta = LANG_META[normBase] || { family: 'other' };
    const usesElisionSplit = normBase === 'fr' || normBase === 'it';

    const mod = {
      code: normBase,
      family: meta.family,
      noSpace: isNoSpace,
      dict: wiktLangs.test(normBase),
      split(t) {
        if (usesElisionSplit) return splitRomanceElision(t);
        if (seg) {
          const out = [];
          for (const s of seg.segment(t)) {
            out.push({ w: s.segment, word: !!s.isWordLike });
          }
          return normBase === 'ja' ? joinJaInflections(out) : out;
        }
        const out = [];
        const re = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]+/gu;
        let m;
        while ((m = re.exec(t))) out.push({ w: m[0], word: /[\p{L}\p{N}]/u.test(m[0]) });
        return out;
      },
      lemma(w) {
        const s = String(w || '').toLowerCase();
        if (normBase === 'ja') return jaLemma(s);
        if (normBase === 'ko') return koLemma(s);
        if (normBase === 'de') return deLemma(s);
        if (normBase === 'es') return esLemma(s);
        if (normBase === 'fr') return frLemma(s);
        if (normBase === 'pt') return ptLemma(s);
        if (normBase === 'it') return itLemma(s);
        if (normBase === 'ru') return ruLemma(s);
        if (normBase === 'tl') return tlLemma(s);
        return lookupForm(normBase, s) || s;
      },
      countWords(t) {
        if (isNoSpace && !seg) return (t.replace(/\s+/g, '').length) / 2;
        if (seg) {
          let n = 0;
          for (const s of seg.segment(t)) if (s.isWordLike) n++;
          return n;
        }
        return (t.match(/[\p{L}\p{M}\p{N}]+/gu) || []).length;
      },
    };
    modCache.set(normBase, mod);
    return mod;
  };

  // ---------------------------------------------------------------------------
  // 12-Language Text Detector (Script + Diacritics + High-Precision Stopwords)
  // ---------------------------------------------------------------------------
  const CANTONESE_RE = /[嘅喺咁噉咗冇係唔嚟畀俾搵諗睇攞仲晒哂喎囉㗎咩啲]/;
  const LATIN_SIGS = {
    de: new Set(['nicht', 'sich', 'auch', 'auf', 'für', 'mit', 'sind', 'wird', 'werden', 'oder', 'aber', 'wenn', 'dass', 'noch', 'nach', 'über', 'einem', 'einer', 'keine', 'kein']),
    fr: new Set(['les', 'des', 'une', 'dans', 'pour', 'pas', 'sur', 'avec', 'sont', 'mais', 'plus', 'tout', 'cette', 'fait', 'être', 'avoir', 'nous', 'vous', 'leur', 'même', 'aux']),
    es: new Set(['los', 'las', 'una', 'para', 'con', 'por', 'como', 'pero', 'más', 'esta', 'está', 'están', 'tiene', 'todo', 'muy', 'sin', 'sobre', 'también', 'hasta', 'cuando', 'hay']),
    pt: new Set(['não', 'uma', 'com', 'para', 'por', 'mais', 'como', 'mas', 'foi', 'são', 'está', 'tem', 'seu', 'sua', 'pelo', 'pela', 'nos', 'das', 'dos', 'isso', 'muito', 'você']),
    it: new Set(['non', 'che', 'sono', 'della', 'delle', 'degli', 'nella', 'con', 'per', 'una', 'più', 'anche', 'questo', 'questa', 'fatto', 'essere', 'hanno', 'dopo', 'molto', 'tutto', 'gli']),
    tl: new Set(['ang', 'mga', 'hindi', 'siya', 'niya', 'nila', 'kami', 'tayo', 'kayo', 'sila', 'ito', 'iyan', 'iyon', 'nang', 'yung', 'lang', 'naman', 'kasi', 'pala', 'kahit', 'dahil', 'walang', 'para', 'isang']),
    en: new Set(['the', 'and', 'that', 'this', 'with', 'from', 'have', 'they', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'your', 'been', 'were']),
  };

  const detectLang = (input, hint = '') => {
    if (hint && hint !== 'auto') {
      const hn = normCode(hint);
      if (SUPPORTED_SET.has(hn) && hn !== 'zh') return hn;
      if (hn === 'zh') {
        const probe = Array.isArray(input) ? input.join('\n') : String(input || '');
        if (CANTONESE_RE.test(probe)) {
          const lines = (Array.isArray(input) ? input : probe.split(/\n+/)).filter((t) => /[\u3400-\u9fff]/.test(t)).slice(0, 200);
          const hits = lines.filter((t) => CANTONESE_RE.test(t)).length;
          if (lines.length <= 4 || hits / Math.max(1, lines.length) >= 0.12) return 'yue';
        }
        return 'zh';
      }
    }
    const text = (Array.isArray(input) ? input.join('\n') : String(input || '')).slice(0, 6000);
    if (!text.trim()) return 'en';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko';
    if (/[\u3040-\u30ff]/.test(text)) return 'ja';
    if (/[\u3400-\u9fff]/.test(text)) {
      const lines = (Array.isArray(input) ? input : text.split(/\n+/)).filter((t) => /[\u3400-\u9fff]/.test(t)).slice(0, 200);
      const yueHits = lines.filter((t) => CANTONESE_RE.test(t)).length;
      if (CANTONESE_RE.test(text) && (lines.length <= 4 || yueHits / Math.max(1, lines.length) >= 0.12)) return 'yue';
      return 'zh';
    }
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';

    // Latin-script scoring across de, fr, es, pt, it, tl, en
    const scores = { de: 0, fr: 0, es: 0, pt: 0, it: 0, tl: 0, en: 0 };
    if (/ß/.test(text)) scores.de += 5;
    if (/[äöüÄÖÜ]/.test(text)) scores.de += 2.5;
    if (/[¿¡ñÑ]/.test(text)) scores.es += 4.5;
    if (/[ãõÃÕ]/.test(text)) scores.pt += 5;
    if (/[œŒ]/.test(text)) scores.fr += 4;
    if (/\b(?:qu'|c'est|n'est|j'ai|d'un|d'une|s'il|l'on)\b/i.test(text)) scores.fr += 3.5;
    if (/\b(?:dell'|nell'|all'|sull'|anch'io|c'è|non\s+è)\b/i.test(text)) scores.it += 3.5;
    if (/\b(?:nag-[a-z]{3,}|mag-[a-z]{3,}|pag-[a-z]{3,})\b/i.test(text)) scores.tl += 4;

    const words = (text.toLowerCase().match(/[\p{L}]+/gu) || []).slice(0, 250);
    for (const w of words) {
      for (const lg of Object.keys(LATIN_SIGS)) {
        if (LATIN_SIGS[lg].has(w)) scores[lg] += lg === 'tl' ? 1.6 : 1.2;
      }
    }
    let best = 'en';
    let bestScore = scores.en + 0.4; // slight tie-breaker to 'en' when ambiguous ASCII
    for (const [lg, sc] of Object.entries(scores)) {
      if (lg !== 'en' && sc > bestScore && sc >= 1.5) {
        best = lg;
        bestScore = sc;
      }
    }
    return best;
  };

  // Merge fragmented caption lines into sentence/clause groups for better MT and idiom matching.
  const mergeSentences = (lines, maxChars = 240, maxLines = 4) => {
    const groups = [];
    let cur = null;
    const endPunct = /[.!?。！？…]["'”’」』»)]*\s*$/;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const prev = i > 0 ? lines[i - 1] : null;
      // lines from the site parsers (VTT/TTML) carry an end time `e` instead of a duration `d` (Gemini v0.7.0)
      const prevEnd = prev ? (prev.e != null ? prev.e : prev.s + (prev.d || 0)) : 0;
      const gap = prev ? ln.s - prevEnd : 0;
      const shouldSplit =
        !cur ||
        cur.indices.length >= maxLines ||
        cur.text.length + ln.t.length > maxChars ||
        gap > 1.6 ||
        endPunct.test(cur.text);
      if (shouldSplit) {
        cur = { indices: [i], text: ln.t.trim(), s: ln.s };
        groups.push(cur);
      } else {
        cur.indices.push(i);
        cur.text += (/[\p{L}\p{N}]$/u.test(cur.text) && /^[\p{L}\p{N}]/u.test(ln.t) ? ' ' : '') + ln.t.trim();
      }
    }
    return groups;
  };

  return {
    SUPPORTED_12,
    LANG_META,
    normCode,
    translationLanguageKey,
    detectLang,
    get: makeModule,
    langFor: makeModule,
    mergeSentences,
    setLexicon,
    setForms,
    jaDeinflectCandidates,
    DE_SEP_PREFIXES,
    DE_KEEP,
  };
})();

if (typeof globalThis !== "undefined" && typeof window !== "undefined" && window.SS_LANG) globalThis.SS_LANG = window.SS_LANG;
