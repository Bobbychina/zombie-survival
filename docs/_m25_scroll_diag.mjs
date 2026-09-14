// M25 诊断：用户报"整个页面还能滚动" —— 量清到底谁在滚（html/body/#app/#view/#side/#log/#v4cards）
// 用法：node docs/_m25_scroll_diag.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 20000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT ' + method } } } }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
const probe = `(() => {
  const de = document.scrollingElement;
  const box = (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
    return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), sh: e.scrollHeight, ch: e.clientHeight,
      sw: e.scrollWidth, cw: e.clientWidth, oy: cs.overflowY, ox: cs.overflowX, mh: cs.maxHeight, hgt: cs.height, pos: cs.position } }
  return JSON.stringify({
    win: { w: innerWidth, h: innerHeight },
    doc: { sh: de.scrollHeight, ch: de.clientHeight, scrollable: de.scrollHeight > de.clientHeight + 1, bodyOverflow: getComputedStyle(document.body).overflow },
    app: box('#app'), topbar: box('#topbar'), tabs: box('#tabs'), body: box('#body'),
    view: box('#view'), side: box('#side'), log: box('#log'), cards: box('#v4cards'), world: box('#v4world'), tools: box('#v4tools'),
    viewStyle: (() => { const e = document.querySelector('#view'); return e ? { cls: e.className, gh: getComputedStyle(e).gridTemplateRows } : null })()
  })
})()`
const widths = [2048, 1600, 1280, 1024]
for (const [w, h] of widths.map((w) => [w, 1105])) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
  await sleep(2200)
  const toExplore = `(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`
  await ev(toExplore); await sleep(800)
  const d = JSON.parse(await ev(probe))
  const line = (n, b) => b ? `  ${n}: h=${b.h} top=${b.top} bot=${b.bottom} sh=${b.sh} ch=${b.ch} oy=${b.oy} mh=${b.mh} h=${b.hgt}` : `  ${n}: —`
  console.log(`\n=== ${w}x${h} ===`)
  console.log(`  win=${d.win.w}x${d.win.h} doc sh=${d.doc.sh} ch=${d.doc.ch} 页面可滚=${d.doc.scrollable} body.overflow=${d.doc.bodyOverflow}`)
  for (const k of ['app', 'topbar', 'tabs', 'body', 'view', 'side', 'log', 'tools', 'world', 'cards']) console.log(line(k, d[k]))
  console.log('  #view class=' + (d.viewStyle?.cls || '') + ' gridRows=' + (d.viewStyle?.gh || ''))
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/scroll_${w}.png`, Buffer.from(r.result.data, 'base64'))
}
ws.close()
