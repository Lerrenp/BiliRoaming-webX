# ArtPlayer 弹幕按钮实现调研（2026-06-04）

## 调研目标

确认 `ArtPlayer-master` 项目内是否已有可复用的弹幕按钮实现，供 `biliExtensionsplayer` 后续接入弹幕 UI 时参考。

## 调研结论

有完整实现。ArtPlayer 在 `packages/` 下提供两个弹幕相关插件，弹幕按钮 UI 主要落在 `artplayer-plugin-danmuku/src/setting.js` 中，开箱即用。

## 插件位置

| 插件 | 路径 | 作用 |
|---|---|---|
| `artplayer-plugin-danmuku` | `ArtPlayer-master/packages/artplayer-plugin-danmuku/` | 弹幕核心插件（含按钮、设置面板、发送器） |
| `artplayer-plugin-danmuku-mask` | `ArtPlayer-master/packages/artplayer-plugin-danmuku-mask/` | 弹幕蒙版（限定弹幕只在视频画面内显示） |

## 入口文件

`packages/artplayer-plugin-danmuku/src/index.js`：

```js
import Danmuku from './danmuku'
import heatmap from './heatmap'
import Setting from './setting'

export default function artplayerPluginDanmuku(option) {
  return (art) => {
    const danmuku = new Danmuku(art, option)
    const setting = new Setting(art, danmuku)

    if (danmuku.option.heatmap) {
      heatmap(art, danmuku, danmuku.option.heatmap)
    }

    return {
      name: 'artplayerPluginDanmuku',
      emit: danmuku.emit.bind(danmuku),
      load: danmuku.load.bind(danmuku),
      config: danmuku.config.bind(danmuku),
      hide: danmuku.hide.bind(danmuku),
      show: danmuku.show.bind(danmuku),
      reset: danmuku.reset.bind(danmuku),
      mount: setting.mount.bind(setting),
    }
  }
}

artplayerPluginDanmuku.icons = Setting.icons
```

- `Danmuku`（`danmuku.js`）：弹幕数据加载、渲染、生命周期（`emit/load/config/show/hide/reset/stop/start`）。
- `Setting`（`setting.js`）：按钮 DOM、面板、事件、滑块、发送器。
- `heatmap`（`heatmap.js`）：可选热力图。

## 按钮 UI 全景

所有按钮 DOM 由 `Setting.TEMPLATE` getter 一次性渲染（`setting.js:110-205`）：

```text
.artplayer-plugin-danmuku
├── .apd-toggle          弹幕开关（开/关）
├── .apd-config          配置按钮（齿轮）
│   └── .apd-config-panel
│       ├── .apd-config-mode        按类型屏蔽（滚动/顶部/底部）
│       ├── .apd-config-other       防重叠 / 同步速度
│       └── .apd-config-slider × 4  不透明度 / 显示区域 / 字号 / 速度
├── .apd-emitter
│   ├── .apd-style       样式按钮（调色板）
│   │   └── .apd-style-panel
│   │       ├── .apd-style-mode     模式（滚动/顶部/底部）
│   │       └── .apd-style-color    颜色选择
│   ├── .apd-input       输入框
│   └── .apd-send        发送按钮
```

## 按钮清单与功能

| 按钮 | CSS 类 | 功能 | 事件代码位置 |
|---|---|---|---|
| 弹幕开关 | `.apd-toggle` | 点击切换 `visible`，同步 tooltip `打开弹幕/关闭弹幕` | `setting.js:370-375` |
| 配置按钮 | `.apd-config` | hover 弹出配置面板（`onMouseEnter`） | `setting.js:70-75, 599-618` |
| 样式按钮 | `.apd-style` | hover 弹出样式面板 | `setting.js:77-82, 599-618` |
| 类型屏蔽 | `.apd-config-mode .apd-mode` | 切换 `modes` 数组（包含/移除滚动/顶部/底部） | `setting.js:377-393` |
| 防重叠 | `.apd-anti-overlap` | 切换 `antiOverlap` | `setting.js:395-400` |
| 同步速度 | `.apd-sync-video` | 切换 `synchronousPlayback` | `setting.js:402-407` |
| 发送模式 | `.apd-style-mode .apd-mode` | 切换 `mode`（0/1/2） | `setting.js:409-418` |
| 颜色选择 | `.apd-style-color .apd-color` | 切换 `color` | `setting.js:420-428` |
| 发送按钮 | `.apd-send` | 触发 `emit()`，并进入 `lockTime` 倒计时 | `setting.js:430, 620-657, 659-682` |
| 输入回车 | `.apd-input` | `keypress Enter` 等价于点击发送 | `setting.js:432-437` |

## 弹幕开关按钮核心逻辑

`setting.js:370-375`：

```js
this.art.proxy($toggle, 'click', () => {
  this.danmuku.config({
    visible: !this.option.visible,
  })
  this.reset()
})
```

底层 `config()` 在 `danmuku.js:387-427` 收到 `visible` 变化时，会调用 `show()` / `hide()`：

```js
if (this.option.visible) {
  this.show()
}
else {
  this.hide()
}
```

`show()` / `hide()`（`danmuku.js:704-718`）只动 `this.$danmuku.style.opacity` 和 `isHide` 标志，不销毁 DOM，开关零成本。

## 图标资源

`Setting.icons` 静态 getter（`setting.js:85-100`），从 `src/img/*.svg?raw` 内联：

| 名称 | 用途 |
|---|---|
| `$on` / `$off` | 弹幕开关的「开/关」图标 |
| `$config` | 配置按钮（齿轮） |
| `$style` | 样式按钮（调色板） |
| `$mode_0_off/on` ~ `$mode_2_off/on` | 滚动 / 顶部 / 底部 三种模式 |
| `$check_on` / `$check_off` | 复选框 |

## 挂载位置

- 默认挂载到 `art.template.$controlsCenter`（播放器控制栏中部），见 `setting.js:22-27, 64`。
- 可通过 `option.mount: HTMLElement | selector` 自定义挂载到任意位置（`danmuku.js:65, 409`，`setting.js:739-746`）。
- 全屏切换时 `onFullscreen()` 重新决定面板归属（`setting.js:584-597`）。
- 宽度 < `option.width`（默认 512）时改挂到 `$player` 底部（`setting.js:693-708`）。

## 弹幕数据加载

`Danmuku.load()`（`danmuku.js:264-310`）支持 4 种来源：

```text
option.danmuku
├── Function   -> 异步函数
├── Promise    -> Promise 对象
├── string     -> B 站 xml 链接（由 ./bilibili.js 的 bilibiliDanmuParseFromUrl 解析）
└── Array      -> 直接传入的弹幕数组
```

事件：

- `artplayerPluginDanmuku:loaded`
- `artplayerPluginDanmuku:error`
- `artplayerPluginDanmuku:config`
- `artplayerPluginDanmuku:show` / `:hide` / `:start` / `:stop` / `:reset` / `:destroy` / `:visible`

## 发送器（emitter）流程

`Setting.emit()`（`setting.js:620-657`）：

1. 读输入框，去 trim，拦截空文本、锁定中、正在发送中三种状态。
2. 构造 `danmu = { text, mode, color, time: art.currentTime }`。
3. `await option.beforeEmit(danmu)`：自定义过滤，支持返回 Promise。
4. 通过则 `danmuku.emit(danmu)`，并 `lock()` 进入 `lockTime` 秒倒计时。

`lock()`（`setting.js:659-682`）逐秒把 `$send.textContent` 改为剩余秒数，倒数到 0 调用 `unlock()` 恢复「发送」。

## 蒙版插件（可选）

`artplayer-plugin-danmuku-mask/src/index.js`：

- 作用：弹幕只在视频画面的可视矩形内显示，不飘到黑边。
- 与弹幕主插件解耦，按需加载。

## 滑块实现要点

`Setting.createSlider()`（`setting.js:512-582`）：

- 自绘 DOM：`.apd-slider-line`、`.apd-slider-points`、`.apd-slider-progress`、`.apd-slider-dot`、`.apd-slider-steps`。
- `pointerdown/move/up` + `click` 双路径触发，支持触屏和拖拽。
- 旋屏（`art.isRotate`）时改用 `clientY` 计算。
- 通过 `art.on('document:pointermove' / 'document:pointerup')` 监听全局指针事件。

## 对 biliExtensionsplayer 的可借鉴点

1. 按钮组织：开关 / 配置 / 样式 / 发送 四件套是公认最优交互，可直接照搬。
2. 开关零成本：通过 `opacity` 切换，不销毁 DOM，seek 也不重建。
3. 配置面板 hover 触发 + 自适应定位：`onMouseEnter()` 算出 `left/right` 越界值并修正（`setting.js:599-618`），避免面板超出播放器。
4. 数据 → 渲染分离：`Danmuku` 只管数据和 DOM，`Setting` 只管 UI，便于单独替换（比如把 `Setting` 换成我们自己 B 站风风格面板）。
5. 图标内联：通过 Vite `?raw` 把 SVG 注入模板，避免额外网络请求，可在 MV3 content script 场景复用相同思路。
6. 事件命名空间：`artplayerPluginDanmuku:*` 前缀统一，对外不污染主播放器事件。
7. 可挂载到任意容器：默认控制栏中部，可被 `mount` 覆盖，适合「在原生播放器之上覆盖一层」的场景——和本项目 `.brx-player-root` 覆盖策略吻合。

## 注意事项

- `setting.js` 的 `TEMPLATE` 整体依赖 `artplayer-plugin-danmuku` 的 `style.less`（在文件末尾通过 `<style id="artplayer-plugin-danmuku">` 注入），复制按钮时需把样式一起带走。
- `Danmuku` 使用 Web Worker 计算弹幕 `top` 值（`worker.js`），纯 UI 接入可不引入。
- `artplayerPluginDanmuku.icons` 静态属性是公开 API，二次封装时要保留，否则会丢失图标。
- 弹幕数据格式（B 站 xml 解析）见 `src/bilibili.js` 的 `bilibiliDanmuParseFromUrl`。

## 后续建议

- 不直接复用整个插件（依赖 ArtPlayer 播放器实例），但可以把 `TEMPLATE` HTML 片段、`Setting.icons`、`Setting.reset()` 中对 `data-*` 属性的同步逻辑，移植成独立的 `brx-danmaku-control` 组件。
- 把 `Setting.createEvents()` 拆成「按钮事件 + 面板事件 + 滑块事件」三组，便于在 VisionPlayer / 自研播放器中按需挂载。
- 弹幕 DOM 容器约定为 `.brx-danmaku-layer`（已在 `BILIBILI_NATIVE_PLAYER.md` 记录），按钮组建议同级挂在 `.brx-danmaku-control`，方便定位和样式覆盖。