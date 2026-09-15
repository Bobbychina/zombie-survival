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
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3400)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1400)
console.log(await ev(`(() => {
  const view = document.getElementById('view'), world = document.getElementById('v4world'), cards = document.getElementById('v4cards')
  const wrap = world.querySelector('.wmapwrap')
  const out = []
  out.push('view: clientH=' + view.clientHeight + ' scrollH=' + view.scrollHeight + ' 差=' + (view.scrollHeight - view.clientHeight))
  out.push('world: h=' + Math.round(world.getBoundingClientRect().height) + ' clientH=' + world.clientHeight + ' scrollH=' + world.scrollHeight)
  out.push('cards: h=' + Math.round(cards.getBoundingClientRect().height) + ' clientH=' + cards.clientHeight + ' scrollH=' + cards.scrollHeight)
  out.push('wrap: clientH=' + (wrap ? wrap.clientHeight : -1) + ' scrollH=' + (wrap ? wrap.scrollHeight : -1))
  out.push('cell=' + Math.round(world.querySelector('.wcell').getBoundingClientRect().height) + ' tpl=' + getComputedStyle(world.querySelector('.wgrid')).gridTemplateColumns.split(' ')[0])
  out.push('board areas=' + getComputedStyle(view).gridTemplateAreas + ' rows=' + getComputedStyle(view).gridTemplateRows)
  out.push('world rect top/bottom=' + Math.round(world.getBoundingClientRect().top) + '/' + Math.round(world.getBoundingClientRect().bottom) + ' view bottom=' + Math.round(view.getBoundingClientRect().bottom))
  /* 手动跑一次 fitMap 看循环有没有把它收小 */
  if (typeof fitMap === 'function') { const b4 = Math.round(world.querySelector('.wcell').getBoundingClientRect().height); fitMap(); const af = Math.round(world.querySelector('.wcell').getBoundingClientRect().height); out.push('fitMap: ' + b4 + ' -> ' + af) }
  return out.join('\\n')
})()`))
ws.close()
