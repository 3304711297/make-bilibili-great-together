# 待办池（backlog）

> P2 修复与收尾轮（2026-09-02）归档。原则：本轮顺手优化只进池不实现；任何条目纳入实现前需单独立项。

## 1. ~~AbortController 穿透 `fetchLike` 适配层支持~~（✅ 2026-09-02 已落地）

- **落地**：`ProbeFetch` 增加可选第三参 `AbortSignal`；`runProbe` 每轮建 controller，`destroy()` abort 在途请求；GM 适配层接 `handle.abort()`、扩展适配层并入内部超时 ctrl。destroyed 闸门保留（abort 结算结果照旧丢弃）。回归测试：destroy 触发 AbortSignal。

## 2. ~~userscript 侧核心纯函数测试覆盖评估~~（✅ 2026-09-02 评估完成并补测）

- **评估结论**：三个目标领域的实现与测试均在 core（拦截点=engine hooks 伪 XHR/fetch 环境测试；CDN 选优=cdnUtil/probe 121 项；归零口径=flushStats 单飞语义测试），userscript 入口层只是薄接线（133 行），无可下移的核心逻辑。
- **已补测**（`packages/userscript/tests/userscript-layer.test.ts`，5 项）：`getModuleEnabledSync` 同步三值语义（缺省 on / off / force-on）与 `createGMKVStore` GM 异步 API→KVStore 适配（往返/getAll）。`isTopFrame` 此前已有 3 项。
- **不补测项（裁定）**：`gm-adapter`/`gm-probe-fetch`（依赖 GM_* 全局与网络，属环境接线，由真机冒烟覆盖）；entry.ts 装配流程（集成性质，用户脚本真机冒烟覆盖）。

## 3. ~~T7 双形态同装运行时提示~~（✅ 2026-09-02 已落地）

- **落地**：extension 主世界入口（main-entry.ts）最前置 `globalThis.__mbgt_extension_active__ = true`；userscript 入口早期经 `hasExtensionMarker`（纯函数，3 项测试）检测，命中则 `console.warn('检测到扩展版同时运行，建议二选一以免重复注入')`。遵守 T7 裁定：只警告、不自动停用/卸载、不引入冲突解决策略。

## 4. 其他顺手优化想法（本轮执行过程产生，均未实现）

- `runProbe` 闸门命中时可补一条 `logger.debug`（"探测结果因销毁被丢弃"），便于真机排查双形态/销毁时序问题；需权衡日志噪音。
- `CdnProbeStatus` 落盘体积包含完整 `results` 数组，长期可考虑截断或仅存最优项，待面板数据出现增长压力再议。
