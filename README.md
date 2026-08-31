# Make Bilibili Great Together

接手 [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（MIT © SukkaW）：
B 站反跟踪、反 PCDN/P2P、播放链路增强，**双形态**（userscript + MV3 扩展），与
[BewlyCat](https://github.com/keleus/BewlyCat)、[BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 共存感知。

> 当前状态：核心引擎与 userscript 形态（Plan 1）。共存感知、扩展形态、点睛功能开发中。

## 安装（userscript）

GitHub Releases 直链（发版后可用）或 jsDelivr：`https://cdn.jsdelivr.net/gh/3304711297/make-bilibili-great-together@<tag>/packages/userscript/dist/make-bilibili-great-together.user.js`

> 发版前获取方式：Releases 尚无产物时，请 clone 本仓库后本地构建：`pnpm install && pnpm build`，产物在 `packages/userscript/dist/`。

## 与扩展共存

安装 BewlyCat / AveMujica 时，重复功能模块将自动停用（开发中，见 spec §3）。

## 致谢

- [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before) — 核心模块与引擎架构来源（MIT）
- [keleus/BewlyCat](https://github.com/keleus/BewlyCat) — 共存兼容目标
- [VentusUta/BewlyBewly-AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) — 共存兼容目标
- [BewlyBewly](https://github.com/BewlyBewly/BewlyBewly) — 上游上游
