import { describe, it, expect } from 'vitest';
import { createCore } from '../src/engine/scheduler';

describe('样式收集', () => {
  it('addStyle 收集并注入 adoptedStyleSheets（无 CSS.supports 时降级 style 标签）', () => {
    const adopted: unknown[] = [];
    const w = {
      fetch: async () => new Response(''),
      console,
      location: { hostname: 'www.bilibili.com', pathname: '/video/x' },
      XMLHttpRequest: class { open() {} send() {} },
      document: {
        adoptedStyleSheets: adopted,
        createElement: () => ({}),
        head: { appendChild: () => {} }
      },
      CSSStyleSheet: class { replaceSync() {} }
    } as unknown as Window & typeof globalThis;
    const core = createCore({
      modules: [{ name: 's', description: '', any(h) { h.addStyle('body{color:red}'); } }],
      console,
      unsafeWindow: w
    });
    expect(adopted.length).toBe(1);
    core.onUnload();
  });
});
