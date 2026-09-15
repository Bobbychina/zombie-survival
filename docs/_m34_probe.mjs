// M34 取证：地图摆法（悬浮窗 / 嵌入页内）是可配置项
//   ① 默认还是悬浮窗（老玩家零感知）② ☰ → 显示 里真的有"地图位置"两个按钮
//   ③ 切 inline：地图卡搬进 #view 顶部、悬浮窗整体隐藏、卡片墙照旧 ④ inline 下的折叠/展开
//   ⑤ inline + 160% 字号不横向溢出、格子仍是正方形、命中区够大 ⑥ 换页签时地图不跟着跑
//   ⑦ 偏好持久化（刷新后仍是 inline）⑧ 切回 float 一切复原 ⑨ 没有把 MutationObserver 拖成死循环
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
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(4200)
/* 读档会恢复"上次停在哪一页"，先显式回探索页（否则量到的是别页的 DOM） */
await ev(`(() => { if (typeof setTab === 'function') setTab('explore'); if (typeof render === 'function') render(); return 1 })()`); await sleep(900)
await ev(`(() => { try { localStorage.removeItem('zsv-ui-v1') } catch {} ; window.V4Scale.setMapStyle('float'); window.V4Scale.set(100); return 1 })()`); await sleep(900)
for (let i = 0; i < 30; i++) {
  if (Number(await ev(`document.querySelectorAll('#v4world .wcell').length`)) >= 576) break
  await sleep(400)
}

/* ── ① 默认（float）：地图还在右上角悬浮窗里，老玩家零感知 ── */
const base = JSON.parse(await ev(`(() => {
  const win = document.getElementById('v4mapwin'), map = document.getElementById('v4world'), view = document.getElementById('view')
  return JSON.stringify({
    style: window.V4Scale.mapStyle(), attr: document.documentElement.dataset.mapstyle,
    inWin: !!(map && win && map.closest('#v4mapwin')), inView: !!(map && map.closest('#view')),
    winShown: !!win && getComputedStyle(win).display !== 'none',
    cells: document.querySelectorAll('#v4world .wcell').length,
    first: view.firstElementChild ? view.firstElementChild.id : '',
  })
})()`))
ok('默认摆法 = 悬浮窗（data-mapstyle=float）', base.style === 'float' && base.attr === 'float', JSON.stringify({ style: base.style, attr: base.attr }))
ok('地图卡在悬浮窗里、悬浮窗是显示状态', base.inWin && !base.inView && base.winShown, JSON.stringify(base))
ok('地图真的画出来了（24×24 = 576 格）', base.cells >= 576, 'cells=' + base.cells)
await shot('m34_a0_float_100')

/* ── ② ☰ → 显示 里的按钮真的存在（玩家找得到入口） ── */
const menu = JSON.parse(await ev(`(() => {
  const html = window.V4Scale.buttons()
  return JSON.stringify({
    hasRow: html.includes('地图位置'),
    hasFloat: html.includes("V4Scale.setMapStyle('float')") && html.includes('悬浮窗'),
    hasInline: html.includes("V4Scale.setMapStyle('inline')") && html.includes('嵌入页内'),
    note: (html.match(/地图(是|嵌)[^<]*/) || [''])[0].slice(0, 40),
  })
})()`))
ok('菜单里有「地图位置」两个按钮（悬浮窗 / 嵌入页内）', menu.hasRow && menu.hasFloat && menu.hasInline, JSON.stringify(menu))
ok('说明文案跟着当前摆法走', /悬浮窗/.test(menu.note), menu.note)

/* ── ③ 切 inline：地图卡搬进探索页顶部，悬浮窗整体下线 ── */
const inline = JSON.parse(await ev(`(async () => {
  window.V4Scale.setMapStyle('inline')
  await new Promise(r => setTimeout(r, 900))
  const win = document.getElementById('v4mapwin'), map = document.getElementById('v4world'), view = document.getElementById('view')
  const wrap = map && map.querySelector('.wmapwrap'), grid = map && map.querySelector('.wgrid')
  const r = map ? map.getBoundingClientRect() : null
  const cells = [...document.querySelectorAll('#v4world .wcell')].slice(0, 30)
  const ws2 = new Set(cells.map(c => Math.round(c.getBoundingClientRect().width)))
  const hs2 = new Set(cells.map(c => Math.round(c.getBoundingClientRect().height)))
  const board = document.getElementById('v4cards')
  const de = document.documentElement
  return JSON.stringify({
    style: window.V4Scale.mapStyle(), attr: document.documentElement.dataset.mapstyle,
    inView: !!(map && map.closest('#view')), inWin: !!(map && win && map.closest('#v4mapwin')),
    isFirst: !!(view && view.firstElementChild === map),
    winShown: !!win && getComputedStyle(win).display !== 'none',
    barShown: getComputedStyle(document.getElementById('v4mapbar')).display !== 'none',
    boardInView: !!(board && board.closest('#view')), boardCards: board ? board.querySelectorAll('.v4card').length : 0,
    cells: document.querySelectorAll('#v4world .wcell').length,
    cell: ws2.size === 1 && hs2.size === 1 ? (ws2.values().next().value + 'x' + hs2.values().next().value) : 'uneven',
    mapAbove: r && board ? r.top < board.getBoundingClientRect().top : false,
    wrapOverX: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
    gridW: grid ? Math.round(grid.getBoundingClientRect().width) : 0,
    pageScrollX: de.scrollWidth - de.clientWidth, pageScrollY: de.scrollHeight - de.clientHeight,
  })
})()`))
ok('切到嵌入页内（data-mapstyle=inline）', inline.style === 'inline' && inline.attr === 'inline', JSON.stringify({ style: inline.style, attr: inline.attr }))
ok('地图卡搬进 #view 且排在卡片墙前面', inline.inView && !inline.inWin && inline.isFirst && inline.mapAbove, JSON.stringify({ inView: inline.inView, inWin: inline.inWin, isFirst: inline.isFirst, above: inline.mapAbove }))
ok('悬浮窗与折叠小条一起下线（不再挡视线）', inline.winShown === false && inline.barShown === false, JSON.stringify({ winShown: inline.winShown, barShown: inline.barShown }))
ok('嵌入后地图照样画出来 + 卡片墙还在（地图在上、卡片在下）', inline.cells >= 576 && inline.boardInView && inline.boardCards >= 5, JSON.stringify({ cells: inline.cells, board: inline.boardInView, cards: inline.boardCards }))
ok('嵌入模式不横向溢出（地图框不滚、整页也不滚）', inline.wrapOverX <= 1 && inline.pageScrollX <= 1, JSON.stringify({ wrapOverX: inline.wrapOverX, pageScrollX: inline.pageScrollX }))
ok('嵌入模式格子仍是正方形', typeof inline.cell === 'string' && inline.cell !== 'uneven', String(inline.cell) + ' · gridW=' + inline.gridW)
await shot('m34_a1_inline_100')

/* ── ④ inline 下的折叠 / 展开（M 键同一套手感） ── */
const fold = JSON.parse(await ev(`(async () => {
  window.V4Scale.toggleMap(false)
  await new Promise(r => setTimeout(r, 500))
  const map = document.getElementById('v4world')
  const hidden = getComputedStyle(map).display === 'none'
  const bar = getComputedStyle(document.getElementById('v4mapbar')).display !== 'none'
  const board = document.getElementById('v4cards')
  const boardUp = board ? Math.round(board.getBoundingClientRect().top) : -1
  window.V4Scale.toggleMap(true)
  await new Promise(r => setTimeout(r, 700))
  const backVisible = getComputedStyle(map).display !== 'none'
  const cells = document.querySelectorAll('#v4world .wcell').length
  return JSON.stringify({ hidden, bar, boardUp, backVisible, cells, foldClass: document.getElementById('view').classList.contains('mapfold') })
})()`))
ok('嵌入模式折叠 = 地图收起（右上角小条仍在，能点回来）', fold.hidden === true && fold.bar === true && fold.foldClass === false, JSON.stringify(fold))
ok('展开后地图回到探索页顶部（格子还在）', fold.backVisible === true && fold.cells >= 576, JSON.stringify({ back: fold.backVisible, cells: fold.cells }))

/* ── ⑤ inline + 160% 字号：不溢出、格子还是正方形、命中区够大 ── */
const big = JSON.parse(await ev(`(async () => {
  window.V4Scale.set(160)
  await new Promise(r => setTimeout(r, 900))
  const map = document.getElementById('v4world'), wrap = map.querySelector('.wmapwrap')
  const cells = document.querySelectorAll('#v4world .wcell')
  const last = cells[cells.length - 1]
  const first = cells[0]
  const de = document.documentElement
  const over = [...document.querySelectorAll('#view *')].filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2)
  }).length
  const ws2 = new Set([...cells].slice(0, 30).map(c => Math.round(c.getBoundingClientRect().width)))
  return JSON.stringify({
    fs: window.V4Scale.prefs().fs, zoom: map.style.zoom, attr: document.documentElement.dataset.mapstyle,
    wrapOverX: wrap.scrollWidth - wrap.clientWidth, over, pageScrollX: de.scrollWidth - de.clientWidth,
    cell: Math.round(first.getBoundingClientRect().width), square: ws2.size === 1,
    lastRight: Math.round(last.getBoundingClientRect().right), viewRight: Math.round(document.getElementById('view').getBoundingClientRect().right),
    cells: cells.length,
  })
})()`))
ok('160% 字号下嵌入模式没有横向溢出元素', big.over === 0 && big.wrapOverX <= 1 && big.pageScrollX <= 1, JSON.stringify({ over: big.over, wrapOverX: big.wrapOverX, pageScrollX: big.pageScrollX }))
ok('160% 字号下格子仍是正方形、命中区 ≥18px', big.square && big.cell >= 18, JSON.stringify({ cell: big.cell, square: big.square }))
ok('160% 字号下最右一列没被切掉', big.lastRight <= big.viewRight + 2, JSON.stringify({ last: big.lastRight, view: big.viewRight }))
await shot('m34_a2_inline_160')
await ev(`(() => { window.V4Scale.set(100); return 1 })()`); await sleep(700)

/* ── ⑥ 换页签：地图卡不能跟着跑到背包/人体页去 ── */
const tabs = JSON.parse(await ev(`(async () => {
  const out = {}
  if (typeof setTab === 'function') setTab('inv')
  await new Promise(r => setTimeout(r, 700))
  const map = document.getElementById('v4world')
  out.inv = { inView: !!map.closest('#view'), hidden: getComputedStyle(map).display === 'none' }
  if (typeof setTab === 'function') setTab('explore')
  await new Promise(r => setTimeout(r, 900))
  const map2 = document.getElementById('v4world')
  out.explore = { inView: !!map2.closest('#view'), first: document.getElementById('view').firstElementChild === map2 }
  return JSON.stringify(out)
})()`))
ok('背包页里地图不出来（寄存在窗里待命）', tabs.inv.inView === false, JSON.stringify(tabs.inv))
ok('切回探索页地图自动回到顶部', tabs.explore.inView === true && tabs.explore.first === true, JSON.stringify(tabs.explore))

/* ── ⑦ 偏好持久化：刷新之后还是嵌入模式（本机偏好，不进存档） ── */
const saved = JSON.parse(await ev(`(() => { const raw = localStorage.getItem('zsv-ui-v1') || '{}'; return JSON.stringify(JSON.parse(raw)) })()`))
ok('摆法写进本机偏好 zsv-ui-v1', saved.mapStyle === 'inline', JSON.stringify(saved))
await send('Page.reload', {}); await sleep(4600)
await ev(`(() => { if (typeof setTab === 'function') setTab('explore'); if (typeof render === 'function') render(); return 1 })()`); await sleep(1200)
const reloaded = JSON.parse(await ev(`(() => {
  const map = document.getElementById('v4world'), win = document.getElementById('v4mapwin')
  return JSON.stringify({ style: window.V4Scale.mapStyle(), attr: document.documentElement.dataset.mapstyle,
    inView: !!(map && map.closest('#view')), winShown: !!win && getComputedStyle(win).display !== 'none',
    cells: document.querySelectorAll('#v4world .wcell').length })
})()`))
ok('刷新后仍是嵌入模式（偏好持久化）', reloaded.style === 'inline' && reloaded.attr === 'inline' && reloaded.inView === true && reloaded.winShown === false && reloaded.cells >= 576, JSON.stringify(reloaded))

/* ── ⑧ 切回 float：一切复原 ── */
const back = JSON.parse(await ev(`(async () => {
  window.V4Scale.setMapStyle('float')
  await new Promise(r => setTimeout(r, 900))
  const map = document.getElementById('v4world'), win = document.getElementById('v4mapwin')
  return JSON.stringify({ style: window.V4Scale.mapStyle(), attr: document.documentElement.dataset.mapstyle,
    inWin: !!(map && map.closest('#v4mapwin')), inView: !!(map && map.closest('#view')),
    winShown: getComputedStyle(win).display !== 'none', cells: document.querySelectorAll('#v4world .wcell').length,
    saved: JSON.parse(localStorage.getItem('zsv-ui-v1') || '{}').mapStyle })
})()`))
ok('切回悬浮窗：地图卡回窗里、悬浮窗亮起', back.style === 'float' && back.inWin && !back.inView && back.winShown && back.cells >= 576, JSON.stringify(back))
ok('偏好跟着回写 float', back.saved === 'float', String(back.saved))
await shot('m34_a3_float_back')

/* ── ⑨ 搬家不能把 MutationObserver 拖成死循环 ── */
const churn = JSON.parse(await ev(`(async () => {
  const view = document.getElementById('view')
  let n = 0
  const mo = new MutationObserver(m => { n += m.length })
  mo.observe(view, { childList: true, subtree: true })
  window.V4Scale.setMapStyle('inline')
  await new Promise(r => setTimeout(r, 2500))
  mo.disconnect()
  return JSON.stringify({ mutations: n, style: window.V4Scale.mapStyle() })
})()`))
ok('#view 子树 2.5 秒内变更次数正常（不是死循环）', churn.mutations > 0 && churn.mutations < 60, JSON.stringify(churn))
ok('控制台无异常', errs.length === 0, errs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
