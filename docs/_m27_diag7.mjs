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
await send('Page.navigate', { url }); await sleep(4000)
console.log(await ev(`(() => {
  const out = []
  out.push('ls done=' + localStorage.getItem('dsh.tutorial.done') + ' step=' + localStorage.getItem('dsh.tutorial.step'))
  out.push('total=' + V4Tutorial.total() + ' step=' + V4Tutorial.step())
  try { V4Tutorial.start(true); out.push('start(true) -> step=' + V4Tutorial.step() + ' root=' + !!document.getElementById('v4tut')) } catch (e) { out.push('start threw: ' + e.message + ' @ ' + (e.stack||'').split('\\n')[1]) }
  return out.join('\\n')
})()`))
console.log('--- 再手动补一次 enter 的效果（start 后 700ms）---')
await sleep(800)
console.log(await ev(`JSON.stringify({ step: V4Tutorial.step(), root: !!document.getElementById('v4tut'), ls: localStorage.getItem('dsh.tutorial.step'), bub: !!document.querySelector('#v4tut .v4tut-bub') })`))
ws.close()
