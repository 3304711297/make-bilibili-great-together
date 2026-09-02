// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { tagged as css } from 'foxts/tagged';
import { onLoaded } from '../utils/on-load-event';

// 上游本模块未使用 logger；参数保留以维持统一的工厂签名 function(_logger: Logger): ModuleMeta
export default function optimizeStory(_logger: Logger): ModuleMeta {
  return {
    name: 'optimize-story',
    description: '动态页面优化',
    // 冲突经真机实测确认（2026-09-02，Issue #1）：BewlyCat/AveMujica 均在动态页注入
    // momentsPage/bewly-design 类并移除原生组件，与本模块宽屏改造重叠
    conflicts: [
      { extension: 'bewlycat', feature: '动态页改造（真机已确认，Issue #1）' },
      { extension: 'avemujica', feature: '动态页改造（真机已确认，Issue #1）' }
    ],
    onStory({ addStyle }) {
      addStyle(css`
        html[wide] #app { display: flex; }
        html[wide] .bili-dyn-home--member { box-sizing: border-box;padding: 0 10px;width: 100%;flex: 1; }
        html[wide] .bili-dyn-content { width: initial; }
        html[wide] main { margin: 0 8px;flex: 1;overflow: hidden;width: initial; }
        #wide-mode-switch { margin-left: 0;margin-right: 20px; }
        .bili-dyn-list__item:has(.bili-dyn-card-goods), .bili-dyn-list__item:has(.bili-rich-text-module.goods) { display: none !important }
      `);
      if (!localStorage.WIDE_OPT_OUT) {
        document.documentElement.setAttribute('wide', 'wide');
      }

      onLoaded(() => {
        const tabContainer = document.querySelector('.bili-dyn-list-tabs__list');
        const placeholder = document.createElement('div');
        placeholder.style.flex = '1';
        const switchButton = document.createElement('a');
        switchButton.id = 'wide-mode-switch';
        switchButton.className = 'bili-dyn-list-tabs__item';
        switchButton.textContent = '宽屏模式';
        switchButton.addEventListener('click', (e) => {
          e.preventDefault();
          if (localStorage.WIDE_OPT_OUT) {
            localStorage.removeItem('WIDE_OPT_OUT');
            document.documentElement.setAttribute('wide', 'wide');
          } else {
            localStorage.setItem('WIDE_OPT_OUT', '1');
            document.documentElement.removeAttribute('wide');
          }
        });
        tabContainer?.appendChild(placeholder);
        tabContainer?.appendChild(switchButton);
      });
    }
  };
}
