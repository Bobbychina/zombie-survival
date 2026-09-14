// 临时诊断：注入菜园后渲染异常是什么。跑完即删。
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(2800)
await ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1; })()`)
await sleep(600)
console.log('0) 干净状态 renderErr =', await ev(`String(window.__renderErr || 'none')`))
console.log('1) 只开菜园:', await ev(`(() => { const S = DEV.state(); S.base.garden = 1; render(); return String(window.__renderErr || 'none'); })()`))
console.log('2) 开菜园 + 只塞 carrot_seed:', await ev(`(() => { const S = DEV.state(); S.inv.carrot_seed = 3; render(); return String(window.__renderErr || 'none'); })()`))
console.log('3) 四种种子的真实 id:', await ev(`JSON.stringify(Object.keys(window.CROPS || {}))`))
console.log('4) 再试 tomato_seed/potato_seed/cabbage_seed:', await ev(`(() => { const S = DEV.state(); ['tomato_seed','potato_seed','cabbage_seed'].forEach(k => S.inv[k] = 3); render(); return String(window.__renderErr || 'none'); })()`))
console.log('5) 菜园卡 HTML:', await ev(`(() => { const c = document.querySelector('#v4cards .v4card[data-card=farm]'); return c ? c.outerHTML.replace(/\\s+/g,' ').slice(0, 400) : 'missing'; })()`))
process.exit(0)
