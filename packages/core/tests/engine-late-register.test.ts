import { describe, it, expect, vi } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import type { ModuleMeta } from '../src/types';

function fakeWindow(pathname = '/video/BV1') {
  return {
    fetch: vi.fn(async () => new Response('original')),
    console,
    location: { hostname: 'www.bilibili.com', pathname },
    // open 真正执行时置 OPENED：abort 路径测试以此为可观测面（实例 spy 无法命中 super 链）
    XMLHttpRequest: class { open() { (this as { readyState?: number }).readyState = 1; } send() {} },
    document: {
      adoptedStyleSheets: [] as unknown[],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    CSSStyleSheet: class { replaceSync() {} }
  } as unknown as Window & typeof globalThis;
}

describe('CoreInstance.registerModules（晚注册）', () => {
  it('晚注册模块的 onBeforeFetch 生效于后续 fetch', async () => {
    const w = fakeWindow();
    // 必须在 createCore 之前捕获：overrideFetch 会将 w.fetch 替换为非 spy 的包装函数
    const spy = w.fetch as ReturnType<typeof vi.fn>;
    const core = createCore({ modules: [], console, unsafeWindow: w });
    core.registerModules([{
      name: 'late', description: '',
      any(h) { h.onBeforeFetch(() => new Response('late-blocked')); }
    }]);
    const res = await w.fetch('https://www.bilibili.com/x');
    expect(await res.text()).toBe('late-blocked');
    expect(spy).not.toHaveBeenCalled();
    core.onUnload();
  });

  it('晚注册按当前 location 分发页面钩子（video 页触发 onVideo）', () => {
    const w = fakeWindow('/video/BV1');
    const calls: string[] = [];
    const core = createCore({ modules: [], console, unsafeWindow: w });
    core.registerModules([{ name: 'p', description: '', onVideo: () => calls.push('video'), onLive: () => calls.push('live') }]);
    expect(calls).toEqual(['video']);
    core.onUnload();
  });

  it('晚注册的 addStyle 立即注入且不重复', () => {
    const w = fakeWindow();
    const core = createCore({ modules: [], console, unsafeWindow: w });
    const mod: ModuleMeta = {
      name: 's', description: '',
      any(h) { h.addStyle('body{color:red}'); h.addStyle('a{color:blue}'); }
    };
    core.registerModules([mod, mod]); // 同模块注册两次，样式字符串去重后 2 条
    const doc = (w as any).document;
    expect(doc.adoptedStyleSheets.length).toBe(2);
    core.registerModules([{ name: 's2', description: '', any(h) { h.addStyle('body{color:red}'); } }]);
    expect(doc.adoptedStyleSheets.length).toBe(2); // 重复字符串不重复注入
    core.onUnload();
  });

  it('初始模块的样式不被 registerModules 重复注入', () => {
    const w = fakeWindow();
    const shared: ModuleMeta = { name: 'init', description: '', any(h) { h.addStyle('p{color:green}'); } };
    const core = createCore({ modules: [shared], console, unsafeWindow: w });
    expect(((w as any).document.adoptedStyleSheets).length).toBe(1);
    core.registerModules([shared]);
    expect(((w as any).document.adoptedStyleSheets).length).toBe(1);
    core.onUnload();
  });
});

describe('overrideXHR abort 路径（R1：仍 open，noise 消除）', () => {
  it('onXhrOpen 返回 null 时 open 仍执行（state=OPENED）而 send/setRequestHeader 为 noop', () => {
    const w = fakeWindow();
    const mod: ModuleMeta = {
      name: 'xhr-blocker', description: '',
      any(h) { h.onXhrOpen(() => null); }
    };
    createCore({ modules: [mod], console, unsafeWindow: w });
    const xhr = new w.XMLHttpRequest();
    xhr.open('GET', 'https://data.bilibili.com/report');
    // B 站绑定原始 setRequestHeader 引用，仅 noop 实例属性会残留 InvalidStateError 噪音——
    // open 必须已真正执行（readyState=1 OPENED）
    expect(xhr.readyState).toBe(1);
    // setRequestHeader 为 noop：不产生网络流量（空洞的 send().not.toThrow() 断言无区分度，已删）
    expect(() => xhr.setRequestHeader('x', 'y')).not.toThrow();
    expect(xhr.readyState).toBe(1); // noop send 不改变状态
  });
});
