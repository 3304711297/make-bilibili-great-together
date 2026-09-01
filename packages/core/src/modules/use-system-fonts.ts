// 去除鸿蒙字体，强制使用系统默认字体

// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { tagged as css } from 'foxts/tagged';

// 上游本模块未使用 logger；参数保留以维持统一的工厂签名 function(_logger: Logger): ModuleMeta
export default function useSystemFonts(_logger: Logger): ModuleMeta {
  return {
    name: 'use-system-fonts',
    description: '去除鸿蒙字体，强制使用系统默认字体',
    conflicts: [
      { extension: 'avemujica', feature: 'customizeFont（默认启用自家推荐字体）' }
    ],
    any({ addStyle }) {
      document.querySelectorAll('link[href*="/jinkela/long/font/"]').forEach(x => x.remove());
      addStyle(css`html, body { font-family: system-ui !important; }`);
    }
  };
}
