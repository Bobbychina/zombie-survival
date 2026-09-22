// M70 取证：藏身处经济（回收台 + 升级曲线）
//   ① 据点页有「♻️ 回收台」，7 种建材各一行
//   ② 没建工作台：一行都换不了，且写明原因
//   ③ 有工作台：换 1 → 材料 -6、铁片 +1、当天额度 1/8；「换满」一次顶到上限
//   ④ 额度用完：按钮禁用 + 说明；换一天（S.day++）额度回满
//   ⑤ 存档往返：额度不会被 sanitize 洗掉（洗掉 = 读档就无限兑换）
//   ⑥ 升级曲线：门窗 Lv0 → Lv1 的价签从 木料4/铁片3 变成 木料6/铁片5（×0.35 而不是 ×0.6）
// 用法：node docs/_m70_probe.mjs <cdpPort> <url> <outDir>
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
const btnSel = (rowId, times) => "[...document.querySelectorAll('#view button')].find(b => (b.getAttribute('onclick')||'').indexOf(\"exchangeItem('" + rowId + "'," + times + ")\") >= 0)"
const click = (rowId, times) => ev("(() => { const b = " + btnSel(rowId, times) + "; if (!b) return 'NOBTN'; if (b.disabled) return 'DISABLED'; b.click(); return 'ok' })()")
const info = () => j(`(() => JSON.stringify({
  mat: S.mat, metal: itemCount('metal'), chip: itemCount('chip'), bench: S.base.bench || 0,
  usedMetal: (S.base.exUsed || {}).metal || 0, usedChip: (S.base.exUsed || {}).chip || 0, exDay: S.base.exDay, day: S.day,
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
  S.base = { door:0, bed:0, filter:0, garden:0, bench:0, storage:0, radio:0, wall:0, exDay:0, exUsed:{} };
  S.mat = 200; render(); return 1 })()`)

/* ① 回收台在据点页里 */
await openBase()
const t0 = String(await pageText())
ok('① 据点页有「♻️ 回收台」区块', t0.indexOf('回收台') >= 0 && t0.indexOf('材料 → 建材') >= 0)
const rowCount = Number(await ev(`(() => document.querySelectorAll('#view button[onclick^="exchangeItem"]').length)`))
ok('① 7 种建材各有一行（木料/铁片/布/胶带/化学品/汽油/芯片）', rowCount === 14 || rowCount === 7,
  '按钮数=' + rowCount + '（每行 1~2 颗：换 1 / 换满）')
if (outDir) await shot('m70-base')

/* ② 没工作台：换不了 */
const noBench = await click('metal', 1)
const t1 = String(await pageText())
ok('② 没建工作台时一行都换不了，并写明原因', noBench === 'DISABLED' && (await info()).mat === 200 && t1.indexOf('先建') >= 0,
  '按钮=' + noBench)

/* ③ 工作台 Lv1：换 1 与换满 */
await ev(`(() => { S.base.bench = 1; render(); return 1 })()`); await sleep(250)
const before = await info()
const one = await click('metal', 1)
await sleep(250)
const afterOne = await info()
ok('③ 换 1：材料 -6、铁片 +1、当天额度记到 1/8',
  one === 'ok' && afterOne.mat === before.mat - 6 && afterOne.metal === before.metal + 1 && afterOne.usedMetal === 1,
  JSON.stringify({ mat: afterOne.mat, metal: afterOne.metal, used: afterOne.usedMetal }))
const bulk = await click('metal', 99)          // 界面上是「换满 (n)」；这里直接传一个足够大的数，验证服务端夹取
await sleep(250)
const afterBulk = await info()
ok('③ 点「换满」会把额度一次顶到上限（8/8），不会超支', afterBulk.usedMetal === 8 && afterBulk.metal === before.mat - 6 * 8,
  JSON.stringify({ used: afterBulk.usedMetal, mat: afterBulk.mat }))
const again = await click('metal', 1)
ok('③ 额度用尽后按钮禁用（再说清楚是今天用完）', again === 'DISABLED' && String(await pageText()).indexOf('额度用完了') >= 0)

/* ④ 换天：额度回满 */
await ev(`(() => { S.day += 1; render(); return 1 })()`); await sleep(250)
const nextDay = await click('metal', 1)
await sleep(250)
const afterNext = await info()
ok('④ 过一天额度回满（跨天清零）', nextDay === 'ok' && afterNext.usedMetal === 1 && afterNext.exDay === afterNext.day,
  JSON.stringify({ used: afterNext.usedMetal, exDay: afterNext.exDay, day: afterNext.day }))

/* ⑤ 存档往返：额度不会被 sanitize 洗掉（洗掉 = 读档就能无限换） */
await ev(`(() => { exchangeItem('metal', 99); return 1 })()`); await sleep(200)
const beforeSave = await info()
await ev(`(() => { saveGame(true); return 1 })()`); await sleep(600)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
const afterLoad = await info()
ok('⑤ 存档往返后额度还在（白名单 exDay/exUsed 真的生效）',
  afterLoad.usedMetal === beforeSave.usedMetal && afterLoad.usedMetal > 0 && afterLoad.exDay === afterLoad.day,
  JSON.stringify({ before: beforeSave.usedMetal, after: afterLoad.usedMetal }))

/* ⑥ 升级曲线：门窗 Lv0 → Lv1 的价签 */
const costText = async () => {
  await ev(`(() => { setTab('base'); render(); return 1 })()`); await sleep(250)
  return String(await ev(`(() => { const card = [...document.querySelectorAll('#view .card')].find(c => /加固门窗/.test(c.textContent)); return card ? card.textContent.replace(/\\s+/g, ' ') : '' })()`))
}
await ev(`(() => { S.base.door = 0; render(); return 1 })()`)
const d0 = await costText()
await ev(`(() => { S.base.door = 1; render(); return 1 })()`)
const d1 = await costText()
const has = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0
ok('⑥ 曲线放缓：门窗 Lv0 要 木料 4/铁片 3，Lv1 要 木料 6/铁片 5（×0.35 曲线；老曲线会是 7/5）',
  has(d0, '木料 4', '铁片 3') && has(d1, '木料 6', '铁片 5'), (d1.match(/木料 \\d+ · 铁片 \\d+/) || [d1.slice(0, 80)])[0])

ok('⑦ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M70 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
