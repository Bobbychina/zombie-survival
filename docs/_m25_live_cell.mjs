const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 20 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
if (!target) { console.log('FAIL CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 15000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 20000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
const u = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
for (const w of [2048, 1600]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1105, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: u }); await sleep(4500)
  console.log(w + '  ' + await ev(`(() => {
    const grid = document.querySelector('#v4world .wgrid'); if (!grid) return 'no map'
    const cs = getComputedStyle(grid); const c = grid.querySelector('.wcell').getBoundingClientRect()
    const wrap = document.querySelector('#v4world .wmapwrap')
    const de = document.scrollingElement
    return 'cell=' + Math.round(c.width) + 'x' + Math.round(c.height) + ' tplCol=' + cs.gridTemplateColumns.split(' ')[0] + ' tplRow=' + cs.gridTemplateRows.split(' ')[0] + ' wrapScroll=' + (wrap ? wrap.scrollHeight - wrap.clientHeight : '?') + ' 整页可滚=' + (de.scrollHeight > de.clientHeight + 1)
  })()`))
}
ws.close()
