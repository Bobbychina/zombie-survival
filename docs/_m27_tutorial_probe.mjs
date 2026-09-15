// M27 取证：新手教程 —— ① 首次进游戏自动弹 ② 每步都有高亮圈 + 气泡且不遮挡点击
//   ③ 上一步/下一步/跳过/续看 ④ 菜单里有入口 ⑤ 无控制台报错
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
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
const send = (method, params = {}, ms = 20000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })

/* ① 首次进游戏：不带 dev 参数（教程只在真实开局自动弹）。
   注意：这个 profile 之前跑过别的探针，localStorage 里可能已经有教程标记 —— 先清干净再重载，
   不然测的是"上次看到第几步"而不是"朋友第一次打开"。 */
await send('Page.navigate', { url })
await sleep(2000)
await ev(`localStorage.removeItem('dsh.tutorial.done'); localStorage.removeItem('dsh.tutorial.step'); 1`)
await send('Page.navigate', { url })
await sleep(4200)
const auto = JSON.parse(await ev(`(() => {
  const r = document.getElementById('v4tut')
  const step = (() => { try { return JSON.parse(localStorage.getItem('dsh.tutorial.step') ?? 'null') } catch { return null } })()
  return JSON.stringify({ open: !!r, bubbles: r ? r.querySelectorAll('.v4tut-bub').length : 0, spots: r ? r.querySelectorAll('.v4tut-spot').length : 0, step })
})()`))
ok('第一次进游戏自动弹出教程', auto.open === true && auto.bubbles === 1, JSON.stringify(auto))
/* 第 1 步（欢迎语）没有目标元素：只给气泡，不该画一个 0×0 的圈 */
ok('第 1 步（欢迎语）只显示气泡、不画圈', auto.spots === 0, 'spots=' + auto.spots)
await shot('40_tut_step1')
// 点「下一步」：应出现"圈 + 气泡"
await ev(`V4Tutorial.next()`); await sleep(700)
const s2 = JSON.parse(await ev(`(() => {
  const r = document.getElementById('v4tut')
  const sp = r.querySelector('.v4tut-spot'); const bub = r.querySelector('.v4tut-bub')
  const hud = document.querySelector('#hud .hud-bars')
  const hr = hud ? hud.getBoundingClientRect() : null
  const sr = sp ? sp.getBoundingClientRect() : null
  return JSON.stringify({ spots: r.querySelectorAll('.v4tut-spot').length, bub: !!bub,
    spotCovers: sr && hr ? (sr.top <= hr.top + 2 && sr.bottom >= hr.bottom - 2 && sr.left <= hr.left + 2) : false,
    pointerEventsOnOverlay: getComputedStyle(r).pointerEvents, pointerEventsOnBub: bub ? getComputedStyle(bub).pointerEvents : '-',
    step: V4Tutorial.step() })
})()`))
ok('第 2 步：圈住了 HUD 生存条', s2.spots === 1 && s2.spotCovers === true, JSON.stringify(s2))
ok('overlay 不吃点击（点击穿透），只有气泡可点', s2.pointerEventsOnOverlay === 'none' && s2.pointerEventsOnBub === 'auto')
await shot('41_tut_step2_hud')

/* ② 逐步走完 15 步：每一步都要有气泡（有目标元素的步骤还要有圈）。
   注意：上面的第 2 步断言已经把教程推到第 2 步（索引 1）了，所以这里的 `walked` 少第 0 步 —— 
   断言口径按"覆盖至少 14 个不同的步骤索引"来算，跳过的那一步单独列出来。 */
const walked = []
let missing = []
for (let i = 0; i < 20; i++) {
  const open = await ev(`V4Tutorial.isOpen()`)
  if (open !== true) break
  const info = JSON.parse(await ev(`(() => {
    const r = document.getElementById('v4tut')
    const bub = r ? r.querySelector('.v4tut-bub') : null
    const sp = r ? r.querySelector('.v4tut-spot') : null
    const hd = bub ? bub.querySelector('.v4tut-hd b') : null
    return JSON.stringify({ st: V4Tutorial.step(), hasBub: !!bub, hasSpot: !!sp, title: hd ? hd.textContent.slice(0, 10) : '' })
  })()`))
  if (!info.hasBub) missing.push('第 ' + (info.st + 1) + ' 步没有气泡')
  walked.push(info.st)
  await ev(`V4Tutorial.next()`)
  await sleep(420)
}
/* 15 步里有一步是"战斗中"（#v4b-overlay 只存在于战斗弹窗里）—— 没有战斗时会**静默跳过**那一步；
   另外本轮循环从索引 1 开始（第 1 步已在上面验过），所以统计口径是 1..14。 */
const skipped = []
for (let i = 1; i < 15; i++) if (!walked.includes(i)) skipped.push(i + 1)
ok('15 步都能走（每步都有气泡）', walked.length >= 13 && missing.length === 0, '走过 ' + walked.length + ' 步，跳过 ' + JSON.stringify(skipped) + ' ' + JSON.stringify(missing))
ok('没有战斗时只有"战斗那一步"被跳过（不是卡住/不是提前关掉）', skipped.length <= 1 && (skipped.length === 0 || skipped[0] === 12), JSON.stringify(skipped))
await shot('42_tut_last')
const done = JSON.parse(await ev(`JSON.stringify({ open: !!document.getElementById('v4tut'), done: localStorage.getItem('dsh.tutorial.done') })`))
ok('走完最后一步自动结束且记下"已看完"', done.open === false && done.done === '1', JSON.stringify(done))

/* ③ 重开后再进游戏：不应该再自动弹 */
await send('Page.navigate', { url })
await sleep(4500)
ok('看完之后不再自动弹', (await ev(`!document.getElementById('v4tut')`)) === true)

/* ④ 菜单入口 + 续看 */
const menu = await ev(`(() => { openMenu(); const ov=[...document.querySelectorAll('.modal')].find(m=>/☰ 菜单/.test(m.innerText||'')); const b=ov?[...ov.querySelectorAll('button')].find(x=>/新手指南/.test(x.textContent||'')):null; return b ? 'FOUND' : 'MISSING' })()`)
ok('☰ 菜单里有「🎓 新手指南」入口', menu === 'FOUND', String(menu))
await ev(`(() => { const ov=[...document.querySelectorAll('.modal')].find(m=>/☰ 菜单/.test(m.innerText||'')); const b=ov?[...ov.querySelectorAll('button')].find(x=>/新手指南/.test(x.textContent||'')):null; if(b) b.click(); return 1 })()`)
await sleep(800)
const restarted = JSON.parse(await ev(`JSON.stringify({ open: !!document.getElementById('v4tut'), step: V4Tutorial.step(), total: V4Tutorial.total() })`))
ok('从菜单点进去能重新看（从头开始）', restarted.open === true && restarted.step === 0, JSON.stringify(restarted))

/* ⑤ 中途关掉 → 下次从这一步继续 */
await ev(`V4Tutorial.next()`); await sleep(500)
await ev(`V4Tutorial.next()`); await sleep(500)
const at = await ev(`V4Tutorial.step()`)
await ev(`V4Tutorial.close()`); await sleep(400)
const seen = await ev(`localStorage.getItem('dsh.tutorial.step')`)
await ev(`V4Tutorial.start()`); await sleep(700)
const resumed = await ev(`V4Tutorial.step()`)
ok('中途关掉会记住进度，下次从这一步继续', String(seen) === String(at) && resumed === at, '关在第 ' + at + ' 步，续看从第 ' + resumed + ' 步')
await ev(`V4Tutorial.close()`)
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
