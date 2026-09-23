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
      try {
        document.querySelectorAll('link[href*="/jinkela/long/font/"]').forEach(x => {
          // 仅过滤 HarmonyOS/字重等 WebFont，避免误删图标与特殊符号字体
          if (x.getAttribute('href')?.includes('HarmonyOS') || x.getAttribute('href')?.includes('font')) {
            x.remove();
          }
        });
      } catch { /* 忽略 DOM 阶段读取异常 */ }
      addStyle(css`html, body, #app { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }`);
    }
  };
}
