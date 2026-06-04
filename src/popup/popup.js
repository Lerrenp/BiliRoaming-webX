import { DEFAULT_CONFIG } from '../common/constants.mjs';
const ids = ['enabled', 'serverBaseUrl', 'clientMode', 'area', 'accessKey', 'defaultQn', 'defaultCodec', 'defaultAudioId', 'danmakuEnabled', 'danmakuArea', 'danmakuOpacity', 'danmakuFontSize', 'danmakuSpeed'];
const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.runtime.sendMessage({ type: 'BRX_PLAYER_ACTION', action: 'GET_CONFIG', payload: {} });
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    const value = cfg[id] ?? DEFAULT_CONFIG[id] ?? '';
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }
  updateOpacityText();
  $('status').textContent = 'ArtPlayer 版本：清晰度/编码/音轨/弹幕配置已启用';
}

async function save() {
  const patch = {};
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    patch[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  patch.danmakuOpacity = Number(patch.danmakuOpacity || DEFAULT_CONFIG.danmakuOpacity);
  patch.danmakuArea = Number(patch.danmakuArea || DEFAULT_CONFIG.danmakuArea);
  patch.danmakuFontSize = Number(patch.danmakuFontSize || DEFAULT_CONFIG.danmakuFontSize);
  patch.danmakuSpeed = Number(patch.danmakuSpeed || DEFAULT_CONFIG.danmakuSpeed);
  await chrome.runtime.sendMessage({ type: 'BRX_PLAYER_ACTION', action: 'SET_CONFIG', payload: patch });
  $('status').textContent = '已保存。新配置会在下次加载/切集时生效';
}

async function readKey() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const resp = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'BRX_PLAYER_READ_ACCESS_KEY' }).catch(() => null) : null;
  if (resp?.accessKey) {
    $('accessKey').value = resp.accessKey;
    $('clientMode').value = 'app';
    $('status').textContent = '已读取 access_key，并切换到 App 模式，请保存';
  } else {
    $('status').textContent = '当前页没有 localStorage.access_key';
  }
}

async function reloadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.reload(tab.id);
  window.close();
}

function updateOpacityText() {
  $('opacityText').textContent = Math.round(Number($('danmakuOpacity').value || 0) * 100) + '%';
}

$('save').addEventListener('click', save);
$('readKey').addEventListener('click', readKey);
$('reload').addEventListener('click', reloadActiveTab);
$('danmakuOpacity').addEventListener('input', updateOpacityText);
load();
