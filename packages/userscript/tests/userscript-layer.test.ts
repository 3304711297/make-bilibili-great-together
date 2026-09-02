import { describe, it, expect, afterEach } from 'vitest';
import { getModuleEnabledSync } from '../src/module-menu';
import { createGMKVStore } from '../src/gm-storage';
import { OVERRIDE_PREFIX } from '@mbgt/core';

// userscript 入口层纯函数覆盖补齐（backlog #2 评估产出）：
// 拦截点/CDN 选优/归零口径的实现与测试都在 core；本层可测的纯逻辑只有
// document-start 同步三值语义与 GM 异步 API→KVStore 适配。
const g = globalThis as unknown as Record<string, unknown>;

describe('getModuleEnabledSync（document-start 同步三值语义）', () => {
  const orig = g.GM_getValue;
  afterEach(() => { g.GM_getValue = orig; });

  it('缺省（键不存在/undefined）→ 启用', () => {
    g.GM_getValue = () => undefined;
    expect(getModuleEnabledSync('no-ad')).toBe(true);
  });

  it("'off' → 关闭", () => {
    g.GM_getValue = (k: string) => (k === `${OVERRIDE_PREFIX}no-ad` ? 'off' : undefined);
    expect(getModuleEnabledSync('no-ad')).toBe(false);
  });

  it("'on' / 'force-on' → 启用（force-on 压过共存自动停用的判定在 core resolveConflicts，此处只验同步读取）", () => {
    g.GM_getValue = (k: string) => (k === `${OVERRIDE_PREFIX}no-ad` ? 'force-on' : undefined);
    expect(getModuleEnabledSync('no-ad')).toBe(true);
    g.GM_getValue = (k: string) => (k === `${OVERRIDE_PREFIX}no-ad` ? 'on' : undefined);
    expect(getModuleEnabledSync('no-ad')).toBe(true);
  });
});

describe('createGMKVStore（GM 异步 API → KVStore 适配）', () => {
  const origGM = g.GM;
  const map = new Map<string, unknown>();

  afterEach(() => { g.GM = origGM; map.clear(); });

  function installMockGM() {
    g.GM = {
      getValue: async (k: string) => map.get(k),
      setValue: async (k: string, v: unknown) => { map.set(k, v); },
      deleteValue: async (k: string) => { map.delete(k); },
      listValues: async () => [...map.keys()]
    };
  }

  it('set/get/delete 往返一致', async () => {
    installMockGM();
    const store = createGMKVStore();
    await store.set('mbgt:test', { a: 1 });
    expect(await store.get<{ a: number }>('mbgt:test')).toEqual({ a: 1 });
    await store.delete('mbgt:test');
    expect(await store.get('mbgt:test')).toBeUndefined();
  });

  it('getAll 全量导出与 listValues 对齐', async () => {
    installMockGM();
    const store = createGMKVStore();
    await store.set('k1', 1);
    await store.set('k2', 'v');
    expect(await store.getAll()).toEqual({ k1: 1, k2: 'v' });
  });
});
