import { DNR_STATS_KEY, mergeDnrCounts, type DnrStatsPayload } from '@mbgt/core';

// browser ?? chrome 双解析：Edge（Chromium 系）仅 chrome.*（与 isolated-entry 同策略）
type MbgtApi = {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  declarativeNetRequest?: { onRuleMatchedDebug?: { addListener(cb: (info: unknown) => void): void } };
};
const api = (globalThis as unknown as { browser?: MbgtApi; chrome?: MbgtApi }).browser
  ?? (globalThis as unknown as { chrome?: MbgtApi }).chrome;

try {
  const dnr = api?.declarativeNetRequest;
  if (!api || !dnr?.onRuleMatchedDebug) throw new Error('declarativeNetRequest.onRuleMatchedDebug unavailable');
  // info 形态：{ request: { url }, rule: { ruleIds: number[] } }
  type MatchedInfo = { rule?: { ruleIds?: number[] } };
  const session: Record<string, number> = {};
  let baseline: Record<string, number> = {};
  let lastWrite = 0;

  dnr.onRuleMatchedDebug.addListener((raw) => {
    try {
      const info = raw as MatchedInfo;
      const id = String(info.rule?.ruleIds?.[0] ?? (info.rule as { id?: number })?.id ?? 'unknown');
      session[id] = (session[id] ?? 0) + 1;
      const now = Date.now();
      if (now - lastWrite < 30_000) return; // 30s 节流写盘
      lastWrite = now;
      void (async () => {
        const stored = await api.storage.local.get(DNR_STATS_KEY);
        const storedCounts = (stored[DNR_STATS_KEY] as DnrStatsPayload | undefined)?.counts ?? {};
        const counts = mergeDnrCounts(storedCounts, baseline, session);
        baseline = { ...session };
        await api.storage.local.set({ [DNR_STATS_KEY]: { counts, updatedAt: now } });
      })().catch(() => { /* 落盘失败不影响后续计数 */ });
    } catch { /* 事件解析异常忽略 */ }
  });
} catch (e) {
  console.warn('[mbgt] dnr stats unavailable:', e);
}
