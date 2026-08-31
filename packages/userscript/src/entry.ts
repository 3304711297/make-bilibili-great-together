import { createCore, createLogger, getDefaultModules } from '@mbgt/core';
import type { ModuleMeta } from '@mbgt/core';
import { unsafeConsole, unsafeWindowRef } from './gm-adapter';
import { initModuleMenu, getModuleEnabledSync } from './module-menu';

const logger = createLogger(unsafeConsole());

// 先注册菜单（含当前处于禁用态的模块，允许再次开启）
const allModules = getDefaultModules(logger);
for (const mod of allModules) {
  initModuleMenu(mod);
}

// document-start 同步过滤：开关持久化于菜单点击时（GM_setValue），刷新后此处生效
const modules: ModuleMeta[] = allModules.filter(m => getModuleEnabledSync(m));
for (const mod of allModules) {
  if (!modules.includes(mod)) {
    logger.log(`[${mod.name}] disabled via menu -- skipping`);
  }
}

createCore({
  modules,
  console: unsafeConsole(),
  unsafeWindow: unsafeWindowRef
});
