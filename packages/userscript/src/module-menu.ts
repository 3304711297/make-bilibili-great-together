// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '@mbgt/core';

const ENABLED_PREFIX = 'mbgt:enabled:';

export async function isModuleEnabled(mod: ModuleMeta): Promise<boolean> {
  const stored = await GM.getValue<boolean>(`${ENABLED_PREFIX}${mod.name}`);
  return stored ?? true; // 默认全部启用
}

export function initModuleMenu(mod: ModuleMeta, onToggle: (enabled: boolean) => void): boolean {
  let enabled = true;
  let menuId: string | null = null;

  const register = () => {
    const labelFor = (e: boolean) => `${e ? '☑' : '☐'} ${mod.name} — ${mod.description}`;
    menuId = GM.registerMenuCommand(labelFor(enabled), async () => {
      enabled = !enabled;
      await GM.setValue(`${ENABLED_PREFIX}${mod.name}`, enabled);
      if (menuId !== null) GM.unregisterMenuCommand(menuId);
      register();
      onToggle(enabled);
    });
  };
  register();

  GM.getValue<boolean>(`${ENABLED_PREFIX}${mod.name}`).then(stored => {
    if (stored !== undefined && stored !== enabled) {
      enabled = stored;
      if (menuId !== null) GM.unregisterMenuCommand(menuId);
      register();
      onToggle(enabled);
    }
  });

  return enabled;
}
