# 丧尸末日生存 v4.0「余烬」—— 接手必知（交接时间：2026-09-15 深夜，M32 / M32b 已上线）

> 写给下一个 agent 会话。**先读这份，再读 `docs/V40-ACCEPTANCE.md`**（每个里程碑的完整验收证据，最后两节是 M32 / M32b）。
> 本文件只讲"怎么干活、现在到哪了、哪里有坑"，不讲历史。

---

## 0. 三十秒速览

| 项 | 值 |
|---|---|
| 工程目录 | `E:\Files\Games\zombieSurvival`（Vite 5 + TS strict + vitest） |
| 主页仓库 | `E:\Files\bobbychina-pages`（`Bobbychina/Bobbychina.github.io`） |
| 日记仓库 | `E:\Files\bobbychina-diary`（私有，一天一条） |
| 线上地址 | <https://bobbychina.github.io/games/zombie-survival/> |
| 测试基线 | **单测 385 通过 / 探针 9 套**（见 §5） |
| 当前 HEAD | `95b7a28 [AI] M32 收尾 + M32b：商人弹药按口径卖…`（三个仓库都已提交推送，工作区干净） |
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
8. 探针浏览器跑完要 `Stop-Process`；别留 headless 进程。**临时诊断脚本（`docs/_m*_diag*.mjs`）和日志跑完删掉，别提交**（探针本体和截图要入库，那是证据）。
9. **GitHub Pages 的 index.html 有分钟级缓存**：push 完线上抽查可能要等 1~2 分钟，用 `?v=<随机>` 破缓存。

---

## 2. 工程结构与"改哪里"

```
src/
  main.ts                 入口：动态 import 各 v4 模块 → 挂 window.V4Xxx → 调 L.boot() → mountWorldPanel()
  legacy/game.ts          旧 v3 底座（3600+ 行，`// @ts-nocheck` 之外的 IIFE），S 状态、渲染、战斗结算都在这里
  v4/*.ts                 v4 接管层。**纯逻辑放 *-core.ts（可单测），DOM/存档接线放同名不带 core 的文件**
  v4/ammo-core.ts         口径表 / 弹种表 / 穿透算法 / resolveAmmoId（杂牌弹药折真弹）
  v4/shop-core.ts         M32b：商人货架（按口径卖弹）+ badShopRows 兜底 + shopPrice
  v4/ui-scale-core.ts     M32：字号档位/偏好纯逻辑；ui-scale.ts 是运行时（--fs + zoom + 悬浮窗开关）
  v4/world-ui.ts          探索页卡片墙 + 地图悬浮窗（#v4mapwin）+ fitMap/fitRegion
  v4/tutorial.ts          M27 新手教程（15 步高亮）；M33 计划改成"分章节 + iframe 沙盒"
  v4/bridge.ts            legacy ↔ v4 的桥（playerProfile/syncBack，弹药按"当前装填弹种"结算）
  v4/save-vault.ts        M29 主档加密（worker + ZSV1）；vault-worker.ts 是**纯 JS**（会被原样内联！）
tools/build.mjs / serve.mjs / sync-site.mjs
docs/V40-ACCEPTANCE.md   验收文档（每个里程碑一节，**交付时必须补**）
docs/_m*_probe.mjs       各里程碑的 CDP 探针（可复现证据）
tests/*.test.ts          vitest 单测（385 条）
```

**改代码的口径**：数值只写在 `*-core.ts` 一处；UI 只读它。legacy 与新系统的通信统一走
`window.V4Xxx`（内联 onclick 只认 window 名字）——**函数名必须与调用方逐字一致**，见 §4 坑 1。

---

## 3. 现在到哪了（**接手第一件事：起浏览器跑一遍探针，确认基线**）

### M32 已完成：字号适配 + 地图悬浮窗（用户：「字体太小了」）

- `src/v4/ui-scale-core.ts` + `ui-scale.ts`：5 档字号 100/115/130/145/160，
  `--fs` 变量 + `#v4cards` 的 `zoom`；☰ 菜单「显示」、顶栏 🗺️、快捷键 `Ctrl±` / `M`，偏好落 localStorage。
- `src/styles/v4.css`：地图从"探索页左列"改成右上角浮层 `#v4mapwin`（折叠后只剩 `#v4mapbar` 小条），
  探索页整宽只剩卡片墙（实测卡片 1601px / 视图 1641px）。
- **M32.1 修掉"大字下窗口比屏幕还高、地图右列被切"**：① `#v4mapwin` 的 CSS zoom 与
  `applyCardsZoom()` 给 `#v4world` 的 zoom **相乘**（160% → 2.56×）→ 现在地图卡不再自己 zoom；
  ② 窗口自身尺寸要 `calc(... / var(--fs))`；③ `fitMap/fitRegion` 的格子上下限按渲染像素算（`24/zoom`）。
- 探针 `docs/_m32_probe.mjs` **17/17**（含五档不出屏 / 最右一列不被切 / 格子 ≥23px 三条新断言）。

### M32b 已完成：商人弹药（用户：「商人卖的子弹还是旧版…买了子弹相当于吞材料！！」）

- 根因：货架还是伪 id `ammo` + `grant('ammo')` 只加到 `S.ammo` 这个**镜像**上（开一枪就被 `ammoCount()` 覆写）
  + 成交前没有兜底校验。掉落/委托/剧情/营地货架/开局 24 发/读档后 `S.ammo=0` 全是同一个坑。
- 现在：`shop-core.ts` 货架（10 种弹按口径卖，穿甲弹每发更贵更少）+ `ammo-core.resolveAmmoId()`
  （杂牌弹药折成**手上枪口径**的真弹，没枪就 9mm FMJ）+ `syncAmmo()` 收口镜像 + 两家商人扣材料前过 `badShopRows()`。
- 探针 `docs/_m32b_probe.mjs` **19/19**（连跑两遍可重复）。顺手补了 `addXP('trade', 3)`
  （M24 承诺的"和商人买卖涨交易技能"以前**从来没人调过**）。

### 回归基线（2026-09-15 实测，全部本地）

```
_m21_layout_probe 31/31 · _m25_probe 33/33 · _m26_res_probe（15 档分辨率表，问题组合为空）
_m27_tutorial_probe 12/12 · _m29_probe 23/23 · _m30_probe 20/20 · _m31_probe 15/15
_m32_probe 17/17 · _m32b_probe 19/19       单测 385/385
```

> 探针是**有状态**的（共用同一个浏览器 profile + 同一份存档）：读档会恢复"上次停在哪一页"，
> 所以每套探针开头都该自己 `setTab('explore')` 之类的把前置条件摆好。老探针里凡是断言
> "探索页里有 #v4world / 双列"的，已按新形态改成"地图在浮层，先 `V4Scale.toggleMap(true)`"。
> `_m30_probe` 的"闷湿+偏凉→呼吸道感染"那条偶发红一次（概率判定），复跑即绿。

### 下一批：M33 = 教程分章节 + iframe 沙盒（P2，形态已确认，见 §6）

用户已拍板的形态：**独立 iframe**（真平行世界）+ 6 章（生存基础/战斗/人体与伤病/建造与据点/地图与大区/背包与制作）
+ 混合教学（前两步脚本 → 自由练手 + 目标清单）+ **预设**伤情/敌人 + 固定假种子 + 进度可恢复。
建议拆两批：先做"章节壳 + iframe + 第 1 章"，再做剩下 5 章。

---

## 4. 踩过的坑（**别再踩第二次**，每条都真的发生过）

1. **`window.V4Xxx` 函数名写错 = 整屏挂掉**，不是"少个 chip"（`penaltyNow` / `bodyPenaltyNow` / `survivalLine` 各挂过一次）。
   → 导出对象**显式写全名、不用简写别名**；`envChips()` 这类被多处调用的拼接函数要 try/catch 兜底。
2. **legacy 的 `renderHud()` 每次 `$('#hud').innerHTML = h` 整块重写** → v4 后加的 chips 会被抹掉。
   现在用**劫持 `#hud` 元素的 `innerHTML` setter**（`main.ts` 的 `paintEnv`）同步拼接。
3. **`display:contents` 会让 Chromium 的 `innerText` 跳过整棵子树**（屏幕上看得见、断言读不到）→ 容器一律 `display:flex`。
4. **`zoom` 之后有两套坐标系**（M32.1 的真教训）：`getBoundingClientRect()` 是**渲染像素**，
   `clientWidth/scrollWidth/offsetWidth` 是**本地像素**，两者不能相减；
   而且 zoom 会**相乘**（父元素 zoom × 自己 zoom）、窗口/容器的 `width` / `max-height` 也会被一起放大
   （要写 `calc(760px / var(--fs))`）。凡是量地图/卡片尺寸的代码，先问"我现在在哪个坐标系里"。
5. **`nightBody()` 曾被自己的节流吞掉**（`stepBody()` 头一行"步数不够就 return"）→ 结算类函数别复用带节流的入口，直接算。
6. **同一部位反复挨轻伤永远升不成大出血**（M31）：抽签用一张大权重表会被同类权重吃掉 → 先判轻重档、再在档内挑具体伤病。
7. **重复定义物品 id 会被单测抓住**（M31 的 `splint`）；新物品 `t` 必须是 `TYPE_LABEL` 认得的类型。
8. **写探针要 `Network.setCacheDisabled`**，否则会读到旧构建（踩过：一直报一个早修好的异常）。
9. **`?dev=fresh` 会 `location.replace` 跳一次**，探针别用它测首屏；用 `?dev=ready`（不弹教程）。
10. **自动读档那条路首屏不画 HUD**：`renderHud()` 要等第一次 `render()`。探针里先手动 `render()` 再量 HUD。
11. **`window.V4Medical/V4Survival` 的调用点分散在 legacy**：grep `window.V4` 能看到全部接线处，改名前先 grep。
12. **卡片墙是 MutationObserver 在微任务里重建的**：同一个 `Runtime.evaluate` 里 `setTab('explore')` 之后
    立刻量 `#v4cards`，会读到"墙还没建"的空状态（探针曾因此报 zoom=none / cards=0）。
    → 探针每一步之间 `await` 一拍；探针要**等目标真的出现**再断言（`_m32_probe` 里等 576 格就是为此）。
13. **探针的 DOM 选择器要收窄**：新档自带 9mm FMJ 之后，按"行首是 FMJ"满页找会命中**9mm 那一段**
    （`_m25_probe` 因此假红过）→ 先定位到"5.56×45"那张卡再找行；点击会 `render()` 重建 DOM，旧按钮已脱挂，要**重新查一次**。
14. **教程步骤没有 `before: go('explore')` 会被静默跳过**：读档会停在别页（背包/人体…），
    那三步的目标元素找不到就静默 advance（`_m27_tutorial_probe` 10/12 就是这么来的）。新加步骤记得先切页。
15. **伪 id `ammo` 这类"影子物品"**：背包里不存在的 id 一旦被 `grant()`，旧版是加到 `S.ammo` 这个镜像上
    （开一枪就被覆写）→ 玩家看到"钱花了、东西没了"。**成交/发放前必须过一遍"id 在不在 ITEMS 里"**，
    货架这种数据表要放 `*-core.ts` 里让单测能钉住（`tests/m32b-ammo-shop.test.ts`）。

---

## 5. 验证流程（照抄就能跑）

```powershell
# 0) 起静态服务（读 dist/，不要用陈旧的 docs/index.html 测本地）
cd E:\Files\Games\zombieSurvival
node tools\serve.mjs --port 8791 --no-open *> _srv.log 2>&1   # 后台常驻

# 1) 类型 + 单测 + 构建
npx tsc --noEmit
npx vitest run          # 应 385 条
npm run build           # 内部会再跑一次 tsc；末尾打印 dist/单文件/docs 三个产物的字节数

# 2) 探针（headless Thorium + CDP；端口按需换）
$exe = 'C:\Users\lenovo\AppData\Local\Thorium\Application\thorium.exe'
Start-Process $exe -ArgumentList '--headless=new','--remote-debugging-port=9449',
  '--user-data-dir=E:\Files\Games\zombieSurvival\docs\_m32_profile','--window-size=2048,1105',
  '--no-first-run','--disable-gpu','about:blank'
Start-Sleep -Seconds 4
foreach ($p in @('_m21_layout_probe','_m25_probe','_m26_res_probe','_m27_tutorial_probe',
                 '_m29_probe','_m30_probe','_m31_probe','_m32_probe','_m32b_probe')) {
  node "docs\$p.mjs" 9449 "http://127.0.0.1:8791/" "docs/_m32_shots" *> "docs\_run_$p.log" 2>&1
  Get-Content "docs\_run_$p.log" -Encoding utf8 | Select-String -Pattern 'ALL PASS|HAS FAIL|通过$' | Select-Object -Last 1
}

# 3) 截图 OCR 复查（零 vision 配额）
node E:\Files\myagent\ocr-vision.mjs docs\_m32_shots\a1_map_float_160.png --tile 4 "<要核对什么>"

# 4) 收尾：同步站点 → 提交 → 推送 → 线上抽查（用 ?v=随机 破缓存）
node tools\sync-site.mjs
git add -A; git commit -F E:\Files\myagent\_commit_xxx.txt; git push
cd E:\Files\bobbychina-pages; git add -A; git commit -m "[AI] M3x 同步：…"; git push
```

单测文件命名：`tests/m<里程碑>-<主题>.test.ts`；探针：`docs/_m<里程碑>_probe.mjs`（**都入库，是证据**）。

---

## 6. 用户的口径与已确认的设计决策（**不要擅自改**）

- **交付节奏**：小步快跑，一批一提交；每批都要能单独验收（他明确说「不需要一次性搞完」）。
- **提需求前先出选择题确认**：他会逐条拍板（M30 就是先出 16 道题）。
- **反作弊口径**：存档/上传全链路加密（M29 已做），但**不做**任何反 DevTools 手段；"导入/导出明文存档"永久下线。
- **健康系统是双轨制**（M31 已确认）：单条 HP 决定生死；部位伤只影响能力 → 不要把生死改成部位制。
- **病症分级可见**：HUD 给数值、人体页给症状文案；湿度舒适区（20~85%）**不给**任何额外惩罚。
- **大区**：危险度/地貌/资源丰度都在（噪声），相邻最多差 1 是硬约束；**不加**高危区硬门槛。
- **M32 字号/地图形态**（用户已认可）：5 档字号整块等比放大；地图住右上角可折叠悬浮窗、任何页签能开；
  探索页整宽留给卡片。**地图那一层 zoom 只能有一层**（见坑 4），宁可地图区域在大字下内部滚一点，也不要格子小到点不准。
- **M32b 经济口径**：弹药按口径/弹种卖，**穿甲弹每发更贵、库存更少**；杂牌弹药折成手上口径的真弹；
  货架/奖励一律"先校验 id、再扣材料/发放"。
- **教程沙盒**（M33）：独立 iframe（真平行世界）+ 6 章 + 混合教学 + 预设伤情/敌人 + 固定假种子 + 进度可恢复。
- **待办（已登记，别自作主张做）**：截肢/断肢长期 debuff、大区事件倾向层、10 天天气预报深化、手机端大格子单指拖动。
- **国庆（2026-10 上旬）计划**：买境外 VPS + 备案域名，把游戏与云存档后端整体自建（沿用现有 `/api/*` 契约与 `ZSV1/ZSV2` 加密）。
  到时候要出迁移清单 + 二次确认流程；`auth-config.js` 里的 `api` 一改即可切换后端。

---

## 7. 三个仓库的收尾纪律

1. **游戏仓库**：`[AI]` 前缀提交 + 推送；`docs/V40-ACCEPTANCE.md` 必须补一节（做了什么 / 实测证据 / 已知问题）。
2. **pages 仓库**：`node tools/sync-site.mjs` 之后再提交（游戏页 + `/games/account.js` 两处）。
3. **日记仓库**（`E:\Files\bobbychina-diary`，私有）：**一天一条**，插在 `entries` 最前面（同一天的多件事**合并进同一条**）；
   `node check-diary.mjs`（禁 ASCII 直引号）→ `node build-viewer.mjs` → 提交推送。
   2026-09-15 那条已经写到 M32b，**今天不要再新开一条**。
4. 提交前 `git status` 复核，只 add 自己的文件（同仓库可能还有别的 agent 在改）。

---

## 8. 现在就能开始的清单（按顺序）

1. 起浏览器把 §5 的九套探针 + 单测跑一遍，确认基线（任何一条红都先查是不是探针自身的前置状态）。
2. **M33 第一批**：教程"章节壳 + 独立 iframe 沙盒 + 第 1 章（生存基础）"，形态见 §6；
   建议先出 3~5 道选择题（沙盒里能不能读主档 / 章节完成判定 / 失败后是重来还是继续）让用户拍板。
3. M33 之后可选：P3 视觉统一（技能页/弹药台还是 legacy 皮）、M32 遗留的"145%/160% 地图区内部滚动"若能顺手收掉更好。
4. 收尾时按 §7 写日记（今天的已写，跨天再补），并可顺手 `update_user_profile`（用户偏好：先给结果、要证据、别客套）。
