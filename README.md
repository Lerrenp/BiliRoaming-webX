# BiliRoaming-X Player

独立重构项目（不是 `bilibiliExtensions` 的附属仓库）。

> **v0.3 修订（2026-06-04）**：播放器内核从 VisionPlayer 切换为 **ArtPlayer 5.4.1**，弹幕从 danmaku-lite 切换为 **artplayer-plugin-danmuku**。详见 `PLAN.md` §0 修订记录 和 `MEMORY.md`。

## 项目性质

- 重写而非移植
- 不依赖旧仓库的 `brx-player.js` 单文件实现
- 自有目录、自有 Git、自有版本号、自有发布节奏

## 技术规范

### 必须使用 ES 模块化

- 所有源码必须是 ES Modules（`import` / `export`）
- `manifest.json` 引用 JS 时使用相对路径 + ESM 语法
- `background` 使用 `service_worker` + `"type": "module"`
- `content_scripts` 默认 ISOLATED world，按需开启 MAIN world
- 禁止 CommonJS（`require` / `module.exports`）
- 禁止 IIFE + 全局变量污染（除非与 B 站原页交互必需）

### 技术栈（v0.3 修订）

| 角色 | 选型 | 版本 | 说明 |
|---|---|---|---|
| 播放器 UI + 状态机 | **ArtPlayer** | 5.4.1 | 内置完整 video 生命周期 |
| DASH MSE 引擎 | **dash.js** | 5.x | 不可替代（`artplayer-plugin-dash-control` 不含 MSE）|
| DASH 控件 UI | **artplayer-plugin-dash-control** | 1.1.0 | 清晰度/音轨菜单（替换原 qualityPanel）|
| 弹幕 | **artplayer-plugin-danmuku** | 5.3.0 | 内置 `bilibili.js` XML 解析器（替换 danmaku-lite）|
| B 站协议适配 | **biliDashProvider** | 自研 | MPD Builder + buvid + WBI + Protobuf→XML |
| 内容脚本隔离 | MV3 ISOLATED world | - | 通过 bridge 与 MAIN world 通信 |
| B 站页面交互 | MV3 MAIN world | - | 区域限制检测 + 集数拦截 |

### 关键澄清：什么是"必须保留的"

> ❌ 切换 ArtPlayer **不**意味着消灭 MPD Builder 或 dash.js。  
> ✅ B 站 playurl v2 返回的是**非标 DASH JSON**（无 Period/AdaptationSet、字段命名差异），  
> ✅ **MPD Builder 是领域适配器**（B 站 v2 JSON → 标准 MPD XML），必须永久保留。  
> ✅ **`artplayer-plugin-dash-control` 不含 MSE 引擎**，dash.js 必须保留。

详见 `MEMORY.md` "2026-06-04 播放器内核评估" 段。

### 目标架构

```
biliExtensionsplayer/
├── manifest.json              # MV3 清单
├── src/
│   ├── inject/                # MAIN world（直接访问 window.player）
│   ├── content/               # ISOLATED world（与 background 通信）
│   │   ├── app.mjs            # 主入口
│   │   ├── bridge.mjs         # MAIN↔ISOLATED 桥
│   │   └── player/
│   │       └── biliDashProvider/   # B 站 DASH 适配器（v0.3 新增）
│   │           ├── index.mjs            # mountBiliDashPlayer(ctx)
│   │           ├── mpdBuilder.mjs       # B 站 v2 JSON → MPD
│   │           ├── buvidInjector.mjs    # m4s URL 注入 buvid3
│   │           ├── wbiSigner.mjs        # WBI 签名
│   │           ├── protobufToXml.mjs    # B 站 Protobuf → XML
│   │           └── protobufDecoder.mjs  # 手写 varint 解析
│   ├── background/            # service worker
│   ├── popup/                 # 工具栏弹窗
│   ├── options/               # 选项页
│   └── common/                # 通用工具
├── vendor/                    # 第三方 bundle
│   ├── artplayer/             # ArtPlayer 体系（v0.3 引入）
│   │   ├── artplayer.mjs
│   │   ├── plugin-dash-control.mjs
│   │   └── plugin-danmuku.mjs
│   └── dash.all.min.mjs       # 永久保留
├── assets/                    # 图标
├── docs/                      # 架构 / 兼容 / 路线图
└── tests/                     # 单元测试
```

## 与原仓库关系

| 项 | bilibiliExtensions（旧）| biliExtensionsplayer（本仓）|
|---|---|---|
| MV3 结构 | ✅ | ✅（本仓）|
| ESM 模块化 | ⚠️ 部分 IIFE | ✅ 强制 |
| 视频播放 | Plyr + dash.js v0.4.1 | 重新设计 |
| 弹幕 | ❌ 无 | 计划（danmaku-lite）|
| 独立仓库 | ❌ | ✅ |
| 共享代码 | — | 否，各自实现 |

调用有数据调试浏览器 打开国内和国外两个番剧页面 记录bilibili原生播放器的行为和位置 包括切换选集切换清晰度/音轨
  加载弹幕 加载字幕 网页全屏等功能的原生实现 整理到md