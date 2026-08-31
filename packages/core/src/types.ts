export type FetchArgs = Parameters<typeof fetch>;

export interface XHRDetail {
  method: string;
  url: string | URL;
  response: unknown;
  lastResponseLength: number | null;
}

export type XHROpenArgs = Parameters<XMLHttpRequest['open']>;
export type XHRDetailGetter = (xhr: XMLHttpRequest) => XHRDetail | undefined;

export type OnBeforeFetchHook = (fetchArgs: FetchArgs) => FetchArgs | { body: unknown } | null;
export type OnResponseHook = (response: Response, finalFetchArgs: FetchArgs, $fetch: typeof fetch) => Response | Promise<Response>;
export type OnXhrOpenHook = (args: XHROpenArgs, xhr: XMLHttpRequest) => XHROpenArgs | null;
export type OnAfterXhrOpenHook = (xhr: XMLHttpRequest) => void;
export type OnXhrResponseHook = (method: string, url: string | URL, response: unknown, xhr: XMLHttpRequest) => unknown;

export interface CompatConflict {
  extension: 'bewlycat' | 'avemujica';
  feature: string;
}

export interface MakeBilibiliGreatTogetherHook {
  addStyle(style: string): void;
  onBeforeFetch(cb: OnBeforeFetchHook): void;
  onResponse(cb: OnResponseHook): void;
  onXhrOpen(cb: OnXhrOpenHook): void;
  onAfterXhrOpen(cb: OnAfterXhrOpenHook): void;
  onXhrResponse(cb: OnXhrResponseHook): void;
  onlyCallOnce(fn: () => void): void;
}

export interface ModuleMeta {
  name: string;
  description: string;
  conflicts?: CompatConflict[]; // Plan 2 起生效
  any?(hook: MakeBilibiliGreatTogetherHook): void;
  onVideo?(hook: MakeBilibiliGreatTogetherHook): void;
  onBangumi?(hook: MakeBilibiliGreatTogetherHook): void;
  onVideoOrBangumi?(hook: MakeBilibiliGreatTogetherHook): void;
  onLive?(hook: MakeBilibiliGreatTogetherHook): void;
  onStory?(hook: MakeBilibiliGreatTogetherHook): void;
  onCV?(hook: MakeBilibiliGreatTogetherHook): void;
}
