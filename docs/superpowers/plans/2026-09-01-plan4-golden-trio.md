# Plan 4：三个点睛功能（CDN 智能选优 → 拦截统计 → 设置+共存面板）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的双形态骨架（Plan 1–3）上落地 spec §4 的三个点睛功能：CDN 智能选优（延迟探测+失败换源）、拦截统计看板（角标+归因计数+DNR 汇总）、设置+共存面板（Preact，userscript 浮层 + 扩展 options 页），并把模块开关语义统一为 `mbgt:override:*` 三值。

**Architecture:** 全部新功能放进 `packages/core/src/features/`（stats / cdn-probe / panel），接线层（userscript entry 与 extension main-entry）负责读设置、创建探测实例、挂载 UI——遵循 2026-09-01 treeshake ruling：**不做模块内部的运行时开关，开关一律是接线层传参/过滤**。统计收集始终开启（成本极低），仅展示（角标/面板）默认关闭。

**Tech Stack:** TypeScript + Vitest（core 单测，新增 happy-dom 环境做 DOM 测试）+ Preact（~4KB gzip，进 core 依赖，userscript 与 extension options 双端打包）。

**Spec:** `docs/superpowers/specs/2026-08-30-make-bilibili-great-together-design.md`（§4 点睛功能、§5 存储与降级、§6 测试与发布）

## Global Constraints

- 所有存储键统一 `mbgt:` 前缀（spec §5）
- 模块 override 语义统一为三值：`'on' | 'off' | 'force-on'`（默认缺省=on）；旧键 `mbgt:enabled:*` 需一次性迁移（spec §5 版本迁移）
- 降级原则：统计/面板/探测任何一环崩溃只吞错+日志，绝不影响核心拦截（spec §5）
- CDN 候选排除无有效 SSL 的 `upos-sz-mirror14b.bilivideo.com`（spec §4.1；该域已在 `knownP2pCdnDomainPattern`，收集镜像宿主时天然排除）
- 探测：每候选 2s 超时，结果缓存 5min，全败回退上游随机策略（spec §4.1）
- 统计：内存累积，每 30s 或页面隐藏/卸载时落盘一次（spec §4.2）
- 统计角标与面板展示默认关闭（`mbgt:ui:stats-badge`，面板本身始终有入口角标）
- 每任务完成判定：`pnpm --filter @mbgt/core test` 全绿 + 三包 `npx tsc --noEmit` 零错误；提交信息中文；push 走代理 `git -c http.proxy=http://127.0.0.1:3067 push`
- pnpm 命令一律在仓库根 `C:\Users\VOS-User\Desktop\make-bilibili-great-together` 执行
- 不引入模块内运行时布尔开关（treeshake ruling 2026-09-01，见 `.superpowers/sdd/2026-09-01-plan3-extension/progress.md`）
- 扩展形态 document-start 语义优先：即时模块（无 conflicts 的 9 个）在扩展形态**不提供关闭开关**（接线层异步读设置赶不上页面内联脚本执行，见 Task 1 说明）；userscript 形态因 GM 同步读取可全量开关

---

### Task 1: 存储语义统一（override 三值 + getAll + 版本迁移）

**Files:**
- Modify: `packages/core/src/platform/storage.ts`
- Modify: `packages/core/src/platform/bridge.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/platform-storage.test.ts`
- Modify: `packages/core/tests/platform-bridge.test.ts`
- Modify: `packages/core/tests/compat-e2e.test.ts`（`readForceOnOverrides` 引用改 `readModuleOverrides` 派生）
- Modify: `packages/userscript/src/module-menu.ts`
- Modify: `packages/userscript/src/entry.ts`（仅换 import 与迁移调用）
- Modify: `packages/extension/src/main-entry.ts`（仅换 import 与派生集合）
- Modify: `packages/extension/src/isolated-entry.ts`

**Interfaces:**
- Consumes: 现有 `KVStore`、`OVERRIDE_PREFIX`、`createBridgeHost`、`createBridgedKVStore`
- Produces（后续任务依赖的精确签名）:
  - `KVStore` 新增 `getAll(): Promise<Record<string, unknown>>`
  - `type ModuleOverride = 'on' | 'off' | 'force-on'`
  - `readModuleOverrides(store: KVStore, moduleNames: readonly string[]): Promise<Map<string, ModuleOverride>>`（替代 `readForceOnOverrides`，后者删除）
  - `migrateLegacyEnabledKeys(store: KVStore): Promise<void>`；`STORAGE_VERSION_KEY = 'mbgt:config:version'`；`STORAGE_VERSION = 2`
  - 桥接协议新增 action `'getAll'`

- [ ] **Step 1: 写失败测试（storage 语义 + 迁移）**

在 `packages/core/tests/platform-storage.test.ts` 追加（保留既有用例，删除断言 `readForceOnOverrides` 的用例，改为新语义）；**`packages/core/tests/compat-e2e.test.ts` 第 4 行与第 72 行同样 import 了 `readForceOnOverrides`——第 4 行 import 改为 `readModuleOverrides`，第 72 行改为：**

```ts
    const overrides = await readModuleOverrides(store, deferred.map(m => m.name));
    const forceOnOverrides = new Set([...overrides.entries()].filter(([, v]) => v === 'force-on').map(([n]) => n));
```

（其后把 `forceOnOverrides` 传给 `resolveConflicts` 的第 4 实参——该测试文件内既有调用点按形参位置替换，断言语义不变：force-on 仍压过自动停用。）

```ts
import { describe, it, expect } from 'vitest';
import {
  createMemoryKVStore, readModuleOverrides, migrateLegacyEnabledKeys,
  OVERRIDE_PREFIX, STORAGE_VERSION_KEY, STORAGE_VERSION
} from '../src/platform/storage';

describe('readModuleOverrides（三值语义）', () => {
  it('off / force-on 记录，缺省与 on 不记录', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}a`, 'off');
    await store.set(`${OVERRIDE_PREFIX}b`, 'force-on');
    await store.set(`${OVERRIDE_PREFIX}c`, 'on');
    const map = await readModuleOverrides(store, ['a', 'b', 'c', 'd']);
    expect(map.get('a')).toBe('off');
    expect(map.get('b')).toBe('force-on');
    expect(map.has('c')).toBe(false);
    expect(map.has('d')).toBe(false);
  });
});

describe('migrateLegacyEnabledKeys', () => {
  it('mbgt:enabled:false → override off 并删旧键；已迁移则跳过', async () => {
    const store = createMemoryKVStore();
    await store.set('mbgt:enabled:no-ad', false);
    await store.set('mbgt:enabled:defuse-spyware', true);
    await migrateLegacyEnabledKeys(store);
    expect(await store.get(`${OVERRIDE_PREFIX}no-ad`)).toBe('off');
    expect(await store.get('mbgt:enabled:no-ad')).toBe(undefined);
    expect(await store.get('mbgt:enabled:defuse-spyware')).toBe(undefined);
    expect(await store.get(STORAGE_VERSION_KEY)).toBe(STORAGE_VERSION);
    // 幂等：二次运行不再改动
    await store.set('mbgt:enabled:x', false);
    await migrateLegacyEnabledKeys(store);
    expect(await store.get('mbgt:enabled:x')).toBe(false);
  });
});

describe('KVStore.getAll', () => {
  it('memory store 返回全量键值', async () => {
    const store = createMemoryKVStore();
    await store.set('mbgt:a', 1);
    await store.set('other', 2);
    expect(await store.getAll()).toEqual({ 'mbgt:a': 1, other: 2 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/platform-storage.test.ts`
Expected: FAIL（`readModuleOverrides` 等导出不存在）

- [ ] **Step 3: 实现 storage.ts**

`packages/core/src/platform/storage.ts` 全量替换为：

```ts
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
```

- [ ] **Step 4: 桥接协议加 getAll**

`packages/core/src/platform/bridge.ts`：`BridgeRequest` 的 action 联合类型改为 `'get' | 'set' | 'delete' | 'getAll' | 'probe'`（probe 本计划 Task 6 启用，此处先扩枚举注释即可，行为分支 Task 6 补）；`createBridgeHost` 监听器新增分支：

```ts
if (req.action === 'getAll') res = { id: req.id, ok: true, value: await store.getAll() };
```

`createBridgedKVStore` 返回对象新增：

```ts
async getAll() {
  const res = await request('getAll') as BridgeResponse;
  if (!res.ok) throw new Error(res.error ?? 'bridge getAll failed');
  return res.value as Record<string, unknown>;
}
```

在 `packages/core/tests/platform-bridge.test.ts` 追加用例：

```ts
it('getAll 经桥接往返', async () => {
  // 沿用该文件既有 fake-host 模式：host 落 memory store，client 走 eventTarget
  const { createBridgeHost, createBridgedKVStore, createMemoryKVStore } = await import('../src/platform/bridge');
  const store = createMemoryKVStore();
  await store.set('mbgt:a', 1);
  const et = new EventTarget();
  createBridgeHost(store, et);
  const client = createBridgedKVStore(et);
  expect(await client.getAll()).toEqual({ 'mbgt:a': 1 });
});
```

- [ ] **Step 5: 三端接线更新（编译级适配）**

- `packages/core/src/index.ts`：导出行把 `readForceOnOverrides` 换成 `readModuleOverrides`，并新增导出 `migrateLegacyEnabledKeys, STORAGE_VERSION_KEY, STORAGE_VERSION, type ModuleOverride`。
- `packages/userscript/src/module-menu.ts`：`getModuleEnabledSync` 改读 override 键：

```ts
import { OVERRIDE_PREFIX } from '@mbgt/core';

// document-start 同步判定：缺省 / 'on' / 'force-on' 均启用；'off' 关闭
export function getModuleEnabledSync(name: string): boolean {
  return GM_getValue(`${OVERRIDE_PREFIX}${name}`) !== 'off';
}
```

`initModuleMenu` 的切换回调改为：

```ts
GM_setValue(`${OVERRIDE_PREFIX}${mod.name}`, getModuleEnabledSync(mod.name) ? 'off' : 'on');
```

（菜单只做 on↔off 循环；force-on 只能由面板设置，见 Task 9。若文件中还有 `isModuleEnabled` 读 `mbgt:enabled:` 的残留，一并改为读 override 键或删除。）
- `packages/userscript/src/entry.ts`：`readForceOnOverrides` 换为 `readModuleOverrides`，并在文件最前（menu 注册之前）调用迁移（GM store 异步）：

```ts
await migrateLegacyEnabledKeys(store);
```

entry 顶层需包成 async IIFE（若还不是）。deferred 结算处的 `readForceOnOverrides(store, names)` 调用改为：

```ts
const overrides = await readModuleOverrides(store, deferred.map(m => m.name));
const forceOn = new Set([...overrides.entries()].filter(([, v]) => v === 'force-on').map(([n]) => n));
const menuDisabledNames = new Set([...overrides.entries()].filter(([, v]) => v === 'off').map(([n]) => n));
const { enabled, autoDisabled } = resolveConflicts(deferred, probe, menuDisabledNames, forceOn);
```

- `packages/extension/src/main-entry.ts`：同样把结算链改为 `readModuleOverrides` 派生 `forceOn`（extension 无菜单，`menuDisabledNames` 传空 Set）。
- `packages/extension/src/isolated-entry.ts`：chrome storage 的 store 实现补 `getAll`：

```ts
async getAll() { return await browserApi.storage.local.get(null); }
```

- [ ] **Step 6: 全测试 + 三包 tsc**

Run: `cd packages/core && npx vitest run`；随后根目录 `(cd packages/core && npx tsc --noEmit) && (cd packages/userscript && npx tsc --noEmit) && (cd packages/extension && npx tsc --noEmit)`
Expected: 全绿、零错误

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "重构：模块开关统一为 mbgt:override 三值语义 + KVStore.getAll + 旧键迁移"

```

---

### Task 2: 拦截统计注册表（会话计数 + 30s/隐藏节流落盘）

**Files:**
- Create: `packages/core/src/features/stats/registry.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/stats-registry.test.ts`

**Interfaces:**
- Consumes: `KVStore`
- Produces:
  - `STATS_KEY = 'mbgt:stats:counters'`
  - `interface StatsPayload { counts: Record<string, number>; flushedAt: number }`
  - `recordInterception(kind: string, count?: number): void`
  - `onInterception(listener: (kind: string, count: number) => void): () => void`
  - `sessionCounts(): Record<string, number>`
  - `flushStats(store: KVStore): Promise<void>`；`startStatsFlush(store: KVStore, intervalMs?: number): { stop(): void }`
  - `readStats(store: KVStore): Promise<StatsPayload>`
  - 统计 kind 契约（面板展示用，Task 3 埋点 + Task 4 DNR 沿用）：`beacon / spyware-fetch / spyware-xhr / storage-defused / p2p-replaced / rtc-mocked / av1-blocked`，DNR 归因独立键（Task 4）

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/stats-registry.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordInterception, sessionCounts, onInterception, flushStats,
  readStats, startStatsFlush, STATS_KEY
} from '../src/features/stats/registry';
import { createMemoryKVStore } from '../src/platform/storage';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('stats registry', () => {
  it('recordInterception 累计会话计数并广播监听器', () => {
    const seen: [string, number][] = [];
    const off = onInterception((kind, n) => seen.push([kind, n]));
    recordInterception('beacon');
    recordInterception('beacon', 3);
    expect(sessionCounts()).toEqual({ beacon: 4 });
    expect(seen).toEqual([['beacon', 1], ['beacon', 3]]);
    off();
    recordInterception('beacon');
    expect(seen).toHaveLength(2);
  });

  it('flushStats 落盘增量并合入既有持久值（跨会话累加）', async () => {
    const store = createMemoryKVStore();
    await store.set(STATS_KEY, { counts: { beacon: 10 }, flushedAt: 1 });
    recordInterception('beacon'); // 本会话 1
    await flushStats(store);
    const stored = await readStats(store);
    expect(stored.counts.beacon).toBe(11);
    // 同一会话重复 flush 不重复累加（flushedBaseline 机制）
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(11);
    recordInterception('beacon', 2);
    await flushStats(store);
    expect((await readStats(store)).counts.beacon).toBe(13);
  });

  it('startStatsFlush：30s 定时落盘 + pagehide 立即落盘；store 抛错被吞', async () => {
    const store = createMemoryKVStore();
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('boom'));
    recordInterception('av1-blocked');
    const { stop } = startStatsFlush(store, 30_000);
    window.dispatchEvent(new Event('pagehide')); // pagehide flush，set 抛错被吞不炸
    await vi.advanceTimersByTimeAsync(30_000); // 定时 flush
    expect((await readStats(store)).counts['av1-blocked']).toBe(1);
    stop();
    recordInterception('p2p-replaced');
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await readStats(store)).counts['p2p-replaced']).toBe(undefined); // stop 后不再落盘
  });

  it('readStats 无存储返回零值', async () => {
    expect(await readStats(createMemoryKVStore())).toEqual({ counts: {}, flushedAt: 0 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/stats-registry.test.ts`
Expected: FAIL（模块不存在；happy-dom 未安装时先执行 Step 3 的依赖安装再跑一次以确认报错形态，见下）

- [ ] **Step 3: 安装依赖并实现 registry**

```bash
cd /c/Users/VOS-User/Desktop/make-bilibili-great-together
pnpm --filter @mbgt/core add -D happy-dom
pnpm --filter @mbgt/core add preact
```

Create `packages/core/src/features/stats/registry.ts`：

```ts
// 拦截统计注册表（spec §4.2）：会话内存累积，30s/隐藏节流落盘，跨会话累加。
// 收集始终开启（成本极低）；展示（角标/面板）默认关闭——由接线层按设置挂载。
// 降级原则：落盘/监听器任何异常被吞，绝不影响拦截路径。
import type { KVStore } from '../../platform/storage';

export const STATS_KEY = 'mbgt:stats:counters';

export interface StatsPayload {
  counts: Record<string, number>;
  flushedAt: number;
}

const session: Record<string, number> = {};
let flushedBaseline: Record<string, number> = {};
const listeners = new Set<(kind: string, count: number) => void>();

export function recordInterception(kind: string, count = 1): void {
  session[kind] = (session[kind] ?? 0) + count;
  for (const l of listeners) {
    try { l(kind, count); } catch { /* 监听器异常不影响拦截 */ }
  }
}

export function onInterception(listener: (kind: string, count: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function sessionCounts(): Record<string, number> {
  return { ...session };
}

export async function flushStats(store: KVStore): Promise<void> {
  try {
    const stored = await store.get<StatsPayload>(STATS_KEY);
    const storedCounts = stored?.counts ?? {};
    let dirty = false;
    const merged: Record<string, number> = { ...storedCounts };
    for (const [kind, n] of Object.entries(session)) {
      const delta = n - (flushedBaseline[kind] ?? 0);
      if (delta > 0) {
        merged[kind] = (merged[kind] ?? 0) + delta;
        dirty = true;
      }
    }
    if (!dirty && stored) return; // 无增量不写
    flushedBaseline = { ...session };
    await store.set(STATS_KEY, { counts: merged, flushedAt: Date.now() });
  } catch {
    // 落盘失败不影响统计收集
  }
}

export function startStatsFlush(store: KVStore, intervalMs = 30_000): { stop(): void } {
  const timer = setInterval(() => { void flushStats(store); }, intervalMs);
  const onPageHide = () => { void flushStats(store); };
  addEventListener('pagehide', onPageHide);
  return {
    stop() {
      clearInterval(timer);
      removeEventListener('pagehide', onPageHide);
    }
  };
}

export async function readStats(store: KVStore): Promise<StatsPayload> {
  return (await store.get<StatsPayload>(STATS_KEY)) ?? { counts: {}, flushedAt: 0 };
}
```

`packages/core/src/index.ts` 追加导出：

```ts
export {
  STATS_KEY, recordInterception, onInterception, sessionCounts,
  flushStats, startStatsFlush, readStats, type StatsPayload
} from './features/stats/registry';
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && npx vitest run tests/stats-registry.test.ts`
Expected: PASS（4 用例）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 拦截统计注册表（会话计数 + 30s/pagehide 节流落盘 + 跨会话累加）"

```

---

### Task 3: 统计埋点接入（5 个模块的拦截点计数）

**Files:**
- Modify: `packages/core/src/modules/defuse-spyware.ts`
- Modify: `packages/core/src/modules/defuse-storage.ts`
- Modify: `packages/core/src/modules/no-p2p.ts`
- Modify: `packages/core/src/modules/no-webtrc.ts`
- Modify: `packages/core/src/modules/disable-av1.ts`
- Test: `packages/core/tests/stats-instrument.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `recordInterception`（kind 契约见 Task 2）
- Produces: 无新导出；埋点语义（后续面板文案依赖）：
  - `beacon`：`navigator.sendBeacon` 假实现被调用
  - `spyware-fetch` / `spyware-xhr`：上报 URL 被 fetch/XHR 钩子拦掉
  - `storage-defused`：被 mock 的 localStorage 写入/读取/删除命中 `defusedPattern`
  - `p2p-replaced`：`getReplacementCdnUrl` 实际改写了 URL
  - `rtc-mocked`：mock 的 `RTCPeerConnection` 被实例化
  - `av1-blocked`：canPlayType / isTypeSupported 对 av01 返回拦截结果

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/stats-instrument.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import { getDefaultModules } from '../src/modules';
import { recordInterception, sessionCounts } from '../src/features/stats/registry';
import { createLogger } from '../src/logger';

const logger = createLogger(console);

beforeAll(() => {
  // 单全局域最小 stub（与 modules.test.ts 同策略，但用 happy-dom 真对象）
  (globalThis as any).unsafeWindow = globalThis;
  (globalThis as any).indexedDB = { databases: async () => [], open: () => ({}) };
  (globalThis as any).MediaSource = class { static isTypeSupported(type: string) { return type.includes('avc'); } };
  (globalThis as any).CSSStyleSheet = class { replaceSync() {} };
});

function spyHook() {
  return {
    addStyle: () => {}, onBeforeFetch: () => {}, onResponse: () => {},
    onXhrOpen: () => {}, onAfterXhrOpen: () => {}, onXhrResponse: () => {},
    onlyCallOnce: (fn: () => void) => fn()
  } as any;
}

it('disable-av1：av01 canPlayType 计入 av1-blocked', () => {
  const before = sessionCounts()['av1-blocked'] ?? 0;
  const mod = getDefaultModules(logger).find(m => m.name === 'disable-av1')!;
  mod.any?.(spyHook());
  expect(document.createElement('video').canPlayType('video/mp4; codecs="av01.0.05M.08"')).toBe('');
  expect(sessionCounts()['av1-blocked']).toBe(before + 1);
});

it('defuse-spyware：sendBeacon 假实现计入 beacon', () => {
  const before = sessionCounts()['beacon'] ?? 0;
  const mod = getDefaultModules(logger).find(m => m.name === 'defuse-spyware')!;
  mod.any?.(spyHook());
  expect((globalThis as any).navigator.sendBeacon('https://data.bilibili.com/x', 'p')).toBe(true);
  expect(sessionCounts()['beacon']).toBe(before + 1);
});

it('no-p2p：替换 URL 计入 p2p-replaced，未改写不计', () => {
  const mod = getDefaultModules(logger).find(m => m.name === 'no-p2p')!;
  mod.any?.(spyHook());
  const before = sessionCounts()['p2p-replaced'] ?? 0;
  // 经 HTMLMediaElement.src setter 注入一个 mcdn 类型 URL（必被改写）
  const v = document.createElement('video');
  v.src = 'https://xy.mcdn.bilivideo.com:4483/v1/resource/41118074799/x/x.m4s?xyz=1';
  expect(sessionCounts()['p2p-replaced']).toBe(before + 1);
});
```

说明：`no-p2p` 用例依赖 `createCDNUtil` 对 mcdn URL 的改写路径（`mCdnTfRegex` 命中 → proxy 包裹，返回值必不等于原 URL）。若该用例在实现前断言失败形态不是"计数差 0"，先按 Step 2 只确认 import 失败。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/stats-instrument.test.ts`
Expected: FAIL（计数差为 0 的断言失败）

- [ ] **Step 3: 五处埋点（精确 diff）**

1. `defuse-spyware.ts`：文件头加 `import { recordInterception } from '../features/stats/registry';`
   - `defineReadonlyProperty(unsafeWindow.navigator, 'sendBeacon', trueFn);` 替换为：

```ts
      defineReadonlyProperty(unsafeWindow.navigator, 'sendBeacon', () => {
        recordInterception('beacon');
        return true;
      });
```

   - `onBeforeFetch` 内 `if (typeof url === 'string' && shouldDefuseUrl(url)) {` 分支改为：

```ts
        if (typeof url === 'string' && shouldDefuseUrl(url)) {
          recordInterception('spyware-fetch');
          return new Response();
        };
```

   - `onXhrOpen` 内 `if (shouldDefuseUrl(url)) {` 分支改为：

```ts
        if (shouldDefuseUrl(url)) {
          recordInterception('spyware-xhr');
          return null;
        }
```

2. `defuse-storage.ts`：文件头加同上 import。`mockedLocalStorage` 的三个 defused 分支各加一行（在 `logger.info(...)` 之前或之后均可，保持在该分支内）：
   - `setItem` defused 分支：`recordInterception('storage-defused');`
   - `getItem` defused 分支：`recordInterception('storage-defused');`
   - `removeItem` defused 分支：`recordInterception('storage-defused');`

3. `no-p2p.ts`：文件头加同上 import；工厂内 `const cdnUtil = createCDNUtil(logger);` 之后加包装器：

```ts
  // 统计埋点：只在 URL 实际被改写时计数（包装不改变替换语义与错误路径）
  const replaceCdnUrl = (url: string | URL, meta: string): string => {
    const out = cdnUtil.getReplacementCdnUrl(url, meta);
    try {
      if (out !== (typeof url === 'string' ? url : url.href)) recordInterception('p2p-replaced');
    } catch { /* 统计不影响替换 */ }
    return out;
  };
```

   并把模块内 4 处 `cdnUtil.getReplacementCdnUrl(...)` 直接调用（`HTMLMediaElement.prototype.src` setter、`onXhrOpen`、`onBeforeFetch` 字符串分支、`onBeforeFetch` Request 分支）替换为 `replaceCdnUrl(...)`（参数不变；Request 分支保持 `new Request(replaceCdnUrl(input.url, 'fetch'), input)`）。

4. `no-webtrc.ts`：文件头加同上 import；`MockRTCPeerConnection` 类体最前（`createDataChannel` 之前）加：

```ts
    constructor() {
      recordInterception('rtc-mocked');
    }
```

5. `disable-av1.ts`：文件头加同上 import；两处 av01 分支（canPlayType 与 isTypeSupported）在 `onlyCallOnce(...)` 行后各加 `recordInterception('av1-blocked');`。

- [ ] **Step 4: 运行确认通过 + 既有测试无回归**

Run: `cd packages/core && npx vitest run`
Expected: 全绿（含 modules.test 既有断言；`sendBeacon()` 恒真语义不变所以该用例仍过）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 五模块拦截点统计埋点（beacon/spyware/storage/p2p/rtc/av1）"

```

---

### Task 4: 扩展 background DNR 统计 + manifest 扩容（host_permissions/后台/反馈权限）

**Files:**
- Create: `packages/core/src/features/stats/dnr.ts`
- Create: `packages/extension/src/background-entry.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/extension/src/manifest.json`
- Modify: `packages/extension/rollup.config.mjs`
- Test: `packages/core/tests/stats-dnr.test.ts`（新建）
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 无（独立纯函数）
- Produces:
  - `DNR_STATS_KEY = 'mbgt:stats:dnr'`；`interface DnrStatsPayload { counts: Record<string, number>; updatedAt: number }`
  - `mergeDnrCounts(storedCounts, baseline, sessionCounts): Record<string, number>`（background 重启后防重复累加）
  - manifest 新字段：`background.service_worker = 'background.js'`；permissions += `declarativeNetRequestFeedback`；host_permissions += `*://*.bilivideo.com/*`（后者供 Task 6 的探测通道使用）
  - `ProbeFetch` 类型与 `probe-fetch.ts` 在 Task 6 落地（保证本任务提交可编译）

- [ ] **Step 1: 写失败测试（merge 纯函数 + ProbeFetch 超时语义）**

Create `packages/core/tests/stats-dnr.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mergeDnrCounts } from '../src/features/stats/dnr';

describe('mergeDnrCounts', () => {
  it('持久值 + 本会话增量（扣 baseline 防后台重启重复累加）', () => {
    expect(mergeDnrCounts({ defuse_report: 100 }, { defuse_report: 3 }, { defuse_report: 7 })).toEqual({ defuse_report: 104 });
  });
  it('新键从 0 起算', () => {
    expect(mergeDnrCounts({}, {}, { defuse_report: 5 })).toEqual({ defuse_report: 5 });
  });
  it('会话计数低于 baseline（异常）不产生负数', () => {
    const r = mergeDnrCounts({ defuse_report: 10 }, { defuse_report: 8 }, { defuse_report: 5 });
    expect(r.defuse_report).toBe(10);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/stats-dnr.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 dnr.ts + background-entry.ts**

Create `packages/core/src/features/stats/dnr.ts`：

```ts
// 扩展 DNR 命中统计（spec §4.2：background 汇总后由 content 侧读取）。
// onRuleMatchedDebug 仅解压加载（unpacked）可用且需 declarativeNetRequestFeedback——
// 本项目分发模型（Releases zip → 用户加载解压缩的扩展）满足；API 缺失时 background 静默跳过。
export const DNR_STATS_KEY = 'mbgt:stats:dnr';

export interface DnrStatsPayload {
  counts: Record<string, number>;
  updatedAt: number;
}

export function mergeDnrCounts(
  storedCounts: Record<string, number>,
  baseline: Record<string, number>,
  sessionCounts: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...storedCounts };
  for (const [key, n] of Object.entries(sessionCounts)) {
    const delta = Math.max(0, n - (baseline[key] ?? 0));
    merged[key] = (merged[key] ?? 0) + delta;
  }
  return merged;
}
```

`packages/core/src/index.ts` 追加：

```ts
export { DNR_STATS_KEY, mergeDnrCounts, type DnrStatsPayload } from './features/stats/dnr';
```

（本任务不导出 `ProbeFetch`——该类型由 Task 5 在 `features/cdn-probe/probe.ts` 定义并导出，避免引用尚未创建的文件导致本任务提交不可编译。）

Create `packages/extension/src/background-entry.ts`：

```ts
import { DNR_STATS_KEY, mergeDnrCounts, type DnrStatsPayload } from '@mbgt/core';

// browser ?? chrome 双解析：Edge（Chromium 系）仅 chrome.*（与 isolated-entry 同策略）
type MbgtApi = {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  declarativeNetRequest?: { onRuleMatchedDebug?: { addListener(cb: (info: unknown) => void): void } };
};
const api = (globalThis as unknown as { browser?: MbgtApi; chrome?: MbgtApi }).browser
  ?? (globalThis as unknown as { chrome?: MbgtApi }).chrome;

try {
  const dnr = api?.declarativeNetRequest;
  if (!api || !dnr?.onRuleMatchedDebug) throw new Error('declarativeNetRequest.onRuleMatchedDebug unavailable');
  // info 形态：{ request: { url }, rule: { ruleIds: number[] } }
  type MatchedInfo = { rule?: { ruleIds?: number[] } };
  const session: Record<string, number> = {};
  let baseline: Record<string, number> = {};
  let lastWrite = 0;

  dnr.onRuleMatchedDebug.addListener((raw) => {
    try {
      const info = raw as MatchedInfo;
      const id = String(info.rule?.ruleIds?.[0] ?? 'unknown');
      session[id] = (session[id] ?? 0) + 1;
      const now = Date.now();
      if (now - lastWrite < 30_000) return; // 30s 节流写盘
      lastWrite = now;
      void (async () => {
        const stored = await api.storage.local.get(DNR_STATS_KEY);
        const storedCounts = (stored[DNR_STATS_KEY] as DnrStatsPayload | undefined)?.counts ?? {};
        const counts = mergeDnrCounts(storedCounts, baseline, session);
        baseline = { ...session };
        await api.storage.local.set({ [DNR_STATS_KEY]: { counts, updatedAt: now } });
      })().catch(() => { /* 落盘失败不影响后续计数 */ });
    } catch { /* 事件解析异常忽略 */ }
  });
} catch (e) {
  console.warn('[mbgt] dnr stats unavailable:', e);
}
```

（`packages/extension/src/probe-fetch.ts` 移到 Task 6 创建——本任务不引入 `ProbeFetch` 类型，保证提交可编译。）

- [ ] **Step 4: manifest 与构建配置**

`packages/extension/src/manifest.json` 全量替换为（注意 permissions 与 host_permissions 的增量、新增 background；version 保持 0.1.0，版本号统一在 Task 11 提升）：

```json
{
  "manifest_version": 3,
  "name": "Make Bilibili Great Together",
  "version": "0.1.0",
  "minimum_chrome_version": "111",
  "description": "接手 Make Bilibili Great Than Ever Before：反跟踪、反 PCDN/P2P、CDN 选优，与 BewlyCat/AveMujica 共存感知",
  "permissions": [
    "storage",
    "declarativeNetRequest",
    "declarativeNetRequestFeedback"
  ],
  "host_permissions": [
    "*://*.bilibili.com/*",
    "*://*.bilivideo.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "defuse_report",
        "enabled": true,
        "path": "rules.json"
      }
    ]
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.bilibili.com/*",
        "https://t.bilibili.com/*",
        "https://live.bilibili.com/*",
        "https://space.bilibili.com/*"
      ],
      "js": ["isolated.js"],
      "run_at": "document_start"
    },
    {
      "matches": [
        "https://www.bilibili.com/*",
        "https://t.bilibili.com/*",
        "https://live.bilibili.com/*",
        "https://space.bilibili.com/*"
      ],
      "js": ["main.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

`packages/extension/rollup.config.mjs` 的 default 导出数组追加一项：

```js
  { input: 'src/background-entry.ts', output: { file: 'dist/background.js', format: 'iife', sourcemap: false }, plugins },
```

`packages/extension/scripts/build-extension.mjs` 的复制清单加 `background.js` 不可行（background 是 rollup 产物非静态文件）——确认无需改动该脚本；但 zip 由 `make-zip.mjs` 从 dist 打包，自动包含。

`.github/workflows/ci.yml` 的「扩展产物断言」块追加一行：

```yaml
          test -f packages/extension/dist/background.js
```

- [ ] **Step 5: 运行确认通过 + 全套构建验证**

Run: `cd packages/core && npx vitest run tests/stats-dnr.test.ts`
Expected: PASS（3 用例）
Run: 根目录 `pnpm build`（三包全量构建，确认 background.js 进入 dist 与 zip；此处若 pnpm build 脚本未聚合三包，则分别 `pnpm --filter @mbgt/userscript build && pnpm --filter @mbgt/extension build`）
Expected: 构建成功，`dist/background.js` 存在

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 扩展 background DNR 命中统计 + manifest 扩容（bilivideo host 权限/后台/反馈权限）"

```

---

### Task 5: CDN 探测状态机 + cdnUtil 选优接线

**Files:**
- Create: `packages/core/src/features/cdn-probe/probe.ts`
- Modify: `packages/core/src/utils/get-cdn-url.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/cdn-probe.test.ts`

**Interfaces:**
- Consumes: `Logger`、`KVStore`、Task 4 的 `ProbeFetch` 类型
- Produces:
  - `type ProbeFetch`（Task 4 已定义于 `features/cdn-probe/probe.ts`——本任务把该类型定义落在此文件，Task 4 的 index.ts 导出行即指此文件）
  - `CDN_PROBE_STATUS_KEY = 'mbgt:cdn:probe:status'`
  - `interface CdnProbeResult { host: string; ms: number; ok: boolean }`
  - `interface CdnProbeStatus { bestHost: string | null; results: CdnProbeResult[]; startedAt: number; finishedAt: number | null; fallback: boolean }`
  - `interface CdnProbe { ensureProbe(candidateHosts: string[], sampleUrl: string): void; getBestHost(): { host: string; expiresAt: number } | null; getStatus(): CdnProbeStatus | null }`
  - `createCdnProbe(opts: { fetchLike: ProbeFetch; logger: Logger; store: KVStore }): CdnProbe`
  - `PROBE_TIMEOUT_MS = 2_000`；`PROBE_CACHE_TTL_MS = 5 * 60_000`
  - `createCDNUtil(logger, hooksRef?: { current?: { probe?: CdnProbe } })`（懒读 hooksRef，支持接线层后挂 probe）
  - CDN 开关键 `mbgt:cdn:probe` 在 Task 6 的 `platform/storage.ts` 定义（`SETTING_CDN_PROBE`），本任务不引入

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/cdn-probe.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCdnProbe } from '../src/features/cdn-probe/probe';
import { createLogger } from '../src/logger';
import { createMemoryKVStore } from '../src/platform/storage';

const logger = createLogger(console);
const store = createMemoryKVStore();

function fakeFetch(results: { ok: boolean; ms: number }[]) {
  let i = 0;
  return vi.fn(async () => results[i++] ?? { ok: false, ms: 2_000 });
}

describe('cdn-probe 状态机', () => {
  it('按候选探测，选延迟最低者并落盘状态', async () => {
    const probe = createCdnProbe({
      fetchLike: fakeFetch([
        { ok: true, ms: 300 }, // hostA
        { ok: true, ms: 120 }, // hostB
        { ok: false, ms: 2_000 } // hostC
      ]),
      logger, store
    });
    probe.ensureProbe(['hostA.bilivideo.com', 'hostB.bilivideo.com', 'hostC.bilivideo.com'], 'https://hostA.bilivideo.com/upgcxcode/x/x.m4s?a=1');
    await vi.waitFor(() => expect(probe.getStatus()?.finishedAt).not.toBeNull());
    const st = probe.getStatus()!;
    expect(st.bestHost).toBe('hostB.bilivideo.com');
    expect(st.fallback).toBe(false);
    expect(st.results).toHaveLength(3);
    expect((await store.get('mbgt:cdn:probe:status'))?.bestHost).toBe('hostB.bilivideo.com');
    expect(probe.getBestHost()?.host).toBe('hostB.bilivideo.com');
  });

  it('缓存有效期内重复 ensureProbe 不再探测', async () => {
    const fetchLike = fakeFetch([{ ok: true, ms: 100 }]);
    const probe = createCdnProbe({ fetchLike, logger, store });
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/x.m4s');
    await vi.waitFor(() => expect(probe.getStatus()?.finishedAt).not.toBeNull());
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/y.m4s');
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it('全部失败 → fallback=true、bestHost=null、不写缓存', async () => {
    const probe = createCdnProbe({ fetchLike: fakeFetch([{ ok: false, ms: 2_000 }]), logger, store });
    probe.ensureProbe(['dead.bilivideo.com'], 'https://dead.bilivideo.com/upgcxcode/x.m4s');
    await vi.waitFor(() => expect(probe.getStatus()?.finishedAt).not.toBeNull());
    expect(probe.getStatus()!.fallback).toBe(true);
    expect(probe.getBestHost()).toBe(null);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/cdn-probe.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 probe.ts**

Create `packages/core/src/features/cdn-probe/probe.ts`：

```ts
// CDN 智能选优（spec §4.1）：对 playinfo 出现的镜像候选发起小体积 range 探测，
// 2s 超时淘汰，按延迟取最优，结果缓存 5min；全败回退上游随机策略（getBestHost 返回 null 即回退）。
// 候选来自 cdnUtil 收集的 mirror_type_upgcxcode_hosts——P2P/PCDN 与无 SSL 的 mirror14b
// 在收集阶段已被排除（knownP2pCdnDomainPattern），本文件不做二次过滤。
import type { Logger } from '../../logger';
import type { KVStore } from '../../platform/storage';

/** 探测网络通道：userscript 走 GM_xmlhttpRequest（绕 CORS+绕页面 hook），扩展走 isolated 世界裸 fetch */
export type ProbeFetch = (url: string, timeoutMs: number) => Promise<{ ok: boolean; ms: number }>;

export const PROBE_TIMEOUT_MS = 2_000;
export const PROBE_CACHE_TTL_MS = 5 * 60_000;
export const CDN_PROBE_STATUS_KEY = 'mbgt:cdn:probe:status';

export interface CdnProbeResult { host: string; ms: number; ok: boolean }
export interface CdnProbeStatus {
  bestHost: string | null;
  results: CdnProbeResult[];
  startedAt: number;
  finishedAt: number | null;
  fallback: boolean;
}

export interface CdnProbe {
  ensureProbe(candidateHosts: string[], sampleUrl: string): void;
  getBestHost(): { host: string; expiresAt: number } | null;
  getStatus(): CdnProbeStatus | null;
}

export function createCdnProbe(opts: { fetchLike: ProbeFetch; logger: Logger; store: KVStore }): CdnProbe {
  const { fetchLike, logger, store } = opts;
  let status: CdnProbeStatus | null = null;
  let probing = false;
  let cache: { host: string; expiresAt: number } | null = null;

  return {
    ensureProbe(candidateHosts, sampleUrl) {
      if (probing) return;
      if (cache && cache.expiresAt > Date.now()) return;
      const hosts = [...new Set(candidateHosts)];
      if (hosts.length === 0) return;
      probing = true;
      void runProbe(hosts, sampleUrl);
    },
    getBestHost() {
      return cache && cache.expiresAt > Date.now() ? cache : null;
    },
    getStatus() { return status; }
  };

  async function runProbe(hosts: string[], sampleUrl: string): Promise<void> {
    const startedAt = Date.now();
    const results: CdnProbeResult[] = [];
    await Promise.all(hosts.map(async (host) => {
      try {
        const url = new URL(sampleUrl);
        url.hostname = host;
        url.protocol = 'https:';
        url.port = '443';
        const r = await fetchLike(url.href, PROBE_TIMEOUT_MS);
        results.push({ host, ok: r.ok, ms: r.ms });
      } catch {
        results.push({ host, ok: false, ms: PROBE_TIMEOUT_MS });
      }
    }));
    const oks = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
    const best = oks[0] ?? null;
    if (best) cache = { host: best.host, expiresAt: Date.now() + PROBE_CACHE_TTL_MS };
    status = { bestHost: best?.host ?? null, results, startedAt, finishedAt: Date.now(), fallback: !best };
    probing = false;
    if (best) logger.info(`CDN probe finished: best=${best.host} (${best.ms}ms)`, { results });
    else logger.warn('CDN probe: all candidates failed, fallback to random mirror', { results });
    try {
      await store.set(CDN_PROBE_STATUS_KEY, status);
    } catch { /* 面板数据持久化失败不影响探测 */ }
  }
}
```

`packages/core/src/index.ts` 追加导出：

```ts
export {
  PROBE_TIMEOUT_MS, PROBE_CACHE_TTL_MS, CDN_PROBE_STATUS_KEY,
  type ProbeFetch, type CdnProbeResult, type CdnProbeStatus, type CdnProbe, createCdnProbe
} from './features/cdn-probe/probe';
```

（若 Task 4 已把 `export type { ProbeFetch } ...` 行写入 index.ts，本步骤删除该重复行，统一由本块导出。）

- [ ] **Step 4: cdnUtil 选优接线（get-cdn-url.ts）**

`packages/core/src/utils/get-cdn-url.ts` 修改：

1. 文件头加：

```ts
import type { CdnProbe } from '../features/cdn-probe/probe';

export interface CdnUtilHooks {
  /** 懒挂载的探测实例（接线层异步读取设置后回填，见 Plan 4 Task 6） */
  probe?: CdnProbe;
}
```

2. `createCDNUtil(logger: Logger)` 签名改为 `createCDNUtil(logger: Logger, hooksRef?: { current?: CdnUtilHooks })`；`mirror` 分支（`case (mirror_urls.size > 0)`）的选源逻辑替换：

```ts
          replacementType = 'mirror';

          const mirrorUrlsArray = Array.from(mirror_urls);
          if (mirrorUrlsArray.length === 1) {
            getReplacementUrl = () => mirrorUrlsArray[0];
            break;
          }
          getReplacementUrl = (url) => selectMirrorUrl(mirrorUrlsArray, url);
          break;
```

并在函数体（createCDNUtil 作用域内、extractCDNFromVideoOrAudio 之外）加：

```ts
  // upgcxcode 路径/签名跨镜像宿主可互换：探测缓存有效时固定换到最优宿主，否则回退上游随机
  function selectMirrorUrl(candidates: string[], incomingUrl: string | URL): string {
    const best = hooksRef?.current?.probe?.getBestHost();
    if (best) {
      const url = new URL(typeof incomingUrl === 'string' ? incomingUrl : incomingUrl.href);
      url.hostname = best.host;
      return url.href;
    }
    return pickOne(candidates);
  }
```

3. `extractCDNFromVideoOrAudio` 末尾（`cdnDatas.set(...)` 循环之后）追加探测触发：

```ts
      const probe = hooksRef?.current?.probe;
      if (probe && mirror_urls.size > 0) {
        probe.ensureProbe(Array.from(mirror_type_upgcxcode_hosts), Array.from(mirror_urls)[0]);
      }
```

- [ ] **Step 5: cdn-util 选优接线测试（追加到 tests/get-cdn-url.test.ts）**

```ts
import { createCDNUtil } from '../src/utils/get-cdn-url';

describe('cdnUtil probe 选优接线', () => {
  it('探测缓存有效时镜像替换固定到最优宿主；无 probe 时保持随机', () => {
    const sampleUrl = 'https://up.mirrorA.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1&upsig=s&uparams=e,os';
    const makePlayinfo = (hosts: string[]) => ({
      data: {
        dash: {
          video: hosts.map(h => ({ baseUrl: `https://${h}/upgcxcode/9/9/x/x.m4s?os=upos&trid=1&upsig=s&uparams=e,os` })),
          audio: []
        }
      }
    });
    const util = createCDNUtil(logger2());
    util.saveAndParsePlayerInfo(makePlayinfo(['up.mirrorA.bilivideo.com', 'up.mirrorB.bilivideo.com']), 't1');
    const url = 'https://up.mirrorA.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1&upsig=s&uparams=e,os';
    // 无 probe：返回值仍是镜像形态（随机宿主在候选集内）
    const out1 = util.getReplacementCdnUrl(url, 't');
    expect(out1).toMatch(/upgcxcode\/9\/9\/x\/x\.m4s/);

    // 有 probe（缓存有效）：固定最优宿主
    const probe = {
      ensureProbe: () => {},
      getBestHost: () => ({ host: 'up.mirrorB.bilivideo.com', expiresAt: Date.now() + 300_000 }),
      getStatus: () => null
    };
    const util2 = createCDNUtil(logger2(), { current: { probe } });
    util2.saveAndParsePlayerInfo(makePlayinfo(['up.mirrorA.bilivideo.com', 'up.mirrorB.bilivideo.com']), 't2');
    expect(util2.getReplacementCdnUrl(url, 't')).toContain('up.mirrorB.bilivideo.com');
  });
});

function logger2() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} } as any;
}
```

（注意 `mirrorRegex` 要求 upos- 前缀宿主才收集为 mirror：用例宿主用 `upos-sz-mirrorxx` 形态更稳妥——若上述宿主不命中 mirrorRegex 导致 `mirror_urls.size === 0`，把宿主改为 `upos-sz-mirrortest01.bilivideo.com` / `upos-sz-mirrortest02.bilivideo.com` 后重跑，Step 4 中不改动 regex。）

- [ ] **Step 6: 运行确认通过**

Run: `cd packages/core && npx vitest run`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: CDN 探测状态机（2s 超时/5min 缓存/全败回退）+ cdnUtil 最优宿主选源接线"

```

---

### Task 6: 探测网络通道 + 接线层设置读取（三值开关生效点）

**Files:**
- Modify: `packages/core/src/platform/bridge.ts`（probe action 分支 + createBridgedProbeFetch）
- Modify: `packages/core/src/platform/storage.ts`（`SETTING_CDN_PROBE`、`SETTING_STATS_BADGE`、`readSettingsWithBudget`）
- Modify: `packages/core/src/modules/no-p2p.ts`（接受 hooksRef 传给 createCDNUtil）
- Modify: `packages/core/src/modules/index.ts`（getDefaultModules 增加可选参数）
- Modify: `packages/userscript/src/gm-probe-fetch.ts`（新建）
- Create: `packages/extension/src/probe-fetch.ts`（新建，Task 4 推迟到本任务）
- Modify: `packages/userscript/src/entry.ts`
- Modify: `packages/extension/src/main-entry.ts`
- Modify: `packages/extension/src/isolated-entry.ts`
- Test: `packages/core/tests/wiring-settings.test.ts`、`packages/core/tests/platform-bridge.test.ts`（追加 probe 用例）

**Interfaces:**
- Consumes: Task 1 `readModuleOverrides`、Task 5 `CdnProbe`/`CdnUtilHooks`、Task 4 `ProbeFetch`
- Produces:
  - `SETTING_CDN_PROBE = 'mbgt:cdn:probe'`（boolean，默认 true）；`SETTING_STATS_BADGE = 'mbgt:ui:stats-badge'`（boolean，默认 false）
  - `interface WiringSettings { overrides: Map<string, ModuleOverride>; cdnProbe: boolean; statsBadge: boolean }`
  - `readSettingsWithBudget(store: KVStore, moduleNames: readonly string[], budgetMs?: number): Promise<WiringSettings>`（超预算回退默认值——永不阻塞 document-start 派发）
  - `getDefaultModules(logger, options?: { cdnHooksRef?: { current?: CdnUtilHooks } })`
  - `createBridgedProbeFetch(eventTarget: EventTarget, budgetMs?: number): ProbeFetch`
  - **语义裁定（写入面板文案）**：扩展形态即时模块不提供关闭开关（接线层异步读设置赶不上页面内联脚本）；`mbgt:cdn:probe=false` 在扩展形态使 probe 不挂载（首载内联 playinfo 解析先于设置返回，当页首跳探测可能仍发生，自下个页面加载起完全生效）；userscript 形态开关同步生效

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/wiring-settings.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readSettingsWithBudget, SETTING_CDN_PROBE, SETTING_STATS_BADGE } from '../src/platform/storage';
import { createMemoryKVStore } from '../src/platform/storage';
import { OVERRIDE_PREFIX } from '../src/platform/storage';

const slowStore = () => {
  const store = createMemoryKVStore();
  return { ...store, getAll: () => new Promise<Record<string, unknown>>(() => {}) }; // 永不 resolve
};

describe('readSettingsWithBudget', () => {
  it('正常读取：overrides + 两个设置', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}no-ad`, 'force-on');
    await store.set(SETTING_CDN_PROBE, false);
    await store.set(SETTING_STATS_BADGE, true);
    const s = await readSettingsWithBudget(store, ['no-ad', 'defuse-spyware']);
    expect(s.overrides.get('no-ad')).toBe('force-on');
    expect(s.cdnProbe).toBe(false);
    expect(s.statsBadge).toBe(true);
  });

  it('读超预算 → 回退默认值（cdnProbe=true, statsBadge=false, overrides 空）', async () => {
    // getAll 永不 resolve + 预算 5ms（真实计时，确定性）
    const s = await readSettingsWithBudget(slowStore() as any, ['no-ad'], 5);
    expect(s.cdnProbe).toBe(true);
    expect(s.statsBadge).toBe(false);
    expect(s.overrides.size).toBe(0);
  });
});
```

`packages/core/tests/platform-bridge.test.ts` 追加：

```ts
it('probe action 经桥接往返（isolated 返回 { ok, ms }）', async () => {
  const { createBridgeHost, createBridgedProbeFetch } = await import('../src/platform/bridge');
  const et = new EventTarget();
  const probeFetch = async (url: string) => ({ ok: url.startsWith('https://'), ms: 42 });
  createBridgeHost(createMemoryKVStore(), et, probeFetch as any);
  const client = createBridgedProbeFetch(et);
  const r = await client('https://upos.bilivideo.com/x.m4s', 2_000);
  expect(r).toEqual({ ok: true, ms: 42 });
  const r2 = await client('http://bad', 2_000);
  expect(r2.ok).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/wiring-settings.test.ts tests/platform-bridge.test.ts`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现 storage 设置读取**

`packages/core/src/platform/storage.ts` 追加：

```ts
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
  try {
    return await Promise.race([
      read,
      new Promise<WiringSettings>(resolve => setTimeout(() => resolve(defaults), budgetMs))
    ]);
  } catch {
    return defaults;
  }
}
```

- [ ] **Step 4: 桥接 probe 通道**

`packages/core/src/platform/bridge.ts`：
- `createBridgeHost` 第三个参数：`createBridgeHost(store: KVStore, eventTarget: EventTarget, probeFetch?: ProbeFetch)`（`import type { ProbeFetch } from '../features/cdn-probe/probe';`）；监听器分支表追加：

```ts
      else if (req.action === 'probe' && probeFetch) res = { id: req.id, ok: true, value: await probeFetch(req.key, Number(req.value) || 2_000) };
```

（注意：probe 结果 ok:true 语义=「请求完成」，`{ok:false}` 的探测结果本身装在 value 里——host 端包装 ok 恒 true，探测成败由 value.ok 表达。）

- 新增导出（pending map 与 store 客户端共用一个模块级 Map，复用既有 `pending`）：

```ts
/** MAIN 侧探测通道：经桥接发 probe 请求到 isolated 世界（其裸 fetch 未被 hook） */
export function createBridgedProbeFetch(eventTarget: EventTarget, budgetMs = 6_000): ProbeFetch {
  return (url, timeoutMs) => new Promise(resolve => {
    const id = `${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, ms: budgetMs });
    }, budgetMs);
    pending.set(id, (res) => {
      clearTimeout(timer);
      resolve((res.value as { ok: boolean; ms: number }) ?? { ok: false, ms: budgetMs });
    });
    eventTarget.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: { id, action: 'probe', key: url, value: timeoutMs } }));
  });
}
```

（`pending` 当前是 `createBridgedKVStore` 闭包内私有——把它提到模块级或在本函数内自建同构 Map；执行者选改动最小方案：在 `createBridgedKVStore` 外新建模块级 `probePending` Map 并让 RESPONSE 监听器同时分派两个 Map。）

- `packages/core/src/index.ts` 导出 `createBridgedProbeFetch` 与 `SETTING_CDN_PROBE, SETTING_STATS_BADGE, readSettingsWithBudget, type WiringSettings`。

- [ ] **Step 5: 模块与接线层装配**

1. `packages/core/src/modules/no-p2p.ts`：

```ts
import type { CdnUtilHooks } from '../utils/get-cdn-url';

export default function noP2P(logger: Logger, cdnHooksRef?: { current?: CdnUtilHooks }): ModuleMeta {
  const cdnUtil = createCDNUtil(logger, cdnHooksRef);
  // ……其余不变
```

2. `packages/core/src/modules/index.ts`：

```ts
import type { CdnUtilHooks } from '../utils/get-cdn-url';

export function getDefaultModules(logger: Logger, options?: { cdnHooksRef?: { current?: CdnUtilHooks } }): ModuleMeta[] {
  return [
    // ……顺序不变……
    noP2P(logger, options?.cdnHooksRef),
    // ……
  ];
}
```

（既有测试 `getDefaultModules(logger)` 继续可用。）

3. `packages/userscript/src/gm-probe-fetch.ts`（新建）：

```ts
import type { ProbeFetch } from '@mbgt/core';

// GM_xmlhttpRequest 通道：绕 CORS（meta 已 @connect bilivideo.com）且绕开页面 fetch hook
export function createGMProbeFetch(): ProbeFetch {
  return (url, timeoutMs) => new Promise(resolve => {
    const started = performance.now();
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { Range: 'bytes=0-1023' },
      timeout: timeoutMs,
      onload: () => resolve({ ok: true, ms: Math.round(performance.now() - started) }),
      onerror: () => resolve({ ok: false, ms: Math.round(performance.now() - started) }),
      ontimeout: () => resolve({ ok: false, ms: timeoutMs })
    });
  });
}
```

4. `packages/userscript/src/entry.ts`：改造为如下骨架（完整文件在 Task 9 再加面板挂载；本步骤先落探测与设置读取）：

```ts
// ……既有 import 基础上新增：
import { createCdnProbe, readSettingsWithBudget, SETTING_CDN_PROBE, SETTING_STATS_BADGE, type CdnUtilHooks } from '@mbgt/core';
import { createGMProbeFetch } from './gm-probe-fetch';

// ……迁移与菜单注册之后：
// userscript 形态 document-start 可同步读设置（GM_getValue），开关当页生效
const cdnProbeEnabled = GM_getValue(SETTING_CDN_PROBE) !== false;
const statsBadgeEnabled = GM_getValue(SETTING_STATS_BADGE) === true;
const cdnHooksRef: { current?: CdnUtilHooks } = {};
if (cdnProbeEnabled) {
  cdnHooksRef.current = {
    probe: createCdnProbe({ fetchLike: createGMProbeFetch(), logger, store })
  };
}
const allModules = getDefaultModules(logger, { cdnHooksRef });
```

（既有 `const allModules = getDefaultModules(logger);` 一行替换为上述带参版本；`getModuleEnabledSync` 读 override 键的即时过滤保持 Task 1 语义。deferred 结算链改用 `readSettingsWithBudget` 统一读 overrides 亦可，但 userscript 既有 `readModuleOverrides` 直接读取路径已正确——保持不变，不重复读。）

5. `packages/extension/src/main-entry.ts`：改造（完整版在 Task 9 收口，本步骤先落探测通道与设置读取）：

```ts
import './unsafe-shim';
import {
  createCore, createLogger, getDefaultModules, startCompatProbe, resolveConflicts,
  COMPAT_STATUS_KEY, createBewlyFamilySnapshot, createBridgedKVStore, createBridgedProbeFetch,
  createCdnProbe, readSettingsWithBudget, type CdnUtilHooks
} from '@mbgt/core';

const logger = createLogger(console);
const eventTarget = globalThis as unknown as EventTarget;
const store = createBridgedKVStore(eventTarget);

// 即时模块同步派发（document-start 语义优先，扩展形态即时模块无关闭开关——裁定见 Plan 4 Task 6）
const cdnHooksRef: { current?: CdnUtilHooks } = {};
const allModules = getDefaultModules(logger, { cdnHooksRef });
const immediate = allModules.filter(m => !m.conflicts?.length);
const core = createCore({ modules: immediate, console, unsafeWindow: unsafeWindow });
const deferred = allModules.filter(m => m.conflicts?.length);

startCompatProbe({
  snapshot: createBewlyFamilySnapshot(document),
  scheduler: (cb, ms) => { const t = setTimeout(cb, ms); return () => clearTimeout(t); },
  timeoutMs: 10_000,
  intervalMs: 200,
  notInstalledCheck: () => document.readyState === 'complete',
  notInstalledGraceMs: 2_000,
  onSettle: (probe) => {
    void (async () => {
      const settings = await readSettingsWithBudget(store, deferred.map(m => m.name));
      const forceOn = new Set([...settings.overrides.entries()].filter(([, v]) => v === 'force-on').map(([n]) => n));
      const menuDisabled = new Set([...settings.overrides.entries()].filter(([, v]) => v === 'off').map(([n]) => n));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, menuDisabled, forceOn);
      for (const d of autoDisabled) logger.log(`[${d.module}] auto-disabled: ${d.extension} (${d.feature}) detected`);
      core.registerModules(enabled);
      await store.set(COMPAT_STATUS_KEY, {
        family: probe.family,
        extensions: probe.extensions.map(e => e.id),
        generic: probe.generic,
        autoDisabled,
        settledAt: Date.now()
      });
    })().catch((e) => logger.error('compat settle chain failed -- deferred modules skipped', e));
  }
});

// 设置回填：probe 挂载 + 统计角标（Task 7 mountStatsBadge 在 Task 9 接入；此处先落 cdnHooksRef）
void (async () => {
  const settings = await readSettingsWithBudget(store, allModules.map(m => m.name));
  if (settings.cdnProbe) {
    cdnHooksRef.current = { probe: createCdnProbe({ fetchLike: createBridgedProbeFetch(eventTarget), logger, store }) };
  }
})().catch((e) => logger.warn('mbgt settings backfill failed', e));
```

6. `packages/extension/src/probe-fetch.ts`（新建，isolated world 使用，自身 fetch 未被 hook，天然绕开 MAIN world 拦截链）：

```ts
import type { ProbeFetch } from '@mbgt/core';

// isolated world 的裸 fetch（无任何 hook 改写）——探测必须走这条通道，
// 否则 MAIN world 的 no-p2p onBeforeFetch 会把候选宿主改写成最优宿主（探测退化）。
export function createExtensionProbeFetch(): ProbeFetch {
  return (url, timeoutMs) => new Promise(resolve => {
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: ctrl.signal })
      .then(() => resolve({ ok: true, ms: Math.round(performance.now() - started) }))
      .catch(() => resolve({ ok: false, ms: Math.round(performance.now() - started) }))
      .finally(() => clearTimeout(timer));
  });
}
```

7. `packages/extension/src/isolated-entry.ts`：`createBridgeHost(store, window)` 改为：

```ts
import { createBridgeHost, createMemoryKVStore } from '@mbgt/core';
import { createExtensionProbeFetch } from './probe-fetch';
// ……既有 store 构建不变……
createBridgeHost(store, window, createExtensionProbeFetch());
```

- [ ] **Step 6: 运行确认通过 + 三包 tsc**

Run: `cd packages/core && npx vitest run`；根目录三包 `npx tsc --noEmit`
Expected: 全绿、零错误

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: CDN 探测三端通道（GM_xmlhttpRequest/桥接 isolated fetch）+ 接线层设置读取（预算回退）"

```

---

### Task 7: 拦截统计角标（默认关闭，设置开启）

**Files:**
- Create: `packages/core/src/features/stats/badge.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/stats-badge.test.ts`

**Interfaces:**
- Consumes: Task 2 registry（`onInterception/sessionCounts/readStats`）
- Produces:
  - `mountStatsBadge(opts: { store: KVStore }): (() => void) | null`——已挂载返回 null；返回 destroy 函数
  - 角标语义：右下角固定 `🛡 N` 胶囊；点击展开明细（kind → 数量）；基线=持久计数（mount 时读一次）+ 会话实时计数（监听器刷新）

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/stats-badge.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountStatsBadge } from '../src/features/stats/badge';
import { recordInterception } from '../src/features/stats/registry';
import { createMemoryKVStore } from '../src/platform/storage';

describe('stats badge', () => {
  it('挂载出 #mbgt-stats-badge，实时事件刷新总数', () => {
    const destroy = mountStatsBadge({ store: createMemoryKVStore() });
    expect(destroy).not.toBeNull();
    const chip = document.getElementById('mbgt-stats-badge')!;
    recordInterception('beacon', 3);
    expect(chip.textContent).toContain('3');
    // 重复挂载返回 null
    expect(mountStatsBadge({ store: createMemoryKVStore() })).toBe(null);
    destroy!();
    expect(document.getElementById('mbgt-stats-badge')).toBe(null);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/stats-badge.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 badge.ts**

Create `packages/core/src/features/stats/badge.ts`：

```ts
// 统计角标（spec §4.2）：右下角可收起角标，默认关闭，设置里开启（接线层按 mbgt:ui:stats-badge 挂载）。
// 基线 = mount 时读到的持久计数；实时增量经 onInterception 监听。挂载失败只损失可视化（降级原则）。
import type { KVStore } from '../../platform/storage';
import { onInterception, readStats, sessionCounts } from './registry';

const BADGE_ID = 'mbgt-stats-badge';

const BADGE_STYLE = `
#${BADGE_ID}{position:fixed;right:12px;bottom:12px;z-index:2147483000;font:12px/1.4 system-ui,sans-serif;
  background:rgba(20,20,20,.85);color:#fff;padding:6px 10px;border-radius:999px;cursor:pointer;user-select:none}
#${BADGE_ID} ul{position:fixed;right:12px;bottom:44px;margin:0;padding:8px 12px;list-style:none;
  background:rgba(20,20,20,.9);color:#fff;border-radius:8px;max-width:260px;display:none}
#${BADGE_ID}.open ul{display:block}
`;

export function mountStatsBadge(opts: { store: KVStore }): (() => void) | null {
  try {
    if (document.getElementById(BADGE_ID)) return null;

    const chip = document.createElement('div');
    chip.id = BADGE_ID;
    const list = document.createElement('ul');
    const label = document.createElement('span');
    chip.appendChild(list);
    chip.appendChild(label);
    const style = document.createElement('style');
    style.textContent = BADGE_STYLE;

    let baselineCounts: Record<string, number> = {};
    let destroyed = false;

    const sum = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + v, 0);
    const render = () => {
      if (destroyed) return;
      const live = sessionCounts();
      label.textContent = `🛡 ${sum(baselineCounts) + sum(live)}`;
      const merged = { ...baselineCounts };
      for (const [k, v] of Object.entries(live)) merged[k] = (merged[k] ?? 0) + v;
      const items = Object.entries(merged).filter(([, v]) => v > 0);
      list.replaceChildren(...(
        items.length > 0
          ? items.map(([k, v]) => {
            const li = document.createElement('li');
            li.textContent = `${k}: ${v}`;
            return li;
          })
          : (() => { const li = document.createElement('li'); li.textContent = '（暂无拦截记录）'; return [li]; })()
      ));
    };

    const off = onInterception(() => render());
    void readStats(opts.store).then(stored => {
      baselineCounts = stored.counts;
      render();
    }).catch(() => { /* 基线读取失败仍可显示会话计数 */ });

    chip.addEventListener('click', () => chip.classList.toggle('open'));
    render();
    document.head?.appendChild(style);
    document.body?.appendChild(chip);

    return () => {
      destroyed = true;
      off();
      chip.remove();
      style.remove();
    };
  } catch (e) {
    console.warn('[mbgt] stats badge mount failed', e);
    return null;
  }
}
```

`packages/core/src/index.ts` 追加：

```ts
export { mountStatsBadge } from './features/stats/badge';
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && npx vitest run tests/stats-badge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 拦截统计角标（右下角胶囊 + 明细展开，设置开启才挂载）"

```

---

### Task 8: 面板状态模型（纯函数：模块行/统计视图/导入导出校验）

**Files:**
- Create: `packages/core/src/features/panel/model.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/panel-model.test.ts`

**Interfaces:**
- Consumes: `ModuleOverride`、`CompatStatus`（platform/storage）、`StatsPayload`（Task 2）、`DnrStatsPayload`（Task 4）
- Produces（Task 9/10 组件直接消费）:
  - `interface ModuleRow { name: string; description: string; override: ModuleOverride; enabled: boolean; forced: boolean; autoDisabledReason?: { extension: string; feature: string } }`
  - `buildModuleRows(modules: { name: string; description: string }[], overrideMap: Map<string, ModuleOverride>, compat?: CompatStatus): ModuleRow[]`
  - `STATS_LABELS: Record<string, string>`（kind → 中文文案）
  - `buildStatsView(stats?: StatsPayload, dnr?: DnrStatsPayload): { rows: { label: string; count: number }[]; total: number }`
  - `filterExportableKeys(all: Record<string, unknown>): Record<string, unknown>`（导出白名单：override 前缀 / `mbgt:ui:` 前缀 / `mbgt:cdn:probe` 单键）
  - `validateImportPayload(raw: unknown): Record<string, unknown> | null`（导入白名单同上，非法值丢弃；空结果返回 null）

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/panel-model.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  buildModuleRows, buildStatsView, filterExportableKeys, validateImportPayload
} from '../src/features/panel/model';
import type { ModuleOverride } from '../src/platform/storage';

const mods = [
  { name: 'no-ad', description: '去广告' },
  { name: 'defuse-spyware', description: '反跟踪' }
];

describe('buildModuleRows', () => {
  it('override 三值 → enabled/forced；compat 命中且非 forced 时带原因', () => {
    const map = new Map<string, ModuleOverride>([['no-ad', 'force-on']]);
    const compat = {
      family: 'bewly' as const, extensions: ['bewlycat'], generic: false, settledAt: 1,
      autoDisabled: [{ module: 'no-ad', extension: 'bewlycat', feature: 'blockAds / 首页重构' }]
    };
    const rows = buildModuleRows(mods, map, compat);
    const noAd = rows.find(r => r.name === 'no-ad')!;
    expect(noAd.enabled).toBe(true);
    expect(noAd.forced).toBe(true);
    expect(noAd.autoDisabledReason).toBe(undefined); // force-on 压过自动停用
    const spy = rows.find(r => r.name === 'defuse-spyware')!;
    expect(spy.enabled).toBe(true);
    expect(spy.forced).toBe(false);
    expect(spy.autoDisabledReason).toBe(undefined);
  });

  it('off → enabled=false；自动停用且未覆盖 → 带原因', () => {
    const map = new Map<string, ModuleOverride>([['defuse-spyware', 'off']]);
    const compat = {
      family: 'bewly' as const, extensions: [], generic: true, settledAt: 1,
      autoDisabled: [{ module: 'no-ad', extension: 'generic', feature: '首页重构' }]
    };
    const rows = buildModuleRows(mods, map, compat);
    expect(rows.find(r => r.name === 'defuse-spyware')!.enabled).toBe(false);
    const noAd = rows.find(r => r.name === 'no-ad')!;
    expect(noAd.enabled).toBe(false);
    expect(noAd.autoDisabledReason).toEqual({ extension: 'generic', feature: '首页重构' });
  });
});

describe('buildStatsView', () => {
  it('合并 content 统计与 DNR 统计并按量排序', () => {
    const view = buildStatsView(
      { counts: { beacon: 5, 'p2p-replaced': 2 }, flushedAt: 1 },
      { counts: { defuse_report: 9 }, updatedAt: 1 }
    );
    expect(view.rows[0]).toEqual({ label: 'DNR 网络层拦截', count: 9 });
    expect(view.rows.find(r => r.label === 'sendBeacon 跟踪上报')!.count).toBe(5);
    expect(view.total).toBe(16);
  });
});

describe('导入/导出', () => {
  it('导出仅保留配置键白名单', () => {
    const all = {
      'mbgt:override:no-ad': 'off',
      'mbgt:ui:stats-badge': true,
      'mbgt:cdn:probe': false,
      'mbgt:compat:status': { x: 1 },
      'mbgt:stats:counters': { counts: {} },
      'other': 1
    };
    expect(filterExportableKeys(all)).toEqual({
      'mbgt:override:no-ad': 'off',
      'mbgt:ui:stats-badge': true,
      'mbgt:cdn:probe': false
    });
  });
  it('导入校验：合法配置键保留、非法键/非法值丢弃、全空返回 null', () => {
    expect(validateImportPayload({ 'mbgt:override:x': 'force-on', 'mbgt:override:y': 'hacked', garbage: 1 }))
      .toEqual({ 'mbgt:override:x': 'force-on' });
    expect(validateImportPayload({ 'mbgt:cdn:probe': true })).toEqual({ 'mbgt:cdn:probe': true });
    expect(validateImportPayload({ garbage: 1 })).toBe(null);
    expect(validateImportPayload(null)).toBe(null);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/panel-model.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 model.ts**

Create `packages/core/src/features/panel/model.ts`：

```ts
// 面板状态模型（纯函数，组件层零逻辑）：模块行视图、统计视图、导入导出白名单。
import type { CompatStatus, ModuleOverride } from '../../platform/storage';
import type { StatsPayload } from '../stats/registry';
import type { DnrStatsPayload } from '../stats/dnr';

export interface ModuleRow {
  name: string;
  description: string;
  override: ModuleOverride;
  enabled: boolean;
  forced: boolean;
  autoDisabledReason?: { extension: string; feature: string };
}

export function buildModuleRows(
  modules: { name: string; description: string }[],
  overrideMap: Map<string, ModuleOverride>,
  compat?: CompatStatus
): ModuleRow[] {
  const autoMap = new Map((compat?.autoDisabled ?? []).map(d => [d.module, d]));
  return modules.map(m => {
    const override = overrideMap.get(m.name) ?? 'on';
    const auto = autoMap.get(m.name);
    const forced = override === 'force-on';
    return {
      name: m.name,
      description: m.description,
      override,
      enabled: override !== 'off',
      forced,
      autoDisabledReason: (auto && !forced) ? { extension: auto.extension, feature: auto.feature } : undefined
    };
  });
}

export const STATS_LABELS: Record<string, string> = {
  'beacon': 'sendBeacon 跟踪上报',
  'spyware-fetch': '上报 fetch 拦截',
  'spyware-xhr': '上报 XHR 拦截',
  'storage-defused': 'localStorage 挡写',
  'p2p-replaced': 'P2P/PCDN 替换',
  'rtc-mocked': 'WebRTC mock',
  'av1-blocked': 'AV1 拦截',
  'dnr': 'DNR 网络层拦截'
};

export function buildStatsView(
  stats?: StatsPayload,
  dnr?: DnrStatsPayload
): { rows: { label: string; count: number }[]; total: number } {
  const merged: Record<string, number> = { ...(stats?.counts ?? {}) };
  for (const [k, v] of Object.entries(dnr?.counts ?? {})) merged[k] = (merged[k] ?? 0) + v;
  const rows = Object.entries(merged)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: STATS_LABELS[k] ?? k, count: v }))
    .sort((a, b) => b.count - a.count);
  return { rows, total: rows.reduce((s, r) => s + r.count, 0) };
}

/** 导入/导出只覆盖配置类键；compat 状态、统计、探测状态等运行数据不进导出文件 */
export function filterExportableKeys(all: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(all).filter(([k]) =>
    k.startsWith('mbgt:override:') || k.startsWith('mbgt:ui:') || k === 'mbgt:cdn:probe'));
}

export function validateImportPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const ok: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('mbgt:override:') && (v === 'on' || v === 'off' || v === 'force-on')) ok[k] = v;
    else if (k === 'mbgt:cdn:probe' && typeof v === 'boolean') ok[k] = v;
    else if (k.startsWith('mbgt:ui:') && typeof v === 'boolean') ok[k] = v;
  }
  return Object.keys(ok).length > 0 ? ok : null;
}
```

`packages/core/src/index.ts` 追加：

```ts
export {
  buildModuleRows, STATS_LABELS, buildStatsView, filterExportableKeys, validateImportPayload,
  type ModuleRow
} from './features/panel/model';
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && npx vitest run tests/panel-model.test.ts`
Expected: PASS（6 用例）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 面板状态模型（模块行/统计视图/导入导出白名单，纯函数）"

```

---

### Task 9: Preact 面板组件 + userscript 浮层挂载 + 两形态接线收口

**Files:**
- Create: `packages/core/src/version.ts`（MBGT_VERSION 单源；index.ts 与面板页脚都从这里取，避免 index↔panel 循环值引用）
- Create: `packages/core/src/features/panel/panel.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/userscript/src/entry.ts`（面板挂载 + 统计 flush + 角标挂载收口）
- Modify: `packages/extension/src/main-entry.ts`（统计 flush + 角标挂载收口）
- Test: `packages/core/tests/panel-ui.test.ts`

**Interfaces:**
- Consumes: Task 8 model、Task 2 registry、Task 4 DNR_STATS_KEY、Task 6 settings、`CDN_PROBE_STATUS_KEY`（Task 5）、`COMPAT_STATUS_KEY`、`SETTING_*`
- Produces:
  - `interface ModuleInfo { name: string; description: string; locked?: boolean }`
  - `function PanelApp(props: { store: KVStore; modules: ModuleInfo[] }): preact.VNode`（h() 调用树，不依赖 JSX 转换）
  - `mountFloatingPanel(opts: { store: KVStore; modules: ModuleInfo[] }): void`（右下角 `⚙ MBGT` 入口胶囊 + 浮层面板；挂载失败仅 console.warn）
  - `loadPanelData(store: KVStore, moduleNames: string[]): Promise<PanelData>`（组件数据加载器，测试可直接调用）
  - 面板操作语义：override 切换写 `mbgt:override:<name>`（on↔off↔force-on 三态循环按钮：默认→off→force-on→默认）；提示"重启页面后生效"（userscript 页内提供"刷新页面"按钮；options 页无需刷新）
  - CDN 区：开关写 `mbgt:cdn:probe`；显示最近探测结果（bestHost/各候选延迟/全败回退标记）
  - 统计区：合并 content+DNR 计数表；角标开关写 `mbgt:ui:stats-badge`
  - 导入导出：导出=`filterExportableKeys(store.getAll())`→textarea JSON；导入=textarea 解析→`validateImportPayload`→逐键 set→提示刷新

- [ ] **Step 1: 写失败测试**

Create `packages/core/tests/panel-ui.test.ts`：

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { PanelApp, mountFloatingPanel, loadPanelData } from '../src/features/panel/panel';
import { render } from 'preact';
import { createMemoryKVStore } from '../src/platform/storage';
import { OVERRIDE_PREFIX } from '../src/platform/storage';

const modules = [
  { name: 'defuse-spyware', description: '反跟踪' },
  { name: 'no-ad', description: '去广告' }
];

describe('loadPanelData', () => {
  it('读 overrides/compat/cdn/stats 并装配', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}no-ad`, 'off');
    const data = await loadPanelData(store, modules.map(m => m.name));
    expect(data.rows.find(r => r.name === 'no-ad')!.enabled).toBe(false);
    expect(data.cdnProbe).toBe(true);
    expect(data.statsBadge).toBe(false);
  });
});

describe('PanelApp 交互', () => {
  it('点击模块开关写入 override 键（取消→off，恢复→删键回默认）', async () => {
    const store = createMemoryKVStore();
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(PanelApp({ store, modules }) as any, container);
    await new Promise(r => setTimeout(r, 10)); // 等异步 load
    // 取消勾选 → 'off'
    const checkbox = container.querySelector<HTMLInputElement>('input[data-module="defuse-spyware"]')!;
    checkbox.click();
    await new Promise(r => setTimeout(r, 10));
    expect(await store.get(`${OVERRIDE_PREFIX}defuse-spyware`)).toBe('off');
    // reload 后重查节点（rerender 可能复用或重建节点），再勾选 → 无 autoDisabled/force 历史 → 删键回默认
    const checkbox2 = container.querySelector<HTMLInputElement>('input[data-module="defuse-spyware"]')!;
    checkbox2.click();
    await new Promise(r => setTimeout(r, 10));
    expect(await store.get(`${OVERRIDE_PREFIX}defuse-spyware`)).toBe(undefined);
  });
});

describe('mountFloatingPanel', () => {
  it('入口胶囊存在且不抛错（降级原则）', () => {
    mountFloatingPanel({ store: createMemoryKVStore(), modules });
    expect(document.getElementById('mbgt-panel-chip')).not.toBe(null);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/panel-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 panel.ts（h() 调用树，避免 JSX 转换配置）**

Create `packages/core/src/features/panel/panel.ts`：

```ts
// 设置+共存面板（spec §4.3）：Preact 组件，双形态共用——userscript 页内浮层、扩展 options 页。
// 用 h() 调用树（core 无 JSX 转换配置）。面板任何异常只 console.warn（降级原则）。
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { KVStore } from '../../platform/storage';
import {
  OVERRIDE_PREFIX, COMPAT_STATUS_KEY, SETTING_CDN_PROBE, SETTING_STATS_BADGE,
  readModuleOverrides, type CompatStatus
} from '../../platform/storage';
import { CDN_PROBE_STATUS_KEY, type CdnProbeStatus } from '../cdn-probe/probe';
import { STATS_KEY, type StatsPayload } from '../stats/registry';
import { DNR_STATS_KEY, type DnrStatsPayload } from '../stats/dnr';
import {
  buildModuleRows, buildStatsView, filterExportableKeys, validateImportPayload, type ModuleRow
} from './model';
import { MBGT_VERSION } from '../../version';

export interface ModuleInfo {
  name: string;
  description: string;
  /** 扩展形态即时模块锁定（document-start 语义裁定） */
  locked?: boolean;
}

export interface PanelData {
  rows: ModuleRow[];
  compat?: CompatStatus;
  cdnStatus?: CdnProbeStatus;
  cdnProbe: boolean;
  statsBadge: boolean;
  statsView: { rows: { label: string; count: number }[]; total: number };
}

export async function loadPanelData(store: KVStore, moduleNames: string[]): Promise<PanelData> {
  const [overrides, compat, cdnStatus, stats, dnr, cdnProbe, statsBadge] = await Promise.all([
    readModuleOverrides(store, moduleNames),
    store.get<CompatStatus>(COMPAT_STATUS_KEY),
    store.get<CdnProbeStatus>(CDN_PROBE_STATUS_KEY),
    store.get<StatsPayload>(STATS_KEY),
    store.get<DnrStatsPayload>(DNR_STATS_KEY),
    store.get<boolean>(SETTING_CDN_PROBE).then(v => v ?? true),
    store.get<boolean>(SETTING_STATS_BADGE).then(v => v ?? false)
  ]);
  return {
    rows: buildModuleRows(
      moduleNames.map(n => ({ name: n, description: '' })), // 行描述由组件按 modules 参数补齐
      overrides, compat ?? undefined
    ),
    compat: compat ?? undefined,
    cdnStatus: cdnStatus ?? undefined,
    cdnProbe,
    statsBadge,
    statsView: buildStatsView(stats ?? undefined, dnr ?? undefined)
  };
}

const PANEL_STYLE = `
#mbgt-panel-chip{position:fixed;right:12px;bottom:64px;z-index:2147483000;font:12px/1.4 system-ui,sans-serif;
  background:rgba(20,20,20,.85);color:#fff;padding:6px 10px;border-radius:999px;cursor:pointer}
#mbgt-panel-root{position:fixed;right:12px;bottom:96px;z-index:2147483000;width:340px;max-height:70vh;overflow:auto;
  background:#fff;color:#222;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:13px/1.6 system-ui,sans-serif;padding:12px}
#mbgt-panel-root h4{margin:10px 0 4px;font-size:13px}
#mbgt-panel-root .mbgt-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0}
#mbgt-panel-root .mbgt-reason{color:#a00;font-size:12px}
#mbgt-panel-root .mbgt-muted{color:#777;font-size:12px}
#mbgt-panel-root .mbgt-btn{cursor:pointer;margin-right:6px}
#mbgt-panel-root textarea{width:100%;height:80px;font:12px monospace}
`;

export function PanelApp(props: { store: KVStore; modules: ModuleInfo[] }) {
  const { store, modules } = props;
  const [data, setData] = useState<PanelData | null>(null);
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [message, setMessage] = useState('');

  const reload = async () => {
    try {
      setData(await loadPanelData(store, modules.map(m => m.name)));
      setMessage('');
    } catch (e) {
      console.warn('[mbgt] panel load failed', e);
    }
  };
  useEffect(() => { void reload(); }, []);

  if (!data) return h('div', null, '加载中…');

  const descOf = (name: string) => modules.find(m => m.name === name)?.description ?? '';
  const lockedOf = (name: string) => modules.find(m => m.name === name)?.locked ?? false;

  // 开关语义（与测试用例一致）：取消勾选 → 'off'；勾选 → 被自动停用的模块恢复为 'force-on'，
  // 正常模块恢复默认（删键）。forced 行取消勾选同样是 'off'（彻底关，而非退回自动停用）。
  const toggleOverride = async (row: ModuleRow, nextEnabled: boolean) => {
    try {
      if (!nextEnabled) await store.set(`${OVERRIDE_PREFIX}${row.name}`, 'off');
      else if (row.forced || row.autoDisabledReason) await store.set(`${OVERRIDE_PREFIX}${row.name}`, 'force-on');
      else await store.delete(`${OVERRIDE_PREFIX}${row.name}`);
      await reload();
      setMessage('配置已写入，重启页面后生效');
    } catch (e) { console.warn('[mbgt] panel write failed', e); }
  };

  const setSetting = async (key: string, value: boolean) => {
    try {
      await store.set(key, value);
      await reload();
    } catch (e) { console.warn('[mbgt] panel write failed', e); }
  };

  return h('div', { id: 'mbgt-panel-root' },
    // ── 模块开关 ──
    h('h4', null, `模块开关（${modules.length}）`),
    h('div', { className: 'mbgt-muted' }, '勾选=启用，取消=关闭；被自动停用的模块勾选即强制开启；重启页面生效'),
    ...data.rows.map(row =>
      h('div', { className: 'mbgt-row', key: row.name },
        h('label', null,
          h('input', {
            type: 'checkbox', 'data-module': row.name,
            checked: row.enabled, disabled: lockedOf(row.name),
            onChange: (e: Event) => {
              if (!lockedOf(row.name)) void toggleOverride(row, (e.target as HTMLInputElement).checked);
            }
          }),
          ` ${row.name}`, ` — ${descOf(row.name) || row.description}`
        ),
        row.forced ? h('span', { className: 'mbgt-muted' }, '（强制开启）') : null,
        row.autoDisabledReason
          ? h('span', { className: 'mbgt-reason' }, `自动停用：${row.autoDisabledReason.extension} / ${row.autoDisabledReason.feature}`)
          : null,
        lockedOf(row.name) ? h('span', { className: 'mbgt-muted' }, '（即时模块锁定：扩展形态保障 document-start 拦截）') : null
      )
    ),
    // ── CDN 选优 ──
    h('h4', null, 'CDN 智能选优'),
    h('div', { className: 'mbgt-row' },
      h('label', null,
        h('input', {
          type: 'checkbox', 'data-setting': SETTING_CDN_PROBE, checked: data.cdnProbe,
          onChange: e => void setSetting(SETTING_CDN_PROBE, (e.target as HTMLInputElement).checked)
        }),
        ' 启用探测（2s 超时，结果缓存 5 分钟，全败回退随机）'
      )
    ),
    h('div', { className: 'mbgt-muted' },
      data.cdnStatus
        ? (data.cdnStatus.fallback
          ? '最近探测：全部候选失败，已回退随机镜像'
          : `最近探测：最优 ${data.cdnStatus.bestHost}；${data.cdnStatus.results.map(r => `${r.host} ${r.ok ? `${r.ms}ms` : '失败'}`).join('，')}`)
        : '尚未探测（播放器取到镜像列表后自动触发）'
    ),
    h('div', { className: 'mbgt-muted' }, '扩展形态：开关自下个页面加载起完全生效'),
    // ── 统计 ──
    h('h4', null, `拦截统计（合计 ${data.statsView.total}）`),
    ...data.statsView.rows.map(r => h('div', { className: 'mbgt-row', key: r.label }, `${r.label}：${r.count}`)),
    data.statsView.rows.length === 0 ? h('div', { className: 'mbgt-muted' }, '暂无拦截记录') : null,
    h('div', { className: 'mbgt-row' },
      h('label', null,
        h('input', {
          type: 'checkbox', 'data-setting': SETTING_STATS_BADGE, checked: data.statsBadge,
          onChange: e => void setSetting(SETTING_STATS_BADGE, (e.target as HTMLInputElement).checked)
        }),
        ' 右下角统计角标（默认关闭）'
      )
    ),
    // ── 导入/导出 ──
    h('h4', null, '配置导入 / 导出'),
    h('div', null,
      h('button', {
        className: 'mbgt-btn',
        onClick: async () => {
          try {
            const all = await store.getAll();
            setExportText(JSON.stringify(filterExportableKeys(all), null, 2));
            setMessage('已生成导出 JSON（复制保存即可）');
          } catch (e) { console.warn('[mbgt] panel export failed', e); }
        }
      }, '生成导出'),
      h('button', {
        className: 'mbgt-btn',
        onClick: async () => {
          try {
            let parsed: unknown;
            try { parsed = JSON.parse(importText); } catch { setMessage('导入失败：不是合法 JSON'); return; }
            const payload = validateImportPayload(parsed);
            if (!payload) { setMessage('导入失败：没有可导入的配置键'); return; }
            for (const [k, v] of Object.entries(payload)) await store.set(k, v);
            await reload();
            setMessage(`已导入 ${Object.keys(payload).length} 个配置键，重启页面后生效`);
          } catch (e) { console.warn('[mbgt] panel import failed', e); }
        }
      }, '导入'),
      h('button', {
        className: 'mbgt-btn',
        onClick: () => { unsafeLocationReload(); }
      }, '刷新页面')
    ),
    h('textarea', {
      value: importText, placeholder: '粘贴导出 JSON 后点导入',
      onInput: e => setImportText((e.target as HTMLTextAreaElement).value)
    }),
    exportText ? h('textarea', { value: exportText, readOnly: true }) : null,
    message ? h('div', { className: 'mbgt-muted' }, message) : null,
    h('div', { className: 'mbgt-muted' }, `MBGT v${MBGT_VERSION}`)
  );
}

/** 页内刷新（options 页不适用；PanelApp 在 options 中不渲染该按钮时传入 noReload） */
function unsafeLocationReload(): void {
  try {
    (globalThis as unknown as { location: { reload(): void } }).location.reload();
  } catch (e) { console.warn('[mbgt] reload unavailable', e); }
}

const PANEL_MOUNT_STYLE_ID = 'mbgt-panel-style';

export function mountFloatingPanel(opts: { store: KVStore; modules: ModuleInfo[] }): void {
  try {
    if (document.getElementById('mbgt-panel-chip')) return;
    if (!document.getElementById(PANEL_MOUNT_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = PANEL_MOUNT_STYLE_ID;
      style.textContent = PANEL_STYLE;
      document.head?.appendChild(style);
    }
    const chip = document.createElement('div');
    chip.id = 'mbgt-panel-chip';
    chip.textContent = '⚙ MBGT';
    chip.addEventListener('click', () => {
      let root = document.getElementById('mbgt-panel-root');
      if (root) {
        render(null, root);
        root.remove();
        return;
      }
      root = document.createElement('div');
      root.id = 'mbgt-panel-root';
      document.body?.appendChild(root);
      render(h(PanelApp, { store: opts.store, modules: opts.modules }) as any, root);
    });
    document.body?.appendChild(chip);
  } catch (e) {
    console.warn('[mbgt] floating panel mount failed', e);
  }
}
```

`packages/core/src/index.ts` 追加：

```ts
export { PanelApp, mountFloatingPanel, loadPanelData, type ModuleInfo, type PanelData } from './features/panel/panel';
```

同文件：把既有 `export const MBGT_VERSION = '0.1.0';` 行删除，改为 `export { MBGT_VERSION } from './version';`；并新建 `packages/core/src/version.ts`：

```ts
/** 版本单源：index.ts 对外导出、面板页脚展示都从这里取（避免 index↔panel 循环值引用） */
export const MBGT_VERSION = '0.1.0';
```

（Task 11 把这里的 `'0.1.0'` 与 userscript.meta.json、manifest.json 一起提到 `'0.2.0'`。）

- [ ] **Step 4: 两形态接线收口**

1. `packages/userscript/src/entry.ts`（在 Task 6 骨架上追加，全部包 try/catch）：

```ts
import { startStatsFlush, mountStatsBadge } from '@mbgt/core';
import { mountFloatingPanel } from '@mbgt/core';
import type { ModuleInfo } from '@mbgt/core';

try { startStatsFlush(store); } catch (e) { logger.warn('stats flush start failed', e); }
if (statsBadgeEnabled) {
  // 角标需 DOM 就绪；document_start 时 body 尚无——挂到 DOMContentLoaded 后
  const mountBadge = () => { try { mountStatsBadge({ store }); } catch { /* 降级 */ } };
  if (document.body) mountBadge();
  else document.addEventListener('DOMContentLoaded', mountBadge, { once: true });
}
const panelModules: ModuleInfo[] = allModules.map(m => ({ name: m.name, description: m.description }));
// 面板入口同样等 DOM 就绪
const mountPanel = () => { try { mountFloatingPanel({ store, modules: panelModules }); } catch { /* 降级 */ } };
if (document.body) mountPanel();
else document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
```

2. `packages/extension/src/main-entry.ts`：在设置回填的 async 块中追加（cdnHooksRef 回填保持 Task 6 代码，此处加统计与角标）：

```ts
import { startStatsFlush, mountStatsBadge } from '@mbgt/core';
// 设置回填块内追加：
  try { startStatsFlush(store); } catch (e) { logger.warn('stats flush start failed', e); }
  if (settings.statsBadge) {
    try { mountStatsBadge({ store }); } catch { /* 降级 */ }
  }
```

（扩展形态不挂页内浮层面板——面板入口=工具栏 options 页，见 Task 10。）

- [ ] **Step 5: 运行确认通过 + 三包 tsc + userscript 构建**

Run: `cd packages/core && npx vitest run`；三包 `npx tsc --noEmit`；`pnpm --filter @mbgt/userscript build`
Expected: 全绿；`.user.js` 构建成功（含 preact，体积增量 ~4KB gzip 量级）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Preact 设置+共存面板（模块三态开关/CDN 状态/统计/导入导出）+ userscript 浮层挂载"

```

---

### Task 10: 扩展 options 页升级为完整面板

**Files:**
- Modify: `packages/extension/src/options.ts`（全量替换）
- Modify: `packages/extension/src/options.html`（全量替换）
- Test: `packages/core/tests/panel-ui.test.ts`（追加 options 形态用例，复用 PanelApp——options 侧仅是挂载壳，组件本身已在 Task 9 测过）

**Interfaces:**
- Consumes: Task 9 `PanelApp`/`ModuleInfo`；core 的 `getDefaultModules`（取模块元数据列表）
- Produces: options 页 = 完整面板（chrome.storage 直连 KVStore 含 getAll；无"刷新页面"按钮依赖——options 页里该按钮调 options 自身 location.reload 无害，保留默认行为即可）

- [ ] **Step 1: options.ts 全量替换**

```ts
import { render } from 'preact';
import { h } from 'preact';
import {
  createLogger, getDefaultModules, PanelApp, type KVStore, type ModuleInfo
} from '@mbgt/core';

// 命名空间双解析 browser ?? chrome：Edge（Chromium 系）不提供 browser.*，仅 chrome.*
interface MbgtStorageLocal {
  get(key: string | string[] | null): Promise<{ [key: string]: any }>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
interface MbgtExtensionApi {
  storage: { local: MbgtStorageLocal };
}
const api = (globalThis as unknown as { browser?: MbgtExtensionApi; chrome?: MbgtExtensionApi }).browser
  ?? (globalThis as unknown as { chrome?: MbgtExtensionApi }).chrome;
if (!api) {
  document.getElementById('app')!.textContent = '扩展存储 API 不可用';
  throw new Error('extension storage API unavailable (browser/chrome)');
}

// options 页运行在扩展上下文：直连 chrome.storage.local（含 getAll，无需桥接）
const store: KVStore = {
  async get(key) { return (await api.storage.local.get(key))[key]; },
  async set(key, value) { await api.storage.local.set({ [key]: value }); },
  async delete(key) { await api.storage.local.remove(key); },
  async getAll() { return await api.storage.local.get(null); }
};

const logger = createLogger(console);
// 扩展形态：即时模块（无 conflicts）锁定不可关（document-start 裁定）；deferred 模块可三态切换
const mods = getDefaultModules(logger);
const panelModules: ModuleInfo[] = mods.map(m => ({ name: m.name, description: m.description, locked: !m.conflicts?.length }));

const root = document.getElementById('app')!;
root.textContent = '';
try {
  render(h(PanelApp, { store, modules: panelModules }) as any, root);
} catch (e) {
  root.textContent = '面板渲染失败（不影响核心拦截）';
  console.warn('[mbgt] options panel render failed', e);
}
```

- [ ] **Step 2: options.html 全量替换**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Make Bilibili Great Together</title>
  <style>
    body { font: 14px/1.6 system-ui, sans-serif; margin: 0; padding: 16px; background: #f6f6f6; }
    #app { max-width: 420px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="app">加载中…</div>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 3: 构建 + 编译验证**

Run: `pnpm --filter @mbgt/extension build`；`npx tsc --noEmit`（extension 包）
Expected: 构建成功；dist/options.js 体积含 preact

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 扩展 options 页升级为完整设置+共存面板（直连 storage.local，即时模块锁定）"

```

---

### Task 11: 构建/CI/README/版本号 0.2.0

**Files:**
- Modify: `packages/core/src/version.ts`（`MBGT_VERSION = '0.2.0'`，Task 9 建立的版本单源）
- Modify: `packages/userscript/userscript.meta.json`（`version: "0.2.0"`）
- Modify: `packages/extension/src/manifest.json`（`version: "0.2.0"`）
- Modify: `README.md`（新增「设置与面板」「CDN 选优」「拦截统计」三段 + 双形态差异说明）
- Modify: `.github/workflows/ci.yml`（若 Task 4 未加 `background.js` 断言则补上——已加则跳过）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 可发版状态（tag 发版在 Task 12 冒烟通过后执行）

- [ ] **Step 1: 三处版本号改 0.2.0**

`packages/core/src/version.ts`：`export const MBGT_VERSION = '0.2.0';`
`packages/userscript/userscript.meta.json`：`"version": "0.2.0"`
`packages/extension/src/manifest.json`：`"version": "0.2.0"`

- [ ] **Step 2: README 增补（在双形态安装段之后追加）**

```markdown
## 设置与面板（v0.2.0）

- **userscript 形态**：页面右下角 `⚙ MBGT` 胶囊打开悬浮面板；油猴菜单的模块开关与面板共用同一配置键（`mbgt:override:*`，三值：默认开 / `off` 关闭 / `force-on` 强制开启）。
- **扩展形态**：工具栏图标 → options 页即面板。即时模块（反跟踪、防 P2P 等无冲突 9 项）在扩展形态**锁定不可关**——这是为保住 document-start 拦截语义的刻意取舍（接线层异步读设置赶不上页面内联脚本）；带冲突的 6 项可三态切换。
- **共存面板**：显示探测到的 BewlyCat/AveMujica 与自动停用原因；`force-on` 可压过自动停用（用户拍板优先）。
- **配置导入/导出**：面板底部生成/导入 JSON；仅覆盖配置类键（override / CDN 开关 / 角标开关），运行数据不进导出文件。

## CDN 智能选优

playinfo 中出现镜像候选时自动探测（每候选小体积 range 请求、2s 超时淘汰），按延迟固定最优宿主；结果缓存 5 分钟；全部候选失败自动回退上游的随机镜像策略。userscript 走 `GM_xmlhttpRequest`（已声明 `@connect bilivideo.com`），扩展走 isolated 世界直连（已申请 `*://*.bilivideo.com/*`）。无有效 SSL 证书的 `upos-sz-mirror14b` 始终排除。

## 拦截统计

各拦截点按类计数（sendBeacon 假实现、上报 fetch/XHR 拦截、localStorage 挡写、P2P 替换、WebRTC mock、AV1 拦截），扩展形态另有 DNR 网络层命中统计（后台 service worker 汇总）。计数 30 秒节流落盘、跨会话累加；右下角角标默认关闭，面板中开启。统计收集始终运行、开销极低；展示环节任何故障不影响拦截。
```

- [ ] **Step 3: 全量验证**

Run: 根目录 `pnpm lint && pnpm test && pnpm build`（按仓库根脚本实际形态执行；若根脚本未聚合则逐包执行）
Expected: lint 0 error、测试全绿、三产物齐全（`.user.js` / `extension.zip` 含 background.js / options.js 含面板）

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "chore: v0.2.0 版本号 + README 设置/面板/CDN/统计说明"
git -c http.proxy=http://127.0.0.1:3067 push origin main
```

---

### Task 12: 真机冒烟（双形态）+ tag 发版

**Files:** 无代码；冒烟清单 + 发版动作

**Interfaces:** 无

- [ ] **Step 1: 冒烟前置状态（执行者记录，勿自行切换用户浏览器设置）**

用户已把 userscript 启用、扩展禁用（Plan 4 开工时状态）。冒烟顺序：先 userscript 后扩展（扩展侧需要重载 dist——用 edge://extensions 页面上下文的 `chrome.developerPrivate.reload('naephbpbijnomloddmldmgmfcjhikbac')` 自动完成，无需用户点界面）。

- [ ] **Step 2: userscript 冒烟清单（ScriptCat 已启用新版）**

1. 重装/更新脚本（dist `.user.js` 拖入 ScriptCat 或其文件监听）→ bilibili 首页
2. 控制台：`[mbgt]` 模块日志照旧；新增 `CDN probe finished: best=…` 或 `all candidates failed`（视频页触发更稳）
3. 右下角 `⚙ MBGT` 胶囊出现 → 打开面板：模块开关列表（三态切换文案）、共存状态、统计表
4. 面板里把 `no-ad` 切到 off → 刷新页面 → 控制台出现 `[no-ad] disabled via menu -- skipping`（菜单/面板同键）→ 面板切回默认 → 刷新恢复
5. 面板开 `mbgt:ui:stats-badge` → 刷新 → 右下角角标出现且计数增长（发弹幕/切页制造拦截事件）
6. 视频页播放正常；`window.RTCPeerConnection` 为 Mock（Plan 3 冒烟同项复验）；`localStorage.length` 正常
7. 导出 JSON → 清空面板配置 → 导入回填 → 重启生效

- [ ] **Step 3: 扩展冒烟清单（developerPrivate.reload 后）**

1. 重载后无 manifest 错误（developerPrivate.getExtensionsInfo errors=0）
2. options 页 = 完整面板；即时模块锁定灰显；deferred 6 项可切换
3. bilibili 首页+视频页：`[mbgt]` 日志照旧；`mbgt:cdn:probe` 默认 true → 控制台探测日志或 options 页 CDN 区出现探测结果
4. DNR 拦截照旧（`data.bilibili.com`/`cm.bilibili.com` ERR_BLOCKED_BY_CLIENT）；options 页统计出现 `DNR 网络层拦截` 计数（background 落盘）
5. 面板关闭 `mbgt:cdn:probe` → 下个页面探测不再发生（当页首跳可发生——已知裁定，不算失败）
6. userscript 与扩展仍二选一：冒烟扩展时 ScriptCat 里脚本需停用（当前用户已停用脚本？——按 Step 1 状态相反，执行者切换后**必须恢复**到 Step 1 记录的状态）

- [ ] **Step 4: tag 发版（冒烟全过后，若用户无异议）**

```bash
git tag v0.2.0 && git -c http.proxy=http://127.0.0.1:3067 push origin v0.2.0
```

发版流水线（tag-only 触发 + 自动 release notes）自动出 `.user.js` 与 `extension.zip`；随后 jsDelivr 通道 `@v0.2.0` 可用。发版前与用户确认一次（tag-only 纪律）。

---

## 交付标准（Plan 4 完成定义）

1. `pnpm test` 全绿（≥80 用例：新增 stats/dnr/cdn-probe/wiring/badge/panel-model/panel-ui 等）；三包 tsc 零错误；lint 0 error
2. 真机冒烟 12 项通过（Step 2 七项 + Step 3 五项）
3. CI 绿（含 background.js 产物断言）
4. README 三段新说明 + 版本三处一致 0.2.0
5. `v0.2.0` tag 发版完成（Releases 含 .user.js + extension.zip）

## 已知取舍（冒烟不算失败的项）

- 扩展形态即时模块无关闭开关（document-start 语义裁定）
- 扩展形态 `mbgt:cdn:probe=false` 当页首跳探测仍可能发生（设置异步回填晚于内联 playinfo 解析）
- DNR 计数依赖 `declarativeNetRequestFeedback` + unpacked 加载（本项目分发模型满足；packed 安装则该项统计静默缺失）
- 面板数据为"打开时读取+手动刷新"快照，不做实时 onChange 推送（YAGNI）
