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
