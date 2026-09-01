import { createBridgeHost, createMemoryKVStore } from '@mbgt/core';
import { createExtensionProbeFetch } from './probe-fetch';

// MAIN world 无法访问扩展 storage API（仅 ISOLATED/background 可用）：
// 此监听端把桥接请求落到扩展 storage.local。命名空间双解析 browser ?? chrome——
// Edge（Chromium 系）不提供 browser.*（Firefox promise 风格命名空间），仅 chrome.*；
// 两者都缺时降级内存 store（仅本页生效，status 不持久化但核心功能不受影响）
let store: import('@mbgt/core').KVStore;
try {
  const browserApi = (globalThis as unknown as { browser?: MbgtExtensionApi; chrome?: MbgtExtensionApi }).browser
    ?? (globalThis as unknown as { chrome?: MbgtExtensionApi }).chrome;
  if (!browserApi) throw new Error('browser/chrome storage unavailable');
  store = {
    async get(key) { return (await browserApi.storage.local.get(key))[key]; },
    async set(key, value) { await browserApi.storage.local.set({ [key]: value }); },
    async delete(key) { await browserApi.storage.local.remove(key); },
    async getAll() { return await browserApi.storage.local.get(null); }
  };
} catch {
  console.warn('[mbgt] storage bridge falling back to in-memory store');
  store = createMemoryKVStore();
}

// probe 通道挂载：MAIN world 的探测请求经桥接落到本世界的裸 fetch（未被 no-p2p hook 改写）
createBridgeHost(store, window, createExtensionProbeFetch());
