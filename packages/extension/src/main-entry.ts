import './unsafe-shim';
import {
  createCore, createLogger, getDefaultModules,
  startCompatProbe, resolveConflicts, readModuleOverrides,
  COMPAT_STATUS_KEY, createBewlyFamilySnapshot, createBridgedKVStore
} from '@mbgt/core';

const logger = createLogger(console);
const store = createBridgedKVStore(globalThis as unknown as EventTarget);
const allModules = getDefaultModules(logger);

// 扩展形态无油猴菜单：模块默认全启用，override 键（mbgt:override:*）由 options 页写入（Plan 4 完整面板）
// 与 userscript entry 语义对齐：immediate（无 conflicts）进初始 createCore（document-start 语义）；
// deferred（带 conflicts）不进初始 createCore，探测结算的 registerModules 是其唯一注册点——
// 否则 compat 停用被架空（带冲突模块已在页面上生效，结算时才被"停用"）
const immediate = allModules.filter(m => !m.conflicts?.length);
const core = createCore({ modules: immediate, console, unsafeWindow: unsafeWindow });

const deferred = allModules.filter(m => m.conflicts?.length);

startCompatProbe({
  snapshot: createBewlyFamilySnapshot(document),
  scheduler: (cb, ms) => { const t = setTimeout(cb, ms); return () => clearTimeout(t); },
  timeoutMs: 10_000,
  intervalMs: 200,
  notInstalledCheck: () => document.readyState === 'complete',
  notInstalledGraceMs: 2_000,
  onSettle: (probe) => {
    void (async () => {
      const overrides = await readModuleOverrides(store, deferred.map(m => m.name));
      // 扩展形态无油猴菜单：'off' 不可能由菜单写入，menuDisabledNames 恒为空集
      const forceOn = new Set([...overrides.entries()].filter(([, v]) => v === 'force-on').map(([n]) => n));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, new Set(), forceOn);
      for (const d of autoDisabled) logger.log(`[${d.module}] auto-disabled: ${d.extension} (${d.feature}) detected`);
      core.registerModules(enabled);
      await store.set(COMPAT_STATUS_KEY, {
        family: probe.family,
        extensions: probe.extensions.map(e => e.id),
        generic: probe.generic,
        autoDisabled,
        settledAt: Date.now()
      });
    })().catch((e) => logger.error('compat settle chain failed -- deferred modules skipped', e));
  }
});
