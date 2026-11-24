(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const grades = Array.from(document.querySelectorAll('[data-grade]'));
  const store = SS_STORE;
  const day = 86400000;
  let model;
  let card;
  let revealed = false;
  let busy = false;
  let timer;
  let revision = 0;

  function duration(ms) {
    if (ms < 3600000) return Math.max(1, Math.round(ms / 60000)) + ' min';
    if (ms < day) return Math.round(ms / 3600000) + ' h';
    return Math.round(ms / day) + ' d';
  }

  function render() {
    clearTimeout(timer);
    const now = Date.now();
    const { items, state, newLimit, retention } = model;
    const { scheduled, fresh, remainingNew } = store.reviewDeck(items, state.history, newLimit, now);
    const ready = [...scheduled, ...fresh];
    const current = ready.find((item) => item.id === card?.id && store.reviewTimestamp(item) === store.reviewTimestamp(card));
    if (!current) {
      card = ready[0];
      revealed = false;
    }
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    const rated = state.history.filter((entry) => entry.at >= midnight).length;
    $('review-counts').textContent = `${scheduled.length} due · ${fresh.length} new available · ${rated} ratings today`;
    $('review-word').textContent = card?.word || (items.length ? 'You’re caught up' : 'Your deck is empty');
    $('review-word').lang = card?.lang || 'en';
    $('review-line').textContent = card?.line && card.line !== card.word ? card.line : '';
    $('review-line').hidden = !$('review-line').textContent;
    $('review-line').lang = card?.lang || 'en';
    $('review-reveal').hidden = !card || revealed;
    $('review-answer').hidden = !card || !revealed;
    $('review-undo').hidden = !items.some((item) => item.id === state.undo?.id);
    $('review-undo').disabled = busy;
    $('review-reading').textContent = card?.reading || '';
    $('review-meaning').textContent = card?.def || card?.trans || 'Answer missing on this card.';
    $('review-context').textContent = [card?.title, card?.trans !== card?.def ? card?.trans : ''].filter(Boolean).join(' · ');
    const source = card?.sourceUrl || card?.pageUrl || '';
    $('review-source').hidden = !/^https?:\/\//i.test(source);
    if (!$('review-source').hidden) $('review-source').href = source;
    if (card && revealed) {
      grades.forEach((button) => {
        const next = store.fsrsSchedule({ ...card }, button.dataset.grade, 'meaning', now, retention);
        button.querySelector('small').textContent = duration(next.nextReviewAt - now);
        button.disabled = busy;
      });
    }
    const nextDue = items.reduce((best, item) => item.reviewStage !== 'new' && item.nextReviewAt > now
      ? Math.min(best, item.nextReviewAt) : best, Infinity);
    if (!card) {
      $('review-message').textContent = !items.length
        ? 'Save a word or expression from a video, webpage, Reader, or the Japanese list below.'
        : [Number.isFinite(nextDue) ? 'Next review in ' + duration(nextDue - now) + '.' : '',
          remainingNew ? `${remainingNew} new cards waiting. You’ve reached your daily new-card limit.` : ''].filter(Boolean).join(' ');
    }
    timer = setTimeout(() => { if (!busy) render(); }, Math.min(60000, Math.max(250, nextDue - now)));
  }

  async function refresh() {
    const request = ++revision;
    const loaded = await store.loadReviews();
    if (request !== revision) return;
    model = loaded;
    for (const [id, value] of [['review-retention', Math.round(model.retention * 100)], ['review-limit', model.newLimit]]) {
      if (!$('review-settings').contains(document.activeElement)) $(id).value = value;
    }
    render();
  }

  function reportError(error) { $('review-message').textContent = error.message || 'Could not open your deck.'; }
  async function changeReview(message) {
    if (busy) return;
    busy = true;
    render();
    $('review-message').textContent = '';
    try {
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.ok) throw new Error('This card changed in another tab or is no longer due.');
      card = null;
      revealed = false;
    } catch (error) { reportError(error); }
    finally { busy = false; await refresh().catch(reportError); }
    if (!revealed && card) $('review-reveal').focus();
  }

  function reveal() {
    if (!card || busy || revealed) return;
    revealed = true;
    render();
    grades[0].focus();
  }
  $('review-reveal').onclick = reveal;
  grades.forEach((button) => {
    button.onclick = () => {
      if (revealed && card) changeReview({ op: 'reviewStudyItem', id: card.id,
        rating: button.dataset.grade, timestamp: store.reviewTimestamp(card) });
    };
  });
  $('review-undo').onclick = () => {
    if (model?.state.undo) changeReview({ op: 'undoStudyReview', at: model.state.undo.at });
  };
  $('review-settings').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await chrome.storage.local.set({ ss_reviewSettings: { retention: Number($('review-retention').value) / 100,
        newLimit: Number($('review-limit').value) } });
      await refresh();
    } catch (error) { reportError(error); }
  };
  document.addEventListener('keydown', (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, select, textarea, summary, [contenteditable]')) return;
    if (event.code === 'Space' && !revealed && card && (!event.target.closest('button, a') || event.target === $('review-reveal'))) {
      event.preventDefault();
      reveal();
    } else if (revealed && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      grades[Number(event.key) - 1].click();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!busy && area === 'local' && (changes.ss_items || changes.ss_review || changes.ss_reviewSettings)) refresh().catch(reportError);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) refresh().catch(reportError); });

  let rows;
  let limit = 24;
  const normalize = (value) => String(value || '').normalize('NFKC').trim().toLowerCase();
  const registers = { polite: 'polite', colloquial: 'colloquial', stiff: 'formal' };
  function renderPatterns() {
    const query = normalize($('pattern-query').value);
    const hits = rows.filter((row) => query ? row.search.includes(query) : row.highlighted);
    if (query) hits.sort((a, b) => Number(normalize(b.word) === query) - Number(normalize(a.word) === query));
    $('pattern-count').textContent = query ? `${hits.length.toLocaleString()} matches` : 'Common expressions and patterns';
    $('pattern-more').hidden = hits.length <= limit;
    $('pattern-results').replaceChildren(...hits.slice(0, limit).map((row) => {
      const li = document.createElement('li');
      const text = document.createElement('div');
      const head = document.createElement('strong');
      head.lang = 'ja';
      head.textContent = row.word;
      const info = document.createElement('div');
      info.textContent = [row.reading !== row.word ? row.reading : '', row.gloss, row.register].filter(Boolean).join(' · ');
      text.append(head, info);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Add card';
      button.onclick = async () => {
        button.disabled = true;
        try {
          const result = await chrome.runtime.sendMessage({ op: 'saveWebItem', item: {
            word: row.word, lang: 'ja', reading: row.reading, def: row.gloss,
            line: row.example || '', studyKey: row.key, title: row.source,
          } });
          if (!result?.ok) throw new Error();
          button.textContent = result.duplicate ? 'Already saved' : 'Saved';
        } catch (_) { button.textContent = 'Retry'; button.disabled = false; }
      };
      li.append(text, button);
      return li;
    }));
  }
  $('patterns').addEventListener('toggle', async () => {
    if (!$('patterns').open || rows) return;
    $('pattern-count').textContent = 'Loading Japanese patterns…';
    try {
      const response = await fetch('data/ja_patterns_tsutsuji.json');
      if (!response.ok) throw new Error();
      const pack = await response.json();
      rows = pack.items.map(([word, key, reading, group, style, label]) => {
        const note = pack.glosses[group];
        const gloss = note?.[0] || label;
        return { word, key: 'tsutsuji:' + key, reading, gloss, register: registers[style] || '',
          example: normalize(note?.[1]).includes(normalize(word)) ? note[1] : '',
          highlighted: Boolean(note && note[2] === word), source: 'Tsutsuji',
          search: normalize([word, reading, gloss].join(' ')) };
      });
      rows.unshift(...pack.expressions.map(([word, , , reading, gloss, , keys, extra]) => ({
        word, key: 'expression:' + word, reading, gloss, register: extra.register, example: extra.example,
        highlighted: true, source: 'Japanese expressions', search: normalize([word, reading, gloss, ...keys].join(' ')),
      })));
      renderPatterns();
    } catch (_) { $('pattern-count').textContent = 'Could not load the Japanese list. Close and reopen this section to retry.'; }
  });
  $('pattern-query').oninput = () => { limit = 24; if (rows) renderPatterns(); };
  $('pattern-more').onclick = () => { limit += 24; renderPatterns(); };
  if (location.hash === '#patterns') $('patterns').open = true;
  refresh().catch(reportError);
})();
