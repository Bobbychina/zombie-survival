// 临时诊断：菜园卡片溢出。跑完即删。
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
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
for (const w of [2048, 1440, 1056]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1280, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
  await sleep(2800)
  await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1; })()`)
  await sleep(700)
  const r = await ev(`(() => {
    const card = document.querySelector('#v4cards .v4card[data-card="farm"]');
    if (!card) return JSON.stringify({ missing: true });
    const cr = card.getBoundingClientRect();
    const over = [];
    card.querySelectorAll('*').forEach(e => {
      if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 10) {
        const cs = getComputedStyle(e);
        over.push({ cls: (e.className || e.tagName).toString().slice(0, 20), sw: e.scrollWidth, cw: e.clientWidth,
          ws: cs.whiteSpace, ov: cs.overflow, txt: (e.textContent || '').slice(0, 28) });
      }
    });
    const rows = [...card.querySelectorAll('.row')].map(e => ({ w: Math.round(e.getBoundingClientRect().width), sw: e.scrollWidth, cw: e.clientWidth }));
    const hints = [...card.querySelectorAll('.hint')].map(e => ({ w: Math.round(e.getBoundingClientRect().width), sw: e.scrollWidth, cw: e.clientWidth, txt: (e.textContent || '').slice(0, 40) }));
    return JSON.stringify({ cardW: Math.round(cr.width), cardH: Math.round(cr.height), over, rows, hints,
      visible: cr.width > 0, clippedByCard: [...card.querySelectorAll('.hint,.row')].some(e => e.getBoundingClientRect().right > cr.right + 1) });
  })()`)
  console.log('=== ' + w + 'px ===\n' + r + '\n')
  if (w === 2048) {
    const box = JSON.parse(await ev(`(() => { const c = document.querySelector('#v4cards .v4card[data-card="farm"]'); const b = c.getBoundingClientRect(); return JSON.stringify({ x: Math.max(0, Math.floor(b.left) - 6), y: Math.max(0, Math.floor(b.top) - 6), width: Math.ceil(b.width) + 12, height: Math.ceil(b.height) + 12, scale: 1 }); })()`))
    await shot('farm_card_2048', box)
  }
}
process.exit(0)
