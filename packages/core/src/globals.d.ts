// 环境全局声明：模块逻辑沿用上游对 `unsafeWindow` 全局引用的写法（brief 适配规则 4），
// 由 userscript/扩展包在打包时提供真实绑定；测试中以 vi.stubGlobal('unsafeWindow', ...) 注入。
// Ported from SukkaW/Make-Bilibili-Great-Than-Ever-Before (MIT) © SukkaW (src/gm.d.ts)
declare const unsafeWindow: typeof globalThis & Window;

// enhance-live 使用 GM.notification；core 包不依赖 @types/tampermonkey，此处声明其用到的最小子集。
declare const GM: {
  notification(text: string, title?: string): unknown;
};
