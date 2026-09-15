// M32b 取证：商人卖的是"各种子弹"而不是旧版的笼统弹药，而且买了真的进背包/进枪
//   ① 货架弹药段（按口径/弹种，穿甲弹更贵）② 点"购买"真的扣材料 + 进对应弹种
//   ③ S.ammo 只是镜像（不是死池子）④ 杂牌弹药 grant 会折成真弹（跟着手上枪的口径）
//   ⑤ 坏货架（伪 id）不许成交 ⑥ 材料不足买不成 ⑦ 开局/读档手里有实弹
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(4200)
await ev(`(() => { if (typeof render === 'function') render(); return 1 })()`); await sleep(700)

/* 开局：给点材料和一把手枪（c9），把商人叫出来 */
const setup = JSON.parse(await ev(`(() => {
  S.mat = 600; S.inv.pistol = 1; equipWeapon('pistol');
  S.shop = { day: S.day, bought: {} };        // 每日限购清零：探针可反复跑（不然第二次就"今日售罄"）
  closeAllModals(); openMerchant();
  const bd = document.querySelector('#overlay-root .modal-bd');
  const rows = [...bd.querySelectorAll('.lrow')].map(r => r.querySelector('.nm').textContent.trim().replace(/\\s+/g, ' '));
  return JSON.stringify({
    hasAmmoSect: /🔩 弹药/.test(bd.textContent), sections: [...bd.querySelectorAll('.sect-title')].map(e => e.textContent.trim()),
    rowCount: rows.length, rows,
    pseudoOnShelf: window.MERCHANT.some(m => m.id === 'ammo'),
    ammoRows: window.MERCHANT.filter(m => m.sec === 'ammo').map(m => m.id),
    calibers: [...new Set(window.MERCHANT.filter(m => m.sec === 'ammo').map(m => (window.ITEMS[m.id] || {}).cal))].sort(),
    startAmmo: S.inv.a9_fmj || 0, ammoMirror: S.ammo,
  })
})()`))
ok('商人弹窗里有独立的「🔩 弹药」段', setup.hasAmmoSect && setup.sections.some(s => /弹药/.test(s)), JSON.stringify(setup.sections))
ok('弹药品类够多（≥8 行 / ≥5 个口径）', setup.ammoRows.length >= 8 && setup.calibers.length >= 5, JSON.stringify({ n: setup.ammoRows.length, cals: setup.calibers }))
ok('货架上不再有旧版的笼统子弹（伪 id "ammo"）', setup.pseudoOnShelf === false && !setup.rows.some(r => /^ammo /.test(r)), JSON.stringify(setup.rows.slice(0, 4)))
ok('弹窗里列的是具体弹种名（如 9mm AP / 5.56 FMJ）', setup.rows.filter(r => /FMJ|AP|鹿弹|穿甲|竞赛/.test(r)).length >= 6, JSON.stringify(setup.rows.filter(r => /FMJ|AP|鹿弹|穿甲|竞赛/.test(r))))
ok('开局那 24 发是实弹（不再是 S.ammo 里的死数）', setup.startAmmo >= 24, 'inv.a9_fmj=' + setup.startAmmo + ' mirror=' + setup.ammoMirror)
await shot('01_merchant_ammo')

/* ① 点真按钮买 9mm 穿甲弹：材料按报价扣、背包 +8 */
const buy = JSON.parse(await ev(`(async () => {
  const before = { mat: S.mat, ap: S.inv.a9_ap || 0 };
  const row = [...document.querySelectorAll('#overlay-root .modal-bd .lrow')].find(r => /9mm AP/.test(r.textContent));
  if (!row) return JSON.stringify({ err: 'NO-ROW' });
  const btn = row.querySelector('button');
  const label = btn.textContent.trim();
  const priced = Number(([...row.querySelectorAll('.tag')].find(t => /🔩/.test(t.textContent)) || { textContent: '' }).textContent.replace(/[^0-9]/g, ''));
  if (btn.disabled) return JSON.stringify({ err: 'DISABLED', label });
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({ before, priced, label, mat: S.mat, ap: S.inv.a9_ap || 0,
    bought: (S.shop.bought || {}).a9_ap || 0, mirror: S.ammo, loaded: loadedAmmo('c9'),
    log: (S.logBuf || []).slice(-3).map(p => p[1]) });
})()`))
ok('点「购买」真的扣了报价那么多材料', buy.err === undefined && buy.before.mat - buy.mat === buy.priced, JSON.stringify({ priced: buy.priced, delta: buy.err ? null : buy.before.mat - buy.mat, log: buy.log }))
ok('买到的子弹真的进背包（对应弹种 +8）', buy.err === undefined && buy.ap === buy.before.ap + 8, 'a9_ap=' + buy.ap)
ok('S.ammo 跟着当前口径的实弹走（不再是没人认的池子）', buy.err === undefined && buy.mirror === buy.ap && buy.ap > 0, 'mirror=' + buy.mirror + ' loaded=' + buy.loaded + ' a9_ap=' + buy.ap)
await shot('02_after_buy')

/* ② 镜像不是死池子：手工灌一个假值，syncAmmo() 必须按背包装填弹种算回来 */
const mirror = JSON.parse(await ev(`(() => {
  const real = S.inv[loadedAmmo('c9')] || 0;
  S.ammo = 99999; syncAmmo();
  return JSON.stringify({ real, after: S.ammo, total: ammoCount() });
})()`))
ok('S.ammo 是"当前装的弹"的镜像（灌 99999 会被算回真实发数）', mirror.after === mirror.real && mirror.after !== 99999, JSON.stringify(mirror))

/* ③ 杂牌弹药（掉落/委托里的 'ammo'）会折成真弹，而且跟着手上枪的口径 */
const grantTest = JSON.parse(await ev(`(() => {
  S.inv.shotgun = 1;
  const fmj0 = S.inv.a9_fmj || 0, buck0 = S.inv.a12_buck || 0;
  equipWeapon('pistol'); grant('ammo', 12);
  const fmj1 = S.inv.a9_fmj || 0;
  equipWeapon('shotgun'); grant('ammo', 6);
  const buck1 = S.inv.a12_buck || 0;
  return JSON.stringify({ fmj0, fmj1, buck0, buck1, pseudoInBag: 'ammo' in S.inv, mirror: S.ammo, loaded: loadedAmmo('c12') });
})()`))
ok('grant("ammo") 折成手上枪的弹种（手枪 → 9mm +12）', grantTest.fmj1 === grantTest.fmj0 + 12, JSON.stringify({ from: grantTest.fmj0, to: grantTest.fmj1 }))
ok('换成霰弹枪再 grant("ammo") → 12 号鹿弹 +6', grantTest.buck1 === grantTest.buck0 + 6, JSON.stringify({ from: grantTest.buck0, to: grantTest.buck1 }))
ok('背包里永远不会出现伪 id "ammo"（旧 bug 的直接症状）', grantTest.pseudoInBag === false && grantTest.mirror > 0, JSON.stringify({ pseudoInBag: grantTest.pseudoInBag, mirror: grantTest.mirror }))

/* ④ 坏货架兜底：塞一条不存在物品表里的 id，点"购买"不许成交 */
const bad = JSON.parse(await ev(`(async () => {
  window.MERCHANT.push({ id: 'ammo', n: 15, cost: 30, stock: 1 });
  openMerchant();
  const rows = [...document.querySelectorAll('#overlay-root .modal-bd .lrow')];
  const row = rows.find(r => /^ammo /.test(r.querySelector('.nm').textContent.trim()));
  const mat0 = S.mat;
  if (row) { const b = row.querySelector('button'); if (!b.disabled) b.click(); }
  await new Promise(r => setTimeout(r, 300));
  const out = { found: !!row, mat0, mat: S.mat, pseudo: 'ammo' in S.inv, log: (S.logBuf || []).slice(-2).map(p => p[1]),
    stillOnShelf: window.MERCHANT.some(m => m.id === 'ammo') };
  window.MERCHANT.pop();
  return JSON.stringify(out);
})()`))
ok('坏货架（未知 id）点购买也不成交：材料一分没扣', bad.found === true && bad.mat === bad.mat0, JSON.stringify({ mat0: bad.mat0, mat: bad.mat }))
ok('而且给出了人话日志（不是静默吞掉）', Array.isArray(bad.log) && bad.log.some(l => /不成交|不在物品表/.test(l)), JSON.stringify(bad.log))
ok('背包里没有多出伪物品', bad.pseudo === false, 'pseudo=' + bad.pseudo)

/* ⑤ 材料不足：买不成，材料不变 */
const poor = JSON.parse(await ev(`(async () => {
  closeAllModals(); S.mat = 3; openMerchant();
  const row = [...document.querySelectorAll('#overlay-root .modal-bd .lrow')].find(r => /9mm AP/.test(r.textContent));
  const btn = row.querySelector('button');
  const disabled = btn.disabled, label = btn.textContent.trim();
  btn.click();
  await new Promise(r => setTimeout(r, 250));
  const out = { disabled, label, mat: S.mat, log: (S.logBuf || []).slice(-1).map(p => p[1]) };
  closeAllModals(); return JSON.stringify(out);
})()`))
ok('材料不够时按钮是禁用/材料不足，点了也不扣材料', poor.mat === 3 && (poor.disabled || /材料不足/.test(poor.label)), JSON.stringify(poor))

/* ⑥ 货架体检：window.ITEMS 实测每一行都是真物品（口径也都认得） */
const shelf = JSON.parse(await ev(`(() => {
  const bad = window.MERCHANT.filter(m => !window.ITEMS[m.id]).map(m => m.id);
  const badCal = window.MERCHANT.filter(m => m.sec === 'ammo' && !window.CALIBERS[window.ITEMS[m.id].cal]).map(m => m.id);
  return JSON.stringify({ bad, badCal, n: window.MERCHANT.length, ammoN: window.MERCHANT.filter(m => m.sec === 'ammo').length,
    stockSum: window.MERCHANT.filter(m => m.sec === 'ammo').reduce((a, m) => a + (m.stock || 0), 0) });
})()`))
ok('货架每一行都在 ITEMS 里，弹药行的口径也在口径表里', shelf.bad.length === 0 && shelf.badCal.length === 0, JSON.stringify(shelf))
ok('弹药每天的总库存够用（不是"看了一眼买不到"）', shelf.ammoN >= 8 && shelf.stockSum >= 10, JSON.stringify({ ammoN: shelf.ammoN, stockSum: shelf.stockSum }))

await ev(`(() => { if (typeof setTab === 'function') setTab('inv'); return 1 })()`); await sleep(700)
await shot('03_bag_ammo_rows')
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
