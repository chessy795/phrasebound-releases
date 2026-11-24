// Language Reactor + Elmo Library (terra_gfl) multi-site export suite:
//   - Anki TSV (words, phrases, FEs, and gapped-frame Cloze {{c1::...}} cards across YouTube, Netflix, Prime Video, Disney+, Bilibili)
//   - Native AnkiConnect 1-click push & incremental re-export (ankiNoteId + exportedAt tracking)
//   - JSON (LR-compatible schema + FE, mastery & telemetry)
//   - CSV (Excel-friendly UTF-8 BOM with reading, layer & cross-lingual eq columns)
//   - SRT (original, translation, or bilingual with optional subtitle sync offset)
//   - Anki .apkg (audio clip + screenshot via local companion)
window.SS_EXPORT = (() => {
  const dl = (name, body, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  };

  const fmtSrtTime = (sec) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    return (
      String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0') + ',' +
      String(r).padStart(3, '0')
    );
  };

  const clean = (s) => String(s == null ? '' : s).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const clipUrlFor = (videoId, tSec = 0) => {
    if (!videoId) return '';
    if (window.SS_SITES && typeof window.SS_SITES.resolveVideoUrl === 'function') {
      return window.SS_SITES.resolveVideoUrl(videoId, tSec);
    }
    const raw = String(videoId).replace(/^yt:/, '');
    return `https://youtu.be/${encodeURIComponent(raw)}?t=${Math.floor(tSec || 0)}`;
  };

  const formatEqSummary = (eq) => {
    if (!eq || typeof eq !== 'object') return '';
    const labels = {
      en: 'EN', zh: 'ZH', yue: 'YUE', ja: 'JA', ko: 'KO',
      es: 'ES', fr: 'FR', de: 'DE', pt: 'PT', it: 'IT', ru: 'RU', tl: 'TL',
    };
    const parts = [];
    for (const [k, v] of Object.entries(eq)) {
      const val = Array.isArray(v) ? v.slice(0, 2).join(' / ') : String(v || '');
      if (val) parts.push(`${labels[k] || k.toUpperCase()}: ${val}`);
    }
    return parts.join(' · ');
  };

  const makeAnkiCloze = (line, target) => {
    const rawLine = String(line || target || '');
    const t = String(target || '').trim();
    if (!t) return `{{c1::${rawLine}}}`;
    const direct = new RegExp(escRe(t), 'i');
    if (direct.test(rawLine)) return rawLine.replace(direct, (m) => `{{c1::${m}}}`);
    const segs = t.split(/(?:…+|\.{2,}|\*+)/).map((x) => x.trim()).filter(Boolean);
    if (segs.length >= 2) {
      const gRe = new RegExp(segs.map(escRe).join('(.{1,12}?)'), 'i');
      if (gRe.test(rawLine)) {
        return rawLine.replace(gRe, (...args) => {
          const mids = args.slice(1, segs.length);
          const out = [];
          for (let i = 0; i < segs.length; i++) {
            out.push(`{{c1::${segs[i]}}}`);
            if (i < mids.length) out.push(mids[i]);
          }
          return out.join('');
        });
      }
    }
    return `${rawLine} ({{c1::${t}}})`;
  };

  // Yomitan-style {cloze-prefix}, {cloze-body}, {cloze-suffix} splitter (supports contiguous & discontinuous FEs)
  const splitClozeParts = (line, target) => {
    const rawLine = String(line || target || '');
    const t = String(target || '').trim();
    if (!t) return { prefix: '', body: rawLine, suffix: '', clozeText: makeAnkiCloze(rawLine, t) };
    const direct = new RegExp(escRe(t), 'i');
    const dm = direct.exec(rawLine);
    if (dm) {
      return {
        prefix: rawLine.slice(0, dm.index),
        body: dm[0],
        suffix: rawLine.slice(dm.index + dm[0].length),
        clozeText: makeAnkiCloze(rawLine, t),
      };
    }
    const segs = t.split(/(?:…+|\.{2,}|\*+)/).map((x) => x.trim()).filter(Boolean);
    if (segs.length >= 2) {
      const gRe = new RegExp(segs.map(escRe).join('(.{1,12}?)'), 'i');
      const gm = gRe.exec(rawLine);
      if (gm) {
        return {
          prefix: rawLine.slice(0, gm.index),
          body: gm[0],
          suffix: rawLine.slice(gm.index + gm[0].length),
          clozeText: makeAnkiCloze(rawLine, t),
        };
      }
    }
    return { prefix: rawLine ? (rawLine + ' ') : '', body: t, suffix: '', clozeText: makeAnkiCloze(rawLine, t) };
  };

  const renderAnkiMarkers = (templateStr, it = {}) => {
    const parts = splitClozeParts(it.line || it.word || '', it.surface || it.word || '');
    const url = it.videoId ? clipUrlFor(it.videoId, it.t) : (it.url || '');
    const map = {
      'word': String(it.word || ''),
      'lemma': String(it.lemma || it.word || ''),
      'reading': String(it.reading || ''),
      'meaning': String(it.def || ''),
      'translation': String(it.trans || ''),
      'sentence': String(it.line || ''),
      'cloze-prefix': parts.prefix,
      'cloze-body': parts.body,
      'cloze-suffix': parts.suffix,
      'source': String(it.title || it.videoId || ''),
      'url': url,
    };
    return String(templateStr || '').replace(/\{([a-z-]+)\}/gi, (full, key) => {
      const k = String(key || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : full;
    });
  };

  // 10ten-inspired single-key quick-copy formatter ('word' | 'tsv' | 'entry' | 'cloze')
  const formatQuickCopy = (it = {}, mode = 'entry') => {
    const word = String(it.word || it.surface || '').trim();
    const reading = String(it.reading || '').trim();
    const def = String(it.def || it.gloss || '').trim();
    const line = String(it.line || '').trim();
    const trans = String(it.trans || '').trim();
    if (mode === 'word') return word;
    if (mode === 'tsv') {
      return [clean(word), clean(reading), clean(def), clean(line), clean(trans)].join('\t');
    }
    if (mode === 'cloze') {
      const p = splitClozeParts(line || word, word);
      return `${p.prefix}[${p.body}]${p.suffix}${def ? ' — ' + def : ''}`;
    }
    const head = word + (reading ? ` [${reading}]` : '');
    return [head, def, line ? `Example: ${line}` : '', trans ? `Translation: ${trans}` : ''].filter(Boolean).join('\n');
  };

  const stampExported = (items) => {
    const now = Date.now();
    for (const it of items || []) it.exportedAt = now;
  };

  const exportAnkiTsv = (items, mode = 'basic') => {
    if (!items || !items.length) return false;
    if (mode === 'cloze') {
      const hdr = '#notetype:Cloze\n#columns:Text\tBack Extra\tTags\n';
      const rows = items.map((it) => {
        const clozeLine = makeAnkiCloze(it.line || it.word, it.word || '');
        const eqTxt = formatEqSummary(it.eq);
        const backExtra = [
          it.reading ? `[${it.reading}]` : '',
          it.trans || '',
          it.def ? `(${it.def})` : '',
          it.lit ? `Literal: ${it.lit}` : '',
          eqTxt ? `Equivalents: ${eqTxt}` : '',
          it.videoId ? clipUrlFor(it.videoId, it.t) : '',
        ].filter(Boolean).join(' · ');
        const tag = ['subtitle-study', it.itemType || 'WORD', it.layer || '', it.lang || 'en'].filter(Boolean).join(' ');
        return [clean(clozeLine), clean(backExtra), clean(tag)].join('\t');
      });
      stampExported(items);
      dl('subtitle-study-anki-cloze.tsv', hdr + rows.join('\n') + '\n', 'text/tab-separated-values;charset=utf-8');
      return true;
    }

    const hdr = '#notetype:Basic\n#columns:Front\tBack\tContext\tSource\tTags\n';
    const rows = items.map((it) => {
      const front = (it.word || it.line || '') + (it.reading ? ` [${it.reading}]` : '');
      const eqTxt = formatEqSummary(it.eq);
      const back = [
        it.def,
        it.lit ? `(Literal: ${it.lit})` : '',
        eqTxt ? `[${eqTxt}]` : '',
        it.trans,
      ].filter(Boolean).join(' — ');
      const ctx = it.line && it.word ? it.line : '';
      const src = it.videoId ? `${it.title || it.videoId} (${Math.floor(it.t || 0)}s) ${clipUrlFor(it.videoId, it.t)}` : '';
      const tags = ['subtitle-study', it.itemType || 'WORD', it.layer || '', it.lang || 'en'].filter(Boolean).join(' ');
      return [clean(front), clean(back), clean(ctx), clean(src), clean(tags)].join('\t');
    });
    stampExported(items);
    dl('subtitle-study-anki.tsv', hdr + rows.join('\n') + '\n', 'text/tab-separated-values;charset=utf-8');
    return true;
  };

  const exportJson = (items, words, researchLog = null) => {
    const payload = {
      schema: 'subtitle-study-export-v3',
      exported: new Date().toISOString(),
      items,
      words,
      ...(researchLog ? { researchLog } : {}),
    };
    stampExported(items);
    dl('subtitle-study-export.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportCsv = (items) => {
    if (!items || !items.length) return false;
    const cols = ['itemType', 'layer', 'word', 'reading', 'lemma', 'lang', 'def', 'lit', 'equivalents', 'line', 'trans', 'provenance', 't', 'endT', 'videoId', 'channelId', 'title', 'reps', 'difficulty', 'stabilityDays', 'at'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const body = '\uFEFF' + cols.join(',') + '\n' + items.map((it) => {
      const row = Object.assign({}, it, { equivalents: formatEqSummary(it.eq) });
      return cols.map((c) => q(row[c])).join(',');
    }).join('\n');
    stampExported(items);
    dl('subtitle-study-saved.csv', body, 'text/csv;charset=utf-8');
    return true;
  };

  const exportResearchCsv = (items = [], researchLog = []) => {
    const cols = [
      'rowType', 'atIso', 'profile', 'videoId', 'itemOrPattern', 'itemType',
      'maxBand', 'isDeceptive', 'soundCue', 'reps', 'lapses', 'difficulty',
      'stabilityDays', 'masteryM', 'masteryF', 'masteryP',
      'eventType', 'ok', 'firstAttempt', 'latencyMs', 'prosodyMatch',
    ];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [];
    for (const it of items || []) {
      const m = it.mastery || {};
      rows.push([
        'ITEM', it.at ? new Date(it.at).toISOString() : '', '', it.videoId || '',
        it.lemma || it.word || '', it.itemType || 'WORD', it.maxBand || '',
        it.deceptive ? 1 : 0, it.soundCue || '', it.reps || 0, it.lapses || 0,
        it.difficulty || '', it.stabilityDays || '', m.meaning || 0, m.form || 0,
        m.prosody || 0, '', '', '', '', '',
      ]);
    }
    for (const ev of researchLog || []) {
      const p = ev.payload || {};
      rows.push([
        'EVENT', ev.at ? new Date(ev.at).toISOString() : '', ev.profile || '', p.videoId || '',
        p.pattern || p.word || '', p.mode || '', '', '', '', '', '', '', '', '', '', '',
        ev.type || '', p.ok == null ? '' : (p.ok ? 1 : 0),
        p.firstAttempt == null ? '' : (p.firstAttempt ? 1 : 0),
        p.latencyMs == null ? '' : p.latencyMs, p.prosodyMatch == null ? '' : p.prosodyMatch,
      ]);
    }
    const body = '\uFEFF' + cols.join(',') + '\n' + rows.map((r) => r.map(q).join(',')).join('\n');
    dl('subtitle-study-research-lme.csv', body, 'text/csv;charset=utf-8');
  };

  const escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const exportTeacherLessonHtml = (info = {}, analysis = {}, drills = {}, pieMap = {}) => {
    const d = (analysis && analysis.diff) || {};
    const fes = (analysis && analysis.targetFEs) || [];
    const bp = d.bandPct || {};
    const vidKey = (info.site ? `${info.site}:${info.videoId}` : info.videoId) || '';
    const title = info.title || info.videoId || 'Subtitle Study Lesson';
    const cloze = (drills && drills.cloze) || [];
    const recall = (drills && drills.recall) || [];

    const bandBars = [
      ['1k', bp.b1 || 0, '#2dd4bf'], ['2k', bp.b2 || 0, '#38bdf8'],
      ['3k', bp.b3 || 0, '#818cf8'], ['4k', bp.b4 || 0, '#fbbf24'],
      ['5k', bp.b5 || 0, '#fb923c'], ['>5k / Slang', bp.other || 0, '#f87171'],
    ].map(([lbl, pct, col]) =>
      `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span>${lbl}</span><b>${pct}%</b></div>` +
      `<div style="background:#1e293b;border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${col}"></div></div></div>`
    ).join('');

    const feRows = fes.map((fe) => {
      const occ = (fe.occurrences && fe.occurrences[0]) || {};
      const pie = (pieMap && pieMap[fe.pattern]) || {};
      const badge = pie.usage === 'literal'
        ? '<span class="tag lit">Literal Here</span>'
        : (fe.deceptive || pie.deceptive_trap)
          ? '<span class="tag trap">Deceptive Trap</span>'
          : `<span class="tag idm">${escHtml(fe.native || fe.layer || 'Idiomatic')}</span>`;
      const ts = occ.t != null && vidKey ? clipUrlFor(vidKey, occ.t) : '';
      const explain = pie.explain || pie.idiomatic_gloss || fe.gloss || fe.glossZh || fe.defKo || fe.defJa || (fe.deceptive ? 'Easy words hiding a non-literal meaning.' : 'Multi-word formulaic expression.');
      const litNote = pie.literal_gloss || fe.lit || '';
      const eqSummary = formatEqSummary(fe.eq);
      return `<tr>
        <td><b>${escHtml(fe.display)}</b>${fe.reading ? ` <small>[${escHtml(fe.reading)}]</small>` : ''}<br><small>${escHtml(fe.type)}${fe.soundCue ? ' · ' + escHtml(fe.soundCue) : ''}</small></td>
        <td>${badge}</td>
        <td>${escHtml(explain)}${litNote ? `<br><small>Literal: ${escHtml(litNote)}</small>` : ''}${eqSummary ? `<br><small>Equivalents: ${escHtml(eqSummary)}</small>` : ''}</td>
        <td>${occ.line ? `"${escHtml(occ.line)}"` : ''}${ts ? `<br><a href="${escHtml(ts)}" target="_blank">▶ Watch clip (${Math.floor(occ.t)}s)</a>` : ''}</td>
      </tr>`;
    }).join('');

    const clozeHtml = cloze.map((q, i) => `
      <div class="qcard" data-ans="${escHtml(q.answer)}">
        <p><b>Q${i + 1}.</b> ${escHtml(q.prompt)}</p>
        ${q.trans ? `<p class="muted">${escHtml(q.trans)}</p>` : ''}
        <div class="opts">${(q.options || []).map((o) =>
          `<button type="button" onclick="chkOpt(this,'${escHtml(o).replace(/'/g, '&#39;')}','${escHtml(q.answer).replace(/'/g, '&#39;')}')">${escHtml(o)}</button>`
        ).join('')}</div>
        <div class="ans-key" hidden>Answer: <b>${escHtml(q.answer)}</b></div>
      </div>`).join('');

    const recallHtml = recall.map((q, i) => `
      <div class="qcard">
        <p><b>R${i + 1}.</b> ${escHtml(q.prompt)}</p>
        ${q.trans ? `<p class="muted">${escHtml(q.trans)}</p>` : ''}
        <input type="text" placeholder="Type: ${escHtml(q.cuePrefix)} ..." onkeydown="if(event.key==='Enter')chkInp(this,'${escHtml(q.expectedTail).replace(/'/g, '&#39;')}','${escHtml(q.fullSurface).replace(/'/g, '&#39;')}')">
        <button type="button" onclick="chkInp(this.previousElementSibling,'${escHtml(q.expectedTail).replace(/'/g, '&#39;')}','${escHtml(q.fullSurface).replace(/'/g, '&#39;')}')">Check</button>
        <span class="fb"></span>
        <div class="ans-key" hidden>Expected: <b>${escHtml(q.fullSurface)}</b></div>
      </div>`).join('');

    const topLink = vidKey ? clipUrlFor(vidKey, 0) : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(title)} — Lesson & Difficulty Audit</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;max-width:960px;margin:28px auto;padding:0 18px;line-height:1.5}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin:16px 0}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:22px 0 10px;color:#7dd3fc} h3{margin:0 0 10px;font-size:14px;color:#94a3b8;text-transform:uppercase}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid #334155;text-align:left;vertical-align:top;font-size:13.5px}
th{background:#0b1322;color:#94a3b8;font-size:12px}
.tag{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}
.tag.idm{background:#115e59;color:#99f6e4} .tag.trap{background:#78350f;color:#fde68a} .tag.lit{background:#334155;color:#cbd5e1}
.qcard{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px;margin:10px 0}
.opts{display:flex;flex-wrap:wrap;gap:8px} button{background:#334155;color:#f8fafc;border:1px solid #475569;padding:6px 12px;border-radius:8px;cursor:pointer}
button.ok{background:#0d9488;border-color:#2dd4bf} button.bad{background:#991b1b;border-color:#f87171}
input{background:#0f172a;color:#f8fafc;border:1px solid #475569;padding:6px 10px;border-radius:8px;margin-right:6px}
.muted{color:#94a3b8;font-size:12.5px} a{color:#38bdf8} .ans-key{margin-top:6px;color:#5eead4;font-size:12.5px}
@media print{body{background:#fff;color:#000}.card,table,.qcard{background:#fff;border-color:#ccc}th{background:#eee;color:#000}}
</style></head><body>
<h1>${escHtml(title)}</h1>
<div class="muted">${escHtml(info.author || '')}${topLink ? ` · <a href="${escHtml(topLink)}" target="_blank">${escHtml(topLink)}</a>` : ''}</div>
<div class="grid">
  <div class="card"><h3>i+1 Comprehension & Speech Audit</h3>
    <p><b>Coverage:</b> ${d.baseCovPct != null ? d.baseCovPct : d.knownPct || 0}% → <b>${d.iPlusOnePct || d.knownPct || 0}%</b> after ${fes.length} phrases (${d.totalTokens || 0} words)</p>
    <p><b>Speech Rate:</b> Median <b>${d.wpm || 0} WPM</b> (Band ${d.rate || '-'}/5) · Peak p90 <b>${d.p90Wpm || d.wpm || 0} WPM</b> (${d.fastLinesPct || 0}% fast lines &ge;190 WPM)</p>
    <p><b>Difficulty Band:</b> Vocab ${d.vocab || '-'}/5 · Overall <b>${escHtml(d.levelLabel || 'Medium')}</b></p>
  </div>
  <div class="card"><h3>Nation Lexical Profile (OpenSubtitles Bins)</h3>${bandBars}</div>
</div>
<h2>1. Target Formulaic Expressions (${fes.length}) <button type="button" style="float:right;font-size:12px" onclick="document.querySelectorAll('.ans-key').forEach(e=>e.hidden=!e.hidden)">Toggle Teacher Answer Key</button></h2>
<table><thead><tr><th>Expression</th><th>Usage</th><th>Explainable Meaning &amp; Literal Trap</th><th>Scene Example</th></tr></thead><tbody>${feRows || '<tr><td colspan="4">No target expressions detected.</td></tr>'}</tbody></table>
<h2>2. Classroom / Self-Study Cloze Quiz</h2>
${clozeHtml || '<p class="muted">No cloze items generated.</p>'}
<h2>3. Cued Form-Recall Drill</h2>
${recallHtml || '<p class="muted">No recall items generated.</p>'}
<script>
function chkOpt(b,val,ans){const p=b.parentElement;p.querySelectorAll('button').forEach(x=>x.disabled=true);b.className=(val.toLowerCase()===ans.toLowerCase())?'ok':'bad';if(val.toLowerCase()!==ans.toLowerCase())p.nextElementSibling.hidden=false;}
function chkInp(inp,tail,full){const v=(inp.value||'').trim().toLowerCase();const ok=v===tail.toLowerCase()||v===full.toLowerCase();inp.nextElementSibling.nextElementSibling.textContent=ok?' ✓ Exact':' ✗ Expected: '+tail;}
</script></body></html>`;

    const safe = (info.videoId || 'lesson').replace(/[^a-zA-Z0-9_-]/g, '');
    dl(`teacher-lesson-${safe}.html`, html, 'text/html;charset=utf-8');
    return true;
  };

  const exportSrt = (lines, transForFn, mode = 'both', title = 'subtitles', subOffset = 0) => {
    if (!lines || !lines.length) return false;
    const blocks = lines.map((ln, idx) => {
      const next = lines[idx + 1];
      let end = ln.e != null ? ln.e : ln.s + (ln.d || 3);
      if (next && next.s > ln.s) end = Math.min(end, next.s);
      const tr = transForFn ? transForFn(ln) : '';
      const body = mode === 'orig' ? ln.t : mode === 'tr' ? (tr || ln.t) : tr ? `${ln.t}\n${tr}` : ln.t;
      const offset = typeof subOffset === 'function' ? subOffset(ln.s) : subOffset;
      const nextOffset = typeof subOffset === 'function' && next ? subOffset(next.s) : offset;
      const mediaEnd = next ? Math.min(end + offset, next.s + nextOffset) : end + offset;
      return `${idx + 1}\n${fmtSrtTime(ln.s + offset)} --> ${fmtSrtTime(mediaEnd)}\n${body}`;
    });
    const safe = (title || 'subtitles').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    dl(`${safe}.${mode}.srt`, blocks.join('\n\n') + '\n', 'text/plain;charset=utf-8');
    return true;
  };

  const exportApkgViaCompanion = (items) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ op: 'companion', path: '/anki_apkg', body: { items } }, (res) => {
      if (!res || !res.ok || !res.b64) { resolve(false); return; }
      const bin = atob(res.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      stampExported(items);
      dl('subtitle-study-media.apkg', bytes, 'application/octet-stream');
      resolve(true);
    });
  });

  const acCall = (ankiUrl, action, params = {}) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ op: 'ankiConnect', ankiUrl, action, params }, (r) => resolve(r || { ok: false }));
  });

  const pushToAnkiConnect = async (items, opts = {}) => {
    if (!items || !items.length) return { ok: false, error: 'Nothing to push' };
    const ankiUrl = opts.ankiUrl || 'http://127.0.0.1:8765';
    const deck = opts.deck || 'Subtitle Study';
    const model = 'Subtitle Study';

    const ver = await acCall(ankiUrl, 'version');
    if (!ver.ok) return { ok: false, error: ver.error || 'AnkiConnect unavailable on ' + ankiUrl };

    await acCall(ankiUrl, 'createDeck', { deck });
    const models = await acCall(ankiUrl, 'modelNames');
    if (models.ok && Array.isArray(models.result) && !models.result.includes(model)) {
      await acCall(ankiUrl, 'createModel', {
        modelName: model,
        inOrderFields: ['Word', 'Sentence', 'Meaning', 'Translation', 'Screenshot', 'Audio', 'Source'],
        css: '.card { font-family: sans-serif; text-align: center; color: #222; background: #fff; } img { max-width: 340px; border-radius: 6px; margin-top: 8px; }',
        cardTemplates: [{
          Name: 'Card 1',
          Front: '<div style="font-size:22px"><b>{{Word}}</b></div><div style="margin-top:8px">{{Sentence}}</div>',
          Back: '{{FrontSide}}<hr id=answer><div>{{Meaning}}</div><div style="opacity:.78;margin-top:6px">{{Translation}}</div><div>{{Audio}}</div><div>{{Screenshot}}</div><div style="font-size:12px;opacity:.6;margin-top:8px">{{Source}}</div>',
        }],
      });
    }

    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const it of items) {
      let screenshotHtml = '';
      if (it.thumbDataUrl && String(it.thumbDataUrl).startsWith('data:image/')) {
        const b64 = String(it.thumbDataUrl).split(',')[1] || '';
        const fname = 'ss_study_' + String(it.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '') + '.webp';
        if (b64) {
          const st = await acCall(ankiUrl, 'storeMediaFile', { filename: fname, data: b64 });
          if (st.ok) screenshotHtml = `<img src="${fname}">`;
        }
      }
      let soundTag = '';
      let clipObj = it.audioClip || null;
      if (!clipObj && opts.captureAudio && typeof document !== 'undefined' && globalThis.SS_AUDIO_CLIP) {
        const vEl = opts.videoEl || document.querySelector('video');
        if (vEl) clipObj = await globalThis.SS_AUDIO_CLIP.captureVideoAudioSlice(vEl, opts.audioDurationMs || 3200);
      }
      if (clipObj && clipObj.dataBase64) {
        const afname = String(clipObj.filename || ('ss_clip_' + Date.now() + '.webm')).replace(/[^a-zA-Z0-9._-]/g, '_');
        const ast = await acCall(ankiUrl, 'storeMediaFile', { filename: afname, data: clipObj.dataBase64 });
        if (ast.ok) soundTag = `[sound:${afname}]`;
      }
      let wordAudioTag = '';
      if (it.wordAudioUrl && /^https?:\/\//i.test(String(it.wordAudioUrl))) {
        const wfname = 'ss_word_' + String(it.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '') + '.mp3';
        const wst = await acCall(ankiUrl, 'storeMediaFile', { filename: wfname, url: String(it.wordAudioUrl) });
        if (wst && wst.ok) wordAudioTag = `[sound:${wfname}]`;
      }
      const eqTxt = formatEqSummary(it.eq);
      const wordField = (it.word || '') + (it.reading ? ` [${it.reading}]` : '');
      const meaningParts = [
        it.def || '',
        it.lit ? `Literal: ${it.lit}` : '',
        eqTxt ? `Equivalents: ${eqTxt}` : '',
      ].filter(Boolean).join('<br>');
      const src = it.videoId ? `${it.title || it.videoId} (${Math.floor(it.t || 0)}s) ${clipUrlFor(it.videoId, it.t)}` : '';
      const mFieldsRes = await acCall(ankiUrl, 'modelFieldNames', { modelName: model });
      const mFields = (mFieldsRes.ok && Array.isArray(mFieldsRes.result)) ? mFieldsRes.result : [];
      const hasAudioField = mFields.includes('Audio');
      const hasWordAudioField = mFields.includes('WordAudio');
      const clozeParts = splitClozeParts(it.line || it.word || '', it.surface || it.word || '');
      const combinedAudio = [wordAudioTag, soundTag].filter(Boolean).join(' ');
      const sentenceVal = String(it.line || '') + (!hasAudioField && soundTag ? ' ' + soundTag : '');
      const fields = {
        Word: String(wordField) + (!hasWordAudioField && !hasAudioField && wordAudioTag ? ' ' + wordAudioTag : ''),
        Sentence: sentenceVal,
        Meaning: String(meaningParts),
        Translation: String(it.trans || ''),
        ...(screenshotHtml ? { Screenshot: screenshotHtml } : { Screenshot: '' }),
        ...(hasAudioField ? { Audio: hasWordAudioField ? soundTag : combinedAudio } : {}),
        ...(hasWordAudioField && wordAudioTag ? { WordAudio: wordAudioTag } : {}),
        ...(mFields.includes('ClozePrefix') ? { ClozePrefix: clozeParts.prefix } : {}),
        ...(mFields.includes('ClozeBody') ? { ClozeBody: clozeParts.body } : {}),
        ...(mFields.includes('ClozeSuffix') ? { ClozeSuffix: clozeParts.suffix } : {}),
        Source: src,
      };
      if (opts.preflightDuplicates !== false && !it.ankiNoteId) {
        const check = await acCall(ankiUrl, 'canAddNotes', {
          notes: [{ deckName: deck, modelName: model, fields, options: { allowDuplicate: false, duplicateScope: 'deck' } }],
        });
        if (check && check.ok && Array.isArray(check.result) && check.result[0] === false) {
          skipped++;
          continue;
        }
      }

      if (it.ankiNoteId) {
        const up = await acCall(ankiUrl, 'updateNoteFields', { note: { id: it.ankiNoteId, fields } });
        if (up.ok) {
          it.exportedAt = Date.now();
          updated++;
          continue;
        }
      }

      const res = await acCall(ankiUrl, 'addNote', {
        note: {
          deckName: deck,
          modelName: model,
          fields,
          options: { allowDuplicate: false, duplicateScope: 'deck' },
          tags: ['subtitle-study', it.itemType || 'WORD', it.layer || '', it.lang || 'en'].filter(Boolean),
        },
      });
      if (res.ok && res.result) {
        it.ankiNoteId = res.result;
        it.exportedAt = Date.now();
        added++;
      } else {
        skipped++;
      }
    }
    return { ok: true, added, updated, skipped };
  };

  return {
    clipUrlFor,
    formatEqSummary,
    makeAnkiCloze,
    splitClozeParts,
    renderAnkiMarkers,
    formatQuickCopy,
    exportAnkiTsv,
    exportJson,
    exportCsv,
    exportResearchCsv,
    exportTeacherLessonHtml,
    exportSrt,
    exportApkgViaCompanion,
    pushToAnkiConnect,
  };
})();
