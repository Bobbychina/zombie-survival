// 诊断：账号模块到底导出了什么 + 注册为什么没弹恢复码
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
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 120000 })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.DSH_AUTH_CONFIG = { api: 'http://127.0.0.1:5199' };` })
await send('Page.navigate', { url: pageUrl })
for (let i = 0; i < 40; i++) { if (await ev('!!window.DSHAccount')) break; await sleep(500) }
await sleep(800)

console.log('DSHAccount 上的方法: ' + await ev('Object.keys(window.DSHAccount).sort().join(",")'))
console.log('V4Account 上的方法: ' + await ev('Object.keys(window.V4Account).sort().join(",")'))
console.log('cryptoInfo: ' + await ev('window.DSHAccount.cryptoInfo ? JSON.stringify(DSHAccount.cryptoInfo()) : "(没有)"'))
console.log('apiAvailable: ' + await ev('DSHAccount.apiAvailable ? DSHAccount.apiAvailable().then(String) : "n/a"'))
const NAME = 'diag' + Date.now().toString(36)
console.log('\n直接调 DSHAccount.register:')
console.log(await ev(`DSHAccount.register({ name: ${JSON.stringify(NAME)}, password: 'first-pass-123' }).then(r => JSON.stringify(r))`))
console.log('\n注册后 cryptoInfo: ' + await ev('JSON.stringify(DSHAccount.cryptoInfo())'))
console.log('当前用户: ' + await ev('JSON.stringify(DSHAccount.current() && DSHAccount.current().name)'))
console.log('恢复码弹窗节点: ' + await ev(`String(!!document.querySelector('#acc-rc-code'))`))
console.log('弹窗内容片段: ' + await ev(`String((document.querySelector('.modal') || document.body).textContent || '').slice(0, 120)`))
ws.close()
