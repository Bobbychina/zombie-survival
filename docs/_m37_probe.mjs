// M51 回归取证：通关之后**界面不许再退回旧版**（老版本残留整条删除）。
// 背景（用户报障）：通关后屏幕上出现旧版「城市地图」卡 + 「📅 本局已通关」图例，而且整个界面都退回旧版。
//   根因：rescueEnding() 把 S.over 置 true（"本局已结束"），而 v4 世界面板/移动/夜间结算都以 over 为总闸
//   （world-ui 的 `if (!S || S.over)`）→ 整屏交回 legacy 探索页。M51 起：通关当场进入无尽延续，over 不置。
// 断言（全部走真实函数/真实点击，不手搓旗标）：
//   ① rescueEnding()：over 仍为 false、endless 打开、血不动；v4 卡片墙 + 地图格子照旧在
//   ② 页面上再也找不到旧版残留：无「城市地图」「本局已通关」，也没有「进入无尽模式」按钮
//   ③ 关掉结局弹窗后还能真的动（地图可走、AP 会扣、over 一直 false）
//   ④ finalVictory()（取回解药那条线）同样是无尽延续，不是"局已结束"
//   ⑤ 死亡是唯一还会 over=true 的情形：v4 自己画结束卡（#v4over + #view.v4-over），旧版探索页被隐藏
//   ⑥ 重开一局后结束态撤掉，界面回到正常探索页
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
/* 界面体检：v4 世界面板 + 旧版残留文本 + 结束态 */
const ui = () => ev(`(() => {
  const view = document.getElementById('view');
  const map = document.getElementById('v4world');
  const clock = document.getElementById('clock-day');
  const txt = document.body.textContent || '';
  const legacyCard = [...document.querySelectorAll('#view .sect-title')].find(e => /城市地图/.test(e.textContent || ''));
  const over = document.getElementById('v4over');
  const rs = over ? getComputedStyle(over) : null;
  return JSON.stringify({
    over: !!S.over, hp: S.hp, day: S.day, ap: S.ap, endless: !!S.flags.endless, won: !!S.flags.won,
    board: !!document.getElementById('v4cards'), boardCls: view ? view.className : '',
    cells: map ? map.querySelectorAll('.wcell').length : -1,
    clock: clock ? clock.textContent.trim() : null,
    oldMapText: /城市地图/.test(txt), oldWonText: /本局已通关/.test(txt),
    endlessBtn: [...document.querySelectorAll('button')].some(b => /进入无尽模式/.test(b.textContent || '')),
    overCard: !!over, overCardShown: !!(rs && rs.display !== 'none'), overCardSize: over ? [over.offsetWidth, over.offsetHeight] : null,
    liveLegacy: !!legacyCard && getComputedStyle(legacyCard).display !== 'none',
    nextStep: (document.getElementById('next-step') || {}).textContent || '',
  })
})()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(500)

/* ① 第 100 天救援结局：走真实函数 rescueEnding()，通关 = 无尽延续（不置 over） */
const resc = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  S.quest.stage = 6; S.flags.won = false; S.flags.cured = false; S.flags.endless = false; S.over = false;
  S.day = 100; S.hp = 88; S.base.radio = 1; S.tab = 'explore'; render();
  rescueEnding();
  return JSON.stringify({ over: !!S.over, won: !!S.flags.won, endless: !!S.flags.endless, hp: S.hp, ap: S.ap,
    modal: !!document.querySelector('#overlay-root .modal-bd') });
})()`))
await sleep(1200)
const a1 = JSON.parse(await ui())
ok('通关（第 100 天救援）：over 保持 false、endless 打开、血不动', resc.over === false && resc.endless === true && resc.hp === 88, JSON.stringify(resc))
ok('通关后 v4 卡片墙 + 地图格子照旧在（没有退回旧版）', a1.board === true && /v4-board/.test(a1.boardCls) && a1.cells > 300, JSON.stringify({ board: a1.board, cls: a1.boardCls, cells: a1.cells }))
ok('顶栏按无尽显示，不是 "101 / 100"', /第 100 天 · 无尽/.test(a1.clock || ''), JSON.stringify(a1.clock))
ok('旧版残留清干净：无「城市地图」、无「本局已通关」、无「进入无尽模式」按钮', !a1.oldMapText && !a1.oldWonText && !a1.endlessBtn, JSON.stringify({ oldMapText: a1.oldMapText, oldWonText: a1.oldWonText, endlessBtn: a1.endlessBtn }))
ok('「下一步」不说"你倒下了"（这是通关，不是死亡）', !/倒下/.test(a1.nextStep || ''), JSON.stringify(a1.nextStep.slice(0, 60)))
await shot('01_rescue_ending')

/* ② 关掉结局弹窗：界面仍是 v4，而且真的能动 */
const dismissed = await ev(`(() => { const b = document.querySelector('#overlay-root [data-close]'); if (!b) return 'NO-BTN'; b.click(); return 'clicked' })()`)
await sleep(900)
const walk = JSON.parse(await ev(`(() => {
  closeAllModals();
  const cur = () => V4.worldstate.ensureSaveWorld(S).cur;
  const before = { ap: S.ap, x: cur().x, y: cur().y };
  const cells = [...document.querySelectorAll('#v4world .wcell[onclick]')]
    .map(c => (c.getAttribute('onclick') || '').match(/V4World\\.(?:click|travel)\\((\\d+),(\\d+)\\)/)).filter(Boolean)
    .map(m => [Number(m[1]), Number(m[2])]);
  if (!cells.length) return JSON.stringify({ err: 'NO-CELL', before });
  let moved = null;
  for (const [x, y] of cells.slice(0, 12)) {
    try { V4World.travel(x, y); } catch (e) { continue; }
    if (cur().x !== before.x || cur().y !== before.y || S.ap !== before.ap) { moved = { x, y }; break; }
  }
  return JSON.stringify({ before, after: { ap: S.ap, x: cur().x, y: cur().y }, moved, over: !!S.over });
})()`))
await sleep(1000)
const a2 = JSON.parse(await ui())
ok('结局弹窗能点掉（点不掉 = 卡死感）', dismissed === 'clicked' && a2.board === true, JSON.stringify({ dismissed }))
ok('关掉之后地图能点着走（AP 真的被扣，通关不是"死界面"）', !!walk.moved && walk.after.ap < walk.before.ap && walk.over === false, JSON.stringify(walk))
ok('走动期间界面一直是 v4（卡片墙 + 地图窗都在）', a2.board === true && /v4-board/.test(a2.boardCls), JSON.stringify({ board: a2.board, cls: a2.boardCls }))
await shot('02_after_win_move')

/* ③ 另一条通关线：finalVictory()（取回解药）也必须是无尽延续 */
const fin = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  S.flags.won = false; S.flags.endless = false; S.over = false; S.hp = 90; S.tab = 'explore'; render();
  finalVictory();
  return JSON.stringify({ over: !!S.over, won: !!S.flags.won, cured: !!S.flags.cured, endless: !!S.flags.endless, hp: S.hp });
})()`))
await sleep(1200)
const a3 = JSON.parse(await ui())
ok('取回解药通关：同样 over=false + endless=true', fin.over === false && fin.won === true && fin.endless === true && fin.hp === 90, JSON.stringify(fin))
ok('取回解药通关后界面也是 v4，旧版残留仍然找不到', a3.board === true && !a3.oldMapText && !a3.oldWonText, JSON.stringify({ board: a3.board, oldMapText: a3.oldMapText, oldWonText: a3.oldWonText }))

/* ④ 死亡：唯一还会 over=true 的情形 —— v4 自己画结束卡，旧版探索页整块隐藏 */
const dead = JSON.parse(await ev(`(() => {
  closeAllModals(); S.hp = 5; S.over = false; S.tab = 'explore'; render();
  gameOver('M51 探针：模拟倒在废墟里');
  return JSON.stringify({ over: !!S.over, hp: S.hp });
})()`))
await sleep(1200)
await ev(`(() => { closeAllModals(); render(); return 1 })()`)
await sleep(800)
const a4 = JSON.parse(await ui())
ok('死亡仍然置 over=true + 血归零（唯一保留的"已结束"状态）', dead.over === true && dead.hp === 0, JSON.stringify(dead))
ok('死亡时 v4 自己画结束卡（#v4over 在屏幕上、有尺寸）', a4.overCard === true && a4.overCardShown === true && !!a4.overCardSize && a4.overCardSize[0] > 200, JSON.stringify({ card: a4.overCard, shown: a4.overCardShown, size: a4.overCardSize }))
ok('旧版探索页内容被隐藏（日历卡不可见），不再是"整个界面退回老版本"', a4.liveLegacy === false, JSON.stringify({ liveLegacy: a4.liveLegacy }))
ok('死亡时也找不到旧版残留文本', !a4.oldMapText && !a4.oldWonText, JSON.stringify({ oldMapText: a4.oldMapText, oldWonText: a4.oldWonText }))
await shot('03_death_endcard')

/* ⑤ 重开一局：结束态撤掉，回到正常探索页 */
const restarted = await ev(`(() => { try { restart(); } catch (e) { return 'EXC ' + e.message } try { closeAllModals(); } catch (e) {} return 1 })()`)
await sleep(2000)
const a5 = JSON.parse(await ui())
ok('重开后回到正常探索页（结束卡撤掉、卡片墙回来）', restarted === 1 && a5.over === false && a5.board === true && a5.overCard === false && !/v4-over/.test(a5.boardCls), JSON.stringify({ restarted, over: a5.over, board: a5.board, cls: a5.boardCls, card: a5.overCard }))
await shot('04_after_restart')

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter((c) => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
