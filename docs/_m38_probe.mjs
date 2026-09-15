// M38 取证：QoL 第一批（背包筛选 + 逐件丢弃/批量存入 + 探索补给快捷键 + 战斗重复上次）
//   ① 背包筛选条：只列有货的类 + 计数；点了真的只剩那一类（筛选不动储物箱）
//   ② 「丢1」只减 1；「全丢×N」清空整叠（老版本一点"丢"整叠就没了）
//   ③ 储物箱塞满时"能塞多少塞多少"并把原因写在日志里；批量存入只碰非消耗品（吃的留在背包）
//   ④ 探索页补给快捷条：1-4 槽 + 键盘数字键真的消耗一件
//   ⑤ 战斗「重复上次」：按钮文案 + 记录上次出招 + 目标死了自动改打第一只活的 + R 键能重复
//   ⑥ 0 未捕获异常
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const BOOT = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 150))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const bootWait = async (tries = 30) => {
  for (let i = 0; i < tries; i++) {
    const r = await ev(`(() => (typeof S === 'object' && !!S && typeof closeAllModals === 'function' && !!document.getElementById('view')) ? 1 : 0)()`)
    if (r === 1) return true
    await sleep(800)
  }
  return false
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(400)

/* 准备一份可预期的背包：各类都有货（含整叠的胶带、多件罐头、弹药） */
await ev(`(() => {
  closeAllModals(); clearLog();
  S.flags.endless = true; S.over = false; S.day = 60; S.ap = S.apMax;
  S.inv = { can: 4, water: 3, bandage: 2, medkit: 1, tape: 7, molotov: 2, a9_fmj: 24, keycard: 1, vest: 1 };
  S.store = {}; S.base.storage = 1;              // 箱子 1 级 = 12 格，方便把"塞满"测出来
  S.eq.wpn = 'crowbar'; S.tab = 'inv'; setBagFilter('all'); render();
  return 1;
})()`)
await sleep(900)

/* ① 筛选条 */
const tabs = JSON.parse(await ev(`(() => {
  const btns = [...document.querySelectorAll('#view button')].map(b => b.textContent.trim());
  const chips = btns.filter(t => /^(全部|🍖|💧|💊|🔩|🗡️|🧥|💣|🔑|🔫)/.test(t));
  const rows = () => [...document.querySelectorAll('#view .lrow .nm')].map(e => e.textContent.trim());
  return JSON.stringify({ chips, rows: rows().slice(0, 20) });
})()`))
ok('背包页出现筛选条（全部 + 只列有货的类）', tabs.chips.length >= 5 && tabs.chips[0].startsWith('全部'), JSON.stringify(tabs.chips))
ok('筛选条带计数（该类的种类数）', tabs.chips.some(c => /🍖 食物 1/.test(c)) && tabs.chips.some(c => /🔩 材料 1/.test(c)), JSON.stringify(tabs.chips.filter(c => /\d/.test(c))))

const foodOnly = JSON.parse(await ev(`(() => {
  const b = [...document.querySelectorAll('#view button')].find(x => /🍖 食物/.test(x.textContent));
  b.click();
  return JSON.stringify({ filter: window.bagFilter });
})()`))
await sleep(700)
const foodRows = JSON.parse(await ev(`(() => {
  const txt = document.getElementById('view').textContent.replace(/\\s+/g, ' ');
  const names = [...document.querySelectorAll('#view .lrow .nm')].map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  return JSON.stringify({ filter: window.bagFilter, names, txt: txt.slice(0, 400),
    hint: (txt.match(/筛选[^。]{0,40}/) || [''])[0] });
})()`))
ok('点「🍖 食物」后随身列表只剩食物（胶带/绷带这些不在列表里了）',
  foodOnly.filter === 'food' && foodRows.names.some(n => /罐头/.test(n)) && !/胶带|绷带|抗生素|钥匙卡/.test(foodRows.txt),
  JSON.stringify({ names: foodRows.names, filter: foodRows.filter }))
ok('筛选状态有明确提示（筛选只作用于随身背包）', /筛选/.test(foodRows.hint), foodRows.hint)
await shot('01_bag_filter')

/* ② 逐件丢弃 */
const drop1 = JSON.parse(await ev(`(() => {
  const before = S.inv.tape;
  setBagFilter('all');
  const row = [...document.querySelectorAll('#view .lrow')].find(r => /胶带/.test(r.textContent));
  const btn = [...row.querySelectorAll('button')].find(b => /^丢1$/.test(b.textContent.trim()));
  btn.click();
  return JSON.stringify({ before, after: S.inv.tape, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(700)
ok('「丢1」只丢 1 个（7 → 6）', drop1.before === 7 && drop1.after === 6, JSON.stringify(drop1))

const dropAll = JSON.parse(await ev(`(() => {
  const row = [...document.querySelectorAll('#view .lrow')].find(r => /胶带/.test(r.textContent));
  const btn = [...row.querySelectorAll('button')].find(b => /全丢×6/.test(b.textContent));
  const label = btn ? btn.textContent.trim() : 'NO-BTN';
  if (btn) btn.click();
  return JSON.stringify({ label, after: S.inv.tape === undefined ? 0 : S.inv.tape, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(700)
ok('「全丢×N」按钮写明数量，点了清空整叠', /全丢×6/.test(dropAll.label) && dropAll.after === 0, JSON.stringify(dropAll))

/* ③ 储物箱：塞满时"能塞多少塞多少" + 批量存入不动吃的 */
const partial = JSON.parse(await ev(`(() => {
  S.store = {}; S.base.storage = 1;                      // 12 格
  for (let i = 0; i < 10; i++) S.store['f' + i] = 1;      // 先占 10 格 → 只剩 2
  S.store.f0 = S.store.f0;   // noop
  S.inv.can = 5; S.tab = 'inv'; setBagFilter('all'); render();
  deposit('can');
  return JSON.stringify({ can: S.inv.can === undefined ? 0 : S.inv.can, stored: S.store.can || 0, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(700)
ok('储物箱只剩 2 格时存 5 件：存进 2、背包留 3，并说明原因', partial.stored === 2 && partial.can === 3 && /只剩 2 格/.test(partial.log), JSON.stringify(partial))

const batch = JSON.parse(await ev(`(() => {
  S.store = {}; S.base.storage = 3;                       // 36 格
  S.inv = { can: 3, water: 2, tape: 4, molotov: 1, a9_fmj: 24, keycard: 1, vest: 1, bandage: 1 };
  S.tab = 'inv'; setBagFilter('all'); render();
  depositAll();
  return JSON.stringify({ inv: Object.keys(S.inv).sort(), store: Object.keys(S.store).sort(), log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(700)
const keptEat = ['can', 'water', 'bandage'].filter(k => (batch.inv || []).includes(k))
ok('「存入非消耗品」把材料/投掷/弹药/剧情/装备都存了', ['tape', 'molotov', 'a9_fmj', 'keycard', 'vest'].every(k => batch.store.includes(k)), JSON.stringify(batch.store))
ok('批量存入刻意不碰食物/饮水/医疗（出门前不会把吃的全塞箱子）', keptEat.length === 3, JSON.stringify(batch.inv))
await shot('02_bag_batch')

/* ④ 探索页补给快捷条 + 数字键 */
const bar = JSON.parse(await ev(`(() => {
  S.inv = { bandage: 2, water: 3, can: 2, anti: 1, medkit: 1 };
  S.tab = 'explore'; render();
  const card = [...document.querySelectorAll('#view .card')].find(c => /补给快捷/.test(c.textContent));
  return JSON.stringify({ has: !!card, text: card ? card.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
    keys: card ? [...card.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()) : [] });
})()`))
await sleep(800)
ok('探索页出现「补给快捷」条（1-4 槽）', bar.has && bar.keys.length === 4, JSON.stringify(bar.keys))
await shot('03_quickbar')

const hotkey = JSON.parse(await ev(`(() => {
  const before = S.inv.bandage;
  const evt = new KeyboardEvent('keydown', { key: '1', bubbles: true });
  document.dispatchEvent(evt);
  return JSON.stringify({ before, after: S.inv.bandage === undefined ? 0 : S.inv.bandage, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(800)
ok('按键盘 1 真的用掉一件绷带（2 → 1）', hotkey.before === 2 && hotkey.after === 1 && /绷带/.test(hotkey.log), JSON.stringify(hotkey))

/* ⑤ 战斗「重复上次」 */
const battle = JSON.parse(await ev(`(() => {
  closeAllModals(); if (window.V4UI && V4UI.close) V4UI.close();
  S.inv.pistol = 1; S.eq.wpn = 'pistol'; S.inv.a9_fmj = 200; syncAmmo();   // 弹药给足：探针要测的是"重复/换目标"，不是打光子弹
  S.hpMax = 150; S.hp = 150; S.staMax = 100; S.sta = 100;                  // 血拉满：别让两只丧尸在第三步就把玩家打死（b.over='lose' 会让后续断言全假）
  window.startCombat(['walker', 'walker'], { title: 'M38 探针' });
  // 血量拉满：探针要的是"重复/换目标"的逻辑，不想让这一枪把战斗提前打完
  const b = V4UI.battle(); b.foes.forEach(f => { f.hp = 999; f.hpMax = 999; });
  return JSON.stringify({ open: !!window.V4UI && V4UI.isOpen(), moves: [...document.querySelectorAll('.mv-slot .mv-name')].map(e => e.textContent.trim()) });
})()`))
await sleep(1200)
ok('战斗界面打开（两只普通丧尸）', battle.open === true && battle.moves.length >= 2, JSON.stringify(battle.moves))

const act = JSON.parse(await ev(`(() => {
  const btn = document.querySelector('.mv-slot:not(.off)');
  const name = btn ? btn.textContent.trim().slice(0, 20) : 'NONE';
  if (btn) btn.click();
  const b = V4UI.battle(); b.foes.forEach(f => { f.hp = 999; f.hpMax = 999; });
  const last = V4UI.last();
  return JSON.stringify({ name, last, hp: b.foes.map(f => Math.round(f.hp)) });
})()`))
await sleep(900)
ok('出招后记下「上次动作」（招式 id + 目标）', !!act.last && !!act.last.id && act.last.target >= 0, JSON.stringify(act.last))

const rbtn = JSON.parse(await ev(`(() => {
  const b = [...document.querySelectorAll('#v4b-overlay button')].find(x => /重复上次/.test(x.textContent));
  return JSON.stringify({ label: b ? b.textContent.trim() : 'NO-BTN', disabled: b ? b.disabled : null });
})()`))
ok('战斗里出现「↻ 重复上次：…（R）」按钮且可点', /重复上次/.test(rbtn.label) && rbtn.disabled === false, JSON.stringify(rbtn))
await shot('04_battle_repeat')

const repeated = JSON.parse(await ev(`(() => {
  const b = V4UI.battle();
  const before = { round: b.round, foes: b.foes.map(f => Math.round(f.hp)), log: b.log.length };
  const okr = V4UI.repeat();
  const b2 = V4UI.battle();
  if (b2) b2.foes.forEach(f => { f.hp = 999; f.hpMax = 999; });
  return JSON.stringify({ okr, before, after: { round: b2 ? b2.round : -1, log: b2 ? b2.log.length : -1 } });
})()`))
await sleep(900)
ok('V4UI.repeat() 真的又出了一招（回合前进 / 日志变长）', repeated.okr === true && repeated.after.log > repeated.before.log, JSON.stringify(repeated))

/* 上次那只死了 → 自动改打第一只活的（把 1 号打死，repeat 必须落到 0 号） */
const retarget = JSON.parse(await ev(`(() => {
  V4UI.target(1);
  const b = V4UI.battle();
  b.foes[1].hp = 0;
  const btn = [...document.querySelectorAll('#v4b-overlay button')].find(x => /重复上次/.test(x.textContent));
  const diag = { disabled: btn ? btn.disabled : null, row: btn ? btn.parentElement.textContent.replace(/\\s+/g, ' ').trim() : null,
    over: !!b.over, foes: b.foes.map(f => [Math.round(f.hp), f.hpMax]), last: V4UI.last(), target: b.target };
  const okr = V4UI.repeat();
  const b2 = V4UI.battle();
  if (b2) b2.foes.forEach(f => { f.hp = 999; f.hpMax = 999; });
  return JSON.stringify({ okr, target: b2 ? b2.target : -1, last: V4UI.last(), diag });
})()`))
await sleep(900)
ok('上次那只死了 → 自动改打第一只活的（target 变 0）', retarget.okr === true && retarget.target === 0, JSON.stringify(retarget))

const keyRepeat = JSON.parse(await ev(`(() => {
  const b = V4UI.battle();
  const n0 = b.log.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  return JSON.stringify({ n0 });
})()`))
await sleep(900)
const keyAfter = JSON.parse(await ev(`(() => { const b = V4UI.battle(); return JSON.stringify({ n: b ? b.log.length : -1, over: b ? !!b.over : null }); })()`))
ok('R 键也能重复上次（键盘路径）', keyAfter.n > keyRepeat.n0 || keyAfter.over === true, JSON.stringify({ before: keyRepeat.n0, after: keyAfter }))
await ev(`(() => { try { V4UI.close(); } catch (e) {} closeAllModals(); return 1 })()`)
await sleep(600)

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
