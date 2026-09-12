/* 布局行为检查：三列里各装了什么、有没有渲染死循环、切页签后会不会串版。
   用法：node _layout_behavior.mjs [url] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 2047, height: 1157 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2000);

const out = {};
// 1) 三列内容
out.columns = await page.evaluate(() => {
  const t = el => (el ? el.innerText.replace(/\s+/g, ' ').slice(0, 120) : null);
  const map = document.getElementById('v4world'), detail = document.getElementById('v4detail'), col = document.querySelector('#view > .v4-col');
  return {
    mapHas: /大世界地图/.test(map ? map.innerText : ''),
    mapCols: map ? getComputedStyle(map.parentElement).gridTemplateColumns : null,
    detailHas: ['搜索（1 行动力）', '今夜'].map(k => (detail ? detail.innerText.includes(k) : false)),
    colHasLegacyCards: ['今日行动', '委托板'].map(k => (col ? col.innerText.includes(k) : false)),
    colText: t(col),
    splitClass: document.getElementById('view').classList.contains('v4-split'),
  };
});

// 2) 渲染死循环检测：2.5 秒内 #view 的 childList 变更次数（正常应该是个位数）
out.mutations = await page.evaluate(() => new Promise(res => {
  let n = 0;
  const mo = new MutationObserver(m => { n += m.length; });
  mo.observe(document.getElementById('view'), { childList: true, subtree: true });
  setTimeout(() => { mo.disconnect(); res(n); }, 2500);
}));

// 3) 切到背包再切回探索：不能串版，地图要回来
out.tabSwitch = await (async () => {
  const r = {};
  await page.evaluate(() => window.setTab('inv'));
  await page.waitForTimeout(500);
  r.invSplit = await page.evaluate(() => document.getElementById('view').classList.contains('v4-split'));
  r.invColumns = await page.evaluate(() => getComputedStyle(document.getElementById('view')).gridTemplateColumns);
  await page.evaluate(() => window.setTab('explore'));
  await page.waitForTimeout(700);
  r.backSplit = await page.evaluate(() => document.getElementById('view').classList.contains('v4-split'));
  r.mapBack = await page.evaluate(() => !!document.getElementById('v4world') && !!document.getElementById('v4detail'));
  return r;
})();

out.errors = errs;
writeFileSync('E:/Files/Games/zombieSurvival/docs/_layout_behavior.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
