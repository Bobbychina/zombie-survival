# 依赖漏洞评估 · 2026-09-22（Dependabot 7 条）

> 结论先说：**7 条全部是「开发期工具链」漏洞**（Vite / Vitest / esbuild 的**开发服务器**），
> 线上产物是一个**静态单文件 HTML**，这些代码一行都不会跑在玩家浏览器里。
> 因此当前**不紧急**；建议按「先修零风险的那半边、把 vitest 大版本升级单独排一轮」处理。

## 1. 清单（`gh api repos/Bobbychina/zombie-survival/dependabot/alerts`）

| # | 包 | 严重度 | 修好的版本 | 摘要 |
|---|---|---|---|---|
| 3 | vitest | **critical** | 3.2.6 | Vitest **UI server** 监听时任意文件可被读取并执行 |
| 4 | vite | **high** | 6.4.3 | Windows 备用路径下 `server.fs.deny` 可绕过 |
| 1 | vitest | medium | 4.1.11 | `@vitest/mocker` 重定向 mock 导致路径穿越 / 任意文件读 |
| 2 | @vitest/mocker | medium | 4.1.11 | 同上 |
| 5 | vite | medium | 6.4.3 | launch-editor 在 Windows 上经 UNC 路径泄露 NTLMv2 哈希 |
| 6 | vite | medium | 6.4.2 | 优化依赖的 `.map` 处理存在路径穿越 |
| 7 | esbuild | medium | 0.25.0 | 开发服务器允许任意网站发起请求并读响应 |

## 2. 为什么说"开发期"（逐条落到本仓库）

- 本仓库对外只交付 `docs/index.html` / `丧尸末日生存.html`（构建后的单文件，735KB 左右）；
  玩家看到的是静态页，**没有 node_modules、没有 dev server**。
- 上述漏洞的触发前提都是「**开发服务器正在跑，且攻击者能访问到它**」：
  - `vitest --ui`（我们平时只跑 `npm test`，不跑 UI）→ #3；
  - `vite dev` 的 `server.fs.deny` / `.map` / launch-editor → #4/#5/#6（要能连到本机端口）；
  - esbuild 开发服务器被恶意网页探测 → #7。
- 本机的 dev server 只在 `127.0.0.1` 上、用完即关；构建（`npm run build`）不依赖这些漏洞路径。
- 结论：**没有一条能影响线上玩家或已发布的产物**；风险面是"我在本机开发时被本机/局域网里的东西打"。

## 3. 建议的修法（分两步，别一把梭）

**第一步（低风险，随时可做）**：升 vite 到 ≥ 6.4.3（连带 esbuild ≥ 0.25）—— 覆盖 #4/#5/#6/#7 四条，
属于同一大版本内的补丁/小版本，跑一遍全量单测 + 构建即可确认。

```powershell
cd E:\Files\Games\zombieSurvival
npm install -D vite@^6.4.3          # 或 npm audit fix（只动 vite 这一支）
npm test                            # 期望 842/842
npm run build                       # 产物字节数应与升级前基本一致（差几十字节属于正常）
```

**第二步（单独排一轮）**：vitest 2.x → 4.x（覆盖 #1/#2/#3，其中 #3 只在跑 UI 时才有意义）。
跨两个大版本，**62 个测试文件**都要复跑；建议：

```powershell
npm install -D vitest@^4 @vitest/coverage-v8@^4   # 视需要
npm test                                          # 有失败再逐个适配（API 基本兼容，注意 workers/mocker 配置项改名）
```

**不改也没关系**：只要不跑 `vitest --ui`、不把 dev server 暴露到 0.0.0.0、不在开着 dev server 时点陌生链接，
这 7 条在本机的实际触发面接近于零。

## 4. 记录

- 决策：**先记录不修**（2026-09-22，站长授权"你自己分析判断修复价值"）。
- 复查触发条件：① 要跑 `vitest --ui` 或把 dev server 对外暴露；② 准备把开发环境搬到共享/公网机器；
  ③ GitHub 又报出**运行时依赖**（vite/vitest 之外的包）的新漏洞 —— 那时优先级立刻上调。
