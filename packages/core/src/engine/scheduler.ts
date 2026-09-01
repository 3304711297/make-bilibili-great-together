import type { MakeBilibiliGreatTogetherHook, ModuleMeta } from '../types';
import type { MinimalConsole } from '../logger';
import { createLogger, type Logger } from '../logger';
import { ErrorCounter } from '../utils/error-counter';
import { overrideFetch, overrideXHR, type HookSets } from './hooks';

export interface CoreOptions {
  modules: ModuleMeta[];
  console: MinimalConsole;
  unsafeWindow: Window & typeof globalThis;
}

export interface CoreInstance {
  getStyles(): string[];
  /** 晚注册：document-start 之后的任意时刻注册新模块（页面钩子分发 + 样式幂等注入） */
  registerModules(newModules: ModuleMeta[]): void;
  onUnload(): void;
}

function buildHook(sets: HookSets, styles: string[], _logger: Logger): MakeBilibiliGreatTogetherHook {
  const fnWs = new WeakSet<() => void>();
  return {
    addStyle(style) { styles.push(style); },
    onBeforeFetch(cb) { sets.onBeforeFetchHooks.add(cb); },
    onResponse(cb) { sets.onResponseHooks.add(cb); },
    onXhrOpen(cb) { sets.onXhrOpenHooks.add(cb); },
    onAfterXhrOpen(cb) { sets.onAfterXhrOpenHooks.add(cb); },
    onXhrResponse(cb) { sets.onXhrResponseHooks.add(cb); },
    onlyCallOnce(fn) {
      if (fnWs.has(fn)) return;
      fnWs.add(fn);
      fn();
    }
  };
}

// 单模块分发（对齐上游：`[name] "onVideo" <href>`；禁用模块的跳过日志由 entry 层负责）
function dispatchModule(mod: ModuleMeta, hook: MakeBilibiliGreatTogetherHook, unsafeWindow: Window & typeof globalThis, logger: Logger): void {
  const { hostname, pathname, href } = unsafeWindow.location;
  const runHook = (mod: ModuleMeta, hookName: string, fn?: (h: MakeBilibiliGreatTogetherHook) => void) => {
    if (!fn) return;
    logger.log(`[${mod.name}] "${hookName}" ${href}`);
    fn(hook);
  };
  if (mod.any) { runHook(mod, 'any', mod.any); }
  if (hostname === 'www.bilibili.com') {
    if (pathname.startsWith('/read/cv')) { runHook(mod, 'onCV', mod.onCV); return; }
    if (pathname.startsWith('/video/')) {
      runHook(mod, 'onVideo', mod.onVideo);
      runHook(mod, 'onVideoOrBangumi', mod.onVideoOrBangumi);
    } else if (pathname.startsWith('/bangumi/play/')) {
      // 上游顺序：onVideo → onBangumi → onVideoOrBangumi（番剧页同样注册 video 钩子）
      runHook(mod, 'onVideo', mod.onVideo);
      runHook(mod, 'onBangumi', mod.onBangumi);
      runHook(mod, 'onVideoOrBangumi', mod.onVideoOrBangumi);
    }
  } else if (hostname === 'live.bilibili.com') {
    runHook(mod, 'onLive', mod.onLive);
  } else if (hostname === 't.bilibili.com') {
    runHook(mod, 'onStory', mod.onStory);
  }
}

function dispatchModules(modules: ModuleMeta[], hook: MakeBilibiliGreatTogetherHook, unsafeWindow: Window & typeof globalThis, logger: Logger): void {
  for (const mod of modules) {
    dispatchModule(mod, hook, unsafeWindow, logger);
  }
}

export function createCore(options: CoreOptions): CoreInstance {
  const { modules, console: cons, unsafeWindow } = options;
  const logger = createLogger(cons);
  const errorCounter = new ErrorCounter();

  const styles: string[] = [];
  const sets: HookSets = {
    onBeforeFetchHooks: new Set(),
    onResponseHooks: new Set(),
    onXhrOpenHooks: new Set(),
    onAfterXhrOpenHooks: new Set(),
    onXhrResponseHooks: new Set()
  };
  const hook = buildHook(sets, styles, logger);

  // 去重集合：同一 style 字符串只注入一次（晚注册/重复注册幂等）；flush 可重复调用
  const injectedStyles = new Set<string>();
  const flushStyles = (): void => {
    const doc = unsafeWindow.document;
    const CSSOM: (typeof CSSStyleSheet) | undefined = (unsafeWindow as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
    // 一律走 unsafeWindow 上的构造器，避免依赖打包环境全局（也便于测试注入假实现）
    const useCSSOM = !!CSSOM && typeof CSSOM.prototype.replaceSync === 'function' && Array.isArray(doc.adoptedStyleSheets);
    for (const css of styles) {
      if (injectedStyles.has(css)) continue;
      injectedStyles.add(css);
      if (useCSSOM) {
        const sheet = new (CSSOM as typeof CSSStyleSheet)();
        sheet.replaceSync(css);
        doc.adoptedStyleSheets.push(sheet);
      } else {
        const el = doc.createElement('style');
        el.textContent = css;
        doc.head?.appendChild(el);
        logger.debug('style tag fallback used');
      }
    }
  };

  dispatchModules(modules, hook, unsafeWindow, logger);
  overrideFetch(unsafeWindow, sets, logger, errorCounter);
  overrideXHR(unsafeWindow, sets, logger, errorCounter);
  flushStyles();

  return {
    getStyles: () => styles,
    registerModules(newModules) {
      for (const mod of newModules) {
        dispatchModule(mod, hook, unsafeWindow, logger);
      }
      flushStyles();
    },
    onUnload: () => { /* 预留给 Plan 2/3：菜单卸载、探测断开 */ }
  };
}
