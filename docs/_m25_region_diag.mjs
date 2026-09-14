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
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1000)
await ev(`V4World.mapMode('region')`); await sleep(1200)
console.log('__fitRegion = ' + await ev(`JSON.stringify(window.__fitRegion || null)`))
console.log('cells = ' + await ev(`(() => { const g=document.querySelector('#v4world .rgrid'); if(!g) return 'no rgrid'; const rows=new Set([...g.children].filter(e=>e.classList.contains('rcell2')).map(e=>Math.round(e.getBoundingClientRect().top))); return 'rows='+rows.size+' h='+Math.round(g.getBoundingClientRect().height)+' tpl='+getComputedStyle(g).gridTemplateColumns.slice(0,26) })()`))
console.log('dom = ' + await ev(`(() => { const g=document.querySelector('#v4world .rgrid'); const c=g?g.firstElementChild:null; return c ? (c.className + ' h=' + Math.round(c.getBoundingClientRect().height) + ' w=' + Math.round(c.getBoundingClientRect().width)) : 'none' })()`))
ws.close()
