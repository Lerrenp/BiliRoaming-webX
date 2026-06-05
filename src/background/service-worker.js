import { DEFAULT_CONFIG } from '../common/constants.mjs';

// ====== DNR: Referer removal for platform=android m4s, tab-scoped ======
// 限定：仅对有受限番剧检测的 tab 生效。tab 关闭/离开番剧页自动清理。
// 不记录 headers 的值、不存 URL、不跨 tab 共享规则。
const dnrTabs = new Set();

async function enableDnrForTab(tabId) {
  if (!tabId || dnrTabs.has(tabId)) return;
  dnrTabs.add(tabId);
  try {
    const rules = [{
      id: tabId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [{ header: 'referer', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }]
      },
      condition: {
        tabIds: [tabId],
        urlFilter: '*upos*/*.m4s*',
        resourceTypes: ['media', 'xmlhttprequest']
      }
    }];
    // 先删再加以防 rule id 冲突
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [tabId] });
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
  } catch (e) { /* DNR may fail if permission not granted; extension still works */ }
}

async function disableDnrForTab(tabId) {
  if (!tabId || !dnrTabs.delete(tabId)) return;
  try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [tabId] }); } catch (_) {}
}

// 标签页关闭 → 清理
chrome.tabs.onRemoved.addListener(tabId => disableDnrForTab(tabId));

// 离开 bangumi 页面 → 清理
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || !dnrTabs.has(tabId)) return;
  if (!changeInfo.url.includes('bilibili.com/bangumi/play/')) {
    disableDnrForTab(tabId);
  }
});

// ====== Message handling ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'BRX_PLAYER_ACTION') return;
  handleAction(msg.action, msg.payload || {}, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ code: -1, message: String(err && err.message || err) }));
  return true;
});

async function handleAction(action, payload, sender) {
  if (action === 'GET_CONFIG') return getConfig();
  if (action === 'SET_CONFIG') return setConfig(payload);
  if (action === 'FETCH_PLAYURL') return fetchPlayurl(payload.context || {});
  if (action === 'FETCH_EP_INFO') return fetchEpInfo(payload.epId);
  if (action === 'FETCH_TEXT') return fetchText(payload.url);
  if (action === 'ENABLE_DNR') { await enableDnrForTab(sender?.tab?.id); return { ok: true }; }
  throw new Error('Unknown action: ' + action);
}
async function getConfig(){ const cfg=await chrome.storage.sync.get(DEFAULT_CONFIG); return Object.assign({},DEFAULT_CONFIG,cfg); }
async function setConfig(patch){ await chrome.storage.sync.set(patch||{}); return getConfig(); }
async function fetchPlayurl(context){ const cfg=await getConfig(); let ctx=Object.assign({},context); if((!ctx.cid||!ctx.aid)&&ctx.epId) ctx=Object.assign(ctx,await fetchEpInfo(ctx.epId)); const params=new URLSearchParams(); if(ctx.epId) params.set('ep_id',String(ctx.epId)); if(ctx.cid) params.set('cid',String(ctx.cid)); if(ctx.aid) params.set('avid',String(ctx.aid)); params.set('qn',cfg.defaultQn||'80'); params.set('fnver','0'); params.set('fnval','4048'); params.set('fourk','1'); params.set('area',cfg.area||'hk'); if(cfg.accessKey) params.set('access_key',cfg.accessKey); const base=String(cfg.serverBaseUrl||'').replace(/\/+$/,''); const path=cfg.clientMode==='app'?'/pgc/player/api/playurl':'/pgc/player/web/playurl'; const url=base+path+'?'+params.toString(); const resp=await fetch(url,{headers:{'User-Agent':'Bilibili Freedoooooom/MarkII','x-from-biliroaming':'biliroaming-x-player','platform-from-biliroaming':cfg.clientMode||'web'}}); const json=await resp.json(); if(json&&json.code===0) return json; throw new Error('BiliRoaming playurl failed: '+JSON.stringify(json).slice(0,500)); }
async function fetchEpInfo(epId){
  if(!epId) return {};
  // 修正：原 pgc/season/episode/web/info 端点**不返回** cid/aid/bvid（只返回 stat/user_community 等）。
  // 改用 pgc/view/web/ep/list，其 result.episodes[] 每项含 aid/cid/bvid/duration。
  // 实测 ep713699 → episodes[0].cid=963649454, aid=519802803, bvid=BV1ug41147kC。
  const url='https://api.bilibili.com/pgc/view/web/ep/list?ep_id='+encodeURIComponent(epId);
  let json;
  try { const resp=await fetch(url,{credentials:'include',headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'}}); json=await resp.json(); }
  catch(err) { console.warn('[BRX-Player BG] fetchEpInfo network error', epId, err); return {epId:Number(epId),aid:null,cid:null,bvid:'',duration:0}; }
  const episodes=(json&&json.result&&Array.isArray(json.result.episodes))?json.result.episodes:[];
  if(!episodes.length) return {epId:Number(epId),aid:null,cid:null,bvid:'',duration:0};
  // 优先按 ep_id 精确匹配，找不到则降级用第一项（顺序一般 = 集数顺序）
  const ep=episodes.find((e)=>Number(e.ep_id)===Number(epId))||episodes[0];
  return {
    epId:Number(ep.ep_id||epId),
    aid:Number(ep.aid)||null,
    cid:Number(ep.cid)||null,
    bvid:ep.bvid||'',
    duration:Number(ep.duration)||0,
  };
}
async function fetchText(url){ if(!url) throw new Error('missing url'); const resp=await fetch(url,{credentials:'include'}); const text=await resp.text(); return {ok:resp.ok,status:resp.status,text,message:resp.ok?'':'HTTP '+resp.status}; }
