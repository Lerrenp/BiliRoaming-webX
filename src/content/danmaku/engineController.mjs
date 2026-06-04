export async function startDanmaku({ layer, video, context, config, log }) {
  try {
    const mod = await import(chrome.runtime.getURL('vendor/danmaku-lite.canvas.mjs'));
    const createEngine = mod.createEngine;
    if (!createEngine) throw new Error('danmaku-lite createEngine not found');

    const engine = createEngine('canvas', {
      container: layer,
      adapter: {
        get position() { return video.currentTime || 0; },
        get paused() { return video.paused; },
        get duration() { return video.duration || 0; },
      },
      fontFamily: 'Noto Sans SC, Microsoft YaHei, sans-serif',
      fontSize: Number(config.danmakuFontSize || 25),
      opacity: Number(config.danmakuOpacity || 0.95),
      area: Number(config.danmakuArea || 0.75),
      speed: Number(config.danmakuSpeed || 1),
      maxVisible: Number(config.danmakuMaxVisible || 120),
    });

    const items = await fetchXmlDanmaku(context.cid, log);
    engine.load(items);
    const onResize = () => engine.resize();
    const onLoadedMetadata = () => engine.resize();
    const onSeeked = () => engine.resize();
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('seeked', onSeeked);
    queueMicrotask(onResize);
    setTimeout(onResize, 300);
    log.info('danmaku loaded', { cid: context.cid, count: items.length });

    return {
      engine,
      count: items.length,
      setEnabled(enabled) { engine.setEnabled?.(!!enabled); },
      setOpacity(opacity) { engine.setOpacity?.(Number(opacity) || 1); },
      destroy() {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('fullscreenchange', onResize);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('seeked', onSeeked);
        engine.destroy();
      },
    };
  } catch (err) {
    log.warn('danmaku disabled', err);
    return null;
  }
}

async function fetchXmlDanmaku(cid, log) {
  if (!cid) return [];
  const resp = await fetch('https://comment.bilibili.com/' + cid + '.xml', { credentials: 'include' });
  if (!resp.ok) throw new Error('danmaku xml failed: HTTP ' + resp.status);
  const text = await resp.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const items = [...doc.querySelectorAll('d')]
    .slice(0, 8000)
    .map((d, i) => normalizeBiliXmlDanmaku(d, i))
    .filter(Boolean);
  log.info('danmaku xml parsed', { cid, count: items.length });
  return items;
}

function normalizeBiliXmlDanmaku(d, index) {
  const p = (d.getAttribute('p') || '').split(',');
  const text = (d.textContent || '').trim();
  if (!text) return null;

  const biliMode = Number(p[1]) || 1;
  const mode = mapBiliModeToDanmakuLite(biliMode);
  if (!mode) return null;

  return {
    id: p[7] || index,
    text,
    time: Math.max(0, Number(p[0]) || 0),
    mode,
    color: normalizeColor(p[3]),
    font_size: normalizeFontSize(p[2]),
  };
}

function mapBiliModeToDanmakuLite(mode) {
  // Bili XML: 1/2/3 = scrolling, 4 = bottom, 5 = top, 6 = reverse, 7/8 = special/code.
  // danmaku-lite canvas package: 1 = Scroll, 5 = Top, 6 = Bottom.
  if (mode === 4) return 6;
  if (mode === 5) return 5;
  if (mode === 7 || mode === 8) return 0;
  return 1;
}

function normalizeColor(value) {
  const n = Number(value);
  return Number.isFinite(n) ? (n & 0xffffff) : 0xffffff;
}

function normalizeFontSize(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, 12), 64) : undefined;
}
