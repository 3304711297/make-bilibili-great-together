import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import type { ModuleMeta } from '../src/types';

function fakeWindow(): Window & typeof globalThis {
  const noop = () => {};
  const fake = {
    fetch: vi.fn(async () => new Response('original')),
    console,
    location: { hostname: 'www.bilibili.com', pathname: '/video/BV1' },
    XMLHttpRequest: class {
      open() {}
      send() {}
      setRequestHeader() {}
    },
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
});
