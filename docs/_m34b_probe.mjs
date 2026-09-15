// M34b 取证（用户报障回归）：① 地图悬浮窗/折叠条不许压住顶栏那排按钮（"地图的按钮挡住了设置"）
//   ② 点一次「嵌入页内」就要当场切过去（"要再点一下按钮"）：菜单自动关掉、页签自动回探索页
// 走真浏览器 + 真点击（CDP Input 落在按钮上，不走 eval 直调）。
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 180))
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
const J = (s) => { try { return JSON.parse(s) } catch { return { raw: String(s).slice(0, 200) } } }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
/* 真鼠标点击（CDP Input）：比 element.click() 更接近玩家操作，能测出"被人盖住点不到" */
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(5000)
await ev(`(() => { try { localStorage.removeItem('zsv-ui-v1') } catch {} ; if (typeof setTab === 'function') setTab('explore'); if (typeof render === 'function') render(); return 1 })()`)
await sleep(1600)
for (let i = 0; i < 20; i++) { if (Number(await ev(`document.querySelectorAll('#v4world .wcell').length`)) >= 576) break; await sleep(400) }

/* ── ① 悬浮窗不许压住顶栏（BETA 条把顶栏推下去之后也一样） ── */
const cover = J(await ev(`(async () => {
  window.V4Scale.setMapStyle('float'); window.V4Scale.toggleMap(true)
  await new Promise(r => setTimeout(r, 900))
  const win = document.getElementById('v4mapwin'), bar = document.getElementById('v4mapbar')
  const tb = document.getElementById('topbar'), beta = document.getElementById('beta-notice')
  const wb = win.getBoundingClientRect(), tbb = tb.getBoundingClientRect()
  const at = (el) => { if (!el) return 'none'; const b = el.getBoundingClientRect()
    const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    return e ? ((e.id || e.className || e.tagName) + '').slice(0, 30) : 'null' }
  const btnMenu = document.getElementById('btn-menu'), btnMap = document.getElementById('btn-v4map')
  const btnSfx = document.getElementById('btn-sfx'), btnHelp = document.getElementById('btn-help')
  return JSON.stringify({
    beta: beta ? Math.round(beta.getBoundingClientRect().height) : 0,
    maptop: getComputedStyle(document.documentElement).getPropertyValue('--v4-maptop').trim(),
    winTop: Math.round(wb.top), winLeft: Math.round(wb.left), winRight: Math.round(wb.right),
    topbarBottom: Math.round(tbb.bottom), topbarRight: Math.round(tbb.right),
    overlapY: Math.round(tbb.bottom - wb.top),
    atMenu: at(btnMenu), atMapBtn: at(btnMap), atSfx: at(btnSfx), atHelp: at(btnHelp),
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
  })
})()`))
ok('悬浮窗上沿落到顶栏下方（不再压住那排按钮）', cover.overlapY <= 0 && cover.winTop >= cover.topbarBottom - 1, JSON.stringify({ 窗顶: cover.winTop, 顶栏底: cover.topbarBottom, BETA条: cover.beta, maptop: cover.maptop }))
ok('☰ 菜单按钮点得到（命中它自己，不是窗头）', /btn-menu|icobtn/.test(cover.atMenu) && !/mwhead|v4mapwin/.test(cover.atMenu), JSON.stringify({ atMenu: cover.atMenu }))
ok('顶栏另外三个按钮也点得到（🗺️/🔊/?）', [cover.atMapBtn, cover.atSfx, cover.atHelp].every(s => !/mwhead|v4mapwin/.test(s)), JSON.stringify({ map: cover.atMapBtn, sfx: cover.atSfx, help: cover.atHelp }))
await shot('m34b_0_float_top')

/* ── ② 折叠条（地图关掉时）也不能压住顶栏 ── */
const barChk = J(await ev(`(async () => {
  window.V4Scale.toggleMap(false)
  await new Promise(r => setTimeout(r, 500))
  const bar = document.getElementById('v4mapbar'), tb = document.getElementById('topbar')
  const bb = bar.getBoundingClientRect(), tbb = tb.getBoundingClientRect()
  const e = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2)
  const hitBar = e ? (e.id === 'v4mapbar' || !!e.closest('#v4mapbar')) : false
  const menu = document.getElementById('btn-menu').getBoundingClientRect()
  const e2 = document.elementFromPoint(menu.x + menu.width / 2, menu.y + menu.height / 2)
  window.V4Scale.toggleMap(true)
  await new Promise(r => setTimeout(r, 400))
  return JSON.stringify({ barTop: Math.round(bb.top), topbarBottom: Math.round(tbb.bottom),
    barHit: hitBar, menuHit: e2 ? ((e2.id || e2.className) + '').slice(0, 30) : 'null' })
})()`))
ok('折叠小条也在顶栏下方、自己点得到，且不挡 ☰', barChk.barTop >= barChk.topbarBottom - 1 && barChk.barHit === true && !/mwhead/.test(barChk.menuHit), JSON.stringify(barChk))

/* ── ③ 真点一次「嵌入页内」：菜单要自动关、地图要当场搬进探索页 ── */
const before = J(await ev(`(() => { document.getElementById('btn-menu').click(); return JSON.stringify({ menuOpen: !!document.querySelector('#overlay-root .overlay') }) })()`))
await sleep(700)
const btnPos = J(await ev(`(() => {
  const b = [...document.querySelectorAll('#overlay-root button')].find(x => (x.textContent || '').includes('嵌入页内'))
  if (!b) return JSON.stringify({ err: 'no button' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width), h: Math.round(r.height),
    hit: (() => { const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? ((e.tagName + '.' + (e.className || '')).slice(0, 30)) : 'null' })() })
})()`))
await clickAt(btnPos.x, btnPos.y)
await sleep(900)
const afterClick = J(await ev(`(() => {
  const map = document.getElementById('v4world'), win = document.getElementById('v4mapwin'), view = document.getElementById('view')
  return JSON.stringify({
    style: window.V4Scale.mapStyle(), attr: document.documentElement.dataset.mapstyle,
    menuOpen: !!document.querySelector('#overlay-root .overlay'), tab: window.S ? window.S.tab : null,
    mapInView: !!(map && map.closest('#view')), mapFirst: !!(view && view.firstElementChild === map),
    winDisp: win ? getComputedStyle(win).display : null, cells: document.querySelectorAll('#v4world .wcell').length,
    boardInView: !!document.getElementById('v4cards')?.closest('#view'),
  })
})()`))
ok('点一次就切过去了（单击生效，不用点第二下）', afterClick.style === 'inline' && afterClick.attr === 'inline' && afterClick.mapInView === true, JSON.stringify({ before: before.menuOpen, 按钮命中: btnPos.hit, after: afterClick.style }))
ok('切完菜单自动关掉（玩家当场看见结果）', afterClick.menuOpen === false, JSON.stringify({ menuOpen: afterClick.menuOpen }))
ok('嵌入后地图在探索页顶部、卡片墙还在', afterClick.mapFirst === true && afterClick.boardInView === true && afterClick.cells >= 576, JSON.stringify({ first: afterClick.mapFirst, board: afterClick.boardInView, cells: afterClick.cells }))
await shot('m34b_1_inline_after_one_click')

/* ── ④ 在别的页签切「嵌入页内」：要自动回探索页，否则等于什么都没发生 ── */
const fromTab = J(await ev(`(async () => {
  window.V4Scale.setMapStyle('float')
  await new Promise(r => setTimeout(r, 600))
  if (typeof setTab === 'function') setTab('inv')
  await new Promise(r => setTimeout(r, 600))
  const beforeTab = window.S ? window.S.tab : null
  window.V4Scale.setMapStyle('inline')
  await new Promise(r => setTimeout(r, 900))
  const map = document.getElementById('v4world'), view = document.getElementById('view')
  return JSON.stringify({ beforeTab, afterTab: window.S ? window.S.tab : null,
    mapInView: !!(map && map.closest('#view')), mapFirst: !!(view && view.firstElementChild === map),
    mapDisp: map ? getComputedStyle(map).display : null })
})()`))
ok('从背包页切「嵌入页内」会自动回到探索页并显示地图', fromTab.beforeTab === 'inv' && fromTab.afterTab === 'explore' && fromTab.mapInView && fromTab.mapDisp !== 'none', JSON.stringify(fromTab))

/* ── ⑤ 切回悬浮窗：按钮同样单击生效 ── */
const back = J(await ev(`(async () => {
  document.getElementById('btn-menu').click()
  await new Promise(r => setTimeout(r, 600))
  const b = [...document.querySelectorAll('#overlay-root button')].find(x => (x.textContent || '').includes('悬浮窗'))
  if (!b) return JSON.stringify({ err: 'no float button' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
})()`))
await clickAt(back.x, back.y)
await sleep(900)
const afterBack = J(await ev(`(() => {
  const map = document.getElementById('v4world'), win = document.getElementById('v4mapwin')
  return JSON.stringify({ style: window.V4Scale.mapStyle(), menuOpen: !!document.querySelector('#overlay-root .overlay'),
    mapInWin: !!(map && map.closest('#v4mapwin')), mapInView: !!(map && map.closest('#view')),
    winTop: Math.round(win.getBoundingClientRect().top), topbarBottom: Math.round(document.getElementById('topbar').getBoundingClientRect().bottom) })
})()`))
ok('切回悬浮窗也是单击生效（菜单关、地图回窗里）', afterBack.style === 'float' && afterBack.menuOpen === false && afterBack.mapInWin === true && !afterBack.mapInView, JSON.stringify(afterBack))
ok('回悬浮窗后它仍不压住顶栏', afterBack.winTop >= afterBack.topbarBottom - 1, JSON.stringify({ 窗顶: afterBack.winTop, 顶栏底: afterBack.topbarBottom }))
ok('控制台无异常', errs.length === 0, errs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
