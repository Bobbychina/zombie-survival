const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description||'').split('\n')[0].slice(0,140)) }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 40000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' }); await sleep(3200)
console.log(await ev(`(() => {
  const S = DEV.state()
  S.apMax = 14; S.debt = 0; S.skills.fitness = 0
  const out = []
  for (let ap = 14; ap >= 0; ap--) {
    S.ap = ap
    const p = phaseName()
    renderTop()
    const t = document.getElementById('daytint')
    out.push('AP ' + String(ap).padStart(2) + ' → ' + p[0] + '（' + p[1] + '）tint=' + t.className.replace(' no-t','') + ' ' + getComputedStyle(t).backgroundColor)
  }
  S.ap = 14; renderTop()
  return out.join('\\n')
})()`))
console.log('\n19 点制（体能满）：' + await ev(`(() => {
  const S = DEV.state(); S.skills.fitness = 15; S.apMax = V4Night.apCapOf(0, 15); S.ap = S.apMax
  const marks = []
  for (let used = 0; used <= S.apMax; used++) { const p = phaseOf(used, S.apMax); if (!marks.length || marks[marks.length-1].p !== p) marks.push({ used, p }) }
  return 'apMax=' + S.apMax + ' 分段=' + marks.map(x => x.p + '@' + x.used).join(' ')
})()`))
console.log('errors: ' + (errs.length ? errs.slice(0,2).join(' | ') : 'none'))
ws.close()
