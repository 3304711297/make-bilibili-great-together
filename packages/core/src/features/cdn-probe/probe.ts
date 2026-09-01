// CDN 智能选优（spec §4.1）：对 playinfo 出现的镜像候选发起小体积 range 探测，
// 2s 超时淘汰，按延迟取最优，结果缓存 5min；全败回退上游随机策略（getBestHost 返回 null 即回退）。
// 候选来自 cdnUtil 收集的 mirror_type_upgcxcode_hosts——P2P/PCDN 与无 SSL 的 mirror14b
// 在收集阶段已被排除（knownP2pCdnDomainPattern），本文件不做二次过滤。
import type { Logger } from '../../logger';
import type { KVStore } from '../../platform/storage';

/** 探测网络通道：userscript 走 GM_xmlhttpRequest（绕 CORS+绕页面 hook），扩展走 isolated 世界裸 fetch */
export type ProbeFetch = (url: string, timeoutMs: number) => Promise<{ ok: boolean; ms: number }>;

export const PROBE_TIMEOUT_MS = 2_000;
export const PROBE_CACHE_TTL_MS = 5 * 60_000;
export const REPROBE_DELAY_MS = 30_000;
export const CDN_PROBE_STATUS_KEY = 'mbgt:cdn:probe:status';

export interface CdnProbeResult { host: string; ms: number; ok: boolean }
export interface CdnProbeStatus {
  bestHost: string | null;
  results: CdnProbeResult[];
  startedAt: number;
  finishedAt: number | null;
  fallback: boolean;
}

export interface CdnProbe {
  ensureProbe(candidateHosts: string[], sampleUrl: string): void;
  getBestHost(): { host: string; expiresAt: number } | null;
  getStatus(): CdnProbeStatus | null;
  destroy(): void;
}

export function createCdnProbe(opts: { fetchLike: ProbeFetch; logger: Logger; store: KVStore }): CdnProbe {
  const { fetchLike, logger, store } = opts;
  let status: CdnProbeStatus | null = null;
  let probing = false;
  let cache: { host: string; expiresAt: number } | null = null;
  let lastInput: { hosts: string[]; sampleUrl: string } | null = null;
  let reprobeTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    ensureProbe(candidateHosts, sampleUrl) { ensureProbe(candidateHosts, sampleUrl); },
    getBestHost() {
      return cache && cache.expiresAt > Date.now() ? cache : null;
    },
    getStatus() { return status; },
    destroy() {
      if (reprobeTimer) { clearTimeout(reprobeTimer); reprobeTimer = null; }
      lastInput = null;
    }
  };

  function ensureProbe(candidateHosts: string[], sampleUrl: string): void {
    if (candidateHosts.length > 0) lastInput = { hosts: [...new Set(candidateHosts)], sampleUrl };
    if (probing) return;
    if (cache && cache.expiresAt > Date.now()) return;
    const hosts = [...new Set(candidateHosts)];
    if (hosts.length === 0) return;
    probing = true;
    void runProbe(hosts, sampleUrl);
  }

  async function runProbe(hosts: string[], sampleUrl: string): Promise<void> {
    const startedAt = Date.now();
    const results: CdnProbeResult[] = [];
    await Promise.all(hosts.map(async (host) => {
      try {
        const url = new URL(sampleUrl);
        url.hostname = host;
        url.protocol = 'https:';
        url.port = '443';
        const r = await fetchLike(url.href, PROBE_TIMEOUT_MS);
        results.push({ host, ok: r.ok, ms: r.ms });
      } catch {
        results.push({ host, ok: false, ms: PROBE_TIMEOUT_MS });
      }
    }));
    const oks = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
    const best = oks[0] ?? null;
    if (best) cache = { host: best.host, expiresAt: Date.now() + PROBE_CACHE_TTL_MS };
    status = { bestHost: best?.host ?? null, results, startedAt, finishedAt: Date.now(), fallback: !best };
    probing = false;
    if (reprobeTimer) { clearTimeout(reprobeTimer); reprobeTimer = null; } // 冻结：单 timer，新探测重排
    if (best) {
      reprobeTimer = setTimeout(() => {
        reprobeTimer = null;
        if (cache && Date.now() >= cache.expiresAt && lastInput) ensureProbe(lastInput.hosts, lastInput.sampleUrl);
      }, PROBE_CACHE_TTL_MS + REPROBE_DELAY_MS);
    }
    // fallback（全败）不安排：等待下一次外部 ensureProbe 触发
    if (best) logger.info(`CDN probe finished: best=${best.host} (${best.ms}ms)`, { results });
    else logger.warn('CDN probe: all candidates failed, fallback to random mirror', { results });
    try {
      await store.set(CDN_PROBE_STATUS_KEY, status);
    } catch { /* 面板数据持久化失败不影响探测 */ }
  }
}
