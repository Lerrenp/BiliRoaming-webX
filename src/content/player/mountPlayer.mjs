import { waitForElement, stripAreaLimitUi } from '../../common/dom.mjs';
import { extractDash, uniqueQualities, uniqueCodecs, audioOptions, createMpdUrl, selectStreams } from './dashMpdBuilder.mjs';

export async function mountPlayer({ playurl, context, config, log }) {
  const dash = extractDash(playurl);
  if (!dash || !dash.video?.length) throw new Error('No DASH video in playurl response');

  await ensureVendorLoaded();

  const target = await waitForElement('#bilibili-player, .bpx-player-container');
  const outer = target.id === 'bilibili-player' ? target : (target.closest('#bilibili-player') || target);
  outer.style.position = 'relative';
  outer.querySelectorAll('.brx-player-root').forEach((el) => el.remove());
  stripAreaLimitUi(outer);

  const root = document.createElement('div');
  root.className = 'brx-player-root brx-artplayer-root';
  root.innerHTML = `
    <div class="brx-artplayer-box"></div>
    <div class="brx-status">BiliRoaming-X ArtPlayer</div>
  `;
  const style = document.createElement('style');
  style.textContent = cssText();
  root.appendChild(style);
  outer.appendChild(root);

  for (const v of outer.querySelectorAll('video')) {
    if (!v.closest('.brx-player-root')) v.style.opacity = '0';
  }

  const artBox = root.querySelector('.brx-artplayer-box');
  const status = root.querySelector('.brx-status');

  const qualities = uniqueQualities(dash.video || []);
  const codecs = uniqueCodecs(dash.video || []);
  const audios = audioOptions(dash.audio || dash.dolby?.audio || []);
  let selection = {
    qn: config.defaultQn || '80',
    codec: config.defaultCodec || 'auto',
    audioId: config.defaultAudioId || 'auto',
  };
  if (!qualities.some((q) => q.id === selection.qn)) selection.qn = qualities[0]?.id || 'auto';

  let mpdObjectUrl = '';
  let art = null;
  let dashPlayer = null;
  let resizeObserver = null;

  function nextMpdUrl() {
    if (mpdObjectUrl) URL.revokeObjectURL(mpdObjectUrl);
    const mpd = createMpdUrl(dash, selection);
    mpdObjectUrl = mpd.url;
    window.__BRX_PLAYER_LAST_MPD__ = mpd.xml;
    return mpdObjectUrl;
  }

  function playMpd(video, url, artInstance) {
    if (!window.dashjs?.supportsMediaSource?.()) {
      artInstance.notice.show = '当前浏览器不支持 DASH/MSE';
      return;
    }
    if (artInstance.dash) {
      try { artInstance.dash.reset?.(); } catch (_) {}
      try { artInstance.dash.destroy?.(); } catch (_) {}
    }
    const player = window.dashjs.MediaPlayer().create();
    dashPlayer = player;
    artInstance.dash = player;
    player.updateSettings({
      streaming: {
        buffer: { fastSwitchEnabled: true },
        abr: { autoSwitchBitrate: { video: selection.qn === 'auto' } },
      },
    });
    player.on(window.dashjs.MediaPlayer.events.ERROR, (e) => {
      status.textContent = '播放错误: ' + JSON.stringify(e.error || e.event || e).slice(0, 180);
      status.style.opacity = '1';
    });
    player.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      status.textContent = labelSelection(selection);
      status.style.opacity = '1';
      setTimeout(() => { status.style.opacity = '0'; }, 1800);
    });
    player.initialize(video, url, artInstance.option.autoplay);
  }

  art = new window.Artplayer({
    container: artBox,
    url: nextMpdUrl(),
    type: 'mpd',
    autoplay: true,
    pip: false,
    autoSize: false,
    autoMini: false,
    screenshot: false,
    setting: true,
    playbackRate: true,
    aspectRatio: true,
    fullscreen: true,
    fullscreenWeb: true,
    mutex: false,
    theme: '#00aeec',
    customType: { mpd: playMpd },
    settings: createArtSettings(),
    plugins: createArtPlugins(),
  });

  art.on('ready', async () => {
    installResizeRelay();
    window.__BRX_PLAYER_DEBUG__ = Object.assign(window.__BRX_PLAYER_DEBUG__ || {}, { art, dashPlayer });
  });

  for (const eventName of ['resize', 'fullscreen', 'fullscreenWeb', 'mini', 'pip', 'document-pip']) {
    art.on(eventName, () => {});
  }
  document.addEventListener('fullscreenchange', onGlobalFullscreenChange);

  async function reloadWithSelection(next) {
    selection = next;
    const video = art?.video;
    const t = video?.currentTime || 0;
    const paused = video ? video.paused : false;
    status.textContent = '切换到 ' + labelSelection(selection);
    status.style.opacity = '1';
    if (art) art.url = nextMpdUrl();
    const onMeta = () => {
      try { art.video.currentTime = t; } catch (_) {}
      if (!paused) art.video.play().catch(() => {});
      art.video.removeEventListener('loadedmetadata', onMeta);
    };
    art?.video?.addEventListener('loadedmetadata', onMeta);
  }

  function createArtSettings() {
    return [
      {
        html: '清晰度',
        tooltip: qualities.find((q) => q.id === selection.qn)?.label || '自动清晰度',
        selector: [{ html: '自动清晰度', value: 'auto', default: selection.qn === 'auto' }, ...qualities.map((q) => ({ html: q.label, value: q.id, default: q.id === selection.qn }))],
        onSelect: (item) => { reloadWithSelection({ ...selection, qn: item.value }); return item.html; },
      },
      {
        html: '编码',
        tooltip: codecs.find((c) => c.id === selection.codec)?.label || '自动编码',
        selector: codecs.map((c) => ({ html: c.label, value: c.id, default: c.id === selection.codec })),
        onSelect: (item) => { reloadWithSelection({ ...selection, codec: item.value }); return item.html; },
      },
      {
        html: '音轨',
        tooltip: audios.find((a) => a.id === selection.audioId)?.label || '自动音轨',
        selector: audios.map((a) => ({ html: a.label, value: a.id, default: a.id === selection.audioId })),
        onSelect: (item) => { reloadWithSelection({ ...selection, audioId: item.value }); return item.html; },
      },
    ];
  }

  function createArtPlugins() {
    const plugins = [];
    if (window.artplayerPluginDanmuku) {
      const cid = Number(context?.cid) || 0;
      if (!cid) {
        log.warn('danmuku: skip load, context.cid missing', { context });
      }
      const danmukuUrl = cid ? `https://comment.bilibili.com/${cid}.xml` : [];
      plugins.push(window.artplayerPluginDanmuku({
        danmuku: danmukuUrl,
        speed: 5,
        opacity: 0.9,
        fontSize: 25,
        antiOverlap: true,
        synchronousPlayback: true,
        visible: true,
        emitter: false,
        heatmap: false,
        filter: (danmu) => danmu.text.trim().length > 0,
      }));
    }
    if (window.artplayerPluginDocumentPip) {
      plugins.push(window.artplayerPluginDocumentPip({ width: 640, height: 360, fallbackToVideoPiP: false, placeholder: '正在以画中画播放' }));
    }
    return plugins;
  }

  function installResizeRelay() {
    if (resizeObserver || !window.ResizeObserver) return;
    resizeObserver = new ResizeObserver(() => {});
    if (art?.template?.$player) resizeObserver.observe(art.template.$player);
    if (art?.template?.$container) resizeObserver.observe(art.template.$container);
    if (art?.video) resizeObserver.observe(art.video);
  }

  function onGlobalFullscreenChange() {}

  function labelSelection(sel) {
    const q = sel.qn === 'auto' ? '自动清晰度' : (qualities.find((x) => x.id === sel.qn)?.label || sel.qn);
    const c = sel.codec === 'auto' ? '自动编码' : String(sel.codec).toUpperCase();
    const a = audios.find((x) => x.id === sel.audioId)?.label || '自动音轨';
    const selected = selectStreams(dash, sel);
    return `${q} / ${c} / ${a} (${selected.videos.length}V/${selected.audios.length}A)`;
  }

  return {
    root,
    get art() { return art; },
    get video() { return art?.video || null; },
    get dashPlayer() { return dashPlayer; },
    get selection() { return selection; },
    destroy() {
      document.removeEventListener('fullscreenchange', onGlobalFullscreenChange);
      try { resizeObserver?.disconnect?.(); } catch (_) {}
      try { dashPlayer?.reset?.(); } catch (_) {}
      try { art?.destroy?.(false); } catch (_) {}
      if (mpdObjectUrl) URL.revokeObjectURL(mpdObjectUrl);
      root.remove();
    },
  };
}

async function ensureVendorLoaded() {
  if (!window.Artplayer) throw new Error('ArtPlayer vendor not loaded');
  if (!window.dashjs) throw new Error('dash.js content script not loaded');
}

function cssText() {
  return `.brx-player-root{position:absolute;inset:0;z-index:999;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.brx-artplayer-box{position:absolute;inset:0;background:#000}.brx-artplayer-box .artplayer{width:100%!important;height:100%!important}.brx-status{position:absolute;left:14px;top:12px;z-index:35;background:rgba(0,0,0,.55);padding:6px 10px;border-radius:6px;transition:opacity .35s}`;
}
