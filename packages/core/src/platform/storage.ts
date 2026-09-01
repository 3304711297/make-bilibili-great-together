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

export const SETTING_CDN_PROBE = 'mbgt:cdn:probe';
export const SETTING_STATS_BADGE = 'mbgt:ui:stats-badge';

export interface WiringSettings {
  overrides: Map<string, ModuleOverride>;
  cdnProbe: boolean;
  statsBadge: boolean;
}

/**
 * 接线层设置读取（预算内失败/超时回退默认值）。
 * 裁定（2026-09-01 Plan 4）：此函数结果仅用于——deferred 模块结算门控、CDN probe 挂载、
 * 统计角标挂载；即时模块派发不等待它（document-start 语义优先）。
 */
export async function readSettingsWithBudget(
  store: KVStore,
  moduleNames: readonly string[],
  budgetMs = 300
): Promise<WiringSettings> {
  const defaults: WiringSettings = { overrides: new Map(), cdnProbe: true, statsBadge: false };
  const read = (async () => {
    const [overrides, cdnProbe, statsBadge] = await Promise.all([
      readModuleOverrides(store, moduleNames),
      store.get<boolean>(SETTING_CDN_PROBE).then(v => v ?? true),
      store.get<boolean>(SETTING_STATS_BADGE).then(v => v ?? false)
    ]);
    return { overrides, cdnProbe, statsBadge };
  })();
  // 竞速超时获胜后，read 仍可能在后完成/拒绝——附着 catch 避免 unhandled rejection
  read.catch(() => {});
  try {
    return await Promise.race([
      read,
      new Promise<WiringSettings>(resolve => setTimeout(() => resolve(defaults), budgetMs))
    ]);
  } catch {
    return defaults;
  }
}
