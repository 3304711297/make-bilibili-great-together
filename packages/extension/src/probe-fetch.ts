import type { ProbeFetch } from '@mbgt/core';

// isolated world 的裸 fetch（无任何 hook 改写）——探测必须走这条通道，
// 否则 MAIN world 的 no-p2p onBeforeFetch 会把候选宿主改写成最优宿主（探测退化）。
export function createExtensionProbeFetch(): ProbeFetch {
  return (url, timeoutMs) => new Promise(resolve => {
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: ctrl.signal })
      .then(() => resolve({ ok: true, ms: Math.round(performance.now() - started) }))
      .catch(() => resolve({ ok: false, ms: Math.round(performance.now() - started) }))
      .finally(() => clearTimeout(timer));
  });
}
