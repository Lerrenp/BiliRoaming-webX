(() => {
  'use strict';
  if (window.__BRX_PLAYER_MAIN_INJECTED__) return;
  window.__BRX_PLAYER_MAIN_INJECTED__ = true;
  const SOURCE = 'BRX_PLAYER_MAIN';
  const log = (...args) => { try { console.debug('[BRX-Player MAIN]', ...args); } catch (_) {} };
  let playinfoValue;
  function safeGetPlayinfo(){ try { return window.__playinfo__?.result || null; } catch(_) { return null; } }
  function epIdFromLocation(){ const m=location.pathname.match(/\/bangumi\/play\/ep(\d+)/); return m?Number(m[1]):null; }
  function ssIdFromLocation(){ const m=location.pathname.match(/\/bangumi\/play\/ss(\d+)/); return m?Number(m[1]):null; }
  function isAreaLimited(pi=safeGetPlayinfo()){
    if(!pi) return /无法观看|非常抱歉|区域|地区/.test(document.body?.innerText||'');
    if(pi.play_video_type==='none') return true;
    if(pi.play_check && (pi.play_check.play_detail==='PLAY_NONE'||pi.play_check.limit_play_reason==='AREA_LIMIT')) return true;
    if(Array.isArray(pi.plugins) && pi.plugins.some(p=>/AreaLimitPanel/i.test(p?.name||''))) return true;
    return false;
  }
  // 从 __playinfo__ 提取当前正在尝试播放的集数信息。
  // SS 页 (play/ss*) 没有 ep_id 但 play_view_business_info.episode_info / supplement.ogv_episode_info
  // 含"上次播放/默认首集"的 ep_id。没有这个 epId，BiliRoaming 服务端无法解析 playurl（-412）。
  // URL ep 优先于 playinfo（切集时 B 站可能还来不及更新 __playinfo__，但 URL 是最新事实）。
  function deriveContext(extra={}){
    const pi=safeGetPlayinfo();
    const arc=pi?.arc||{};
    const epInfo=pi?.play_view_business_info?.episode_info||{};
    const ogvEp=pi?.supplement?.ogv_episode_info||{};
    const watchProg=pi?.play_view_business_info?.user_status?.watch_progress||{};
    const seasonInfo=pi?.play_view_business_info?.season_info||{};
    const urlEpId=epIdFromLocation();
    const urlSsId=ssIdFromLocation();
    // 优先级：URL ep > 显式 extra > episode_info.ep_id > ogv_episode_info.episode_id > watch_progress.last_ep_id
    const epId=Number(extra.epId||urlEpId||epInfo.ep_id||ogvEp.episode_id||watchProg.last_ep_id)||null;
    const seasonId=Number(extra.seasonId||seasonInfo.season_id||urlSsId||pi?.season_id||pi?.seasonId)||null;
    const aid=Number(extra.aid||epInfo.aid||arc.aid||pi?.aid)||null;
    const cid=Number(extra.cid||epInfo.cid||arc.cid||pi?.cid)||null;
    const bvid=extra.bvid||arc.bvid||pi?.bvid||'';
    return { epId, seasonId, aid, cid, bvid, title:document.title||'', href:location.href, limited:isAreaLimited(pi) };
  }
  function notify(type,payload={}){ window.postMessage({source:SOURCE,type,payload:Object.assign({context:deriveContext(payload.context||{})},payload)},'*'); }
  function maybeStart(reason){ const context=deriveContext(); window.__BRX_PLAYER_CONTEXT__=context; if(context.limited||context.epId||context.cid) notify('BRX_PLAYER_START',{reason,context}); }
  try { const desc=Object.getOwnPropertyDescriptor(window,'__playinfo__'); if(!desc||desc.configurable){ Object.defineProperty(window,'__playinfo__',{configurable:true,enumerable:true,get(){return playinfoValue},set(v){playinfoValue=v;setTimeout(()=>maybeStart('__playinfo__ setter'),0)}}); } } catch(_) {}
  document.addEventListener('click',(event)=>{ const link=event.target?.closest?.('a[href*="/bangumi/play/ep"]'); if(!link) return; const m=(link.getAttribute('href')||'').match(/ep(\d+)/); if(!m) return; event.preventDefault(); event.stopPropagation(); history.pushState({},'',new URL(link.getAttribute('href'),location.href).href); notify('BRX_PLAYER_EPISODE_SELECT',{context:{epId:Number(m[1])},href:link.href}); },true);
  const oldPush=history.pushState; history.pushState=function(...args){const r=oldPush.apply(this,args);setTimeout(()=>maybeStart('pushState'),80);return r;};
  const oldReplace=history.replaceState; history.replaceState=function(...args){const r=oldReplace.apply(this,args);setTimeout(()=>maybeStart('replaceState'),80);return r;};
  window.addEventListener('popstate',()=>setTimeout(()=>maybeStart('popstate'),80));
  [300,1000,2500,5000,9000].forEach(t=>setTimeout(()=>maybeStart('timer:'+t),t));
  log('installed');
})();
