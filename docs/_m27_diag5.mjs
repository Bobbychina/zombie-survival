const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 30 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[' + m.params.type + '] ' + (m.params.args||[]).map(a=>String(a.value??a.description??'')).join(' ').slice(0,180))
  if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (m.params.exceptionDetails?.exception?.description||'').split('\n')[0].slice(0,180)) }
const send = (method, params = {}, ms = 20000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
/* 干净起点：清掉教程标记，再进游戏（模拟"朋友第一次打开"） */
await send('Page.navigate', { url }); await sleep(2500)
await ev(`localStorage.removeItem('dsh.tutorial.done'); localStorage.removeItem('dsh.tutorial.step'); 1`)
await send('Page.navigate', { url }); await sleep(6000)
console.log('auto after clean start: ' + await ev(`JSON.stringify({ rooted: !!document.getElementById('v4tut'), step: (typeof V4Tutorial!=='undefined'?V4Tutorial.step():'x'), ls: localStorage.getItem('dsh.tutorial.step'), visibility: document.visibilityState })`))
console.log('logs: ' + logs.slice(-6).join(' || '))
ws.close()
