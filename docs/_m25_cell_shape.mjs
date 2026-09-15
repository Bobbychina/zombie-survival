const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
if (!target) { console.log('FAIL CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description||'').split('\n')[0].slice(0,120)) }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
for (const [w, h] of [[2048, 1105], [2048, 1280], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' }); await sleep(3000)
  await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1200)
  console.log(`${w}x${h}  ` + await ev(`(() => {
    const card = document.getElementById('v4world'), grid = card.querySelector('#v4world .wgrid'), wrap = card.querySelector('.wmapwrap')
    const cs = getComputedStyle(grid), cell = grid.querySelector('.wcell')
    const cb = cell.getBoundingClientRect(), gb = grid.getBoundingClientRect(), wb = wrap.getBoundingClientRect()
    return JSON.stringify({ cell: Math.round(cb.width) + 'x' + Math.round(cb.height), autoRows: cs.gridAutoRows, tpl: cs.gridTemplateColumns.split(' ')[0],
      alignItems: cs.alignItems, gridH: Math.round(gb.height), wrapH: Math.round(wb.height), wrapScroll: wrap.scrollHeight - wrap.clientHeight,
      lastRowBottom: Math.round([...grid.querySelectorAll('.wcell')].slice(-1)[0].getBoundingClientRect().bottom), wrapBottom: Math.round(wb.bottom) })
  })()`))
}
console.log('errors: ' + (errs.length ? errs.slice(0,2).join(' | ') : 'none'))
ws.close()
