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
  buildModuleRows, buildStatsView, filterExportableKeys, validateImportPayload, type ModuleRow
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

const PANEL_STYLE = `
#mbgt-panel-chip{position:fixed;right:12px;bottom:64px;z-index:2147483000;font:12px/1.4 system-ui,sans-serif;
  background:rgba(20,20,20,.85);color:#fff;padding:6px 10px;border-radius:999px;cursor:pointer}
/* 面板根用 class（.mbgt-panel-root）而非 id：id 'mbgt-panel-root' 保留给浮层挂载容器，
   避免与 PanelApp 渲染出的根 div 冲突；PANEL_STYLE 仅浮层形态注入，options 页用自己的样式 */
.mbgt-panel-root{position:fixed;right:12px;bottom:96px;z-index:2147483000;width:340px;max-height:70vh;overflow:auto;
  background:#fff;color:#222;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:13px/1.6 system-ui,sans-serif;padding:12px}
.mbgt-panel-root h4{margin:10px 0 4px;font-size:13px}
.mbgt-panel-root .mbgt-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0}
.mbgt-panel-root .mbgt-reason{color:#a00;font-size:12px}
.mbgt-panel-root .mbgt-muted{color:#777;font-size:12px}
.mbgt-panel-root .mbgt-btn{cursor:pointer;margin-right:6px}
.mbgt-panel-root textarea{width:100%;height:80px;font:12px monospace}
`;

export function PanelApp(props: { store: KVStore; modules: ModuleInfo[] }) {
  const { store, modules } = props;
  const [data, setData] = useState<PanelData | null>(null);
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
  useEffect(() => { void reload(); }, []);

  if (!data) return h('div', null, '加载中…');

  const descOf = (name: string) => modules.find(m => m.name === name)?.description ?? '';
  const lockedOf = (name: string) => modules.find(m => m.name === name)?.locked ?? false;

  // 开关语义（与测试用例一致）：取消勾选 → 'off'；勾选 → 被自动停用的模块恢复为 'force-on'，
  // 正常模块恢复默认（删键）。forced 行取消勾选同样是 'off'（彻底关，而非退回自动停用）。
  const toggleOverride = async (row: ModuleRow, nextEnabled: boolean) => {
    try {
      if (!nextEnabled) await store.set(`${OVERRIDE_PREFIX}${row.name}`, 'off');
      else if (row.forced || row.autoDisabledReason) await store.set(`${OVERRIDE_PREFIX}${row.name}`, 'force-on');
      else await store.delete(`${OVERRIDE_PREFIX}${row.name}`);
      await reload();
      setMessage('配置已写入，重启页面后生效');
    } catch (e) { console.warn('[mbgt] panel write failed', e); }
  };

  const setSetting = async (key: string, value: boolean) => {
    try {
      await store.set(key, value);
      await reload();
    } catch (e) { console.warn('[mbgt] panel write failed', e); }
  };

  return h('div', { className: 'mbgt-panel-root' },
    // ── 模块开关 ──
    h('h4', null, `模块开关（${modules.length}）`),
    h('div', { className: 'mbgt-muted' }, '勾选=启用，取消=关闭；被自动停用的模块勾选即强制开启；重启页面生效'),
    ...data.rows.map(row =>
      h('div', { className: 'mbgt-row', key: row.name },
        h('label', null,
          h('input', {
            type: 'checkbox', 'data-module': row.name,
            checked: row.enabled, disabled: lockedOf(row.name),
            onChange: (e: Event) => {
              if (!lockedOf(row.name)) void toggleOverride(row, (e.target as HTMLInputElement).checked);
            }
          }),
          ` ${row.name}`, ` — ${descOf(row.name) || row.description}`
        ),
        row.forced ? h('span', { className: 'mbgt-muted' }, '（强制开启）') : null,
        row.autoDisabledReason
          ? h('span', { className: 'mbgt-reason' }, `自动停用：${row.autoDisabledReason.extension} / ${row.autoDisabledReason.feature}`)
          : null,
        lockedOf(row.name) ? h('span', { className: 'mbgt-muted' }, '（即时模块锁定：扩展形态保障 document-start 拦截）') : null
      )
    ),
    // ── CDN 选优 ──
    h('h4', null, 'CDN 智能选优'),
    h('div', { className: 'mbgt-row' },
      h('label', null,
        h('input', {
          type: 'checkbox', 'data-setting': SETTING_CDN_PROBE, checked: data.cdnProbe,
          onChange: e => void setSetting(SETTING_CDN_PROBE, (e.target as HTMLInputElement).checked)
        }),
        ' 启用探测（2s 超时，结果缓存 5 分钟，全败回退随机）'
      )
    ),
    h('div', { className: 'mbgt-muted' },
      data.cdnStatus
        ? (data.cdnStatus.fallback
          ? '最近探测：全部候选失败，已回退随机镜像'
          : `最近探测：最优 ${data.cdnStatus.bestHost}；${data.cdnStatus.results.map(r => `${r.host} ${r.ok ? `${r.ms}ms` : '失败'}`).join('，')}`)
        : '尚未探测（播放器取到镜像列表后自动触发）'
    ),
    h('div', { className: 'mbgt-muted' }, '扩展形态：开关自下个页面加载起完全生效'),
    // ── 统计 ──
    h('h4', null, `拦截统计（合计 ${data.statsView.total}）`),
    ...data.statsView.rows.map(r => h('div', { className: 'mbgt-row', key: r.label }, `${r.label}：${r.count}`)),
    data.statsView.rows.length === 0 ? h('div', { className: 'mbgt-muted' }, '暂无拦截记录') : null,
    h('div', { className: 'mbgt-row' },
      h('label', null,
        h('input', {
          type: 'checkbox', 'data-setting': SETTING_STATS_BADGE, checked: data.statsBadge,
          onChange: e => void setSetting(SETTING_STATS_BADGE, (e.target as HTMLInputElement).checked)
        }),
        ' 右下角统计角标（默认关闭）'
      )
    ),
    // ── 导入/导出 ──
    h('h4', null, '配置导入 / 导出'),
    h('div', null,
      h('button', {
        className: 'mbgt-btn',
        onClick: async () => {
          try {
            const all = await store.getAll();
            setExportText(JSON.stringify(filterExportableKeys(all), null, 2));
            setMessage('已生成导出 JSON（复制保存即可）');
          } catch (e) { console.warn('[mbgt] panel export failed', e); }
        }
      }, '生成导出'),
      h('button', {
        className: 'mbgt-btn',
        onClick: async () => {
          try {
            let parsed: unknown;
            try { parsed = JSON.parse(importText); } catch { setMessage('导入失败：不是合法 JSON'); return; }
            const payload = validateImportPayload(parsed);
            if (!payload) { setMessage('导入失败：没有可导入的配置键'); return; }
            for (const [k, v] of Object.entries(payload)) await store.set(k, v);
            await reload();
            setMessage(`已导入 ${Object.keys(payload).length} 个配置键，重启页面后生效`);
          } catch (e) { console.warn('[mbgt] panel import failed', e); }
        }
      }, '导入'),
      h('button', {
        className: 'mbgt-btn',
        onClick: () => { unsafeLocationReload(); }
      }, '刷新页面')
    ),
    h('textarea', {
      value: importText, placeholder: '粘贴导出 JSON 后点导入',
      onInput: (e: Event) => setImportText((e.target as HTMLTextAreaElement).value)
    }),
    exportText ? h('textarea', { value: exportText, readOnly: true }) : null,
    message ? h('div', { className: 'mbgt-muted' }, message) : null,
    h('div', { className: 'mbgt-muted' }, `MBGT v${MBGT_VERSION}`)
  );
}

/** 页内刷新（options 页不适用；PanelApp 在 options 中不渲染该按钮时传入 noReload） */
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
    chip.textContent = '⚙ MBGT';
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
