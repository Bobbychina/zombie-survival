// M30 P0 取证：① 湿度是天气的导出量（看天能预判）② 干燥/闷湿两条阈值后果链
//   ③ 舒适区不生病 ④ 淋湿/生火/腐坏/喝水四条副作用 ⑤ 大区资源丰度 + 危险度噪声（UI 真显示）
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' })
await sleep(4200)

/* 先把人挪到野外的一个 POI：庇护所里不会中暑（有屋顶就是不一样），探针必须在野外测 */
const moved = await ev(`(() => { const b = DEV.gotoPoi({}); return b ? (b.biome + '@' + b.x + ',' + b.y) : 'none' })()`)
/* 顶栏 HUD 由 legacy 的 renderHud 铺底（自动读档那条路首屏不画），探针先把它画出来再量 */
await ev(`(() => { try { if (typeof renderHud === 'function') renderHud(); if (typeof render === 'function') render(); } catch (e) {} return 1 })()`)
await sleep(600)

/* ── ① 湿度是天气的导出量；M50 起体温/湿度/病症的 chips 搬进「人体」页（顶栏不再有） ── */
const hud = JSON.parse(await ev(`(() => {
  window.V4Survival.refreshHum()
  if (typeof render === 'function') render()
  const env0 = document.querySelector('.v4-env')
  const chips = env0 ? [...env0.querySelectorAll('.chip')].map(c => c.textContent.replace(/\\s+/g, ' ').trim()) : []
  const s = window.V4Survival.status()
  return JSON.stringify({ chips, count: chips.length, inHud: !!(env0 && env0.closest('#hud')),
    visW: env0 ? Math.round(env0.getBoundingClientRect().width) : 0,
    hum: s.hum, weather: window.S.env.weather })
})()`))
ok('顶栏不再挂体温/湿度/病症 chips（M50：搬进人体页 / 用户要求）', hud.count === 0, JSON.stringify(hud.chips))
ok('湿度是天气的导出量（雨天闷湿 / 热浪干燥）', (() => {
  const w = hud.weather
  if (w === 'rain' || w === 'storm' || w === 'fog') return hud.hum > 70
  if (w === 'heat') return hud.hum < 25
  return hud.hum >= 0 && hud.hum <= 100
})(), 'weather=' + hud.weather + ' hum=' + hud.hum)
await shot('80_hud_humidity')

/* ── ② 干燥 + 高温 → 中暑 / 脱水；这些病现在写在人体页的病症表里 ── */
const dry = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.env.weather = 'heat'; S.env.temp = 85; S.thi = 12
  window.V4Survival.refreshHum()
  const before = window.V4Survival.status()
  const out = window.V4Survival.step(40)          // 40 步 ≈ 10 次病程结算
  window.V4Survival.refreshHum()
  if (typeof render === 'function') render()      // 重画一次让页面跟上状态
  return JSON.stringify({ before: before, after: window.V4Survival.status(), gained: out.gained, hp: out.hp,
    rows: window.V4Survival.condStatus() })
})()`))
ok('干燥 + 高温真的会得病（中暑/脱水）', dry.after.conds.length > 0,
  JSON.stringify({ conds: dry.after.conds, hum: dry.after.hum, loc: moved }))
ok('中暑/脱水在人体页的病症表里（带药名与需要份数）',
  dry.rows.some(r => /中暑|脱水/.test(r.name)) && dry.rows.every(r => r.item && r.need > 0),
  JSON.stringify(dry.rows))
ok('病的代价真的落下（掉血或惩罚）', dry.hp < 0 || dry.gained.length > 0, JSON.stringify({ hp: dry.hp, gained: dry.gained }))

/* ── ③ 环境回到舒适区 → 病程消退 ── */
const healed = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.env.weather = 'cloudy'; S.env.temp = 50; S.thi = 90; S.loc = 'base'
  window.V4Survival.refreshHum()
  window.V4Survival.step(40)
  window.V4Survival.refreshHum()
  return JSON.stringify(window.V4Survival.status())
})()`))
ok('回到舒适区后病症消退（不会赖着不走）', healed.conds.length === 0, JSON.stringify(healed))

/* ── ④ 闷湿 → 呼吸道/真菌；舒适区一个都不给 ── */
const muggy = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.env.weather = 'storm'; S.env.temp = 30; S.thi = 90; S.loc = 'field'
  window.V4Survival.refreshHum()
  const hum = window.V4Survival.humidityNow()
  const out = window.V4Survival.step(40)
  const got = window.V4Survival.status().conds
  S.env.temp = 75                       // 闷湿 + 热 → 真菌
  window.V4Survival.refreshHum(); window.V4Survival.step(40)
  const both = window.V4Survival.status().conds
  return JSON.stringify({ hum, got, both })
})()`))
ok('闷湿 + 偏凉 → 呼吸道感染', muggy.got.some(c => c === 'respiratory'), JSON.stringify({ hum: muggy.hum, got: muggy.got }))
ok('闷湿 + 偏热 → 真菌感染', muggy.both.some(c => c === 'fungal'), JSON.stringify(muggy.both))

/* ── ⑤ 四条副作用：淋湿 / 生火 / 腐坏 / 喝水收益 ── */
const side = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.loc = 'field'; S.env.weather = 'rain'; S.env.wet = 0; S.env.temp = 50
  window.V4Survival.refreshHum()
  const wet0 = window.V4Survival.wetNow()
  window.V4Survival.step(6)
  const wet1 = window.V4Survival.wetNow()
  const fire = window.V4Survival.fireOk()
  const rot = window.V4Survival.rotMul()
  S.env.weather = 'heat'; window.V4Survival.refreshHum()
  const dryDrink = window.V4Survival.drinkGain()
  const dryFire = window.V4Survival.fireOk()
  /* 回屋烘干：同一步数应该把淋湿降下去 */
  S.loc = 'base'; window.V4Survival.step(6)
  const wet2 = window.V4Survival.wetNow()
  return JSON.stringify({ wet0, wet1, wet2, fire, rot, dryDrink, dryFire })
})()`))
ok('雨天在外面会淋湿', side.wet1 > side.wet0, JSON.stringify({ before: side.wet0, after: side.wet1 }))
ok('回屋/火堆旁会把身上烘干', side.wet2 < side.wet1, JSON.stringify({ wet: side.wet1, dried: side.wet2 }))
ok('闷湿天生火难、干燥天恢复正常', side.fire < 1 && side.dryFire === 1, JSON.stringify({ rain: side.fire, dry: side.dryFire }))
ok('闷湿让生鲜坏得更快', side.rot > 1.2, 'rotMul=' + side.rot)
ok('干燥天喝水只补七成', side.dryDrink < 1, 'drinkGain=' + side.dryDrink)

/* ── ⑥ 湿度计（工作台新道具）：预报三天，且与真实翻日一致 ── */
const fc = JSON.parse(await ev(`(() => {
  const lines = window.V4Survival.forecastLines(3)
  return JSON.stringify({ lines, hasItem: !!ITEMS.hygro, hasRecipe: RECIPES.some(r => r.out === 'hygro') })
})()`))
ok('湿度计是工作台可做的道具', fc.hasItem === true && fc.hasRecipe === true, JSON.stringify(fc))
ok('读一次给未来三天的湿度预报', fc.lines.length === 3 && fc.lines.every(l => /湿度 \d+%/.test(l)), fc.lines.join(' | ').slice(0, 100))

/* ── ⑦ 大区：危险度是噪声 + 每格有资源丰度，UI 真的显示 ── */
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
await sleep(800)
await ev(`(() => { const m = document.getElementById('v4world'); return m ? 'has-v4world' : 'no-v4world' })()`)
const modeOk = await ev(`(() => { try { V4World.mapMode('region'); return 'ok' } catch (e) { return 'EXC ' + e.message } })()`)
await sleep(1800)
const region = JSON.parse(await ev(`(() => {
  const cell = document.querySelector('#v4world .rcell2')
  const all = [...document.querySelectorAll('#v4world .rcell2')].slice(0, 3).map(e => e.innerText.replace(/\\s+/g, ' ').slice(0, 40))
  const txt = cell ? cell.innerText.replace(/\\s+/g, ' ') : ''
  const title = cell ? (cell.getAttribute('title') || '') : ''
  return JSON.stringify({ count: document.querySelectorAll('#v4world .rcell2').length, txt, title: title.slice(0, 140),
    all, html: cell ? cell.innerHTML.slice(0, 300) : '' })
})()`))
ok('大区格子显示了资源丰度档位（贫瘠/一般/丰富/富矿）', /贫瘠|一般|丰富|富矿/.test(region.txt + region.title + region.html + region.all.join(' ')),
  JSON.stringify({ mode: modeOk, count: region.count, txt: region.txt.slice(0, 60), title: region.title.slice(0, 90) }))
await shot('81_region_abundance')

/* ── ⑧ 丰度真的影响产出（同一 RNG 下，富矿 ≥ 贫瘠，且贫瘠也有保底 1 份） ── */
const yld = JSON.parse(await ev(`(() => {
  const fn = window.V4Debug.salvageYields
  const mk = () => { let s = 12345; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }
  const total = (ab) => fn(mk(), 'ruins', 3, ab).items.reduce((a, i) => a + (i.id === 'MAT' ? i.n : 1), 0)
  const poor = [1,2,3,4,5,6,7,8].map(() => total(0.75))
  const rich = [1,2,3,4,5,6,7,8].map(() => total(1.35))
  const cur = window.V4Debug.regionById(window.S.world.region)
  return JSON.stringify({ poorAvg: poor.reduce((a,b)=>a+b,0)/poor.length, richAvg: rich.reduce((a,b)=>a+b,0)/rich.length,
    poorMin: Math.min(...poor), cur: cur ? { name: cur.name, ab: Math.round(cur.abundance*100)/100 } : null })
})()`))
ok('富矿产出明显高于贫瘠（丰度真的乘进去了）', yld.richAvg > yld.poorAvg * 1.3, JSON.stringify(yld))
ok('贫瘠区也有保底产出（不是白跑）', yld.poorMin >= 1, 'poorMin=' + yld.poorMin)
ok('当前大区带丰度数值（UI 有得显示）', !!yld.cur && yld.cur.ab > 0, JSON.stringify(yld.cur))

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
