/* 一次性排查：存档里到底有没有 world 字段、legacy 暴露了哪些存档函数。
   用法：node _save_check.mjs [url] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const out = {};
out.fns = await page.evaluate(() => ({
  saveGame: typeof window.saveGame, autosave: typeof window.autosave, writeSave: typeof window.writeSave,
  loadGame: typeof window.loadGame, newState: typeof window.newState, sanitizeSave: typeof window.sanitizeSave,
  S: typeof window.S, DEV: typeof window.DEV,
}));
out.before = await page.evaluate(() => {
  const S = window.DEV.state();
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  return {
    day: S.day, mat: S.mat, hasWorld: !!S.world, worldSeed: S.world && S.world.seed,
    cur: S.world && S.world.cur, rawLen: raw.length, rawHasWorld: raw.includes('"world"'),
    lsKeys: Object.keys(localStorage),
  };
});
// 手动触发一次写入（优先用 legacy 的 saveGame，其次 autosave）
out.wrote = await page.evaluate(() => {
  try { if (typeof window.saveGame === 'function') { window.saveGame(true); return 'saveGame'; } } catch (e) { return 'saveGame threw: ' + e.message; }
  try { if (typeof window.autosave === 'function') { window.autosave(); return 'autosave'; } } catch (e) { return 'autosave threw: ' + e.message; }
  return 'no save fn';
});
out.after = await page.evaluate(() => {
  const S = window.DEV.state();
  // 直接手工序列化一份，看看 world 到底在不在对象上
  const manual = JSON.stringify({ world: S.world }).slice(0, 120);
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  return { rawLen: raw.length, rawHasWorld: raw.includes('"world"'), manualHead: manual, worldSeed: S.world && S.world.seed };
});
out.reload = await (async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const S = window.DEV.state();
    const raw = localStorage.getItem('zombie_survival_save_v2') || '';
    return { day: S.day, mat: S.mat, hasWorld: !!S.world, cur: S.world && S.world.cur, rawHasWorld: raw.includes('"world"'), rawLen: raw.length };
  });
})();
out.errs = errs;
writeFileSync('E:/Files/Games/zombieSurvival/docs/_save_check.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
