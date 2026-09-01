import { describe, it, expect, vi } from 'vitest';
import { startCompatProbe, type ProbeResult, type SnapshotResult } from '../src/platform/compat-types';

/** 假调度器：收集任务，测试手动推进时间 */
function fakeScheduler() {
  const tasks: { cb: () => void; at: number; cancelled: boolean }[] = [];
  let now = 0;
  const schedule = (cb: () => void, ms: number) => {
    const task = { cb, at: now + ms, cancelled: false };
    tasks.push(task);
    return () => { task.cancelled = true; };
  };
  return {
    schedule,
    advance(ms: number) {
      now += ms;
      for (const t of [...tasks].sort((a, b) => a.at - b.at)) {
        if (!t.cancelled && t.at <= now) { t.cancelled = true; t.cb(); }
      }
    }
  };
}

const NO_FAMILY: ProbeResult = { family: null, extensions: [], generic: false };

describe('startCompatProbe', () => {
  it('特征命中→启动时同步结算，首个 tick 前完成', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({
      snapshot: () => ({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.7.8' }], generic: false }),
      scheduler: s.schedule,
      onSettle
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith({ family: 'bewly', extensions: [{ id: 'bewlycat', version: '1.7.8' }], generic: false });
    s.advance(10_000);
    expect(onSettle).toHaveBeenCalledTimes(1); // 结算后不再触发
  });

  it("pending-family（家族在场特征未现）→ 不提前结算，超时后按 generic 结算", () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({
      snapshot: () => 'pending-family',
      scheduler: s.schedule,
      onSettle
    });
    s.advance(9_999);
    expect(onSettle).not.toHaveBeenCalled();
    s.advance(1);
    expect(onSettle).toHaveBeenCalledWith({ family: 'bewly', extensions: [], generic: true });
  });

  it('超时且家族信号消失→按未安装结算', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    startCompatProbe({ snapshot: () => NO_FAMILY, scheduler: s.schedule, onSettle });
    s.advance(10_000);
    expect(onSettle).toHaveBeenCalledWith({ family: null, extensions: [], generic: false });
  });

  it('pending-family 期间特征出现→立即结算，不再等超时', () => {
    const s = fakeScheduler();
    const onSettle = vi.fn();
    let result: SnapshotResult = 'pending-family';
    startCompatProbe({ snapshot: () => result, scheduler: s.schedule, onSettle });
    expect(onSettle).not.toHaveBeenCalled(); // 启动同步查询是 pending，不结算
    result = { family: 'bewly', extensions: [{ id: 'avemujica', version: '1.8.31' }], generic: false };
    s.advance(200);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.advance(10_000);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });
});
