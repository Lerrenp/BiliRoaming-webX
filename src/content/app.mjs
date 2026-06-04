import { BRX } from '../common/constants.mjs';
import { createLogger } from '../common/logger.mjs';
import { stripAreaLimitUi } from '../common/dom.mjs';
import { PageBridge, sendRuntime } from './bridge.mjs';
import { mountPlayer } from './player/mountPlayer.mjs';

const log = createLogger('[BRX-Player CONTENT]');
let currentController = null;
let lastKey = '';
let currentEpId = null;
let highlightObserver = null;

export async function startContentApp() {
  if (window.__BRX_PLAYER_CONTENT_APP__) return;
  window.__BRX_PLAYER_CONTENT_APP__ = true;
  ensureEpisodeHighlightStyle();
  installEpisodeHighlightObserver();

  const bridge = new PageBridge(log);
  bridge.on(BRX.START, (p) => handleStart(p, 'auto'));
  bridge.on(BRX.EPISODE_SELECT, (p) => handleStart(p, 'episode-select'));
  bridge.start();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'BRX_PLAYER_READ_ACCESS_KEY') {
      sendResponse({ accessKey: localStorage.getItem('access_key') || localStorage.access_key || '' });
      return true;
    }
  });

  log.info('content app started');
}

async function handleStart(payload, reason) {
  const cfg = await sendRuntime('GET_CONFIG', {});
  if (!cfg.enabled) return;

  let context = { ...(payload.context || {}) };
  if (context.epId) {
    try {
      const patch = await sendRuntime('FETCH_EP_INFO', { epId: context.epId });
      // 非破坏性合并：只填补缺失字段，绝不用 null/'' 覆盖已有值。
      // 修复历史：曾因 FETCH_EP_INFO 用错端点返回 {cid:null}，把 MAIN 已经传过来的有效 cid 覆盖。
      for (const k of ['epId', 'aid', 'cid', 'bvid', 'duration']) {
        const v = patch?.[k];
        if (v !== undefined && v !== null && v !== '') context[k] = v;
        else if (context[k] === undefined || context[k] === null || context[k] === '') context[k] = v;
      }
    } catch (err) {
      log.warn('fetch episode info failed', context.epId, err);
    }
  }
  if (context.epId) {
    currentEpId = Number(context.epId);
    updateEpisodeHighlight(currentEpId);
  }

  const key = [context.epId || '', context.cid || ''].join(':');
  if (key === lastKey && currentController) return;
  if (!context.epId && !context.cid) return;
  lastKey = key;

  window.__BRX_PLAYER_DEBUG__ = { state: 'fetching-playurl', context, reason };
  stripAreaLimitUi();

  const playurl = await sendRuntime('FETCH_PLAYURL', { context });
  if (!playurl || playurl.code !== 0) throw new Error('playurl failed: ' + JSON.stringify(playurl));

  if (currentController) {
    try { currentController.destroy(); } catch (_) {}
  }
  currentController = await mountPlayer({ playurl, context, config: cfg, log });
  if (context.epId) updateEpisodeHighlight(context.epId);

  window.__BRX_PLAYER_DEBUG__ = {
    state: 'mounted',
    context,
    playurlSummary: summarize(playurl),
    controller: currentController,
  };
}

function summarize(resp) {
  const dash = resp?.result?.dash || resp?.result?.video_info?.dash || resp?.dash || resp?.data?.dash;
  return { video: dash?.video?.length || 0, audio: dash?.audio?.length || 0, duration: dash?.duration || 0 };
}

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
