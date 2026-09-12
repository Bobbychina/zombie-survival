/* file:// 双击可玩性检查：构建产物必须能不经过任何服务器直接打开。
   用法：node _file_check.mjs [fileUrl] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'file:///E:/Files/Games/zombieSurvival/dist/index.html';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  let lsOk = true;
  try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); } catch (e) { lsOk = false; }
  return {
    title: document.title,
    tabs: document.querySelectorAll('#tabs .tab').length,
    mapPanel: !!document.getElementById('v4world'),
    mapCells: document.querySelectorAll('#v4world .wcell').length,
    hud: !!document.getElementById('hud'),
    logLines: (document.querySelector('#log') || {}).childElementCount || 0,
    renderErr: String(window.__renderErr || ''),
    hasS: typeof window.S, hasStartCombat: typeof window.startCombat,
    v4: typeof window.V4, v4ui: typeof window.V4UI, v4world: typeof window.V4World, v4camp: typeof window.V4Camp,
    localStorageWorks: lsOk,
  };
});
out.errors = errs;
writeFileSync('E:/Files/Games/zombieSurvival/docs/_file_check.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
