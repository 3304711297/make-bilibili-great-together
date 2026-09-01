export type ExtensionId = 'bewlycat' | 'avemujica';

export interface DetectedExtension {
  id: ExtensionId;
  version: string | null;
}

export interface ProbeResult {
  family: 'bewly' | null;
  extensions: DetectedExtension[];
  /** 家族在场但无法定位到具体扩展（特征不足/超时），按保守并集处理 */
  generic: boolean;
}

/** 三态快照：null=未装；'pending-family'=家族在场等特征；ProbeResult=特征命中即结算 */
export type SnapshotResult = ProbeResult | 'pending-family' | null;

export interface CompatProbeOptions {
  snapshot: () => SnapshotResult;
  intervalMs?: number;
  timeoutMs?: number;
  /** 返回取消函数；测试注入假调度器 */
  scheduler: (cb: () => void, ms: number) => () => void;
  onSettle: (result: ProbeResult) => void;
}

export function startCompatProbe(options: CompatProbeOptions): void {
  const { snapshot, scheduler, onSettle } = options;
  const intervalMs = options.intervalMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 10_000;

  let settled = false;
  const settle = (result: ProbeResult) => {
    if (settled) return;
    settled = true;
    cancelInterval();
    cancelTimeout();
    onSettle(result);
  };

  const settleFromSnapshot = () => {
    const result = snapshot();
    // 仅特征命中（完整 ProbeResult）触发结算；null 与 pending-family 继续轮询
    if (result !== null && result !== 'pending-family') settle(result);
  };

  const cancelInterval = loop(settleFromSnapshot);
  const cancelTimeout = scheduler(() => {
    const result = snapshot();
    if (result !== null && result !== 'pending-family') {
      settle(result); // 超时瞬间特征已出现：按真实结果结算
    } else if (result === 'pending-family') {
      // 家族在场但特征始终未现：按保守 generic 结算
      settle({ family: 'bewly', extensions: [], generic: true });
    } else {
      settle({ family: null, extensions: [], generic: false });
    }
  }, timeoutMs);
  // 启动时同步查一次（cancelInterval/cancelTimeout 已赋值，TDZ 安全）
  settleFromSnapshot();

  function loop(cb: () => void): () => void {
    let cancelled = false;
    const tick = () => {
      if (cancelled || settled) return;
      cb();
      scheduler(tick, intervalMs);
    };
    scheduler(tick, intervalMs);
    return () => { cancelled = true; };
  }
}
