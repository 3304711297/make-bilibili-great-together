import type { ProbeFetch } from '@mbgt/core';

// GM_xmlhttpRequest 通道：绕 CORS（meta 已 @connect bilivideo.com）且绕开页面 fetch hook
export function createGMProbeFetch(): ProbeFetch {
  return (url, timeoutMs) => new Promise(resolve => {
    const started = performance.now();
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Range: 'bytes=0-1023' },
        timeout: timeoutMs,
        onload: () => resolve({ ok: true, ms: Math.round(performance.now() - started) }),
        onerror: () => resolve({ ok: false, ms: Math.round(performance.now() - started) }),
        ontimeout: () => resolve({ ok: false, ms: timeoutMs })
      });
    } catch {
      // 同步抛出（如脚本管理器未实现该 API）：探测 promise 必须始终结算
      resolve({ ok: false, ms: timeoutMs });
    }
  });
}
