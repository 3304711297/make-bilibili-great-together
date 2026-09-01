/** 顶层框架判定（纯函数，可测）：B 站同源隐藏 iframe（correspond）也命中 @match，
 * 非顶层框架在 entry 里只跑核心同步派发，跳过一切共享存储/菜单/UI/探测——
 * iframe 的 compat 结算会覆盖主页面写入的 COMPAT_STATUS_KEY（真机冒烟实证）。 */
export function isTopFrame(win: { top: unknown }): boolean {
  try {
    return win.top === win;
  } catch {
    // 跨源 top 访问抛错（部分隔离环境）：保守按非顶层处理
    return false;
  }
}
