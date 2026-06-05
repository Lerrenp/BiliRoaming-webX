// BiliRoaming-webX Player — Background service worker (MV3 + ESM)。
//
// 消息路由：content script 通过 chrome.runtime.sendMessage 投递 BRX_PLAYER_ACTION，
// 业务侧只需要 action + payload。本模块负责：
//   - GET_CONFIG / SET_CONFIG — 读写 chrome.storage.sync 配置。
//   - FETCH_PLAYURL — 根据 clientMode (web/app) 分发到 fetch-web.js / fetch-app.js。
//   - FETCH_EP_INFO — PGC 分集元数据 (aid/cid/bvid/duration) 补全。
//   - FETCH_TEXT — 通用 fetch 透传（用于字幕 json 等）。
//
// 注意：所有外部 HTTP 都在这里发起，content world 不直接发请求，
// 一是规避部分端点需要 cookie 但 content 拿不全；二是统一错误处理。
import { DEFAULT_CONFIG } from '../common/constants.mjs';
import { fetchPlayurlWeb } from './fetch-web.js';
import { fetchPlayurlApp } from './fetch-app.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'BRX_PLAYER_ACTION') return;
  handleAction(msg.action, msg.payload || {})
    .then(sendResponse)
    .catch((err) => sendResponse({ code: -1, message: String(err && err.message || err) }));
  return true;
});

async function handleAction(action, payload) {
  if (action === 'GET_CONFIG')   return getConfig();
  if (action === 'SET_CONFIG')   return setConfig(payload);
  if (action === 'FETCH_PLAYURL') return fetchPlayurl(payload.context || {});
  if (action === 'FETCH_EP_INFO') return fetchEpInfo(payload.epId);
  if (action === 'FETCH_TEXT')   return fetchText(payload.url);
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
// - web 模式：fetch-web.js，路径 /pgc/player/web/playurl，可选附加 BiliRoaming 头。
// - app 模式：fetch-app.js，路径 /pgc/player/api/playurl 或 /intl/gateway/v2/ogv/playurl（TH），
//             自动构造 appkey/appsec/MD5 sign。
// 缺 cid/aid 时自动从 FETCH_EP_INFO 补一次（不破坏已有值）。
async function fetchPlayurl(context) {
  const cfg = await getConfig();
  let ctx = Object.assign({}, context);
  if ((!ctx.cid || !ctx.aid) && ctx.epId) {
    ctx = Object.assign(ctx, await fetchEpInfo(ctx.epId));
  }
  if (cfg.clientMode === 'app') return fetchPlayurlApp(ctx, cfg);
  return fetchPlayurlWeb(ctx, cfg);
}

// ====== EP Info ======
// 拉 PGC 番剧分集列表，定位 ep_id 对应集数并返回 aid/cid/bvid/duration。
// 注意：旧版曾用错端点（如 /pgc/season/episode/web/info）返回 cid=null 把已有值覆盖掉，
// 改用 ep_list 后字段稳定。非破坏性合并由 content/app.mjs 负责。
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
