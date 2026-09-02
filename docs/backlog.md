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

## 4. ~~其他顺手优化想法~~（2026-09-02 评估后关闭，均不实现）

- **闸门 debug 日志**：关闭。`logger.debug`/`trace` 本身就是 noop（刻意静音防控制台噪音），写了也不输出；且 AbortController 落地后 destroy 会显式取消在途请求，丢弃路径已不再难排查。
- **`CdnProbeStatus` 落盘截断**：关闭。`results` 数组上限=单轮候选数（收集阶段已过滤，通常 1~3 条、每条数十字节），payload 可忽略；面板压力场景不存在，加截断是无收益复杂度。
