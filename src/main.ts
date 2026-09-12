/* v4.0 入口：先加载 legacy 底座（它自带全局导出垫片），再挂 v4 模块并接管对应系统。
   本步接管的是「战斗」：把 window.startCombat 换成宝可梦式回合制引擎 + 新界面。 */
import './styles/game.css';
import './styles/v4.css';
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
  const [worldgen, pois, combat, moves, battleUi, worldUi, worldState, camp, night, evac, env, farm, gather, water, accountUi] = await Promise.all([
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
  ]);
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
  });
  // 内联 onclick 只认 window 上的名字：今夜（过夜）与撤离
  (window as any).V4Night = { rest: night.rest, options: night.restOptions, apMaxOf: night.apMaxOf };
  (window as any).V4Farm = { plant: farm.plant, harvest: farm.harvest, plots: farm.plotSlots, summary: farm.farmSummary };
  (window as any).V4Gather = { forage: gather.forage, salvage: gather.salvage, chop: gather.chop };
  (window as any).V4Water = { fish: water.fish, intake: water.intake, dive: water.dive, swim: worldUi.V4World.swim, pond: water.pondSummary };
  // 账号与云存档（内联 onclick 用；函数名与 account-ui.ts 导出保持一致）
  (window as any).V4Account = {
    open: accountUi.openPanel, summary: accountUi.accountSummary,
    doRegister: accountUi.doRegister, doLogin: accountUi.doLogin, logout: accountUi.logout,
    bindGitHub: accountUi.bindGitHub, bindGitHubConfirm: accountUi.bindGitHubConfirm,
    bindGitHubToken: accountUi.bindGitHubToken,
    bindGitHubDevice: accountUi.bindGitHubDevice, bindMicrosoft: accountUi.bindMicrosoft, unbind: accountUi.unbind,
    diagnose: accountUi.diagnose,
    push: accountUi.push, pull: accountUi.pull, sync: accountUi.sync, toggleAuto: accountUi.toggleAuto,
    exportAll: accountUi.exportAll, importAll: accountUi.importAll, doImport: accountUi.doImport,
    exportFile: accountUi.exportFile, importFile: accountUi.importFile, doImportFile: accountUi.doImportFile,
    changePass: accountUi.changePass, doChangePass: accountUi.doChangePass, del: accountUi.del, doDelete: accountUi.doDelete,
  };
  (V4 as any).account = accountUi;
  accountUi.wrapAutosave();

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

  L.boot();
  mountWorld();
  L.log('🧪 v4 引擎已接管战斗：4 招式槽 / 速度出手 / 属性克制。', 'info');
  // file:// 直开时存档只落在本浏览器：给一句提示，免得换个浏览器以为存档丢了
  if (location.protocol === 'file:') {
    L.log('💾 直接双击打开的（file://）：存档写在本浏览器本地，换浏览器或清缓存会丢；想更稳可以跑 start.bat 起本地服务。', 'dim');
  }

  runDevHook(battleUi);
}

/** 验证钩子：?dev=fresh,battle / dev=battle / dev=none —— 供 playwright 截图脚本用，正式玩法不受影响。
 *  fresh 会清档并重载一次（用 sessionStorage 防止无限重载）。 */
function runDevHook(battleUi: { startV4Combat(f: any[], o?: any): void }) {
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
    /** 跳到最近的带 POI 的区块（截图/冒烟用） */
    gopoi: () => {
      const w = (V4 as any).worldgen.generateWorld(L.S.world.seed);
      const cur = L.S.world.cur;
      let best: any = null, bd = 1e9;
      for (const k in w.blocks) {
        const b = w.blocks[k];
        if (!b.poi || b.poi === 'lab') continue;
        const d = Math.max(Math.abs(b.x - cur.x), Math.abs(b.y - cur.y));
        if (d < bd) { bd = d; best = b; }
      }
      if (best) (window as any).V4World.teleport(best.x, best.y);
      return best ? best.poi : null;
    },
  };
  setTimeout(() => {
    if (tokens.includes('battle')) battleUi.startV4Combat(['walker', 'runner'], { title: '冒烟遭遇' });
  }, 400);
}

main();
