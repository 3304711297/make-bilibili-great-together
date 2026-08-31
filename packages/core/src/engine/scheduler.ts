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
  onUnload(): void;
}

function buildHook(sets: HookSets, styles: string[], logger: Logger): MakeBilibiliGreatTogetherHook {
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

function dispatchModules(modules: ModuleMeta[], hook: MakeBilibiliGreatTogetherHook, unsafeWindow: Window & typeof globalThis): void {
  const { hostname, pathname } = unsafeWindow.location;
  for (const mod of modules) {
    if (mod.any) mod.any(hook);
    if (hostname === 'www.bilibili.com') {
      if (pathname.startsWith('/read/cv')) { mod.onCV?.(hook); continue; }
      if (pathname.startsWith('/video/')) {
        mod.onVideo?.(hook);
        mod.onVideoOrBangumi?.(hook);
      } else if (pathname.startsWith('/bangumi/play/')) {
        mod.onBangumi?.(hook);
        mod.onVideo?.(hook);
        mod.onVideoOrBangumi?.(hook);
      }
    } else if (hostname === 'live.bilibili.com') {
      mod.onLive?.(hook);
    } else if (hostname === 't.bilibili.com') {
      mod.onStory?.(hook);
    }
  }
}

function injectStyles(unsafeWindow: Window & typeof globalThis, styles: string[], logger: Logger): void {
  if (styles.length === 0) return;
  const css = styles.join('\n');
  const doc = unsafeWindow.document;
  const CSSOM: (typeof CSSStyleSheet) | undefined = (unsafeWindow as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  // 一律走 unsafeWindow 上的构造器，避免依赖打包环境全局（也便于测试注入假实现）
  if (CSSOM && typeof CSSOM.prototype.replaceSync === 'function' && Array.isArray(doc.adoptedStyleSheets)) {
    const sheet = new CSSOM();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets.push(sheet);
  } else {
    const el = doc.createElement('style');
    el.textContent = css;
    doc.head?.appendChild(el);
    logger.debug('style tag fallback used');
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

  dispatchModules(modules, hook, unsafeWindow);
  overrideFetch(unsafeWindow, sets, logger, errorCounter);
  overrideXHR(unsafeWindow, sets, logger, errorCounter);
  injectStyles(unsafeWindow, styles, logger);

  return {
    getStyles: () => styles,
    onUnload: () => { /* 预留给 Plan 2/3：菜单卸载、探测断开 */ }
  };
}
