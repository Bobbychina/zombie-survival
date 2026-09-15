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
await send('Emulation.setDeviceMetricsOverride', { width: 1707, height: 960, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3400)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1200)
console.log(await ev(`(() => {
  const cards = document.getElementById('v4cards'), cs = getComputedStyle(cards), cr = cards.getBoundingClientRect()
  const kids = [...cards.children]
  const lefts = [...new Set(kids.map(k => Math.round(k.getBoundingClientRect().left)))].sort((a,b)=>a-b)
  const perCol = lefts.map(l => kids.filter(k => Math.round(k.getBoundingClientRect().left) === l).length)
  const bad = kids.filter(k => k.getBoundingClientRect().right > cr.right + 1).map(k => { const r=k.getBoundingClientRect(); return (k.dataset.card||'raw') + ':' + Math.round(r.left) + '-' + Math.round(r.right) })
  return JSON.stringify({ cardsBox: [Math.round(cr.left), Math.round(cr.right)], columnWidth: cs.columnWidth, columnGap: cs.columnGap,
    cols: lefts.length, perCol, overflowing: bad, scrollW: cards.scrollWidth, clientW: cards.clientWidth, overflowX: cs.overflowX })
})()`))
ws.close()
