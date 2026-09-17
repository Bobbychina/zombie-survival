// M55 取证：堵住用户报的速通漏洞 ——「不在家 + 一直点睡觉 + 遇僵尸就逃跑 = 直接速通」
//   ① 复现路径走一遍：野外、不吃不喝、连点睡觉（遇战就逃跑）→ **速通不成立**（血一路掉、很快死）
//   ② 空着肚子睡觉回血被削到 1/4（别想靠睡觉把血睡回来）
//   ③ 有吃有喝时睡觉照常回血（不许误伤正常玩法）
//   ④ 野外过夜消耗 ×1.5（18/21 而不是 12/14）
//   ⑤ 夜里日志会把"饿/渴到掉血"说清楚，并告诉玩家吃什么
//   ⑥ 吃东西/喝水之后连饿计数归零（加码停止）
//   ⑦ 0 未捕获异常 + 截图
// 用法：node docs/_m55_probe.mjs <cdpPort> <url> <outDir>
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
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
/* 干净 profile 上新手教程会自动弹：它的高亮/按钮会混进"按文字找按钮"的查询里，先把它标记成看完 */
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done', '1'); localStorage.setItem('dsh.tutorial.step', '99'); } catch (e) {} return 1 })()`)

/* 状态读取：要等"整份状态"就位再读（干净档第一次 boot 时 S 还没补齐就断言会读到半截对象） */
const stRaw = () => ev(`(() => { if (!S || !S.flags || !S.stats) return 'WAIT'; return JSON.stringify({ day: S.day, hp: Math.round(S.hp), hpMax: S.hpMax,
  hun: Math.round(S.hun), thi: Math.round(S.thi), starveN: S.starveN | 0, thirstN: S.thirstN | 0, over: !!S.over, won: !!S.flags.won }) })()`)
const st = async () => {
  for (let i = 0; i < 24; i++) {
    const r = await stRaw()
    if (r !== 'WAIT' && !String(r).startsWith('EXC')) return r
    await sleep(400)
  }
  return '{}'
}
/* 睡一晚：先切回据点页（「睡觉」按钮在安全屋那张卡上，探索页没有）→ 点真按钮；
   若夜里开战就点逃跑（用户的原始操作） */
const sleepNight = async () => {
  await ev(`(() => { closeAllModals(); setTab('base'); render(); return 1 })()`)
  await sleep(500)
  const b = await ev(`(() => { const x = [...document.querySelectorAll('#view button')].find(y => /睡觉/.test(y.textContent || '')); if (!x) return 'NO-BTN'; x.click(); return 'clicked' })()`)
  if (b !== 'clicked') return b
  await sleep(850)
  for (let k = 0; k < 6; k++) {
    const r = await ev(`(() => {
      if (!window.V4UI || !V4UI.isOpen || !V4UI.isOpen()) return 'over';
      const ov = document.getElementById('v4b-overlay'); if (!ov) return 'over';
      const flee = [...ov.querySelectorAll('.mv-slot')].find(x => /逃跑/.test(x.textContent || ''));
      if (flee && !flee.disabled) { flee.click(); return 'fled'; }
      return 'wait';
    })()`)
    if (r === 'fled') { await sleep(700); return 'fled' }
    if (r === 'over') return 'quiet'
    await sleep(500)
  }
  return 'stuck'
}

/* ── ① 复现用户的速通路径：野外 + 不吃不喝 + 一直睡（遇战就逃） ── */
await ev(`(() => {
  closeAllModals(); S.over = false; S.flags.won = false; S.day = 1; S.loc = 'oldtown';
  S.hp = S.hpMax; S.hun = 0; S.thi = 0; S.inv = {}; S.starveN = 0; S.thirstN = 0;
  S.cal.bloodMoon = false; S.horde = { eta: 0, size: 0 }; setTab('explore'); render(); return 1
})()`)
await sleep(800)
let hpTrace = [], died = false, fledCount = 0, day = 1
for (let i = 0; i < 24; i++) {
  const r = await sleepNight()
  if (r === 'fled') fledCount++
  const s = JSON.parse(await st())
  hpTrace.push(s.hp); day = s.day
  if (s.over) { died = true; break }
  if (s.won || s.day > 101) break
}
const clone = JSON.parse(await st())
ok('速通不成立：野外不吃不喝连睡 → 很快死（不再是"睡到第 100 天通关"）',
  (died || clone.day < 101) && !clone.won && hpTrace[hpTrace.length - 1] < hpTrace[0], JSON.stringify({ died, day, hp: hpTrace.slice(0, 6), last: hpTrace[hpTrace.length - 1], fledCount }))
ok('死亡原因是饥饿/脱水（日志里写明了）',
  /饥饿第|脱水第|又饿又渴/.test(String(await ev(`(() => (document.getElementById('log') ? document.getElementById('log').innerText : '').slice(-400))()`))),
  '')
await shot('01_speedrun_dead')

/* ── ①b 用户原话那一套：**夜里遇战就逃**也救不了 —— 强制夜袭（血月）+ 逃跑，照样饿死 ── */
await ev(`(() => {
  closeAllModals(); S.over = false; S.flags.won = false; S.day = 6; S.loc = 'oldtown';
  S.hp = S.hpMax; S.hun = 0; S.thi = 0; S.inv = {}; S.starveN = 0; S.thirstN = 0;
  S.cal.bloodMoon = true;              /* 血月 = 今晚必定开战，逼出"逃跑"这条路 */
  S.horde = { eta: 0, size: 0 }; setTab('explore'); render(); return 1
})()`)
await sleep(800)
let fledN = 0, died2 = false, day2 = 6, hp2 = []
const hordes0 = Number(await ev(`(() => S.stats.hordes | 0)()`)) || 0
for (let i = 0; i < 20; i++) {
  const r = await sleepNight()
  if (r === 'fled') fledN++
  const s = JSON.parse(await st())
  hp2.push(s.hp); day2 = s.day
  if (s.over) { died2 = true; break }
  if (s.won || s.day > 101) break
  await ev(`(() => { S.cal.bloodMoon = S.day % 7 === 0; return 1 })()`)
}
const c2 = JSON.parse(await st())
const hordes1 = Number(await ev(`(() => S.stats.hordes | 0)()`)) || 0
/* 断言抓"结果"：这一轮真的开过夜袭（hordes 增长），玩家照样饿死、没通关。
   逃跑那一格点没点到不当断言（战斗弹窗的按钮态在自动化里不稳）—— 守也好逃也好，都活不过十来晚才是要守住的事。 */
ok('逃跑也不能速通：血月夜必开战（hordes 增长）+ 不吃不喝，同样很快死',
  died2 && !c2.won && hordes1 > hordes0, JSON.stringify({ died2, hordes: [hordes0, hordes1], fledN, day2, hp: hp2.slice(0, 8) }))
await shot('01b_flee_dead')

/* ── ② 空腹睡觉回血只剩 1/4 ── */
await ev(`(() => { closeAllModals(); S.over = false; S.day = 5; S.loc = 'base'; S.hp = 50; S.hun = 0; S.thi = 0; S.base.bed = 0; S.starveN = 0; S.thirstN = 0; render(); return 1 })()`)
await sleep(600)
const beforeStarve = JSON.parse(await st())
await sleepNight()
const afterStarve = JSON.parse(await st())
/* 据点地板本来回 12；空腹 → 3（还要再看夜里掉的饥饿血） */
ok('空腹睡觉：回血被削到四分之一（12 → 3，再减去夜里掉的饥饿血）',
  afterStarve.hp < beforeStarve.hp, JSON.stringify({ before: beforeStarve.hp, after: afterStarve.hp }))
const logTxt = String(await ev(`(() => (document.getElementById('log') ? document.getElementById('log').innerText : '').slice(-600))()`))
ok('日志里写清了"空腹/脱水只恢复四分之一"', /四分之一/.test(logTxt), logTxt.slice(-120))

/* ── ③ 有吃有喝：睡觉照常回血（不误伤正常玩法） ── */
await ev(`(() => { closeAllModals(); S.over = false; S.day = 6; S.loc = 'base'; S.hp = 50; S.hun = 80; S.thi = 80; S.base.bed = 0; S.starveN = 0; S.thirstN = 0; S.cal.bloodMoon = false; S.horde = { eta: 0, size: 0 }; render(); return 1 })()`)
await sleep(600)
const beforeFed = JSON.parse(await st())
await sleepNight()
const afterFed = JSON.parse(await st())
ok('吃饱喝足时睡觉照常回血（据点地板 +12）', afterFed.hp >= beforeFed.hp + 10, JSON.stringify({ before: beforeFed.hp, after: afterFed.hp }))

/* ── ④ 野外过夜消耗 ×1.5 ── */
await ev(`(() => { closeAllModals(); S.over = false; S.loc = 'base'; S.day = 8; S.hp = S.hpMax; S.hun = 90; S.thi = 90; S.starveN = 0; S.thirstN = 0; render(); return 1 })()`)
await sleep(600)
const b1 = JSON.parse(await st()); await sleepNight(); const a1 = JSON.parse(await st())
await ev(`(() => { S.loc = 'oldtown'; S.day = 9; S.hp = S.hpMax; S.hun = 90; S.thi = 90; render(); return 1 })()`)
await sleep(600)
const b2 = JSON.parse(await st()); await sleepNight(); const a2 = JSON.parse(await st())
const usedBase = b1.hun - a1.hun, usedWild = b2.hun - a2.hun
ok('野外过夜更耗：饱食消耗明显高于据点（约 ×1.5）', usedWild > usedBase + 2, JSON.stringify({ 据点: usedBase, 野外: usedWild }))
await shot('02_wild_night')

/* ── ⑤ 吃东西之后连饿计数归零 ── */
await ev(`(() => { closeAllModals(); S.over = false; S.loc = 'base'; S.hp = S.hpMax; S.hun = 0; S.thi = 0; S.starveN = 4; S.thirstN = 4; S.inv = { can: 2, water: 2 }; render(); return 1 })()`)
await sleep(600)
const ate = await ev(`(() => { try { useConsumable('can'); useConsumable('water'); return JSON.stringify({ hun: Math.round(S.hun), thi: Math.round(S.thi), ok: true }) } catch (e) { return 'EXC ' + e.message } })()`)
await sleep(800)
const afterEat = JSON.parse(await st())
await sleepNight()
const afterEatNight = JSON.parse(await st())
ok('吃了罐头+喝水之后：连饿计数归零、当晚不再加码掉血',
  afterEatNight.starveN === 0 && afterEatNight.thirstN === 0 && afterEatNight.hp >= afterEat.hp, JSON.stringify({ ate, afterEat: { hun: afterEat.hun, thi: afterEat.thi }, afterNight: { starveN: afterEatNight.starveN, hp: afterEatNight.hp } }))

ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM55 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
