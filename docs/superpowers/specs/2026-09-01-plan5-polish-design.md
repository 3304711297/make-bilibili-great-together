# Plan 5 设计文档：CDN 选优精确化 / 统计口径统一 / 面板实时刷新

- 日期：2026-09-01
- 状态：已与用户逐节确认（含三条冻结实现约束），待用户复核本文档
- 版本目标：v0.3.0（tag 走既有 release.yml，发版前确认）
- 前置：Plan 4（v0.2.0）已完成；spec 底稿 `2026-08-30-make-bilibili-great-together-design.md` §4/§5

## 0. 冻结实现约束（用户裁定，实现与测试必须钉死）

1. **pendingProbe 只保留最新一次未探测输入**（覆盖语义，不累积队列）；`replayPendingProbe()` 幂等——首次回放后立即清空 pending，重复调用不得重复探测。
2. **flushStats 单飞**：并发/重叠 flush 不得对同一 delta 重复扣除（实现保证或既有实现+测试钉死皆可）。
3. **badge 与 panel 采用相同合计口径**；DNR 基线实时性定义为 **30s 周期同步（最终一致）**，不承诺任何时刻严格一致——面板文案与代码注释均按此表述。

## 1. CDN 选优精确化

### 1.1 A 首载不漏（扩展形态首跳探测不漏）

- 问题：扩展形态设置回填（异步）晚于内联 playinfo 解析 → `hooksRef.current.probe` 缺失 → 首次 parse 的 ensureProbe 未触发。
- 机制：
  - `createCDNUtil` 在 parse 末尾：probe 在场 → 原样 ensureProbe；probe 缺失 → 把该次输入（mirror hosts 数组 + 一条样本 URL）**覆盖式**写入 `pendingProbe`（只保留最新，不累积）。
  - `noP2P` 工厂把自己的 `cdnUtil` 实例写进接线层传入的 `hooksRef.current.cdnUtil`（钩子首次运行时挂上）。
  - 接线层设置回填块：创建 probe 后（mutate current，不整体替换以保留 cdnUtil 字段）调用 `cdnUtil.replayPendingProbe()`。
  - `replayPendingProbe()`：probe 在场且 pending 存在 → ensureProbe(pending) → 立即清空 pending → 幂等（重复调用空操作）；userscript 同步装配路径下 pending 恒空，调用无害。
- 面板/README 文案补充：扩展形态的 CDN 开关与首跳探测语义说明随本项更新。

### 1.2 B 缓存过期主动重探

- probe 探测成功后安排重探定时器：**缓存过期时刻 + 30s**（TTL+30s）自动以 `lastInput`（实例内记住的最近一次 ensureProbe 输入）重探。
- 单飞约束：任何时刻只有一个有效重探 timer——新探测成功产生新 lastInput 时**取消旧 timer 并重排**；探测失败（fallback）不安排重探（等待下一次外部 ensureProbe 触发）。
- 生命周期：`destroy()` 显式清理（扩展 main-entry 设置回填可持有；userscript 页面级实例随页面销毁，注册 `pagehide` 兜底清理亦可——实现取最小：提供 destroy 供调用方在需要时清理，pagehide 注册不加，避免新全局监听）。
- 测试覆盖：到期触发一次重探、新探测重置旧 timer、timer 不叠加、destroy 后不再重探。

### 1.3 C http 边界加固

- `selectMirrorUrl` 改为**基于候选 URL 副本**换宿主：候选均为收集期 https 化的 URL，`new URL(pickOne(candidates))` 后 `url.hostname = best.host` → 输出恒 https；不再从 incoming 复制（incoming 的 scheme/port 不参与镜像构造）。
- 测试覆盖：incoming=https 与 incoming=http 两种输入，输出都必须是 `https://<best-host>/upgcxcode/...`（path+query 不变）。

### 1.4 D 单候选也探测（无代码）

- 现状触发条件即 `mirror_urls.size > 0`（不分个数）→ 单候选已探测并展示状态；选源无需换宿主故直返。
- 仅面板 CDN 区文案补一句「单候选也会探测并展示延迟」。

## 2. 统计口径统一（归零语义）

- `flushStats` 重写：
  - 取会话快照 delta（自上次成功落盘以来的全部会话计数）；
  - `merged = stored + delta` 写盘；
  - **写盘成功后**：`session[k] -= delta[k]`（归零但不吃掉落盘间隙的新增计数——await 间隙的 recordInterception 会话值保留，下轮落盘）；
  - 写盘失败：不扣除，增量保留，下轮重试（沿用 Plan 4 T2 裁定）。
- 删除 `flushedBaseline` 机制（无增量时 skip 逻辑改由 delta 判空承担）。
- **单飞约束（冻结 #2）**：flush 重入保护（进行中则直接返回），保证同一 delta 不被并发扣除；测试钉死。
- 无存储且无增量时不再写盘（修正 T2-minor-1 的空 payload 写盘）。
- badge 增补（终审 Minor-1，用户已点头）：mount 时读一次 DNR 统计键并入基线；30s 周期重读持久基线（含 DNR）。
- **口径语义（冻结 #3 的表述）**：badge 与 panel 同口径；DNR 基线为 30s 周期同步 → 最终一致，不承诺任何时刻严格一致。badge 重读基线时必须叠加当前实时会话增量（`badge = 最新持久基线 + 当前会话未归档增量`），不得用纯持久值覆盖（否则吃掉实时计数）。

## 3. 面板实时刷新（打开期轮询）

- PanelApp：挂载后每 **2s** 调一次 `loadPanelData`；**单飞/链式约束**：同一时刻最多一个 loadPanelData 在执行（上一轮完成后再安排下一轮的链式 timer，或进行中跳过本拍）——防止慢读并发乱序导致旧数据覆盖新数据；读失败吞错保持上次数据。
- 关闭（render(null) 卸载）：effect cleanup 清除 timer，**零开销**；测试钉死「关闭后推进 fake timers 不再产生调用」。
- badge：事件实时（onInterception）不变 + **30s 低频重读**持久基线（含 DNR），重读计算按 §2 口径公式；timer cleanup。
- 测试覆盖：2s 刷新生效、关闭后停止、读取失败保留旧数据、慢读不乱序覆盖、badge 重读不吃 session 增量。

## 4. 版本与交付

- 版本 **0.3.0**：三处（version.ts / userscript.meta.json / manifest.json）+ README 增补（首载补探、主动重探、归零统计、面板实时刷新四段小更新）。
- tag `v0.3.0` 走既有 release.yml；**tag 必须指向已含 release.yml 的提交**（v0.2.0 教训入账）；发版前用户确认。
- 测试总集（不新增任务，塞进对应任务的既有测试文件）：
  - T1：落盘成功归零、落盘期间新增保留、重复 flush 不重复扣、flush 单飞、无增量不写盘
  - T2：pendingProbe 回放、回放幂等、多次 playinfo 只处理最新 pending、incoming http/https 输出恒 https
  - T3：到期重探、新 probe 重置旧 timer、timer 不叠加、cleanup 后不再重探
  - T4：面板 2s 刷新、关闭后停止、读失败保留旧数据、不乱序覆盖、badge 重读不吃 session

## 5. 任务划分（4 任务，SDD 流程同 Plan 4）

| 任务 | 内容 |
|---|---|
| T1 | 统计数据层：registry 归零语义 + flush 单飞 + badge 数据逻辑（DNR 基线读取/合并、合计公式、30s 重读所需的数据计算语义——mount 与重读共用同一入口） |
| T2 | cdnUtil pendingProbe + replayPendingProbe + selectMirrorUrl 候选副本化 + hooksRef.cdnUtil + 接线层回填 |
| T3 | probe 主动重探（TTL+30s 单飞 timer + lastInput + destroy） |
| T4 | UI/生命周期接线：面板 2s 链式轮询 + badge 30s timer/cleanup（接入 T1 数据逻辑）+ 版本 0.3.0 + README + 冒烟 + tag |

## 6. 降级原则（不变）

统计/面板/探测任何一环异常只吞错+日志，不影响核心拦截；面板读失败保留旧数据；探测失败回退随机镜像。

## 7. destroy 语义裁定（P2 收尾补记，2026-09-02）

CDN probe 生命周期 race（destroy 时在途探测）已由 `destroyed` 标志闸门修复（probe.ts：声明 + `ensureProbe`/`runProbe`/`destroy` 三处闸门），两条回归测试钉死在 `packages/core/tests/cdn-probe.test.ts`「destroy 生命周期 race」分组。裁定如下：

1. **`destroy()` 后 `getBestHost()` 维持现状**：仍可能返回销毁前已写入的旧 cache（cache 写入在闸门之后，销毁前完成的探测结果不被回滚）。不做销毁即清 cache 的额外清理。
2. **销毁路径不引入 AbortController**：`fetchLike` 为自定义签名（`(url, timeoutMs) => Promise<{ok, ms}>`），穿透 abort 需要修改 userscript（GM_xmlhttpRequest）与扩展（isolated fetch）两侧适配层，超出本轮最小修复边界，归入待办池（docs/backlog.md）。销毁时在途 fetch 自然完成，其结果在 `runProbe` 的 `destroyed` 闸门处整体丢弃（不写 cache、不写 status、不落盘、不安排重探）。
