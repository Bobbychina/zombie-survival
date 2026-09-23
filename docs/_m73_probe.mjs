// M73 取证：技能硬门槛（高级武器/防具要战斗技能）+ 军事区/实验室搜刮门槛（腰斩不锁死）+ 死亡扣进度
//   ① 判定本身：低阶武器不吃门槛；重近战要近战 Lv.3；枪分 3/5 两档；重甲要体能 Lv.3
//   ② 装不上 = 真装不上 + 给理由（背包里点一下，武器槽不变、日志里写明差几级、给下一步出路）
//   ③ 背包页 UI 是**禁用态**：按钮上没有 onclick、有 🔒 与「需要「射击」Lv.5（现在 Lv.1）」
//   ④ 练上去就能装（射击 Lv.5 → 同一把枪装得上）
//   ⑤ 军事区/实验室的「生存」门槛：不够 → 效率 ×0.5 且提示写明；够了 → 不打折
//   ⑥ 端到端（真搜刮路径，Math.random 钉死）：生疏时材料 4 份 vs 达标时 8 份（腰斩，且下限 1）
//   ⑦ 死亡清空当前等级进度条（xp 归零、**等级保留**），弹窗与日志都写了这行
//   ⑧ 全程 0 未捕获异常
// 用法：node docs/_m73_probe.mjs <cdpPort> <url> <outDir>
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
const logs = () => j(`(() => JSON.stringify(S.logBuf.slice(-12).map(p => String(p[1]))))()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','dsh.regionlayer','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)

/** 干净起点：技能清零、背包里塞上待测的装备（门槛判定只看 S.skills，跟天数无关） */
await ev(`(() => {
  try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}
  closeAllModals(); S.over = false; S.ap = 30; S.mat = 100; S.hp = 100;
  for(const k in S.skills) S.skills[k] = 0;
  for(const k in S.xp) S.xp[k] = 0;
  S.inv.marksman = 1; S.inv.kevlar = 1; S.inv.axe = 1; S.inv.pistol = 1;
  S.eq.wpn = 'crowbar'; S.eq.body = null;
  return 1 })()`)
await sleep(400)

/* ── ① 判定本身：门槛表是不是按伤害/防护分档 ── */
const gates = await j(`(() => {
  const g = (id) => { const r = equipGateOf(id); return { id, ok: r.ok, tier: r.tier, skill: r.skill, need: r.need, lv: r.lv } }
  return JSON.stringify({ crowbar: g('crowbar'), pistol: g('pistol'), axe: g('axe'), marksman: g('marksman'), kevlar: g('kevlar') })
})()`)
ok('① 低阶不吃门槛 / 重近战要近战 3 / 枪分 3·5 两档 / 重甲要体能 3',
  gates.crowbar.ok === true && gates.pistol.ok === true &&
  gates.axe.ok === false && gates.axe.skill === 'melee' && gates.axe.need === 3 &&
  gates.marksman.ok === false && gates.marksman.skill === 'shoot' && gates.marksman.need === 5 &&
  gates.kevlar.ok === false && gates.kevlar.skill === 'fitness' && gates.kevlar.need === 3,
  JSON.stringify(gates))

/* ── ② 点一下真装不上，且日志给理由（差几级 + 出路） ── */
const blocked = await j(`(() => {
  const before = S.eq.wpn;
  equipWeapon('marksman');
  const t = String(document.querySelector('#toasts') ? document.querySelector('#toasts').textContent : '');
  return JSON.stringify({ before, after: S.eq.wpn, gunStillOn: (S.inv.marksman || 0) >= 1, toasts: t.slice(0, 120) })
})()`)
await sleep(300)
const lg2 = await logs()
const whyLine = lg2.find(x => x.indexOf('🔒') >= 0) || ''
ok('② 技能不够：武器槽没变 + 东西还在背包里 + 日志写明「需要射击 Lv.5（现在 Lv.0）」',
  blocked.before === 'crowbar' && blocked.after === 'crowbar' && blocked.gunStillOn === true &&
  whyLine.indexOf('射击') >= 0 && whyLine.indexOf('Lv.5') >= 0 && whyLine.indexOf('先拿低一档的用') >= 0,
  JSON.stringify({ slot: blocked.after, log: whyLine.slice(0, 90) }))
ok('② 低阶武器照常装得上（门槛不是把玩家锁死）',
  String(await ev(`(() => { equipWeapon('pistol'); return S.eq.wpn })()`)) === 'pistol')
await ev(`(() => { equipWeapon('crowbar'); return 1 })()`)

/* ── ③ 背包页是禁用态：按钮无 onclick + 🔒 文案（不是"点了才知道"） ── */
const invUi = await j(`(() => {
  S.tab = 'inv'; render();
  const view = document.getElementById('view');
  const txt = String(view.textContent || '').replace(/\\s+/g, ' ');
  const btn = [...view.querySelectorAll('button')].find(b => (b.textContent || '').indexOf('🔒 装备') >= 0);
  return JSON.stringify({
    hint: txt.indexOf('🔒 需要「射击」Lv.5（现在 Lv.0）') >= 0,
    armorHint: txt.indexOf('🔒 需要「体能」Lv.3') >= 0,
    lockedBtn: !!btn, onclick: btn ? btn.getAttribute('onclick') : null, title: btn ? (btn.getAttribute('title') || '').slice(0, 60) : '',
  })
})()`)
if (outDir) await shot('m73-inventory-locked')
ok('③ 背包页直接写明"锁着 + 差几级"，按钮是禁用态（没有 onclick、带 🔒 与 title 理由）',
  invUi.hint === true && invUi.armorHint === true && invUi.lockedBtn === true && invUi.onclick === null && invUi.title.length > 4,
  JSON.stringify(invUi))

/* ── ④ 练上去就能装（门槛跟着技能走，不是一次性开关） ── */
const afterLevel = await j(`(() => {
  S.skills.shoot = 5;
  const g = equipGateOf('marksman');
  equipWeapon('marksman');
  S.tab = 'inv'; render();
  const txt = String(document.getElementById('view').textContent || '');
  return JSON.stringify({ ok: g.ok, slot: S.eq.wpn, hintGone: txt.indexOf('需要「射击」Lv.5') < 0 })
})()`)
ok('④ 射击练到 Lv.5：同一把精准步枪立刻装得上，背包页的锁也消失',
  afterLevel.ok === true && afterLevel.slot === 'marksman' && afterLevel.hintGone === true, JSON.stringify(afterLevel))
await ev(`(() => { S.skills.shoot = 0; S.skills.melee = 0; S.eq.wpn = 'crowbar'; S.tab = 'explore'; render(); return 1 })()`)

/* ── ⑤ 区域门槛判定 + 提示文案 ── */
const zonePre = await j(`(() => {
  const g = (z) => { const r = zoneGateOf(z); return { gated: r.gated, mul: r.mul, need: r.need, lv: r.lv } }
  return JSON.stringify({ mil: g('military'), lab: g('lab'), school: g('school') })
})()`)
ok('⑤ 军事区要生存 Lv.3 / 实验室要 Lv.5 且效率 ×0.5；普通区域不吃门槛',
  zonePre.mil.gated === true && zonePre.mil.mul === 0.5 && zonePre.mil.need === 3 &&
  zonePre.lab.gated === true && zonePre.lab.need === 5 && zonePre.school.gated === false && zonePre.school.mul === 1,
  JSON.stringify(zonePre))

/* ── ⑥ 端到端真搜刮：Math.random 钉在 0.60（wpick 落到材料档，ri(2,5)=4 → 4+d(4)=8 份）── */
const e2e = await j(`(() => {
  const keep = Math.random;
  Math.random = function () { return 0.60 };
  S.seen.military = 1;                       // 别走"第一次抵达"的早退分支
  const run = (survLv) => {
    S.over = false; S.skills.survival = survLv; S.loc = 'military';
    S.ap = 30; S.mat = 0;
    const gated = zoneGateOf('military').gated;
    searchZone('military', false);
    const line = S.logBuf.slice(-8).map(p => String(p[1])).join(' | ');
    return { got: S.mat, gated, line };
  };
  const low = run(1);        // 生疏：效率腰斩
  const high = run(4);       // 达标：正常产出
  Math.random = keep;
  /* 日志窗口里两条都在，取**最后一条**才算这一趟的（第一版取了第一条，于是拿旧行判新账） */
  const lastMats = (s) => { const m = s.match(/回收了 (\\d+) 份材料[^|]*/g) || ['']; return m[m.length - 1].slice(0, 150) };
  return JSON.stringify({ low: low.got, high: high.got, lowGated: low.gated, highGated: high.gated,
    lowLine: lastMats(low.line), highLine: lastMats(high.line) })
})()`)
ok('⑥ 端到端：生存生疏时材料 **4 份** vs 达标 **8 份**（腰斩），日志写明打折原因与"至少留 1 份"',
  e2e.high === 8 && e2e.low === 4 && e2e.lowGated === true && e2e.highGated === false &&
  /-50%/.test(e2e.lowLine) && /至少留 1 份/.test(e2e.lowLine) && e2e.highLine.indexOf('-50%') < 0,
  JSON.stringify(e2e))

/* ── ⑦ 死亡：清空进度条、等级保留、弹窗与日志都写 ── */
const death = await j(`(() => {
  S.over = false; S.day = 9; S.flags.everDied = true; S.flags.rescueUsed = true;   // 跳过"第 1~3 天唯一救援"那条分支
  S.skills.shoot = 4; S.skills.medic = 2;
  S.xp.shoot = 31; S.xp.medic = 9; S.xp.survival = 4;
  const before = { shoot: S.skills.shoot, medic: S.skills.medic, xp: { ...S.xp } };
  gameOver('探针：技能门槛这一项的死亡结算');
  const modal = document.querySelector('.modal, #modalRoot') ? String((document.querySelector('.modal') || document.querySelector('#modalRoot')).textContent || '').replace(/\\s+/g,' ') : '';
  const line = S.logBuf.slice(-16).map(p => String(p[1])).find(x => x.indexOf('📉') >= 0) || '';
  return JSON.stringify({ before, over: S.over, xp: { ...S.xp }, skills: { shoot: S.skills.shoot, medic: S.skills.medic },
    modalHit: modal.indexOf('技能进度') >= 0, modalLine: (modal.match(/技能进度：.{0,80}/) || [''])[0], line: line.slice(0, 110) })
})()`)
if (outDir) await shot('m73-death-progress')
ok('⑦ 死亡清空 3 条进度条（31+9+4=44 点），**等级保留**（射击 Lv.4 / 医疗 Lv.2 不动）',
  death.over === true && death.xp.shoot === 0 && death.xp.medic === 0 && death.xp.survival === 0 &&
  death.skills.shoot === 4 && death.skills.medic === 2,
  JSON.stringify({ xp: death.xp, skills: death.skills }))
ok('⑦ 死亡弹窗与日志都写了这行（丢的是进度，不是等级）',
  death.modalHit === true && /等级保留/.test(death.modalLine) && death.line.indexOf('📉') >= 0 && death.line.indexOf('44') >= 0,
  JSON.stringify({ modal: death.modalLine, log: death.line.slice(0, 80) }))

/* ── ⑧ 全程 0 未捕获异常 ── */
ok('⑧ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log('')
console.log('M73 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
