/* M7.1 探针：① 进游戏自动读档（不再弹「发现存档」）② 水体接水 ③ 净化片/煮沸净水
   ④ 物品表 undefined 体检（用户实测"麦子和种子为啥是 undefined"）⑤ 新增现代建筑的建材加成
   用法：node docs/_m71_probe.mjs [baseUrl] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const base = (process.argv[2] || 'http://127.0.0.1:5178/index.html').replace(/\?.*$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m71_shots';
mkdirSync(dir, { recursive: true });
const out = { base, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 2047, height: 1157 } });
const page = await ctx.newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

/* ① 先造一个"第 7 天 + 有净化片"的存档，再不带任何参数正常进游戏 —— 应该直接续上 */
await page.goto(base + '?dev=fresh', { waitUntil: 'load' });
await page.waitForTimeout(2200);
out.steps.makeSave = await ev(() => {
  const S = window.DEV.state();
  S.day = 7; S.inv.purify = 2; S.inv.seed_veg = 1; S.inv.seed_grain = 1; S.inv.grain = 2;
  const ok = window.saveGame(true);
  return { ok, day: S.day, saved: !!window.lsGet(window.SAVE_KEY) };
});
await page.goto(base, { waitUntil: 'load' });          // 裸进（模拟玩家直接打开游戏）
await page.waitForTimeout(2500);
out.steps.autoLoad = await ev(() => ({
  day: window.S.day,
  hasSaveModal: /发现存档/.test(document.body.innerText),
  overlays: [...document.querySelectorAll('.overlay')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 40)),
  mapMounted: !!document.querySelector('.wgrid, .wmap, .wcell'),
  envPanel: !!document.querySelector('.wenv'),
  log: [...document.querySelectorAll('#log div')].slice(0, 6).map(e => e.innerText),
}));

/* ② 重开新档必须二次确认（自动读档之后，误点 = 丢进度） */
out.steps.restartGuard = await ev(() => {
  window.openMenu();
  const menu = [...document.querySelectorAll('.overlay button')].map(b => b.innerText.trim());
  window.closeAllModals();
  window.confirmRestart();
  const dlg = [...document.querySelectorAll('.overlay')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 80));
  const btns = [...document.querySelectorAll('.overlay button')].map(b => b.innerText.trim());
  window.closeAllModals();
  return { menuHasRekey: menu.filter(t => /重开新档/.test(t)), menu, confirmDialog: dlg, confirmButtons: btns };
});

/* ③ 接水：站到临水陆地，能接 3 次 / 每次 2 份污水 / 1 行动力 */
await page.goto(base + '?dev=ready', { waitUntil: 'load' });
await page.waitForTimeout(2200);
const findCoast = () => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  return Object.values(gen.blocks).find(b => {
    if (b.biome === 'water') return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nb = gen.blocks[(b.x + dx) + ',' + (b.y + dy)];
      if (nb && nb.biome === 'water') return true;
    }
    return false;
  });
};
out.steps.intake = await page.evaluate((fnSrc) => {
  const find = eval('(' + fnSrc + ')');
  const land = find();
  window.V4World.teleport(land.x, land.y);
  const S = window.DEV.state();
  S.ap = 9; S.inv.dirty = 0; S.world.fish = {};
  const apBefore = S.ap;                                     // DEV.state() 拿到的是同一个对象，必须先快照
  const tries = [];
  for (let i = 0; i < 4; i++) tries.push(window.V4Water.intake());
  const S2 = window.DEV.state();
  return {
    at: [land.x, land.y], tries, dirty: S2.inv.dirty, apSpent: apBefore - S2.ap,
    perAction: S2.inv.dirty / 3,
    record: S2.world.fish['w:' + land.x + ',' + land.y],
    log: [...document.querySelectorAll('#log div')].slice(-5).map(e => e.innerText),
  };
}, findCoast.toString());
// 接够之后按钮要变成禁用态——等一拍，让 MutationObserver 把面板重新挂回 DOM 再读
await page.waitForTimeout(500);
out.steps.intakeUi = await ev(() => {
  const btns = [...document.querySelectorAll('button')];
  const btn = btns.find(b => /取水/.test(b.textContent || ''));
  const fish = btns.find(b => /钓鱼/.test(b.textContent || ''));
  return {
    found: !!btn, text: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : null,
    disabled: btn ? btn.disabled : null, className: btn ? btn.className : null,
    fishText: fish ? fish.textContent.replace(/\s+/g, ' ').trim() : null,
    hint: [...document.querySelectorAll('.wenv .hint')].map(e => e.innerText).filter(t => /污水/.test(t)),
  };
});

/* ④ 净水闭环：净化片（不用生火）与煮沸都要能把污水变成净水 */
out.steps.purify = await ev(() => {
  const S = window.DEV.state();
  S.inv.dirty = 4; S.inv.purify = 2; S.inv.water = 0; S.inv.wood = 2; S.ap = 9; S.base.bench = Math.max(1, S.base.bench || 0);
  const iTab = window.RECIPES.findIndex(r => r.out === 'water' && r.need.purify);
  const iBoil = window.RECIPES.findIndex(r => r.out === 'water' && r.need.wood && (r.need.dirty || 0) >= 2);
  window.craft(iTab);
  const afterTab = { water: S.inv.water, dirty: S.inv.dirty, purify: S.inv.purify };
  window.craft(iBoil);
  const afterBoil = { water: S.inv.water, dirty: S.inv.dirty, wood: S.inv.wood };
  return { iTab, iBoil, recipeTab: window.RECIPES[iTab], afterTab, recipeBoil: window.RECIPES[iBoil], afterBoil,
    log: [...document.querySelectorAll('#log div')].slice(-4).map(e => e.innerText) };
});

/* ⑤ undefined 体检：物品类型表 + 真的把背包画出来扫一遍 */
out.steps.invSanity = await ev(() => {
  const bad = Object.entries(window.ITEMS).filter(([, v]) => !window.TYPE_LABEL[v.t]).map(([k, v]) => k + ':' + v.t);
  const S = window.DEV.state();
  Object.assign(S.inv, { seed_veg: 2, seed_grain: 2, grain: 3, berry: 1, fish: 1, rod: 1, bait: 2, o2: 1, purify: 2, flare: 1, dirty: 2, wetsuit: 1 });
  for (const id in S.inv) if (S.inv[id] > 0 && !window.ITEMS[id] && id !== 'ammo') bad.push('inv:' + id);
  let dom = '';
  try { window.setTab('inv'); dom = (document.getElementById('view') || document.body).innerText; } catch (e) { dom = 'ERR:' + e.message; }
  const undefLines = dom.split('\n').filter(l => /undefined/.test(l)).slice(0, 5);
  return { badTypes: bad, invKeys: Object.keys(S.inv).filter(k => (S.inv[k] || 0) > 0), undefLines,
    itemCount: Object.keys(window.ITEMS).length, typeCount: Object.keys(window.TYPE_LABEL).length,
    labels: ['seed_veg', 'seed_grain', 'grain', 'rod', 'bait', 'o2', 'purify', 'flare']
      .map(id => id + '=' + window.itemName(id) + '/' + window.TYPE_LABEL[window.ITEMS[id].t]) };
});

/* ⑥ 新建筑 + 建材加成：地图上刷得出来，且在建材市场搜到的材料明显更多 */
out.steps.materials = await page.evaluate((fnSrc) => {
  const find = eval('(' + fnSrc + ')');
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const MODERN = ['furniture', 'hardware', 'megamart', 'office', 'appliance', 'depot', 'buildmart'];
  const counts = {};
  for (const b of Object.values(gen.blocks)) if (b.poi && MODERN.includes(b.poi)) counts[b.poi] = (counts[b.poi] || 0) + 1;
  const target = Object.values(gen.blocks).find(b => b.poi === 'buildmart') || Object.values(gen.blocks).find(b => b.poi === 'hardware');
  const plain = Object.values(gen.blocks).find(b => b.poi === 'market');
  const roll = (blk, n) => {
    window.V4World.teleport(blk.x, blk.y);
    const s = window.DEV.state();
    s.hp = s.hpMax; s.sta = 100; s.noise = 0;
    const gains = [];
    for (let i = 0; i < n; i++) {
      s.ap = 9;
      const before = s.mat;
      window.V4World.search(0);
      gains.push(s.mat - before);
      if (document.getElementById('v4b-overlay')) { const b = window.V4UI.battle(); if (b) { b.over = 'flee'; window.V4UI.close(); } }
      window.closeAllModals && window.closeAllModals();
      document.querySelectorAll('.overlay').forEach(e => e.remove());
      s.hp = s.hpMax; s.hun = 80; s.thi = 80;
    }
    return gains;
  };
  return {
    counts, modernTotal: Object.values(counts).reduce((a, b) => a + b, 0),
    bonusTable: MODERN.map(id => id + '=' + (window.V4.POIS[id]?.matBonus ?? 'none') + '/' + window.V4.POIS[id]?.name),
    // 普通档材料产出：base(2..5)+danger 再 ×1.3，建材市场再 +6 → 凡 ≥10 的必是"材料档 + 加成"
    build: target ? { poi: target.poi, at: [target.x, target.y], bonus: window.V4.POIS[target.poi].matBonus, gains: roll(target, 12) } : null,
    plain: plain ? { poi: plain.poi, at: [plain.x, plain.y], bonus: window.V4.POIS[plain.poi]?.matBonus ?? 0, gains: roll(plain, 12) } : null,
  };
}, findCoast.toString());
await page.waitForTimeout(300);

/* ⑧ 接水次数必须进存档：读档不能把次数刷回来（否则 F5 就能无限接水） */
out.steps.intakePersist = await page.evaluate((fnSrc) => {
  const find = eval('(' + fnSrc + ')');
  const land = find();
  window.V4World.teleport(land.x, land.y);
  const S = window.DEV.state();
  S.ap = 9; S.inv.dirty = 0; S.world.fish = {};
  const first = window.V4Water.intake();
  window.saveGame(true);
  return { at: [land.x, land.y], first, dirty: S.inv.dirty, rec: S.world.fish['w:' + land.x + ',' + land.y] };
}, findCoast.toString());
await page.goto(base, { waitUntil: 'load' });                 // 裸重载（自动读档）
await page.waitForTimeout(2200);
out.steps.intakeAfterReload = await ev(() => {
  const S = window.S;
  const key = S.world.cur.x + ',' + S.world.cur.y;
  const rec = (S.world.fish || {})['w:' + key];
  S.ap = 9;
  const again = window.V4Water.intake();                       // 应当还能接（剩 2）而不是回到 3 次
  const rec2 = (S.world.fish || {})['w:' + key];
  return { key, recOnLoad: rec, again, recAfter: rec2, dirty: S.inv.dirty, day: S.day };
});
await page.goto(base + '?dev=ready', { waitUntil: 'load' });
await page.waitForTimeout(2000);

/* ⑦ 截图：水边（取水按钮可用）+ 建材市场 */
out.shots = {};
{
  await page.evaluate((fnSrc) => {                            // 回到水边并把接水次数重置，截"可用"状态
    const find = eval('(' + fnSrc + ')');
    const land = find();
    window.V4World.teleport(land.x, land.y);
    const S = window.DEV.state();
    S.ap = 9; S.inv.dirty = 0; S.world.fish = {};
  }, findCoast.toString());
  await page.waitForTimeout(700);
  const shot = path.join(dir, 'water-env.png');
  await page.screenshot({ path: shot, fullPage: true });
  out.shots.env = shot;
}
{
  await ev(() => {
    const S = window.DEV.state();
    const gen = window.V4.worldgen.generateWorld(S.world.seed);
    const t = Object.values(gen.blocks).find(b => b.poi === 'buildmart') || Object.values(gen.blocks).find(b => b.poi === 'hardware');
    if (t) window.V4World.teleport(t.x, t.y);
  });
  await page.waitForTimeout(600);
  const shot = path.join(dir, 'buildmart.png');
  await page.screenshot({ path: shot, fullPage: true });
  out.shots.buildmart = shot;
}

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m71_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK');
