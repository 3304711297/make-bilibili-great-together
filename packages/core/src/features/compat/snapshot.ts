import type { ExtensionId, SnapshotResult } from '../../platform/compat-types';

export interface BewlySnapshotOptions {
  /** 冒烟裁定（2026-09-01）：#bewly-bottom-comment-style 在 BewlyCat 1.6.9 也会瞬时注入，
   *  作为 AveMujica 独有标记不可靠。默认 false=忽略该标记。找到版本稳定的独有标记后可开启。 */
  enableAvemujicaCommentStyleMarker?: boolean;
}

// 🐱 层级 1：BewlyCat (keleus) 独占专属特征指纹
const BEWLYCAT_EXCLUSIVE_MARKERS = [
  'img[src*="logo-cat"]',
  'a[href*="keleus/BewlyCat"]',
  'a[href*="keleus"]'
].join(', ');

// 🌸 层级 1：AveMujica (VentusUta) 独占专属特征指纹
const AVEMUJICA_EXCLUSIVE_MARKERS = [
  'img[src*="bewly-ave-mujica"]',
  'a[href*="VentusUta"]',
  'a[href*="BewlyBewly-AveMujica"]',
  '.ave-mujica',
  '.theme-avemujica',
  '.ave-dock',
  '.ave-sidebar',
  '#ave-mujica-app',
  '[data-ave-theme]',
  '#ave-font-style',
  'style[data-theme="ave-mujica"]'
].join(', ');

// 🏠 层级 3：家族通用标记（若无独占指纹且无版本号，作为待定通用宿主）
const FAMILY_COMMON_MARKERS = [
  '[bewly-auto-exit-listener]',
  '.bewly-watch-later-btn',
  '[data-bewly-theme]',
  '.bewly-design',
  '.bewly-dock',
  '#bewly-app',
  '.bewly-header',
  '.bewly-search-bar',
  '[data-bewly-version]'
].join(', ');

/**
 * 三态 DOM 快照工厂（userscript 与扩展共用）：
 * DOM 查询：#bewly 家族宿主 + 多维分层特征标记；shadow DOM 为 open 模式可直查。
 */
export function createBewlyFamilySnapshot(doc: Document, options?: BewlySnapshotOptions): () => SnapshotResult {
  const enableAvemujicaMarker = options?.enableAvemujicaCommentStyleMarker === true;
  return (): SnapshotResult => {
    const hosts = Array.from(doc.querySelectorAll<HTMLElement>('#bewly[data-version]'));
    if (hosts.length === 0) return null;
    const extensions: { id: ExtensionId; version: string | null }[] = [];
    const whole = doc.documentElement;
    const version = hosts[0]?.getAttribute('data-version') ?? null;

    // 1. 层级 1：独占专属指纹匹配 (Exclusive Identity Matching)
    const hasBewlyCatExclusive = whole.querySelector(BEWLYCAT_EXCLUSIVE_MARKERS) !== null
      || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector(BEWLYCAT_EXCLUSIVE_MARKERS) !== null);

    const hasAvemujicaExclusive = whole.querySelector(AVEMUJICA_EXCLUSIVE_MARKERS) !== null
      || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector(AVEMUJICA_EXCLUSIVE_MARKERS) !== null)
      || (enableAvemujicaMarker && (whole.querySelector('#bewly-bottom-comment-style') !== null || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector('#bewly-bottom-comment-style') !== null)));

    if (hasBewlyCatExclusive) {
      extensions.push({ id: 'bewlycat', version });
    }

    if (hasAvemujicaExclusive) {
      extensions.push({ id: 'avemujica', version });
    }

    // 2. 层级 2：版本号主支启发式判定 (Version Heuristics)
    // 当独占 UI 组件尚未渲染、但宿主带有版本号时，直接按主支号精准锁定扩展
    if (extensions.length === 0 && version) {
      if (version.startsWith('1.8.')) {
        extensions.push({ id: 'avemujica', version });
      } else if (version.startsWith('1.7.') || version.startsWith('1.6.')) {
        extensions.push({ id: 'bewlycat', version });
      }
    }

    // 3. 层级 3：若通过独占指纹或版本号已锁定身份
    if (extensions.length > 0) {
      return { family: 'bewly' as const, extensions, generic: false };
    }

    // 4. 若无独占指纹，检查是否有家族通用组件（若有则为 pending-family 维持轮询，超时走保守 generic）
    const hasCommonMarker = whole.querySelector(FAMILY_COMMON_MARKERS) !== null
      || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector(FAMILY_COMMON_MARKERS) !== null);

    if (hasCommonMarker) {
      return 'pending-family';
    }

    return 'pending-family';
  };
}
