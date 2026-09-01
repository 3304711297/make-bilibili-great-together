# Plan 2: 共存感知 + compat 元数据生效（里程碑 3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引擎获得"检测到 BewlyCat/AveMujica 时自动停用重复模块"的能力，冲突表按 spec §3.3 落地，userscript 形态端到端生效（含手动覆盖存储契约）。

**Architecture:** 探测/冲突解析/存储接口全部放在 core（平台无关），userscript 包负责接线（document、调度器、GM 存储）。无冲突模块在 document-start 立即注册；带 `conflicts` 的模块延迟到探测结算后经新 API `CoreInstance.registerModules()` 注册。探测结算结果写入存储键 `mbgt:compat:status` 供 Plan 4 面板消费。

**Tech Stack:** TypeScript 5（strict）、Vitest（fake timers + 注入式调度器，不用 jsdom）、既有 rollup 链。

**Spec:** `docs/superpowers/specs/2026-08-30-make-bilibili-great-together-design.md` §3（模块系统与共存感知）、§5（存储与错误处理）

## Global Constraints

- TypeScript strict；双包 `tsc --noEmit` 零错误；`pnpm lint` 零 error
- 移植保真约束继续适用：本计划不改任何模块的既有逻辑，只允许给模块对象**新增 `conflicts` 字段**
- 中文 commit message
- 测试不依赖真实网络/浏览器；vitest node 环境无 DOM——探测器的 DOM 查询经注入的 `snapshot` 函数抽象，测试注入假快照
- 探测参数（spec §3.2）：轮询间隔 200ms、超时 10000ms、超时未命中特征视为"未安装"
- 优先级裁定（本计划新增，spec §3.2 的落地解释）：仅 BewlyCat 识别成功 → 用 BewlyCat 表；仅 AveMujica → 用 AveMujica 表；两者都识别成功 → 两表并集（两扩展的功能都真实在场）；家族在场但特征不足（generic）→ 用两表并集（保守禁用）。手动覆盖 `mbgt:override:<module>` === `'force-on'` 优先于探测禁用，菜单禁用优先于一切
- 冲突表（spec §3.3；optimize-story 两项为 **provisional**，等真机实测后可在 Plan 3 前修订，代码里以常量注释标注）：
  - `no-ad`、`optimize-homepage`、`remove-useless-url-params` → bewlycat + avemujica
  - `optimize-story` → bewlycat + avemujica（provisional）
  - `player-video-fit` → 仅 bewlycat
  - `use-system-fonts` → 仅 avemujica
- 探测特征（已对两仓库源码交叉验证）：
  - 家族信号：`#bewly[data-version]`（两者挂载点完全同源）
  - BewlyCat 独有：`[bewly-auto-exit-listener]`、`.bewly-watch-later-btn`
  - AveMujica 独有：`#bewly-bottom-comment-style`
- 探测机制裁定：用注入式轮询（200ms + 超时 10s）而非 MutationObserver——spec §3.2 的"observer + 轮询兜底"语义由轮询单独满足（可测、无 observer 生命周期管理）；观察器优化留给后续计划。快照三态契约：`null`＝未装（继续轮询）；`'pending-family'`＝家族在场但特征未现（继续轮询，超时后按 generic 结算）；完整 `ProbeResult`＝特征命中（立即结算）。首次快照在启动时同步执行一次

---

### Task 1: core — KVStore 接口与 compat 状态类型

**Files:**
- Create: `packages/core/src/platform/storage.ts`, `packages/core/src/platform/compat-types.ts`
- Modify: `packages/core/src/index.ts`（追加导出）
- Test: `packages/core/tests/platform-storage.test.ts`

**Interfaces:**
- Consumes: 无
- Produces（Task 3/5 依赖，签名逐字为准）:
  - `interface KVStore { get<T>(key: string): Promise<T | undefined>; set<T>(key: string, value: T): Promise<void>; delete(key: string): Promise<void> }`
  - `createMemoryKVStore(): KVStore`（测试与无存储环境兜底）
  - `const OVERRIDE_PREFIX = 'mbgt:override:'`、`const COMPAT_STATUS_KEY = 'mbgt:compat:status'`
  - `interface CompatStatus { family: 'bewly' | null; extensions: string[]; generic: boolean; autoDisabled: { module: string; extension: string; feature: string }[]; settledAt: number }`
  - `function readForceOnOverrides(store: KVStore, moduleNames: string[]): Promise<Set<string>>`（读每个 `OVERRIDE_PREFIX + name`，值 === `'force-on'` 收入 Set）

- [ ] **Step 1: 写失败测试**

`packages/core/tests/platform-storage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryKVStore, readForceOnOverrides, OVERRIDE_PREFIX } from '../src/platform/storage';

describe('createMemoryKVStore', () => {
  it('set 后 get 返回同值，delete 后返回 undefined', async () => {
    const store = createMemoryKVStore();
    await store.set('a', { x: 1 });
    expect(await store.get('a')).toEqual({ x: 1 });
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });

  it('get 未设置的键返回 undefined', async () => {
    const store = createMemoryKVStore();
    expect(await store.get('nope')).toBeUndefined();
  });
});

describe('readForceOnOverrides', () => {
  it('仅收集值为 force-on 的键', async () => {
    const store = createMemoryKVStore();
    await store.set(`${OVERRIDE_PREFIX}no-ad`, 'force-on');
    await store.set(`${OVERRIDE_PREFIX}no-p2p`, 'other');
    const names = ['no-ad', 'no-p2p', 'use-system-fonts'];
    const overrides = await readForceOnOverrides(store, names);
    expect(overrides.has('no-ad')).toBe(true);
    expect(overrides.has('no-p2p')).toBe(false);
    expect(overrides.has('use-system-fonts')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/platform-storage.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/platform/storage.ts`:

```ts
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
```

`packages/core/src/platform/compat-types.ts`（探测层共享类型，Task 2/3 消费）:

```ts
export type ExtensionId = 'bewlycat' | 'avemujica';

export interface DetectedExtension {
  id: ExtensionId;
  version: string | null;
}

export interface ProbeResult {
  family: 'bewly' | null;
  extensions: DetectedExtension[];
  /** 家族在场但无法定位到具体扩展（特征不足/超时），按保守并集处理 */
  generic: boolean;
}

/** 三态快照：null=未装；'pending-family'=家族在场等特征；ProbeResult=特征命中即结算 */
export type SnapshotResult = ProbeResult | 'pending-family' | null;

export interface CompatProbeOptions {
  snapshot: () => SnapshotResult;
  intervalMs?: number;
  timeoutMs?: number;
  /** 返回取消函数；测试注入假调度器 */
  scheduler: (cb: () => void, ms: number) => () => void;
  onSettle: (result: ProbeResult) => void;
}

export function startCompatProbe(options: CompatProbeOptions): void {
  const { snapshot, scheduler, onSettle } = options;
  const intervalMs = options.intervalMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 10_000;

  let settled = false;
  const settle = (result: ProbeResult) => {
    if (settled) return;
    settled = true;
    cancelInterval();
    cancelTimeout();
    onSettle(result);
  };

  const settleFromSnapshot = () => {
    const result = snapshot();
    // 仅特征命中（完整 ProbeResult）触发结算；null 与 pending-family 继续轮询
    if (result !== null && result !== 'pending-family') settle(result);
  };

  const cancelInterval = loop(settleFromSnapshot);
  const cancelTimeout = scheduler(() => {
    const result = snapshot();
    if (result === 'pending-family') {
      // 家族在场但特征始终未现：按保守 generic 结算
      settle({ family: 'bewly', extensions: [], generic: true });
    } else {
      settle({ family: null, extensions: [], generic: false });
    }
  }, timeoutMs);
  // 启动时同步查一次（cancelInterval/cancelTimeout 已赋值，TDZ 安全）
  settleFromSnapshot();

  function loop(cb: () => void): () => void {
    let cancelled = false;
    const tick = () => {
      if (cancelled || settled) return;
      cb();
      scheduler(tick, intervalMs);
    };
    scheduler(tick, intervalMs);
    return () => { cancelled = true; };
  }
}
```

`packages/core/src/index.ts` 追加导出：

```ts
export { createMemoryKVStore, readForceOnOverrides, OVERRIDE_PREFIX, COMPAT_STATUS_KEY, type KVStore, type CompatStatus } from './platform/storage';
export { startCompatProbe, type ExtensionId, type DetectedExtension, type ProbeResult, type SnapshotResult, type CompatProbeOptions } from './platform/compat-types';
```

- [ ] **Step 4: 运行测试通过 + 全量回归**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit`
Expected: 全部 PASS（含既有 30 用例）、tsc 零错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): KVStore 接口与 compat 探测类型/调度骨架"
```

---

### Task 2: core — startCompatProbe 单测（假快照 + 假调度器）

**Files:**
- Test: `packages/core/tests/compat-probe.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `startCompatProbe`、`ProbeResult`
- Produces: 探测器行为契约锁定（结算条件/超时路径/取消语义）——Task 4 接线时依赖

- [ ] **Step 1: 写测试（先于任何实现改动，探测器已在 Task 1 落地，此任务纯锁行为）**

`packages/core/tests/compat-probe.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { startCompatProbe, type ProbeResult } from '../src/platform/compat-types';

/** 假调度器：收集任务，测试手动推进时间 */
function fakeScheduler() {
  const tasks: { cb: () => void; at: number; cancelled: boolean }[] = [];
  let now = 0;
  const schedule = (cb: () => void, ms: number) => {
    const task = { cb, at: now + ms, cancelled: false };
    tasks.push(task);
    return () => { task.cancelled = true; };
  };
  return {
    schedule,
    advance(ms: number) {
      now += ms;
      for (const t of [...tasks].sort((a, b) => a.at - b.at)) {
        if (!t.cancelled && t.at <= now) { t.cancelled = true; t.cb(); }
      }
    }
  };
}

const NO_FAMILY: ProbeResult = { family: null, extensions: [], generic: false };

describe('startCompatProbe', () => {
  it('特征命中→启动时同步结算，首个 tick 前完成', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({
      snapshot: () => ({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.7.8' }], generic: false }),
      scheduler: s.schedule,
      onSettle
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.7.8' }], generic: false });
    s.advance(10_000);
    expect(onSettle).toHaveBeenCalledTimes(1); // 结算后不再触发
  });

  it("pending-family（家族在场特征未现）→ 不提前结算，超时后按 generic 结算", () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({
      snapshot: () => 'pending-family',
      scheduler: s.schedule,
      onSettle
    });
    s.advance(9_999);
    expect(onSettle).not.toHaveBeenCalled();
    s.advance(1);
    expect(onSettle).toHaveBeenCalledWith({ family: 'bewly', extensions: [], generic: true });
  });

  it('超时且家族信号消失→按未安装结算', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({ snapshot: () => NO_FAMILY, scheduler: s.schedule, onSettle });
    s.advance(10_000);
    expect(onSettle).toHaveBeenCalledWith({ family: null, extensions: [], generic: false });
  });

  it('pending-family 期间特征出现→立即结算，不再等超时', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    let result: 'pending-family' | null = 'pending-family';
    startCompatProbe({ snapshot: () => result, scheduler: s.schedule, onSettle });
    expect(onSettle).not.toHaveBeenCalled(); // 启动同步查询是 pending，不结算
    result = { family: 'bewly', extensions: [{ id: 'avemujica', version: '1.8.31' }], generic: false };
    s.advance(200);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.advance(10_000);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认通过（若失败则是 Task 1 实现缺陷，修复至通过）**

Run: `cd packages/core && pnpm vitest run tests/compat-probe.test.ts`
Expected: 4 用例 PASS。特别核对第 2 用例：9_999ms 时**不得**结算（timeout 边界）

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(core): compat 探测器行为契约（命中/超时 generic/未安装/单次结算）"
```

---

### Task 3: core — 冲突表与 resolveConflicts 纯函数

**Files:**
- Create: `packages/core/src/features/compat/resolve.ts`
- Modify: `packages/core/src/index.ts`（追加导出）
- Test: `packages/core/tests/compat-resolve.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ProbeResult`、`ExtensionId`；既有 `ModuleMeta`
- Produces（Task 5 依赖）:
  - `const CONFLICT_TABLE: Record<ExtensionId, Record<string, string>>`（module 名 → 对方功能标识；按 Global Constraints 的表逐字落地）
  - `function resolveConflicts(modules: ModuleMeta[], probe: ProbeResult, menuDisabledNames: ReadonlySet<string>, forceOnOverrides: ReadonlySet<string>): { enabled: ModuleMeta[]; autoDisabled: { module: string; extension: string; feature: string }[] }`
  - 语义：probe.extensions 中每个 id 取 CONFLICT_TABLE[id] 行；generic=true 时取两行**并集**（同模块 feature 取 bewlycat 行值，无则 avemujica 行值）；menuDisabledNames 中的模块不进 enabled 也不进 autoDisabled（菜单已禁，与共存无关）；forceOnOverrides 命中的模块无视冲突进 enabled；其余命中的进 autoDisabled

- [ ] **Step 1: 写失败测试**

`packages/core/tests/compat-resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveConflicts, CONFLICT_TABLE } from '../src/features/compat/resolve';
import type { ModuleMeta } from '../src/types';

const mod = (name: string): ModuleMeta => ({ name, description: '' });
const ALL = ['no-ad', 'optimize-homepage', 'remove-useless-url-params', 'optimize-story', 'player-video-fit', 'use-system-fonts'].map(mod);

describe('CONFLICT_TABLE', () => {
  it('与 spec §3.3 一致（含 provisional 的 optimize-story）', () => {
    expect(Object.keys(CONFLICT_TABLE.bewlycat).sort()).toEqual(
      ['no-ad', 'optimize-homepage', 'optimize-story', 'player-video-fit', 'remove-useless-url-params']);
    expect(Object.keys(CONFLICT_TABLE.avemujica).sort()).toEqual(
      ['no-ad', 'optimize-homepage', 'optimize-story', 'remove-useless-url-params', 'use-system-fonts']);
  });
});

describe('resolveConflicts', () => {
  it('未检测到扩展→全部 enabled，无 autoDisabled', () => {
    const r = resolveConflicts(ALL, { family: null, extensions: [], generic: false }, new Set(), new Set());
    expect(r.enabled).toHaveLength(6);
    expect(r.autoDisabled).toEqual([]);
  });

  it('仅 BewlyCat→其表内 5 个禁用，use-system-fonts 保留', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [{ id: 'bewlycat', version: null }], generic: false }, new Set(), new Set());
    expect(r.enabled.map(m => m.name)).toEqual(['use-system-fonts']);
    expect(r.autoDisabled.map(d => d.extension)).toEqual(new Array(5).fill('bewlycat'));
  });

  it('仅 AveMujica→其表内 5 个禁用，player-video-fit 保留', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [{ id: 'avemujica', version: null }], generic: false }, new Set(), new Set());
    expect(r.enabled.map(m => m.name)).toEqual(['player-video-fit']);
  });

  it('两者都在→并集 6 个全禁用', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [{ id: 'bewlycat', version: null }, { id: 'avemujica', version: null }], generic: false }, new Set(), new Set());
    expect(r.enabled).toHaveLength(0);
    expect(r.autoDisabled).toHaveLength(6);
  });

  it('generic→保守并集，同样 6 个全禁用', () => {
    const r = resolveConflicts(ALL, { family: 'bewly', extensions: [], generic: true }, new Set(), new Set());
    expect(r.enabled).toHaveLength(0);
  });

  it('force-on 覆盖冲突禁用，但不覆盖菜单禁用', () => {
    const menuDisabled = new Set(['optimize-homepage']);
    const r = resolveConflicts(ALL,
      { family: 'bewly', extensions: [{ id: 'bewlycat', version: null }], generic: false },
      menuDisabled, new Set(['no-ad']));
    expect(r.enabled.map(m => m.name)).toEqual(['no-ad', 'use-system-fonts']);
    expect(r.autoDisabled.map(d => d.module)).not.toContain('no-ad');
    expect(r.autoDisabled.map(d => d.module)).not.toContain('optimize-homepage');
    expect(r.autoDisabled).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/compat-resolve.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/features/compat/resolve.ts`:

```ts
import type { ExtensionId, ProbeResult } from '../../platform/compat-types';
import type { ModuleMeta } from '../../types';

/** module 名 → 对方功能标识（spec §3.3；optimize-story 两项 provisional，待真机实测后修订） */
export const CONFLICT_TABLE: Record<ExtensionId, Record<string, string>> = {
  bewlycat: {
    'no-ad': 'blockAds / 首页重构',
    'optimize-homepage': '首页重构',
    'remove-useless-url-params': 'cleanUrlArgument',
    'optimize-story': '动态页改造（provisional）',
    'player-video-fit': 'bewlyWidescreen / 播放器样式'
  },
  avemujica: {
    'no-ad': 'blockAds / 首页重构',
    'optimize-homepage': '首页重构',
    'remove-useless-url-params': 'cleanUrlArgument',
    'optimize-story': '动态页改造（provisional）',
    'use-system-fonts': 'customizeFont（默认启用自家推荐字体）'
  }
};

export function resolveConflicts(
  modules: ModuleMeta[],
  probe: ProbeResult,
  menuDisabledNames: ReadonlySet<string>,
  forceOnOverrides: ReadonlySet<string>
): { enabled: ModuleMeta[]; autoDisabled: { module: string; extension: string; feature: string }[] } {
  const enabled: ModuleMeta[] = [];
  const autoDisabled: { module: string; extension: string; feature: string }[] = [];

  // 生效的冲突行：specific 扩展各自一行；generic 取两行并集（同模块 bewlycat 行优先）
  const activeRows: Record<string, { extension: ExtensionId; feature: string }>[] = [];
  const specific = probe.extensions.map(e => e.id);
  if (probe.generic || specific.length === 0) {
    // generic 或"家族在场但无 specific"：并集
    activeRows.push(mergedRow());
  }
  for (const id of specific) {
    activeRows.push(rowOf(id));
  }

  for (const mod of modules) {
    if (menuDisabledNames.has(mod.name)) continue;
    if (forceOnOverrides.has(mod.name)) { enabled.push(mod); continue; }
    const hit = activeRows.find(row => row[mod.name] !== undefined);
    if (hit) {
      const { extension, feature } = hit[mod.name];
      autoDisabled.push({ module: mod.name, extension, feature });
    } else {
      enabled.push(mod);
    }
  }
  return { enabled, autoDisabled };
}

function rowOf(id: ExtensionId): Record<string, { extension: ExtensionId; feature: string }> {
  const out: Record<string, { extension: ExtensionId; feature: string }> = {};
  for (const [modName, feature] of Object.entries(CONFLICT_TABLE[id])) {
    out[modName] = { extension: id, feature };
  }
  return out;
}

function mergedRow(): Record<string, { extension: ExtensionId; feature: string }> {
  const out = rowOf('avemujica');
  for (const [modName, feature] of Object.entries(CONFLICT_TABLE.bewlycat)) {
    out[modName] = { extension: 'bewlycat', feature };
  }
  return out;
}
```

`packages/core/src/index.ts` 追加：

```ts
export { CONFLICT_TABLE, resolveConflicts } from './features/compat/resolve';
```

- [ ] **Step 4: 运行通过 + 回归 + 类型检查**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit`
Expected: 全 PASS（36 用例）、tsc 零错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): 冲突表与 resolveConflicts 纯函数（specific/generic/并集/覆盖语义）含单测"
```

---

### Task 4: core — 引擎支持晚注册（registerModules + 迟到样式注入）

**Files:**
- Modify: `packages/core/src/engine/scheduler.ts`、`packages/core/src/index.ts`（CoreInstance 类型出口）
- Test: `packages/core/tests/engine-late-register.test.ts`

**Interfaces:**
- Consumes: 既有 `createCore`/`CoreInstance`
- Produces（Task 5 依赖）: `CoreInstance.registerModules(modules: ModuleMeta[]): void`——对每个模块按当前 `unsafeWindow.location` 执行与初始调度相同的页面钩子分发，并把其间收集的 addStyle 立即注入（幂等：同一 style 字符串只注入一次）。**约束：registerModules 必须可在 document-start 之后的任意时刻调用，不得重复注入初始已注入的样式**

- [ ] **Step 1: 写失败测试**

`packages/core/tests/engine-late-register.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';

function fakeWindow(pathname = '/video/BV1') {
  return {
    fetch: vi.fn(async () => new Response('original')),
    console,
    location: { hostname: 'www.bilibili.com', pathname },
    XMLHttpRequest: class { open() {} send() {} },
    document: {
      adoptedStyleSheets: [] as unknown[],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    CSSStyleSheet: class { replaceSync() {} }
  } as unknown as Window & typeof globalThis;
}

describe('CoreInstance.registerModules（晚注册）', () => {
  it('晚注册模块的 onBeforeFetch 生效于后续 fetch', async () => {
    const w = fakeWindow();
    const core = createCore({ modules: [], console, unsafeWindow: w });
    const spy = w.fetch as ReturnType<typeof vi.fn>;
    core.registerModules([{
      name: 'late', description: '',
      any(h) { h.onBeforeFetch(() => new Response('late-blocked')); }
    }]);
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('late-blocked');
    expect(spy).not.toHaveBeenCalled();
    core.onUnload();
  });

  it('晚注册按当前 location 分发页面钩子（video 页触发 onVideo）', () => {
    const w = fakeWindow('/video/BV1');
    const calls: string[] = [];
    const core = createCore({ modules: [], console, unsafeWindow: w });
    core.registerModules([{ name: 'p', description: '', onVideo: () => calls.push('video'), onLive: () => calls.push('live') }]);
    expect(calls).toEqual(['video']);
    core.onUnload();
  });

  it('晚注册的 addStyle 立即注入且不重复', () => {
    const w = fakeWindow();
    const core = createCore({ modules: [], console, unsafeWindow: w });
    const mod = {
      name: 's', description: '',
      any(h) { h.addStyle('body{color:red}'); h.addStyle('a{color:blue}'); }
    };
    core.registerModules([mod, mod]); // 同模块注册两次，样式字符串去重后 2 条
    const doc = (w as any).document;
    expect(doc.adoptedStyleSheets.length).toBe(2);
    core.registerModules([{ name: 's2', description: '', any(h) { h.addStyle('body{color:red}'); } }]);
    expect(doc.adoptedStyleSheets.length).toBe(2); // 重复字符串不重复注入
    core.onUnload();
  });

  it('初始模块的样式不被 registerModules 重复注入', () => {
    const w = fakeWindow();
    const shared = { name: 'init', description: '', any(h) { h.addStyle('p{color:green}'); } };
    const core = createCore({ modules: [shared], console, unsafeWindow: w });
    expect(((w as any).document.adoptedStyleSheets).length).toBe(1);
    core.registerModules([shared]);
    expect(((w as any).document.adoptedStyleSheets).length).toBe(1);
    core.onUnload();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/engine-late-register.test.ts`
Expected: FAIL（`core.registerModules is not a function`）

- [ ] **Step 3: 实现（scheduler.ts 改造）**

改造要点（保持既有测试全绿）：
1. 把 `dispatchModules` 的单模块循环体抽成 `dispatchModule(mod, hook, unsafeWindow)`（含 Task 6 最终修复波次加入的 `runHook` 日志，逻辑不变）
2. 样式注入改为**去重集合 + 可重复 flush**：`const injectedStyles = new Set<string>()`；`function flushStyles()` 遍历 `styles` 中未注入的条目，CSSOM 路径每条样式各建一个 `CSSStyleSheet`（复用既有 `unsafeWindow.CSSStyleSheet` 探测逻辑）push 进 `adoptedStyleSheets`，降级路径每条样式 append 一个 `<style>`；`createCore` 末尾与每次 `registerModules` 后各 flush 一次。**初始一次性注入行为被此实现覆盖（首 flush 注入全部初始样式），既有 scheduler 样式测试（adopted.length === 1，注入 'body{color:red}' 一条）必须继续通过**
3. `CoreInstance` 增加 `registerModules(newModules: ModuleMeta[]): void`：对每个模块 `dispatchModule`，然后 `flushStyles()`
4. `packages/core/src/index.ts` 的 `CoreInstance` 类型出口同步更新（若类型定义在 scheduler.ts 内则改那里并确认 index 的 re-export 自动跟随）

- [ ] **Step 4: 全量测试通过 + 双包类型检查**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit && cd ../userscript && npx tsc --noEmit`
Expected: 全 PASS（40 用例）、双包 tsc 零错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): CoreInstance.registerModules 支持晚注册（页面分发+样式去重幂等注入）"
```

---

### Task 5: 模块补 conflicts 元数据（5 个文件，纯新增字段）

**Files:**
- Modify: `packages/core/src/modules/no-ad.ts`、`optimize-homepage.ts`、`remove-useless-url-params.ts`、`optimize-story.ts`、`player-video-fit.ts`、`use-system-fonts.ts`（6 个，各 1 处）
- Test: 无新增（Task 6 的接线测试 + resolve 测试已覆盖）

**Interfaces:**
- Consumes: Task 1 `types.ts` 的 `CompatConflict`（`{ extension: 'bewlycat' | 'avemujica'; feature: string }`，已在 `ModuleMeta.conflicts?` 定义）
- Produces: 6 个模块的返回对象带 `conflicts` 字段——Task 6 接线按 `m.conflicts?.length` 区分立即/延迟注册

- [ ] **Step 1: 逐文件给返回对象字面量加 conflicts**

按 Global Constraints 冲突表，各模块 return 对象内 `description` 行之后加（保留其余一切不动）：

```ts
// no-ad.ts / optimize-homepage.ts / remove-useless-url-params.ts / optimize-story.ts 四个：
conflicts: [
  { extension: 'bewlycat', feature: '...' },   // feature 文案从 CONFLICT_TABLE 对应行复制
  { extension: 'avemujica', feature: '...' }
],
```

`player-video-fit.ts` 只有 bewlycat 行；`use-system-fonts.ts` 只有 avemujica 行。

一致性硬约束：模块内 `conflicts[].feature` 文案必须与 `CONFLICT_TABLE` 同名行**逐字一致**（单一真源问题在 Plan 4 面板前接受双写，Plan 4 统一收敛到 CONFLICT_TABLE 单源）。

- [ ] **Step 2: 全量回归 + 类型检查**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit`
Expected: 全 PASS（44 用例，模块行为零变化）、tsc 零错误

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(core): 6 个冲突模块补 compat 元数据（纯新增 conflicts 字段，feature 文案与冲突表逐字一致）"
```

---

### Task 6: userscript 接线（探测→解析→晚注册）+ GM KVStore 实现

**Files:**
- Create: `packages/userscript/src/gm-storage.ts`
- Modify: `packages/userscript/src/entry.ts`、`packages/userscript/src/module-menu.ts`（`getModuleEnabledSync` 参数如为 mod 对象改收 `name: string`，同步更新调用）
- Test: `packages/core/tests/compat-e2e.test.ts`（core 层端到端：假快照驱动完整链路）

**Interfaces:**
- Consumes: Task 1 `startCompatProbe/KVStore`、Task 3 `resolveConflicts/CONFLICT_TABLE`、Task 4 `registerModules`、既有 `getModuleEnabledSync`
- Produces: userscript 产物行为——无冲突模块照常即时生效；冲突模块在探测结算后注册/禁用；`mbgt:compat:status` 落盘

- [ ] **Step 1: 写 core 层端到端失败测试**

`packages/core/tests/compat-e2e.test.ts`（用 createMemoryKVStore + 假调度器 + 假 window，把 Task 1-4 串起来）:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import { startCompatProbe } from '../src/platform/compat-types';
import { createMemoryKVStore, readForceOnOverrides, COMPAT_STATUS_KEY } from '../src/platform/storage';
import { resolveConflicts } from '../src/features/compat/resolve';

// 结构复用 fakeScheduler 与 fakeWindow（从 compat-probe/engine-late-register 的既有写法复制，勿 import 测试文件）

describe('compat 端到端：立即注册 + 延迟注册 + 状态落盘', () => {
  it('BewlyCat 在场时：无冲突模块即时注册，冲突模块结算后被禁用不注册', async () => {
    const w = fakeWindow('/video/BV1');
    const store = createMemoryKVStore();
    const immediateCalls: string[] = [];
    const spy = w.fetch as ReturnType<typeof vi.fn>;

    // 模拟 entry 的装配逻辑（与 Task 6 Step 3 的 entry.ts 一致）
    const allModules = [
      { name: 'net-module', description: '', any(h) { h.onBeforeFetch(() => new Response('blocked-by-net')); } },
      { name: 'no-ad', description: '', conflicts: [{ extension: 'bewlycat', feature: 'blockAds / 首页重构' }], any(h) { h.addStyle('.ad{display:none}'); } }
    ] as any[];
    const immediate = allModules.filter(m => !m.conflicts?.length);
    const deferred = allModules.filter(m => m.conflicts?.length);
    const core = createCore({ modules: immediate, console, unsafeWindow: w });

    let probeResult: any = null;
    const s = fakeScheduler();
    startCompatProbe({
      snapshot: () => probeResult,
      scheduler: s.schedule,
      onSettle: (r) => { probeResult = r; }
    });
    // BewlyCat 宿主出现
    probeResult = { family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.7.8' }], generic: false };
    s.advance(200);

    const menuDisabled = new Set<string>();
    const overrides = await readForceOnOverrides(store, deferred.map(m => m.name));
    const { enabled, autoDisabled } = resolveConflicts(deferred, probeResult, menuDisabled, overrides);
    core.registerModules(enabled);
    await store.set(COMPAT_STATUS_KEY, { family: probeResult.family, extensions: probeResult.extensions.map(e => e.id), generic: probeResult.generic, autoDisabled, settledAt: Date.now() });

    expect(enabled).toHaveLength(0); // no-ad 被 BewlyCat 冲突禁用
    expect(autoDisabled).toEqual([{ module: 'no-ad', extension: 'bewlycat', feature: 'blockAds / 首页重构' }]);
    // net-module 照常拦截
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('blocked-by-net');
    const status = await store.get<any>(COMPAT_STATUS_KEY);
    expect(status.autoDisabled).toHaveLength(1);
    core.onUnload();
  });
});
```

- [ ] **Step 2: 运行确认失败（若 Task 1-4 实现正确此测试应直接通过——失败即为接口衔接缺陷，修复后再继续）**

Run: `cd packages/core && pnpm vitest run tests/compat-e2e.test.ts`
Expected: PASS（本测试是"接线契约"的可执行文档；红则说明前序任务接口对不上，须修复）

- [ ] **Step 3: userscript 实现**

`packages/userscript/src/gm-storage.ts`:

```ts
import type { KVStore } from '@mbgt/core';

export function createGMKVStore(): KVStore {
  return {
    async get<T>(key: string) { return await GM.getValue<T>(key); },
    async set<T>(key: string, value: T) { await GM.setValue(key, value); },
    async delete(key: string) { await GM.deleteValue(key); }
  };
}
```

`packages/userscript/src/entry.ts` 重写为两段装配（保持既有菜单注册逻辑不变）：

```ts
import { createCore, createLogger, getDefaultModules, startCompatProbe, resolveConflicts, readForceOnOverrides, COMPAT_STATUS_KEY } from '@mbgt/core';
import { unsafeConsole, unsafeWindowRef } from './gm-adapter';
import { getModuleEnabledSync } from './module-menu';
import { createGMKVStore } from './gm-storage';

const logger = createLogger(unsafeConsole());
const store = createGMKVStore();
const allModules = getDefaultModules(logger);

// 立即注册：无冲突声明且菜单启用的模块（document-start 语义）
const immediate = allModules.filter(m => !m.conflicts?.length);
const enabledImmediate = immediate.filter(m => getModuleEnabledSync(m.name));
for (const mod of immediate) {
  if (!getModuleEnabledSync(mod.name)) {
    initModuleMenu(mod, () => {});
    logger.log(`[${mod.name}] disabled via menu -- skipping`);
  } else {
    initModuleMenu(mod, () => {});
  }
}
// 注意：全部 15 个模块的菜单都要注册（禁用态也能在菜单里切回来）

const core = createCore({ modules: enabledImmediate, console: unsafeConsole(), unsafeWindow: unsafeWindowRef });

// 延迟注册：带 conflicts 的模块，等共存探测结算
const deferred = allModules.filter(m => m.conflicts?.length);
for (const mod of deferred) initModuleMenu(mod, () => {});
const menuDisabledNames = new Set(deferred.filter(m => !getModuleEnabledSync(m.name)).map(m => m.name));

startCompatProbe({
  snapshot: () => {
    // DOM 查询（真实实现）：#bewly 家族 + 特征标记；shadow DOM 为 open 模式可直查
    const doc = unsafeWindowRef.document;
    const hosts = Array.from(doc.querySelectorAll<HTMLElement>('#bewly[data-version]'));
    if (hosts.length === 0) return null;
    const extensions: { id: 'bewlycat' | 'avemujica'; version: string | null }[] = [];
    const whole = doc.documentElement;
    const hasBewlyCatMarker = whole.querySelector('[bewly-auto-exit-listener], .bewly-watch-later-btn') !== null
      || hosts.some(h => h.shadowRoot?.querySelector('[bewly-auto-exit-listener], .bewly-watch-later-btn') !== null);
    const hasAveMujicaMarker = whole.querySelector('#bewly-bottom-comment-style') !== null
      || hosts.some(h => h.shadowRoot?.querySelector('#bewly-bottom-comment-style') !== null);
    if (hasBewlyCatMarker) extensions.push({ id: 'bewlycat', version: hosts[0]?.getAttribute('data-version') ?? null });
    if (hasAveMujicaMarker) extensions.push({ id: 'avemujica', version: hosts[0]?.getAttribute('data-version') ?? null });
    // 三态契约：特征命中→完整结果；家族在场特征未现→pending-family（保持轮询，超时后 generic）；无家族→null
    if (extensions.length > 0) return { family: 'bewly' as const, extensions, generic: false };
    return 'pending-family';
  },
  scheduler: (cb, ms) => {
    const t = unsafeWindowRef.setTimeout(cb, ms);
    return () => unsafeWindowRef.clearTimeout(t);
  },
  timeoutMs: 10_000,
  intervalMs: 200,
  onSettle: (probe) => {
    void (async () => {
      const overrides = await readForceOnOverrides(store, deferred.map(m => m.name));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, menuDisabledNames, overrides);
      for (const d of autoDisabled) {
        logger.log(`[${d.module}] auto-disabled: ${d.extension} (${d.feature}) detected`);
      }
      core.registerModules(enabled);
      await store.set(COMPAT_STATUS_KEY, {
        family: probe.family,
        extensions: probe.extensions.map(e => e.id),
        generic: probe.generic,
        autoDisabled,
        settledAt: Date.now()
      });
    })();
  }
});
```

（实现者注意：上面 entry 是**行为规格**——菜单注册必须覆盖全部 15 模块且只注册一次、immediate 的禁用日志、deferred 结算后才 registerModules。写码时可调整内部组织，但这些语义不得变；`getModuleEnabledSync` 若当前签名收 mod 对象，改为收 `name: string` 并同步所有调用点。）

- [ ] **Step 4: 构建与产物断言**

Run: `pnpm --filter @mbgt/userscript build`，然后：

```bash
cd packages/userscript
node --check dist/make-bilibili-great-together.user.js
grep -q "startCompatProbe\|auto-disabled" dist/make-bilibili-great-together.user.js
grep -q "mbgt:compat:status" dist/make-bilibili-great-together.user.js
for m in bewly-auto-exit-listener bewly-bottom-comment-style; do grep -q "$m" dist/make-bilibili-great-together.user.js; done
echo OK
```

Expected: `OK`（产物含探测器与两扩展特征标记）

- [ ] **Step 5: 全量验证 + Commit**

Run: `cd <root> && pnpm lint && pnpm test && pnpm build`
Expected: lint 0 error、测试全绿（45 用例）、双产物构建成功

```bash
git add -A && git commit -m "feat: userscript 共存感知端到端接线（探测→resolve→晚注册→状态落盘）+GM KVStore"
```

---

### Task 7: 文档与真机冒烟清单

**Files:**
- Modify: `README.md`（共存章节）、`docs/superpowers/specs/2026-08-30-make-bilibili-great-together-design.md`（§3.3 冲突表加 provisional 标注说明）

**Interfaces:**
- Consumes: 无
- Produces: README 真实反映 Plan 2 能力；冒烟清单供用户真机验证

- [ ] **Step 1: README 共存章节更新**

替换 `## 与扩展共存` 小节为：

```markdown
## 与扩展共存

安装 [BewlyCat](https://github.com/keleus/BewlyCat) / [BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 后，脚本自动探测并停用与其重复的模块（首页广告、URL 参数清理、字体、播放器适配等），网络层能力（反跟踪、反 PCDN/P2P）不受影响。

- 探测窗口 10 秒；检测到家族但无法区分具体扩展时按保守策略停用并集
- 被停用的模块会写入控制台日志（`[mbgt] [模块名] auto-disabled: ...`）
- 强制开启某模块：设置 `GM存储键 mbgt:override:<模块名>` 为 `force-on`（设置面板在后续版本提供）
- 冲突表中 `optimize-story` 两项为 provisional（待真机实测确认）
```

- [ ] **Step 2: spec §3.3 表格下追加一行说明**

在 spec 冲突表后追加：

```markdown
> 注：optimize-story 两项为 provisional（2026-09-01 标注），待真机装 BewlyCat/AveMujica 实测动态页改造程度后定稿；定稿后更新 CONFLICT_TABLE 与模块 conflicts 元数据（两处 feature 文案需逐字一致）。
```

- [ ] **Step 3: 全量验证 + Commit + 推送**

Run: `pnpm test && pnpm build`，CI 绿后：

```bash
git add -A && git commit -m "docs: README 共存章节与 spec 冲突表 provisional 标注" && git push
```

Expected: CI 绿

---

## 交付标准（Plan 2 完成定义）

1. `pnpm test` 全绿（≥45 用例：探测器契约 4、resolve 6、e2e 1、晚注册 4 及既有 30）
2. 产物含探测逻辑与两扩展特征标记（grep 断言）
3. README/spec 文档更新；CI 绿
4. 真机冒烟清单（Task 7）待用户执行：装 BewlyCat 后控制台应出现 `auto-disabled` 日志、`mbgt:compat:status` 键有值

## 后续计划占位

- Plan 3: MV3 扩展 + declarativeNetRequest（复用 core compat 探测，MAIN world 注入）
- Plan 4: CDN 选优 / 拦截统计 / 设置+共存面板（面板消费 `mbgt:compat:status` 与 `mbgt:override:*`，把 CONFLICT_TABLE 收敛为 feature 文案单一真源）
