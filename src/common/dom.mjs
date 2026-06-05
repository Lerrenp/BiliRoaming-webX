// 跨世界共用的 DOM 工具集。
// waitForElement —— 通用选择器等待（MutationObserver），用于等播放器容器出现。
// stripAreaLimitUi —— 移除 B 站原生区域限制 UI 残留（big-block-panel / areaLimit 节点）。
// getCookie —— 同步读取 cookie（dash.js / m4s 鉴权需要 buvid3）。
// unhideCommentModule —— 修复 #comment-module 被 B 站 React 设为 display:none 的问题。
// switchBiliComments —— 切集后手动重载 <bili-comments> web component（PGC: type=1+aid；UGC: type=11+avid）。

export function waitForElement(selector, timeoutMs = 15000) {
  const existed = document.querySelector(selector);
  if (existed) return Promise.resolve(existed);
  return new Promise((resolve, reject) => {
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { clearTimeout(timer); obs.disconnect(); resolve(el); }
    });
    const timer = setTimeout(() => {
      obs.disconnect();
      reject(new Error('waitForElement timeout: ' + selector));
    }, timeoutMs);
    obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  });
}

export function stripAreaLimitUi(root = document) {
  // 清除 B 站原生播放器的区域限制遮罩和错误浮层。
  // 覆盖选择器：big-block-panel（旧版浮层）、bpx-player-error-wrap（播放器错误容器）、
  // 以及任何 class 名含 areaLimit / AreaLimit 的元素。
  ['#big-block-panel', '.bpx-player-error-wrap', '[class*="areaLimit"]', '[class*="AreaLimit"]']
    .forEach(sel => root.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; }));
}

export function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

// 受限页时 B 站 React 会把 #comment-module 设为 display:none，
// 导致 <bili-comments lazy-load="true"> 的 IntersectionObserver 永远不触发，
// 评论永远不加载。把模块显示出来，lazy-load 会在用户滚动到评论区时自动触发。
// MutationObserver 防止 React 在我们解锁后再次 re-render 把 display 改回 none。
let commentUnhideObserver = null;
export function unhideCommentModule(root = document) {
  const cm = root.querySelector('#comment-module');
  if (!cm) return false;
  cm.style.display = 'block';
  cm.style.visibility = 'visible';
  cm.removeAttribute('aria-hidden');
  if (!commentUnhideObserver) {
    commentUnhideObserver = new MutationObserver(() => {
      const el = document.querySelector('#comment-module');
      if (!el) return;
      const cur = getComputedStyle(el).display;
      if (cur === 'none' || el.getAttribute('aria-hidden') === 'true') {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.removeAttribute('aria-hidden');
      }
    });
    commentUnhideObserver.observe(document.documentElement || document.body, {
      attributes: true, subtree: true, attributeFilter: ['style', 'class', 'aria-hidden'],
    });
  }
  return true;
}

// 切集后 B 站原生 React 不会重渲染 <bili-comments>（我们拦截了 click 走自己的播放链路），
// 旧 oid 的评论会一直挂着。直接改 web component 的 oid/type 并 reload。
// PGC 用 type=1, oid=aid；UGC 用 type=11, oid=av 号。
export function switchBiliComments({ oid, type = 1, mode = 3 } = {}) {
  const bc = document.querySelector('bili-comments');
  if (!bc) return false;
  const newOid = oid != null ? String(oid) : bc.oid;
  const newType = type != null ? Number(type) : Number(bc.type);
  if (bc.oid === newOid && Number(bc.type) === newType) return false;
  bc.oid = newOid;
  bc.type = newType;
  bc.setAttribute('data-params', newType + ',' + newOid);
  try { if (typeof bc.unload === 'function') bc.unload(); } catch (_) {}
  try { if (typeof bc.load === 'function') bc.load(); } catch (_) {}
  return true;
}
