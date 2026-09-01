import {
  createCore,
  createBewlyFamilySnapshot,
  createLogger,
  getDefaultModules,
  startCompatProbe,
  resolveConflicts,
  readModuleOverrides,
  migrateLegacyEnabledKeys,
  COMPAT_STATUS_KEY,
  createCdnProbe,
  SETTING_CDN_PROBE,
  SETTING_STATS_BADGE,
  startStatsFlush,
  mountStatsBadge,
  mountFloatingPanel,
  type ModuleInfo,
  type CdnUtilHooks
} from '@mbgt/core';
import { unsafeConsole, unsafeWindowRef } from './gm-adapter';
import { initModuleMenu, getModuleEnabledSync } from './module-menu';
import { createGMKVStore } from './gm-storage';
import { createGMProbeFetch } from './gm-probe-fetch';
import { isTopFrame } from './top-frame';

// 顶层包成 async IIFE：旧 mbgt:enabled:* 键的迁移走异步 GM storage，须先于菜单注册完成
void (async () => {
  const logger = createLogger(unsafeConsole());
  const store = createGMKVStore();

  // ── 顶层框架守卫（仅核心同步派发路径，early-return 放最前）──
  // B 站同源隐藏 iframe（correspond）也命中 @match：非顶层框架只跑核心派发，
  // 跳过一切共享存储/菜单/UI/探测（iframe 结算会覆盖主页面 compat 状态，真机冒烟实证）
  if (!isTopFrame(unsafeWindowRef)) {
    const iframeModules = getDefaultModules(logger, {});
    const enabledImmediate = iframeModules.filter(m => !m.conflicts?.length).filter(m => getModuleEnabledSync(m.name));
    createCore({
      modules: enabledImmediate,
      console: unsafeConsole(),
      unsafeWindow: unsafeWindowRef
    });
    return;
  }

  // ── 主路径（顶层框架）：迁移 + 同步设置读取 + 菜单 + deferred 探测 + 统计 + 面板 ──
  await migrateLegacyEnabledKeys(store);

  // userscript 形态 document-start 可同步读设置（GM_getValue），开关当页生效
  const cdnProbeEnabled = GM_getValue(SETTING_CDN_PROBE) !== false;
  const statsBadgeEnabled = GM_getValue(SETTING_STATS_BADGE) === true;
  const cdnHooksRef: { current?: CdnUtilHooks } = {};
  if (cdnProbeEnabled) {
    cdnHooksRef.current = {
      probe: createCdnProbe({ fetchLike: createGMProbeFetch(), logger, store })
    };
  }
  const allModules = getDefaultModules(logger, { cdnHooksRef });

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
        const overrides = await readModuleOverrides(store, deferred.map(m => m.name));
        const forceOn = new Set([...overrides.entries()].filter(([, v]) => v === 'force-on').map(([n]) => n));
        const menuDisabledNames = new Set([...overrides.entries()].filter(([, v]) => v === 'off').map(([n]) => n));
        const { enabled, autoDisabled } = resolveConflicts(deferred, probe, menuDisabledNames, forceOn);
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

  // ── Task 9 接线收口：统计 flush + 角标 + 浮层面板 ──
  try { startStatsFlush(store); } catch (e) { logger.warn('stats flush start failed', e); }
  if (statsBadgeEnabled) {
    // 角标需 DOM 就绪；document_start 时 body 尚无——挂到 DOMContentLoaded 后
    const mountBadge = () => { try { mountStatsBadge({ store }); } catch { /* 降级 */ } };
    if (document.body) mountBadge();
    else document.addEventListener('DOMContentLoaded', mountBadge, { once: true });
  }
  const panelModules: ModuleInfo[] = allModules.map(m => ({ name: m.name, description: m.description }));
  // 面板入口同样等 DOM 就绪
  const mountPanel = () => { try { mountFloatingPanel({ store, modules: panelModules }); } catch { /* 降级 */ } };
  if (document.body) mountPanel();
  else document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
})();
