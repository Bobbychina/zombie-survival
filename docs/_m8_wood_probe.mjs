/* M8 探针：伐木（🪵）
   断言链：① 林地里有伐木按钮且可用 → ② 伐一次：AP−1、wood 落在预期区间 → ③ 连续伐到当日上限后被拒
   （chop() 返回 false + 按钮变灰 + hint 写明原因）→ ④ 同骰点下带斧头产量严格高于徒手 →
   ⑤ 新 POI（林场/木材加工厂）真的刷得出来 + wood 进了 5 个老建筑的掉落表 →
   ⑥ 截图 docs/_m8_shots/wood-panel.png（只截 .wenv，小图便于 OCR）→ 结果写 docs/_m8_wood_probe.json
   用法：node docs/_m8_wood_probe.mjs [baseUrl]   （默认 http://127.0.0.1:5178/index.html?dev=ready） */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const base = (process.argv[2] || 'http://127.0.0.1:5178/index.html').replace(/\?.*$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m8_shots';
mkdirSync(dir, { recursive: true });
const out = { base, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 2047, height: 1157 } });
const page = await ctx.newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

/** 读面板上的「🪵 伐木」按钮（禁用态/文案/hint 都从真实 DOM 读，不看内存状态） */
const readBtn = () => ev(() => {
  const btn = [...document.querySelectorAll('.wenv button')].find(b => /伐木/.test(b.textContent || ''));
  return {
    found: !!btn,
    text: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : null,
    disabled: btn ? btn.disabled : null,
    className: btn ? btn.className : null,
    hint: [...document.querySelectorAll('.wenv .hint')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(t => /🪵|砍/.test(t)),
    row: [...document.querySelectorAll('.wenv .row')].map(e => e.innerText.replace(/\s+/g, ' ').trim())[0] ?? null,
  };
});

await page.goto(base + '?dev=fresh', { waitUntil: 'load' });      // 清档，保证从第 1 天开始
await page.waitForTimeout(2400);
await page.goto(base + '?dev=ready', { waitUntil: 'load' });
await page.waitForTimeout(2400);

/* ① 找一块林地（离玩家最近的），传送过去 */
out.steps.forest = await page.evaluate(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const cur = S.world.cur;
  let best = null, bd = 1e9;
  for (const k in gen.blocks) {
    const b = gen.blocks[k];
    if (b.biome !== 'forest') continue;
    const d = Math.max(Math.abs(b.x - cur.x), Math.abs(b.y - cur.y));
    if (d < bd) { bd = d; best = b; }
  }
  const forestCount = Object.values(gen.blocks).filter(b => b.biome === 'forest').length;
  return best ? { at: [best.x, best.y], biome: best.biome, name: best.name, poi: best.poi, dist: bd, forestCount } : null;
});
if (!out.steps.forest) out.errors.push('世界里没有林地？');
const F = out.steps.forest.at;

out.steps.panel = await ev((at) => {
  window.V4World.teleport(at[0], at[1]);
  const S = window.DEV.state();
  S.ap = 9; S.inv.axe = 0; S.inv.crowbar = 0; S.inv.wood = 0;
  S.world.chop = {};
  window.render();
  return { at, season: window.S.day, wood: S.inv.wood, ap: S.ap };
}, F);
await page.waitForTimeout(500);
out.steps.panelBtn = await readBtn();

/* ② 伐一次：AP −1、wood 增加、次数记账进存档 */
out.steps.chopOnce = await ev((at) => {
  const S = window.DEV.state();
  const key = at[0] + ',' + at[1];
  const apBefore = S.ap, woodBefore = S.inv.wood || 0;
  const info = window.V4.gather.chopInfo();
  const ok = window.V4Gather.chop();
  const S2 = window.DEV.state();
  return {
    info, ok, apBefore, apAfter: S2.ap, apSpent: apBefore - S2.ap,
    woodGained: (S2.inv.wood || 0) - woodBefore, woodNow: S2.inv.wood || 0,
    rec: S2.world.chop[key],
    log: [...document.querySelectorAll('#log div')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(t => /伐木/.test(t)).slice(-2),
  };
}, F);

/* ③ 连续伐到当日上限：最后一次成功之后必须是"被拒"，且按钮变灰 + hint 说明原因 */
out.steps.cap = await ev((at) => {
  const S = window.DEV.state();
  S.ap = 99; S.inv.wood = 0; S.world.chop = {};
  const key = at[0] + ',' + at[1];
  const returns = [];
  let wood = 0;
  for (let i = 0; i < 12; i++) {
    const before = S.inv.wood || 0;
    const ok = window.V4Gather.chop();
    returns.push({ i, ok, gained: (S.inv.wood || 0) - before, ap: window.DEV.state().ap });
    if (ok) wood += (window.DEV.state().inv.wood || 0) - before;
    else break;
  }
  const S2 = window.DEV.state();
  const btn = [...document.querySelectorAll('.wenv button')].find(b => /伐木/.test(b.textContent || ''));
  return {
    returns, successes: returns.filter(r => r.ok).length, wood,
    lastReturn: returns[returns.length - 1], rec: S2.world.chop[key],
    apLeft: S2.ap, woodNow: S2.inv.wood,
    btnAfterCap: btn ? { text: btn.textContent.replace(/\s+/g, ' ').trim(), disabled: btn.disabled, className: btn.className } : null,
    log: [...document.querySelectorAll('#log div')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(t => /伐木/.test(t)).slice(-2),
  };
}, F);
await page.waitForTimeout(500);
out.steps.capBtn = await readBtn();

/* ④ 工具加成：把 Math.random 换成同一颗种子骰子，徒手与"只带斧头"各砍满一轮（6 次），比总产量 */
out.steps.tools = await ev((at) => {
  const S = window.DEV.state();
  const key = at[0] + ',' + at[1];
  const seedRng = (s) => {                                  // mulberry32：可控骰子
    let a = s >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  const real = Math.random;
  const run = (seed, gear) => {
    S.ap = 99; S.inv.wood = 0; S.world.chop = {};
    S.inv.axe = gear.axe; S.inv.crowbar = gear.crowbar;
    window.render();
    Math.random = seedRng(seed);                            // 同骰点：两次跑消耗的随机数序列完全一致
    let ok = 0;
    for (let i = 0; i < 6; i++) if (window.V4Gather.chop()) ok++;
    Math.random = real;
    return { chops: ok, wood: window.DEV.state().inv.wood || 0, left: (window.DEV.state().world.chop[key] || {}).left, tool: window.V4.gather.chopInfo().tool };
  };
  const bare = run(20260808, { axe: 0, crowbar: 0 });
  const crow = run(20260808, { axe: 0, crowbar: 1 });
  const axe = run(20260808, { axe: 1, crowbar: 0 });
  return {
    seed: 20260808, bare, crow, axe,
    monotonic: axe.wood >= crow.wood && crow.wood >= bare.wood,
    axeGainPct: bare.wood ? Math.round((axe.wood / bare.wood - 1) * 100) : null,
    crowGainPct: bare.wood ? Math.round((crow.wood / bare.wood - 1) * 100) : null,
  };
}, F);

/* ⑤ 次数必须落在存档里：存盘 → 裸重载（自动读档）→ 那一天已经砍够的区块仍是"砍够了"（否则 F5 就能无限木头） */
out.steps.persistBefore = await ev((at) => {
  const S = window.DEV.state();
  const key = at[0] + ',' + at[1];
  const ok = window.saveGame(true);
  return { key, saved: !!window.lsGet(window.SAVE_KEY), ok, rec: (S.world.chop || {})[key], day: S.day, wood: S.inv.wood };
}, F);
await page.goto(base, { waitUntil: 'load' });                    // 裸重载：走自动读档 + sanitizeSave
await page.waitForTimeout(2400);
out.steps.persistAfter = await page.evaluate((at) => {
  const S = window.S;
  const key = at[0] + ',' + at[1];
  const rec = (S.world.chop || {})[key];
  const info = window.V4.gather.chopInfo();
  const ok = window.V4Gather.chop();                             // 应当仍被拒
  return {
    key, day: S.day, at: S.world.cur, rec, info, chopOk: ok, wood: S.inv.wood,
    hasChopTable: !!S.world.chop, keys: Object.keys(S.world.chop || {}),
  };
}, F);

/* ⑥ POI 侧证据：新建筑刷得出来 + wood 进了 5 个老建筑的掉落表 */
out.steps.pois = await ev(() => {
  const seeds = ['m8-a', 'm8-b', 'm8-c'];
  const counts = {};
  let total = 0;
  for (const s of seeds) {
    const w = window.V4.worldgen.generateWorld(s);
    for (const b of Object.values(w.blocks)) {
      if (b.poi === 'lumber' || b.poi === 'sawmill') { counts[b.poi] = (counts[b.poi] || 0) + 1; total++; }
    }
  }
  const P = window.V4.POIS;
  const wood = {};
  for (const id of ['furniture', 'hardware', 'buildmart', 'depot', 'megamart', 'lumber', 'sawmill']) {
    wood[id] = { name: P[id] && P[id].name, icon: P[id] && P[id].icon, wood: P[id] && P[id].loot.wood, matBonus: P[id] && P[id].matBonus };
  }
  return { seeds, counts, total, wood };
});

/* ⑦ 复现面板"可用"态并截图（只截 .wenv）——回到带 dev 钩子的地址（存档仍在，dev 钩子才能用） */
await page.goto(base + '?dev=ready', { waitUntil: 'load' });
await page.waitForTimeout(2200);
await ev((at) => {
  window.V4World.teleport(at[0], at[1]);
  const S = window.DEV.state();
  S.ap = 9; S.inv.wood = 0; S.inv.axe = 1; S.inv.crowbar = 0; S.inv.dirty = 2; S.world.chop = {};
  window.render();
}, F);
await page.waitForTimeout(800);
out.steps.shotBtn = await readBtn();
out.shots = {};
{
  const shot = path.join(dir, 'wood-panel.png');
  await page.locator('.wenv').screenshot({ path: shot });
  out.shots.panel = shot;
}

/* 无树群系：按钮必须禁用并给出原因 */
await ev(() => {
  const S = window.DEV.state();
  const gen = window.V4.worldgen.generateWorld(S.world.seed);
  const city = Object.values(gen.blocks).find(b => b.biome === 'city');
  if (city) window.V4World.teleport(city.x, city.y);
});
await page.waitForTimeout(600);
out.steps.noTree = await readBtn();

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_wood_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('OK pageerror=' + out.errors.length);
