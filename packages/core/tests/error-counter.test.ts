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

  it('recordError 累积后按时间窗口裁剪（惰性清理在 getErrorCount 读取时生效）', () => {
    const ec = new ErrorCounter(1000 * 30); // 与 enhance-live 同参：30s 窗口
    ec.recordError();                        // t=0
    vi.advanceTimersByTime(10_000);          // t=10s
    ec.recordError();                        // t=10s
    vi.advanceTimersByTime(21_000);          // t=31s：第一条出窗（31s > 30s），第二条仍在窗内（21s ≤ 30s）
    expect(ec.getErrorCount()).toBe(1);
    vi.advanceTimersByTime(10_000);          // t=41s：第二条也出窗
    expect(ec.getErrorCount()).toBe(0);
  });

  it('不同 timeWindow 的实例互不干扰，shouldReport 语义不受影响', () => {
    const a = new ErrorCounter(5_000);
    const b = new ErrorCounter(60_000);
    a.recordError();
    b.recordError();
    vi.advanceTimersByTime(10_000);
    expect(a.getErrorCount()).toBe(0);  // 10s > 5s 窗口 → 裁剪为 0
    expect(b.getErrorCount()).toBe(1);  // 10s ≤ 60s 窗口 → 保留
    expect(a.shouldReport('k')).toBe(true);
    expect(a.shouldReport('k')).toBe(false);
  });
});
