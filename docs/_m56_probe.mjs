// M56 取证：① 逃跑失败要真的挨打（用户：「逃跑失败了也不会受伤，完全可以无限逃跑避战」）
//            ② 避战道具（气味引诱器三档）：引走敌人、够档不浪费、血月无效
// 用法：node docs/_m56_probe.mjs <cdpPort> <url> <outDir>
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
/** 战斗界面里的某个槽（按文字找） */
const slotByText = (re) => `(() => {
  const ov = document.getElementById('v4b-overlay'); if (!ov) return 'NO-OVERLAY';
  const el = [...ov.querySelectorAll('.mv-slot, button')].find(x => ${re}.test(x.textContent || ''));
  if (!el) return 'NO-SLOT'; if (el.disabled) return 'DISABLED'; el.click(); return 'clicked';
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done', '1'); } catch (e) {} return 1 })()`)

/* ── ① 逃跑失败要真的挨打（旧版：失败只写日志 → 无限逃跑避战） ── */
const setupFight = async (ids, inv = {}, extra = '') => {
  await ev(`(() => {
    closeAllModals(); S.over = false; S.day = 1; S.eliteToday = 0; S.hpMax = 300; S.hp = 300; S.sta = S.staMax;
    S.skills.stealth = 0; S.eq.feet = null; S.inv = ${JSON.stringify(inv)}; S.mat = 20;
    ${extra}
    window.DEV.battle(${JSON.stringify(ids)}); return 1
  })()`)
  await sleep(1400)
}
await setupFight(['walker'])
const beforeFlee = JSON.parse(await ev(`(() => JSON.stringify({ hp: S.hp, sta: S.sta, kills: S.stats.kills }))()`))
/** 逃跑失败一次（真的挨打）：等按钮可用 → 点 → 读引擎状态。返回 {tried, failed, escaped, s0, s1} */
const tryFleeOnce = async () => {
  let ready = false
  for (let k = 0; k < 12 && !ready; k++) {
    ready = (await ev(`(() => { const ov = document.getElementById('v4b-overlay'); if (!ov) return false;
      const el = [...ov.querySelectorAll('.mv-slot, button')].find(x => /逃跑/.test(x.textContent || ''));
      return !!el && !el.disabled })()`)) === true
    if (!ready) await sleep(400)
  }
  if (!ready) return { tried: false, reason: 'not-ready' }
  const s0 = JSON.parse(await ev(`(() => JSON.stringify(window.V4UI.state()))()`))
  const click = await ev(slotByText(`/逃跑/`))
  if (click !== 'clicked') return { tried: false, reason: 'click=' + click }
  await sleep(1100)
  const s1 = JSON.parse(await ev(`(() => JSON.stringify(window.V4UI.state()))()`))
  return { tried: true, s0, s1, failed: !!s1 && s1.fleeTries > s0.fleeTries, escaped: !!s1 && s1.over === 'flee' }
}
let fails = 0, hpDrops = 0, escapes = 0, pairs = [], fleeLog = ''
for (let battle = 0; battle < 6 && fails < 3; battle++) {
  await setupFight(['walker', 'runner'])               // 迅捷敌人：成功率更低，更快凑到失败样本
  for (let i = 0; i < 6; i++) {
    const r = await tryFleeOnce()
    if (!r.tried) { fleeLog = 'reason=' + r.reason; break }
    if (r.failed) {
      fails++
      if (r.s1.hp < r.s0.hp) hpDrops++
      pairs.push([r.s0.fleeTries, Math.round(r.s0.chance * 100), Math.round(r.s1.chance * 100)])
      fleeLog = 'chance ' + Math.round(r.s0.chance * 100) + '% → ' + Math.round(r.s1.chance * 100) + '%'
    }
    if (r.escaped) { escapes++; break }
  }
}
const afterFlee = JSON.parse(await ev(`(() => JSON.stringify({ hp: S.hp, sta: S.sta }))()`))
ok('逃跑失败要付出代价：失败时真的掉血（旧版失败不掉血 → 无限逃跑）',
  fails >= 3 && hpDrops === fails, JSON.stringify({ fails, hpDrops, escapes, before: beforeFlee.hp, after: afterFlee.hp, fleeLog }))
ok('逃跑失败还掉体力（8 点/次，跑多了体力见底）', afterFlee.sta < beforeFlee.sta, JSON.stringify({ sta: [beforeFlee.sta, afterFlee.sta], fails }))
ok('失败后成功率会下降（引擎记了失败次数，下一次更难跑；到 8% 下限为止）',
  pairs.length >= 3 && pairs.filter(p => p[1] - p[2] >= 6).length >= 3 && pairs.every(p => p[2] <= p[1]),
  JSON.stringify(pairs))
await ev(`(() => { try { window.V4UI.close() } catch (e) {} closeAllModals(); return 1 })()`)
await shot('01_flee_costs')

/* ── ② 引诱器：够档的最低档全引走（战斗直接结束，不算击杀）
   用慢速普通丧尸（walker，spd 1）：这样在点引诱器之前玩家不会先挨打，"没掉血"才是干净的断言 ── */
await setupFight(['walker', 'walker'], { decoy1: 2, decoy3: 1 })
const beforeDecoy = JSON.parse(await ev(`(() => JSON.stringify({ hp: S.hp, kills: S.stats.kills, d1: itemCount('decoy1'), d3: itemCount('decoy3'), st: window.V4UI.state() }))()`))
const decoyClick = await ev(slotByText(`/引诱器/`))
await sleep(1200)
const afterDecoy = JSON.parse(await ev(`(() => JSON.stringify({ st: window.V4UI.state(), hp: S.hp, kills: S.stats.kills, d1: itemCount('decoy1'), d3: itemCount('decoy3') }))()`))
ok('引诱器把普通丧尸全引走 → 战斗以"脱离"收尾、用道具本身不掉血、**没算击杀**（不掉战利品）',
  decoyClick === 'clicked' && !!afterDecoy.st && afterDecoy.st.over === 'flee' && afterDecoy.st.foes.every(f => f.driven) &&
  afterDecoy.hp === beforeDecoy.hp && afterDecoy.kills === beforeDecoy.kills,
  JSON.stringify({ decoyClick, before: { hp: beforeDecoy.hp, d1: beforeDecoy.d1, d3: beforeDecoy.d3 }, after: { over: afterDecoy.st && afterDecoy.st.over, hp: afterDecoy.hp, kills: afterDecoy.kills, foes: afterDecoy.st && afterDecoy.st.foes } }))
ok('用的是"够档的最低档"：消耗 decoy1、留着 decoy3', afterDecoy.d1 === beforeDecoy.d1 - 1 && afterDecoy.d3 === beforeDecoy.d3,
  JSON.stringify({ d1: [beforeDecoy.d1, afterDecoy.d1], d3: [beforeDecoy.d3, afterDecoy.d3] }))
await ev(`(() => { window.V4UI.close(); closeAllModals(); return 1 })()`)
await shot('02_decoy_clears')

/* ── ③ 档位不匹配：低级引不走 boss，且**不消耗**道具 ── */
await setupFight(['tyrant'], { decoy1: 2 })
const beforeWeak = JSON.parse(await ev(`(() => JSON.stringify({ d1: itemCount('decoy1'), hp: S.hp }))()`))
const weakClick = await ev(slotByText(`/引诱器/`))
await sleep(1000)
const afterWeak = JSON.parse(await ev(`(() => JSON.stringify({ d1: itemCount('decoy1'), st: window.V4UI.state(), log: (document.getElementById('v4b-overlay')||document.body).textContent.replace(/\\s+/g,' ') }))()`))
ok('低级引诱器对暴君无效：战斗继续、道具**没被浪费**',
  weakClick === 'clicked' && !!afterWeak.st && afterWeak.st.over === null && afterWeak.d1 === beforeWeak.d1 && afterWeak.st.foes.every(f => !f.driven),
  JSON.stringify({ weakClick, before: beforeWeak, after: { d1: afterWeak.d1, over: afterWeak.st && afterWeak.st.over } }))
ok('  —— 提示语告诉玩家该用什么档（"只对…有效"）', /只对/.test(afterWeak.log), afterWeak.log.slice(-100))
await ev(`(() => { window.V4UI.close(); closeAllModals(); return 1 })()`)

/* ── ④ 高档引诱器能把暴君也引开 ── */
await setupFight(['tyrant'], { decoy3: 1 })
const beforeStrong = Number(await ev(`itemCount('decoy3')`))
const strongClick = await ev(slotByText(`/引诱器/`))
await sleep(1200)
const afterStrong = JSON.parse(await ev(`(() => JSON.stringify({ d3: itemCount('decoy3'), st: window.V4UI.state() }))()`))
ok('军用信息素诱饵把暴君引走 → 脱离接触、道具 -1',
  strongClick === 'clicked' && !!afterStrong.st && afterStrong.st.over === 'flee' && afterStrong.st.foes[0].driven && afterStrong.d3 === beforeStrong - 1,
  JSON.stringify({ strongClick, before: beforeStrong, after: { d3: afterStrong.d3, over: afterStrong.st && afterStrong.st.over, foes: afterStrong.st && afterStrong.st.foes } }))
await ev(`(() => { window.V4UI.close(); closeAllModals(); return 1 })()`)

/* ── ⑤ 道具能"找到"也能"自己做"：物品 / 配方 / 掉落三处都在 ── */
const data = JSON.parse(await ev(`(() => {
  const ids = ['decoy1','decoy2','decoy3'];
  const recipes = (window.RECIPES || []).filter(r => ids.includes(r.out)).map(r => ({ out: r.out, st: r.st, lv: r.lv }));
  const zones = Object.keys(window.ZONES || {}).filter(z => { const l = (ZONES[z] && ZONES[z].loot) || {}; return ids.some(i => (l[i] || 0) > 0); });
  return JSON.stringify({ items: ids.map(i => !!(window.ITEMS && ITEMS[i])), recipes, zones });
})()`))
ok('三档道具都在物品表里，且各有配方（工作台 / 医疗台 / 弹药台）',
  data.items.every(Boolean) && data.recipes.length === 3 && new Set(data.recipes.map(r => r.st)).size >= 2,
  JSON.stringify({ items: data.items, recipes: data.recipes }))
ok('掉落表里也能搜到（超市 / 医院 / 军方 / 地铁）', data.zones.length >= 2, JSON.stringify(data.zones))
await shot('03_decoy_data')

ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM56 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
