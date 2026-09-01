export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** 导入/导出与迁移需要全量键值；无权限/无实现时抛错由调用方兜底 */
  getAll(): Promise<Record<string, unknown>>;
}

export function createMemoryKVStore(): KVStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { map.set(key, value); },
    async delete(key: string) { map.delete(key); },
    async getAll() { return Object.fromEntries(map.entries()); }
  };
}

/** 模块 override 三值语义（Plan 4 统一）：缺省=on；'off'=用户关闭；'force-on'=用户强制开启（压过共存自动停用） */
export type ModuleOverride = 'on' | 'off' | 'force-on';

export const OVERRIDE_PREFIX = 'mbgt:override:';
export const COMPAT_STATUS_KEY = 'mbgt:compat:status';
export const STORAGE_VERSION_KEY = 'mbgt:config:version';
/** v2：mbgt:enabled:* 布尔键迁移为 mbgt:override:* 三值键（userscript 旧菜单遗留） */
export const STORAGE_VERSION = 2;

export interface CompatStatus {
  family: 'bewly' | null;
  extensions: string[];
  generic: boolean;
  autoDisabled: { module: string; extension: string; feature: string }[];
  settledAt: number;
}

export async function readModuleOverrides(store: KVStore, moduleNames: readonly string[]): Promise<Map<string, ModuleOverride>> {
  const map = new Map<string, ModuleOverride>();
  const all = await store.getAll();
  for (const name of moduleNames) {
    const v = all[`${OVERRIDE_PREFIX}${name}`];
    if (v === 'off' || v === 'force-on') map.set(name, v);
  }
  return map;
}

export async function migrateLegacyEnabledKeys(store: KVStore): Promise<void> {
  try {
    if ((await store.get<number>(STORAGE_VERSION_KEY)) === STORAGE_VERSION) return;
    const all = await store.getAll();
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith('mbgt:enabled:')) continue;
      const name = key.slice('mbgt:enabled:'.length);
      if (value === false) await store.set(`${OVERRIDE_PREFIX}${name}`, 'off');
      await store.delete(key);
    }
    await store.set(STORAGE_VERSION_KEY, STORAGE_VERSION);
  } catch {
    // 迁移失败不阻断启动（降级原则）
  }
}
