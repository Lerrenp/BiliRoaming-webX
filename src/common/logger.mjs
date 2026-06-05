// 通用日志工具：所有世界（MAIN / ISOLATED / background）共用一个轻量 logger。
// 失败安全：浏览器禁用 console 或方法不存在时静默吞掉，避免污染业务流。
export function createLogger(tag='[BRX-Player]'){
  const out = (level, args) => { try { console[level](tag, ...args); } catch (_) {} };
  return {
    debug: (...a) => out('debug', a),
    info:  (...a) => out('info',  a),
    warn:  (...a) => out('warn',  a),
    error: (...a) => out('error', a),
  };
}
