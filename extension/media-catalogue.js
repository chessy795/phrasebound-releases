(() => {
  const initialLanguages = ['ko', 'ja', 'yue'];
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().trim();
  const preferencesKey = 'ss_media_catalogue_preferences';
  const cacheKey = 'ss_media_catalogue';
  const maxBytes = 16 * 1024 * 1024;
  const isThumbnail = data => typeof data === 'string' && data.length <= 470_000 &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data);
  const artKey = /^[a-f0-9]{24}$/;
  const dateValue = item => Date.parse(item.published_at) || 0;
  const pageSize = 36;

  function profileFor(lang, state, now = Date.now()) {
    const words = new Map();
    for (const [key, mark] of Object.entries(state.words || {})) {
      const split = key.indexOf('|');
      if (split < 1 || SS_LANG.normCode(key.slice(0, split)) !== lang) continue;
      if (mark === 'known' || mark === 'learning') words.set(normalize(key.slice(split + 1)), mark);
    }
    const expressions = new Map();
    for (const item of state.items || []) {
      if (!item.lang || SS_LANG.normCode(item.lang) !== lang || item.itemType !== 'FE') continue;
      const aliases = [item.lemma, item.word, item.surface].map(normalize).filter(Boolean);
      if (!aliases.length) continue;
      const explicit = aliases.some(key => words.get(key) === 'known');
      const reviewed = item.reviewStage === 'review' && Number(item.lastRating) >= 3 && !SS_STORE.isRecallDue(item, 0.9, now);
      const mark = explicit ? 'known' : reviewed ? 'recalled' : 'saved';
      for (const key of aliases) {
        const current = expressions.get(key);
        if (current !== 'known' && (current !== 'recalled' || mark === 'known')) expressions.set(key, mark);
      }
    }
    return { words, expressions };
  }

  function matchProfile(item, profile) {
    const knownWords = [], learningWords = [];
    let covered = 0;
    for (const [term, count] of item.words) {
      const mark = profile.words.get(term);
      if (mark === 'known') covered += count;
      if (mark === 'known') knownWords.push([term, count]);
      if (mark === 'learning') learningWords.push([term, count]);
    }
    knownWords.sort((a, b) => b[1] - a[1]);
    learningWords.sort((a, b) => b[1] - a[1]);
    const knownExpressions = [], recalled = [], saved = [];
    for (const [key, label, count, start] of item.expressions) {
      const alias = normalize(label);
      const marks = [profile.expressions.get(key), profile.expressions.get(alias)];
      const exactMark = profile.words.get(key) || profile.words.get(alias);
      const evidence = { label, count, start };
      if (exactMark === 'known' || marks.includes('known')) knownExpressions.push(evidence);
      else if (marks.includes('recalled')) recalled.push(evidence);
      else if (exactMark === 'learning' || marks.includes('saved')) saved.push(evidence);
    }
    const score = 12 * Math.min(4, saved.length) + 5 * Math.min(4, recalled.length) +
      4 * Math.min(5, knownExpressions.length) + 2 * Math.min(5, learningWords.length) +
      30 * covered / (item.tokenCount + 40) + 0.5 * Math.min(12, knownWords.length);
    return { item, knownWords, learningWords, knownExpressions, recalled, saved, score };
  }

  function rank(items, profile, sort = 'recommended') {
    const popular = (a, b) => (b.item.views || 0) - (a.item.views || 0) || a.item.title.localeCompare(b.item.title);
    return items.map(item => matchProfile(item, profile)).sort((a, b) => {
      if (sort === 'views') return popular(a, b);
      if (sort === 'recent') return dateValue(b.item) - dateValue(a.item) || popular(a, b);
      if (sort === 'short') return (a.item.duration_s || Infinity) - (b.item.duration_s || Infinity) || popular(a, b);
      return b.score - a.score || popular(a, b);
    });
  }

  function matchesSearch(item, query) {
    return !query || normalize(item.title + ' ' + (item.publisher || '')).includes(query) ||
      item.words.some(([term]) => normalize(term) === query) ||
      item.expressions.some(([key, label]) => normalize(key) === query || normalize(label) === query);
  }

  function sourceUrl(raw) {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url : null;
    } catch (_) { return null; }
  }

  function validCatalogue(value) {
    if (value?.version !== 1 || !Array.isArray(value.items) || value.items.length > 5000) return false;
    const images = value.artwork ?? {};
    if (Array.isArray(images) || typeof images !== 'object' ||
        Object.entries(images).some(([key, data]) => !artKey.test(key) || !isThumbnail(data))) return false;
    const seen = new Set();
    return value.items.every(item => {
      if (!item || !SS_LANG.SUPPORTED_12.includes(item.lang) || !['video', 'podcast', 'audio'].includes(item.kind) ||
          typeof item.id !== 'string' || seen.has(item.lang + '|' + item.id) ||
          (item.publisher != null && typeof item.publisher !== 'string') || !sourceUrl(item.url) || typeof item.title !== 'string' || !item.title.trim() ||
          !Number.isFinite(item.tokenCount) || item.tokenCount < 1 || !Array.isArray(item.words) ||
          !Array.isArray(item.expressions) || item.captions !== 'publisher' ||
          (item.artwork_id != null && (!artKey.test(item.artwork_id) || !Object.hasOwn(images, item.artwork_id))) ||
          (item.thumbnail != null && !isThumbnail(item.thumbnail))) return false;
      seen.add(item.lang + '|' + item.id);
      return item.words.every(row => Array.isArray(row) && typeof row[0] === 'string' && Number.isFinite(row[1]) && row[1] > 0) &&
        item.expressions.every(row => Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string' &&
          Number.isFinite(row[2]) && row[2] > 0 && (row[3] === null || (Number.isFinite(row[3]) && row[3] >= 0)));
    });
  }

  globalThis.SS_MEDIA_CATALOGUE = { profileFor, rank, validCatalogue, matchesSearch };
  if (typeof document === 'undefined') return;

  const language = document.getElementById('media-language');
  const types = [...document.querySelectorAll('[data-kind]')];
  const publisher = document.getElementById('media-publisher');
  const sort = document.getElementById('media-sort');
  const search = document.getElementById('media-search');
  const results = document.getElementById('media-results');
  const resultTitle = document.getElementById('media-title');
  const status = document.getElementById('media-status');
  const reload = document.getElementById('media-refresh');
  const refreshStatus = document.getElementById('media-refresh-status');
  const importer = document.getElementById('media-import');
  let state = { words: {}, items: [], set: {} };
  let catalogue = null;
  let readingProfile = 0;
  let indexRevision = 0;
  let refreshing = false;
  let kind = 'all';
  let shown = pageSize;

  function element(tag, text = '', className = '') {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function link(text, href, className) {
    const node = element('a', text, className);
    node.href = href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  }

  function timecode(seconds) {
    const time = Math.floor(seconds);
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor(time / 60) % 60;
    const tail = String(time % 60).padStart(2, '0');
    return hours ? [hours, String(minutes).padStart(2, '0'), tail].join(':') : [minutes, tail].join(':');
  }

  function previewTerms(section, heading, labels) {
    if (!labels.length) return;
    const shown = labels.slice(0, 3);
    const detail = element('p', '', 'media-match');
    detail.append(element('strong', heading + ' '), shown.join(' · '));
    if (labels.length > shown.length) detail.append(' +' + (labels.length - shown.length));
    section.append(detail);
  }

  function cardFor(match) {
    const { item, knownWords, learningWords, knownExpressions, recalled, saved } = match;
    const url = sourceUrl(item.url);
    const card = element('article', '', 'media-card');
    const artwork = catalogue.artwork?.[item.artwork_id] || item.thumbnail;
    if (artwork) {
      const art = link('', url.href, 'media-art');
      art.setAttribute('aria-label', (item.kind === 'video' ? 'Watch ' : 'Open ') + item.title);
      const image = element('img');
      image.src = artwork;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      art.append(image);
      if (item.duration_s > 0) art.append(element('span', timecode(item.duration_s), 'media-duration'));
      card.append(art);
      card.classList.add('has-art');
      if (item.kind !== 'video') card.classList.add('is-audio');
    }
    const body = element('div', '', 'media-card-body');
    const title = element('h3');
    title.dir = 'auto';
    title.append(link(item.title, url.href, 'media-card-title'));
    body.append(title);
    const info = [item.publisher];
    if (dateValue(item)) info.push(new Date(item.published_at).toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' }));
    if (item.views > 0) info.push(new Intl.NumberFormat(undefined, { notation: 'compact' }).format(item.views) + ' views');
    info.push(item.kind === 'video' && item.evidence !== 'publisher_episode_transcript' ? 'Captions' : 'Transcript');
    body.append(element('p', info.filter(Boolean).join(' · '), 'media-meta'));

    const matches = element('div', '', 'media-matches');
    previewTerms(matches, 'Saved expressions', saved.map(item => item.label));
    previewTerms(matches, 'Recently recalled', recalled.map(item => item.label));
    previewTerms(matches, 'Known expressions', knownExpressions.map(item => item.label));
    previewTerms(matches, 'Known words', knownWords.map(([term]) => term));
    previewTerms(matches, 'Words you’re learning', learningWords.map(([term]) => term));
    if (matches.childElementCount) body.append(matches);
    const query = normalize(search.value);
    const occurrence = query && item.expressions.find(([key, label,, start]) =>
      Number.isFinite(start) && (normalize(key) === query || normalize(label) === query));
    const target = occurrence ? { label: occurrence[1], start: occurrence[3] } :
      [...saved, ...recalled, ...knownExpressions].find(term => Number.isFinite(term.start));
    if (item.kind === 'video' && target && url.hostname === 'www.youtube.com') {
      const jump = new URL(url);
      jump.searchParams.set('t', target.start + 's');
      const anchor = link('Study at ' + timecode(target.start), jump.href, 'media-jump');
      anchor.title = target.label;
      body.append(anchor);
    }
    card.append(body);
    return card;
  }

  function updatePublishers(available) {
    const selected = publisher.value;
    const names = [...new Set(available.map(item => item.publisher).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    publisher.replaceChildren(new Option('All publishers', ''), ...names.map(name => new Option(name, name)));
    publisher.value = names.includes(selected) ? selected : '';
  }

  function render() {
    results.replaceChildren();
    if (!catalogue) return;
    const lang = language.value;
    const native = SS_LANG.LANG_META[lang].label;
    const available = catalogue.items.filter(item => item.lang === lang);
    updatePublishers(available);
    const query = normalize(search.value);
    const visible = available.filter(item =>
      (kind === 'all' || (item.kind === 'video') === (kind === 'video')) &&
      (!publisher.value || item.publisher === publisher.value) &&
      matchesSearch(item, query));
    if (!visible.length) {
      resultTitle.textContent = native;
      status.textContent = '';
      results.append(element('p', available.length ? 'No items match these filters.' :
        'No verified publisher media for ' + native + ' yet.', 'media-empty'));
      return;
    }
    const items = rank(visible, profileFor(lang, state), sort.value);
    const personalized = sort.value === 'recommended' && items.some(row => row.score > 0);
    resultTitle.textContent = personalized ? 'Recommended for you' : 'Browse ' + native;
    status.textContent = visible.length + (visible.length === 1 ? ' item' : ' items');
    for (const item of items.slice(0, shown)) results.append(cardFor(item));
    if (visible.length > shown) {
      const more = element('button', 'Show more');
      more.type = 'button';
      more.addEventListener('click', () => {
        const first = shown;
        shown += pageSize;
        more.remove();
        for (const item of items.slice(first, shown)) results.append(cardFor(item));
        results.children[first]?.querySelector('.media-card-title')?.focus();
        if (visible.length > shown) results.append(more);
      });
      results.append(more);
    }
  }

  async function storeCatalogue(data) {
    if (!validCatalogue(data)) throw new Error('This file isn’t a Phrasebound media catalogue.');
    catalogue = data;
    render();
    await chrome.storage.local.set({ [cacheKey]: data });
  }

  function catalogueEndpoint(path = '/media_catalogue') {
    const url = new URL(state.set.companionUrl || 'http://127.0.0.1:8787');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Catalogue refresh needs a local Companion.');
    }
    return new URL(path, url);
  }

  async function refresh() {
    const revision = indexRevision;
    if (!catalogue) status.textContent = 'Loading your catalogue…';
    try {
      const response = await fetch(catalogueEndpoint(), {
        headers: { 'X-Phrasebound-Catalogue': '1' }, signal: AbortSignal.timeout(4500), cache: 'no-store',
      });
      if (!response.ok) throw new Error('No catalogue is available from Companion.');
      if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('The catalogue is too large.');
      const data = await response.json();
      if (revision === indexRevision) await storeCatalogue(data);
    } catch (error) {
      if (!catalogue) {
        resultTitle.textContent = 'Open your catalogue';
        status.textContent = 'Start Companion with a local catalogue or import the catalogue JSON.';
      }
    }
  }

  function updateStatus(message) {
    refreshStatus.textContent = message;
    refreshStatus.hidden = !message;
  }

  async function checkPublishers(manual = false) {
    if (refreshing) return;
    refreshing = true;
    reload.disabled = true;
    const revision = indexRevision;
    let active = false;
    const request = async (url, method) => {
      const response = await fetch(url, { method, cache: 'no-store', signal: AbortSignal.timeout(4500),
        headers: { 'X-Phrasebound-Catalogue': '1' } });
      if (!response.ok) throw new Error('Publisher check unavailable.');
      return response.json();
    };
    try {
      const endpoint = catalogueEndpoint('/media_catalogue/refresh');
      if (manual) updateStatus('Checking publisher archives…');
      if (manual) endpoint.searchParams.set('force', 'true');
      let progress = await request(endpoint, 'POST');
      active = Boolean(progress.started);
      if (!active && !manual) return;
      if (active) updateStatus('Checking Japanese and Cantonese publishers…');
      const deadline = Date.now() + 240_000;
      while (progress.running && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2100));
        progress = await request(catalogueEndpoint('/media_catalogue/refresh'), 'GET');
      }
      if (progress.running) {
        updateStatus('Publisher check is still running. Reopen the catalogue to load the results.');
        return;
      }
      if (progress.error) throw new Error(progress.error);
      if (revision === indexRevision) await refresh();
      const added = Number(progress.added) || 0;
      const partial = Object.values(progress.publishers || {}).some(source => source.unavailable);
      updateStatus((added ? added + (added === 1 ? ' new item.' : ' new items.') : 'No new verified media this check.') +
        (partial ? ' Some publisher resources were unavailable.' : ''));
    } catch (_) {
      if (manual || active) updateStatus('Publisher check unavailable. You can still browse your saved catalogue.');
    } finally {
      refreshing = false;
      reload.disabled = false;
    }
  }

  async function readProfile() {
    const revision = ++readingProfile;
    const fresh = await SS_STORE.loadAll();
    if (revision !== readingProfile) return;
    state = fresh;
    render();
  }

  async function start() {
    const [stored] = await Promise.all([chrome.storage.local.get([cacheKey, preferencesKey]), readProfile()]);
    const codes = [...new Set([...initialLanguages, ...SS_LANG.SUPPORTED_12])];
    for (const code of codes) language.add(new Option(SS_LANG.LANG_META[code].label, code));
    const prefs = stored[preferencesKey] || {};
    const currentLang = state.set.lang ? SS_LANG.normCode(state.set.lang) : '';
    language.value = codes.find(code => code === prefs.lang || (!prefs.lang && code === currentLang)) || initialLanguages[0];
    kind = ['all', 'video', 'podcast'].includes(prefs.kind) ? prefs.kind : 'all';
    sort.value = ['recommended', 'short', 'views', 'recent'].includes(prefs.sort) ? prefs.sort : 'recommended';
    if (validCatalogue(stored[cacheKey])) {
      catalogue = stored[cacheKey];
      render();
    }
    function filterChanged() {
      shown = pageSize;
      render();
    }
    function updateFilters() {
      for (const control of types) control.setAttribute('aria-pressed', String(control.dataset.kind === kind));
      filterChanged();
      chrome.storage.local.set({ [preferencesKey]: { lang: language.value, kind, sort: sort.value } }).catch(() => {});
    }
    for (const control of types) control.addEventListener('click', () => {
      kind = control.dataset.kind;
      updateFilters();
    });
    language.addEventListener('change', () => {
      publisher.value = '';
      updateFilters();
    });
    sort.addEventListener('change', updateFilters);
    publisher.addEventListener('change', filterChanged);
    search.addEventListener('input', filterChanged);
    for (const control of types) control.setAttribute('aria-pressed', String(control.dataset.kind === kind));
    reload.addEventListener('click', () => checkPublishers(true));
    importer.addEventListener('change', async () => {
      const file = importer.files[0];
      if (!file) return;
      try {
        if (file.size > maxBytes) throw new Error('The catalogue is too large.');
        const data = JSON.parse(await file.text());
        if (!validCatalogue(data)) throw new Error('This file isn’t a Phrasebound media catalogue.');
        indexRevision++;
        await storeCatalogue(data);
      } catch (error) {
        status.textContent = error instanceof SyntaxError ? 'The file contains invalid JSON.' : error.message;
      } finally {
        importer.value = '';
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ['ss_words', 'ss_items', 'ss_review', 'ss_set'].some(key => changes[key])) {
        readProfile().catch(() => {});
      }
    });
    await refresh();
    checkPublishers();
  }

  start().catch(() => { status.textContent = 'Could not open your catalogue.'; });
})();
