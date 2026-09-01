import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createCore } from '../src/engine/scheduler';
import { getDefaultModules } from '../src/modules';

// 模块依赖 unsafeWindow/浏览器全局，stub 最小集合。
// 注意：模块逻辑沿用上游写法直接引用全局 unsafeWindow（brief 适配规则 4），
// 故这里 stub 的 unsafeWindow = globalThis，模块运行期触碰的浏览器全局都在 globalThis 上补齐；
// createCore 的 unsafeWindow 实参仅承载引擎自身需要的最小面（location/fetch/XHR/document/样式注入）。
// （在 brief 基础上按实际注册路径补齐的 stub 见 task-5 报告适配清单）
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
  // defuse-spyware / force-enable-4k：navigator 读写
  vi.stubGlobal('navigator', { maxTouchPoints: 0, sendBeacon: () => false });
  // disable-av1：HTMLMediaElement（global 引用）与 unsafeWindow.MediaSource
  vi.stubGlobal('HTMLMediaElement', class {});
  vi.stubGlobal('MediaSource', class {});
  // player-video-fit：注册时 self.setInterval 轮询注入按钮；测试中不真正起定时器
  vi.stubGlobal('self', { setInterval: () => 0, clearInterval: () => {} });
  // remove-useless-url-params：注册时读 location.href、包 unsafeWindow.history
  vi.stubGlobal('location', { href: 'https://www.bilibili.com/video/BV1xx?buvid=xyz&spm_id_from=1' });
  vi.stubGlobal('history', { pushState() {}, replaceState() {} });
  // defuse-storage：unsafeWindow.indexedDB / unsafeWindow.localStorage
  vi.stubGlobal('indexedDB', { databases: async () => [] });
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
  // no-p2p 的 microtask/DOMContentLoaded 兜底、use-system-fonts / fix-copy-in-cv / player-video-fit 的 document 引用
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

describe('getDefaultModules', () => {
  const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), group: vi.fn(), groupCollapsed: vi.fn(), groupEnd: vi.fn() } as any;

  it('返回 15 个模块，名字与上游一致', () => {
    const mods = getDefaultModules(logger);
    expect(mods).toHaveLength(15);
    expect(mods.map(m => m.name)).toEqual(expect.arrayContaining([
      'defuse-spyware', 'no-p2p', 'no-webrtc', 'disable-av1', 'force-enable-4k',
      'enhance-live', 'fix-copy-in-cv', 'no-ad', 'optimize-homepage', 'optimize-story',
      'player-video-fit', 'remove-black-backdrop-filter', 'remove-useless-url-params',
      'use-system-fonts', 'disable-storage'
    ]));
  });

  it('getDefaultModules 顺序与上游 src/index.ts 的 modules 数组一致', () => {
    const mods = getDefaultModules(logger);
    expect(mods.map(m => m.name)).toEqual([
      'disable-storage', // 上游 defuse-storage.ts 内声明的模块名即为 disable-storage
      'defuse-spyware',
      'disable-av1',
      'enhance-live',
      'fix-copy-in-cv',
      'force-enable-4k',
      'no-ad',
      'no-p2p',
      'no-webrtc',
      'optimize-homepage',
      'optimize-story',
      'player-video-fit',
      'remove-black-backdrop-filter',
      'remove-useless-url-params',
      'use-system-fonts'
    ]);
  });

  it('CSS 类模块注册的样式进入引擎收集器', () => {
    // 模块按上游设计写 unsafeWindow；core 单全局域下 bare localStorage 与 unsafeWindow.localStorage
    // 是同一绑定，defuse-storage 重定义后会自引用（上游沙盒为双域无此问题）。
    // 这里把 unsafeWindow 指向独立新对象，bare 全局保持 beforeAll 的 stub。
    const uw: Record<string, unknown> = {
      navigator: { ...(globalThis as any).navigator },
      indexedDB: { databases: async () => [] },
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
    // use-system-fonts / remove-black-backdrop-filter / no-ad / optimize-homepage 四个 any 模块均 addStyle
    expect(core.getStyles().length).toBeGreaterThanOrEqual(4);
  });

  it('force-enable-4k 的 onVideo 钩子可正常清理播放器偏好键（回归：TDZ）', () => {
    // 预置一个会被清理的键，确保 hook() 实际触达 OUR_KEYS 分支
    // （localStorage 为空时 hook 不会引用 OUR_KEYS，这就是此前 22 用例未抓住 TDZ 的原因）
    (globalThis as any).localStorage.setItem('bilibili_player_force_src', '1');
    // overrideUA 会以 configurable:false 写 navigator.userAgent（模块按上游设计每页面只跑一次），
    // 指向独立新对象避免与前面用例留下的只读属性冲突
    vi.stubGlobal('unsafeWindow', { navigator: { maxTouchPoints: 0 } });
    const mod = getDefaultModules(logger).find(m => m.name === 'force-enable-4k')!;
    const h = { addStyle: vi.fn(), onBeforeFetch: vi.fn(), onXhrOpen: vi.fn(), onAfterXhrOpen: vi.fn(), onXhrResponse: vi.fn(), onResponse: vi.fn(), onlyCallOnce: (fn: () => void) => fn() } as any;
    expect(() => mod.onVideo?.(h)).not.toThrow();
    expect((globalThis as any).localStorage.getItem('bilibili_player_force_src')).toBe(null);
  });

  it('defuse-spyware 将 navigator.sendBeacon 改为恒真', () => {
    const beacon = vi.fn();
    const navObj = { ...(globalThis as any).navigator, sendBeacon: beacon };
    // 模块按上游设计为每页面运行一次（defineReadonlyProperty 以 configurable:false 写入全局），
    // 这里把 unsafeWindow 指向独立的新对象，避免与前面用例已写入 globalThis 的只读属性冲突
    vi.stubGlobal('navigator', navObj);
    vi.stubGlobal('unsafeWindow', { navigator: navObj });
    const mod = getDefaultModules(logger).find(m => m.name === 'defuse-spyware')!;
    const h = { addStyle: vi.fn(), onBeforeFetch: vi.fn(), onXhrOpen: vi.fn(), onlyCallOnce: vi.fn() } as any;
    mod.any?.(h);
    expect((globalThis.navigator as any).sendBeacon()).toBe(true);
  });

  it('defuse-storage 的 mock length 读闭包原始 storage，不自引用（真机冒烟回归：视频页炸栈）', () => {
    // 复现单全局域：bare localStorage 解析到 globalThis 的 storage，而 mock 安装在 unsafeWindow 上。
    // 若 mock length 误引用 bare localStorage（= globalThis 的 fakeA），读到的将是 2 而非 5；
    // 修复后应读闭包内 orignalLocalStorage（fakeB，5 条）。
    const fakeA = fakeStorage();
    fakeA.setItem('a', '1');
    fakeA.setItem('b', '2');
    const fakeB = fakeStorage();
    for (let i = 0; i < 5; i++) fakeB.setItem(`k${i}`, String(i));
    vi.stubGlobal('localStorage', fakeA);
    const uw: Record<string, unknown> = {
      navigator: { ...(globalThis as any).navigator },
      indexedDB: { databases: async () => [] },
      localStorage: fakeB,
      HTMLMediaElement: class {},
      MediaSource: class {},
      location: { href: 'https://www.bilibili.com/' }
    };
    vi.stubGlobal('unsafeWindow', uw);
    const mod = getDefaultModules(logger).find(m => m.name === 'disable-storage')!;
    const h = { addStyle: vi.fn(), onBeforeFetch: vi.fn(), onXhrOpen: vi.fn(), onXhrResponse: vi.fn(), onResponse: vi.fn(), onlyCallOnce: vi.fn() } as any;
    mod.any?.(h);
    const mocked = (uw as any).localStorage;
    expect(mocked).not.toBe(fakeB); // mock 已装上
    expect(() => mocked.length).not.toThrow();
    expect(mocked.length).toBe(5); // store.size(0) + orignal(5)，而非 fakeA 的 2
  });
});
