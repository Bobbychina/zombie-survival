// M66 取证：建筑内部（平面图）——"进楼"不再是点一下搜刮
//   ① 格子卡片上有入口（DOM 真的点了）；点开是一张 3~6 间的平面图
//   ② 平面图确定性（同一栋楼两次生成一致；退出重进不会"刷新"出没锁的布局）
//   ③ 每间房独立掉落 + 各花 1 行动力；**照旧记进任务账**（M35 的教训）
//   ④ 锁着的房间：有撬棍是「撬开」，没有是「硬踹」（掉血 + 一定招人）；永远打得开
//   ⑤ 进度按区块存档：关掉弹窗 / 刷新页面都能接着搜（一栋楼分两趟）
// 用法：node docs/_m66_probe.mjs <cdpPort> <url> <outDir>
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
const nav = async () => { await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900) }
const dbg = () => j(`(() => JSON.stringify(V4Interior.debug()))()`)
const dbgRooms = async () => (await dbg())?.rooms ?? []
const stat = (id) => ev(`(() => { const d = V4Interior.debug(); return d ? (d.rooms.find(r => r.id === '${id}') || {}).status : '' })()`)
/** 点平面图里某一间的按钮（DOM 真的点，不是直接调 API） */
const clickRoom = (roomId) => ev(`(() => { const b = [...document.querySelectorAll('#v4i-overlay button')].find(x => (x.getAttribute('onclick')||'').indexOf("'${roomId}'") >= 0); if (!b) return 'NOBTN'; b.click(); return 'ok' })()`)
const roomBtnText = (roomId) => ev(`(() => { const b = [...document.querySelectorAll('#v4i-overlay button')].find(x => (x.getAttribute('onclick')||'').indexOf("'${roomId}'") >= 0); return b ? b.textContent.replace(/\\s+/g,' ').trim() : 'NOBTN' })()`)
/** 埋伏会把平面图关掉并开战：探针要能把这一场收掉再回来接着搜 */
const clearBattle = async () => {
  const open = await ev(`(() => (V4.battle.isOpen() ? 1 : 0))()`)
  if (open === 1) { await ev(`(() => { V4.UI.close(); return 1 })()`); await sleep(300); await ev(`(() => { V4Interior.open(); return 1 })()`); await sleep(200); return true }
  return false
}

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
/* 探针前置状态（M46/M56 的规矩）：干净档 + 教程已看 + 地图摆法/地图模式清掉，避免老 origin 污染 */
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await nav()
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); setTab('explore'); S.over = false; S.ap = 40; render(); return 1 })()`)

/* 找一栋有内部平面图的楼（医院/药房/警局/超市/购物中心），瞬移过去 */
const spot = await j(`(() => {
  const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
  const w = ws.worldOf(s.seed, s.region);
  const hosts = ['hospital','pharmacy','police','market','mall','school','hardware'];
  const all = Object.values(w.blocks).filter(b => b && b.poi && hosts.indexOf(b.poi) >= 0);
  const pick = all.find(b => b.danger <= 1 && b.poi !== 'hospital') || all[0];
  return JSON.stringify(pick ? { x: pick.x, y: pick.y, poi: pick.poi, danger: pick.danger } : null);
})()`)
if (!spot) { console.log('FAIL 这一局找不到带内部平面图的建筑'); process.exit(1) }
console.log('  目标建筑: ' + JSON.stringify(spot))
await ev(`(() => { V4World.teleport(${spot.x}, ${spot.y}); return 1 })()`)
await sleep(500)
const host = await ev(`(() => String(V4Debug.interiorHost('${spot.poi}') || ''))()`)
ok('① 这类建筑在 INTERIOR_HOSTS 里（有"里面"）', !!host, spot.poi + ' → kit=' + host)
const entryBtn = await ev(`(() => { const b = [...document.querySelectorAll('[data-card="poi"] button')].find(x => (x.getAttribute('onclick')||'').indexOf('V4Interior.open') >= 0); return b ? b.textContent.replace(/\\s+/g,' ').trim() : 'NOBTN' })()`)
ok('① 格子卡片上有「进楼搜房」入口（DOM 文本）', String(entryBtn).indexOf('进楼搜房') >= 0, String(entryBtn))
if (outDir) await shot('m66-card')
const plan1 = await j(`(() => { const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
  const p = V4Debug.interiorPlan({ id: '${spot.poi}', name: 'x', icon: 'x', loot: V4.POIS['${spot.poi}'].loot }, s.seed + '|' + s.region + '|' + '${spot.x},${spot.y}');
  return JSON.stringify(p) })()`)
const plan2 = await j(`(() => { const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
  const p = V4Debug.interiorPlan({ id: '${spot.poi}', name: 'x', icon: 'x', loot: V4.POIS['${spot.poi}'].loot }, s.seed + '|' + s.region + '|' + '${spot.x},${spot.y}');
  return JSON.stringify(p) })()`)
ok('② 平面图是确定性的（两次生成逐字节一致）', JSON.stringify(plan1) === JSON.stringify(plan2), 'rooms=' + plan1.rooms.length)

/* 点入口进楼 */
await ev(`(() => { const b = [...document.querySelectorAll('[data-card="poi"] button')].find(x => (x.getAttribute('onclick')||'').indexOf('V4Interior.open') >= 0); b.click(); return 1 })()`)
await sleep(400)
const domRooms = Number(await ev(`document.querySelectorAll('#v4i-overlay .grid .card').length`))
const ovCount = Number(await ev(`document.querySelectorAll('#v4i-overlay').length`))
const rooms = await dbgRooms()
ok('① 点开后是一张平面图覆盖层，且只有一个', ovCount === 1 && domRooms >= 3, 'overlay=' + ovCount + ' 房间卡片=' + domRooms)
ok('① 房间数与逻辑一致、落在 3~6 之间', domRooms === rooms.length && rooms.length >= 3 && rooms.length <= 6, 'rooms=' + rooms.length)
ok('② 打开的这张图 = 确定性生成的那张', JSON.stringify(rooms.map(r => r.name)) === JSON.stringify(plan1.rooms.map(r => r.name)))
if (outDir) await shot('m66-interior')

/* ③ 搜一间没锁的房间：1 行动力、账记进任务系统、房间变已搜 */
const openRoom = rooms.find(r => r.status === 'open')
const ap0 = Number(await ev(`S.ap`))
const left0 = (await dbg()).left
const zoneCnt0 = Number(await ev(`(() => Number((S.stats.zoneCnt || {})['${spot.poi}'] || 0))()`))
await clickRoom(openRoom.id)
await sleep(300)
const ap1 = Number(await ev(`S.ap`))
const left1 = (await dbg()).left
const zoneCnt1 = Number(await ev(`(() => Number((S.stats.zoneCnt || {})['${spot.poi}'] || 0))()`))
ok('③ 搜一间 = 1 行动力、这地方的可搜次数 -1', ap1 === ap0 - 1 && left1 === left0 - 1, 'ap ' + ap0 + '→' + ap1 + ' · left ' + left0 + '→' + left1)
ok('③ 照样记进任务账（zoneCnt +1 —— M35 那条"搜了但任务不动"的坑）', zoneCnt1 === zoneCnt0 + 1, 'zoneCnt ' + zoneCnt0 + '→' + zoneCnt1)
ok('③ 搜过的房间变成"已搜空"', (await stat(openRoom.id)) === 'looted', openRoom.name)
const ap2 = Number(await ev(`S.ap`))
await clickRoom(openRoom.id)
await sleep(250)
ok('③ 同一间再点不会重复搜（不扣行动力）', Number(await ev(`S.ap`)) === ap2, 'ap=' + ap2)

/* ④ 锁着的房间：没撬棍 → 硬踹；有撬棍 → 撬开 */
const locked = rooms.find(r => r.lock === 'crowbar' && r.status === 'locked')
const sealed = rooms.find(r => r.lock === 'sealed' && r.status === 'locked')
const lockedRoom = locked || sealed
if (lockedRoom) {
  await ev(`(() => { S.inv.crowbar = 0; V4Interior.open(); return 1 })()`)
  await sleep(250)
  const txt0 = await roomBtnText(lockedRoom.id)
  ok('④ 锁着的房间（没撬棍）= 按钮是"硬踹"，文案直接说清代价', String(txt0).indexOf('硬踹') >= 0, String(txt0))
  await ev(`(() => { S.inv.crowbar = 1; V4Interior.open(); return 1 })()`)
  await sleep(250)
  const txt1 = await roomBtnText(lockedRoom.id)
  ok('④ 有撬棍 = 按钮变"撬开"', String(txt1).indexOf('撬开') >= 0, String(txt1))
  const ap3 = Number(await ev(`S.ap`))
  await clickRoom(lockedRoom.id)
  await sleep(300)
  await clearBattle()
  ok('④ 撬开后门是开的、行动力 -1', (await stat(lockedRoom.id)) === 'open' && Number(await ev(`S.ap`)) === ap3 - 1, lockedRoom.name)
}

/* ⑤ 把这一栋楼搜完 → 关掉再开、刷新页面都要能接着搜 */
let steps = 0
while (steps++ < 12) {
  const cur = await dbgRooms()
  const next = cur.find(r => r.status === 'open')
  if (!next) break
  await ev(`(() => { if (!document.getElementById('v4i-overlay')) V4Interior.open(); return 1 })()`)
  await clickRoom(next.id)
  await sleep(220)
  await clearBattle()
}
const done1 = (await dbg())?.summary || {}
ok('⑤ 一间间搜完 → 全部房间都标记为已搜', done1.done === done1.total && done1.total >= 3, JSON.stringify(done1))
await ev(`(() => { V4Interior.leave(); return 1 })()`)
await sleep(200)
await ev(`(() => { V4Interior.open(); return 1 })()`)
await sleep(250)
const done2 = (await dbg())?.summary || {}
ok('⑤ 关掉弹窗再进：进度留着（这就是"一栋楼分两趟搜"）', done2.done === done1.done && done2.total === done1.total, JSON.stringify(done2))
await ev(`(() => { saveGame(true); return 1 })()`)
await sleep(500)
await nav()
await ev(`(() => { closeAllModals(); setTab('explore'); V4World.teleport(${spot.x}, ${spot.y}); return 1 })()`)
await sleep(400)
await ev(`(() => { V4Interior.open(); return 1 })()`)
await sleep(300)
const done3 = (await dbg())?.summary || {}
ok('⑤ 存档往返（刷新页面）后进度还在 —— 真的落盘了', done3.done === done1.done && done3.total === done1.total, JSON.stringify(done3))
if (outDir) await shot('m66-after')

ok('⑥ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M66 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
