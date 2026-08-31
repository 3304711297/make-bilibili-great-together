# Plan 1: Monorepo 脚手架 + core 引擎 + 模块移植 + Userscript 产物

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 pnpm monorepo，core 包完整移植 SukkaW 的 15 个功能模块与 hook 引擎（含单测），产出与上游功能对齐的 `.user.js`。

**Architecture:** `packages/core` 为平台无关 TypeScript 库（引擎 + 模块 + 工具），`packages/userscript` 用 rollup 打包单文件 userscript，GM API 适配层在 userscript 包内。测试用 Vitest + 伪 fetch/XHR 环境。

**Tech Stack:** TypeScript 5, pnpm workspace, Vitest, rollup (+ @rollup/plugin-typescript, rollup-plugin-userscript), ESLint 9。

**Spec:** `docs/superpowers/specs/2026-08-30-make-bilibili-great-together-design.md`（本计划覆盖其 §2 架构、§3.1 模块接口、§7 里程碑 1+2）

## Global Constraints

- Node ≥ 20（上游 `.node-version` 为准），pnpm ≥ 9
- TypeScript strict 模式；所有 hook 回调必须 try/catch 吞错不阻断页面（spec §5）
- 继承自上游的文件头部必须保留 SukkaW 版权声明（spec §6）
- 测试不依赖真实网络、真实浏览器；用伪 XHR/fetch/jsdom
- 每个任务以中文 commit message 提交（用户偏好）
- 仓库根：`C:\Users\VOS-User\Desktop\make-bilibili-great-together`（下文 `<root>` 代指）
- 上游源码获取：`git clone --depth 1 https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before "$TMPDIR/mbgte-src"`（Task 1 做，供移植参照）

---

### Task 1: Monorepo 脚手架 + Vitest 冒烟

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Test: `packages/core/tests/smoke.test.ts`

**Interfaces:**
- Produces: workspace 布局；`packages/core` 的 `test`/`build` npm scripts；后续所有任务在此结构内工作

- [ ] **Step 1: 克隆上游源码供移植参照**

```bash
cd <root>
git clone --depth 1 https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before "$TMPDIR/mbgte-src"
ls "$TMPDIR/mbgte-src/src/modules"   # 应列出 15 个 .ts 模块
```

Expected: 15 个模块文件（defuse-spyware.ts, defuse-storage.ts, disable-av1.ts, enhance-live.ts, fix-copy-in-cv.ts, force-enable-4k.ts, no-ad.ts, no-p2p.ts, no-webtrc.ts, optimize-homepage.ts, optimize-story.ts, player-video-fit.ts, remove-black-backdrop-filter.ts, remove-useless-url-params.ts, use-system-fonts.ts）

- [ ] **Step 2: 写 workspace 与基础配置**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

`package.json`（根）:

```json
{
  "name": "make-bilibili-great-together",
  "private": true,
  "packageManager": "pnpm@9",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r --workspace-concurrency=1 test",
    "build": "pnpm -r --workspace-concurrency=1 build",
    "lint": "pnpm -r --workspace-concurrency=1 lint"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
*.user.js
*.zip
coverage/
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`packages/core/package.json`:

```json
{
  "name": "@mbgt/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint src tests"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 写冒烟测试**

`packages/core/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('workspace smoke', () => {
  it('vitest works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

`packages/core/src/index.ts` 暂为空导出占位：

```ts
export const MBGT_VERSION = '0.1.0';
```

- [ ] **Step 4: 安装并验证测试通过**

Run: `cd <root> && pnpm install && pnpm test`
Expected: 冒烟测试 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: pnpm monorepo 脚手架 + core 包与 vitest 冒烟"
```

---

### Task 2: core — types + logger + error-counter

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/logger.ts`, `packages/core/src/utils/error-counter.ts`
- Test: `packages/core/tests/logger.test.ts`, `packages/core/tests/error-counter.test.ts`

**Interfaces:**
- Produces: `logger`（log/error/warn/info/debug/trace/group…，前缀 `[mbgt]`）；`ErrorCounter`（`shouldReport(key: string): boolean`，同 key 30s 内只报一次）；类型 `ModuleMeta`、`MakeBilibiliGreatTogetherHook`（本计划内 `compat` 字段先定义为可选空接口，Plan 2 填充）

- [ ] **Step 1: 写失败测试**

`packages/core/tests/error-counter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorCounter } from '../src/utils/error-counter';

describe('ErrorCounter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('同一 key 30s 内只报一次', () => {
    const ec = new ErrorCounter();
    expect(ec.shouldReport('e1')).toBe(true);
    expect(ec.shouldReport('e1')).toBe(false);
    vi.advanceTimersByTime(29_999);
    expect(ec.shouldReport('e1')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ec.shouldReport('e1')).toBe(true);
  });

  it('不同 key 互不影响', () => {
    const ec = new ErrorCounter();
    expect(ec.shouldReport('a')).toBe(true);
    expect(ec.shouldReport('b')).toBe(true);
  });
});
```

`packages/core/tests/logger.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../src/logger';

function fakeConsole() {
  return {
    log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    debug: vi.fn(), trace: vi.fn(), group: vi.fn(), groupCollapsed: vi.fn(), groupEnd: vi.fn()
  };
}

describe('createLogger', () => {
  it('所有方法可调用且带前缀', () => {
    const cons = fakeConsole();
    const logger = createLogger(cons as unknown as Console);
    logger.log('hello');
    expect(cons.log).toHaveBeenCalledWith('[mbgt]', 'hello');
  });

  it('debug 为 no-op，不触发 console', () => {
    const cons = fakeConsole();
    const logger = createLogger(cons as unknown as Console);
    logger.debug('hidden');
    expect(cons.log).not.toHaveBeenCalled();
    expect(cons.info).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run tests/logger.test.ts tests/error-counter.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`packages/core/src/utils/error-counter.ts`（移植自上游同名文件，保留其头部版权注释，把前缀改为 `mbgt`）：

```ts
// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
const ERROR_REPORT_INTERVAL = 30_000;

export class ErrorCounter {
  private lastReportTime = new Map<string, number>();

  shouldReport(key: string): boolean {
    const now = Date.now();
    const last = this.lastReportTime.get(key);
    if (last !== undefined && now - last < ERROR_REPORT_INTERVAL) {
      return false;
    }
    this.lastReportTime.set(key, now);
    return true;
  }
}
```

`packages/core/src/logger.ts`（上游 logger 的工厂化改写——上游直接绑 unsafeWindow.console，core 平台无关故改为注入 console；userscript 包负责传入 `unsafeWindow.console`）：

```ts
export type MinimalConsole = Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'group' | 'groupCollapsed' | 'groupEnd'>;

const PREFIX = '[mbgt]';

export function createLogger(console: MinimalConsole) {
  const noop = () => {};
  return {
    log: console.log.bind(console, PREFIX),
    error: console.error.bind(console, PREFIX),
    warn: console.warn.bind(console, PREFIX),
    info: console.info.bind(console, PREFIX),
    debug: noop,
    trace: noop,
    group: console.group.bind(console, PREFIX),
    groupCollapsed: console.groupCollapsed.bind(console, PREFIX),
    groupEnd: console.groupEnd.bind(console)
  };
}

export type Logger = ReturnType<typeof createLogger>;
```

`packages/core/src/types.ts`：

```ts
export type FetchArgs = Parameters<typeof fetch>;

export interface XHRDetail {
  method: string;
  url: string | URL;
  response: unknown;
  lastResponseLength: number | null;
}

export type XHROpenArgs = Parameters<XMLHttpRequest['open']>;
export type XHRDetailGetter = (xhr: XMLHttpRequest) => XHRDetail | undefined;

export type OnBeforeFetchHook = (fetchArgs: FetchArgs) => FetchArgs | { body: unknown } | null;
export type OnResponseHook = (response: Response, finalFetchArgs: FetchArgs, $fetch: typeof fetch) => Response | Promise<Response>;
export type OnXhrOpenHook = (args: XHROpenArgs, xhr: XMLHttpRequest) => XHROpenArgs | null;
export type OnAfterXhrOpenHook = (xhr: XMLHttpRequest) => void;
export type OnXhrResponseHook = (method: string, url: string | URL, response: unknown, xhr: XMLHttpRequest) => unknown;

export interface CompatConflict {
  extension: 'bewlycat' | 'avemujica';
  feature: string;
}

export interface MakeBilibiliGreatTogetherHook {
  addStyle(style: string): void;
  onBeforeFetch(cb: OnBeforeFetchHook): void;
  onResponse(cb: OnResponseHook): void;
  onXhrOpen(cb: OnXhrOpenHook): void;
  onAfterXhrOpen(cb: OnAfterXhrOpenHook): void;
  onXhrResponse(cb: OnXhrResponseHook): void;
  onlyCallOnce(fn: () => void): void;
}

export interface ModuleMeta {
  name: string;
  description: string;
  conflicts?: CompatConflict[]; // Plan 2 起生效
  any?(hook: MakeBilibiliGreatTogetherHook): void;
  onVideo?(hook: MakeBilibiliGreatTogetherHook): void;
  onBangumi?(hook: MakeBilibiliGreatTogetherHook): void;
  onVideoOrBangumi?(hook: MakeBilibiliGreatTogetherHook): void;
  onLive?(hook: MakeBilibiliGreatTogetherHook): void;
  onStory?(hook: MakeBilibiliGreatTogetherHook): void;
  onCV?(hook: MakeBilibiliGreatTogetherHook): void;
}
```

- [ ] **Step 4: 运行测试通过**

Run: `cd packages/core && pnpm vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): types/logger/error-counter 基础设施与单测"
```

---

### Task 3: core — hook 引擎（fetch/XHR 劫持 + 模块调度）

**Files:**
- Create: `packages/core/src/engine/hooks.ts`（fetch/XHR 劫持）、`packages/core/src/engine/scheduler.ts`（模块调度入口）
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/engine-hooks.test.ts`, `packages/core/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 2 的类型与 logger
- Produces: `createCore(options: CoreOptions): CoreInstance`；`CoreOptions = { modules: ModuleMeta[]; console: MinimalConsole; unsafeWindow: Window & typeof globalThis; hostname: string; pathname: string }`；`CoreInstance = { getStyles(): string[]; onUnload(): void }`（scheduler 把样式收集为 adopted stylesheet、包装 unsafeWindow.fetch/XHR）

- [ ] **Step 1: 写失败测试（伪 fetch/XHR 环境）**

`packages/core/tests/engine-hooks.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import type { ModuleMeta } from '../src/types';

function fakeWindow(): Window & typeof globalThis {
  const noop = () => {};
  const fake = {
    fetch: vi.fn(async () => new Response('original')),
    console,
    location: { hostname: 'www.bilibili.com', pathname: '/video/BV1' },
    XMLHttpRequest: class {
      open() {}
      send() {}
      setRequestHeader() {}
    },
    document: {
      adoptedStyleSheets: [] as unknown[],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    CSSStyleSheet: class { replaceSync() {} }
  } as unknown as Window & typeof globalThis;
  return fake;
}

const noopModule: ModuleMeta = { name: 'noop', description: '测试空模块' };

describe('createCore 引擎', () => {
  it('hook 后 fetch 走包装层，响应仍返回原始内容', async () => {
    const w = fakeWindow();
    const core = createCore({ modules: [noopModule], console, unsafeWindow: w });
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('original');
    core.onUnload();
  });

  it('onBeforeFetch 返回 mock Response 时短路，不发起真实请求', async () => {
    const w = fakeWindow();
    const spy = w.fetch as ReturnType<typeof vi.fn>;
    const mod: ModuleMeta = {
      name: 'blocker',
      description: '拦截测试',
      any(hook) {
        hook.onBeforeFetch(() => new Response('blocked'));
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const res = await w.fetch('https://data.bilibili.com/x');
    expect(await res.text()).toBe('blocked');
    expect(spy).not.toHaveBeenCalled();
  });

  it('onXhrOpen 返回 null 时 open/send 被置为 no-op', () => {
    const w = fakeWindow();
    const mod: ModuleMeta = {
      name: 'xhr-blocker',
      description: 'XHR 拦截测试',
      any(hook) {
        hook.onXhrOpen(() => null);
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const xhr = new w.XMLHttpRequest();
    const sendSpy = vi.spyOn(xhr, 'send');
    xhr.open('GET', 'https://data.bilibili.com/report');
    xhr.send();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('模块回调抛错不影响页面（吞错 + errorCounter 去重）', async () => {
    const w = fakeWindow();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod: ModuleMeta = {
      name: 'thrower',
      description: '抛错测试',
      any(hook) {
        hook.onBeforeFetch(() => { throw new Error('boom'); });
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const res = await w.fetch('https://www.bilibili.com/ok');
    expect(await res.text()).toBe('original');
    errSpy.mockRestore();
  });

  it('按 hostname/pathname 调度页面钩子：video 页触发 onVideo 不触发 onLive', () => {
    const w = fakeWindow();
    const calls: string[] = [];
    const a: ModuleMeta = { name: 'a', description: '', onVideo: () => calls.push('video'), onLive: () => calls.push('live') };
    createCore({ modules: [a], console, unsafeWindow: w });
    expect(calls).toEqual(['video']);
  });
});
```

`scheduler.test.ts` 中的样式收集测试（`packages/core/tests/scheduler.test.ts`）:

```ts
import { describe, it, expect } from 'vitest';
import { createCore } from '../src/engine/scheduler';

describe('样式收集', () => {
  it('addStyle 收集并注入 adoptedStyleSheets（无 CSS.supports 时降级 style 标签）', () => {
    const adopted: unknown[] = [];
    const w = {
      fetch: async () => new Response(''),
      console,
      location: { hostname: 'www.bilibili.com', pathname: '/video/x' },
      XMLHttpRequest: class { open() {} send() {} },
      document: {
        adoptedStyleSheets: adopted,
        createElement: () => ({}),
        head: { appendChild: () => {} }
      },
      CSSStyleSheet: class { replaceSync() {} }
    } as unknown as Window & typeof globalThis;
    const core = createCore({
      modules: [{ name: 's', description: '', any(h) { h.addStyle('body{color:red}'); } }],
      console,
      unsafeWindow: w
    });
    expect(adopted.length).toBe(1);
    core.onUnload();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && pnpm vitest run`
Expected: FAIL（`../src/engine/scheduler` 不存在）

- [ ] **Step 3: 实现引擎**

`packages/core/src/engine/hooks.ts`（移植上游 `src/index.ts` 的 fetch 包装与 XHR 子类，改为工厂函数形式；保留上游头部版权注释）：

```ts
// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type {
  FetchArgs, XHRDetail, XHROpenArgs,
  OnBeforeFetchHook, OnResponseHook, OnXhrOpenHook, OnAfterXhrOpenHook, OnXhrResponseHook
} from '../types';
import type { Logger } from '../logger';
import { ErrorCounter } from '../utils/error-counter';

export interface HookSets {
  onBeforeFetchHooks: Set<OnBeforeFetchHook>;
  onResponseHooks: Set<OnResponseHook>;
  onXhrOpenHooks: Set<OnXhrOpenHook>;
  onAfterXhrOpenHooks: Set<OnAfterXhrOpenHook>;
  onXhrResponseHooks: Set<OnXhrResponseHook>;
}

export function overrideFetch(
  unsafeWindow: Window & typeof globalThis,
  hooks: Pick<HookSets, 'onBeforeFetchHooks' | 'onResponseHooks'>,
  logger: Logger,
  errorCounter: ErrorCounter
): void {
  (($fetch: typeof fetch) => {
    unsafeWindow.fetch = async function (this: unknown, ...$fetchArgs: FetchArgs) {
      let abortFetch = false;
      let fetchArgs: FetchArgs | { body: unknown } | null = $fetchArgs;
      let mockResponse: Response | null = null;
      for (const onBeforeFetch of hooks.onBeforeFetchHooks) {
        try {
          fetchArgs = onBeforeFetch($fetchArgs);
          if (fetchArgs === null) { abortFetch = true; break; }
          if ('body' in fetchArgs) { abortFetch = true; mockResponse = fetchArgs as unknown as Response; break; }
        } catch (e) {
          if (errorCounter.shouldReport('before-fetch')) logger.error('Failed to run onBeforeFetch', e);
        }
      }
      if (abortFetch) {
        return (mockResponse as Response) ?? new Response();
      }
      let response = await Reflect.apply($fetch, this, $fetchArgs);
      for (const onResponse of hooks.onResponseHooks) {
        try {
          response = await onResponse(response, $fetchArgs, $fetch);
        } catch (e) {
          if (errorCounter.shouldReport('on-response')) logger.error('Failed to run onResponse', e);
        }
      }
      return response;
    } as typeof fetch;
  })(unsafeWindow.fetch);
}

export function overrideXHR(
  unsafeWindow: Window & typeof globalThis,
  hooks: HookSets,
  logger: Logger,
  errorCounter: ErrorCounter
): void {
  const xhrInstances = new WeakMap<XMLHttpRequest, XHRDetail>();
  const XHRBefore = unsafeWindow.XMLHttpRequest.prototype;

  unsafeWindow.XMLHttpRequest = class extends unsafeWindow.XMLHttpRequest {
    open(...$args: XHROpenArgs) {
      const xhrDetails: XHRDetail = { method: $args[0] as string, url: $args[1] as string | URL, response: null, lastResponseLength: null };
      let xhrArgs: XHROpenArgs | null = $args;
      for (const onXhrOpen of hooks.onXhrOpenHooks) {
        try {
          if (xhrArgs === null) break;
          xhrArgs = onXhrOpen(xhrArgs, this);
        } catch (e) {
          if (errorCounter.shouldReport('xhr-open')) logger.error('Failed to run onXhrOpen', e);
        }
      }
      if (xhrArgs === null) {
        this.send = () => {};
        this.setRequestHeader = () => {};
        return;
      }
      xhrInstances.set(this, xhrDetails);
      super.open(...(xhrArgs as Parameters<XMLHttpRequest['open']>));
      for (const onAfterXhrOpen of hooks.onAfterXhrOpenHooks) {
        try { onAfterXhrOpen(this); } catch (e) {
          if (errorCounter.shouldReport('after-xhr-open')) logger.error('Failed to run onAfterXhrOpen', e);
        }
      }
    }

    get response(): unknown {
      const originalResponse = super.response;
      if (!xhrInstances.has(this)) return originalResponse;
      const xhrDetails = xhrInstances.get(this)!;
      const responseLength = typeof originalResponse === 'string' ? originalResponse.length : null;
      if (xhrDetails.lastResponseLength !== responseLength) {
        xhrDetails.response = null;
        xhrDetails.lastResponseLength = responseLength;
      }
      if (xhrDetails.response !== null) return xhrDetails.response;
      let finalResponse = originalResponse;
      for (const onXhrResponse of hooks.onXhrResponseHooks) {
        try {
          finalResponse = onXhrResponse(xhrDetails.method, xhrDetails.url, finalResponse, this);
        } catch (e) {
          if (errorCounter.shouldReport('xhr-response')) logger.error('Failed to run onXhrResponse', e);
        }
      }
      xhrDetails.response = finalResponse;
      return finalResponse;
    }

    get responseText(): string {
      const response = this.response;
      return typeof response === 'string' ? response : super.responseText;
    }
  };

  // 反检测：保持原生 toString（上游同款做法）
  unsafeWindow.XMLHttpRequest.prototype.open.toString = () => XHRBefore.open.toString();
  unsafeWindow.XMLHttpRequest.prototype.send.toString = () => XHRBefore.send.toString();
}
```

`packages/core/src/engine/scheduler.ts`：

```ts
import type { MakeBilibiliGreatTogetherHook, ModuleMeta } from '../types';
import type { MinimalConsole } from '../logger';
import { createLogger, type Logger } from '../logger';
import { ErrorCounter } from '../utils/error-counter';
import { overrideFetch, overrideXHR, type HookSets } from './hooks';

export interface CoreOptions {
  modules: ModuleMeta[];
  console: MinimalConsole;
  unsafeWindow: Window & typeof globalThis;
}

export interface CoreInstance {
  getStyles(): string[];
  onUnload(): void;
}

function buildHook(sets: HookSets, styles: string[], logger: Logger): MakeBilibiliGreatTogetherHook {
  const fnWs = new WeakSet<() => void>();
  return {
    addStyle(style) { styles.push(style); },
    onBeforeFetch(cb) { sets.onBeforeFetchHooks.add(cb); },
    onResponse(cb) { sets.onResponseHooks.add(cb); },
    onXhrOpen(cb) { sets.onXhrOpenHooks.add(cb); },
    onAfterXhrOpen(cb) { sets.onAfterXhrOpenHooks.add(cb); },
    onXhrResponse(cb) { sets.onXhrResponseHooks.add(cb); },
    onlyCallOnce(fn) {
      if (fnWs.has(fn)) return;
      fnWs.add(fn);
      fn();
    }
  };
}

function dispatchModules(modules: ModuleMeta[], hook: MakeBilibiliGreatTogetherHook, unsafeWindow: Window & typeof globalThis): void {
  const { hostname, pathname } = unsafeWindow.location;
  for (const mod of modules) {
    if (mod.any) mod.any(hook);
    if (hostname === 'www.bilibili.com') {
      if (pathname.startsWith('/read/cv')) { mod.onCV?.(hook); continue; }
      if (pathname.startsWith('/video/')) {
        mod.onVideo?.(hook);
        mod.onVideoOrBangumi?.(hook);
      } else if (pathname.startsWith('/bangumi/play/')) {
        mod.onBangumi?.(hook);
        mod.onVideo?.(hook);
        mod.onVideoOrBangumi?.(hook);
      }
    } else if (hostname === 'live.bilibili.com') {
      mod.onLive?.(hook);
    } else if (hostname === 't.bilibili.com') {
      mod.onStory?.(hook);
    }
  }
}

function injectStyles(unsafeWindow: Window & typeof globalThis, styles: string[], logger: Logger): void {
  if (styles.length === 0) return;
  const css = styles.join('\n');
  const doc = unsafeWindow.document;
  const CSSOM: (typeof CSSStyleSheet) | undefined = (unsafeWindow as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  // 一律走 unsafeWindow 上的构造器，避免依赖打包环境全局（也便于测试注入假实现）
  if (CSSOM && typeof CSSOM.prototype.replaceSync === 'function' && Array.isArray(doc.adoptedStyleSheets)) {
    const sheet = new CSSOM();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets.push(sheet);
  } else {
    const el = doc.createElement('style');
    el.textContent = css;
    doc.head?.appendChild(el);
    logger.debug('style tag fallback used');
  }
}

export function createCore(options: CoreOptions): CoreInstance {
  const { modules, console: cons, unsafeWindow } = options;
  const logger = createLogger(cons);
  const errorCounter = new ErrorCounter();

  const styles: string[] = [];
  const sets: HookSets = {
    onBeforeFetchHooks: new Set(),
    onResponseHooks: new Set(),
    onXhrOpenHooks: new Set(),
    onAfterXhrOpenHooks: new Set(),
    onXhrResponseHooks: new Set()
  };
  const hook = buildHook(sets, styles, logger);

  dispatchModules(modules, hook, unsafeWindow);
  overrideFetch(unsafeWindow, sets, logger, errorCounter);
  overrideXHR(unsafeWindow, sets, logger, errorCounter);
  injectStyles(unsafeWindow, styles, logger);

  return {
    getStyles: () => styles,
    onUnload: () => { /* 预留给 Plan 2/3：菜单卸载、探测断开 */ }
  };
}
```

`packages/core/src/index.ts` 改为统一出口：

```ts
export { createCore, type CoreOptions, type CoreInstance } from './engine/scheduler';
export type { ModuleMeta, MakeBilibiliGreatTogetherHook, CompatConflict } from './types';
export { createLogger, type Logger, type MinimalConsole } from './logger';
export { ErrorCounter } from './utils/error-counter';
export const MBGT_VERSION = '0.1.0';
```

- [ ] **Step 4: 运行测试通过**

Run: `cd packages/core && pnpm vitest run`
Expected: 全部 PASS（engine 5 用例 + 样式 1 用例 + 既有用例）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): hook 引擎与模块调度（fetch/XHR 劫持、样式注入、吞错降级）含单测"
```

---

### Task 4: core — utils 移植

**Files:**
- Create: `packages/core/src/utils/{define-readonly-property.ts, fake-native-function.ts, get-url-from-request.ts, mock-class.ts, on-load-event.ts, get-cdn-url.ts}`
- Test: `packages/core/tests/get-url-from-request.test.ts`, `packages/core/tests/get-cdn-url.test.ts`

**Interfaces:**
- Consumes: Task 2 的 logger
- Produces: `getUrlFromRequest(request: Request | string | URL): string | null`；`createCDNUtil(...)`（沿用上游签名，见 Step 1 探明）；`createMockClass(className: string): unknown`；`defineReadonlyProperty(obj, prop, value)`；`fakeNativeFunction(fn: Function): Function`；`onLoadEvent(cb)`。这些签名是模块移植（Task 5）的依赖，移植时若上游签名有出入**以上游为准**并在 commit message 中注明

- [ ] **Step 1: 复制上游文件并适配**

```bash
cd <root>
for f in define-readonly-property fake-native-function get-url-from-request mock-class on-load-event get-cdn-url; do
  cp "$TMPDIR/mbgte-src/src/utils/$f.ts" packages/core/src/utils/$f.ts
done
```

适配规则（逐文件检查）：
1. 相对导入路径不变（目录结构一致）
2. `import { logger } from '../logger'` → 改为 `import type { Logger } from '../logger'` 并将文件内 `logger.xxx` 改为注入：构造函数/工厂多接收 `logger: Logger` 参数（上游是全局单例，core 内不允许）
3. 保留文件头版权注释，追加 `// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW`
4. 依赖 `foxts/*`（retrie、pick-random、split-nth 等）的：`cd packages/core && pnpm add foxts/retrie foxts/pick-random foxts/split-nth`（以实际 import 报错为准）

- [ ] **Step 2: 写失败测试（针对有逻辑的两个文件）**

`packages/core/tests/get-url-from-request.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getUrlFromRequest } from '../src/utils/get-url-from-request';

describe('getUrlFromRequest', () => {
  it('string 直接返回', () => {
    expect(getUrlFromRequest('https://a.b')).toBe('https://a.b');
  });
  it('URL 返回 href', () => {
    expect(getUrlFromRequest(new URL('https://a.b/c'))).toBe('https://a.b/c');
  });
  it('Request 返回 url', () => {
    expect(getUrlFromRequest(new Request('https://a.b/d'))).toBe('https://a.b/d');
  });
  it('非法输入返回 null', () => {
    expect(getUrlFromRequest(123 as unknown as Request)).toBeNull();
  });
});
```

`packages/core/tests/get-cdn-url.test.ts`（测核心判定逻辑，mock logger 注入）:

```ts
import { describe, it, expect, vi } from 'vitest';
// 以 Step 1 探明的实际导出为准，典型形态：
import { isP2PCDNDomain } from '../src/utils/get-cdn-url';

describe('isP2PCDNDomain', () => {
  it('识别已知 P2P/PCDN 域名', () => {
    expect(isP2PCDNDomain('upos-sz-302ppio.bilivideo.com')).toBe(true);
    expect(isP2PCDNDomain('xy.mcdn.bilivideo.com')).toBe(true);
    expect(isP2PCDNDomain('upos-sz-mirror14b.bilivideo.com')).toBe(true);
    expect(isP2PCDNDomain('xxx.szbdyd.com')).toBe(true);
  });
  it('正常镜像不是 P2P', () => {
    expect(isP2PCDNDomain('upos-sz-mirrorali.bilivideo.com')).toBe(false);
    expect(isP2PCDNDomain('upos-sz-mirror08c.bilivideo.com')).toBe(false);
  });
});
```

注意：若 `get-cdn-url.ts` 未导出 `isP2PCDNDomain`（上游为模块内私有函数），则在该文件 `export` 它（最小改动，不改逻辑），测试照上写。

- [ ] **Step 3: 运行确认失败 → 修复导入/注入 logger → 通过**

Run: `cd packages/core && pnpm vitest run`
Expected: 先 FAIL（如有未适配导入），修复后 PASS

- [ ] **Step 4: 全量类型检查**

Run: `cd packages/core && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): 移植上游 utils（CDN 判定/mock 类/只读属性等）并补单测"
```

---

### Task 5: core — 15 模块移植

**Files:**
- Create: `packages/core/src/modules/`（15 个文件，名单见 Step 1）与 `packages/core/src/modules/index.ts`（导出 `defaultModules: ModuleMeta[]`）
- Test: `packages/core/tests/modules.test.ts`

**Interfaces:**
- Consumes: Task 2 `ModuleMeta`/hook、Task 3 引擎、Task 4 utils
- Produces: `defaultModules`（顺序与上游 `src/index.ts` 的数组一致）——userscript 包（Task 6）与后续 compat 探测（Plan 2）依赖此名单

- [ ] **Step 1: 复制上游 15 个模块文件**

```bash
cd <root>
for f in defuse-spyware defuse-storage disable-av1 enhance-live fix-copy-in-cv force-enable-4k no-ad no-p2p no-webtrc optimize-homepage optimize-story player-video-fit remove-black-backdrop-filter remove-useless-url-params use-system-fonts; do
  cp "$TMPDIR/mbgte-src/src/modules/$f.ts" packages/core/src/modules/$f.ts
done
```

逐文件适配（与 Task 4 相同规则）：
1. `import { logger } from '../logger'` → `Logger` 注入（模块工厂化：`export default function(logger: Logger): ModuleMeta { ... }`，返回值即原对象字面量；仅此一处结构变化，其余逻辑不动）
2. 保留上游头部注释，追加 Ported 声明
3. `flru`（optimize-homepage 用到）：`pnpm add flru`
4. `unsafeWindow` 引用：模块逻辑里上游直接引用全局 `unsafeWindow`——core 内改为从 `MakeBilibiliGreatTogetherHook` 不可得，**模块内保留 `unsafeWindow` 全局引用**，由 userscript/扩展包在打包时用 `@types/tampermonkey`（或自写 `declare const unsafeWindow`）声明；测试中用 `vi.stubGlobal('unsafeWindow', fakeWindow)`

`packages/core/src/modules/index.ts`:

```ts
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import defuseStorage from './defuse-storage';
import defuseSpyware from './defuse-spyware';
import disableAV1 from './disable-av1';
import enhanceLive from './enhance-live';
import fixCopyInCV from './fix-copy-in-cv';
import forceEnable4K from './force-enable-4k';
import noAd from './no-ad';
import noP2P from './no-p2p';
import noWebRTC from './no-webtrc';
import optimizeHomepage from './optimize-homepage';
import optimizeStory from './optimize-story';
import playerVideoFit from './player-video-fit';
import removeBlackBackdropFilter from './remove-black-backdrop-filter';
import removeUselessUrlParams from './remove-useless-url-params';
import useSystemFonts from './use-system-fonts';

export function getDefaultModules(logger: Logger): ModuleMeta[] {
  return [
    defuseStorage(logger),
    defuseSpyware(logger),
    disableAV1(logger),
    enhanceLive(logger),
    fixCopyInCV(logger),
    forceEnable4K(logger),
    noAd(logger),
    noP2P(logger),
    noWebRTC(logger),
    optimizeHomepage(logger),
    optimizeStory(logger),
    playerVideoFit(logger),
    removeBlackBackdropFilter(logger),
    removeUselessUrlParams(logger),
    useSystemFonts(logger)
  ];
}
```

- [ ] **Step 2: 写失败测试（每个模块能注册钩子、样式进入收集器）**

`packages/core/tests/modules.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import { getDefaultModules } from '../src/modules';

// 模块依赖 unsafeWindow/浏览器全局，stub 最小集合
beforeAll(() => {
  vi.stubGlobal('unsafeWindow', globalThis);
  vi.stubGlobal('CSSStyleSheet', class { replaceSync() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});

describe('getDefaultModules', () => {
  const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), group: vi.fn(), groupCollapsed: vi.fn(), groupEnd: vi.fn() } as any;

  it('返回 15 个模块，名字与上游一致', () => {
    const mods = getDefaultModules(logger);
    expect(mods).toHaveLength(15);
    expect(mods.map(m => m.name)).toEqual(expect.arrayContaining([
      'defuse-spyware', 'no-p2p', 'no-webtrc', 'disable-av1', 'force-enable-4k',
      'enhance-live', 'fix-copy-in-cv', 'no-ad', 'optimize-homepage', 'optimize-story',
      'player-video-fit', 'remove-black-backdrop-filter', 'remove-useless-url-params',
      'use-system-fonts', 'defuse-storage'
    ]));
  });

  it('CSS 类模块注册的样式进入引擎收集器', () => {
    const w = {
      fetch: async () => new Response(''),
      console: logger,
      location: { hostname: 'www.bilibili.com', pathname: '/video/BV1' },
      XMLHttpRequest: class { open() {} send() {} },
      document: {
        adoptedStyleSheets: [] as unknown[],
        createElement: () => ({}),
        head: { appendChild: () => {} }
      },
      CSSStyleSheet: class { replaceSync() {} }
    } as unknown as Window & typeof globalThis;
    const core = createCore({ modules: getDefaultModules(logger), console: logger, unsafeWindow: w });
    // use-system-fonts 与 remove-black-backdrop-filter 至少贡献 1 条样式
    expect(core.getStyles().length).toBeGreaterThanOrEqual(2);
  });

  it('defuse-spyware 将 navigator.sendBeacon 改为恒真', () => {
    const beacon = vi.fn();
    vi.stubGlobal('navigator', { ...(globalThis as any).navigator, sendBeacon: beacon });
    const mod = getDefaultModules(logger).find(m => m.name === 'defuse-spyware')!;
    const h = { addStyle: vi.fn(), onBeforeFetch: vi.fn(), onXhrOpen: vi.fn(), onlyCallOnce: vi.fn() } as any;
    mod.any?.(h);
    expect((globalThis.navigator as any).sendBeacon()).toBe(true);
  });
});
```

- [ ] **Step 3: 运行确认失败 → 适配修复 → 通过**

Run: `cd packages/core && pnpm vitest run`
Expected: 全部 PASS。**这是移植保真度检查点：任何因适配改写的行为差异都必须在此暴露**

- [ ] **Step 4: 类型检查**

Run: `cd packages/core && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): 移植上游全部 15 个功能模块（Logger 注入化改造）含移植保真测试"
```

---

### Task 6: userscript 包 — GM 适配 + 打包产物

**Files:**
- Create: `packages/userscript/package.json`, `packages/userscript/rollup.config.ts`, `packages/userscript/userscript.meta.json`, `packages/userscript/src/entry.ts`, `packages/userscript/src/gm-adapter.ts`, `packages/userscript/src/module-menu.ts`
- Modify: 根 `package.json`（无——workspace 脚本已就绪）

**Interfaces:**
- Consumes: `@mbgt/core` 的 `createCore`、`getDefaultModules`、`Logger`、`MinimalConsole`
- Produces: `dist/make-bilibili-great-together.user.js`（单文件，含 meta 头）

- [ ] **Step 1: 写 meta 头与 GM 适配层**

`packages/userscript/userscript.meta.json`（脚本名遵循仓库名）:

```json
{
  "name": "Make Bilibili Great Together",
  "description": "接手 Make Bilibili Great Than Ever Before：反跟踪、反 PCDN/P2P、CDN 选优，与 BewlyCat/AveMujica 共存感知",
  "namespace": "https://github.com/VOS-User/make-bilibili-great-together",
  "run-at": "document-start",
  "match": [
    "https://www.bilibili.com/*",
    "https://t.bilibili.com/*",
    "https://live.bilibili.com/*",
    "https://space.bilibili.com/*"
  ],
  "grant": [
    "unsafeWindow",
    "GM.registerMenuCommand",
    "GM.unregisterMenuCommand",
    "GM.getValue",
    "GM.setValue",
    "GM.deleteValue",
    "GM.listValues",
    "GM_xmlhttpRequest",
    "GM.notification"
  ],
  "connect": ["bilivideo.com", "hdslb.com"]
}
```

（`connect` 为 Plan 4 的 CDN 探测预留；`GM_xmlhttpRequest` 同理，本计划不使用但不改头。）

`packages/userscript/src/gm-adapter.ts`:

```ts
export function unsafeConsole(): Console {
  return unsafeWindow.console;
}

export const unsafeWindowRef = unsafeWindow;
```

`packages/userscript/src/module-menu.ts`（移植上游 `src/utils/module-menu.ts`，行为一致：GM storage 存开关态 + 菜单命令注册/注销）：

```ts
// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '@mbgt/core';

const ENABLED_PREFIX = 'mbgt:enabled:';

export async function isModuleEnabled(mod: ModuleMeta): Promise<boolean> {
  const stored = await GM.getValue<boolean>(`${ENABLED_PREFIX}${mod.name}`);
  return stored ?? true; // 默认全部启用
}

export function initModuleMenu(mod: ModuleMeta, onToggle: (enabled: boolean) => void): boolean {
  let enabled = true;
  let menuId: string | null = null;

  const register = () => {
    const labelFor = (e: boolean) => `${e ? '☑' : '☐'} ${mod.name} — ${mod.description}`;
    menuId = GM.registerMenuCommand(labelFor(enabled), async () => {
      enabled = !enabled;
      await GM.setValue(`${ENABLED_PREFIX}${mod.name}`, enabled);
      if (menuId !== null) GM.unregisterMenuCommand(menuId);
      register();
      onToggle(enabled);
    });
  };
  register();

  GM.getValue<boolean>(`${ENABLED_PREFIX}${mod.name}`).then(stored => {
    if (stored !== undefined && stored !== enabled) {
      enabled = stored;
      if (menuId !== null) GM.unregisterMenuCommand(menuId);
      register();
      onToggle(enabled);
    }
  });

  return enabled;
}
```

（若上游 `module-menu.ts` 实际签名不同，**以上游为准移植**，保持"菜单切换→持久化→下次启动生效"语义即可。）

- [ ] **Step 2: 写入口**

`packages/userscript/src/entry.ts`:

```ts
import { createCore, createLogger, getDefaultModules } from '@mbgt/core';
import { unsafeConsole, unsafeWindowRef } from './gm-adapter';
import { initModuleMenu } from './module-menu';

const logger = createLogger(unsafeConsole());

const modules = getDefaultModules(logger);
for (const mod of modules) {
  // Plan 2 起此处接入共存探测结果；当前仅注册菜单，默认全启用
  initModuleMenu(mod, () => { /* 开关生效于下次加载（与上游语义一致） */ });
}

createCore({
  modules,
  console: unsafeConsole(),
  unsafeWindow: unsafeWindowRef
});
```

- [ ] **Step 3: 配置 rollup 并构建**

`packages/userscript/package.json`:

```json
{
  "name": "@mbgt/userscript",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "rollup -c rollup.config.ts --configPlugin typescript2",
    "test": "echo \"no unit tests in userscript package\" && exit 0",
    "lint": "eslint src"
  },
  "dependencies": { "@mbgt/core": "workspace:*" },
  "devDependencies": {
    "rollup": "^4.0.0",
    "@rollup/plugin-typescript": "^11.0.0",
    "@rollup/plugin-json": "^6.0.0",
    "rollup-plugin-userscript": "^0.6.0",
    "@types/tampermonkey": "^5.0.0",
    "typescript": "^5.5.0"
  }
}
```

`packages/userscript/rollup.config.ts`:

```ts
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import userscript from 'rollup-plugin-userscript';

export default {
  input: 'src/entry.ts',
  output: {
    file: 'dist/make-bilibili-great-together.user.js',
    format: 'iife'
  },
  plugins: [
    json(),
    userscript('./userscript.meta.json'),
    typescript({ tsconfig: './tsconfig.json' })
  ]
};
```

`packages/userscript/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["tampermonkey"] },
  "include": ["src", "userscript.meta.json"]
}
```

Run: `cd <root> && pnpm install && pnpm --filter @mbgt/userscript build`
Expected: `dist/make-bilibili-great-together.user.js` 生成；文件头含 `// ==UserScript==` 且 meta 字段齐全；IIFE 内含 `[mbgt]` logger 前缀与 15 个模块名

- [ ] **Step 4: 构建产物断言（脚本化冒烟）**

```bash
cd packages/userscript
grep -q "==UserScript==" dist/make-bilibili-great-together.user.js
grep -q "document-start" dist/make-bilibili-great-together.user.js
for m in defuse-spyware no-p2p no-webtrc use-system-fonts; do grep -q "$m" dist/make-bilibili-great-together.user.js; done
echo OK
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(userscript): GM 适配层+菜单移植+rollup 打包产出 .user.js"
```

---

### Task 7: 根 README + ESLint + CI（build+test+lint）

**Files:**
- Create: `README.md`, `.github/workflows/ci.yml`, `eslint.config.js`
- Modify: 各包 `lint` script 确保 `pnpm lint` 可跑

**Interfaces:**
- Consumes: 无
- Produces: CI 工作流（PR 触发 build+test+lint）；README 骨架（含三上游致谢）

- [ ] **Step 1: ESLint 扁平配置（最小化，贴上游规则）**

`eslint.config.js`:

```js
import eslint from '@eslint/js';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
];
```

根 `package.json` devDependencies 追加：`"eslint": "^9.0.0"`, `"@eslint/js": "^9.0.0"`。各包 `pnpm lint` 若因扁平配置位置无法解析，在包内 `package.json` 的 lint 脚本加 `--no-config-lookup -c ../../eslint.config.js` 或直接在根 lint 一把梭：`"lint": "eslint packages/*/src"`（取能跑通者）。

- [ ] **Step 2: README 骨架**

`README.md`:

```markdown
# Make Bilibili Great Together

接手 [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（MIT © SukkaW）：
B 站反跟踪、反 PCDN/P2P、播放链路增强，**双形态**（userscript + MV3 扩展），与
[BewlyCat](https://github.com/keleus/BewlyCat)、[BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 共存感知。

> 当前状态：核心引擎与 userscript 形态（Plan 1）。共存感知、扩展形态、点睛功能开发中。

## 安装（userscript）

GitHub Releases 直链（发版后可用）或 jsDelivr：`https://cdn.jsdelivr.net/gh/<owner>/make-bilibili-great-together@<tag>/packages/userscript/dist/make-bilibili-great-together.user.js`

## 与扩展共存

安装 BewlyCat / AveMujica 时，重复功能模块将自动停用（开发中，见 spec §3）。

## 致谢

- [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before) — 核心模块与引擎架构来源（MIT）
- [keleus/BewlyCat](https://github.com/keleus/BewlyCat) — 共存兼容目标
- [VentusUta/BewlyBewly-AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) — 共存兼容目标
- [BewlyBewly](https://github.com/BewlyBewly/BewlyBewly) — 上游上游
```

- [ ] **Step 3: CI 工作流**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - name: 产物冒烟
        run: |
          test -f packages/userscript/dist/make-bilibili-great-together.user.js
          grep -q "==UserScript==" packages/userscript/dist/make-bilibili-great-together.user.js
```

- [ ] **Step 4: 全量验证**

Run: `cd <root> && pnpm install && pnpm lint && pnpm test && pnpm build`
Expected: lint 0 error（warning 允许）、测试全 PASS、构建产物生成

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "ci: lint/test/build 工作流 + README 骨架与上游致谢"
```

---

## 交付标准（Plan 1 完成定义）

1. `pnpm test` 全绿（含引擎 5 用例、CDN 判定、模块保真、error-counter）
2. `packages/userscript/dist/make-bilibili-great-together.user.js` 可在 ScriptCat 安装并加载（真机冒烟：B 站视频页控制台出现 `[mbgt]` 前缀日志、菜单含 15 个模块开关）
3. CI 三件套（lint/test/build）在 PR 上跑通
4. 所有继承文件头部保留 SukkaW 版权声明

## 后续计划（占位，完成后逐个开写）

- Plan 2: 共存感知 + compat 元数据生效（真机确认 optimize-story 冲突表两项）
- Plan 3: MV3 扩展 + declarativeNetRequest
- Plan 4: CDN 选优 / 拦截统计 / 设置面板 + tag-only 发版流水线
