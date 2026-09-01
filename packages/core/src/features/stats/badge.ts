// 统计角标（spec §4.2）：右下角可收起角标，默认关闭，设置里开启（接线层按 mbgt:ui:stats-badge 挂载）。
// 基线 = mount 时读到的持久计数；实时增量经 onInterception 监听。挂载失败只损失可视化（降级原则）。
import type { KVStore } from '../../platform/storage';
import { onInterception, readStats, sessionCounts } from './registry';
import { foldDnrCounts, DNR_STATS_KEY, type DnrStatsPayload } from './dnr';

const BADGE_ID = 'mbgt-stats-badge';

/** 角标/面板同口径持久基线：content 统计 + DNR（归并为 'dnr'）。T1 数据入口，T4 的 30s 重读复用。 */
export async function readBadgeBaseline(store: KVStore): Promise<Record<string, number>> {
  const [stats, dnr] = await Promise.all([
    readStats(store),
    store.get<DnrStatsPayload>(DNR_STATS_KEY)
  ]);
  return { ...stats.counts, ...foldDnrCounts(dnr?.counts ?? {}) };
}

const BADGE_STYLE = `
#${BADGE_ID}{position:fixed;right:12px;bottom:12px;z-index:2147483000;font:12px/1.4 system-ui,sans-serif;
  background:rgba(20,20,20,.85);color:#fff;padding:6px 10px;border-radius:999px;cursor:pointer;user-select:none}
#${BADGE_ID} ul{position:fixed;right:12px;bottom:44px;margin:0;padding:8px 12px;list-style:none;
  background:rgba(20,20,20,.9);color:#fff;border-radius:8px;max-width:260px;display:none}
#${BADGE_ID}.open ul{display:block}
`;

export function mountStatsBadge(opts: { store: KVStore }): (() => void) | null {
  try {
    if (document.getElementById(BADGE_ID)) return null;

    const chip = document.createElement('div');
    chip.id = BADGE_ID;
    const list = document.createElement('ul');
    const label = document.createElement('span');
    chip.appendChild(list);
    chip.appendChild(label);
    const style = document.createElement('style');
    style.textContent = BADGE_STYLE;

    let baselineCounts: Record<string, number> = {};
    let destroyed = false;

    const sum = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + v, 0);
    const render = () => {
      if (destroyed) return;
      const live = sessionCounts();
      label.textContent = `🛡 ${sum(baselineCounts) + sum(live)}`;
      const merged = { ...baselineCounts };
      for (const [k, v] of Object.entries(live)) merged[k] = (merged[k] ?? 0) + v;
      const items = Object.entries(merged).filter(([, v]) => v > 0);
      list.replaceChildren(...(
        items.length > 0
          ? items.map(([k, v]) => {
            const li = document.createElement('li');
            li.textContent = `${k}: ${v}`;
            return li;
          })
          : (() => { const li = document.createElement('li'); li.textContent = '（暂无拦截记录）'; return [li]; })()
      ));
    };

    const off = onInterception(() => render());
    void readBadgeBaseline(opts.store).then(base => {
      baselineCounts = base;
      render();
    }).catch(() => { /* 基线读取失败仍可显示会话计数 */ });
    // Plan 5 §3：30s 低频重读持久基线（含 DNR，同口径最终一致）；叠加当前会话未归档增量，不覆盖实时计数
    const baselineTimer = setInterval(() => {
      void readBadgeBaseline(opts.store).then(base => {
        if (destroyed) return;
        baselineCounts = base;
        render();
      }).catch(() => { /* 重读失败保持上次基线 */ });
    }, 30_000);

    chip.addEventListener('click', () => chip.classList.toggle('open'));
    render();
    document.head?.appendChild(style);
    document.body?.appendChild(chip);

    return () => {
      destroyed = true;
      clearInterval(baselineTimer);
      off();
      chip.remove();
      style.remove();
    };
  } catch (e) {
    console.warn('[mbgt] stats badge mount failed', e);
    return null;
  }
}
