// 直接量滚动条：innerWidth - documentElement.clientWidth 就是经典滚动条宽度（0 = 没有）。
// 不要靠截图里的"浅色竖条"判断——那玩意儿在深色页面上跟卡片描边一样。
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
const send = (method, params = {}, ms = 30000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT' } } } }) } }, ms)
})
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
for (const [w, h] of [[2048, 1105], [2048, 800], [1440, 900], [860, 900], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
  await sleep(2200)
  await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
  await sleep(700)
  const r = await ev(`(() => {
    const de = document.scrollingElement, cs = getComputedStyle(document.documentElement)
    return JSON.stringify({ win: innerWidth, docCW: de.clientWidth, scrollbar: innerWidth - de.clientWidth,
      htmlOy: cs.overflowY, bodyOy: getComputedStyle(document.body).overflowY,
      docScrollable: de.scrollHeight > de.clientHeight + 1, sh: de.scrollHeight, ch: de.clientHeight,
      appH: Math.round(document.querySelector('#app').getBoundingClientRect().height) })
  })()`)
  console.log(`${w}x${h}  ` + r)
}
ws.close()
