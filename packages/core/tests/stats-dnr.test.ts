import { describe, it, expect } from 'vitest';
import { mergeDnrCounts } from '../src/features/stats/dnr';

describe('mergeDnrCounts', () => {
  it('持久值 + 本会话增量（扣 baseline 防后台重启重复累加）', () => {
    expect(mergeDnrCounts({ defuse_report: 100 }, { defuse_report: 3 }, { defuse_report: 7 })).toEqual({ defuse_report: 104 });
  });
  it('新键从 0 起算', () => {
    expect(mergeDnrCounts({}, {}, { defuse_report: 5 })).toEqual({ defuse_report: 5 });
  });
  it('会话计数低于 baseline（异常）不产生负数', () => {
    const r = mergeDnrCounts({ defuse_report: 10 }, { defuse_report: 8 }, { defuse_report: 5 });
    expect(r.defuse_report).toBe(10);
  });
});
