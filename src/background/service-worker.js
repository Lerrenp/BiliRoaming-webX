import { DEFAULT_CONFIG } from '../common/constants.mjs';
import { fetchPlayurlWeb } from './fetch-web.js';
import { fetchPlayurlApp } from './fetch-app.js';

// ====== Message handling ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'BRX_PLAYER_ACTION') return;
  handleAction(msg.action, msg.payload || {})
    .then(sendResponse)
    .catch(err => sendResponse({ code: -1, message: String(err && err.message || err) }));
  return true;
});

async function handleAction(action, payload) {
  if (action === 'GET_CONFIG') return getConfig();
  if (action === 'SET_CONFIG') return setConfig(payload);
  if (action === 'FETCH_PLAYURL') return fetchPlayurl(payload.context || {});
  if (action === 'FETCH_EP_INFO') return fetchEpInfo(payload.epId);
  if (action === 'FETCH_TEXT') return fetchText(payload.url);
  throw new Error('Unknown action: ' + action);
}

// ====== Config ======
async function getConfig() {
  const cfg = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return Object.assign({}, DEFAULT_CONFIG, cfg);
}
async function setConfig(patch) {
  await chrome.storage.sync.set(patch || {});
  return getConfig();
}

// ====== Playurl dispatcher ======
// web 模式走 fetch-web.js（原始逻辑不变）
// app 模式走 fetch-app.js（Android 签名）
async function fetchPlayurl(context) {
  const cfg = await getConfig();
  let ctx = Object.assign({}, context);
  if ((!ctx.cid || !ctx.aid) && ctx.epId) ctx = Object.assign(ctx, await fetchEpInfo(ctx.epId));

  if (cfg.clientMode === 'app') {
    return fetchPlayurlApp(ctx, cfg);
  }
  return fetchPlayurlWeb(ctx, cfg);
}

// ====== EP Info ======
async function fetchEpInfo(epId) {
  if (!epId) return {};
  const url = 'https://api.bilibili.com/pgc/view/web/ep/list?ep_id=' + encodeURIComponent(epId);
  let json;
  try {
    const resp = await fetch(url, {
      credentials: 'include',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/' },
    });
    json = await resp.json();
  } catch (err) {
    console.warn('[BRX-Player BG] fetchEpInfo network error', epId, err);
    return { epId: Number(epId), aid: null, cid: null, bvid: '', duration: 0 };
  }
  const episodes = (json && json.result && Array.isArray(json.result.episodes)) ? json.result.episodes : [];
  if (!episodes.length) return { epId: Number(epId), aid: null, cid: null, bvid: '', duration: 0 };
  const ep = episodes.find((e) => Number(e.ep_id) === Number(epId)) || episodes[0];
  return {
    epId: Number(ep.ep_id || epId),
    aid: Number(ep.aid) || null,
    cid: Number(ep.cid) || null,
    bvid: ep.bvid || '',
    duration: Number(ep.duration) || 0,
  };
}

// ====== Fetch Text ======
async function fetchText(url) {
  if (!url) throw new Error('missing url');
  const resp = await fetch(url, { credentials: 'include' });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text, message: resp.ok ? '' : 'HTTP ' + resp.status };
}
