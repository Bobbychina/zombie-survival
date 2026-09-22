// M68 取证：把"伤"接到每个动作上（用户硬核化路线图 · 短期第 1 项）
//   ① 手臂伤 → 搜刮产出下降（**同一掷点**下对比：健康 vs 手臂骨折，材料确实是更少的那一个）
//   ② 头部伤 → 视野少一圈（走一步点亮的新格子从 3×3 变…实测计数）
//   ③ 下限保护：手全废也不是 0（至少 1 份材料）；头再晕也至少 1 圈（不能瞎）
//   ④ 人体页把这两条损失写在明面上（不再只有命中/闪避）
// 用法：node docs/_m68_probe.mjs <cdpPort> <url> <outDir>
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

/** 找一块能搜刮的空地/POI：优先 danger 0 的建材类（材料档收益稳定），找不到就用任意 POI */
const spot = await j(`(() => {
  const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
  const w = ws.worldOf(s.seed, s.region);
  const all = Object.values(w.blocks).filter(b => b && b.poi);
  const pick = all.find(b => b.poi === 'hardware' || b.poi === 'buildmart' || b.poi === 'warehouse') || all.find(b => b.danger <= 1) || all[0];
  return JSON.stringify(pick ? { x: pick.x, y: pick.y, poi: pick.poi, danger: pick.danger } : null);
})()`)
if (!spot) { console.log('FAIL 这一局找不到可搜刮的点'); process.exit(1) }
console.log('  目标点位: ' + JSON.stringify(spot))
await ev(`(() => { V4World.teleport(${spot.x}, ${spot.y}); return 1 })()`)
await sleep(400)

/* 定量对比：把 Math.random 钉成固定值 → 同一掷点下跑两次（健康 / 双手报废），比材料增量。
   注意：探针自己钉随机数是为了让"同一次搜索"可复现，不是改玩法。 */
const runSearch = async (arms, apTop) => j(`(() => {
  const real = Math.random;
  try {
    Math.random = () => 0.5;                        // rollSearchKind 在 danger 0 时会落到 'mats'
    S.ap = ${apTop}; S.hp = S.hpMax;
    const b = (S.body = S.body || { parts: {}, injuries: [], bleedSince: 0 });
    b.parts.armL = ${arms}; b.parts.armR = ${arms};
    if (!Array.isArray(b.injuries)) b.injuries = [];
    const before = S.mat;
    const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
    s.left['${spot.x},${spot.y}'] = 9;              // 保证不是"搜空只剩材料"那条分支
    V4World.search(0);
    return JSON.stringify({ mat: S.mat - before, ap: S.ap });
  } finally { Math.random = real }
})()`)

const healthy = await runSearch(100, 40)
const broken = await runSearch(0, 40)
console.log('  同一掷点：健康 ' + JSON.stringify(healthy) + ' · 双手报废 ' + JSON.stringify(broken))
ok('① 手臂报废时**同一次搜索**的材料产出确实更少', broken.mat < healthy.mat && healthy.mat > 0 && broken.mat >= 1,
  '健康 ' + healthy.mat + ' → 手臂报废 ' + broken.mat)
ok('③ 下限保护：手全废也翻得到东西（≥1 份材料）', broken.mat >= 1, 'broken=' + broken.mat)

const muls = await j(`(() => JSON.stringify({
  healthy: V4Debug.scavMulOf({ parts: { armL: 100, armR: 100 } }),
  hurt: V4Debug.scavMulOf({ parts: { armL: 0, armR: 0 } }),
  half: V4Debug.scavMulOf({ parts: { armL: 50, armR: 50 } }),
  junk: V4Debug.scavMulOf({ parts: {} }),
  visionNormal: V4Debug.headVisionLoss({ parts: { head: 100 }, injuries: [] }),
  visionHurt: V4Debug.headVisionLoss({ parts: { head: 30 }, injuries: [] }),
}))()`)
ok('① 公式：100%→1.00 / 50%→0.725 / 0%→0.45，坏档兜底 1.00', muls.healthy === 1 && muls.hurt === 0.45 && muls.half > 0.7 && muls.half < 0.75 && muls.junk === 1, JSON.stringify(muls))

/* ② 视野：默认 1 圈 = 3×3；把侦查技能点到 Lv3（2 圈）再看头伤前后 */
const revealCount = () => ev(`(() => { const ws = V4.worldstate, s = ws.ensureSaveWorld(S); const w = ws.worldOf(s.seed, s.region);
  return Object.values(w.blocks).filter(b => b && b.revealed).length })()`)
const radiusProbe = async (head, skill, cx) => {
  await ev(`(() => { S.skills = S.skills || {}; S.skills.scout = ${skill};
    S.body = S.body || { parts: {}, injuries: [], bleedSince: 0 };
    S.body.parts.head = ${head};
    S.body.injuries = ${head < 55 ? "[{ part: 'head', id: 'concuss', day: S.day }]" : '[]'};
    return 1 })()`)
  const r = Number(await ev(`(() => V4Debug.scoutRadius())()`))
  const before = Number(await revealCount())
  await ev(`(() => { const ws = V4.worldstate, s = ws.ensureSaveWorld(S);
    /* 直接走 markVisited 那条路：和玩家走一格点亮的效果一致（两块探针各自用不同的坐标，避免互相污染） */
    ws.markVisited(V4.worldstate.worldOf(s.seed, s.region), s, ${cx}, 10); return 1 })()`)
  const after = Number(await revealCount())
  return { r, gain: after - before }
}
const vHealthy = await radiusProbe(100, 3, 1)
const vHurt = await radiusProbe(30, 3, 4)
console.log('  视野：健康 ' + JSON.stringify(vHealthy) + ' · 头伤 ' + JSON.stringify(vHurt))
ok('② 头伤让视野少一圈（圈数 2→1，且新点亮的格子变少）',
  vHealthy.r === 2 && vHurt.r === 1 && vHurt.gain < vHealthy.gain, JSON.stringify({ healthy: vHealthy, hurt: vHurt }))
await ev(`(() => { S.skills.scout = 0; return 1 })()`)
ok('③ 下限：没点侦查技能（1 圈）+ 头伤，仍然是 1 圈（不能瞎）', Number(await ev(`(() => V4Debug.scoutRadius())()`)) === 1)

/* ④ 人体页与 HUD 要把这两条损失写在明面上（不再只有命中/闪避） */
await ev(`(() => { S.body.parts.armR = 20; S.body.parts.head = 40;
  S.body.injuries = [{ part: 'armR', id: 'fracture', day: S.day }, { part: 'head', id: 'concuss', day: S.day }]; return 1 })()`)
const bodyHtml = String(await ev(`(() => { try { return String(V4Medical.renderTab('body') || '') } catch(e) { return 'EXC ' + e.message } })()`))
const hud = String(await ev(`(() => { try { return String(V4Medical.hudLine() || '') } catch(e) { return 'EXC ' + e.message } })()`))
ok('④ 人体页写着「搜刮产出 -x%」与「视野 -1 圈」',
  /搜刮产出 -\d+%/.test(bodyHtml) && /视野 -1 圈/.test(bodyHtml),
  (bodyHtml.match(/你现在干活更费劲[^<]{0,70}/) || ['(没找到)'])[0])
ok('④ HUD 那一行同样带上这两条', /搜刮产出 -\d+%/.test(hud) && /视野 -1 圈/.test(hud), hud.slice(0, 80))
if (outDir) await shot('m68-body')

ok('⑤ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M68 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
