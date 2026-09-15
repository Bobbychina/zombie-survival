// M29 线上抽查（只读，不改存档）：worker 模式 + 主档密文 + 账号库密钥 + 导出入口已下线
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 150))
}
const send = (method, params = {}, ms = 30000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url }); await sleep(5000)

const live = JSON.parse(await ev(`(async () => {
  const v = window.V4Vault
  const raw = localStorage.getItem('zombie_survival_save_v2') || ''
  const key = await v.getKeyRaw({ tag: 'account-save-v1' })
  return JSON.stringify({
    mode: v ? v.status().mode : 'none', ready: v ? v.status().ready : false,
    saveHead: raw.slice(0, 5), 明文可见: /"day"/.test(raw),
    keyLen: key ? key.length : 0, av: !!window.V4AccountVault,
    exportSave: typeof window.exportSave, accExport: typeof window.V4Account?.exportFile,
    day: (window.S || {}).day, url: location.origin + location.pathname,
  })
})()`))
ok('线上是 worker 模式（密钥在 worker 里）', live.mode === 'worker' && live.ready === true, JSON.stringify({ mode: live.mode, url: live.url }))
ok('线上主档是 ZSV1: 密文且搜不到明文（新档还没写过盘就跳过这一条）',
  live.saveHead === '' || (live.saveHead === 'ZSV1:' && live.明文可见 === false),
  JSON.stringify({ head: live.saveHead, day: live.day }))
ok('线上账号库拿到 worker 的密钥', live.av === true && live.keyLen >= 20, 'keyLen=' + live.keyLen)
ok('线上没有导出入口（exportSave / V4Account.exportFile 都不存在）', live.exportSave === 'undefined' && live.accExport === 'undefined', JSON.stringify({ exportSave: live.exportSave, accExport: live.accExport }))
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))
await ev(`(() => { const a=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(a) a.click(); return 1 })()`)
await sleep(800); await shot('70_live_m29')
const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
