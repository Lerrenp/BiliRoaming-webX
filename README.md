# BiliRoaming-webX Player

> 哔哩漫游浏览器插件。
> 
> 让 B 站"仅限港澳台地区"的番剧，在你的浏览器里像普通番剧一样播放。

你有没有遇到过这种情况——打开一个 B 站番剧页面，画面卡在"非常抱歉，根据版权方要求，
您所在的地区无法观看本片"？这就是俗称的"区域限制番剧"，版权方把播放权只卖给了
港澳台或东南亚，B 站会按 IP 严格拦截。

**BiliRoaming-webX Player** 是一个 Chrome / Edge 浏览器扩展。它会在 B 站页面
检测到这种"墙"，自动通过公共 BiliRoaming 代理拿到真实播放数据，
然后在原播放器位置上"接管"出一个完整可用的播放器。

听起来像"破解"？其实更像是"重连"——B 站自己也知道这些番剧有境外授权，
只是没把播放接口开放给大陆用户。我们做的事，只是把这个"空缺"接上而已。

---

## 📑 目录

- [BiliRoaming-webX Player](#biliroaming-webx-player)
  - [📑 目录](#-目录)
  - [这是怎么做到的？](#这是怎么做到的)
    - [几个关键设计决策](#几个关键设计决策)
  - [我们做了什么工作](#我们做了什么工作)
  - [技术栈](#技术栈)
  - [安装与使用](#安装与使用)
    - [安装](#安装)
    - [使用](#使用)
  - [配置项说明](#配置项说明)
    - [⚠️ 关于 App 模式（暂时不可用）](#️-关于-app-模式暂时不可用)
  - [🔑 access\_key 获取教程](#-access_key-获取教程)
    - [安装步骤](#安装步骤)
    - [使用步骤（2 种方式任选）](#使用步骤2-种方式任选)
      - [方式 1：手动输入](#方式-1手动输入)
      - [方式 2：二维码自动获取（推荐）](#方式-2二维码自动获取推荐)
    - [写入 popup](#写入-popup)
  - [开发说明](#开发说明)
    - [模块划分原则](#模块划分原则)
    - [调试变量](#调试变量)
    - [本地检查](#本地检查)
  - [项目结构](#项目结构)
  - [踩过的坑](#踩过的坑)
  - [AI 生成声明](#ai-生成声明)
  - [许可证](#许可证)
  - [致谢](#致谢)

---

## 这是怎么做到的？

整体数据流是这样的（简化版）：

```text
B 站页面（检测到区域限制）
       │
       ▼
MAIN world  拦截 __playinfo__ 赋值 / 选集点击 / SPA 路由
       │
       │  postMessage
       ▼
ISOLATED world  事务管理 + 上下文合并
       │
       │  chrome.runtime.sendMessage
       ▼
Background service worker
   ├── FETCH_EP_INFO   →  B 站 pgc/view/web/ep/list   补全 aid/cid
   └── FETCH_PLAYURL   →  BiliRoaming 公共代理          拿 DASH JSON
       │
       ▼
MPD Builder（领域适配器）
   把 B 站"非标 DASH JSON"转成标准 MPD XML
       │
       ▼
dash.js  （MSE 引擎）  +  ArtPlayer  （UI + 视频状态机）
       │
       ▼
<video> 播出来 🎬
```

### 几个关键设计决策

**1. 不重写 B 站原生播放器，重写代价太高。**  
新版的 B 站播放器是 React/Next 复杂组件，直接拿不到 manifest/playUrl 状态。
我们换个思路：在原位置追加一个绝对定位的"覆盖层"，接管 `<video>` 元素，
让 ArtPlayer 跑完整的生命周期（播放/暂停/缓冲/全屏/destroy）。

**2. MPD Builder 是必须的，不能省。**  
B 站 `playurl v2` 返回的是"非标 DASH JSON"——没有 Period/AdaptationSet、
字段命名也是它自己的。但 dash.js 只吃标准 MPD XML。
所以我们写了一个 200 行的"领域适配器"：B 站 JSON → 标准 MPD。

**3. dash.js 也是必须的，不能省。**  
ArtPlayer 自身没有 DASH 原生支持，`artplayer-plugin-dash-control` 只是 UI 控件层
（帮你做清晰度菜单），MSE 引擎还得靠 dash.js。

**4. 弹幕、字幕、评论——能修就修。**  
受限页 B 站 React 会把 `#comment-module` 设为 `display:none`，导致
`<bili-comments lazy-load>` 的 IntersectionObserver 永远不触发——
我们 `unhideCommentModule()` 强制显示，让 lazy-load 在用户滚动时正常触发。
字幕 protobuf 走 B 站非公开接口，我们手写了 varint 解析 + XOR 解密。

---

## 我们做了什么工作

这个项目走过一段有点曲折的路，每一阶段都有它的"为什么"：

| 版本 | 关键工作 | 解决的问题 |
|---|---|---|
| v0.1 | MV3 扩展脚手架 + MAIN/ISOLATED 双世界 | 浏览器扩展基础架构 |
| v0.2 | fetch/XHR playurl hook + 区域限制检测 | 服务端取流 |
| v0.3 | **切换到 ArtPlayer** + danmuku 插件 | "暂停后音频继续" 等状态机 bug |
| v0.4 | 字幕 protobuf 解码 + 评论 unhide | 受限页体验 |
| v0.5 | 事务管理 + 事件栅栏 + 配置面板 | 并发竞态 / 误触网页全屏 / PHP 后端 -15 |

走过的弯路也都写进了 [`dev-docs/`](./dev-docs) 里——VisionPlayer 的 bug、playinfo setter
的"幌子"发现、为什么不能简单塞 `<video src>`…… 那些踩过的坑，
未来如果有人接手，应该能少走一些。

---

## 技术栈

| 角色 | 选型 | 说明 |
|---|---|---|
| 播放器 UI + 视频状态机 | **ArtPlayer** 5.4.1 | 内置完整生命周期 |
| DASH MSE 引擎 | **dash.js** 5.x | 不可替代 |
| 清晰度/音轨菜单 | **artplayer-plugin-dash-control** | UI 控件层 |
| 弹幕 | **artplayer-plugin-danmuku** | 缓冲时自动暂停 |
| B 站协议适配 | **MPD Builder**（自研）| B 站 JSON → 标准 MPD |
| 字幕 | **SubtitleManager**（自研）| protobuf → VTT + 繁简转换 |
| 通信桥 | **MV3 MAIN ↔ ISOLATED** | postMessage 协议 |
| 模块化 | **ESM** 强制 | 拒绝 CommonJS / IIFE 污染 |

---

## 安装与使用

### 安装

目前还在早期版本，发布到 Chrome Web Store 之前你可以尝试寻找 release 中有没有发布版本；如果没有，可以用下面两种方式安装。

> 注：如果 Edge 报告“本地安装此扩展不是来自任何已知来源”，可以把 `.crx` 改成 `.zip` 后直接拖进去安装。

**方式 1：加载未打包扩展（推荐开发者）**

1. 克隆仓库到本地：
   ```bash
   git clone <repo-url> && cd biliExtensionsplayer
   ```
2. 打开 Chrome / Edge，访问 `chrome://extensions`
3. 打开右上角"开发者模式"
4. 点击"加载已解压的扩展程序"，选择本仓库根目录
5. 安装完成，工具栏会出现 BRX 图标

**方式 2：与ai一起使用 persistent 浏览器调试（仅调试用）**

```bash
playwright-cli open https://www.bilibili.com/bangumi/play/ss44467/ --headed --persistent
```

> ⚠️ 普通 Playwright 临时浏览器**不加载扩展**，请始终使用 `--persistent`。
加载后你就可以让ai给你装扩展了。

### 使用

打开一个港澳台限定番剧页面，例如：
- <https://www.bilibili.com/bangumi/play/ss44467/>（虚構推理 S2）
- <https://www.bilibili.com/bangumi/play/ep713699>

扩展会在 document_start 注入并检测区域限制，**通常你什么都不用做**——
原生播放器会被隐藏，扩展接管并自动开始播放。
弹幕、字幕、选集切换、清晰度切换，应该都正常工作。

如果出问题，先点工具栏的 BRX 图标看 popup，再去
`chrome://extensions` → "检查视图：service worker" 看 background 日志。

---

## 配置项说明

打开 popup 或 `chrome://extensions` → BiliRoaming-webX Player → 选项：

| 字段 | 作用 | 备注 |
|---|---|---|
| **启用扩展播放器** | 总开关 | 关掉后所有行为都停 |
| **服务端地址** | BiliRoaming 代理 URL | 默认 `https://bili.xcnya.cn`（独苗啊独苗别给骑爆了） |
| **模式** | `web` / `app` | ⚠️ App 模式因 SSL 403 暂时不可用，请用 web 模式 |
| **区域** | `hk` / `tw` / `th` / `cn` | 不同服务端支持不同的地区组合 |
| **Web 模式发送漫游请求头** | 开关 | 旧 PHP 后端报 `code=-15` 时关掉 |
| **Access Key** | web 模式签名用 | 留空走 旧php web 模式；可点按钮从 B 站 localStorage 自动读取 |
| **清晰度 / 编码 / 音轨** | 默认值 | 播放时可临时切换 |

> 💡 access_key 不会上传到任何第三方服务，全部存在本地 `chrome.storage.sync`。

### ⚠️ 关于 App 模式（暂时不可用）

`App 模式`（即走 B 站 Android 端 `appkey` + `appsec` 签名通道）
**当前因服务端 SSL 握手问题暂不可用** —— 公共 BiliRoaming 代理
返回 `403`（部分场景是 `SSL handshake failed`），不是我们前端签名
逻辑错误。

> 报错大致形如：  
> `BiliRoaming playurl failed: {"code":-...,"message":"..."}` 或  
> `net::ERR_CERT_...` / `SSL routines: ssl3_read_bytes`

**目前的推荐做法：**

- **保持 `web` 模式** —— 大多数公共 BiliRoaming 服务端
  （`bili.xcnya.cn` / 自建）都直接支持 web 通道，access_key 就能拿流。
- access_key popup 里的"Access Key"输入框可以**留空**（仅限部分php后端）。
- 等服务端 SSL 伪装有人做或切到开发出tun签名重写后，App 模式会恢复（无需改代码）。

**用户侧无需操作**；如果你自己部署 BiliRoaming 服务端遇到 403（web模式几乎不可能），
可以检查 `nginx` 证书链 + 上游 B 站 `api.bilibili.com` 的 TLS 版本
（多数是 1.0/1.1 协商失败）。

---

## 🔑 access_key 获取教程

虽然 App 模式暂不可用，web模式需要 access_key。
本仓库附带一个独立油猴脚本，让你**登录 B 站主站**就能拿到 access_key：

📄 [`userscripts/balh_access_key_helper.user.js`](./userscripts/balh_access_key_helper.user.js)
v3.2.0 · MIT License · 基于 [ipcjs/bilibili-helper](https://github.com/ipcjs/bilibili-helper) 改造

### 安装步骤

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)（或兼容的 Userscript 插件）
2. 把 `userscripts/balh_access_key_helper.user.js` 拖进 Chrome 扩展页安装
   （或者从文件管理器双击，浏览器会提示是否安装）
3. 打开任意 B 站页面（推荐 B 站主页 `https://www.bilibili.com/`）

### 使用步骤（2 种方式任选）

#### 方式 1：手动输入

1. 在弹窗的"Access Key"输入框里粘贴你已有的 access_key
2. 点"保存 access_key"
3. 关闭浮层即可

#### 方式 2：二维码自动获取（推荐）

1. 点击弹窗里的"自动获取 access_key"按钮
2. 脚本会调 B 站 TV 登录接口，拿到一个 `auth_code`
3. 用 B 站**手机 App** 扫描浮层里显示的二维码（绝大多数可以直接借由主站登录状态直接拿到）
4. App 上确认后，access_key 自动写入 `localStorage.access_key`（兼容老脚本）

### 写入 popup

拿到 access_key 后，回到本扩展 popup：

1. 点 "从当前 B 站页面读取 access_key" 按钮
2. 弹窗提示"已读取 access_key，请保存"
3. 点 "保存配置" 即可

> 💡 access_key 与 B 站账号绑定，**不绑定 session**；
> 一次获取，过期前可重复使用。

---

## 开发说明

### 模块划分原则

- **`inject/main.js`** —— MAIN world IIFE，可直接读 `window.__playinfo__`，但不能 `import`。
  所以不依赖 ESM 模块，逻辑尽量短小。
- **`content/`** —— ISOLATED world，可 `import`、可发 `chrome.runtime.sendMessage`。
  业务核心。
- **`background/`** —— service worker，统一发外部 HTTP 请求。
  拆成 `service-worker.js`（路由）+ `fetch-web.js` + `fetch-app.js`（实现）。
- **`common/`** —— 跨世界共用的工具，被 `inject/` / `content/` 共享。

### 调试变量

打开 B 站页面，在 DevTools Console 可以查看：

```js
window.__BRX_PLAYER_CONTEXT__   // 当前 ep/aid/cid/limited
window.__BRX_PLAYER_DEBUG__      // state: 'mounted' / 'fetching-playurl' / ...
window.__BRX_PLAYER_LAST_MPD__   // 最近一次构建的 MPD XML
```

### 本地检查

```bash
npm run check    # node --check + JSON.parse(manifest.json) + 静态 ESM 解析
```

---

## 项目结构

```
biliExtensionsplayer/
├── manifest.json              # MV3 清单
├── README.md                  # 你正在看的
├── LICENSE                    # GPL-3.0
├── src/
│   ├── inject/
│   │   └── main.js            # MAIN world：区域限制检测 + 选集拦截
│   ├── content/
│   │   ├── app.mjs            # ISOLATED 主入口，事务管理
│   │   ├── bridge.mjs         # MAIN↔ISOLATED 桥
│   │   ├── content.js         # 引导入口
│   │   ├── player/
│   │   │   ├── dashMpdBuilder.mjs   # B 站 JSON → 标准 MPD
│   │   │   └── mountPlayer.mjs      # ArtPlayer + dash.js 接管
│   │   └── subtitle/
│   │       ├── biliSubtitle.mjs     # protobuf 解码 + XOR
│   │       └── subtitlePlugin.mjs   # SubtitleManager UI
│   ├── background/
│   │   ├── service-worker.js  # 消息路由
│   │   ├── fetch-web.js       # Web 模式
│   │   └── fetch-app.js       # App 模式（MD5 签名）
│   ├── common/                # 跨世界共用工具
│   │   ├── constants.mjs      # DEFAULT_CONFIG
│   │   ├── dom.mjs            # waitForElement / unhideCommentModule ...
│   │   └── logger.mjs
│   ├── popup/                 # 工具栏弹窗
│   └── options/               # 高级配置页
├── vendor/                    # 第三方 bundle（ArtPlayer / dash.js / 弹幕）
├── assets/                    # 图标
├── userscripts/               # 配套用户脚本
│   └── balh_access_key_helper.user.js  # access_key 获取助手（油猴）
├── scripts/
│   └── check-syntax.mjs       # 静态检查
├── dev-docs/                  # 开发期文档（不进 git）
│   ├── MEMORY.md
│   ├── PLAN.md
│   └── ...                    # 调研记录 / 历史决策
└── tests/                     # 单元测试（规划中）
```

---

## 踩过的坑

挑几个有教育意义的：

🪤 **"修 `__playinfo__` 就能解锁"是错觉**  
受限页的 `__playinfo__` 改完确实显示正常数据了，但播放器 manifest 还是 null——
因为 B 站 React wrapper 在更早阶段就读走了原始 playinfo，并固化在 Player core 内部。
后期 patch 全局变量已经太晚。

🪤 **MPD Builder 不是可以"消灭"的中间层**  
切了 ArtPlayer 之后一度以为可以省掉 MPD Builder 直接喂 B 站 JSON，
但 dash.js 是严格的 DASH 规范实现，喂 JSON 直接报错。

🪤 **VisionPlayer 切到 ArtPlayer 不是倒退，是进步**  
VisionPlayer 自己写 video 状态机，"暂停后音频继续" 的 bug 调了一周治标不治本。
切到 ArtPlayer 之后，destroy 生命周期可靠，根因消失。


---

## AI 生成声明

> 本项目的大部分代码、注释、架构设计、和文档由 AI 辅助生成。
> 协作工具：Claude code，系列模型GPT5.5,deepseekv4p,mimimax3。
> 工作方式：需求拆解、模块设计、代码实现、调试、注释撰写、文档编辑全程 AI 协作。
> 人工参与：架构决策、API 行为验证、关键 bug 复现、用户体验测试、上线前 review。

之所以主动写明这一点：

1. **透明**——你有权知道你在读什么。我们不会假装这些代码是某个天才程序员一行行手写出来的。
2. **不甩锅**——AI 生成的代码同样需要 review、验证、迭代。我们尽可能对每段代码都跑了实际场景测试。
3. **能力放大**——个人维护者能在合理时间内搞完跨世界通信、MSE 引擎集成、
   protobuf 解码、MV3 扩展架构、DASH MPD 适配这些活儿，没有 AI 协作是不可能的。
4. **仍然欢迎 review**——AI 代码会有它自己的"风格"和偶尔的"幻觉"，欢迎提 issue / PR。

---

## 许可证

本项目基于 [GNU General Public License v3.0](./LICENSE)（GPL-3.0）发布。

许可证选型依据：

- [BiliRoaming](https://github.com/yujincheng08/BiliRoaming) 协议一致
- BiliRoaming-Rust-Server 同协议
- 所有 vendor 代码许可（ArtPlayer MIT、dash.js BSD 等）均与 GPL-3.0 兼容
- 防御性 copyleft：阻止闭源 fork，保证衍生作品继续开源
- **不采用 AGPL-3.0**：本项目是用户侧浏览器扩展，不向第三方提供网络服务，
  AGPL 的网络 copyleft 条款不适用
- **不采用 MIT/Apache**：与上游 BiliRoaming 生态不一致

---

## 致谢

- [BiliRoaming](https://github.com/yujincheng08/BiliRoaming) —— 上游 Xposed 模块与思路起点
- [BiliRoaming-Rust-Server](https://github.com/yujincheng08/BiliRoaming-Rust-Server) —— 公共代理服务端实现
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) —— 播放器 UI 与状态机
- [dash.js](https://github.com/Dash-Industry-Forum/dash.js) —— DASH MSE 引擎
- 所有早期油猴脚本作者和 BiliRoaming 生态贡献者
- [解除B站区域限制 (Greasy Fork #25718)](https://greasyfork.org/zh-CN/scripts/25718-%E8%A7%A3%E9%99%A4b%E7%AB%99%E5%8C%BA%E5%9F%9F%E9%99%90%E5%88%B6) —— 浏览器端区域限制解锁油猴脚本，本扩展的思路与协议层参照

如果这个项目对你有帮助，欢迎给个 ⭐。
如果发现 bug 或有想法，欢迎开 issue / PR。

— BiliRoaming-webX 维护者
