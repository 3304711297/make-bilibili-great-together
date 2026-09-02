import { describe, it, expect, vi } from 'vitest';
import { createCdnProbe, PROBE_CACHE_TTL_MS, REPROBE_DELAY_MS } from '../src/features/cdn-probe/probe';
import { createLogger } from '../src/logger';
import { createMemoryKVStore, type KVStore } from '../src/platform/storage';

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
    await vi.waitFor(() => expect(probe.getStatus()?.finishedAt ?? null).not.toBeNull());
    const st = probe.getStatus()!;
    expect(st.bestHost).toBe('hostB.bilivideo.com');
    expect(st.fallback).toBe(false);
    expect(st.results).toHaveLength(3);
    expect((await store.get<{ bestHost: string }>('mbgt:cdn:probe:status'))?.bestHost).toBe('hostB.bilivideo.com');
    expect(probe.getBestHost()?.host).toBe('hostB.bilivideo.com');
  });

  it('缓存有效期内重复 ensureProbe 不再探测', async () => {
    const fetchLike = fakeFetch([{ ok: true, ms: 100 }]);
    const probe = createCdnProbe({ fetchLike, logger, store });
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/x.m4s');
    await vi.waitFor(() => expect(probe.getStatus()?.finishedAt ?? null).not.toBeNull());
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/y.m4s');
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it('全部失败 → fallback=true、bestHost=null、不写缓存', async () => {
    const probe = createCdnProbe({ fetchLike: fakeFetch([{ ok: false, ms: 2_000 }]), logger, store });
    probe.ensureProbe(['dead.bilivideo.com'], 'https://dead.bilivideo.com/upgcxcode/x.m4s');
    await vi.waitFor(() => expect(probe.getStatus()?.finishedAt ?? null).not.toBeNull());
    expect(probe.getStatus()!.fallback).toBe(true);
    expect(probe.getBestHost()).toBe(null);
  });

  it('探测中重复 ensureProbe 不启动第二次探测（fetchLike 仅调用一次）', async () => {
    // fetchLike 返回永不 resolve 的 promise：探测卡在 probing 态，第二次 ensureProbe 不得再触发探测
    const fetchLike = vi.fn(() => new Promise<{ ok: boolean; ms: number }>(() => {}));
    const probe = createCdnProbe({ fetchLike: fetchLike as any, logger, store });
    probe.ensureProbe(['h.bilivideo.com'], 'https://h.bilivideo.com/upgcxcode/x.m4s');
    probe.ensureProbe(['h.bilivideo.com'], 'https://h.bilivideo.com/upgcxcode/x.m4s');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });
});

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

describe('destroy 生命周期 race（P2 修复回归）', () => {
  it('destroy 在途探测 race：无残留落盘、无残留重探 timer、状态不复活', async () => {
    vi.useFakeTimers();
    const base = createMemoryKVStore();
    const setCalls: unknown[] = [];
    const storeSpy: KVStore = {
      ...base,
      set: async (k, v) => {
        setCalls.push(v);
        return base.set(k, v);
      }
    };
    let resolveFetch: (r: { ok: boolean; ms: number }) => void = () => {};
    const fetchLike = vi.fn(() => new Promise<{ ok: boolean; ms: number }>(res => { resolveFetch = res; }));
    const probe = createCdnProbe({ fetchLike: fetchLike as any, logger, store: storeSpy });
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/x.m4s');
    // 前置：fetch 在途，状态尚未落
    expect(probe.getStatus()).toBe(null);
    // fetch 仍在途时销毁
    probe.destroy();
    resolveFetch({ ok: true, ms: 100 });
    // 冲刷微任务：在途探测自然完成，结果必须被丢弃
    await vi.advanceTimersByTimeAsync(0);
    expect(setCalls).toHaveLength(0);
    // 无残留重探 timer：TTL + 30s + 60s 后不得再发探测
    await vi.advanceTimersByTimeAsync(PROBE_CACHE_TTL_MS + REPROBE_DELAY_MS + 60_000);
    expect(fetchLike).toHaveBeenCalledTimes(1);
    expect(probe.getStatus()).toBe(null);
    vi.useRealTimers();
  });

  it('destroy 后 ensureProbe 不复活', () => {
    const fetchLike = vi.fn(async () => ({ ok: true, ms: 100 }));
    const probe = createCdnProbe({ fetchLike, logger, store });
    probe.destroy();
    probe.ensureProbe(['h1.bilivideo.com'], 'https://h1.bilivideo.com/upgcxcode/x.m4s');
    expect(fetchLike).toHaveBeenCalledTimes(0);
  });
});
