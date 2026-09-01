export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createMemoryKVStore(): KVStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { map.set(key, value); },
    async delete(key: string) { map.delete(key); }
  };
}

export const OVERRIDE_PREFIX = 'mbgt:override:';
export const COMPAT_STATUS_KEY = 'mbgt:compat:status';

export interface CompatStatus {
  family: 'bewly' | null;
  extensions: string[];
  generic: boolean;
  autoDisabled: { module: string; extension: string; feature: string }[];
  settledAt: number;
}

export async function readForceOnOverrides(store: KVStore, moduleNames: string[]): Promise<Set<string>> {
  const overrides = new Set<string>();
  for (const name of moduleNames) {
    const value = await store.get<string>(`${OVERRIDE_PREFIX}${name}`);
    if (value === 'force-on') overrides.add(name);
  }
  return overrides;
}
