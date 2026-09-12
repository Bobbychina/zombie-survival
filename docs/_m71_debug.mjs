/* 排查：为什么麦子/种子显示成 undefined */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 2047, height: 1157 } })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2000);
const out = await page.evaluate(() => {
  const ITEMS = window.ITEMS || {};
  const ids = ['grain', 'seed_grain', 'seed_veg', 'berry', 'mushroom', 'dried', 'pickle', 'veg', 'fish', 'rod', 'bait', 'wetsuit', 'o2', 'purify', 'rot'];
  const defs = {};
  for (const id of ids) defs[id] = ITEMS[id] ? (ITEMS[id].n || '(无 n 字段)') : 'MISSING';
  // 背包里塞上这些，然后看背包页渲染出来的文字
  const S = window.DEV.state();
  for (const id of ids) if (ITEMS[id]) S.inv[id] = 1;
  window.setTab('inv');
  const invText = (document.getElementById('view') || {}).innerText || '';
  window.setTab('craft');
  const craftText = (document.getElementById('view') || {}).innerText || '';
  return {
    itemCount: Object.keys(ITEMS).length,
    defs,
    itemName: Object.fromEntries(ids.map(id => [id, (() => { try { return window.itemName(id); } catch (e) { return 'THREW'; } })()])),
    invUndefinedCount: (invText.match(/undefined/g) || []).length,
    craftUndefinedCount: (craftText.match(/undefined/g) || []).length,
    invSample: invText.split('\n').filter(l => /undefined|麦|种子/.test(l)).slice(0, 10),
    craftSample: craftText.split('\n').filter(l => /undefined|麦|种子|果干|腌/.test(l)).slice(0, 10),
  };
});
out.errors = errs;
writeFileSync('E:/Files/Games/zombieSurvival/docs/_m71_debug.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
