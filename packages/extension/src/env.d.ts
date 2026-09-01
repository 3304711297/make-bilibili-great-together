// 扩展 API 的 storage.local 最小子集（MV3 promise 风格）：
// Firefox/ScriptCat 提供 browser.*，Chrome/Edge（Chromium 系）仅提供 chrome.*，
// 调用方一律 browser ?? chrome 双解析。get 返回值取 any 索引签名以适配
// @mbgt/core KVStore.get<T> 的泛型实现赋值（no-explicit-any 仅 warn 不阻断）
interface MbgtStorageLocal {
  get(key: string | string[] | null): Promise<{ [key: string]: any }>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
interface MbgtExtensionApi {
  storage: { local: MbgtStorageLocal };
}
