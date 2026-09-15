const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3000)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1500)
/* 把每次 apply 的调用记下来，看 fitMap 到底算了什么 */
console.log(await ev(`(() => {
  const grid = document.querySelector('#v4world .wgrid'), wrap = document.querySelector('#v4world .wmapwrap')
  const out = []
  out.push('wrap.clientH=' + wrap.clientHeight + ' wrap.scrollH=' + wrap.scrollHeight)
  out.push('inline tpl=' + (grid.style.gridTemplateColumns || '(none)') + ' autoRows=' + (grid.style.gridAutoRows || '(none)') + ' alignItems=' + (grid.style.alignItems||'(none)'))
  out.push('computed tpl=' + getComputedStyle(grid).gridTemplateColumns.split(' ')[0] + ' rows=' + getComputedStyle(grid).gridTemplateRows.split(' ')[0])
  const cs = getComputedStyle(grid)
  out.push('colGap=' + cs.columnGap + ' rowGap=' + cs.rowGap + ' justify=' + cs.justifyContent + ' align=' + cs.alignItems)
  /* 手算：24 列 c 像素 + 23 个 2px 间隙 = 需要多宽；24 行同理需要多高 */
  const c = grid.querySelector('.wcell').getBoundingClientRect().height
  out.push('实测 cell=' + Math.round(c) + '  24 行所需高度=' + Math.round(24*c + 23*2))
  out.push('byBox 应该是=' + Math.floor((wrap.clientHeight - 16 - 46) / 24))
  return out.join('\\n')
})()`))
ws.close()
