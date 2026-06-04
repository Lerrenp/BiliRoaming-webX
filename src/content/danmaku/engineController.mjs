export async function startDanmaku({ layer, video, context, config, log }) {
  try {
    const mod = await import(chrome.runtime.getURL('vendor/danmaku-lite.canvas.mjs'));
    const createEngine = mod.createEngine;
    if (!createEngine) throw new Error('danmaku-lite createEngine not found');

    const state = {
      enabled: !!config.danmakuEnabled,
      opacity: clamp(Number(config.danmakuOpacity || 0.95), 0.2, 1),
      area: clamp(Number(config.danmakuArea || 0.75), 0.25, 1),
      fontSize: clamp(Number(config.danmakuFontSize || 25), 12, 64),
      speed: clamp(Number(config.danmakuSpeed || 1), 0.5, 3),
      maxVisible: Math.max(0, Number(config.danmakuMaxVisible || 120)),
    };

    const engine = createEngine('canvas', {
      container: layer,
      adapter: {
        get position() { return video.currentTime || 0; },
        get paused() { return video.paused; },
        get duration() { return video.duration || 0; },
      },
      enabled: state.enabled,
      fontFamily: 'Noto Sans SC, Microsoft YaHei, sans-serif',
      fontSize: state.fontSize,
      opacity: state.opacity,
      area: state.area,
      speed: state.speed,
      maxVisible: state.maxVisible,
    });

    const items = await fetchXmlDanmaku(context.cid, log);
    engine.load(items);
    applyState();

    const onResize = () => resizeSoon(engine);
    const onLoadedMetadata = () => resizeSoon(engine);
    const onSeeked = () => resizeSoon(engine);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('seeked', onSeeked);
    queueMicrotask(onResize);
    setTimeout(onResize, 300);
    log.info('danmaku loaded', { cid: context.cid, count: items.length, state });

    function applyState() {
      layer.style.display = state.enabled ? '' : 'none';
      engine.setEnabled?.(state.enabled);
      engine.setOpacity?.(state.opacity);
      engine.setArea?.(state.area);
      engine.setFontSize?.(state.fontSize);
      engine.setSpeed?.(state.speed);
      engine.setMaxVisible?.(state.maxVisible);
      resizeSoon(engine);
    }

    return {
      engine,
      count: items.length,
      getState() { return { ...state }; },
      setEnabled(enabled) {
        state.enabled = !!enabled;
        applyState();
      },
      setOpacity(opacity) {
        state.opacity = clamp(Number(opacity) || 1, 0.2, 1);
        applyState();
      },
      setArea(area) {
        state.area = clamp(Number(area) || 1, 0.25, 1);
        applyState();
      },
      setFontSize(fontSize) {
        state.fontSize = clamp(Number(fontSize) || 25, 12, 64);
        applyState();
      },
      setSpeed(speed) {
        state.speed = clamp(Number(speed) || 1, 0.5, 3);
        applyState();
      },
      setMaxVisible(maxVisible) {
        state.maxVisible = Math.max(0, Number(maxVisible) || 0);
        applyState();
      },
      resize() { resizeSoon(engine); },
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

function resizeSoon(engine) {
  try { engine.resize?.(); } catch (_) {}
  requestAnimationFrame(() => {
    try { engine.resize?.(); } catch (_) {}
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
