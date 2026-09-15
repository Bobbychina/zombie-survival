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
await send('Page.navigate', { url }); await sleep(4500)
console.log(await ev(`(() => {
  const out = []
  out.push('__v4AutoTut 挂了没: ' + typeof window.__v4AutoTut)
  try { V4Tutorial.start(); out.push('手动 start 之后 root=' + !!document.getElementById('v4tut') + ' step=' + V4Tutorial.step()) } catch (e) { out.push('start 抛错: ' + e.message) }
  return out.join('\\n')
})()`))
console.log('展开的引导:', await ev(`(typeof __v4AutoTut === 'function') ? (() => { try { __v4AutoTut(); return 'called ok, root=' + !!document.getElementById('v4tut') } catch (e) { return 'threw: ' + e.message } })() : 'no hook'`))
ws.close()
