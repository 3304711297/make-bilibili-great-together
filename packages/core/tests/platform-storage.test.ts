import { describe, it, expect } from 'vitest';
import {
  createMemoryKVStore, readModuleOverrides, migrateLegacyEnabledKeys,
  OVERRIDE_PREFIX, STORAGE_VERSION_KEY, STORAGE_VERSION
} from '../src/platform/storage';

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

describe('readModuleOverrides（三值语义）', () => {
  it('off / force-on 记录，缺省与 on 不记录', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}a`, 'off');
    await store.set(`${OVERRIDE_PREFIX}b`, 'force-on');
    await store.set(`${OVERRIDE_PREFIX}c`, 'on');
    const map = await readModuleOverrides(store, ['a', 'b', 'c', 'd']);
    expect(map.get('a')).toBe('off');
    expect(map.get('b')).toBe('force-on');
    expect(map.has('c')).toBe(false);
    expect(map.has('d')).toBe(false);
  });
});

describe('migrateLegacyEnabledKeys', () => {
  it('mbgt:enabled:false → override off 并删旧键；已迁移则跳过', async () => {
    const store = createMemoryKVStore();
    await store.set('mbgt:enabled:no-ad', false);
    await store.set('mbgt:enabled:defuse-spyware', true);
    await migrateLegacyEnabledKeys(store);
    expect(await store.get(`${OVERRIDE_PREFIX}no-ad`)).toBe('off');
    expect(await store.get('mbgt:enabled:no-ad')).toBe(undefined);
    expect(await store.get('mbgt:enabled:defuse-spyware')).toBe(undefined);
    expect(await store.get(STORAGE_VERSION_KEY)).toBe(STORAGE_VERSION);
    // 幂等：二次运行不再改动
    await store.set('mbgt:enabled:x', false);
    await migrateLegacyEnabledKeys(store);
    expect(await store.get('mbgt:enabled:x')).toBe(false);
  });
});

describe('KVStore.getAll', () => {
  it('memory store 返回全量键值', async () => {
    const store = createMemoryKVStore();
    await store.set('mbgt:a', 1);
    await store.set('other', 2);
    expect(await store.getAll()).toEqual({ 'mbgt:a': 1, other: 2 });
  });
});
