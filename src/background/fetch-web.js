// Web 模式 fetchPlayurl。
// 路径：<serverBaseUrl>/pgc/player/web/playurl
// 必要参数：ep_id / cid / avid 三选一，qn（默认 80），fnver=0，fnval=4048（DASH），fourk=1，area。
//
// BiliRoaming 头策略（webRoamingHeaders 配置）：
//   - 开启时附带 x-from-biliroaming / platform-from-biliroaming / User-Agent。
//   - 关闭时只发浏览器默认头。用于兼容旧 PHP 后端（这些头会让它返回 code=-15）。
//
// 不修改行为：
//   - 这是 BiliRoaming 服务端期望的"web"通道；
//   - area 仅用 4 选 1（hk / tw / cn / th），由 popup/options 提供。
export async function fetchPlayurlWeb(context, cfg) {
  const params = new URLSearchParams();
  if (context.epId) params.set('ep_id', String(context.epId));
  if (context.cid)  params.set('cid',  String(context.cid));
  if (context.aid)  params.set('avid', String(context.aid));
  params.set('qn',    cfg.defaultQn || '80');
  params.set('fnver', '0');
  params.set('fnval', '4048');
  params.set('fourk', '1');
  params.set('area',  cfg.area || 'hk');
  if (cfg.accessKey) params.set('access_key', cfg.accessKey);

  const base = String(cfg.serverBaseUrl || '').replace(/\/+$/, '');
  const url = base + '/pgc/player/web/playurl?' + params.toString();

  const init = {};
  if (cfg.webRoamingHeaders !== false) {
    init.headers = {
      'User-Agent': 'Bilibili Freedoooooom/MarkII',
      'x-from-biliroaming': 'biliroaming-x-player',
      'platform-from-biliroaming': 'web',
    };
  }
  const resp = await fetch(url, init);
  const json = await resp.json();
  if (json && json.code === 0) return json;
  throw new Error('BiliRoaming playurl failed: ' + JSON.stringify(json).slice(0, 500));
}
