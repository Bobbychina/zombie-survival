const [, , cdpPort, url, tag] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
const u = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
for (const w of [2048, 1800, 1700, 1600, 1440, 1280, 1100, 1000]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1105, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: u }); await sleep(2600)
  await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(900)
  console.log(`${tag} ${String(w).padStart(4)}  ` + await ev(`(() => {
    const grid = document.querySelector('#v4world .wgrid'); if (!grid) return 'no map'
    const cs = getComputedStyle(grid), c0 = grid.querySelector('.wcell').getBoundingClientRect()
    const cols = cs.gridTemplateColumns.split(' ').length, rows = cs.gridTemplateRows === 'none' ? 'none' : cs.gridTemplateRows.split(' ').length
    return 'cell=' + Math.round(c0.width) + 'x' + Math.round(c0.height) + ' tplCols=' + cols + '(' + cs.gridTemplateColumns.split(' ')[0] + ') tplRows=' + rows + '(' + (cs.gridTemplateRows === 'none' ? '-' : cs.gridTemplateRows.split(' ')[0]) + ') autoRows=' + cs.gridAutoRows + ' gridH=' + Math.round(grid.getBoundingClientRect().height)
  })()`))
}
ws.close()
