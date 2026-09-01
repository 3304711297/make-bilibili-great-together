import { describe, it, expect } from 'vitest';
import {
  buildModuleRows, buildStatsView, filterExportableKeys, validateImportPayload
} from '../src/features/panel/model';
import type { ModuleOverride } from '../src/platform/storage';

const mods = [
  { name: 'no-ad', description: '去广告' },
  { name: 'defuse-spyware', description: '反跟踪' }
];

describe('buildModuleRows', () => {
  it('override 三值 → enabled/forced；compat 命中且非 forced 时带原因', () => {
    const map = new Map<string, ModuleOverride>([['no-ad', 'force-on']]);
    const compat = {
      family: 'bewly' as const, extensions: ['bewlycat'], generic: false, settledAt: 1,
      autoDisabled: [{ module: 'no-ad', extension: 'bewlycat', feature: 'blockAds / 首页重构' }]
    };
    const rows = buildModuleRows(mods, map, compat);
    const noAd = rows.find(r => r.name === 'no-ad')!;
    expect(noAd.enabled).toBe(true);
    expect(noAd.forced).toBe(true);
    expect(noAd.autoDisabledReason).toBe(undefined); // force-on 压过自动停用
    const spy = rows.find(r => r.name === 'defuse-spyware')!;
    expect(spy.enabled).toBe(true);
    expect(spy.forced).toBe(false);
    expect(spy.autoDisabledReason).toBe(undefined);
  });

  it('off → enabled=false；自动停用且未覆盖 → 带原因', () => {
    const map = new Map<string, ModuleOverride>([['defuse-spyware', 'off']]);
    const compat = {
      family: 'bewly' as const, extensions: [], generic: true, settledAt: 1,
      autoDisabled: [{ module: 'no-ad', extension: 'generic', feature: '首页重构' }]
    };
    const rows = buildModuleRows(mods, map, compat);
    expect(rows.find(r => r.name === 'defuse-spyware')!.enabled).toBe(false);
    const noAd = rows.find(r => r.name === 'no-ad')!;
    expect(noAd.enabled).toBe(false);
    expect(noAd.autoDisabledReason).toEqual({ extension: 'generic', feature: '首页重构' });
  });
});

describe('buildStatsView', () => {
  it('合并 content 统计与 DNR 统计并按量排序', () => {
    const view = buildStatsView(
      { counts: { beacon: 5, 'p2p-replaced': 2 }, flushedAt: 1 },
      { counts: { defuse_report: 9 }, updatedAt: 1 }
    );
    expect(view.rows[0]).toEqual({ label: 'DNR 网络层拦截', count: 9 });
    expect(view.rows.find(r => r.label === 'sendBeacon 跟踪上报')!.count).toBe(5);
    expect(view.total).toBe(16);
  });
});

describe('导入/导出', () => {
  it('导出仅保留配置键白名单', () => {
    const all = {
      'mbgt:override:no-ad': 'off',
      'mbgt:ui:stats-badge': true,
      'mbgt:cdn:probe': false,
      'mbgt:compat:status': { x: 1 },
      'mbgt:stats:counters': { counts: {} },
      'other': 1
    };
    expect(filterExportableKeys(all)).toEqual({
      'mbgt:override:no-ad': 'off',
      'mbgt:ui:stats-badge': true,
      'mbgt:cdn:probe': false
    });
  });
  it('导入校验：合法配置键保留、非法键/非法值丢弃、全空返回 null', () => {
    expect(validateImportPayload({ 'mbgt:override:x': 'force-on', 'mbgt:override:y': 'hacked', garbage: 1 }))
      .toEqual({ 'mbgt:override:x': 'force-on' });
    expect(validateImportPayload({ 'mbgt:cdn:probe': true })).toEqual({ 'mbgt:cdn:probe': true });
    expect(validateImportPayload({ garbage: 1 })).toBe(null);
    expect(validateImportPayload(null)).toBe(null);
  });
});
