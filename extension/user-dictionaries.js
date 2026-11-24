/* Local, text-only imports of the documented Yomitan term-bank format. */
(() => {
  const dbName = 'phrasebound-user-dictionaries';
  const supported = 'en es fr de pt it ru ja ko zh yue tl'.split(' ');
  const bankLimit = 64 * 1024 * 1024;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let opened;

  function language(value) {
    const code = String(value || '').toLowerCase().split(/[-_]/)[0];
    return ({ fil: 'tl', tgl: 'tl', jpn: 'ja', kor: 'ko', cmn: 'zh' })[code] || code;
  }

  const key = value => String(value || '').normalize('NFKC').toLowerCase().trim();
  const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

  function database() {
    if (opened) return opened;
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('packs', { keyPath: 'id' });
        const entries = db.createObjectStore('entries', { autoIncrement: true });
        entries.createIndex('matches', 'matches', { multiEntry: true });
        entries.createIndex('pack', 'pack');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opened = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Phrasebound settings tabs and retry.'));
    }).catch(error => { opened = null; throw error; });
    return opened;
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function commit(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Dictionary storage was interrupted.'));
    });
  }

  async function list() {
    const db = await database();
    return requestValue(db.transaction('packs').objectStore('packs').getAll());
  }

  async function remove(id) {
    const db = await database();
    const tx = db.transaction(['packs', 'entries'], 'readwrite');
    const done = commit(tx);
    tx.objectStore('packs').delete(id);
    const scan = tx.objectStore('entries').index('pack').openCursor(IDBKeyRange.only(id));
    scan.onsuccess = () => {
      const row = scan.result;
      if (row) { row.delete(); row.continue(); }
    };
    await done;
  }

  async function directory(file) {
    const tailStart = Math.max(0, file.size - 65557);
    const tail = new DataView(await file.slice(tailStart).arrayBuffer());
    let end = tail.byteLength - 22;
    while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--;
    if (end < 0) throw new Error('Choose a valid Yomitan dictionary ZIP.');
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    const count = tail.getUint16(end + 10, true);
    if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true) || size > 16 * 1024 * 1024 ||
      offset + size > tailStart + end || count === 65535) throw new Error('This ZIP layout is unsupported.');
    const bytes = await file.slice(offset, offset + size).arrayBuffer();
    const view = new DataView(bytes);
    const entries = new Map();
    let at = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > size || view.getUint32(at, true) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
      const nameSize = view.getUint16(at + 28, true);
      const next = at + 46 + nameSize + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
      if (next > size) throw new Error('The ZIP directory is incomplete.');
      const name = decoder.decode(new Uint8Array(bytes, at + 46, nameSize));
      if (name === 'index.json' || /^term_bank_\d+\.json$/.test(name)) {
        if (entries.has(name)) throw new Error('The ZIP contains duplicate dictionary files.');
        entries.set(name, { name, flags: view.getUint16(at + 8, true), method: view.getUint16(at + 10, true),
          packed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true),
          offset: view.getUint32(at + 42, true), boundary: offset });
      }
      at = next;
    }
    return entries;
  }

  async function jsonMember(file, member, limit) {
    if (!member || member.size > limit || member.packed > limit || member.flags & 1 ||
      ![0, 8].includes(member.method) || member.offset + 30 > member.boundary) {
      throw new Error('A dictionary file is missing, too large, encrypted, or uses unsupported compression.');
    }
    const h = new DataView(await file.slice(member.offset, member.offset + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(8, true) !== member.method) throw new Error('Invalid ZIP member.');
    const start = member.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    if (start + member.packed > member.boundary) throw new Error('The ZIP member is incomplete.');
    let stream = file.slice(start, start + member.packed).stream();
    if (member.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const utf8 = new TextDecoder('utf-8', {fatal: true});
    const chunks = [];
    let size = 0;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > member.size || size > limit) { await reader.cancel(); throw new Error('The ZIP member exceeds its declared size.'); }
      chunks.push(utf8.decode(value, {stream: true}));
    }
    if (size !== member.size) throw new Error('The ZIP member is incomplete.');
    chunks.push(utf8.decode());
    return JSON.parse(chunks.join(''));
  }

  function definition(value) {
    let output = '';
    function append(node, depth) {
      if (depth > 18 || output.length >= 4000 || node == null) return;
      if (typeof node === 'string') { output += node.slice(0, 4000 - output.length); return; }
      if (Array.isArray(node)) { for (const part of node) append(part, depth + 1); return; }
      if (node.type === 'image' || ['img', 'rt', 'rp'].includes(node.tag)) return;
      if (node.type === 'structured-content' || node.type === 'text' || node.tag) {
        const block = /^(?:br|div|li|tr|td|th|p)$/.test(node.tag || '');
        if (block && output) output += '\n';
        append(node.content ?? node.text, depth + 1);
        if (block) output += '\n';
      }
    }
    append(value, 0);
    return output.replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
  }

  async function importZip(file, selectedLanguage, progress) {
    const files = await directory(file);
    const index = await jsonMember(file, files.get('index.json'), 1024 * 1024);
    const title = text(index?.title, 180);
    const format = index?.format ?? index?.version;
    if (!title || ![1, 2, 3].includes(format)) throw new Error('The dictionary needs a title and a supported format in index.json.');
    const lang = language(selectedLanguage || index.sourceLanguage);
    if (!supported.includes(lang)) throw new Error('Select the language of the dictionary’s headwords.');
    const banks = [...files.values()].filter(entry => entry.name !== 'index.json')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    if (!banks.length) throw new Error('This ZIP has no term banks. Choose a vocabulary dictionary.');
    const db = await database();
    const id = crypto.randomUUID();
    const pack = {id, title, lang, revision: text(index.revision, 60), author: text(index.author, 180), count: 0};
    try {
      for (let i = 0; i < banks.length; i++) {
        const rows = await jsonMember(file, banks[i], bankLimit);
        if (!Array.isArray(rows)) throw new Error('A term bank is not a list.');
        const tx = db.transaction('entries', 'readwrite');
        const done = commit(tx);
        const store = tx.objectStore('entries');
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          const head = text(row[0], 180), reading = text(row[1], 180);
          const gloss = Array.isArray(row[5]) ? row[5] : row.slice(5);
          const defs = [...new Set(gloss.slice(0, 16).map(definition).filter(Boolean))];
          if (!head || !defs.length) continue;
          const matches = [...new Set([head, reading].filter(Boolean).map(value => `${lang}:${key(value)}`))];
          store.add({pack: id, matches, head, reading: reading === head ? '' : reading,
            pos: text(row[2], 150), defs, score: Number.isFinite(row[4]) ? row[4] : 0});
          pack.count++;
        }
        await done;
        if (progress) progress(i + 1, banks.length);
      }
      if (!pack.count) throw new Error('The dictionary has no usable text definitions.');
      const tx = db.transaction('packs', 'readwrite');
      const done = commit(tx);
      tx.objectStore('packs').add(pack);
      await done;
      return pack;
    } catch (error) {
      await remove(id).catch(() => {});
      throw error;
    }
  }

  async function lookup(words, lang, languageApi, koreanVariants) {
    lang = language(lang);
    if (!supported.includes(lang)) return [];
    const packs = (await list()).filter(pack => pack.lang === lang);
    if (!packs.length) return [];
    const candidates = new Set();
    for (const word of words.slice(0, 10)) {
      if (typeof word !== 'string' || word.length > 180) continue;
      for (const value of [word, languageApi?.get(lang)?.lemma?.(word)]) if (value) candidates.add(key(value));
      if (lang === 'ja') for (const {lemma} of languageApi?.jaDeinflectCandidates?.(word) || []) {
        if (lemma) candidates.add(key(lemma));
      }
      if (lang === 'ko' && koreanVariants) {
        for (const [lemma] of await koreanVariants(word)) candidates.add(key(lemma));
      }
    }
    const db = await database();
    const index = db.transaction('entries').objectStore('entries').index('matches');
    const results = await Promise.all([...candidates].slice(0, 36).map(word => requestValue(index.getAll(`${lang}:${word}`, 100))));
    return packs.flatMap(pack => {
      const seen = new Set();
      const entries = results.flatMap(rows => rows.filter(row => row.pack === pack.id).sort((a,b) => b.score - a.score))
        .filter(row => {
          const signature = JSON.stringify([row.head, row.reading, row.defs]);
          if (seen.has(signature)) return false;
          seen.add(signature);
          return true;
        }).slice(0, 8).map(({head, reading, pos, defs}) => ({head, reading, pos, defs}));
      return entries.length ? [{id: `user:${pack.id}`, name: pack.title, note: 'Imported dictionary', entries}] : [];
    });
  }

  globalThis.SS_USER_DICTIONARIES = {supported, importZip, list, remove, lookup};
})();
