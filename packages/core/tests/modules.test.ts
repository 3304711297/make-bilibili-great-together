import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import { getDefaultModules } from '../src/modules';
import type { Logger } from '../src/logger';
import type { MakeBilibiliGreatTogetherHook } from '../src/types';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; }
  };
}

beforeAll(() => {
  vi.stubGlobal('unsafeWindow', globalThis);
  vi.stubGlobal('CSSStyleSheet', class { replaceSync() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('navigator', { maxTouchPoints: 0, sendBeacon: () => false });
  class FakeMediaElement {
    canPlayType(type: string) {
      return type.includes('mp4') ? 'maybe' : '';
    }
  }
  vi.stubGlobal('HTMLMediaElement', FakeMediaElement);
  vi.stubGlobal('MediaSource', class {
    static isTypeSupported = (type: string) => type.includes('mp4');
  });
  vi.stubGlobal('self', { setInterval: () => 0, clearInterval: () => {} });
  vi.stubGlobal('location', { href: 'https://www.bilibili.com/video/BV1xx?buvid=xyz&spm_id_from=1' });
  vi.stubGlobal('history', { pushState() {}, replaceState() {} });
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
  vi.stubGlobal('document', {
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {} }),
    body: { toggleAttribute() {} },
    documentElement: {
      setAttribute() {},
      removeAttribute() {}
    }
  });
});

describe('getDefaultModules 契约与各功能模块测试', () => {
  const logger = Object.fromEntries(
    ['log', 'error', 'warn', 'info', 'debug', 'trace', 'group', 'groupCollapsed', 'groupEnd'].map(k => [k, vi.fn()])
  ) as unknown as Logger;

  it('返回 12 个健康核心模块，剔除已废弃毒瘤模块', () => {
    const mods = getDefaultModules(logger);
    expect(mods).toHaveLength(12);
    expect(mods.map(m => m.name)).toEqual([
      'defuse-spyware',
      'disable-av1',
      'enhance-live',
      'fix-copy-in-cv',
      'no-ad',
      'no-p2p',
      'no-webrtc',
      'optimize-homepage',
      'optimize-story',
      'player-video-fit',
      'remove-useless-url-params',
      'use-system-fonts'
    ]);
  });

  it('CSS 类模块注册的样式进入引擎收集器', () => {
    const uw: Record<string, unknown> = {
      navigator: { ...globalThis.navigator },
      localStorage: fakeStorage(),
      history: { pushState() {}, replaceState() {} },
      HTMLMediaElement: class {},
      MediaSource: class {},
      location: { href: 'https://www.bilibili.com/video/BV1xx?buvid=xyz' }
    };
    vi.stubGlobal('unsafeWindow', uw);
    const w = {
      fetch: async () => new Response(''),
      console: logger,
      location: { hostname: 'www.bilibili.com', pathname: '/video/BV1' },
      XMLHttpRequest: class { open() {} send() {} },
      document: {
        adoptedStyleSheets: [] as unknown[],
        createElement: () => ({}),
        head: { appendChild: () => {} }
      },
      CSSStyleSheet: class { replaceSync() {} }
    } as unknown as Window & typeof globalThis;
    const core = createCore({ modules: getDefaultModules(logger), console: logger, unsafeWindow: w });
    // use-system-fonts / no-ad / optimize-homepage / player-video-fit
    expect(core.getStyles().length).toBeGreaterThanOrEqual(3);
  });

  it('disable-av1: 拦截 av01 编码并透传其他合法编码', () => {
    class MediaElem {
      canPlayType(type: string) {
        return type.includes('mp4') ? 'maybe' : '';
      }
    }
    const origCanPlay = vi.fn((type: string) => (type.includes('mp4') ? 'maybe' : ''));
    MediaElem.prototype.canPlayType = origCanPlay;

    const mediaSource = class {
      static isTypeSupported = vi.fn((type: string) => type.includes('mp4'));
    };
    vi.stubGlobal('HTMLMediaElement', MediaElem);
    vi.stubGlobal('MediaSource', mediaSource);
    vi.stubGlobal('unsafeWindow', { MediaSource: mediaSource });

    const mod = getDefaultModules(logger).find(m => m.name === 'disable-av1')!;
    mod.any?.({ onlyCallOnce: (fn: () => void) => fn() } as unknown as MakeBilibiliGreatTogetherHook);

    const instance = new MediaElem();
    // av01 必须被阻断
    expect(instance.canPlayType('video/mp4; codecs="av01.0.08M.08"')).toBe('');
    expect(mediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"')).toBe(false);

    // 非 av01 必须 100% 透传原生结果
    expect(instance.canPlayType('video/mp4; codecs="avc1.640028"')).toBe('maybe');
    expect(mediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"')).toBe(true);
  });

  it('defuse-spyware: 拦截 sendBeacon 与打点请求，正常请求放行', () => {
    const navObj = { ...globalThis.navigator, sendBeacon: vi.fn() };
    vi.stubGlobal('navigator', navObj);
    vi.stubGlobal('unsafeWindow', { navigator: navObj, location: { href: 'https://www.bilibili.com' } });

    let fetchHook: ((args: [RequestInfo | URL, RequestInit?]) => unknown) | undefined;
    let xhrHook: ((args: [string, string | URL, ...unknown[]]) => unknown) | undefined;

    const mod = getDefaultModules(logger).find(m => m.name === 'defuse-spyware')!;
    mod.any?.({
      onBeforeFetch: (fn) => { fetchHook = fn; },
      onXhrOpen: (fn) => { xhrHook = fn; }
    } as unknown as MakeBilibiliGreatTogetherHook);

    // 1. sendBeacon 拦截并返回 true
    expect(navObj.sendBeacon()).toBe(true);

    // 2. 打点 URL 拦截
    const blockedRes = fetchHook?.(['https://data.bilibili.com/log/web']);
    expect(blockedRes).toBeInstanceOf(Response);

    const blockedXhr = xhrHook?.(['POST', 'https://cm.bilibili.com/cm/api']);
    expect(blockedXhr).toBeNull();

    // 3. 正常请求 100% 原样放行
    const normalArgs: [RequestInfo | URL, RequestInit?] = ['https://api.bilibili.com/x/web-interface/nav'];
    expect(fetchHook?.(normalArgs)).toBe(normalArgs);
  });

  it('remove-useless-url-params: 精准剥离 tracking 参数且保留业务路由参数', () => {
    let replacedUrl: string | undefined;
    const historyObj = {
      pushState: vi.fn(),
      replaceState: vi.fn((_state, _title, url) => { replacedUrl = url; })
    };
    vi.stubGlobal('unsafeWindow', {
      history: historyObj,
      location: { href: 'https://www.bilibili.com/video/BV1xx?buvid=abc&spm_id_from=333.1007&mid=12345&up_id=67890' }
    });

    const mod = getDefaultModules(logger).find(m => m.name === 'remove-useless-url-params')!;
    mod.any?.({} as MakeBilibiliGreatTogetherHook);

    expect(replacedUrl).toBeDefined();
    const parsed = new URL(replacedUrl!);
    // 追踪参数被剔除
    expect(parsed.searchParams.has('buvid')).toBe(false);
    expect(parsed.searchParams.has('spm_id_from')).toBe(false);
    // 业务参数完好保留
    expect(parsed.searchParams.get('mid')).toBe('12345');
    expect(parsed.searchParams.get('up_id')).toBe('67890');
  });

  it('player-video-fit: 轮询具备 MAX_ATTEMPTS 上限，无播放器时安全停止', () => {
    let intervalFn: (() => void) | undefined;
    let clearIntervalCalled = false;
    vi.stubGlobal('self', {
      setInterval: (fn: () => void) => { intervalFn = fn; return 123; },
      clearInterval: () => { clearIntervalCalled = true; }
    });

    const mod = getDefaultModules(logger).find(m => m.name === 'player-video-fit')!;
    mod.onVideo?.({ addStyle: vi.fn() } as unknown as MakeBilibiliGreatTogetherHook);

    expect(intervalFn).toBeDefined();
    // 模拟轮询 31 次（超过 MAX_ATTEMPTS 30 次）
    for (let i = 0; i <= 31; i++) {
      intervalFn?.();
    }
    // 必须自动清除定时器，杜绝无限空转泄漏
    expect(clearIntervalCalled).toBe(true);
  });

  it('enhance-live: 在无 GM 运行时环境下安全降级，绝不抛出 ReferenceError', () => {
    // 确保全局无 GM
    vi.stubGlobal('GM', undefined);

    let onResponseHook: ((resp: Response, args: unknown[], $fetch: unknown) => unknown) | undefined;
    const mod = getDefaultModules(logger).find(m => m.name === 'enhance-live')!;
    mod.onLive?.({
      addStyle: vi.fn(),
      onBeforeFetch: vi.fn(),
      onResponse: (fn) => { onResponseHook = fn; }
    } as unknown as MakeBilibiliGreatTogetherHook);

    expect(onResponseHook).toBeDefined();
    // 模拟多次 403 失败，验证错误分支安全执行且不崩溃
    const failResp = new Response('', { status: 403 });
    Object.defineProperty(failResp, 'url', { value: 'https://live-bvc.bilivideo.com/live-bvc/123/live_123_456.m3u8' });

    for (let i = 0; i < 6; i++) {
      expect(() => onResponseHook?.(failResp, [''], vi.fn())).not.toThrow();
    }
  });
});
