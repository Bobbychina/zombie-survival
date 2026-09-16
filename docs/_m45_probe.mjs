// M45 取证：探索页不再出现「重复的卡片」（用户报障：「有重复的」—— 截图里日历区块整整出现了两遍）
//   ① 日历区块（标题 + 血月/电网/尸群/目标四条 chip + 那段说明）在探索页只出现 1 次
//   ② 通用哨兵：卡片墙里没有任何两张卡的正文一模一样（当日历被认领两遍时这条会红）
//   ③ 孤儿副本（标题是 `📋 <正文前 12 字>` 的 legacy 卡）数量 = 0 —— 那是被认领过又二次包装的痕迹
//   ④ 委托板 teaser / 地图卡 也各只有 1 份
//   ⑤ 0 未捕获异常
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
await send('Emulation.setDeviceMetricsOverride', { width: 560, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await sleep(800)

/* 准备：探索页 + 干净的一天（日历那段说明一定会渲染出来） */
await ev(`(() => {
  closeAllModals(); S.over = false; S.day = 5; S.hp = Math.max(60, S.hp);
  window.V4Scale.setMapStyle('float'); setTab('explore'); render();
  return 1;
})()`)
await sleep(1500)

/* 诊断 dump：卡片墙里每张卡的标题 + 正文前 40 字（重复时一眼能看出是哪两张） */
const dump = await ev(`(() => {
  const cards = [...document.querySelectorAll('#view .v4card')].map(c => {
    const t = (c.querySelector('.card-tt')?.textContent || '').trim();
    const b = (c.querySelector('.card-bd')?.textContent || '').replace(/\\s+/g, ' ').trim();
    return { t, b: b.slice(0, 40), legacy: c.dataset.card === 'legacy', n: b.length };
  });
  const cal = [...document.querySelectorAll('#view .card')].filter(c => /每 7 天一次/.test(c.textContent || '')).length;
  return JSON.stringify({ cards, cal, viewKids: [...document.getElementById('view').children].map(e => e.id || e.className) });
})()`)
console.log('DOM：' + dump)
const dom = JSON.parse(dump)

/* ① 日历区块只出现一次 */
ok('日历区块在探索页只出现 1 次（用户报的重复）', dom.cal === 1, 'count=' + dom.cal)
/* ② 通用哨兵：没有两张卡正文完全相同 */
const seen = new Map(); const dups = []
for (const c of dom.cards) {
  if (c.n < 20) continue
  if (seen.has(c.b)) dups.push([seen.get(c.b), c.t]); else seen.set(c.b, c.t)
}
ok('卡片墙里没有正文重复的两张卡', dups.length === 0, dups.length ? JSON.stringify(dups) : '')
/* ③ 没有「孤儿副本」：标题是被截断正文的那种 legacy 卡 */
const orphan = dom.cards.filter(c => c.legacy && /^📋 /.test(c.t))
ok('没有二次包装出来的「孤儿副本」卡', orphan.length === 0, orphan.length ? JSON.stringify(orphan.map(o => o.t)) : '')
/* ④ 委托板 teaser / 地图卡各只有一份 */
const teaser = await ev(`(() => [...document.querySelectorAll('#view .v4card')].filter(c => /📜 委托板/.test(c.querySelector('.card-tt')?.textContent || '')).length)()`)
ok('委托板卡片只有 1 张', teaser === 1, 'count=' + teaser)
const maps = await ev(`(() => document.querySelectorAll('#view #v4world, #v4mapwin #v4world').length)()`)
ok('地图卡全局只有 1 张', maps === 1, 'count=' + maps)
await shot('01_explore_cards')

/* ⑤ 换日 + 重渲染两次（legacy render 会整块重写 #view）：不能又长出副本 */
await ev(`(() => { S.day = 6; render(); return 1 })()`); await sleep(700)
await ev(`(() => { S.day = 7; render(); mountWorldPanel(); return 1 })()`); await sleep(900)
const cal2 = await ev(`(() => [...document.querySelectorAll('#view .card')].filter(c => /每 7 天一次/.test(c.textContent || '')).length)()`)
ok('再渲染两轮后日历仍然只有 1 份（不会越滚越多）', cal2 === 1, 'count=' + cal2)
await shot('02_after_rerender')

ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM45 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
