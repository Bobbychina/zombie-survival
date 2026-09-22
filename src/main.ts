/* v4.0 入口：先加载 legacy 底座（它自带全局导出垫片），再挂 v4 模块并接管对应系统。
   本步接管的是「战斗」：把 window.startCombat 换成宝可梦式回合制引擎 + 新界面。 */
import './styles/game.css';
import './styles/v4.css';
import './styles/tutorial.css';
import './legacy/game.ts';
// M8：账号库（原生 JS，同一份文件也被 bobbychina.github.io/games 大厅用 <script> 引用——
// 打进这里是为了让单文件离线版也能注册/登录/存本地档，云同步当然还是要联网）
import './account/account.js';

/** legacy 底座通过垫片挂在 window 上的 API（新模块统一从这里取） */
export interface LegacyApi {
  S: any;
  battle: any;
  log(msg: string, type?: string): void;
  render(): void;
  addItem(id: string, n?: number, silent?: boolean): void;
  takeItem(id: string, n?: number): boolean;
  itemCount(id: string): number;
  addXP(sk: string, n: number): void;
  grant(id: string, n?: number, silent?: boolean): void;
  boot(): void;
  [k: string]: any;
}
export const L = window as unknown as LegacyApi;
export const V4: Record<string, unknown> = {};
(window as any).V4 = V4;

async function main() {
  const [worldgen, pois, combat, moves, battleUi, worldUi, worldState, camp, night, evac, env, farm, gather, water, accountUi, integrity, betaNotice, regionEventsCore, regionEvents, regionsCore, worldsUi, tutorial, saveVault, accountVault, survival, envCore, medical, uiScale, sandboxCore, tutorialLab, bridge, interiorCore, interiorUi] = await Promise.all([
    import('./v4/worldgen'),
    import('./v4/pois'),
    import('./v4/combat'),
    import('./v4/moves'),
    import('./v4/battle-ui'),
    import('./v4/world-ui'),
    import('./v4/worldstate'),
    import('./v4/camp'),
    import('./v4/night'),
    import('./v4/evac'),
    import('./v4/env'),
    import('./v4/farm'),
    import('./v4/gather'),
    import('./v4/water'),
    import('./v4/account-ui'),
    import('./v4/integrity'),
    import('./v4/beta-notice'),
    import('./v4/region-events-core'),
    import('./v4/region-events'),
    import('./v4/regions-core'),
    import('./v4/worlds-ui'),
    import('./v4/tutorial'),
    import('./v4/save-vault'),
    import('./v4/account-vault'),
    import('./v4/survival'),
    import('./v4/env-core'),
    import('./v4/medical'),
    import('./v4/ui-scale'),
    import('./v4/sandbox-core'),
    import('./v4/tutorial-lab'),
    import('./v4/bridge'),          // M64：探针出口要用（playerProfile / onEnd），顺带把模块提到这里的懒加载清单
    import('./v4/interior-core'),   // M66：建筑内部（平面图 + 锁门 + 房间掉落）
    import('./v4/interior-ui'),
  ]);
  /* M33：教程沙盒 —— iframe 里跑的就是这一份代码，靠 `?sandbox=1` 分岔：
     不读主档（boot 走沙盒分支）、不落盘（writeSave 直接 return）、不弹教程、菜单里没有世界/账号。
     必须在 boot 之前就把预设交给 legacy（那边只负责套用，判定逻辑在 sandbox-core）。 */
  const LAB = sandboxCore.labFromSearch(location.search);
  if (LAB) {
    const st = sandboxCore.labStateOf(LAB.ch);
    (window as any).__ZSV_LAB = { ch: LAB.ch, seed: st.seed, preset: st.preset };
  }
  (window as any).V4Lab = tutorialLab.V4Lab;
  Object.assign(V4, { sandbox: { LAB_CHAPTERS: sandboxCore.LAB_CHAPTERS, labFromSearch: sandboxCore.labFromSearch, snapOf: sandboxCore.snapOf } });
  /* M8：存档完整性——boot 之前看的原始存档（沙盒里不看：那是别人的档） */
  let preVerdict: unknown = null;
  // BETA 声明条：整站/整游戏最上面那一条（本站所有子页面都要有）
  betaNotice.installBetaNotice();
  const { REGION_EVENTS } = regionEventsCore;
  const { applyRegionEvent } = regionEvents;
  const { regionById } = regionsCore;
  const ghosts = await import('./v4/ghosts');
  const ghostCore = await import('./v4/ghosts-core');
  const telemetry = await import('./v4/telemetry-core');
  const shareCore = await import('./v4/share-core');
  Object.assign(V4, {
    worldgen: { generateWorld: worldgen.generateWorld, WORLD_W: worldgen.WORLD_W, WORLD_H: worldgen.WORLD_H },
    POIS: pois.POIS,
    combat,
    moves,
    battle: { startV4Combat: battleUi.startV4Combat, isOpen: battleUi.isV4BattleOpen },
    UI: battleUi.V4UI,
    world: worldUi.V4World,
    interior: interiorUi.V4Interior,
    worldstate: worldState,
    camp: camp.V4Camp,
    night,
    evac,
    env,
    farm,
    gather,
    npc: await import('./v4/npc'),
    quest4: await import('./v4/quest4'),
    quests: await import('./v4/quests'),
    endings: await import('./v4/endings'),
  });
  /* M13：委托（接单制）+ 大故事（章节制）。legacy 里那几个桥（rollBounties / bountyTick /
     renderBounties）和任务页渲染都按这几个名字取函数——名字必须与 quests.ts 的导出一致。 */
  const quests = (V4 as any).quests as typeof import('./v4/quests');
  (window as any).V4Quest = {
    accept: quests.accept, abandon: quests.abandon, choose: quests.choose, summary: quests.summary,
    storyHtml: quests.storyHtml, contractsHtml: quests.contractsHtml, teaser: quests.teaser,
    newDay: quests.newDay, tick: quests.tick,
  };
  (window as any).__v4QuestNewDay = quests.newDay;
  (window as any).__v4QuestTick = quests.tick;
  (window as any).__v4StoryHtml = quests.storyHtml;
  (window as any).__v4ContractsHtml = quests.contractsHtml;
  (window as any).__v4QuestTeaser = quests.teaser;
  /* M15：多结局。legacy 的 finalVictory / rescueEnding / gameOver / enterEndless 各调一次，
     任务页用 __v4EndingsHtml 铺"结局档案"。 */
  const endings = (V4 as any).endings as typeof import('./v4/endings');
  (window as any).__v4Ending = (kind: string, extra?: { inLab?: boolean }) => endings.showEnding(kind as any, extra);
  (window as any).__v4EndingsHtml = endings.endingsHtml;
  (window as any).V4Endings = {
    show: endings.showEnding, list: endings.V4Endings.list, html: endings.endingsHtml,
    peek: endings.peekEnding, all: endings.V4Endings.all,
  };
  // 内联 onclick 只认 window 上的名字：今夜（过夜）与撤离
  (window as any).V4Night = { rest: night.rest, options: night.restOptions, apMaxOf: night.apMaxOf,
    /* M25.2：行动力上限 = 睡眠债 + 体能加成 —— 探针与将来的 UI 都从这里取，别只挂 apMaxOf */
    apCapOf: night.apCapOf, fitnessApBonus: night.fitnessApBonus, syncApMax: night.syncApMax };
  /* M20：世界管理 / 挑战码 / 幽灵据点 / 开发者统计（一个面板） */
  (window as any).V4Worlds = worldsUi.V4Worlds;
  worldsUi.ensureWorlds();
  /* M20：死亡与结局都记一笔台账（**只存本机**，玩家点导出才离开这台机器）。
     legacy 的 gameOver 是所有死亡路径的汇聚点（战斗/搜刮/落水/感染…），所以在这里包一层。 */
  const wireRunLog = () => {
    const origGameOver = L.gameOver;
    if (typeof origGameOver !== 'function' || (L as any).__runLogWired) return;
    (L as any).__runLogWired = true;
    L.gameOver = (msg?: string, opts?: any) => {
      try {
        const s = L.S as any;
        const sw2 = worldState.ensureSaveWorld(s);
        const def = regionsCore.regionById(sw2.region);
        worldsUi.recordRun({
          kind: 'death', day: Math.max(1, Number(s.day) || 1), cause: String(msg || '死亡').slice(0, 60),
          region: sw2.region, rtype: (def?.type ?? '') as any, tier: def?.tier ?? 1,
          kills: Number(s.stats?.kills) || 0, mat: Number(s.mat) || 0, at: Date.now(),
        });
        worldsUi.syncActive();
      } catch (e) { console.warn('[v4] 记录死亡台账失败', e); }
      return origGameOver.call(L, msg, opts);
    };
  };
  wireRunLog();
  (window as any).V4Farm = { plant: farm.plant, harvest: farm.harvest, plots: farm.plotSlots, summary: farm.farmSummary };
  (window as any).V4Gather = { forage: gather.forage, salvage: gather.salvage, chop: gather.chop };
  (window as any).V4Water = { fish: water.fish, intake: water.intake, dive: water.dive, swim: worldUi.V4World.swim, pond: water.pondSummary };
  // 账号与云存档（内联 onclick 用；函数名与 account-ui.ts 导出保持一致）
  (window as any).V4Account = {
    open: accountUi.openPanel, summary: accountUi.accountSummary,
    /* M23：账号 = GitHub。登录只有两条路（设备码 / 令牌码），**没有注册** */
    loginDevice: accountUi.loginDevice, loginRemembered: accountUi.loginRemembered,
    legacyLogin: accountUi.legacyLogin, legacyDoLogin: accountUi.doLogin,
    doLogin: accountUi.doLogin, logout: accountUi.logout,
    showRecover: accountUi.showRecover, doRecover: accountUi.doRecover,
    setupRecovery: accountUi.setupRecovery, copyRecovery: accountUi.copyRecovery,
    bindGitHubToken: accountUi.bindGitHubToken, openTokenBind: accountUi.openTokenBind,
    bindMicrosoft: accountUi.bindMicrosoft, unbind: accountUi.unbind,
    push: accountUi.push, pull: accountUi.pull, sync: accountUi.sync, toggleAuto: accountUi.toggleAuto,
    /* M29：exportAll / importAll / exportFile / importFile 全部下线 —— 见 account-ui.ts 的注释 */
    unlock: accountUi.unlock, doUnlock: accountUi.doUnlock,
    changePass: accountUi.changePass, doChangePass: accountUi.doChangePass, del: accountUi.del, doDelete: accountUi.doDelete,
  };
  (V4 as any).account = accountUi;
  // 存档完整性（内联 onclick / 探针用）
  (V4 as any).integrity = integrity;
  (window as any).V4Integrity = {
    summary: integrity.integritySummary, tampered: integrity.isTampered,
    verdict: integrity.lastVerdictOf, verdictOf: integrity.verifyForeign,
    preBootVerdict: () => preVerdict,
  };
  accountUi.subscribeAutoSync();

  // 接管战斗：legacy 的遭遇/守夜战/最终决战都会走到这里
  // 两条入口都要接：window.startCombat（内联 onclick / v4 自己调用）和 __v4StartCombat（legacy 内部直接调 startCombat）
  const legacyStart = L.startCombat;
  L.startCombat = (foes: any[], opts: any) => battleUi.startV4Combat(foes, opts ?? {});
  (window as any).startCombat = L.startCombat;
  (window as any).__v4StartCombat = L.startCombat;
  L.__legacyStartCombat = legacyStart;
  // 界面里的内联 onclick 只能看到 window 上的名字（V4UI.target/move/flee...）
  (window as any).V4UI = battleUi.V4UI;
  (V4 as any).UI = battleUi.V4UI;

  // 键盘：战斗中用 1-4 出招、5 逃、6 换武器（捕获阶段抢先，避免 legacy 的按键处理插手）
  document.addEventListener('keydown', e => {
    if (!battleUi.isV4BattleOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); return; }
    const t = e.target as HTMLElement | null;
    if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
    if (battleUi.V4UI.key(e)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // 大世界：把 legacy 的探索页接上 24×24 区块地图（地图卡插到 #view 最前面，并摘掉 legacy 的旧地图与区域列表）
  (window as any).V4World = worldUi.V4World;
  /* M66：建筑内部（平面图）—— 格子详情卡的「🚪 进楼搜房」按这个名字走内联 onclick */
  (window as any).V4Interior = interiorUi.V4Interior;
  /* M26：☰ 菜单（legacy 的 openMenu）要借 v4 的按钮 HTML 渲染「世界与账号」分区 —— 内联 onclick 只认 window 名字 */
  (window as any).__v4ToolsButtons = worldUi.toolsButtonsHtml;
  /* M27：新手教程 —— 第一次进游戏自动弹（看完了不再自动弹），菜单里也能重看 */
  (window as any).V4Tutorial = tutorial.V4Tutorial;
  (window as any).__v4TutorialBattleTip = tutorial.maybeBattleTip;
  (window as any).V4Camp = camp.V4Camp;
  // M6：季节/天气/体温的最小 HUD（挂在顶栏 chips 里，不动地图面板结构）
  // M30：湿度 / 淋湿 / 病症也挂在这里（数值在 survival-core，运行时在 survival.ts）
  /* 注意：legacy 的 renderHud() 会**整块重写** #hud 的 innerHTML —— 只"添加一次"的写法会被下一次
     渲染抹掉（实测第一版就是这样：mountWorld 里塞进去的 .v4-env 在首次 render 后就不见了）。
     所以这里既补内容、也用 MutationObserver 盯着 #hud，legacy 每次重画都把我们这一块补回去。 */
  const paintEnv = () => {
    try {
      const hud = document.getElementById('hud');
      if (!hud) return;
      /* M50：体温/湿度/淋湿/病症的 chips 搬进「人体」subpage 了（用户：「把所有的体温啊病情啊啥的
         都移到人体 subpage 内」），HUD 不再插这一块。壳留着 —— 以后想在顶栏恢复只改这一行。 */
      const chips = '';
      const inner = hud.querySelector<HTMLElement>('.hud-chips');
      const host: HTMLElement = inner ?? hud;
      let env0 = hud.querySelector<HTMLElement>('.v4-env');
      if (!env0) {
        env0 = document.createElement('span');
        env0.className = 'v4-env';
        host.appendChild(env0);
      } else if (env0.parentElement !== host) {
        host.appendChild(env0);
      }
      if (chips && env0.innerHTML !== chips) env0.innerHTML = chips;
      return true;
    } catch (e) { console.warn('[v4] 环境 HUD 挂载失败', e); return false; }
  };
  const hudEl = document.getElementById('hud') as (HTMLElement & { __v4Patched?: boolean }) | null;
  if (hudEl) {
    /* 关键：legacy 的 renderHud() 每次都是 `$('#hud').innerHTML = h` —— **整块重写**。
       所以"渲染完再 append"这种写法必然被下一次重写抹掉（实测：MutationObserver 版本在探针里
       反复 MISSING）。真正稳的做法是在赋值那一刻就把我们这段 HTML 拼进去（synchronous，不靠时序）。
       副作用几乎为零：只拦 #hud 这一个元素的 innerHTML。M50 起这段 chips 为空（见上）。 */
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (proto && proto.set && proto.get) {
      Object.defineProperty(hudEl, 'innerHTML', {
        configurable: true,
        get() { return proto.get!.call(this); },
        set(v: string) {
          let out = String(v);
          try {
            const chips = '';
            if (chips) out = out.replace('</div>', '</div><span class="v4-env">' + chips + '</span>');
          } catch { /* HUD 少一条 chip 不该让整屏挂掉 */ }
          proto.set!.call(this, out);
        },
      });
      hudEl.__v4Patched = true;
    }
    paintEnv();                                   // 首屏（自动读档那条路）也补一次
  }
  const mountWorld = () => {
    try { worldUi.mountWorldPanel(); } catch (e) { console.error('[v4] 世界地图挂载失败', e); }
    paintEnv();
  };
  // legacy 内部调 render() 不会经过 window.render，所以用观察器兜底：探索页每次重画都把我这块补回去
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => mountWorld()).observe(view, { childList: true });
  // 窗口尺寸变了要重算地图格子（fitMap 会按可用高度重新定格子边长）
  window.addEventListener('resize', () => mountWorld());

  /* M29：存档保险箱先行 —— worker 里生成/取出 AES-GCM-256 密钥（不可导出），
     把磁盘上的密文解进内存；legacy 的 boot() 是同步流程，所以必须在它之前 hydrate。 */
  const vaultState = await saveVault.SaveVault.init();
  (window as any).V4Vault = saveVault.SaveVault;
  /* M29：账号库那条链路（本机记录 / GitHub Gist / OneDrive）也走同一把 worker 密钥加密 —— */
  accountVault.initAccountVault();
  (window as any).V4AccountVault = { status: accountVault.accountVaultStatus, warmUp: accountVault.warmUp };
  /* M30：湿度 / 淋湿 / 病症链 —— legacy 与 env.ts 通过 window.V4Survival 读写。
     名字必须与调用方**逐字一致**：叫错一个的后果不是"少个 chip"，而是整屏挂掉 ——
     探针实测撞了两次（`e.penaltyNow is not a function` → render() 走 catch 分支换成"界面渲染出错"；
     `window.V4Survival.survivalLine is not a function` → 世界地图与环境 HUD 一起挂）。
     所以这里显式写全，**不用简写别名**（survivalLine / survivalChips / forecastLines…）。 */
  (window as any).V4Survival = {
    step: survival.step, nightStep: survival.nightStep, status: survival.survivalStatus,
    chips: survival.survivalChips, survivalChips: survival.survivalChips,
    line: survival.survivalLine, survivalLine: survival.survivalLine, riskLine: survival.riskLine,
    humidityNow: survival.humidityNow, wetNow: survival.wetNow, condsNow: survival.condsNow, hasCond: survival.hasCond,
    penaltyNow: survival.penaltyNow, staCapMul: survival.staCapMul, vitalsMul: survival.vitalsMul,
    condNames: survival.condNames, forecastLines: survival.forecastLines,
    drinkGain: survival.drinkGain, fireOk: survival.fireOk, rotMul: survival.rotMul, refreshHum: survival.refreshHum,
    /* M50：病症的主动治疗（人体页按钮 / 背包吃药 / 探针都走这三个名字） */
    condRows: survival.condRows, treat: survival.treatCond, treatByItem: survival.treatByItem,
    condStatus: survival.condStatus, humNow: survival.humNow,
  };
  (V4 as any).survival = survival;
  /* M31：人体与伤病（分页 + 战斗钩子 + 走路成本 + 治疗）—— legacy 通过 window.V4Medical 调 */
  (window as any).V4Medical = {
    renderTab: medical.renderTab, pick: medical.pick, treat: medical.treatPart,
    stepBody: medical.stepBody, nightBody: medical.nightBody, onPlayerHurt: medical.onPlayerHurt,
    status: medical.bodyStatus, penaltyNow: medical.bodyPenaltyNow, bodyPenaltyNow: medical.bodyPenaltyNow,
    travelExtra: medical.bodyTravelExtra, hudLine: medical.bodyHudLine, bodyNow: medical.bodyNow,
    /* M69：感染链 —— 人体页/HUD/探针读同一行总览；夜晚结算走 window.__v4InfectNight（legacy 那边调） */
    infection: medical.infectionStatus, infectNight: medical.infectNightHook,
    guideHtml: medical.guideHtml,                  // M50：治疗指南（图鉴 → 📘 治疗指南）
  };
  /* M50：图鉴里的「治疗指南」由 v4 渲染（legacy 的 renderCodex 只留一个调用点） */
  (window as any).__v4GuideHtml = medical.guideHtml;
  (V4 as any).medical = medical;
  /* M32：字号适配 + 地图悬浮窗（顶栏 🗺️、☰ 菜单里的 A−/A+、快捷键 Ctrl±/M 都走这里）
     M34：地图摆法（悬浮窗 / 嵌入页内）也在这一份里 —— ☰ → 显示 → 地图位置 */
  (window as any).V4Scale = {
    step: uiScale.stepFsBtn, set: uiScale.setFs, name: uiScale.fsName, prefs: uiScale.uiPrefs,
    toggleMap: uiScale.toggleMap, mapOpen: uiScale.mapOpenNow, paintMap: uiScale.paintMapOverlay,
    buttons: uiScale.scaleButtonsHtml, status: uiScale.scaleStatusNow,
    applyCardsZoom: uiScale.applyCardsZoom,        // mountWorldPanel 每次重建卡片墙后都要补一次
    zoomNow: uiScale.zoomNow,                      // M32.1：fitMap/fitRegion 按它把像素下限折回渲染尺寸
    mapStyle: uiScale.mapStyleNow,                  // M34：当前摆法
    setMapStyle: uiScale.setMapStyle,               // M34：切换摆法（☰ 菜单两个按钮调它）
    mapStyleNote: uiScale.mapStyleNoteNow,          // M34：说明文案（☰ 菜单/世界与账号分区共用）
    paintMapTop: uiScale.paintMapTop,               // M34.1：按实测顶栏底边写 --v4-maptop（别写死 52px）
  };
  (V4 as any).uiScale = uiScale;
  uiScale.applyScale();
  /* 探针/调试用的纯函数出口（只在本地探针里读，游戏逻辑不依赖它）
     M64：审计探针要能核对"UI 上写的惩罚到底进没进战斗数值"（statMods → playerProfile → 引擎），
     以及战斗结算记账（onEnd）—— 都是只读/纯函数出口。 */
  (window as any).V4Debug = Object.assign((window as any).V4Debug || {}, {
    salvageYields: envCore.salvageYields, regionById: regionsCore.regionById,
    statMods: L.statMods, playerProfile: bridge.playerProfile, onEnd: bridge.onEnd,
    // M66：建筑内部 —— 探针要能核对"平面图长什么样、房间锁/进度"而不去解析 DOM 文本
    interiorHost: interiorCore.interiorHost, interiorPlan: interiorCore.buildInterior,
    interiorSummary: interiorCore.summary, interiorOpen: interiorCore.openDecision,
    // M68：身体状态接到动作上 —— 探针要能量"手臂伤后搜刮产出打折、头伤后视野少一圈"
    scavMulOf: medical.scavMulOf, headVisionLoss: medical.headVisionLoss, scoutRadius: worldState.scoutRadius,
    // M69：感染链 —— 探针要能核对"伤口过夜感染不消退而是 +4/处、抗生素能压住当晚"
    infectNight: medical.infectNightHook, infectionLine: medical.infectionStatus,
  });
  /* M8：存档完整性——必须在 L.boot() 读档之前看原始 JSON（loadGame 会 sanitize，夹取之后就查不出越界了）。
     M33：沙盒 iframe 里不做这套（那里压根不读主档，指纹校验会读出一个"别人的档"来）。 */
  if (!LAB) { preVerdict = integrity.inspectBeforeBoot(); integrity.installWriteHook(); }
  L.boot();
  if (!LAB) integrity.reportAfterBoot();
  if (!LAB) {
    if (vaultState.mode === 'main-thread') L.log('🔐 存档加密：worker 不可用，已降级成主线程 AES-GCM（存档同样不是明文）。', 'dim');
    else if (vaultState.mode === 'worker') L.log('🔐 存档已加密（AES-GCM-256，密钥只在本机 worker 里，不可导出）。', 'dim');
    if (vaultState.lastError) L.log('⚠️ 保险箱初始化有问题：' + vaultState.lastError, 'danger');
  }
  /* M15.1：地图重画（世界生成器版本变了）。BETA 阶段地形会随生成器更新而变，
     存档里保留人物进度、清掉按坐标记的地形进度——这事必须告诉玩家，否则会以为丢档了。 */
  if (worldState.takeWorldMigration()) {
    L.log('🗺️ BETA：地图生成器更新了，这个世界重画了一遍。', 'system');
    L.log('　 你的人物/背包/材料/据点/天数/任务都还在；探索过的格子、POI 剩余次数、营地库存与地图情报重置了（它们按坐标存，地形一换就对不上）。', 'info');
    L.toast('地图已重画', 'BETA 阶段地形会随生成器更新而变，人物进度保留。', 'info');
  }
  mountWorld();
  L.log('🧪 v4 引擎已接管战斗：4 招式槽 / 速度出手 / 属性克制。', 'info');
  /* M32：地图悬浮窗与字号都在 boot 之后再落一次 —— #hud/#topbar 这时候才齐，
     顶栏那个 🗺️ 按钮也才有地方插（ensureMapWindow 是幂等的）。 */
  try { worldUi.ensureMapWindow(); uiScale.applyScale(); uiScale.paintMapOverlay(); } catch (e) { console.warn('[v4] 界面适配初始化失败', e); }
  /* M32 快捷键：Ctrl + / − / 0 调字号，M 开关地图（输入框里打字时不抢键） */
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); uiScale.stepFsBtn(1); return; }
    if (e.ctrlKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); uiScale.stepFsBtn(-1); return; }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); uiScale.setFs(100); return; }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault(); uiScale.toggleMap();
    }
  });
  /* M27 新手教程：第一次进游戏自动弹一次（看完/跳过之后不再自动弹；☰ 菜单里随时能重看）。
     ?dev=ready 这类开发钩子不弹，免得探针每次都被挡住。M33：沙盒 iframe 里也不弹
     （沙盒本身就是教学，再套一层高亮会打架），改成每 0.5 秒给父页面报一份快照。 */
  const devFlags = String(new URLSearchParams(location.search).get('dev') || '');
  if (LAB) {
    const post = () => {
      try {
        if (window.parent === window) return;
        window.parent.postMessage({ __zsvLab: 1, type: 'snap', snap: sandboxCore.snapOf(L.S) }, '*');
      } catch { /* 跨窗口失败不该影响游戏 */ }
    };
    window.addEventListener('message', (e: MessageEvent) => {
      const d: any = e.data;
      if (d && d.__zsvLab === 1 && d.type === 'ping') post();
    });
    setInterval(post, 500);
    setTimeout(post, 400);
    L.log('🧪 教程沙盒：这是 iframe 里的平行世界 —— 不读主档、不落盘、死了不惩罚。', 'system');
  } else if (!devFlags.includes('ready') && !devFlags.includes('fresh')) {
    setTimeout(() => {
      try {
        tutorial.maybeAutoStartTutorial();
        L.log('[教程] 自动启动检查完成（根节点=' + (document.getElementById('v4tut') ? '有' : '无') + '）', 'dim');
      } catch (e) {
        console.warn('[v4] 教程启动失败', e);
        L.log('[教程] 启动失败：' + (e && (e as Error).message ? (e as Error).message : e), 'danger');
      }
    }, 900);
  }
  // file:// 直开时存档只落在本浏览器：给一句提示，免得换个浏览器以为存档丢了
  if (location.protocol === 'file:') {
    L.log('💾 直接双击打开的（file://）：存档写在本浏览器本地，换浏览器或清缓存会丢；想更稳可以跑 start.bat 起本地服务。', 'dim');
  }

  runDevHook(battleUi, worldState, regionById, REGION_EVENTS as any, applyRegionEvent, {
    worlds: worldsUi,
    ghosts: { ...ghosts, GHOST_KEY: ghosts.GHOST_KEY },
    ghostCore,
    runs: telemetry,
    share: shareCore,
    quests,
    regions: regionsCore,
    localWorld: () => {
      const s = worldState.ensureSaveWorld(L.S);
      return worldState.worldOf(s.seed, s.region);
    },
  });
}

/** 验证钩子：?dev=fresh,battle / dev=battle / dev=none —— 供 playwright 截图脚本用，正式玩法不受影响。
 *  fresh 会清档并重载一次（用 sessionStorage 防止无限重载）。 */
function runDevHook(
  battleUi: { startV4Combat(f: any[], o?: any): void },
  worldState: typeof import('./v4/worldstate'),
  regionById: (id: string) => any,
  REGION_EVENTS: Record<string, Array<Record<string, any>>>,
  applyRegionEvent: (ev: any, regionId: string) => void,
  m20: { worlds: any; ghosts: any; ghostCore: any; runs: any; share: any; quests: any; regions: any; localWorld: () => any },
) {
  const raw = new URLSearchParams(location.search).get('dev');
  if (!raw) return;
  const tokens = raw.split(',').filter(Boolean);
  if (tokens.includes('fresh') && !sessionStorage.getItem('dev-fresh')) {
    sessionStorage.setItem('dev-fresh', '1');
    localStorage.removeItem('zombie_survival_save_v2');
    // 去掉 fresh 之后如果没剩别的 token，也要留一个占位，否则 URLSearchParams 拿到空串会当没开钩子
    const rest = tokens.filter(t => t !== 'fresh');
    location.replace(location.pathname + '?dev=' + (rest.length ? rest.join(',') : 'ready'));
    return;
  }
  (window as any).DEV = {
    state: () => L.S,
    battle: (ids: string[] = ['walker', 'runner']) => battleUi.startV4Combat(ids, { title: '冒烟遭遇' }),
    ui: (window as any).V4UI,
    world: (window as any).V4World,
    /** 当前区域的一格（探针用：不靠 DOM 拿 zone/road/poi；走的是玩家真正在玩的那张图） */
    block: (x: number, y: number) => {
      const s = worldState.ensureSaveWorld(L.S);
      const b = worldState.worldOf(s.seed, s.region).blocks[x + ',' + y];
      return b ? { x: b.x, y: b.y, biome: b.biome, zone: b.zone, road: !!b.road, poi: b.poi, name: b.name, danger: b.danger } : null;
    },
    /** 在当前区域找一格"能搜刮的 POI"（跳过实验室和沉没基地），并把人挪过去。
     *  `feat` 用来指定玩法类型（探针要"修车点"就走 feat:'vehicle'）——注意必须走 worldOf，
     *  直接调 generateWorld 拿到的是**没有主题偏置**的另一张图（M15 起同一 seed 会生成不同的 POI）。 */
    gotoPoi: (opts: { zone?: string; feat?: string; skipWater?: boolean } = {}) => {
      const s = worldState.ensureSaveWorld(L.S);
      const w = worldState.worldOf(s.seed, s.region);
      const cands = Object.keys(w.blocks).map(k => w.blocks[k])
        .filter(b => b.poi && b.poi !== 'lab' && b.poi !== 'sunken' && b.biome !== 'water')
        .filter(b => !opts.zone || b.zone === opts.zone)
        .filter(b => !opts.feat || ((V4 as any).POIS[b.poi!] && (V4 as any).POIS[b.poi!].feat === opts.feat))
        .sort((a, b) => (Math.max(Math.abs(a.x - s.cur.x), Math.abs(a.y - s.cur.y))) - (Math.max(Math.abs(b.x - s.cur.x), Math.abs(b.y - s.cur.y))));
      const best = cands[0];
      if (!best) return null;
      (window as any).V4World.teleport(best.x, best.y);
      return { x: best.x, y: best.y, poi: best.poi, zone: best.zone, biome: best.biome };
    },
    /** M18 探针用：强制按指定/当前区域类型掷一次区域事件（不看概率，直接结算并写日志） */
    forceRegionEvent: (type?: string) => {
      const s = worldState.ensureSaveWorld(L.S);
      const def = regionById(s.region);
      const t = (type || def?.type || 'ruins') as keyof typeof REGION_EVENTS;
      const pool = REGION_EVENTS[t] ?? REGION_EVENTS.ruins;
      const ev = { ...pool[0] };
      applyRegionEvent(ev, s.region);
      return { id: ev.id, title: ev.title, kind: ev.kind, hp: ev.hp ?? 0, mat: ev.mat ?? 0,
        item: ev.item ?? '', n: ev.n ?? 0, region: s.region, type: t };
    },
    /** 当前区域类型（探针挑"该测哪一类事件"用） */
    regionType: () => (regionById(worldState.ensureSaveWorld(L.S).region)?.type ?? ''),
    /* M20：世界 / 幽灵 / 台账三套系统的探针入口（只读 + 玩家可用动作，不额外开后门） */
    worlds: m20.worlds,
    ghosts: m20.ghosts,
    ghostCore: m20.ghostCore,
    runs: m20.runs,
    share: m20.share,
    localWorld: m20.localWorld,
    /* M21 探针：复现"刷委托板扫别区 POI"这条**真实**路径（quests.poisIn → worldOf(别区)）。
       老实现是单槽世界缓存 + "指纹没变就不重放迷雾"，这条路径会把当前区域的世界挤掉，
       于是整张图全黑、连脚下都不亮 → 一格都点不了（用户报的"动不了"）。 */
    scanRegion: (rid?: string) => {
      const s = worldState.ensureSaveWorld(L.S);
      const other = rid || (m20.regions.REGIONS.find((r: any) => r.id !== s.region)?.id ?? s.region);
      let hit = false;
      try { hit = m20.quests.hasPoiIn(other, 'market'); } catch (e) { console.warn('[v4] 扫区失败', e); }
      return { region: other, hit };
    },
  };
  setTimeout(() => {
    if (tokens.includes('battle')) battleUi.startV4Combat(['walker', 'runner'], { title: '冒烟遭遇' });
  }, 400);
}

main();
