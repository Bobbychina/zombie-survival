// 探针辅助：切到某个 tab，回印该页 innerText 与渲染异常（诊断用）
const [, , cdpPort, url, which] = process.argv
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
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[' + m.params.type + '] ' + (m.params.args || []).map(a => String(a.value ?? a.description ?? '')).join(' ').slice(0, 400))
  if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(3500)
console.log(await ev(`(async () => {
  const out = []
  setTab(${JSON.stringify(which)})
  await new Promise(r => setTimeout(r, 500))
  out.push('tab=' + S.tab + ' renderErr=' + (window.__renderErr ? (window.__renderErr.message || window.__renderErr) : 'null'))
  out.push('viewText: ' + (document.getElementById('view').innerText || '').slice(0, 700).replace(/\\n+/g, ' | '))
  if (window.__renderErr) out.push('stack: ' + String(window.__renderErr.stack || '').split('\\n').slice(0, 3).join(' >> '))
  return out.join('\\n')
})()`))
console.log('\nconsole logs:\n' + logs.slice(-12).join('\n'))
ws.close()
