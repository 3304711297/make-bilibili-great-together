// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { tagged as css } from 'foxts/tagged';

// 上游本模块未使用 logger；参数保留以维持统一的工厂签名 function(_logger: Logger): ModuleMeta
export default function removeBlackBackdropFilter(_logger: Logger): ModuleMeta {
  return {
    name: 'remove-black-backdrop-filter',
    description: '去除叔叔去世时的全站黑白效果',
    any({ addStyle }) {
      addStyle(css`html, body { -webkit-filter: none !important; filter: none !important; }`);
    }
  };
}
