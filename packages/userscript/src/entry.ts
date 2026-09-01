import {
  createCore,
  createBewlyFamilySnapshot,
  createLogger,
  getDefaultModules,
  startCompatProbe,
  resolveConflicts,
  readForceOnOverrides,
  COMPAT_STATUS_KEY
} from '@mbgt/core';
import { unsafeConsole, unsafeWindowRef } from './gm-adapter';
import { initModuleMenu, getModuleEnabledSync } from './module-menu';
import { createGMKVStore } from './gm-storage';

const logger = createLogger(unsafeConsole());
const store = createGMKVStore();
const allModules = getDefaultModules(logger);

// 全部 15 个模块的菜单都要注册且只注册一次（禁用态也能在菜单里切回来）
for (const mod of allModules) {
  initModuleMenu(mod);
}

// 立即注册：无冲突声明且菜单启用的模块（document-start 语义）
const immediate = allModules.filter(m => !m.conflicts?.length);
const enabledImmediate = immediate.filter(m => getModuleEnabledSync(m.name));
for (const mod of immediate) {
  if (!getModuleEnabledSync(mod.name)) {
    logger.log(`[${mod.name}] disabled via menu -- skipping`);
  }
}

const core = createCore({
  modules: enabledImmediate,
  console: unsafeConsole(),
  unsafeWindow: unsafeWindowRef
});

// 延迟注册：带 conflicts 的模块，等共存探测结算
const deferred = allModules.filter(m => m.conflicts?.length);
const menuDisabledNames = new Set(
  deferred.filter(m => !getModuleEnabledSync(m.name)).map(m => m.name)
);

startCompatProbe({
  // 共享快照工厂（core）：三态判定与 avemujica 注释样式标记默认停用均由 core 实现
  snapshot: createBewlyFamilySnapshot(unsafeWindowRef.document),
  scheduler: (cb, ms) => {
    const t = unsafeWindowRef.setTimeout(cb, ms);
    return () => unsafeWindowRef.clearTimeout(t);
  },
  timeoutMs: 10_000,
  intervalMs: 200,
  onSettle: (probe) => {
    // 结算单次性由 startCompatProbe 保证：此处只触发一次 registerModules，不重复注册
    void (async () => {
      const overrides = await readForceOnOverrides(store, deferred.map(m => m.name));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, menuDisabledNames, overrides);
      for (const d of autoDisabled) {
        logger.log(`[${d.module}] auto-disabled: ${d.extension} (${d.feature}) detected`);
      }
      core.registerModules(enabled);
      await store.set(COMPAT_STATUS_KEY, {
        family: probe.family,
        extensions: probe.extensions.map(e => e.id),
        generic: probe.generic,
        autoDisabled,
        settledAt: Date.now()
      });
    })().catch((e) => logger.error('compat settle chain failed -- deferred modules skipped', e));
    // fail-closed：结算链失败时 deferred 模块保持不注册（均为非关键 UI 模块，与共存保守方向一致），可见性靠日志补足
  }
});
