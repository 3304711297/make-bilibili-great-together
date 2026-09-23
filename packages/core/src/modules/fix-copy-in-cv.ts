// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { defineReadonlyProperty } from '../utils/define-readonly-property';

declare global {
  interface Window {
    original?: {
      reprint: string
    }
  }
}

// 上游本模块未使用 logger；参数保留以维持统一的工厂签名 function(_logger: Logger): ModuleMeta
export default function fixCopyInCV(_logger: Logger): ModuleMeta {
  return {
    name: 'fix-copy-in-cv',
    description: '修复文章复制功能',
    onCV() {
      if ('original' in unsafeWindow) {
        defineReadonlyProperty(unsafeWindow.original, 'reprint', '1');
      }

      // 兼容经典专栏 .article-holder 与新版 opus/article 容器
      const holders = document.querySelectorAll('.article-holder, .opus-module-content, .article-content');
      holders.forEach(holder => {
        holder.classList.remove('unable-reprint');
      });

      // 阻止复制劫持并清理版权后缀
      document.addEventListener('copy', (e) => {
        const selection = unsafeWindow.getSelection()?.toString();
        if (selection && selection.length > 0 && e.clipboardData) {
          e.clipboardData.setData('text/plain', selection);
          e.stopImmediatePropagation();
        }
      }, { capture: true });
    }
  };
}
