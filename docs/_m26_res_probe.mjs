// M26 诊断：分辨率 × 缩放矩阵 —— 到底哪些窗口尺寸下会坏（用户：「你没适配别的分辨率，也没适配别的缩放」）
// 缩放用 Emulation.setPageScaleFactor 模拟（CSS 像素视口等比缩小，浏览器缩放就是这个效果）。
// 用法：node docs/_m26_res_probe.mjs <cdpPort> <url> [outDir]
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 120))
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
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })

/* 真实世界组合：常见屏幕分辨率 × 常见浏览器缩放（CSS 像素视口 = 物理 / 缩放） */
const CASES = [
  ['1920x1080 @100%', 1920, 1080, 1],
  ['1920x1080 @125%', 1536, 864, 1],
  ['1920x1080 @150%', 1280, 720, 1],
  ['1920x1080 @175%', 1097, 617, 1],
  ['1920x1080 @200%', 960, 540, 1],
  ['2560x1440 @100%', 2560, 1440, 1],
  ['2560x1440 @125%', 2048, 1152, 1],
  ['2560x1440 @150%', 1707, 960, 1],
  ['1366x768  @100%', 1366, 768, 1],
  ['1366x768  @125%', 1093, 614, 1],
  ['1600x900  @125%', 1280, 720, 1],
  ['3840x2160 @200%', 1920, 1080, 1],
  ['3440x1440 @100%', 3440, 1440, 1],
  ['768x1024  iPad竖', 768, 1024, 1],
  ['390x844  手机', 390, 844, 1],
]
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
if (outDir) await fs.mkdir(outDir, { recursive: true })
const rows = []
for (const [label, w, h, z] of CASES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 })
  await send('Page.navigate', { url: pageUrl })
  await sleep(3200)
  await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
  await sleep(1100)
  const r = JSON.parse(await ev(`(() => {
    const de = document.scrollingElement
    const q = (s) => document.querySelector(s)
    const box = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) } }
    const grid = q('#v4world .wgrid')
    const cell = grid ? grid.querySelector('.wcell').getBoundingClientRect() : null
    const wrap = q('#v4world .wmapwrap')
    /* 找"被窗口切掉"的元素：右/下越界超过 2px 且不是滚动容器本身 */
    const clipped = []
    for (const e of document.querySelectorAll('#app *')) {
      const b = e.getBoundingClientRect()
      if (b.width < 8 || b.height < 8) continue
      const cs = getComputedStyle(e)
      if (cs.position === 'fixed') continue
      if (b.right > innerWidth + 2 || b.left < -2) clipped.push((e.id || e.className || e.tagName).toString().slice(0, 28) + ':' + Math.round(b.left) + '..' + Math.round(b.right))
    }
    /* 顶部工具条/时钟/HUD 是否还在首屏（不能被挤出视野） */
    const top = box('#topbar'), tabs = box('#tabs'), hud = box('#hud'), tools = box('#v4tools')
    const inView = (b) => !!b && b.t >= -2 && b.b <= Math.min(innerHeight, de.clientHeight) + 2
    return JSON.stringify({
      win: innerWidth + 'x' + innerHeight,
      pageScroll: de.scrollHeight > de.clientHeight + 1,
      appH: Math.round(q('#app').getBoundingClientRect().height),
      cell: cell ? Math.round(cell.width) + 'x' + Math.round(cell.height) : null,
      rows: grid ? Math.round(grid.getBoundingClientRect().height / Math.max(1, cell ? cell.height + 2 : 1)) : null,
      mapScroll: wrap ? wrap.scrollHeight - wrap.clientHeight : null,
      v4board: q('#view').classList.contains('v4-board'),
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null,
      clipped: clipped.slice(0, 4), clippedN: clipped.length,
      inView: { topbar: inView(top), tabs: inView(tabs), hud: inView(hud), tools: inView(tools) },
    })
  })()`))
  const bad = []
  /* M26：**窄屏（<900px）整页滚是预期行为** —— 那种宽度下地图与卡片只能上下排，
     shell 高度是 auto（game.css 的 ≤860px 规则），页面不滚就等于内容看不全。
     桌面档位（≥900px）才要求"整页不可滚"。 */
  if (r.pageScroll && w >= 900) bad.push('整页可滚')
  if (!r.inView.topbar) bad.push('顶栏出视野')
  if (!r.inView.tabs) bad.push('标签出视野')
  if (!r.inView.tools) bad.push('工具条出视野')
  if (r.clippedN) bad.push('横向越界 ' + r.clippedN + ' 个')
  if (r.cell && r.cell.split('x')[0] !== r.cell.split('x')[1]) bad.push('方块非方')
  console.log(`${label.padEnd(18)} ${r.win.padEnd(10)} board=${r.v4board ? 'Y' : 'N'} cell=${String(r.cell).padEnd(7)} rows=${String(r.rows).padEnd(4)} 地图滚=${String(r.mapScroll).padEnd(4)} ${bad.length ? '❌ ' + bad.join('、') : '✅'}`)
  if (bad.length) console.log('      clipped=' + JSON.stringify(r.clipped))
  if (outDir && (label.includes('2560x1440 @150%') || label.includes('1920x1080 @125%'))) await shot('res_' + label.replace(/[^0-9a-z%]+/gi, '_'))
  rows.push({ label, ...r, bad })
}
console.log('\n问题组合: ' + rows.filter(r => r.bad.length).map(r => r.label + '[' + r.bad.join('/') + ']').join('  ') || '无')
console.log('errors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'))
ws.close()
