import type { ExtensionId, ProbeResult } from '../../platform/compat-types';
import type { ModuleMeta } from '../../types';

/** module 名 → 对方功能标识（spec §3.3；optimize-story 两项经真机实测确认为真实冲突，追踪 Issue #1） */
export const CONFLICT_TABLE: Record<ExtensionId, Record<string, string>> = {
  bewlycat: {
    'no-ad': 'blockAds / 首页重构',
    'optimize-homepage': '首页重构',
    'remove-useless-url-params': 'cleanUrlArgument',
    'optimize-story': '动态页改造（真机已确认，Issue #1）',
    'player-video-fit': 'bewlyWidescreen / 播放器样式'
  },
  avemujica: {
    'no-ad': 'blockAds / 首页重构',
    'optimize-homepage': '首页重构',
    'remove-useless-url-params': 'cleanUrlArgument',
    'optimize-story': '动态页改造（真机已确认，Issue #1）',
    'use-system-fonts': 'customizeFont（默认启用自家推荐字体）'
  }
};

// 导出前冻结：防止运行时误改冲突表（表内容视为静态契约）
for (const row of Object.values(CONFLICT_TABLE)) Object.freeze(row);
Object.freeze(CONFLICT_TABLE);

export function resolveConflicts(
  modules: ModuleMeta[],
  probe: ProbeResult,
  menuDisabledNames: ReadonlySet<string>,
  forceOnOverrides: ReadonlySet<string>
): { enabled: ModuleMeta[]; autoDisabled: { module: string; extension: string; feature: string }[] } {
  const enabled: ModuleMeta[] = [];
  const autoDisabled: { module: string; extension: string; feature: string }[] = [];

  // 生效的冲突行：specific 扩展各自一行；generic 取两行并集（同模块 bewlycat 行优先）
  const activeRows: Record<string, { extension: string; feature: string }>[] = [];
  const specific = probe.extensions.map(e => e.id);
  if (probe.generic) {
    // generic：保守并集（specific 为空且非 generic 时不启用任何冲突行，全部照常启用）
    activeRows.push(mergedRow());
  }
  // specific 行序固定：并集归因不再依赖 probe.extensions 的检测顺序（bewlycat 行优先）
  const ORDER: ExtensionId[] = ['bewlycat', 'avemujica'];
  for (const id of ORDER.filter(o => specific.includes(o))) {
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

// generic（家族在场但无法区分具体扩展）路径的归因统一标 'generic'：
function mergedRow(): Record<string, { extension: string; feature: string }> {
  const out: Record<string, { extension: string; feature: string }> = {};
  for (const [modName, feature] of Object.entries(CONFLICT_TABLE.bewlycat)) {
    out[modName] = { extension: 'generic', feature };
  }
  for (const [modName, feature] of Object.entries(CONFLICT_TABLE.avemujica)) {
    if (out[modName] === undefined) out[modName] = { extension: 'generic', feature };
  }
  return out;
}
