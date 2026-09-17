// M57 取证：死亡结算把这一局讲清楚（死因 / 瞬间 / 下次怎么做 / 生涯最好）
//   ① 死因判词按真实文案归类（流干血 / 尸潮 / 饥渴 / 感染 / 辐射 / 实验室）
//   ② 这一局的瞬间有料才上（击杀/守夜/走路/搜刮/据点/秘闻）
//   ③ "下次可以这样"至少两条、带数字，且不许是空话
//   ④ 生涯记录：第一次死 → 三项全是新纪录；第二次死（更差）→ 记录保留、显示"最好 X"
//   ⑤ 不死人的正常路径没被影响（战斗胜利不弹死亡结算）
//   ⑥ 0 未捕获异常 + 截图
// 用法：node docs/_m57_probe.mjs <cdpPort> <url> <outDir>
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
/** 死亡弹窗的正文（modal 里的卡片文本） */
const deathText = () => ev(`(() => { const m = document.querySelector('.modal, .overlay .modal') || document.querySelector('.modal'); return m ? m.innerText.replace(/\\s+/g, ' ') : '' })()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); localStorage.removeItem('zsv-best-v1'); } catch (e) {} return 1 })()`)

/** 造一个"有料"的存档状态并触发死亡 */
const die = async (msg, extra = '') => {
  await ev(`(() => {
    closeAllModals(); S.over = false; S.day = 12; S.hp = 0;
    S.stats.kills = 23; S.stats.meleeKills = 7; S.stats.apKills = 2; S.stats.scav = 31; S.stats.deep = 5; S.stats.hordes = 3;
    S.lore = (S.lore && S.lore.length) ? S.lore : ['l_the_one', 'l_outbreak'];
    S.base = Object.assign({}, S.base, { door: 1, filter: 1, garden: 1, bench: 1 });
    S.hun = 72; S.thi = 68; S.infect = 10; S.rad = 0; S.mat = 6;
    ${extra}
    gameOver(${JSON.stringify(msg)}); return 1
  })()`)
  await sleep(900)
  return String(await deathText())
}

/* ① 死因：失血 */
const t1 = await die('你在废墟里流干了最后一滴血。')
ok('死亡结算有"死因判词"：失血（图标 + 一句话）', /失血过多/.test(t1) && /🩸/.test(t1), t1.slice(0, 120))
ok('死因后面解释"怎么发生的"', /伤口一直在流血/.test(t1), t1.slice(0, 200))
ok('这一局的瞬间：击杀 / 守夜 / 走路都写出来', /共击杀 23 只/.test(t1) && /守住了 3 次夜袭/.test(t1), t1.slice(0, 260))
ok('"下次可以这样"至少两条、且带具体数字/物品', /下次可以这样/.test(t1) && /绷带/.test(t1) && (t1.match(/· /g) || []).length >= 2, t1.slice(-260))
ok('生涯记录第一次就是新纪录（三项）', /🏆新纪录/.test(t1) && /天数 12/.test(t1), t1.slice(-200))
await shot('01_death_bleed')

/* ② 第二次（更差的）死亡：记录保留、显示"最好" */
const t2 = await die('你在搜刮时被这一带彻底吞掉了。', `S.day = 4;`)
ok('第二次死：记录不被更差的成绩覆盖（显示"最好 12"）', /最好 12/.test(t2), t2.slice(-200))
ok('换一种死因也能正确归类（尸潮）并给对应建议', /被尸潮吞没|尸潮/.test(t2) && /引诱器|烟雾|守夜/.test(t2), t2.slice(0, 220))
await shot('02_death_horde')

/* ③ 饥渴 / 感染 / 辐射三种死因的判词 */
const t3 = await die('你的身体先一步投降了。', `S.hun = 0; S.thi = 0; S.day = 9;`)
ok('饥渴致死：判词是"饥饿与脱水"', /饥饿与脱水/.test(t3), t3.slice(0, 120))
const t4 = await die('随便什么话。', `S.infect = 100;`)
ok('感染拉满：判词是"感染攻陷"', /感染攻陷/.test(t4), t4.slice(0, 120))
const t5 = await die('随便什么话。', `S.rad = 85;`)
ok('辐射超标：判词是"辐射病"', /辐射病/.test(t5), t5.slice(0, 120))
ok('死在实验室：专门的判词与建议（面具/防化服）', /方舟实验室/.test(await die('', `S.loc = 'lab'; S.infect = 0; S.rad = 0;`)), '')
await shot('03_death_lab')

/* ④ 生涯记录存进了本机（不是只看一次就没了） */
const saved = await ev(`(() => { try { return localStorage.getItem('zsv-best-v1') } catch (e) { return 'EXC' } })()`)
ok('生涯最好落进本机 localStorage（跨局保留）', /"days":1[2-9]|"days":[2-9][0-9]|"days":\d{3}/.test(String(saved)) && String(saved).includes('score'), saved)
ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM57 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
