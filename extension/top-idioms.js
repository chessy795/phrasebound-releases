'use strict';
// Most-heard idioms per language, ranked by YouTube rate (ext/data/spoken_<lang>.json).
const LANGS = [['en','English'],['zh','Mandarin'],['yue','Cantonese'],['ja','Japanese'],['ko','Korean'],
  ['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ru','Russian']];
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const fmt = (x) => (x >= 10 ? String(Math.round(x)) : x >= 1 ? x.toFixed(1) : x.toFixed(2));
let rows = [], shown = 0, gloss = null, short = [];

async function load(lang) {
  const d = await fetch(chrome.runtime.getURL(`data/spoken_${lang}.json`)).then((r) => r.json());
  short = (d.meta && d.meta.short) || ['YouTube', 'film', 'TED'];
  $('unit').textContent = d.meta && d.meta.unit === 'characters' ? 'characters' : 'words';
  gloss = null;
  if (lang === 'en') { try { gloss = (await fetch(chrome.runtime.getURL('data/fe_en_gloss.json')).then((r) => r.json())).items; } catch (_) {} }
  rows = Object.entries(d.r).filter(([, r]) => r[0] > 0).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]);
  const total = rows.reduce((s, [, r]) => s + r[0], 0);
  let acc = 0, n = 0;
  for (const [, r] of rows) { acc += r[0]; n++; if (acc >= 0.8 * total) break; }
  const stat = $('stat'); stat.textContent = '';
  stat.append('The top ', el('b', '', String(n)), ` idioms (${Math.round(100 * n / rows.length)}% of the ${rows.length} heard on YouTube) make up `, el('b', '', '80%'), ' of all idiom use.');
  $('list').textContent = ''; shown = 0; more();
}

function more() {
  const top = rows.length ? rows[0][1][0] : 1;
  for (const [exp, r] of rows.slice(shown, shown + 100)) {
    const li = el('li'); const row = el('div', 'ti-row');
    row.append(el('span', 'ti-exp', exp), el('span', 'ti-num', r.map((x, i) => `${short[i]} ${fmt(x)}`).join(' · ')));
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
  $('more').onclick = more;
  load(lang);
})();
