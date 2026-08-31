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
