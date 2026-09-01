import type { ExtensionId, ProbeResult } from '../../platform/compat-types';
import type { ModuleMeta } from '../../types';

/** module 名 → 对方功能标识（spec §3.3；optimize-story 两项 provisional，待真机实测后修订） */
export const CONFLICT_TABLE: Record<ExtensionId, Record<string, string>> = {
  bewlycat: {
    'no-ad': 'blockAds / 首页重构',
    'optimize-homepage': '首页重构',
    'remove-useless-url-params': 'cleanUrlArgument',
    'optimize-story': '动态页改造（provisional）',
    'player-video-fit': 'bewlyWidescreen / 播放器样式'
  },
  avemujica: {
    'no-ad': 'blockAds / 首页重构',
    'optimize-homepage': '首页重构',
    'remove-useless-url-params': 'cleanUrlArgument',
    'optimize-story': '动态页改造（provisional）',
    'use-system-fonts': 'customizeFont（默认启用自家推荐字体）'
  }
};

export function resolveConflicts(
  modules: ModuleMeta[],
  probe: ProbeResult,
  menuDisabledNames: ReadonlySet<string>,
  forceOnOverrides: ReadonlySet<string>
): { enabled: ModuleMeta[]; autoDisabled: { module: string; extension: string; feature: string }[] } {
  const enabled: ModuleMeta[] = [];
  const autoDisabled: { module: string; extension: string; feature: string }[] = [];

  // 生效的冲突行：specific 扩展各自一行；generic 取两行并集（同模块 bewlycat 行优先）
  const activeRows: Record<string, { extension: ExtensionId; feature: string }>[] = [];
  const specific = probe.extensions.map(e => e.id);
  if (probe.generic) {
    // generic：保守并集（specific 为空且非 generic 时不启用任何冲突行，全部照常启用）
    activeRows.push(mergedRow());
  }
  for (const id of specific) {
    activeRows.push(rowOf(id));
  }

  for (const mod of modules) {
    if (menuDisabledNames.has(mod.name)) continue;
    if (forceOnOverrides.has(mod.name)) { enabled.push(mod); continue; }
    const hit = activeRows.find(row => row[mod.name] !== undefined);
    if (hit) {
      const { extension, feature } = hit[mod.name];
      autoDisabled.push({ module: mod.name, extension, feature });
    } else {
      enabled.push(mod);
    }
  }
  return { enabled, autoDisabled };
}

function rowOf(id: ExtensionId): Record<string, { extension: ExtensionId; feature: string }> {
  const out: Record<string, { extension: ExtensionId; feature: string }> = {};
  for (const [modName, feature] of Object.entries(CONFLICT_TABLE[id])) {
    out[modName] = { extension: id, feature };
  }
  return out;
}

function mergedRow(): Record<string, { extension: ExtensionId; feature: string }> {
  const out = rowOf('avemujica');
  for (const [modName, feature] of Object.entries(CONFLICT_TABLE.bewlycat)) {
    out[modName] = { extension: 'bewlycat', feature };
  }
  return out;
}
