export { createCore, type CoreOptions, type CoreInstance } from './engine/scheduler';
export type { ModuleMeta, MakeBilibiliGreatTogetherHook, CompatConflict } from './types';
export { createLogger, type Logger, type MinimalConsole } from './logger';
export { getDefaultModules } from './modules';
export { ErrorCounter } from './utils/error-counter';
export { createMemoryKVStore, readModuleOverrides, migrateLegacyEnabledKeys, OVERRIDE_PREFIX, COMPAT_STATUS_KEY, STORAGE_VERSION_KEY, STORAGE_VERSION, SETTING_CDN_PROBE, SETTING_STATS_BADGE, readSettingsWithBudget, type KVStore, type CompatStatus, type ModuleOverride, type WiringSettings } from './platform/storage';
export { BRIDGE_REQUEST_EVENT, BRIDGE_RESPONSE_EVENT, createBridgeHost, createBridgedKVStore, createBridgedProbeFetch } from './platform/bridge';
export { startCompatProbe, type ExtensionId, type DetectedExtension, type ProbeResult, type SnapshotResult, type CompatProbeOptions } from './platform/compat-types';
export { CONFLICT_TABLE, resolveConflicts } from './features/compat/resolve';
export { createBewlyFamilySnapshot, type BewlySnapshotOptions } from './features/compat/snapshot';
export {
  STATS_KEY, recordInterception, onInterception, sessionCounts,
  flushStats, startStatsFlush, readStats, type StatsPayload
} from './features/stats/registry';
export { DNR_STATS_KEY, mergeDnrCounts, type DnrStatsPayload } from './features/stats/dnr';
export { mountStatsBadge } from './features/stats/badge';
export {
  PROBE_TIMEOUT_MS, PROBE_CACHE_TTL_MS, CDN_PROBE_STATUS_KEY,
  type ProbeFetch, type CdnProbeResult, type CdnProbeStatus, type CdnProbe, createCdnProbe
} from './features/cdn-probe/probe';
export type { CdnUtilHooks } from './utils/get-cdn-url';
export {
  buildModuleRows, STATS_LABELS, buildStatsView, filterExportableKeys, validateImportPayload,
  type ModuleRow
} from './features/panel/model';
export { PanelApp, mountFloatingPanel, loadPanelData, type ModuleInfo, type PanelData } from './features/panel/panel';
export { MBGT_VERSION } from './version';
