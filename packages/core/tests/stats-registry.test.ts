// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryKVStore } from '../src/platform/storage';
import type * as Registry from '../src/features/stats/registry';

// registry 是模块级单例状态（session/flushing/listeners）；vitest 同文件内
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

  it('flushStats 落盘增量并合入既有持久值（归零语义）', async () => {
    const store = createMemoryKVStore();
    await store.set(STATS_KEY, { counts: { beacon: 10 }, flushedAt: 1 });
    recordInterception('beacon'); // 本会话 1
    await flushStats(store);
    const stored = await readStats(store);
    expect(stored.counts.beacon).toBe(11);
    // 归零语义：写盘成功后已落盘部分从会话扣除（原 flushedBaseline 时代断言 sessionCounts 为 11 作废）
    expect(sessionCounts()['beacon']).toBe(undefined);
    // 同一会话重复 flush：无增量且已有存储 → 不写盘
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(11);
    recordInterception('beacon', 2);
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(13);
    expect(sessionCounts()['beacon']).toBe(undefined); // 归零干净
  });

  it('归零语义：写盘成功后已落盘部分从会话扣除（间隙新增保留）', async () => {
    const store = createMemoryKVStore();
    recordInterception('beacon', 10);
    // set 期间模拟新增：mock set 在 resolve 前再记 3 个（仅首次——第二轮 flush 须无间隙，
    // 否则按归零不变式第二轮后 session 应为 3 而非 undefined，与用例末断言矛盾）
    const origSet = store.set.bind(store);
    let gapDone = false;
    (store as any).set = async (key: string, value: unknown) => {
      if (!gapDone) { gapDone = true; recordInterception('beacon', 3); }
      await origSet(key, value as never);
    };
    await flushStats(store);
    expect(sessionCounts()['beacon']).toBe(3);          // 13 - 10 = 3（间隙新增保留）
    expect((await readStats(store)).counts.beacon).toBe(10); // 本次只落盘 10
    // 下一轮只落盘新增的 3
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(13);
    expect(sessionCounts()['beacon']).toBe(undefined);   // 归零干净
  });

  it('单飞：进行中的 flush 未结束前重入直接返回（set 只执行一次）', async () => {
    const store = createMemoryKVStore();
    const origSet = store.set.bind(store);
    let releaseSet!: () => void;
    const gate = new Promise<void>(r => { releaseSet = r; });
    let setCalls = 0;
    (store as any).set = async (key: string, value: unknown) => {
      setCalls++;
      await gate;
      return origSet(key as string, value as never);
    };
    recordInterception('beacon', 5);
    const p1 = flushStats(store);
    const p2 = flushStats(store); // 重入被吞
    releaseSet();
    await Promise.all([p1, p2]);
    expect(setCalls).toBe(1);
    expect((await readStats(store)).counts.beacon).toBe(5); // 只落一份，无双倍扣除
  });

  it('无增量且已有存储 → 不写盘（不产空 payload）', async () => {
    const store = createMemoryKVStore();
    await store.set(STATS_KEY, { counts: { beacon: 7 }, flushedAt: 1 });
    const setSpy = vi.spyOn(store, 'set');
    await flushStats(store);
    expect(setSpy).not.toHaveBeenCalled();
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
