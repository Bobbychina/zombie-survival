// M16 验收：本地地图 / 大区地图合并 + 按钮切换（用户要求：在一起、按钮切、不占空间）
// 检查：默认只显示一张图、点按钮切换、两种视图互斥、切到大区后页面更矮（不占空间）、
//       切换会被记住（刷新后还在那个视图）、大区视图里跨区流程仍然可用。
// 用法：node docs/_m16_map_toggle_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 120))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(4200)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await ev(`localStorage.removeItem('zombie_survival_save_v2'); localStorage.removeItem('dsh.mapmode'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url })
await sleep(4200)
await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(1000)

const probeState = `(() => {
  const card = document.querySelector('#v4world') || document.body;
  const cells = document.querySelectorAll('#v4world .wcell').length;
  const rcells = document.querySelectorAll('#v4world .rcell2').length;
  const tabs = [...document.querySelectorAll('#v4world .wmtab')].map(b => ({ t: b.textContent.trim(), on: b.className.includes('on') }));
  const text = (card.textContent || '');
  return JSON.stringify({
    cells, rcells, tabs,
    cardH: Math.round((card.getBoundingClientRect ? card.getBoundingClientRect().height : 0)),
    viewH: Math.round((document.getElementById('view')||{scrollHeight:0}).scrollHeight),
    title: text.slice(0, 14),
    hasCrossHint: /跨区/.test(text), hasVehHint: /没有载具|车已就绪|油\\/行动力不够/.test(text),
    hasLocalHint: /本地地图/.test(text),
  });
})()`

// 1) 默认：本地地图，且大区格子不在 DOM 里
const def = await ev(probeState)
console.log('  默认: ' + def)
const D = JSON.parse(def)
ok('顶部有两个切换按钮（本地 24×24 / 大区 12×12）', D.tabs.length === 2 && /本地/.test(D.tabs[0].t) && /大区/.test(D.tabs[1].t), JSON.stringify(D.tabs))
ok('默认显示本地地图：576 格在、大区格子不在（两张图不再同时铺开）',
  D.cells === 576 && D.rcells === 0 && D.tabs[0].on && !D.tabs[1].on, JSON.stringify({ cells: D.cells, rcells: D.rcells }))
const localH = D.cardH
await shot('m16-local')

// 2) 点「大区地图」→ 互斥切换
const toRegion = await ev(`(() => {
  const b = [...document.querySelectorAll('#v4world .wmtab')].find(x => /大区/.test(x.textContent||''));
  b.click();
  return 1;
})()`)
void toRegion
await sleep(700)
const reg = await ev(probeState)
console.log('  大区: ' + reg)
const R = JSON.parse(reg)
ok('点按钮切到大区视图：144 格在、本地 576 格已移除',
  R.rcells === 144 && R.cells === 0 && R.tabs[1].on && !R.tabs[0].on, JSON.stringify({ cells: R.cells, rcells: R.rcells }))
ok('大区视图不比本地视图高（不占空间：没人看的那张图完全不占版面）',
  R.cardH > 0 && localH > 0 && R.cardH <= localH * 1.02, `local=${localH}px region=${R.cardH}px`)
ok('大区视图里仍然写着"跨区要开车"的说明 + 指路到本地地图',
  R.hasCrossHint && R.hasVehHint && R.hasLocalHint, JSON.stringify({ cross: R.hasCrossHint, veh: R.hasVehHint, local: R.hasLocalHint }))
await shot('m16-region')

// 3) 视图会被记住（刷新后还在大区）
await send('Page.navigate', { url })
await sleep(4200)
await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(900)
const persisted = await ev(probeState)
console.log('  刷新后: ' + persisted)
const P = JSON.parse(persisted)
ok('刷新后仍停在"大区地图"（视图选择被记住）', P.rcells === 144 && P.tabs[1].on, JSON.stringify({ rcells: P.rcells, on: P.tabs.map(t => t.on) }))

// 4) 大区视图里跨区流程仍可用：没车 → 拦住；给车 → 能跨（M17：区域 id 由种子生成，不能再写死）
const meta = JSON.parse(await ev(`JSON.stringify(V4World.meta())`))
const hop = JSON.parse(await ev(`JSON.stringify((() => {
  const ms = V4World.meta().regions.filter(r => r.id !== V4World.meta().home).sort((a, b) => a.dist - b.dist);
  for (const r of ms) { const t = V4World.trip(r.id); if (t.ok || /没有载具|靠两条腿/.test(t.why || '')) return { id: r.id, name: r.name }; }
  return null;
})())`))
ok('大区地图上能找到相邻目标（跨区流程有对象可测）', !!hop, hop ? hop.name : 'none')
const travel = await ev(`(() => {
  const before = V4World.snapshot();
  V4World.travelRegion('${hop.id}');                 // 没车
  const blocked = V4World.snapshot().region;
  const S = DEV.state();
  S.world.veh = { fuel: 12, hp: 100 }; S.ap = 9;      // 模拟"修好了车、油也加满"
  return JSON.stringify({ before: before.region, blocked });
})()`)
await sleep(700)
console.log('  没车: ' + travel)
const T = JSON.parse(travel)
ok('大区视图里没车时跨区被拦住（还在原区域）', T.blocked === T.before, JSON.stringify(T))

const crossed = await ev(`(() => {
  const s0 = V4World.snapshot();
  V4World.travelRegion('${hop.id}');
  const s1 = V4World.snapshot();
  return JSON.stringify({ from: s0.region, to: s1.region, seen: s1.seenRegions });
})()`)
await sleep(800)
console.log('  有车: ' + crossed)
const C = JSON.parse(crossed)
ok('大区视图里给车后能真的跨区', C.from !== C.to && C.to === hop.id, JSON.stringify(C))
ok('跨区之后仍能切回本地地图并正常渲染 576 格', await (async () => {
  await ev(`(() => { const b = [...document.querySelectorAll('#v4world .wmtab')].find(x => /本地/.test(x.textContent||'')); if (b && !b.className.includes('on')) b.click(); return 1; })()`)
  await sleep(600)
  const s = JSON.parse(await ev(probeState))
  return s.cells === 576 && s.rcells === 0
})(), '切回本地视图后 576 格在')

const pageErrs = errs.filter(e => !/favicon/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m16_probe.json`, JSON.stringify({ checks, errs: pageErrs, local: D, region: R, persisted: P, travel: T, crossed: C, hop, metaRegions: meta.regions.length }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
