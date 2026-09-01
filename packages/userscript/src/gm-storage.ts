import type { KVStore } from '@mbgt/core';

// GM_* 异步 storage API → KVStore 适配：entry 的 compat 状态落盘、override 读取与旧键迁移
// 均经由该实现（meta 已 @grant GM.getValue / GM.setValue / GM.deleteValue / GM.listValues）。
export function createGMKVStore(): KVStore {
  return {
    async get<T>(key: string) { return await GM.getValue<T>(key); },
    async set<T>(key: string, value: T) { await GM.setValue(key, value); },
    async delete(key: string) { await GM.deleteValue(key); },
    async getAll() {
      const keys = await GM.listValues();
      return Object.fromEntries(await Promise.all(keys.map(async k => [k, await GM.getValue(k)] as const)));
    }
  };
}
