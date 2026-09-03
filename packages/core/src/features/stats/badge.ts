// 统计角标（spec §4.2）：右下角可收起角标，默认关闭，设置里开启（接线层按 mbgt:ui:stats-badge 挂载）。
// 基线 = mount 时读到的持久计数；实时增量经 onInterception 监听。挂载失败只损失可视化（降级原则）。
import type { KVStore } from '../../platform/storage';
import { onInterception, onFlush, readStats, sessionCounts } from './registry';
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
#${BADGE_ID} {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 2147483000;
  font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: rgba(24, 25, 28, 0.9);
  color: #fff;
  padding: 6px 13px;
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: -0.01em;
}
#${BADGE_ID}:hover {
  transform: translateY(-2px) scale(1.02);
  border-color: #00aeec;
  box-shadow: 0 6px 22px rgba(0, 174, 236, 0.35);
}
#${BADGE_ID}:active {
  transform: translateY(0) scale(0.98);
}
#${BADGE_ID} ul {
  position: fixed;
  right: 14px;
  bottom: 50px;
  margin: 0;
  padding: 12px 16px;
  list-style: none;
  background: rgba(24, 25, 28, 0.95);
  color: #f1f2f3;
  border-radius: 14px;
  max-width: 290px;
  min-width: 170px;
  display: none;
  backdrop-filter: blur(18px) saturate(180%);
  -webkit-backdrop-filter: blur(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
  font-size: 12px;
  line-height: 1.6;
}
#${BADGE_ID} ul li {
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: color 0.15s ease;
}
#${BADGE_ID} ul li:last-child {
  border-bottom: none;
}
#${BADGE_ID} ul li:hover {
  color: #00aeec;
}
#${BADGE_ID}.open ul {
  display: block;
  animation: mbgt-badge-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes mbgt-badge-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
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
    // flush 落盘成功 → 立即重读基线（自愈加速；失败/跨上下文仍由下方 30s timer 兜底）
    const offFlush = onFlush(() => {
      void readBadgeBaseline(opts.store).then(base => {
        if (destroyed) return;
        baselineCounts = base;
        render();
      }).catch(() => { /* 重读失败保持上次基线 */ });
    });
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
      offFlush();
      chip.remove();
      style.remove();
    };
  } catch (e) {
    console.warn('[mbgt] stats badge mount failed', e);
    return null;
  }
}
