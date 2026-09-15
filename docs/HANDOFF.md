# 丧尸末日生存 v4.0「余烬」—— 接手必知（交接时间：2026-09-15 晚，M32 进行中）

> 写给下一个 agent 会话。**先读这份，再读 `docs/V40-ACCEPTANCE.md`**（那里有每个里程碑的完整验收证据）。
> 本文件只讲"怎么干活、现在到哪了、哪里有坑"，不讲历史。

---

## 0. 三十秒速览

| 项 | 值 |
|---|---|
| 工程目录 | `E:\Files\Games\zombieSurvival`（Vite 5 + TS strict + vitest） |
| 主页仓库 | `E:\Files\bobbychina-pages`（`Bobbychina/Bobbychina.github.io`） |
| 日记仓库 | `E:\Files\bobbychina-diary`（私有，一天一条） |
| 线上地址 | <https://bobbychina.github.io/games/zombie-survival/> |
| 测试基线 | **单测 372 通过 / 探针 6 套**（见 §5） |
| 当前 HEAD | `346b929 [AI] M31：人体状态分页…`（**M32 未提交**，工作区有改动，见 §3） |
| 用户 | bobbychina，学生 + 独立开发者，中文交流、口语化、不要客套。**他要的是"修好并上线"，不是报告** |

---

## 1. 铁律（违反会挨骂或被规则拦下）

1. **一切交付 = 改代码 + 单测 + 浏览器探针 + 截图/OCR 复查 + 提交推送三个仓库。** 只写报告不算完成。
2. **提交格式**：`[AI]` 前缀；commit message 写到**仓库外**的文件（如 `E:\Files\myagent\_commit_xxx.txt`），再 `git add -A && git commit -F <文件>`。
3. **run-to-file**：所有外部命令（node/playwright/OCR）输出一律 `cmd *> <工作区文件> 2>&1` 落盘再 `read`，禁止靠管道捕获（沙箱下 Node 子进程管道会 EPERM）。
4. **不要禁用 F12 / 不做反调试**（用户原话「不要妄想禁用 f12」）；我们全部探针都靠 CDP 跑。
5. **存档必须加密**（M29 起硬要求）：主档 `ZSV1:`（worker 密钥）、账号档 `ZSV2:`；**不许再提供任何"导出明文存档"入口**。
6. 改了 `src/` 就要 `npm run build`（构建脚本自己会 `tsc --noEmit` + 内联 worker + 写 `dist/`、仓库根的单文件 HTML、`docs/index.html`）。
7. 上线要 `node tools/sync-site.mjs`（把 `dist/index.html` 注入 auth-config 后拷到 pages 仓库，并把 `src/account/account.js` 覆盖 `/games/account.js`），然后 pages 仓库也要提交推送。
8. 探针浏览器跑完要 `Stop-Process`；别留 headless 进程。

---

## 2. 工程结构与"改哪里"

```
src/
  main.ts                 入口：动态 import 各 v4 模块 → 挂 window.V4Xxx → 调 L.boot() → mountWorld()
  legacy/game.ts          旧 v3 底座（3500+ 行，`// @ts-nocheck` 之外的 IIFE），S 状态、渲染、战斗结算都在这里
  v4/*.ts                 v4 接管层。**纯逻辑放 *-core.ts（可单测），DOM/存档接线放同名不带 core 的文件**
  v4/gather.ts            采集/拆解/伐木（拆解吃大区资源丰度）
  v4/world-ui.ts          探索页卡片墙 + 地图面板（M32 起地图住悬浮窗）+ 世界面板
  v4/battle-ui.ts         v4 战斗界面（M31 在这里接了"挨打→部位伤"）
  v4/worldgen.ts          24×24 局部地图生成
  v4/regions-core.ts      12×12 元地图（区域类型/地名/资源丰度）
  v4/region-danger.ts     柏林噪声危险度场 + 资源丰度噪声（M28/M30）
  v4/survival-core.ts     M30 湿度/病症链数值表；survival.ts 是运行时
  v4/medical-core.ts      M31 人体伤病数值表；medical.ts 是运行时 + 人体页渲染
  v4/ui-scale-core.ts     M32 字号/地图偏好纯逻辑；ui-scale.ts 是运行时
  v4/save-vault.ts        M29 主档加密（worker + ZSV1）；vault-worker.ts 是**纯 JS**（会被原样内联！）
  v4/account-vault*.ts    M29 账号档加密（ZSV2）
  v4/tutorial.ts          M27 新手教程（15 步高亮）；M33 计划改成"分章节 + iframe 沙盒"
tools/build.mjs          构建：内联 worker → tsc → vite build → postbuild → 还原占位符
tools/sync-site.mjs      同步到 pages 仓库
docs/V40-ACCEPTANCE.md   验收文档（每个里程碑一节，**交付时必须补**）
docs/_m*_probe.mjs       各里程碑的 CDP 探针（可复现证据）
tests/*.test.ts          vitest 单测（372 条）
```

**改代码的口径**：数值只写在 `*-core.ts` 一处；UI 只读它。legacy 与新系统的通信统一走
`window.V4Xxx`（内联 onclick 只认 window 名字）——**函数名必须与调用方逐字一致**，见 §4 坑 1。

---

## 3. 现在到哪了（**接手第一件事：处理 M32**）

### M32 在做：字号适配 + 地图悬浮窗（用户原话）

> 「用户反馈字体太小了，做可自定义字号适配（简化一下 GUI，把地图改成那种类似于悬浮框可折叠的模式，
> 在哪里都能开，然后呢主要的地方全用来放行动卡片，这样大字适配会很不错）」

**已完成并本地验证**（未提交，工作区）：
- 新增 `src/v4/ui-scale-core.ts`（纯逻辑：5 档字号 100/115/130/145/160、偏好读写、标题/头部文案、卡片数估算）
  + `src/v4/ui-scale.ts`（运行时：`--fs` 变量、`#v4cards`/`#v4world` 的 `zoom`、`☰` 菜单按钮、快捷键 Ctrl±/M）
  + `tests/m32-ui-scale.test.ts`（12 条，已过）。
- `src/styles/v4.css`：**地图从"探索页左列"改成右上角浮层 `#v4mapwin`**（折叠后只剩 `#v4mapbar` 小条），
  删掉了旧的双列地图/卡片网格（`#view.v4-board` 现在只有 `cards` 一个区域），`#v4cards` 用 `zoom: var(--fs)`。
- `src/v4/world-ui.ts`：`ensureMapWindow()` / `paintMapWindow()`；`mountWorldPanel()` 现在**任何页签都维护地图窗**、
  只在自己是 `explore` 时维护卡片墙；`fitMap()` 在悬浮窗折叠时直接 return；卡片墙重建后补一次 `V4Scale.applyCardsZoom()`。
- `src/legacy/game.ts`：`☰` 菜单加了「显示（字号 / 地图）」区块。
- `src/main.ts`：挂 `window.V4Scale`、boot 后 `ensureMapWindow + applyScale`、键盘快捷键。

**探针状态**：`docs/_m32_probe.mjs` 上次跑 **12/14**，12 条全过，**只剩 3 条没过**（已修一部分，需重跑确认）：
- 「五档字号都落到 DOM」+「卡片宽度随字号变化」：**上一轮探针读到 `#v4cards.style.zoom` 一直是 `none`**。
  已修（`applyCardsZoom` 暴露给 `window.V4Scale`，`mountWorldPanel` 里补调），**但还没重跑验证**。
  探针这段的读法：`document.getElementById('v4cards').style.zoom` 与 `--fs` 变量。若仍为 none，检查
  `#v4cards` 是否在 `mountWorldPanel` 里被**重建**（重建后 style 会丢 → 必须在建完后立刻补 zoom）。
- 其余（地图在浮层 / 整宽卡片 / 折叠小条 / 别的页签能开 / 160% 无横向溢出 / 整页不滚 / 地图格子正方形 /
  偏好持久化 / 大区图 144 格）**都已 PASS**。

**M32 剩余 TODO**：
1. 重跑 `node docs/_m32_probe.mjs 9449 "http://127.0.0.1:8791/" "docs/_m32_shots"` → 目标 14/14。
2. 回归：`_m21_layout_probe`（31 条，**最可能被 M32 版式改动打挂**——它有"地图卡在探索页"的老断言）、
   `_m25_probe`(33)、`_m26_res_probe`(15 档)、`_m27_tutorial_probe`(12)、`_m29_probe`(23)、`_m30_probe`(20)、`_m31_probe`(15)。
   **老探针里凡是断言"探索页里有 #v4world / 双列"的，都要按新形态改**（地图在浮层，需先 `V4Scale.toggleMap(true)`）。
3. `npx tsc --noEmit` + `npx vitest run`（应 372+）→ `npm run build` → `node tools/sync-site.mjs`。
4. `docs/V40-ACCEPTANCE.md` 补第四十一节（M32），然后提交推送游戏 + pages 两个仓库，最后抽查线上 URL。

### 用户新报的 bug（**必须优先修，还没动**）

> 「商人卖的子弹还是旧版，没有各种不同的子弹卖！买了子弹相当于吞材料！！」

**已知线索**（尚未定位到根因，接手先做这个）：
- 商人定义在 `src/legacy/game.ts` 的 `const MERCHANT = [...]`（约 328 行），买卖 UI 在 `openMerchant()` / `buyMerchant(i)`（约 3372 行）。
- M25 把弹药改成**口径 + 弹种**（`CALIBERS` / `AMMO_OF` / 各 `a9_fmj`、`a556_ap` … 见 §"弹药"那批物品与配方，约 220-270 行），
  但 `MERCHANT` 表**很可能还写着老的 `ammo` 这种通用弹药**，于是：
  ① 商人只有"子弹"一件，没有不同口径/弹种；② 买到的 id 在新系统里没人认（枪吃口径），**钱花了、子弹进不了枪 → 等于吞材料**。
- 需要做的：把 `MERCHANT` 的弹药条目改成按口径/弹种卖（含穿甲弹更贵），并在 `buyMerchant` 里加一层**兜底校验**
  （未知 id 不许成交）；顺手查 `sanitizeSave`/`MIGRATIONS` 里老 `ammo` 字段怎么迁的，别让老档里的 `ammo` 变成死物。
- 修完按 §1 铁律走：单测（MERCHANT 条目 id 必须在 ITEMS 里、且弹药要在对应的 `AMMO_OF[cal]` 里）+ 探针（买一发真的进枪/进背包）+ 文档 + 提交。

---

## 4. 踩过的坑（**别再踩第二次**，每条都真的发生过）

1. **`window.V4Xxx` 函数名写错 = 整屏挂掉**，不是"少个 chip"。
   - `e.penaltyNow is not a function`（M30）→ `render()` 走 catch，探索页变成"⚠️ 界面渲染出错"；
   - `n.bodyPenaltyNow is not a function`（M31）→ 同上；
   - `window.V4Survival.survivalLine is not a function`（M30）→ `env.envChips()` 抛错 → **世界地图挂载一起失败**。
   → 规矩：导出对象**显式写全名、不用简写别名**；`envChips()` 这类被多处调用的拼接函数要 try/catch 兜底。
2. **legacy 的 `renderHud()` 每次 `$('#hud').innerHTML = h` 整块重写** → v4 后加的 chips 会被抹掉。
   现在用**劫持 `#hud` 元素的 `innerHTML` setter**（`main.ts` 的 `paintEnv`）同步拼接，不要用 MutationObserver 版（会被时序坑）。
3. **`display:contents` 会让 Chromium 的 `innerText` 跳过整棵子树**（屏幕上看得见、断言读不到）。容器一律用 `display:flex`。
4. **`zoom` 之后 `getBoundingClientRect()` 返回缩放后的值**（M32 起 `#v4cards`/`#v4world` 有 zoom），
   `fitMap`/`fitRegion` 里所有按像素算格子的换算都要考虑它（必要时除以 zoom）。
5. **`nightBody()` 曾被自己的节流吞掉**：`stepBody()` 头一行"步数不够就 return"，而它只是把步数清零再调 → 过夜康复一次没生效。
   → 凡是"结算类"函数，别复用带节流的入口，直接算。
6. **同一部位反复挨轻伤永远升不成大出血**（M31）：抽签用一张大权重表会被同类权重吃掉 →
   改成"先判轻重档、再在档内挑具体伤病"。
7. **重复定义物品 id 会被单测抓住**（M31 的 `splint` 与老物品撞车）；新物品 `t` 必须是
   `TYPE_LABEL` 认得的类型（`food/drink/med/mat/wpn/gear/thr/key/ammo`）。
8. **`Item` 上限/前缀**：写探针要 `Network.setCacheDisabled`，否则会读到旧构建（踩过：一直报一个早修好的异常）。
9. **`?dev=fresh` 会 `location.replace` 跳一次**，探针别用它测首屏；用 `?dev=ready`（不弹教程）。
10. **自动读档那条路首屏不画 HUD**：`renderHud()` 要等第一次 `render()`。探针里先手动 `render()` 再量 HUD。
11. **`window.V4Medical/V4Survival` 的调用点分散在 legacy**：grep `window.V4` 能看到全部接线处，改名前先 grep。

---

## 5. 验证流程（照抄就能跑）

```powershell
# 0) 起静态服务（读 dist/，不要用陈旧的 docs/index.html 测本地）
cd E:\Files\Games\zombieSurvival
node tools\serve.mjs --port 8791 --no-open *> _srv.log 2>&1   # 后台常驻

# 1) 类型 + 单测 + 构建
npx tsc --noEmit
npx vitest run
npm run build          # 内部会再跑一次 tsc；末尾打印 dist/单文件/docs 三个产物的字节数

# 2) 探针（headless Thorium + CDP；端口按需换）
$exe = 'C:\Users\lenovo\AppData\Local\Thorium\Application\thorium.exe'
Start-Process $exe -ArgumentList '--headless=new','--remote-debugging-port=9449',
  '--user-data-dir=E:\Files\Games\zombieSurvival\docs\_m32_profile','--window-size=2048,1105',
  '--no-first-run','--disable-gpu','about:blank'
Start-Sleep -Seconds 4
node docs\_m32_probe.mjs 9449 "http://127.0.0.1:8791/" "docs/_m32_shots" *> docs\_m32_out.log 2>&1

# 3) 截图 OCR 复查（零 vision 配额）
node E:\Files\myagent\ocr-vision.mjs docs\_m32_shots\a1_map_float_160.png --tile 4 "<要核对什么>"

# 4) 收尾：同步站点 → 提交 → 推送 → 线上抽查
node tools\sync-site.mjs
git add -A; git commit -F E:\Files\myagent\_commit_m32.txt; git push
cd E:\Files\bobbychina-pages; git add -A; git commit -m "[AI] M32 同步：…"; git push
```

单测文件命名：`tests/m<里程碑>-<主题>.test.ts`；探针：`docs/_m<里程碑>_probe.mjs`（**都入库，是证据**）。
临时诊断脚本（`docs/_m*_diag*.mjs`）用完删掉，别提交。

---

## 6. 用户的口径与已确认的设计决策（**不要擅自改**）

- **交付节奏**：小步快跑，一批一提交；每批都要能单独验收（他明确说「不需要一次性搞完」）。
- **提需求前先出选择题确认**：他会逐条拍板（M30 就是先出 16 道题）。
- **反作弊口径**：存档/上传全链路加密（M29 已做），但**不做**任何反 DevTools 手段；"导入/导出明文存档"永久下线。
- **健康系统是双轨制**（M31 已确认）：单条 HP 决定生死；部位伤只影响能力 → 不要把生死改成部位制。
- **病症分级可见**：HUD 给数值、人体页给症状文案；湿度舒适区（20~85%）**不给**任何额外惩罚。
- **大区**：危险度/地貌/资源丰度都在（噪声），相邻最多差 1 是硬约束；**不加**高危区硬门槛。
- **教程沙盒**：用户选**独立 iframe**（真平行世界）+ 6 章（生存基础/战斗/人体与伤病/建造与据点/地图与大区/背包与制作）+
  混合教学（前两步脚本 → 自由练手 + 目标清单）+ **预设**伤情/敌人 + 固定假种子 + 进度可恢复。
- **待办（已登记，别自作主张做）**：截肢/断肢长期 debuff、大区事件倾向层、10 天天气预报深化、手机端大格子单指拖动。
- **国庆（2026-10 上旬）计划**：买境外 VPS + 备案域名，把游戏与云存档后端整体自建（沿用现有 `/api/*` 契约与 `ZSV1/ZSV2` 加密）。
  到时候要出迁移清单 + 二次确认流程；`auth-config.js` 里的 `api` 一改即可切换后端。

---

## 7. 三个仓库的收尾纪律

1. **游戏仓库**：`[AI]` 前缀提交 + 推送；`docs/V40-ACCEPTANCE.md` 必须补一节（做了什么 / 实测证据 / 已知问题）。
2. **pages 仓库**：`node tools/sync-site.mjs` 之后再提交（游戏页 + `/games/account.js` 两处）。
3. **日记仓库**（`E:\Files\bobbychina-diary`，私有）：**一天一条**，插在 `entries` 最前面；
   `node check-diary.mjs`（禁 ASCII 直引号）→ `node build-viewer.mjs` → 提交推送。
   2026-09-15 那条已经写过 M25–M31，**M32 完成后可以追加到同一条**（同一天不新开）。
4. 提交前 `git status` 复核，只 add 自己的文件（同仓库可能还有别的 agent 在改）。

---

## 8. 现在就能开始的清单（按顺序）

1. 修**商人弹药**那个 bug（用户在等，见 §3 末）。
2. 重跑并修完 **M32 探针**（14/14），回归 `_m21`（最可能挂）+ `_m25`/`_m26`/`_m29`/`_m30`/`_m31`。
3. 补 `docs/V40-ACCEPTANCE.md` 第四十一节 → 提交推送游戏 + pages → 线上抽查。
4. 然后才是 **M33 = 教程分章节 + iframe 沙盒**（P2，用户已确认形态）。
5. 收尾时按 §7 处理日记，并可顺手 `update_user_profile`（用户偏好：先给结果、要证据、别客套）。
