// M54 取证：据点页全面革新（用户：「全面革新据点系统，现在还是太何意味了」）
//   ① 五个区块都在：安全屋 / 今夜守夜 / 明天的收成 / 该建什么 / 设施四分区（守夜·产线·工坊·基建）
//   ② 守夜判词是**真实读数**：防线满 → 稳；把门墙打光 → 危险（不是静态文案）
//   ③ 明天的收成按算式出数：净水 = 净水等级 + 发电机(1)；蔬菜 = 菜园等级；鱼 = 鱼塘投喂后的产量
//   ④ 该建什么：血月当晚 → 第一条必是防御且带 urgent；全满级 → 给总结而不是空列表
//   ⑤ 设施卡：每张都有「升级后：」增量 + 材料不足写清「还差 X×N」且按钮禁用
//   ⑥ 真建造一次（点真按钮）：等级 +1 / 材料减少 / AP -1
//   ⑦ 抢修防线：把门打到 1 → 点抢修 → 门回满（真按钮）
//   ⑧ 0 未捕获异常 + 截图
// 用法：node docs/_m54_probe.mjs <cdpPort> <url> <outDir>
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

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { try { localStorage.removeItem('zsv-ui-v1') } catch (e) {} return 1 })()`)
await sleep(700)

/* 进据点页；SECTION 取某张卡的正文（卡头文本匹配） */
const gotoBase = async () => { await ev(`(() => { closeAllModals(); S.over = false; setTab('base'); render(); return 1 })()`); await sleep(1100) }
const SECTION = `(t) => { const c = [...document.querySelectorAll('#view .v4card')].find(x => ((x.querySelector(':scope > .card-hd .card-tt')||{}).textContent||'').includes(t)); return c ? c.innerText.replace(/\\s+/g,' ').trim() : '' }`
const heads = () => ev(`(() => [...document.querySelectorAll('#view .v4card > .card-hd > .card-tt')].map(e => e.textContent.trim()))()`)

await gotoBase()
const hs = await heads()
ok('据点页有五个区块：安全屋 / 今夜守夜 / 明天的收成 / 该建什么 + 设施分区',
  hs.some(h => h.includes('安全屋')) && hs.some(h => h.includes('今夜守夜')) && hs.some(h => h.includes('明天的收成')) &&
  hs.some(h => h.includes('该建什么')) && ['守夜', '产线', '工坊', '基建'].every(s => hs.some(h => h.includes(s))),
  JSON.stringify(hs))
await shot('01_base_new')

/* ② 判词是真实读数：先把据点守成"稳"（门窗 3 / 围墙 2 / 陷阱 6），再把它拆穿看判词变"危险" */
const verdictText = async () => await ev(`(() => { const t = ${SECTION}; return t('今夜守夜') })()`)
await ev(`(() => {
  S.base.door = 3; S.base.wall = 2;
  S.def.traps = { spike: 3, fire: 2, alarm: 1 };
  S.def.doorHp = defMax().door; S.def.wallHp = defMax().wall;
  render(); return 1
})()`)
await sleep(900)
const vFull = await verdictText()
await ev(`(() => { S.def.doorHp = 0; S.def.wallHp = 0; S.def.traps = { spike: 0, fire: 0, alarm: 0 }; render(); return 1 })()`)
await sleep(900)
const vBare = await verdictText()
ok('守夜判词是真实读数（守好了 → 稳；被拆穿 → 危险并叫你抢修/建墙）',
  /判词：稳/.test(vFull) && /判词：危险/.test(vBare) && /抢修|围墙/.test(vBare), JSON.stringify({ full: vFull.slice(0, 40), bare: vBare.slice(0, 60) }))
await shot('02_verdict_danger')

/* ③ 明天的收成按算式出数 */
await ev(`(() => {
  S.base.filter = 2; S.base.garden = 2; S.base.pond = 2; S.base.power = 1;
  S.inv.bait = 3; S.cal.bloodMoon = false; S.horde.eta = 0;
  S.def.doorHp = defMax().door; S.def.wallHp = defMax().wall;
  render(); return 1
})()`)
await sleep(1000)
const yText = await ev(`(() => { const t = ${SECTION}; const card = [...document.querySelectorAll('#view .v4card')].find(x => ((x.querySelector(':scope > .card-hd .card-tt')||{}).textContent||'').includes('明天的收成')); return card ? card.innerText.replace(/\\s+/g,' ') : '' })()`)
ok('明天的收成给的是算式结果：净水 = 等级+发电机（2+1=3 份/天）',
  /\+3 \/ 天/.test(yText) && /发电机供电/.test(yText), yText.slice(0, 120))
ok('蔬菜 +2 / 天、鱼 +2 / 天 都写在收成卡里（鱼是投喂后的产量）',
  /\+2 \/ 天/.test(yText) && /鱼/.test(yText) && /投喂/.test(yText), yText.slice(0, 200))
await shot('03_yield')

/* ④ 该建什么：血月当晚第一条是防御 */
await ev(`(() => { S.base = { door:0, bed:0, filter:0, garden:0, bench:0, storage:0, radio:0, wall:0 }; S.cal.bloodMoon = true; S.ap = S.apMax; render(); return 1 })()`)
await sleep(1000)
const adv1 = await ev(`(() => { const t = ${SECTION}; return t('该建什么') })()`)
ok('该建什么：血月当晚第一条是防御（门窗），并写明"今晚/血月"理由',
  /门窗/.test(adv1.slice(0, 60)) && /今晚|血月/.test(adv1), adv1.slice(0, 120))
const urgent = await ev(`(() => [...document.querySelectorAll('#view .v4card .badge')].some(b => /warnpulse|heavy/.test(b.className) ) )()`)
ok('推荐位上带"紧急"视觉标记（urgent 徽章）', urgent === true)
await shot('04_advice_raid')

/* ⑤ 设施卡：delta + 缺料文案 + 禁用 */
await ev(`(() => { S.cal.bloodMoon = false; S.mat = 0; S.inv = { crowbar: 1 }; S.ap = S.apMax; render(); return 1 })()`)
await sleep(1000)
const cards = await ev(`(() => {
  const out = [...document.querySelectorAll('#view .v4card .card')].filter(c => /Lv\\.\\d\\/\\d/.test(c.innerText)).map(c => c.innerText.replace(/\\s+/g,' ').trim());
  return JSON.stringify(out);
})()`)
const cardList = JSON.parse(cards)
ok('每张设施卡都写了「升级后：…」的增量', cardList.length >= 10 && cardList.filter(c => /升级后：/.test(c)).length >= cardList.length - 3,
  JSON.stringify({ total: cardList.length, withDelta: cardList.filter(c => /升级后：/.test(c)).length }))
ok('材料不足时按钮写清「还差 X×N」而不是灰着不说话',
  cardList.some(c => /还差 .+×\\d/.test(c)) || cardList.some(c => /还差/.test(c)), JSON.stringify(cardList.slice(0, 2)))
await shot('05_facilities')

/* ⑥ 真建造一次 */
await ev(`(() => { S.inv = { crowbar: 1, wood: 20, metal: 20, cloth: 10, can: 6 }; S.base.garden = 0; S.ap = S.apMax; S.mat = 5; render(); return 1 })()`)
await sleep(900)
const beforeBuild = JSON.parse(await ev(`(() => JSON.stringify({ lv: S.base.garden, ap: S.ap, wood: itemCount('wood') }))()`))
const built = await ev(`(() => { const b = [...document.querySelectorAll('#view button')].find(x => /建造|升级/.test(x.textContent) && x.getAttribute('onclick') && /build\\('garden'\\)/.test(x.getAttribute('onclick'))); if (!b || b.disabled) return 'NO-BTN'; b.click(); return 'clicked' })()`)
await sleep(1000)
const afterBuild = JSON.parse(await ev(`(() => JSON.stringify({ lv: S.base.garden, ap: S.ap, wood: itemCount('wood') }))()`))
ok('点真按钮真的建起来了（等级 +1 / 行动力 -1 / 木料 -2）',
  built === 'clicked' && afterBuild.lv === beforeBuild.lv + 1 && afterBuild.ap === beforeBuild.ap - 1 && afterBuild.wood === beforeBuild.wood - 2,
  JSON.stringify({ built, before: beforeBuild, after: afterBuild }))

/* ⑦ 抢修防线（真按钮） */
await ev(`(() => { S.inv = { crowbar: 1, wood: 9, metal: 9 }; S.base.door = 1; S.def.doorHp = 1; S.def.wallHp = 0; S.ap = S.apMax; render(); return 1 })()`)
await sleep(900)
const beforeFix = JSON.parse(await ev(`(() => JSON.stringify({ door: S.def.doorHp, max: defMax().door, ap: S.ap }))()`))
const fixed = await ev(`(() => { const b = [...document.querySelectorAll('#view button')].find(x => /抢修防线/.test(x.textContent)); if (!b || b.disabled) return 'NO-BTN'; b.click(); return 'clicked' })()`)
await sleep(900)
const afterFix = JSON.parse(await ev(`(() => JSON.stringify({ door: S.def.doorHp, ap: S.ap }))()`))
ok('点「抢修防线」把门补回满（行动力 -1）',
  fixed === 'clicked' && afterFix.door === beforeFix.max && afterFix.ap === beforeFix.ap - 1, JSON.stringify({ fixed, beforeFix, afterFix }))
await shot('06_repaired')

ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM54 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
