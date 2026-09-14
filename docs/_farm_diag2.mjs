// 临时诊断 2：菜园卡片在多种宽度下是否溢出（含"建好菜园"的状态）。跑完即删。
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
await send('Runtime.enable'); await send('Page.enable')
const probe = async (tag) => {
  const r = await ev(`(() => {
    const card = document.querySelector('#v4cards .v4card[data-card="farm"]');
    if (!card) return JSON.stringify({ missing: true });
    const cr = card.getBoundingClientRect();
    const bad = [];
    card.querySelectorAll('*').forEach(e => {
      const b = e.getBoundingClientRect();
      if (b.right > cr.right + 1 || b.left < cr.left - 1) bad.push({ cls: (e.className || e.tagName).toString().slice(0, 18), right: Math.round(b.right), cardRight: Math.round(cr.right), txt: (e.textContent || '').slice(0, 24) });
      else if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 10) bad.push({ cls: (e.className || e.tagName).toString().slice(0, 18), sw: e.scrollWidth, cw: e.clientWidth, txt: (e.textContent || '').slice(0, 24) });
    });
    return JSON.stringify({ w: Math.round(cr.width), h: Math.round(cr.height), bad: bad.slice(0, 5) });
  })()`)
  console.log(tag + ' ' + r)
}
for (const w of [1200, 1440, 1600, 1800, 2048, 2400, 2560]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1280, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
  await sleep(2400)
  await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1; })()`)
  await sleep(600)
  await probe('空菜园 @' + w)
  // 建一个菜园（4 块地）+ 给点种子，让播种按钮出现
  await ev(`(() => { const S = DEV.state(); S.base.garden = 1; ['carrot','tomato','potato','cabbage'].forEach(s => { S.inv[s + '_seed'] = (S.inv[s + '_seed'] || 0) + 3; }); render(); return 1; })()`)
  await sleep(700)
  await probe('有菜园 @' + w)
}
process.exit(0)
