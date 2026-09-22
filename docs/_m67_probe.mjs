// M67 取证：楼内要有**自己的行动日志**（用户：「在楼内需要有一个单独的行动日志，不然看不到搜到了啥」）
//   ① 平面图里就有日志框（#v4i-log），不是被压在全屏覆盖层下面的 legacy 日志
//   ② 进楼第一句进日志（推开侧门 / 几间锁着）
//   ③ 搜一间之后：日志里能看到"搜了哪间"和"拿到了什么"（📦 拿到 … 或 明确说这间是空的）
//   ④ 撬门/硬踹也进日志
//   ⑤ 关掉弹窗再进：楼内日志还在（按楼存，跨弹窗/跨战斗不丢）
//   ⑥ legacy 的世界日志照样记（楼内日志是"加一份"，不是"换一份"）
// 用法：node docs/_m67_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const BOOT = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready'
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const j = async (x) => JSON.parse(String(await ev(x)))
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const bootWait = async (tries = 30) => {
  for (let i = 0; i < tries; i++) {
    const r = await ev(`(() => (typeof S === 'object' && !!S && typeof closeAllModals === 'function' && !!document.getElementById('view')) ? 1 : 0)()`)
    if (r === 1) return true
    await sleep(800)
  }
  return false
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
/** 楼内日志的 DOM 文本（就是玩家能看见的那一份） */
const logText = () => ev(`(() => { const b = document.getElementById('v4i-log'); return b ? [...b.querySelectorAll('div')].map(d => d.textContent).join('\\n').replace(/\\s+/g, ' ') : 'NOLOG' })()`)
const dlog = async () => ((await j(`(() => JSON.stringify(V4Interior.debug()))()`)) || {}).log || []
const rooms = async () => ((await j(`(() => JSON.stringify(V4Interior.debug()))()`)) || {}).rooms || []
const clickRoom = (roomId) => ev(`(() => { const b = [...document.querySelectorAll('#v4i-overlay button')].find(x => (x.getAttribute('onclick')||'').indexOf("'${roomId}'") >= 0); if (!b) return 'NOBTN'; b.click(); return 'ok' })()`)
const clearBattle = async () => {
  const open = await ev(`(() => (V4.battle.isOpen() ? 1 : 0))()`)
  if (open === 1) { await ev(`(() => { V4.UI.close(); return 1 })()`); await sleep(300); await ev(`(() => { V4Interior.open(); return 1 })()`); await sleep(200); return true }
  return false
}

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); setTab('explore'); S.over = false; S.ap = 40; render(); return 1 })()`)

const spot = await j(`(() => {
  const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
  const w = ws.worldOf(s.seed, s.region);
  const hosts = ['pharmacy','market','police','mall','school','hardware','hospital'];
  const all = Object.values(w.blocks).filter(b => b && b.poi && hosts.indexOf(b.poi) >= 0);
  const pick = all.find(b => b.danger <= 1 && b.poi !== 'hospital') || all[0];
  return JSON.stringify(pick ? { x: pick.x, y: pick.y, poi: pick.poi } : null);
})()`)
if (!spot) { console.log('FAIL 找不到带内部平面图的建筑'); process.exit(1) }
console.log('  目标建筑: ' + JSON.stringify(spot))
await ev(`(() => { V4World.teleport(${spot.x}, ${spot.y}); V4Interior.open(); return 1 })()`)
await sleep(500)

/* ① 楼内日志框就在平面图里 */
const hasBox = await ev(`(() => { const b = document.getElementById('v4i-log'); return b ? 1 : 0 })()`)
const boxInOverlay = await ev(`(() => { const b = document.getElementById('v4i-log'); return b && !!b.closest('#v4i-overlay') ? 1 : 0 })()`)
ok('① 平面图里有独立的楼内日志框 #v4i-log（不是被覆盖层压住的 legacy 日志）', hasBox === 1 && boxInOverlay === 1)

/* ② 进楼第一句进日志 */
const t0 = String(await logText())
ok('② 进楼的第一句写进了楼内日志（推开侧门 / 几间房几间锁着）', /你推开/.test(t0) && /间房/.test(t0), t0.slice(0, 60))

/* ③ 搜一间：日志里要有"搜了哪间"和"拿到了什么" */
const openRoom = (await rooms()).find(r => r.status === 'open')
await ev(`(() => { if (S.hp < 60) S.hp = 90; return 1 })()`)
await clickRoom(openRoom.id)
await sleep(320)
await clearBattle()
const t1 = String(await logText())
const lootedSomething = /📦 拿到 /.test(t1)
const saidEmpty = /什么都没有/.test(t1)
ok('③ 搜完之后日志里能看到"搜了哪间"', t1.indexOf('搜') >= 0 && t1.indexOf(openRoom.name) >= 0, openRoom.name)
ok('③ 日志里写清了拿到了什么（📦 拿到 … 或明确说这间是空的）', lootedSomething || saidEmpty,
  (t1.match(/📦 拿到 [^]{0,40}/) || t1.match(/什么都没有[^]{0,20}/) || [''])[0])
if (outDir) await shot('m67-log')

/* ④ 撬门/硬踹也进日志 */
const locked = (await rooms()).find(r => r.status === 'locked')
if (locked) {
  await ev(`(() => { S.inv.crowbar = 0; S.ap = Math.max(S.ap, 10); V4Interior.open(); return 1 })()`)
  await sleep(250)
  await clickRoom(locked.id)                       // 没撬棍 → 硬踹
  await sleep(320)
  await clearBattle()
  const t2 = String(await logText())
  ok('④ 门的事也进日志（硬踹会写清掉了多少血）', /硬踹/.test(t2) && /-\d+ 生命/.test(t2), (t2.match(/🦶[^]{0,50}/) || [''])[0])
} else {
  ok('④ 门的事也进日志（这栋楼没有锁着的门，跳过）', true, '无锁门')
}

/* ⑤ 关掉弹窗再进：楼内日志还在（按楼存） */
const beforeLines = (await dlog()).length
await ev(`(() => { V4Interior.leave(); return 1 })()`)
await sleep(250)
await ev(`(() => { V4Interior.open(); return 1 })()`)
await sleep(250)
const afterLines = await dlog()
ok('⑤ 关掉弹窗再进来：楼内日志还留着（跨弹窗/跨战斗不丢）',
  afterLines.length >= beforeLines && beforeLines >= 3 && afterLines.some(l => /📦 拿到|什么都没有/.test(l)),
  'lines ' + beforeLines + '→' + afterLines.length)

/* ⑥ legacy 的世界日志照样记（楼内日志是"加一份"，不是"换一份"） */
const worldLog = await ev(`(() => (S.logBuf || []).filter(p => /你搜|📦/.test(String(p[1]))).length)()`)
ok('⑥ 世界日志（#log）里同样有记录 —— 楼内日志是加一份，不是换一份', Number(worldLog) >= 2, 'worldLog 命中 ' + worldLog + ' 条')

ok('⑦ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M67 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
