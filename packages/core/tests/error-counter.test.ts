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
