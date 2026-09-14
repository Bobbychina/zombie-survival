const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 40000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3200)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1200)
console.log(await ev(`(() => {
  const card = document.getElementById('v4world'), wrap = card.querySelector('.wmapwrap'), grid = card.querySelector('.wgrid')
  const cs = getComputedStyle(grid)
  const cells = grid.querySelectorAll('.wcell')
  const rows = new Set([...cells].map(c => Math.round(c.getBoundingClientRect().top)))
  const c0 = cells[0].getBoundingClientRect()
  const out = []
  out.push('grid tpl=' + cs.gridTemplateColumns.slice(0,30) + ' autoRows=' + cs.gridAutoRows + ' cols=' + cs.gridTemplateColumns.split(' ').length)
  out.push('cell rect=' + Math.round(c0.width) + 'x' + Math.round(c0.height) + ' rows=' + rows.size + ' cells=' + cells.length)
  out.push('grid rect h=' + Math.round(grid.getBoundingClientRect().height) + ' sh=' + grid.scrollHeight)
  out.push('wrap clientH=' + wrap.clientHeight + ' scrollH=' + wrap.scrollHeight)
  out.push('card clientH=' + card.clientHeight + ' scrollH=' + card.scrollHeight + ' ovY=' + getComputedStyle(card).overflowY)
  out.push('wrap cs minH=' + getComputedStyle(wrap).minHeight + ' flex=' + getComputedStyle(wrap).flex)
  return out.join('\\n')
})()`))
ws.close()
