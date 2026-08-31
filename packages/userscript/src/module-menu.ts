// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '@mbgt/core';

const ENABLED_PREFIX = 'mbgt:enabled:';

// document-start 阶段必须同步判定模块开关（entry 装配在 createCore 之前完成过滤），
// 故走同步 GM_getValue：Tampermonkey/ScriptCat/Violentmonkey 均提供。
export function getModuleEnabledSync(mod: ModuleMeta): boolean {
  const stored = GM_getValue(`${ENABLED_PREFIX}${mod.name}`);
  return stored === undefined ? true : Boolean(stored); // 默认全部启用
}

// Plan 2 备用：异步版开关读取（共存探测落地后可能改用批量读取）
export async function isModuleEnabled(mod: ModuleMeta): Promise<boolean> {
  const stored = await GM.getValue<boolean>(`${ENABLED_PREFIX}${mod.name}`);
  return stored ?? true;
}

export function initModuleMenu(mod: ModuleMeta): void {
  GM.registerMenuCommand(
    `${getModuleEnabledSync(mod) ? '☑' : '☐'} ${mod.name} — ${mod.description}`,
    () => {
      GM_setValue(`${ENABLED_PREFIX}${mod.name}`, !getModuleEnabledSync(mod));
      // 与上游语义一致：开关在下次加载生效
      unsafeWindow.location.reload();
    }
  );
}
