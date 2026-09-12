/* 线上验收：GitHub Pages 上的游戏是不是真的能打开、能玩（不是只返回 200）
   用法：node docs/_pages_check.mjs [url] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'https://bobbychina.github.io/zombie-survival/';
const dir = 'E:/Files/Games/ZombieSurvival/docs/_pages_shots';
mkdirSync(dir, { recursive: true });
const out = { url, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 2047, height: 1157 } })).newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 160)));
const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
out.httpStatus = resp && resp.status();
out.contentType = resp && resp.headers()['content-type'];
out.bytes = (await resp.body()).length;
await page.waitForTimeout(3000);
out.dom = await page.evaluate(() => ({
  title: document.title,
  hasS: typeof window.S,
  day: window.S && window.S.day,
  mapCells: document.querySelectorAll('.wcell').length,
  tabs: document.querySelectorAll('.tab, .tabs button').length,
  v4Modules: ['V4UI', 'V4World', 'V4Camp', 'V4Night', 'V4Farm', 'V4Gather', 'V4Water'].filter(k => !!window[k]),
  inventoryUndefined: /undefined/.test((document.getElementById('view') || {}).innerText || ''),
  saveKey: !!window.lsGet && !!window.lsGet('zombie_survival_save_v2'),
}));
// 真打一场：线上版本也要能进战斗
out.combat = await page.evaluate(() => {
  window.startCombat(['walker', 'runner'], { title: '线上冒烟' });
  return !!(window.V4UI && window.V4UI.battle && window.V4UI.battle());
});
await page.waitForTimeout(800);
out.shot = dir + '/pages-online.png';
await page.screenshot({ path: out.shot, fullPage: true });
await page.evaluate(() => { const b = window.V4UI.battle(); if (b) { b.over = 'flee'; window.V4UI.close(); } });
writeFileSync('E:/Files/Games/ZombieSurvival/docs/_pages_check.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify({ status: out.httpStatus, dom: out.dom, combat: out.combat, errors: out.errors }));
