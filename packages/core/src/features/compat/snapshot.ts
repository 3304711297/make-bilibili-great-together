import type { ExtensionId, SnapshotResult } from '../../platform/compat-types';

export interface BewlySnapshotOptions {
  /** 冒烟裁定（2026-09-01）：#bewly-bottom-comment-style 在 BewlyCat 1.6.9 也会瞬时注入，
   *  作为 AveMujica 独有标记不可靠。默认 false=忽略该标记（AveMujica 单独在场走 generic 并集）。
   *  找到版本稳定的独有标记后可开启。 */
  enableAvemujicaCommentStyleMarker?: boolean;
}

const BEWLYCAT_MARKERS = [
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

const AVEMUJICA_MARKERS = [
  '.ave-mujica',
  '.theme-avemujica',
  '.ave-dock',
  '.ave-sidebar',
  '#ave-mujica-app',
  '[data-ave-theme]',
  '#ave-font-style',
  'style[data-theme="ave-mujica"]'
].join(', ');

/**
 * 细粒度功能状态探测：检测扩展是否真正在当前页面激活了冲突项
 */
function probeActiveFeatures(whole: HTMLElement, hosts: HTMLElement[]): Record<string, boolean> {
  const query = (sel: string) =>
    whole.querySelector(sel) !== null ||
    hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector(sel) !== null);

  return {
    // 首页重构与去广告：检测是否生成了 Bewly 首页组件或隐藏了原生 feed
    'optimize-homepage': query('#bewly-home, .bewly-home-grid, [data-bewly-page="home"], .bewly-header'),
    'no-ad': query('#bewly-home, .bewly-home-grid, [data-bewly-page="home"]'),
    // 自定义字体：检测是否注入了 font-family 全局样式覆盖
    'use-system-fonts': query('style#bewly-font-style, style#ave-font-style, style[data-font-override]'),
    // 动态页改造：检测根节点是否被打上 momentsPage 改造标记
    'optimize-story': whole.classList.contains('momentsPage') || query('.opus-detail-bewly'),
    // 播放器适配：检测播放器宽屏增强
    'player-video-fit': query('.bewly-widescreen, [data-bewly-widescreen], .bpx-player-ctrl-bewly-widescreen'),
    // URL 参数清理
    'remove-useless-url-params': query('[data-bewly-clean-url]')
  };
}

/**
 * 三态 DOM 快照工厂（userscript 与扩展共用）：
 * DOM 查询：#bewly 家族宿主 + 多维特征标记；shadow DOM 为 open 模式可直查。
 */
export function createBewlyFamilySnapshot(doc: Document, options?: BewlySnapshotOptions): () => SnapshotResult {
  const enableAvemujicaMarker = options?.enableAvemujicaCommentStyleMarker === true;
  return (): SnapshotResult => {
    const hosts = Array.from(doc.querySelectorAll<HTMLElement>('#bewly[data-version]'));
    if (hosts.length === 0) return null;
    const extensions: { id: ExtensionId; version: string | null }[] = [];
    const whole = doc.documentElement;

    // 行序固定裁定：bewlycat 恒在 avemujica 之前
    // I1：shadowRoot 判空前置
    const hasBewlyCatMarker = whole.querySelector(BEWLYCAT_MARKERS) !== null
      || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector(BEWLYCAT_MARKERS) !== null);
    if (hasBewlyCatMarker) {
      extensions.push({ id: 'bewlycat', version: hosts[0]?.getAttribute('data-version') ?? null });
    }

    const hasAvemujicaMarker = whole.querySelector(AVEMUJICA_MARKERS) !== null
      || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector(AVEMUJICA_MARKERS) !== null)
      || (enableAvemujicaMarker && (whole.querySelector('#bewly-bottom-comment-style') !== null || hosts.some(h => h.shadowRoot && h.shadowRoot.querySelector('#bewly-bottom-comment-style') !== null)));
    if (hasAvemujicaMarker) {
      extensions.push({ id: 'avemujica', version: hosts[0]?.getAttribute('data-version') ?? null });
    }

    if (extensions.length > 0) {
      const activeFeatures = probeActiveFeatures(whole, hosts);
      return { family: 'bewly' as const, extensions, generic: false, activeFeatures };
    }
    return 'pending-family';
  };
}
