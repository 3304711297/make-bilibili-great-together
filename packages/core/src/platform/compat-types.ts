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
  /** 细粒度功能激活状态快照（精确识别哪些冲突功能真正处于生效态） */
  activeFeatures?: Record<string, boolean>;
}

/** 三态快照：null=未装；'pending-family'=家族在场等特征；ProbeResult=特征命中即结算 */
export type SnapshotResult = ProbeResult | 'pending-family' | null;

export interface CompatProbeOptions {
  snapshot: () => SnapshotResult;
  intervalMs?: number;
  timeoutMs?: number;
  /** 家族缺席判定：返回 true 表示确定未安装，宽限期满仍缺席则提前按未安装结算 */
  notInstalledCheck?: () => boolean;
  /** 提前结算宽限期（ms），默认 2000；一次性计时，触发时需再确认 snapshot 仍为 null */
  notInstalledGraceMs?: number;
  /** 返回取消函数；测试注入假调度器 */
  scheduler: (cb: () => void, ms: number) => () => void;
  onSettle: (result: ProbeResult) => void;
}

export function startCompatProbe(options: CompatProbeOptions): void {
  const { snapshot, scheduler, onSettle } = options;
  const intervalMs = options.intervalMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const notInstalledCheck = options.notInstalledCheck;
  const notInstalledGraceMs = options.notInstalledGraceMs ?? 2_000;

  let settled = false;
  let cancelGrace: (() => void) | null = null;
  const settle = (result: ProbeResult) => {
    if (settled) return;
    settled = true;
    cancelInterval();
    cancelTimeout();
    cancelGrace?.();
    onSettle(result);
  };

  const settleFromSnapshot = () => {
    let result: SnapshotResult;
    try {
      result = snapshot();
    } catch {
      return; // 轮询路径抛错视为本轮 null：继续轮询
    }
    // 仅特征命中（完整 ProbeResult）触发结算；null 与 pending-family 继续轮询
    if (result !== null && result !== 'pending-family') {
      settle(result);
      return;
    }
    // R2 提前结算：家族缺席（确定未安装）→ 启动一次性宽限计时；
    // 宽限期内宿主出现（interval 命中结算）则 settle 内连带取消宽限计时
    if (result === null && notInstalledCheck?.() && cancelGrace === null) {
      cancelGrace = scheduler(() => {
        cancelGrace = null;
        let recheck: SnapshotResult;
        try {
          recheck = snapshot();
        } catch {
          recheck = null;
        }
        // 宽限期满仍缺席才结算未安装；宿主已出现/pending-family 则继续原轮询逻辑
        if (recheck === null) settle({ family: null, extensions: [], generic: false });
      }, notInstalledGraceMs);
    }
  };

  const cancelInterval = loop(settleFromSnapshot);
  const cancelTimeout = scheduler(() => {
    let result: SnapshotResult;
    try {
      result = snapshot();
    } catch {
      result = null; // 超时路径抛错按未安装结算
    }
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
