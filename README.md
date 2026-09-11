# Make Bilibili Great Together 🎬

<p align="center">
  <strong>现代化 B 站反跟踪、反 PCDN / P2P、CDN 智能选优与播放链路增强引擎</strong>
</p>

<p align="center">
  <a href="https://github.com/3304711297/make-bilibili-great-together/releases"><img src="https://img.shields.io/github/v/release/3304711297/make-bilibili-great-together?style=flat-square&color=blue&label=Latest%20Release" alt="Latest Release"></a>
  <a href="https://github.com/3304711297/make-bilibili-great-together/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/3304711297/make-bilibili-great-together/ci.yml?branch=main&label=CI%20Build&style=flat-square" alt="CI Status"></a>
  <img src="https://img.shields.io/badge/Form-Userscript%20%7C%20Chrome%20MV3-orange?style=flat-square" alt="Form">
  <img src="https://img.shields.io/badge/Compatibility-BewlyCat%20%7C%20AveMujica-526CFE?style=flat-square" alt="Coexistence">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

---

接手自 [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（MIT © SukkaW），重构支持 **双形态（Userscript 油猴脚本 + Chrome/Edge MV3 原生扩展）**，内置与 [BewlyCat](https://github.com/keleus/BewlyCat) 和 [BewlyBewly! AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica) 的智能共存感知机制。

---

## ⚡ 双形态特性对比与选型

> ⚠️ **重要提示**：请勿在同一浏览器中同时启用 Userscript 与 MV3 扩展。两者底层均会在主世界包装 fetch / XHR，二选一即可。

| 对比维度 | 📦 Chrome / Edge MV3 扩展 (推荐) | 📜 Userscript 油猴脚本 |
| :--- | :--- | :--- |
| **网络层拦截** | **Declarative Net Request (DNR)** 原生网络层规则阻断，首包前毫秒级生效 | 依赖主世界 Hook，异步首包可能产生微小漏网 |
| **反 PCDN / P2P** | 原生 WebRTC 拦截 + 主世界 Hook | 主世界 Hook 假实现 |
| **CDN 智能选优** | Isolated 世界与 Background Service Worker 高速测速 | `GM_xmlhttpRequest` 测速 |
| **配置面板** | 浏览器工具栏图标直接呼出 Options 设置页 | 页面右下角 `⚙ MBGT` 悬浮胶囊面板 |
| **安装方式** | 解压后加载到扩展管理页（`chrome://extensions`） | 脚本猫 (ScriptCat) / Tampermonkey 一键安装 |

---

## 🚀 快速安装

### 方案 A：安装 MV3 浏览器扩展 (日常推荐)
1. 前往 [GitHub Releases](https://github.com/3304711297/make-bilibili-great-together/releases) 下载最新版本的 `make-bilibili-great-together-extension.zip` 并解压到本地；
2. 打开浏览器扩展页面（Edge: `edge://extensions`，Chrome: `chrome://extensions`）；
3. 打开右上角的 **「开发者模式」**；
4. 点击 **「加载已解压的扩展程序」**，选择解压出来的文件夹即可（最低要求 Chromium 111+）。

### 方案 B：安装 Userscript 油猴脚本
- 直接点击 [GitHub Releases 页面](https://github.com/3304711297/make-bilibili-great-together/releases) 中的 `make-bilibili-great-together.user.js` 即可唤起脚本猫或 Tampermonkey 安装。

---

## 🛠️ 核心功能与技术实现

```text
                                 [Bilibili Web 请求]
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [网络层 DNR 规则阻断]                              [主世界 Hook 拦截]
      - 拦截各类数据打点与上报                          - sendBeacon / XHR / fetch 拦截
      - 封禁 PCDN / P2P 上传节点                        - WebRTC RTCPeerConnection 模拟
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                             [CDN 智能延迟选优引擎]
                     - 提取 playinfo 中所有 CDN 镜像候选
                     - Range 测速淘汰慢节点，缓存最优线路 (5min)
                                          │
                                          ▼
                             [拦截统计与共存感知面板]
                     - 30s 节流安全落盘，与 BewlyCat 零冲突
```

### 1. ⚙️ 设置面板与即时控制
- **三态开关机制**：每个模块支持 `默认开启` / `关闭 (off)` / `强制开启 (force-on)`。
- **配置导入与导出**：一键生成/导入 JSON 配置文件，配置跨设备安全同步。
- **动态刷新**：面板打开期间每 2 秒静默拉取状态，关闭后零额外 CPU 开销。

### 2. ⚡ CDN 智能选优
当视频播放信息（`playinfo`）中包含多个 CDN 镜像时，引擎自动发起微小体积的 HTTP Range 测速请求（2 秒超时自动淘汰），并锁定延迟最优的服务器节点。结果自动缓存 5 分钟，避免频繁重试。

### 3. 📊 实时拦截与统计落盘
全量统计 sendBeacon 假实现、上报接口拦截、localStorage 阻断写、P2P 替换及 WebRTC 阻断次数。数据采用归零口径与 30 秒节流落盘机制，保证跨会话精准累加且零性能损耗。

### 4. 🤝 与 BewlyCat / AveMujica 无缝共存
内置共存感知守卫。当检测到页面已加载 Bewly 系列扩展时，会自动停用与其重叠的页面美化、广告过滤模块，保留底层网络反跟踪、反 PCDN 核心能力，实现 100% 互补运行。

---

## 🛠️ 本地构建与全自动发版

本项目采用 pnpm Monorepo 结构维护：

```bash
# 1. 安装依赖
pnpm install

# 2. 全量构建 (Userscript + Extension)
pnpm build

# 3. 运行自动化测试
pnpm test
```

* **全自动发版机制**：版本号单源写在 `packages/core/src/version.ts` 的 `MBGT_VERSION` 常量中。push 到 `main` 分支后，`version-release.yml` 会自动比对当前版本号与已有 tag；若为新版本则跑全量门禁（lint + test + build）与三处一致性断言（`version.ts` / `userscript.meta.json` / `extension` 的 `manifest.json` 及产物 `@version`），全绿后自动打 `v$VER` tag 并发布 Release。机制幂等：tag 已存在则整条流水线跳过，不会重复发版。

---

## 📂 项目结构

```text
make-bilibili-great-together/
├── packages/
│   ├── core/               # 共享引擎（双形态共用）
│   │   └── src/
│   │       ├── engine/     # 拦截与选优核心引擎
│   │       ├── features/   # 功能模块
│   │       ├── modules/    # 各功能实现
│   │       ├── platform/   # 平台适配层
│   │       ├── utils/      # 通用工具
│   │       └── version.ts  # 版本号单源（MBGT_VERSION）
│   ├── extension/          # Chrome / Edge MV3 扩展
│   │   └── src/manifest.json   # 产物：dist/ + make-bilibili-great-together-extension.zip
│   └── userscript/         # Userscript 油猴脚本
│       └── userscript.meta.json  # 产物：dist/*.user.js
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── eslint.config.js
```

- 当前版本 **0.3.5**，最低浏览器要求 **Chromium 111+**（见 `manifest.json` 的 `minimum_chrome_version`）。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><strong>Userscript 和 MV3 扩展能同时装吗？</strong></summary>

**不能。** 两者底层都会在主世界包装 `fetch` / `XHR`，同时启用会导致重复拦截与不可预期的冲突，二选一即可。日常推荐 MV3 扩展。

</details>

<details>
<summary><strong>扩展安装时提示版本过低？</strong></summary>

需要 **Chromium 111+** 内核（Edge / Chrome 均可满足）。请升级浏览器到该版本以上，或改用 Userscript 方案。

</details>

<details>
<summary><strong>CDN 选优测速失败会怎样？</strong></summary>

不会影响播放。测速请求 2 秒超时后会自动淘汰慢节点；若全部节点测速失败，则回退默认线路正常播放。

</details>

<details>
<summary><strong>配置如何跨设备同步？</strong></summary>

设置面板支持一键导出 / 导入 JSON 配置文件，导出后在新设备上导入即可完成同步。

</details>

<details>
<summary><strong>设置面板在哪里打开？</strong></summary>

- **MV3 扩展**：点击浏览器工具栏图标直接呼出 Options 设置页；
- **Userscript**：点击页面右下角的 `⚙ MBGT` 悬浮胶囊面板。

</details>

---

## 📄 致谢与开源协议

- [SukkaW/Make-Bilibili-Great-Than-Ever-Before](https://github.com/SukkaW/Make-Bilibili-Great-Than-Ever-Before)（核心架构与底层能力来源，MIT）
- [keleus/BewlyCat](https://github.com/keleus/BewlyCat) & [VentusUta/BewlyBewly-AveMujica](https://github.com/VentusUta/BewlyBewly-AveMujica)（共存兼容目标）

本项目采用 [MIT 许可证](LICENSE) 开源。
