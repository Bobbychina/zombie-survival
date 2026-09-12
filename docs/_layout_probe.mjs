/* 布局探针：在几个典型分辨率下量「两侧留白 / 是否要滚动 / 三列位置 / 地图尺寸」，
   并截图供 OCR 复核。用法：node _layout_probe.mjs [url] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const dir = 'E:/Files/Games/zombieSurvival/docs/_layout_shots';
mkdirSync(dir, { recursive: true });

const SIZES = [
  { name: 'wide-2047x1157（用户机器 2560x1600@125%）', w: 2047, h: 1157 },
  { name: 'mid-1600x900', w: 1600, h: 900 },
  { name: 'small-1440x900', w: 1440, h: 900 },
  { name: 'narrow-1000x800', w: 1000, h: 800 },
];

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const out = { url, sizes: [], errors: [] };

for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
  const page = await ctx.newPage();
  page.on('pageerror', e => out.errors.push(s.name + ': ' + String(e.message).slice(0, 160)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  // 站在一个有 POI 的区块上（POI 面板 + 今夜才会出现）
  await page.evaluate(() => {
    const S = window.DEV.state();
    const gen = window.V4.worldgen.generateWorld(S.world.seed);
    const b = Object.values(gen.blocks).find(x => x.poi === 'garage');
    if (b) window.V4World.teleport(b.x, b.y);
    const cell = [...document.querySelectorAll('#v4world .wcell.seen:not(.cur)')][0];
    if (cell) window.V4World.click(...(cell.title.match(/^\((\d+),(\d+)\)/) || []).slice(1).map(Number));
  });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const r = el => { const b = el && el.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
    const app = document.getElementById('app'), view = document.getElementById('view'), side = document.getElementById('side');
    const map = document.getElementById('v4world'), detail = document.getElementById('v4detail'), col = document.querySelector('#view > .v4-col');
    const grid = document.querySelector('#v4world .wgrid');
    const cell = document.querySelector('#v4world .wcell');
    const gridBox = grid && grid.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      app: r(app), sideGapLeft: r(app) ? r(app).x : null,
      sideGapRight: r(app) ? Math.round(innerWidth - r(app).x - r(app).w) : null,
      sidePanel: r(side),
      viewScroll: view ? { clientH: view.clientHeight, scrollH: view.scrollHeight, overflows: view.scrollHeight > view.clientHeight + 2 } : null,
      map: r(map), detail: r(detail), col: r(col),
      grid: gridBox ? { w: Math.round(gridBox.width), h: Math.round(gridBox.height) } : null,
      cell: cell ? Math.round(cell.getBoundingClientRect().width) : null,
      gridFitsInView: gridBox && view ? gridBox.height <= view.clientHeight : null,
      splitOn: view ? view.classList.contains('v4-split') : false,
      docScrolls: document.documentElement.scrollHeight > innerHeight + 2,
    };
  });
  const shot = path.join(dir, s.name.replace(/[^\w.-]/g, '_') + '.png');
  await page.screenshot({ path: shot });
  out.sizes.push({ size: s.name, ...m, shot });
  await ctx.close();
}

writeFileSync('E:/Files/Games/zombieSurvival/docs/_layout_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
