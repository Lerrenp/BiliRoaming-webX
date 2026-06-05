import { DEFAULT_CONFIG } from '../common/constants.mjs';
const ids = ['enabled', 'serverBaseUrl', 'clientMode', 'area', 'accessKey', 'defaultQn', 'defaultCodec', 'defaultAudioId'];
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
  $('status').textContent = 'ArtPlayer 播放器配置已启用';
}

async function save() {
  const patch = {};
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    patch[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  await chrome.runtime.sendMessage({ type: 'BRX_PLAYER_ACTION', action: 'SET_CONFIG', payload: patch });
  $('status').textContent = '已保存。新配置会在下次加载/切集时生效';
}

async function readKey() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // 优先尝试 content script
  let ak = null;
  if (tab?.id && tab.url && /^https?:\/\/(www\.)?bilibili\.com\//.test(tab.url)) {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'BRX_PLAYER_READ_ACCESS_KEY' }).catch(() => null);
    ak = resp?.accessKey || null;
  }
  // 兜底：直接用 chrome.scripting 在页面里执行 JS 读 localStorage
  // 适用任意 B 站子页（首页/个人空间等），不依赖 content script 注入位置
  if (!ak && tab?.id && tab.url && /^https?:\/\/(www\.)?bilibili\.com\//.test(tab.url)) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => localStorage.getItem('access_key') || localStorage.getItem('accessKey') || localStorage.access_key || '',
      });
      ak = result || null;
    } catch (_) {}
  }
  if (ak) {
    $('accessKey').value = ak;
    $('clientMode').value = 'app';
    $('status').textContent = '已读取 access_key，并切换到 App 模式，请保存';
  } else {
    $('status').textContent = '当前页没有 localStorage.access_key（请先在 B 站登录）';
  }
}

async function reloadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.reload(tab.id);
  window.close();
}


$('save').addEventListener('click', save);
$('readKey').addEventListener('click', readKey);
$('reload').addEventListener('click', reloadActiveTab);
load();
