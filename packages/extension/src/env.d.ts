// 扩展 API 的 storage.local 最小子集（MV3 promise 风格）：
// Firefox/ScriptCat 提供 browser.*，Chrome/Edge（Chromium 系）仅提供 chrome.*，
// 调用方一律 browser ?? chrome 双解析。get 泛型透传适配
// @mbgt/core KVStore.get<T> 的泛型实现赋值
interface MbgtStorageLocal {
  get<T>(key: string | string[] | null): Promise<Record<string, T>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
interface MbgtExtensionApi {
  storage: { local: MbgtStorageLocal };
}
