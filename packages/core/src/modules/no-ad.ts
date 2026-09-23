// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { tagged as css } from 'foxts/tagged';

export default function noAd(_logger: Logger): ModuleMeta {
  return {
    name: 'no-ad',
    description: '防止叔叔通过广告给自己赚棺材钱',
    conflicts: [
      { extension: 'bewlycat', feature: 'blockAds / 首页重构' },
      { extension: 'avemujica', feature: 'blockAds / 首页重构' }
    ],
    any({ addStyle }) {
      // 现代 CSS 广告与打点元素隐藏（微小尺寸防检测）
      addStyle(css`
        .adblock-tips,
        .feed-card:has(.bili-video-card>div:empty),
        a[href*="cm.bilibili.com"],
        .desktop-download-tip,
        .ad-report {
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
      `);
    }
  };
}
