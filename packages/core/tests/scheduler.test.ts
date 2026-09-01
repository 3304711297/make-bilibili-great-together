import { describe, it, expect } from 'vitest';
import { createCore } from '../src/engine/scheduler';

const spyConsole = { log: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {}, group: () => {}, groupCollapsed: () => {}, groupEnd: () => {} };

function fakeWindow(pathname: string) {
  return {
    fetch: async () => new Response(''),
    console: spyConsole,
    location: { hostname: 'www.bilibili.com', pathname },
    XMLHttpRequest: class { open() {} send() {} },
    document: {
      adoptedStyleSheets: [] as unknown[],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    CSSStyleSheet: class { replaceSync() {} }
  } as unknown as Window & typeof globalThis;
}

describe('样式收集', () => {
  it('addStyle 收集并注入 adoptedStyleSheets（无 CSS.supports 时降级 style 标签）', () => {
    const w = fakeWindow('/video/x');
    const core = createCore({
      modules: [{ name: 's', description: '', any(h) { h.addStyle('body{color:red}'); } }],
      console,
      unsafeWindow: w
    });
    expect(w.document.adoptedStyleSheets.length).toBe(1);
    core.onUnload();
  });
});

describe('单模块分发隔离', () => {
  // 真机冒烟（2026-09-01）：视频页 defuse-storage length 自引用炸栈曾使
  // no-p2p/no-webrtc/remove-black-backdrop-filter 全部未执行——单模块抛错必须隔离
  it('初始分发：前序模块抛错不阻断后续模块', () => {
    const w = fakeWindow('/video/x');
    const styles = w.document.adoptedStyleSheets as unknown[];
    createCore({
      modules: [
        { name: 'boom', description: '', any() { throw new Error('boom'); } },
        { name: 'after', description: '', any(h) { h.addStyle('body{color:blue}'); } }
      ],
      console: spyConsole,
      unsafeWindow: w
    });
    expect(styles.length).toBe(1); // after 仍被分发
  });

  it('晚注册：registerModules 中抛错的模块不阻断同批次后续模块', () => {
    const w = fakeWindow('/video/x');
    const styles = w.document.adoptedStyleSheets as unknown[];
    const core = createCore({ modules: [], console: spyConsole, unsafeWindow: w });
    core.registerModules([
      { name: 'boom', description: '', any() { throw new Error('boom'); } },
      { name: 'after', description: '', any(h) { h.addStyle('body{color:blue}'); } }
    ]);
    expect(styles.length).toBe(1);
  });
});
