// 扩展页面上下文的 browser.* 全局（MV3 options 页直接访问 browser.storage.local）：
// 仅声明 isolated-entry / options 页用到的最小子集（get 返回值取 any 索引签名，
// 以适配 @mbgt/core KVStore.get<T> 的泛型实现赋值，no-explicit-any 仅 warn 不阻断）。
// isolated-entry 经 globalThis 显式取用同一形状，不依赖此处的全局声明可见性
declare const browser: {
  storage: {
    local: {
      get(key: string | string[] | null): Promise<{ [key: string]: any }>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
};
