# Plan 5：CDN 选优精确化 / 统计口径统一 / 面板实时刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec 的三项精确化——CDN 选优（首载补探/主动重探/https 恒定/单候选文案）、统计归零口径（flush 单飞 + badge 同口径）、面板/角标实时刷新（轮询+低频重读），发版 v0.3.0。

**Architecture:** 全部改动收敛在 core 三个 features 文件（stats/registry、stats/badge、cdn-probe/probe）+ cdnUtil（utils/get-cdn-url）+ 两形态接线层（extension main-entry 回填 mutate、userscript entry 不动）+ 面板组件轮询。数据层（T1）与 UI 生命周期接线（T4）按用户裁定拆界：T1 提供 `readBadgeBaseline` 数据入口，T4 只做 timer/清理。

**Tech Stack:** TypeScript + Vitest（happy-dom/fake timers），无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-01-plan5-polish-design.md`（三条冻结实现约束在 §0，逐字生效）

## Global Constraints

- 冻结 #1：pendingProbe 只保留**最新一次未探测输入**（覆盖式）；`replayPendingProbe()` 幂等——先清空再探测，重复调用空操作
- 冻结 #2：`flushStats` 单飞——进行中的 flush 未结束前重入直接返回；同一 delta 不得被并发扣除
- 冻结 #3：badge 与 panel 同合计口径；DNR 基线 30s 周期同步（**最终一致**，文案/注释不得写"严格一致"）；badge 重读基线公式=`最新持久基线 + 当前会话未归档增量`，不得用纯持久值覆盖
- flush 语义：写盘成功后才归零已落盘部分（`session[k] -= delta[k]`，间隙新增保留）；失败不扣减；无增量且已有存储时不写盘（不产空 payload）
- 重探 timer 单飞：新探测成功取消旧 timer 重排；探测失败（fallback）不安排重探；`destroy()` 清理
- selectMirrorUrl：scheme/port 恒取候选 URL（收集期已 https 化），不继承 incoming
- 版本 0.3.0 三处同步（version.ts / userscript.meta.json / manifest.json）；tag `v0.3.0` 必须指向已含 release.yml 的提交（v0.2.0 教训）
- 每任务完成判定：core vitest 全绿 + userscript vitest 全绿 + 三包 `npx tsc --noEmit`；提交信息中文；push 前先试直连，失败再回退 `git -c http.proxy=http://127.0.0.1:3067 push`（2026-09-01 起两种都要备）
- 降级原则不变：任何一环异常只吞错+日志，不影响核心拦截

---

### Task 1: 统计数据层——registry 归零语义 + flush 单飞 + badge 数据入口

**Files:**
- Modify: `packages/core/src/features/stats/registry.ts`（flushStats 重写 + flushedBaseline 删除）
- Modify: `packages/core/src/features/stats/dnr.ts`（新增 foldDnrCounts）
- Modify: `packages/core/src/features/stats/badge.ts`（新增 readBadgeBaseline 导出；不改 mount 逻辑）
- Modify: `packages/core/src/index.ts`（导出 readBadgeBaseline）
- Test: `packages/core/tests/stats-registry.test.ts`、`packages/core/tests/stats-badge.test.ts`

**Interfaces:**
- Consumes: 既有 `flushStats/readStats/STATS_KEY/StatsPayload`、`DNR_STATS_KEY/DnrStatsPayload`
- Produces（T4 依赖）:
  - `readBadgeBaseline(store: KVStore): Promise<Record<string, number>>`——stats counts 与 DNR 计数（全部 rule 键归并为单一 `dnr` kind，口径与面板 buildStatsView 一致）的合并持久基线
  - `foldDnrCounts(dnrCounts: Record<string, number>): Record<string, number>`——返回 `{ dnr: 总数 }`
  - `flushStats` 新语义：归零 + 单飞（签名不变）

- [ ] **Step 1: 写失败测试（registry 归零 + 单飞）**

在 `packages/core/tests/stats-registry.test.ts` 追加（保留既有用例；既有"flushStats 落盘增量并合入既有持久值"用例中依赖 `flushedBaseline` 的行为断言改为归零语义断言）：

```ts
it('归零语义：写盘成功后已落盘部分从会话扣除（间隙新增保留）', async () => {
  const store = createMemoryKVStore();
  recordInterception('beacon', 10);
  // set 期间模拟新增：mock set 在 resolve 前再记 3 个
  const origSet = store.set.bind(store);
  (store as any).set = async (key: string, value: unknown) => {
    recordInterception('beacon', 3);
    await origSet(key, value as never);
  };
  await flushStats(store);
  expect(sessionCounts()['beacon']).toBe(3);          // 13 - 10 = 3（间隙新增保留）
  expect((await readStats(store)).counts.beacon).toBe(10); // 本次只落盘 10
  // 下一轮只落盘新增的 3
  await flushStats(store);
  expect((await readStats(store)).counts.beacon).toBe(13);
  expect(sessionCounts()['beacon']).toBe(undefined);   // 归零干净
});

it('单飞：进行中的 flush 未结束前重入直接返回（set 只执行一次）', async () => {
  const store = createMemoryKVStore();
  const origSet = store.set.bind(store);
  let releaseSet!: () => void;
  const gate = new Promise<void>(r => { releaseSet = r; });
  let setCalls = 0;
  (store as any).set = async (key: string, value: unknown) => {
    setCalls++;
    await gate;
    return origSet(key as string, value as never);
  };
  recordInterception('beacon', 5);
  const p1 = flushStats(store);
  const p2 = flushStats(store); // 重入被吞
  releaseSet();
  await Promise.all([p1, p2]);
  expect(setCalls).toBe(1);
  expect((await readStats(store)).counts.beacon).toBe(5); // 只落一份，无双倍扣除
});

it('无增量且已有存储 → 不写盘（不产空 payload）', async () => {
  const store = createMemoryKVStore();
  await store.set(STATS_KEY, { counts: { beacon: 7 }, flushedAt: 1 });
  const setSpy = vi.spyOn(store, 'set');
  await flushStats(store);
  expect(setSpy).not.toHaveBeenCalled();
});
```

（Step 3 实现后若单飞用例的 mock 写法与既有用例的 store spy 风格冲突，执行者可统一为该文件的既有 mock 模式——断言语义不变。既有用例「flushStats 落盘增量并合入既有持久值（跨会话累加）」改为归零断言：flush 后 `sessionCounts()['beacon']` 为 undefined 而非 11。注意归零后既有用例中「间隙新增 +3」的阶段断言 `sessionCounts()['beacon']` 应为 `3`。）

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/stats-registry.test.ts`
Expected: FAIL（归零断言失败——当前实现不归零；单飞失败——当前实现会双写；无增量用例当前会写空 payload）

- [ ] **Step 3: 重写 flushStats + 删 flushedBaseline**

`packages/core/src/features/stats/registry.ts`：删除第 14 行 `let flushedBaseline ...`，`flushStats` 全量替换为：

```ts
let flushing = false;

export async function flushStats(store: KVStore): Promise<void> {
  if (flushing) return; // 冻结#2：单飞——并发重入直接返回，同一 delta 不重复扣除
  flushing = true;
  try {
    const stored = await store.get<StatsPayload>(STATS_KEY);
    const storedCounts = stored?.counts ?? {};
    // delta 快照在 get 之后、set 之前取：set 间隙的新增留在会话，不会被本次归零吃掉
    const delta: Record<string, number> = {};
    let dirty = false;
    for (const [kind, n] of Object.entries(session)) {
      if (n > 0) { delta[kind] = n; dirty = true; }
    }
    if (!dirty && stored) return; // 无增量不写（也不产空 payload）
    const merged: Record<string, number> = { ...storedCounts };
    for (const [kind, v] of Object.entries(delta)) merged[kind] = (merged[kind] ?? 0) + v;
    await store.set(STATS_KEY, { counts: merged, flushedAt: Date.now() });
    // 写盘成功后归零已落盘部分：await 间隙的新增（会话值已大于 delta）保留到下轮
    for (const [kind, v] of Object.entries(delta)) {
      const left = (session[kind] ?? 0) - v;
      if (left > 0) session[kind] = left; else delete session[kind];
    }
  } catch {
    // 落盘失败：不扣减，增量保留，下轮重试（Plan 4 T2 裁定）
  } finally {
    flushing = false;
  }
}
```

- [ ] **Step 4: badge 数据入口（readBadgeBaseline）+ foldDnrCounts**

`packages/core/src/features/stats/dnr.ts` 追加：

```ts
/** DNR 规则键（ruleId 数字串）归并为单一 'dnr' kind——与面板 buildStatsView 口径一致 */
export function foldDnrCounts(dnrCounts: Record<string, number>): Record<string, number> {
  const total = Object.values(dnrCounts).reduce((s, v) => s + v, 0);
  return total > 0 ? { dnr: total } : {};
}
```

`packages/core/src/features/stats/badge.ts` 追加导出（mount 函数不动——timer 属 T4）：

```ts
import { foldDnrCounts, DNR_STATS_KEY, type DnrStatsPayload } from './dnr';

/** 角标/面板同口径持久基线：content 统计 + DNR（归并为 'dnr'）。T1 数据入口，T4 的 30s 重读复用。 */
export async function readBadgeBaseline(store: KVStore): Promise<Record<string, number>> {
  const [stats, dnr] = await Promise.all([
    readStats(store),
    store.get<DnrStatsPayload>(DNR_STATS_KEY)
  ]);
  return { ...stats.counts, ...foldDnrCounts(dnr?.counts ?? {}) };
}
```

`packages/core/src/index.ts` 追加：

```ts
export { readBadgeBaseline } from './features/stats/badge';
export { foldDnrCounts } from './features/stats/dnr';
```

- [ ] **Step 5: badge 数据入口测试**

`packages/core/tests/stats-badge.test.ts` 追加：

```ts
import { readBadgeBaseline } from '../src/features/stats/badge';
import { DNR_STATS_KEY } from '../src/features/stats/dnr';

it('readBadgeBaseline：content + DNR（归并 dnr 单键）', async () => {
  const store = createMemoryKVStore();
  await store.set('mbgt:stats:counters', { counts: { beacon: 5 }, flushedAt: 1 });
  await store.set(DNR_STATS_KEY, { counts: { '1': 3, unknown: 2 }, updatedAt: 1 });
  const base = await readBadgeBaseline(store);
  expect(base.beacon).toBe(5);
  expect(base.dnr).toBe(5); // 3+2 归并
});
```

- [ ] **Step 6: 全量验证 + 提交**

Run: `cd packages/core && npx vitest run`（全绿）；三包 `npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: 统计归零口径（flush 单飞+间隙新增保留）+ badge 同口径数据入口"
```

---

### Task 2: cdnUtil pendingProbe 首载补探 + selectMirrorUrl 候选副本化

**Files:**
- Modify: `packages/core/src/utils/get-cdn-url.ts`
- Modify: `packages/extension/src/main-entry.ts`（回填块 mutate + replay）
- Test: `packages/core/tests/get-cdn-url.test.ts`（追加）

**Interfaces:**
- Consumes: 既有 `CdnUtilHooks { probe? }`、`hooksRef` 懒读、`selectMirrorUrl`（T5 现状）
- Produces:
  - `CdnUtilHooks { probe?: CdnProbe; cdnUtil?: { replayPendingProbe(): void } }`
  - `createCDNUtil` 返回对象新增 `replayPendingProbe(): void`
  - `replayPendingProbe` 幂等 + pendingProbe 覆盖式（冻结 #1）
  - selectMirrorUrl 输出 scheme/port 恒取候选（https）

- [ ] **Step 1: 写失败测试**

`packages/core/tests/get-cdn-url.test.ts` 追加（沿用该文件既有的 logger2 辅助与 upos-sz-mirrortestNN 宿主形态）：

```ts
describe('pendingProbe 首载补探（Plan 5 冻结#1）', () => {
  const makePlayinfo = (hosts: string[]) => ({
    data: { dash: { video: hosts.map(h => ({ baseUrl: `https://${h}/upgcxcode/9/9/x/x.m4s?os=upos&trid=1` })), audio: [] } }
  });
  const URL_A = 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';

  it('probe 缺失时 parse 记 pending；回放触发 ensureProbe；重复回放幂等', () => {
    const calls: { hosts: string[]; sample: string }[] = [];
    const probe = { ensureProbe: (hosts: string[], sample: string) => calls.push({ hosts, sample }), getBestHost: () => null, getStatus: () => null };
    const hooksRef: { current?: any } = {};
    const util = createCDNUtil(logger2(), hooksRef);
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com']), 't1'); // probe 缺失 → pending
    util.replayPendingProbe(); // probe 仍缺失 → no-op
    expect(calls).toHaveLength(0);
    hooksRef.current = { ...hooksRef.current, probe };
    util.replayPendingProbe();
    expect(calls).toHaveLength(1);
    expect(calls[0].sample).toBe(URL_A);
    util.replayPendingProbe(); // 幂等：pending 已清
    expect(calls).toHaveLength(1);
  });

  it('多次 playinfo 只保留最新 pending（覆盖式）', () => {
    const calls: string[] = [];
    const probe = { ensureProbe: (_h: string[], sample: string) => calls.push(sample), getBestHost: () => null, getStatus: () => null };
    const hooksRef: { current?: any } = {};
    const util = createCDNUtil(logger2(), hooksRef);
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com']), 't1');
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest02.bilivideo.com']), 't2');
    hooksRef.current = { ...hooksRef.current, probe };
    util.replayPendingProbe();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('https://upos-sz-mirrortest02.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1');
  });

  it('selectMirrorUrl：候选副本构造，incoming http/https 输出恒 https', () => {
    const probe = { ensureProbe: () => {}, getBestHost: () => ({ host: 'upos-sz-mirrortest02.bilivideo.com', expiresAt: Date.now() + 300_000 }), getStatus: () => null };
    const util = createCDNUtil(logger2(), { current: { probe } });
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com', 'upos-sz-mirrortest02.bilivideo.com']), 't');
    const httpIncoming = 'http://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';
    const httpsIncoming = 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';
    for (const incoming of [httpIncoming, httpsIncoming]) {
      const out = util.getReplacementCdnUrl(incoming, 't');
      expect(out.startsWith('https://upos-sz-mirrortest02.bilivideo.com/upgcxcode/')).toBe(true);
      expect(out.endsWith('/upgcxcode/9/9/x/x.m4s?os=upos&trid=1')).toBe(true);
    }
  });
});
```

（若宿主形态与 `mirrorRegex` 不匹配导致 `mirror_urls.size === 0`，按 Plan 4 T5 的既有验证——`upos-sz-mirrortest01.bilivideo.com` 形态可命中——执行者维持该形态。）

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/get-cdn-url.test.ts`
Expected: FAIL（replayPendingProbe 不存在；http 输入输出 http）

- [ ] **Step 3: 实现 cdnUtil 改动**

`packages/core/src/utils/get-cdn-url.ts`：

1. `CdnUtilHooks` 扩展：

```ts
export interface CdnUtilHooks {
  probe?: CdnProbe;
  /** noP2P 工厂回填：接线层 probe 后挂时调用 replayPendingProbe 补探首载候选 */
  cdnUtil?: { replayPendingProbe(): void };
}
```

2. `createCDNUtil` 内（`const cdnDatas = flru...` 之后）加：

```ts
  // 冻结#1：只保留最新一次未探测输入（覆盖式）；replay 先清后探（幂等）
  let pendingProbe: { hosts: string[]; sampleUrl: string } | null = null;
```

3. 返回对象新增方法（`getReplacementCdnUrl` 之后）：

```ts
    replayPendingProbe() {
      const probe = hooksRef?.current?.probe;
      if (!probe || !pendingProbe) return;
      const pending = pendingProbe;
      pendingProbe = null; // 先清后探：幂等
      probe.ensureProbe(pending.hosts, pending.sampleUrl);
    },
```

4. `extractCDNFromVideoOrAudio` 末尾的触发块（现第 383-386 行）替换为：

```ts
      const probe = hooksRef?.current?.probe;
      if (mirror_urls.size > 0) {
        const input = { hosts: Array.from(mirror_type_upgcxcode_hosts), sampleUrl: Array.from(mirror_urls)[0] };
        if (probe) probe.ensureProbe(input.hosts, input.sampleUrl);
        else pendingProbe = input; // probe 未挂载（扩展首跳）：覆盖式记 pending，回填后 replay
      }
```

5. `selectMirrorUrl` 替换为候选副本构造：

```ts
  // C 项加固：scheme/port 恒取候选 URL（收集期已 https 化），不继承 incoming——http incoming 不产 http 镜像
  function selectMirrorUrl(candidates: string[], _incomingUrl: string | URL): string {
    const best = hooksRef?.current?.probe?.getBestHost();
    if (best) {
      const url = new URL(pickOne(candidates));
      url.hostname = best.host;
      return url.href;
    }
    return pickOne(candidates);
  }
```

6. `noP2P` 工厂（`packages/core/src/modules/no-p2p.ts`）在 `const cdnUtil = createCDNUtil(logger, cdnHooksRef);` 之后加：

```ts
  // 把 cdnUtil 回填给接线层：扩展形态 probe 晚挂载时经 replayPendingProbe 补探首载候选
  if (cdnHooksRef) cdnHooksRef.current = { ...(cdnHooksRef.current ?? {}), cdnUtil: { replayPendingProbe: () => cdnUtil.replayPendingProbe() } };
```

7. `packages/extension/src/main-entry.ts` 设置回填块：`cdnHooksRef.current = { probe: ... }` 改为保留既有 cdnUtil 并回放：

```ts
  if (settings.cdnProbe) {
    cdnHooksRef.current = { ...(cdnHooksRef.current ?? {}), probe: createCdnProbe({ fetchLike: createBridgedProbeFetch(eventTarget), logger, store }) };
    cdnHooksRef.current?.cdnUtil?.replayPendingProbe();
  }
```

- [ ] **Step 4: 全量验证 + 提交**

Run: `cd packages/core && npx vitest run`；三包 `npx tsc --noEmit`；`cd packages/extension && npm run build`

```bash
git add -A
git commit -m "feat: cdnUtil pendingProbe 首载补探（覆盖式+幂等回放）+ selectMirrorUrl 候选副本化（https 恒定）"
```

---

### Task 3: probe 缓存过期主动重探

**Files:**
- Modify: `packages/core/src/features/cdn-probe/probe.ts`
- Modify: `packages/core/src/index.ts`（如 CdnProbe 接口新增 destroy 则确认导出已覆盖——接口类型导出即含）
- Test: `packages/core/tests/cdn-probe.test.ts`（追加）

**Interfaces:**
- Consumes: Task 5（Plan 4）的 `createCdnProbe`、`PROBE_CACHE_TTL_MS`
- Produces:
  - `CdnProbe` 接口新增 `destroy(): void`
  - `REPROBE_DELAY_MS = 30_000`（导出）
  - 语义：探测成功 → 安排 TTL+30s 单飞 timer；新探测成功取消旧 timer 重排；fallback 不安排；destroy 清理

- [ ] **Step 1: 写失败测试**

`packages/core/tests/cdn-probe.test.ts` 追加：

```ts
describe('缓存过期主动重探（Plan 5）', () => {
  it('TTL+30s 到期自动重探一次；新探测重置旧 timer（不叠加）', async () => {
    vi.useFakeTimers();
    let seq = 0;
    const results = [{ ok: true, ms: 100 }, { ok: true, ms: 90 }];
    const fetchLike = vi.fn(async () => results[Math.min(seq++, results.length - 1)]);
    const probe = createCdnProbe({ fetchLike, logger, store });
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/x.m4s');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchLike).toHaveBeenCalledTimes(1);
    // TTL(5min) + 30s 到期：恰好一次重探
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 30_000);
    expect(fetchLike).toHaveBeenCalledTimes(2);
    // 重探成功后再次进入下一周期：无第三发（到期点尚未再过一轮）
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchLike).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('fallback（全败）不安排重探', async () => {
    vi.useFakeTimers();
    const fetchLike = vi.fn(async () => ({ ok: false, ms: 2_000 }));
    const probe = createCdnProbe({ fetchLike, logger, store });
    probe.ensureProbe(['dead.bilivideo.com'], 'https://dead.bilivideo.com/upgcxcode/x.m4s');
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchLike).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('destroy 后不再重探', async () => {
    vi.useFakeTimers();
    const fetchLike = vi.fn(async () => ({ ok: true, ms: 100 }));
    const probe = createCdnProbe({ fetchLike, logger, store });
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/x.m4s');
    await vi.advanceTimersByTimeAsync(50);
    probe.destroy();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 60_000);
    expect(fetchLike).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/cdn-probe.test.ts`
Expected: FAIL（destroy 不存在；无自动重探）

- [ ] **Step 3: 实现**

`packages/core/src/features/cdn-probe/probe.ts`：

1. 常量与接口：

```ts
export const REPROBE_DELAY_MS = 30_000;
```

`CdnProbe` 接口加一行：`destroy(): void;`

2. `createCdnProbe` 内状态区加：

```ts
  let lastInput: { hosts: string[]; sampleUrl: string } | null = null;
  let reprobeTimer: ReturnType<typeof setTimeout> | null = null;
```

3. `ensureProbe` 开头（`if (probing) return;` 之前）加 lastInput 记录：

```ts
      if (candidateHosts.length > 0) lastInput = { hosts: [...new Set(candidateHosts)], sampleUrl };
```

4. 返回对象加 `destroy`：

```ts
    destroy() {
      if (reprobeTimer) { clearTimeout(reprobeTimer); reprobeTimer = null; }
      lastInput = null;
    },
```

5. `runProbe` 末尾（`probing = false;` 之后、日志之前）加重排；成功路径安排 timer：

```ts
    if (reprobeTimer) { clearTimeout(reprobeTimer); reprobeTimer = null; } // 冻结：单 timer，新探测重排
    if (best) {
      reprobeTimer = setTimeout(() => {
        reprobeTimer = null;
        if (cache && Date.now() >= cache.expiresAt && lastInput) ensureProbe(lastInput.hosts, lastInput.sampleUrl);
      }, PROBE_CACHE_TTL_MS + REPROBE_DELAY_MS);
    }
    // fallback（全败）不安排：等待下一次外部 ensureProbe 触发
```

（`ensureProbe` 内部被 timer 调用时 lastInput 已在入口刷新 ✓；`probing` 重入保护天然防止 timer 与外部触发叠加。）

- [ ] **Step 4: 全量验证 + 提交**

Run: `cd packages/core && npx vitest run`；三包 `npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: CDN 缓存过期主动重探（TTL+30s 单飞 timer，fallback 不安排，destroy 清理）"
```

---

### Task 4: UI 接线（面板轮询 + badge timer）+ 版本 0.3.0 + README + 冒烟 + tag

**Files:**
- Modify: `packages/core/src/features/panel/panel.ts`（PanelApp 2s 链式轮询 + D 项文案）
- Modify: `packages/core/src/features/stats/badge.ts`（30s 基线重读 timer + cleanup，接入 T1 `readBadgeBaseline`）
- Modify: `packages/core/src/index.ts`（如需导出调整）
- Modify: `packages/core/src/version.ts`、`packages/userscript/userscript.meta.json`、`packages/extension/src/manifest.json`（0.3.0）
- Modify: `README.md`（四段小更新：首载补探/主动重探/归零统计/面板实时刷新）
- Test: `packages/core/tests/panel-ui.test.ts`、`packages/core/tests/stats-badge.test.ts`（追加）

**Interfaces:**
- Consumes: T1 `readBadgeBaseline`、既有 `loadPanelData`
- Produces: 无新导出（面板/角标行为变化）

- [ ] **Step 1: 写失败测试**

`packages/core/tests/panel-ui.test.ts` 追加（**导入补充**：该文件需新增 `import { vi } from 'vitest'`（并入既有 vitest import 行）与 `import { h } from 'preact'`（若尚未导入——Task 9 适配后应已有，核对即可）；`modules` 常量沿用该文件既有的测试模块定义）：

```ts
describe('面板 2s 轮询（Plan 5）', () => {
  it('打开期间每 2s 刷新；关闭后停止；读失败保留旧数据', async () => {
    vi.useFakeTimers();
    const store = createMemoryKVStore();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let gets = 0;
    const origGet = store.get.bind(store);
    (store as any).get = async (k: string) => { gets++; return origGet(k); };
    render(h(PanelApp, { store, modules }) as any, container);
    const loadOnce = () => gets; // 一次 loadPanelData = 7 次 get
    await vi.advanceTimersByTimeAsync(20);
    const afterOpen = loadOnce();
    expect(afterOpen).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2_100);
    const afterTick1 = loadOnce();
    expect(afterTick1).toBeGreaterThan(afterOpen); // 2s 后自动刷新
    // 读失败：get 抛错后 UI 保留旧数据（不清空），下一轮继续
    (store as any).get = async () => { throw new Error('boom'); };
    await vi.advanceTimersByTimeAsync(2_100);
    expect(container.textContent).toContain('模块开关');
    // 关闭：render(null) 卸载 → cleanup 停止轮询
    render(null as any, container);
    const frozen = loadOnce;
    (store as any).get = async (k: string) => { gets++; return origGet(k); };
    await vi.advanceTimersByTimeAsync(6_000);
    expect(loadOnce()).toBe(frozen()); // 关闭后零调用
    vi.useRealTimers();
  });
});
```

`packages/core/tests/stats-badge.test.ts` 追加（**导入补充**：`vi` 并入既有 vitest import 行）：

```ts
it('badge 30s 重读基线不吃掉会话未归档增量（归零口径下无重复计数）', async () => {
  vi.useFakeTimers();
  const store = createMemoryKVStore();
  await store.set('mbgt:stats:counters', { counts: { beacon: 100 }, flushedAt: 1 });
  const destroy = mountStatsBadge({ store })!;
  await vi.advanceTimersByTimeAsync(10);
  expect(document.getElementById('mbgt-stats-badge')!.textContent).toContain('100');
  recordInterception('beacon', 7); // 实时 107
  await vi.advanceTimersByTimeAsync(30_000); // 30s 重读基线（此时仍 100）→ 100+7=107
  expect(document.getElementById('mbgt-stats-badge')!.textContent).toContain('107');
  vi.useRealTimers();
  destroy();
});
```

（注意 fake timers 下 `mountStatsBadge` 内 `readStats().then` 微任务需 `advanceTimersByTimeAsync` 推进。若 30s 重读与 flush 竞态在该用例中不稳定，把断言放宽为 `toContain('107')` 于 31s 检查点——语义不变。）

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run tests/panel-ui.test.ts tests/stats-badge.test.ts`
Expected: FAIL（无轮询；无 30s 重读）

- [ ] **Step 3: 实现接线**

1. `packages/core/src/features/panel/panel.ts` 的 `PanelApp`：现有 `useEffect(() => { void reload(); }, []);` 替换为链式轮询：

```ts
  // Plan 5 §3：打开期 2s 链式轮询（上一轮完成后再安排下一轮——单飞，防慢读乱序）；关闭 cleanup 零开销
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (cancelled) return;
      try { await reload(); } catch { /* 读失败保留旧数据 */ }
      if (cancelled) return;
      timer = setTimeout(loop, 2_000);
    };
    void loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
```

2. 同文件 CDN 区 muted 文案块追加一行（D 项说明）：

```ts
    h('div', { className: 'mbgt-muted' }, '单候选也会探测并展示延迟'),
```

3. `packages/core/src/features/stats/badge.ts`：`let destroyed = false;` 后加 30s 重读 timer；destroy 清理：

```ts
    // Plan 5 §3：30s 低频重读持久基线（含 DNR，同口径最终一致）；叠加当前会话未归档增量，不覆盖实时计数
    const baselineTimer = setInterval(() => {
      void readBadgeBaseline(opts.store).then(base => {
        if (destroyed) return;
        baselineCounts = base;
        render();
      }).catch(() => { /* 重读失败保持上次基线 */ });
    }, 30_000);
```

`readStats(...)` 首次基线读取改用 `readBadgeBaseline`（替换 `void readStats(opts.store).then(stored => { baselineCounts = stored.counts; render(); })` 段为：

```ts
    void readBadgeBaseline(opts.store).then(base => {
      baselineCounts = base;
      render();
    }).catch(() => { /* 基线读取失败仍可显示会话计数 */ });
```

）destroy 返回函数加 `clearInterval(baselineTimer);`。

4. `packages/core/src/index.ts`：确认 `readBadgeBaseline`/`foldDnrCounts` 导出已在（T1 加过）。

- [ ] **Step 4: 版本 0.3.0 + README**

三处版本改 0.3.0（version.ts / userscript.meta.json / manifest.json）。README 在「CDN 智能选优」「拦截统计」「设置与面板」三段各追加一两句（内容见下）：

```markdown
- CDN 段追加：扩展形态下首次页面加载的镜像解析也会补探一次（`pendingProbe` 回放机制）；探测结果缓存 5 分钟、过期后 30 秒自动重探（页面存活期间保持新鲜）；镜像构造恒为 HTTPS，不受页面协议影响；单候选也会探测并展示延迟。
- 拦截统计段追加：统计落盘为「归零口径」——已落盘部分从会话计数中扣除，角标与面板采用相同合计口径，DNR 命中每 30 秒同步进角标（最终一致）；落盘失败自动重试不丢增量。
- 设置与面板段追加：面板打开期间每 2 秒自动刷新数据，关闭即停止（零开销）；读取失败保留上次数据。
```

- [ ] **Step 5: 全量验证 + 提交 + push**

Run: `cd packages/core && npx vitest run`；`cd packages/userscript && npx vitest run`；三包 `npx tsc --noEmit`；`pnpm --filter @mbgt/userscript build`；`pnpm --filter @mbgt/extension build`

```bash
git add -A
git commit -m "feat: 面板 2s 链式轮询 + badge 30s 同口径重读 + v0.3.0 + README"
git push origin main
```

- [ ] **Step 6: 真机冒烟 + tag**

冒烟清单（controller 执行，chrome-devtools）：
1. userscript 更新最终构建（用户代劳）→ 首页：面板打开 4s 内数据自动刷新两次（可见统计数字增长）；关闭面板后无网络/定时活动
2. 视频页：`CDN probe finished` 日志 + options/面板 CDN 区状态；badge（若开）数字与面板同口径
3. 扩展侧（developerPrivate 重载）：视频页首跳后 options 页 CDN 区即有探测结果（首载补探生效）；`mbgt:stats:dnr` 键为 ruleId
4. 全过 → 问用户确认 → tag `v0.3.0`（指向已含 release.yml 的 main 提交）→ 验证 Release 资产

---

## 交付标准（Plan 5 完成定义）

1. core + userscript vitest 全绿（新增 ≥12 用例：归零 4 + 单飞 1 + badge 基线 1 + pendingProbe 3 + selectMirror 1 + 重探 3 + 面板轮询 1 + badge 重读 1）；三包 tsc 零错误
2. 真机冒烟 4 项通过（含首载补探与 DNR 键名复验）
3. v0.3.0 Release 资产齐全（.user.js + extension.zip，tag 指向含 release.yml 的提交）

## 已知取舍

- badge DNR 基线 30s 周期同步（最终一致）——冻结 #3 明示，不追求瞬时一致
- 主动重探仅页面存活期间有效（无跨会话后台）；fallback 后不自动重试（等下一次 playinfo/导航触发）
- 面板轮询 2s 为固定值不做指数退避（打开期间才轮询，开销可接受）
