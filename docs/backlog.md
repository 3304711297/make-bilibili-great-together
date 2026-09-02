# 待办池（backlog）

> P2 修复与收尾轮（2026-09-02）归档。原则：本轮顺手优化只进池不实现；任何条目纳入实现前需单独立项。

## 1. AbortController 穿透 `fetchLike` 适配层支持

- **背景**：CDN probe destroy 语义裁定（plan5 设计文档 §7）明确本轮不引入 AbortController。`fetchLike` 为自定义签名 `(url, timeoutMs) => Promise<{ok, ms}>`，穿透 abort 需要同时修改 userscript（GM_xmlhttpRequest）与扩展（isolated fetch）两侧适配层签名。
- **收益**：销毁时在途探测可真正取消，而非自然完成后在闸门处丢弃结果。
- **范围**：`packages/core/src/features/cdn-probe/probe.ts`（签名）、`packages/userscript/src/gm-probe-fetch.ts`、`packages/extension/src/probe-fetch.ts`。

## 2. userscript 侧核心纯函数测试覆盖评估

- **现状**：core 已有较完整测试（117 条）；userscript 入口层覆盖度待评估。
- **评估对象**（核心纯函数优先）：
  - 拦截点（engine hooks / 拦截适配）
  - CDN 选优（cdnUtil 收集、候选副本化、selectMirrorUrl）
  - 归零口径（统计 flush 单飞语义在入口层的透传）
- **产出要求**：先评估后补测，评估结论回填本条目。

## 3. T7 双形态同装运行时提示（extension 标记注入 + userscript 检测）

- **背景**：T7 因 extension 侧不存在任何现成全局标记（`window.__mbgt_extension_active__` 等）按任务书裁定跳过，禁止为完成 T7 临时修改 extension。
- **下一轮单独立项**：extension 标记注入 + userscript 入口早期检测；检测到双形态同装时 `console.warn` 提示二选一，只警告、不自动停用/卸载，不引入冲突解决策略。

## 4. 其他顺手优化想法（本轮执行过程产生，均未实现）

- `runProbe` 闸门命中时可补一条 `logger.debug`（"探测结果因销毁被丢弃"），便于真机排查双形态/销毁时序问题；需权衡日志噪音。
- `CdnProbeStatus` 落盘体积包含完整 `results` 数组，长期可考虑截断或仅存最优项，待面板数据出现增长压力再议。
