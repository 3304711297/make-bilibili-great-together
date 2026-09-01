import { describe, it, expect } from 'vitest';
// 以 Step 1 探明的实际导出为准，典型形态：
import { isP2PCDNDomain } from '../src/utils/get-cdn-url';
import { createCDNUtil } from '../src/utils/get-cdn-url';

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

describe('cdnUtil probe 选优接线', () => {
  it('探测缓存有效时镜像替换固定到最优宿主；无 probe 时保持随机', () => {
    const _sampleUrl = 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1&upsig=s&uparams=e,os';
    const makePlayinfo = (hosts: string[]) => ({
      data: {
        dash: {
          video: hosts.map(h => ({ baseUrl: `https://${h}/upgcxcode/9/9/x/x.m4s?os=upos&trid=1&upsig=s&uparams=e,os` })),
          audio: []
        }
      }
    });
    const util = createCDNUtil(logger2());
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com', 'upos-sz-mirrortest02.bilivideo.com']), 't1');
    const url = 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1&upsig=s&uparams=e,os';
    // 无 probe：返回值仍是镜像形态（随机宿主在候选集内）
    const out1 = util.getReplacementCdnUrl(url, 't');
    expect(out1).toMatch(/upgcxcode\/9\/9\/x\/x\.m4s/);
    expect(out1.startsWith('https://upos-sz-mirrortest0')).toBe(true);

    // 有 probe（缓存有效）：固定最优宿主
    const probe = {
      ensureProbe: () => {},
      getBestHost: () => ({ host: 'upos-sz-mirrortest02.bilivideo.com', expiresAt: Date.now() + 300_000 }),
      getStatus: () => null
    };
    const util2 = createCDNUtil(logger2(), { current: { probe } });
    util2.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com', 'upos-sz-mirrortest02.bilivideo.com']), 't2');
    expect(util2.getReplacementCdnUrl(url, 't')).toContain('upos-sz-mirrortest02.bilivideo.com');
  });
});

function logger2() {
  // 测试桩 logger：no-explicit-any 为 warn 级，直接 as any（去掉 brief 中多余的 no-require-imports disable 注释）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} } as any;
}
