// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountStatsBadge } from '../src/features/stats/badge';
import { recordInterception } from '../src/features/stats/registry';
import { createMemoryKVStore } from '../src/platform/storage';

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
});
