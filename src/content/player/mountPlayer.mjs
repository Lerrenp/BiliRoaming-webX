import { waitForElement, stripAreaLimitUi } from '../../common/dom.mjs';
import { extractDash, uniqueQualities, uniqueCodecs, audioOptions, createMpdUrl, selectStreams } from './dashMpdBuilder.mjs';
import { createQualityPanel } from './qualityPanel.mjs';
import { startDanmaku } from '../danmaku/engineController.mjs';

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
    <div class="brx-danmaku-layer"></div>
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
  const layer = root.querySelector('.brx-danmaku-layer');
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
  let danmaku = null;
  const panel = createQualityPanel({ qualities, codecs, audios, initial: selection, onChange: reloadWithSelection });
  root.appendChild(panel);

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
    pip: true,
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
    const video = art.video;
    danmaku = config.danmakuEnabled ? await startDanmaku({ layer, video, context, config, log }) : null;
    window.__BRX_PLAYER_DEBUG__ = Object.assign(window.__BRX_PLAYER_DEBUG__ || {}, { art, dashPlayer, danmaku });
  });

  async function reloadWithSelection(next) {
    selection = next;
    panel.__brxSetSelection?.(selection);
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
      {
        html: '弹幕',
        switch: !!config.danmakuEnabled,
        onSwitch: (item) => {
          const enabled = !item.switch;
          danmaku?.setEnabled?.(enabled);
          layer.style.display = enabled ? '' : 'none';
          return enabled;
        },
      },
    ];
  }

  function createArtPlugins() {
    // v1.1.0 dash-control expects dash.js v3 API (getBitrateInfoListFor).
    // Current bundled dash.js is v5, and the plugin throws on ArtPlayer ready.
    // Manual BRX quality settings above already provide qn/codec/audio switching.
    return [];
  }

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
    get danmaku() { return danmaku; },
    destroy() {
      try { danmaku?.destroy?.(); } catch (_) {}
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
  return `.brx-player-root{position:absolute;inset:0;z-index:999;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.brx-artplayer-box{position:absolute;inset:0;background:#000}.brx-artplayer-box .artplayer{width:100%!important;height:100%!important}.brx-danmaku-layer{position:absolute;inset:0;pointer-events:none;z-index:31;overflow:hidden;width:100%;height:100%;contain:layout paint}.brx-status{position:absolute;left:14px;top:12px;z-index:35;background:rgba(0,0,0,.55);padding:6px 10px;border-radius:6px;transition:opacity .35s}.brx-quality-panel{position:absolute;right:12px;top:12px;z-index:36;display:flex;gap:8px;align-items:center;background:rgba(0,0,0,.62);padding:8px;border-radius:8px;backdrop-filter:blur(4px);opacity:.25;transition:opacity .2s}.brx-quality-panel:hover{opacity:1}.brx-quality-panel label{font-size:12px;color:#fff;display:flex;gap:4px;align-items:center}.brx-quality-panel select{background:#18191c;color:#fff;border:1px solid #555;border-radius:4px;padding:3px 5px}`;
}
