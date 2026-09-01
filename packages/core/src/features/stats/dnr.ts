// 扩展 DNR 命中统计（spec §4.2：background 汇总后由 content 侧读取）。
// onRuleMatchedDebug 仅解压加载（unpacked）可用且需 declarativeNetRequestFeedback——
// 本项目分发模型（Releases zip → 用户加载解压缩的扩展）满足；API 缺失时 background 静默跳过。
export const DNR_STATS_KEY = 'mbgt:stats:dnr';

export interface DnrStatsPayload {
  counts: Record<string, number>;
  updatedAt: number;
}

export function mergeDnrCounts(
  storedCounts: Record<string, number>,
  baseline: Record<string, number>,
  sessionCounts: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...storedCounts };
  for (const [key, n] of Object.entries(sessionCounts)) {
    const delta = Math.max(0, n - (baseline[key] ?? 0));
    merged[key] = (merged[key] ?? 0) + delta;
  }
  return merged;
}

/** DNR 规则键（ruleId 数字串）归并为单一 'dnr' kind——与面板 buildStatsView 口径一致 */
export function foldDnrCounts(dnrCounts: Record<string, number>): Record<string, number> {
  const total = Object.values(dnrCounts).reduce((s, v) => s + v, 0);
  return total > 0 ? { dnr: total } : {};
}
