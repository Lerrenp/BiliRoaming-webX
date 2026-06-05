import { DEFAULT_CONFIG } from '../common/constants.mjs';

// ====== DNR: Referer removal for platform=android m4s, tab-scoped ======
// 限定：仅对有受限番剧检测的 tab 生效。tab 关闭/离开番剧页自动清理。
// 不记录 headers 的值、不存 URL、不跨 tab 共享规则。
const dnrTabs = new Set();

async function enableDnrForTab(tabId) {
  if (!tabId || dnrTabs.has(tabId)) return { ok: true, tabId, reason: 'already-enabled' };
  if (!chrome.declarativeNetRequest) return { ok: false, tabId, reason: 'no-dnr-api' };
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
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
    return { ok: true, tabId, ruleCount: 1 };
  } catch (e) {
    dnrTabs.delete(tabId);
    return { ok: false, tabId, reason: 'dnr-error', error: String(e && e.message || e).slice(0, 200) };
  }
}

async function disableDnrForTab(tabId) {
  if (!tabId || !dnrTabs.delete(tabId)) return;
  try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }); } catch (_) {}
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
  if (action === 'ENABLE_DNR') return enableDnrForTab(sender?.tab?.id);
  throw new Error('Unknown action: ' + action);
}
// ====== MD5 (for Bilibili app signing) ======
function md5(inputString) {
  var hc='0123456789abcdef';
  function rh(n){var j,s='';for(j=0;j<=3;j++)s+=hc.charAt((n>>(j*8+4))&0x0F)+hc.charAt((n>>(j*8))&0x0F);return s;}
  function ad(x,y){var l=(x&0xFFFF)+(y&0xFFFF);var m=(x>>16)+(y>>16)+(l>>16);return(m<<16)|(l&0xFFFF);}
  function rl(n,c){return(n<<c)|(n>>>(32-c));}
  function cm(q,a,b,x,s,t){return ad(rl(ad(ad(a,q),ad(x,t)),s),b);}
  function ff(a,b,c,d,x,s,t){return cm((b&c)|((~b)&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t){return cm((b&d)|(c&(~d)),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t){return cm(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t){return cm(c^(b|(~d)),a,b,x,s,t);}
  function sb(x){var i;var nblk=((x.length+8)>>6)+1;var blks=new Array(nblk*16);for(i=0;i<nblk*16;i++)blks[i]=0;for(i=0;i<x.length;i++)blks[i>>2]|=x.charCodeAt(i)<<((i%4)*8);blks[i>>2]|=0x80<<((i%4)*8);blks[nblk*16-2]=x.length*8;return blks;}
  var x=sb(unescape(encodeURIComponent(inputString)));
  var a=1732584193,b=4023233417,c=2562383102,d=271733878;
  for(var i=0;i<x.length;i+=16){
    var olda=a,oldb=b,oldc=c,oldd=d;
    a=ff(a,b,c,d,x[i+0],7,3614090360);d=ff(d,a,b,c,x[i+1],12,3905402710);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,3250441966);
    a=ff(a,b,c,d,x[i+4],7,4118548399);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,2821735955);b=ff(b,c,d,a,x[i+7],22,4249261313);
    a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,2336552879);c=ff(c,d,a,b,x[i+10],17,4294925233);b=ff(b,c,d,a,x[i+11],22,2304563134);
    a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,4254626195);c=ff(c,d,a,b,x[i+14],17,2792965006);b=ff(b,c,d,a,x[i+15],22,1236535329);
    a=gg(a,b,c,d,x[i+1],5,4129170786);d=gg(d,a,b,c,x[i+6],9,3225465664);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i+0],20,3921069994);
    a=gg(a,b,c,d,x[i+5],5,3593408605);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,3634488961);b=gg(b,c,d,a,x[i+4],20,3889429448);
    a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,3275163606);c=gg(c,d,a,b,x[i+3],14,4107603335);b=gg(b,c,d,a,x[i+8],20,1163531501);
    a=gg(a,b,c,d,x[i+13],5,2850285829);d=gg(d,a,b,c,x[i+2],9,4243563512);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,2368359562);
    a=hh(a,b,c,d,x[i+5],4,4294588738);d=hh(d,a,b,c,x[i+8],11,2272392833);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,4259657740);
    a=hh(a,b,c,d,x[i+1],4,2763975236);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,4139469664);b=hh(b,c,d,a,x[i+10],23,3200236656);
    a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i+0],11,3936430074);c=hh(c,d,a,b,x[i+3],16,3572445317);b=hh(b,c,d,a,x[i+6],23,76029189);
    a=hh(a,b,c,d,x[i+9],4,3654602809);d=hh(d,a,b,c,x[i+12],11,3873151461);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,3299628645);
    a=ii(a,b,c,d,x[i+0],6,4096336452);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,2878612391);b=ii(b,c,d,a,x[i+5],21,4237533241);
    a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,2399980690);c=ii(c,d,a,b,x[i+10],15,4293915773);b=ii(b,c,d,a,x[i+1],21,2240044497);
    a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,4264355552);c=ii(c,d,a,b,x[i+6],15,2734768916);b=ii(b,c,d,a,x[i+13],21,1309151649);
    a=ii(a,b,c,d,x[i+4],6,4149444226);d=ii(d,a,b,c,x[i+11],10,3174756917);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,3951481745);
    a=ad(a,olda);b=ad(b,oldb);c=ad(c,oldc);d=ad(d,oldd);
  }
  return rh(a)+rh(b)+rh(c)+rh(d);
}

// ====== Bilibili App Signing Constants ======
const APP_SIGN = {
  main: { appkey:'1d8b6e7d45233436', appsec:'560c52ccd288fed045859ed18bffd973', mobi_app:'android', platform:'android', device:'android', otype:'json', module:'pgc', build:'6800300' },
  th:   { appkey:'7d089525d3611b1c', appsec:'acd495b248ec528c2eed1e862d393126', mobi_app:'bstar_a', platform:'android', build:'1001310' },
};

/** Sort keys → encodeURIComponent(k=v) → join & → MD5(query+appsec) */
function appSign(paramsObj, appsec) {
  const keys = Object.keys(paramsObj).sort();
  const query = keys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(paramsObj[k])).join('&');
  return md5(query + appsec);
}

// ====== Config ======
async function getConfig(){ const cfg=await chrome.storage.sync.get(DEFAULT_CONFIG); return Object.assign({},DEFAULT_CONFIG,cfg); }
async function setConfig(patch){ await chrome.storage.sync.set(patch||{}); return getConfig(); }

// ====== Playurl (web / app mode with signing) ======
async function fetchPlayurl(context){
  const cfg=await getConfig();
  let ctx=Object.assign({},context);
  if((!ctx.cid||!ctx.aid)&&ctx.epId) ctx=Object.assign(ctx,await fetchEpInfo(ctx.epId));

  const area=cfg.area||'hk';
  const mode=cfg.clientMode||'web';
  const base=String(cfg.serverBaseUrl||'').replace(/\/+$/,'');

  // Build params object (plain object for signing, not URLSearchParams)
  const params={};
  if(ctx.epId) params.ep_id=String(ctx.epId);
  if(ctx.cid) params.cid=String(ctx.cid);
  if(ctx.aid) params.avid=String(ctx.aid);
  params.qn=cfg.defaultQn||'80';
  params.fnver='0';
  params.fnval='4048';
  params.fourk='1';
  params.area=area;

  let path;
  let platformHeader;
  if(mode==='app'){
    const isTH=area==='th';
    const ac=isTH?APP_SIGN.th:APP_SIGN.main;
    path=isTH?'/intl/gateway/v2/ogv/playurl':'/pgc/player/api/playurl';
    platformHeader='android';

    if(cfg.accessKey) params.access_key=cfg.accessKey;
    Object.assign(params,{
      appkey:ac.appkey,
      mobi_app:ac.mobi_app,
      platform:ac.platform,
      build:ac.build,
    });
    if(ac.device) params.device=ac.device;
    if(ac.otype) params.otype=ac.otype;
    if(ac.module) params.module=ac.module;

    // Compute sign before adding to URL
    params.sign=appSign(params,ac.appsec);
  } else {
    path='/pgc/player/web/playurl';
    platformHeader='web';
    if(cfg.accessKey) params.access_key=cfg.accessKey;
  }

  // Build URL with encodeURIComponent (matches signing algorithm)
  const keys=Object.keys(params).sort();
  const qs=keys.map(k=>encodeURIComponent(k)+'='+encodeURIComponent(params[k])).join('&');
  const url=base+path+'?'+qs;

  const resp=await fetch(url,{headers:{
    'User-Agent':'Bilibili Freedoooooom/MarkII',
    'x-from-biliroaming':'9.999.0',
    'build':'9999999',
    'platform-from-biliroaming':platformHeader,
  }});
  const json=await resp.json();
  if(json&&json.code===0) return json;
  throw new Error('BiliRoaming playurl failed: '+JSON.stringify(json).slice(0,500));
}
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
