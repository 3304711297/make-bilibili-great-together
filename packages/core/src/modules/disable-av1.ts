// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { recordInterception } from '../features/stats/registry';

export default function disableAV1(logger: Logger): ModuleMeta {
  // only call once, since fucking Bilibili now storming us with AV1 check
  const logAv1Disabled = {
    MediaSource_isTypeSupported(this: void) {
      logger.info('AV1 disabled!', { meta: 'MediaSource.isTypeSupported' });
    },
    HTMLVideoElement_canPlayType(this: void) {
      logger.info('AV1 disabled!', { meta: 'HTMLVideoElement.prototype.canPlayType' });
    }
  };

  return {
    name: 'disable-av1',
    description: '防止叔叔用 AV1 格式燃烧你的 CPU 并省下棺材钱',
    any({ onlyCallOnce }) {
      ((origCanPlayType) => {
        // 上游 lint 指令（本仓库未启用该规则）：sukka/class-prototype -- override native method
        HTMLMediaElement.prototype.canPlayType = function (type) {
          if (type.includes('av01')) {
            onlyCallOnce(logAv1Disabled.HTMLVideoElement_canPlayType);
            recordInterception('av1-blocked');
            return '';
          };
          return origCanPlayType.call(this, type);
        };
        // eslint-disable-next-line @typescript-eslint/unbound-method -- override native method
      })(HTMLMediaElement.prototype.canPlayType);
      ((origIsTypeSupported) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- can be nullable
        if (origIsTypeSupported == null) return false;

        unsafeWindow.MediaSource.isTypeSupported = function (type) {
          if (type.includes('av01')) {
            onlyCallOnce(logAv1Disabled.MediaSource_isTypeSupported);
            recordInterception('av1-blocked');
            return false;
          }
          return origIsTypeSupported.call(this, type);
        };
        // eslint-disable-next-line @typescript-eslint/unbound-method -- override native method
      })(unsafeWindow.MediaSource.isTypeSupported);
    }
  };
}
