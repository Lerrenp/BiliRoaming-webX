// 字幕管理器
import { fetchBiliSubtitleVtt } from './biliSubtitle.mjs';

const ICON_CC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>';
const ICON_CC_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z" opacity="0.45"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.6"/></svg>';

const PANEL_CSS = `
.brx-subtitle-panel {
  position: absolute;
  bottom: calc(var(--art-control-height) + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 35;
  display: none;
  min-width: 180px;
  padding: 6px 0;
  background: rgba(0,0,0,.78);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  user-select: none;
}
.brx-subtitle-panel.open { display: block; }
.brx-subtitle-item {
  padding: 6px 14px;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
}
.brx-subtitle-item:hover { background: rgba(255,255,255,.08); }
.brx-subtitle-item.current { color: #00aeec; }
.brx-subtitle-item .brx-check {
  width: 14px; height: 14px;
  display: inline-block;
  border: 1.5px solid rgba(255,255,255,.4);
  border-radius: 50%;
  flex-shrink: 0;
}
.brx-subtitle-item.current .brx-check {
  background: #00aeec;
  border-color: #00aeec;
  box-shadow: inset 0 0 0 2px rgba(0,0,0,.85);
}
.brx-subtitle-empty {
  padding: 8px 14px;
  color: rgba(255,255,255,.55);
  font-size: 12px;
}
.brx-subtitle-toggle {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 10px;
  cursor: pointer;
  opacity: var(--art-control-opacity);
  transition: opacity var(--art-transition-duration) ease;
}
.brx-subtitle-toggle:hover { opacity: 1; }
.brx-subtitle-toggle.is-off { opacity: 0.4; }
`;

let styleInjected = false;
function ensureStyle() {
  if (styleInjected) return;
  const el = document.createElement('style');
  el.textContent = PANEL_CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

export class SubtitleManager {
  constructor({ art, log }) {
    this.art = art;
    this.log = log;
    this.tracks = [];
    this.currentIndex = -1;
    this._abort = null;
    this._uiBuilt = false;
  }

  async load({ cid, aid, type = 1 }) {
    if (this._abort) { try { this._abort.abort(); } catch (_) {} }
    this._abort = new AbortController();
    this.disposeOldBlobUrls();
    this.tracks = [];
    this.currentIndex = -1;
    if (!cid || !aid) return [];
    try {
      const result = await fetchBiliSubtitleVtt(
        { cid, aid, type },
        { signal: this._abort.signal, log: this.log }
      );
      if (!result) {
        this.log?.info?.('subtitle: no tracks for episode', { cid, aid });
      } else {
        this.tracks = [{
          lan: result.lan,
          lanDoc: result.lanDoc,
          blobUrl: result.blobUrl,
          itemCount: result.itemCount,
        }];
        this.currentIndex = 0;
        this._apply();
        this.log?.info?.('subtitle: track loaded', { lan: result.lan, items: result.itemCount });
      }
    } catch (err) {
      if (err?.name === 'AbortError') return this.tracks;
      this.log?.warn?.('subtitle: track load failed', err);
    }
    if (this._uiBuilt) this._refreshUI();
    return this.tracks;
  }

  switchTo(idx) {
    if (idx < -1 || idx >= this.tracks.length) return;
    this.currentIndex = idx;
    this._apply();
    if (this._uiBuilt) this._refreshUI();
  }

  show() {
    if (this.tracks.length === 0) return;
    if (this.currentIndex === -1) this.currentIndex = 0;
    this._apply();
    if (this._uiBuilt) this._refreshUI();
  }

  hide() {
    this.currentIndex = -1;
    this._apply();
    if (this._uiBuilt) this._refreshUI();
  }

  isOff() { return this.currentIndex === -1; }

  dispose() {
    if (this._abort) { try { this._abort.abort(); } catch (_) {} this._abort = null; }
    this.disposeOldBlobUrls();
    this.tracks = [];
    if (this._ui) {
      const t = this._ui.toggle;
      const p = this._ui.panel;
      if (t?.parentNode) t.parentNode.removeChild(t);
      if (p?.parentNode) p.parentNode.removeChild(p);
    }
    this._ui = null;
    this._uiBuilt = false;
  }

  disposeOldBlobUrls() {
    for (const t of this.tracks) {
      if (t.blobUrl) { try { URL.revokeObjectURL(t.blobUrl); } catch (_) {} }
    }
  }

  _apply() {
    if (!this.art?.subtitle?.init) return;
    // ArtPlayer 的 subtitle 系统依赖一个已有的 <track> 元素来给 textTrack 赋值。
    // 如果构造函数里没设 subtitle.url，就不会创建 track，后续 init() 会直接 return null。
    // 先插入一个最小空 VTT 的 track，再 init 走正常流程就会替换掉它。
    if (!this.art.subtitle.textTrack) {
      const dummyUrl = URL.createObjectURL(new Blob(['WEBVTT\n\n'], { type: 'text/vtt' }));
      try {
        this.art.subtitle.createTrack('metadata', dummyUrl);
      } catch (_) {
        // createTrack 可能也在内部检查了条件，静默
      }
    }
    const track = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
    if (track) {
      this.art.subtitle.init({
        url: track.blobUrl,
        type: 'vtt',
        name: track.lanDoc || track.lan || 'Subtitle',
        style: {},
        encoding: 'utf-8',
        escape: false,
        onVttLoad: (vtt) => vtt,
      });
    } else {
      try {
        const tt = this.art.template?.$video?.textTracks?.[0];
        if (tt) { tt.mode = 'disabled'; }
      } catch (_) {}
    }
  }

  buildUI() {
    if (this._uiBuilt || !this.art?.template) return;
    ensureStyle();
    const $right = this.art.template.$controlsRight;
    if (!$right) return;

    // toggle 塞进 controlsRight 的第一个位置（设置按钮左边 = 弹幕与设置之间）
    const toggle = document.createElement('div');
    toggle.className = 'brx-subtitle-toggle';
    toggle.title = '字幕';
    toggle.innerHTML = ICON_CC;
    if ($right.firstChild) {
      $right.insertBefore(toggle, $right.firstChild);
    } else {
      $right.appendChild(toggle);
    }

    // 弹出面板挂到播放器容器上（绝对定位），防止被 controls 的 flex 挤压
    const panel = document.createElement('div');
    panel.className = 'brx-subtitle-panel';
    this.art.template.$player.appendChild(panel);

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      // 面板定位在 toggle 正上方
      const tr = toggle.getBoundingClientRect();
      const pr = this.art.template.$player.getBoundingClientRect();
      panel.style.left = (tr.left + tr.width / 2 - pr.left - 90) + 'px';
      panel.style.bottom = (pr.bottom - tr.top + 8) + 'px';
      panel.classList.toggle('open');
    });
    document.addEventListener('click', () => panel.classList.remove('open'), { capture: true });
    panel.addEventListener('click', (e) => e.stopPropagation());

    this._ui = { toggle, panel };
    this._uiBuilt = true;
    this._refreshUI();
  }

  _refreshUI() {
    if (!this._ui) return;
    const { toggle, panel } = this._ui;
    const off = this.currentIndex === -1;
    toggle.classList.toggle('is-off', off);
    toggle.innerHTML = off ? ICON_CC_OFF : ICON_CC;

    if (this.tracks.length === 0) {
      panel.innerHTML = '<div class="brx-subtitle-empty">该集暂无字幕</div>';
      return;
    }
    const items = [
      { idx: -1, label: '关闭字幕' },
      ...this.tracks.map((t, idx) => ({
        idx,
        label: t.lanDoc || t.lan || ('字幕 ' + (idx + 1)),
      })),
    ];
    panel.innerHTML = items.map((it) =>
      '<div class="brx-subtitle-item' + (it.idx === this.currentIndex ? ' current' : '') + '" data-idx="' + it.idx + '">' +
      '<span class="brx-check"></span>' +
      '<span>' + escapeHtml(it.label) + '</span>' +
      '</div>'
    ).join('');
    panel.querySelectorAll('.brx-subtitle-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.idx);
        this.switchTo(idx);
        panel.classList.remove('open');
      });
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
