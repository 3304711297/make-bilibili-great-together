import { createCore, createLogger, getDefaultModules } from '@mbgt/core';
import { unsafeConsole, unsafeWindowRef } from './gm-adapter';
import { initModuleMenu } from './module-menu';

const logger = createLogger(unsafeConsole());

const modules = getDefaultModules(logger);
for (const mod of modules) {
  // Plan 2 起此处接入共存探测结果；当前仅注册菜单，默认全启用
  initModuleMenu(mod, () => { /* 开关生效于下次加载（与上游语义一致） */ });
}

createCore({
  modules,
  console: unsafeConsole(),
  unsafeWindow: unsafeWindowRef
});
