// 快速体检：抓控制台报错 + 关键节点是否存在（改完代码页面白屏时的第一站）
const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[' + m.params.type + '] ' + (m.params.args || []).map(a => String(a.value ?? a.description ?? '')).join(' ').slice(0, 300))
  if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params.exceptionDetails)).slice(0, 400))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(4000)
console.log('logs:\n' + logs.slice(0, 25).join('\n'))
console.log('\nDOM: ' + await ev(`JSON.stringify({
  app: !!document.getElementById('app'), view: !!document.getElementById('view'), tabs: document.querySelectorAll('#tabs .tab').length,
  v4tools: !!document.getElementById('v4tools'), v4world: !!document.getElementById('v4world'), v4cards: !!document.getElementById('v4cards'),
  DEV: typeof DEV, boot: typeof boot, S: typeof S, setLoaded: typeof setLoaded, loadedAmmo: typeof loadedAmmo,
  viewText: (document.getElementById('view')||{}).innerText ? document.getElementById('view').innerText.slice(0,80) : null
})`))
ws.close()
