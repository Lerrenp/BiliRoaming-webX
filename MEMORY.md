# biliExtensionsplayer 子项目记忆

> 更新时间：2026-06-04
> 项目：`D:\claude-code\project\bilibili项目\biliExtensionsplayer`

## 当前基线

已提交 MVP：

```text
ad3e1bc feat: add dash player MVP with episode highlight
```

MVP 已验证能力：

- MV3 扩展可加载。
- MAIN world 可检测 B 站受限页并拦截选集。
- background 可请求 BiliRoaming 服务端。
- B 站 DASH JSON 可转 MPD Blob。
- dash.js 临时播放器可播放。
- 右上角已有清晰度 / 编码 / 音轨选择。
- 选集点击后右侧集数高亮已修复。
- access_key 辅助读取已并入 popup。

## 当前问题

临时播放器状态管理不可靠：

- 音画可能不同步。
- 有时音频先播放，画面没出来。
- 切换第二集后，第一集音频可能仍在播放。
- danmaku-lite 与视频耦合弱，缓冲时弹幕仍前进。

判断：不要继续修临时播放器，避免自己重造播放器状态机。

## 当前目标

从 `ad3e1bc` 基线继续，开始 **VisionPlayer 接入工作**，迭代到下一个可加载版本。

核心目标：

```text
BiliRoaming playurl -> DASH JSON -> MPD Blob -> VisionPlayer -> VisionPlayer Dash component -> dash.js
```

VisionPlayer 负责：

- 创建 / 持有 video 元素。
- 播放状态。
- waiting / stalled / playing / pause / seek 等生命周期。
- destroy 生命周期，避免切集后旧音频残留。
- 后续承载弹幕同步。

## VisionPlayer 接入策略

1. 保留当前数据链路：
   - MAIN 检测受限页。
   - content bridge。
   - background FETCH_PLAYURL。
   - dashMpdBuilder 构造 MPD。

2. 替换播放器核心：
   - 新增/重写 `src/content/player/visionController.mjs`。
   - 使用 `vendor/visionplayer.mjs` 默认构建，而不是 streaming 超大构建。
   - `vendor/dash.all.min.js` 仍作为 content script 预加载，让 `window.dashjs` 在 ISOLATED world 可见。
   - `new VisionPlayer(container, { src: mpdUrl, mimeType: 'application/dash+xml' }, config)`。

3. 选项策略：
   - v0.2.0 先保留右上角自定义清晰度 / 编码 / 音轨面板。
   - 切换时销毁旧 VisionPlayer，revoke 旧 MPD Blob，创建新 VisionPlayer。
   - 后续再研究 VisionPlayer 自带 quality/language 菜单是否能直接承载 B 站多轨。

4. 弹幕策略：
   - 暂时保留 danmaku-lite XML 弹幕。
   - 本阶段不修弹幕耦合。
   - VisionPlayer 播放稳定后，再把弹幕时钟绑定到 VisionPlayer media/video 状态。

## 本阶段验收标准

- 扩展可重新加载，无 manifest 错误。
- 受限页 `ep713699` 可挂载 VisionPlayer root。
- 视频可播放，`currentTime` 递增。
- 点击选集后旧音频不残留。
- 右侧选集高亮仍正常。
- 清晰度 / 编码 / 音轨选择仍可用。
- Git 有新提交保存 VisionPlayer 接入版本。

## 注意事项

- 不要把 VisionPlayer、dash.js、danmaku-lite 混成单个业务 JS，vendor 必须独立。
- 业务代码继续 ESM 模块化。
- 临时播放器状态问题不再作为修复方向。
- 若 VisionPlayer 对 MPD/dash.js 报错，优先调整 mediaData/config，不回退到重写播放器状态机。

## 2026-06-04 VisionPlayer 暂停音频继续问题定位

现象：前端视频暂停/不可见时，音频仍继续；切集时可能旧音频残留。

定位：不是 B 站原生 video 播放，原生 video src 为空且 paused=true。根因是扩展多次收到 BRX_PLAYER_START，FETCH_PLAYURL 并发返回后可能创建多个 VisionPlayer/dash 实例；部分旧实例 DOM 被移除或不可见但 media pipeline 没有完全 pause/reset，导致残留音频。

修复：content app 增加 startSeq/inFlightKey 单飞保护；创建新播放器前 cleanupDetachedMedia，销毁旧 controller 后再次 cleanup；destroy 时 pause/remove src/load。实测页面仅剩 1 个 brx video + 1 个原生空 video，手动 pause BRX video 后全部 media paused。

---

## 2026-06-04 播放器内核评估（ArtPlayer vs VisionPlayer）

### 评估范围
对 `ArtPlayer-master`（v5.4.1 + 22 个官方插件）进行源码评估，作为 VisionPlayer 替代方案。

### 评估结论
**建议切换**，核心收益：
- ArtPlayer 内置完整 video 状态机，destroy 生命周期可靠（消灭"暂停后音频继续"问题根因）
- `artplayer-plugin-danmuku` 含 `bilibili.js` 解析器，缓冲时弹幕自动暂停（消灭"缓冲时弹幕前进"问题）
- 维护成本下降：3,257 commits、完整 TS 类型、活跃社区

### 关键技术澄清（颠覆原认知）

| 之前误以为 | 实际情况 |
|---|---|
| 切换后可以"消灭 MPD Builder" | ❌ B 站 playurl v2 返回**非标 DASH JSON**（无 Period / AdaptationSet / 字段命名差异），MPD Builder 是**领域适配器**（domain adapter），**必须保留** |
| 切换后可以"消灭 dash.js" | ❌ `artplayer-plugin-dash-control` **不含 MSE 引擎**，只是 UI 控件层（调用 `dash.getBitrateInfoListFor` / `dash.setQualityFor` 等）。ArtPlayer 自身**无 DASH 原生支持**，dash.js **必须保留** |
| `bilibili.js` 解析器能直接用 | ⚠️ 插件期望 **XML** 弹幕，B 站 `dm.web/view` + `seg.so` 返回 **Protobuf**，**仍需 Protobuf 解码层**（输出转 XML 喂给插件）|
| 2.x→5.x"转换层"是 API 包装 | ❌ "2.x"=B 站 playurl **v2 端点**，"5.x"=**dash.js v5 库**，是**协议格式转换**（B 站非标 DASH JSON → 标准 MPD XML）|

### 简化理解（最终版）
```
B 站 v2 JSON（非标 DASH）          ← 正常且预期的输入
   ↓
MPD Builder（领域适配器，~200 行）  ← 不可消灭
   ↓
标准 MPD XML
   ↓
dash.js 5.x（MSE 引擎）            ← 不可消灭
   ↓
ArtPlayer（video + 状态机）        ← 升级点
   ↓
+ artplayer-plugin-dash-control    ← 升级点（替换 qualityPanel.mjs）
+ artplayer-plugin-danmuku         ← 升级点（替换 danmaku-lite）
```

### 切换真正能消灭的代码
- `visionController.mjs`（~150 行 VisionPlayer 封装 + 自管理 destroy）
- `qualityPanel.mjs`（自写清晰度/编码/音轨面板）
- 自写"视频-弹幕时间同步"逻辑（danmaku-lite 与 video.currentTime 解耦的代码）
- 自写 video.destroy 后 pause/remove src/load 兜底逻辑

### 切换不能消灭的代码（项目护城河）
- MPD Builder（`dashMpdBuilder.mjs`）
- dash.js（`vendor/dash.all.min.js` → 后续搬入 ArtPlayer vendor bundle）
- buvid3 注入（`patchM4sUrl`）
- WBI 签名（未来写在 `bilibiliAdapter.mjs`）
- Protobuf 解码（保留，可复用 ArtPlayer 插件的 `bilibili.js` XML 输出格式）

---

## 2026-06-04 新目标：biliDashProvider 模式

### 思路
把所有"B 站特殊协议"封装在一个业务插件内，**对外只暴露 `mount(ctx)` API**。
ArtPlayer 体系负责通用 DASH 播放 + UI，业务侧不直接碰 MPD / dash.js / Protobuf。

### 目标结构
```
src/content/player/biliDashProvider/
├── mpdBuilder.mjs          ← 搬自 dashMpdBuilder.mjs
├── protobufToXml.mjs       ← 新写：Protobuf → XML（喂给 danmuku 插件）
├── buvidInjector.mjs       ← 搬自 patchM4sUrl
├── wbiSigner.mjs           ← 搬自 PLAN.md 设计
└── index.mjs               ← mountBiliDashPlayer({ container, playurlResp, ... })
        ↓ 内部使用
vendor/artplayer/
├── artplayer.mjs
├── dash.all.min.mjs        ← MSE 引擎
├── plugin-dash-control.mjs ← 清晰度/音轨 UI
└── plugin-danmuku.mjs      ← 弹幕（内部含 bilibili.js XML 解析器）
```

### 业务侧调用示例
```js
import { mountBiliDashPlayer } from './player/biliDashProvider/index.mjs'

const player = await mountBiliDashPlayer({
  container,                // 覆盖层 div
  playurlResponse,          // B 站 v2 JSON
  cid, aid, duration,       // 弹幕上下文
  config,                   // 默认清晰度等
})
```

业务侧**完全不需要知道 MPD、dash.js、Protobuf**。这些都是 `biliDashProvider` 的"实现细节"。

### 修订后 WBS（4-5 天，比原 8-10 天减半）

| 阶段 | 任务 | 预计 |
|---|---|---|
| P0 | vendor/ 准备 ArtPlayer + dash.js + 2 个 plugin bundle | 0.5d |
| P0 | 搬 `dashMpdBuilder.mjs` → `biliDashProvider/mpdBuilder.mjs` | 0.2d |
| P0 | 写 `protobufToXml.mjs`（用现成 Protobuf 解析，输出 danmuku 插件 XML 格式）| 1d |
| P1 | 写 `biliDashProvider/index.mjs`（mount API，串起 ArtPlayer + plugin）| 1d |
| P1 | 删除 `visionController.mjs` + `qualityPanel.mjs` | 0.2d |
| P2 | 验证 ep713699 切集不残留音频 | 0.5d |
| P2 | 验证弹幕缓冲同步 | 0.5d |
| P2 | 验证清晰度/音轨切换 | 0.5d |

### 三个"不做什么"
- ❌ 不消灭 MPD Builder（B 站格式 ≠ 标准 DASH，必须适配）
- ❌ 不消灭 dash.js（DASH 的 MSE 引擎是必须的）
- ❌ 不消灭 Protobuf 解码（B 站弹幕是 Protobuf，danmuku 插件只吃 XML）

---

## Git 历史（截至 2026-06-04）

### main 分支（4 commits）
```
5389c2c fix: prevent duplicate player instances          (Codex, 14:59)
2cff62f feat: integrate VisionPlayer playback controller  (Codex, 14:51)
ad3e1bc feat: add dash player MVP with episode highlight   (Codex, 14:40)
1afc844 chore: init biliExtensionsplayer repo (ESM MV3)    (Codex, 01:44)
```

### v0.3-artplayer-migration 分支（4 commits，**当前工作分支**）
```
dbf192e refactor: rename visionController.mjs to mountPlayer.mjs   (Codex, 21:34)
eb29e17 chore: remove unused visionplayer.streaming.mjs vendor      (Codex, 21:31)
94a79c2 docs: v0.3 technology switch evaluation (VisionPlayer to ArtPlayer)  (Codex, 21:26)
ad3e1bc feat: add dash player MVP with episode highlight             (Codex, 14:40)  ← 起点
1afc844 chore: init biliExtensionsplayer repo (ESM MV3)              (Codex, 01:44)
```

**注**：v0.3 分支跳过 `2cff62f`（VisionPlayer 接入）和 `5389c2c`（VisionPlayer 引起的 bug 修复），因为切到 ArtPlayer 后根因消失。

### 分支状态
- 当前分支：`main`（无其他分支）
- 工作树：clean
- 总提交：4
- 单日活跃：所有提交均在 2026-06-04 一天内完成

### 演进路径
1. `1afc844` 仓库初始化（README + .gitignore）
2. `ad3e1bc` MVP 落地：769 行 PLAN.md + 完整 ESM MV3 脚手架 + DASH 播放器原型 + VisionPlayer.streaming vendor
3. `2cff62f` VisionPlayer 控制器接入：MEMORY.md 首次记录 + 14,834 行 visionplayer.mjs vendor
4. `5389c2c` 紧急修复：VisionPlayer 多次创建导致音频残留

### 关键观察
- 项目仅 1 天历史，但演进非常快
- 已经在第 4 个 commit 就遇到 VisionPlayer 状态机问题（暂停音频残留）
- 决策窗口：是否继续修 VisionPlayer，还是切换到 ArtPlayer
- **结论：切换**（ArtPlayer 内置 destroy 生命周期，根因上解决音频残留）

### 当前文件清单（v0.3-artplayer-migration）
```
src/content/player/
├── dashMpdBuilder.mjs    # B 站 v2 JSON → MPD（保留，领域适配器）
├── mountPlayer.mjs       # 原 visionController.mjs（已改名，匹配 mountPlayer 导出）
├── qualityPanel.mjs      # 自写清晰度/编码/音轨面板（v0.4 替换为 plugin-dash-control）
└── (未来)
    └── biliDashProvider/ # v0.3 后续：封装层

src/content/danmaku/
└── engineController.mjs  # danmaku-lite 启动（v0.4 替换为 plugin-danmuku）

vendor/
├── dash.all.min.js       # MSE 引擎（永久保留）
├── dash.all.min.mjs      # ESM 版本（永久保留）
└── danmaku-lite.canvas.mjs  # v0.4 删除
```

### v0.3 当前已删
- ❌ `vendor/visionplayer.streaming.mjs` (2.9MB 死代码)
- ❌ `vendor/visionplayer.mjs` (从未引入)
- ❌ `2cff62f` VisionPlayer controller commit（跳过）
- ❌ `5389c2c` VisionPlayer bug 修复 commit（跳过）

---

## 2026-06-04 BiliRoaming 公共服务端巡查（**部署前提调研**）

### 巡查结论
**2026-06-04 公共 BiliRoaming 服务端大面积失效**。`baseline/SERVER_TEST_RESULTS.md` 记录的"✅ code:0"已不再适用。

### 各服务端状态对照（curl 实测）

| 服务端 | 状态 | 错误码 | 备注 |
|---|---|---|---|
| `bili.xcnya.cn` | ❌ 死 | `-500 Client request failed Step 2` | 服务端到 B 站 `reqwest::Client::send()` 网络层失败（`BiliRoaming-Rust-Server-main/src/mods/request.rs:60`）|
| `bili.nepnep.moe` | ⚠️ 半活 | `-101 未登录` / `-500` | 偶尔能处理请求但鉴权不通过 |
| `atri.ink`（Go 实现）| ⚠️ 半活 | `401 解析服务器: 账号未登录！` | 用自己的鉴权体系，忽略 B 站 access_key |
| `bili.global.ssl.fastly.net` | ❌ 域不存在 | Fastly error | 已废弃 |
| `bili.udplog.com` | ❌ 不通 | Connection timeout | 已失效 |
| `bili.afoolishfox.com` | ❌ 不通 | TLS error | 证书问题 |
| `bili.snm0516.aisee.tv` | ❌ 不通 | DNS 解析失败 | 已失效 |
| `bili.majiawebtest.dpdns.org` | ✅ 通 | `code:0` + 30KB 真实 DASH | **用户自建服务器，仅作开发测试** |

### 关键根因（`bili.xcnya.cn` 为例）
**`Client request failed Step 2`** = BiliRoaming Rust 服务端 `reqwest::Client::send()` 失败。代码在 `BiliRoaming-Rust-Server-main/src/mods/request.rs:60`：
```rust
let rsp_raw_data = if let Ok(value) = client.send().await {
    value
} else {
    return Err(EType::ServerReqError("Client request failed Step 2"));
};
```
网络层错误（DNS/TCP/TLS/IP 封禁/代理配置都可能），与请求参数无关。

### 模式说明
**web 模式 / app 模式** 在用户自建服务器上 **web 模式即通**（不需要 access_key/sign/特殊 UA）。不同服务端支持不同的模式组合：
- 公共 xcnya：web + App 长 key（来自 PROJECT_MEMORY.md 2026-06-03 记录）
- 用户自建 majiawebtest：web 模式 + 浏览器标准 UA 即通
- 其他服务端：模式各异

**结论**：扩展必须**支持 web/app 模式切换 + 地区切换**（用户配置项），不能写死。

### 对 v0.3 切换 ArtPlayer 的影响
✅ **无关**。这是**部署侧问题**（服务端网络），不是**代码侧问题**（播放器内核）。无论用 VisionPlayer 还是 ArtPlayer，**服务端不通都播不了**。

### POPUP 配置示例（开发测试，web 模式 + 用户自建）
```
serverBaseUrl: https://bili.majiawebtest.dpdns.org
clientMode: web  ← 当前测试用 web 模式
area: hk
accessKey: （空）
```

---

## 2026-06-04 下一步计划：扩展 Options UI（模式/地区配置）

### 背景
当前 popup 已包含 `serverBaseUrl` / `area` / `accessKey` / `clientMode` 等基础配置，但**用户难发现/难操作**。不同 BiliRoaming 服务端支持的模式/地区组合不同，需要：
- **可视化**的配置页面
- **测试按钮**（验证当前配置能否拿到 playurl）
- **模式/地区可选项 UI**（不写死）

### 计划任务

#### P0-1：扩展 Options Page（`src/options/options.html`）
- 完整配置 UI（替代当前 popup 的部分功能）
- 字段：
  - **服务端地址**（serverBaseUrl）：文本输入 + 候选下拉
  - **客户端模式**（clientMode）：单选 `web` / `app`
  - **区域**（area）：单选 `hk` / `tw` / `cn` / `th`
  - **access_key**：文本输入 + "从当前页 localStorage 读取" 按钮
  - **默认清晰度 / 编码**：下拉
  - **弹幕开关 / 引擎 / 透明度 / 速度**：复选 + 滑块

#### P0-2：模式/地区智能推荐
- 根据服务端 URL 自动推荐模式（如 `bili.majiawebtest.*` → web；`bili.xcnya.*` → app）
- 提供"测试当前配置"按钮：发一个最小 playurl 请求，code:0 算通过

#### P0-3：配置导入/导出
- 方便用户备份/分享配置
- 配合 manifest 更新提示（升级时迁移旧配置）

#### 验收
- 用户打开 `chrome://extensions` → "BiliRoaming-X Player" → "选项"
- 能看到完整配置 UI，所有字段可编辑
- 保存后立即生效（无需重启扩展）
- "测试"按钮能在 5s 内返回 code:0/非 0 结果

### 关联文件
```
src/options/
├── options.html        # 现有 1 行（待扩展）
├── options.css         # 新增
└── options.mjs         # 新增
src/popup/popup.html   # 保留作为快速开关面板
```

### v0.3 当前未实现的部分
- ❌ src/options/options.html 仍是占位
- ❌ src/options/options.css 不存在
- ❌ src/options/options.mjs 不存在
- ❌ POPUP 没有"测试配置"按钮
- ❌ 没有模式/地区候选下拉

