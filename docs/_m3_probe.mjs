/* 大世界地图的浏览器探针：直接用 playwright 驱动 Thorium，跑完把结构化结果写成 UTF-8 JSON。
   比 playwright-cli eval 稳：不用跟 PowerShell 的引号/编码搏斗。
   用法：node _m3_probe.mjs            （默认 http://127.0.0.1:5178/index.html?dev=fresh）
        node _m3_probe.mjs <url> <outdir> */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const outDir = process.argv[3] || 'E:/Files/Games/zombieSurvival/docs';
mkdirSync(outDir, { recursive: true });

const result = { url, steps: {}, console: [], errors: [] };

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe',
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (result.console.length < 40) result.console.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => result.errors.push(String(e.message).slice(0, 300)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2200);

const shotDir = path.join(outDir, '_m3_shots');
mkdirSync(shotDir, { recursive: true });
result.shots = {};
const ev = (fn, arg) => page.evaluate(fn, arg);

/* 1) 地图挂载 + legacy 旧地图被摘掉 */
result.steps.mount = await ev(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const S = window.DEV.state();
  const poi = document.querySelector('#v4world .wpoi');
  return {
    cells: q('#v4world .wcell'), fog: q('#v4world .wcell.fog'), seen: q('#v4world .wcell.seen'),
    legacyMapGone: !document.querySelector('#view svg.wmap'), legacyZones: q('#view .zone'),
    cur: S.world.cur, ap: S.ap, day: S.day, worldSeed: String(S.world.seed).slice(0, 12),
    blockName: (document.querySelector('#v4world .wname') || {}).innerText,
    vehicles: (document.querySelector('#v4world .wveh') || {}).innerText,
    poiPanel: poi ? poi.innerText.replace(/\n+/g, ' | ').slice(0, 200) : null,
    renderErr: String(window.__renderErr || ''),
  };
});

/* 2) 走到一个点亮的相邻区块：扣行动力、扩迷雾、换位置 */
result.steps.travel = await ev(() => {
  const S = window.DEV.state();
  const cur = { ...S.world.cur };
  const cells = [...document.querySelectorAll('#v4world .wcell.seen')]
    .map(c => (c.title.match(/^\((\d+),(\d+)\)/) || []).slice(1).map(Number))
    .filter(p => p.length === 2 && (p[0] !== cur.x || p[1] !== cur.y));
  if (!cells.length) return { err: 'no revealed neighbour' };
  const t = cells[0];
  const ap0 = S.ap, fog0 = document.querySelectorAll('#v4world .wcell.fog').length;
  window.V4World.travel(t[0], t[1]);
  const S2 = window.DEV.state();
  const out = {
    from: [cur.x, cur.y], to: t, ap0, ap1: S2.ap, cur: S2.world.cur, steps: S2.world.steps,
    fogBefore: fog0, fogAfter: document.querySelectorAll('#v4world .wcell.fog').length,
    battleOpened: !!document.getElementById('v4b-overlay'),
    trail: S2.world.trail.slice(-2), loc: S2.loc,
  };
  if (out.battleOpened) window.V4UI.flee();
  return out;
});
// 旅行/搜刮结尾会 sync render()，而地图是 MutationObserver 异步补回来的：
// 不等一拍就数 DOM 会数到"地图暂时不在"的 0，这里等一拍再复核一次迷雾
await page.waitForTimeout(300);
result.steps.travelAfterRender = await ev(() => ({
  fog: document.querySelectorAll('#v4world .wcell.fog').length,
  seen: document.querySelectorAll('#v4world .wcell.seen').length,
  panel: !!document.getElementById('v4world'),
}));

/* 3) 传送到最近的有 POI 的区块并搜刮一次 */
result.steps.search = await ev(() => {
  const poi = window.DEV.gopoi();
  const S = window.DEV.state();
  const before = { ap: S.ap, mat: S.mat, hp: S.hp, zoneCnt: { ...S.stats.zoneCnt } };
  window.V4World.search(0);
  const S2 = window.DEV.state();
  const out = {
    poi, cur: S2.world.cur,
    before, after: { ap: S2.ap, mat: S2.mat, hp: S2.hp, zoneCnt: { ...S2.stats.zoneCnt }, left: { ...S2.world.left }, seen: Object.keys(S2.seen) },
    battleOpened: !!document.getElementById('v4b-overlay'),
    apSpent: before.ap - S2.ap,
  };
  return out;
});
// 搜刮可能触发战斗：逃跑失败也不会关掉弹窗，所以这里必须自己收干净，否则后面截图全是战斗遮罩
await ev(() => {
  if (document.getElementById('v4b-overlay') && window.V4UI.flee) window.V4UI.flee();
});
await page.waitForTimeout(400);
result.steps.battleCleanup = await ev(() => {
  const open = !!document.getElementById('v4b-overlay');
  if (open) {
    window.closeAllModals && window.closeAllModals();
    document.querySelectorAll('.overlay').forEach(e => e.remove());
  }
  return { hadBattle: open, overlaysLeft: document.querySelectorAll('.overlay').length };
});
await page.waitForTimeout(600);

/* 4) 汽修厂修车 + 开车报价 */
result.steps.vehicle = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const g = Object.values(gen.blocks).find(b => b.poi === 'garage');
  if (!g) return { err: 'no garage' };
  window.V4World.teleport(g.x, g.y);
  const S1 = window.DEV.state();
  S1.mat = 60; S1.inv.fuel = 3;
  window.V4World.fixCar();
  const S2 = window.DEV.state();
  const here = S2.world.cur;
  const plans = [];
  for (const d of [2, 5, 9]) {
    const to = { x: Math.min(23, here.x + d), y: here.y };
    const p = window.V4.worldstate.planTrip(gen, here, to, { ap: S2.ap, veh: S2.world.veh, fractured: false, night: false });
    plans.push('trip' in p ? { d, mode: p.trip.mode, steps: p.trip.steps, ap: p.trip.ap, fuel: p.trip.fuel } : { d, err: p.err });
  }
  return { garage: [g.x, g.y], veh: S2.world.veh, mat: S2.mat, fuelItems: S2.inv.fuel, plans };
});

/* 6) 幸存者营地：进去 → 买一件 → 买情报（点亮碎片点）→ 看库存与材料变化 */
result.steps.camp = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const campB = Object.values(gen.blocks).find(b => b.poi === 'camp');
  if (!campB) return { err: 'no camp' };
  window.V4World.teleport(campB.x, campB.y);
  S.mat = 200;
  window.V4Camp.open();
  const modal = document.querySelector('.overlay .modal');
  const before = { mat: S.mat, can: (S.inv.can || 0), fog: document.querySelectorAll('#v4world .wcell.fog').length };
  const buyBtn = [...document.querySelectorAll('.overlay .modal .btn')].find(b => /^\d+ 材料$/.test(b.innerText.trim()));
  const label = buyBtn ? buyBtn.innerText.trim() : null;
  if (buyBtn) buyBtn.click();
  const S2 = window.DEV.state();
  const m2 = document.querySelector('.overlay .modal');
  window.V4Camp.intel();
  const S3 = window.DEV.state();
  const out = {
    campAt: [campB.x, campB.y], campName: (m2 || {}).innerText ? m2.innerText.split('\n').slice(0, 3).join(' | ') : null,
    modalRows: document.querySelectorAll('.overlay .modal .lrow').length,
    hasRecruit: !!document.querySelector('.overlay .modal .btn.ok'),
    buyLabel: label,
    afterBuy: { mat: S3.mat, can: (S3.inv.can || 0), stock: JSON.stringify(S3.world.stock) },
    before,
    afterIntel: { mat: window.DEV.state().mat, fog: document.querySelectorAll('#v4world .wcell.fog').length, keyCells: document.querySelectorAll('#v4world .wcell.frag').length },
    fragSpots: window.V4.quest4.fragSpots(gen).map(f => [f.x, f.y, f.poi]),
  };
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  return out;
});
await page.waitForTimeout(400);

/* 7) 碎片点：先传送到隔壁，再"走"过去——走到的瞬间碎片要自动进兜 */
result.steps.fragment = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const spots = window.V4.quest4.fragSpots(gen);
  const f = spots[0];
  const keyCellsBefore = document.querySelectorAll('#v4world .wcell.frag').length;
  const before = { keycards: S.quest.keycards, keyCells: keyCellsBefore, fog: document.querySelectorAll('#v4world .wcell.fog').length };
  // 站到碎片点旁边（四邻之一），然后正常走一步过去
  const nb = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: f.x + dx, y: f.y + dy }))
    .find(p => p.x >= 0 && p.y >= 0 && p.x < 24 && p.y < 24);
  window.V4World.teleport(nb.x, nb.y);
  S.ap = 9;
  window.V4World.travel(f.x, f.y);
  const S2 = window.DEV.state();
  const after = {
    keycards: S2.quest.keycards,
    taken: Object.keys(S2.world.frag || {}),
    cur: S2.world.cur,
    keyCellsLeft: document.querySelectorAll('#v4world .wcell.frag').length,
    stage: S2.quest.stage,
    log: (document.querySelector('#log') || {}).innerText.split('\n').slice(-3),
  };
  return { spot: [f.x, f.y, f.poi], from: [nb.x, nb.y], before, after, allSpots: spots.length };
});
await page.waitForTimeout(400);
// 同步 render 之后地图是异步补挂的：等一拍再数一次 DOM，否则会数到"面板暂时不在"的 0
result.steps.fragmentAfterRender = await ev(() => ({
  keyCells: document.querySelectorAll('#v4world .wcell.frag').length,
  fog: document.querySelectorAll('#v4world .wcell.fog').length,
  panel: !!document.getElementById('v4world'),
}));

/* 8) 存档往返：大世界进度（位置/迷雾/碎片/车/情报）必须能过一遍 localStorage 而不丢 */
result.steps.beforeReload = await ev(() => {
  const S = window.DEV.state();
  window.saveGame && window.saveGame(true);
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  let saved = null;
  try { saved = JSON.parse(raw); } catch { /* 存档不是合法 JSON */ }
  return {
    cur: S.world.cur, visited: Object.keys(S.world.visited).length, frag: Object.keys(S.world.frag || {}),
    intel: !!S.world.intel, veh: S.world.veh, keycards: S.quest.keycards, steps: S.world.steps,
    fog: document.querySelectorAll('#v4world .wcell.fog').length,
    savedLen: raw.length, savedHasWorld: raw.includes('"world"'),
    savedWorld: saved && saved.world ? { cur: saved.world.cur, intel: saved.world.intel, frag: Object.keys(saved.world.frag || {}) } : null,
    savedDay: saved && saved.day, savedMat: saved && saved.mat, liveDay: S.day, liveMat: S.mat,
  };
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
// M7.1 改版：进游戏自动读档，不再弹「发现存档 / 继续上次」——这里改成断言"没有弹窗但进度照样回来了"
result.steps.reloadPrompt = await ev(() => {
  const btn = [...document.querySelectorAll('.overlay .btn')].find(b => b.innerText.includes('继续上次'));
  const title = (document.querySelector('.overlay .modal') || {}).innerText;
  if (btn) btn.click();                                    // 老版本才有；保留兼容，自动读档时是 no-op
  return { hadPrompt: !!btn, autoLoaded: !btn, text: title ? title.split('\n').slice(0, 2).join(' | ') : null };
});
await page.waitForTimeout(800);
result.steps.afterReload = await ev(() => {
  const S = window.DEV.state();
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  return {
    cur: S.world.cur, visited: Object.keys(S.world.visited).length, frag: Object.keys(S.world.frag || {}),
    intel: !!S.world.intel, veh: S.world.veh, keycards: S.quest.keycards, steps: S.world.steps,
    fog: document.querySelectorAll('#v4world .wcell.fog').length,
    keyCells: document.querySelectorAll('#v4world .wcell.frag').length,
    panel: !!document.getElementById('v4world'), renderErr: String(window.__renderErr || ''),
    day: S.day, mat: S.mat, savedLen: raw.length, savedHasWorld: raw.includes('"world"'),
  };
});

/* 9) 拾荒者据点：谈不拢就得打 */
result.steps.outpost = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const ob = Object.values(gen.blocks).find(b => b.poi === 'outpost');
  if (!ob) return { err: 'no outpost' };
  window.V4World.teleport(ob.x, ob.y);
  window.V4Camp.open();
  const modal = document.querySelector('.overlay .modal');
  const txt = modal ? modal.innerText.replace(/\n+/g, ' | ').slice(0, 220) : null;
  const fightBtn = [...document.querySelectorAll('.overlay .modal .btn')].find(b => b.innerText.includes('火并'));
  if (fightBtn) fightBtn.click();
  const out = { at: [ob.x, ob.y], modalText: txt, battleOpened: !!document.getElementById('v4b-overlay') };
  if (out.battleOpened) window.V4UI.flee();
  return out;
});
await page.waitForTimeout(300);
await ev(() => {
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  const S = window.DEV.state();
  const w = window.V4.worldgen.generateWorld(S.world.seed);
  window.V4World.teleport(w.home.x, w.home.y);
});
await page.waitForTimeout(600);
result.campShot = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const campB = Object.values(gen.blocks).find(b => b.poi === 'camp');
  if (campB) window.V4World.teleport(campB.x, campB.y);
  return { at: campB ? [campB.x, campB.y] : null };
});
await page.waitForTimeout(400);
{
  const p4 = path.join(shotDir, 'camp-panel.png');
  await page.screenshot({ path: p4, fullPage: true });
  await ev(() => { window.V4Camp.open(); });
  await page.waitForTimeout(400);
  const p5 = path.join(shotDir, 'camp-modal.png');
  await page.screenshot({ path: p5, fullPage: true });
  result.shots.campPanel = p4;
  result.shots.campModal = p5;
}

await ev(() => {
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  const S = window.DEV.state();
  const w = window.V4.worldgen.generateWorld(S.world.seed);
  window.V4World.teleport(w.home.x, w.home.y);
});
// 走几个区块把迷雾推开一点，截图里才看得出"已探索/未探索"的区别
for (const [dx, dy] of [[1, 0], [1, 1], [0, 1], [2, 1], [1, 2]]) {
  await ev(([x, y]) => window.V4World.teleport(x, y), [12 + dx, 12 + dy]);
}
await page.waitForTimeout(800);
result.mapState = await ev(() => {
  const S = window.DEV.state();
  return {
    cur: S.world.cur, steps: S.world.steps,
    fog: document.querySelectorAll('#v4world .wcell.fog').length,
    seen: document.querySelectorAll('#v4world .wcell.seen').length,
    panel: !!document.getElementById('v4world'),
    overlays: document.querySelectorAll('.overlay').length,
  };
});
const shotDir2 = shotDir;
{
  const p1 = path.join(shotDir2, 'world-viewport.png');
  await page.screenshot({ path: p1 });
  const p2 = path.join(shotDir2, 'world-fullpage.png');
  await page.screenshot({ path: p2, fullPage: true });
  result.shots.viewport = p1;
  result.shots.fullPage = p2;
}
await ev(() => { window.DEV.battle(['walker', 'runner', 'sprinter']); });
await page.waitForTimeout(900);
result.battleFallback = await ev(() => ({
  overlay: !!document.getElementById('v4b-overlay'),
  foes: [...document.querySelectorAll('#v4b-overlay .enemy .nm, #v4b-overlay .foe .n, #v4b-overlay .foe-card')].map(e => e.innerText.split('\n')[0]),
  html: (document.getElementById('v4b-overlay') || {}).innerHTML ? document.getElementById('v4b-overlay').innerHTML.length : 0,
  log: [...document.querySelectorAll('#v4b-overlay .round-log div')].slice(0, 3).map(e => e.innerText),
}));
{
  const p3 = path.join(shotDir, 'battle-fullpage.png');
  await page.screenshot({ path: p3, fullPage: true });
  result.shots.battle = p3;
}

writeFileSync(path.join(outDir, '_m3_probe.json'), JSON.stringify(result, null, 1), 'utf8');
await browser.close();
console.log('OK ' + path.join(outDir, '_m3_probe.json'));
