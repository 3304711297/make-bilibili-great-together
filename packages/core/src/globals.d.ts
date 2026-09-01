// 环境全局声明：模块逻辑沿用上游对 `unsafeWindow` 全局引用的写法（brief 适配规则 4），
// 由 userscript/扩展包在打包时提供真实绑定；测试中以 vi.stubGlobal('unsafeWindow', ...) 注入。
// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW (src/gm.d.ts)
declare const unsafeWindow: typeof globalThis & Window;

// enhance-live 使用 GM.notification；module-menu（userscript 包）使用 GM storage 与菜单命令。
// core 包不依赖 @types/tampermonkey，此处声明整个 workspace 用到的最小子集
//（userscript 包不装 @types/tampermonkey，沿用本声明，避免重复声明冲突）。
declare const GM: {
  notification(text: string, title?: string): unknown;
  getValue<T = unknown>(key: string): Promise<T | undefined>;
  setValue(key: string, value: unknown): Promise<void>;
  // 同步版 storage API：模块开关必须在 document-start 同步判定（Tampermonkey/ScriptCat/Violentmonkey 均提供）
  GM_getValue(name: string): unknown | undefined;
  GM_setValue(name: string, value: unknown): void;  deleteValue(key: string): Promise<void>;
  listValues(): Promise<string[]>;
  // Violentmonkey 返回 number，Tampermonkey 返回 string
  registerMenuCommand(label: string, fn: () => void | Promise<void>, accessKeyOrOptions?: string | { autoClose?: boolean; caption?: string }): string | number;
  unregisterMenuCommand(id: string): void;
}

// 同步版 storage API 以独立全局形式注入沙箱（@grant GM_getValue / GM_setValue），非 GM 对象的成员
declare function GM_getValue(name: string): unknown | undefined;
declare function GM_setValue(name: string, value: unknown): void;;

// gm-probe-fetch 使用 GM_xmlhttpRequest（meta 已 @grant GM_xmlhttpRequest + @connect bilivideo.com）：
// 本仓库用到的最小子集——Range 头 GET 探测（onload/onerror/ontimeout 三态回调）
declare function GM_xmlhttpRequest(details: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  onload?: (response: unknown) => void;
  onerror?: (response: unknown) => void;
  ontimeout?: () => void;
}): unknown;
