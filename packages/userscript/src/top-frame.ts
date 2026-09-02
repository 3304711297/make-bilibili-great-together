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

/** T7 双形态同装检测（纯函数，可测）：extension 主世界入口置位的全局标记。
 * 只警告不自动停用（T7 裁定：禁止自动停用/卸载/冲突解决策略）。 */
export function hasExtensionMarker(win: Record<string, unknown>): boolean {
  return win.__mbgt_extension_active__ === true;
}
