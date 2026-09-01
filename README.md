# Make Bilibili Great Together

接手 [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（MIT © SukkaW）：
B 站反跟踪、反 PCDN/P2P、播放链路增强，**双形态**（userscript + MV3 扩展），与
[BewlyCat](https://github.com/keleus/BewlyCat)、[BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 共存感知。

> 当前状态：核心引擎、userscript 形态与共存感知（Plan 1+2）。扩展形态、CDN 选优、统计看板、设置面板开发中。

## 安装（userscript）

GitHub Releases 直链（发版后可用）或 jsDelivr：`https://cdn.jsdelivr.net/gh/3304711297/make-bilibili-great-together@<tag>/packages/userscript/dist/make-bilibili-great-together.user.js`

> 发版前获取方式：Releases 尚无产物时，请 clone 本仓库后本地构建：`pnpm install && pnpm build`，产物在 `packages/userscript/dist/`。

## 与扩展共存

安装 [BewlyCat](https://github.com/keleus/BewlyCat) / [BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 后，脚本自动探测并停用与其重复的模块（首页广告、URL 参数清理、字体、播放器适配等），网络层能力（反跟踪、反 PCDN/P2P）不受影响。

- 探测窗口 10 秒；检测到家族但无法区分具体扩展时按保守策略停用并集
- 被停用的模块会写入控制台日志（`[mbgt] [模块名] auto-disabled: ...`）
- 强制开启某模块：设置 `GM存储键 mbgt:override:<模块名>` 为 `force-on`（设置面板在后续版本提供）
- 冲突表中 `optimize-story` 两项为 provisional（待真机实测确认）

## 致谢

- [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before) — 核心模块与引擎架构来源（MIT）
- [keleus/BewlyCat](https://github.com/keleus/BewlyCat) — 共存兼容目标
- [VentusUta/BewlyBewly-AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) — 共存兼容目标
- [BewlyBewly](https://github.com/BewlyBewly/BewlyBewly) — 上游上游
