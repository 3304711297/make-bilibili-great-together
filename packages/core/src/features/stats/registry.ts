// 拦截统计注册表（spec §4.2）：会话内存累积，30s/隐藏节流落盘，跨会话累加。
// 收集始终开启（成本极低）；展示（角标/面板）默认关闭——由接线层按设置挂载。
// 降级原则：落盘/监听器任何异常被吞，绝不影响拦截路径。
import type { KVStore } from '../../platform/storage';

export const STATS_KEY = 'mbgt:stats:counters';

export interface StatsPayload {
  counts: Record<string, number>;
  flushedAt: number;
}

const session: Record<string, number> = {};
const listeners = new Set<(kind: string, count: number) => void>();

export function recordInterception(kind: string, count = 1): void {
  session[kind] = (session[kind] ?? 0) + count;
  for (const l of listeners) {
    try { l(kind, count); } catch { /* 监听器异常不影响拦截 */ }
  }
}

export function onInterception(listener: (kind: string, count: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function sessionCounts(): Record<string, number> {
  return { ...session };
}

let flushing = false;

export async function flushStats(store: KVStore): Promise<void> {
  if (flushing) return; // 冻结#2：单飞——并发重入直接返回，同一 delta 不重复扣除
  flushing = true;
  try {
    const stored = await store.get<StatsPayload>(STATS_KEY);
    const storedCounts = stored?.counts ?? {};
    // delta 快照在 get 之后、set 之前取：set 间隙的新增留在会话，不会被本次归零吃掉
    const delta: Record<string, number> = {};
    let dirty = false;
    for (const [kind, n] of Object.entries(session)) {
      if (n > 0) { delta[kind] = n; dirty = true; }
    }
    if (!dirty && stored) return; // 无增量不写（也不产空 payload）
    const merged: Record<string, number> = { ...storedCounts };
    for (const [kind, v] of Object.entries(delta)) merged[kind] = (merged[kind] ?? 0) + v;
    await store.set(STATS_KEY, { counts: merged, flushedAt: Date.now() });
    // 写盘成功后归零已落盘部分：await 间隙的新增（会话值已大于 delta）保留到下轮
    for (const [kind, v] of Object.entries(delta)) {
      const left = (session[kind] ?? 0) - v;
      if (left > 0) session[kind] = left; else delete session[kind];
    }
  } catch {
    // 落盘失败：不扣减，增量保留，下轮重试（Plan 4 T2 裁定）
  } finally {
    flushing = false;
  }
}

export function startStatsFlush(store: KVStore, intervalMs = 30_000): { stop(): void } {
  const timer = setInterval(() => { void flushStats(store); }, intervalMs);
  const onPageHide = () => { void flushStats(store); };
  addEventListener('pagehide', onPageHide);
  return {
    stop() {
      clearInterval(timer);
      removeEventListener('pagehide', onPageHide);
    }
  };
}

export async function readStats(store: KVStore): Promise<StatsPayload> {
  return (await store.get<StatsPayload>(STATS_KEY)) ?? { counts: {}, flushedAt: 0 };
}
