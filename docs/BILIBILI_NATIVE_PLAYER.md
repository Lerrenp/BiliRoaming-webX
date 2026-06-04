# B 站原生播放器界面与行为基线（2026-06-04）

## 测试页面

| 类型 | URL | 状态 |
|---|---|---|
| 国内正常番剧 | https://www.bilibili.com/bangumi/play/ss25813 | 原生播放器可初始化，可切清晰度、弹幕、字幕、网页全屏 |
| 港澳台受限番剧 | https://www.bilibili.com/bangumi/play/ss44467 / ep713699 | 显示区域限制，原生播放器 manifest/playUrl 为空 |

## 原生播放器位置

- 主容器：`#bilibili-player`，实测约 `x=50 y=104 w=1152 h=704`
- 播放器容器：`.bpx-player-container`
- 视频区域：`.bpx-player-video-wrap` / `.bpx-player-video-area`
- 原生 video：`.bpx-player-video-area video`
- 区域限制遮罩：`#big-block-panel`、`[class*=areaLimit]`

新插件覆盖策略：在 `#bilibili-player` 内追加 `.brx-player-root` 绝对定位覆盖层，不移动 `#comment-module`。

## 原生弹幕结构

B 站 Web 弹幕是 div/CSS 动画结构，不是 canvas：

```text
.bpx-player-dm
  .bpx-player-dm-wrap
    .bpx-player-dm-container
  .bpx-player-dm-wrap-child
    .bpx-player-dm-container
```

新插件使用 danmaku-lite canvas 层：`.brx-danmaku-layer`，放在新 video 上方。

## 原生选集

- 容器：`.eplist_ep_list_wrapper...`
- 链接：`a[href*="/bangumi/play/ep"]`
- 新插件在 MAIN world 捕获点击，阻止 SPA 原始播放器继续走区域限制分支，然后按 ep_id 重新取流并重建播放器。

## 原生清晰度 / 编码 / 音轨

正常页原生清晰度由 B 站播放器内部 DASH manifest + 设置菜单驱动；受限页没有 playUrl，菜单无有效流。

新插件不复用原生菜单，独立提供：

- 清晰度选择：按 `dash.video[].id`，如 `112/80/64/32/16`
- 编码选择：按 codec 分组，`AVC / HEVC / AV1 / 自动`
- 音轨选择：按 `dash.audio[].id`，支持自动 / 指定音轨

切换后重建 MPD 并保持当前播放时间。

## 字幕

原生字幕接口：

```text
/x/v2/subtitle/web/view?oid=<cid>&pid=<aid>&context_ext=...&type=1
```

受限页 oid/pid 为空。v0.1.0 先不接字幕，保留接口位置；后续可在取得 aid/cid 后请求字幕并注入 text track。

## 网页全屏

原生网页全屏是 `.bpx-player-container` 内部状态。新插件 v0.1.0 依赖浏览器 video controls 全屏；覆盖层跟随 `#bilibili-player`，不破坏评论区。

## 结论

受限页原生 Player 的 manifest/playUrl 为空，修补 `window.__playinfo__` 无法恢复 video pipeline。因此新项目采用覆盖式播放器：

```text
BiliRoaming playurl -> B 站 DASH JSON -> MPD Blob -> dash.js -> video -> danmaku-lite overlay
```
