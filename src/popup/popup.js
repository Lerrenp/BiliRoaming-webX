// 工具栏弹窗（popup）逻辑。
// 通过 chrome.runtime.sendMessage 读写 background 的配置（GET_CONFIG / SET_CONFIG）。
// accessKey 读取：优先用 chrome.tabs.sendMessage 走 content script，回退到 chrome.scripting 直接执行。
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

async function readKey() {
  // 优先走 content script（响应 BRX_PLAYER_READ_ACCESS_KEY），拿不到时回退到
  // chrome.scripting.executeScript 直接读 localStorage。两路都失败说明当前页
  // 不是 B 站登录态，提示用户先登录。
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let ak = null;
  if (tab?.id && tab.url && /^https?:\/\/(www\.)?bilibili\.com\//.test(tab.url)) {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'BRX_PLAYER_READ_ACCESS_KEY' }).catch(() => null);
    ak = resp?.accessKey || null;
  }
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
    setStatus('已读取 access_key，请保存');
  } else {
    setStatus('当前页没有 access_key（请先在 B 站登录）', true);
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
