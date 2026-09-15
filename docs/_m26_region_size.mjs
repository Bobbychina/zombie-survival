const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 30 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 20000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${n}.png`, Buffer.from(r.result.data, 'base64')) }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
for (const [w, h] of [[2048, 1105], [2560, 1440], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3200)
  await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`); await sleep(900)
  const local = await ev(`(() => { const g=document.querySelector('#v4world .wgrid'); const c=g?g.querySelector('.wcell').getBoundingClientRect():null; return c ? Math.round(c.width)+'x'+Math.round(c.height) : 'n/a' })()`)
  await ev(`V4World.mapMode('region')`); await sleep(1300)
  const region = await ev(`(() => {
    const g = document.querySelector('#v4world .rgrid'), wrap = document.querySelector('#v4world .wmapwrap')
    const card = document.getElementById('v4world')
    if (!g) return 'no rgrid'
    const c = g.querySelector('.rcell2').getBoundingClientRect()
    const cr = card.getBoundingClientRect(), wr = wrap ? wrap.getBoundingClientRect() : null
    const de = document.scrollingElement
    return JSON.stringify({ cell: Math.round(c.width) + 'x' + Math.round(c.height), cardW: Math.round(cr.width),
      wrapH: wr ? Math.round(wr.height) : null, wrapScroll: wrap ? wrap.scrollHeight - wrap.clientHeight : null,
      整页可滚: de.scrollHeight > de.clientHeight + 1, tiny: g.classList.contains('tiny') })
  })()`)
  console.log(`${w}x${h}  本地 cell=${local}  大区 ${region}`)
  /* M26.2：用户说「大区地图为什么这么小，放大到跟小区地图一样」—— 把这条变成断言：
     同一屏里大区格子**不小于**本地格子（12×12 本来就更该看得清），且大区图不滚。 */
  const lw = Number(String(local).split('x')[0]);
  const rw = Number((String(region).match(/"cell":"(\d+)x/) || [])[1]);
  if (lw > 0 && rw > 0) {
    const ratio = rw / lw;
    /* 只在**并排布局**（宽 ≥2000 且 高 ≥950）里要求"大区不小于本地"：
       叠成一列的档位里地图卡与卡片墙上下排，可视高度本来就不够，缩格子是唯一出路。 */
    const dual = w >= 2000 && h >= 950;
    console.log(`     → 大区/本地格子比 = ${ratio.toFixed(2)}  ${!dual ? '（叠式布局，不作要求）' : ratio >= 1 ? 'PASS 大区不小于本地' : 'FAIL 大区比本地还小'}`);
  }
  if (w === 2048) await shot('33_region_big_2048')
  await ev(`V4World.mapMode('local')`); await sleep(500)
}
ws.close()
