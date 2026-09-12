/* M7 探针：钓鱼 / 下水游泳 / 潜水搜沉没基地 / 鱼塘产出。
   用法：node _m7_probe.mjs [url] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m7_shots';
mkdirSync(dir, { recursive: true });
const out = { url, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 2047, height: 1157 } });
const page = await ctx.newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2200);

/* 1) 沉没基地在世界里存在，且是可潜水的深水 */
out.steps.world = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const sunken = Object.values(gen.blocks).filter(b => b.poi === 'sunken');
  return {
    count: sunken.length,
    spots: sunken.map(b => ({ at: [b.x, b.y], biome: b.biome, danger: b.danger })),
    poolDef: window.V4.POIS.sunken ? { name: window.V4.POIS.sunken.name, searches: window.V4.POIS.sunken.searches } : null,
  };
});

/* 2) 钓鱼：站到水边（找一块临水的陆地），钓到东西、次数递减 */
out.steps.fish = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const water = Object.values(gen.blocks).find(b => b.biome === 'water');
  // 找一块临水的陆地
  const land = Object.values(gen.blocks).find(b => {
    if (b.biome === 'water') return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nb = gen.blocks[(b.x + dx) + ',' + (b.y + dy)];
      if (nb && nb.biome === 'water') return true;
    }
    return false;
  }) || water;
  window.V4World.teleport(land.x, land.y);
  const S1 = window.DEV.state();
  S1.ap = 9; S1.inv.rod = 1; S1.inv.bait = 3;
  const before = { ap: S1.ap, inv: { ...S1.inv } };
  const ok = window.V4Water.fish();
  const S2 = window.DEV.state();
  const gained = Object.keys(S2.inv).filter(k => (S2.inv[k] || 0) > (before.inv[k] || 0));
  const key = land.x + ',' + land.y;
  return {
    at: [land.x, land.y], landBiome: land.biome, ok, apSpent: before.ap - S2.ap, gained,
    fishLeft: S2.world.fish[key], baitLeft: S2.inv.bait,
    log: [...document.querySelectorAll('#log div')].slice(-2).map(e => e.innerText),
  };
});

/* 3) 下水：游一格水，扣 2 AP、掉体力与体温 */
out.steps.swim = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  // 回到刚才那块临水陆地
  const land = Object.values(gen.blocks).find(b => {
    if (b.biome === 'water') return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nb = gen.blocks[(b.x + dx) + ',' + (b.y + dy)];
      if (nb && nb.biome === 'water') return true;
    }
    return false;
  });
  window.V4World.teleport(land.x, land.y);
  const S1 = window.DEV.state();
  S1.ap = 9; S1.sta = 100; S1.env.temp = 50; S1.eq.body = 'wetsuit';    // 穿潜水服：验证"不抽筋"这条
  const before = { ap: S1.ap, sta: S1.sta, temp: S1.env.temp, cur: { ...S1.world.cur } };
  window.V4Water.swim();
  const S2 = window.DEV.state();
  return {
    before, after: { ap: S2.ap, sta: S2.sta, temp: S2.env.temp, cur: S2.world.cur },
    biome: gen.blocks[S2.world.cur.x + ',' + S2.world.cur.y]?.biome,
    log: [...document.querySelectorAll('#log div')].slice(-2).map(e => e.innerText),
  };
});

/* 4) 潜水：传送到沉没基地，第一次下水无氧气瓶只有 1 次机会 → 再潜应被拒 */
out.steps.dive = await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const sunken = Object.values(gen.blocks).find(b => b.poi === 'sunken');
  window.V4World.teleport(sunken.x, sunken.y);
  const S1 = window.DEV.state();
  S1.ap = 9; S1.inv.o2 = 0; S1.hp = S1.hpMax;
  const before = { ap: S1.ap, hp: S1.hp, inv: { ...S1.inv } };
  const first = window.V4Water.dive();
  const S2 = window.DEV.state();
  const gained = Object.keys(S2.inv).filter(k => (S2.inv[k] || 0) > (before.inv[k] || 0));
  const second = window.V4Water.dive();          // 没氧气 → 应该被拒
  const S3 = window.DEV.state();
  // 给一瓶氧气再来
  S3.inv.o2 = 1; S3.ap = 9;
  const third = window.V4Water.dive();
  const S4 = window.DEV.state();
  if (document.getElementById('v4b-overlay')) { const b = window.V4UI.battle(); if (b) { b.over = 'flee'; window.V4UI.close(); } }
  window.closeAllModals && window.closeAllModals();
  document.querySelectorAll('.overlay').forEach(e => e.remove());
  return {
    at: [sunken.x, sunken.y], first, firstGained: gained, second, third,
    hpAfterNoTank: S2.hp, hpBefore: before.hp,
    log: [...document.querySelectorAll('#log div')].slice(-6).map(e => e.innerText),
  };
});

/* 5) 鱼塘：给据点建鱼塘 → 翻日产鱼（投喂翻倍） */
out.steps.pond = await ev(() => {
  const S = window.DEV.state();
  S.base.pond = 2; S.inv.bait = 1; S.inv.fish = 0;
  S.ap = 9;
  window.V4Night.rest('base');
  const S2 = window.DEV.state();
  return { pondLevel: S2.base.pond, fishAfter: S2.inv.fish || 0, baitLeft: S2.inv.bait || 0,
    summary: window.V4Water.pond(), day: S2.day,
    log: [...document.querySelectorAll('#log div')].slice(-4).map(e => e.innerText) };
});
await page.waitForTimeout(400);

/* 6) 截图（水体面板） */
out.shots = {};
{
  await ev(() => {
    const S = window.DEV.state();
    const gen = window.V4.worldgen.generateWorld(S.world.seed);
    const sunken = Object.values(gen.blocks).find(b => b.poi === 'sunken');
    S.inv.rod = 1; S.inv.bait = 2; S.inv.o2 = 1; S.base.pond = 1;
    window.V4World.teleport(sunken.x, sunken.y);
  });
  await page.waitForTimeout(700);
  const shot = path.join(dir, 'water-panel.png');
  await page.screenshot({ path: shot, fullPage: true });
  out.shots.panel = shot;
}

writeFileSync('E:/Files/Games/zombieSurvival/docs/_m7_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
