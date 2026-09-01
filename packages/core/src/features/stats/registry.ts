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
let flushedBaseline: Record<string, number> = {};
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

export async function flushStats(store: KVStore): Promise<void> {
  try {
    const stored = await store.get<StatsPayload>(STATS_KEY);
    const storedCounts = stored?.counts ?? {};
    let dirty = false;
    const merged: Record<string, number> = { ...storedCounts };
    for (const [kind, n] of Object.entries(session)) {
      const delta = n - (flushedBaseline[kind] ?? 0);
      if (delta > 0) {
        merged[kind] = (merged[kind] ?? 0) + delta;
        dirty = true;
      }
    }
    if (!dirty && stored) return; // 无增量不写
    await store.set(STATS_KEY, { counts: merged, flushedAt: Date.now() });
    // 写盘成功后才推进 baseline：set 抛错时增量保留，下轮 flush 重试（降级原则）
    flushedBaseline = { ...session };
  } catch {
    // 落盘失败不影响统计收集
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
