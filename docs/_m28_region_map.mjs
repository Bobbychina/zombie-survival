const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 30 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description||'').split('\n')[0].slice(0,150)) }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${n}.png`, Buffer.from(r.result.data, 'base64')) }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3500)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(900)
await ev(`V4World.mapMode('region')`); await sleep(1400)
console.log('危险度分布: ' + await ev(`(() => {
  const cells = document.querySelectorAll('#v4world .rcell2')
  const grid = []
  for (let r = 0; r < 12; r++) {
    const row = []
    for (let c = 0; c < 12; c++) {
      const el = cells[r * 12 + c]
      const m = el && /d(\\d)/.exec(el.className || '')
      row.push(m ? m[1] : '?')
    }
    grid.push(row.join(''))
  }
  const flat = grid.join('').split('').filter(ch => ch !== '?').map(Number)
  const hist = [0, 0, 0, 0, 0, 0]
  for (const v of flat) hist[v]++
  return grid.join('\\n') + '\\n各档格数: ' + JSON.stringify(hist.slice(1)) + ' 共 ' + flat.length + ' 格'
})()`))
await shot('50_region_noise')
ws.close()
