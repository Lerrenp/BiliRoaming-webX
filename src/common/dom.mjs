export function waitForElement(selector, timeoutMs=15000){ const existed=document.querySelector(selector); if(existed) return Promise.resolve(existed); return new Promise((resolve,reject)=>{ const obs=new MutationObserver(()=>{ const el=document.querySelector(selector); if(el){clearTimeout(timer);obs.disconnect();resolve(el);} }); const timer=setTimeout(()=>{obs.disconnect();reject(new Error('waitForElement timeout: '+selector));},timeoutMs); obs.observe(document.documentElement||document.body,{childList:true,subtree:true}); }); }
export function stripAreaLimitUi(root=document){ ['#big-block-panel','.bpx-player-error-wrap','[class*="areaLimit"]','[class*="AreaLimit"]'].forEach(sel=>root.querySelectorAll(sel).forEach(el=>{el.style.display='none'})); }
export function getCookie(name){ const m=document.cookie.match(new RegExp('(?:^|;\\s*)'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=([^;]*)')); return m?decodeURIComponent(m[1]):''; }

// 受限页时 B 站 React 会把 #comment-module 设为 display:none，
// 导致 <bili-comments lazy-load="true"> 的 IntersectionObserver 永远不触发，
// 评论永远不加载。把模块显示出来，lazy-load 会在用户滚动到评论区时自动触发。
let commentUnhideObserver=null;
export function unhideCommentModule(root=document){
  const cm=root.querySelector('#comment-module');
  if(!cm) return false;
  cm.style.display='block';
  cm.style.visibility='visible';
  cm.removeAttribute('aria-hidden');
  if(!commentUnhideObserver){
    commentUnhideObserver=new MutationObserver(()=>{
      const el=document.querySelector('#comment-module');
      if(!el) return;
      const cur=getComputedStyle(el).display;
      if(cur==='none'||el.getAttribute('aria-hidden')==='true'){
        el.style.display='block';
        el.style.visibility='visible';
        el.removeAttribute('aria-hidden');
      }
    });
    commentUnhideObserver.observe(document.documentElement||document.body,{attributes:true,subtree:true,attributeFilter:['style','class','aria-hidden']});
  }
  return true;
}
