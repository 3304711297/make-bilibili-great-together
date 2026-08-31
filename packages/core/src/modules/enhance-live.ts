// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { ErrorCounter } from '../utils/error-counter';
import { getUrlFromRequest } from '../utils/get-url-from-request';
import { tagged as css } from 'foxts/tagged';
import flru from 'flru';
import { createRetrieKeywordFilter } from 'foxts/retrie';

declare global {
  interface Window {
    disableMcdn?: boolean
  }
}

// const mcdnRegexp = /[\dxy]+\.mcdn\.bilivideo\.cn:\d+/;
const qualityRegexp = /(live-bvc\/\d+\/live_\d+_\d+)_\w+/;
const hevcRegexp = /(\d+)_(?:mini|pro)hevc/g;

const smtcdnsRegexp = /[\w.]+\.smtcdns.net\/([\w-]+\.bilivideo.com\/)/;

const liveCdnUrlKwFilter = createRetrieKeywordFilter([
  '.bilivideo.',
  '.m3u8',
  '.m4s',
  '.flv'
]);

export default function enhanceLive(logger: Logger): ModuleMeta {
  return {
    name: 'enhance-live',
    description: '增强直播（原画画质、其他修复）',
    onLive({ addStyle, onBeforeFetch, onResponse }) {
      let forceHighestQuality = true;

      const urlMap = flru<string>(300);

      // 还得帮叔叔修 bug，唉
      addStyle(css`div[data-cy=EvaRenderer_LayerWrapper]:has(.player) { z-index: 999999; }`);

      // 干掉些直播间没用的东西
      addStyle(css`#welcome-area-bottom-vm, .web-player-icon-roomStatus { display: none !important; }`);

      // 修复直播画质
      onBeforeFetch((fetchArgs) => {
        if (!forceHighestQuality) {
          return fetchArgs;
        }

        // 上游此处有 try/catch 包裹（旧版 getUrlFromRequest 对非法输入抛异常）；
        // core 的 getUrlFromRequest 对非法输入返回 null，enhance-live 本就按 url == null 分支处理，
        // try/catch 已成死代码，依 Controller 裁定移除
        const url = getUrlFromRequest(fetchArgs[0], logger);
        if (url == null) {
          return fetchArgs;
        }

        let finalUrl = url;
        // if (mcdnRegexp.test(url) && disableMcdn) {
        //   return Promise.reject();
        // }
        if (qualityRegexp.test(url)) {
          finalUrl = url
            .replace(qualityRegexp, '$1')
            .replaceAll(hevcRegexp, '$1');

          logger.info('force quality', url, '->', finalUrl);

          urlMap.set(finalUrl, url);
        }
        if (smtcdnsRegexp.test(finalUrl)) {
          finalUrl = finalUrl.replace(smtcdnsRegexp, '$1');
          logger.info('drop smtcdns', url, '->', finalUrl);
        }

        fetchArgs[0] = finalUrl;
        return fetchArgs;
      });

      const errorCounter = new ErrorCounter(1000 * 30);

      onResponse((resp, fetchArgs, $fetch) => {
        if (liveCdnUrlKwFilter(resp.url) && !resp.ok) {
          logger.error('force quality fail', resp.url, resp.status);
          errorCounter.recordError();

          if (forceHighestQuality && errorCounter.getErrorCount() >= 5) {
            forceHighestQuality = false;
            logger.error('Force quality failed! Falling back');
            GM.notification(
              '[Make Bilibili Great Then Ever Before] 已为您自动切换至播放器上选择的清晰度.',
              '最高清晰度可能不可用'
            );
          }

          // If we have old url, we fetch old quality again
          if (urlMap.has(resp.url)) {
            const oldUrl = urlMap.get(resp.url)!;
            logger.warn('');
            return $fetch(oldUrl, fetchArgs[1]);
          }
        }
        return resp;
      });
    }
  };
}
