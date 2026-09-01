# make-bilibili-great-together 设计文档

- 日期：2026-08-30
- 状态：已与用户逐节确认
- 上游：[SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（MIT，v1.8.4）
- 协作目标：[keleus/BewlyCat](https://github.com/keleus/BewlyCat)（主兼容）、[VentusUta/BewlyBewly-AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica)（次兼容）

## 1. 项目定位

接手 SukkaW《Make Bilibili Great Than Ever Before》的定位：B 站反跟踪、反 PCDN/P2P、播放链路增强的**核心网络层引擎**。区别在于：

1. **双形态**：同一份 core 同时打包为 userscript（ScriptCat/Tampermonkey/Violentmonkey）与 MV3 浏览器扩展。
2. **共存感知**：检测 BewlyCat / AveMujica，自动停用与它们重复的模块，主兼容 BewlyCat、次兼容 AveMujica。
3. **三个点睛功能**（三个上游项目都没有）：CDN 智能选优、拦截统计看板、设置+共存面板。

**不做的事（YAGNI）**：不做 UI 重设计/暗色模式/首页改造（BewlyCat/AveMujica 的领域）；不移植扩展的播放器快捷键、倍速记忆等功能；不封装客户端；不上架商店。

## 2. 总体架构

pnpm monorepo，三包共享 `core`：

```
make-bilibili-great-together/
├── packages/
│   ├── core/                # 平台无关：引擎 + 模块 + 点睛功能
│   │   ├── src/engine/      #   fetch/XHR hook、样式注入、模块调度、compat 探测
│   │   ├── src/modules/     #   15 个继承模块（带 compat 元数据）
│   │   ├── src/features/    #   cdn-probe / stats / panel
│   │   └── src/platform/    #   storage 适配层接口
│   ├── userscript/          # rollup → 单文件 .user.js
│   └── extension/           # MV3：manifest + MAIN world 注入器 + options 页 + DNR 规则
├── .github/workflows/       # CI：build + test + lint；tag-only 发版
└── docs/
```

**注入时序**：userscript `@run-at document-start`；扩展用 `chrome.scripting.executeScript`（`world: "MAIN"`, `document_start`）注入同一份 core bundle，保证 hook 抢在 B 站脚本之前。扩展额外加载 declarativeNetRequest 静态规则，在网络层直接挡 `data.bilibili.com` / `cm.bilibili.com` 上报（扩展形态独有的更早拦截）。

**覆盖范围**：与上游一致——`www.bilibili.com`、`t.bilibili.com`、`live.bilibili.com`、`space.bilibili.com`。

## 3. 模块系统与共存感知

### 3.1 模块接口（继承 + 扩展）

沿用上游接口：页面类型钩子 `any / onVideo / onBangumi / onVideoOrBangumi / onLive / onStory / onCV`，hook 集合 `addStyle / onBeforeFetch / onResponse / onXhrOpen / onAfterXhrOpen / onXhrResponse / onlyCallOnce`。

新增 `compat` 元数据：

```ts
interface CompatConflict {
  extension: 'bewlycat' | 'avemujica';
  feature: string;        // 对方对应的功能标识，用于面板展示
}
interface ModuleMeta {
  name: string;
  description: string;
  conflicts?: CompatConflict[];
  // ...原有钩子
}
```

### 3.2 共存探测

- 探测方式：等待并匹配两个扩展注入的 DOM 特征（BewlyCat 的 bewly 容器/顶栏替换节点、AveMujica 同源特征节点），`MutationObserver` + 启动轮询兜底；超时（如 10s）未命中视为未安装。
- 命中冲突 → 对应模块自动禁用，禁用原因（哪个扩展、哪个功能）写入共存面板与统计看板。
- **优先级**：两者同时安装时以 BewlyCat 冲突表为准（功能面更全）。
- **手动覆盖**：面板中可对被自动禁用的模块强制开启，用户拍板优先于探测，状态持久化。

### 3.3 初始冲突表（继承 15 模块）

| 模块 | 与 BewlyCat 冲突 | 与 AveMujica 冲突 |
|---|---|---|
| defuse-storage | 无 | 无 |
| defuse-spyware | 无 | 无 |
| disable-av1 | 无 | 无 |
| enhance-live | 无 | 无 |
| fix-copy-in-cv | 无 | 无 |
| force-enable-4k | 无 | 无 |
| no-ad | 有（blockAds/首页重构） | 有（blockAds/首页重构） |
| no-p2p | 无 | 无 |
| no-webtrc | 无 | 无 |
| optimize-homepage | 有（首页重构） | 有（首页重构） |
| optimize-story | 待实测确认（动态页改造程度） | 待实测确认 |
| player-video-fit | 有（bewlyWidescreen/播放器样式） | 无 |
| remove-black-backdrop-filter | 无 | 无 |
| remove-useless-url-params | 有（cleanUrlArgument） | 有（cleanUrlArgument） |
| use-system-fonts | 无（BewlyCat 默认不强制字体） | 有（默认启用自家推荐字体） |

"待实测确认"项在实现阶段用真机验证后定稿。

> 注：optimize-story 两项为 provisional（2026-09-01 标注），待真机装 BewlyCat/AveMujica 实测动态页改造程度后定稿；定稿后更新 CONFLICT_TABLE 与模块 conflicts 元数据（两处 feature 文案需逐字一致）。

## 4. 点睛功能设计

### 4.1 CDN 智能选优（`features/cdn-probe`）

- 候选名单与上游 `get-cdn-url` 保持同步（常规镜像；**排除**无有效 SSL 证书的 `upos-sz-mirror14b`）。
- playinfo 中出现候选镜像时发起探测：对每个候选请求小体积 range 段，超时 2s，失败淘汰；按延迟取最优，结果缓存 5 分钟。
- 全部候选失败 → 回退上游的随机挑选策略。
- 网络通道：userscript 用 `GM_xmlhttpRequest`（新增 `@connect bilivideo.com`）绕 CORS；扩展凭 `host_permissions` 直接 fetch。
- 探测仅对 playinfo 替换路径生效，不影响其他模块。

### 4.2 拦截统计看板（`features/stats`）

- 归因计数：每个拦截点（fetch 拦截 / XHR 拦截 / 扩展 DNR 命中）按模块计数。
- 落盘节流：内存累积，每 30s 或页面卸载时写一次 storage，避免高频写。
- 展示：页面右下角可收起角标（点击展开面板），**默认关闭**，设置里开启。DNR 计数通过 background 汇总后由 content 侧读取。

### 4.3 设置 + 共存面板（`features/panel`）

- 页面内悬浮面板，双形态共用同一套组件；扩展形态挂为 options 页。
- 内容：模块开关列表（含自动禁用原因、强制开启）、CDN 选优开关与最近探测结果、统计看板入口、配置导入/导出（JSON）。
- 技术选型：**Preact**（约 4KB gzip），打包进 core 的可选 chunk。

## 5. 存储与错误处理

- **存储适配层**：core 面向接口 `storage.get/set/onChange`；userscript 实现 GM storage，扩展实现 `browser.storage.local`。键统一 `mbgt:` 前缀，带版本迁移。
- **错误处理**：所有 hook 回调 try/catch 吞错不阻断页面；错误走 logger；同一错误 30s 内去重（沿上游 error-counter 思路）。
- **降级原则**：探测、统计、面板任一崩溃不影响核心拦截；面板挂载失败仅损失可视化。

## 6. 测试、CI 与发布

- **单测（Vitest）**：模块调度与 compat 判定（伪造特征 DOM）；CDN 探测状态机（mock 成功/失败/超时/缓存）；统计聚合与节流落盘；存储迁移；hook 引擎（伪 XHR/fetch 环境）。
- **CI**：PR 跑 build + test + lint；发版 **tag-only 触发 + 自动 release notes**。
- **产物**：`.user.js`、`extension.zip`（source map 不进 release）。
- **分发**：userscript = GitHub Releases 直链 + jsDelivr（`/gh/...@tag`）双通道；扩展不打商店，Releases zip + Edge 拖拽安装。README 写明与 BewlyCat/AveMujica 的共存矩阵与安装指引。
- **协议与署名**：MIT；继承自上游的文件头部保留 SukkaW 版权声明；README 致谢 SukkaW、BewlyCat、AveMujica 三上游。

## 7. 里程碑（供实现计划拆解）

1. Monorepo 脚手架 + core 引擎（15 模块原样移植，单测跟随）
2. userscript 产物跑通（对齐上游功能）
3. 共存感知 + compat 表
4. MV3 扩展产物 + DNR 规则
5. 三个点睛功能（CDN 选优 → 统计 → 面板）
6. CI/发版流水线 + README + v0.1.0 发版
