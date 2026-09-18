// M58 取证：辐射的**白天症状**（以前只有夜里掉血与压体力上限，白天照跑照打，玩家看不出被辐射害了）
//   ① HUD 辐射 chip：干净时不出；吃进去以后报分档 + 症状摘要，点一下进人体页
//   ② 白天真的在扣：口渴 ×1.5、体力消耗 ×1.6、重度每步 -1 血、致命每步 -3 血（干净档一滴不扣）
//   ③ 呕吐：明显以上随机把刚吃的吐掉（固定随机数下可复现）
//   ④ statMods 把症状并进同一本账：命中/闪避惩罚 + 「辐射病 X」备注
//   ⑤ 人体页新增 ☢️ 辐射 卡：症状 / 怎么办 / 一键吃药（80 → 25）
//   ⑥ 图鉴 → 📘 治疗指南 新增「辐射怎么处理」五档对照表
//   ⑦ 0 未捕获异常 + 截图
// 用法：node docs/_m58_probe.mjs <cdpPort> <url> <outDir>
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
/* 干净起点：不背包污染、无病无伤，只留这一件事在测 */
await ev(`(() => {
  closeAllModals(); S.over = false; S.hp = 80; S.hpMax = 100; S.hun = 80; S.thi = 90; S.infect = 0; S.rad = 0;
  S.sta = 30; S.staMax = 100; S.wounds = []; S.comp = null;
  S.eq = Object.assign({}, S.eq, { head: null, body: null, mask: null, feet: null });
  S.inv = {}; syncAmmo && syncAmmo(); render(); return 1
})()`)

/* ── ① HUD 辐射 chip ── */
const hud = JSON.parse(await ev(`(() => {
  S.rad = 0; render();
  const find = () => [...document.querySelectorAll('.hud-chips .chip')].find(c => /辐射/.test(c.textContent || ''));
  const cleanHidden = !find();
  S.rad = 80; render();
  const el = find();
  const text = el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  return JSON.stringify({ cleanHidden, text, title: el ? (el.getAttribute('title') || '') : '',
    clickable: el ? /setTab/.test(el.getAttribute('onclick') || '') : false });
`)()`))
console.log('  HUD: ' + JSON.stringify(hud))
ok('① 干净档不出辐射 chip（没吃进去就别吓人）', hud.cleanHidden)
ok('① 80 剂量：chip 报「重度」并顶出症状摘要', /辐射/.test(hud.text) && /重度/.test(hud.text) && /掉血 1\/步/.test(hud.text), hud.text)
ok('① 提示里给了症状清单与处理建议，且点一下进人体页', /症状/.test(hud.title) && /抗辐射药/.test(hud.title) && hud.clickable, hud.title.slice(0, 120))
await shot('01_hud_rad')

/* ── ② 白天真的在扣（每步结算，与夜里那套分开） ── */
const vit = JSON.parse(await ev(`(() => {
  const run = (rad, steps) => {
    S.rad = rad; S.hp = 80; S.hpMax = 100; S.thi = 100; S.hun = 80; S.infect = 0; S.sta = 30;
    const h0 = S.hp, t0 = S.thi, s0 = S.sta;
    for (let i = 0; i < steps; i++) tickVitals(1);
    return { hp: h0 - S.hp, thi: +(t0 - S.thi).toFixed(3), sta: +(s0 - S.sta).toFixed(3) };
  };
  const one = (rad) => run(rad, 1);
  const clean = one(0), light = one(30), heavy = run(80, 3), fatal = run(97, 3);
  S.rad = 0; render();
  return JSON.stringify({ clean, light, heavy, fatal,
    thirstRatio: +(fatal.thi / clean.thi).toFixed(3), staRatio: +(fatal.sta / clean.sta).toFixed(3) });
`)()`))
console.log('  每步结算: ' + JSON.stringify(vit))
ok('② 干净档：走一步不掉血', vit.clean.hp === 0, 'hp -' + vit.clean.hp)
ok('② 重度（80）每步 -1 血，致命（97）每步 -3 血（3 步 3 / 9）', vit.heavy.hp === 3 && vit.fatal.hp === 9, `heavy=${vit.heavy.hp} fatal=${vit.fatal.hp}`)
ok('② 口渴按档放大（致命 ×1.5）', Math.abs(vit.thirstRatio - 1.5) < 0.02, '×' + vit.thirstRatio)
ok('② 体力消耗按档放大（致命 ×1.6）', Math.abs(vit.staRatio - 1.6) < 0.02, '×' + vit.staRatio)
ok('② 轻微档只放大消耗、不掉血（别默默扣血让玩家以为是 bug）', vit.light.hp === 0 && vit.light.thi > vit.clean.thi, JSON.stringify(vit.light))

/* ── ③ 呕吐：明显以上按概率把刚吃的吐掉 ── */
const vom = JSON.parse(await ev(`(() => {
  const rnd = Math.random, out = {};
  const one = (rad, r) => {
    Math.random = () => r; S.rad = rad; S.hp = 90; S.hpMax = 100; S.hun = 80; S.thi = 90; S.infect = 0; S.sta = 60;
    tickVitals(1); return +(80 - S.hun).toFixed(2);
  };
  out.clean = one(0, 0);                       // 干净档：只走正常饱食消耗
  out.heavyHit = one(80, 0);                   // 命中呕吐
  out.heavyMiss = one(80, 0.99);               // 没呕吐
  out.tier1Hit = one(30, 0);                   // 轻微档不该吐
  Math.random = rnd; S.rad = 0; render();
  return JSON.stringify(out);
`)()`))
console.log('  呕吐: ' + JSON.stringify(vom))
ok('③ 明显以上会呕吐：一步多掉 8 点饱食（3.6 → 11.6）', vom.heavyHit > vom.heavyMiss + 7 && vom.heavyMiss < 4.5, `${vom.heavyMiss} → ${vom.heavyHit}`)
ok('③ 轻微档不呕吐、干净档不受影响', vom.tier1Hit < 4.5 && vom.clean < 4.5, `${vom.clean} / ${vom.tier1Hit}`)

/* ── ④ statMods：命中/闪避惩罚并进同一本账 ── */
const mods = JSON.parse(await ev(`(() => {
  const at = (rad) => { S.rad = rad; const m = statMods(); return { hit: +(m.hit || 0).toFixed(3), dodge: +m.dodge.toFixed(3), dmg: +m.dmgMul.toFixed(3), notes: m.note.slice() }; };
  S.hun = 80; S.thi = 80; S.sta = 60; S.infect = 0;
  const r0 = at(0), r60 = at(60), r80 = at(80);
  S.rad = 0; render();
  return JSON.stringify({ r0, r60, r80 });
`)()`))
console.log('  战力账: ' + JSON.stringify(mods))
ok('④ 干净档没有「辐射病」备注', !mods.r0.notes.some(n => /辐射/.test(n)), JSON.stringify(mods.r0.notes))
ok('④ 60 剂量：命中 -5%、备注写「辐射病 明显」', Math.abs(mods.r60.hit + 0.05) < 0.001 && mods.r60.notes.some(n => /辐射病 明显/.test(n)), JSON.stringify(mods.r60))
ok('④ 80 剂量：闪避再降一档（症状 -6% + 分档 -10%）',
  Math.abs((mods.r80.dodge - mods.r60.dodge) + 0.13) < 0.001 && Math.abs(mods.r80.hit + 0.10) < 0.001,
  `dodge ${mods.r60.dodge} → ${mods.r80.dodge}`)

/* ── ⑤ 人体页 ☢️ 辐射 卡 + 一键吃药 ── */
const body = JSON.parse(await ev(`(() => {
  S.rad = 80; addItem('radaway', 1, true); addItem('iodine', 2, true);
  setTab('body');
  const txt = () => ((document.querySelector('#view') || document.body).textContent || '').replace(/\\s+/g, ' ');
  const t0 = txt();
  const btn = [...document.querySelectorAll('#view button')].find(b => /抗辐射药/.test(b.textContent || ''));
  const before = S.rad;
  if (btn) btn.click();
  const t1 = txt();
  return JSON.stringify({ hasCard: /☢️ 辐射/.test(t0), hasSymptom: /白天症状/.test(t0), hasStep: /掉血 1\\/步/.test(t0),
    hasCare: /抗辐射药优先/.test(t0), hasBtn: !!btn, before, after: S.rad, afterTier: /轻微/.test(t1), left: itemCount('radaway') });
`)()`))
console.log('  人体页: ' + JSON.stringify(body))
ok('⑤ 人体页有辐射卡：剂量/档位 + 白天症状 + 怎么办', body.hasCard && body.hasSymptom && body.hasStep && body.hasCare)
ok('⑤ 卡上按钮真的能吃药（抗辐射药 80 → 25，卡面跟着降到轻微）', body.hasBtn && body.before === 80 && body.after === 25 && body.afterTier, `${body.before} → ${body.after}，剩余 ${body.left}`)
await shot('02_body_rad')

/* ── ⑥ 图鉴 → 📘 治疗指南：辐射五档对照表 ── */
const guide = JSON.parse(await ev(`(() => {
  setTab('codex');
  const btn = [...document.querySelectorAll('#view button')].find(b => /治疗指南/.test(b.textContent || ''));
  if (btn) btn.click();
  const txt = ((document.querySelector('#view') || document.body).textContent || '').replace(/\\s+/g, ' ');
  return JSON.stringify({ clicked: !!btn, hasRad: /辐射怎么处理/.test(txt),
    tiers: ['干净', '轻微', '明显', '重度', '致命'].filter(l => txt.includes(l)),
    hasRange: /75–94/.test(txt), hasMed: /抗辐射药/.test(txt), hasGeiger: /盖革计数器/.test(txt) });
`)()`))
console.log('  图鉴: ' + JSON.stringify(guide))
ok('⑥ 治疗指南新增「辐射怎么处理」', guide.clicked && guide.hasRad)
ok('⑥ 五档标签 + 剂量区间 + 用药全都写清楚', guide.tiers.length === 5 && guide.hasRange && guide.hasMed && guide.hasGeiger, JSON.stringify(guide))
await shot('03_codex_rad')

/* ── ⑦ 纯逻辑也在页面上可查（探针与外部脚本依赖这几个名字） ── */
const api = JSON.parse(await ev(`(() => {
  const t = [0, 30, 60, 80, 97].map(r => window.radSymptoms(r));
  const mono = t.every((s, i) => i === 0 || (s.staDrainMul >= t[i-1].staDrainMul && s.hitPenalty >= t[i-1].hitPenalty && s.hpPerStep >= t[i-1].hpPerStep));
  return JSON.stringify({ hasFn: typeof window.radSymptoms === 'function' && typeof window.radBrief === 'function',
    mono, labels: t.map(s => s.label), brief: window.radBrief(window.radSymptoms(97)) });
`)()`))
console.log('  纯逻辑: ' + JSON.stringify(api))
ok('⑦ 症状函数挂到 window 且严格单调（高辐射不会更轻）', api.hasFn && api.mono, JSON.stringify(api.labels))
ok('⑦ HUD 短摘要不含 undefined', /掉血 3\/步/.test(api.brief) && !/undefined/.test(api.brief), api.brief)
ok('⑦ 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM58 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
