// Shared on-demand Companion study actions for selections with source context.
(() => {
  const actions = [
    ['explain', 'Explain'], ['examples', 'Example sentences'], ['grammar', 'Grammar'],
    ['register', 'Tone'], ['chunks', 'Example pattern'],
  ];

  function create(doc, { request, modes = ['explain', 'grammar', 'register', 'chunks'], buttonClass = '' }) {
    const section = doc.createElement('div');
    section.className = 'ss-local-study';
    const buttons = doc.createElement('div');
    buttons.className = 'ss-local-study-actions';
    const result = doc.createElement('p');
    result.hidden = true;
    result.setAttribute('role', 'status');
    const completed = new Map();
    const controls = new Map();
    let active = '';

    async function show(mode) {
      active = mode;
      for (const [id, control] of controls) control.setAttribute('aria-pressed', String(id === mode));
      result.hidden = false;
      let pending = completed.get(mode);
      result.textContent = 'Checking the selected line with the local model…';
      if (!pending) {
        pending = Promise.resolve().then(() => request(mode)).catch(() => null);
        completed.set(mode, pending);
      }
      const response = await pending;
      const text = response?.ok && response.contextual === true && String(response.explanation || '').trim();
      if (!text && completed.get(mode) === pending) completed.delete(mode);
      if (!section.isConnected || active !== mode) return;
      result.textContent = text ? text.replace(/\*\*([^*\n]+)\*\*/g, '$1')
        : (response?.error || 'Local explanation unavailable.') + ' Select the action again to retry.';
    }

    for (const [id, label] of actions) {
      if (!modes.includes(id)) continue;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = buttonClass;
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => show(id));
      controls.set(id, button);
      buttons.appendChild(button);
    }
    section.append(buttons, result);
    return section;
  }

  globalThis.SS_LOCAL_STUDY = { create };
})();
