import { describe, it, expect } from 'vitest';
import { hasExtensionMarker } from '../src/top-frame';

describe('hasExtensionMarker（T7 双形态同装检测，纯函数）', () => {
  it('window.__mbgt_extension_active__ 为 true → true', () => {
    expect(hasExtensionMarker({ __mbgt_extension_active__: true })).toBe(true);
  });

  it('标记不存在 → false', () => {
    expect(hasExtensionMarker({})).toBe(false);
  });

  it('标记为 falsy（如手动置 false/undefined）→ false', () => {
    expect(hasExtensionMarker({ __mbgt_extension_active__: false })).toBe(false);
    expect(hasExtensionMarker({ __mbgt_extension_active__: undefined })).toBe(false);
  });
});
