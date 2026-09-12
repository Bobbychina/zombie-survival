/* 单截"环境面板"这一块（M7.1 取水按钮）——小图 OCR 才看得清 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const base = (process.argv[2] || 'http://127.0.0.1:5178/index.html').replace(/\?.*$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m71_shots';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 2047, height: 1157 } })).newPage();
await page.goto(base + '?dev=ready', { waitUntil: 'load' });
await page.waitForTimeout(2200);
const info = await page.evaluate(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const land = Object.values(gen.blocks).find(b => {
    if (b.biome === 'water') return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nb = gen.blocks[(b.x + dx) + ',' + (b.y + dy)];
      if (nb && nb.biome === 'water') return true;
    }
    return false;
  });
  window.V4World.teleport(land.x, land.y);
  S.ap = 9; S.inv.dirty = 0; S.inv.purify = 2; S.world.fish = {};
  return { at: [land.x, land.y] };
});
await page.waitForTimeout(800);
const el = await page.$('.wenv');
if (el) await el.screenshot({ path: dir + '/env-panel.png' });
const btns = await page.$$eval('.wenv button', bs => bs.map(b => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), disabled: b.disabled })));
console.log(JSON.stringify({ info, btns }, null, 1));
await browser.close();
