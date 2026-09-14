// M25 定位 33px 幽灵：谁把 #app 推下去、谁让文档多出 33px
const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 20000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT' } } } }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(2500)
console.log(await ev(`(() => {
  const out = []
  const app = document.querySelector('#app')
  const cs = getComputedStyle(app)
  out.push('app margin=' + cs.margin + ' position=' + cs.position + ' top=' + cs.top + ' height=' + cs.height + ' transform=' + cs.transform)
  out.push('body margin=' + getComputedStyle(document.body).margin + ' html margin=' + getComputedStyle(document.documentElement).margin)
  // 找所有 top>0 且不是 #app 后代的 fixed/absolute 元素（幽灵占位嫌疑）
  const ghosts = []
  document.querySelectorAll('body > *, body > *::before').forEach((e) => {})
  for (const e of document.body.children) {
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e)
    ghosts.push(e.id || e.className || e.tagName, ': top=' + Math.round(r.top) + ' h=' + Math.round(r.height) + ' pos=' + c.position + ' mt=' + c.marginTop + ' ov=' + c.overflowY)
  }
  out.push('body children: ' + JSON.stringify(ghosts))
  const before = getComputedStyle(document.body, '::before')
  out.push('body::before content=' + before.content + ' display=' + before.display + ' h=' + before.height + ' pos=' + before.position)
  out.push('doc sh=' + document.scrollingElement.scrollHeight + ' ch=' + document.scrollingElement.clientHeight)
  return out.join('\\n')
})()`))
ws.close()
