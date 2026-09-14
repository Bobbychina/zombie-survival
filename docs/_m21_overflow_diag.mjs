// 临时诊断 3：溢出到底出在哪（用户截图：大区地图选中详情被切）。跑完即删。
const [, , cdpPort, url] = process.argv
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
  if (r.result?.data) await (await import('node:fs/promises')).writeFile(name, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
for (const [w, h] of [[973, 867], [1056, 1151], [1440, 1000]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
  await sleep(2600)
  await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1; })()`)
  await sleep(500)
  await ev(`V4World.mapMode('region')`); await sleep(600)
  // 选中一个非当前区域（第一格）
  const sel = await ev(`(() => { const c=[...document.querySelectorAll('#v4world .rcell2')].find(e=>!/here/.test(e.className)); if(!c) return 'none'; c.click(); return c.textContent.replace(/\\s+/g,' ').trim().slice(0,20); })()`)
  await sleep(500)
  const info = await ev(`(() => {
    const R = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
        sh: e.scrollHeight, ch: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth, ov: getComputedStyle(e).overflow + '/' + getComputedStyle(e).overflowY }; };
    const over = [];
    document.querySelectorAll('#view *').forEach(e => { if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) over.push((e.id || e.className || e.tagName) + ' sw' + e.scrollWidth + '>cw' + e.clientWidth); });
    const view = document.getElementById('view');
    const card = document.getElementById('v4world');
    const det = document.querySelector('#v4world .rdetail');
    const cv = card.getBoundingClientRect(), dv = det ? det.getBoundingClientRect() : null;
    return JSON.stringify({ sel: ${JSON.stringify(sel)}, view: R('#view'), card: R('#v4world'), grid: R('#v4world .rgridwrap'), detail: R('#v4world .rdetail'),
      detailClippedByCard: dv ? Math.round(dv.bottom - cv.bottom) : null,
      viewScrollable: view.scrollHeight - view.clientHeight, hOverflow: over.slice(0, 6) }, null, 1);
  })()`)
  console.log('=== viewport ' + w + 'x' + h + ' ===')
  console.log(info)
  await ev(`document.getElementById('view').scrollTop = document.getElementById('view').scrollHeight; 1`); await sleep(400)
  await shot('docs/_m21_shots/diag_' + w + '.png')
}
process.exit(0)
