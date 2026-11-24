// Offscreen player for dictionary pronunciation recordings (see pron.js).
(() => {
  'use strict';
  let cur = null;
  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (!msg || msg.type !== 'SS_PRON_PLAY' || !msg.url) return false;
    try {
      if (cur) { cur.pause(); cur = null; }
      const a = new Audio(msg.url);
      a.playbackRate = msg.rate || 1;
      cur = a;
      a.play().then(() => send({ ok: true }), (e) => send({ ok: false, error: String(e && e.message || e) }));
    } catch (e) { send({ ok: false, error: String(e) }); }
    return true;
  });
})();
