// BiliRoaming-webX Player — MAIN world 注入（document_start）。
//
// 职责：
//   1. 检测当前 B 站页是否是"仅限港澳台地区"番剧（区域限制页）。
//   2. 从 window.__playinfo__ + URL 提取当前集的 epId/aid/cid/bvid 上下文。
//   3. 把上下文通过 postMessage 投递给 ISOLATED world 的 content/app.mjs。
//   4. 拦截选集（a[href*="/bangumi/play/ep"]）点击、SPA 路由变更（pushState/replaceState/popstate）、
//      以及多个时间点兜底 timer，触发解锁播放。
//
// 关键决策：
//   - isGmtOnly() 双重判断：标题含"僅限港澳台地區" + 区域限制信号。
//     内地番剧（国创）标题无此字样，安全跳过；hydration 阶段 play_video_type 偶发误为 "none"，
//     标题字样是更可靠的过滤闸。
//   - 上下文优先级：URL ep > 显式 extra > __playinfo__ 嵌套字段。URL 是最新事实（切集瞬间
//     __playinfo__ 可能还来不及更新，但 URL 已变）。
//
// 协议：所有 postMessage 的 source 固定为 BRX.MAIN_SOURCE（BRX_PLAYER_MAIN），
// 接收方 bridge.mjs 据此过滤外部消息。
(() => {
  'use strict';
  if (window.__BRX_PLAYER_MAIN_INJECTED__) return;
  window.__BRX_PLAYER_MAIN_INJECTED__ = true;

  const SOURCE = 'BRX_PLAYER_MAIN';
  const BRX_START = 'BRX_PLAYER_START';
  const BRX_EPISODE_SELECT = 'BRX_PLAYER_EPISODE_SELECT';
  const log = (...args) => { try { console.debug('[BRX-Player MAIN]', ...args); } catch (_) {} };
  let playinfoValue;

  function safeGetPlayinfo() { try { return window.__playinfo__?.result || null; } catch (_) { return null; } }
  function epIdFromLocation() { const m = location.pathname.match(/\/bangumi\/play\/ep(\d+)/); return m ? Number(m[1]) : null; }
  function ssIdFromLocation() { const m = location.pathname.match(/\/bangumi\/play\/ss(\d+)/); return m ? Number(m[1]) : null; }

  // 综合判断当前页是否被区域限制：
  //   1) __playinfo__ 存在 → 用 play_video_type / play_check.play_detail / AreaLimitPanel plugin。
  //   2) __playinfo__ 尚未注入（document_start 早期）→ 退化到 body 文本关键词正则。
  function isAreaLimited(pi = safeGetPlayinfo()) {
    if (!pi) return /无法观看|非常抱歉|区域|地区/.test(document.body?.innerText || '');
    if (pi.play_video_type === 'none') return true;
    if (pi.play_check && (pi.play_check.play_detail === 'PLAY_NONE' || pi.play_check.limit_play_reason === 'AREA_LIMIT')) return true;
    if (Array.isArray(pi.plugins) && pi.plugins.some((p) => /AreaLimitPanel/i.test(p?.name || ''))) return true;
    return false;
  }

  // 仅在"港澳台限定"番剧上激活。内地番剧（国创）标题里没有"僅限港澳台地區"字样。
  // play_video_type/play_check 在内地页是 "whole" / "PLAY_WHOLE"，但旧数据或 hydration 阶段
  // 可能误为"none"或"PLAY_NONE"，因此以**标题 + 区域限制**双重判断最稳。
  function isGmtOnly() {
    return isAreaLimited() && /僅限港澳台地區|仅限港澳台地区/.test(document.title || '');
  }

  // 从 __playinfo__ + URL 提取当前正在尝试播放的集数信息。
  // SS 页 (play/ss*) 没有 ep_id 但 play_view_business_info.episode_info / supplement.ogv_episode_info
  // 含"上次播放/默认首集"的 ep_id。缺少 epId 会导致 BiliRoaming 服务端返回 -412。
  // URL ep 优先于 playinfo：切集时 B 站可能还来不及更新 __playinfo__，但 URL 是最新事实。
  function deriveContext(extra = {}) {
    const pi = safeGetPlayinfo();
    const arc = pi?.arc || {};
    const epInfo = pi?.play_view_business_info?.episode_info || {};
    const ogvEp = pi?.supplement?.ogv_episode_info || {};
    const watchProg = pi?.play_view_business_info?.user_status?.watch_progress || {};
    const seasonInfo = pi?.play_view_business_info?.season_info || {};
    const urlEpId = epIdFromLocation();
    const urlSsId = ssIdFromLocation();
    // 优先级：URL ep > 显式 extra > episode_info.ep_id > ogv_episode_info.episode_id > watch_progress.last_ep_id
    const epId = Number(extra.epId || urlEpId || epInfo.ep_id || ogvEp.episode_id || watchProg.last_ep_id) || null;
    const seasonId = Number(extra.seasonId || seasonInfo.season_id || urlSsId || pi?.season_id || pi?.seasonId) || null;
    const aid = Number(extra.aid || epInfo.aid || arc.aid || pi?.aid) || null;
    const cid = Number(extra.cid || epInfo.cid || arc.cid || pi?.cid) || null;
    const bvid = extra.bvid || arc.bvid || pi?.bvid || '';
    return { epId, seasonId, aid, cid, bvid, title: document.title || '', href: location.href, limited: isAreaLimited(pi) };
  }

  function notify(type, payload = {}) {
    window.postMessage({ source: SOURCE, type, payload: Object.assign({ context: deriveContext(payload.context || {}) }, payload) }, '*');
  }

  function maybeStart(reason) {
    const context = deriveContext();
    window.__BRX_PLAYER_CONTEXT__ = context;
    if (isGmtOnly()) notify(BRX_START, { reason, context });
  }

  // 重新定义 window.__playinfo__：捕获 B 站赋值时机的"受限信号"，延时 0ms 让 React 自己先消费赋值。
  try {
    const desc = Object.getOwnPropertyDescriptor(window, '__playinfo__');
    if (!desc || desc.configurable) {
      Object.defineProperty(window, '__playinfo__', {
        configurable: true,
        enumerable: true,
        get() { return playinfoValue; },
        set(v) { playinfoValue = v; setTimeout(() => maybeStart('__playinfo__ setter'), 0); },
      });
    }
  } catch (_) {}

  // 拦截选集点击：用 history.pushState 模拟跳转（让 URL 同步），不触发原生导航。
  // 阻止默认行为 + 拦截冒泡，避免 B 站原生 React 走"区域限制分支"重建播放器。
  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href*="/bangumi/play/ep"]');
    if (!link) return;
    const m = (link.getAttribute('href') || '').match(/ep(\d+)/);
    if (!m) return;
    event.preventDefault();
    event.stopPropagation();
    history.pushState({}, '', new URL(link.getAttribute('href'), location.href).href);
    notify(BRX_EPISODE_SELECT, { context: { epId: Number(m[1]) }, href: link.href });
  }, true);

  // SPA 路由变更 + popstate + 多时间点兜底。
  // 80ms 延时让 B 站自己先把 URL/DOM 变更完成，再评估上下文。
  const oldPush = history.pushState;
  history.pushState = function (...args) { const r = oldPush.apply(this, args); setTimeout(() => maybeStart('pushState'), 80); return r; };
  const oldReplace = history.replaceState;
  history.replaceState = function (...args) { const r = oldReplace.apply(this, args); setTimeout(() => maybeStart('replaceState'), 80); return r; };
  window.addEventListener('popstate', () => setTimeout(() => maybeStart('popstate'), 80));
  [300, 1000, 2500, 5000, 9000].forEach((t) => setTimeout(() => maybeStart('timer:' + t), t));

  log('installed');
})();
