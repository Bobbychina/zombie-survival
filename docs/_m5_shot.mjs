/* 针对 M5 新 UI 的定点截图：把地图面板滚到可视区（地图在 #view 这个滚动容器里），
   分别截「路线预览中」和「营地 + 今夜选项」两张，供 OCR 复核。
   用法：node _m5_shot.mjs [url] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:8125/dist/index.html?dev=fresh';
const dir = 'E:/Files/GameS/webGames/_v2-dev/_m5_shots';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2200);

// 站到一个营地上：POI 面板 + 幸存者按钮 + 今夜选项同屏
const info = await page.evaluate(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const camp = Object.values(gen.blocks).find(b => b.poi === 'camp');
  S.mat = 120; S.inv.fuel = 3;
  window.V4World.teleport(camp.x, camp.y);
  return { camp: [camp.x, camp.y] };
});
await page.waitForTimeout(400);
// 点一个相邻的点亮区块 → 出路线预览
await page.evaluate(() => {
  const cell = [...document.querySelectorAll('#v4world .wcell.seen:not(.cur)')][0];
  if (cell) window.V4World.click(...(cell.title.match(/^\((\d+),(\d+)\)/) || []).slice(1).map(Number));
});
await page.waitForTimeout(400);
const scroll = await page.evaluate(() => {
  const p = document.getElementById('v4world');
  if (p) p.scrollIntoView({ block: 'start' });
  const view = document.getElementById('view');
  if (view) view.scrollTop = Math.max(0, (p ? p.offsetTop : 0) - 8);
  return { panelTop: p ? p.offsetTop : -1, viewScroll: view ? view.scrollTop : -1 };
});
await page.waitForTimeout(300);
const shot1 = path.join(dir, 'panel-preview.png');
await page.screenshot({ path: shot1 });

// 再截一张：把「今夜」段落也带进来
await page.evaluate(() => {
  const view = document.getElementById('view');
  if (view) view.scrollTop += 420;
});
await page.waitForTimeout(300);
const shot2 = path.join(dir, 'panel-night.png');
await page.screenshot({ path: shot2 });

const probe = await page.evaluate(() => ({
  preview: (document.getElementById('v4-preview') || {}).innerText,
  night: [...document.querySelectorAll('#v4world .wnight .btn')].map(b => b.innerText + (b.disabled ? '(禁用)' : '')),
  nightHint: [...document.querySelectorAll('#v4world .wnight .hint')].map(e => e.innerText),
  head: (document.querySelector('#v4world .wveh') || {}).innerText,
  evacSection: (document.querySelector('#v4world .wevac') || {}).innerText,
}));
writeFileSync('E:/Files/GameS/webGames/_v2-dev/_m5_shot.json', JSON.stringify({ info, scroll, probe, errors: errs, shots: [shot1, shot2] }, null, 1), 'utf8');
await browser.close();
console.log('OK');
