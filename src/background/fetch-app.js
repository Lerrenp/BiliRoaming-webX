// App 模式 fetchPlayurl（Android 端签名 + BiliRoaming 转发）。
//
// 路径选择（按 area）：
//   - th (泰国/东南亚)  → <base>/intl/gateway/v2/ogv/playurl   （bstar_a 签名集）
//   - 其它 (hk/tw/cn)   → <base>/pgc/player/api/playurl        （android 签名集）
//
// 签名算法（与 B 站 Android API 一致）：
//   sign = MD5( sort(params) + appsec )
//   - 所有 key 按字典序排序
//   - 编码用 encodeURIComponent，& 连接
//   - 末尾直接拼 appsec，MD5 后小写 32 字符
//
// 凭证来源：APP_SIGN 中的 appkey / appsec / build 来自 B 站官方 Android 客户端公开配置，
// 与 BiliRoaming 生态（油猴脚本、Xposed 模块）共用同一组。不是用户私人凭证。

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

const APP_SIGN = {
  main: { appkey:'1d8b6e7d45233436', appsec:'560c52ccd288fed045859ed18bffd973', mobi_app:'android', platform:'android', device:'android', otype:'json', module:'pgc', build:'6800300' },
  th:   { appkey:'7d089525d3611b1c', appsec:'acd495b248ec528c2eed1e862d393126', mobi_app:'bstar_a', platform:'android', build:'1001310' },
};

function appSign(paramsObj, appsec) {
  const keys = Object.keys(paramsObj).sort();
  const query = keys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(paramsObj[k])).join('&');
  return md5(query + appsec);
}

export async function fetchPlayurlApp(context, cfg) {
  const area = cfg.area || 'hk';
  const isTH = area === 'th';
  const ac = isTH ? APP_SIGN.th : APP_SIGN.main;
  const path = isTH ? '/intl/gateway/v2/ogv/playurl' : '/pgc/player/api/playurl';
  const base = String(cfg.serverBaseUrl || '').replace(/\/+$/, '');

  const params = {};
  if (context.epId) params.ep_id = String(context.epId);
  if (context.cid) params.cid = String(context.cid);
  if (context.aid) params.avid = String(context.aid);
  params.qn = cfg.defaultQn || '80';
  params.fnver = '0';
  params.fnval = '4048';
  params.fourk = '1';
  params.area = area;

  if (cfg.accessKey) params.access_key = cfg.accessKey;
  Object.assign(params, {
    appkey: ac.appkey,
    mobi_app: ac.mobi_app,
    platform: ac.platform,
    build: ac.build,
  });
  if (ac.device) params.device = ac.device;
  if (ac.otype) params.otype = ac.otype;
  if (ac.module) params.module = ac.module;

  params.sign = appSign(params, ac.appsec);

  const keys = Object.keys(params).sort();
  const qs = keys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const url = base + path + '?' + qs;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Bilibili Freedoooooom/MarkII',
      'x-from-biliroaming': '9.999.0',
      'build': '9999999',
      'platform-from-biliroaming': 'android',
    },
  });
  const json = await resp.json();
  if (json && json.code === 0) return json;
  throw new Error('BiliRoaming playurl failed: ' + JSON.stringify(json).slice(0, 500));
}
