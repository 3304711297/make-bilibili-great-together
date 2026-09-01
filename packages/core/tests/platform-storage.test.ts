import { describe, it, expect } from 'vitest';
import { createMemoryKVStore, readForceOnOverrides, OVERRIDE_PREFIX } from '../src/platform/storage';

describe('createMemoryKVStore', () => {
  it('set 后 get 返回同值，delete 后返回 undefined', async () => {
    const store = createMemoryKVStore();
    await store.set('a', { x: 1 });
    expect(await store.get('a')).toEqual({ x: 1 });
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });

  it('get 未设置的键返回 undefined', async () => {
    const store = createMemoryKVStore();
    expect(await store.get('nope')).toBeUndefined();
  });
});

describe('readForceOnOverrides', () => {
  it('仅收集值为 force-on 的键', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}no-ad`, 'force-on');
    await store.set(`${OVERRIDE_PREFIX}no-p2p`, 'other');
    const names = ['no-ad', 'no-p2p', 'use-system-fonts'];
    const overrides = await readForceOnOverrides(store, names);
    expect(overrides.has('no-ad')).toBe(true);
    expect(overrides.has('no-p2p')).toBe(false);
    expect(overrides.has('use-system-fonts')).toBe(false);
  });
});
