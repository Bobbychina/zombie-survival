/* 一次性排查：为什么潜水按钮/调用失败。打印当前区块、面板文本、以及各种前置条件。 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const url = process.argv[2] || 'http://127.0.0.1:5178/index.html?dev=fresh';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 2047, height: 1157 } })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2000);
// 二段式：先 teleport，等一拍再读面板
await page.evaluate(() => { const S = window.DEV.state(); const gen = window.V4.worldgen.generateWorld(S.world.seed); const sk = Object.values(gen.blocks).find(b => b.poi === 'sunken'); window.V4World.teleport(sk.x, sk.y); });
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const sunken = Object.values(gen.blocks).find(b => b.poi === 'sunken');
  window.V4World.teleport(sunken.x, sunken.y);
  const S2 = window.DEV.state();
  const cur = gen.blocks[S2.world.cur.x + ',' + S2.world.cur.y];
  const detail = document.getElementById('v4detail');
  const txt = detail ? detail.innerText : '';
  const i = txt.indexOf('水体');
  return {
    sunkenAt: [sunken.x, sunken.y, sunken.poi],
    cur: S2.world.cur, curPoi: cur ? cur.poi : null, curBiome: cur ? cur.biome : null,
    ap: S2.ap, o2: S2.inv.o2, waterPanel: i >= 0 ? txt.slice(i, i + 320).replace(/\s+/g, ' ') : null,
    diveResult: (() => { try { return window.V4Water.dive(); } catch (e) { return 'THREW: ' + e.message; } })(),
    toasts: [...document.querySelectorAll('#toasts div')].map(e => e.innerText).slice(-3),
    cachedWorld: (() => {
      const st = window.V4.worldstate;
      const sv = st.ensureSaveWorld(window.DEV.state());
      const cw = st.worldOf(sv.seed);
      const cb = cw.blocks[sv.cur.x + ',' + sv.cur.y];
      let diff = 0; for (const k in cw.blocks) if (cw.blocks[k].biome !== gen.blocks[k].biome) diff++;
      return { seed: sv.seed, genSeed: S.world.seed, cur: sv.cur, poib: cb ? cb.poi : null, biome: cb ? cb.biome : null,
        biomeDiffBlocks: diff,
        sunkenCount: Object.values(cw.blocks).filter(x => x.poi === 'sunken').length,
        freshCount: Object.values(gen.blocks).filter(x => x.poi === 'sunken').length,
        cachedWater: Object.values(cw.blocks).filter(x => x.biome === 'water').length,
        freshWater: Object.values(gen.blocks).filter(x => x.biome === 'water').length };
    })(),
    diveFnTypes: {
      dive: typeof window.V4Water?.dive, fish: typeof window.V4Water?.fish, swim: typeof window.V4Water?.swim,
      water: typeof window.V4.water, waterDive: typeof window.V4.water?.dive,
    },
  };
});
out.errors = errs;
writeFileSync('E:/Files/Games/zombieSurvival/docs/_m7_debug.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
