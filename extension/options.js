// Phrasebound Studio Options Controller (ext/options.js) — strictly zero innerHTML
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const SERVICE_CHOICES = [
    ['auto', 'Automatic (local, browser, then web)'],
    ['free_web', 'Use the web service first'],
    ['browser_api', 'Chrome Built-in Translator (On-device)'],
    ['local_plamo2b', 'Local GPU: PLaMo 3 2B (Default)'],
    ['local_index2b', 'Local GPU: Index 2B'],
    ['local_gemma_e4b', 'Local GPU: Gemma 3n E4B'],
    ['local_hymt7b', 'Local GPU: Hy-MT2 7B'],
    ['custom_openai', 'Custom OpenAI-Compatible API'],
  ];

  const DEFAULT_SUB_STYLE = {
    origSize: 26,
    origColor: '#f8fafc',
    trSize: 19,
    trColor: '#dbe4f3',
    bgOpacity: 0.84,
  };
  const WEB_SHORTCUTS = [
    ['article', 'Article Bilingual', 'a'],
    ['full', 'Full-Page Bilingual', 'p'],
    ['compare', 'Compare translation models', 'd'],
    ['input', 'Translate input text', 't'],
    ['view', 'Toggle translation-only view', 'b'],
    ['glosses', 'Toggle study glosses', 'i'],
    ['weave', 'Toggle L2 word weaving', 'w'],
    ['picker', 'Site Rule Picker', 's'],
  ];

  let curSet = {};
  let settingWrites = Promise.resolve();

  function syncWebShortcutFields() {
    if (!$('webShortcutFields')) return;
    const current = new Map(WEB_SHORTCUTS.map(([action, , fallback]) => [action, curSet.webKeys?.[action] ?? fallback]));
    for (const [action, key] of current) {
      const select = $('web-key-' + action);
      select.value = key;
      for (const option of select.options) {
        option.disabled = option.value !== '' && Array.from(current).some(([other, used]) => other !== action && used === option.value);
      }
    }
  }

  function buildWebShortcutFields() {
    const fields = $('webShortcutFields');
    if (!fields) return;
    for (const [action, title] of WEB_SHORTCUTS) {
      const field = document.createElement('label');
      field.className = 'opt-field';
      const text = document.createElement('span');
      text.textContent = title;
      const select = document.createElement('select');
      select.id = 'web-key-' + action;
      for (const key of ['', ...'abcdefghijklmnopqrstuvwxyz']) {
        if (key === 'o') continue; // Alt+O remains reserved for hardsub capture.
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key ? 'Alt+' + key.toUpperCase() : 'Off';
        select.appendChild(option);
      }
      select.onchange = () => {
        saveSet({ webKeys: Object.assign({}, curSet.webKeys, { [action]: select.value }) });
        syncWebShortcutFields();
      };
      field.append(text, select);
      fields.appendChild(field);
    }
  }

  function setStatus(txt) {
    const el = $('saveStatus');
    if (el) el.textContent = txt;
  }

  function saveSet(patch) {
    const stamped = Object.assign({}, patch || {}, { _updatedAt: Date.now() });
    curSet = Object.assign({}, curSet, stamped);
    setStatus('Saving…');
    settingWrites = settingWrites.then(() => new Promise((resolve) => {
      try {
        chrome.storage.local.get(['ss_set'], (result) => {
          const merged = Object.assign({}, result?.ss_set, stamped);
          chrome.storage.local.set({ ss_set: merged }, () => {
            setStatus(chrome.runtime.lastError ? 'Could not save settings' : 'Saved automatically');
            resolve();
          });
        });
      } catch (_) {
        setStatus('Could not save settings');
        resolve();
      }
    }));
    return settingWrites;
  }

  function populateScenarioSelects(services) {
    const selects = document.querySelectorAll('select[data-scene]');
    for (const sel of selects) {
      const scene = sel.getAttribute('data-scene');
      sel.textContent = '';
      for (const [val, label] of SERVICE_CHOICES) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        sel.appendChild(opt);
      }
      sel.value = (services && services[scene]) || 'auto';
      sel.onchange = () => {
        const next = Object.assign({}, curSet.sceneServices || {}, { [scene]: sel.value });
        saveSet({ sceneServices: next });
      };
    }
  }

  function readMicrosoftInputs() {
    return { key: $('microsoftKey').value.trim(), region: $('microsoftRegion').value.trim() };
  }

  function updateWebRoute() {
    if (!$('webMtRoute')) return;
    const microsoft = curSet.webMtProvider === 'microsoft';
    const configured = !!$('microsoftKey').value.trim();
    const google = 'Google Translate';
    const ms = 'Microsoft Translator' + (configured ? '' : ' (key needed)');
    const order = microsoft ? [ms, google] : [google, ms];
    if (curSet.webMtFallback === false) order.pop();
    $('webMtRoute').textContent = order.join(' → ');
  }

  function syncWebOptions() {
    if (!$('webMtProvider')) return;
    $('webMtProvider').value = curSet.webMtProvider === 'microsoft' ? 'microsoft' : 'google';
    $('webMtFallback').checked = curSet.webMtFallback !== false;
    $('chkAutoWebReadings').checked = curSet.autoWebReadings === true;
    $('webDisplayMode').value = curSet.webDisplayMode === 'bilingual' ? 'bilingual' : 'tr_only';
    $('webTranslationStyle').value = curSet.webTranslationStyle === 'panel' ? 'panel' : 'native';
    updateWebRoute();
  }

  async function testWebRoute(provider) {
    const status = $('webMtStatus');
    const btn = provider ? $('testMicrosoft') : $('testWebMt');
    btn.disabled = true;
    status.textContent = 'Contacting translation service…';
    try {
      await settingWrites;
      if (provider === 'microsoft') {
        await chrome.storage.local.set({ ss_ms_translator: readMicrosoftInputs() });
      }
      const start = performance.now();
      const tl = curSet.tl || 'zh-Hant';
      const result = await sendBg({ op: 'webTranslate', texts: [tl === 'en' ? 'Bonjour le monde.' : 'Hello world.'],
        sl: tl === 'en' ? 'fr' : 'en', tl, provider, fallback: provider ? false : undefined, fresh: true });
      status.textContent = result?.ok
        ? `${result.provider} · ${Math.round(performance.now() - start)} ms · ${result.translations[0]}`
        : result?.error || 'Translation service unavailable';
    } catch (_) {
      status.textContent = 'Could not test the service';
    } finally {
      btn.disabled = false;
      updateWebRoute();
    }
  }

  async function saveTranslationGlossary() {
    const status = $('translationGlossaryStatus');
    const entries = [];
    for (const [index, line] of $('translationGlossary').value.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const split = line.indexOf('=');
      const src = split < 0 ? '' : line.slice(0, split).trim();
      const dst = split < 0 ? '' : line.slice(split + 1).trim();
      if (!src || !dst) {
        status.textContent = 'Use source = translation on line ' + (index + 1) + '.';
        return;
      }
      entries.push({ src, dst });
    }
    const unique = new Map(entries.map(entry => [entry.src.toLowerCase(), entry]));
    await saveSet({ glossary: Array.from(unique.values()) });
    status.textContent = 'Glossary saved for webpage translation.';
  }

  function updateSubPreview() {
    const st = Object.assign({}, DEFAULT_SUB_STYLE, curSet.subStyle || {});
    const origEl = $('subPrevOrig');
    const trEl = $('subPrevTr');
    const box = $('subPreviewBox');
    if (!origEl || !trEl || !box) return;

    const alpha = st.bgOpacity != null ? Number(st.bgOpacity) : 0.84;
    origEl.style.fontSize = st.origSize + 'px';
    origEl.style.color = st.origColor;
    origEl.style.background = `rgba(10, 12, 18, ${alpha})`;

    trEl.style.fontSize = st.trSize + 'px';
    trEl.style.color = st.trColor;
    trEl.style.background = `rgba(10, 12, 18, ${alpha})`;

    if ($('lblOrigSize')) $('lblOrigSize').textContent = Math.round(st.origSize / 26 * 100) + '%';
    if ($('lblTrSize')) $('lblTrSize').textContent = Math.round(st.trSize / 19 * 100) + '%';
    if ($('lblBgOpacity')) $('lblBgOpacity').textContent = Math.round(alpha * 100) + '%';

    box.textContent = '';
    if (curSet.transAboveOrig) {
      box.appendChild(trEl);
      box.appendChild(origEl);
    } else {
      box.appendChild(origEl);
      box.appendChild(trEl);
    }
  }

  function renderAlwaysHosts() {
    const hostEl = $('alwaysHostsList');
    if (!hostEl) return;
    hostEl.textContent = '';
    const map = (curSet.autoTranslateHosts && typeof curSet.autoTranslateHosts === 'object') ? curSet.autoTranslateHosts : {};
    const keys = Object.keys(map);
    if (!keys.length) {
      const span = document.createElement('span');
      span.style.fontSize = '12px';
      span.style.color = 'var(--pb-muted)';
      span.textContent = 'No always-translate sites pinned yet. Use "Always Translate Site" in the floating menu.';
      hostEl.appendChild(span);
      return;
    }
    for (const host of keys) {
      const tag = document.createElement('span');
      tag.className = 'opt-tag';
      const txt = document.createElement('span');
      txt.textContent = `${host} (${map[host]})`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '×';
      btn.title = 'Remove';
      btn.onclick = () => {
        const next = Object.assign({}, curSet.autoTranslateHosts || {});
        delete next[host];
        saveSet({ autoTranslateHosts: next });
        renderAlwaysHosts();
      };
      tag.appendChild(txt);
      tag.appendChild(btn);
      hostEl.appendChild(tag);
    }
  }

  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function runSpeedBenchmark() {
    const list = $('benchList');
    if (!list) return;
    list.textContent = '';
    const tl = curSet.tl || 'zh-Hant';
    const sample = 'Good morning, how have you been lately?';

    const rows = [
      { id: 'free', name: 'Web translation' },
      { id: 'browser', name: 'Chrome Built-in Translator API' },
      { id: 'local', name: `Local GPU Companion (${curSet.mtModel || 'plamo-2b'})` },
      { id: 'custom', name: 'Custom OpenAI-Compatible API' },
    ];

    const badges = {};
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'opt-bench-row';
      const lbl = document.createElement('span');
      lbl.textContent = r.name;
      const badge = document.createElement('span');
      badge.className = 'opt-badge';
      badge.textContent = 'Testing…';
      badges[r.id] = badge;
      row.appendChild(lbl);
      row.appendChild(badge);
      list.appendChild(row);
    }

    const mark = (id, ok, text) => {
      const b = badges[id];
      if (!b) return;
      b.className = 'opt-badge ' + (ok ? 'ok' : 'err');
      b.textContent = text;
    };

    // 1. Free Web MT
    {
      const t0 = performance.now();
      const res = await sendBg({ op: 'webTranslate', texts: [sample], sl: 'en', tl });
      const ms = Math.round(performance.now() - t0);
      const ok = !!(res && res.ok && res.translations && res.translations[0]);
      mark('free', ok, ok ? `${res.provider} · ${ms} ms` : res?.error || 'Unavailable');
    }

    // 2. Chrome Built-in AI
    {
      const api = globalThis.Translator || (globalThis.translation && globalThis.translation);
      if (!api || typeof api.create !== 'function') {
        mark('browser', false, 'Not supported in this browser build');
      } else {
        try {
          const t0 = performance.now();
          const tr = await api.create({ sourceLanguage: 'en', targetLanguage: tl.split('-')[0] });
          const out = await tr.translate(sample);
          mark('browser', !!out, `${Math.round(performance.now() - t0)} ms · Ready`);
        } catch (e) {
          mark('browser', false, 'Model pack not downloaded');
        }
      }
    }

    // 3. Local Companion GPU
    {
      const t0 = performance.now();
      const res = await sendBg({
        op: 'companion',
        path: '/translate_text',
        method: 'POST',
        timeoutMs: 12000,
        url: curSet.companionUrl || undefined,
        body: { text: sample, target_lang: tl, model: curSet.mtModel || 'plamo-2b', device: curSet.mtDevice || 'gpu' },
      });
      const ms = Math.round(performance.now() - t0);
      const ok = !!(res && res.ok && res.translation);
      mark('local', ok, ok ? `${ms} ms · "${res.translation.slice(0, 28)}"` : 'Companion :8787 offline');
    }

    // 4. Custom API
    {
      const custom = readCustomInputs();
      if (!custom.baseUrl) {
        mark('custom', false, 'Not configured');
      } else {
        const t0 = performance.now();
        const res = await sendBg({ op: 'customTranslate', text: sample, tl, customApi: custom, timeoutMs: 15000 });
        const ms = Math.round(performance.now() - t0);
        const ok = !!(res && res.ok && res.translation);
        mark('custom', ok, ok ? `${ms} ms · "${res.translation.slice(0, 28)}"` : (res && res.error) || 'Failed');
      }
    }
  }

  function readCustomInputs() {
    return {
      baseUrl: ($('customBaseUrl') ? $('customBaseUrl').value : '').trim(),
      model: ($('customModel') ? $('customModel').value : '').trim(),
      apiKey: ($('customApiKey') ? $('customApiKey').value : '').trim(),
    };
  }

  function bindTabs() {
    const tabs = document.querySelectorAll('.opt-tab');
    const activate = (name) => {
      for (const t of tabs) t.classList.toggle('active', t.getAttribute('data-tab') === name);
      for (const s of document.querySelectorAll('.opt-sec')) s.classList.toggle('active', s.id === `tab-${name}`);
    };
    for (const t of tabs) {
      t.addEventListener('click', () => {
        const name = t.getAttribute('data-tab');
        activate(name);
        try { history.replaceState(null, '', `#${name}`); } catch (_) {}
      });
    }
    const h = (location.hash || '').replace(/^#/, '');
    if (h && document.getElementById(`tab-${h}`)) activate(h);
  }

  function bindControls() {
    if ($('optTl')) $('optTl').onchange = (e) => saveSet({ tl: e.target.value });
    if ($('optMtModel')) $('optMtModel').onchange = (e) => saveSet({ mtModel: e.target.value });
    if ($('companionUrlInput')) $('companionUrlInput').onchange = (e) => saveSet({ companionUrl: e.target.value.trim() || 'http://127.0.0.1:8787' });
    if ($('webMtProvider')) {
      $('chkAutoWebReadings').onchange = () => saveSet({ autoWebReadings: $('chkAutoWebReadings').checked });
      $('webDisplayMode').onchange = () => saveSet({ webDisplayMode: $('webDisplayMode').value });
      $('webTranslationStyle').onchange = () => saveSet({ webTranslationStyle: $('webTranslationStyle').value });
      $('webMtProvider').onchange = () => {
        saveSet({ webMtProvider: $('webMtProvider').value });
        if (curSet.webMtProvider === 'microsoft' && !$('microsoftKey').value.trim()) $('microsoftSetup').open = true;
        updateWebRoute();
      };
      if ($('cloudFallback')) {
        $('cloudFallback').checked = curSet.cloudFallback === true;
        $('cloudFallback').onchange = () => saveSet({ cloudFallback: $('cloudFallback').checked });
      }
      $('webMtFallback').onchange = () => {
        saveSet({ webMtFallback: $('webMtFallback').checked });
        updateWebRoute();
      };
      for (const id of ['microsoftKey', 'microsoftRegion']) {
        $(id).onchange = () => {
          chrome.storage.local.set({ ss_ms_translator: readMicrosoftInputs() }).catch(() => {
            $('webMtStatus').textContent = 'Could not save Microsoft setup';
          });
          updateWebRoute();
        };
      }
      $('testWebMt').onclick = () => testWebRoute();
      $('testMicrosoft').onclick = () => testWebRoute('microsoft');
      $('saveGlossary').onclick = saveTranslationGlossary;
    }

    for (const id of ['customBaseUrl', 'customModel', 'customApiKey']) {
      if ($(id)) $(id).onchange = () => saveSet({ customApi: readCustomInputs() });
    }
    if ($('btnTestCustom')) {
      $('btnTestCustom').onclick = async () => {
        const custom = readCustomInputs();
        saveSet({ customApi: custom });
        if ($('customStatus')) $('customStatus').textContent = 'Verifying connection…';
        const res = await sendBg({ op: 'customTranslate', text: 'Hello world', tl: curSet.tl || 'zh-Hant', customApi: custom });
        if ($('customStatus')) {
          $('customStatus').textContent = res && res.ok
            ? `Connected (${res.model || custom.model}): "${res.translation}"`
            : `Connection error: ${(res && res.error) || 'unknown'}`;
        }
      };
    }

    if ($('chkPreferHuman')) $('chkPreferHuman').onchange = (e) => saveSet({ preferHumanSubs: e.target.checked });
    if ($('chkPreferCustomYtMt')) $('chkPreferCustomYtMt').onchange = (e) => saveSet({ preferCustomYtMt: e.target.checked, autoAiTranslate: e.target.checked });
    if ($('chkCleanStageNoise')) $('chkCleanStageNoise').onchange = (e) => saveSet({ cleanStageNoise: e.target.checked });
    if ($('chkMergeClauses')) $('chkMergeClauses').onchange = (e) => saveSet({ mergeClauses: e.target.checked });
    if ($('chkAutoDetectVideo')) $('chkAutoDetectVideo').onchange = (e) => saveSet({ autoDetectVideo: e.target.checked });
    if ($('chkAutoCalibrateLevel')) $('chkAutoCalibrateLevel').onchange = (e) => saveSet({ autoCalibrateLevel: e.target.checked });
    if ($('chkIncidentalFsrs')) $('chkIncidentalFsrs').onchange = (e) => saveSet({ incidentalFsrs: e.target.checked });
    $('chkWebRareWords').onchange = e => saveSet({webRareWordsOn:e.target.checked});
    if ($('chkWebReaderAid')) $('chkWebReaderAid').onchange = (e) => saveSet({ webReaderAid: e.target.checked });
    if ($('chkPosColors')) $('chkPosColors').onchange = (e) => saveSet({ posColors: e.target.checked });
    if ($('optReadingAid')) $('optReadingAid').onchange = (e) => saveSet({ readingAid: e.target.value, webReaderAid: e.target.value !== 'off' });
    if ($('chkTransAboveOrig')) $('chkTransAboveOrig').onchange = (e) => { saveSet({ transAboveOrig: e.target.checked }); updateSubPreview(); };

    const updateSubKey = (patch) => {
      const next = Object.assign({}, DEFAULT_SUB_STYLE, curSet.subStyle || {}, patch);
      saveSet({ subStyle: next, overlayBgOpacity: next.bgOpacity });
      updateSubPreview();
    };
    if ($('subOrigSize')) $('subOrigSize').oninput = (e) => updateSubKey({ origSize: Number(e.target.value) });
    if ($('subOrigColor')) $('subOrigColor').oninput = (e) => updateSubKey({ origColor: e.target.value });
    if ($('subTrSize')) $('subTrSize').oninput = (e) => updateSubKey({ trSize: Number(e.target.value) });
    if ($('subTrColor')) $('subTrColor').oninput = (e) => updateSubKey({ trColor: e.target.value });
    if ($('subBgOpacity')) $('subBgOpacity').oninput = (e) => updateSubKey({ bgOpacity: Number(e.target.value) / 100 });
    if ($('btnResetSubStyle')) {
      $('btnResetSubStyle').onclick = () => {
        saveSet({ subStyle: Object.assign({}, DEFAULT_SUB_STYLE), overlayBgOpacity: 0.84, transAboveOrig: false });
        syncFormValues();
        updateSubPreview();
      };
    }

    if ($('chkShowFab')) $('chkShowFab').onchange = (e) => saveSet({ showFloatingFab: e.target.checked });
    if ($('chkFabCompact')) $('chkFabCompact').onchange = (e) => saveSet({ fabCompact: e.target.checked });
    if ($('chkTripleSpace')) $('chkTripleSpace').onchange = (e) => saveSet({ inputTripleSpace: e.target.checked });
    if ($('fabClickMode')) $('fabClickMode').onchange = (e) => saveSet({ fabClickMode: e.target.value });
    if ($('fabSide')) $('fabSide').onchange = (e) => saveSet({ fabSide: e.target.value });
    if ($('fabTheme')) $('fabTheme').onchange = (e) => saveSet({ fabTheme: e.target.value });
    if ($('fabOpacity')) $('fabOpacity').oninput = (e) => {
      const op = Number(e.target.value) / 100;
      if ($('lblFabOpacity')) $('lblFabOpacity').textContent = Math.round(op * 100) + '%';
      saveSet({ fabOpacity: op });
    };
    if ($('fabHoverDelay')) $('fabHoverDelay').oninput = (e) => {
      const ms = Number(e.target.value);
      if ($('lblFabDelay')) $('lblFabDelay').textContent = ms + 'ms';
      saveSet({ fabHoverDelay: ms });
    };
    if ($('fabHideDomains')) $('fabHideDomains').onchange = (e) => {
      const list = String(e.target.value || '').split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      saveSet({ fabHideDomains: list });
    };
    if ($('chkAutoTranslateForeign')) $('chkAutoTranslateForeign').onchange = (e) => saveSet({ autoTranslateWeb: e.target.checked });
    if ($('autoTranslateScope')) $('autoTranslateScope').onchange = (e) => saveSet({ autoTranslateScope: e.target.value });
    if ($('skipAutoTranslateLangs')) $('skipAutoTranslateLangs').onchange = (e) => {
      const list = String(e.target.value || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      saveSet({ skipAutoTranslateLangs: list });
    };
    if ($('neverTranslateHosts')) $('neverTranslateHosts').onchange = (e) => {
      const list = String(e.target.value || '').split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      saveSet({ neverTranslateHosts: list });
    };

    if ($('btnSpeedTest')) $('btnSpeedTest').onclick = runSpeedBenchmark;
    if ($('chkAutoStartCompanion')) $('chkAutoStartCompanion').onchange = (e) => saveSet({ autoStartCompanion: e.target.checked });
    if ($('btnWakeCompanion')) {
      $('btnWakeCompanion').onclick = async () => {
        const stEl = $('companionWakeStatus');
        if (stEl) stEl.textContent = 'Waking companion host…';
        const r = await sendBg({ op: 'wakeCompanion', url: curSet.companionUrl || undefined });
        if (stEl) {
          stEl.textContent = r && r.ok
            ? (r.alreadyRunning ? 'Companion already online on :8787.' : 'Companion started silently in background!')
            : `Could not auto-start (${(r && r.error) || 'run companion/install_autostart.bat once'}).`;
        }
      };
    }
    if ($('btnOpenReader')) $('btnOpenReader').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') });
    if ($('btnOpenPlayer')) $('btnOpenPlayer').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('player.html') });
  }

  function syncFormValues() {
    if ($('optTl')) $('optTl').value = curSet.tl || 'zh-Hant';
    if ($('optMtModel')) $('optMtModel').value = curSet.mtModel || 'plamo-2b';
    if ($('companionUrlInput')) $('companionUrlInput').value = curSet.companionUrl || 'http://127.0.0.1:8787';
    if ($('chkAutoStartCompanion')) $('chkAutoStartCompanion').checked = curSet.autoStartCompanion !== false;
    try {
      if ($('extIdDisplay') && chrome.runtime && chrome.runtime.id) {
        $('extIdDisplay').textContent = `Extension ID: ${chrome.runtime.id}`;
      }
    } catch (_) {}

    const ca = curSet.customApi || {};
    if ($('customBaseUrl')) $('customBaseUrl').value = ca.baseUrl || '';
    if ($('customModel')) $('customModel').value = ca.model || '';
    if ($('customApiKey')) $('customApiKey').value = ca.apiKey || '';

    if ($('chkPreferHuman')) $('chkPreferHuman').checked = curSet.preferHumanSubs !== false;
    if ($('chkPreferCustomYtMt')) $('chkPreferCustomYtMt').checked = curSet.preferCustomYtMt !== false;
    if ($('chkCleanStageNoise')) $('chkCleanStageNoise').checked = curSet.cleanStageNoise !== false;
    if ($('chkMergeClauses')) $('chkMergeClauses').checked = curSet.mergeClauses !== false;
    if ($('chkAutoDetectVideo')) $('chkAutoDetectVideo').checked = !!curSet.autoDetectVideo;
    if ($('chkAutoCalibrateLevel')) $('chkAutoCalibrateLevel').checked = curSet.autoCalibrateLevel !== false;
    if ($('chkIncidentalFsrs')) $('chkIncidentalFsrs').checked = curSet.incidentalFsrs !== false;
    $('chkWebRareWords').checked = curSet.webRareWordsOn === true;
    if ($('chkWebReaderAid')) $('chkWebReaderAid').checked = curSet.webReaderAid !== false;
    if ($('chkPosColors')) $('chkPosColors').checked = curSet.posColors !== false;
    if ($('optReadingAid')) $('optReadingAid').value = curSet.readingAid || 'romaji';
    if ($('chkTransAboveOrig')) $('chkTransAboveOrig').checked = !!curSet.transAboveOrig;

    const st = Object.assign({}, DEFAULT_SUB_STYLE, curSet.subStyle || {});
    if ($('subOrigSize')) $('subOrigSize').value = String(st.origSize);
    if ($('subOrigColor')) $('subOrigColor').value = st.origColor;
    if ($('subTrSize')) $('subTrSize').value = String(st.trSize);
    if ($('subTrColor')) $('subTrColor').value = st.trColor;
    if ($('subBgOpacity')) $('subBgOpacity').value = String(Math.round((st.bgOpacity != null ? st.bgOpacity : 0.84) * 100));

    if ($('chkShowFab')) $('chkShowFab').checked = curSet.showFloatingFab !== false;
    if ($('chkFabCompact')) $('chkFabCompact').checked = !!curSet.fabCompact;
    if ($('chkTripleSpace')) $('chkTripleSpace').checked = curSet.inputTripleSpace !== false;
    if ($('fabClickMode')) $('fabClickMode').value = curSet.fabClickMode || 'article';
    if ($('fabSide')) $('fabSide').value = curSet.fabSide || 'right';
    if ($('fabTheme')) $('fabTheme').value = curSet.fabTheme || 'system';
    syncWebShortcutFields();
    const fabOp = curSet.fabOpacity != null ? Number(curSet.fabOpacity) : 0.82;
    if ($('fabOpacity')) $('fabOpacity').value = String(Math.round(fabOp * 100));
    if ($('lblFabOpacity')) $('lblFabOpacity').textContent = Math.round(fabOp * 100) + '%';
    const fabMs = curSet.fabHoverDelay != null ? Number(curSet.fabHoverDelay) : 140;
    if ($('fabHoverDelay')) $('fabHoverDelay').value = String(fabMs);
    if ($('lblFabDelay')) $('lblFabDelay').textContent = fabMs + 'ms';
    if ($('fabHideDomains')) $('fabHideDomains').value = Array.isArray(curSet.fabHideDomains) ? curSet.fabHideDomains.join('\n') : '';
    if ($('chkAutoTranslateForeign')) $('chkAutoTranslateForeign').checked = curSet.autoTranslateWeb === true;
    if ($('autoTranslateScope')) $('autoTranslateScope').value = curSet.autoTranslateScope || 'full';
    if ($('skipAutoTranslateLangs')) $('skipAutoTranslateLangs').value = Array.isArray(curSet.skipAutoTranslateLangs) ? curSet.skipAutoTranslateLangs.join(', ') : '';
    if ($('neverTranslateHosts')) $('neverTranslateHosts').value = Array.isArray(curSet.neverTranslateHosts) ? curSet.neverTranslateHosts.join('\n') : '';

    populateScenarioSelects(curSet.sceneServices || {});
    syncWebOptions();
    if ($('translationGlossary')) {
      const glossary = curSet.glossary || {};
      const pairs = Array.isArray(glossary) ? glossary.map(entry => [entry.src, entry.dst]) : Object.entries(glossary);
      $('translationGlossary').value = pairs.map(([src, dst]) => src + ' = ' + dst).join('\n');
    }
    updateSubPreview();
    renderAlwaysHosts();
  }

  bindTabs();
  bindControls();
  buildWebShortcutFields();
  try {
    chrome.storage.local.get(['ss_set', 'ss_ms_translator'], (res) => {
      curSet = (res && res.ss_set) || {};
      if ($('microsoftKey')) {
        $('microsoftKey').value = res?.ss_ms_translator?.key || '';
        $('microsoftRegion').value = res?.ss_ms_translator?.region || '';
      }
      syncFormValues();
    });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if ((!area || area === 'local') && changes && changes.ss_set && changes.ss_set.newValue) {
          curSet = Object.assign({}, curSet, changes.ss_set.newValue);
          renderAlwaysHosts();
          syncWebShortcutFields();
          if ($('fabTheme')) $('fabTheme').value = curSet.fabTheme || 'system';
          populateScenarioSelects(curSet.sceneServices || {});
          syncWebOptions();
        }
      });
    }
  } catch (_) {
    syncFormValues();
  }
})();
