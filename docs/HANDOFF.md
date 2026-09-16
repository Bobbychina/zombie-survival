# 丧尸末日生存 v4.0「余烬」—— 接手必知（交接时间：2026-09-15 深夜，M37 无尽修复 + M38 QoL 第一批 已上线）

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
| 测试基线 | **单测 418 通过 / 探针 10 套**（见 §5） |
| 当前 HEAD | `482ba41`（M33 前两批已上线）＋ 本轮的 **M33 第三批：第 3~6 章**（六章全可玩，探针 49/49） |
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

### M33 已完成三批：教程沙盒（章节壳 + 独立 iframe 沙盒 + **六章全部可玩**）

用户拍板的四条：**① 沙盒完全隔离 ② 章节完成判定 = 目标清单全绿 ③ 章内无限重来、不惩罚
④ 分批做章节**（第一批「壳 + iframe + 第 1 章」，第二批第 2 章，第三批第 3~6 章）。

- `src/v4/sandbox-core.ts`（纯逻辑、可单测）：**6 章章节表全部 `ready:true`**、
  `evalChapter`（全绿才算过）、`mergeSticky`（**勾选单调**：吃饱了再睡一觉饿下去，不许把打好的勾收回去）、
  `snapOf`（iframe 出来的快照一律当不可信输入：stats 计数 / 背包 / `load` 装填 / `injuries` 伤病 /
  `base` 据点 / `visited`·`steps`·`regions`·`veh` / `invKinds`）、进度读写、`sandboxUrl`/`labFromSearch`。
- `src/v4/tutorial-lab.ts`（父页面）：整屏覆盖层 = 左列章节 + 中间 iframe + 右列目标清单；
  iframe 每 0.5 秒 postMessage 一份快照，父页面判绿打勾，全绿写本机进度 `zsv-lab-v1` + 「✅ 已通关」徽章。
- **六章内容**（预设种子 / 三条目标）：
  1. 生存基础 `lab-survival-01`：搜刮 2 处 / 深搜 1 次 / 饱食水分到 80 / 睡进第 2 天；
  2. 战斗与枪械 `lab-combat-01`：枪杀 1 只（`kills≥1 && ammoUsed≥1`）/ 近战杀 1 只 / 手动换弹种；
  3. 人体与伤病 `lab-medical-01`：**预设伤情**（小出血 + 骨折）→ 处理出血 / 上夹板 / 睡一觉；
  4. 建造与据点 `lab-base-01`：建净水装置 / 建工作台 / 安全屋睡一觉（预设必须给**胶带**，见下）；
  5. 地图与大区 `lab-world-01`：走 8 格 / 深搜 1 次 / **弄到一辆车**（体能 9 级换行动力上限 17）；
  6. 背包与制作 `lab-bag-01`：制作 1 件 / 手动装填 / 背包 6 种。
- 沙盒预设支持：`base`（据点等级）、`injuries`/`parts`（预设伤情）、`skills`（换行动力上限）、`ap`（按章给）。
- **隔离三条**（要动沙盒代码先读这三条）：iframe 走 `?sandbox=1&ch=…` → legacy `boot()` 走 `bootLab()`
  （不读主档，按预设开一局固定种子的平行世界）；`writeSave()` 头一行 `isLab()` 直接 return
  （**所有落盘都过这一个口子**）；☰ 菜单在沙盒里摘掉存档/读取/回滚/重开/世界账号/教程，`restoreBackup()` 加守卫。
- 探针 `docs/_m33_probe.mjs` **49/49**（本地连跑，真浏览器）：六章逐章用**真实操作**通关
  （点搜索/深搜/使用/回安全屋睡/点招式槽/点装填/人体页急救/据点页建造/走地图/修车/制作），
  六章进度全落 `zsv-lab-v1`、六张章节卡全挂「✅ 已通关」；**隔离实测**：玩完整轮后主档密文一字未变、
  localStorage 只多出进度那一个键、沙盒里 `saveGame/autosave` 也写不动主档。
- 探针顺手逼出两条**产品事实**（不是代码 bug，是设计）：
  ① **跨大区必须有车**（大区面板明写"没有载具：跨区得开车"）→ 第 5 章目标从"跨一次区"改成"弄到一辆车"；
  ② 净水装置与工作台**都要胶带** → 第 4 章预设补 `tape×4`（否则按钮是禁用态，探针表现为"点了没反应"）。
- 上线方式：源码提交 → `git archive HEAD` 到临时目录 + junction `node_modules` 干净构建 → 产物提交 →
  `sync-site` → pages 提交；**这样不会把同仓别的会话未提交的源码发上线**。

### 下一批

0. **M45 已完成并上线**（用户当场报障：「有重复的」）：探索页「日历」整块出现两次。
   根因 = `world-ui.adoptLegacy()` 里 `.sect-title` 连带认领的 `.card` **还在待认领名单里**（名单是认领前拍的快照），
   于是被包装第二遍，标题退化成兜底档「📋 + 正文前 12 字」（截图里那张「📅 🩸 血月 2 天后 ⚡」）。
   修法 = 纯函数 `claimPlan()`（新 `src/v4/card-wall-core.ts`）保证每个 legacy 节点只被认领一次；
   顺带给 M38 补给快捷条加 `v4quick` 类，标题不再退化成「📋 ⌨️ 补给快捷（键盘数字」。
   证据：`tests/m45-card-wall.test.ts` 11 例（含"没有节点被认领两次/漏认"不变量）+ `docs/_m45_probe.mjs`
   修复前 3/7（日历 count=2）→ 修复后 7/7（本地 + 线上都跑过）；全量单测 597/597；回归 m37/m38/m40/m43 全绿。
   ⚠️ **`tools/sync-site.mjs` 读的是仓库里的 `dist/index.html`**（不是 `docs/index.html`）——
   别的会话正在同仓构建时，sync 会把**他们的**产物发上线。发布前先把自己的 HEAD 产物盖进 `dist/` 再 sync。

1. **M41~M43 已完成并上线**（都是用户当场报障）：
   - **M41** 地图不再吃满主区域（用户：「为何整个地图占了整个行动主区域」）：命中区只当上限、`fitCellSize` 让"一屏装下"优先；
   - **M42** 账号库副本"解不开"不再每 15 秒刷屏（用户：「什么鬼」）：`unreadablePolicy` 只警告一次 + 用当前进度自愈重建；
   - **M43** 每次行动后内容不再跳回顶部（用户：「为啥每次行动后滚动会自动回到顶上」）：
     新增 `src/v4/scroll-keep.ts`，`render()` 同页签保留偏移/换页签回顶；日志面板只在贴底时跟着滚。
   ⚠️ **同仓并发构建坑（真踩了）**：干净构建的临时目录 `E:\Files\myagent\_zsvbuild` 是**共享**的 ——
   另一个会话同时做 M44 时两边互相覆盖，一度把"不含 M43 的产物"推上线。**各用独立目录**（例如 `_zsvb_m43b`），
   发布前用行为探针对着该目录的产物跑一遍（不是看文件名/大小）。发布建议基于 **HEAD**（含双方已提交内容）重建。

1. **M37 已完成（玩家报障 P0）**：通关好结局 → 进无尽模式"直接死 + 地图变旧版"。
   根因是 `rescueEnding()`（第 100 天好结局）和 `gameOver()` 都把 `S.over = true`，而 `enterEndless()` 没清它；
   `S.over` 是 v4 世界层的总闸（`world-ui mountWorld` 的 `if (!S || S.over)` 整块退出渲染 → 卡片墙/地图消失，
   `travel/search/nightTick` 全部 early-return → 动不了）。修法：新 `src/v4/endless-core.ts`（`resumeFromOver()` 清 over +
   补行动力 + 血为 0 救回三成、`endDayLabel/endGoalChip/overHint`），`enterEndless()` 调它。
   验收：`tests/m37-endless.test.ts` 15 例 + `docs/_m37_probe.mjs` 24/24（本地 + 线上）。
2. **M38 / M39 / M40 三批 QoL 全部完成并上线**（用户从 15 项清单里勾的 10 项）：
   - M38：背包筛选 / 「丢1」·「全丢×N」/ 储物箱"能塞多少塞多少" + 批量存入 / 探索补给快捷键 1-4 / 战斗「重复上次（R）」
     （`src/v4/qol-core.ts`，`tests/m38-qol.test.ts` 18 例，`docs/_m38_probe.mjs` 18/18）
   - M39：商人批量购买（`buyPlan`）/ 口令加密导出导入（`src/v4/save-port-core.ts`，PBKDF2 15 万 + AES-GCM）/
     多份备份历史（`src/v4/backup-core.ts` + save-vault，6 份轮转 + 指定回滚）
     （`tests/m39-qol.test.ts` 29 例，`docs/_m39_probe.mjs` 24/24）
   - M40：地图悬浮窗内滚（删 158px 写死常量、窗里只留一个滚动容器）/ 字号 zoom 提到 `#view`（全页签 + 折叠条 + 沙盒）/
     手机单指拖动 + 触控命中区 30px（`cellTargets`）
     （`tests/m40-layout.test.ts` 13 例，`docs/_m40_probe.mjs` 13/13）
   - 顺手修掉两个 P0：**刷新一次弹药翻倍**（`sanitizeSave` 把装填镜像当旧版弹药池折算 → `ammo-core.legacyAmmoFold` 加判据）、
     无尽模式那个（见上）。
3. **还没做的教程项**：第 2 章"穿甲弹打死装甲目标"的硬验证（要新计数器）、第 5 章"真的开出去跨一次区"的探针
   （慢且飘，价值一般）、沙盒"按章硬解锁"（现在只有建议顺序）。
4. **同仓多 agent**：这个仓库长期有别的会话在改（M34 地图摆法 / M35 搜刮记账 / M36 完整性 / M36.1…）。
   提交前 `git status` 逐个看，**只 add 自己的文件**；同一个文件两边都改了就用 hunk 级暂存
   （`git diff -- file | Out-File -Encoding utf8 p.patch` → `node E:\Files\myagent\pick-hunks.mjs p.patch 1,2,4 keep.patch`
   → `git apply --cached keep.patch`）。文档这类"两人同时往末尾追加"的文件，用
   `git show HEAD:docs/V40-ACCEPTANCE.md > head.md` → 只把自己那段接上去 → `git hash-object -w` →
   `git update-index --cacheinfo`（M37~M40 四节都是这么提交的，脚本 `E:\Files\myagent\_append_sec.mjs`）。
   **别 `git add -A`**：构建产物里会混进别人未提交的源码。
5. **探针端口会被别人抢**：多个会话同时跑 `tools\serve.mjs --port 8791` 时会顺延端口，别人的"清理 node 进程"
   也可能把你那个杀掉（本轮跑一半 8791 就没了 → 探针报 `SecurityError: localStorage`）。
   探针起在**自己独占的端口**上（本轮用 8797/8798），并在开头确保主档存在（M33 探针已这么做）。
6. **探针状态会互相污染**（本轮踩了三次，已加固）：地图**摆法**（`V4Scale.setMapStyle`）与**模式**
   （`V4World.mapMode`）都是本机偏好，上一支探针留下的值会让下一支量错东西 ——
   检查页内布局的探针开场要 `setMapStyle('inline')`，量 `.wcell` 的要 `mapMode('local')`（M21/M26/M32 已加）。
7. **线上探针要等引导**（M37 起）：本地 `sleep(4200)` 够，线上要 `bootWait()` 轮询
   （固定 sleep 会撞 `ReferenceError: closeAllModals is not defined`）；`?v=` 破缓存对 Pages 边缓存无效，
   用 `curl.exe -s --max-time 40 -o file <url>` 轮询"新串是否存在"来判传播（`Invoke-WebRequest` 本机常超时）。
8. **本机进度键**（`zsv-lab-v1` 之类）会让探针"上一次跑过"变成前置状态：跑 M33 探针前它会自己清掉；
   自己写新探针时注意同类问题（教程键 `dsh.tutorial.*` 也一样）。
9. **战斗探针的坑**：玩家死在战斗里会让 `b.over='lose'`，之后 `repeat()/move()` 全部静默 no-op——
   探针里先把 `S.hp/S.hpMax` 拉满再 `startCombat`，否则断言全是假 PASS/FAIL（本轮踩过）。
10. **合成触摸手势**：`Input.synthesizeScrollGesture` 在带 `touch-action` 的嵌套容器上实测**不动**
    （scrollLeft 一直 0）；要测"单指拖动"就用 `Input.dispatchTouchEvent` 手搓 touchStart → N×touchMove → touchEnd
    （并且 xDistance 方向要对：从右上往左下推 = scrollLeft 增大）。
### 回归基线（2026-09-15 深夜实测，全部本地）

```
_m21_layout_probe 31/31 · _m25_probe 33/33 · _m26_res_probe（15 档分辨率表，问题组合为空）
_m27_tutorial_probe 12/12 · _m29_probe 23/23 · _m30_probe 20/20 · _m31_probe 15/15
_m32_probe 17/17 · _m32b_probe 19/19 · _m33_probe 56/56
_m37_probe 24/24（无尽修复） · _m38_probe 18/18（QoL 第一批）
_m39_probe 24/24（商人批量/口令导出/备份历史） · _m40_probe 14/14（地图窗/字号/手机触控）
_m43_probe 8/8（行动后滚动不跳顶） · _m45_probe 7/7（探索页不再重复卡片）
单测 597/597（42 文件）
```

> 探针是**有状态**的（共用同一个浏览器 profile + 同一份存档）：读档会恢复"上次停在哪一页"，
> 所以每套探针开头都该自己 `setTab('explore')` 之类的把前置条件摆好；换端口跑 = 换了 origin，
> 存档是空的 —— M33 探针会先确保主档存在再留指纹（否则"隔离"验的是空气）。
> `_m30_probe` 的"闷湿+偏凉→呼吸道感染"偶发红（概率判定），复跑即绿；
> `_m32_probe` 的"悬浮窗里的地图画出来了"在多探针连跑时偶发 `cells=0`（单独跑三次都 17/17），
> 探针已打印"地图首帧等待 Nms"便于定位。
> **探针里跨 iframe 的坑**：`lab()` 这类包装函数的函数体是在**父页面**上下文执行的，
> 沙盒里的全局必须写 `W.xxx`（裸 `DEV` 拿到的是父页面那份，踩过）。

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

1. 起浏览器把 §5 的十套探针 + 单测跑一遍（探针的 outDir 先建好，见 §3「下一批」4），确认基线（任何一条红都先查是不是探针自身的前置状态）。
2. **M33 第三批**：第 3~6 章（章节表已留好 `ready:false` 的位置，补 objectives + preset 即可）。
3. **构建产物/上线**：`npm run build` + `node tools/sync-site.mjs` 要在**工作区没有别人未提交的源码**时做
   （或用 `git worktree` + junction `node_modules` 从 HEAD 干净构建再拷产物回来）——否则会把别人的半成品一起发上线。
4. 之后可选：P3 视觉统一（技能页/弹药台还是 legacy 皮）、M32 遗留的"145%/160% 地图区内部滚动"。
5. 收尾时按 §7 写日记（2026-09-15 那条已经写到 M33，跨天再新开），并可顺手 `update_user_profile`
   （用户偏好：先给结果、要证据、别客套）。
