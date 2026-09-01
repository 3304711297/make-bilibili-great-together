import { createBridgeHost, createMemoryKVStore } from '@mbgt/core';

// MAIN world 无法访问 browser.storage（扩展 API 仅 ISOLATED/background 可用）：
// 此监听端把桥接请求落到 browser.storage.local；桥接初始化失败时降级内存 store（仅本页生效，status 不持久化但核心功能不受影响）
let store: import('@mbgt/core').KVStore;
try {
  // get 返回值用 any 索引签名（而非 Record<string, unknown>）：适配 KVStore.get<T> 的泛型实现赋值（tsc 零错误），运行时行为不变
  const browserApi = (globalThis as unknown as { browser?: { storage: { local: { get: (k: string | null) => Promise<{ [key: string]: any }>; set: (v: Record<string, unknown>) => Promise<void>; remove: (k: string | string[]) => Promise<void> } } } }).browser;
  if (!browserApi) throw new Error('browser.storage unavailable');
  store = {
    async get(key) { return (await browserApi.storage.local.get(key))[key]; },
    async set(key, value) { await browserApi.storage.local.set({ [key]: value }); },
    async delete(key) { await browserApi.storage.local.remove(key); }
  };
} catch {
  console.warn('[mbgt] storage bridge falling back to in-memory store');
  store = createMemoryKVStore();
}

createBridgeHost(store, window);
