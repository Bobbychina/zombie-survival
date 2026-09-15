// M32 取证：① 字号 5 档真的放大（卡片区 zoom + 布局不崩）② 地图搬进悬浮窗（任何页签都能开/折叠）
//   ③ 探索页整宽只剩行动卡片 ④ 悬浮窗里地图真的画出来了（本地 + 大区）⑤ 偏好持久化 ⑥ 整页不滚/无横向溢出
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
/* 读档会恢复"上次停在哪一页"，所以先显式回到探索页 —— 否则量到的是别页的 DOM（cards=0）。 */
await ev(`(() => { if (typeof setTab === 'function') setTab('explore'); if (typeof render === 'function') render(); return 1 })()`); await sleep(900)
/* 等地图真的画完再量：悬浮窗里的图是"世界就绪后才挂上去"的，冷门区域首次生成会慢一点
   （实测偶发第一帧还是空的）。这里最多等 12 秒，并把**实际等待时长**打出来 —— 它本身是个性能信号。
   M36：连跑多套探针时这里偶发 cells=0（回归电池批跑实测栽过一次，单独跑 17/17）——
   多半是上一支探针把页签/悬浮窗留在了别的状态，所以先把"探索页 + 悬浮窗开着"按下去再等。
   M40：再加一条 —— 地图有**本地/大区**两种模式，模式存在 localStorage（`dsh.mapmode`）里，
   别的探针/诊断把大区图留在那儿时这里的 `.wcell` 就是 0（本轮实测栽过）。开场强制回本地图。 */
await ev(`(() => { try { closeAllModals(); setTab('explore') } catch {} ; try { window.V4Scale && V4Scale.setMapStyle && V4Scale.setMapStyle('float') } catch {} ; try { window.V4Scale && V4Scale.toggleMap && V4Scale.toggleMap(true) } catch {} ; try { window.V4World && V4World.mapMode && V4World.mapMode('local') } catch {} ; return 1 })()`)
await sleep(800)
let mapWaitMs = 0
for (let i = 0; i < 30; i++) {
  if (Number(await ev(`document.querySelectorAll('#v4world .wcell').length`)) >= 576) break
  await sleep(400); mapWaitMs += 400
}
console.log('（地图首帧等待 ' + mapWaitMs + 'ms）')

/* ── ① 地图搬进悬浮窗，且探索页整宽只剩卡片 ── */
const layout = JSON.parse(await ev(`(() => {
  const view = document.getElementById('view')
  const win = document.getElementById('v4mapwin')
  const map = document.getElementById('v4world')
  const cards = document.getElementById('v4cards')
  const vr = view.getBoundingClientRect(), cr = cards ? cards.getBoundingClientRect() : null
  return JSON.stringify({
    winExists: !!win, winOpen: !!(win && win.classList.contains('open')),
    mapInWin: !!(map && win && map.closest('#v4mapwin')), mapInView: !!(map && map.closest('#view')),
    board: view.classList.contains('v4-board'),
    cardsW: cr ? Math.round(cr.width) : 0, viewW: Math.round(vr.width),
    cardsInView: !!(cards && cards.closest('#view')), cells: document.querySelectorAll('#v4world .wcell').length,
  })
})()`))
ok('地图搬进悬浮窗（不在 #view 里了）', layout.winExists && layout.mapInWin && !layout.mapInView, JSON.stringify({ inWin: layout.mapInWin, inView: layout.mapInView }))
ok('探索页整宽留给行动卡片', layout.board && layout.cardsInView && layout.cardsW >= layout.viewW - 40, JSON.stringify({ cards: layout.cardsW, view: layout.viewW }))
ok('悬浮窗里的地图真的画出来了（24×24 格）', layout.cells >= 576, 'cells=' + layout.cells + (layout.cells >= 576 ? '' : ' | ' + await ev(`(() => {
  /* 连跑多套探针时偶发 cells=0（单独跑 3 次都正常）—— 失败时把现场打出来，省得下次靠猜 */
  const map = document.getElementById('v4world')
  const win = document.getElementById('v4mapwin')
  return JSON.stringify({ tab: S && S.tab, over: !!(S && S.over), day: S && S.day, loc: S && S.loc,
    hasWorld: !!(S && S.world), region: S && S.world && S.world.region,
    mapHere: !!map, htmlLen: map ? map.innerHTML.length : -1, sigLen: map ? (map.dataset.sig || '').length : -1,
    winOpen: win ? win.classList.contains('open') : null, viewCls: (document.getElementById('view') || {}).className })
})()`)))
await shot('a0_map_float_100')

/* ── ② 折叠 / 在任何页签都能开 ── */
const toggle = JSON.parse(await ev(`(() => {
  if (typeof setTab === 'function') setTab('craft')          // 换到"制作"页：地图照样能在
  window.V4Scale.toggleMap(false)
  const closed = !document.getElementById('v4mapwin').classList.contains('open')
  const barVisible = getComputedStyle(document.getElementById('v4mapbar')).display !== 'none'
  window.V4Scale.toggleMap(true)
  const opened = document.getElementById('v4mapwin').classList.contains('open')
  return JSON.stringify({ closed, barVisible, opened, tab: window.S.tab })
})()`))
ok('折叠后只留一个小条（可点开）', toggle.closed === true && toggle.barVisible === true, JSON.stringify(toggle))
ok('在别的页签（制作/背包…）也能打开地图', toggle.opened === true && toggle.tab === 'craft', JSON.stringify(toggle))

/* ── ③ 字号 5 档：card zoom 真的变了 ── */
/* 注意（踩过的坑）：卡片墙是 MutationObserver 在**微任务**里重建的，所以 `setTab('explore')` 之后
   必须在同一个 evaluate 里 await 一拍，否则读到的是"墙还没建"的空状态（zoom=none、cardW=0）——
   这是探针的时序问题，不是产品问题。每一步都 await，量到的才是真实布局。 */
const scales = JSON.parse(await ev(`(async () => {
  if (typeof setTab === 'function') setTab('explore')
  const out = []
  for (const fs of [100, 115, 130, 145, 160]) {
    window.V4Scale.set(fs)
    await new Promise(r => setTimeout(r, 250))
    const cards = document.getElementById('v4cards')
    out.push({ fs, zoom: cards ? cards.style.zoom || '1' : 'none', cssVar: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(),
      cardW: cards ? Math.round(cards.querySelector('.v4card') ? cards.querySelector('.v4card').getBoundingClientRect().width : 0) : 0 })
  }
  window.V4Scale.set(100)
  await new Promise(r => setTimeout(r, 250))
  return JSON.stringify({ out })
})()`))
const zs = scales.out.map(o => Number(o.zoom))
ok('五档字号都落到 DOM（zoom = 1.0 / 1.15 … 1.6）', zs.join() === '1,1.15,1.3,1.45,1.6', JSON.stringify(scales.out.map(o => o.fs + '→' + o.zoom)))
ok('卡片宽度随字号变化（不是只改字号不改布局）', new Set(scales.out.map(o => o.cardW)).size > 1, JSON.stringify(scales.out.map(o => o.cardW)))

/* ── ④ 160% 下：不横向溢出、整页不滚、地图仍可用 ── */
const big = JSON.parse(await ev(`(async () => {
  window.V4Scale.set(160)
  await new Promise(r => setTimeout(r, 400))
  if (typeof V4World !== 'undefined' && V4World.mapMode) V4World.mapMode('local')
  await new Promise(r => setTimeout(r, 900))
  const over = [...document.querySelectorAll('#view *')].filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2)
  }).length
  const de = document.documentElement
  return JSON.stringify({ fs: window.V4Scale.prefs().fs, overflowEls: over,
    pageScroll: de.scrollHeight - de.clientHeight, winW: window.innerWidth,
    mapCells: document.querySelectorAll('#v4world .wcell').length, mapAllSame: (() => {
      const cells = [...document.querySelectorAll('#v4world .wcell')].slice(0, 40)
      const ws = new Set(cells.map(c => Math.round(c.getBoundingClientRect().width)))
      const hs = new Set(cells.map(c => Math.round(c.getBoundingClientRect().height)))
      return ws.size === 1 && hs.size === 1 ? (ws.values().next().value + 'x' + hs.values().next().value) : 'uneven'
    })() })
})()`))
ok('160% 字号下没有横向溢出', big.overflowEls === 0, JSON.stringify({ overflowEls: big.overflowEls, winW: big.winW }))
ok('160% 字号下整页不滚（只有容器内部滚）', Math.abs(big.pageScroll) <= 2, 'scroll=' + big.pageScroll)
ok('160% 字号下地图格子仍是正方形', typeof big.mapAllSame === 'string' && big.mapAllSame !== 'uneven', String(big.mapAllSame))
await shot('a1_map_float_160')

/* ── ④b 悬浮窗自己在五档字号下都不能超出屏幕（M32.1：zoom 会把窗口的 px 也放大） ── */
const fitScale = JSON.parse(await ev(`(async () => {
  const out = []
  for (const fs of [100, 115, 130, 145, 160]) {
    window.V4Scale.set(fs)
    await new Promise(r => setTimeout(r, 600))
    const win = document.getElementById('v4mapwin')
    const cells = document.querySelectorAll('#v4world .wcell')
    const last = cells[cells.length - 1]
    const wb = win.getBoundingClientRect(), lb = last ? last.getBoundingClientRect() : null
    out.push({ fs, right: Math.round(wb.right), bottom: Math.round(wb.bottom), w: Math.round(wb.width), h: Math.round(wb.height),
      inView: wb.left >= -1 && wb.top >= -1 && wb.right <= innerWidth + 1 && wb.bottom <= innerHeight + 1,
      lastRight: lb ? Math.round(lb.right) : null, cellW: lb ? Math.round(lb.width) : null })
  }
  window.V4Scale.set(100); await new Promise(r => setTimeout(r, 500))
  return JSON.stringify({ vp: innerWidth + 'x' + innerHeight, out })
})()`))
ok('五档字号下地图悬浮窗都不超出屏幕（右边/下边）', fitScale.out.every(o => o.inView), JSON.stringify({ vp: fitScale.vp, out: fitScale.out.map(o => o.fs + '%:' + o.w + 'x' + o.h + (o.inView ? '✅' : '❌')) }))
ok('大字模式下最右一列没被切掉（整宽 24 列都在窗内）', fitScale.out.every(o => o.lastRight !== null && o.lastRight <= o.right + 2), JSON.stringify(fitScale.out.map(o => o.fs + '%:' + o.lastRight + '/' + o.right)))
ok('大字模式下格子命中区仍 ≥23px（不会小到点不准）', fitScale.out.every(o => o.cellW >= 23), JSON.stringify(fitScale.out.map(o => o.fs + '%:' + o.cellW + 'px')))

/* ── ⑤ 偏好持久化 + 大区图在悬浮窗里也能用 ── */
const persist = JSON.parse(await ev(`(async () => {
  window.V4Scale.set(130)
  window.V4Scale.toggleMap(false)
  await new Promise(r => setTimeout(r, 200))
  const raw = localStorage.getItem('zsv-ui-v1') || ''
  const saved = JSON.parse(raw || '{}')
  /* 切个页签再回来，看偏好有没有被"重置"（模拟换页） */
  if (typeof setTab === 'function') { setTab('inv'); setTab('explore') }
  await new Promise(r => setTimeout(r, 500))
  const after = window.V4Scale.prefs()
  window.V4Scale.toggleMap(true)
  if (typeof V4World !== 'undefined' && V4World.mapMode) V4World.mapMode('region')
  await new Promise(r => setTimeout(r, 1200))
  const rcells = document.querySelectorAll('#v4world .rcell2').length
  return JSON.stringify({ saved, after, rcells, title: (document.getElementById('v4mapwin-title') || {}).textContent })
})()`))
ok('字号/地图开关写进本机偏好（不是存档）', persist.saved.fs === 130 && persist.saved.mapOpen === false, JSON.stringify(persist.saved))
ok('换页之后偏好没丢', persist.after.fs === 130, JSON.stringify(persist.after))
ok('大区图在悬浮窗里正常（144 格 + 标题变"大区"）', persist.rcells === 144 && /大区/.test(String(persist.title)), JSON.stringify({ rcells: persist.rcells, title: persist.title }))
await shot('a2_map_float_region')

/* ── ⑥ 参数恢复标准，方便后续探针 ── */
await ev(`(() => { window.V4Scale.set(100); if (typeof V4World !== 'undefined' && V4World.mapMode) V4World.mapMode('local'); return 1 })()`)
await sleep(600)
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
