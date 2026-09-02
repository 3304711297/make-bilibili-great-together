import { render } from 'preact';
import { h } from 'preact';
import {
  createLogger, getDefaultModules, PanelApp, PANEL_STYLE, type KVStore, type ModuleInfo
} from '@mbgt/core';

// 命名空间双解析 browser ?? chrome：Edge（Chromium 系）不提供 browser.*，仅 chrome.*
interface MbgtStorageLocal {
  get(key: string | string[] | null): Promise<{ [key: string]: any }>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
interface MbgtExtensionApi {
  storage: { local: MbgtStorageLocal };
}
const api = (globalThis as unknown as { browser?: MbgtExtensionApi; chrome?: MbgtExtensionApi }).browser
  ?? (globalThis as unknown as { chrome?: MbgtExtensionApi }).chrome;
if (!api) {
  document.getElementById('app')!.textContent = '扩展存储 API 不可用';
  throw new Error('extension storage API unavailable (browser/chrome)');
}

// 注入面板样式
if (!document.getElementById('mbgt-panel-style')) {
  const style = document.createElement('style');
  style.id = 'mbgt-panel-style';
  style.textContent = PANEL_STYLE;
  document.head?.appendChild(style);
}

// options 页运行在扩展上下文：直连 chrome.storage.local（含 getAll，无需桥接）
const store: KVStore = {
  async get(key) { return (await api.storage.local.get(key))[key]; },
  async set(key, value) { await api.storage.local.set({ [key]: value }); },
  async delete(key) { await api.storage.local.remove(key); },
  async getAll() { return await api.storage.local.get(null); }
};

const logger = createLogger(console);
// 扩展形态：即时模块（无 conflicts）锁定不可关（document-start 裁定）；deferred 模块可三态切换
const mods = getDefaultModules(logger);
const panelModules: ModuleInfo[] = mods.map(m => ({ name: m.name, description: m.description, locked: !m.conflicts?.length }));

const root = document.getElementById('app')!;
root.textContent = '';
try {
  render(h(PanelApp, { store, modules: panelModules }) as any, root);
} catch (e) {
  root.textContent = '面板渲染失败（不影响核心拦截）';
  console.warn('[mbgt] options panel render failed', e);
}
