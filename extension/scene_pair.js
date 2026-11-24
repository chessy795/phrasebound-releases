(() => {
  const nonce = /^#ss-pair=([\da-f-]+)$/i.exec(location.hash)?.[1];
  if (!nonce || window.top !== window) return;
  const send = (op, index) => chrome.runtime.sendMessage({ op, nonce, index });
  send('readScenePair').then(result => {
    if (!result?.ok) return;
    window.__ssComparingScenes = true;
    const { row, index, total = 2 } = result;
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647';
    const box = document.createElement('div');
    box.style.cssText = 'background:#172128;color:white;font:15px system-ui;padding:12px;border-radius:8px;max-width:34em';
    root.appendChild(box);
    const status = document.createElement('p');
    box.appendChild(status);
    const label = 'Scene ' + (index + 1) + ' of ' + total + ' · ' + row.line;
    status.textContent = label;
    document.documentElement.appendChild(host);
    const button = (name, action) => {
      const b = document.createElement('button');
      b.textContent = name;
      b.addEventListener('click', action);
      box.appendChild(b);
      return b;
    };
    let playing, completed = false, timer, attempted = false;
    async function finish(op) {
      if (completed) return;
      completed = true;
      playing?.pause();
      clearInterval(timer);
      try { await send(op, index); } catch { status.textContent = 'Comparison ended. Close this tab to return.'; }
    }
    function start() {
      const site = window.SS_SITES?.byId(row.videoKey.startsWith('yt:') ? 'yt' : 'bili');
      const v = site?.video();
      if (!v || v.readyState < 1 || site.isAd?.()) return;
      attempted = true;
      playing = v;
      v.currentTime = Math.max(0, row.t - 0.3);
      v.play().then(() => { status.textContent = label; }, () => { status.textContent = 'Press Play scene to hear this clip.'; });
    }
    button('Play scene', start);
    button(index + 1 === total ? 'Finish' : 'Next scene', () => finish('nextScenePair'));
    button('Return to lookup', () => finish('stopScenePair'));
    timer = setInterval(() => {
      if (!attempted) start();
      else if (playing && !playing.seeking && (playing.ended || (!playing.paused && playing.currentTime >= row.endT + 0.25))) finish('nextScenePair');
    }, 120);
    addEventListener('pagehide', () => clearInterval(timer), { once: true });
  }).catch(() => {});
})();
