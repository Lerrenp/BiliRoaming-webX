// 字幕管理器：多轨字幕加载、中文繁简转换、字幕样式设置
import { fetchBiliSubtitleVtt } from './biliSubtitle.mjs';

const ICON_CC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>';
const ICON_CC_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z" opacity="0.45"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.6"/></svg>';

const PANEL_CSS = ".brx-subtitle-panel{position:absolute;bottom:calc(var(--art-control-height)+6px);left:50%;transform:translateX(-50%);z-index:35;display:none;min-width:200px;padding:6px 0;background:rgba(0,0,0,.82);border-radius:8px;color:#fff;font-size:13px;user-select:none}.brx-subtitle-panel.open{display:block}.brx-sub-row{cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:6px 14px;min-height:32px}.brx-sub-row:hover{background:rgba(255,255,255,.05)}.brx-sub-label{color:rgba(255,255,255,.85)}.brx-sub-label.arrow::after{content:'\\25B6';font-size:10px;margin-left:6px;opacity:.5}.brx-sub-item{cursor:pointer;display:flex;align-items:center;gap:8px}.brx-sub-item.current{color:#00aeec}.brx-sub-check{width:14px;height:14px;border:1.5px solid rgba(255,255,255,.4);border-radius:50%;flex-shrink:0}.brx-sub-item.current .brx-sub-check{background:#00aeec;border-color:#00aeec;box-shadow:inset 0 0 0 2px rgba(0,0,0,.85)}.brx-sub-divider{height:1px;margin:4px 14px;background:rgba(255,255,255,.1);pointer-events:none}.brx-sub-empty{padding:8px 14px;color:rgba(255,255,255,.45);font-size:12px}.brx-sub-toggle{flex-shrink:0;display:flex;align-items:center;justify-content:center;min-height:var(--art-control-height);min-width:var(--art-control-height);padding:0;cursor:pointer;opacity:var(--art-control-opacity);transition:opacity var(--art-transition-duration) ease}.brx-sub-toggle:hover{opacity:1}.brx-sub-toggle.is-off{opacity:.4}.brx-switch{position:relative;width:32px;height:18px;flex-shrink:0;cursor:pointer}.brx-switch-track{position:absolute;inset:0;border-radius:9px;background:rgba(255,255,255,.25);transition:background .2s}.brx-switch.on .brx-switch-track{background:#00aeec}.brx-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s}.brx-switch.on .brx-switch-knob{left:16px}.brx-sub-settings{display:none}.brx-sub-settings.open{display:block}.brx-sub-slider-row{padding:6px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:default}.brx-sub-slider-row span{font-size:12px;color:rgba(255,255,255,.7);white-space:nowrap}.brx-sub-slider{flex:1;-webkit-appearance:none;height:3px;border-radius:2px;background:rgba(255,255,255,.2);outline:none}.brx-sub-slider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#00aeec;cursor:pointer}.brx-sub-color-row{padding:6px 14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;cursor:default}.brx-sub-color-dot{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid transparent}.brx-sub-color-dot.active{border-color:#fff}";

let styleInjected = false;
function ensureStyle(){if(styleInjected)return;const el=document.createElement('style');el.textContent=PANEL_CSS;document.head.appendChild(el);styleInjected=true;}

const DEFAULT_STYLE={fontSize:28,color:'#FFFFFF',opacity:1.0,bottom:8};
const COLORS=['#FFFFFF','#00FF00','#FFFF00','#00FFFF','#FF8800','#FF00FF','#FF4444','#8888FF'];

export class SubtitleManager {
  constructor({art,log}){this.art=art;this.log=log;this.tracks=[];this.currentIndex=-1;this._abort=null;this._uiBuilt=false;this.convMode='none';this.convFn=null;this.style={...DEFAULT_STYLE};this._convOpen=false;this._styleOpen=false;}

  async load({cid,aid,type=1}){
    if(this._abort){try{this._abort.abort();}catch(_){}}
    this._abort=new AbortController();this.disposeOldBlobUrls();this.tracks=[];this.currentIndex=-1;
    if(!cid||!aid)return[];
    try{const r=await fetchBiliSubtitleVtt({cid,aid,type},{signal:this._abort.signal,log:this.log});
      if(!r)this.log?.info?.('subtitle: no tracks',{cid,aid});
      else{this.tracks=[{lan:r.lan,lanDoc:r.lanDoc,blobUrl:r.blobUrl,itemCount:r.itemCount}];this.currentIndex=0;await this._preloadConv();this._apply();this.log?.info?.('subtitle: track loaded',{lan:r.lan,items:r.itemCount});}
    }catch(err){if(err?.name!=='AbortError')this.log?.warn?.('subtitle: load failed',err);}
    if(this._uiBuilt)this._refreshUI();return this.tracks;
  }

  switchTo(idx){if(idx<-1||idx>=this.tracks.length)return;this.currentIndex=idx;this._apply();if(this._uiBuilt)this._refreshUI();}
  show(){if(this.tracks.length===0)return;if(this.currentIndex===-1)this.currentIndex=0;this._apply();if(this._uiBuilt)this._refreshUI();}
  hide(){this.currentIndex=-1;this._apply();if(this._uiBuilt)this._refreshUI();}
  isOff(){return this.currentIndex===-1;}

  dispose(){
    if(this._abort){try{this._abort.abort();}catch(_){}this._abort=null;}
    this.disposeOldBlobUrls();this.tracks=[];
    if(this._ui){const t=this._ui.toggle,p=this._ui.panel;if(t?.parentNode)t.parentNode.removeChild(t);if(p?.parentNode)p.parentNode.removeChild(p);}
    this._ui=null;this._uiBuilt=false;
  }
  disposeOldBlobUrls(){for(const t of this.tracks){if(t.blobUrl)try{URL.revokeObjectURL(t.blobUrl);}catch(_){}}}

  _apply(){
    if(!this.art?.subtitle?.init)return;
    if(!this.art.subtitle.textTrack){const d=URL.createObjectURL(new Blob(['WEBVTT\n\n'],{type:'text/vtt'}));try{this.art.subtitle.createTrack('metadata',d);}catch(_){}}
    const track=this.currentIndex>=0?this.tracks[this.currentIndex]:null;
    if(track){
      // 字幕内容可能已經在 track.blobUrl 裏。繁簡轉換通過 onVttLoad 同步處理避免 async issue
      this.art.subtitle.init({url:track.blobUrl,type:'vtt',name:track.lanDoc||track.lan||'Subtitle',style:{color:this.style.color,fontSize:this.style.fontSize+'px',bottom:this.style.bottom+'px'},encoding:'utf-8',escape:false,
        onVttLoad:(vtt)=>{if(this.convMode==='s2t')return this._convSync(vtt,'s2t');if(this.convMode==='t2s')return this._convSync(vtt,'t2s');return vtt;}});
    }else{
      // 空 VTT Blob → 清屏
      const empty=URL.createObjectURL(new Blob(['WEBVTT\n\n'],{type:'text/vtt'}));
      this.art.subtitle.init({url:empty,type:'vtt',name:'',style:{},encoding:'utf-8',escape:false,onVttLoad:(v)=>v});
      URL.revokeObjectURL(empty);
    }
  }

  // 同步繁簡轉換（不用 async import，首次 load 時 preload）
  _convSync(vtt,dir){
    if(!this.convFn)return vtt;
    const fn=dir==='s2t'?this.convFn.toTraditional:this.convFn.toSimplified;
    const lines=vtt.split('\n'),out=[];
    for(const line of lines){if(line.includes('-->')||line.startsWith('WEBVTT')||line.trim()===''){out.push(line);continue;}out.push(fn(line));}
    return out.join('\n');
  }

  async _preloadConv(){if(!this.convFn){try{this.convFn=await import(chrome.runtime.getURL('vendor/zhConvert.mjs'));}catch(_){}}}

  buildUI(){
    if(this._uiBuilt||!this.art?.template)return;ensureStyle();
    const $right=this.art.template.$controlsRight;if(!$right)return;
    const toggle=document.createElement('div');toggle.className='brx-subtitle-toggle';toggle.title='字幕';toggle.innerHTML=ICON_CC;
    if($right.firstChild)$right.insertBefore(toggle,$right.firstChild);else $right.appendChild(toggle);
    const panel=document.createElement('div');panel.className='brx-subtitle-panel';this.art.template.$player.appendChild(panel);
    toggle.addEventListener('click',(e)=>{e.stopPropagation();const tr=toggle.getBoundingClientRect(),pr=this.art.template.$player.getBoundingClientRect();panel.style.left=(tr.left+tr.width/2-pr.left-100)+'px';panel.style.bottom=(pr.bottom-tr.top+8)+'px';panel.classList.toggle('open');});
    document.addEventListener('click',(e)=>{if(e.target===toggle||toggle.contains(e.target)||panel.contains(e.target))return;panel.classList.remove('open');this._convOpen=false;this._styleOpen=false;if(this._uiBuilt)this._refreshUI();},{capture:true});
    panel.addEventListener('click',(e)=>e.stopPropagation());
    this._ui={toggle,panel};this._uiBuilt=true;this._refreshUI();
  }

  _refreshUI(){
    if(!this._ui)return;const{toggle,panel}=this._ui,off=this.currentIndex===-1;
    toggle.classList.toggle('is-off',off);toggle.innerHTML=off?ICON_CC_OFF:ICON_CC;
    let h='';
    h+='<div class="brx-sub-row"><span class="brx-sub-label">字幕</span>';
    h+='<div class="brx-switch'+(off?'':' on')+'" id="brx-sub-main-toggle"><div class="brx-switch-track"></div><div class="brx-switch-knob"></div></div></div>';
    h+='<div class="brx-sub-divider"></div>';
    if(this.tracks.length===0){h+='<div class="brx-sub-empty">该集暂无字幕</div>';}
    else{for(let i=0;i<this.tracks.length;i++){const t=this.tracks[i],cur=i===this.currentIndex;
      h+='<div class="brx-sub-row brx-sub-item'+(cur?' current':'')+'" data-idx="'+i+'"><span class="brx-sub-check"></span><span>'+esc(t.lanDoc||t.lan||('字幕 '+(i+1)))+'</span></div>';}}
    h+='<div class="brx-sub-divider"></div>';
    const cl=this.convMode==='none'?'不转换':(this.convMode==='s2t'?'简体转繁体':'繁体转简体');
    h+='<div class="brx-sub-row" id="brx-sub-conv-row"><span class="brx-sub-label">繁简转换</span><span style="font-size:12px;color:rgba(255,255,255,.5)">'+esc(cl)+'</span></div>';
    h+='<div class="brx-sub-settings'+(this._convOpen?' open':'')+'" id="brx-sub-conv-menu">';
    for(const[m,l]of[['none','不转换'],['s2t','简体转繁体'],['t2s','繁体转简体']]){
      h+='<div class="brx-sub-row brx-sub-item'+(this.convMode===m?' current':'')+'" data-conv="'+m+'"><span class="brx-sub-check"></span><span>'+esc(l)+'</span></div>';}
    h+='</div><div class="brx-sub-divider"></div>';
    const sl=(this.style.fontSize||28)+'px / '+(this.style.color||'#FFF');
    h+='<div class="brx-sub-row" id="brx-sub-settings-btn"><span class="brx-sub-label">设置</span><span class="brx-sub-label arrow" style="font-size:12px;opacity:.5">'+esc(sl)+'</span></div>';
    h+='<div class="brx-sub-settings'+(this._styleOpen?' open':'')+'" id="brx-sub-settings-panel">';
    h+='<div class="brx-sub-slider-row"><span>字号</span><input type="range" class="brx-sub-slider" id="brx-sub-fontsize" min="16" max="48" value="'+(this.style.fontSize||28)+'"><span>'+(this.style.fontSize||28)+'px</span></div>';
    h+='<div class="brx-sub-color-row" id="brx-sub-colors">';
    for(const c of COLORS){h+='<div class="brx-sub-color-dot'+(this.style.color===c?' active':'')+'" data-color="'+c+'" style="background:'+c+'"></div>';}
    h+='</div><div class="brx-sub-slider-row"><span>位置</span><input type="range" class="brx-sub-slider" id="brx-sub-position" min="0" max="120" value="'+(this.style.bottom||8)+'"><span>'+(this.style.bottom||8)+'%</span></div>';
    h+='</div>';
    panel.innerHTML=h;
    const $t=panel.querySelector('#brx-sub-main-toggle');if($t)$t.addEventListener('click',()=>{if(this.isOff())this.show();else this.hide();});
    panel.querySelectorAll('.brx-sub-item[data-idx]').forEach(el=>{el.addEventListener('click',()=>{this.switchTo(Number(el.dataset.idx));panel.classList.remove('open');});});
    const $cr=panel.querySelector('#brx-sub-conv-row');if($cr)$cr.addEventListener('click',()=>{this._convOpen=!this._convOpen;this._styleOpen=false;this._refreshUI();});
    panel.querySelectorAll('.brx-sub-item[data-conv]').forEach(el=>{el.addEventListener('click',()=>{this.convMode=el.dataset.conv;this._apply();this._convOpen=false;this._refreshUI();});});
    const $sb=panel.querySelector('#brx-sub-settings-btn');if($sb)$sb.addEventListener('click',()=>{this._styleOpen=!this._styleOpen;this._convOpen=false;this._refreshUI();});
    const $fs=panel.querySelector('#brx-sub-fontsize');if($fs)$fs.addEventListener('input',()=>{this.style.fontSize=Number($fs.value);this._apply();this._refreshUI();});
    const $po=panel.querySelector('#brx-sub-position');if($po)$po.addEventListener('input',()=>{this.style.bottom=Number($po.value);this._apply();this._refreshUI();});
    panel.querySelectorAll('.brx-sub-color-dot').forEach(el=>{el.addEventListener('click',()=>{this.style.color=el.dataset.color;this._apply();this._refreshUI();});});
  }
}

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
