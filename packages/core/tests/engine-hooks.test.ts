import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import type { ModuleMeta } from '../src/types';

// 最小 fake XHR：需要 response 存取器供引擎的 response getter super 委托读取
class FakeXHR {
  protected _response = '';
  get response() { return this._response; }
  set response(v: unknown) { this._response = v as string; }
  open() {}
  send() { this._response = '{"ok":true}'; }
  setRequestHeader() {}
}

function fakeWindow(pathname = '/video/BV1'): Window & typeof globalThis {
  const fake = {
    fetch: vi.fn(async () => new Response('original')),
    console,
    location: { hostname: 'www.bilibili.com', pathname, href: `https://www.bilibili.com${pathname}` },
    XMLHttpRequest: FakeXHR,
    document: {
      adoptedStyleSheets: [] as unknown[],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    CSSStyleSheet: class { replaceSync() {} }
  } as unknown as Window & typeof globalThis;
  return fake;
}

const noopModule: ModuleMeta = { name: 'noop', description: '测试空模块' };

describe('createCore 引擎', () => {
  it('hook 后 fetch 走包装层，响应仍返回原始内容', async () => {
    const w = fakeWindow();
    const core = createCore({ modules: [noopModule], console, unsafeWindow: w });
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('original');
    core.onUnload();
  });

  it('onBeforeFetch 返回 mock Response 时短路，不发起真实请求', async () => {
    const w = fakeWindow();
    const spy = w.fetch as ReturnType<typeof vi.fn>;
    const mod: ModuleMeta = {
      name: 'blocker',
      description: '拦截测试',
      any(hook) {
        hook.onBeforeFetch(() => new Response('blocked'));
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const res = await w.fetch('https://data.bilibili.com/x');
    expect(await res.text()).toBe('blocked');
    expect(spy).not.toHaveBeenCalled();
  });

  it('onBeforeFetch 返回新数组时 fetch 收到替换后的实参（链式替换）', async () => {
    const w = fakeWindow();
    const spy = w.fetch as ReturnType<typeof vi.fn>;
    const mod: ModuleMeta = {
      name: 'replacer',
      description: '替换测试',
      any(hook) {
        hook.onBeforeFetch(() => ['https://replaced.example/x', undefined]);
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    await w.fetch('https://www.bilibili.com/original');
    expect((spy.mock.calls[0] as unknown[])[0]).toBe('https://replaced.example/x');
  });

  it('onXhrOpen 返回 null 时 open/send 被置为 no-op', () => {
    const w = fakeWindow();
    const mod: ModuleMeta = {
      name: 'xhr-blocker',
      description: 'XHR 拦截测试',
      any(hook) {
        hook.onXhrOpen(() => null);
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const xhr = new w.XMLHttpRequest();
    const sendSpy = vi.spyOn(xhr, 'send');
    xhr.open('GET', 'https://data.bilibili.com/report');
    xhr.send();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('onResponse 链式：第二个 hook 收到第一个 hook 的返回值', async () => {
    const w = fakeWindow();
    const seenBySecond: string[] = [];
    const mod: ModuleMeta = {
      name: 'chain',
      description: '链式响应测试',
      any(hook) {
        hook.onResponse(async res => new Response(`${await res.text()}-a`));
        hook.onResponse(async res => {
          seenBySecond.push(await res.text());
          return new Response(`${seenBySecond[0]}-b`);
        });
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('original-a-b');
    expect(seenBySecond).toEqual(['original-a']);
  });

  it('onResponse 抛错不影响响应（吞错路径）', async () => {
    const w = fakeWindow();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod: ModuleMeta = {
      name: 'resp-thrower',
      description: '响应抛错测试',
      any(hook) {
        hook.onResponse(() => { throw new Error('resp boom'); });
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const res = await w.fetch('https://www.bilibili.com/ok');
    expect(await res.text()).toBe('original');
    errSpy.mockRestore();
  });

  it('onXhrResponse 改写响应串：xhr.response 返回改写值', () => {
    const w = fakeWindow();
    const mod: ModuleMeta = {
      name: 'xhr-resp',
      description: 'XHR 响应改写测试',
      any(hook) {
        hook.onXhrResponse((_method, _url, resp) => `${resp}-patched`);
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const xhr = new w.XMLHttpRequest();
    xhr.open('GET', 'https://data.bilibili.com/api');
    xhr.send();
    expect(xhr.response).toBe('{"ok":true}-patched');
  });

  it('onAfterXhrOpen：open 后回调被调用且收到 xhr 实例', () => {
    const w = fakeWindow();
    const seen: unknown[] = [];
    const mod: ModuleMeta = {
      name: 'after-open',
      description: 'open 后回调测试',
      any(hook) {
        hook.onAfterXhrOpen(xhr => { seen.push(xhr); });
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const xhr = new w.XMLHttpRequest();
    xhr.open('GET', 'https://www.bilibili.com/api');
    expect(seen).toEqual([xhr]);
  });

  it('模块回调抛错不影响页面（吞错 + errorCounter 去重）', async () => {
    const w = fakeWindow();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod: ModuleMeta = {
      name: 'thrower',
      description: '抛错测试',
      any(hook) {
        hook.onBeforeFetch(() => { throw new Error('boom'); });
      }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const res = await w.fetch('https://www.bilibili.com/ok');
    expect(await res.text()).toBe('original');
    errSpy.mockRestore();
  });

  it('按 hostname/pathname 调度页面钩子：video 页触发 onVideo 不触发 onLive', () => {
    const w = fakeWindow();
    const calls: string[] = [];
    const a: ModuleMeta = { name: 'a', description: '', onVideo: () => calls.push('video'), onLive: () => calls.push('live') };
    createCore({ modules: [a], console, unsafeWindow: w });
    expect(calls).toEqual(['video']);
  });

  it('bangumi 页 dispatch 顺序与上游一致：onVideo → onBangumi → onVideoOrBangumi', () => {
    const w = fakeWindow('/bangumi/play/ep1');
    const order: string[] = [];
    const mod: ModuleMeta = {
      name: 'order',
      description: '顺序锁定测试',
      onVideo: () => order.push('video'),
      onBangumi: () => order.push('bangumi'),
      onVideoOrBangumi: () => order.push('videoOrBangumi')
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    expect(order).toEqual(['video', 'bangumi', 'videoOrBangumi']);
  });
});
