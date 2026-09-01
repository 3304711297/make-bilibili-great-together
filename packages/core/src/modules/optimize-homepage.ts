// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { tagged as css } from 'foxts/tagged';

// 上游本模块未使用 logger；参数保留以维持统一的工厂签名 function(_logger: Logger): ModuleMeta
export default function optimizeHomepage(_logger: Logger): ModuleMeta {
  return {
    name: 'optimize-homepage',
    description: '首页广告去除和样式优化',
    conflicts: [
      { extension: 'bewlycat', feature: '首页重构' },
      { extension: 'avemujica', feature: '首页重构' }
    ],
    any({ addStyle }) {
      addStyle(css`
        .feed2 .feed-card:has(a[href*="cm.bilibili.com"]),
        .feed2 .feed-card:has(.bili-video-card:empty) {
          width: 1px !important;
          height: 1px !important;
          opacity: 0 !important;
          pointer-events: none !important;
          position: absolute !important;
          padding: 0 !important;
          margin: -1px !important;
          overflow: hidden !important;
          clip: rect(0, 0, 0, 0) !important;
          white-space: nowrap !important;
          border-width: 0 !important;
        }

        .feed2 .container > * {
          margin-top: 0 !important
        }
      `);
    }
  };
}
