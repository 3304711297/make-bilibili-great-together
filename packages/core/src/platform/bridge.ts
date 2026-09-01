import type { KVStore } from './storage';
import type { ProbeFetch } from '../features/cdn-probe/probe';

export const BRIDGE_REQUEST_EVENT = 'mbgt:storage-request';
export const BRIDGE_RESPONSE_EVENT = 'mbgt:storage-response';

interface BridgeRequest { id: string; action: 'get' | 'set' | 'delete' | 'getAll' | 'probe'; key?: string; value?: unknown }
interface BridgeResponse { id: string; ok: boolean; value?: unknown; error?: string }

// pending 表提升到模块级（Plan 4 Task 6）：storage 客户端与探测客户端共用同一条 RESPONSE
// 事件通道，单一监听器按 id 同时分派两张表——store pending 优先，probePending 兜底。
// 同一 eventTarget 只挂一次监听器（WeakSet 去重），多次 createBridgedKVStore/createBridgedProbeFetch 不重复注册。
const storePending = new Map<string, (res: BridgeResponse) => void>();
const probePending = new Map<string, (res: BridgeResponse) => void>();
const responseListenerTargets = new WeakSet<EventTarget>();

function ensureResponseListener(eventTarget: EventTarget): void {
  if (responseListenerTargets.has(eventTarget)) return;
  responseListenerTargets.add(eventTarget);
  eventTarget.addEventListener(BRIDGE_RESPONSE_EVENT, (ev) => {
    const res = (ev as CustomEvent<BridgeResponse>).detail;
    storePending.get(res.id)?.(res);
    storePending.delete(res.id);
    probePending.get(res.id)?.(res);
    probePending.delete(res.id);
  });
}

/**
 * ISOLATED 侧桥接宿主：把 MAIN world 经 CustomEvent detail 传来的请求落到 KVStore，回执经 RESPONSE 事件送回。
 * 结构化克隆约束：CustomEvent.detail 只可携带 JSON 可序列化值——函数与带原型链的对象跨 world 不可达。
 * probe 动作（Plan 4 Task 6 启用）：转交第三参 probeFetch，其探测结果装在 value 里
 * ——host 端包装 ok 恒 true（语义=「请求完成」），探测成败由 value.ok 表达。
 */
export function createBridgeHost(store: KVStore, eventTarget: EventTarget, probeFetch?: ProbeFetch): () => void {
  const listener = async (ev: Event) => {
    const req = (ev as CustomEvent<BridgeRequest>).detail;
    let res: BridgeResponse;
    try {
      if (req.action === 'get') res = { id: req.id, ok: true, value: await store.get(req.key!) };
      else if (req.action === 'set') { await store.set(req.key!, req.value); res = { id: req.id, ok: true }; }
      else if (req.action === 'getAll') res = { id: req.id, ok: true, value: await store.getAll() };
      else if (req.action === 'probe' && probeFetch) res = { id: req.id, ok: true, value: await probeFetch(req.key!, Number(req.value) || 2_000) };
      else if (req.action === 'delete') { await store.delete(req.key!); res = { id: req.id, ok: true }; }
      else res = { id: req.id, ok: false, error: 'unknown action: ' + req.action };
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
  ensureResponseListener(eventTarget);

  function request(action: BridgeRequest['action'], key?: string, value?: unknown): Promise<unknown> {
    return new Promise(resolve => {
      const id = `${Date.now()}-${Math.random()}`;
      const timer = setTimeout(() => {
        storePending.delete(id);
        // get 超时按未命中返回（安全默认）；set/delete 超时拒绝（由调用方 .catch 兜底记录）
        if (action === 'get') resolve({ id, ok: true, value: undefined });
        else resolve({ id, ok: false, error: `bridge timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      storePending.set(id, (res) => {
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
    },
    async getAll() {
      const res = await request('getAll') as BridgeResponse;
      if (!res.ok) throw new Error(res.error ?? 'bridge getAll failed');
      return res.value as Record<string, unknown>;
    }
  };
}

/** MAIN 侧探测通道：经桥接发 probe 请求到 isolated 世界（其裸 fetch 未被 hook） */
export function createBridgedProbeFetch(eventTarget: EventTarget, budgetMs = 6_000): ProbeFetch {
  ensureResponseListener(eventTarget);
  return (url, timeoutMs) => new Promise(resolve => {
    const id = `${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => {
      probePending.delete(id);
      resolve({ ok: false, ms: budgetMs });
    }, budgetMs);
    probePending.set(id, (res) => {
      clearTimeout(timer);
      resolve((res.value as { ok: boolean; ms: number }) ?? { ok: false, ms: budgetMs });
    });
    eventTarget.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: { id, action: 'probe', key: url, value: timeoutMs } }));
  });
}
