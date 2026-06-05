// 项目级常量与默认配置。
// BRX.* — 跨世界（MAIN ↔ ISOLATED）postMessage 协议标识，必须保持稳定。
// DEFAULT_CONFIG — popup/options/background 三方共享的初始配置；
//   公开 BiliRoaming 公共服务端（xcnya）已失效，开发测试请用自建（majiawebtest）。
// QUALITY_LABELS — B 站 dash.video[].id 到中文清晰度名的映射，覆盖主流 8K ~ 360P。

export const BRX = Object.freeze({
  MAIN_SOURCE: 'BRX_PLAYER_MAIN',
  CONTENT_SOURCE: 'BRX_PLAYER_CONTENT',
  START: 'BRX_PLAYER_START',
  EPISODE_SELECT: 'BRX_PLAYER_EPISODE_SELECT',
});

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  serverBaseUrl: 'https://bili.xcnya.cn',
  area: 'hk',
  clientMode: 'web',
  // 是否在 Web 模式请求中附带 BiliRoaming 标识头（x-from-biliroaming / platform-from-biliroaming / User-Agent）。
  // 旧 PHP 后端在收到这些头时会返回 code=-15，需要在 popup 关闭它。
  webRoamingHeaders: true,
  accessKey: '',
  defaultQn: '80',
  defaultCodec: 'auto',
  defaultAudioId: 'auto',
  danmakuEnabled: true,
  danmakuOpacity: 0.95,
  danmakuArea: 0.75,
  danmakuFontSize: 25,
  danmakuSpeed: 1,
  danmakuMaxVisible: 120,
  debug: true,
});

export const QUALITY_LABELS = Object.freeze({
  127: '8K',
  126: '杜比视界',
  125: 'HDR',
  120: '4K',
  116: '1080P60',
  112: '1080P+',
  80:  '1080P',
  74:  '720P60',
  64:  '720P',
  32:  '480P',
  16:  '360P',
  15:  '360P',
});
