const WATCHED_PREFIX = 'ss_watched_scene:';
let sceneQueue = Promise.resolve();

function watchedSceneRequest(message) {
  const store = chrome.storage.local;
  const keyFor = pattern => WATCHED_PREFIX + JSON.stringify([message.lang, pattern]);
  async function run() {
    if (message.op === 'clearWatchedScenes') {
      const keys = store.getKeys ? await store.getKeys() : Object.keys(await store.get(null));
      await store.remove(keys.filter(key => key.startsWith(WATCHED_PREFIX)));
      return { ok: true };
    }
    if (message.op === 'listSceneRecall') {
      const prefix = WATCHED_PREFIX + JSON.stringify([message.lang]).slice(0, -1) + ',';
      const keys = store.getKeys ? await store.getKeys() : Object.keys(await store.get(null));
      const values = await store.get(keys.filter(key => key.startsWith(prefix)));
      const groups = [];
      for (const [key, rows] of Object.entries(values)) {
        if (!Array.isArray(rows) || !rows.length) continue;
        const pattern = JSON.parse(key.slice(WATCHED_PREFIX.length))[1];
        const recent = [...rows].filter(sceneAddress).sort((a, b) => b.at - a.at);
        if (!recent.length) continue;
        const latest = recent[0];
        const another = recent.find(row => row.videoKey !== latest.videoKey);
        groups.push({ pattern, latest, another });
      }
      groups.sort((a, b) => b.latest.at - a.latest.at);
      return { ok: true, groups: groups.slice(0, 12) };
    }
    if (message.op === 'sceneFrequency') {
      const patterns = [...new Set(message.patterns)];
      const values = await store.get(patterns.map(keyFor));
      const cutoff = Date.now() - 30 * 86400000;
      return { ok: true, counts: patterns.map(pattern => {
        const rows = (values[keyFor(pattern)] || []).filter(row => row.at >= cutoff);
        return [pattern, rows.length, new Set(rows.map(row => row.videoKey)).size];
      }) };
    }
    if (message.op === 'labelScene') {
      const key = keyFor(message.pattern);
      const rows = (await store.get(key))[key] || [];
      const row = rows.find(r => r.videoKey === message.videoKey && r.t === message.t);
      if (!row || !['', 'Literal', 'Idiomatic'].includes(message.sense)) return { ok: false };
      row.sense = message.sense;
      await store.set({ [key]: rows });
      return { ok: true };
    }
    if (message.op === 'getWatchedScenes') {
      const key = keyFor(message.pattern);
      const rows = (await store.get(key))[key] || [];
      return { ok: true, rows: rows.filter(row => row.videoKey !== message.exclude) };
    }
    const { scene, patterns } = message;
    if (!scene || !Array.isArray(patterns) || !Number.isFinite(scene.t) || scene.t < 0 ||
        !/^(yt:|bili:)/.test(scene.videoKey)) return { ok: false };
    const keys = [...new Set(patterns.filter(p => typeof p === 'string' && p).map(keyFor))];
    if (!keys.length) return { ok: true };
    const existing = await store.get(keys);
    const changes = {};
    for (const key of keys) {
      const rows = existing[key] || [];
      if (rows.some(row => row.videoKey === scene.videoKey && row.t === scene.t)) continue;
      changes[key] = [scene, ...rows].slice(0, 30);
    }
    if (Object.keys(changes).length) await store.set(changes);
    return { ok: true };
  }
  const result = sceneQueue.then(run);
  sceneQueue = result.catch(() => {});
  return result;
}

function sceneAddress(row) {
  if (!Number.isFinite(row?.t) || !Number.isFinite(row.endT) || row.endT <= row.t) return null;
  const id = row.videoKey;
  const yt = /^yt:([\w-]+)$/.exec(id);
  const bili = /^bili:(BV[a-z\d]+|av\d+|ep\d+|ss\d+)(?:_p(\d+))?(?:_\d+)?$/i.exec(id);
  const time = Math.max(0, Math.floor(row.t - 0.3));
  if (yt) return 'https://www.youtube.com/watch?v=' + yt[1] + '&t=' + time + 's';
  if (!bili) return null;
  const path = /^(ep|ss)/.test(bili[1]) ? '/bangumi/play/' : '/video/';
  return 'https://www.bilibili.com' + path + bili[1] + '?p=' + (bili[2] || 1) + '&t=' + time;
}

async function compareScenes(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null || sender.frameId !== 0) return { ok: false };
  const session = chrome.storage.session;
  const key = id => 'ss_scene_pair_' + id;
  if (message.op === 'startScenePair' || message.op === 'startRecallPlaylist') {
    let rows;
    if (message.op === 'startRecallPlaylist') {
      const result = await watchedSceneRequest({op:'listSceneRecall',lang:message.lang});
      const seen = new Set();
      rows = result.groups.map(group=>group.latest).filter(row=>{
        const url=sceneAddress(row);
        if (!url || seen.has(url)) return false;
        seen.add(url); return true;
      });
      if (!rows.length) return {ok:false};
    } else {
      const result = await watchedSceneRequest({ ...message, op:'getWatchedScenes', exclude:'' });
      const first = result.rows.find(r => r.videoKey === message.first?.videoKey && r.t === message.first.t);
      const second = result.rows.find(r => r.videoKey === message.second?.videoKey && r.t === message.second.t);
      if (!first || !second || first.videoKey === second.videoKey || ![first,second].every(sceneAddress)) return {ok:false};
      rows=[first,second];
    }
    const tab = await chrome.tabs.create({ url: 'about:blank', openerTabId: tabId });
    const pair = { rows, index: 0, source: tabId, nonce: crypto.randomUUID() };
    try {
      await session.set({ [key(tab.id)]: pair });
      await chrome.tabs.update(tab.id, { url: sceneAddress(rows[0]) + '#ss-pair=' + pair.nonce });
    } catch (error) {
      await session.remove(key(tab.id));
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
    return { ok: true };
  }
  const pair = (await session.get(key(tabId)))[key(tabId)];
  if (!pair || pair.nonce !== message.nonce) return { ok: false };
  if (message.op === 'readScenePair') return { ok: true, row: pair.rows[pair.index], index: pair.index, total:pair.rows.length };
  if (message.index !== pair.index) return { ok: false };
  if (message.op === 'nextScenePair' && pair.index + 1 < pair.rows.length) {
    pair.index++;
    await session.set({ [key(tabId)]: pair });
    try {
      await chrome.tabs.update(tabId, {url:sceneAddress(pair.rows[pair.index]) + '#ss-pair=' + pair.nonce});
    } catch (err) {
      pair.index--;
      await session.set({[key(tabId)]:pair});
      throw err;
    }
  } else {
    await session.remove(key(tabId));
    await chrome.tabs.update(pair.source, { active: true }).catch(() => {});
    await chrome.tabs.remove(tabId);
  }
  return { ok: true };
}
