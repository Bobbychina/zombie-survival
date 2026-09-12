/* M5 wave 的浏览器探针：PR0 战斗出口统一 / C11 性能 / C01+C02 过夜 / C03 血月被啃 / C07 撤离 / C10 地图 UX
   用法：node _m5_probe.mjs [url] [outdir]（结果落 UTF-8 JSON，截图进 _m5_shots） */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const outDir = process.argv[3] || 'E:/Files/Games/zombieSurvival/docs';
mkdirSync(outDir, { recursive: true });
const shotDir = path.join(outDir, '_m5_shots');
mkdirSync(shotDir, { recursive: true });

const result = { url, steps: {}, console: [], errors: [], shots: {} };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (result.console.length < 30) result.console.push(m.type() + ': ' + m.text().slice(0, 160)); });
page.on('pageerror', e => result.errors.push(String(e.message).slice(0, 240)));
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2200);

/* ── PR0：legacy 内部发起的战斗必须也走 v4 引擎 ── */
result.steps.legacyFinalBattle = await ev(() => {
  const S = window.DEV.state();
  S.quest.stage = 5;                                   // 最终决战要先推进到阶段 5
  window.startFinalBattle();
  const legacyModal = [...document.querySelectorAll('.overlay .modal-hd h2')].map(e => e.innerText).join(' | ');
  return {
    v4Open: !!document.getElementById('v4b-overlay'),
    title: (document.querySelector('#v4b-overlay .modal-hd h2') || {}).innerText,
    overlayCount: document.querySelectorAll('.overlay').length,
    legacyTitleText: legacyModal,
    noFleeDisabled: (() => { const b = [...document.querySelectorAll('#v4b-overlay .btn')].find(x => x.innerText.includes('无路可退')); return !!b; })(),
  };
});
// 强制打赢阶段 1：onWin 必须把阶段 2 接上来
result.steps.bossChain = await ev(() => {
  const b = window.V4UI.battle();
  if (!b) return { err: 'no battle' };
  b.over = 'win';
  window.V4UI.close();
  return {
    phase2Open: !!document.getElementById('v4b-overlay'),
    title: (document.querySelector('#v4b-overlay .modal-hd h2') || {}).innerText,
  };
});
result.steps.cleanup1 = await ev(() => {
  const b = window.V4UI.battle();
  if (b) { b.over = 'flee'; window.V4UI.close(); }
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  return { overlays: document.querySelectorAll('.overlay').length };
});

/* ── PR0c：区域遭遇（legacy encounterRoll）同样走 v4 ── */
result.steps.legacyEncounter = await ev(() => {
  const S = window.DEV.state();
  S.loc = 'hospital'; S.seen.hospital = 1;
  window.encounterRoll('hospital', false);
  const out = {
    v4Open: !!document.getElementById('v4b-overlay'),
    title: (document.querySelector('#v4b-overlay .modal-hd h2') || {}).innerText,
    hintShown: [...document.querySelectorAll('#v4b-overlay .hint')].some(e => e.innerText.includes('第一次交手') || e.innerText.includes('切换目标')),
  };
  const b = window.V4UI.battle();
  if (b) { b.over = 'flee'; window.V4UI.close(); }
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  return out;
});

/* ── PR0b：夜间守夜战（legacy nightRaid）走 v4，且防线/陷阱都在 ── */
result.steps.nightRaid = await ev(() => {
  const S = window.DEV.state();
  S.day = 21; S.cal.bloodMoon = true; S.def.traps = { spike: 1, fire: 1, alarm: 1 };
  const before = { door: S.def.doorHp, wall: S.def.wallHp, traps: { ...S.def.traps } };
  window.nightRaid();
  const chips = [...document.querySelectorAll('#v4b-overlay .hint')].map(e => e.innerText);
  const out = {
    v4Open: !!document.getElementById('v4b-overlay'),
    title: (document.querySelector('#v4b-overlay .modal-hd h2') || {}).innerText,
    hasDefenseLine: chips.some(t => t.includes('门户') && t.includes('围墙')),
    trapsAfter: window.DEV.state().def.traps,
    before,
    log: [...document.querySelectorAll('#v4log div')].slice(0, 3).map(e => e.innerText),
    foes: [...document.querySelectorAll('#v4b-overlay .enemy')].length,
  };
  const b = window.V4UI.battle();
  if (b) { b.over = 'win'; window.V4UI.close(); }
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  return out;
});
await page.waitForTimeout(300);

/* ── C11：反复 ensure 不该反复重放迷雾 ── */
result.steps.perf = await ev(() => {
  const S = window.DEV.state();
  const before = window.V4.worldstate.replayCount ? window.V4.worldstate.replayCount() : -1;
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) window.V4.worldstate.ensureSaveWorld(S);
  const ms = performance.now() - t0;
  const after = window.V4.worldstate.replayCount ? window.V4.worldstate.replayCount() : -1;
  return { replaysBefore: before, replaysAfter: after, ms50: Math.round(ms), fog: document.querySelectorAll('#v4world .wcell.fog').length };
});

/* ── C10：地图 UX（命中区 / 悬停 / 路线预览 / 图例折叠） ── */
result.steps.mapUx = await ev(() => {
  const cell = document.querySelector('#v4world .wcell.seen:not(.cur)');
  const r = cell.getBoundingClientRect();
  cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  const hover = (document.getElementById('v4-hover') || {}).innerText;
  const S = window.DEV.state();
  const ap0 = S.ap;
  window.V4World.click(...(cell.title.match(/^\((\d+),(\d+)\)/) || []).slice(1).map(Number));
  return { cellSize: [Math.round(r.width), Math.round(r.height)], hover, apBefore: ap0 };
});
await page.waitForTimeout(350);
result.steps.mapPreview = await ev(() => ({
  previewText: (document.getElementById('v4-preview') || {}).innerText.slice(0, 110),
  pathCells: document.querySelectorAll('#v4world .wcell.path').length,
  targetCells: document.querySelectorAll('#v4world .wcell.target').length,
  legendIsDetails: !!document.querySelector('#v4world details.wlegend-box'),
  headChips: document.querySelectorAll('#v4world .whead > *').length,
}));
result.steps.mapConfirm = await ev(() => {
  const S = window.DEV.state();
  const ap0 = S.ap;
  window.V4World.confirmTrip();                       // 等价于第二次点同一格
  return { apBefore: ap0 };
});
await page.waitForTimeout(400);
result.steps.mapConfirmed = await ev(() => {
  const S = window.DEV.state();
  return { apAfter: S.ap, cur: S.world.cur, trail: S.world.trail.slice(-1) };
});
// 趁游戏还在正常状态（没通关、没死）把地图面板截下来——终局之后 S.over=true，地图面板会按设计收起来
result.shots.map = path.join(shotDir, 'map-m5.png');
await page.screenshot({ path: result.shots.map, fullPage: true });

/* ── C01/C02：安全屋满额 vs 野外打折（含夜袭三档） ── */
result.steps.restBase = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  window.V4World.teleport(gen.home.x, gen.home.y);
  S.day = 10; S.ap = 1; S.world.debt = 1;
  window.V4Night.rest('base');
  const S2 = window.DEV.state();
  return { day: S2.day, ap: S2.ap, apMax: S2.apMax, debt: S2.world.debt, lastNight: S2.world.lastNight };
});
result.steps.restField = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const far = Object.values(gen.blocks).find(b => b.poi === 'camp');
  window.V4World.teleport(far.x, far.y);
  S.ap = 1;
  // 固定随机：第一掷决定有没有夜袭（0.01 < p → 有），第二掷落在"打断睡眠"档
  const seq = [0.01, 0.01];
  const orig = Math.random;
  Math.random = () => (seq.length ? seq.shift() : 0.5);
  try { window.V4Night.rest('open'); } finally { Math.random = orig; }
  const S2 = window.DEV.state();
  const night = S2.world.lastNight;
  return { at: [far.x, far.y, far.poi], day: S2.day, ap: S2.ap, apMax: S2.apMax, debt: S2.world.debt, outcome: night && night.outcome, log: (document.querySelector('#log') || {}).innerText.split('\n').slice(-3) };
});
// 野睡第 7 夜：债触顶，AP 上限不得低于 6
result.steps.fieldWeek = await ev(() => {
  const S = window.DEV.state();
  const orig = Math.random;
  Math.random = () => 0.99;                      // 不触发夜袭，只看债
  try { for (let i = 0; i < 6; i++) window.V4Night.rest('open'); } finally { Math.random = orig; }
  const S2 = window.DEV.state();
  return { day: S2.day, ap: S2.ap, apMax: S2.apMax, debt: S2.world.debt };
});

/* ── C03：血月不在家 → 据点被啃（含上界与幂等标记） ── */
result.steps.bloodMoonField = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const far = Object.values(gen.blocks).find(b => b.poi === 'warehouse');
  window.V4World.teleport(far.x, far.y);
  S.day = 28;                                    // 28 % 7 === 0 → 血月
  S.def.doorHp = 0; S.def.wallHp = 0;
  window.defInit();
  S.mat = 100; S.store = { metal: 10, wood: 10 };
  const before = { door: S.def.doorHp, wall: S.def.wallHp, mat: S.mat, store: { ...S.store } };
  const orig = Math.random;
  Math.random = () => 0.99;                      // 不触发野睡夜袭，只看被啃
  try { window.V4Night.rest('open'); } finally { Math.random = orig; }
  const S2 = window.DEV.state();
  const out = {
    before,
    after: { door: S2.def.doorHp, wall: S2.def.wallHp, mat: S2.mat, store: { ...S2.store } },
    lastRaidDay: S2.world.lastRaidDay,
    doorCap: Math.round(window.defMax().door * 0.35), wallCap: Math.round(window.defMax().wall * 0.35),
    log: (document.querySelector('#log') || {}).innerText.split('\n').slice(-3),
  };
  return out;
});

/* ── C07：撤离窗口 / 血月顺延 / 打信号弹 ── */
result.steps.evac = await ev(() => {
  const S = window.DEV.state();
  S.day = 90;
  window.V4World.teleport(S.world.cur.x, S.world.cur.y);   // 触发一次 mount → ensureEvac 落盘
  return { day: S.day };
});
await page.waitForTimeout(400);
result.steps.evacAfter = await ev(() => {
  const s = window.DEV.state();
  return { evac: s.world.evac, markerCells: document.querySelectorAll('#v4world .wcell.evac').length,
    log: (document.querySelector('#log') || {}).innerText.split('\n').slice(-2) };
});
result.steps.evacBloodMoon = await ev(() => {
  const S = window.DEV.state();
  S.day = 91;                                   // 血月日
  const r = window.V4.evac.fireFlare();
  return { fired: r, toasts: [...document.querySelectorAll('#toasts div')].map(e => e.innerText).slice(-2) };
});
result.steps.evacFire = await ev(() => {
  const S = window.DEV.state();
  S.day = 92;
  S.inv.flare = 1;
  const ev = S.world.evac;
  window.V4World.teleport(ev.x, ev.y);
  const S2 = window.DEV.state();
  const fired = window.V4World.flare();
  const S3 = window.DEV.state();
  return { at: [S2.world.cur.x, S2.world.cur.y], fired, won: !!S3.flags.won, flareLeft: S3.inv.flare || 0,
    modal: (document.querySelector('.overlay .modal') || {}).innerText ? document.querySelector('.overlay .modal').innerText.split('\n').slice(0, 3).join(' | ') : null };
});

/* ── 截图 ── */
await ev(() => { window.closeAllModals && window.closeAllModals(); document.querySelectorAll('.overlay').forEach(e => e.remove()); });
await page.waitForTimeout(500);
result.shots.afterEnding = path.join(shotDir, 'after-ending.png');
await page.screenshot({ path: result.shots.afterEnding, fullPage: true });

writeFileSync(path.join(outDir, '_m5_probe.json'), JSON.stringify(result, null, 1), 'utf8');
await browser.close();
console.log('OK ' + path.join(outDir, '_m5_probe.json'));
