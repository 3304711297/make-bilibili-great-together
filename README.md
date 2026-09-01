# Make Bilibili Great Together

接手 [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（MIT © SukkaW）：
B 站反跟踪、反 PCDN/P2P、播放链路增强，**双形态**（userscript + MV3 扩展），与
[BewlyCat](https://github.com/keleus/BewlyCat)、[BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 共存感知。

> 当前状态：v0.2.0 — 核心引擎、userscript/扩展双形态、共存感知、设置与面板、CDN 智能选优、拦截统计均已上线。

## 安装（userscript）

GitHub Releases 直链（发版后可用）或 jsDelivr：`https://cdn.jsdelivr.net/gh/3304711297/make-bilibili-great-together@<tag>/packages/userscript/dist/make-bilibili-great-together.user.js`

> 发版前获取方式：Releases 尚无产物时，请 clone 本仓库后本地构建：`pnpm install && pnpm build`，产物在 `packages/userscript/dist/`。

## 安装（扩展）

Releases 下载 `make-bilibili-great-together-extension.zip` 并**解压**（或本地构建 `pnpm --filter @mbgt/extension build`，产物在 `packages/extension/dist`），然后在浏览器扩展页开启开发人员模式，用"加载解压缩的扩展"按钮选择解压后的目录（Chrome 为 `chrome://extensions`，Edge 为 `edge://extensions`；最低要求 Chromium 111）。

> **请勿与 userscript 形态同时启用**：两种形态都会在页面主世界包装 fetch/XHR，同装会产生双重注入与重复日志。二选一即可。

## 设置与面板（v0.2.0）

- **userscript 形态**：页面右下角 `⚙ MBGT` 胶囊打开悬浮面板；油猴菜单的模块开关与面板共用同一配置键（`mbgt:override:*`，三值：默认开 / `off` 关闭 / `force-on` 强制开启）。
- **扩展形态**：工具栏图标 → options 页即面板。即时模块（反跟踪、防 P2P 等无冲突 9 项）在扩展形态**锁定不可关**——这是为保住 document-start 拦截语义的刻意取舍（接线层异步读设置赶不上页面内联脚本）；带冲突的 6 项可三态切换。
- **共存面板**：显示探测到的 BewlyCat/AveMujica 与自动停用原因；`force-on` 可压过自动停用（用户拍板优先）。
- **配置导入/导出**：面板底部生成/导入 JSON；仅覆盖配置类键（override / CDN 开关 / 角标开关），运行数据不进导出文件。
- 面板打开期间每 2 秒自动刷新数据，关闭即停止（零开销）；读取失败保留上次数据。

## CDN 智能选优

playinfo 中出现镜像候选时自动探测（每候选小体积 range 请求、2s 超时淘汰），按延迟固定最优宿主；结果缓存 5 分钟；全部候选失败自动回退上游的随机镜像策略。userscript 走 `GM_xmlhttpRequest`（已声明 `@connect bilivideo.com`），扩展走 isolated 世界直连（已申请 `*://*.bilivideo.com/*`）。无有效 SSL 证书的 `upos-sz-mirror14b` 始终排除。扩展形态下首次页面加载的镜像解析也会补探一次（`pendingProbe` 回放机制）；探测结果缓存 5 分钟、过期后 30 秒自动重探（页面存活期间保持新鲜）；镜像构造恒为 HTTPS，不受页面协议影响；单候选也会探测并展示延迟。

## 拦截统计

各拦截点按类计数（sendBeacon 假实现、上报 fetch/XHR 拦截、localStorage 挡写、P2P 替换、WebRTC mock、AV1 拦截），扩展形态另有 DNR 网络层命中统计（后台 service worker 汇总）。计数 30 秒节流落盘、跨会话累加；右下角角标默认关闭，面板中开启。统计收集始终运行、开销极低；展示环节任何故障不影响拦截。统计落盘为「归零口径」——已落盘部分从会话计数中扣除，角标与面板采用相同合计口径，DNR 命中每 30 秒同步进角标（最终一致）；落盘失败自动重试不丢增量。

## 与扩展共存

安装 [BewlyCat](https://github.com/keleus/BewlyCat) / [BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 后，脚本自动探测并停用与其重复的模块（首页广告、URL 参数清理、字体、播放器适配等），网络层能力（反跟踪、反 PCDN/P2P）不受影响。

- 探测窗口 10 秒；检测到家族但无法区分具体扩展时按保守策略停用并集
- 被停用的模块会写入控制台日志（`[mbgt] [模块名] auto-disabled: ...`）
- 强制开启某模块：设置 `GM存储键 mbgt:override:<模块名>` 为 `force-on`（也可在设置面板操作，见下方「设置与面板」）
- 冲突表中 `optimize-story` 两项为 provisional（待真机实测确认）

## 致谢

- [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before) — 核心模块与引擎架构来源（MIT）
- [keleus/BewlyCat](https://github.com/keleus/BewlyCat) — 共存兼容目标
- [VentusUta/BewlyBewly-AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) — 共存兼容目标
- [BewlyBewly](https://github.com/BewlyBewly/BewlyBewly) — 上游上游
