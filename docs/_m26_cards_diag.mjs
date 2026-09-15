const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 30 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 20000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
for (const [w, h] of [[1920, 1080], [1707, 960]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3200)
  await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(1000)
  console.log(`${w}x${h}  ` + await ev(`(() => {
    const cards = document.getElementById('v4cards')
    const cs = getComputedStyle(cards)
    /* 多列流的 scrollWidth 会把"列的排版盒子"也算进去，所以真正的判据是：
       ① 卡片各自的实际视觉列数（按 left 分组） ② 有没有元素真的越出 #v4cards 的可视右边 */
    const kid = [...cards.children].map(c => { const r = c.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) } })
    const cols = new Set(kid.map(k => k.l)).size
    const cr = cards.getBoundingClientRect()
    const outside = kid.filter(k => k.r > cr.right + 1).length
    return JSON.stringify({ columnCount: cs.columnCount, 实际列数: cols, 卡宽: kid[0] ? kid[0].w : null,
      卡右越界数: outside, cardsRight: Math.round(cr.right), 视口: innerWidth })
  })()`))
}
ws.close()
