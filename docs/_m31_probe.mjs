// M31 取证：①「人体」分页真的在（页签 + 方块人形 SVG）② 战斗挨打会生成部位伤
//   ③ 流血真的掉血、绷带能止血 ④ 三档治疗链（急救/手术/康复）⑤ 手术失败变感染 ⑥ 走路变贵 ⑦ 老档迁移
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
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(4200)

/* ── ① 页签与页面 ── */
const tab = JSON.parse(await ev(`(() => {
  if (typeof render === 'function') render()
  const tabsBefore = document.querySelectorAll('#tabs .tab').length
  const hasBody = [...document.querySelectorAll('#tabs .tab')].some(e => /人体/.test(e.textContent || ''))
  if (hasBody) setTab('body')
  const t = [...document.querySelectorAll('#tabs .tab')].map(e => e.textContent.trim())
  const v = document.getElementById('view')
  return JSON.stringify({ tabsBefore, hasBody, tabs: t, svgParts: v.querySelectorAll('.mfig .mpart').length,
    title: (v.querySelector('h3') || {}).textContent || '', viewErr: String(window.__renderErr || ''), len: v.innerHTML.length })
})()`))
ok('页签里有「人体」', tab.hasBody === true, JSON.stringify({ tabsBefore: tab.tabsBefore, tabs: tab.tabs, viewErr: tab.viewErr }))
ok('人体页画出了方块人形（7 个部位方块）', tab.svgParts === 7, 'parts=' + tab.svgParts + ' viewLen=' + tab.len)
await shot('90_body_tab')

/* ── ② 战斗挨打 → 部位伤（走真伤判定，不靠 setter 造假） ── */
const hurt = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.hp = S.hpMax
  const before = window.V4Medical.status().injuries.length
  window.V4Medical.onPlayerHurt(45)          // 一次掉 45% 血：必定出重伤
  const st = window.V4Medical.status()
  return JSON.stringify({ before, injuries: st.injuries, parts: st.parts })
})()`))
ok('一次 45% 血的伤害会打出部位伤', hurt.injuries.length > 0, JSON.stringify(hurt.injuries))
const inj = hurt.injuries[0] || {}
ok('伤病带部位与类型（部位伤只做 debuff，不参与生死）', !!inj.part && !!inj.id, JSON.stringify(inj))
const hurtParts = Object.entries(hurt.parts).filter(([, v]) => v < 100).map(([k]) => k)
ok('掉了血的部位与受伤部位对得上', hurtParts.indexOf(inj.part) >= 0, JSON.stringify(hurtParts))

/* ── ③ 流血真的掉血：等几步看 HP ── */
const bleed = JSON.parse(await ev(`(async () => {
  const S = DEV.state()
  S.hp = S.hpMax
  const b = window.V4Medical.bodyNow()
  b.injuries = [{ part: 'torso', id: 'bleedL', day: S.day }]
  window.V4Medical.bodyNow()
  const hp0 = S.hp
  for (let i = 0; i < 20; i++) { window.V4Medical.stepBody() }
  return JSON.stringify({ hp0, hp1: S.hp })
})()`))
ok('未处理的大出血会持续掉血', bleed.hp1 < bleed.hp0, JSON.stringify(bleed))

const bandaged = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.inv.bandage = (S.inv.bandage || 0) + 1
  const b = window.V4Medical.bodyNow()
  b.injuries = [{ part: 'torso', id: 'bleedS', day: S.day }]
  window.V4Medical.bodyNow()
  const r = window.V4Medical.treat('torso', 'bandage')
  const st = window.V4Medical.status()
  return JSON.stringify({ ok: r.ok, msg: r.msg, field: st.injuries[0] && st.injuries[0].field, inv: S.inv.bandage || 0 })
})()`))
ok('绷带能给小出血做急救（并消耗道具）', bandaged.ok === true && bandaged.field === true, JSON.stringify(bandaged))

/* ── ④ 手术：技能越高成功率越高；失败变感染 ── */
const surg = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.inv.surgerykit = 5
  S.skills.medic = 5                       // 5 级：成功率 100%
  S.base.medlab = 1                        // 要有医疗台
  const b = window.V4Medical.bodyNow()
  b.injuries = [{ part: 'legL', id: 'fracture', day: S.day, field: true }]
  window.V4Medical.bodyNow()
  const r = window.V4Medical.treat('legL', 'surgerykit')
  const st = window.V4Medical.status()
  return JSON.stringify({ ok: r.ok, msg: String(r.msg).slice(0, 40), done: st.injuries[0] && st.injuries[0].done })
})()`))
ok('医疗台 + 手术包能把骨折复位（标记 done）', surg.ok === true && surg.done === true, JSON.stringify(surg))

const fail = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.skills.medic = 0                       // 0 级：55%，靠运气
  let failed = null
  for (let i = 0; i < 40 && !failed; i++) {
    S.inv.surgerykit = 5
    const b = window.V4Medical.bodyNow()
    b.injuries = [{ part: 'legR', id: 'fracture', day: S.day, field: true }]
    window.V4Medical.bodyNow()
    window.V4Medical.treat('legR', 'surgerykit')
    const st = window.V4Medical.status()
    if (st.injuries[0] && st.injuries[0].id === 'infected') failed = st.injuries[0]
  }
  return JSON.stringify({ failed })
})()`))
ok('手术失败会变成感染伤口（"有风险"是真的）', !!fail.failed, JSON.stringify(fail))

/* ── ⑤ 走路变贵 + HUD 提示 ── */
const travel = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  const b = window.V4Medical.bodyNow()
  b.injuries = [{ part: 'legL', id: 'fracture', day: S.day }]
  window.V4Medical.bodyNow()
  const extra = window.V4Medical.travelExtra()
  render()
  const hud = (document.querySelector('.hud-chips') || {}).textContent || ''
  return JSON.stringify({ extra, hud: hud.replace(/\\s+/g, ' ').slice(0, 120) })
})()`))
ok('腿部骨折让走路更贵（额外行动力）', travel.extra > 0, 'extra=' + travel.extra)
ok('HUD 上有伤病提示（点得进人体页）', /左腿|骨折|🩺/.test(travel.hud), travel.hud.slice(0, 80))

/* ── ⑥ 康复：过几天 + 吃饱就长好 ── */
const rec = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  S.hun = 95
  if (typeof render === 'function') render()
  const b = window.V4Medical.bodyNow()
  b.parts.legL = 40
  b.injuries = [{ part: 'legL', id: 'fracture', day: S.day, done: true, field: true }]
  window.V4Medical.bodyNow()
  const p0 = window.V4Medical.status().parts.legL
  window.V4Medical.nightBody()
  const p1 = window.V4Medical.status().parts.legL
  const dayNow = S.day
  S.day = (Number(S.day) || 1) + 6
  window.V4Medical.nightBody()
  const st = window.V4Medical.status()
  return JSON.stringify({ p0, p1, dayNow, injuries: st.injuries.length, parts: st.parts.legL, hun: S.hun })
})()`))
ok('手术后的部位会随睡觉回血', rec.p1 > rec.p0, JSON.stringify({ before: rec.p0, after: rec.p1 }))
ok('康复天数到了就痊愈（伤情清零）', rec.injuries === 0, JSON.stringify(rec))

/* ── ⑦ 老档迁移：没有 S.body 时按 HP 比例铺 ── */
const mig = JSON.parse(await ev(`(() => {
  const S = DEV.state()
  delete S.body
  S.hp = 55; S.hpMax = 100
  const st = window.V4Medical.status()
  return JSON.stringify({ parts: st.parts })
})()`))
const vals = Object.values(mig.parts)
ok('老档按当前 HP 比例铺部位血量（不洗成满血）', vals.every(v => v === 55), JSON.stringify(mig.parts))

await ev(`setTab('body')`); await sleep(400); await shot('91_body_injured')
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
