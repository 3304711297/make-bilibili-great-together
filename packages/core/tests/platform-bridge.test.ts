import { describe, it, expect } from 'vitest';
import { createMemoryKVStore, type KVStore } from '../src/platform/storage';
import { createBridgeHost, createBridgedKVStore, BRIDGE_REQUEST_EVENT } from '../src/platform/bridge';

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
    const { client, unload } = wired();
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
});
