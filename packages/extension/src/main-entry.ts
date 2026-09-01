import './unsafe-shim';
import {
  createCore, createLogger, getDefaultModules, startCompatProbe, resolveConflicts,
  COMPAT_STATUS_KEY, createBewlyFamilySnapshot, createBridgedKVStore, createBridgedProbeFetch,
  createCdnProbe, readSettingsWithBudget, type CdnUtilHooks
} from '@mbgt/core';

const logger = createLogger(console);
const eventTarget = globalThis as unknown as EventTarget;
const store = createBridgedKVStore(eventTarget);

// 即时模块同步派发（document-start 语义优先，扩展形态即时模块无关闭开关——裁定见 Plan 4 Task 6）
const cdnHooksRef: { current?: CdnUtilHooks } = {};
const allModules = getDefaultModules(logger, { cdnHooksRef });
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
      const settings = await readSettingsWithBudget(store, deferred.map(m => m.name));
      const forceOn = new Set([...settings.overrides.entries()].filter(([, v]) => v === 'force-on').map(([n]) => n));
      const menuDisabled = new Set([...settings.overrides.entries()].filter(([, v]) => v === 'off').map(([n]) => n));
      const { enabled, autoDisabled } = resolveConflicts(deferred, probe, menuDisabled, forceOn);
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

// 设置回填：probe 挂载 + 统计角标（Task 7 mountStatsBadge 在 Task 9 接入；此处先落 cdnHooksRef）
void (async () => {
  const settings = await readSettingsWithBudget(store, allModules.map(m => m.name));
  if (settings.cdnProbe) {
    cdnHooksRef.current = { probe: createCdnProbe({ fetchLike: createBridgedProbeFetch(eventTarget), logger, store }) };
  }
})().catch((e) => logger.warn('mbgt settings backfill failed', e));
