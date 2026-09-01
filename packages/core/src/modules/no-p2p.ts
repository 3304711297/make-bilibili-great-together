// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import { noop } from 'foxts/noop';
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { defineReadonlyProperty } from '../utils/define-readonly-property';
import { createCDNUtil } from '../utils/get-cdn-url';
import { never } from 'foxts/guard';
import { createRetrieKeywordFilter } from 'foxts/retrie';
import { onDOMContentLoaded } from '../utils/on-load-event';
import { recordInterception } from '../features/stats/registry';

const knownNonVideoPattern = createRetrieKeywordFilter([
  'bilibili.com',
  'hdslb.com',
  'bvc.bilivideo.com',
  'bvc-drm.bilivideo.com'
]);
function isKnownNonVideoUrl(url: string | URL): boolean {
  const urlStr = url.toString();
  if (knownNonVideoPattern(urlStr)) {
    return true;
  }
  if (typeof url === 'string') {
    return url.startsWith('data:') || url.startsWith('blob:');
  }
  return url.protocol === 'data:' || url.protocol === 'blob:';
}

declare global {
  interface Window {
    __playinfo__?: unknown
  }
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export default function noP2P(logger: Logger): ModuleMeta {
  // 上游为 utils/get-cdn-url 中的模块级懒加载单例 getCDNUtil()；core 内 logger 需注入，
  // 故改为工厂作用域内持有一个 createCDNUtil(logger) 实例（每次 getDefaultModules 调用各创建一次）
  const cdnUtil = createCDNUtil(logger);

  // 统计埋点：只在 URL 实际被改写时计数（包装不改变替换语义与错误路径）
  const replaceCdnUrl = (url: string | URL, meta: string): string => {
    const out = cdnUtil.getReplacementCdnUrl(url, meta);
    try {
      if (out !== (typeof url === 'string' ? url : url.href)) recordInterception('p2p-replaced');
    } catch { /* 统计不影响替换 */ }
    return out;
  };

  return {
    name: 'no-p2p',
    description: '防止叔叔用 P2P CDN 省下纸钱',
    any({ onXhrOpen, onBeforeFetch, onXhrResponse }) {
      class MockPCDNLoader { }

      class MockBPP2PSDK {
        on = noop;
      }

      class MockSeederSDK { }

      defineReadonlyProperty(unsafeWindow, 'PCDNLoader', MockPCDNLoader);
      defineReadonlyProperty(unsafeWindow, 'BPP2PSDK', MockBPP2PSDK);
      defineReadonlyProperty(unsafeWindow, 'SeederSDK', MockSeederSDK);

      if (isObject(unsafeWindow.__playinfo__)) {
        cdnUtil.saveAndParsePlayerInfo(unsafeWindow.__playinfo__, 'unsafeWindow.__playinfo__');
      } else {
        logger.warn('No unsafeWindow.__playinfo__ found, waiting for a microtask and check again.', { json: unsafeWindow.__playinfo__ });

        Promise.resolve().finally(() => {
          if (isObject(unsafeWindow.__playinfo__)) {
            cdnUtil.saveAndParsePlayerInfo(unsafeWindow.__playinfo__, 'unsafeWindow.__playinfo__ (microtask)');
          } else {
            logger.warn('No unsafeWindow.__playinfo__ found in microtask either, waiting for DOMContentLoaded and check again.', { json: unsafeWindow.__playinfo__ });
            onDOMContentLoaded(() => {
              if (isObject(unsafeWindow.__playinfo__)) {
                cdnUtil.saveAndParsePlayerInfo(unsafeWindow.__playinfo__, 'unsafeWindow.__playinfo__ (DOMContentLoaded)');
              }
            });
          }
        });
      }

      onXhrResponse((_method, url, response, _xhr) => {
        if (typeof response === 'string' && url.toString().includes('api.bilibili.com/x/player/wbi/playurl')) {
          try {
            cdnUtil.saveAndParsePlayerInfo(JSON.parse(response), 'playurl XHR API');
          } catch (e) {
            logger.error('Failed to parse playinfo XHR API JSON', e, { response });
          }
        }

        return response;
      });

      // Patch new Native Player
      (function (HTMLMediaElementPrototypeSrcDescriptor) {
        Object.defineProperty(unsafeWindow.HTMLMediaElement.prototype, 'src', {
          ...HTMLMediaElementPrototypeSrcDescriptor,
          set(value: string) {
            if (typeof value !== 'string') {
              // 上游 lint 指令（本仓库未启用该规则）：sukka/unicorn/no-useless-coercion -- fuck typescript-eslint about never
              value = String(value);
            }

            if (!value.startsWith('blob:') && !value.startsWith('data:')) {
              // we don't care about blob urls
              // they will use another way to fetch the real url and turn it into blob url anyway
              // we can intercept that fetch/XHR instead
              try {
                value = replaceCdnUrl(value, 'HTMLMediaElement.prototype.src');
              } catch (e) {
                logger.error('Failed to handle HTMLMediaElement.prototype.src setter', e, { value });
              }
            }

            HTMLMediaElementPrototypeSrcDescriptor?.set?.call(this, value);
          }
        });
      })(Object.getOwnPropertyDescriptor(unsafeWindow.HTMLMediaElement.prototype, 'src'));

      onXhrOpen((xhrOpenArgs) => {
        const xhrUrl = xhrOpenArgs[1];
        if (isKnownNonVideoUrl(xhrUrl)) {
          return xhrOpenArgs;
        }

        try {
          xhrOpenArgs[1] = replaceCdnUrl(xhrUrl, 'XMLHttpRequest.prototype.open');
        } catch (e) {
          logger.error('Failed to replace P2P for XMLHttpRequest.prototype.open', e, { xhrUrl });
        }

        return xhrOpenArgs;
      });

      onBeforeFetch((fetchArgs: [RequestInfo | URL, RequestInit?]) => {
        let input = fetchArgs[0];
        if (typeof input === 'string' || 'href' in input) { // string | URL
          if (!isKnownNonVideoUrl(input)) {
            input = replaceCdnUrl(input, 'fetch');
            fetchArgs[0] = input;
          }
        } else if ('url' in input) { // Request
          if (!isKnownNonVideoUrl(input.url)) {
            input = new Request(replaceCdnUrl(input.url, 'fetch'), input);
            fetchArgs[0] = input;
          }
        } else {
          never(input, 'fetchArgs[0]');
        }

        return fetchArgs;
      });
    }
  };
}
