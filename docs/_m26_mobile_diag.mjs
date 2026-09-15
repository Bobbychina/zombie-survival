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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3500)
console.log(await ev(`(() => {
  const out = []
  out.push('innerWidth=' + innerWidth + ' 视口meta=' + (document.querySelector('meta[name=viewport]')||{}).content)
  out.push('匹配 max-width:560 -> ' + matchMedia('(max-width:560px)').matches + ' | min-width:1500 -> ' + matchMedia('(min-width:1500px)').matches + ' | max-width:860 -> ' + matchMedia('(max-width:860px)').matches)
  const g = document.querySelector('#v4world .wgrid'), wrap = document.querySelector('#v4world .wmapwrap'), cards = document.querySelector('#v4cards')
  if (g) { const cs = getComputedStyle(g); const c = g.querySelector('.wcell').getBoundingClientRect(); out.push('wgrid: minWidth=' + cs.minWidth + ' tpl=' + cs.gridTemplateColumns.split(' ')[0] + ' 宽=' + Math.round(g.getBoundingClientRect().width) + ' cell=' + Math.round(c.width) + 'x' + Math.round(c.height)) }
  if (wrap) out.push('wrap: ' + Math.round(wrap.clientWidth) + 'x' + Math.round(wrap.clientHeight) + ' sw=' + wrap.scrollWidth)
  if (cards) out.push('cards: ' + Math.round(cards.clientWidth) + ' sw=' + cards.scrollWidth + ' 列=' + getComputedStyle(cards).columnCount)
  out.push('doc: sh=' + document.scrollingElement.scrollHeight + ' ch=' + document.scrollingElement.clientHeight + ' sw=' + document.scrollingElement.scrollWidth)
  return out.join('\\n')
})()`))
ws.close()
