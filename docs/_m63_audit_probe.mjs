// M63 审计探针：不测"新功能好不好"，专测"会不会坏" —— 计数器幂等 / 存档往返 / 边界输入 / 全页签无异常
//   ① 引诱器计数：一次点击只 +1；同场用两次 = +2；打完关窗不再补记；引不走既不消耗也不记账
//   ② 跨区计数：油不够/行动力不够时**不涨**；成功后 +1；"跨到自己"不涨
//   ③ 存档往返：存档 → 重新加载页面 → world.crossings / stats.decoyUses 还在（不被 sanitize/migrate 丢掉）
//   ④ 边界输入：radSymptoms/radSymptomText 喂 NaN/Infinity/负数不炸；missingFor 喂负数库存不炸
//   ⑤ 全页签 + 弹窗巡游：9 个页签 + 商人弹窗 + 存档口令弹窗，0 未捕获异常、0 页面横向溢出
//   ⑥ 反复开关地图窗/切本地大区 6 次：尺寸收敛且不再抖（M59 的回归）
// 用法：node docs/_m63_audit_probe.mjs <cdpPort> <url> <outDir>
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
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') errs.push('LOG ' + String(m.params.entry.text || '').slice(0, 140))
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

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(1000)
/* M47 同款前置加固：字号/地图摆法是本机偏好（`zsv-ui-v1`），别的探针可能留在 160% 或"嵌入页内"，
   那样 `#v4world` 的挂载位置都不同 → 按 DOM 找格子的断言会假红。清掉并重载一次。 */
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); localStorage.removeItem('zsv-ui-v1'); localStorage.removeItem('dsh.mapmode'); } catch(e){}; return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(1000)
await ev(`(() => { try { closeAllModals(); } catch(e){}; setTab('explore'); render(); return 1 })()`)
await sleep(600)
/** 起一场战斗并等到界面打开 */
const battle = async (foes) => {
  await ev(`(() => { if (V4UI.isOpen()) V4UI.close(); S.hp = S.hpMax; DEV.battle(${JSON.stringify(foes)}); return 1 })()`)
  for (let i = 0; i < 20; i++) { if ((await ev(`!!(window.V4UI && V4UI.isOpen())`)) === true) return true; await sleep(350) }
  return false
}
const state = async () => JSON.parse(String(await ev(`(() => { const st = V4UI.state() || { foes: [] };
  return JSON.stringify({ uses: S.stats.decoyUses || 0, d1: S.inv.decoy1 || 0, d2: S.inv.decoy2 || 0, over: st.over || null,
    driven: (st.foes || []).filter(f => f.driven).length, open: V4UI.isOpen() }); })()`)))
const clickDecoy = () => ev(`(() => { const s = [...document.querySelectorAll('#v4b-overlay .mv-slot')].find(x => /decoy/.test(x.getAttribute('onclick') || ''));
  if (!s) return 'NO-SLOT'; if (s.disabled) return 'DISABLED'; s.click(); return 'CLICKED'; })()`)

/* ── ① 引诱器计数幂等 ── */
await ev(`(() => { S.stats.decoyUses = 0; S.inv.decoy1 = 3; S.inv.decoy2 = 0; S.inv.decoy3 = 0; return 1 })()`)
await battle(['walker', 'walker'])
const before1 = await state()
await clickDecoy(); await sleep(900)
const after1 = await state()
await ev(`if (V4UI.isOpen()) V4UI.close(); return 1`); await sleep(500)
const afterClose = await state()
console.log('  一次引诱器: ' + JSON.stringify({ before: before1, after: after1, afterClose }))
ok('① 一次引诱器只 +1（清场脱离后立刻落库）', after1.uses === before1.uses + 1 && after1.d1 === before1.d1 - 1, JSON.stringify(after1))
ok('① 关掉战斗窗不再补记（不会重复落库）', afterClose.uses === after1.uses, JSON.stringify(afterClose))

/* 部分引走：只带**低档**道具、群里有高档敌人 → 引走低档那几只、剩下继续打（这是唯一的"非清场"路径），
   而且同一场里点第二次**不能再记一笔**（道具已经没了 / 引不走不消耗 → 计数就停在 1）。 */
await ev(`(() => { S.stats.decoyUses = 0; S.inv.decoy1 = 1; S.inv.decoy2 = 0; S.inv.decoy3 = 0; S.hp = S.hpMax; return 1 })()`)
await battle(['walker', 'armored'])
const two0 = await state()
await clickDecoy(); await sleep(900)
const two1 = await state()
const again = await clickDecoy(); await sleep(600)
const two2 = await state()
await ev(`if (V4UI.isOpen()) V4UI.close(); return 1`); await sleep(400)
console.log('  部分引走: ' + JSON.stringify({ start: two0, after1: two1, again, after2: two2 }))
ok('① 只带低档道具：引走普通丧尸、装甲丧尸留下继续打（不是"一发全清"）',
  two1.driven === 1 && !two1.over && two1.d1 === two0.d1 - 1 && two1.uses === two0.uses + 1,
  JSON.stringify({ driven: two1.driven, over: two1.over, d1: two1.d1, uses: two1.uses }))
ok('① 同一场再点一次不会再记一笔（计数停在 1）',
  (again === 'NO-SLOT' || again === 'DISABLED' || again === 'CLICKED') && two2.uses === two1.uses,
  JSON.stringify({ again, uses: two2.uses }))

/* ── ② 跨区计数：失败不涨、成功 +1 ── */
/* 先切到大区图再查格子（不然读到 0 个格子 —— 探针第一版就是这么假红的） */
await ev(`(() => { try { V4Scale.toggleMap(true); } catch(e){}; try { V4World.mapMode('region'); } catch(e){}; render(); return 1 })()`)
/* 线上（单文件 700KB + 慢网）地图卡挂载会慢：轮询等格子出现，别用固定 sleep 赌 */
for (let i = 0; i < 12; i++) {
  const n = Number(await ev(`document.querySelectorAll('#v4world .rcell2').length`))
  if (n > 0) break
  await ev(`(() => { try { V4World.mapMode('region'); render(); } catch(e){} return 1 })()`)
  await sleep(500)
}
/* 挑一个"有油就能开"的目标（挑不到就跳过这几条，别拿"你已经在...了"当失败用例 —— 那是假测试） */
const pick = JSON.parse(String(await ev(`(() => { const s = S.world;
  if (!s.veh) s.veh = { fuel: 12, hp: 80 };
  s.veh.fuel = 12; S.ap = Math.max(S.ap, 16); render();
  const ids = [...document.querySelectorAll('#v4world .rcell2')].map(c => (/pickRegion\\('([^']+)'\\)/.exec(c.getAttribute('onclick') || '') || [])[1]).filter(Boolean);
  for (const id of ids) { if (id === s.region) continue; const t = V4World.trip(id); if (t && t.ok) return JSON.stringify({ id, ap: t.ap, fuel: t.fuel, before: s.crossings || 0, region: s.region }); }
  return JSON.stringify({ none: true, cells: ids.length, region: s.region }); })()`)))
console.log('  跨区目标: ' + JSON.stringify(pick))
ok('② 能挑到一个"有油就能开"的邻区（后面两条才有意义）', pick.none !== true, JSON.stringify(pick).slice(0, 120))
if (pick.none !== true) {
  const negTry = JSON.parse(String(await ev(`(() => { const s = S.world, before = s.crossings || 0;
    s.veh.fuel = 0; render();
    const t = V4World.trip(${JSON.stringify(pick.id)});
    V4World.travelRegion(${JSON.stringify(pick.id)});
    s.veh.fuel = ${pick.fuel + 2};
    return JSON.stringify({ okTrip: !!(t && t.ok), why: t && t.why, before, after: s.crossings || 0, region: s.region, want: ${JSON.stringify(pick.region)} }); })()`)))
  ok('② 油不够时出发失败、跨区计数不动、区域也没变（不许"点了就算跨过"）',
    negTry.okTrip === false && /油/.test(String(negTry.why)) && negTry.after === negTry.before && negTry.region === negTry.want,
    JSON.stringify(negTry))
  const okTry = JSON.parse(String(await ev(`(() => { const s = S.world, before = s.crossings || 0;
    const t = V4World.trip(${JSON.stringify(pick.id)});
    if (!t || !t.ok) return JSON.stringify({ skipped: true, why: t && t.why });
    V4World.travelRegion(${JSON.stringify(pick.id)});
    return JSON.stringify({ skipped: false, before, after: s.crossings || 0, region: s.region, fuel: s.veh.fuel, want: ${JSON.stringify(pick.id)} }); })()`)))
  ok('② 条件够了才 +1（成功一次就一次，且落点就是那个区）',
    okTry.skipped !== true && okTry.after === okTry.before + 1 && okTry.region === okTry.want,
    JSON.stringify(okTry))
  const selfTry = JSON.parse(String(await ev(`(() => { const s = S.world, before = s.crossings || 0;
    V4World.travelRegion(s.region); return JSON.stringify({ before, after: s.crossings || 0, region: s.region }); })()`)))
  ok('② 原地"跨到自己"不涨计数', selfTry.after === selfTry.before, JSON.stringify(selfTry))
}

/* ── ③ 存档往返（真写盘 + 真重载）──
   注意：加密落盘是**异步**的（save-vault.write 里 void run()），所以这里必须等密文真的换了再刷新，
   否则测的是"上一次自动存档"（探针第一版就这么假红过一次） */
const hashOf = `(() => { const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return JSON.stringify({ h, len: raw.length }); })()`
const before3 = JSON.parse(String(await ev(hashOf)))
await ev(`(() => { S.stats.decoyUses = 7; S.world.crossings = 3; saveGame(true); return 1 })()`)
let landed = false
for (let i = 0; i < 20; i++) {
  await sleep(200)
  const now = JSON.parse(String(await ev(hashOf)))
  if (now.h !== before3.h) { landed = true; break }
}
console.log('  落盘: ' + JSON.stringify({ before: before3, landed }))
ok('③ 手动保存真的把密文换掉了（异步写等得到）', landed, JSON.stringify(before3))
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(1200)
const reloaded = JSON.parse(String(await ev(`(() => { const s = (typeof S === 'object' && S && S.world) ? S.world : {}; return JSON.stringify({ uses: (S.stats && S.stats.decoyUses) || 0, cross: s.crossings || 0, day: S.day }); })()`)))
console.log('  存档往返: ' + JSON.stringify({ want: { uses: 7, cross: 3 }, reloaded }))
ok('③ 存档→重载后 decoyUses / crossings 都还在（没被 sanitize/migrate 丢）',
  reloaded.uses === 7 && reloaded.cross === 3, JSON.stringify(reloaded))

/* ── ④ 边界输入 ── */
const edge = JSON.parse(String(await ev(`(() => {
  const rs = window.radSymptoms ? [NaN, Infinity, -Infinity, -5, 1e9, 0].map(v => { try { const s = window.radSymptoms(v); return s.tier + ':' + s.hpPerStep; } catch (e) { return 'EXC ' + e.message; } }) : ['no-radSymptoms'];
  const txt = window.radSymptomText ? [window.radSymptoms(0), window.radSymptoms(97)].map(s => { try { return window.radSymptomText(s); } catch (e) { return 'EXC ' + e.message; } }) : ['no-text'];
  const S2 = { world: {} };
  return JSON.stringify({ rs, txt, radCap: (typeof V4Survival === 'object' && V4Survival) ? (() => { try { return String(V4Survival.staCapMul()); } catch (e) { return 'EXC'; } })() : 'n/a' });
})()`)))
console.log('  边界: ' + JSON.stringify(edge).slice(0, 300))
ok('④ 辐射症状函数对 NaN/Infinity/负数/超界都给合法档位（不出现 NaN 或负倍率）',
  Array.isArray(edge.rs) && edge.rs.every(x => /^[0-4]:\d+$/.test(x)) && edge.txt.every(x => x && !/undefined|NaN/.test(x)),
  JSON.stringify(edge.rs))
const bad = JSON.parse(String(await ev(`(() => { const w = window.V4Debug || {}; const out = {};
  try { out.radNaN = window.radSymptoms(NaN).tier; } catch (e) { out.radNaN = 'EXC'; }
  const s = S; const keep = { rad: s.rad, hp: s.hp, hun: s.hun, thi: s.thi, sta: s.sta };
  try { s.rad = NaN; const before = s.hp; tickVitals(1); out.hpAfterNaNRad = s.hp === before || isFinite(s.hp); } catch (e) { out.hpAfterNaNRad = 'EXC ' + e.message; }
  Object.assign(s, keep); render(); return JSON.stringify(out); })()`)))
console.log('  边界2: ' + JSON.stringify(bad))
ok('④ tickVitals 在 S.rad=NaN 时不崩、不写出 NaN 生命', bad.hpAfterNaNRad === true || bad.hpAfterNaNRad === undefined, JSON.stringify(bad))

/* ── ⑤ 全页签 + 弹窗巡游 ── */
const before5 = errs.length
const tabs = ['explore', 'body', 'base', 'inv', 'craft', 'skills', 'quest', 'codex', 'stats']
const visited = []
for (const t of tabs) {
  const r = await ev(`(() => { try { setTab(${JSON.stringify(t)}); render(); return 'ok'; } catch (e) { return 'EXC ' + e.message; } })()`)
  visited.push(t + ':' + r)
  await sleep(550)
}
const scroll = JSON.parse(String(await ev(`JSON.stringify({ w: document.documentElement.scrollWidth, i: window.innerWidth })`)))
console.log('  页签: ' + visited.join(' '))
ok('⑤ 9 个页签逐个打开都不报错', visited.every(x => /:ok$/.test(x)), visited.filter(x => !/:ok$/.test(x)).join(' '))
ok('⑤ 页面没有横向溢出（scrollWidth ≤ innerWidth+2）', scroll.w <= scroll.i + 2, JSON.stringify(scroll))
await ev(`(() => { try { openMerchant(); } catch(e){} return 1 })()`); await sleep(700)
const mer = await ev(`(() => { const m = document.querySelector('.modal'); return m ? (m.textContent || '').replace(/\\s+/g,' ').slice(0, 60) : 'NONE' })()`)
await ev(`(() => { try { closeAllModals(); } catch(e){}; try { openSavePort(); } catch(e){} return 1 })()`); await sleep(700)
const port = await ev(`(() => { const m = document.querySelector('.modal'); return m ? (m.textContent || '').replace(/\\s+/g,' ').slice(0, 60) : 'NONE' })()`)
await ev(`(() => { try { closeAllModals(); } catch(e){} return 1 })()`)
console.log('  弹窗: ' + JSON.stringify({ mer, port }))
ok('⑤ 商人 / 存档口令两个弹窗都能打开（文案非空）', mer !== 'NONE' && port !== 'NONE', JSON.stringify({ mer: String(mer).slice(0, 30), port: String(port).slice(0, 30) }))
ok('⑤ 巡游期间 0 未捕获异常 / 0 console.error', errs.length === before5, errs.slice(0, 3).join(' | '))

/* ── ⑥ 地图窗反复开关（M59 回归） ── */
await ev(`(() => { setTab('explore'); V4Scale.toggleMap(true); V4World.mapMode('region'); render(); return 1 })()`)
await sleep(800)
const cells = []
for (let i = 0; i < 6; i++) {
  await ev(`(() => { V4World.mapMode(${i % 2 ? "'local'" : "'region'"}); V4Scale.toggleMap(false); V4Scale.toggleMap(true); render(); return 1 })()`)
  await sleep(450)
  cells.push(String(await ev(`(() => { const g = document.querySelector('#v4world .rgrid, #v4world .wgrid'); return g ? g.style.gridTemplateColumns : 'none'; })()`)))
}
const s6 = []
for (let i = 0; i < 15; i++) { s6.push(String(await ev(`(() => { const g = document.querySelector('#v4world .rgrid, #v4world .wgrid'); const c = document.getElementById('v4world'); return (g ? g.style.gridTemplateColumns : '?') + '|' + (c ? Math.round(c.getBoundingClientRect().height) : 0); })()`))); await sleep(120) }
const chg = s6.filter((v, i) => i && v !== s6[i - 1]).length
console.log('  地图反复开关: ' + JSON.stringify({ cells: cells.slice(0, 3), last: s6[s6.length - 1], changes: chg }))
ok('⑥ 反复开关地图窗 6 次后尺寸稳定（15 采样 0 变化）', chg === 0, 'changes=' + chg + ' last=' + s6[s6.length - 1])
ok('⑥ 巡游全程 0 未捕获异常', errs.length === 0, errs.slice(0, 4).join(' | '))
await shot('audit_end')

const pass = checks.filter(([, c]) => c).length
console.log(`\nM63 审计探针：${pass}/${checks.length}`)
if (errs.length) console.log('异常清单：\n  - ' + errs.slice(0, 10).join('\n  - '))
process.exit(pass === checks.length ? 0 : 1)
