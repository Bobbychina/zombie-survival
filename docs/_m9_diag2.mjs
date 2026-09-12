// 诊断：push 到底有没有上云（看额度计数 + 服务端原始响应）
const [, , cdpPort, pageUrl] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(400)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.DSH_AUTH_CONFIG = { api: 'http://127.0.0.1:5199' };` })
await send('Page.navigate', { url: pageUrl })
for (let i = 0; i < 40; i++) { if (await ev('!!window.DSHAccount')) break; await sleep(500) }
await sleep(1000)

const NAME = 'p' + Date.now().toString(36)
console.log('register: ' + await ev(`DSHAccount.register({ name: ${JSON.stringify(NAME)}, password: 'first-pass-123' }).then(r => JSON.stringify({ok:r.ok, server:r.server, err:r.err}))`))
console.log('session:   ' + await ev(`JSON.stringify({ hasToken: !!(JSON.parse(sessionStorage.getItem('dsh.session.v1')||'{}').token), uid: JSON.parse(sessionStorage.getItem('dsh.session.v1')||'{}').uid })`))
console.log('crypto:    ' + await ev('JSON.stringify(DSHAccount.cryptoInfo())'))
console.log('push():    ' + await ev(`(async () => { V4Account.push(); await new Promise(r => setTimeout(r, 3500)); return 'done' })()`))
console.log('manifest:  ' + await ev(`JSON.stringify(DSHAccount.slots('zombie-survival'))`))
console.log('pushAll:   ' + await ev(`DSHAccount.pushAll('zombie-survival').then(r => JSON.stringify(r))`))
console.log('quota:     ' + await ev(`DSHAccount.quota().then(q => JSON.stringify(q))`))
console.log('server GET /api/saves: ' + await ev(`(async () => {
  const t = JSON.parse(sessionStorage.getItem('dsh.session.v1')||'{}').token;
  const r = await fetch('http://127.0.0.1:5199/api/saves?game=zombie-survival', { headers: { authorization: 'Bearer ' + t } });
  return r.status + ' ' + (await r.text()).slice(0, 200);
})()`))
console.log('server GET /api/save?slot=main: ' + await ev(`(async () => {
  const t = JSON.parse(sessionStorage.getItem('dsh.session.v1')||'{}').token;
  const r = await fetch('http://127.0.0.1:5199/api/save?game=zombie-survival&slot=main', { headers: { authorization: 'Bearer ' + t } });
  const txt = await r.text();
  return r.status + ' len=' + txt.length + ' ' + txt.slice(0, 160);
})()`))
console.log('saveInfo:  ' + await ev(`JSON.stringify(DSHAccount.saveInfo('zombie-survival','main'))`))
ws.close()
