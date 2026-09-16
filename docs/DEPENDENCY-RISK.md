# 依赖风险报告 · zombie-survival

- 扫描对象：`E:\Files\Games\zombieSurvival`（GitHub `Bobbychina/zombie-survival`）
- 扫描依据：仓库根 `package-lock.json`（git 已跟踪，Dependabot 只扫这一份）
- 生成时间：2026-09-16 · 工具：`npm audit --json`（auditReportVersion 2）+ `gh api .../dependabot/alerts`
- 依赖面：101 个包（prod 3 / dev 99 / optional 50）

## 一句话结论

**7 条 Dependabot 告警 = 5 个受影响包，全部落在 dev 链（vite / vitest / esbuild / vite-node / @vitest/mocker）；生产依赖 0 命中，线上单文件 HTML 产物不含任何运行时依赖。** 唯一的 critical 在本项目不可达（需要未安装的 `@vitest/ui`），真正需要处理的是 Windows 上 `npm run dev` 的 vite 高危项。

## 明细

| # | 包 | 安装版本 | 告警级别 | 影响区间 | 最低修复版 | 本项目实际可利用性 |
|---|---|---|---|---|---|---|
| 3 | vitest | 2.1.9 | critical | `<3.2.6` | 3.2.6 | **不可达**：需 Vitest UI server（`vitest --ui`，依赖未安装的 `@vitest/ui`） |
| 4 | vite | 5.4.21 | high | `<=6.4.2` | 6.4.3 | **真实**：Windows 可绕过 `server.fs.deny` 读任意文件（CVSS 7.5），本机就是 Windows 且常跑 `npm run dev` |
| 5 | vite | 5.4.21 | moderate | `<=6.4.2` | 6.4.3 | 中：`launch-editor` 经 UNC 路径泄露 NTLMv2 哈希，需攻击者能请求到 dev server |
| 2 | vite | 5.4.21 | moderate | `<=6.4.1` | 6.4.2 | 中：优化依赖 `.map` 路径穿越，同上需触达 dev server |
| 1 | esbuild | 0.21.5（vite 传递） | moderate | `<=0.24.2` | 0.25.0 | **不可达**：只影响 `esbuild --serve`，vite 仅用 esbuild 做 transform |
| 6/7 | @vitest/mocker | 2.1.9（vitest 传递） | moderate | `>=2.1.0 <4.1.11` | 4.1.11 | 低：需在测试里对不可信输入用 redirect mock；自有测试代码可控 |
| — | vite-node | 2.1.9（vitest 传递） | moderate | `<=2.2.0-beta.2` | 随 vitest 升级 | 低：经由 vite 传递 |

## 为什么生产是干净的

- `dependencies` 只有 `seedrandom` + `simplex-noise`（3 个 prod 包，0 告警）。
- 发布物是 `tools/build.mjs` 产出的**单文件 HTML**：`docs/index.html` → `tools/sync-site.mjs` 拷到 `bobbychina-pages/games/zombie-survival/index.html`（GitHub Pages 静态托管）。
- 所有受影响包都只在 `npm run dev` / `npm test` 期间执行，不被打进产物。

## 修复方案（推荐）

vite 5.x 线**没有修复版本**（告警区间上探到 6.4.2），必须跨大版本：

```powershell
cd E:\Files\Games\zombieSurvival
npm i -D vite@^7.3.6 vitest@^4.1.11
npm dedupe
npm audit          # 期望：found 0 vulnerabilities
npm test           # 87 个测试文件必须全绿（vitest 2 → 4 有 breaking change）
npm run build      # tools/build.mjs 内联 worker + await build() 必须照常
```

选型理由：

- **vite 7.3.6**：自带 esbuild `^0.27 || ^0.28`（0.25+ 已修），保留 rollup 打包链。
- **不推荐直接上 vite 8.3.0**：vite 8 用 **rolldown 取代 rollup**，而 `vite.config.ts` 里 `rollupOptions.output.inlineDynamicImports` + `vite-plugin-singlefile`（peer 要求 `rollup ^4.59.0`）依赖 rollup 语义，跨到这步风险明显高于收益。
- **vitest 4.1.11**：同时越过 critical(`<3.2.6`) 与 mocker(`<4.1.11`) 两条线的最低修复版本；peer 要 `vite ^6||^7||^8`，与 vite 7 匹配。
- `vite-plugin-singlefile` 已是 2.3.3（最新，peer 已含 `^7.0.0`），无需动。
- 本机 Node v24.18.0，满足 vite 7（`^20.19 || >=22.12`）与 vitest 4 的 engines。

升级后仍需人工确认（vitest 4 breaking change）：`vi.mock` 提升行为、`test.workspace` → `projects` 配置、`environment` 默认值、`coverage` 阈值字段。若 `npm test` 出现大面积失败，退路是只升 vite 到 `^6.4.3` + vitest 到 `^3.2.7`（清掉全部 5 条告警，改动更小，但两条线都已进入维护末期）。

## 附注

- `_m49build/package-lock.json` 是构建快照副本，同样锁定 vite 5.4.x / vitest 2.1.x，但**未被 Dependabot 扫描**（只扫仓库根 manifest）。若不作为发布源可忽略，否则按上面同一方案升级。
- 同一台机器上 `E:\Files\Games\stardustEpochV2`、`stockGameOnlinePro` 也有 vite 依赖，本次未纳入（用户只问了 zombie-game）。
