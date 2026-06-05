// ====== Web 模式 fetchPlayurl（原始逻辑，不改动） ======
export async function fetchPlayurlWeb(context, cfg) {
  const params = new URLSearchParams();
  if (context.epId) params.set('ep_id', String(context.epId));
  if (context.cid) params.set('cid', String(context.cid));
  if (context.aid) params.set('avid', String(context.aid));
  params.set('qn', cfg.defaultQn || '80');
  params.set('fnver', '0');
  params.set('fnval', '4048');
  params.set('fourk', '1');
  params.set('area', cfg.area || 'hk');
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
