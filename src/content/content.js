// ISOLATED world 引导入口。
// 动态 import app.mjs 是为了绕开 content_scripts 列表的静态限制，把 ESM 入口
// 放进 web_accessible_resources 后用 chrome.runtime.getURL 取真实 URL。
// 防重复：window.__BRX_PLAYER_CONTENT_BOOTSTRAPPED__ 标志避免被反复挂载。
(async () => {
  if (window.__BRX_PLAYER_CONTENT_BOOTSTRAPPED__) return;
  window.__BRX_PLAYER_CONTENT_BOOTSTRAPPED__ = true;
  try {
    const url = chrome.runtime.getURL('src/content/app.mjs');
    console.info('[BRX-Player CONTENT] dynamic import', url);
    const mod = await import(url);
    await mod.startContentApp();
  } catch (err) {
    console.error('[BRX-Player CONTENT] bootstrap failed', err && (err.stack || err.message || err), err);
    throw err;
  }
})();
