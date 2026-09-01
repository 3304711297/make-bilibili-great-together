import { describe, it, expect } from 'vitest';
import { createMemoryKVStore, type KVStore } from '../src/platform/storage';
import { createBridgeHost, createBridgedKVStore, BRIDGE_REQUEST_EVENT, BRIDGE_RESPONSE_EVENT } from '../src/platform/bridge';

function wired(): { client: KVStore; hostStore: KVStore; unload: () => void } {
  const et = new EventTarget();
  const hostStore = createMemoryKVStore();
  const unload = createBridgeHost(hostStore, et);
  const client = createBridgedKVStore(et);
  return { client, hostStore, unload };
}

describe('storage bridge', () => {
  it('set/get/delete 全链路', async () => {
    const { client, hostStore } = wired();
    await client.set('a', { x: 1 });
    expect(await hostStore.get('a')).toEqual({ x: 1 });
    expect(await client.get('a')).toEqual({ x: 1 });
    await client.delete('a');
    expect(await client.get('a')).toBeUndefined();
  });

  it('宿主未启动时 get 超时返回 undefined、set 超时 reject', async () => {
    const client = createBridgedKVStore(new EventTarget(), 50);
    await expect(client.get('k')).resolves.toBeUndefined();
    await expect(client.set('k', 1)).rejects.toThrow(/bridge timeout/i);
  });

  it('卸载后请求不再被处理', async () => {
    // 此用例需单独建 client（不走 wired()）：传 50ms 超时消除默认 3s 的等待
    const et = new EventTarget();
    const unload = createBridgeHost(createMemoryKVStore(), et);
    const client = createBridgedKVStore(et, 50);
    unload();
    await expect(client.get('k')).resolves.toBeUndefined();
  });

  it('请求事件名正确（isolated 端按此监听）', () => {
    let seen = '';
    const et = new EventTarget();
    et.addEventListener(BRIDGE_REQUEST_EVENT, () => { seen = BRIDGE_REQUEST_EVENT; });
    et.dispatchEvent(new Event(BRIDGE_REQUEST_EVENT));
    expect(seen).toBe('mbgt:storage-request');
  });

  it('getAll 经桥接往返', async () => {
    // 沿用该文件既有 fake-host 模式：host 落 memory store，client 走 eventTarget
    // （createMemoryKVStore/createBridgeHost/createBridgedKVStore 均取文件顶部静态 import——bridge 不导出 createMemoryKVStore，动态 import 会取到 undefined）
    const store = createMemoryKVStore();
    await store.set('mbgt:a', 1);
    const et = new EventTarget();
    createBridgeHost(store, et);
    const client = createBridgedKVStore(et);
    expect(await client.getAll()).toEqual({ 'mbgt:a': 1 });
  });

  it('probe action 经桥接往返（isolated 返回 { ok, ms }）', async () => {
    const { createBridgeHost, createBridgedProbeFetch } = await import('../src/platform/bridge');
    const et = new EventTarget();
    const probeFetch = async (url: string) => ({ ok: url.startsWith('https://'), ms: 42 });
    createBridgeHost(createMemoryKVStore(), et, probeFetch as any);
    const client = createBridgedProbeFetch(et);
    const r = await client('https://upos.bilivideo.com/x.m4s', 2_000);
    expect(r).toEqual({ ok: true, ms: 42 });
    const r2 = await client('http://bad', 2_000);
    expect(r2.ok).toBe(false);
  });

  it('未知 action 回 ok:false 且不误删既有键（delete 分支显式化 + unknown 兜底）', async () => {
    const et = new EventTarget();
    const hostStore = createMemoryKVStore();
    createBridgeHost(hostStore, et);
    const client = createBridgedKVStore(et);
    await client.set('keep', 1);
    const res = await new Promise<{ id: string; ok: boolean; error?: string }>(resolve => {
      const listener = (ev: Event) => resolve((ev as CustomEvent<{ id: string; ok: boolean; error?: string }>).detail);
      et.addEventListener(BRIDGE_RESPONSE_EVENT, listener, { once: true });
      et.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: { id: 'u1', action: 'bogus', key: 'keep' } }));
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unknown action');
    expect(await hostStore.get('keep')).toBe(1);
  });
});
