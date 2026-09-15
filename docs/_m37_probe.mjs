// M37 取证：通关好结局 → 无尽模式 那一段不再"直接死 + 地图变旧版"
//   ① 第 100 天救援结局（rescueEnding）确实把本局置为"已结束"（over=true，v4 世界面板收工）
//   ② 但 HUD「下一步」不再骗玩家说"你倒下了"，而是指向无尽模式
//   ③ 点真按钮进无尽 → over 清掉、卡片墙/地图回来、顶栏改"第 N 天 · 无尽"、日历目标牌换无尽
//   ④ 进无尽后真的能动：地图格子可点着走路（AP 会扣、位置会变），S.over 一直是 false
//   ⑤ 睡到第 102 天不会突然暴毙（玩家报的"直接死"就是这个）
//   ⑥ 刷新页面后仍是无尽局（标志落盘），不退回"已结束"
//   ⑦ 从死亡界面进无尽 → 救回三成血、地图回来（不是 0 血活死人）
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const BOOT = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready'   // 线上复核会带 ?v= 破缓存，别把参数拼坏
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
/* 线上比本地慢（account.js/加密 worker 要联网拉），固定 sleep 会撞上"引导没跑完就调函数"的 ReferenceError */
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
// 世界面板体检：卡片墙 + 地图格子 + 顶栏天数 + 日历目标牌
const ui = () => ev(`(() => {
  const view = document.getElementById('view');
  const map = document.getElementById('v4world');
  const clock = document.getElementById('clock-day');
  return JSON.stringify({
    over: !!S.over, hp: S.hp, day: S.day, ap: S.ap, loc: S.loc, endless: !!S.flags.endless, won: !!S.flags.won,
    board: !!document.getElementById('v4cards'), boardCls: view ? view.className : '', cells: map ? map.querySelectorAll('.wcell').length : -1,
    clock: clock ? clock.textContent.trim() : null,
    endlessChip: /无尽模式 · 难度随天数长/.test(document.body.textContent),
    nextStep: (document.getElementById('next-step') || {}).textContent || '',
    lastLog: (S.logBuf || []).slice(-1).map(p => p[1]).join('').slice(0, 60),
  })
})()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(500)

/* ① 第 100 天好结局（走真实函数 rescueEnding，它会 S.over = true） */
const resc = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  S.quest.stage = 6; S.flags.won = false; S.flags.cured = false; S.flags.endless = false; S.over = false;
  S.day = 101; S.hp = 88; S.base.radio = 1; S.tab = 'explore'; render();
  rescueEnding();
  return JSON.stringify({ over: !!S.over, won: !!S.flags.won, hp: S.hp, modal: !!document.querySelector('#overlay-root .modal-bd') });
})()`))
await sleep(900)
const a1 = JSON.parse(await ui())
ok('第 100 天好结局：本局确实置为"已结束"（over=true、won=true）', resc.over === true && resc.won === true, JSON.stringify(resc))
ok('已结束状态下 v4 世界面板收工（这就是玩家说的"地图变旧版"）', a1.board === false && !/v4-board/.test(a1.boardCls), JSON.stringify({ board: a1.board, cls: a1.boardCls }))
await shot('01_rescue_ending')

/* ② 关掉弹窗后，HUD「下一步」必须指向无尽，而不是"你倒下了" */
const hint = JSON.parse(await ev(`(() => {
  closeAllModals(); render();
  const ns = document.getElementById('next-step');
  return JSON.stringify({ txt: ns ? ns.textContent.replace(/\\s+/g, ' ').trim() : null, btn: ns && ns.querySelector('button') ? ns.querySelector('button').textContent.trim() : null,
    hudBtn: [...document.querySelectorAll('#hud button')].map(b => b.textContent.trim()) });
})()`))
ok('「下一步」不再说"你倒下了"，改成指路无尽模式', /无尽模式/.test(hint.txt || '') && !/倒下/.test(hint.txt || ''), JSON.stringify(hint.txt))
ok('HUD 上有可点的「进入无尽模式」按钮', (hint.hudBtn || []).some(t => /进入无尽模式/.test(t)), JSON.stringify(hint.hudBtn))

/* ③ 点真按钮（不直接调函数）→ over 清掉、世界面板回来 */
const clicked = await ev(`(() => {
  const b = [...document.querySelectorAll('#hud button')].find(b => /进入无尽模式/.test(b.textContent));
  if (!b) return 'NO-BTN';
  b.click(); return 'clicked';
})()`)
await sleep(2000)
const a2 = JSON.parse(await ui())
ok('点了 HUD 的「进入无尽模式」（真点击路径）', clicked === 'clicked', clicked)
ok('进无尽后 S.over 被清掉（地图不再退化成旧版）', a2.over === false, JSON.stringify({ over: a2.over, hp: a2.hp }))
ok('卡片墙 + 地图格子都回来了', a2.board === true && /v4-board/.test(a2.boardCls) && a2.cells > 300, JSON.stringify({ board: a2.board, cls: a2.boardCls, cells: a2.cells }))
ok('顶栏天数不再显示"101 / 100"，改无尽样式', /第 101 天 · 无尽/.test(a2.clock || ''), JSON.stringify(a2.clock))
ok('日历目标牌换成无尽（不再喊"活到第 100 天"）', a2.endlessChip === true, String(a2.endlessChip))

/* ③b 结局卡要能点「继续」关掉 —— 关不掉的话玩家还是"卡死"感（截图也要留关掉之后的世界） */
const dismissed = await ev(`(() => {
  const b = document.querySelector('#overlay-root [data-close]');
  if (!b) return 'NO-BTN';
  b.click(); return 'clicked';
})()`)
await sleep(1200)
const vis = JSON.parse(await ev(`(() => {
  const card = document.getElementById('v4cards'), map = document.getElementById('v4mapwin');
  const rc = card ? card.getBoundingClientRect() : null, rm = map ? map.getBoundingClientRect() : null;
  return JSON.stringify({ overlays: document.querySelectorAll('#overlay-root .modal-bd').length,
    cards: rc ? [Math.round(rc.width), Math.round(rc.height)] : null, map: rm ? [Math.round(rm.width), Math.round(rm.height)] : null });
})()`))
ok('结局卡能点「继续」关掉（关不掉 = 还是卡死感）', dismissed === 'clicked' && vis.overlays === 0, JSON.stringify({ dismissed, overlays: vis.overlays }))
ok('关掉后卡片墙与地图在屏幕上真的有尺寸（不是 display:none）', !!vis.cards && vis.cards[0] > 200 && vis.cards[1] > 200 && !!vis.map && vis.map[0] > 100, JSON.stringify(vis))
await shot('02_endless_map')

/* ④ 真的能动：从地图上找一格可点的路走过去（AP 扣、位置变、over 保持 false） */
const walk = JSON.parse(await ev(`(() => {
  const before = { ap: S.ap, loc: S.loc, day: S.day };
  const cells = [...document.querySelectorAll('#v4world .wcell[onclick]')]
    .map(c => (c.getAttribute('onclick') || '').match(/V4World\\.click\\((\\d+),(\\d+)\\)/)).filter(Boolean)
    .map(m => [Number(m[1]), Number(m[2])]);
  if (!cells.length) return JSON.stringify({ err: 'NO-CELL', before });
  let moved = null;
  for (const [x, y] of cells.slice(0, 12)) {
    try { V4World.travel(x, y); } catch (e) { continue; }
    if (S.loc !== before.loc || S.ap !== before.ap) { moved = { x, y }; break; }
  }
  return JSON.stringify({ before, after: { ap: S.ap, loc: S.loc }, moved, over: !!S.over,
    log: (S.logBuf || []).slice(-2).map(p => p[1]).join(' | ').slice(0, 90) });
})()`))
await sleep(1200)
ok('进无尽后地图能点着走路（找到相邻格并移动）', !!walk.moved, JSON.stringify(walk))
ok('行动力真的会被扣（不是死界面）', walk.after && walk.after.ap < walk.before.ap, JSON.stringify({ ap: walk.after && walk.after.ap, before: walk.before.ap }))
ok('移动过程中 over 一直是 false', walk.over === false, String(walk.over))

/* ⑤ 睡到第 102 天不能突然暴毙（玩家报的"直接死"） */
const night = JSON.parse(await ev(`(() => {
  const before = { day: S.day, hp: S.hp };
  try { sleepNight(); } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
  return JSON.stringify({ before, day: S.day, hp: S.hp, over: !!S.over, ap: S.ap, battle: !!window.V4Battle || !!document.querySelector('#overlay-root .modal-bd') });
})()`))
await sleep(2500)
const a3 = JSON.parse(await ui())
ok('睡过一夜：天数前进、没死（over=false、血 > 0）', night.day > night.before.day && a3.over === false && a3.hp > 0, JSON.stringify({ night, after: { over: a3.over, hp: a3.hp, day: a3.day } }))
ok('夜里没把地图弄丢（卡片墙还在）', a3.board === true, JSON.stringify({ board: a3.board, cls: a3.boardCls }))
await shot('03_after_sleep')
await ev(`(() => { try { closeAllModals(); } catch (e) {} return 1 })()`); await sleep(400)

/* ⑥ 刷新页面：无尽标志要落盘，不能退回"已结束" */
await ev(`(() => { try { autosave(); } catch (e) {} return 1 })()`); await sleep(600)
await send('Page.navigate', { url: BOOT }); await bootWait()
const a4 = JSON.parse(await ui())
ok('刷新后仍是无尽局（flags.endless 落盘）', a4.endless === true && a4.over === false, JSON.stringify({ endless: a4.endless, over: a4.over, day: a4.day }))
ok('刷新后地图与卡片墙仍在', a4.board === true && a4.cells > 300, JSON.stringify({ board: a4.board, cells: a4.cells }))

/* ⑦ 从死亡界面进无尽：救回三成血，地图回来 */
const dead = JSON.parse(await ev(`(() => {
  closeAllModals(); S.flags.endless = false; S.flags.won = true; S.hp = 5; S.over = false; S.ap = 0; S.day = 44; render();
  gameOver('M37 探针：模拟倒在废墟里');
  return JSON.stringify({ over: !!S.over, hp: S.hp, ap: S.ap });
})()`))
await sleep(1200)
await ev(`(() => { closeAllModals(); S.tab = 'quest'; render(); return 1 })()`); await sleep(900)
await shot('04_death_quest')
const qbtn = await ev(`(() => {
  const b = [...document.querySelectorAll('#view button')].find(b => /进入无尽模式/.test(b.textContent));
  if (!b) return 'NO-BTN';
  b.click(); return 'clicked';
})()`)
await sleep(2000)
const a5 = JSON.parse(await ui())
ok('从任务页「进入无尽模式」点进来（死亡状态）', qbtn === 'clicked', qbtn)
ok('死亡状态进无尽会救回血（不再是 0 血活死人）', dead.hp === 0 && a5.hp > 0 && a5.over === false, JSON.stringify({ dead: dead.hp, hp: a5.hp, over: a5.over }))
ok('复活后地图/卡片墙立即恢复', a5.board === true && /v4-board/.test(a5.boardCls), JSON.stringify({ board: a5.board, cls: a5.boardCls }))
ok('日志里写了"又睁开眼"（玩家能看懂的交代）', /又睁开眼/.test(a5.lastLog || '') || /又睁开眼/.test((await ev(`(S.logBuf||[]).map(p=>p[1]).join('|')`)) || ''), a5.lastLog)
await ev(`(() => { const b = document.querySelector('#overlay-root [data-close]'); if (b) b.click(); return 1 })()`); await sleep(1200)
const vis5 = JSON.parse(await ev(`(() => {
  const card = document.getElementById('v4cards'); const rc = card ? card.getBoundingClientRect() : null;
  const map = document.getElementById('v4mapwin'); const rm = map ? map.getBoundingClientRect() : null;
  return JSON.stringify({ overlays: document.querySelectorAll('#overlay-root .modal-bd').length,
    hp: S.hp, over: !!S.over, cards: rc ? [Math.round(rc.width), Math.round(rc.height)] : null, map: rm ? [Math.round(rm.width), Math.round(rm.height)] : null });
})()`))
ok('复活后的世界真的在屏幕上（卡片墙有尺寸、没残留弹窗）', vis5.overlays === 0 && !!vis5.cards && vis5.cards[0] > 200 && !!vis5.map && vis5.map[0] > 100 && vis5.over === false, JSON.stringify(vis5))
await shot('05_endless_after_death')

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
