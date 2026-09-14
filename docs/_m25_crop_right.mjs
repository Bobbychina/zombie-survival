// 裁右边缘 80px 竖条并放大 4 倍（PNG 手写解码太麻烦 → 用 CDP 截图能力更省事：
// 直接在页面里把截图当图片画进 canvas，裁右边缘导出 dataURL）。这样不依赖任何图像库。
const [, , cdpPort, url, out] = process.argv
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
const send = (method, params = {}, ms = 30000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT' } } } }) } }, ms)
})
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(2200)
await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
await sleep(600)
const shot = await send('Page.captureScreenshot', { format: 'png' })
const dataUrl = 'data:image/png;base64,' + shot.result.data
// 右边缘 60px 放大 4 倍导出，再看滚动条是否真的存在
const res = await ev(`(async () => {
  const img = new Image(); img.src = ${JSON.stringify(dataUrl)}
  await img.decode()
  const w = 60, h = img.naturalHeight, z = 4
  const c = document.createElement('canvas'); c.width = w * z; c.height = h * z
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false
  g.drawImage(img, img.naturalWidth - w, 0, w, h, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
})()`)
if (typeof res === 'string' && res.startsWith('data:image')) {
  await fs.writeFile(out, Buffer.from(res.split(',')[1], 'base64'))
  console.log('WROTE ' + out)
} else console.log('FAIL ' + res)
ws.close()
