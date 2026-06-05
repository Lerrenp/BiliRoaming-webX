// BiliRoaming-webX Player — 播放器挂载核心。
//
// 架构：覆盖式播放（不重写 B 站 Player core）
//   在 #bilibili-player 内追加 .brx-player-root 绝对定位覆盖层，隐藏 B 站原生 <video>，
//   创建 ArtPlayer 接管 video 状态机，dash.js 作为 MSE 引擎消费 MPD Blob。
//
// 关键设计点：
//   - 选择器等待：waitForElement('#bilibili-player, .bpx-player-container') —— 容器可能被
//     React 异步渲染。
//   - 事件栅栏 installPlayerEventFence：bubble 阶段截断 click/dblclick/contextmenu/mouse/
//     pointer/touch/wheel/keydown/keyup，避免 ArtPlayer 内部控件点击冒泡到 B 站原生监听器
//     触发误触（网页全屏 / 暂停 / 选中控件）。
//   - destroy 顺序：clearInterval → subtitle dispose → eventFence cleanup → resizeObserver
//     disconnect → dashPlayer.reset → art.destroy(false) → revokeObjectURL → root.remove，
//     保证切集后无残留音频（修复历史：VisionPlayer 时代 "暂停后音频继续"）。
//   - 切换清晰度/编码/音轨：reloadWithSelection() 重建 MPD Blob，保留 currentTime。
//
// 弹幕：artplayerPluginDanmuku(cid-based https://comment.bilibili.com/<cid>.xml) +
//   chrome.storage.sync.brx_danmaku 持久化。
// 字幕：SubtitleManager 异步拉 /x/v2/subtitle/web/view → VTT Blob → art.subtitle.init。

import { waitForElement, stripAreaLimitUi } from '../../common/dom.mjs';
import { extractDash, uniqueQualities, uniqueCodecs, audioOptions, createMpdUrl, selectStreams } from './dashMpdBuilder.mjs';
import { SubtitleManager } from '../subtitle/subtitlePlugin.mjs';

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
    <div class="brx-status">BiliRoaming-webX ArtPlayer</div>
  `;
  const style = document.createElement('style');
  style.textContent = cssText();
  root.appendChild(style);
  outer.appendChild(root);

  // 播放器覆盖层事件栅栏：允许 ArtPlayer 内部控件先正常处理事件，
  // 但在冒泡离开覆盖层前截断，避免点击/双击/右键等漏到 B 站原生播放器，
  // 触发原生网页全屏、暂停、选中控件等副作用。
  const eventFenceCleanups = installPlayerEventFence(root);

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
  let subtitleManager = null;

  // 从 chrome.storage 加载弹幕已保存设置
  let dmSaved = {};
  try {
    const r = await chrome.storage.sync.get('brx_danmaku');
    if (r.brx_danmaku && typeof r.brx_danmaku.speed === 'number') {
      dmSaved = r.brx_danmaku;
      delete dmSaved.margin;
    } else {
      // 旧数据格式（speed 是 NaN 或不存在），清除
      try { chrome.storage.sync.remove('brx_danmaku'); } catch (_) {}
    }
  } catch (_) {}

  function nextMpdUrl() {
    if (mpdObjectUrl) URL.revokeObjectURL(mpdObjectUrl);
    const mpd = createMpdUrl(dash, selection);
    mpdObjectUrl = mpd.url;
    window.__BRX_PLAYER_LAST_MPD__ = mpd.xml;
    return mpdObjectUrl;
  }

  // ArtPlayer customType 回调：dash.js 接管 <video>。
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

  // 字幕按钮随播放器一起初始化，不用等 ready
  // SubtitleManager 内部用 art.controls.add 挂到 controlsRight
  buildSubtitleControl();
  // 字幕数据异步拉，不阻塞 ready
  loadSubtitle().catch(() => {});

  art.on('ready', async () => {
    installResizeRelay();
    installDanmakuPersistence();
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
      // PGC 场景下 cid 不可缺（缺失会让插件请求 ?oid=null&pid=null → code:-400）。
      // 由 content/app.mjs 的 FETCH_EP_INFO 已确保 cid 非空。
      const cid = Number(context?.cid) || 0;
      if (!cid) log.warn('danmuku: skip load, context.cid missing', { context });
      const danmukuUrl = cid ? `https://comment.bilibili.com/${cid}.xml` : [];
      const dmDefaults = { speed: 5, opacity: 0.9, fontSize: 25, antiOverlap: true, synchronousPlayback: true, visible: true, modes: [0, 1, 2] };
      const dmOpts = { ...dmDefaults, ...dmSaved, danmuku: danmukuUrl, emitter: false, heatmap: false, filter: (d) => d.text.trim().length > 0 };
      plugins.push(window.artplayerPluginDanmuku(dmOpts));
    }
    if (window.artplayerPluginDocumentPip) {
      plugins.push(window.artplayerPluginDocumentPip({ width: 640, height: 360, fallbackToVideoPiP: false, placeholder: '正在以画中画播放' }));
    }
    return plugins;
  }

  // 字幕开关 + 语言切换面板，挂在 controlsRight（右边设置按钮旁边）
  function buildSubtitleControl() {
    if (!art?.template) return;
    subtitleManager = new SubtitleManager({ art, log });
    subtitleManager.buildUI();
  }

  // 拉 B 站 PGC 字幕 → 喂给 SubtitleManager
  async function loadSubtitle() {
    if (!subtitleManager) return;
    const cid = Number(context?.cid);
    const aid = Number(context?.aid);
    if (!cid || !aid) {
      log?.info?.('subtitle: skip, no cid/aid', { context });
      return;
    }
    await subtitleManager.load({ cid, aid });
  }

  function installResizeRelay() {
    if (resizeObserver || !window.ResizeObserver) return;
    resizeObserver = new ResizeObserver(() => {});
    if (art?.template?.$player) resizeObserver.observe(art.template.$player);
    if (art?.template?.$container) resizeObserver.observe(art.template.$container);
    if (art?.video) resizeObserver.observe(art.video);
  }

  let dmSaveTimer = null;
  function installDanmakuPersistence() {
    // ArtPlayer 插件挂在 art.plugins 上，属性名是 plugin 返回值的 name。
    // 实际值：art.plugins.artplayerPluginDanmuku 或 art.plugins.danmuku（向后兼容）。
    const readOpt = () => {
      try {
        const p = art.plugins || {};
        const inst = p.artplayerPluginDanmuku || p.danmuku;
        return inst?.option || null;
      } catch (_) { return null; }
    };
    const save = () => {
      const opt = readOpt(); if (!opt) return;
      try {
        chrome.storage.sync.set({ brx_danmaku: {
          visible: opt.visible !== false,
          speed: opt.speed,
          opacity: opt.opacity,
          fontSize: opt.fontSize,
          antiOverlap: opt.antiOverlap,
          synchronousPlayback: opt.synchronousPlayback,
          modes: Array.isArray(opt.modes) ? [...opt.modes] : [0, 1, 2],
        } });
      } catch (_) {}
    };
    save();
    dmSaveTimer = setInterval(save, 3000);
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
      if (dmSaveTimer) { clearInterval(dmSaveTimer); dmSaveTimer = null; }
      try { subtitleManager?.dispose?.(); } catch (_) {}
      subtitleManager = null;
      for (const cleanup of eventFenceCleanups) {
        try { cleanup(); } catch (_) {}
      }
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
  // ISOLATED content_scripts 列表里已经预先注入了 vendor/dash.all.min.js + artplayer.js，
  // 这里只做存在性检查，不再二次加载。
  if (!window.Artplayer) throw new Error('ArtPlayer vendor not loaded');
  if (!window.dashjs) throw new Error('dash.js content script not loaded');
}

// 事件栅栏：在 .brx-player-root 上注册 bubble 阶段 stopPropagation，阻止
// 控件点击冒泡到 #bilibili-player / B 站原生播放器监听器。capture 阶段不拦截，
// ArtPlayer 内部子控件仍能正常处理事件。
function installPlayerEventFence(root) {
  const cleanups = [];
  const events = [
    'click', 'dblclick', 'contextmenu',
    'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend',
    'wheel', 'keydown', 'keyup',
  ];
  for (const eventName of events) {
    const handler = (e) => {
      if (e.eventPhase !== Event.BUBBLING_PHASE) return;
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    root.addEventListener(eventName, handler, false);
    cleanups.push(() => root.removeEventListener(eventName, handler, false));
  }
  return cleanups;
}

function cssText() {
  return `.brx-player-root{position:absolute;inset:0;z-index:999;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.brx-artplayer-box{position:absolute;inset:0;background:#000}.brx-artplayer-box .artplayer{width:100%!important;height:100%!important}.brx-status{position:absolute;left:14px;top:12px;z-index:35;background:rgba(0,0,0,.55);padding:6px 10px;border-radius:6px;transition:opacity .35s}`;
}
