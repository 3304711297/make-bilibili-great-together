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
