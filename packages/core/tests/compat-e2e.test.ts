import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import { startCompatProbe } from '../src/platform/compat-types';
import { createMemoryKVStore, readForceOnOverrides, COMPAT_STATUS_KEY } from '../src/platform/storage';
import { resolveConflicts } from '../src/features/compat/resolve';

// 结构复用 fakeScheduler（compat-probe）与 fakeWindow（engine-late-register）的既有写法，勿 import 测试文件

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

describe('compat 端到端：立即注册 + 延迟注册 + 状态落盘', () => {
  it('BewlyCat 在场时：无冲突模块即时注册，冲突模块结算后被禁用不注册', async () => {
    const w = fakeWindow('/video/BV1');
    const store = createMemoryKVStore();
    // 必须在 createCore 之前捕获：core 会将 w.fetch 替换为包装函数
    const spy = w.fetch as ReturnType<typeof vi.fn>;

    // 模拟 entry 的装配逻辑（与 Task 6 Step 3 的 entry.ts 一致）
    const allModules = [
      { name: 'net-module', description: '', any(h: any) { h.onBeforeFetch(() => new Response('blocked-by-net')); } },
      { name: 'no-ad', description: '', conflicts: [{ extension: 'bewlycat', feature: 'blockAds / 首页重构' }], any(h: any) { h.addStyle('.ad{display:none}'); } }
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
    await store.set(COMPAT_STATUS_KEY, { family: probeResult.family, extensions: probeResult.extensions.map((e: any) => e.id), generic: probeResult.generic, autoDisabled, settledAt: Date.now() });

    expect(enabled).toHaveLength(0); // no-ad 被 BewlyCat 冲突禁用
    expect(autoDisabled).toEqual([{ module: 'no-ad', extension: 'bewlycat', feature: 'blockAds / 首页重构' }]);
    // net-module 照常拦截
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('blocked-by-net');
    expect(spy).not.toHaveBeenCalled(); // 原始 fetch 未被触达
    const status = await store.get<any>(COMPAT_STATUS_KEY);
    expect(status.autoDisabled).toHaveLength(1);
    expect(status.extensions).toEqual(['bewlycat']);
    core.onUnload();
  });
});
