/* M6 探针：季节/天气/体温、采集/拆解、菜园、装备保底、X01/X03 修复。
   用法：node _m6_probe.mjs [url]
   注意：所有结论都从**页面里跑出来的真实状态**读，不假设实现细节。 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const dir = 'E:/Files/Games/zombieSurvival/docs/_m6_shots';
mkdirSync(dir, { recursive: true });
const out = { url, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 2047, height: 1157 } });
const page = await ctx.newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2200);

/* 1) 环境状态与 HUD */
out.steps.env = await ev(() => {
  const S = window.DEV.state();
  const chips = [...document.querySelectorAll('.hud-chips .v4-env .chip')].map(e => e.innerText);
  return {
    env: S.env, season: window.V4.env.seasonNow(), weather: window.V4.env.envLine(),
    hudChips: chips, plotSlots: window.V4Farm.plots().length,
  };
});

/* 2) 翻日：天气重掷、体温漂移、日志里出现季节+天气 */
out.steps.dayTick = await ev(() => {
  const S = window.DEV.state();
  const before = { day: S.day, weather: S.env.weather, temp: S.env.temp, tomorrow: S.env.tomorrow };
  S.ap = 9;
  window.V4Night.rest('base');
  const S2 = window.DEV.state();
  return {
    before, after: { day: S2.day, weather: S2.env.weather, temp: S2.env.temp, tomorrow: S2.env.tomorrow },
    weatherMatchesForecast: S2.env.weather === before.tomorrow,
    log: [...document.querySelectorAll('#log .le, #log div')].slice(-4).map(e => e.innerText),
  };
});
await page.waitForTimeout(300);

/* 3) 采集：AP 扣 1、拿到东西、采集池下降；采光后拒绝 */
out.steps.forage = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const forest = Object.values(gen.blocks).find(b => b.biome === 'forest');
  window.V4World.teleport(forest.x, forest.y);
  S.ap = 9;
  const before = { ap: S.ap, inv: { ...S.inv } };
  const ok = window.V4Gather.forage();
  const S2 = window.DEV.state();
  const key = forest.x + ',' + forest.y;
  const gained = Object.keys(S2.inv).filter(k => (S2.inv[k] || 0) > (before.inv[k] || 0));
  // 把这一片采光，验证上限
  for (let i = 0; i < 8; i++) { S2.ap = 9; window.V4Gather.forage(); }
  const S3 = window.DEV.state();
  return {
    at: [forest.x, forest.y, forest.biome], ok, apSpent: before.ap - S2.ap, gained,
    poolLeft: S3.world.forage[key], exhausted: (S3.world.forage[key]?.left ?? 9) === 0,
    lastLog: [...document.querySelectorAll('#log div')].slice(-2).map(e => e.innerText),
  };
});

/* 4) 拆解：材料 +1、池子下降 */
out.steps.salvage = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const ind = Object.values(gen.blocks).find(b => b.biome === 'industrial' && !b.poi);
  window.V4World.teleport(ind.x, ind.y);
  S.ap = 9;
  const mat0 = S.mat;
  const ok = window.V4Gather.salvage();
  const S2 = window.DEV.state();
  return { at: [ind.x, ind.y], ok, matGain: S2.mat - mat0, poolLeft: S2.world.salvage[ind.x + ',' + ind.y],
    log: [...document.querySelectorAll('#log div')].slice(-1).map(e => e.innerText) };
});

/* 5) 菜园：给种子+1 级菜园 → 播种 → 直接推天数 → 收获；冬天拒绝播种 */
out.steps.farm = await ev(() => {
  const S = window.DEV.state();
  S.base.garden = 1; S.inv.seed_veg = 2; S.inv.seed_grain = 1;
  const planted = window.V4Farm.plant(0, 'veg');
  const S2 = window.DEV.state();
  const plotsAfterPlant = JSON.parse(JSON.stringify(S2.plots));
  const seedsLeft = S2.inv.seed_veg;
  // 直接推成熟（等价于过了 growthDays 天）
  S2.plots[0].day = 99;
  const harvested = window.V4Farm.harvest(0, false);
  const S3 = window.DEV.state();
  const vegAfter = S3.inv.veg || 0;
  // 冬天播种应被拒绝
  window.DEV.state().day = 95;
  const winter = window.V4Farm.plant(0, 'veg');
  const S4 = window.DEV.state();
  return {
    planted, plotsAfterPlant, seedsLeft, harvested, vegAfter,
    winterPlanted: winter, winterPlot: S4.plots[0], summary: window.V4Farm.summary(),
    log: [...document.querySelectorAll('#log div')].slice(-4).map(e => e.innerText),
  };
});
await ev(() => { const S = window.DEV.state(); S.day = 5; });

/* 6) 装备保底：军械类 POI 首次深搜必出装备，且只保底一次 */
out.steps.gear = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const host = Object.values(gen.blocks).find(b => ['police', 'military', 'prison', 'bunker', 'tunnel'].includes(b.poi));
  window.V4World.teleport(host.x, host.y);
  const before = { ...window.DEV.state().inv };
  const S1 = window.DEV.state(); S1.ap = 9;
  window.V4World.search(1);                       // 第一次深搜 → 应该有保底
  const S2 = window.DEV.state();
  const gearIds = ['vest', 'kevlar', 'helmet', 'boots', 'backpack', 'gasmask', 'hazmat', 'rifle', 'marksman', 'machete', 'shotgun'];
  const got = gearIds.filter(g => (S2.inv[g] || 0) > (before[g] || 0));
  // 换一场（如果打起来了先跑）再深搜第二次：不该再保底
  if (document.getElementById('v4b-overlay')) window.V4UI.flee();
  const S3 = window.DEV.state(); S3.ap = 9;
  window.V4World.search(1);
  const S4 = window.DEV.state();
  const got2 = gearIds.filter(g => (S4.inv[g] || 0) > (S2.inv[g] || 0));
  if (document.getElementById('v4b-overlay')) window.V4UI.flee();
  return { at: [host.x, host.y, host.poi, host.danger], firstDeep: got, secondDeep: got2,
    log: [...document.querySelectorAll('#log div')].slice(-6).map(e => e.innerText) };
});

/* 7) X01：生命回写必须 clamp 到上限 */
out.steps.hpClamp = await ev(() => {
  const S = window.DEV.state();
  S.hp = S.hpMax + 58;                            // 复现试玩里的 186/128
  const before = { hp: S.hp, hpMax: S.hpMax };
  window.startCombat(['walker'], { title: '夹取测试' });
  const b = window.V4UI.battle();
  if (b) { window.V4UI.move('swing'); }
  const S2 = window.DEV.state();
  if (document.getElementById('v4b-overlay')) { const bb = window.V4UI.battle(); if (bb) { bb.over = 'flee'; window.V4UI.close(); } }
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  return { before, after: { hp: S2.hp, hpMax: S2.hpMax }, clamped: S2.hp <= S2.hpMax };
});

/* 8) X03：饿/渴的时候面板要给出采集/菜园/雨水的出路 */
out.steps.hungerWays = await ev(() => {
  const S = window.DEV.state();
  S.hun = 10; S.thi = 10; S.env.rainToday = 1;
  window.V4World.teleport(S.world.cur.x, S.world.cur.y);
  return { panel: document.getElementById('v4detail') ? document.getElementById('v4detail').innerText.replace(/\s+/g, ' ').slice(0, 60) : null };
});
await page.waitForTimeout(400);
out.steps.hungerPanel = await ev(() => {
  const txt = document.getElementById('v4detail') ? document.getElementById('v4detail').innerText : '';
  const i = txt.indexOf('告急');
  return { hint: i >= 0 ? txt.slice(i - 30, i + 160).replace(/\s+/g, ' ') : null };
});

/* 9) 截图（环境面板 + 菜园 + 采集按钮） */
out.shots = {};
{
  await ev(() => {
    const S = window.DEV.state();
    S.hun = 100; S.thi = 100; S.base.garden = 2; S.inv.seed_veg = 3;
    window.V4Farm.plant(0, 'veg');
    const gen = window.V4.worldgen.generateWorld(S.world.seed);
    const farm = Object.values(gen.blocks).find(b => b.biome === 'farm');
    window.V4World.teleport(farm.x, farm.y);
  });
  await page.waitForTimeout(600);
  const shot = path.join(dir, 'env-farm.png');
  await page.screenshot({ path: shot, fullPage: true });
  out.shots.env = shot;
}

writeFileSync('E:/Files/Games/zombieSurvival/docs/_m6_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
