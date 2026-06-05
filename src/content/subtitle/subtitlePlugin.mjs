// 字幕管理器：多轨字幕加载、中文繁简转换、字幕样式设置。
//
// 面板结构：
//   .brx-subtitle-panel（挂在 art.template.$player 内，点击外部关闭）
//   ├── 主开关 brx-sub-main-toggle
//   ├── 字幕轨列表 brx-sub-item[data-idx]
//   ├── 繁简转换 brx-sub-conv-row / brx-sub-item[data-conv]
//   └── 设置 brx-sub-settings-btn（字号/颜色/位置）
//
// 关键设计点：
//   - 面板内部 click/mousedown/pointerdown/.../touchend 全部 stopPropagation，
//     否则字幕开关点击会被外层误判成"播放器控制点击"，在部分页面触发网页全屏。
//   - 面板挂到 art.template.$player，点击 player 空白区域时关闭面板。
//   - 字幕数据异步加载：buildUI() 同步挂按钮，load() 异步拉 protobuf → VTT。
//   - 繁简转换：preload zhConvert.mjs（vendor），apply 时同步替换（非异步，避免弹幕式卡顿）。
//
// 持久化：chrome.storage.sync.brx_subtitle（fontSize/color/bottom/convMode）。
import { fetchBiliSubtitleVtt } from './biliSubtitle.mjs';

const ICON_CC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>';
const ICON_CC_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z" opacity="0.45"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.6"/></svg>';

const PANEL_CSS = ".brx-subtitle-panel{position:absolute;bottom:calc(var(--art-control-height)+6px);left:50%;z-index:60;display:none;min-width:200px;padding:6px 0;background:rgba(0,0,0,.82);border-radius:8px;color:#fff;font-size:13px;user-select:none;pointer-events:auto}.brx-subtitle-panel.open{display:block}.art-hide-cursor .brx-subtitle-panel{display:none!important}.brx-sub-row{cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:6px 14px;min-height:32px}.brx-sub-row:hover{background:rgba(255,255,255,.05)}.brx-sub-label{color:rgba(255,255,255,.85)}.brx-sub-label.arrow::after{content:'\\25B6';font-size:10px;margin-left:6px;opacity:.5}.brx-sub-item{cursor:pointer;display:flex;align-items:center;gap:8px}.brx-sub-item.current{color:#00aeec}.brx-sub-check{width:14px;height:14px;border:1.5px solid rgba(255,255,255,.4);border-radius:50%;flex-shrink:0}.brx-sub-item.current .brx-sub-check{background:#00aeec;border-color:#00aeec;box-shadow:inset 0 0 0 2px rgba(0,0,0,.85)}.brx-sub-divider{height:1px;margin:4px 14px;background:rgba(255,255,255,.1);pointer-events:none}.brx-sub-empty{padding:8px 14px;color:rgba(255,255,255,.45);font-size:12px}.brx-switch{position:relative;width:32px;height:18px;flex-shrink:0;cursor:pointer}.brx-switch-track{position:absolute;inset:0;border-radius:9px;background:rgba(255,255,255,.25);transition:background .2s}.brx-switch.on .brx-switch-track{background:#00aeec}.brx-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s}.brx-switch.on .brx-switch-knob{left:16px}.brx-sub-settings{display:none}.brx-sub-settings.open{display:block}.brx-sub-slider-row{padding:6px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:default}.brx-sub-slider-row span{font-size:12px;color:rgba(255,255,255,.7);white-space:nowrap}.brx-sub-slider{flex:1;-webkit-appearance:none;height:3px;border-radius:2px;background:rgba(255,255,255,.2);outline:none}.brx-sub-slider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#00aeec;cursor:pointer}.brx-sub-color-row{padding:6px 14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;cursor:default}.brx-sub-color-dot{width:20px;height:20px;border-radius:50%;cursor:pointer;border:2px solid transparent}.brx-sub-color-dot.active{border-color:#fff}";

let styleInjected = false;
function ensureStyle(){if(styleInjected)return;const el=document.createElement('style');el.textContent=PANEL_CSS;document.head.appendChild(el);styleInjected=true;}

const DEFAULT_STYLE={fontSize:28,color:'#FFFFFF',opacity:1.0,bottom:8};
const COLORS=['#FFFFFF','#00FF00','#FFFF00','#00FFFF','#FF8800','#FF00FF','#FF4444','#8888FF'];

export class SubtitleManager {
  constructor({art,log}){this.art=art;this.log=log;this.tracks=[];this.currentIndex=-1;this._abort=null;this._uiBuilt=false;this.convMode='none';this.convFn=null;this.style={...DEFAULT_STYLE};this._convOpen=false;this._styleOpen=false;this._loadSettings();}

  async _loadSettings(){try{const r=await chrome.storage.sync.get('brx_subtitle');if(r.brx_subtitle){const s=r.brx_subtitle;if(s.fontSize)this.style.fontSize=s.fontSize;if(s.color)this.style.color=s.color;if(s.bottom!=null)this.style.bottom=s.bottom;if(s.convMode)this.convMode=s.convMode;}}catch(_){}}
  _saveSettings(){try{chrome.storage.sync.set({brx_subtitle:{fontSize:this.style.fontSize,color:this.style.color,bottom:this.style.bottom,convMode:this.convMode}});}catch(_){}}

  async load({cid,aid,type=1}){
    if(this._abort){try{this._abort.abort();}catch(_){}}
    this._abort=new AbortController();this.disposeOldBlobUrls();this.tracks=[];this.currentIndex=-1;
    if(!cid||!aid)return[];
    try{const r=await fetchBiliSubtitleVtt({cid,aid,type},{signal:this._abort.signal,log:this.log});
      if(!r)this.log?.info?.('subtitle: no tracks',{cid,aid});
      else{this.tracks=[{lan:r.lan,lanDoc:r.lanDoc,blobUrl:r.blobUrl,itemCount:r.itemCount}];this.currentIndex=0;await this._preloadConv();this._apply();this._saveSettings();this.log?.info?.('subtitle: track loaded',{lan:r.lan,items:r.itemCount});}
    }catch(err){if(err?.name!=='AbortError')this.log?.warn?.('subtitle: load failed',err);}
    if(this._uiBuilt){this._updateToggleState();this._renderPanel()};return this.tracks;
  }

  switchTo(idx){if(idx<-1||idx>=this.tracks.length)return;this.currentIndex=idx;this._apply();if(this._uiBuilt)this._updateAfterToggle();}
  show(){if(this.tracks.length===0)return;if(this.currentIndex===-1)this.currentIndex=0;this._apply();if(this._uiBuilt)this._updateAfterToggle();}
  hide(){this.currentIndex=-1;this._apply();if(this._uiBuilt)this._updateAfterToggle();}
  isOff(){return this.currentIndex===-1;}

  dispose(){
    if(this._abort){try{this._abort.abort();}catch(_){}this._abort=null;}
    this.disposeOldBlobUrls();this.tracks=[];
    if(this._$toggle?.parentNode)this._$toggle.parentNode.removeChild(this._$toggle);
    if(this._ui?.panel?.parentNode)this._ui.panel.parentNode.removeChild(this._ui.panel);
    this._ui=null;this._uiBuilt=false;
  }
  disposeOldBlobUrls(){for(const t of this.tracks){if(t.blobUrl)try{URL.revokeObjectURL(t.blobUrl);}catch(_){}}}

  _apply(){
    if(!this.art?.subtitle?.init)return;
    if(!this.art.subtitle.textTrack){const d=URL.createObjectURL(new Blob(['WEBVTT\n\n'],{type:'text/vtt'}));try{this.art.subtitle.createTrack('metadata',d);}catch(_){}}
    const track=this.currentIndex>=0?this.tracks[this.currentIndex]:null;
    if(track){
      this.art.subtitle.init({url:track.blobUrl,type:'vtt',name:track.lanDoc||track.lan||'Subtitle',style:{color:this.style.color,fontSize:this.style.fontSize+'px',bottom:this.style.bottom+'px'},encoding:'utf-8',escape:false,
        onVttLoad:(vtt)=>{if(this.convMode==='s2t')return this._convSync(vtt,'s2t');if(this.convMode==='t2s')return this._convSync(vtt,'t2s');return vtt;}});
    }else{
      const empty=URL.createObjectURL(new Blob(['WEBVTT\n\n'],{type:'text/vtt'}));
      this.art.subtitle.init({url:empty,type:'vtt',name:'',style:{},encoding:'utf-8',escape:false,onVttLoad:(v)=>v});
      URL.revokeObjectURL(empty);
    }
    this._saveSettings();
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
    if(this._uiBuilt||!this.art?.controls?.add)return;ensureStyle();
    const self=this;
    const panel=document.createElement('div');panel.className='brx-subtitle-panel';
    const $player=this.art.template.$player;
    if(!$player)return;
    $player.appendChild(panel);

    // 面板挂在 ArtPlayer 的 player 容器里，点击面板内部控件时不能继续冒泡到
    // ArtPlayer/原页面的控制层。否则字幕开关点击会被外层误判成播放器控制点击，
    // 在部分页面上表现为误触发网页全屏（再点一次又恢复）。
    for (const eventName of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      panel.addEventListener(eventName, (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      });
    }

    this.art.controls.add({
      name:'subtitle',position:'right',index:5,
      html:'<span>'+ICON_CC+'</span>',
      mounted($control){
        self._$toggle=$control;
        $control.title='字幕';
        $control.addEventListener('click',(e)=>{e.stopPropagation();e.stopImmediatePropagation();
          const tr=$control.getBoundingClientRect(),pr=$player.getBoundingClientRect();
          panel.style.left=(tr.left+tr.width/2-pr.left-100)+'px';
          // bottom 固定 56px = 控制栏 50px + 6px 余量，与设置菜单等高
          panel.style.bottom='56px';
          panel.classList.toggle('open');
          if(panel.classList.contains('open')){self._convOpen=false;self._styleOpen=false;self._renderPanel();}
          self._updateToggleState();
        });
        self._updateToggleState();
      },
    });

    // 点击播放器空白区域关闭面板（只监听 player 级，toggle 和 panel 内部不关）
    $player.addEventListener('click',(e)=>{
      if(!panel.classList.contains('open'))return;
      if(panel.contains(e.target))return;
      if(self._$toggle&&self._$toggle.contains(e.target))return;
      panel.classList.remove('open');self._convOpen=false;self._styleOpen=false;
      self._renderPanel();
    });

    this._ui={panel};this._uiBuilt=true;
    this._updateToggleState();this._renderPanel();
  }

  // 增量更新面板（不重建 DOM）：开关状态 + 选集勾选
  _updateAfterToggle(){
    this._updateToggleState();
    const p=this._ui?.panel;if(!p)return;
    // 主开关
    const $sw=p.querySelector('#brx-sub-main-toggle');
    if($sw)$sw.classList.toggle('on',!this.isOff());
    // 选集勾选
    p.querySelectorAll('.brx-sub-item[data-idx]').forEach(el=>{
      el.classList.toggle('current',Number(el.dataset.idx)===this.currentIndex);
    });
  }

  _updateToggleState(){
    const $t=this._$toggle;if(!$t)return;
    const off=this.currentIndex===-1;
    const span=$t.querySelector('span');
    if(!span)return;
    if(off){span.innerHTML=ICON_CC_OFF;$t.style.opacity='0.4';}
    else{span.innerHTML=ICON_CC;$t.style.opacity='';}
  }

  _renderPanel(){
    const panel=this._ui?.panel;if(!panel)return;
    const off=this.currentIndex===-1;
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
    h+='<div class="brx-sub-slider-row"><span>字号</span><input type="range" class="brx-sub-slider" id="brx-sub-fontsize" min="16" max="48" value="'+(this.style.fontSize||28)+'"><span id="brx-sub-fontsize-val">'+(this.style.fontSize||28)+'px</span></div>';
    h+='<div class="brx-sub-color-row" id="brx-sub-colors">';
    for(const c of COLORS){h+='<div class="brx-sub-color-dot'+(this.style.color===c?' active':'')+'" data-color="'+c+'" style="background:'+c+'"></div>';}
    h+='</div><div class="brx-sub-slider-row"><span>位置</span><input type="range" class="brx-sub-slider" id="brx-sub-position" min="0" max="120" value="'+(this.style.bottom||8)+'"><span id="brx-sub-pos-val">'+(this.style.bottom||8)+'%</span></div>';
    h+='</div>';
    panel.innerHTML=h;

    const $t=panel.querySelector('#brx-sub-main-toggle');if($t)$t.addEventListener('click',()=>{if(this.isOff())this.show();else this.hide();});
    panel.querySelectorAll('.brx-sub-item[data-idx]').forEach(el=>{el.addEventListener('click',()=>{this.switchTo(Number(el.dataset.idx));panel.classList.remove('open');});});

    // 展开/折叠用 class toggle 直操作，不重建 DOM（否则 panel 消失）
    const $cr=panel.querySelector('#brx-sub-conv-row');
    if($cr)$cr.addEventListener('click',()=>{this._convOpen=!this._convOpen;this._styleOpen=false;this._toggleSubMenus();});
    panel.querySelectorAll('.brx-sub-item[data-conv]').forEach(el=>{el.addEventListener('click',()=>{this.convMode=el.dataset.conv;this._apply();this._convOpen=false;this._toggleSubMenus();this._updateConvLabel();});});
    const $sb=panel.querySelector('#brx-sub-settings-btn');
    if($sb)$sb.addEventListener('click',()=>{this._styleOpen=!this._styleOpen;this._convOpen=false;this._toggleSubMenus();});
    // 颜色点击只刷新颜色区的 active，不重建面板
    panel.querySelectorAll('.brx-sub-color-dot').forEach(el=>{el.addEventListener('click',()=>{this.style.color=el.dataset.color;this._apply();this._updateColorDots();});});

    // 滑块：input 只改值+生效，不重建面板
    const $fs=panel.querySelector('#brx-sub-fontsize');
    if($fs){$fs.addEventListener('input',()=>{this.style.fontSize=Number($fs.value);this._apply();this._updateSliderSpan('brx-sub-fontsize-val',this.style.fontSize+'px');});}
    const $po=panel.querySelector('#brx-sub-position');
    if($po){$po.addEventListener('input',()=>{this.style.bottom=Number($po.value);this._apply();this._updateSliderSpan('brx-sub-pos-val',this.style.bottom+'%');});}
  }

  _toggleSubMenus(){
    const p=this._ui?.panel;if(!p)return;
    const $m=p.querySelector('#brx-sub-conv-menu');if($m)$m.classList.toggle('open',this._convOpen);
    const $s=p.querySelector('#brx-sub-settings-panel');if($s)$s.classList.toggle('open',this._styleOpen);
  }
  _updateConvLabel(){
    const p=this._ui?.panel;if(!p)return;
    const cl=this.convMode==='none'?'不转换':(this.convMode==='s2t'?'简体转繁体':'繁体转简体');
    const $l=p.querySelector('#brx-sub-conv-row span:last-child');if($l)$l.textContent=cl;
    // 更新 checkmark
    p.querySelectorAll('.brx-sub-item[data-conv]').forEach(el=>{el.classList.toggle('current',el.dataset.conv===this.convMode);});
  }
  _updateColorDots(){
    const p=this._ui?.panel;if(!p)return;
    p.querySelectorAll('.brx-sub-color-dot').forEach(el=>{el.classList.toggle('active',el.dataset.color===this.style.color);});
  }
  _updateSliderSpan(id,text){const el=document.getElementById(id);if(el)el.textContent=text;}
}

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
