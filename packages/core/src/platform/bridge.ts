import type { KVStore } from './storage';

export const BRIDGE_REQUEST_EVENT = 'mbgt:storage-request';
export const BRIDGE_RESPONSE_EVENT = 'mbgt:storage-response';

interface BridgeRequest { id: string; action: 'get' | 'set' | 'delete'; key: string; value?: unknown }
interface BridgeResponse { id: string; ok: boolean; value?: unknown; error?: string }

/**
 * ISOLATED 侧桥接宿主：把 MAIN world 经 CustomEvent detail 传来的请求落到 KVStore，回执经 RESPONSE 事件送回。
 * 结构化克隆约束：CustomEvent.detail 只可携带 JSON 可序列化值——函数与带原型链的对象跨 world 不可达。
 */
export function createBridgeHost(store: KVStore, eventTarget: EventTarget): () => void {
  const listener = async (ev: Event) => {
    const req = (ev as CustomEvent<BridgeRequest>).detail;
    let res: BridgeResponse;
    try {
      if (req.action === 'get') res = { id: req.id, ok: true, value: await store.get(req.key) };
      else if (req.action === 'set') { await store.set(req.key, req.value); res = { id: req.id, ok: true }; }
      else { await store.delete(req.key); res = { id: req.id, ok: true }; }
    } catch (e) {
      res = { id: req.id, ok: false, error: String(e) };
    }
    eventTarget.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: res }));
  };
  eventTarget.addEventListener(BRIDGE_REQUEST_EVENT, listener);
  return () => eventTarget.removeEventListener(BRIDGE_REQUEST_EVENT, listener);
}

/**
 * MAIN 侧桥接客户端：把 get/set/delete 经 CustomEvent detail 转发给 ISOLATED 宿主。
 * 结构化克隆约束：value 仅可传 JSON 可序列化值——函数与带原型链的对象跨 world 不可达；
 * get 超时按未命中返回 undefined，set/delete 超时抛错。
 */
export function createBridgedKVStore(eventTarget: EventTarget, timeoutMs = 3_000): KVStore {
  const pending = new Map<string, (res: BridgeResponse) => void>();
  eventTarget.addEventListener(BRIDGE_RESPONSE_EVENT, (ev) => {
    const res = (ev as CustomEvent<BridgeResponse>).detail;
    pending.get(res.id)?.(res);
    pending.delete(res.id);
  });

  function request(action: BridgeRequest['action'], key: string, value?: unknown): Promise<unknown> {
    return new Promise(resolve => {
      const id = `${Date.now()}-${Math.random()}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        // get 超时按未命中返回（安全默认）；set/delete 超时拒绝（由调用方 .catch 兜底记录）
        if (action === 'get') resolve({ id, ok: true, value: undefined });
        else resolve({ id, ok: false, error: `bridge timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      eventTarget.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: { id, action, key, value } }));
    });
  }

  return {
    async get(key) {
      const res = await request('get', key) as BridgeResponse;
      return res.value as undefined;
    },
    async set(key, value) {
      const res = await request('set', key, value) as BridgeResponse;
      if (!res.ok) throw new Error(res.error ?? 'bridge set failed');
    },
    async delete(key) {
      const res = await request('delete', key) as BridgeResponse;
      if (!res.ok) throw new Error(res.error ?? 'bridge delete failed');
    }
  };
}
