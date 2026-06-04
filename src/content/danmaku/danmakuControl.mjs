const AREA_OPTIONS = [
  { value: 0.25, label: '1/4 屏' },
  { value: 0.5, label: '1/2 屏' },
  { value: 0.75, label: '3/4 屏' },
  { value: 1, label: '全屏' },
];

export function createDanmakuControl({ state, onChange }) {
  const root = document.createElement('div');
  root.className = 'brx-danmaku-control artplayer-plugin-danmuku';
  root.innerHTML = `
    <button class="apd-toggle" type="button" title="弹幕开关" aria-label="弹幕开关"></button>
    <div class="apd-config" title="弹幕设置">
      <button class="apd-config-button" type="button" aria-label="弹幕设置">⚙</button>
      <div class="apd-config-panel">
        <div class="apd-config-title">弹幕设置</div>
        <div class="apd-config-row apd-config-mode" data-key="area"></div>
        ${sliderTemplate('opacity', '不透明度', 20, 100, 5)}
        ${sliderTemplate('fontSize', '字号', 16, 48, 1)}
        ${sliderTemplate('speed', '速度', 5, 30, 1)}
      </div>
    </div>
  `;

  const areaBox = root.querySelector('[data-key="area"]');
  for (const opt of AREA_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'apd-mode';
    btn.dataset.value = String(opt.value);
    btn.textContent = opt.label;
    btn.addEventListener('click', () => update({ area: opt.value }));
    areaBox.appendChild(btn);
  }

  root.querySelector('.apd-toggle').addEventListener('click', () => update({ enabled: !state.enabled }));
  bindRange('opacity', (value) => update({ opacity: Number(value) / 100 }));
  bindRange('fontSize', (value) => update({ fontSize: Number(value) }));
  bindRange('speed', (value) => update({ speed: Number(value) / 10 }));

  function bindRange(key, fn) {
    const input = root.querySelector(`input[data-key="${key}"]`);
    input.addEventListener('input', () => fn(input.value));
  }

  function update(patch) {
    Object.assign(state, patch);
    sync();
    onChange?.({ ...state });
  }

  function sync() {
    const toggle = root.querySelector('.apd-toggle');
    toggle.dataset.enabled = state.enabled ? '1' : '0';
    toggle.innerHTML = state.enabled ? iconOn() : iconOff();
    toggle.title = state.enabled ? '关闭弹幕' : '打开弹幕';

    for (const btn of root.querySelectorAll('.apd-mode')) {
      btn.dataset.active = Number(btn.dataset.value) === Number(state.area) ? '1' : '0';
    }

    setRange('opacity', Math.round(Number(state.opacity || 1) * 100), percent(state.opacity));
    setRange('fontSize', Number(state.fontSize || 25), `${state.fontSize}px`);
    setRange('speed', Math.round(Number(state.speed || 1) * 10), `${Number(state.speed || 1).toFixed(1)}x`);
  }

  function setRange(key, value, text) {
    const input = root.querySelector(`input[data-key="${key}"]`);
    const label = root.querySelector(`[data-value-label="${key}"]`);
    input.value = String(value);
    label.textContent = text;
    const min = Number(input.min);
    const max = Number(input.max);
    const ratio = (Number(value) - min) / (max - min);
    input.style.setProperty('--brx-progress', `${Math.max(0, Math.min(1, ratio)) * 100}%`);
  }

  sync();
  return { root, sync };
}

function sliderTemplate(key, label, min, max, step) {
  return `
    <label class="apd-config-slider">
      <span>${label}</span>
      <input data-key="${key}" type="range" min="${min}" max="${max}" step="${step}">
      <em data-value-label="${key}"></em>
    </label>
  `;
}

function percent(value) {
  return Math.round(Number(value || 0) * 100) + '%';
}

function iconOn() {
  return '<span class="apd-icon apd-icon-on">弹</span>';
}

function iconOff() {
  return '<span class="apd-icon apd-icon-off">弹</span>';
}
