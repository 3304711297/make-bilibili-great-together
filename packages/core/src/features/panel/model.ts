// 面板状态模型（纯函数，组件层零逻辑）：模块行视图、统计视图、导入导出白名单。
import type { CompatStatus, ModuleOverride } from '../../platform/storage';
import type { StatsPayload } from '../stats/registry';
import type { DnrStatsPayload } from '../stats/dnr';

export interface ModuleRow {
  name: string;
  description: string;
  override: ModuleOverride;
  enabled: boolean;
  forced: boolean;
  autoDisabledReason?: { extension: string; feature: string };
}

export function buildModuleRows(
  modules: { name: string; description: string }[],
  overrideMap: Map<string, ModuleOverride>,
  compat?: CompatStatus
): ModuleRow[] {
  const autoMap = new Map((compat?.autoDisabled ?? []).map(d => [d.module, d]));
  return modules.map(m => {
    const override = overrideMap.get(m.name) ?? 'on';
    const auto = autoMap.get(m.name);
    const forced = override === 'force-on';
    // enabled 与引擎实际生效一致（resolveConflicts）：auto 停用且非 forced → 未启用
    const enabled = forced ? true : (override !== 'off' && !auto);
    return {
      name: m.name,
      description: m.description,
      override,
      enabled,
      forced,
      autoDisabledReason: (auto && !forced) ? { extension: auto.extension, feature: auto.feature } : undefined
    };
  });
}

export const STATS_LABELS: Record<string, string> = {
  'beacon': 'sendBeacon 跟踪上报',
  'spyware-fetch': '上报 fetch 拦截',
  'spyware-xhr': '上报 XHR 拦截',
  'storage-defused': 'localStorage 挡写',
  'p2p-replaced': 'P2P/PCDN 替换',
  'rtc-mocked': 'WebRTC mock',
  'av1-blocked': 'AV1 拦截',
  'dnr': 'DNR 网络层拦截'
};

export function buildStatsView(
  stats?: StatsPayload,
  dnr?: DnrStatsPayload
): { rows: { label: string; count: number }[]; total: number } {
  const merged: Record<string, number> = { ...(stats?.counts ?? {}) };
  // DNR counts 键为规则 ID（background-entry 以 ruleIds[0] 计数）→ 归并为单一 'dnr' kind
  for (const v of Object.values(dnr?.counts ?? {})) merged['dnr'] = (merged['dnr'] ?? 0) + v;
  const rows = Object.entries(merged)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: STATS_LABELS[k] ?? k, count: v }))
    .sort((a, b) => b.count - a.count);
  return { rows, total: rows.reduce((s, r) => s + r.count, 0) };
}

/** 导入/导出只覆盖配置类键；compat 状态、统计、探测状态等运行数据不进导出文件 */
export function filterExportableKeys(all: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(all).filter(([k]) =>
    k.startsWith('mbgt:override:') || k.startsWith('mbgt:ui:') || k === 'mbgt:cdn:probe'));
}

export function validateImportPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const ok: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('mbgt:override:') && (v === 'on' || v === 'off' || v === 'force-on')) ok[k] = v;
    else if (k === 'mbgt:cdn:probe' && typeof v === 'boolean') ok[k] = v;
    else if (k.startsWith('mbgt:ui:') && typeof v === 'boolean') ok[k] = v;
  }
  return Object.keys(ok).length > 0 ? ok : null;
}
