// M72 取证：化学品转化链（工业区化学品 → 医疗台/弹药台 → 抗生素 / 爆炸物）
//   ① 搜到化学品：走 grant()（搜刮掉落的那条路）进背包，背包页看得到
//   ② 据点页有「🧪 化学品转化链」，两个台子各 2 行（共 8 颗按钮）
//   ③ 没建医疗台：抗生素一行按钮禁用 + 写明"先建医疗台"
//   ④ 建到 Lv2 + 给料：合成 1 份 → 化学品 -2、电子元件 -1、抗生素 +1、当日产能 1/3
//   ⑤ 「合成满」一次顶到产能上限，不超支；额度用尽后按钮禁用 + 文案含"产能用完"
//   ⑥ 材料守恒：消耗量 = 单份配方 × 份数（背包前后差与 chemUsed 对账）
//   ⑦ 弹药台：化学品 + 火药 + 铁片 → 手雷；化学品 + 火药 + 铁片 → 5.56 穿甲弹 ×8（各 2 份顶格）
//   ⑧ 跨天：产能回满（chemDay 跟进、chemUsed 清零）
//   ⑨ 存档往返：产能额度不会被 sanitize 洗掉（洗掉 = 读档就能无限合成）
//   ⑩ 配方表出口：window.CHEM_ROWS，每行都吃化学品、产出是成品（med/thr/ammo）
// 用法：node docs/_m72_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
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
const j = async (x) => JSON.parse(String(await ev(x)))
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
/** 打开据点页并渲染 */
const openBase = async () => { await ev(`(() => { closeAllModals(); setTab('base'); render(); return 1 })()`); await sleep(350) }
const pageText = () => ev("(() => String((document.getElementById('view') || {}).textContent || '').replace(/\\s+/g, ' '))()")
/** 找某一行合成按钮：按 onclick 前缀匹配（份数写死为 1 / 99，别猜文案形状） */
const btnSel = (rowId, times) => "[...document.querySelectorAll('#view button')].find(b => (b.getAttribute('onclick')||'').indexOf(\"synthChem('" + rowId + "',\") >= 0 && /\\u5408\\u6210\\u6ee1/.test(b.textContent) === " + (times > 1 ? 'true' : 'false') + ")"
const click = (rowId, times) => ev("(() => { const b = " + btnSel(rowId, times) + "; if (!b) return 'NOBTN'; if (b.disabled) return 'DISABLED'; b.click(); return 'ok' })()")
const info = () => j(`(() => JSON.stringify({
  day: S.day, chem: itemCount('chem'), chip: itemCount('chip'), powder: itemCount('powder'), metal: itemCount('metal'),
  anti: itemCount('anti'), grenade: itemCount('grenade'), ap: itemCount('a556_ap'),
  usedAnti: (S.base.chemUsed || {}).anti || 0, usedGrenade: (S.base.chemUsed || {}).grenade || 0, usedAp: (S.base.chemUsed || {}).a556_ap || 0,
  chemDay: S.base.chemDay, medlab: S.base.medlab || 0, loading: S.base.loading || 0,
}))()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); S.over = false; S.ap = 30;
  S.base = { door:0, bed:0, filter:0, garden:0, bench:0, storage:0, radio:0, wall:0, exDay:0, exUsed:{}, medlab:0, loading:0, chemDay:0, chemUsed:{} };
  S.inv = { can:2, water:4, bandage:1, crowbar:1 }; S.mat = 60; render(); return 1 })()`)

/* ① 搜到化学品：走 grant（搜刮/掉落那条路）进背包，背包页里看得到 */
const chem0 = Number(await ev(`(() => { grant('chem', 6); return itemCount('chem') })()`))
await ev(`(() => { setTab('inv'); render(); return 1 })()`); await sleep(300)
const invText = String(await pageText())
ok('① 搜到的化学品进背包（grant 6 份 → 背包 6 份，背包页显示「化学药剂」）', chem0 === 6 && invText.indexOf('化学药剂') >= 0, 'itemCount=' + chem0)
await ev(`(() => { setTab('base'); render(); return 1 })()`)

/* ② 据点页里的化学品转化链 */
await openBase()
const t0 = String(await pageText())
const btnCount = Number(await ev("(() => document.querySelectorAll('#view button[onclick^=\"synthChem\"]').length)()"))
ok('② 据点页有「🧪 化学品转化链」+ 医疗台/弹药台两个合成区块（4 行 = 8 颗按钮）',
  t0.indexOf('化学品转化链') >= 0 && t0.indexOf('医疗台 · 合成') >= 0 && t0.indexOf('弹药台 · 合成') >= 0 && btnCount === 8,
  '按钮数=' + btnCount)
/* 截图取证：把「🧪 化学品转化链」滚进视野（不然拍到的是页顶的守夜那块）。
   注意：M53 会把非探索页按 `.sect-title` 分段**原地包成 v4 卡片**，包完之后顶层就没有 .sect-title 了
   （第一版按 .sect-title 找，几秒后必然找不到）——所以这里改成"从合成按钮往上找最近的那一段"。 */
const scrollToChem = () => ev(`(() => {
  const view = document.getElementById('view');
  const btn = view && view.querySelector('button[onclick^="synthChem"]');
  if (!btn) return 'NOBTN';
  let el = btn;
  while (el.parentElement && el.parentElement !== view) {
    el = el.parentElement;
    if (/化学品转化链/.test(el.textContent || '')) break;
  }
  el.scrollIntoView({ block: 'start' });
  return 'ok:' + Math.round(view.scrollTop);
})()`)
await scrollToChem(); await sleep(400)
if (outDir) await shot('m72-base')

/* ③ 没建医疗台：抗生素一行做不了 */
const noLab = await click('anti', 1)
const t1 = String(await pageText())
ok('③ 没建医疗台时抗生素做不了，并写明"先建医疗台"',
  noLab === 'DISABLED' && t1.indexOf('先建医疗台') >= 0, '按钮=' + noLab)

/* ④ 医疗台 Lv2 + 给料：合成 1 份抗生素 */
await ev(`(() => { S.base.medlab = 2; S.inv.chem = 20; S.inv.chip = 10; render(); return 1 })()`); await sleep(250)
const b4 = await info()
const one = await click('anti', 1)
await sleep(250)
const a4 = await info()
ok('④ 医疗台 Lv2：合成 1 份抗生素 → 化学品 -2、电子元件 -1、抗生素 +1、当日产能 1/3',
  one === 'ok' && a4.chem === b4.chem - 2 && a4.chip === b4.chip - 1 && a4.anti === b4.anti + 1 && a4.usedAnti === 1,
  JSON.stringify({ chem: a4.chem, chip: a4.chip, anti: a4.anti, used: a4.usedAnti }))

/* ⑤ 合成满 + 额度用尽 */
const bulk = await click('anti', 99)
await sleep(250)
const a5 = await info()
ok('⑤「合成满 (2)」一次顶到产能上限 3/3：化学品再 -4、电子元件再 -2、抗生素再 +2（不超支）',
  bulk === 'ok' && a5.usedAnti === 3 && a5.chem === b4.chem - 6 && a5.chip === b4.chip - 3 && a5.anti === b4.anti + 3,
  JSON.stringify({ used: a5.usedAnti, chem: a5.chem, chip: a5.chip, anti: a5.anti }))
const again = await click('anti', 1)
await sleep(200)
const t5 = String(await pageText())
ok('⑤ 产能用尽后按钮禁用，文案写清"今天的产能用完了"',
  again === 'DISABLED' && t5.indexOf('产能用完') >= 0, '按钮=' + again)

/* ⑥ 材料守恒：消耗量 = 单份配方 × 份数（与 chemUsed 对账） */
const consumedChem = b4.chem - a5.chem, consumedChip = b4.chip - a5.chip
ok('⑥ 材料守恒：3 份抗生素消耗 化学品×6 / 电子元件×3（= 单份 2/1 × 3），产出 3 件',
  consumedChem === 2 * a5.usedAnti && consumedChip === 1 * a5.usedAnti && a5.anti - b4.anti === 1 * a5.usedAnti,
  JSON.stringify({ consumedChem, consumedChip, made: a5.anti - b4.anti, used: a5.usedAnti }))

/* ⑦ 弹药台：爆炸物 + 弹药各顶格 2 份 */
await ev(`(() => { S.base.loading = 2; S.inv.chem = 20; S.inv.powder = 20; S.inv.metal = 20; render(); return 1 })()`); await sleep(250)
const b7 = await info()
const g1 = await click('grenade', 1)
await sleep(220)
const a7 = await info()
ok('⑦ 弹药台：合成 1 枚手雷 → 化学品 -2、火药 -3、铁片 -1、手雷 +1',
  g1 === 'ok' && a7.chem === b7.chem - 2 && a7.powder === b7.powder - 3 && a7.metal === b7.metal - 1 && a7.grenade === b7.grenade + 1 && a7.usedGrenade === 1,
  JSON.stringify({ chem: a7.chem, powder: a7.powder, metal: a7.metal, grenade: a7.grenade }))
const apBulk = await click('a556_ap', 99)
await sleep(220)
const a8 = await info()
ok('⑦ 弹药台「合成满 (2)」：5.56 穿甲弹 +16（8 发/份 × 2），化学品 -4 / 火药 -8 / 铁片 -6',
  apBulk === 'ok' && a8.ap === b7.ap + 16 && a8.usedAp === 2 && a8.chem === b7.chem - 2 - 4 && a8.powder === b7.powder - 3 - 8 && a8.metal === b7.metal - 1 - 6,
  JSON.stringify({ ap: a8.ap, usedAp: a8.usedAp, chem: a8.chem, powder: a8.powder, metal: a8.metal }))
await scrollToChem(); await sleep(400)
if (outDir) await shot('m72-after-synth')

/* ⑧ 跨天：产能回满 */
await ev(`(() => { S.day += 1; render(); return 1 })()`); await sleep(250)
const dayNext = await click('anti', 1)
await sleep(250)
const a9 = await info()
ok('⑧ 过一天产能回满（跨天清零、chemDay 跟进），又能合成', dayNext === 'ok' && a9.usedAnti === 1 && a9.chemDay === a9.day,
  JSON.stringify({ used: a9.usedAnti, chemDay: a9.chemDay, day: a9.day }))

/* ⑨ 存档往返：产能额度不会被 sanitize 洗掉 */
await ev(`(() => { synthChem('anti', 99); return 1 })()`); await sleep(250)
const beforeSave = await info()
await ev(`(() => { saveGame(true); return 1 })()`); await sleep(700)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(1000)
const afterLoad = await info()
ok('⑨ 存档往返后产能额度还在（白名单 chemDay/chemUsed 真的生效）',
  afterLoad.usedAnti === beforeSave.usedAnti && afterLoad.usedAnti > 0 && afterLoad.chemDay === afterLoad.day,
  JSON.stringify({ before: beforeSave.usedAnti, after: afterLoad.usedAnti, chemDay: afterLoad.chemDay, day: afterLoad.day }))

/* ⑩ 配方表出口：每行吃化学品、产出是成品 */
const table = await j(`(() => JSON.stringify((window.CHEM_ROWS || []).map(r => ({ id: r.id, st: r.st, out: r.out, n: r.n, cap: r.cap, lv: r.lv, chem: r.need.chem || 0, t: (window.ITEMS[r.out] || {}).t }))) )()`)
ok('⑩ window.CHEM_ROWS 出了 4 行，每行都吃化学品、产出是成品（med/thr/ammo）',
  table.length === 4 && table.every(r => r.chem > 0 && ['med', 'thr', 'ammo'].indexOf(r.t) >= 0 && r.cap > 0),
  JSON.stringify(table.map(r => r.id + ':' + r.t)))

ok('⑪ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M72 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
