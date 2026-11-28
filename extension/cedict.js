// Bundled CC-CEDICT (CC BY-SA 4.0, mdbg.net, data/cedict.txt.gz) for Chinese lookups that work without the companion app.
// Loaded once per service-worker life, on the first Chinese lookup (about 120k entries; parsing takes well under a second).
// cedictLookup(word) -> [{head, trad, reading, defs}] or []. Matches simplified or traditional headwords exactly.
// cedictTrad(word)   -> the traditional form, or '' (used to retry Wiktionary, whose simplified pages often only point to the traditional one).
(() => {
  let mapP = null;
  const TONE = { a: 'āáǎàa', e: 'ēéěèe', i: 'īíǐìi', o: 'ōóǒòo', u: 'ūúǔùu', 'ü': 'ǖǘǚǜü' };
  function syl(s) {
    const m = /^([a-zü:]+)([1-5])$/i.exec(s);
    if (!m) return s;
    let b = m[1].replace(/u:/gi, 'ü');
    const t = +m[2] - 1;
    const low = b.toLowerCase();
    let i = low.search(/[ae]/);
    if (i < 0) i = low.indexOf('ou');
    if (i < 0) { for (let k = low.length - 1; k >= 0; k--) if ('iouü'.includes(low[k])) { i = k; break; } }
    if (i < 0 || t === 4) return b;
    const ch = low[i];
    const marked = TONE[ch][t];
    return b.slice(0, i) + (b[i] === ch ? marked : marked.toUpperCase()) + b.slice(i + 1);
  }
  async function load() {
    // Store builds ship plain data/cedict.txt (the Edge store rejects compressed files); source builds ship .gz.
    let text;
    try {
      const r = await fetch(chrome.runtime.getURL('data/cedict.txt.gz'));
      if (!r.ok) throw new Error('no gz');
      text = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
    } catch (e) {
      text = await (await fetch(chrome.runtime.getURL('data/cedict.txt'))).text();
    }
    const map = new Map();
    const re = /^(\S+) (\S+) \[([^\]]*)\] \/(.+)\/\s*$/;
    for (const line of text.split('\n')) {
      if (!line || line[0] === '#') continue;
      const m = re.exec(line);
      if (!m) continue;
      const e = { trad: m[1], head: m[2], py: m[3], defs: m[4] };
      const add = (k) => { const a = map.get(k); if (a) a.push(e); else map.set(k, [e]); };
      add(m[2]);
      if (m[1] !== m[2]) add(m[1]);
    }
    return map;
  }
  function get() {
    if (!mapP) mapP = load().catch((e) => { mapP = null; throw e; });
    return mapP;
  }
  self.cedictLookup = async (word) => {
    const w = String(word || '').trim();
    if (!w || !/[\u3400-\u9fff]/.test(w)) return [];
    const hits = (await get()).get(w) || [];
    return hits.slice(0, 6).map((e) => ({
      head: e.head,
      trad: e.trad,
      reading: e.py.split(' ').map(syl).join(' '),
      defs: e.defs.split('/').filter((d) => d && !/^CL:/.test(d)).slice(0, 6),
    }));
  };
  // Character-by-character conversion, good enough to search a song title in both scripts.
  self.cedictConvert = async (text, to) => {
    const src = String(text || '');
    if (!/[㐀-鿿]/.test(src)) return src;
    const map = await get();
    let out = '';
    for (const ch of src) {
      const hits = /[㐀-鿿]/.test(ch) ? map.get(ch) : null;
      out += hits && hits.length ? (to === 'trad' ? hits[0].trad : hits[0].head) : ch;
    }
    return out;
  };
  self.cedictTrad = async (word) => {
    const hits = (await get()).get(String(word || '').trim()) || [];
    return hits.length ? hits[0].trad : '';
  };
})();
