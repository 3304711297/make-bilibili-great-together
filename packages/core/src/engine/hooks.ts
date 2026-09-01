// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW
import type {
  FetchArgs, XHRDetail, XHROpenArgs,
  OnBeforeFetchHook, OnResponseHook, OnXhrOpenHook, OnAfterXhrOpenHook, OnXhrResponseHook
} from '../types';
import type { Logger } from '../logger';
import { ErrorCounter } from '../utils/error-counter';

export interface HookSets {
  onBeforeFetchHooks: Set<OnBeforeFetchHook>;
  onResponseHooks: Set<OnResponseHook>;
  onXhrOpenHooks: Set<OnXhrOpenHook>;
  onAfterXhrOpenHooks: Set<OnAfterXhrOpenHook>;
  onXhrResponseHooks: Set<OnXhrResponseHook>;
}

export function overrideFetch(
  unsafeWindow: Window & typeof globalThis,
  hooks: Pick<HookSets, 'onBeforeFetchHooks' | 'onResponseHooks'>,
  logger: Logger,
  errorCounter: ErrorCounter
): void {
  (($fetch: typeof fetch) => {
    unsafeWindow.fetch = async function (this: unknown, ...$fetchArgs: FetchArgs) {
      let abortFetch = false;
      let fetchArgs: FetchArgs | { body: unknown } | null = $fetchArgs;
      let mockResponse: Response | null = null;
      for (const onBeforeFetch of hooks.onBeforeFetchHooks) {
        try {
          // 链式传递：每个 hook 收到上一个 hook 的输出（首轮即 $fetchArgs）；
          // 原地变异（上游模块依赖同引用）与返回新数组的替换语义两者均生效
          fetchArgs = onBeforeFetch(fetchArgs as FetchArgs);
          if (fetchArgs === null) { abortFetch = true; break; }
          if ('body' in fetchArgs) { abortFetch = true; mockResponse = fetchArgs as unknown as Response; break; }
        } catch (e) {
          if (errorCounter.shouldReport('before-fetch')) logger.error('Failed to run onBeforeFetch', e);
        }
      }
      if (abortFetch) {
        return (mockResponse as Response) ?? new Response();
      }
      let response = await Reflect.apply($fetch, this, fetchArgs as FetchArgs);
      for (const onResponse of hooks.onResponseHooks) {
        try {
          response = await onResponse(response, $fetchArgs, $fetch);
        } catch (e) {
          if (errorCounter.shouldReport('on-response')) logger.error('Failed to run onResponse', e);
        }
      }
      return response;
    } as typeof fetch;
  })(unsafeWindow.fetch);
}

export function overrideXHR(
  unsafeWindow: Window & typeof globalThis,
  hooks: HookSets,
  logger: Logger,
  errorCounter: ErrorCounter
): void {
  const xhrInstances = new WeakMap<XMLHttpRequest, XHRDetail>();
  const XHRBefore = unsafeWindow.XMLHttpRequest.prototype;

  unsafeWindow.XMLHttpRequest = class extends unsafeWindow.XMLHttpRequest {
    // rest 参数取联合类型以同时兼容 lib.dom 的两个 open 重载（(method, url) 与完整签名）；
    // 实参原样透传，运行时行为与上游一致
    open(...$args: XHROpenArgs | [method: string, url: string | URL]) {
      const xhrDetails: XHRDetail = { method: $args[0] as string, url: $args[1] as string | URL, response: null, lastResponseLength: null };
      let xhrArgs: XHROpenArgs | null = $args as XHROpenArgs;
      for (const onXhrOpen of hooks.onXhrOpenHooks) {
        try {
          if (xhrArgs === null) break;
          xhrArgs = onXhrOpen(xhrArgs, this);
        } catch (e) {
          if (errorCounter.shouldReport('xhr-open')) logger.error('Failed to run onXhrOpen', e);
        }
      }
      if (xhrArgs === null) {
        // R1：仍执行真实 open（不产生网络流量），使 state=OPENED——
        // B 站代码绑定原始 setRequestHeader 引用，仅 noop 实例属性会残留 InvalidStateError 噪音
        super.open(...($args as Parameters<XMLHttpRequest['open']>));
        this.send = () => {};
        this.setRequestHeader = () => {};
        return;
      }
      xhrInstances.set(this, xhrDetails);
      super.open(...(xhrArgs as Parameters<XMLHttpRequest['open']>));
      for (const onAfterXhrOpen of hooks.onAfterXhrOpenHooks) {
        try { onAfterXhrOpen(this); } catch (e) {
          if (errorCounter.shouldReport('after-xhr-open')) logger.error('Failed to run onAfterXhrOpen', e);
        }
      }
    }

    get response(): unknown {
      const originalResponse = super.response;
      if (!xhrInstances.has(this)) return originalResponse;
      const xhrDetails = xhrInstances.get(this)!;
      const responseLength = typeof originalResponse === 'string' ? originalResponse.length : null;
      if (xhrDetails.lastResponseLength !== responseLength) {
        xhrDetails.response = null;
        xhrDetails.lastResponseLength = responseLength;
      }
      if (xhrDetails.response !== null) return xhrDetails.response;
      let finalResponse = originalResponse;
      for (const onXhrResponse of hooks.onXhrResponseHooks) {
        try {
          finalResponse = onXhrResponse(xhrDetails.method, xhrDetails.url, finalResponse, this);
        } catch (e) {
          if (errorCounter.shouldReport('xhr-response')) logger.error('Failed to run onXhrResponse', e);
        }
      }
      xhrDetails.response = finalResponse;
      return finalResponse;
    }

    get responseText(): string {
      const response = this.response;
      return typeof response === 'string' ? response : super.responseText;
    }
  };

  // 反检测：保持原生 toString（上游同款做法）
  unsafeWindow.XMLHttpRequest.prototype.open.toString = () => XHRBefore.open.toString();
  unsafeWindow.XMLHttpRequest.prototype.send.toString = () => XHRBefore.send.toString();
}
