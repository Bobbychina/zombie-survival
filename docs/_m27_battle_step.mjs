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
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3500)
console.log(await ev(`(async () => {
  DEV.battle(['walker','runner'])           // 开一场战斗（宝可梦式界面）
  await new Promise(r => setTimeout(r, 900))
  V4Tutorial.start(true)
  for (let i = 0; i < 12; i++) V4Tutorial.next()      // 快进到"战斗中"那一步（索引 11）
  await new Promise(r => setTimeout(r, 900))
  const r = document.getElementById('v4tut')
  const sp = r ? r.querySelector('.v4tut-spot') : null
  const bub = r ? r.querySelector('.v4tut-bub') : null
  const ov = document.getElementById('v4b-overlay')
  const orb = ov ? ov.getBoundingClientRect() : null
  const spr = sp ? sp.getBoundingClientRect() : null
  return JSON.stringify({ step: V4Tutorial.step(), 战斗界面: !!ov, 有圈: !!sp,
    圈住战斗界面: (spr && orb) ? (spr.left <= orb.left + 2 && spr.right >= orb.right - 2) : false,
    标题: bub ? bub.querySelector('.v4tut-hd b').textContent.slice(0, 16) : '-' })
})()`))
ws.close()
