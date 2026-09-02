# 待办池（backlog）

> P2 修复与收尾轮（2026-09-02）归档。原则：本轮顺手优化只进池不实现；任何条目纳入实现前需单独立项。

## 1. ~~AbortController 穿透 `fetchLike` 适配层支持~~（✅ 2026-09-02 已落地）

- **落地**：`ProbeFetch` 增加可选第三参 `AbortSignal`；`runProbe` 每轮建 controller，`destroy()` abort 在途请求；GM 适配层接 `handle.abort()`、扩展适配层并入内部超时 ctrl。destroyed 闸门保留（abort 结算结果照旧丢弃）。回归测试：destroy 触发 AbortSignal。

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
