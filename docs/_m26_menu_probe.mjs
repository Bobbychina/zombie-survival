// M26.1 取证：① 探索页地图上方不再有工具条 ② ☰ 菜单里有「世界与账号」分区且两个按钮在
//   ③ 菜单里点「世界 · 分享」真的会打开世界面板
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 140))
}
const send = (method, params = {}, ms = 20000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(3500)
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
await sleep(1000)

const explore = JSON.parse(await ev(`(() => {
  const view = document.getElementById('view')
  const wr = document.getElementById('v4world').getBoundingClientRect()
  const tools = document.getElementById('v4tools')
  const txt = view.innerText || ''
  return JSON.stringify({ tools: !!tools, worldTop: Math.round(wr.top), viewTop: Math.round(view.getBoundingClientRect().top),
    hasWorldBtnOnPage: /世界 · 分享/.test(txt), hasAccountBtnOnPage: /注册 \\/ 登录|👤 /.test(txt.slice(0, 400)) })
})()`))
ok('探索页没有 #v4tools 工具条了', explore.tools === false, JSON.stringify(explore))
ok('地图卡贴着 #view 顶部（上面没有别的行）', explore.worldTop - explore.viewTop <= 24, 'worldTop=' + explore.worldTop + ' viewTop=' + explore.viewTop)
ok('探索页正文里不再出现「世界 · 分享」按钮', explore.hasWorldBtnOnPage === false)
await shot('30_explore_no_tools')

await ev(`openMenu()`)
await sleep(700)
const menu = JSON.parse(await ev(`(() => {
  const ov = document.querySelector('.modal')
  if (!ov) return JSON.stringify({ open: false })
  const t = ov.innerText || ''
  const btns = [...ov.querySelectorAll('button')].map(b => (b.textContent || '').trim())
  return JSON.stringify({ open: true, hasSection: /世界与账号/.test(t),
    world: btns.find(b => /世界 · 分享/.test(b)) || null, acct: btns.find(b => /注册 \\/ 登录|👤/.test(b)) || null, btns })
})()`))
ok('☰ 菜单打开', menu.open === true)
ok('菜单里有「世界与账号」分区', menu.hasSection === true)
ok('菜单里有「🌍 世界 · 分享」按钮', !!menu.world, String(menu.world))
ok('菜单里有账号按钮', !!menu.acct, String(menu.acct))
ok('菜单里仍然有 设置 分区（音频/节奏）', (menu.btns || []).some(b => /战斗节奏/.test(b)) && (menu.btns || []).some(b => /配乐/.test(b)))
await shot('31_menu_world_account')

const opened = await ev(`(() => {
  const ov = document.querySelector('.modal')
  const btn = [...ov.querySelectorAll('button')].find(b => /世界 · 分享/.test(b.textContent || ''))
  if (!btn) return 'NOBTN'
  btn.click()
  return 'clicked'
})()`)
await sleep(900)
const after = JSON.parse(await ev(`(() => {
  const t = document.body.innerText || ''
  return JSON.stringify({ worlds: /世界|挑战码|幽灵/.test(t), menuGone: !document.querySelector('.modal') || !/☰ 菜单/.test(document.querySelector('.modal').innerText || '') })
})()`))
ok('菜单里的「世界 · 分享」能打开世界面板', opened === 'clicked' && after.worlds === true, JSON.stringify({ opened, after }))
await shot('32_worlds_panel_from_menu')
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
