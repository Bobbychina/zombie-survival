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
  const [worldgen, pois, combat, moves, battleUi, worldUi, worldState, camp, night, evac, env, farm, gather, water, accountUi, integrity, betaNotice, regionEventsCore, regionEvents, regionsCore, worldsUi, tutorial, saveVault, accountVault] = await Promise.all([
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
  ]);
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
  /* M26：☰ 菜单（legacy 的 openMenu）要借 v4 的按钮 HTML 渲染「世界与账号」分区 —— 内联 onclick 只认 window 名字 */
  (window as any).__v4ToolsButtons = worldUi.toolsButtonsHtml;
  /* M27：新手教程 —— 第一次进游戏自动弹（看完了不再自动弹），菜单里也能重看 */
  (window as any).V4Tutorial = tutorial.V4Tutorial;
  (window as any).__v4TutorialBattleTip = tutorial.maybeBattleTip;
  (window as any).V4Camp = camp.V4Camp;
  // M6：季节/天气/体温的最小 HUD（挂在顶栏 chips 里，不动地图面板结构）
  const paintEnv = () => {
    try {
      const hud = document.querySelector('.hud-chips');
      if (!hud || hud.querySelector('.v4-env')) {
        const old = hud?.querySelector('.v4-env');
        if (old) old.innerHTML = env.envChips();
        return;
      }
      const span = document.createElement('span');
      span.className = 'v4-env';
      span.style.display = 'contents';
      span.innerHTML = env.envChips();
      hud.appendChild(span);
    } catch (e) { console.warn('[v4] 环境 HUD 挂载失败', e); }
  };
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
  /* M8：存档完整性——必须在 L.boot() 读档之前看原始 JSON（loadGame 会 sanitize，夹取之后就查不出越界了） */
  const preVerdict = integrity.inspectBeforeBoot();
  integrity.installWriteHook();
  L.boot();
  integrity.reportAfterBoot();
  if (vaultState.mode === 'main-thread') L.log('🔐 存档加密：worker 不可用，已降级成主线程 AES-GCM（存档同样不是明文）。', 'dim');
  else if (vaultState.mode === 'worker') L.log('🔐 存档已加密（AES-GCM-256，密钥只在本机 worker 里，不可导出）。', 'dim');
  if (vaultState.lastError) L.log('⚠️ 保险箱初始化有问题：' + vaultState.lastError, 'danger');
  /* M15.1：地图重画（世界生成器版本变了）。BETA 阶段地形会随生成器更新而变，
     存档里保留人物进度、清掉按坐标记的地形进度——这事必须告诉玩家，否则会以为丢档了。 */
  if (worldState.takeWorldMigration()) {
    L.log('🗺️ BETA：地图生成器更新了，这个世界重画了一遍。', 'system');
    L.log('　 你的人物/背包/材料/据点/天数/任务都还在；探索过的格子、POI 剩余次数、营地库存与地图情报重置了（它们按坐标存，地形一换就对不上）。', 'info');
    L.toast('地图已重画', 'BETA 阶段地形会随生成器更新而变，人物进度保留。', 'info');
  }
  mountWorld();
  L.log('🧪 v4 引擎已接管战斗：4 招式槽 / 速度出手 / 属性克制。', 'info');
  /* M27 新手教程：第一次进游戏自动弹一次（看完/跳过之后不再自动弹；☰ 菜单里随时能重看）。
     ?dev=ready 这类开发钩子不弹，免得探针每次都被挡住。 */
  const devFlags = String(new URLSearchParams(location.search).get('dev') || '');
  if (!devFlags.includes('ready') && !devFlags.includes('fresh')) {
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
