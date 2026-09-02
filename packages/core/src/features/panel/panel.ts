// 设置+共存面板（spec §4.3）：Preact 组件，双形态共用——userscript 页内浮层、扩展 options 页。
// 用 h() 调用树（core 无 JSX 转换配置）。面板任何异常只 console.warn（降级原则）。
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { KVStore } from '../../platform/storage';
import {
  OVERRIDE_PREFIX, COMPAT_STATUS_KEY, SETTING_CDN_PROBE, SETTING_STATS_BADGE,
  readModuleOverrides, type CompatStatus
} from '../../platform/storage';
import { CDN_PROBE_STATUS_KEY, type CdnProbeStatus } from '../cdn-probe/probe';
import { STATS_KEY, type StatsPayload } from '../stats/registry';
import { DNR_STATS_KEY, type DnrStatsPayload } from '../stats/dnr';
import {
  buildModuleRows, buildStatsView, filterExportableKeys, validateImportPayload, describeAutoDisable, type ModuleRow
} from './model';
import { MBGT_VERSION } from '../../version';

export interface ModuleInfo {
  name: string;
  description: string;
  /** 扩展形态即时模块锁定（document-start 语义裁定） */
  locked?: boolean;
}

export interface PanelData {
  rows: ModuleRow[];
  compat?: CompatStatus;
  cdnStatus?: CdnProbeStatus;
  cdnProbe: boolean;
  statsBadge: boolean;
  statsView: { rows: { label: string; count: number }[]; total: number };
}

export async function loadPanelData(store: KVStore, moduleNames: string[]): Promise<PanelData> {
  const [overrides, compat, cdnStatus, stats, dnr, cdnProbe, statsBadge] = await Promise.all([
    readModuleOverrides(store, moduleNames),
    store.get<CompatStatus>(COMPAT_STATUS_KEY),
    store.get<CdnProbeStatus>(CDN_PROBE_STATUS_KEY),
    store.get<StatsPayload>(STATS_KEY),
    store.get<DnrStatsPayload>(DNR_STATS_KEY),
    store.get<boolean>(SETTING_CDN_PROBE).then(v => v ?? true),
    store.get<boolean>(SETTING_STATS_BADGE).then(v => v ?? false)
  ]);
  return {
    rows: buildModuleRows(
      moduleNames.map(n => ({ name: n, description: '' })), // 行描述由组件按 modules 参数补齐
      overrides, compat ?? undefined
    ),
    compat: compat ?? undefined,
    cdnStatus: cdnStatus ?? undefined,
    cdnProbe,
    statsBadge,
    statsView: buildStatsView(stats ?? undefined, dnr ?? undefined)
  };
}

export const PANEL_STYLE = `
:root {
  --mbgt-bg: rgba(255, 255, 255, 0.92);
  --mbgt-card-bg: rgba(248, 249, 250, 0.85);
  --mbgt-card-border: rgba(0, 0, 0, 0.06);
  --mbgt-text-main: #18191c;
  --mbgt-text-sub: #61666d;
  --mbgt-text-muted: #9499a0;
  --mbgt-primary: #00aeec;
  --mbgt-primary-hover: #009cd6;
  --mbgt-pink: #fb7299;
  --mbgt-green: #2ac864;
  --mbgt-amber: #f59e0b;
  --mbgt-shadow: 0 16px 36px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04);
  --mbgt-blur: blur(20px) saturate(180%);
}

@media (prefers-color-scheme: dark) {
  :root {
    --mbgt-bg: rgba(24, 25, 28, 0.94);
    --mbgt-card-bg: rgba(34, 36, 42, 0.75);
    --mbgt-card-border: rgba(255, 255, 255, 0.08);
    --mbgt-text-main: #f1f2f3;
    --mbgt-text-sub: #9499a0;
    --mbgt-text-muted: #71767d;
    --mbgt-primary: #00aeec;
    --mbgt-pink: #fb7299;
    --mbgt-shadow: 0 16px 36px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
  }
}

#mbgt-panel-chip {
  position: fixed;
  right: 14px;
  bottom: 64px;
  z-index: 2147483000;
  font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
  background: rgba(24, 25, 28, 0.88);
  color: #fff;
  padding: 7px 13px;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: none;
}
#mbgt-panel-chip:hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow: 0 6px 18px rgba(0, 174, 236, 0.35);
  border-color: var(--mbgt-primary);
}

.mbgt-panel-root {
  position: fixed;
  right: 14px;
  bottom: 104px;
  z-index: 2147483000;
  width: 380px;
  max-height: calc(85vh - 120px);
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--mbgt-bg);
  color: var(--mbgt-text-main);
  border-radius: 18px;
  box-shadow: var(--mbgt-shadow);
  backdrop-filter: var(--mbgt-blur);
  -webkit-backdrop-filter: var(--mbgt-blur);
  border: 1px solid var(--mbgt-card-border);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
  padding: 16px;
  box-sizing: border-box;
  animation: mbgt-fade-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes mbgt-fade-in {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Standalone options page layout overrides */
body.mbgt-standalone-options {
  background: #f0f2f5;
  margin: 0;
  padding: 32px 16px;
  display: flex;
  justify-content: center;
  min-height: 100vh;
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  body.mbgt-standalone-options { background: #0f1012; }
}
body.mbgt-standalone-options .mbgt-panel-root {
  position: static;
  width: 100%;
  max-width: 680px;
  max-height: none;
  overflow: visible;
  padding: 24px;
  border-radius: 20px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.1);
}

/* Header */
.mbgt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--mbgt-card-border);
  margin-bottom: 14px;
}
.mbgt-header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--mbgt-text-main);
  display: flex;
  align-items: center;
  gap: 8px;
}
.mbgt-version-pill {
  font-size: 11px;
  font-weight: 500;
  background: rgba(0, 174, 236, 0.12);
  color: var(--mbgt-primary);
  padding: 2px 8px;
  border-radius: 999px;
}

/* Tab Navigation */
.mbgt-tabs {
  display: flex;
  gap: 4px;
  background: var(--mbgt-card-bg);
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 14px;
  border: 1px solid var(--mbgt-card-border);
}
.mbgt-tab-btn {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--mbgt-text-sub);
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.mbgt-tab-btn.active {
  background: var(--mbgt-bg);
  color: var(--mbgt-primary);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

/* Section & Cards */
.mbgt-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mbgt-card {
  background: var(--mbgt-card-bg);
  border: 1px solid var(--mbgt-card-border);
  border-radius: 12px;
  padding: 12px 14px;
  transition: border-color 0.15s ease;
}
.mbgt-card:hover {
  border-color: rgba(0, 174, 236, 0.25);
}

/* Module Row with iOS Switch */
.mbgt-module-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mbgt-card-border);
}
.mbgt-module-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.mbgt-module-item:first-child {
  padding-top: 0;
}
.mbgt-module-info {
  flex: 1;
  min-width: 0;
}
.mbgt-module-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--mbgt-text-main);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mbgt-module-desc {
  font-size: 12px;
  color: var(--mbgt-text-sub);
  margin-top: 2px;
  line-height: 1.4;
}

/* Switch Component */
.mbgt-switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
  margin-top: 2px;
}
.mbgt-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}
.mbgt-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #cbd5e1;
  border-radius: 22px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
@media (prefers-color-scheme: dark) {
  .mbgt-slider { background-color: #475569; }
}
.mbgt-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}
.mbgt-switch input:checked + .mbgt-slider {
  background-color: var(--mbgt-primary);
}
.mbgt-switch input:checked + .mbgt-slider:before {
  transform: translateX(16px);
}
.mbgt-switch input:disabled + .mbgt-slider {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Badges */
.mbgt-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 6px;
  line-height: 1.4;
}
.mbgt-badge-warning {
  background: rgba(245, 158, 11, 0.14);
  color: var(--mbgt-amber);
}
.mbgt-badge-force {
  background: rgba(251, 114, 153, 0.14);
  color: var(--mbgt-pink);
}
.mbgt-badge-locked {
  background: rgba(148, 153, 160, 0.16);
  color: var(--mbgt-text-sub);
}
.mbgt-badge-success {
  background: rgba(42, 200, 100, 0.14);
  color: var(--mbgt-green);
}

/* Stats Metrics Grid */
.mbgt-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.mbgt-metric-box {
  background: var(--mbgt-card-bg);
  border: 1px solid var(--mbgt-card-border);
  border-radius: 12px;
  padding: 12px;
  text-align: center;
}
.mbgt-metric-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--mbgt-primary);
  line-height: 1.2;
}
.mbgt-metric-label {
  font-size: 11px;
  color: var(--mbgt-text-sub);
  margin-top: 4px;
}

/* CDN latency ping */
.mbgt-ping-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mbgt-green);
}
.mbgt-ping-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mbgt-green);
  box-shadow: 0 0 6px var(--mbgt-green);
}

/* Actions & Buttons */
.mbgt-btn-group {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.mbgt-btn {
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--mbgt-card-border);
  background: var(--mbgt-card-bg);
  color: var(--mbgt-text-main);
  cursor: pointer;
  transition: all 0.18s ease;
  user-select: none;
}
.mbgt-btn:hover {
  background: var(--mbgt-primary);
  color: #fff;
  border-color: var(--mbgt-primary);
  box-shadow: 0 4px 12px rgba(0, 174, 236, 0.25);
}
.mbgt-btn-primary {
  background: var(--mbgt-primary);
  color: #fff;
  border-color: var(--mbgt-primary);
}
.mbgt-btn-primary:hover {
  background: var(--mbgt-primary-hover);
}

.mbgt-textarea {
  width: 100%;
  height: 70px;
  box-sizing: border-box;
  font: 11px/1.4 Menlo, Monaco, Consolas, monospace;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--mbgt-card-border);
  background: var(--mbgt-card-bg);
  color: var(--mbgt-text-main);
  margin-top: 8px;
  resize: vertical;
}
.mbgt-textarea:focus {
  outline: none;
  border-color: var(--mbgt-primary);
}

.mbgt-msg-banner {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(0, 174, 236, 0.1);
  color: var(--mbgt-primary);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mbgt-muted {
  font-size: 11px;
  color: var(--mbgt-text-muted);
}
`;

export function PanelApp(props: { store: KVStore; modules: ModuleInfo[]; noReload?: boolean }) {
  const { store, modules, noReload = false } = props;
  const [data, setData] = useState<PanelData | null>(null);
  const [activeTab, setActiveTab] = useState<'modules' | 'stats' | 'settings'>('modules');
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [message, setMessage] = useState('');

  const reload = async () => {
    try {
      setData(await loadPanelData(store, modules.map(m => m.name)));
      setMessage('');
    } catch (e) {
      console.warn('[mbgt] panel load failed', e);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (cancelled) return;
      try {
        if (!document.hidden) await reload();
      } catch { /* 读失败保留旧数据 */ }
      if (cancelled) return;
      timer = setTimeout(loop, 2_000);
    };
    void loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  if (!data) {
    return h('div', { className: 'mbgt-panel-root' },
      h('div', { style: 'text-align:center;padding:24px;color:var(--mbgt-text-muted)' }, '加载配置中…')
    );
  }

  const descOf = (name: string) => modules.find(m => m.name === name)?.description ?? '';
  const lockedOf = (name: string) => modules.find(m => m.name === name)?.locked ?? false;

  const toggleOverride = async (row: ModuleRow, nextEnabled: boolean) => {
    try {
      if (!nextEnabled) await store.set(`${OVERRIDE_PREFIX}${row.name}`, 'off');
      else if (row.forced || row.autoDisabledReason) await store.set(`${OVERRIDE_PREFIX}${row.name}`, 'force-on');
      else await store.delete(`${OVERRIDE_PREFIX}${row.name}`);
      await reload();
      setMessage('配置已写入，刷新页面后生效');
    } catch (e) { console.warn('[mbgt] panel write failed', e); }
  };

  const setSetting = async (key: string, value: boolean) => {
    try {
      await store.set(key, value);
      await reload();
    } catch (e) { console.warn('[mbgt] panel write failed', e); }
  };

  return h('div', { className: 'mbgt-panel-root' },
    // ── 顶部 Brand 栏 ──
    h('div', { className: 'mbgt-header' },
      h('div', { className: 'mbgt-header-title' },
        h('span', { style: 'font-size:16px;' }, '⚡'),
        'Make Bilibili Great Together'
      ),
      h('span', { className: 'mbgt-version-pill' }, `v${MBGT_VERSION}`)
    ),

    // ── Tab 导航 ──
    h('div', { className: 'mbgt-tabs' },
      h('button', {
        className: `mbgt-tab-btn ${activeTab === 'modules' ? 'active' : ''}`,
        onClick: () => setActiveTab('modules')
      }, `模块开关（${modules.length}）`),
      h('button', {
        className: `mbgt-tab-btn ${activeTab === 'stats' ? 'active' : ''}`,
        onClick: () => setActiveTab('stats')
      }, `监控看板`),
      h('button', {
        className: `mbgt-tab-btn ${activeTab === 'settings' ? 'active' : ''}`,
        onClick: () => setActiveTab('settings')
      }, `配置备份`)
    ),

    // ── Tab 1: 模块开关 ──
    activeTab === 'modules' ? h('div', { className: 'mbgt-section' },
      h('div', { className: 'mbgt-muted', style: 'margin-bottom:4px;' }, '勾选=启用，取消=关闭；被自动停用的模块勾选即强制开启'),
      h('div', { className: 'mbgt-card' },
        ...data.rows.map(row =>
          h('div', { className: 'mbgt-module-item', key: row.name },
            h('div', { className: 'mbgt-module-info' },
              h('div', { className: 'mbgt-module-title' },
                row.name,
                row.forced ? h('span', { className: 'mbgt-badge mbgt-badge-force' }, '强制开启') : null,
                row.autoDisabledReason
                  ? h('span', { className: 'mbgt-badge mbgt-badge-warning' }, `避让: ${describeAutoDisable(data.compat, row.autoDisabledReason)}`)
                  : null,
                lockedOf(row.name) ? h('span', { className: 'mbgt-badge mbgt-badge-locked' }, '即时拦截锁定') : null
              ),
              h('div', { className: 'mbgt-module-desc' }, descOf(row.name) || row.description)
            ),
            h('label', { className: 'mbgt-switch' },
              h('input', {
                type: 'checkbox',
                'data-module': row.name,
                checked: row.enabled,
                disabled: lockedOf(row.name),
                onChange: (e: Event) => {
                  if (!lockedOf(row.name)) void toggleOverride(row, (e.target as HTMLInputElement).checked);
                }
              }),
              h('span', { className: 'mbgt-slider' })
            )
          )
        )
      )
    ) : null,

    // ── Tab 2: 监控看板 & CDN ──
    activeTab === 'stats' ? h('div', { className: 'mbgt-section' },
      // 拦截指标 2x2 网格
      h('div', { className: 'mbgt-stats-grid' },
        h('div', { className: 'mbgt-metric-box' },
          h('div', { className: 'mbgt-metric-num' }, data.statsView.total),
          h('div', { className: 'mbgt-metric-label' }, '总拦截次数')
        ),
        ...data.statsView.rows.slice(0, 3).map(r =>
          h('div', { className: 'mbgt-metric-box', key: r.label },
            h('div', { className: 'mbgt-metric-num', style: 'color:var(--mbgt-text-main);' }, r.count),
            h('div', { className: 'mbgt-metric-label' }, r.label)
          )
        )
      ),
      // CDN 智能选优卡片
      h('div', { className: 'mbgt-card' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' },
          h('div', { style: 'font-weight:600;font-size:13px;' }, '⚡ CDN 智能选优'),
          h('label', { className: 'mbgt-switch' },
            h('input', {
              type: 'checkbox',
              'data-setting': SETTING_CDN_PROBE,
              checked: data.cdnProbe,
              onChange: e => void setSetting(SETTING_CDN_PROBE, (e.target as HTMLInputElement).checked)
            }),
            h('span', { className: 'mbgt-slider' })
          )
        ),
        h('div', { className: 'mbgt-muted', style: 'margin-bottom:8px;' }, '并发测速淘汰高延迟节点，锁定最佳播放源 (缓存 5min)'),
        h('div', { style: 'font-size:12px;color:var(--mbgt-text-sub);padding:8px;background:var(--mbgt-bg);border-radius:8px;' },
          data.cdnStatus
            ? (data.cdnStatus.fallback
              ? '⚠️ 全部候选节点测速超时，已安全回退随机策略'
              : h('div', null,
                  h('div', { className: 'mbgt-ping-tag', style: 'margin-bottom:4px;' },
                    h('span', { className: 'mbgt-ping-dot' }),
                    `最优节点: ${data.cdnStatus.bestHost}`
                  ),
                  h('div', { className: 'mbgt-muted' },
                    data.cdnStatus.results.map(r => `${r.host.split('.')[0]}: ${r.ok ? `${r.ms}ms` : '失败'}`).join(' · ')
                  )
                ))
            : '尚未探测（播放器加载镜像时将自动触发）'
        )
      ),
      // 角标设置卡片
      h('div', { className: 'mbgt-card', style: 'display:flex;justify-content:space-between;align-items:center;' },
        h('div', null,
          h('div', { style: 'font-weight:500;' }, '右下角实时统计角标'),
          h('div', { className: 'mbgt-muted' }, '在页面右下角显示拦截计数胶囊')
        ),
        h('label', { className: 'mbgt-switch' },
          h('input', {
            type: 'checkbox',
            'data-setting': SETTING_STATS_BADGE,
            checked: data.statsBadge,
            onChange: e => void setSetting(SETTING_STATS_BADGE, (e.target as HTMLInputElement).checked)
          }),
          h('span', { className: 'mbgt-slider' })
        )
      )
    ) : null,

    // ── Tab 3: 配置与备份 ──
    activeTab === 'settings' ? h('div', { className: 'mbgt-section' },
      h('div', { className: 'mbgt-card' },
        h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:6px;' }, '📦 备份与配置迁移'),
        h('div', { className: 'mbgt-muted', style: 'margin-bottom:10px;' }, '导出配置 JSON 跨浏览器迁移，或粘贴配置一键导入恢复'),
        h('div', { className: 'mbgt-btn-group' },
          h('button', {
            className: 'mbgt-btn mbgt-btn-primary',
            onClick: async () => {
              try {
                const all = await store.getAll();
                setExportText(JSON.stringify(filterExportableKeys(all), null, 2));
                setMessage('✅ 已生成导出 JSON（复制下方内容即可）');
              } catch (e) { console.warn('[mbgt] panel export failed', e); }
            }
          }, '生成导出配置'),
          h('button', {
            className: 'mbgt-btn',
            onClick: async () => {
              try {
                let parsed: unknown;
                try { parsed = JSON.parse(importText); } catch { setMessage('❌ 导入失败：不是合法的 JSON 格式'); return; }
                const payload = validateImportPayload(parsed);
                if (!payload) { setMessage('❌ 导入失败：未找到有效配置键'); return; }
                for (const [k, v] of Object.entries(payload)) await store.set(k, v);
                await reload();
                setMessage(`✅ 成功导入 ${Object.keys(payload).length} 项配置，刷新后生效`);
              } catch (e) { console.warn('[mbgt] panel import failed', e); }
            }
          }, '一键导入'),
          !noReload ? h('button', {
            className: 'mbgt-btn',
            onClick: () => { unsafeLocationReload(); }
          }, '刷新页面') : null
        ),
        h('textarea', {
          className: 'mbgt-textarea',
          value: importText,
          placeholder: '在此粘贴导出的 JSON 字符串后点击「一键导入」',
          onInput: (e: Event) => setImportText((e.target as HTMLTextAreaElement).value)
        }),
        exportText ? h('textarea', {
          className: 'mbgt-textarea',
          value: exportText,
          readOnly: true,
          style: 'background:var(--mbgt-bg);border-color:var(--mbgt-primary);'
        }) : null
      )
    ) : null,

    // 底部消息横幅与版权
    message ? h('div', { className: 'mbgt-msg-banner' }, message) : null
  );
}

/** 页内刷新（仅在 userscript 浮层形态渲染；options 页传入 noReload=true 隐藏该按钮） */
function unsafeLocationReload(): void {
  try {
    (globalThis as unknown as { location: { reload(): void } }).location.reload();
  } catch (e) { console.warn('[mbgt] reload unavailable', e); }
}

const PANEL_MOUNT_STYLE_ID = 'mbgt-panel-style';

export function mountFloatingPanel(opts: { store: KVStore; modules: ModuleInfo[] }): void {
  try {
    if (document.getElementById('mbgt-panel-chip')) return;
    if (!document.getElementById(PANEL_MOUNT_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = PANEL_MOUNT_STYLE_ID;
      style.textContent = PANEL_STYLE;
      document.head?.appendChild(style);
    }
    const chip = document.createElement('div');
    chip.id = 'mbgt-panel-chip';
    chip.innerHTML = '<span style="font-size:13px;">⚙</span><span>MBGT</span>';
    chip.addEventListener('click', () => {
      let root = document.getElementById('mbgt-panel-root');
      if (root) {
        render(null, root);
        root.remove();
        return;
      }
      root = document.createElement('div');
      root.id = 'mbgt-panel-root';
      document.body?.appendChild(root);
      render(h(PanelApp, { store: opts.store, modules: opts.modules }) as any, root);
    });
    document.body?.appendChild(chip);
  } catch (e) {
    console.warn('[mbgt] floating panel mount failed', e);
  }
}
