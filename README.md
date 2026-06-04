# BiliRoaming-X Player

独立重构项目（不是 `bilibiliExtensions` 的附属仓库）。

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

### 目标架构

```
biliExtensionsplayer/
├── manifest.json              # MV3 清单
├── src/
│   ├── inject/                # MAIN world（直接访问 window.player）
│   ├── content/               # ISOLATED world（与 background 通信）
│   ├── background/            # service worker
│   ├── popup/                 # 工具栏弹窗
│   ├── options/               # 选项页
│   ├── player/                # 播放器模块（dash.js / Plyr / Danmaku）
│   └── common/                # 通用工具（api-client、storage、constants）
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