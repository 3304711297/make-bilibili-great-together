import { describe, it, expect } from 'vitest';
import { isTopFrame } from '../src/top-frame';

describe('isTopFrame', () => {
  it('win.top === win → true', () => {
    const win = { top: undefined as unknown };
    (win as { top: unknown }).top = win;
    expect(isTopFrame(win)).toBe(true);
  });

  it('win.top 为其它对象 → false', () => {
    const win = { top: {} as unknown };
    expect(isTopFrame(win)).toBe(false);
  });

  it('win.top getter 抛错（跨源访问）→ false', () => {
    const win = Object.defineProperties({}, {
      top: { get() { throw new Error('cross-origin'); } }
    });
    expect(isTopFrame(win as { top: unknown })).toBe(false);
  });
});
