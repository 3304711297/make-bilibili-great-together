import type { ExtensionId, SnapshotResult } from '../../platform/compat-types';

export interface BewlySnapshotOptions {
  /** 冒烟裁定（2026-09-01）：#bewly-bottom-comment-style 在 BewlyCat 1.6.9 也会瞬时注入，
   *  作为 AveMujica 独有标记不可靠。默认 false=忽略该标记（AveMujica 单独在场走 generic 并集）。
   *  找到版本稳定的独有标记后可开启。 */
  enableAvemujicaCommentStyleMarker?: boolean;
}

/**
 * 三态 DOM 快照工厂（userscript 与扩展共用）：
 * DOM 查询：#bewly 家族宿主 + 特征标记；shadow DOM 为 open 模式可直查。
 * BewlyCat 标记：播放器/稍后再看补间（1.6.9 与 main 均存在，瞬时出现，轮询可捕获）。
 * 真机冒烟（2026-09-01）发现 #bewly-bottom-comment-style 并非 AveMujica 独有：
 * BewlyCat 1.6.9 初始化时也会瞬时注入该 id，会误判为"双扩展在场"走并集。
 * 默认忽略该标记（enableAvemujicaCommentStyleMarker=false）——AveMujica 单独在场时
 * 走 pending-family→超时 generic（保守并集，禁用结果一致）。
 * 共用 #bewly[data-version] 挂载点：BewlyCat 命中时取 hosts[0] 版本——单扩展场景正确，
 * 同页多宿主时非精确（version 精确化留给 Plan 4）。
 * 三态契约：特征命中→完整结果；家族在场特征未现→pending-family（保持轮询，超时后 generic）；无家族→null
 * doc 契约：doc 需支持 documentElement.querySelector（文档级标记查询）与 querySelectorAll('#bewly[data-version]')（家族宿主查询）
 */
export function createBewlyFamilySnapshot(doc: Document, options?: BewlySnapshotOptions): () => SnapshotResult {
  const enableAvemujicaMarker = options?.enableAvemujicaCommentStyleMarker === true;
  return (): SnapshotResult => {
    const hosts = Array.from(doc.querySelectorAll<HTMLElement>('#bewly[data-version]'));
    if (hosts.length === 0) return null;
    const extensions: { id: ExtensionId; version: string | null }[] = [];
    const whole = doc.documentElement;
    // 行序固定裁定：bewlycat 恒在 avemujica 之前
    // I1：shadowRoot 判空前置——`h.shadowRoot?.querySelector(sel) !== null` 在 shadowRoot 为 null 时
    // 因 optional chaining 得 undefined !== null 恒真，会对无 shadowRoot 宿主误归因
    const hasBewlyCatMarker = whole.querySelector('[bewly-auto-exit-listener], .bewly-watch-later-btn') !== null
      || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector('[bewly-auto-exit-listener], .bewly-watch-later-btn') !== null);
    if (hasBewlyCatMarker) extensions.push({ id: 'bewlycat', version: hosts[0]?.getAttribute('data-version') ?? null });
    // 误报治理：#bewly-bottom-comment-style 查询保留在开关守卫分支内（默认不执行）
    if (enableAvemujicaMarker) {
      const hasAvemujicaMarker = whole.querySelector('#bewly-bottom-comment-style') !== null
        || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector('#bewly-bottom-comment-style') !== null);
      if (hasAvemujicaMarker) extensions.push({ id: 'avemujica', version: null });
    }
    if (extensions.length > 0) return { family: 'bewly' as const, extensions, generic: false };
    return 'pending-family';
  };
}
