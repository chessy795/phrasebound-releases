(() => {
  const button = document.getElementById('exportPhraseEvidence');
  const status = document.getElementById('phraseEvidenceStatus');
  const languages = new Set('en zh yue ja ko es fr de pt it ru tl'.split(' '));
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const store = chrome.storage.local;
      const prefix = 'ss_watched_scene:';
      const keys = store.getKeys ? await store.getKeys() : Object.keys(await store.get(null));
      const selected = keys.filter(key => key.startsWith(prefix));
      const records = await store.get(['ss_items', ...selected]);
      const rows = [];
      function add(lang, line, expression, sense, surface) {
        if (!languages.has(lang) || typeof line !== 'string' || !line.trim()) return;
        rows.push({lang, text:line.slice(0, 2000), expression, sense, surface});
      }
      for (const key of selected) {
        const [lang, expression] = JSON.parse(key.slice(prefix.length));
        for (const scene of records[key] || []) add(lang,scene.line,expression,scene.sense || '', 'video');
      }
      for (const item of records.ss_items || []) {
        if (!item.sourceUrl || item.videoKey) continue;
        add(item.lang,item.line,item.word || '', '', 'web');
      }
      if (!rows.length) {
        status.textContent = 'No watched expressions or saved web passages are available.';
        return;
      }
      const blob = new Blob(rows.map(row => JSON.stringify(row) + '\n'), {type:'application/x-ndjson'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'phrasebound-personal-evidence.jsonl';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = rows.length + ' local evidence rows exported.';
    } catch (err) { status.textContent = 'Export failed. ' + err.message; }
    finally { button.disabled = false; }
  });
})();

