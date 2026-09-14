// 临时诊断 4：大区视图在 973/1056/1440 下"详情与出发按钮是否首屏可见 + 整卡是否一屏"。跑完即删。
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
for (const [w, h] of [[973, 867], [1056, 1151], [1440, 1000]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
  await sleep(2600)
  await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1; })()`)
  await sleep(400)
  await ev(`V4World.mapMode('region')`); await sleep(700)
  await ev(`(() => { const c=[...document.querySelectorAll('#v4world .rcell2')].find(e=>!/here/.test(e.className)); if(c) c.click(); return 1; })()`)
  await sleep(600)
  const info = await ev(`(() => {
    const v = document.getElementById('view'), card = document.getElementById('v4world');
    const det = document.querySelector('#v4world .rdetail'), go = document.querySelector('#v4world .rdetail .rgo');
    const grid = document.querySelector('#v4world .rgrid');
    const vb = v.getBoundingClientRect(), cb = card.getBoundingClientRect(), db = det.getBoundingClientRect();
    const gb = go ? go.getBoundingClientRect() : null, grb = grid.getBoundingClientRect();
    return JSON.stringify({ viewH: Math.round(vb.height), cardH: Math.round(cb.height), cardFits: Math.round(cb.bottom) <= Math.round(vb.bottom) + 1,
      cell: getComputedStyle(grid).gridTemplateColumns.split(' ')[0], gridH: Math.round(grb.height), tiny: grid.classList.contains('tiny'),
      stack: document.querySelector('#v4world .rmain').classList.contains('stack'),
      detailTop: Math.round(db.top - vb.top), detailVisible: Math.round(db.bottom) <= Math.round(vb.bottom) + 1,
      goText: (go ? go.textContent.replace(/\\s+/g,' ').trim().slice(0, 40) : null),
      goVisible: gb ? (gb.bottom <= vb.bottom + 1 && gb.top >= vb.top) : null,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth });
  })()`)
  console.log(w + 'x' + h + ' ' + info)
  await shot('diag_region_' + w)
}
process.exit(0)
