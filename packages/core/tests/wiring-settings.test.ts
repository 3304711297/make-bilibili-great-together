import { describe, it, expect } from 'vitest';
import { readSettingsWithBudget, SETTING_CDN_PROBE, SETTING_STATS_BADGE } from '../src/platform/storage';
import { createMemoryKVStore } from '../src/platform/storage';
import { OVERRIDE_PREFIX } from '../src/platform/storage';

const slowStore = () => {
  const store = createMemoryKVStore();
  return { ...store, getAll: () => new Promise<Record<string, unknown>>(() => {}) }; // 永不 resolve
};

describe('readSettingsWithBudget', () => {
  it('正常读取：overrides + 两个设置', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}no-ad`, 'force-on');
    await store.set(SETTING_CDN_PROBE, false);
    await store.set(SETTING_STATS_BADGE, true);
    const s = await readSettingsWithBudget(store, ['no-ad', 'defuse-spyware']);
    expect(s.overrides.get('no-ad')).toBe('force-on');
    expect(s.cdnProbe).toBe(false);
    expect(s.statsBadge).toBe(true);
  });

  it('读超预算 → 回退默认值（cdnProbe=true, statsBadge=false, overrides 空）', async () => {
    // getAll 永不 resolve + 预算 5ms（真实计时，确定性）
    const s = await readSettingsWithBudget(slowStore() as any, ['no-ad'], 5);
    expect(s.cdnProbe).toBe(true);
    expect(s.statsBadge).toBe(false);
    expect(s.overrides.size).toBe(0);
  });
});
