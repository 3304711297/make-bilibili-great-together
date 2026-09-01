// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
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
});
