// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryKVStore } from '../src/platform/storage';
import type * as Registry from '../src/features/stats/registry';

// registry 是模块级单例状态（session/flushedBaseline/listeners）；vitest 同文件内
// 各用例共享模块实例，故每个用例前 resetModules 并动态重新导入以获得干净状态。
// （对 brief 测试代码的唯一适配：仅改变导入方式，用例主体逐字保留。）
let recordInterception: typeof Registry.recordInterception;
let sessionCounts: typeof Registry.sessionCounts;
let onInterception: typeof Registry.onInterception;
let flushStats: typeof Registry.flushStats;
let readStats: typeof Registry.readStats;
let startStatsFlush: typeof Registry.startStatsFlush;
let STATS_KEY: string;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const r = await import('../src/features/stats/registry');
  recordInterception = r.recordInterception;
  sessionCounts = r.sessionCounts;
  onInterception = r.onInterception;
  flushStats = r.flushStats;
  readStats = r.readStats;
  startStatsFlush = r.startStatsFlush;
  STATS_KEY = r.STATS_KEY;
});
afterEach(() => { vi.useRealTimers(); });

describe('stats registry', () => {
  it('recordInterception 累计会话计数并广播监听器', () => {
    const seen: [string, number][] = [];
    const off = onInterception((kind, n) => seen.push([kind, n]));
    recordInterception('beacon');
    recordInterception('beacon', 3);
    expect(sessionCounts()).toEqual({ beacon: 4 });
    expect(seen).toEqual([['beacon', 1], ['beacon', 3]]);
    off();
    recordInterception('beacon');
    expect(seen).toHaveLength(2);
  });

  it('flushStats 落盘增量并合入既有持久值（跨会话累加）', async () => {
    const store = createMemoryKVStore();
    await store.set(STATS_KEY, { counts: { beacon: 10 }, flushedAt: 1 });
    recordInterception('beacon'); // 本会话 1
    await flushStats(store);
    const stored = await readStats(store);
    expect(stored.counts.beacon).toBe(11);
    // 同一会话重复 flush 不重复累加（flushedBaseline 机制）
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(11);
    recordInterception('beacon', 2);
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(13);
  });

  it('startStatsFlush：30s 定时落盘 + pagehide 立即落盘；store 抛错被吞', async () => {
    const store = createMemoryKVStore();
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('boom'));
    recordInterception('av1-blocked');
    const { stop } = startStatsFlush(store, 30_000);
    window.dispatchEvent(new Event('pagehide')); // pagehide flush，set 抛错被吞不炸
    await vi.advanceTimersByTimeAsync(30_000); // 定时 flush
    expect((await readStats(store)).counts['av1-blocked']).toBe(1);
    stop();
    recordInterception('p2p-replaced');
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await readStats(store)).counts['p2p-replaced']).toBe(undefined); // stop 后不再落盘
  });

  it('readStats 无存储返回零值', async () => {
    expect(await readStats(createMemoryKVStore())).toEqual({ counts: {}, flushedAt: 0 });
  });
});
