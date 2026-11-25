const COMPANION_SETUP_URL = 'https://github.com/chessy795/phrasebound-releases/releases/latest/download/PhraseboundSetup.exe';
// Unified Toolbar Action Popup Controller (ext/popup.js) — strictly zero innerHTML
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  let curSet = {};

  function syncModeButtons(mode) {
    const isPro = mode === 'pro';
    if ($('btnModeClean')) $('btnModeClean').classList.toggle('active', !isPro);
    if ($('btnModePro')) $('btnModePro').classList.toggle('active', isPro);
  }

  function syncReadingAidButton() {
    const btn = $('btnReaderAid');
    if (!btn) return;
    const on = curSet.webReaderAid !== false && curSet.readingAid !== 'off';
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '✓ Reading aids' : 'Reading aids';
  }

  function saveSet(patch) {
    const stamped = Object.assign({}, patch || {}, { _updatedAt: Date.now() });
    curSet = Object.assign({}, curSet, stamped);
    if (patch.uiMode) syncModeButtons(patch.uiMode);
    try {
      if (chrome.storage.local.get) {
        chrome.storage.local.get(['ss_set'], (res) => {
          const merged = Object.assign({}, (res && res.ss_set) || {}, stamped);
          curSet = merged;
          chrome.storage.local.set({ ss_set: merged });
        });
      } else {
        chrome.storage.local.set({ ss_set: curSet });
      }
    } catch (_) {}
  }

  function sendToActiveTab(msg) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (tab && tab.id != null) {
          chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }, () => { void chrome.runtime.lastError; });
        }
      });
    } catch (_) {}
  }

  function loadState() {
    try {
      chrome.storage.local.get(['ss_set', 'ss_items', 'ss_words', 'ss_xp'], (res) => {
        curSet = (res && res.ss_set) || {};
        for (const [action, fallback] of Object.entries({ article: 'a', full: 'p', picker: 's', compare: 'd' })) {
          const hint = $('shortcut-' + action);
          if (!hint) continue;
          const saved = curSet.webKeys?.[action];
          const key = typeof saved === 'string' && /^(?:[a-np-z])?$/.test(saved) ? saved : fallback;
          hint.textContent = key ? 'Alt+' + key.toUpperCase() : '';
          hint.hidden = !key;
          if (action === 'compare' && $('compareHint')) $('compareHint').hidden = !key;
        }
        syncReadingAidButton();
        const effectiveTl = curSet.tl || 'zh-Hant';
        if ($('tlSelect')) $('tlSelect').value = effectiveTl;
        if (curSet.mtModel && $('modelSelect')) $('modelSelect').value = curSet.mtModel;
        syncModeButtons(curSet.uiMode || 'clean');
        if ($('btnAutoWeb')) {
          const on = curSet.autoTranslateWeb === true;
          $('btnAutoWeb').classList.toggle('active', on);
          $('btnAutoWeb').textContent = on ? '✓ Auto Web' : 'Auto Web';
        }
        if ($('btnBlurWeb')) $('btnBlurWeb').classList.toggle('active', !!curSet.webBlurTr);
        if ($('btnBorderless')) $('btnBorderless').classList.toggle('active', !!curSet.webBorderless);

        const items = Array.isArray(res && res.ss_items) ? res.ss_items : [];
        const words = (res && res.ss_words && typeof res.ss_words === 'object') ? res.ss_words : {};
        const knownCount = Object.values(words).filter((v) => v === 'known').length;
        if ($('statSaved')) $('statSaved').textContent = String(items.length);
        if ($('statKnown')) $('statKnown').textContent = String(knownCount);
        if ($('statXp')) $('statXp').textContent = String((res && res.ss_xp) || 0);

        chrome.runtime.sendMessage({
          op: 'companion',
          path: '/health',
          method: 'GET',
          timeoutMs: 1800,
          url: curSet.companionUrl || undefined,
        }, (r) => {
          const dot = $('compDot');
          const st = $('compStatus');
          const pw = $('compPower');
          if (pw) {
            const off = !!curSet.companionOff;
            pw.hidden = !(r && r.ok) && !off;
            pw.textContent = off ? 'AI off' : 'AI on';
            pw.classList.toggle('off', off);
            pw.onclick = () => {
              pw.disabled = true;
              pw.textContent = off ? 'Starting…' : 'Stopping…';
              chrome.runtime.sendMessage({ op: 'setCompanionPower', on: off }, () => { window.location.reload(); });
            };
          }
          if (curSet.companionOff) {
            if (dot) dot.classList.add('offline');
            if (st) st.textContent = 'Local AI off · Free Web AI ready';
            return;
          }
          if (r && r.ok) {
            if (dot) dot.classList.add('online');
            const active = r.active_mt_model || r.active_mt || curSet.mtModel || 'plamo-2b';
            const dl = r.model_download;
            if (st) st.textContent = dl && dl.state === 'downloading' && dl.total
              ? `Local AI: downloading translator ${Math.floor(100 * dl.bytes / dl.total)}%`
              : `Local AI online · ${active}`;
          } else {
            if (dot) dot.classList.add('offline');
            if (st) st.textContent = 'Offline dicts · Free Web AI ready';
            if (/Windows/.test(navigator.userAgent) && st && !$('compInstall')) {
              const b = document.createElement('button');
              b.type = 'button';
              b.id = 'compInstall';
              b.className = 'pp-install';
              b.textContent = 'Get free offline AI (Windows)';
              b.title = 'Downloads the Phrasebound companion: offline translation and subtitle reading on this PC';
              b.addEventListener('click', () => chrome.tabs.create({ url: COMPANION_SETUP_URL }));
              st.after(b);
            }
          }
        });
      });
    } catch (_) {}
  }

  if ($('tlSelect')) $('tlSelect').addEventListener('change', (e) => saveSet({ tl: e.target.value }));
  if ($('modelSelect')) $('modelSelect').addEventListener('change', (e) => saveSet({ mtModel: e.target.value }));
  if ($('btnModeClean')) $('btnModeClean').addEventListener('click', () => saveSet({ uiMode: 'clean' }));
  if ($('btnModePro')) $('btnModePro').addEventListener('click', () => saveSet({ uiMode: 'pro' }));

  if ($('btnArticle')) $('btnArticle').addEventListener('click', () => { sendToActiveTab({ op: 'ssToggleArticle' }); window.close(); });
  if ($('btnFullPage')) $('btnFullPage').addEventListener('click', () => { sendToActiveTab({ op: 'ssToggleFullPage' }); window.close(); });
  if ($('btnRulePicker')) $('btnRulePicker').addEventListener('click', () => { sendToActiveTab({ op: 'ssStartRulePicker' }); window.close(); });
  if ($('btnOcr')) $('btnOcr').addEventListener('click', () => { sendToActiveTab({ op: 'ssTriggerOcr' }); window.close(); });
  if ($('btnAutoWeb')) $('btnAutoWeb').addEventListener('click', () => {
    const next = !(curSet.autoTranslateWeb === true);
    saveSet({ autoTranslateWeb: next });
    $('btnAutoWeb').classList.toggle('active', next);
    $('btnAutoWeb').textContent = next ? '✓ Auto Web' : 'Auto Web';
    sendToActiveTab({ op: 'ssReevalAutoTranslate' });
  });
  if ($('btnIPlusOne')) $('btnIPlusOne').addEventListener('click', () => { sendToActiveTab({ op: 'ssToggleIPlusOneGloss' }); window.close(); });
  if ($('btnL1Weave')) $('btnL1Weave').addEventListener('click', () => { sendToActiveTab({ op: 'ssToggleL1Weave' }); window.close(); });
  if ($('btnBlurWeb')) $('btnBlurWeb').addEventListener('click', () => { saveSet({ webBlurTr: !curSet.webBlurTr }); sendToActiveTab({ op: 'ssToggleWebBlur' }); window.close(); });
  if ($('btnBorderless')) $('btnBorderless').addEventListener('click', () => { saveSet({ webBorderless: !curSet.webBorderless }); sendToActiveTab({ op: 'ssToggleBorderless' }); window.close(); });
  if ($('btnReaderAid')) $('btnReaderAid').addEventListener('click', () => {
    const curAid = curSet.webReaderAid !== false && curSet.readingAid !== 'off';
    const next = !curAid;
    const mode = curSet.readingAid && curSet.readingAid !== 'off' ? curSet.readingAid : 'romaji';
    saveSet({ webReaderAid: next, posColors: next, readingAid: next ? mode : 'off' });
    syncReadingAidButton();
  });
  if ($('btnRegionOcr')) $('btnRegionOcr').addEventListener('click', () => { sendToActiveTab({ op: 'ssStartRegionOcr' }); window.close(); });
  if ($('btnMediaCatalogue')) $('btnMediaCatalogue').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('media-catalogue.html') });
  });
  if ($('btnTopIdioms')) $('btnTopIdioms').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('top-idioms.html') }));
  if ($('btnReview')) $('btnReview').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }));
  if ($('btnReader')) $('btnReader').addEventListener('click', () => {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') }); } catch (_) {}
    window.close();
  });
  if ($('btnLocalPlayer')) $('btnLocalPlayer').addEventListener('click', () => {
    try { chrome.tabs.create({ url: chrome.runtime.getURL('player.html') }); } catch (_) {}
    window.close();
  });
  if ($('btnOptions')) $('btnOptions').addEventListener('click', () => {
    try {
      if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    } catch (_) {}
    window.close();
  });

  loadState();
})();
