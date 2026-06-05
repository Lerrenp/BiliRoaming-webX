// MAIN ↔ ISOLATED 通信桥。
// - PageBridge：监听 window message，过滤 source = BRX.MAIN_SOURCE，按 type 分发到注册处理器。
// - sendRuntime：ISOLATED → background 的 chrome.runtime.sendMessage 薄封装。
//
// 所有跨世界消息都走这两个函数。MAIN→ISOLATED 通过 window.postMessage；ISOLATED→background
// 通过 chrome.runtime.sendMessage，background 再回投到 ISOLATED 时通过同一通道。
import { BRX } from '../common/constants.mjs';

export class PageBridge {
  constructor(logger) {
    this.logger = logger;
    this.handlers = new Map();
    this.bound = this.onMessage.bind(this);
  }
  start() { window.addEventListener('message', this.bound); }
  stop()  { window.removeEventListener('message', this.bound); }
  on(type, fn) { this.handlers.set(type, fn); }
  async onMessage(event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== BRX.MAIN_SOURCE) return;
    const fn = this.handlers.get(msg.type);
    if (!fn) return;
    try { await fn(msg.payload || {}); }
    catch (err) { this.logger.error('bridge handler failed', msg.type, err); }
  }
}

export function sendRuntime(action, payload) {
  return chrome.runtime.sendMessage({ type: 'BRX_PLAYER_ACTION', action, payload });
}
