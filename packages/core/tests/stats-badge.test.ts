// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mountStatsBadge, readBadgeBaseline } from '../src/features/stats/badge';
import { recordInterception } from '../src/features/stats/registry';
import { createMemoryKVStore } from '../src/platform/storage';
import { DNR_STATS_KEY } from '../src/features/stats/dnr';

describe('stats badge', () => {
  it('挂载出 #mbgt-stats-badge，实时事件刷新总数', () => {
    const destroy = mountStatsBadge({ store: createMemoryKVStore() });
    expect(destroy).not.toBeNull();
    const chip = document.getElementById('mbgt-stats-badge')!;
    recordInterception('beacon', 3);
    expect(chip.textContent).toContain('3');
    // 重复挂载返回 null
    expect(mountStatsBadge({ store: createMemoryKVStore() })).toBe(null);
    destroy!();
    expect(document.getElementById('mbgt-stats-badge')).toBe(null);
  });

  it('readBadgeBaseline：content + DNR（归并 dnr 单键）', async () => {
    const store = createMemoryKVStore();
    await store.set('mbgt:stats:counters', { counts: { beacon: 5 }, flushedAt: 1 });
    await store.set(DNR_STATS_KEY, { counts: { '1': 3, unknown: 2 }, updatedAt: 1 });
    const base = await readBadgeBaseline(store);
    expect(base.beacon).toBe(5);
    expect(base.dnr).toBe(5); // 3+2 归并
  });

  it('badge 30s 重读基线不吃掉会话未归档增量（归零口径下无重复计数）', async () => {
    vi.resetModules(); // 会话计数是模块级状态：动态取全新 registry/badge 实例，隔离本文件前序用例的 recordInterception
    const { recordInterception: record } = await import('../src/features/stats/registry');
    const { mountStatsBadge: mount } = await import('../src/features/stats/badge');
    vi.useFakeTimers();
    const store = createMemoryKVStore();
    await store.set('mbgt:stats:counters', { counts: { beacon: 100 }, flushedAt: 1 });
    const destroy = mount({ store })!;
    await vi.advanceTimersByTimeAsync(10);
    expect(document.getElementById('mbgt-stats-badge')!.textContent).toContain('100');
    record('beacon', 7); // 实时 107
    await vi.advanceTimersByTimeAsync(30_000); // 30s 重读基线（此时仍 100）→ 100+7=107
    expect(document.getElementById('mbgt-stats-badge')!.textContent).toContain('107');
    vi.useRealTimers();
    destroy();
  });

  it('flush 落盘成功后事件驱动重读基线：badge 立即自愈，不等 30s', async () => {
    vi.resetModules();
    const { recordInterception: record, flushStats } = await import('../src/features/stats/registry');
    const { mountStatsBadge: mount } = await import('../src/features/stats/badge');
    vi.useFakeTimers();
    const store = createMemoryKVStore();
    await store.set('mbgt:stats:counters', { counts: { beacon: 100 }, flushedAt: 1 });
    const destroy = mount({ store })!;
    await vi.advanceTimersByTimeAsync(10);
    expect(document.getElementById('mbgt-stats-badge')!.textContent).toContain('100');
    record('beacon', 7); // 实时 100+7=107
    await flushStats(store); // 归零口径：7 落盘、会话归零 → 持久 107
    await vi.advanceTimersByTimeAsync(0); // 冲刷事件回调的重读微任务
    record('beacon', 5); // 新拦截触发渲染：应基线 107 + 会话 5 = 112
    // 低估窗口钉死：无事件机制时基线仍 100 → 105（偏低 7）
    expect(document.getElementById('mbgt-stats-badge')!.textContent).toContain('112');
    vi.useRealTimers();
    destroy();
  });
});
