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
import { initModuleMenu, getModuleEnabledSync, updateModuleMenuStates } from './module-menu';
import { createGMKVStore } from './gm-storage';
import { createGMProbeFetch } from './gm-probe-fetch';
import { isTopFrame, hasExtensionMarker } from './top-frame';

// 顶层包成 async IIFE：同步先行段（无 await，document-start 硬保证——抢在 B 站脚本之前，spec §2），
// 旧 mbgt:enabled:* 键迁移与 deferred 探测/统计/UI 一律挪到其后的非阻塞异步段
void (async () => {
  const logger = createLogger(unsafeConsole());
  const store = createGMKVStore();

  // T7 双形态同装提示（backlog #3 落地）：只警告不自动停用（T7 裁定）
  if (hasExtensionMarker(unsafeWindowRef as unknown as Record<string, unknown>)) {
    logger.warn('检测到扩展版同时运行，建议二选一以免重复注入');
  }

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

  // ── 同步先行段（全部无 await）：同步设置读取 + cdnHooksRef 装配 + 菜单注册 + createCore 同步派发 ──
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

  // ── 非阻塞异步段：迁移 + deferred 探测/结算/状态写入 + 统计 + 角标 + 面板 ──
  // 取舍（final review 裁定）：迁移从 createCore 之前移出（原先 await 一个 GM 异步往返会推迟
  // hooks 安装、弱化 document-start）。迁移前派发的极端情形 = 持旧 mbgt:enabled:*:false 的用户
  // 在迁移完成前的首个页面该模块会多跑一次（菜单显示态同帧一过性）；换取 document-start 硬保证。
  // 迁移只在版本键未达标时干活，日常为一次短读。非顶层框架不走本段（守卫已 return，无需迁移）。
  const deferred = allModules.filter(m => m.conflicts?.length);
  void (async () => {
    await migrateLegacyEnabledKeys(store);

    // 延迟注册：带 conflicts 的模块，等共存探测结算
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
          // 菜单/面板口径对齐：按生效状态重注册 deferred 模块菜单（自动停用 ⛔ / 强制开启标注）
          updateModuleMenuStates(deferred, new Set(autoDisabled.map(d => d.module)));
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
  })().catch((e) => logger.warn('mbgt post-sync chain failed', e));
})();
