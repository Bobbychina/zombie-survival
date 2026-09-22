// M71 取证：商人好感度与解锁（塔科夫式：好感 → 忠诚档位 → 货架门槛；做委托解锁特定道具）
//   ① 商人弹窗顶部有好感面板：两行（神秘商人 / 军需官）+ 档位名 + 进度
//   ② 好感 0 时：穿甲弹 a9_ap 是「未解锁」+ 写清差什么；普通弹 a9_fmj 能买
//   ③ 好感 120（熟人）：a9_ap 解锁；军需官的货仍要无线电
//   ④ 买东西涨好感 + 忠诚折扣作用在价签上；⑤ 卖东西也涨好感
//   ⑥ 完成一张委托 +25（走 quests 的真实结算路径）
//   ⑦ 存档往返：好感度进白名单（否则读档就掉回 0）
// 注：文件名带 trader —— `_m71_probe.mjs` 是老的 M7.1 探针，别覆盖。
// 用法：node docs/_m71_trader_probe.mjs <cdpPort> <url> <outDir>
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
const modalText = () => ev("(() => { const m = document.querySelector('#overlay-root .modal'); return m ? m.textContent.replace(/\\s+/g, ' ') : 'NOMODAL' })()")
const openShop = async () => { await ev(`(() => { closeAllModals(); merchantTab = 'buy'; openMerchant(); return 1 })()`); await sleep(350) }
/** 某件货那一行的 DOM 状态（按钮是否禁用 / 按钮文案 / 整行文本） */
const rowState = (goodsId) => j(`(() => {
  const idx = MERCHANT.findIndex(m => m.id === '${goodsId}');
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const row = rows[idx];
  const b = row ? row.querySelector('button') : null;
  return JSON.stringify({ found: !!row, disabled: b ? !!b.disabled : null, label: b ? b.textContent.trim() : '', text: row ? row.textContent.replace(/\\s+/g, ' ') : '' });
})()`)
/** 那一行的价签（材料数） */
const rowPrice = (goodsId) => ev(`(() => {
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const row = rows[MERCHANT.findIndex(m => m.id === '${goodsId}')];
  const t = row ? row.querySelector('.tag') : null;
  return t ? Number(String(t.textContent).replace(/[^0-9]/g, '')) : 0 })()`)
const rep = () => ev(`(() => Number(repOf('peddler')))()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); setTab('explore'); S.over = false; S.ap = 30;
  S.mat = 400; S.rep = { peddler: 0, quarter: 0 }; S.base.radio = 0; S.stats.bounties = 0; S.inv = { cloth: 30, metal: 10 }; render(); return 1 })()`)

/* ① 好感面板 */
await openShop()
const head = String(await modalText())
ok('① 商人弹窗顶部有好感面板（两个商人各一行 + 档位 + 进度）',
  head.indexOf('神秘商人') >= 0 && head.indexOf('军需官') >= 0 && head.indexOf('陌生人') >= 0 && head.indexOf('还没架无线电') >= 0,
  (head.match(/🏪[^|]{0,60}/) || [''])[0])
if (outDir) await shot('m71-shop')

/* ② 好感 0：普通弹能买、穿甲弹锁着且写清差什么 */
const fmj0 = await rowState('a9_fmj')
const ap0 = await rowState('a9_ap')
ok('② 好感 0：普通弹可买，穿甲弹「未解锁」+ 写清差什么',
  fmj0.found && fmj0.disabled === false && ap0.found && ap0.disabled === true && ap0.label.indexOf('未解锁') >= 0 && ap0.text.indexOf('好感不够') >= 0,
  'a9_ap=' + ap0.label + ' / ' + (ap0.text.match(/好感不够[^🔒]{0,40}/) || [''])[0])

/* ③ 好感 120（熟人）：穿甲弹解锁；军需官仍要无线电 */
await ev(`(() => { S.rep.peddler = 120; refreshMerchant(); return 1 })()`)
await sleep(400)
const ap120 = await rowState('a9_ap')
const quarter = await rowState('a308_ap')
const head120 = String(await modalText())
ok('③ 好感 120 → 「熟人」档，穿甲弹解锁可买', ap120.disabled === false && ap120.label.indexOf('购买') >= 0 && head120.indexOf('熟人') >= 0, ap120.label)
ok('③ 军需官的货仍锁着（要先架无线电）', quarter.disabled === true && quarter.text.indexOf('无线电') >= 0, (quarter.text.match(/🔒[^🔒]{0,44}/) || [''])[0])

/* ④ 买东西涨好感 + 折扣作用在价签上 */
const beforeBuy = Number(await rep())
await ev(`(() => { buyMerchant(MERCHANT.findIndex(m => m.id === 'a9_ap'), 1); return 1 })()`)
await sleep(450)
const afterBuy = Number(await rep())
ok('④ 买东西涨好感（+1~2）', afterBuy > beforeBuy, beforeBuy + ' → ' + afterBuy)
await ev(`(() => { S.rep.peddler = 0; refreshMerchant(); return 1 })()`); await sleep(350)
const priceLL1 = Number(await rowPrice('a9_fmj'))
await ev(`(() => { S.rep.peddler = 700; refreshMerchant(); return 1 })()`); await sleep(350)
const priceLL4 = Number(await rowPrice('a9_fmj'))
ok('④ 忠诚折扣真的作用在价签上（LL4 比 LL1 便宜）', priceLL1 > 0 && priceLL4 > 0 && priceLL4 < priceLL1, priceLL1 + ' → ' + priceLL4)

/* ⑤ 卖东西也涨好感 */
await ev(`(() => { S.rep.peddler = 0; refreshMerchant(); return 1 })()`); await sleep(350)
const beforeSell = Number(await rep())
await ev(`(() => { sellMerchant('metal', 2); return 1 })()`)
await sleep(450)
const afterSell = Number(await rep())
ok('⑤ 卖东西也涨好感（+1~3）', afterSell > beforeSell, beforeSell + ' → ' + afterSell)

/* ⑥ 完成委托 +25：走 quests 的真实结算（造一张 need=0 的激活委托，然后 bountyTick） */
const bountyRes = await j(`(() => {
  S.rep.peddler = 0;
  const before = S.stats.bounties || 0;
  try {
    S.ct = { day: 1, offers: [], active: [{ id: 'probe-' + Date.now(), title: '探针委托', metric: 'kill', need: 0, days: 3, until: S.day + 3, day: S.day, reward: { mat: 0, items: {} }, snap: {} }], done: [], seq: 1 };
    bountyTick();
    return JSON.stringify({ rep: Number(repOf('peddler')), before, after: S.stats.bounties || 0, logs: (S.logBuf || []).slice(-3).map(p => String(p[1])) });
  } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }); }
})()`)
ok('⑥ 完成委托让好感 +25（真实结算：完成 → stats.bounties +1 → rep +25）',
  bountyRes.rep === 25 && bountyRes.after > bountyRes.before, JSON.stringify(bountyRes).slice(0, 220))

/* ⑦ 存档往返：好感进白名单 */
await ev(`(() => { S.rep.peddler = 260; saveGame(true); return 1 })()`); await sleep(700)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
const kept = Number(await ev(`(() => Number(repOf('peddler')))()`))
ok('⑦ 存档往返后好感还在（sanitize 白名单生效）', kept === 260, 'rep=' + kept)

ok('⑧ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M71 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
