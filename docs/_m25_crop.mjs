// 裁出地图卡片的左边缘竖条并放大 3 倍（判"24 行有没有被裁"这种几何问题，比整页 OCR 准得多）
// 用法：node docs/_m25_crop.mjs <cdpPort> <url> <out.png> <x> <y> <w> <h> [zoom]
const [, , cdpPort, url, out, x, y, w, h, zoom] = process.argv
const fs = await import('node:fs/promises')
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
const send = (method, params = {}, ms = 30000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(3200)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
await sleep(1200)
const shot = await send('Page.captureScreenshot', { format: 'png' })
const dataUrl = 'data:image/png;base64,' + shot.result.data
const res = await ev(`(async () => {
  const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode()
  const X = ${Number(x)}, Y = ${Number(y)}, W = ${Number(w)}, H = ${Number(h)}, Z = ${Number(zoom || 3)}
  const c = document.createElement('canvas'); c.width = Math.min(4096, W * Z); c.height = Math.min(4096, H * Z)
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false
  g.drawImage(img, X, Y, W, H, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
})()`)
if (typeof res === 'string' && res.startsWith('data:image')) { await fs.writeFile(out, Buffer.from(res.split(',')[1], 'base64')); console.log('WROTE ' + out) } else console.log('FAIL ' + res)
/* 顺便把地图卡片的几何数据回印出来，图上量不出精确像素时以这份为准 */
console.log(await ev(`(() => {
  const card = document.getElementById('v4world'), grid = card.querySelector('#v4world .wgrid'), wrap = card.querySelector('.wmapwrap')
  const cells = [...grid.querySelectorAll('.wcell')]
  const tops = [...new Set(cells.map(c => Math.round(c.getBoundingClientRect().top)))].sort((a,b)=>a-b)
  const c0 = cells[0].getBoundingClientRect(), cN = cells[cells.length-1].getBoundingClientRect()
  const wr = wrap.getBoundingClientRect()
  return JSON.stringify({ cardRect: [Math.round(card.getBoundingClientRect().left), Math.round(card.getBoundingClientRect().top), Math.round(card.getBoundingClientRect().width), Math.round(card.getBoundingClientRect().height)],
    wrapRect: [Math.round(wr.left), Math.round(wr.top), Math.round(wr.width), Math.round(wr.height)],
    rows: tops.length, firstTop: Math.round(c0.top), lastBottom: Math.round(cN.bottom), wrapBottom: Math.round(wr.bottom),
    clipped: Math.round(cN.bottom) > Math.round(wr.bottom) })
})()`))
ws.close()
