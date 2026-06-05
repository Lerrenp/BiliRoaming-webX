import { QUALITY_LABELS } from '../../common/constants.mjs';
import { getCookie } from '../../common/dom.mjs';
export function extractDash(resp){ return resp?.result?.dash||resp?.result?.video_info?.dash||resp?.dash||resp?.data?.dash||null; }
export function uniqueQualities(videos){ const map=new Map(); for(const v of videos||[]) map.set(String(v.id),QUALITY_LABELS[v.id]||v.label||String(v.id)); return [...map.entries()].sort((a,b)=>Number(b[0])-Number(a[0])).map(([id,label])=>({id,label})); }
export function uniqueCodecs(videos){ const set=new Set((videos||[]).map(codecGroup).filter(Boolean)); return ['auto',...set].map(id=>({id,label:id==='auto'?'自动编码':id.toUpperCase()})); }
export function audioOptions(audios){ return [{id:'auto',label:'自动音轨'},...(audios||[]).map((a,i)=>({id:String(a.id||i),label:(a.lang||a.label||('音轨 '+(a.id||i+1)))+(a.bandwidth?' / '+Math.round(a.bandwidth/1000)+'kbps':'')}))]; }
function codecGroup(v){ const c=String(v.codecs||'').toLowerCase(); if(c.includes('av01')) return 'av1'; if(c.includes('hev')||c.includes('hvc')) return 'hevc'; if(c.includes('avc')) return 'avc'; return c.split('.')[0]||'unknown'; }
function esc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function rangeText(r){ return Array.isArray(r)?r.join('-'):String(r||'0-0'); }
export function patchM4sUrl(url){
  try{
    const u=new URL(url);
    const buvid3=getCookie('buvid3');
    if(buvid3&&(!u.searchParams.get('buvid')||u.searchParams.get('buvid')==='')) u.searchParams.set('buvid',buvid3);
    // 修正 CDN URL 参数，避免 403：
    // 1. platform=android → pc (服务端 Android 凭证取流)
    if(u.searchParams.get('platform')==='android') u.searchParams.set('platform','pc');
    // 2. build=6800300 → 0 (app build 残留；build 不在 upsig 签名中，安全)
    if(u.searchParams.get('build')==='6800300'&&u.searchParams.get('platform')==='pc') u.searchParams.set('build','0');
    // 3. 清除 CDN 回退时可能残留的 app 专属参数（不在签名中）
    ['mobi_app','device','otype','module'].forEach(p=>{if(u.searchParams.has(p))u.searchParams.delete(p)});
    return u.href;
  }catch(_){return url}
}
export function selectStreams(dash,selection={}){ const qn=String(selection.qn||'auto'), codec=String(selection.codec||'auto'); let videos=[...(dash.video||[])]; if(qn!=='auto') videos=videos.filter(v=>String(v.id)===qn); if(codec!=='auto') videos=videos.filter(v=>codecGroup(v)===codec); if(!videos.length&&qn!=='auto') videos=(dash.video||[]).filter(v=>String(v.id)===qn); if(!videos.length) videos=dash.video||[]; let audios=[...(dash.audio||dash.dolby?.audio||[])]; if(selection.audioId&&selection.audioId!=='auto') audios=audios.filter((a,i)=>String(a.id||i)===String(selection.audioId)); if(!audios.length) audios=dash.audio||dash.dolby?.audio||[]; return {videos,audios}; }
export function buildMpdXml(dash,selection={}){ const {videos,audios}=selectStreams(dash,selection); const duration=Number(dash.duration||0); const mediaDuration=duration>0?'PT'+duration+'S':'PT0S'; const reps=[]; reps.push('<AdaptationSet id="video" contentType="video" mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">'); for(const [i,v] of videos.entries()){ const init=rangeText(v.segment_base?.initialization||v.SegmentBase?.Initialization?.range||v.initialization); const indexRange=rangeText(v.segment_base?.index_range||v.SegmentBase?.indexRange||v.indexRange); reps.push('<Representation id="v-'+esc(v.id)+'-'+i+'" bandwidth="'+esc(v.bandwidth||1)+'" codecs="'+esc(v.codecs||'')+'" width="'+esc(v.width||0)+'" height="'+esc(v.height||0)+'" frameRate="'+esc(v.frame_rate||v.frameRate||'')+'"><BaseURL>'+esc(patchM4sUrl(v.baseUrl||v.base_url||v.backupUrl?.[0]||''))+'</BaseURL><SegmentBase indexRange="'+esc(indexRange)+'"><Initialization range="'+esc(init)+'"/></SegmentBase></Representation>'); } reps.push('</AdaptationSet>'); reps.push('<AdaptationSet id="audio" contentType="audio" mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1">'); for(const [i,a] of audios.entries()){ const init=rangeText(a.segment_base?.initialization||a.SegmentBase?.Initialization?.range||a.initialization); const indexRange=rangeText(a.segment_base?.index_range||a.SegmentBase?.indexRange||a.indexRange); reps.push('<Representation id="a-'+esc(a.id||i)+'" bandwidth="'+esc(a.bandwidth||1)+'" codecs="'+esc(a.codecs||'mp4a.40.2')+'" audioSamplingRate="'+esc(a.audioSamplingRate||48000)+'"><AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/><BaseURL>'+esc(patchM4sUrl(a.baseUrl||a.base_url||a.backupUrl?.[0]||''))+'</BaseURL><SegmentBase indexRange="'+esc(indexRange)+'"><Initialization range="'+esc(init)+'"/></SegmentBase></Representation>'); } reps.push('</AdaptationSet>'); return '<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="'+mediaDuration+'" minBufferTime="PT1.5S"><Period duration="'+mediaDuration+'">'+reps.join('')+'</Period></MPD>'; }
export function createMpdUrl(dash,selection){ const xml=buildMpdXml(dash,selection); return {xml,url:URL.createObjectURL(new Blob([xml],{type:'application/dash+xml'}))}; }
