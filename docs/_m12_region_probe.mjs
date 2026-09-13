// M12 跨区域验收（真浏览器）：区域面板渲染 / 没车被拦 / 有车能跨 / 进度与坐标正确 / 旧档兼容
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 100))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 140))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(4500)

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

/* 干净起步：这个探针假定"新档、没车、在主城"。不清档的话，前一个探针留下的存档会让
   "没车被拦 / 有车能跨"这几条失真（实测：跑完 M15 再跑它会 6/13，因为从"北岭+有车"开始）。 */
await ev(`localStorage.removeItem('zombie_survival_save_v2'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url })
await sleep(4200)

// 打开探索页（区域面板在那一页）
await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(900)

/* M16：区域面板默认收在「大区地图」视图里（本地/大区合并成一个面板 + 按钮切换），
   所以这里的每一步都要先切到大区视图；下面统一用 openRegion()。 */
async function openRegion() {
  await ev(`(() => { const b = [...document.querySelectorAll('#v4world .wmtab')].find(x => /大区/.test(x.textContent||'')); if (b && !b.className.includes('on')) b.click(); })()`)
  await sleep(500)
}

await openRegion()
/* M17：大区地图从写死的 3×3 变成按种子生成的 12×12，区域 id 也是生成的——
   探针不能再写死 'dongjiao'/'ember'，一律用 V4World.meta() 里的真实区域。 */
const meta = JSON.parse(await ev(`JSON.stringify(V4World.meta())`))
const homeId = meta.home
const panel = await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4world .rcell2')];
  const t = document.body.innerText;
  return JSON.stringify({
    cells: cells.length,
    here: cells.filter(c => c.className.includes('here')).length,
    hasRegionTitle: /当前在/.test(t), hasHome: /余烬/.test(t), noCarHint: /没有载具/.test(t),
  });
})()`)
console.log('  区域面板: ' + panel)
const p = JSON.parse(panel)
ok('12×12 = 144 个区域格子都渲染出来了', p.cells === 144, 'cells=' + p.cells)
ok('当前区域标为 here（有且只有一个）', p.here === 1, JSON.stringify(p))
ok('面板显示当前区域名与"没车"提示', p.hasRegionTitle && p.hasHome && p.noCarHint, JSON.stringify(p))

// 没车时点相邻区域 → 应该被拦（详情给出理由），区域不变
await ev(`(() => {
  V4World.travelRegion('${meta.regions.find(r => r.dist === 1).id}');   // 玩家点「出发」走的就是它
  return 1;
})()`)
await sleep(800)
const blocked = String(await ev(`(document.querySelector('#v4world .rdetail') || {}).textContent || ''`))
const regionAfter = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
console.log('  没车尝试跨区: ' + blocked)
ok('没车时跨区被拦住（仍在原区域）', regionAfter.region === homeId, 'region=' + regionAfter.region)
ok('被拦住时详情里给出原因（不是干瞪眼）', /靠两条腿|走不到|没有载具|⛔/.test(String(blocked)), String(blocked).replace(/\s+/g, ' ').slice(0, 90))

// 给车：全走真实玩法 —— ① 传到本区修车点 ② 搜一下触发存档 ③ 补足修车材料（12 材料 + 2 汽油）④ 点「修车」
/* M17 注意：找点必须用 DEV.gotoPoi（内部走 worldOf，带主题偏置）；
   直接调 V4.worldgen.generateWorld(seed::region) 拿到的是另一张图，传过去会站在空地上。 */
const grant = await ev(`(() => {
  const spot = DEV.gotoPoi({ feat: 'vehicle' });
  if (!spot) return JSON.stringify({ ok: false, why: '本区没有载具点' });
  V4World.search(0);                          // 搜一下：顺手让游戏把存档写下来
  return JSON.stringify({ ok: true, poi: spot.poi, at: [spot.x, spot.y], hasSave: !!localStorage.getItem('zombie_survival_save_v2') });
})()`)
console.log('  传送到载具点: ' + grant)
await sleep(500)

// 补材料（改存档 = 模拟玩家攒够了），再重载
const stocked = await ev(`(() => {
  const KEY = 'zombie_survival_save_v2';
  const raw = localStorage.getItem(KEY);
  if (!raw) return JSON.stringify({ ok: false, why: '没写出存档' });
  const S = JSON.parse(raw);
  S.mat = 99;
  S.inv = S.inv || {}; S.inv.fuel = (S.inv.fuel || 0) + 3;
  localStorage.setItem(KEY, JSON.stringify(S));
  return JSON.stringify({ ok: true });
})()`)
console.log('  补材料: ' + stocked)
await send('Page.navigate', { url })
await sleep(4500)
const fixed = await ev(`(async () => {
  V4World.fixCar();                            // 玩家在汽修厂点「🔧 修车」走的就是它
  await new Promise(r => setTimeout(r, 500));
  return JSON.stringify(V4World.snapshot());
})()`)
const f1 = JSON.parse(fixed)
console.log('  修车后快照: veh=' + JSON.stringify(f1.veh))
ok('在载具点花材料修出了车（有油有车况）', !!f1.veh && f1.veh.fuel > 0 && f1.veh.hp > 0, JSON.stringify(f1.veh))

await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(800)
await openRegion()
/* 有车后：挑一个 1 跳就到的邻区（M17 的元地图上"东郊"这种写死名字已经不存在） */
const hopTarget = JSON.parse(await ev(`JSON.stringify((() => {
  for (const r of V4World.meta().regions) {
    if (r.dist !== 1) continue;
    const t = V4World.trip(r.id);
    if (t.ok && t.hops === 1) return { id: r.id, name: r.name, trip: t };
  }
  return null;
})())`))
ok('有车后至少有一个"1 跳可达"的相邻区域', !!hopTarget, hopTarget ? hopTarget.name : 'none')

const beforeSnap = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
await ev(`(() => { V4World.pickRegion('${hopTarget.id}'); return 1; })()`)
await sleep(500)
const detail = String(await ev(`(document.querySelector('#v4world .rdetail') || {}).textContent || ''`))
ok('点格子只选中：详情给出 ⚡/⛽ 报价与「出发」按钮（不动身）',
  /⚡\d/.test(detail) && /⛽\d/.test(detail) && JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`)).region === beforeSnap.region,
  detail.replace(/\s+/g, ' ').slice(0, 90))
await ev(`(() => { V4World.travelRegion('${hopTarget.id}'); return 1; })()`)
await sleep(1500)
const afterSnap = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
console.log('  点格子跨区: ' + JSON.stringify({ region: afterSnap.region, veh: afterSnap.veh, ap: afterSnap.ap }))
ok('点「出发」真的跨到了目标区域', afterSnap.region === hopTarget.id, 'region=' + afterSnap.region + ' want=' + hopTarget.id)
ok('跨区扣油 ' + hopTarget.trip.fuel + ' 点、磨损车况 4%',
  !!afterSnap.veh && afterSnap.veh.fuel === beforeSnap.veh.fuel - hopTarget.trip.fuel && afterSnap.veh.hp === beforeSnap.veh.hp - 4,
  'fuel ' + beforeSnap.veh.fuel + '→' + afterSnap.veh.fuel + ' · hp ' + beforeSnap.veh.hp + '→' + afterSnap.veh.hp)
ok('跨区扣行动力 ' + hopTarget.trip.ap + ' 点', afterSnap.ap === beforeSnap.ap - hopTarget.trip.ap, 'ap ' + beforeSnap.ap + '→' + afterSnap.ap)
ok('已到过区域变成 2 个', afterSnap.seenRegions.length === 2, JSON.stringify(afterSnap.seenRegions))

const shot = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/m12-region-panel.png', Buffer.from(shot.result.data, 'base64'))

/* 跨回主城：主城在元地图正中央，1~2 跳。这里测的是"跨区链路通不通"，
   所以先把油/车况/行动力补满（不然会因为油不够而拦住，那是另一条被测过的分支）。 */
await ev(`(() => { const s = DEV.state(); if (s.world.veh) { s.world.veh.fuel = 12; s.world.veh.hp = 100; } s.ap = 9; return 1; })()`)
await ev(`(() => { V4World.travelRegion('${homeId}'); return 1; })()`)
await sleep(1500)
const backSnap = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
console.log('  跨回主城: ' + JSON.stringify(backSnap))
ok('能跨回主城', backSnap.region === homeId, 'region=' + backSnap.region)
ok('两个区域各留一份进度（冻结 1 份，当前区进度还在）', backSnap.frozenRegions.length === 1 && backSnap.visitedKeys > 0,
  'frozen=' + backSnap.frozenRegions.length + ' visited=' + backSnap.visitedKeys)
console.log('\nconsole 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : '无'))
ok('无 console 错误', errs.length === 0)
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
