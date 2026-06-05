// 高级选项页（options）逻辑。
// 与 popup 共用同一份 DEFAULT_CONFIG + 同一组 ids，UI 字段完全一致。
// 区别：popup 是快速开关面板（固定宽度 360px），options 是 chrome://extensions → 选项 全屏页。
// 通过 chrome.runtime.sendMessage 读写 background 的配置。
import { DEFAULT_CONFIG } from '../common/constants.mjs';

const ids = ['enabled', 'serverBaseUrl', 'clientMode', 'area', 'webRoamingHeaders', 'accessKey', 'defaultQn', 'defaultCodec', 'defaultAudioId'];
const $ = (id) => document.getElementById(id);

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  clearTimeout(setStatus._t);
  if (msg && !isError) setStatus._t = setTimeout(() => { el.textContent = ''; el.classList.remove('error'); }, 4000);
}

async function load() {
  const cfg = await chrome.runtime.sendMessage({ type: 'BRX_PLAYER_ACTION', action: 'GET_CONFIG', payload: {} });
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    const value = cfg[id] ?? DEFAULT_CONFIG[id] ?? '';
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }
  setStatus('配置已加载');
}

async function save() {
  const patch = {};
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    patch[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  await chrome.runtime.sendMessage({ type: 'BRX_PLAYER_ACTION', action: 'SET_CONFIG', payload: patch });
  setStatus('已保存。下次加载/切集时生效');
}

async function reloadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.reload(tab.id);
}

$('save').addEventListener('click', save);
$('reload').addEventListener('click', reloadActiveTab);
load().catch((err) => setStatus(String(err?.message || err), true));
