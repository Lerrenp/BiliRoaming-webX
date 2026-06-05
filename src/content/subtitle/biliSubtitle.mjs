// B 站字幕适配层。
//
// 解决 PGC 受限页字幕问题：原生页面有字幕但被区域限制隐藏，我们用 ArtPlayer 接管后，
// 从 PGC 字幕 view API 拉字幕再注入。
//
// 数据流：
//   B 站字幕 protobuf view (binary)
//     → parseSubtitleViewProto 解出 subtitle_url（base64 + XOR 编码）
//     → decodeBiliSubtitleUrl XOR 解码得 aisubtitle JSON URL
//     → fetch JSON
//     → biliJsonToVtt 转 WebVTT
//     → URL.createObjectURL(Blob) → 喂给 ArtPlayer art.subtitle.init({url, type:'vtt'})
//
// 切集：传新 (aid, cid) 给 fetchBiliSubtitleVtt()，重复上面流程。
//
// Protobuf schema（手解，非 protobufjs）：
//   外层: 1 → wrapper_msg
//   wrapper_msg: 3 → Subtitle
//   Subtitle: 1=id(int), 2=aid_string, 3=lan, 4=lan_doc, 5=subtitle_url(string)

const BILI_SUBTITLE_KEYS = Object.freeze([
  { key: 'nP](wOFRvU.+<fjS{jn-!$D|Dz&",zT`', prefix: '=CFxYRn{.y|uVyO$uh&sikph?N.ilF/`' },
  { key: 'Bn"q~|albg@]Go~ACgyDvKnd+)_D}^&J?', prefix: "Cu~L!xs~f^&r@'vh=q]q{eeng*sEg^kp#J" },
]);

function xorDecode(str, key) {
  let r = '';
  for (let i = 0; i < str.length; i++) {
    r += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return r;
}

function readVarint(bytes, pos) {
  let result = 0, shift = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  return [result, pos];
}

function parseMessage(bytes) {
  const fields = {};
  let pos = 0;
  while (pos < bytes.length) {
    const [tag, posAfterTag] = readVarint(bytes, pos);
    const wireType = tag & 0x7;
    const fieldNum = tag >> 3;
    pos = posAfterTag;
    if (wireType === 2) {
      const [len, newPos] = readVarint(bytes, pos);
      const dataStart = newPos;
      pos = dataStart + len;
      const slice = new Uint8Array(bytes.buffer, bytes.byteOffset + dataStart, len);
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(slice);
    } else if (wireType === 0) {
      const [v, newPos] = readVarint(bytes, pos);
      pos = newPos;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(v);
    } else {
      break;
    }
  }
  return fields;
}

export function parseSubtitleViewProto(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // 外层 wrapper: field 1 → wrapper_msg → field 3 → Subtitle 消息
  // Subtitle 字段: 1=id(int), 2=aid_string, 3=lan, 4=lan_doc, 5=subtitle_url
  const outer = parseMessage(bytes);
  const wrapper = parseMessage(outer[1]?.[0] || new Uint8Array(0));
  const sub = parseMessage(wrapper[3]?.[0] || new Uint8Array(0));
  const dec = (v) => (v ? new TextDecoder('utf-8').decode(v) : null);
  return {
    id: sub[1]?.[0],
    lan: dec(sub[3]?.[0]),
    lanDoc: dec(sub[4]?.[0]),
    subtitleUrl: dec(sub[5]?.[0]),
  };
}

export function decodeBiliSubtitleUrl(encoded) {
  if (!encoded) return null;
  const urlParts = encoded.split('?');
  if (urlParts.length < 2) return null;
  const m = urlParts[0].match(/\/\/subtitle\.bilibili\.com\/([^?]+)/);
  if (!m) return null;
  const payload = m[1];
  let decoded;
  try { decoded = decodeURIComponent(payload); } catch (_) { decoded = payload; }
  for (const { key, prefix } of BILI_SUBTITLE_KEYS) {
    const xorKey = prefix + 'bilibili';
    const result = xorDecode(decoded, xorKey);
    if (result.startsWith(key)) {
      const path = result.slice(key.length);
      return `https://aisubtitle.hdslb.com${path}?${urlParts[1]}`;
    }
  }
  return null;
}

function formatVttTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.padStart(6, '0')}`;
}

function biliJsonToVtt(json) {
  const body = Array.isArray(json?.body) ? json.body : [];
  const lines = ['WEBVTT', ''];
  for (const item of body) {
    if (typeof item?.from !== 'number' || typeof item?.to !== 'number') continue;
    const text = String(item.content || '').replace(/\r?\n/g, '\n');
    if (!text.trim()) continue;
    lines.push(`${formatVttTime(item.from)} --> ${formatVttTime(item.to)}`);
    lines.push(text);
    lines.push('');
  }
  return lines.join('\n');
}

export async function fetchBiliSubtitleVtt({ cid, aid, type = 1 } = {}, { signal, log } = {}) {
  if (!cid || !aid) throw new Error('fetchBiliSubtitleVtt: missing cid/aid');
  const ctx = JSON.stringify({ video_type: 2 });
  const url = `https://api.bilibili.com/x/v2/subtitle/web/view?oid=${encodeURIComponent(cid)}&pid=${encodeURIComponent(aid)}&type=${type}&context_ext=${encodeURIComponent(ctx)}&cur_production_type=0`;
  if (log) log.info('subtitle: fetch view', { cid, aid });
  const r = await fetch(url, {
    credentials: 'include',
    headers: { 'Referer': 'https://www.bilibili.com/' },
    signal,
  });
  if (!r.ok) throw new Error('subtitle view http ' + r.status);
  const buf = await r.arrayBuffer();

  const track = parseSubtitleViewProto(buf);
  if (!track.subtitleUrl) {
    if (log) log.info('subtitle: no subtitle for this episode', { cid, aid });
    return null;
  }
  const jsonUrl = decodeBiliSubtitleUrl(track.subtitleUrl);
  if (!jsonUrl) {
    if (log) log.warn('subtitle: failed to decode subtitle url', track.subtitleUrl.slice(0, 80));
    return null;
  }
  if (log) log.info('subtitle: decoded url', { lan: track.lan, jsonUrl: jsonUrl.slice(0, 100) });

  const r2 = await fetch(jsonUrl, {
    headers: { 'Referer': 'https://www.bilibili.com/' },
    signal,
  });
  if (!r2.ok) throw new Error('subtitle json http ' + r2.status);
  const json = await r2.json();
  const vtt = biliJsonToVtt(json);
  if (log) log.info('subtitle: vtt built', { lan: track.lan, items: json.body?.length || 0, vttBytes: vtt.length });
  const blob = new Blob([vtt], { type: 'text/vtt' });
  return {
    blobUrl: URL.createObjectURL(blob),
    lan: track.lan,
    lanDoc: track.lanDoc,
    itemCount: Array.isArray(json.body) ? json.body.length : 0,
  };
}
