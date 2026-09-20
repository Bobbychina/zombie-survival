// M64 取证：审计里发现的那几个 bug —— 修好没有（同一支探针在**未修的线上版**上会红，在修好的版本上全绿）
//   ① 战斗中换武器不再吞子弹 / 不再虚增 ammoUsed / 不留幻影弹
//   ② 钉刺陷阱只扎最前面那一只（不再全场 -22）
//   ③ 胜利结算补齐：干净胜利计数 + 成就 + 猎人奖励（legacy endCombat 的口径）
//   ④ 辐射病/部位伤的命中·闪避惩罚真的进战斗数值（以前只是 UI 上写着）
//   ⑤ 键盘：第 5 个槽是 Q（不再和"5 = 逃跑"撞车）
//   ⑥ 走路掉血不再出现负数生命；重复开战不再留两个战斗覆盖层
// 用法：node docs/_m64_probe.mjs <cdpPort> <url> <outDir>
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
const battle = async (foes, opts) => {
  await ev(`(() => { if (V4UI.isOpen()) V4UI.close(); S.hp = S.hpMax; startCombat(${JSON.stringify(foes)}, ${JSON.stringify(opts || {})}); return 1 })()`)
  for (let i = 0; i < 20; i++) { if ((await ev(`!!(window.V4UI && V4UI.isOpen())`)) === true) return true; await sleep(350) }
  return false
}

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); S.over = false; return 1 })()`)
await sleep(300)

/* ── ① 战斗中换武器不吞弹 ── */
const gun0 = JSON.parse(String(await ev(`(() => {
  if (V4UI.isOpen()) V4UI.close();
  S.eq.wpn = 'pistol'; S.inv.pistol = 1; S.inv.shotgun = 1;
  S.inv.a9_fmj = (S.inv.a9_fmj || 0) + 40; S.inv.a12_buck = 8;
  S.load = Object.assign({}, S.load, { c9: 'a9_fmj', c12: 'a12_buck' });
  S.ammo = 0; syncAmmo(); S.stats.ammoUsed = 0; S.ap = 14; render();
  return JSON.stringify({ wpn: S.eq.wpn, ammoMirror: S.ammo, shells: S.inv.a12_buck, used: S.stats.ammoUsed, c9: itemCount('a9_fmj') }); })()`)))
await battle(['walker'])
await sleep(500)
const gun1 = JSON.parse(String(await ev(`(() => {
  V4UI.switchWeapon();
  return JSON.stringify({ wpn: S.eq.wpn, ammoMirror: S.ammo, shells: S.inv.a12_buck, used: S.stats.ammoUsed, c9: itemCount('a9_fmj'), loadedForNew: (S.load || {}).c12 }); })()`)))
await ev(`if (V4UI.isOpen()) V4UI.close(); return 1`); await sleep(300)
console.log('  换枪: ' + JSON.stringify({ before: gun0, after: gun1 }))
ok('① 战斗中换武器：新口径的子弹一个不少（修前会被"spent"吞掉）',
  gun1.shells === gun0.shells && gun1.c9 === gun0.c9, JSON.stringify({ shells: [gun0.shells, gun1.shells], c9: [gun0.c9, gun1.c9] }))
ok('① 换武器不会虚增"消耗弹药"统计（修前 ammoUsed 会 +8）', gun1.used === gun0.used, JSON.stringify({ used: [gun0.used, gun1.used] }))
ok('① 弹药镜像跟上了新武器（不是旧口径的残留数字）', gun1.wpn === 'shotgun' && gun1.ammoMirror === gun1.shells,
  JSON.stringify({ wpn: gun1.wpn, mirror: gun1.ammoMirror, shells: gun1.shells }))

/* ── ② 钉刺陷阱只扎一只 ── */
const spike = JSON.parse(String(await ev(`(() => {
  if (V4UI.isOpen()) V4UI.close();
  S.def = Object.assign({}, S.def, { traps: Object.assign({}, S.def && S.def.traps, { spike: 1, alarm: 0, fire: 0 }) });
  S.eq.wpn = 'pistol';
  return JSON.stringify({ spike: S.def.traps.spike }); })()`)))
await battle(['walker', 'walker', 'walker'], { siege: true })
await sleep(500)
const spikeAfter = JSON.parse(String(await ev(`(() => { const st = V4UI.state(); return JSON.stringify({
  hps: (st.foes || []).map(f => f.hp), spike: (S.def.traps || {}).spike,
  log: (document.getElementById('v4b-overlay') || {}).textContent ? 'ok' : 'none' }); })()`)))
await ev(`if (V4UI.isOpen()) V4UI.close(); return 1`); await sleep(300)
const damaged = spikeAfter.hps.filter(h => h < 24).length        // 普通丧尸 24 血：<24 才算被扎到
console.log('  钉刺: ' + JSON.stringify({ before: spike, hps: spikeAfter.hps, damaged }))
ok('② 钉刺只扎最前面那一只（另外两只满血）', damaged === 1 && spikeAfter.spike === 0, JSON.stringify(spikeAfter.hps))

/* ── ③ 胜利结算补齐（干净胜利计数 + 成就 + 猎人） ── */
const end0 = JSON.parse(String(await ev(`(() => { S.stats.cleanWins = 0; S.ach = []; S.comp = 'none';
  return JSON.stringify({ cleanWins: S.stats.cleanWins, ach: S.ach.length }); })()`)))
const end1 = JSON.parse(String(await ev(`(() => { if (typeof V4Debug.onEnd !== 'function') return JSON.stringify({ missing: true });
  V4Debug.onEnd('win', { clean: true, foeCount: 3 });
  return JSON.stringify({ cleanWins: S.stats.cleanWins, ach: (S.ach || []).slice() }); })()`)))
console.log('  结算: ' + JSON.stringify({ before: end0, after: end1 }))
ok('③ 干净胜利记账：cleanWins +1 且 a_immune / a_boom 到手（修前 v4 这条路全漏）',
  !end1.missing && end1.cleanWins === end0.cleanWins + 1 && end1.ach.includes('a_immune') && end1.ach.includes('a_boom'),
  JSON.stringify(end1))
const end2 = JSON.parse(String(await ev(`(() => { if (typeof V4Debug.onEnd !== 'function') return JSON.stringify({ missing: true });
  S.stats.cleanWins = 5; V4Debug.onEnd('win', { clean: false, foeCount: 2 });
  return JSON.stringify({ cleanWins: S.stats.cleanWins }); })()`)))
ok('③ 挨过打的胜利不算"干净"（cleanWins 不动）', end2.cleanWins === 5, JSON.stringify(end2))

/* ── ④ 命中/闪避惩罚真的进战斗数值 ── */
const rad0 = JSON.parse(String(await ev(`(() => { if (typeof V4Debug.playerProfile !== 'function') return JSON.stringify({ missing: true });
  S.rad = 0; S.skills = Object.assign({}, S.skills, { stealth: 10 }); const m = statMods(); const p = V4Debug.playerProfile();
  return JSON.stringify({ hit: m.hit || 0, dodge: m.dodge, profDodge: p.dodge, accPenalty: p.accPenalty || 0 }); })()`)))
const rad1 = JSON.parse(String(await ev(`(() => { if (typeof V4Debug.playerProfile !== 'function') return JSON.stringify({ missing: true });
  S.rad = 97; const m = statMods(); const p = V4Debug.playerProfile();
  return JSON.stringify({ hit: m.hit || 0, dodge: m.dodge, profDodge: p.dodge, accPenalty: p.accPenalty || 0 }); })()`)))
/* 闪避这一条要**带点基础闪避**（潜行 10 级 = 0.15）才看得出来：惩罚是减在基础值上的，
   基础 0 的档位会 clamp 到 0（那也是对的），所以这里用"明显档"（rad 60 → 闪避 -3%）比小差值。 */
const rad2 = JSON.parse(String(await ev(`(() => { S.rad = 60; const p = V4Debug.playerProfile();
  return JSON.stringify({ profDodge: p.dodge, accPenalty: p.accPenalty || 0 }); })()`)))
console.log('  辐射惩罚: ' + JSON.stringify({ clean: rad0, fatal: rad1, mid: rad2 }))
ok('④ 辐射 97 档：命中惩罚真的进了档案（accPenalty ≈ 0.18）',
  !rad1.missing && Math.abs((rad1.accPenalty || 0) - 0.18) < 0.001 && (rad0.accPenalty || 0) === 0, JSON.stringify({ clean: rad0.accPenalty, sick: rad1.accPenalty }))
ok('④ 闪避惩罚真的减在基础闪避上（明显档 -3%，致命档直接被压到 0）',
  !rad1.missing && Math.abs((rad0.profDodge - rad2.profDodge) - 0.03) < 0.001 && rad0.profDodge > 0.1 && rad1.profDodge === 0,
  JSON.stringify({ clean: rad0.profDodge, mid: rad2.profDodge, fatal: rad1.profDodge }))
await ev(`S.rad = 0; render(); return 1`)

/* ── ⑤ 键盘：第 5 槽是 Q ── */
const keys = JSON.parse(String(await ev(`(() => {
  if (V4UI.isOpen()) V4UI.close();
  S.inv.bandage = 3; S.inv.decoy1 = 2;          // 保证第 4 槽（引诱器）与第 5 槽（道具）都在
  const inv = {}; for (const id of ['bandage', 'medkit', 'molotov', 'grenade', 'smoke', 'antitoxin', 'decoy1', 'decoy2', 'decoy3']) inv[id] = itemCount(id);
  S.hp = 50; render();
  return JSON.stringify({ inv }); })()`)))
await sleep(400)
const opened5 = await battle(['walker', 'walker'])
await sleep(600)
const labels = JSON.parse(String(await ev(`(() => {
  const st = V4UI.state();
  const slots = [...document.querySelectorAll('#v4b-overlay .mv-slot .mv-name')].map(x => (x.textContent || '').trim().slice(0, 2));
  const p = (typeof V4Debug.playerProfile === 'function') ? V4Debug.playerProfile() : {};
  return JSON.stringify({ labels: slots, open: V4UI.isOpen(), foes: st ? st.foes.length : 0, profInv: p.inventory || {} }); })()`)))
await ev(`(() => { S.hp = 50; V4UI.key({ key: 'q', preventDefault(){} }); return 1 })()`)
await sleep(500)
const afterQ = JSON.parse(String(await ev(`(() => { const st = V4UI.state();
  const inv = {}; for (const id of ['bandage', 'medkit', 'molotov', 'grenade', 'smoke', 'antitoxin', 'decoy1', 'decoy2', 'decoy3']) inv[id] = itemCount(id);
  return JSON.stringify({ open: V4UI.isOpen(), over: st && st.over, hp: S.hp, inv, last: V4UI.last && V4UI.last() }); })()`)))
await ev(`if (V4UI.isOpen()) V4UI.close(); return 1`); await sleep(300)
const usedId = afterQ.last && afterQ.last.id
const ITEM_IDS = ['bandage', 'medkit', 'molotov', 'grenade', 'smoke', 'antitoxin', 'decoy1', 'decoy2', 'decoy3']
console.log('  键盘: ' + JSON.stringify({ opened: opened5, labels: labels.labels, open: labels.open, foes: labels.foes, profInv: labels.profInv, before: keys.inv, afterQ }))
ok('⑤ 第 5 个槽标成 Q（不再和「5 = 逃跑」撞车）', labels.open === true && labels.labels.length === 5 && labels.labels[4].startsWith('Q'), JSON.stringify(labels))
ok('⑤ 按 Q 触发的就是第 5 槽（道具槽）那个动作，并且真的消耗掉一件',
  ITEM_IDS.includes(String(usedId)) && (afterQ.inv[usedId] || 0) === (keys.inv[usedId] || 0) - 1,
  JSON.stringify({ used: usedId, before: keys.inv[usedId] || 0, after: afterQ.inv[usedId] || 0, hp: afterQ.hp }))

/* ── ⑥ 负数生命 + 重复开战 ── */
const neg = JSON.parse(String(await ev(`(() => { const keep = { rad: S.rad, hp: S.hp };
  S.rad = 97; S.hp = 2; tickVitals(1);
  const out = { hp: S.hp };
  S.rad = keep.rad; S.hp = keep.hp; render(); return JSON.stringify(out); })()`)))
ok('⑥ 重度辐射每步掉血不会写出负数生命（clamp 到 0）', neg.hp === 0, JSON.stringify(neg))
const dup = JSON.parse(String(await ev(`(() => {
  if (V4UI.isOpen()) V4UI.close();
  startCombat(['walker'], {}); const first = document.querySelectorAll('#v4b-overlay').length;
  startCombat(['walker', 'walker'], {}); const second = document.querySelectorAll('#v4b-overlay').length;
  const st = V4UI.state();
  if (V4UI.isOpen()) V4UI.close();
  return JSON.stringify({ first, second, foes: st && st.foes.length }); })()`)))
await sleep(400)
console.log('  重复开战: ' + JSON.stringify(dup))
ok('⑥ 重复开战不会留下两个战斗覆盖层（旧的一场先收掉）', dup.first === 1 && dup.second === 1 && dup.foes === 2, JSON.stringify(dup))
ok('⑥ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
await shot('m64_end')

const pass = checks.filter(([, c]) => c).length
console.log(`\nM64 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
