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
  function deriveContext(extra={}){
    const pi=safeGetPlayinfo(); const arc=pi?.arc||{}; const ep=pi?.episode_info||pi?.ep||{};
    return { epId:Number(extra.epId||ep.ep_id||ep.id||epIdFromLocation())||null, seasonId:Number(extra.seasonId||pi?.season_id||pi?.seasonId||ssIdFromLocation())||null, aid:Number(extra.aid||arc.aid||pi?.aid)||null, cid:Number(extra.cid||arc.cid||ep.cid||pi?.cid)||null, bvid:extra.bvid||arc.bvid||pi?.bvid||'', title:document.title||'', href:location.href, limited:isAreaLimited(pi) };
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
