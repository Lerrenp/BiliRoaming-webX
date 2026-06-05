// BiliRoaming-webX Player — ISOLATED world 主入口。
//
// 启动流程：
//   1. startContentApp() 注册 PageBridge，监听 MAIN 的 BRX_PLAYER_START / BRX_PLAYER_EPISODE_SELECT。
//   2. handleStart() 启动一次完整解锁流程：
//        a) GMT 防御（标题含"僅限港澳台地區"）
//        b) FETCH_EP_INFO 非破坏性合并补 aid/cid
//        c) 选集高亮 (brx-episode-selected)
//        d) FETCH_PLAYURL 拉 BiliRoaming DASH JSON
//        e) mountPlayer() 创建 ArtPlayer + dash.js
//        f) unhideCommentModule() + switchBiliComments() 修评论 lazy-load
//
// 单飞保护（事务管理）：
//   - startTxnSeq  单调递增
//   - inFlightKey  标记正在请求的 epId:cid
//   - pendingCandidateKey 标记排队中的候选
//   - 每个 await 阶段后用 abortIfStale() 检查自己是否仍是最新的，旧事务直接 return，
//     避免旧 playurl 响应覆盖新播放器（修复历史：VisionPlayer 时代并发竞态）。
//
// 防御层次：
//   - MAIN world 已经在 isGmtOnly() 拦过；ISOLATED 看不到 __playinfo__，用 context.limited + 标题正则。
//   - context.epId 缺失时直接 return（无 epId 服务端 -412）。
//   - playurl.code !== 0 抛错。
//   - mountPlayer 完成后再次 abortIfStale 再交接高亮/评论逻辑。

import { BRX } from '../common/constants.mjs';
import { createLogger } from '../common/logger.mjs';
import { stripAreaLimitUi, unhideCommentModule, switchBiliComments } from '../common/dom.mjs';
import { PageBridge, sendRuntime } from './bridge.mjs';
import { mountPlayer } from './player/mountPlayer.mjs';

const log = createLogger('[BRX-Player CONTENT]');
let currentController = null;
let lastKey = '';
let currentEpId = null;
let highlightObserver = null;

// 启动/切集事务管理：保证快速连点、SPA 多次通知、定时兜底通知并发时，
// 只有最新且未被去重的事务可以继续挂载播放器，避免旧请求后返回覆盖新播放器。
let startTxnSeq = 0;
let inFlightKey = '';
let pendingCandidateKey = '';

function makeContextKey(context = {}) {
  const ep = context.epId || '';
  const cid = context.cid || '';
  if (!ep && !cid) return '';
  return [ep, cid].join(':');
}

function isSameMountedKey(key) {
  return !!key && key === lastKey && !!currentController;
}

function beginStartTransaction(candidateKey, reason) {
  if (candidateKey && (isSameMountedKey(candidateKey) || candidateKey === inFlightKey || candidateKey === pendingCandidateKey)) {
    log.debug('skip duplicate start transaction', { candidateKey, reason });
    return null;
  }
  if (candidateKey) pendingCandidateKey = candidateKey;
  const id = ++startTxnSeq;
  return { id, candidateKey, reason };
}

function isCurrentTransaction(tx) {
  return !!tx && tx.id === startTxnSeq;
}

function finishStartTransaction(tx, finalKey = '') {
  if (tx?.candidateKey && pendingCandidateKey === tx.candidateKey) pendingCandidateKey = '';
  if (finalKey && inFlightKey === finalKey) inFlightKey = '';
}

function abortIfStale(tx, stage) {
  if (isCurrentTransaction(tx)) return false;
  log.debug('drop stale start transaction', { stage, tx: tx?.id, current: startTxnSeq, reason: tx?.reason });
  return true;
}

export async function startContentApp() {
  if (window.__BRX_PLAYER_CONTENT_APP__) return;
  window.__BRX_PLAYER_CONTENT_APP__ = true;
  ensureEpisodeHighlightStyle();
  installEpisodeHighlightObserver();

  const bridge = new PageBridge(log);
  bridge.on(BRX.START, (p) => handleStart(p, 'auto'));
  bridge.on(BRX.EPISODE_SELECT, (p) => handleStart(p, 'episode-select'));
  bridge.start();

  // popup.js 的 readKey() 通过 chrome.tabs.sendMessage 调用本处理器，从 localStorage
  // 读 access_key 回投。ISOLATED 能访问 B 站页面的 localStorage（同一 document）。
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'BRX_PLAYER_READ_ACCESS_KEY') {
      sendResponse({ accessKey: localStorage.getItem('access_key') || localStorage.access_key || '' });
      return true;
    }
  });

  log.info('content app started');
}

async function handleStart(payload, reason) {
  const context0 = payload.context || {};
  const tx = beginStartTransaction(makeContextKey(context0), reason);
  if (!tx) return;

  let key = '';
  try {
    const cfg = await sendRuntime('GET_CONFIG', {});
    if (abortIfStale(tx, 'get-config')) return;
    if (!cfg.enabled) return;

    // 防御：仅在"港澳台限定"番剧上激活。内地番剧（国创）不应被处理。
    // 双重检查：MAIN world 已经在 isGmtOnly() 拦过，但这里再确认一次避免误伤。
    // 注意：ISOLATED world 看不到 window.__playinfo__，所以用 MAIN 传来的 context.limited + 标题正则。
    const title = context0.title || document.title || '';
    const isGmt = /僅限港澳台地區|仅限港澳台地区/.test(title);
    const isLimited = !!context0.limited;
    if (!isGmt || !isLimited) {
      log.info('skip non-GMT page', { title, isGmt, isLimited, reason });
      return;
    }

    // 非破坏性合并：只填补缺失字段，绝不用 null/'' 覆盖已有值。
    // 修复历史：曾因 FETCH_EP_INFO 用错端点返回 {cid:null}，把 MAIN 已经传过来的有效 cid 覆盖。
    let context = { ...context0 };
    if (context.epId) {
      try {
        const patch = await sendRuntime('FETCH_EP_INFO', { epId: context.epId });
        if (abortIfStale(tx, 'fetch-ep-info')) return;
        for (const k of ['epId', 'aid', 'cid', 'bvid', 'duration']) {
          const v = patch?.[k];
          if (v !== undefined && v !== null && v !== '') context[k] = v;
          else if (context[k] === undefined || context[k] === null || context[k] === '') context[k] = v;
        }
      } catch (err) {
        if (abortIfStale(tx, 'fetch-ep-info-error')) return;
        log.warn('fetch episode info failed', context.epId, err);
      }
    }
    if (context.epId) {
      currentEpId = Number(context.epId);
      updateEpisodeHighlight(currentEpId);
    }

    key = makeContextKey(context);
    if (isSameMountedKey(key)) return;
    if (key && inFlightKey && key === inFlightKey) {
      log.debug('skip duplicate in-flight start transaction', { key, reason });
      return;
    }
    if (!context.epId && !context.cid) return;
    lastKey = key;
    inFlightKey = key;

    window.__BRX_PLAYER_DEBUG__ = { state: 'fetching-playurl', context, reason, tx: tx.id };
    stripAreaLimitUi();

    const playurl = await sendRuntime('FETCH_PLAYURL', { context });
    if (abortIfStale(tx, 'fetch-playurl')) return;
    if (!playurl || playurl.code !== 0) throw new Error('playurl failed: ' + JSON.stringify(playurl));

    if (currentController) {
      try { currentController.destroy(); } catch (_) {}
    }
    currentController = await mountPlayer({ playurl, context, config: cfg, log });
    if (abortIfStale(tx, 'mount-player')) {
      try { currentController?.destroy?.(); } catch (_) {}
      currentController = null;
      return;
    }
    if (context.epId) updateEpisodeHighlight(context.epId);

    // 受限页 B 站 React 会把评论区设为 display:none，导致 <bili-comments lazy-load>
    // 永远不触发。解锁后把评论区显示出来，IntersectionObserver 在用户滚动到评论区时
    // 会自动触发 lazy-load 拉取评论。
    unhideCommentModule();

    // 我们拦截了集数 click，没有走 B 站原生 React 流程，<bili-comments> 不会自动切集。
    // 手动更新 web component 的 oid/type 并 reload 拉新评论。
    if (context.aid) {
      const switched = switchBiliComments({ oid: context.aid, type: 1 });
      log.info('switchBiliComments', { epId: context.epId, aid: context.aid, switched });
    }

    window.__BRX_PLAYER_DEBUG__ = {
      state: 'mounted',
      context,
      playurlSummary: summarize(playurl),
      controller: currentController,
      tx: tx.id,
    };
  } finally {
    finishStartTransaction(tx, key);
  }
}

function summarize(resp) {
  // 适配 B 站 playurl v2 多种嵌套位置（result.dash / result.video_info.dash / data.dash）。
  const dash = resp?.result?.dash || resp?.result?.video_info?.dash || resp?.dash || resp?.data?.dash;
  return { video: dash?.video?.length || 0, audio: dash?.audio?.length || 0, duration: dash?.duration || 0 };
}

// ====== 选集高亮 ======
// 在 B 站原生选集列表 a[href*="/bangumi/play/ep"] 上叠加 .brx-episode-selected。
// 同步识别 B 站 CSS Module 选集高亮 class（numberListItem_select__xxx）并保留，
// 不与原生选中态冲突。

function ensureEpisodeHighlightStyle() {
  if (document.getElementById('brx-episode-highlight-style')) return;
  const style = document.createElement('style');
  style.id = 'brx-episode-highlight-style';
  style.textContent = `
    .brx-episode-selected {
      color: #00aeec !important;
      border-color: #00aeec !important;
      background: rgba(0, 174, 236, .12) !important;
      box-shadow: inset 0 0 0 1px #00aeec !important;
    }
    .brx-episode-selected * { color: #00aeec !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function installEpisodeHighlightObserver() {
  if (highlightObserver) return;
  highlightObserver = new MutationObserver(() => {
    if (currentEpId) updateEpisodeHighlight(currentEpId, false);
  });
  highlightObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function updateEpisodeHighlight(epId, scrollIntoView = true) {
  epId = Number(epId);
  if (!epId) return;
  currentEpId = epId;

  const links = [...document.querySelectorAll('a[href*="/bangumi/play/ep"]')];
  if (!links.length) return;

  const selectedClass = findNativeSelectedClass(links);
  for (const a of links) {
    const item = a.parentElement || a;
    item.classList.remove('brx-episode-selected');
    a.classList.remove('brx-episode-selected');
    removeCssModuleSelectedClasses(item);
    removeCssModuleSelectedClasses(a);
  }

  const target = links.find((a) => {
    const m = (a.getAttribute('href') || a.href || '').match(/ep(\d+)/);
    return m && Number(m[1]) === epId;
  });
  if (!target) return;

  const item = target.parentElement || target;
  item.classList.add('brx-episode-selected');
  target.classList.add('brx-episode-selected');
  if (selectedClass) item.classList.add(selectedClass);
  target.setAttribute('aria-current', 'true');

  if (scrollIntoView) {
    try { item.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
  }
}

function findNativeSelectedClass(links) {
  for (const a of links) {
    for (const el of [a, a.parentElement, a.parentElement?.parentElement]) {
      if (!el || !el.classList) continue;
      const cls = [...el.classList].find((c) => /(?:^|_)select(?:_|$)/i.test(c) || /selected/i.test(c));
      if (cls && /numberListItem|episode|ep|select/i.test(cls)) return cls;
    }
  }
  return '';
}

function removeCssModuleSelectedClasses(el) {
  if (!el || !el.classList) return;
  for (const cls of [...el.classList]) {
    if (/numberListItem_select__/i.test(cls) || cls === 'brx-episode-selected') el.classList.remove(cls);
  }
  el.removeAttribute('aria-current');
}
