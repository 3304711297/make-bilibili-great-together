// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import { noop, trueFn } from 'foxts/noop';
import { getUrlFromRequest } from '../utils/get-url-from-request';
import { createMockClass } from '../utils/mock-class';
import { defineReadonlyProperty } from '../utils/define-readonly-property';
import type { ModuleMeta } from '../types';
import type { Logger } from '../logger';
import { createRetrieKeywordFilter } from 'foxts/retrie';

const shouldDefuseUrl = createRetrieKeywordFilter([
  'data.bilibili.com',
  'cm.bilibili.com',
  'api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi'
]);

export default function defuseSpyware(logger: Logger): ModuleMeta {
  return {
    name: 'defuse-spyware',
    description: '禁用叔叔日志上报和用户跟踪的无限请求风暴',
    any({ onBeforeFetch, onXhrOpen }) {
      defineReadonlyProperty(unsafeWindow.navigator, 'sendBeacon', trueFn);

      const SentryHub = createMockClass('SentryHub');

      const fakeSentry = {
        SDK_NAME: 'sentry.javascript.browser',
        SDK_VERSION: '0.0.1145141919810',
        BrowserClient: createMockClass('Sentry.BrowserClient'),
        Hub: SentryHub,
        Integrations: {
          Vue: createMockClass('Sentry.Integrations.Vue'),
          GlobalHandlers: createMockClass('Sentry.Integrations.GlobalHandlers'),
          InboundFilters: createMockClass('Sentry.Integrations.InboundFilters')
        },
        init: noop,
        configureScope: noop,
        getCurrentHub: () => new SentryHub(),
        setContext: noop,
        setExtra: noop,
        setExtras: noop,
        setTag: noop,
        setTags: noop,
        setUser: noop,
        wrap: noop
      };

      defineReadonlyProperty(unsafeWindow, 'Sentry', fakeSentry);
      defineReadonlyProperty(unsafeWindow, 'MReporter', createMockClass('MReporter'));
      defineReadonlyProperty(unsafeWindow, 'ReporterPb', createMockClass('ReporterPb'));
      defineReadonlyProperty(unsafeWindow, '__biliUserFp__', {
        init: noop,
        queryUserLog() {
          return [];
        }
      });
      defineReadonlyProperty(unsafeWindow, '__USER_FP_CONFIG__', undefined);
      defineReadonlyProperty(unsafeWindow, '__MIRROR_CONFIG__', undefined);

      onBeforeFetch((fetchArgs) => {
        const url = getUrlFromRequest(fetchArgs[0]);

        if (typeof url === 'string' && shouldDefuseUrl(url)) {
          return new Response();
        };

        return fetchArgs;
      });

      onXhrOpen((args) => {
        let url = args[1];
        if (typeof url !== 'string') {
          url = url.href;
        }

        if (shouldDefuseUrl(url)) {
          return null;
        }

        return args;
      });
    }
  };
}
