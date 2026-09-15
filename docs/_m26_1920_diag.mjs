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
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3400)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1400)
console.log(await ev(`(() => {
  const out = []
  const clipped = []
  for (const e of document.querySelectorAll('#app *')) {
    const b = e.getBoundingClientRect()
    if (b.width < 8 || b.height < 8) continue
    if (getComputedStyle(e).position === 'fixed') continue
    if (b.right > innerWidth + 2 || b.left < -2) clipped.push({ sel: (e.id || e.className || e.tagName).toString().slice(0, 30), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) })
  }
  out.push('越界元素: ' + JSON.stringify(clipped))
  const cards = document.getElementById('v4cards')
  const cs = getComputedStyle(cards)
  out.push('cards: display=' + cs.display + ' columnWidth=' + cs.columnWidth + ' cols=' + cs.columnCount + ' clientW=' + cards.clientWidth)
  out.push('cards 子卡宽: ' + JSON.stringify([...cards.children].slice(0,4).map(c => Math.round(c.getBoundingClientRect().width))))
  out.push('media max-width:1799 -> ' + matchMedia('(max-width:1799px)').matches + ' | min-width:1800&min-height:950 -> ' + matchMedia('(min-width:1800px) and (min-height:950px)').matches)
  return out.join('\\n')
})()`))
ws.close()
