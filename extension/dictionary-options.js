(() => {
  const dictionaries = globalThis.SS_USER_DICTIONARIES;
  const form = document.getElementById('dictionaryImport');
  const file = document.getElementById('dictionaryFile');
  const lang = document.getElementById('dictionaryLanguage');
  const list = document.getElementById('dictionaryList');
  const status = document.getElementById('dictionaryStatus');
  const submit = form.querySelector('button[type="submit"]');
  if (!dictionaries) { status.textContent = 'Dictionary storage is unavailable.'; submit.disabled = true; return; }
  const languageName = code => [...lang.options].find(option => option.value === code)?.textContent || code;

  async function refresh() {
    const rows = await dictionaries.list();
    list.replaceChildren();
    if (!rows.length) {
      const message = document.createElement('li');
      message.textContent = 'No dictionaries imported yet.';
      list.append(message);
    }
    for (const row of rows) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = row.title;
      const remove = document.createElement('button');
      remove.className = 'opt-btn';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${row.title}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await dictionaries.remove(row.id);
          status.textContent = `Removed ${row.title}.`;
          await refresh();
        } catch (_) { remove.disabled = false; status.textContent = 'Removal failed. Try again.'; }
      });
      item.append(name, ` · ${languageName(row.lang)} · ${row.count.toLocaleString()} entries `, remove);
      list.append(item);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !file.files?.[0]) return;
    submit.disabled = true;
    file.disabled = true;
    lang.disabled = true;
    status.textContent = 'Reading dictionary ZIP…';
    try {
      const row = await dictionaries.importZip(file.files[0], lang.value, (done, total) => {
        status.textContent = `Importing term bank ${done} of ${total}…`;
      });
      file.value = '';
      await refresh();
      status.textContent = `Imported ${row.title} · ${row.count.toLocaleString()} entries.`;
    } catch (error) {
      status.textContent = error?.name === 'QuotaExceededError' ? 'The browser ran out of dictionary storage.'
        : error?.message || 'Dictionary import failed.';
    } finally {
      submit.disabled = false;
      file.disabled = false;
      lang.disabled = false;
    }
  });

  refresh().catch(() => { status.textContent = 'Could not open the dictionary library.'; });
})();
