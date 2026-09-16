// M49 取证：现场日志又跟得上最新一行了（用户报障：「现场日志不知道为什么无法自动滚动」）
//   ① 连打 40 行（40ms 一行，模拟战斗刷屏）→ 离底 ≈0（旧版实测离底 2323px，一动不动）
//   ② 三种窗口（1600×1000 / 2037×734 / 390×844）都要跟住 —— 宽而矮的窗口正是用户常遇到的形态
//   ③ #log 仍然是 scroll-behavior:smooth（修的是判定逻辑，不是把平滑滚动一关了事）
//   ④ 玩家往上翻（轮子 deltaY<0）→ 之后来的日志**不许**把人拽回去（位置不动、离底仍大）
//   ⑤ 玩家滚回底部 → 新日志继续跟；真实动作（搜索）打了多行日志也跟住
//   ⑥ 0 未捕获异常
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
    const r = await ev(`(() => (typeof S === 'object' && !!S && typeof log === 'function' && !!document.getElementById('log')) ? 1 : 0)()`)
    if (r === 1) return true
    await sleep(800)
  }
  return false
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })

for (const [w, h] of [[1600, 1000], [2037, 734], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 })
  await send('Page.navigate', { url: url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready' })
  const up = await bootWait()
  await sleep(900)
  const r = JSON.parse(await ev(`(async () => {
    const b = document.getElementById('log');
    const d = () => Math.round(b.scrollHeight - b.scrollTop - b.clientHeight);
    clearLog();
    for (let i = 1; i <= 40; i++) { log('现场日志自动滚动复查第 ' + i + ' 行：这一行故意写长一点，好把面板顶满，看看它还跟不跟最新一行。', 'info'); await new Promise(r2 => setTimeout(r2, 40)); }
    await new Promise(r2 => setTimeout(r2, 900));
    const follow = { d: d(), top: Math.round(b.scrollTop), behavior: getComputedStyle(b).scrollBehavior };
    /* 玩家往上翻：之后来的日志不许把人拽回去 */
    b.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true }));
    const topUp = Math.round(b.scrollTop);
    for (let i = 1; i <= 5; i++) { log('（玩家正在往上看，这一行不该把我拽回去）' + i, 'dim'); await new Promise(r2 => setTimeout(r2, 60)); }
    await new Promise(r2 => setTimeout(r2, 700));
    const afterUp = { d: d(), top: Math.round(b.scrollTop), moved: Math.abs(Math.round(b.scrollTop) - topUp) };
    /* 滚回底部：应该重新跟上（模拟玩家把内容拖到底：先把位置落到底，再补一记向下的轮子，然后等落定） */
    const behavior = b.style.scrollBehavior;
    b.style.scrollBehavior = 'auto';                 // 合成手势没法真滚 DOM：这一跳就是"玩家已经拖到底"的结果
    b.scrollTop = b.scrollHeight;
    b.style.scrollBehavior = behavior;
    b.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true }));
    await new Promise(r2 => setTimeout(r2, 420));    // 落定判定 140ms + 余量
    for (let i = 1; i <= 5; i++) { log('（回到最新一行之后继续跟）' + i, 'dim'); await new Promise(r2 => setTimeout(r2, 60)); }
    await new Promise(r2 => setTimeout(r2, 800));
    const back = { d: d() };
    /* 拖滚动条那条路也要能重新跟上：mousedown（玩家动作）→ 拖到底 → 落定 */
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.style.scrollBehavior = 'auto'; b.scrollTop = b.scrollHeight; b.style.scrollBehavior = behavior;
    await new Promise(r2 => setTimeout(r2, 420));
    for (let i = 1; i <= 3; i++) { log('（拖滚动条到底之后继续跟）' + i, 'dim'); await new Promise(r2 => setTimeout(r2, 60)); }
    await new Promise(r2 => setTimeout(r2, 700));
    const drag = { d: d() };
    return JSON.stringify({ follow, afterUp, back, drag, h: b.clientHeight, sh: b.scrollHeight });
  })()`))
  ok(`${w}×${h}：页面起来了`, up === true, String(up))
  ok(`${w}×${h}：连打 40 行仍然跟到最新一行（离底 ≤2px）`, r.follow && r.follow.d <= 2, JSON.stringify(r.follow))
  ok(`${w}×${h}：平滑滚动还在（修的是判定，不是关掉 smooth）`, r.follow && r.follow.behavior === 'smooth', r.follow && r.follow.behavior)
  ok(`${w}×${h}：玩家往上翻之后，新日志不把人拽回去`, r.afterUp && r.afterUp.moved <= 2 && r.afterUp.d > 100, JSON.stringify(r.afterUp))
  ok(`${w}×${h}：滚回底部之后继续跟（离底 ≤2px）`, r.back && r.back.d <= 2, JSON.stringify(r.back))
  ok(`${w}×${h}：拖滚动条到底之后也继续跟（离底 ≤2px）`, r.drag && r.drag.d <= 2, JSON.stringify(r.drag))
  if (w === 1600) await shot('01_follow_after_40')
  if (w === 390) await shot('02_follow_mobile')
}

/* 真实动作：搜索几次（每次都会写好几行日志 + 触发 render），面板要跟住 */
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready' })
await bootWait(); await sleep(900)
const real = JSON.parse(await ev(`(async () => {
  const b = document.getElementById('log');
  const d = () => Math.round(b.scrollHeight - b.scrollTop - b.clientHeight);
  clearLog(); closeAllModals();
  S.over = false; S.ap = S.apMax; S.hp = S.hpMax;
  setTab('explore');
  await new Promise(r => setTimeout(r, 400));
  let acted = 0;
  for (let i = 0; i < 6; i++) {
    try { if (window.V4World && V4World.search) { V4World.search(0); acted++; } } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    S.ap = S.apMax;                                   // 行动力管够：这一步只想看日志跟不跟
  }
  await new Promise(r => setTimeout(r, 900));
  const afterSearch = d();
  /* 中间夹几次 render()（每次行动都会走）：以前 render 的 restoreScroll 会把跟随关掉 → 日志再也不跟 */
  for (let i = 0; i < 3; i++) { render(); await new Promise(r => setTimeout(r, 200)); }
  for (let i = 0; i < 4; i++) { log('（render 之后继续跟）' + i, 'dim'); await new Promise(r => setTimeout(r, 60)); }
  await new Promise(r => setTimeout(r, 800));
  return JSON.stringify({ acted, afterSearch, d: d(), lines: b.children.length, top: Math.round(b.scrollTop), behavior: getComputedStyle(b).scrollBehavior, log: (S.logBuf || []).slice(-2).map(p => p[1]).join(' | ') });
})()`))
await sleep(400)
ok('真实动作（连搜 6 次、每次好几行日志）也跟到最新一行', real && real.acted >= 5 && real.afterSearch <= 2 && real.lines >= 6, JSON.stringify(real))
ok('行动触发的 render() 不会把跟随关掉（render 的 scroll 还原算"我们自己滚的"）', real && real.d <= 2, JSON.stringify({ d: real.d, top: real.top }))
await shot('03_follow_real_actions')

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
