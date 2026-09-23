// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';

const uselessUrlParams = [
  'buvid',
  'launch_id',
  'session_id',
  'vd_source',
  'trackid',
  'from_source',
  'from_spmid',
  'bili_seed',
  /^share/,
  /^spm/
];

export default function removeUselessUrlParams(logger: Logger): ModuleMeta {
  return {
    name: 'remove-useless-url-params',
    description: '清理 URL 中的无用参数',
    conflicts: [
      { extension: 'bewlycat', feature: 'cleanUrlArgument' },
      { extension: 'avemujica', feature: 'cleanUrlArgument' }
    ],
    any() {
      unsafeWindow.history.replaceState(undefined, '', removeTracking(unsafeWindow.location.href));

      const pushState = unsafeWindow.history.pushState;
      unsafeWindow.history.pushState = function (state, unused, url) {
        return Reflect.apply(pushState, this, [state, unused, removeTracking(url)]);
      };

      const replaceState = unsafeWindow.history.replaceState;
      unsafeWindow.history.replaceState = function (state, unused, url) {
        return Reflect.apply(replaceState, this, [state, unused, removeTracking(url)]);
      };
    }
  };

  function removeTracking(url: string | URL | null | undefined) {
    if (!url) return url;
    try {
      if (typeof url === 'string') url = new URL(url, unsafeWindow.location.href);
      if (!url.search) return url;

      const keys = Array.from(url.searchParams.keys());
      for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        for (let j = 0, len = uselessUrlParams.length; j < len; j++) {
          const item = uselessUrlParams[j];
          if (typeof item === 'string') {
            if (item === key) url.searchParams.delete(key);
          } else if ('test' in item && item.test(key)) {
            url.searchParams.delete(key);
          };
        };
      }
      return url.href;
    } catch (e) {
      logger.error('Failed to remove useless urlParams', e);
      return url;
    }
  }
}
