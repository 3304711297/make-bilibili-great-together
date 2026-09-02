// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '@mbgt/core';
import { OVERRIDE_PREFIX } from '@mbgt/core';

// document-start 同步判定：缺省 / 'on' / 'force-on' 均启用；'off' 关闭
export function getModuleEnabledSync(name: string): boolean {
  return GM_getValue(`${OVERRIDE_PREFIX}${name}`) !== 'off';
}

/** 三值 override 同步读取：缺省视为 'on'（force-on 压过共存自动停用，语义见 Plan 4） */
export function readModuleOverrideSync(name: string): 'on' | 'off' | 'force-on' {
  return (GM_getValue(`${OVERRIDE_PREFIX}${name}`) as 'on' | 'off' | 'force-on' | undefined) ?? 'on';
}

export interface MenuModuleInfo {
  name: string;
  description: string;
}

/** 生效状态 → 菜单标签（用户反馈「设置不同步」修复）：
 * 菜单此前只显示用户 override（off/非 off），compat 自动停用后与面板口径脱节。
 * 现按生效态标注：⛔=自动停用（点击强制开启）、强制开启显式标注。 */
export function moduleMenuLabel(mod: MenuModuleInfo, state: 'on' | 'off' | 'force-on', autoDisabled: boolean): string {
  const base = `${mod.name} — ${mod.description}`;
  if (state === 'force-on') return `☑ ${base}（强制开启·点击恢复自动）`;
  if (autoDisabled) return `⛔ ${base}（已自动停用·点击强制开启）`;
  return `${state === 'off' ? '☐' : '☑'} ${base}`;
}

/** 点击语义（与面板提示一致）：off→on；自动停用的 on→force-on、force-on→on；未停用的 on→off */
export function nextMenuOverride(state: 'on' | 'off' | 'force-on', autoDisabled: boolean): 'on' | 'off' | 'force-on' {
  if (state === 'off') return 'on';
  if (autoDisabled) return state === 'force-on' ? 'on' : 'force-on';
  return 'off';
}

// 已注册菜单命令 id：compat 结算后按生效状态重注册（unregister + register）以刷新标签
const commandIds = new Map<string, unknown>();

function registerWithState(mod: MenuModuleInfo, autoDisabled: boolean): void {
  const state = readModuleOverrideSync(mod.name);
  const id = GM.registerMenuCommand(moduleMenuLabel(mod, state, autoDisabled), () => {
    GM_setValue(`${OVERRIDE_PREFIX}${mod.name}`, nextMenuOverride(state, autoDisabled));
    // 与上游语义一致：开关在下次加载生效
    unsafeWindow.location.reload();
  });
  commandIds.set(mod.name, id);
}

/** document-start 初次注册（此时共存探测未结算，按用户 override 展示） */
export function initModuleMenu(mod: ModuleMeta): void {
  registerWithState(mod, false);
}

/** compat 结算后按生效状态重注册 deferred 模块，刷新标签与点击语义 */
export function updateModuleMenuStates(mods: MenuModuleInfo[], autoDisabledNames: ReadonlySet<string>): void {
  for (const mod of mods) {
    const prev = commandIds.get(mod.name);
    if (prev !== undefined) {
      try { GM.unregisterMenuCommand(prev as number); } catch { /* 管理器不支持时降级为叠加 */ }
    }
    registerWithState(mod, autoDisabledNames.has(mod.name));
  }
}
