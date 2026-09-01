# Plan 3: MV3 扩展形态 + declarativeNetRequest（里程碑 4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可安装的 MV3 扩展产物（同一份 core：MAIN world 注入 + storage 桥接 + DNR 静态拦截规则 + 极简 options 页），并完成 Plan 3 前顺手加固批次。

**Architecture:** `packages/extension` 双 content script：`isolated.js`（先注册，宿主 KVStore 桥接监听端，走 `browser.storage.local`）+ `main.js`（后注入，`world: "MAIN"`，跑完整 core 引擎，经 window CustomEvent 桥接存取）。DNR 静态规则在网络层拦 `data.bilibili.com` / `cm.bilibili.com`（比脚本 hook 更早）。compat 探测的 DOM 快照实现抽入 core 供两形态共用。

**Tech Stack:** TypeScript 5、Vitest、rollup（双 IIFE 输出）、adm-zip（打包）、MV3（manifest v3，Edge/Chrome 111+ 支持 `world: "MAIN"`）。

**Spec:** `docs/superpowers/specs/2026-08-30-make-bilibili-great-together-design.md` §2（扩展注入时序与 DNR）、§5（存储/降级）

## Global Constraints

- TypeScript strict；三包 `tsc --noEmit` 零错误；`pnpm lint` 0 error；既有 50 用例不回退
- 中文 commit message；测试不依赖真实网络/浏览器（bridge 用 Node 原生 EventTarget 测试）
- core 保持平台无关：`browser.*`/`chrome.*`/`GM` API 只允许出现在 packages/userscript、packages/extension
- 覆盖范围与 userscript 一致：`www/t/live/space.bilibili.com`
- DNR 规则域：`data.bilibili.com`、`cm.bilibili.com`（与 defuse-spyware 的 hook 拦截名单一致）
- **Controller 裁定（本计划新增）**：
  - R1 abort 路径消除 `setRequestHeader` 噪音——XHR hook 的 abort 分支改为仍执行 `super.open(...$args)` 再 noop `send/setRequestHeader`（open 不产生网络流量；B 站代码绑定了原始方法引用，noop 实例属性挡不住它，只有让 state=OPENED 才能根治 InvalidStateError）
  - R2 家族缺席提前结算——`document.readyState === 'complete'` 后宽限 2 秒仍无 `#bewly` 宿主 → 按"未安装"提前结算（扩展均为 document_start 注入，readyState complete 时宿主应已存在；兜底 10s 超时保留）。生效条件是 snapshot 返回 `null`（非 pending-family），pending-family 仍等满 10s
  - R3 generic 归因（冒烟修复，已上线）保持 `extension: 'generic'`，本计划不动

---

### Task 1: core — 顺手加固批次（6 项，行为增强不改对外签名）

**Files:**
- Modify: `packages/core/src/engine/scheduler.ts`（flushStyles 标记时序、abort 路径）、`packages/core/src/features/compat/resolve.ts`（freeze + 行序）、`packages/core/src/platform/compat-types.ts`（snapshot 容错 + 提前结算）、`packages/core/src/engine/hooks.ts`（abort 路径）
- Test: `packages/core/tests/engine-late-register.test.ts`（追加）、`packages/core/tests/compat-probe.test.ts`（追加）

**Interfaces:**
- Consumes: 既有 engine/compat 实现
- Produces: `CompatProbeOptions` 新增可选字段 `notInstalledCheck?: () => boolean` 与 `notInstalledGraceMs?: number`（默认 2000）；其余签名不变

- [ ] **Step 1: 写失败测试（追加到既有测试文件）**

`packages/core/tests/compat-probe.test.ts` 追加：

```ts
describe('startCompatProbe 提前结算（notInstalledCheck）', () => {
  it('readyState complete 且宽限期内仍无宿主→按未安装提前结算', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({
      snapshot: () => null,
      scheduler: s.schedule,
      onSettle,
      notInstalledCheck: () => true,
      notInstalledGraceMs: 2_000
    });
    s.advance(1_999);
    expect(onSettle).not.toHaveBeenCalled();
    s.advance(1);
    expect(onSettle).toHaveBeenCalledWith({ family: null, extensions: [], generic: false });
  });

  it('宽限期内宿主出现（snapshot 返回完整结果）→正常结算而非未安装', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    let result: null | ProbeResult = null;
    startCompatProbe({
      snapshot: () => result,
      scheduler: s.schedule,
      onSettle,
      notInstalledCheck: () => true,
      notInstalledGraceMs: 2_000
    });
    s.advance(1_000);
    result = { family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.6.9' }], generic: false };
    s.advance(1_500);
    expect(onSettle).toHaveBeenCalledWith(result);
  });

  it('pending-family 不受提前结算影响（宿主在场特征未现仍等满超时）', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({
      snapshot: () => 'pending-family',
      scheduler: s.schedule,
      onSettle,
      notInstalledCheck: () => true,
      notInstalledGraceMs: 2_000
    });
    s.advance(5_000);
    expect(onSettle).not.toHaveBeenCalled();
    s.advance(5_000);
    expect(onSettle).toHaveBeenCalledWith({ family: 'bewly', extensions: [], generic: true });
  });

  it('notInstalledCheck 未提供时行为与旧版完全一致', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({ snapshot: () => null, scheduler: s.schedule, onSettle });
    s.advance(9_999);
    expect(onSettle).not.toHaveBeenCalled();
    s.advance(1);
    expect(onSettle).toHaveBeenCalledWith({ family: null, extensions: [], generic: false });
  });
});
```

`packages/core/tests/engine-late-register.test.ts` 追加（abort 路径 R1）：

```ts
describe('overrideXHR abort 路径（R1：仍 open，noise 消除）', () => {
  it('onXhrOpen 返回 null 时 open 仍执行（state=OPENED）而 send/setRequestHeader 为 noop', () => {
    const w = fakeWindow();
    const mod: ModuleMeta = {
      name: 'xhr-blocker', description: '',
      any(h) { h.onXhrOpen(() => null); }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const xhr = new w.XMLHttpRequest();
    // 既有测试锁定 send 不可用；此处锁定 open 已真正发生——B 站绑定原始 setRequestHeader 引用不再抛 InvalidStateError
    const superOpenSpy = vi.spyOn(xhr as unknown as { open: () => void }, 'open');
    xhr.open('GET', 'https://data.bilibili.com/report');
    expect(superOpenSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/compat-probe.test.ts tests/engine-late-register.test.ts`
Expected: 新增 5 用例 FAIL（notInstalledCheck 不存在 / open 未执行）

- [ ] **Step 3: 实现（6 项加固）**

1. **abort 路径（hooks.ts overrideXHR）**：`if (xhrArgs === null)` 分支改为——
```ts
      if (xhrArgs === null) {
        // R1：仍执行真实 open（不产生网络流量），使 state=OPENED——
        // B 站代码绑定原始 setRequestHeader 引用，仅 noop 实例属性会残留 InvalidStateError 噪音
        super.open(...($args as Parameters<XMLHttpRequest['open']>));
        this.send = () => {};
        this.setRequestHeader = () => {};
        return;
      }
```
（注意：`superOpenSpy` 测试中 spy 的是实例的 open——子类 open 被调用即经由它；实现时若 spy 无法命中 super 链，可断言 `xhr.readyState === 1`（OPENED）替代，测试可按实际可观测面调整，语义不变：open 必须已执行。）

2. **flushStyles 标记时序（scheduler.ts）**：把 `injectedStyles.add(css)` 移到实际注入成功之后（CSSOM push 或 style 标签 append 之后）；注入抛错时该样式下次 flush 重试。
3. **CONFLICT_TABLE 冻结（resolve.ts）**：导出前 `for (const row of Object.values(CONFLICT_TABLE)) Object.freeze(row); Object.freeze(CONFLICT_TABLE);`
4. **specific 行序固定（resolve.ts resolveConflicts）**：`for (const id of specific)` 改为固定顺序——`const ORDER: ExtensionId[] = ['bewlycat', 'avemujica']; for (const id of ORDER.filter(o => specific.includes(o)))`（并集归因不再依赖 probe.extensions 顺序；`ExtensionId` 类型导入如缺失则补）。
5. **snapshot 容错（compat-types.ts）**：`settleFromSnapshot` 与超时回调内对 `snapshot()` 调用包 try/catch——轮询路径抛错视为本轮 null（继续轮询），超时路径抛错按未安装结算。
6. **提前结算（compat-types.ts）**：`CompatProbeOptions` 增加两可选字段；`loop` 的 tick 内逻辑改为——快照结算优先；`snapshot() === null && notInstalledCheck?.()` 时启动一次性宽限计时（`scheduler(settle, notInstalledGraceMs ?? 2000)`，宽限触发时再次确认 `snapshot()` 仍为 null 才结算未安装，宿主已出现则取消并继续原逻辑）；pending-family 不受影响；10s 总超时保留。

- [ ] **Step 4: 全量测试 + 双包类型检查**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit && cd ../userscript && npx tsc --noEmit`
Expected: 55 用例全绿（50+5）、双包零错误

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): 顺手加固批次——abort 路径仍 open 消除噪音/flushStyles 失败重试/表冻结/行序固定/snapshot 容错/家族缺席提前结算"
```

---

### Task 2: core — createBewlyFamilySnapshot 抽取（两形态共用）

**Files:**
- Create: `packages/core/src/features/compat/snapshot.ts`
- Modify: `packages/core/src/index.ts`（导出）、`packages/userscript/src/entry.ts`（改用共享实现）
- Test: `packages/core/tests/compat-snapshot.test.ts`

**Interfaces:**
- Consumes: `SnapshotResult`
- Produces: `createBewlyFamilySnapshot(doc: Document): () => SnapshotResult`——返回的函数每次调用即执行一次三态判定；`doc` 只需实现 `querySelectorAll/querySelector`（测试注入 stub）

- [ ] **Step 1: 写失败测试**

`packages/core/tests/compat-snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBewlyFamilySnapshot } from '../src/features/compat/snapshot';

function fakeDoc(hosts: { version: string | null; shadowBewlycat: boolean; shadowAvemujica: boolean }[], docMarkers: { bewlycat: boolean; avemujica: boolean }) {
  const hostEls = hosts.map(h => ({
    getAttribute: (k: string) => (k === 'data-version' ? h.version : null),
    shadowRoot: {
      querySelector: (sel: string) =>
        ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn')) && h.shadowBewlycat) ||
        (sel.includes('bewly-bottom-comment-style') && h.shadowAvemujica) ? {} : null
    }
  }));
  return {
    querySelectorAll: (sel: string) => (sel.includes('#bewly') ? hostEls : []),
    querySelector: (sel: string) =>
      ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn')) && docMarkers.bewlycat) ||
      (sel.includes('bewly-bottom-comment-style') && docMarkers.avemujica) ? {} : null,
    documentElement: { querySelector: (sel: string) =>
      ((sel.includes('bewly-auto-exit-listener') || sel.includes('bewly-watch-later-btn')) && docMarkers.bewlycat) ||
      (sel.includes('bewly-bottom-comment-style') && docMarkers.avemujica) ? {} : null }
  } as unknown as Document;
}

describe('createBewlyFamilySnapshot（三态契约）', () => {
  it('无宿主→null', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([], { bewlycat: false, avemujica: false }));
    expect(snap()).toBeNull();
  });

  it('宿主在场+无标记→pending-family（注意：#bewly-bottom-comment-style 已从标记表移除，见冒烟裁定）', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: false }));
    expect(snap()).toBe('pending-family');
  });

  it('documentElement 级 bewlycat 标记→extensions=[bewlycat] + version', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: true, avemujica: false }));
    expect(snap()).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.6.9' }], generic: false });
  });

  it('shadowRoot 级标记命中→generic=false', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: true, shadowAvemujica: false }], { bewlycat: false, avemujica: false }));
    expect(snap()).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: null }], generic: false });
  });

  it('双标记同时在场→extensions 顺序固定 bewlycat 在前（配合行序固定裁定）', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: '1.6.9', shadowBewlycat: true, shadowAvemujica: true }], { bewlycat: true, avemujica: true }));
    const r = snap();
    expect(r).toEqual({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.6.9' }, { id: 'avemujica', version: null }], generic: false });
  });

  it('仅 avemujica 注释样式标记在场→默认忽略（pending-family）——冒烟裁定：该标记在 BewlyCat 1.6.9 也瞬时注入', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: true }));
    expect(snap()).toBe('pending-family');
  });

  it('显式开启 enableAvemujicaCommentStyleMarker 时才上报 avemujica', () => {
    const snap = createBewlyFamilySnapshot(fakeDoc([{ version: null, shadowBewlycat: false, shadowAvemujica: false }], { bewlycat: false, avemujica: true }), { enableAvemujicaCommentStyleMarker: true });
    expect(snap()).toEqual({ family: 'bewly', extensions: [{ id: 'avemujica', version: null }], generic: false });
  });
});
```

（注意最后一个用例：`#bewly-bottom-comment-style` 标记**保留在 snapshot 表内**——本抽取是行为等价重构，不改标记表；真机已证实它对 BewlyCat 1.6.9 有误报，但 userscript 侧已在 entry 层移除。抽取后**统一行为**：标记表完整保留（avemujica 标记命中仍上报 avemujica），误报治理改为在 Task 3/4 的接线层裁剪——userscript entry 与扩展 entry 共用本实现，误报问题由 Task 2 的 userscript 重接线一并消除，方式见 Step 3。）

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/compat-snapshot.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 + userscript 重接线**

`packages/core/src/features/compat/snapshot.ts`：把 userscript `entry.ts` snapshot 闭包的判定逻辑原样搬入工厂（hosts 查询、documentElement+shadowRoot 双路径标记查询、三态返回、BewlyCat version 取 hosts[0]、avemujica version=null）。**同时落地误报治理**：标记表增加一个可选开关参数——

```ts
export interface BewlySnapshotOptions {
  /** 冒烟裁定（2026-09-01）：#bewly-bottom-comment-style 在 BewlyCat 1.6.9 也会瞬时注入，
   *  作为 AveMujica 独有标记不可靠。默认 false=忽略该标记（AveMujica 单独在场走 generic 并集）。
   *  找到版本稳定的独有标记后可开启。 */
  enableAvemujicaCommentStyleMarker?: boolean;
}
export function createBewlyFamilySnapshot(doc: Document, options?: BewlySnapshotOptions): () => SnapshotResult
```

两形态接线均不传该开关（默认 false），`#bewly-bottom-comment-style` 查询代码保留在开关分支内。`index.ts` 导出工厂与 Options。

`packages/userscript/src/entry.ts`：snapshot 闭包替换为 `createBewlyFamilySnapshot(unsafeWindowRef.document)`（删除本地实现与本地注释——冒烟裁定注释随实现进入 core）。

- [ ] **Step 4: 全量测试 + 双包 tsc + 构建产物断言**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit && cd ../userscript && npx tsc --noEmit && cd ../.. && pnpm --filter @mbgt/userscript build && node --check packages/userscript/dist/make-bilibili-great-together.user.js`
Expected: 62 用例全绿（60+6？以实际为准——55+7=62）、产物构建成功。开关守卫核查：`grep -c "bewly-bottom-comment-style" packages/userscript/dist/*.js` 的命中必须全部位于 `enableAvemujicaCommentStyleMarker` 守卫分支对应的查询语句内（实现者核对 grep 上下文后在报告中确认）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: compat DOM 快照抽入 core（createBewlyFamilySnapshot）+ avemujica 注释样式标记默认停用"
```

---

### Task 3: core — storage 桥接协议（MAIN↔ISOLATED）

**Files:**
- Create: `packages/core/src/platform/bridge.ts`
- Modify: `packages/core/src/index.ts`（导出）
- Test: `packages/core/tests/platform-bridge.test.ts`

**Interfaces:**
- Consumes: `KVStore`
- Produces（Task 4 依赖，签名逐字为准）:
  - `const BRIDGE_REQUEST_EVENT = 'mbgt:storage-request'`、`BRIDGE_RESPONSE_EVENT = 'mbgt:storage-response'`
  - `createBridgeHost(store: KVStore, eventTarget: EventTarget): () => void`——监听请求事件并回写响应；返回卸载函数
  - `createBridgedKVStore(eventTarget: EventTarget, timeoutMs?: number): KVStore`——默认 3000ms 超时；超时 get 返回 `undefined`、set/delete **reject**（由上层 .catch 兜底）
  - 事件 detail 契约：请求 `{ id: string; action: 'get' | 'set' | 'delete'; key: string; value?: unknown }`；响应 `{ id: string; ok: boolean; value?: unknown; error?: string }`

- [ ] **Step 1: 写失败测试（Node 原生 EventTarget，双向即同一对象）**

`packages/core/tests/platform-bridge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryKVStore, type KVStore } from '../src/platform/storage';
import { createBridgeHost, createBridgedKVStore, BRIDGE_REQUEST_EVENT } from '../src/platform/bridge';

function wired(): { client: KVStore; hostStore: KVStore; unload: () => void } {
  const et = new EventTarget();
  const hostStore = createMemoryKVStore();
  const unload = createBridgeHost(hostStore, et);
  const client = createBridgedKVStore(et);
  return { client, hostStore, unload };
}

describe('storage bridge', () => {
  it('set/get/delete 全链路', async () => {
    const { client, hostStore } = wired();
    await client.set('a', { x: 1 });
    expect(await hostStore.get('a')).toEqual({ x: 1 });
    expect(await client.get('a')).toEqual({ x: 1 });
    await client.delete('a');
    expect(await client.get('a')).toBeUndefined();
  });

  it('宿主未启动时 get 超时返回 undefined、set 超时 reject', async () => {
    const client = createBridgedKVStore(new EventTarget(), 50);
    await expect(client.get('k')).resolves.toBeUndefined();
    await expect(client.set('k', 1)).rejects.toThrow(/bridge timeout/i);
  });

  it('卸载后请求不再被处理', async () => {
    const { client, unload } = wired();
    unload();
    await expect(client.get('k')).resolves.toBeUndefined();
  });

  it('请求事件名正确（isolated 端按此监听）', () => {
    let seen = '';
    const et = new EventTarget();
    et.addEventListener(BRIDGE_REQUEST_EVENT, () => { seen = BRIDGE_REQUEST_EVENT; });
    et.dispatchEvent(new Event(BRIDGE_REQUEST_EVENT));
    expect(seen).toBe('mbgt:storage-request');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/platform-bridge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/platform/bridge.ts`：

```ts
import type { KVStore } from './storage';

export const BRIDGE_REQUEST_EVENT = 'mbgt:storage-request';
export const BRIDGE_RESPONSE_EVENT = 'mbgt:storage-response';

interface BridgeRequest { id: string; action: 'get' | 'set' | 'delete'; key: string; value?: unknown }
interface BridgeResponse { id: string; ok: boolean; value?: unknown; error?: string }

export function createBridgeHost(store: KVStore, eventTarget: EventTarget): () => void {
  const listener = async (ev: Event) => {
    const req = (ev as CustomEvent<BridgeRequest>).detail;
    let res: BridgeResponse;
    try {
      if (req.action === 'get') res = { id: req.id, ok: true, value: await store.get(req.key) };
      else if (req.action === 'set') { await store.set(req.key, req.value); res = { id: req.id, ok: true }; }
      else { await store.delete(req.key); res = { id: req.id, ok: true }; }
    } catch (e) {
      res = { id: req.id, ok: false, error: String(e) };
    }
    eventTarget.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: res }));
  };
  eventTarget.addEventListener(BRIDGE_REQUEST_EVENT, listener);
  return () => eventTarget.removeEventListener(BRIDGE_REQUEST_EVENT, listener);
}

export function createBridgedKVStore(eventTarget: EventTarget, timeoutMs = 3_000): KVStore {
  const pending = new Map<string, (res: BridgeResponse) => void>();
  eventTarget.addEventListener(BRIDGE_RESPONSE_EVENT, (ev) => {
    const res = (ev as CustomEvent<BridgeResponse>).detail;
    pending.get(res.id)?.(res);
    pending.delete(res.id);
  });

  function request(action: BridgeRequest['action'], key: string, value?: unknown): Promise<unknown> {
    return new Promise(resolve => {
      const id = `${Date.now()}-${Math.random()}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        // get 超时按未命中返回（安全默认）；set/delete 超时拒绝（由调用方 .catch 兜底记录）
        if (action === 'get') resolve({ id, ok: true, value: undefined });
        else resolve({ id, ok: false, error: `bridge timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      eventTarget.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: { id, action, key, value } }));
    });
  }

  return {
    async get(key) {
      const res = await request('get', key) as BridgeResponse;
      return res.value as undefined;
    },
    async set(key, value) {
      const res = await request('set', key, value) as BridgeResponse;
      if (!res.ok) throw new Error(res.error ?? 'bridge set failed');
    },
    async delete(key) {
      const res = await request('delete', key) as BridgeResponse;
      if (!res.ok) throw new Error(res.error ?? 'bridge delete failed');
    }
  };
}
```

`index.ts` 追加导出（bridge 四个符号）。注意：跨 world 的 CustomEvent detail 经结构化克隆，`undefined` value 与普通对象均可安全通过；不支持函数/原型链对象（存储值本就应为纯数据，Plan 4 面板约定只存 JSON 可序列化值）。

- [ ] **Step 4: 全量测试 + 类型检查**

Run: `cd packages/core && pnpm vitest run && npx tsc --noEmit`
Expected: 66 用例全绿（62+4）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): MAIN↔ISOLATED storage 桥接协议（host/client + 超时语义）含单测"
```

---

### Task 4: extension 包 — manifest/DNR/双注入/options/打包

**Files:**
- Create: `packages/extension/package.json`、`packages/extension/tsconfig.json`、`packages/extension/rollup.config.mjs`、`packages/extension/src/manifest.json`、`packages/extension/src/rules.json`、`packages/extension/src/unsafe-shim.ts`、`packages/extension/src/main-entry.ts`、`packages/extension/src/isolated-entry.ts`、`packages/extension/src/options.html`、`packages/extension/src/options.ts`、`packages/extension/scripts/build-extension.mjs`、`packages/extension/scripts/make-zip.mjs`
- Modify: 根 `pnpm-workspace.yaml` 无需改（`packages/*` 已覆盖）
- Test: 无单测（与 userscript 包同策略），以构建产物断言 + 真机冒烟验收

**Interfaces:**
- Consumes: `createCore`/`getDefaultModules`/`createLogger`/`startCompatProbe`/`resolveConflicts`/`readForceOnOverrides`/`COMPAT_STATUS_KEY`/`createBewlyFamilySnapshot`/`createBridgedKVStore`/`createBridgeHost`/`createMemoryKVStore`
- Produces: `packages/extension/dist/`（manifest.json、rules.json、main.js、isolated.js、options.html）与 `make-bilibili-great-together-extension.zip`

- [ ] **Step 1: manifest 与 DNR 规则**

`packages/extension/src/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Make Bilibili Great Together",
  "version": "0.1.0",
  "description": "接手 Make Bilibili Great Than Ever Before：反跟踪、反 PCDN/P2P、CDN 选优，与 BewlyCat/AveMujica 共存感知",
  "permissions": ["storage", "declarativeNetRequest"],
  "host_permissions": ["*://*.bilibili.com/*"],
  "declarative_net_request": {
    "rule_resources": [{ "id": "defuse_report", "enabled": true, "path": "rules.json" }]
  },
  "content_scripts": [
    {
      "matches": ["https://www.bilibili.com/*", "https://t.bilibili.com/*", "https://live.bilibili.com/*", "https://space.bilibili.com/*"],
      "js": ["isolated.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://www.bilibili.com/*", "https://t.bilibili.com/*", "https://live.bilibili.com/*", "https://space.bilibili.com/*"],
      "js": ["main.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "options_ui": { "page": "options.html", "open_in_tab": true }
}
```

`packages/extension/src/rules.json`（与 defuse-spyware 拦截名单一致，网络层更早拦截）:

```json
[
  {
    "id": 1,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "requestDomains": ["data.bilibili.com", "cm.bilibili.com"],
      "resourceTypes": ["xmlhttprequest", "ping", "script", "other"]
    }
  }
]
```

- [ ] **Step 2: 双注入入口**

`packages/extension/src/unsafe-shim.ts`（main 包首导入——core 模块引用 `unsafeWindow` 全局，MAIN world 中即 window 自身）:

```ts
(globalThis as unknown as { unsafeWindow?: Window & typeof globalThis }).unsafeWindow ??= globalThis as unknown as Window & typeof globalThis;
```

`packages/extension/src/main-entry.ts`:

```ts
import './unsafe-shim';
import {
  createCore, createLogger, getDefaultModules,
  startCompatProbe, resolveConflicts, readForceOnOverrides,
  COMPAT_STATUS_KEY, createBewlyFamilySnapshot, createBridgedKVStore
} from '@mbgt/core';

const logger = createLogger(console);
const store = createBridgedKVStore(globalThis as unknown as EventTarget);
const allModules = getDefaultModules(logger);

// 扩展形态无油猴菜单：模块默认全启用，override 键（mbgt:override:*）由 options 页写入（Plan 4 完整面板）
const core = createCore({ modules: allModules, console, unsafeWindow: unsafeWindow });

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
      const overrides = await readForceOnOverrides(store, deferred.map(m => m.name));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, new Set(), overrides);
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
```

`packages/extension/src/isolated-entry.ts`:

```ts
import { createBridgeHost, createMemoryKVStore } from '@mbgt/core';

// MAIN world 无法访问 browser.storage（扩展 API 仅 ISOLATED/background 可用）：
// 此监听端把桥接请求落到 browser.storage.local；桥接初始化失败时降级内存 store（仅本页生效，status 不持久化但核心功能不受影响）
let store: import('@mbgt/core').KVStore;
try {
  const browserApi = (globalThis as unknown as { browser?: { storage: { local: { get: (k: string | null) => Promise<Record<string, unknown>>; set: (v: Record<string, unknown>) => Promise<void>; remove: (k: string | string[]) => Promise<void> } } } }).browser;
  if (!browserApi) throw new Error('browser.storage unavailable');
  store = {
    async get(key) { return (await browserApi.storage.local.get(key))[key]; },
    async set(key, value) { await browserApi.storage.local.set({ [key]: value }); },
    async delete(key) { await browserApi.storage.local.remove(key); }
  };
} catch {
  console.warn('[mbgt] storage bridge falling back to in-memory store');
  store = createMemoryKVStore();
}

createBridgeHost(store, window);
```

- [ ] **Step 3: options 页（极简：Plan 4 完整面板的占位）**

`packages/extension/src/options.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Make Bilibili Great Together</title><style>body{font-family:system-ui;max-width:640px;margin:2rem auto;line-height:1.6}pre{background:#f4f4f4;padding:1rem;overflow:auto}</style></head>
<body>
<h1>Make Bilibili Great Together</h1>
<p>扩展形态已启用。模块开关与共存面板将在后续版本提供（当前可通过 ScriptCat 形态的油猴菜单控制）。</p>
<h2>共存感知状态（mbgt:compat:status）</h2>
<pre id="status">读取中…</pre>
<script src="options.js"></script>
</body>
</html>
```

`packages/extension/src/options.ts`:

```ts
const el = document.getElementById('status')!;
browser.storage.local.get('mbgt:compat:status').then(v => {
  const status = v['mbgt:compat:status'];
  el.textContent = status ? JSON.stringify(status, null, 2) : '尚未结算（访问一次 bilibili.com 后再打开本页）';
}).catch(e => { el.textContent = '读取失败: ' + String(e); });
```

- [ ] **Step 4: rollup 配置 + 打包脚本 + 构建**

`packages/extension/package.json`:

```json
{
  "name": "@mbgt/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "rollup -c rollup.config.mjs && node scripts/build-extension.mjs && node scripts/make-zip.mjs",
    "test": "echo \"no unit tests in extension package\" && exit 0",
    "lint": "eslint src"
  },
  "dependencies": { "@mbgt/core": "workspace:*" },
  "devDependencies": {
    "rollup": "^4.0.0",
    "@rollup/plugin-typescript": "^11.0.0",
    "@rollup/plugin-node-resolve": "^15.0.0",
    "adm-zip": "^0.5.0",
    "typescript": "^5.5.0"
  }
}
```

`packages/extension/rollup.config.mjs`:

```mjs
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';

export default {
  input: { main: 'src/main-entry.ts', isolated: 'src/isolated-entry.ts', options: 'src/options.ts' },
  output: { dir: 'dist', format: 'iife', sourcemap: false },
  plugins: [resolve(), typescript({ tsconfig: './tsconfig.json' })]
};
```

`packages/extension/scripts/build-extension.mjs`（拷贝静态文件）:

```mjs
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const f of ['manifest.json', 'rules.json', 'options.html']) {
  copyFileSync(`src/${f}`, `dist/${f}`);
}
console.log('static files copied');
```

`packages/extension/scripts/make-zip.mjs`:

```mjs
import AdmZip from 'adm-zip';
import { readdirSync } from 'node:fs';
const zip = new AdmZip();
for (const f of readdirSync('dist')) zip.addLocalFile(`dist/${f}`);
zip.writeZip('make-bilibili-great-together-extension.zip');
console.log('zip written');
```

`packages/extension/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": [] },
  "include": ["src", "../../packages/core/src/globals.d.ts"]
}
```

Run: `cd <root> && pnpm install && pnpm --filter @mbgt/extension build`
Expected: `dist/` 含 manifest.json、rules.json、main.js、isolated.js、options.js、options.html 与 zip；`node --check` main.js/isolated.js 通过

- [ ] **Step 5: 产物断言 + Commit**

```bash
cd packages/extension
node --check dist/main.js && node --check dist/isolated.js
grep -q "mbgt:storage-request" dist/main.js
grep -q "mbgt:storage-request" dist/isolated.js
grep -q "declarative_net_request" dist/manifest.json
grep -q "requestDomains" dist/rules.json
echo EXT_OK
cd ../.. && git add -A && git commit -m "feat(extension): MV3 扩展形态——MAIN world 注入+storage 桥接+DNR 拦截+极简 options 页"
```

Expected: `EXT_OK`

---

### Task 5: CI 扩展产物 + README/spec 文档同步

**Files:**
- Modify: `.github/workflows/ci.yml`、`README.md`
- Test: 无（CI 实跑验证）

**Interfaces:**
- Consumes: Task 4 的 build 链
- Produces: CI 三包构建 + 扩展 zip 断言；README 双形态安装说明

- [ ] **Step 1: CI 增加 extension 构建与断言**

`.github/workflows/ci.yml` 的 `pnpm build` 步骤后追加：

```yaml
      - name: 扩展产物断言
        run: |
          test -f packages/extension/dist/manifest.json
          test -f packages/extension/dist/main.js
          test -f packages/extension/make-bilibili-great-together-extension.zip
```

- [ ] **Step 2: README 安装章节增加扩展形态**

`README.md` 的安装章节追加：

```markdown
## 安装（扩展）

Releases 下载 `make-bilibili-great-together-extension.zip` 解压（或本地构建 `pnpm --filter @mbgt/extension build`），`edge://extensions` 开启开发人员模式后拖入文件夹或 zip。扩展与 userscript 二选一即可（功能相同，扩展额外在网络层用 declarativeNetRequest 拦截上报）。
```

- [ ] **Step 3: 全量验证 + Commit + push（CI 绿）**

Run: `cd <root> && pnpm lint && pnpm test && pnpm build`
Expected: lint 0 error、66 用例全绿、三包构建成功

```bash
git add -A && git commit -m "ci: 扩展产物构建断言 + README 双形态安装说明" && git push
```

Expected: push 后 CI 绿（直连 reset 时 `git -c http.proxy=http://127.0.0.1:3067 push`）

---

### Task 6: 真机冒烟（扩展形态）

**Files:** 无代码；冒烟清单

**Interfaces:** 无

- [ ] **Step 1: 冒烟清单（执行者为 controller，用 chrome-devtools + computer-use，流程同 Plan 2 冒烟）**

1. `edge://extensions` → 开发人员模式 → 加载解压缩的扩展（选 `packages/extension/dist`）——注意 native 文件对话框需 computer-use 驱动
2. 打开 bilibili 首页：控制台出现 `[mbgt]` 即时分发日志；**网络面板确认 data.bilibili.com 请求被 DNR 阻断**（或 console 无上报请求）
3. 探测结算后 auto-disabled 日志（BewlyCat 在场 → 5 项 bewlycat 归因；首页标记瞬态 → generic 归因，两者均正确）
4. options 页打开显示 compat status JSON
5. `browser.storage.local` 中 `mbgt:compat:status` 有值（options 页即证据）
6. 与 userscript 形态二选一验证：**同装时无冲突**（两形态独立 storage；仅日志重复，不产生双重注入——userscript 的 hook 与扩展的 hook 在 MAIN world 会叠加！**冒烟时若 userscript 同时启用，需禁用其一**——此为交付说明要点，写入 README）

- [ ] **Step 2: 冒烟发现的问题按 Plan 2 冒烟模式处理（小修直改+推送，结构性问题回 plan）**

---

## 交付标准（Plan 3 完成定义）

1. `pnpm test` 全绿（≥66 用例：加固 5、快照 7、桥接 4 及既有 50）；三包 tsc 零错误；lint 0 error
2. 扩展产物 zip 可加载；真机冒烟 6 项通过
3. CI 绿（含扩展断言）
4. README 双形态说明含"二选一"警示

## 后续计划占位

- Plan 4: CDN 智能选优 / 拦截统计看板 / 设置+共存面板（options 页升级为完整面板；CONFLICT_TABLE feature 文案收敛单源；KVStore.onChange 如面板需要）
