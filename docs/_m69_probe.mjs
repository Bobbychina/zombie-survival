// M69 取证：两条感染链咬合（用户硬核化路线图 · 短期第 1 项的剩下一半）
//   ① 干净身子过夜：感染值不动、不刷日志
//   ② 带一处没清创的感染伤口过夜：感染 **+4**（不再自然消退）
//   ③ 人体页吃抗生素：当晚伤口不推进（消退照常）；一天只能一次
//   ④ 爆发期（≥60）：伤口康复暂停（手术过的骨折当晚不结案）
//   ⑤ 真实过夜链路（sleepNight → window.__v4InfectNight）也走这套账
//   ⑥ 人体页/HUD 的总览把"感染档位 + 没清创的伤口数 + 每晚代价"写在一起
// 用法：node docs/_m69_probe.mjs <cdpPort> <url> <outDir>
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
/** 把身体重置成"只有一处没清创的感染伤口"（其他伤清掉），hunger/thirst 给足，避免虚弱 +1 混进来 */
const setup = (infect, woundPart = 'armR', extra = '') => ev(`(() => {
  S.body = { parts: { head: 100, torso: 100, belly: 100, armL: 100, armR: 100, legL: 100, legR: 100 },
             injuries: ${woundPart ? `[{ part: '${woundPart}', id: 'infected', day: S.day }]` : '[]'}, bleedSince: S.day };
  ${extra}
  S.infect = ${infect}; S.hun = 90; S.thi = 90; S.hp = S.hpMax;
  return 1 })()`)
const night = () => j(`(() => { const r = V4Medical.infectNight(); return JSON.stringify({ infect: S.infect, push: r.woundPush, logs: r.logs.map(l => l.text) }) })()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); setTab('explore'); S.over = false; S.ap = 40; render(); return 1 })()`)

/* ① 干净身子 */
await setup(0, null)
const clean = await night()
ok('① 没有伤口时：感染值不动、也不刷日志', clean.infect === 0 && clean.logs.length === 0, JSON.stringify(clean))

/* ② 一处没清创的伤口 → +4 且不再消退 */
await setup(10, 'armR')
const hurt1 = await night()
ok('② 带一处感染伤口过夜：感染 +4（吃饱喝足也不再自然消退）',
  hurt1.infect === 14 && hurt1.push === 4 && hurt1.logs.some(l => l.indexOf('往血里灌') >= 0),
  JSON.stringify({ infect: hurt1.infect, push: hurt1.push, log: hurt1.logs[0] || '' }))
ok('② 伤口是"没清创"才算 —— 手术过的伤口不计入每晚代价', Number(await ev(`(() => {
  S.body.injuries[0].done = true; const r = V4Medical.infectNight(); return r.woundPush })()`)) === 0)

/* ③ 抗生素压制 */
await setup(20, 'armR', `S.inv.anti = 2;`)
const treatRes = await j(`(() => { const r = V4Medical.treat('armR', 'anti'); return JSON.stringify({ ok: r.ok, msg: r.msg }) })()`)
const suppressed = await night()
const again = await j(`(() => { const r = V4Medical.treat('armR', 'anti'); return JSON.stringify({ ok: r.ok, msg: r.msg }) })()`)
ok('③ 人体页吃抗生素：当晚伤口不推进（感染照常消退）',
  treatRes.ok && suppressed.push === 0 && suppressed.infect === 19 && suppressed.logs.some(l => l.indexOf('抗生素压住') >= 0),
  JSON.stringify({ treat: treatRes.msg, infect: suppressed.infect, push: suppressed.push }))
ok('③ 一天只能吃一次（第二次被拒）', again.ok === false && String(again.msg).indexOf('今天已经吃过') >= 0, String(again.msg))

/* ④ 爆发期：伤口康复暂停 */
const burst = await j(`(() => {
  S.day = 12;
  S.body = { parts: { head: 100, torso: 100, belly: 100, armL: 100, armR: 100, legL: 100, legR: 100 },
             injuries: [{ part: 'legR', id: 'fracture', day: 1, done: true, field: true }], bleedSince: 1 };
  S.infect = 70; S.hun = 90; S.thi = 90;
  V4Medical.nightBody();
  return JSON.stringify({ infect: S.infect, injuries: S.body.injuries.length, logs: (S.logBuf || []).slice(-4).map(p => p[1]) }) })()`)
ok('④ 感染 ≥60（爆发期）：手术过的伤当晚不长、不结案', burst.injuries === 1 && burst.logs.some(l => String(l).indexOf('爆发期') >= 0),
  JSON.stringify({ injuries: burst.injuries, logs: burst.logs.slice(-2) }))

/* ⑤ 真实过夜链路：sleepNight 里 legacy 那段账现在走 window.__v4InfectNight */
await setup(10, 'armR')
const realNight = await j(`(() => {
  try { sleepNight(); } catch (e) { return JSON.stringify({ err: String(e && e.message || e) }) }
  return JSON.stringify({ infect: S.infect, day: S.day, logs: (S.logBuf || []).slice(-6).map(p => String(p[1])).filter(l => l.indexOf('感染') >= 0) }) })()`)
ok('⑤ 真的过一夜（sleepNight）：感染从 10 涨到 14，日志里能看到"伤口在往血里灌"',
  realNight.infect === 14 && (realNight.logs || []).some(l => l.indexOf('往血里灌') >= 0),
  JSON.stringify({ infect: realNight.infect, logs: realNight.logs, err: realNight.err || null }))

/* ⑥ 人体页总览 */
const line = await ev(`(() => { S.body.injuries = [{ part: 'armR', id: 'infected', day: S.day }, { part: 'legL', id: 'infected', day: S.day }]; S.infect = 70; return String(V4Medical.infection()) })()`)
ok('⑥ 总览一行写清：档位 + 没清创的伤口数 + 每晚代价', /爆发期/.test(line) && /2 处伤口没清创（每晚 \+8）/.test(line), String(line))
const page = String(await ev(`(() => String(V4Medical.renderTab('body') || ''))()`))
ok('⑥ 人体页里也有这一行', page.indexOf('处伤口没清创') >= 0)
if (outDir) await shot('m69-body')

ok('⑦ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M69 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
