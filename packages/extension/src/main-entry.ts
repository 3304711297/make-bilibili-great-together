import './unsafe-shim';
import {
  createCore, createLogger, getDefaultModules,
  startCompatProbe, resolveConflicts, readForceOnOverrides,
  COMPAT_STATUS_KEY, createBewlyFamilySnapshot, createBridgedKVStore
} from '@mbgt/core';

const logger = createLogger(console);
const store = createBridgedKVStore(globalThis as unknown as EventTarget);
const allModules = getDefaultModules(logger);

// 扩展形态无油猴菜单：模块默认全启用，override 键（mbgt:override:*）由 options 页写入（Plan 4 完整面板）
const core = createCore({ modules: allModules, console, unsafeWindow: unsafeWindow });

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
      const overrides = await readForceOnOverrides(store, deferred.map(m => m.name));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, new Set(), overrides);
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
