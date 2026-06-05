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
