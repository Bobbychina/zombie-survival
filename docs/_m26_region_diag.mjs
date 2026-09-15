const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 30 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 20000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3200)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(900)
await ev(`V4World.mapMode('region')`); await sleep(1500)
console.log(await ev(`(() => {
  const card = document.getElementById('v4world'), view = document.getElementById('view')
  const out = []
  out.push('view: ' + Math.round(view.clientWidth) + 'x' + Math.round(view.clientHeight) + ' board=' + view.className)
  out.push('card: ' + Math.round(card.clientWidth) + 'x' + Math.round(card.clientHeight))
  let i = 0
  for (const el of card.children) { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); out.push('  ' + i++ + ' ' + (el.className || el.tagName).toString().slice(0,26) + ' h=' + Math.round(r.height) + ' w=' + Math.round(r.width) + ' flex=' + cs.flex + ' disp=' + cs.display) }
  const rg = card.querySelector('.rgrid')
  const rr = rg ? rg.parentElement : null
  out.push('rgrid parent=' + (rr ? (rr.className || rr.tagName) : 'none') + ' h=' + (rr ? Math.round(rr.clientHeight) : -1))
  out.push('rgrid: ' + (rg ? Math.round(rg.getBoundingClientRect().width) + 'x' + Math.round(rg.getBoundingClientRect().height) + ' cols=' + getComputedStyle(rg).gridTemplateColumns.split(' ')[0] : 'none'))
  out.push('cell=' + (rg ? Math.round(rg.querySelector('.rcell2').getBoundingClientRect().width) : -1))
  return out.join('\\n')
})()`))
ws.close()
