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
await send('Page.navigate', { url }); await sleep(5000)
console.log('auto: ' + await ev(`JSON.stringify({ root: !!document.getElementById('v4tut'), step: (typeof V4Tutorial !== 'undefined' ? V4Tutorial.step() : 'x'), ls: localStorage.getItem('dsh.tutorial.step') })`))
console.log('steps: ' + await ev(`(async () => {
  if (!document.getElementById('v4tut')) V4Tutorial.start(true)
  const seen = []
  for (let i = 0; i < 18; i++) {
    const open = V4Tutorial.isOpen()
    if (!open) break
    const r = document.getElementById('v4tut')
    const bub = r.querySelector('.v4tut-bub')
    const spot = r.querySelector('.v4tut-spot')
    seen.push(V4Tutorial.step() + ':' + (bub ? 'B' : '-') + (spot ? 'S' : '-') + ':' + ((bub.querySelector('.v4tut-hd b') || {}).textContent || '').slice(0, 14))
    V4Tutorial.next()
    await new Promise(r2 => setTimeout(r2, 500))
  }
  return seen.join(' | ')
})()`))
ws.close()
