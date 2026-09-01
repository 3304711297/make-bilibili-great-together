// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '@mbgt/core';
import { OVERRIDE_PREFIX } from '@mbgt/core';

// document-start 同步判定：缺省 / 'on' / 'force-on' 均启用；'off' 关闭
export function getModuleEnabledSync(name: string): boolean {
  return GM_getValue(`${OVERRIDE_PREFIX}${name}`) !== 'off';
}

export function initModuleMenu(mod: ModuleMeta): void {
  GM.registerMenuCommand(
    `${getModuleEnabledSync(mod.name) ? '☑' : '☐'} ${mod.name} — ${mod.description}`,
    () => {
      GM_setValue(`${OVERRIDE_PREFIX}${mod.name}`, getModuleEnabledSync(mod.name) ? 'off' : 'on');
      // 与上游语义一致：开关在下次加载生效
      unsafeWindow.location.reload();
    }
  );
}
