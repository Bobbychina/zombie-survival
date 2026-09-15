const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 20000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
const u = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: u }); await sleep(4000)
const ok = await ev(`typeof DEV !== 'undefined'`)
console.log('DEV: ' + ok)
if (ok === true) {
  console.log(await ev(`(() => {
    const S = DEV.state(); S.apMax = 14; S.debt = 0; S.skills.fitness = 0
    const out = []
    for (let ap = 14; ap >= 0; ap--) { S.ap = ap; out.push(ap + ':' + phaseName()[0]) }
    S.ap = 14; renderTop()
    const t = document.getElementById('daytint')
    return out.join(' ') + ' || 19点制=' + (() => { const c = V4Night.apCapOf(0, 15); const m = []; for (let u2 = 0; u2 <= c; u2++) { const p = phaseOf(u2, c); if (!m.length || m[m.length-1].p !== p) m.push({ p, u: u2 }) } return 'apMax=' + c + ' ' + m.map(x => x.p + '@' + x.u).join(' ') })()
  })()`))
}
console.log('整页可滚: ' + await ev(`(() => { const de = document.scrollingElement; return de.scrollHeight > de.clientHeight + 1 })()`))
ws.close()
