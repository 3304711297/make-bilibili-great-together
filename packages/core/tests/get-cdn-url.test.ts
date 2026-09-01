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

describe('pendingProbe 首载补探（Plan 5 冻结#1）', () => {
  const makePlayinfo = (hosts: string[]) => ({
    data: { dash: { video: hosts.map(h => ({ baseUrl: `https://${h}/upgcxcode/9/9/x/x.m4s?os=upos&trid=1` })), audio: [] } }
  });
  const URL_A = 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';

  it('probe 缺失时 parse 记 pending；回放触发 ensureProbe；重复回放幂等', () => {
    const calls: { hosts: string[]; sample: string }[] = [];
    const probe = { ensureProbe: (hosts: string[], sample: string) => calls.push({ hosts, sample }), getBestHost: () => null, getStatus: () => null };
    const hooksRef: { current?: any } = {};
    const util = createCDNUtil(logger2(), hooksRef);
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com']), 't1'); // probe 缺失 → pending
    util.replayPendingProbe(); // probe 仍缺失 → no-op
    expect(calls).toHaveLength(0);
    hooksRef.current = { ...hooksRef.current, probe };
    util.replayPendingProbe();
    expect(calls).toHaveLength(1);
    expect(calls[0].sample).toBe(URL_A);
    util.replayPendingProbe(); // 幂等：pending 已清
    expect(calls).toHaveLength(1);
  });

  it('多次 playinfo 只保留最新 pending（覆盖式）', () => {
    const calls: string[] = [];
    const probe = { ensureProbe: (_h: string[], sample: string) => calls.push(sample), getBestHost: () => null, getStatus: () => null };
    const hooksRef: { current?: any } = {};
    const util = createCDNUtil(logger2(), hooksRef);
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com']), 't1');
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest02.bilivideo.com']), 't2');
    hooksRef.current = { ...hooksRef.current, probe };
    util.replayPendingProbe();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('https://upos-sz-mirrortest02.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1');
  });

  it('selectMirrorUrl：候选副本构造，incoming http/https 输出恒 https', () => {
    const probe = { ensureProbe: () => {}, getBestHost: () => ({ host: 'upos-sz-mirrortest02.bilivideo.com', expiresAt: Date.now() + 300_000 }), getStatus: () => null };
    const util = createCDNUtil(logger2(), { current: { probe } });
    util.saveAndParsePlayerInfo(makePlayinfo(['upos-sz-mirrortest01.bilivideo.com', 'upos-sz-mirrortest02.bilivideo.com']), 't');
    const httpIncoming = 'http://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';
    const httpsIncoming = 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';
    for (const incoming of [httpIncoming, httpsIncoming]) {
      const out = util.getReplacementCdnUrl(incoming, 't');
      expect(out.startsWith('https://upos-sz-mirrortest02.bilivideo.com/upgcxcode/')).toBe(true);
      expect(out.endsWith('/upgcxcode/9/9/x/x.m4s?os=upos&trid=1')).toBe(true);
    }
  });

  it('selectMirrorUrl：单条目多候选（baseUrl+backup_url）时 http incoming 输出恒 https（候选副本化路径）', () => {
    const probe = { ensureProbe: () => {}, getBestHost: () => ({ host: 'upos-sz-mirrortest02.bilivideo.com', expiresAt: Date.now() + 300_000 }), getStatus: () => null };
    const util = createCDNUtil(logger2(), { current: { probe } });
    util.saveAndParsePlayerInfo({
      data: { dash: { video: [{
        baseUrl: 'https://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1',
        backup_url: ['https://upos-sz-mirrortest02.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1']
      }], audio: [] } }
    }, 't');
    const httpIncoming = 'http://upos-sz-mirrortest01.bilivideo.com/upgcxcode/9/9/x/x.m4s?os=upos&trid=1';
    const out = util.getReplacementCdnUrl(httpIncoming, 't');
    expect(out.startsWith('https://upos-sz-mirrortest02.bilivideo.com/upgcxcode/')).toBe(true);
    expect(out.endsWith('/upgcxcode/9/9/x/x.m4s?os=upos&trid=1')).toBe(true);
  });
});

function logger2() {
  // 测试桩 logger：no-explicit-any 为 warn 级，直接 as any（去掉 brief 中多余的 no-require-imports disable 注释）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} } as any;
}
