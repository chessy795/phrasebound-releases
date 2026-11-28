'use strict';
// Most-heard idioms per language, ranked by YouTube rate (ext/data/spoken_<lang>.json).
const LANGS = [['en','English'],['zh','Mandarin'],['yue','Cantonese'],['ja','Japanese'],['ko','Korean'],
  ['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ru','Russian'],['tl','Filipino']];
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmt = (x) => (x >= 10 ? String(Math.round(x)) : x >= 1 ? x.toFixed(1) : x.toFixed(2));
let allRows = [], rows = [], shown = 0, gloss = null, short = [], playSet = new Set();
let quoteData = null, quoteSummary = null, curLang = 'en';

function renderQuoteCompare() {
  const box = $('quoteCompare');
  if (!box) return;
  box.textContent = '';
  if (!$('quoteOnly')?.checked || !quoteSummary?.languages?.length) { box.hidden = true; return; }
  box.hidden = false;
  const tbl = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const col of ['Language', 'Lines', 'In Speech', 'Top Famous Line']) hr.append(el('th', '', col));
  thead.append(hr);
  const tbody = el('tbody');
  for (const r of quoteSummary.languages) {
    const tr = el('tr');
    tr.append(
      el('td', '', r.name || r.lang),
      el('td', '', String(r.shipped || 0)),
      el('td', '', String(r.speech_hits || 0)),
      el('td', '', r.top_line ? `${r.top_line}${r.top_author ? ` (${r.top_author})` : ''}` : '—'));
    tbody.append(tr);
  }
  tbl.append(thead, tbody);
  box.append(tbl);
}

function applyFilter() {
  const onlyQuote = Boolean($('quoteOnly') && $('quoteOnly').checked);
  const onlyPlay = !onlyQuote && Boolean($('playOnly') && $('playOnly').checked);
  if ($('playOnly')) $('playOnly').disabled = onlyQuote;
  if ($('quoteCompare')) renderQuoteCompare();
  const stat = $('stat');
  if (onlyQuote && quoteData) {
    const items = quoteData.items || [];
    const speechCnt = items.filter((q) => (q[6] || 0) > 0).length;
    stat.textContent = '';
    stat.append(el('b', '', String(items.length)), ' famous lines curated for ', el('b', '', curLang), ` (${speechCnt} attested in YouTube/film speech).`);
    rows = items;
    $('list').textContent = ''; shown = 0; more();
    return;
  }
  const total = allRows.reduce((s, [, r]) => s + r[0], 0);
  let acc = 0, n = 0;
  for (const [, r] of allRows) { acc += r[0]; n++; if (acc >= 0.8 * total) break; }
  stat.textContent = '';
  if (allRows.length) stat.append('The top ', el('b', '', String(n)), ` idioms (${Math.round(100 * n / allRows.length)}% of the ${allRows.length} heard on YouTube) make up `, el('b', '', '80%'), ' of all idiom use.');
  rows = onlyPlay ? allRows.filter(([exp]) => playSet.has(exp.toLowerCase())) : allRows;
  $('list').textContent = ''; shown = 0; more();
}

async function load(lang) {
  curLang = lang;
  const d = await fetch(chrome.runtime.getURL(`data/spoken_${lang}.json`)).then((r) => r.json());
  short = (d.meta && d.meta.short) || ['YouTube', 'film', 'TED'];
  if ($('unit')) $('unit').textContent = d.meta && d.meta.unit === 'characters' ? 'characters' : 'words';
  gloss = null;
  if (lang === 'en') { try { gloss = (await fetch(chrome.runtime.getURL('data/fe_en_gloss.json')).then((r) => r.json())).items; } catch (_) {} }
  playSet = new Set();
  try {
    const fe = await fetch(chrome.runtime.getURL(`data/fe_${lang}.json`)).then((r) => r.json());
    for (const row of (fe.items || [])) {
      const ex = Array.isArray(row) ? row[row.length - 1] : null;
      if (ex && typeof ex === 'object' && ex.play && row[0]) playSet.add(String(row[0]).toLowerCase());
    }
  } catch (_) {}
  quoteData = null;
  try { quoteData = await fetch(chrome.runtime.getURL(`data/quotes_${lang}.json`)).then((r) => r.json()); } catch (_) {}
  if (!quoteSummary) { try { quoteSummary = await fetch(chrome.runtime.getURL('data/quotes_summary.json')).then((r) => r.json()); } catch (_) {} }
  allRows = Object.entries(d.r).filter(([, r]) => r[0] > 0).sort((a, b) => b[1][0] - a[1][0] || (b[1][1] || 0) - (a[1][1] || 0));
  const playHits = allRows.reduce((c, [exp]) => c + (playSet.has(exp.toLowerCase()) ? 1 : 0), 0);
  if ($('playOnly')) $('playOnly').checked = false;
  if ($('playWrap')) $('playWrap').hidden = playHits === 0;
  if ($('playLbl')) $('playLbl').textContent = `Playful only (${playHits})`;
  const qCount = quoteData?.items?.length || 0;
  if ($('quoteWrap')) $('quoteWrap').hidden = qCount === 0;
  if ($('quoteLbl')) $('quoteLbl').textContent = `Famous lines (${qCount})`;
  applyFilter();
}

function more() {
  const onlyQuote = Boolean($('quoteOnly') && $('quoteOnly').checked);
  if (onlyQuote) {
    const top = rows.length ? Math.max(1, rows[0][5] || 1) : 1;
    for (const q of rows.slice(shown, shown + 100)) {
      const [line, kind, author, work, partner, score, speech] = q;
      const li = el('li'); const row = el('div', 'ti-row');
      row.append(el('span', 'ti-exp', line), el('span', 'ti-quote', kind || 'quote'));
      row.append(el('span', 'ti-num', speech > 0 ? `${speech} speech hits · score ${fmt(score)}` : `canon · score ${fmt(score)}`));
      const cite = [author, work].filter(Boolean).join(' · ') + (partner ? ` · Paired: ${partner}` : '');
      if (cite) row.append(el('span', 'ti-gl', cite));
      const bar = el('div', 'ti-bar'); bar.style.width = Math.max(2, Math.min(100, 100 * (score || 0) / top)) + '%';
      li.append(row, bar); $('list').append(li);
    }
    shown += 100;
    $('more').hidden = shown >= rows.length;
    return;
  }
  const top = rows.length ? rows[0][1][0] : 1;
  for (const [exp, r] of rows.slice(shown, shown + 100)) {
    const li = el('li'); const row = el('div', 'ti-row');
    const expEl = el('span', 'ti-exp', exp);
    row.append(expEl);
    if (playSet.has(exp.toLowerCase())) row.append(el('span', 'ti-play', 'playful'));
    row.append(el('span', 'ti-num', r.map((x, i) => `${short[i]} ${fmt(x)}`).join(' · ')));
    const g = gloss && gloss[exp.toLowerCase()];
    if (g && (g[0] || g[1])) row.append(el('span', 'ti-gl', g[0] || g[1]));
    const bar = el('div', 'ti-bar'); bar.style.width = Math.max(1, 100 * r[0] / top) + '%';
    li.append(row, bar); $('list').append(li);
  }
  shown += 100;
  $('more').hidden = shown >= rows.length;
}

(async () => {
  const sel = $('lang');
  for (const [c, n] of LANGS) { const o = el('option', '', n); o.value = c; sel.append(o); }
  let lang = new URLSearchParams(location.search).get('lang');
  if (!lang) { try { const s = await chrome.storage.local.get('ss_set'); lang = s.ss_set && String(s.ss_set.lang || '').toLowerCase().split('-')[0]; } catch (_) {} }
  if (!LANGS.some(([c]) => c === lang)) lang = 'en';
  sel.value = lang;
  sel.onchange = () => load(sel.value);
  if ($('playOnly')) $('playOnly').onchange = applyFilter;
  if ($('quoteOnly')) $('quoteOnly').onchange = applyFilter;
  if (new URLSearchParams(location.search).get('view') === 'quotes' && $('quoteOnly')) $('quoteOnly').checked = true;
  $('more').onclick = more;
  load(lang);
})();
