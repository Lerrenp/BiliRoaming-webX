# BiliRoaming-X Player 计划文档

> 创建日期：2026-06-04  
> 最后修订：2026-06-04（v0.3 草案）  
> 目标：在受限番剧播放时，浏览器扩展调用 BiliRoaming 解析服务，**用 ArtPlayer 体系覆盖 B 站原生播放器**，并正确加载弹幕和评论。

---

## 0. 修订记录

### v0.3（2026-06-04 草案，**待评审**）

**关键变更**：
- 播放器内核：**VisionPlayer → ArtPlayer 5.4.1**
- 弹幕内核：**danmaku-lite → artplayer-plugin-danmuku**
- 清晰度/音轨 UI：**自写 qualityPanel → artplayer-plugin-dash-control**
- 业务封装层：新增 **`biliDashProvider/`** 子模块，对外只暴露 `mount(ctx)` API

**关键认知修正**（重要，影响后续工作量）：

| 原认知 | 修正后 | 影响 |
|---|---|---|
| 切换 ArtPlayer 后可"消灭 MPD Builder" | **B 站 v2 JSON 是非标 DASH，MPD Builder 是领域适配器，必须保留** | 不再投入精力研究"消灭"方案 |
| 切换后 dash.js 可去掉 | **`artplayer-plugin-dash-control` 不含 MSE 引擎，dash.js 必须保留** | manifest web_accessible_resources 保留 `dash.all.min.js` |
| `artplayer-plugin-danmuku/bilibili.js` 能直接吃 B 站弹幕 | **插件吃 XML，B 站是 Protobuf，仍需转接层** | 需要 `protobufToXml.mjs` |
| "2.x→5.x 转换层"是 API 包装 | **是 B 站 v2 端点 → 标准 MPD XML 的协议格式转换** | 命名修正为"MPD Builder" |

**新工作分解**（4-5 天，比原 8-10 天减半）详见 §十一。

---

## 一、项目背景与目标

### 1.1 项目定位

| 项 | 说明 |
|---|---|
| 项目名 | BiliRoaming-X Player |
| 目录 | `D:\claude-code\project\bilibili项目\biliExtensionsplayer` |
| 性质 | 独立仓库，重写而非移植（旧 `bilibiliExtensions` 已停更）|
| 版本 | v0.1.0（计划起点）|
| 核心策略 | **覆盖式播放器** — 不修补 B 站原生 Player，直接用第三方播放器盖在上面 |

### 1.2 核心目标

1. **受限自动检测**：访问 `https://www.bilibili.com/bangumi/play/*` 时检测是否区域限制
2. **代理取流**：通过 background service worker 调用 BiliRoaming 解析服务（`https://bili.xcnya.cn`）
3. **播放器覆盖**：在原播放器位置覆盖一层 VisionPlayer，渲染 DASH 视频流
4. **弹幕层叠加**：VisionPlayer 上方叠加 danmaku-lite 弹幕层，加载 B 站弹幕（带 WBI 签名）
5. **评论保留**：保留 B 站原生评论区 `#comment-module` 不动
6. **状态联动**：同步 B 站 UI（点赞、投币、收藏、进度、追番）状态

### 1.3 关键技术约束

- 强制 ESM（import / export，禁止 require / IIFE）
- MV3 manifest
- MAIN world 注入 + ISOLATED content script + background service worker 三层架构
- TypeScript（与 VisionPlayer、danmaku-lite 保持一致）
- BiliRoaming 服务端协议：web 模式（/pgc/player/web/playurl）+ hk/tw/cn 区域
- **CORS**：m4s 拉取必须在 https://www.bilibili.com/... 页面下，浏览器自动注入 Origin
- **m4s 防盗链**：必须从 cookie 注入 buvid3 到每个 m4s URL

---

## 二、参考项目分析

### 2.1 VisionPlayer（@alphanull/visionplayer v1.3.0）

| 维度 | 评估 |
|---|---|
| 包大小 | 单一零依赖 bundle（含样式 + SVG + i18n）|
| DASH 支持 | 内置（MSE 引擎）|
| HLS 支持 | 内置（hls.js 不在 bundle 中，动态加载）|
| 多音轨 | 完整 UI |
| 多字幕 | WebVTT / TTML / 原生 track |
| 主题 | 内置暗 / 亮，自定义 CSS 变量 |
| 嵌入方式 | 单类 VisionPlayer，通过 data-vip 属性可挂载到任意元素 |
| 多语言 | 含 zh-CN |
| 局限 | 需自建 DASH MPD 喂入；B 站 DASH 是非标准（无 Period/AdaptationSet），需自己构造 MPD |

**集成策略**：
- 通过 ESM import 单文件 bundle 到 content script
- 在覆盖容器中 new VisionPlayer(container, { ... })
- 用 attachSource(url) 喂 DASH MPD（Blob URL 形式）

### 2.2 danmaku-lite

| 维度 | 评估 |
|---|---|
| 后端 | Canvas 2D（高性能，500+ 并发）/ DOM（简单）|
| 引擎 | 双引擎可切换 |
| 数据源 | DataSourceAdapter 接口（自定义）|
| 弹幕格式 | XML（B 站 .xml 格式） / Protobuf（dm.web/view）/ 自定义 |
| 帧率 | 可配置，默认 60 |
| 引擎文件大小 | Canvas 引擎 + 核心 ~50KB |
| 局限 | B 站弹幕是 Protobuf 格式（dm.web/view），需要解码 |

**集成策略**：
- 引入 DanmakuEngine（Canvas）
- 写一个 BilibiliDataSourceAdapter 实现：
  - 拉 dm.web/view 拿元数据（Protobuf）
  - 拉 dm.wbi/web/seg.so?segment_index=N 拿实际弹幕（Protobuf）
  - 解析 Protobuf（需手写或用 protobufjs）
- 弹幕定位在 VisionPlayer 容器内，绝对定位 position: absolute; z-index: 10

### 2.3 BiliRoaming Rust 服务端

| 维度 | 评估 |
|---|---|
| 路径 | /pgc/player/web/playurl（web 模式）/ /pgc/player/api/playurl（app 模式）|
| 必带参数 | ep_id、cid、qn=80、fnval=4048、fourk=1、area=hk|tw|cn|th |
| 必带 header | User-Agent: Bilibili Freedoooooom/MarkII、x-from-biliroaming、platform-from-biliroaming |
| access_key | App 32+ 字符（Rust 截取前 32 位）|
| 返回 | code:0 + 15 视频流 + 3 音频流 DASH |
| 缺陷 | 返回的 m4s URL 中 buvid= 为空字符串，必须本地注入 |

### 2.4 B 站原生页面 DOM（已抓取）

```
#bilibili-player (位置 50,104 尺寸 1152x704)  ← 覆盖目标
  └ .bpx-player-container
      └ .bpx-player-video-wrap
          └ .bpx-player-video-area
              └ video   ← 视频（覆盖后隐藏）
  └ .bpx-player-dm (弹幕层)
      └ .bpx-player-dm-wrap
          └ .bpx-player-dm-container  ← 弹幕插入点

#comment-module (位置 50,1126 尺寸 1152x169)  ← 保留不动
.eplist_ep_list_wrapper (位置 1231,216 尺寸 411x406)  ← 拦截点击
.toolbar (位置 50,808 尺寸 1152x66)  ← 同步状态
```

---

## 三、系统架构

### 3.1 总体架构图

```
+-------------------------------------------------------------+
| B 站页面 (https://www.bilibili.com/bangumi/play/...)         |
|                                                             |
|  +----------- MAIN world (main.js) ----------------+         |
|  | 检测区域限制 (PlayInfo / player.getManifest)     |         |
|  | 注入覆盖 UI (visionplayer-mount)                 |         |
|  | 拦截集数链接 (eplist_ep_list_wrapper)            |         |
|  | 注入 buvid3 到 m4s URL                           |         |
|  +-----------+-------------------------------------+         |
|              | postMessage                                   |
|  +----------- ISOLATED world (content.js) ---------+         |
|  | chrome.runtime.sendMessage → background        |         |
|  | 注入 VisionPlayer bundle (UMD/ESM)              |         |
|  | 注入 danmaku-lite bundle                        |         |
|  | 启动覆盖流程                                   |         |
|  +-----------+-------------------------------------+         |
|              | chrome.runtime.sendMessage                    |
|  +----------- background (service-worker.js) ------+         |
|  | 调 BiliRoaming 服务 (fetch playurl)              |         |
|  | 处理 Rust 协议转换                              |         |
|  | access_key 注入                                  |         |
|  | 维护 m4s URL 缓存                                |         |
|  +-----------+-------------------------------------+         |
|              | fetch                                         |
|  +----------- bili.xcnya.cn ------------------------+        |
|  | Rust BiliRoaming 服务                           |         |
|  +------------------------------------------------+         |
+-------------------------------------------------------------+
```

### 3.2 模块划分

```
biliExtensionsplayer/
|-- manifest.json
|-- src/
|   |-- inject/
|   |   |-- main.ts                    # MAIN world 入口
|   |   |-- detectors/
|   |   |   |-- areaLimit.ts          # 区域限制检测
|   |   |   `-- episodeLink.ts        # 集数链接拦截
|   |   |-- url/
|   |   |   |-- buvidInjector.ts      # m4s URL 注入 buvid3
|   |   |   `-- playContextDeriver.ts # ep_id/cid/aid 推导
|   |   `-- overlay/
|   |       `-- mountCoordinator.ts   # 协调覆盖层挂载
|   |
|   |-- content/
|   |   |-- content.ts                # ISOLATED world 入口
|   |   |-- bridge.ts                 # MAIN ISOLATED 桥接
|   |   |-- visionPlayerLoader.ts     # 动态 import VisionPlayer bundle
|   |   |-- danmakuLoader.ts          # 动态 import danmaku-lite bundle
|   |   |-- player/
|   |   |   |-- visionController.ts   # VisionPlayer 控制器
|   |   |   |-- dashMpdBuilder.ts     # B 站 DASH → 标准 MPD
|   |   |   |-- qualitySelector.ts    # 清晰度切换
|   |   |   `-- trackSelector.ts      # 音轨切换
|   |   |-- danmaku/
|   |   |   |-- bilibiliAdapter.ts    # B 站数据源适配器
|   |   |   |-- protobufDecoder.ts    # Protobuf 解码
|   |   |   |-- wbiSigner.ts          # WBI 签名 (w_rid, wts)
|   |   |   `-- engineController.ts   # danmaku-lite 引擎控制
|   |   `-- comment/
|   |       `-- commentObserver.ts    # 评论区观察
|   |
|   |-- background/
|   |   |-- service-worker.ts        # service worker 入口
|   |   |-- api/
|   |   |   |-- proxyPlayurl.ts      # 转发到 BiliRoaming
|   |   |   |-- proxyDanmaku.ts      # 转发到 B 站弹幕
|   |   |   `-- proxySubtitle.ts     # 转发到 B 站字幕
|   |   |-- config/
|   |   |   `-- userConfig.ts        # 用户配置 (server, area, key)
|   |   `-- cache/
|   |       `-- playurlCache.ts       # playurl 缓存
|   |
|   |-- common/
|   |   |-- constants.ts             # 端点 URL / API 路径
|   |   |-- types.ts                 # 共享类型
|   |   |-- logger.ts                # 统一日志
|   |   `-- errors.ts                # 自定义错误
|   |
|   |-- popup/
|   |   |-- popup.html
|   |   |-- popup.ts
|   |   `-- popup.css
|   |
|   |-- options/
|   |   |-- options.html
|   |   |-- options.ts
|   |   `-- options.css
|   |
|   `-- player/
|       `-- (本目录放置 VisionPlayer/danmaku-lite bundle 拷贝)
|
|-- assets/
|   `-- icons/
|
|-- vendor/
|   |-- visionplayer.umd.js          # VisionPlayer 单文件 bundle
|   `-- danmaku-lite.esm.js          # danmaku-lite 单文件 bundle
|
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- COMPATIBILITY.md
|   `-- ROADMAP.md
|
|-- tests/
|   |-- buvidInjector.test.ts
|   |-- dashMpdBuilder.test.ts
|   |-- wbiSigner.test.ts
|   `-- bilibiliAdapter.test.ts
|
|-- package.json
|-- tsconfig.json
|-- vite.config.ts                   # bundle vendor
`-- README.md
```

---

## 四、关键模块设计

### 4.1 MAIN world 注入（main.ts）

**触发时机**：document_start

**职责**：

1. **检测区域限制**：
```ts
function isAreaLimited(): boolean {
  const pi = window.__playinfo__?.result;
  if (!pi) return false;
  if (pi.play_video_type === 'none') return true;
  if (pi.play_check?.play_detail === 'PLAY_NONE') return true;
  if (Array.isArray(pi.plugins) && pi.plugins.some(p => p?.name === 'AreaLimitPanel')) return true;
  return false;
}
```

2. **拦截集数链接**：
```ts
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest('a[href*="/bangumi/play/ep"]');
  if (!link) return;
  e.preventDefault();
  const epId = link.getAttribute('href').match(/ep(\d+)/)?.[1];
  if (epId) {
    window.postMessage({ source: 'BRX_MAIN', type: 'EPISODE_SELECT', epId }, '*');
  }
}, true);
```

3. **注入 buvid3 到 m4s URL**（与 content 协作）：
```ts
function injectBuvid(m4sUrl: string): string {
  const buvid3 = (document.cookie.match(/buvid3=([^;]+)/) || [])[1] || '';
  try {
    const u = new URL(m4sUrl);
    if (!u.searchParams.get('buvid')) {
      u.searchParams.set('buvid', buvid3);
    }
    return u.href;
  } catch { return m4sUrl; }
}
```

### 4.2 ISOLATED world 注入（content.ts）

**触发时机**：document_idle（MAIN 注入后）

**职责**：

1. **加载 vendor bundle**：
```ts
import { visionPlayerBundle } from '../player/visionplayer.umd.js';  // 静态 import
// 或：
const visionPlayer = await import(chrome.runtime.getURL('vendor/visionplayer.umd.js'));
```

2. **与 MAIN world 通信**：
```ts
window.addEventListener('message', async (e) => {
  if (e.source !== window) return;
  const msg = e.data;
  if (msg?.source === 'BRX_MAIN') {
    if (msg.type === 'EPISODE_SELECT') {
      const playurl = await chrome.runtime.sendMessage({
        type: 'BRX_ACTION', action: 'FETCH_PLAYURL',
        payload: { epId: msg.epId, cid: msg.cid, ... }
      });
      await launchVisionPlayer(playurl);
    }
  }
});
```

3. **挂载 VisionPlayer 覆盖层**：
```ts
async function launchVisionPlayer(playurlResp: PlayurlResult) {
  // 1. 找到原播放器
  const target = document.querySelector('#bilibili-player');
  if (!target) return;

  // 2. 构造 DASH MPD XML
  const mpdXml = buildMpdXml(playurlResp);
  const mpdBlob = new Blob([mpdXml], { type: 'application/dash+xml' });
  const mpdUrl = URL.createObjectURL(mpdBlob);

  // 3. 给每个 m4s URL 注入 buvid3
  const patchedMpd = patchMpdWithBuvid(mpdXml);

  // 4. 挂载 VisionPlayer
  const mount = document.createElement('div');
  mount.id = 'brx-visionplayer-mount';
  mount.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:50;background:#000';
  target.style.position = 'relative';
  target.appendChild(mount);

  // 5. 初始化 VisionPlayer
  const player = new VisionPlayer(mount, {
    src: patchedMpdUrl,
    type: 'application/dash+xml',
    ...visionOptions
  });

  // 6. 启动 danmaku-lite
  await startDanmaku(player, playurlResp.context);

  // 7. 隐藏原 B 站播放器视频
  const origVideo = target.querySelector('video');
  if (origVideo) origVideo.style.opacity = '0';

  // 8. 移除区域限制 UI
  document.querySelectorAll('[class*="areaLimit"], .bpx-player-error-wrap, #big-block-panel')
    .forEach(el => el.remove());
}
```

### 4.3 DASH MPD 构造器（dashMpdBuilder.ts）

**关键挑战**：B 站返回的 dash.video[] / dash.audio[] 是**非标准 DASH 格式**（没有 Period/AdaptationSet），需要构造标准 MPD XML。

**输入**：`{ dash: { video: Video[], audio: Audio[], duration: number } }`

**输出**：标准 DASH MPD XML 字符串

**结构**：
```xml
<MPD type="static" mediaPresentationDuration="PT25M1S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">
      <Representation id="video-112-avc" codecs="avc1.640032" bandwidth="1669031" width="1920" height="1080" frameRate="24.390">
        <BaseURL>https://upos-...m4s?buvid=...</BaseURL>
        <SegmentBase indexRange="995-4614">
          <Initialization range="0-994" />
        </SegmentBase>
      </Representation>
      <Representation id="video-112-hevc" .../>
      <!-- ... -->
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true">
      <Representation id="audio-30280" codecs="mp4a.40.2" bandwidth="193656" audioSamplingRate="48000">
        <BaseURL>...</BaseURL>
        <SegmentBase indexRange="946-4589">
          <Initialization range="0-945" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
```

**每个 Representation 内的 BaseURL 必须包含 buvid3 参数**（与 background 协作或本地注入）。

### 4.4 弹幕数据源适配器（bilibiliAdapter.mjs）

**目标**：把 B 站 Protobuf 弹幕转成 `artplayer-plugin-danmuku` 期望的 XML 格式。

```js
// biliDashProvider/protobufToXml.mjs
export async function fetchBilibiliDanmakuXml({ cid, aid, duration }, { wbiSign, log }) {
  // 1. 拉 dm.web/view（Protobuf）→ 拿元数据
  const meta = await fetchViewMeta({ cid, aid, duration, wbiSign });
  // 2. 拉 dm.wbi/web/seg.so?segment_index=N（Protobuf）× N 段
  const segments = await Promise.all(
    range(meta.segments).map(i => fetchSegment(i, { cid, aid, wbiSign }))
  );
  // 3. 解析 Protobuf → 弹幕对象数组
  const items = segments.flatMap(parseSegProtobuf);
  // 4. 转成 XML（B 站 comment.bilibili.com 风格，供 danmuku 插件解析）
  return buildBilibiliXml(items);
}
```

**XML 输出格式**（与 `comment.bilibili.com/<cid>.xml` 一致）：

```xml
<i>
  <d p="time,mode,fontsize,color,timestamp,pool,user,rowId">弹幕文本</d>
  <d p="...">...</d>
</i>
```

**关键说明**：
- `artplayer-plugin-danmuku/bilibili.js` 已经实现了这个 XML 格式的解析（含 Web Worker 异步）
- 我们只需要**生产**这个 XML，不需要自己解析
- 节省：原计划 `parseDanmakuViewProtobuf` + `parseDanmakuSegProtobuf` 的复杂实现 → 简化为"生产 XML"
- **Protobuf 解码仍需保留**（手写 varint/length-delimited，约 100 行）

### 4.5 WBI 签名（wbiSigner.ts）

参考 B 站开源 WBI 算法：

```ts
const MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';  // 当前 mixin key (会轮换)

async function getWbiSign(params: URLSearchParams): Promise<string> {
  // 1. 按 key 排序
  const sorted = [...params.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  // 2. 拼接
  const query = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  // 3. 计算 w_rid
  const w_rid = md5(query + MIXIN_KEY);
  return w_rid;
}
```

**注意**：mixin_key 是 B 站前端暴露的，固定时间内不变；需要 background 中 navigator.webdriver 假装非自动化请求（已验证不需要，B 站直接给）。

### 4.6 Protobuf 解码

**两个 Protobuf 定义**：

1. **dm.web/view**（Dmmeta.pb）— 弹幕元数据
2. **dm.wbi/web/seg.so**（DmSegMobileReply.pb）— 弹幕段

**两种实现**：

| 方案 | 优缺点 |
|---|---|
| 手写 .proto → TS 类型 + 手动解析 | 零依赖，体积小，但要自己处理 varint/zigzag |
| protobufjs（动态加载）| 自动生成，但 100KB+ 依赖 |

**决策**：手写核心 Protobuf 解析（只支持 varint/length-delimited/32-bit/64-bit 几种），减体积。

**v0.3 调整**：解码完成后**输出转为 XML**（见 §4.4），不直接构造 JS 对象数组给业务层。这样业务层完全无感 Protobuf 存在。

### 4.6.1 MPD Builder 的定位（**v0.3 关键澄清**）

**MPD Builder 不是"要消灭的转换层"，而是"领域适配器"**：

| 输入 | 输出 | 性质 |
|---|---|---|
| B 站 playurl v2 JSON（含 `dash.video[]/audio[]`）| 标准 MPD XML（Period/AdaptationSet/Representation/SegmentBase）| **领域适配器** |

为什么不能消灭：
- B 站 v2 JSON 字段命名 `base_url`（下划线）vs MPD `BaseURL`（驼峰）
- B 站无 `Period` 概念
- B 站无 `AdaptationSet` 概念（需按 `id`（质量码）+ `codecs` 自动分组）
- B 站 DASH 是单文件 m4s，MPD 强制要求 `SegmentBase` + `Initialization` 结构
- **任何播放 DASH 的方案都需要这一步**（不只是我们）

**结论**：`mpdBuilder.mjs` 永久保留在 `biliDashProvider/` 下。

### 4.6.2 dash.js 的定位（**v0.3 关键澄清**）

**artplayer-plugin-dash-control 不含 MSE 引擎**，源码中所有调用都是 dash.js API：

```js
// artplayer-plugin-dash-control/src/index.js
const qualities = dash.getBitrateInfoListFor('video')  // ← dash.js
const audioTracks = dash.getTracksFor('audio')         // ← dash.js
dash.setQualityFor('video', item.value)                // ← dash.js
```

**ArtPlayer 自身不支持 DASH**（只内置 HLS），因此：

| 组件 | 角色 |
|---|---|
| ArtPlayer | video 元素 + UI 状态机 |
| artplayer-plugin-dash-control | 清晰度/音轨**菜单 UI**（调 dash.js API）|
| **dash.js** | **MPD 解析 + MSE 引擎**（不可替代）|

**结论**：`dash.all.min.js` 永久保留在 `vendor/`。

---

## 4.7 biliDashProvider 子模块设计（v0.3 新增）

### 定位
把"B 站特殊协议"封装在一个业务插件内，**对外只暴露 `mountBiliDashPlayer(ctx)` API**。

### 接口契约
```ts
interface MountOptions {
  container: HTMLElement;           // 覆盖层 div
  playurlResponse: PlayurlResponse; // B 站 v2 JSON（含 result.dash）
  context: {
    cid: number;
    aid: number;
    duration: number;               // ms
    title?: string;
  };
  config: {
    defaultQn?: number;             // 默认清晰度
    defaultCodec?: 'avc'|'hevc'|'av1'|'auto';
    defaultAudioId?: string|number;
    danmakuEnabled?: boolean;
    danmakuOpacity?: number;
  };
  log: Logger;
}

interface Player {
  destroy(): void;
  reload(opts?: { qn?, codec?, audioId? }): Promise<void>;
  setDanmakuEnabled(enabled: boolean): void;
  // ... 其他 ArtPlayer 代理 API
}

function mountBiliDashPlayer(opts: MountOptions): Promise<Player>;
```

### 内部流程
```
mountBiliDashPlayer(opts)
  ↓
加载 vendor/artplayer/* bundle
  ↓
mpdBuilder.buildMpdXml(opts.playurlResponse.result.dash, opts.config)
  ↓
URL.createObjectURL(blob) → mpdUrl
  ↓
加载 vendor/dash.all.min.js → window.dashjs
  ↓
const dash = dashjs.MediaPlayer().create()
dash.initialize(video, mpdUrl)
  ↓
new ArtPlayer({ container, video, ... })
  ↓
art.dash = dash
art.plugins.add(artplayerPluginDashControl())
art.plugins.add(artplayerPluginDanmuku({ danmuku: protobufToXml }))
```

### 文件组织
```
src/content/player/biliDashProvider/
├── index.mjs           # mountBiliDashPlayer 主入口
├── mpdBuilder.mjs      # 搬自 dashMpdBuilder.mjs
├── buvidInjector.mjs   # 搬自 patchM4sUrl
├── wbiSigner.mjs       # WBI 签名
├── protobufToXml.mjs   # B 站 Protobuf 弹幕 → XML
├── protobufDecoder.mjs # 手写 Protobuf varint/length-delimited 解析
└── style.mjs           # 注入样式（隔离）
```

### 4.7 background service-worker.ts

```ts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BRX_ACTION') {
    if (msg.action === 'FETCH_PLAYURL') return handleFetchPlayurl(msg, sendResponse);
    if (msg.action === 'FETCH_DANMAKU') return handleFetchDanmaku(msg, sendResponse);
    if (msg.action === 'GET_CONFIG') return sendResponse(getUserConfig());
  }
});

async function handleFetchPlayurl(msg, sendResponse) {
  const cfg = await getUserConfig();
  // 1. 构造 BiliRoaming URL
  const url = `${cfg.serverBaseUrl}/pgc/player/web/playurl?${buildQuery(msg.payload, cfg)}`;
  // 2. fetch
  const resp = await fetch(url, { headers: buildHeaders(cfg) });
  const json = await resp.json();
  if (json.code !== 0) throw new Error(`BiliRoaming error: ${json.message}`);
  sendResponse(json);
}
```

---

## 五、核心用户场景与流程

### 5.1 场景 A：访问受限番剧 (ep713699)

```
1. 用户打开 https://www.bilibili.com/bangumi/play/ep713699
2. MAIN world 注入 (document_start) → 标记 __BILIROAMING_X_INJECTED__
3. 页面加载完成，__playinfo__.play_video_type === "none" 检测到受限
4. MAIN world 读 __playinfo__.result.arc → { aid: 519802803, cid: 963649454, bvid: ... }
5. MAIN world postMessage → content script
6. content script → background (FETCH_PLAYURL)
7. background 调 bili.xcnya.cn → 返回 15 视频 + 3 音频 DASH
8. background 缓存 (memory 5min)
9. content script 拿到 DASH，构造标准 MPD XML
10. content script 给每个 m4s URL 注入 buvid3 (从 document.cookie)
11. content script 创建 Blob URL → 喂给 VisionPlayer
12. content script 初始化 danmaku-lite → 拉 dm.web/view + dm.wbi/web/seg.so
13. 原 B 站 video 标签 opacity:0；区域限制 UI 移除
14. VisionPlayer 开始播放
15. danmaku-lite 渲染弹幕（Canvas 引擎）
16. 评论区 #comment-module 保持不变（B 站原生）
```

### 5.2 场景 B：点击集数切换 (从 ep713699 跳到 ep713700)

```
1. 用户点击 .numberListItem a[href*="/bangumi/play/ep713700"]
2. MAIN world click 拦截 → postMessage(EPISODE_SELECT, epId=713700)
3. content script 拿到 ep713700
4. content script → background (FETCH_PLAYURL with new epId)
   - 缺 cid/aid：先用 /pgc/season/episode/web/info?ep_id=713700 查
5. background 返回新 playurl
6. content script 重建 MPD，停止旧 VisionPlayer，销毁旧 danmaku engine
7. 创建新 VisionPlayer + 新 danmaku
8. 集数列表的当前高亮更新
```

### 5.3 场景 C：清晰度切换

```
1. VisionPlayer 内部切换（自动或用户点）
2. VisionPlayer 重新请求对应 Representation 的 m4s
3. 弹幕层不变（不随清晰度切换重置）
4. 历史记录同步到 background
```

### 5.4 场景 D：禁用扩展

```
1. content script 不注入
2. 原 B 站 player 行为不变
3. 受限番剧继续显示非常抱歉
```

---

## 六、状态机

### 6.1 扩展状态

```
IDLE ──(页面加载完成)──> DETECTING ──(检测到非受限)──> PASS_THROUGH ──(卸载)──> IDLE
                          │
                          └──(检测到受限)──> FETCHING_PLAYURL ──(成功)──> BUILDING_MPD
                                                │                          │
                                                └──(失败, 重试)──> RETRYING (max 3)
                                                                              │
                                                                              └──(全失败)──> ERROR_OVERLAY
```

### 6.2 播放器状态

```
VISION_INIT ──> LOADING_MPD ──> BUFFERING ──> PLAYING ──> PAUSED
   │                │               │             │          │
   │                │               │             │          └──> ENDED
   │                │               │             └──(seek)──> SEEKING
   │                │               └──(error)──> ERROR_RECOVER
   │                └──(error)──> ERROR
   └──(error)──> INIT_ERROR
```

### 6.3 弹幕状态

```
DM_INIT ──(拉 meta)──> META_LOADED ──(拉 segment 1)──> SEGMENT_LOADED ──(play)──> RENDERING
   │                       │                              │
   │                       └──(meta 失败)──> DM_ERROR     └──(play 结束)──> DM_PAUSED
   └──(init 失败)──> DM_FATAL
```

---

## 七、配置项

### 7.1 用户配置 (popup)

| 项 | 默认 | 说明 |
|---|---|---|
| enabled | true | 总开关 |
| serverBaseUrl | https://bili.xcnya.cn | BiliRoaming 服务端 |
| area | hk | hk / tw / cn / th |
| clientMode | web | web / app |
| accessKey | (空) | App access_key，32+ 字符 |
| defaultQuality | 1080P | 1080P+ / 1080P / 720P / 480P / 360P |
| danmakuEnabled | true | 是否渲染弹幕 |
| danmakuEngine | canvas | canvas / dom |
| danmakuOpacity | 1.0 | 0.0 ~ 1.0 |
| danmakuSpeed | 1.0 | 滚动速度倍率 |
| preserveOriginalComments | true | 保留 B 站原生评论区 |
| debug | false | 调试模式 |

### 7.2 调试变量 (window)

```js
window.__BRX_DEBUG__ = {
  state: string,                // 当前状态机状态
  lastContext: { epId, cid, aid, ssId },
  lastPlayurl: { code, acceptQuality, videoCount, audioCount },
  lastMpd: { representationCount, buvidInjectedCount },
  visionPlayer: { instance, state, quality, audio },
  danmaku: { engine, meta, segmentCount, rendered },
  commentObserver: { visible, frozen },
  network: { requests, errors }
};
```

---

## 八、风险与对策

### 8.1 风险表

| 风险 | 严重度 | 对策 |
|---|---|---|
| B 站 m4s URL deadline 过短（约 4h） | 中 | 缓存 playurl + 失效前重新拉 |
| WBI mixin_key 轮换 | 高 | 启动时拉 nav 接口拿 key |
| Protobuf 解析错误 | 中 | 严格错误处理 + 单弹幕降级（纯文本模式）|
| VisionPlayer 覆盖 B 站原生弹幕层冲突 | 中 | z-index 控制：VisionPlayer 内部 < 弹幕层 < B 站工具栏 |
| 用户点集数时 URL 变化拦截失败 | 中 | history.pushState 也 hook，捕获 SPA 导航 |
| B 站页面结构变化（class 名改）| 高 | 维护 DOM 兼容层 + snapshot 测试 |
| B 站 Player 提前 unmount 我们的 VisionPlayer | 中 | MutationObserver 监听 + 重新挂载 |
| 扩展被检测（自动化 UA）| 低 | 不使用 navigator.webdriver 修改 |

### 8.2 已知限制

- **不实现** 4K / HDR / 杜比视界（VisionPlayer 支持但需复杂流选择）
- **不实现** 多 P 视频选段（分段视频）
- **不实现** 实时弹幕发送（仅消费）
- **不实现** 视频下载
- **不实现** 直播（仅 VOD）
- **不接管** B 站稍后再看、历史记录 业务（只同步显示）

---

## 九、版本路线图

### v0.1.0 (本次目标)

**核心**：
- [ ] 完整 ESM 项目骨架（manifest.json, package.json, tsconfig.json, vite.config.ts）
- [ ] 拷贝 VisionPlayer / danmaku-lite bundle 到 vendor/
- [ ] MAIN world 检测 + 集数拦截
- [ ] background 转发 playurl 到 BiliRoaming
- [ ] content 加载 VisionPlayer + 构造 MPD
- [ ] buvid3 注入 m4s URL
- [ ] 原播放器隐藏 + 区域限制 UI 移除
- [ ] danmaku-lite 基础渲染
- [ ] popup 基础配置（server / area / access_key / danmaku 开关）
- [ ] 测试 ep713699 + ss25813 兼容性

**验收标准**：
- 访问 https://www.bilibili.com/bangumi/play/ep713699 自动播放第 1 集
- 弹幕正常显示
- 评论区保留
- 集数切换可用

### v0.2.0

- [ ] WBI 签名完整实现
- [ ] Protobuf 解码器完整
- [ ] 清晰度切换 / 音轨切换 UI（用 VisionPlayer 自身控件）
- [ ] 完整 WAI-ARIA 无障碍

### v0.3.0

- [ ] 历史记录 / 进度同步
- [ ] 投币 / 点赞联动
- [ ] 番剧推荐保持

### v0.4.0

- [ ] 4K / HDR 支持
- [ ] 直播支持
- [ ] 多 P 视频

### v1.0.0

- [ ] 全场景测试
- [ ] 文档完整
- [ ] Firefox / Chrome 双平台发布
- [ ] 用户配置导入/导出

---

## 十、参考资源

### 10.1 现有项目

- `bilibiliExtensions/` — 旧仓库，已停更 v0.4.1
- `D:\claude-code\project\bilibili项目\baseline\PAGE_BASELINE.md` — DOM / 网络基线
- `D:\claude-code\project\bilibili项目\baseline\SERVER_TEST_RESULTS.md` — 服务端测试

### 10.2 参考项目

- `D:\claude-code\project\bilibili项目\技术选型\VisionPlayer-master` — VisionPlayer 源码
- `D:\claude-code\project\bilibili项目\技术选型\danmaku-lite-main` — danmaku-lite 源码
- `D:\claude-code\project\bilibili项目\dash.js-5.2.0` — 旧 v0.4.1 用的 dash.js（保留参考）
- `D:\claude-code\project\bilibili项目\BiliRoaming-master` — Android BiliRoaming（proto 参考）

### 10.3 在线参考

- WBI 签名算法（socialsisteryi 大佬整理）
- B 站弹幕 Protobuf 定义
- B 站 UP 主工具 nav
- VisionPlayer 官方文档 visionplayer.io

---

## 十一、立即行动清单（v0.3 修订）

> 修订日期：2026-06-04  
> 修订原因：技术选型从 VisionPlayer 切换为 ArtPlayer；封装层从"散落模块"整合为 `biliDashProvider/`  
> 总工时估算：4-5 人天（原 8-10 人天）

### P0-1 vendor 准备（0.5d）
- [ ] 从 ArtPlayer-master 构建 `artplayer.mjs` 单文件 bundle
- [ ] 从 ArtPlayer-master 构建 `plugin-dash-control.mjs` 单文件 bundle
- [ ] 从 ArtPlayer-master 构建 `plugin-danmuku.mjs` 单文件 bundle
- [ ] **保留** `vendor/dash.all.min.mjs`（MSE 引擎，不可消灭）
- [ ] 在 `manifest.json` 的 `web_accessible_resources` 列出新 vendor 路径
- [ ] **移除** `vendor/visionplayer.mjs` 和 `vendor/visionplayer.streaming.mjs`（在切换完成后）

### P0-2 biliDashProvider 骨架（0.5d）
- [ ] 新建 `src/content/player/biliDashProvider/` 目录
- [ ] 搬 `dashMpdBuilder.mjs` 逻辑 → `biliDashProvider/mpdBuilder.mjs`
- [ ] 搬 `patchM4sUrl` → `biliDashProvider/buvidInjector.mjs`
- [ ] 写 `biliDashProvider/index.mjs` 的 `mountBiliDashPlayer` 主框架

### P0-3 弹幕 Protobuf → XML（1d）
- [ ] `biliDashProvider/protobufDecoder.mjs` 手写 varint / length-delimited
- [ ] `biliDashProvider/protobufToXml.mjs` 拉 dm.web/view + seg.so，输出 B 站 XML 格式
- [ ] `biliDashProvider/wbiSigner.mjs` WBI 签名（mixin_key 启动时拉 nav）

### P1-1 ArtPlayer 集成（1d）
- [ ] `biliDashProvider/index.mjs` 完整实现：
  - 加载 ArtPlayer + dash.js + 2 个 plugin
  - 初始化 dash.js MediaPlayer → ArtPlayer video
  - 挂载 dash-control 菜单
  - 挂载 danmuku 插件，传入 protobufToXml 数据源

### P1-2 旧代码清理（0.2d）
- [ ] 删除 `src/content/player/visionController.mjs`
- [ ] 删除 `src/content/player/qualityPanel.mjs`
- [ ] 删除 `src/content/player/dashMpdBuilder.mjs`（已搬入 biliDashProvider）
- [ ] 删除 `src/content/danmaku/engineController.mjs`（替换为插件调用）
- [ ] 移除 `manifest.json` web_accessible_resources 中 visionplayer 路径

### P2-1 验证（1.5d）
- [ ] playwright-cli 验证 ep713699 可播
- [ ] 验证 ss25813 正常页不被干扰
- [ ] 验证弹幕显示（XML 格式正确性）
- [ ] 验证清晰度切换（含编码筛选）
- [ ] 验证音轨切换
- [ ] 验证切集时**无旧音频残留**（ArtPlayer 内置 destroy）
- [ ] 验证弹幕**缓冲时自动暂停**（plugin 内置）

### P3-1 文档（0.5d）
- [ ] 更新 README.md 技术栈描述
- [ ] 更新 docs/ARCHITECTURE.md（biliDashProvider 子模块）
- [ ] 更新 MEMORY.md（追加切换记录）
- [ ] tests/ 单元测试：
  - `buvidInjector.test.mjs`
  - `mpdBuilder.test.mjs`
  - `wbiSigner.test.mjs`
  - `protobufToXml.test.mjs`

### 验收标准
- [ ] 访问 https://www.bilibili.com/bangumi/play/ep713699 自动播放
- [ ] 弹幕正常显示
- [ ] 评论区保留
- [ ] 集数切换可用，**无旧音频残留**
- [ ] 弹幕**缓冲时自动暂停前进**
- [ ] 清晰度/编码/音轨切换可用

---

## 十一.B 下一步计划：扩展 Options UI（2026-06-04 新增）

### 背景
2026-06-04 巡查发现公共 BiliRoaming 服务端大面积失效，用户自建服务端（如 `bili.majiawebtest.dpdns.org`）能用 web 模式 + 浏览器标准 UA 直接通。**这要求扩展必须支持**：
- **客户端模式切换**（web / app）：不同服务端支持不同
- **地区切换**（hk / tw / cn / th）：不同区域权限不同
- **可视化配置**：用户友好

### 任务 P4-1：Options Page 完整 UI（1d）
- 扩展 `src/options/options.html`（当前是占位文件）
- 新增 `src/options/options.css`（样式）
- 新增 `src/options/options.mjs`（业务逻辑）
- 字段：
  - **服务端地址**（serverBaseUrl）：文本输入 + 候选下拉（xcnya/nepnep/atri/majiawebtest）
  - **客户端模式**（clientMode）：单选 `web` / `app`
  - **区域**（area）：单选 `hk` / `tw` / `cn` / `th`
  - **access_key**：文本输入 + "从当前页 localStorage 读取" 按钮
  - **默认清晰度 / 编码**：下拉
  - **弹幕开关 / 引擎 / 透明度 / 速度**：复选 + 滑块

### 任务 P4-2：模式/地区智能推荐（0.5d）
- 根据 serverBaseUrl 自动推荐默认模式：
  - `bili.majiawebtest.*` / `nepnep.*` → web
  - `bili.xcnya.*` → app
- "测试当前配置"按钮：发一个最小 playurl 请求，5s 内返回 code:0/非 0 结果
- 显示当前推荐的"基线配置"

### 任务 P4-3：配置导入/导出（0.3d）
- 一键导出 JSON 配置
- 一键导入 JSON 配置
- 配置版本号（升级时迁移）

### 关联文件
```
src/options/
├── options.html        # 现有 1 行占位（待扩展）
├── options.css         # 新增
└── options.mjs         # 新增
src/popup/popup.html   # 保留作为快速开关面板
```

### 验收标准
- [ ] `chrome://extensions` → "BiliRoaming-X Player" → "选项" 打开完整 UI
- [ ] 模式/地区/服务端地址 可视化切换
- [ ] "测试配置"按钮 5s 内返回 code:0/非 0
- [ ] 配置保存后立即生效（无需重启扩展）
- [ ] 配置文件可导入/导出

### 与 v0.3 切换 ArtPlayer 关系
✅ **无关**，是独立任务。Options UI 在 v0.3（原生 video）阶段就有用，在 v0.4（ArtPlayer）阶段继续保留。

---

## 十二、风险与对策（v0.3 修订）

### 12.1 风险表

| 风险 | 严重度 | v0.2 对策 | v0.3 对策（调整）|
|---|---|---|---|
| B 站 m4s URL deadline 过短 | 中 | 缓存 playurl + 失效前重新拉 | 同上 |
| WBI mixin_key 轮换 | 高 | 启动时拉 nav 接口拿 key | 同上 |
| Protobuf 解析错误 | 中 | 严格错误处理 + 单弹幕降级 | 同上，输出降级为纯文本 XML |
| **VisionPlayer 暂停音频继续** | 高 | 手动 pause/remove/load 兜底 | **ArtPlayer 内置 destroy，根因上解决** |
| **danmaku-lite 与 video 耦合弱** | 高 | 暂不修复 | **artplayer-plugin-danmuku 内置 currentTime 同步** |
| 用户点集数时 URL 变化拦截失败 | 中 | history.pushState hook | 同上 |
| B 站页面结构变化 | 高 | DOM 兼容层 + snapshot 测试 | 同上 |
| B 站 Player 提前 unmount | 中 | MutationObserver | 同上 |
| **artplayer-plugin-dash-control 与 dash.js 版本不匹配** | 中 | （新风险）| 锁版本：dash.js 5.x + plugin 1.1.0 |
| **MV3 content script 加载 ArtPlayer bundle 受限** | 中 | （新风险）| 验证 web_accessible_resources 路径配置 |

### 12.2 已知限制

- **不实现** 4K / HDR / 杜比视界
- **不实现** 多 P 视频选段
- **不实现** 实时弹幕发送（仅消费）
- **不实现** 视频下载
- **不接管** 稍后再看、历史记录

---

> 本文档将随项目进展持续更新。  
> 任何与文档不符的实现需先更新文档再写代码。
