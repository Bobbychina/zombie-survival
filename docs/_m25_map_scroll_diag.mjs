// 诊断：地图面板到底谁在滚（#v4world 自己 / .wmapwrap / .rgridwrap），以及各层高度对不上多少
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
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 40000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(3200)
const report = async (tag) => {
  const r = await ev(`(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null
      const c = getComputedStyle(e), b = e.getBoundingClientRect()
      return { h: Math.round(b.height), w: Math.round(b.width), sh: e.scrollHeight, sw: e.scrollWidth, ch: e.clientHeight, cw: e.clientWidth,
        oy: c.overflowY, ox: c.overflowX, mh: c.maxHeight, hgt: c.height, gt: (c.gridTemplateColumns || '').slice(0, 40) } }
    const scrollers = []
    for (const e of document.querySelectorAll('#view, #view *')) {
      const c = getComputedStyle(e)
      if ((e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) && /auto|scroll/.test(c.overflowY + c.overflowX)) {
        scrollers.push((e.id || e.className || e.tagName) + '[y' + (e.scrollHeight - e.clientHeight) + ' x' + (e.scrollWidth - e.clientWidth) + ']')
      }
    }
    /* 注意：本地视图的网格类名是 .wgrid，大区视图是 .rgrid —— 两个都查，别用一个选择器碰运气
       （诊断第一版就栽在这：大区视图里量到的是本地那张 24×24 的 .wgrid，结论全是错的）。 */
    return JSON.stringify({ tag: '${tag}', mapMode: (window.V4World && V4World.mapMode ? V4World.mapMode() : '?'),
      view: box('#view'), world: box('#v4world'), wrap: box('.wmapwrap'),
      localGrid: box('#v4world .wgrid') ? { ...box('#v4world .wgrid'), rows: document.querySelectorAll('#v4world .wgrid .wcell').length / 24 } : null,
      regionGrid: box('#v4world .rgrid'), legend: box('#v4world .wlegend-box'),
      scrollers })
  })()`)
  console.log(r)
}
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
await sleep(1000)
await report('local-2048x1105')
await ev(`V4World.mapMode('region')`); await sleep(900)
await report('region-2048x1105')
await ev(`V4World.mapMode('local')`); await sleep(700)
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(900)
await report('local-1440x900')
ws.close()
