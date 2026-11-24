// Offline dictionary packs (built by _dev/build_packs.py into data/packs/<pack>/): meanings with no companion and no network.
// A pack is split into shards by FNV-1a hash of the lower-cased word, so one click reads one small gzipped file.
// self.packSources(words, lang, tl) -> [{id, name, note, licence, word, entries:[{head, reading, pos, defs, examples}]}] (first word that hits)
// When a word has no entry it tries, in order: inflected form -> headword (from the pack's form index),
// language-specific stripping (Korean particles/endings, Tagalog -ng linker, French/Italian hyphen and apostrophe parts),
// and for Chinese/Japanese a longest-match split into component words. Each fallback says what it did in `note`.
(() => {
  const PACK = { en: 'en', zh: 'zh', cn: 'zh', yue: 'zh', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt', ru: 'ru', tl: 'tl', fil: 'tl', tgl: 'tl' };
  const metaP = new Map(), shardC = new Map();
  const base = (lang) => PACK[(lang || '').toLowerCase().split(/[-_]/)[0]] || '';
  function fnv(s) {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h;
  }
  async function gz(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('pack ' + r.status);
    return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text());
  }
  function meta(pack) {
    if (!metaP.has(pack)) metaP.set(pack, fetch(chrome.runtime.getURL(`data/packs/${pack}/meta.json`)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return metaP.get(pack);
  }
  async function shard(pack, key) {
    const m = await meta(pack);
    if (!m) return null;
    const n = fnv(key) % m.shards, ck = pack + '/' + n;
    if (!shardC.has(ck)) {
      if (shardC.size > 120) shardC.delete(shardC.keys().next().value);
      shardC.set(ck, gz(chrome.runtime.getURL(`data/packs/${pack}/${n}.json.gz`)).catch((e) => { shardC.delete(ck); throw e; }));
    }
    return shardC.get(ck);
  }
  async function heads(pack, key) {
    const s = await shard(pack, key);
    return (s && s.h[key]) || [];
  }
  // exact headword, then inflected form -> headword
  async function find(pack, w) {
    const key = String(w || '').trim().toLowerCase();
    if (!key) return null;
    const s = await shard(pack, key);
    if (!s) return null;
    // a word can be a headword and an inflected form at once (French est: "east" and a form of être): show both
    let lemHit = null;
    for (const lem of s.f[key] || []) {
      const h = await heads(pack, lem);
      if (h.length) { lemHit = { word: lem, hits: h }; break; }
    }
    if (s.h[key]) {
      if (!lemHit) return { word: w, hits: s.h[key], note: '' };
      return { word: w, hits: s.h[key].concat(lemHit.hits.map((e) => [e[0], e[1] + ` (${key} is a form of it)`, e[2], e[3], e[4]])), note: `also a form of ${lemHit.word}` };
    }
    if (lemHit) return { word: lemHit.word, hits: lemHit.hits, note: `form of ${lemHit.word}` };
    return null;
  }
  const KO_TAIL = [
    '이에요', '거예요', '거에요', '예요', '입니다', '이었다', '이었어', '에서는', '에게서', '한테서', '으로는', '에서도',
    '에서', '에게', '한테', '까지', '부터', '처럼', '보다', '으로', '이라고', '라고', '이랑',
    '하고', '이야', '거야', '거요', '거죠', '이죠', '이다', '님들', '님', '들',
    '은', '는', '이', '가', '을', '를', '에', '의', '도', '만', '로', '와', '과', '랑', '요', '죠', '야', '지', '서',
  ];
  const KO_VERB_TAIL = [
    '은가요', '인가요', '을까요', 'ㄹ까요', '건가요', '을래요', 'ㄹ래요', '겠어요', '겠네요', '겠습니다',
    '거든요', '잖아요', '던데요', '는데요', '었어요', '았어요', '였어요', '었더니', '았더니',
    '습니다', '십니다', 'ㅂ니다', '으세요', '으려고', '으니까', '으면',
    '나요', '까요', '군요', '네요', '는데', '더니', '었어', '았어', '였다', '었다', '았다', '겠다', '겠어', '겠지',
    '다면', '다고', '냐고', '자고', '잖아', '거든', '던데', '면서', '도록', '을지', '테니', '텐데',
    '세요', '어요', '아요', '여요', '해요', '려고', '니까', '지만', '어라', '아라', '을까', '을래',
    '어', '아', '고', '면', '니', '나', '소', '오', '게', '지', '죠',
  ];
  const KO_CONTR = {
    텐데: '터', 터인데: '터', 테니: '터', 건: '것', 걸: '것', 게: '것',
    거예요: '것', 거에요: '것', 거요: '것', 거죠: '것', 거야: '것', 건가: '것', 건가요: '것', 건데: '것',
    그건: '그것', 그걸: '그것', 그게: '그것', 그거: '그것',
    이건: '이것', 이걸: '이것', 이게: '이것', 이거: '이것',
    저건: '저것', 저걸: '저것', 저게: '저것', 저거: '저것',
    뭔: '무엇', 뭘: '무엇', 뭡니까: '무엇', 뭐야: '무엇', 뭐예요: '무엇', 왜: '왜', 말이야: '말',
  };
  const KO_HADA_FU = { 했: '하', 해: '하', 할: '하', 한: '하', 함: '하', 와: '오', 왔: '오', 올: '오', 온: '오', 봐: '보', 봤: '보', 볼: '보', 본: '보', 돼: '되', 됐: '되', 될: '되', 된: '되', 줘: '주', 줬: '주', 줄: '주', 준: '주', 가: '가', 갔: '가', 갈: '가', 간: '가', 나: '나', 났: '나', 날: '나', 난: '나', 샀: '사', 탔: '타', 잤: '자', 셨: '시', 였: '이' };
  const EN_FORMS = {
    gonna: 'go', wanna: 'want', gotta: 'get', kinda: 'kind', sorta: 'sort', outta: 'out', lotta: 'lot',
    dunno: 'know', lemme: 'let', gimme: 'give', aint: 'be', "ain't": 'be',
    gentlemen: 'gentleman', men: 'man', women: 'woman', children: 'child', people: 'person',
    teeth: 'tooth', feet: 'foot', mice: 'mouse', geese: 'goose', oxen: 'ox',
    lives: 'life', wives: 'wife', knives: 'knife', leaves: 'leaf', wolves: 'wolf', thieves: 'thief',
    shelves: 'shelf', halves: 'half', calves: 'calf', ourselves: 'ourself', themselves: 'themself',
  };
  const JA_IRREG_DEINF = {
    '行った': '行く', '行って': '行く', '行きます': '行く', '行かない': '行く', '行かなかった': '行く',
    '来た': '来る', '来て': '来る', '来ます': '来る', '来ない': '来る',
    'きた': 'くる', 'きて': 'くる', 'きます': 'くる', 'こない': 'くる',
    'した': 'する', 'して': 'する', 'します': 'する', 'しない': 'する', 'しなかった': 'する',
    'いい': 'よい', 'よかった': 'よい', 'よくない': 'よい',
  };
  const deinflectJa = (w) => {
    const out = [];
    const seen = new Set([w]);
    const push = (cand, why) => {
      if (cand && cand !== w && !seen.has(cand)) { seen.add(cand); out.push([cand, why]); }
    };
    if (JA_IRREG_DEINF[w]) push(JA_IRREG_DEINF[w], `form of ${JA_IRREG_DEINF[w]}`);
    const queue = [w];
    const seenQ = new Set(queue);
    while (queue.length && out.length < 24) {
      const cur = queue.shift();
      // Compound auxiliary strips back to shorter stem
      for (const [end, rep] of [
        ['ています', 'る'], ['ている', 'る'], ['ていた', 'る'], ['ていた', ''], ['てい', ''], ['てる', 'て'], ['てた', 'て'],
        ['ました', 'ます'], ['ません', 'ます'], ['ませんでした', 'ます'], ['なかった', 'ない'], ['なかったら', 'ない'],
        ['たく', 'たい'], ['たかった', 'たい'], ['くない', 'い'], ['かった', 'い'], ['くて', 'い'], ['くな', 'い'],
        ['られた', 'る'], ['られる', 'る'], ['れた', 'る'], ['させる', 'る'], ['せる', 'る'], ['ちゃう', 'て'], ['じゃう', 'で'],
      ]) {
        if (cur.length > end.length && cur.endsWith(end)) {
          const nxt = cur.slice(0, -end.length) + rep;
          if (!seenQ.has(nxt)) { seenQ.add(nxt); queue.push(nxt); }
          if (rep === 'る' || rep === 'い') push(nxt, `form of ${nxt}`);
        }
      }
      // Godan & Ichidan terminal -> dictionary candidates
      for (const [end, reps] of [
        ['った', ['う', 'つ', 'る']], ['って', ['う', 'つ', 'る']],
        ['んだ', ['む', 'ぶ', 'ぬ']], ['んで', ['む', 'ぶ', 'ぬ']],
        ['いた', ['く']], ['いて', ['く']],
        ['いだ', ['ぐ']], ['いで', ['ぐ']],
        ['した', ['す', 'する']], ['して', ['す', 'する']],
        ['た', ['る']], ['て', ['る']],
        ['ます', ['る', '']],
        ['ない', ['る']],
        ['たい', ['る']],
      ]) {
        if (cur.length > end.length && cur.endsWith(end)) {
          const st = cur.slice(0, -end.length);
          for (const r of reps) push(st + r, `form of ${st + r}`);
          if (end === 'ます' || end === 'たい') {
            const last = st.slice(-1);
            const iToU = { い: 'う', き: 'く', ぎ: 'ぐ', し: 'す', じ: 'ず', ち: 'つ', に: 'ぬ', ひ: 'ふ', び: 'ぶ', み: 'む', り: 'る' }[last];
            if (iToU) push(st.slice(0, -1) + iToU, `form of ${st.slice(0, -1) + iToU}`);
          }
          if (end === 'ない') {
            const last = st.slice(-1);
            const aToU = { わ: 'う', か: 'く', が: 'ぐ', さ: 'す', た: 'つ', な: 'ぬ', ば: 'ぶ', ま: 'む', ら: 'る' }[last];
            if (aToU) push(st.slice(0, -1) + aToU, `form of ${st.slice(0, -1) + aToU}`);
          }
        }
      }
    }
    return out;
  };
  async function variants(pack, w) {
    const out = [];
    if (pack === 'en') {
      if (EN_FORMS[w]) out.push([EN_FORMS[w], `form of ${EN_FORMS[w]}`]);
      const baseW = w.replace(/('s|n't|'re|'ve|'ll|'d|'m)$/i, '');
      if (baseW !== w && baseW.length >= 2) out.push([baseW, `contraction/possessive of ${baseW}`]);
      if (w.length > 4 && w.endsWith('ies')) out.push([w.slice(0, -3) + 'y', `plural/3sg of ${w.slice(0, -3)}y`]);
      if (w.length > 4 && w.endsWith('ied')) out.push([w.slice(0, -3) + 'y', `past of ${w.slice(0, -3)}y`]);
      if (w.length > 4 && w.endsWith('ves')) out.push([w.slice(0, -3) + 'f', `plural of ${w.slice(0, -3)}f`], [w.slice(0, -3) + 'fe', `plural of ${w.slice(0, -3)}fe`]);
      if (w.length > 3 && w.endsWith('es')) out.push([w.slice(0, -2), `plural/3sg of ${w.slice(0, -2)}`], [w.slice(0, -1), `form of ${w.slice(0, -1)}`]);
      if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.push([w.slice(0, -1), `form of ${w.slice(0, -1)}`]);
      if (w.length > 4 && w.endsWith('ed')) {
        const st = w.slice(0, -2);
        out.push([st, `past of ${st}`], [st + 'e', `past of ${st}e`]);
        if (st.length >= 3 && st.slice(-1) === st.slice(-2, -1)) out.push([st.slice(0, -1), `past of ${st.slice(0, -1)}`]);
      }
      if (w.length > 5 && w.endsWith('ing')) {
        const st = w.slice(0, -3);
        out.push([st, `gerund of ${st}`], [st + 'e', `gerund of ${st}e`]);
        if (st.length >= 3 && st.slice(-1) === st.slice(-2, -1)) out.push([st.slice(0, -1), `gerund of ${st.slice(0, -1)}`]);
      }
      if (w.length > 4 && w.endsWith('er')) out.push([w.slice(0, -2), `base of ${w.slice(0, -2)}`], [w.slice(0, -1), `base of ${w.slice(0, -1)}`]);
      if (w.length > 5 && w.endsWith('est')) out.push([w.slice(0, -3), `superlative of ${w.slice(0, -3)}`], [w.slice(0, -2), `superlative of ${w.slice(0, -2)}`]);
      if (w.length > 4 && w.endsWith('ly')) out.push([w.slice(0, -2), `adverb of ${w.slice(0, -2)}`]);
    } else if (pack === 'ja') {
      out.push(...deinflectJa(w));
    } else if (pack === 'ko') {
      if (KO_CONTR[w]) out.push([KO_CONTR[w], `contraction of ${KO_CONTR[w]}`]);
      for (const t of KO_VERB_TAIL) {
        if (w.length > t.length && w.endsWith(t)) {
          const r = w.slice(0, -t.length);
          out.push([r + '다', `${r}다 + -${t}`]);
          const lastCh = r.slice(-1);
          if (KO_HADA_FU[lastCh]) {
            const baseStem = r.slice(0, -1) + KO_HADA_FU[lastCh];
            out.push([baseStem + '다', `${baseStem}다 + -${t}`]);
          }
          const code = lastCh.charCodeAt(0) - 0xac00;
          if (code >= 0 && code < 11172) {
            const fin = code % 28;
            if (fin === 4 || fin === 8) {
              const openSyl = String.fromCharCode(0xac00 + code - fin);
              const openStem = r.slice(0, -1) + (KO_HADA_FU[openSyl] || openSyl);
              out.push([openStem + '다', `${openStem}다 + -${t}`]);
            }
          }
        }
      }
      for (const t of KO_TAIL) {
        if (w.length > t.length && w.endsWith(t)) {
          const r = w.slice(0, -t.length);
          if (r.endsWith('거')) out.push([r.slice(0, -1) + '것', `${r} (= 것) + ${t}`]);   // 거 is spoken 것 "thing", not 거 "vehicle"
          out.push([r, `${r} + ${t}`], [r + '다', `${r}다 + ending`]);
          for (const t2 of ['님', '들']) {
            if (r.length > t2.length && r.endsWith(t2)) {
              const r2 = r.slice(0, -t2.length);
              out.push([r2, `${r2} + ${t2} + ${t}`]);
            }
          }
        }
      }
      if (/[건걸]$/.test(w)) out.push([w.slice(0, -1) + '것', 'contraction of 것']);
      if (w.endsWith('서') && w.length > 1) out.push([w.slice(0, -1), `${w.slice(0, -1)} + 서 (에서)`]);
      // 는/를/ㄹ fused into the last syllable as a final consonant: 여긴 = 여기 + 는, 날 = 나 + 를, 될 = 되 + -ㄹ
      const last = w.charCodeAt(w.length - 1) - 0xac00;
      if (last >= 0 && last < 11172) {
        const fin = last % 28;
        if (fin === 4 || fin === 8) {
          const r = w.slice(0, -1) + String.fromCharCode(0xac00 + last - fin);
          const what = fin === 4 ? '는/ㄴ' : '를/ㄹ';
          out.push([r, `${r} + ${what}`], [r + '다', `${r}다 + ${what}`]);
        }
      }
    } else if (pack === 'tl') {
      const TL_COLLOQ = {
        sayo: 'iyo', sakin: 'akin', satin: 'atin', samin: 'amin', sanyo: 'inyo', sanila: 'kanila',
        nasayo: 'iyo', meron: 'mayroon', bat: 'bakit', san: 'saan', dun: 'doon', dyan: 'diyan', jan: 'diyan',
        ganun: 'ganoon', ganon: 'ganoon', kelan: 'kailan', pano: 'paano', pede: 'puwede', pwede: 'puwede',
        wag: 'huwag', di: 'hindi', yung: 'iyon', nung: 'noon', marami: 'dami',
      };
      if (TL_COLLOQ[w]) out.push([TL_COLLOQ[w], `colloquial form of ${TL_COLLOQ[w]}`]);
      if (/['’](?:t|y|ng)$/i.test(w)) {
        const bare = w.replace(/['’](?:t|y|ng)$/i, '');
        out.push([bare, `${bare} + clitic`]);
        if (TL_COLLOQ[bare]) out.push([TL_COLLOQ[bare], `colloquial form of ${TL_COLLOQ[bare]}`]);
      }
      if (/[aeiou]ng$/i.test(w)) out.push([w.slice(0, -2), `${w.slice(0, -2)} + linker -ng`]);
      if (/ng$/i.test(w)) out.push([w.slice(0, -1), `${w.slice(0, -1)} + linker -g`]);   // aking = akin + g
      for (const pfx of ['ipagpa', 'makipag', 'nakikipag', 'pakikipag', 'nakapag', 'makapag', 'pakiki', 'paki', 'kaka', 'nagpa', 'magpa', 'nag', 'mag', 'pag', 'pinag', 'ika', 'ka', 'ni', 'in', 'na', 'ma', 'i']) {
        if (w.startsWith(pfx) && w.length > pfx.length + 2) {
          const st = w.slice(pfx.length);
          out.push([st, `${pfx}- + ${st}`]);
          if (st.startsWith('r') && st.length >= 4) out.push(['d' + st.slice(1), `${pfx}- + d${st.slice(1)}`]);
        }
      }
      const um = /^([bcdfghklmnpqrstvwxyz])um([aeiou]\w+)$/i.exec(w);
      if (um) out.push([um[1] + um[2], `<um> infix of ${um[1] + um[2]}`]);
      const inFx = /^([bcdfghklmnpqrstvwxyz])in([aeiou]\w+)$/i.exec(w);
      if (inFx) out.push([inFx[1] + inFx[2], `<in> infix of ${inFx[1] + inFx[2]}`]);
      if (w.length >= 6 && /(?:han|hin|an|in)$/i.test(w)) {
        const sfx = w.replace(/(?:han|hin|an|in)$/i, '');
        if (sfx.length >= 4) out.push([sfx, `stem of ${w}`]);
      }
    } else if (pack === 'ru') {
      if (w.includes('е')) out.push([w.replace(/е/g, 'ё'), 'spelled with ё'], ...[...w.matchAll(/е/g)].map((m) => [w.slice(0, m.index) + 'ё' + w.slice(m.index + 1), 'spelled with ё']));
      for (const end of ['ами', 'ями', 'ому', 'ему', 'ого', 'его', 'ыми', 'ими', 'ах', 'ях', 'ом', 'ем', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ут', 'ют', 'ат', 'ят', 'ал', 'ял', 'ил', 'ел', 'ла', 'ло', 'ли']) {
        if (w.length > end.length + 2 && w.endsWith(end)) {
          const st = w.slice(0, -end.length);
          out.push([st, `inflected stem of ${st}`], [st + 'а', `form of ${st}а`], [st + 'я', `form of ${st}я`], [st + 'ить', `inflected ${st}ить`], [st + 'ать', `inflected ${st}ать`]);
        }
      }
    } else if (pack === 'de') {
      if (w.length > 5 && w.startsWith('ge')) {
        const noGe = w.slice(2);
        if (noGe.endsWith('t') && noGe.length > 3) out.push([noGe.slice(0, -1) + 'en', `participle of ${noGe.slice(0, -1)}en`]);
        if (noGe.endsWith('en')) out.push([noGe, `participle of ${noGe}`]);
      }
      for (const end of ['sten', 'ster', 'stes', 'stem', 'ern', 'est', 'end', 'ten', 'tet', 'te', 'st', 'en', 'er', 'es', 'em', 'e', 'n', 's']) {
        if (w.length > end.length + 2 && w.endsWith(end)) {
          const st = w.slice(0, -end.length);
          out.push([st, `form of ${st}`], [st + 'en', `verb form of ${st}en`]);
        }
      }
    } else if (pack === 'es' || pack === 'pt') {
      if (w.length > 5 && w.endsWith('mente')) out.push([w.slice(0, -5), `adverb of ${w.slice(0, -5)}`]);
      if (w.length > 5 && (w.endsWith('ando') || w.endsWith('iendo') || w.endsWith('endo') || w.endsWith('indo'))) {
        const idx = w.endsWith('iendo') ? -5 : -4;
        const st = w.slice(0, idx);
        const v = w.endsWith('ando') ? 'ar' : (w.endsWith('indo') ? 'ir' : 'er');
        out.push([st + v, `gerund of ${st + v}`], [st + 'ir', `gerund of ${st}ir`]);
      }
      if (w.length > 5 && (w.endsWith('ado') || w.endsWith('ada') || w.endsWith('ido') || w.endsWith('ida'))) {
        const st = w.slice(0, -3);
        const v = w[w.length - 3] === 'a' ? 'ar' : 'er';
        out.push([st + v, `participle of ${st + v}`], [st + 'ir', `participle of ${st}ir`]);
      }
      if (w.length > 4 && w.endsWith('es')) out.push([w.slice(0, -2), `plural of ${w.slice(0, -2)}`], [w.slice(0, -1), `form of ${w.slice(0, -1)}`]);
      if (w.length > 3 && w.endsWith('s')) out.push([w.slice(0, -1), `form of ${w.slice(0, -1)}`]);
    } else if (pack === 'fr') {
      if (/['’-]/.test(w)) {
        const parts = w.split(/['’-]/).filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
        for (const p of parts) out.push([p, `part of ${w}`]);
      }
      for (const end of ['ement', 'aient', 'ions', 'iez', 'ons', 'ez', 'ant', 'ées', 'ée', 'és', 'és', 'es', 'er', 'e', 's', 'x']) {
        if (w.length > end.length + 2 && w.endsWith(end)) {
          const st = w.slice(0, -end.length);
          out.push([st, `form of ${st}`], [st + 'er', `verb form of ${st}er`]);
        }
      }
    } else if (pack === 'it') {
      const m = /^(del|dal|nel|al|sul|col)(l[aoei]|l'|lo|la|le|gli|i)?$/.exec(w) || /^(dei|degli|delle|della|dello|nei|negli|nelle|nella|nello|ai|agli|alle|alla|allo|dai|dagli|dalle|dalla|dallo|sui|sugli|sulle|sulla|sullo)$/.exec(w);
      if (m) {
        const p = { de: 'di', da: 'da', ne: 'in', al: 'a', ag: 'a', ai: 'a', su: 'su', co: 'con' }[w.slice(0, 2)] || '';
        if (p) out.push([p, `${p} + article`]);
      }
      if (/['’-]/.test(w)) {
        const parts = w.split(/['’-]/).filter((x) => x.length > 1).sort((a, b) => b.length - a.length);
        for (const x of parts) out.push([x, `part of ${w}`]);
        const el = /^(\p{L}+)['’]/u.exec(w);
        if (el) for (const v of 'aoe') out.push([el[1] + v, `${el[1]}' = ${el[1]}${v}`]);
      }
    } else if (/['’-]/.test(w)) {
      const parts = w.split(/['’-]/).filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
      for (const p of parts) out.push([p, `part of ${w}`]);
      const el = /^(\p{L}+)['’]/u.exec(w);   // elided first word: cos' -> cosa, quell' -> quello
      if (el) for (const v of 'aoe') out.push([el[1] + v, `${el[1]}' = ${el[1]}${v}`]);
    }
    return out;
  }
  async function splitCjk(pack, w) {   // longest-match split: 不知道 -> 不 + 知道
    const chars = Array.from(w), parts = [];
    for (let i = 0; i < chars.length;) {
      let got = null;
      for (let j = Math.min(chars.length, i + 6); j > i; j--) {
        const sub = chars.slice(i, j).join('');
        const h = await heads(pack, sub);
        if (h.length) { got = { word: sub, hits: h }; i = j; break; }
      }
      if (!got) return null;
      parts.push(got);
    }
    return parts.length > 1 ? parts : null;
  }
  function toSources(m, pack, lang, tl, r, note) {
    const order = pack === 'zh' ? (lang === 'yue' ? ['cccanto', 'cedict', 'enwikt_zh'] : ['cedict', 'enwikt_zh', 'cccanto'])
      : pack === 'en' ? (/^(zh|yue)/.test(tl || '') ? ['ecdict', 'oewn'] : ['oewn', 'ecdict']) : Object.keys(m.srcs);
    const by = new Map();
    for (const [src, head, rd, pos, defs] of r.hits) {
      if (!by.has(src)) by.set(src, []);
      // CC-CEDICT readings are "pinyin · jyutping"; show the half that fits the video
      let reading = rd;
      if (pack === 'zh' && rd.includes(' · ')) reading = rd.split(' · ')[lang === 'yue' ? 1 : 0];
      by.get(src).push({ head, reading, pos, defs, examples: [] });
    }
    return order.filter((s) => by.has(s)).map((s) => ({
      id: 'pack_' + s, name: m.srcs[s][0], licence: m.srcs[s][1], word: r.word,
      note: ['offline pack', note].filter(Boolean).join(' · '), entries: by.get(s).slice(0, 6),
    }));
  }
  self.koreanDictionaryVariants = (word) => variants('ko', word);
  self.packSources = async (words, lang, tl) => {
    const pack = base(lang);
    if (!pack) return [];
    const m = await meta(pack);
    if (!m) return [];
    const lg = (lang || '').toLowerCase().split(/[-_]/)[0];
    try {
      for (const w of words || []) {
        const r = await find(pack, w);
        if (r) return toSources(m, pack, lg, tl, r, r.note);
      }
      const w0 = String((words || [])[0] || '').trim();
      if (!w0) return [];
      for (const [v, note] of await variants(pack, w0.toLowerCase())) {
        const r = await find(pack, v);
        if (r) return toSources(m, pack, lg, tl, r, [note, r.note].filter(Boolean).join(' · '));
      }
      if ((pack === 'zh' || pack === 'ja') && /[㐀-鿿぀-ヿ]/.test(w0)) {
        const parts = await splitCjk(pack, w0);
        if (parts) return parts.flatMap((p) => toSources(m, pack, lg, tl, p, `part of ${w0}`).slice(0, 1));
      }
      if (pack === 'tl' && /^[a-z][a-z'\-]{1,}$/i.test(w0)) {
        const mEn = await meta('en');
        if (mEn) {
          for (const w of words || []) {
            const rEn = await find('en', w);
            if (rEn) return toSources(mEn, 'en', 'en', tl, rEn, ['Taglish (EN)', rEn.note].filter(Boolean).join(' · '));
          }
          for (const [v, note] of await variants('en', w0.toLowerCase())) {
            const rEn = await find('en', v);
            if (rEn) return toSources(mEn, 'en', 'en', tl, rEn, ['Taglish (EN)', note, rEn.note].filter(Boolean).join(' · '));
          }
        }
      }
    } catch (e) {}
    return [];
  };
})();
