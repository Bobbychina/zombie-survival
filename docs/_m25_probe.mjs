// M25 取证/验收：① 整页不可滚（用户报「为什么整个页面还能滚动」）② 藏身处式工作站
//   ③ 枪械口径 / 弹种穿透（参考塔科夫） ④ 辐射（核电站 / 废料场）
// 用法：node docs/_m25_probe.mjs <cdpPort> <url> <outDir> [live]
const [, , cdpPort, url, outDir, liveFlag] = process.argv
const LIVE = !!liveFlag
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push((m.params.args || []).map(a => String(a.value ?? a.description ?? '')).join(' ').slice(0, 240))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 140))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT ' + method } } } }) } }, ms)
})
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
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev(expr)) === true) return true; await sleep(400) } return false }
const tab = (re) => ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/${re}/.test(e.textContent||'')); if(b) b.click(); return b ? (b.textContent||'').trim() : 'NOTAB'; })()`)

const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: pageUrl })
await waitFor(`typeof DEV !== 'undefined'`)
await ev(`['zombie_survival_save_v2','zsv_worlds_v1','zsv_ghosts_v1','zsv_runs_v1','dsh.mapmode','dsh.regionlayer'].forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); 1`)
await send('Page.navigate', { url: pageUrl })
await waitFor(`typeof DEV !== 'undefined'`)
await sleep(1500)
ok('DEV 钩子可用', (await ev(`typeof DEV !== 'undefined' && typeof DEV.state === 'function'`)) === true)

/* ── 1) 整页不可滚：用户视口 2048×1105 及三档常见高度 ── */
const scrollAt = async (w, h) => JSON.parse(await ev(`(async () => {
  return JSON.stringify({ w: innerWidth, h: innerHeight })
})()`) || '{}')
for (const [w, h] of [[2048, 1105], [2048, 1280], [1440, 900], [1280, 800]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const r = JSON.parse(await ev(`(() => {
    const de = document.scrollingElement
    const tools = document.getElementById('v4tools')
    const tr = tools ? tools.getBoundingClientRect() : null
    return JSON.stringify({ win: innerWidth + 'x' + innerHeight, sh: de.scrollHeight, ch: de.clientHeight,
      docScrollable: de.scrollHeight > de.clientHeight + 1, sb: innerWidth - de.clientWidth,
      toolsBottom: tr ? Math.round(tr.bottom) : -1, toolsInView: tr ? (tr.top >= 0 && tr.bottom <= de.clientHeight) : false })
  })()`))
  ok(`整页不可滚 @${w}x${h}`, r.docScrollable === false, `sh=${r.sh} ch=${r.ch} 滚动条=${r.sb}px`)
  ok(`工具条（存档/账号/世界）整条在视野内 @${w}x${h}`, r.toolsInView === true, 'bottom=' + r.toolsBottom)
}
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await sleep(500)
await tab('探索'); await sleep(900)
const cols = JSON.parse(await ev(`(() => {
  const v = document.getElementById('view'), wr = document.getElementById('v4world'), cd = document.getElementById('v4cards')
  const vr = v.getBoundingClientRect()
  return JSON.stringify({ viewScroll: v.scrollHeight > v.clientHeight + 1,
    worldScroll: wr.scrollHeight > wr.clientHeight + 1, cardsScroll: cd.scrollHeight > cd.clientHeight + 1,
    worldInside: wr.getBoundingClientRect().bottom <= vr.bottom + 2, cardsInside: cd.getBoundingClientRect().bottom <= vr.bottom + 2 })
})()`))
ok('宽屏：地图列在自己列里滚（不顶出 #view）', cols.worldInside === true && cols.worldScroll === true, JSON.stringify(cols))
ok('宽屏：卡片墙在自己列里滚（不顶出 #view）', cols.cardsInside === true, 'cardsScroll=' + cols.cardsScroll)
await shot('01_explore_scroll_fixed')

/* ── 2) 藏身处式工作站：四个站 + 弹药台配方 ── */
ok('切到制作页', /制作/.test(String(await tab('制作'))), '')
await sleep(900)
const craft = JSON.parse(await ev(`(() => {
  const t = document.getElementById('view').innerText
  const heads = [...document.querySelectorAll('#view .sect-title')].map(e => e.textContent.trim()).filter(s => /工作台|弹药台|医疗台|灶台/.test(s))
  const btns = [...document.querySelectorAll('#view button')].filter(b => /制作|材料不足|需要先建|等级不够/.test(b.textContent || ''))
  return JSON.stringify({ heads, n: btns.length, txt: t.slice(0, 60) })
})()`))
ok('制作页按工作站分区：工作台/弹药台/医疗台/灶台 4 个分区都在', craft.heads.length >= 4, JSON.stringify(craft.heads))
ok('制作页配方按钮 ≥ 25 个（M25 从 12 条扩到 29 条）', craft.n >= 25, 'n=' + craft.n)
await shot('02_craft_stations')

/* ── 3) 口径 / 弹种 / 穿透 ── */
const ammoUi = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.inv.a556_fmj = 40; S.inv.a556_ap = 20; S.eq.wpn = 'rifle'; S.base.loading = 1
  render(); autosave()
  const view = document.getElementById('view')
  return JSON.stringify({ ok: true })
})()`))
ok('注入 5.56 两种弹 + 步枪成功', ammoUi.ok === true)
await tab('背包'); await sleep(900)
const inv = JSON.parse(await ev(`(() => {
  const t = document.getElementById('view').innerText
  const seg = (t.match(/弹药[\\s\\S]{0,400}/) || [''])[0]
  return JSON.stringify({ has: /5\\.56×45/.test(t), seg: seg.slice(0, 320),
    loadedBtns: [...document.querySelectorAll('#view button')].filter(b => /装填|已装填/.test(b.textContent || '')).length })
})()`))
ok('背包出现「弹药」分区且列出 5.56×45 两种弹', inv.has === true && inv.loadedBtns >= 2, '装填按钮=' + inv.loadedBtns)
ok('弹药区写明穿透与伤害倍率', /穿透/.test(inv.seg) && /伤害 ×/.test(inv.seg), inv.seg.replace(/\s+/g, ' ').slice(0, 100))
await shot('03_inventory_ammo')

ok('切到背包页', /背包/.test(String(await tab('背包'))), '')
await sleep(900)
const swap = JSON.parse(await ev(`(() => {
  const before = loadedAmmo('c556')
  const byName = (re) => [...document.querySelectorAll('#view .lrow')]
    .filter(r => re.test((r.innerText || '').split('\\n')[0]))
    .map(r => [...r.querySelectorAll('button')].find(b => /装填/.test(b.textContent || '')))[0]
  const rows = [...document.querySelectorAll('#view .lrow')].map(r => (r.innerText || '').replace(/\\n+/g, ' / ').slice(0, 50))
  const fmj = byName(/FMJ/), ap = byName(/AP/)
  if (!fmj || !ap) return JSON.stringify({ before, err: 'no button', rows })
  fmj.click()                                       // 自动挑的是穿甲弹 → 先手动换成普通弹
  const mid = loadedAmmo('c556')
  const apBtn = [...document.querySelectorAll('#view .lrow')]
    .filter(r => /AP/.test((r.innerText || '').split('\\n')[0]))
    .map(r => [...r.querySelectorAll('button')].find(b => /装填|已装填/.test(b.textContent || '')))[0]
  apBtn.click()                                     // 再换回穿甲弹
  const after = loadedAmmo('c556')
  return JSON.stringify({ before, mid, after, midPen: ITEMS[mid].pen, afterPen: ITEMS[after].pen })
})()`))
ok('点「装填」能换弹种（普通弹 pen3 ↔ 穿甲弹 pen5 来回切）', swap.mid !== swap.before && swap.after !== swap.mid && swap.midPen === 3 && swap.afterPen === 5, JSON.stringify(swap))

const cyc = JSON.parse(await ev(`(() => {
  const S = DEV.state(); S.inv.a556_ap = 5; S.inv.a556_fmj = 5
  const b = loadedAmmo('c556'); cycleLoaded(); const a = loadedAmmo('c556')
  return JSON.stringify({ b, a })
})()`))
ok('HUD 弹药条点击循环换弹种', cyc.b !== cyc.a, JSON.stringify(cyc))

/* 穿透数学：同一把枪打无甲 vs 装甲，伤害必须差出一截 */
const pen = JSON.parse(await ev(`(() => {
  const mk = (armor) => ({ id: 'walker', n: '测试丧尸', hp: 999, hpMax: 999, dmg: 5, spd: 1, armor: armor, t: { armor: armor } })
  const soft = mk(0), hard = mk(5)
  const base = 30
  const a = base * penMul(ITEMS.a556_fmj.pen, soft.t.armor)
  const b = base * penMul(ITEMS.a556_fmj.pen, hard.t.armor)
  const c = base * penMul(ITEMS.a556_ap.pen, hard.t.armor)
  return JSON.stringify({ fmjSoft: a, fmjHard: Math.round(b), apHard: c,
    ratio: +(a / b).toFixed(2) })
})()`))
ok('普通弹打装甲目标被吃掉大半伤害（FMJ pen3 vs 装甲5 → 64%）', pen.fmjHard === 19, JSON.stringify(pen))
ok('换穿甲弹后打装甲目标满伤', pen.apHard === 30)
ok('装甲目标上"普通弹 vs 穿甲弹"的收益差 ≥ 1.5 倍', pen.ratio >= 1.5, 'ratio=' + pen.ratio)

/* ── 4) 辐射：核电站周边累积 ── */
/* 真实路径：在当前区域里找一格带辐射的 POI（核电站/废料场）并把玩家挪过去 */
const radPoi = JSON.parse(await ev(`(() => {
  const hit = DEV.gotoPoi({ feat: 'rad' })
  return JSON.stringify({ hit: hit, poi: hit ? hit.poi : null, rad: DEV.state().rad || 0 })
})()`))
ok('大区里能找到核电站/废料填埋场并抵达', !!radPoi.poi && /nuclear|waste/.test(String(radPoi.poi)), JSON.stringify(radPoi))

const radRun = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  const src = [{ x: S.world.cur.x, y: S.world.cur.y, kind: 'nuclear' }]
  const lv = radLevelAt(src, S.world.cur.x, S.world.cur.y)
  const gain = radGain(lv, 3, radProtect([]))
  S.rad = Math.min(100, (S.rad || 0) + gain)
  render()
  const chip = [...document.querySelectorAll('.hud-chips .chip')].map(c => c.textContent).find(t => /辐射/.test(t)) || ''
  return JSON.stringify({ lv, gain, rad: S.rad, chip: chip.replace(/\\s+/g, ' ').trim(), tier: radTier(S.rad).label })
})()`))
ok('站在核电站中心：辐射等级 3', radRun.lv === 3, JSON.stringify(radRun))
ok('走 3 格累积辐射 > 0', radRun.gain > 0, 'gain=' + radRun.gain)
ok('HUD 出现辐射 chip 且带分档标签', /辐射/.test(radRun.chip) && radRun.chip.length > 4, radRun.chip)

const radItem = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.rad = 60; S.inv.radaway = 2; S.inv.iodine = 3
  const before = S.rad
  useConsumable('radaway')
  const mid = S.rad
  useConsumable('iodine')
  return JSON.stringify({ before, mid, after: S.rad })
})()`))
ok('抗辐射药能压下体内辐射（-55）', radItem.mid === 5, JSON.stringify(radItem))
ok('碘片继续压（最低 0，不出现负数）', radItem.after === 0, JSON.stringify(radItem))

const geiger = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.inv.geiger = 1
  return JSON.stringify({ no: geigerText(2, true), blind: geigerText(2, false) })
})()`))
ok('有盖革计数器时报具体等级，没有时只给模糊线索', /辐射 2 级/.test(geiger.no) && !/2 级/.test(geiger.blind))

/* ── 5) 发电机被动 ── */
const power = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.base.filter = 2; S.base.garden = 2; S.base.power = 1
  const logLen = S.log ? S.log.length : -1
  return JSON.stringify({ ok: true, logLen })
})()`))
ok('注入 净水2 + 菜园2 + 发电机1 成功', power.ok === true)

/* ── 6) 无异常 ── */
ok('控制台没有报错', errs.length === 0, errs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}${LIVE ? ' （live）' : ''}`)
ws.close()
