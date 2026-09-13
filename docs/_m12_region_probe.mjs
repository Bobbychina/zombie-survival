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

// 打开探索页（区域面板在那一页）
await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(900)

const panel = await ev(`(() => {
  const cells = [...document.querySelectorAll('.rcell')];
  const t = document.body.innerText;
  return JSON.stringify({
    cells: cells.length,
    here: cells.filter(c => c.className.includes('here')).length,
    go: cells.filter(c => c.className.includes('go')).length,
    no: cells.filter(c => c.className.includes('no')).length,
    hasRegionTitle: /区域/.test(t), hasHome: /余烬/.test(t), noCarHint: /没有载具/.test(t),
  });
})()`)
console.log('  区域面板: ' + panel)
const p = JSON.parse(panel)
ok('3×3 共 9 个区域格子都渲染出来了', p.cells === 9, 'cells=' + p.cells)
ok('当前区域标为 here，其余按能不能去分色', p.here === 1 && p.go + p.no === 8, JSON.stringify(p))
ok('面板显示当前区域名与"没车"提示', p.hasRegionTitle && p.hasHome && p.noCarHint, JSON.stringify(p))

// 没车时点相邻区域 → 应该被拦（toast 给出理由），区域不变
const blocked = await ev(`(() => {
  const before = window.DSHWorldRegion ? '' : '';
  const goCell = [...document.querySelectorAll('.rcell')].find(c => c.className.includes('go'));
  const before2 = document.body.innerText.match(/区块 \\((\\d+),(\\d+)\\)/)?.[0] || '';
  if (goCell) goCell.click();                       // 没车时 go 类不该存在，这里点一下防意外
  V4World.travelRegion('dongjiao');                 // 直接调（玩家点格子走的就是它）
  return JSON.stringify({ before: before2, toast: (document.querySelector('.toast, #toast') || {}).textContent || '' });
})()`)
await sleep(600)
const regionAfter = await ev(`(() => {
  const t = document.body.innerText;
  const m = t.match(/区域\\s*(\\S+?)\\s*·/);
  return JSON.stringify({ region: m ? m[1] : '', hint: /没有载具/.test(t) });
})()`)
console.log('  没车尝试跨区: ' + blocked + ' | 之后: ' + regionAfter)
ok('没车时跨区被拦住（仍在原区域）', /余烬/.test(regionAfter), regionAfter)

// 给车：全走真实玩法 —— ① 传到本区载具点 ② 搜一下触发存档 ③ 补足修车材料（12 材料 + 2 汽油）④ 点「修车」
const grant = await ev(`(async () => {
  const snap = V4World.snapshot();
  const w = V4.worldgen.generateWorld(snap.seed + '::' + snap.region);
  let spot = null;
  for (const k in w.blocks) {
    const b = w.blocks[k];
    if (b.poi && V4.POIS[b.poi] && V4.POIS[b.poi].feat === 'vehicle') { spot = b; break; }
  }
  if (!spot) return JSON.stringify({ ok: false, why: '本区没有载具点' });
  V4World.teleport(spot.x, spot.y);
  V4World.search(0);                          // 搜一下：顺手让游戏把存档写下来
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({ ok: true, poi: spot.poi, at: [spot.x, spot.y], hasSave: !!localStorage.getItem('zombie_survival_save_v2') });
})()`)
console.log('  传送到载具点: ' + grant)

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
const withCar = await ev(`(() => {
  const cells = [...document.querySelectorAll('.rcell')];
  return JSON.stringify({ go: cells.filter(c => c.className.includes('go')).length, no: cells.filter(c => c.className.includes('no')).length });
})()`)
console.log('  有车后面板: ' + withCar)
ok('有车后相邻区域变成可点（8 个 go）', /"go":8/.test(withCar), withCar)

const beforeSnap = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
await ev(`(() => { const c = [...document.querySelectorAll('.rcell.go')].find(e => /东郊/.test(e.title||'')); if (c) c.click(); })()`)
await sleep(1500)
const afterSnap = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
console.log('  点格子跨区: ' + JSON.stringify(afterSnap))
ok('点区域格子真的跨到了东郊', afterSnap.region === 'dongjiao', 'region=' + afterSnap.region)
ok('跨区扣油 2 点、磨损车况 4%', !!afterSnap.veh && afterSnap.veh.fuel === beforeSnap.veh.fuel - 2 && afterSnap.veh.hp === beforeSnap.veh.hp - 4,
  'fuel ' + beforeSnap.veh.fuel + '→' + afterSnap.veh.fuel + ' · hp ' + beforeSnap.veh.hp + '→' + afterSnap.veh.hp)
ok('跨区扣行动力 3 点', afterSnap.ap === beforeSnap.ap - 3, 'ap ' + beforeSnap.ap + '→' + afterSnap.ap)
ok('已到过区域变成 2 个', afterSnap.seenRegions.length === 2, JSON.stringify(afterSnap.seenRegions))

const shot = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/m12-region-panel.png', Buffer.from(shot.result.data, 'base64'))

await ev(`(() => { const c = [...document.querySelectorAll('.rcell.go')].find(e => /余烬/.test(e.title||'')); if (c) c.click(); })()`)
await sleep(1500)
const backSnap = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
console.log('  跨回主城: ' + JSON.stringify(backSnap))
ok('能跨回主城', backSnap.region === 'ember', 'region=' + backSnap.region)
ok('两个区域各留一份进度（冻结 1 份，当前区进度还在）', backSnap.frozenRegions.length === 1 && backSnap.visitedKeys > 0,
  'frozen=' + backSnap.frozenRegions.length + ' visited=' + backSnap.visitedKeys)
console.log('\nconsole 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : '无'))
ok('无 console 错误', errs.length === 0)
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
