// M43 取证：每次行动后滚动不再跳回顶部（用户报障：「为啥每次行动后滚动会自动回到顶上，这不方便」）
//   ① 探索页滚到中部 → 点一次真按钮（就地休整/搜索）→ 滚动位置**保留**（原来会跳回 0）
//   ② 连点两次行动 → 仍然保留
//   ③ 换页签（背包 → 探索）→ 回顶部（新页面应该从头看）
//   ④ 日志面板：往上翻看历史 → 新日志不把玩家拽回底部；在底部时 → 跟着最新一行
//   ⑤ 地图窗（悬浮窗）里的滚动也能跨行动保留
//   ⑥ 0 未捕获异常
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
/* 用**宽而矮**的窗口（和用户截图一致：单列、内容长，滚动问题最明显） */
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 760, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await sleep(800)

/* 准备：探索页、有行动力、地图开在悬浮窗 */
await ev(`(() => {
  closeAllModals(); S.over = false; S.day = 3; S.ap = S.apMax; S.hp = Math.max(60, S.hp);
  window.V4Scale.setMapStyle('float'); V4Scale.toggleMap(true); setTab('explore'); render();
  return 1;
})()`)
await sleep(1500)

/* ① 滚到中部 → 点「就地休整」（真按钮）→ 偏移应保留 */
const scrollInfo = `(() => { const v = document.getElementById('view'); return JSON.stringify({ top: Math.round(v.scrollTop), h: v.scrollHeight, ch: v.clientHeight }) })()`
const before = JSON.parse(await ev(`(() => { const v = document.getElementById('view'); v.scrollTop = Math.round(v.scrollHeight * 0.55); return JSON.stringify({ top: Math.round(v.scrollTop), h: v.scrollHeight, ch: v.clientHeight }) })()`))
console.log('滚动前：' + JSON.stringify(before))
ok('页面够长、能滚（否则这条验不了）', before.h > before.ch + 200, JSON.stringify(before))
const clicked = await ev(`(() => { const b = [...document.querySelectorAll('#view button')].find(x => /就地休整/.test(x.textContent)); if (!b) return 'NO-BTN'; b.click(); return 'clicked'; })()`)
await sleep(1200)
const after1 = JSON.parse(await ev(scrollInfo))
/* 容差按内容比例给：上面那几行（行动力 / 今日行动）字数变了会让偏移漂几像素，那不是「跳回顶部」 */
const tol = Math.max(6, Math.round(before.h * 0.02))
ok('点一次「就地休整」后滚动位置保留（原来这里会跳回 0）', clicked === 'clicked' && Math.abs(after1.top - before.top) <= tol, JSON.stringify({ before: before.top, after: after1.top, tol }))
await shot('01_scroll_kept')

/* ② 再来一次（连点行动） */
const second = await ev(`(() => { const b = [...document.querySelectorAll('#view button')].find(x => /就地休整/.test(x.textContent)); if (!b) return 'NO-BTN'; b.click(); return 'clicked'; })()`)
await sleep(1100)
const after2 = JSON.parse(await ev(scrollInfo))
ok('连着再点一次仍然保留', second === 'clicked' && Math.abs(after2.top - after1.top) <= tol, JSON.stringify({ after1: after1.top, after2: after2.top, tol }))

/* ③ 换页签 → 回顶部 */
await ev(`(() => { setTab('inv'); return 1 })()`); await sleep(900)
const invTop = JSON.parse(await ev(scrollInfo))
await ev(`(() => { const v = document.getElementById('view'); v.scrollTop = 300; return 1 })()`); await sleep(200)
await ev(`(() => { setTab('explore'); return 1 })()`); await sleep(1000)
const backExplore = JSON.parse(await ev(scrollInfo))
ok('换页签回顶部（背包 → 探索：新页面从头看）', invTop.top === 0 && backExplore.top === 0, JSON.stringify({ inv: invTop.top, explore: backExplore.top }))

/* ④ 日志面板：往上翻 → 不被拽走；贴底时 → 新日志可见
   注意所有"设完立刻读"都放在**同一个 evaluate** 里 —— 分成两次读会被面板自己的异步更新插进来（踩过）。
   往上翻的位置要**离底部足够远**（日志一直在长，离太近的话下一行到达时就已经算"贴底"了）。 */
await ev(`(() => { clearLog(); replayLog(); return 1 })()`); await sleep(400)
const upTop = Number(await ev(`(() => {
  const b = document.getElementById('log');
  const max = Math.max(0, b.scrollHeight - b.clientHeight);
  b.scrollTop = Math.max(40, Math.round(max * 0.3));
  return Math.round(b.scrollTop);
})()`))
await sleep(120)
const upGap = Number(await ev(`(() => { const b = document.getElementById('log'); return b.scrollHeight - b.scrollTop - b.clientHeight })()`))
const afterLogTop = Number(await ev(`(() => { log('M43 探针 A：往上翻时不该被拽走', 'info'); return Math.round(document.getElementById('log').scrollTop) })()`))
/* 只等一帧多一点：这一段才是本次逻辑负责的窗口（"补底"那一下就在这一帧）。
   判定口径用**"离底部还很远"**而不是精确相等 —— 面板高度会因为日志行的增删抖一行（浏览器布局），
   那不是"被拽回底部"；真正要守住的是"没被拽到底"。 */
await sleep(160)
const afterLogTop2 = Number(await ev(`(() => { const b = document.getElementById('log'); return JSON.stringify({ top: Math.round(b.scrollTop), h: b.scrollHeight, ch: b.clientHeight }) })()`).then(r => JSON.parse(r).top))
const logBoxAfter = JSON.parse(await ev(`(() => { const b = document.getElementById('log'); return JSON.stringify({ top: Math.round(b.scrollTop), h: b.scrollHeight, ch: b.clientHeight }) })()`))
const awayFromBottom = logBoxAfter.h - logBoxAfter.top - logBoxAfter.ch
ok('日志往上翻时，新日志不会把玩家拽回底部（离底部仍很远）', upTop > 40 && upGap > 60 && awayFromBottom > 40 && logBoxAfter.top > 40, JSON.stringify({ up: upTop, upGap, right_after: afterLogTop, next_frame: afterLogTop2, awayFromBottom, box: logBoxAfter }))

await ev(`(() => { const b = document.getElementById('log'); b.scrollTop = b.scrollHeight; return 1 })()`); await sleep(200)
await ev(`(() => { log('M43 探针 B：贴底时应该跟着滚', 'info'); return 1 })()`)
/* 判定口径：**稳定之后**离底部的距离始终 ≤60px（约一行半）。
   为什么先等 700ms：日志是流式追加的，"刚 append、还没补底"的那一帧必然差一行；
   而最后一行的高度有时要几百毫秒才定下来（换行/滚动条），补底逻辑会在这段时间里反复收敛。
   要守住的是"收敛到一行以内，并且不会越漂越远"。 */
await sleep(700)
const gaps = []
for (let i = 0; i < 5; i++) {
  await sleep(220)
  gaps.push(Number(await ev(`(() => { const b = document.getElementById('log'); return b.scrollHeight - b.scrollTop - b.clientHeight })()`)))
}
const maxGap = Math.max(...gaps)
ok('日志本来在底部时，新日志跟着滚（稳定后离底部不超过一行半）', maxGap <= 60, JSON.stringify({ gaps, maxGap }))
await shot('02_log_scroll')

/* ⑤ 地图悬浮窗里的滚动：跨行动保留 */
const mapInfo = `(() => { const b = document.querySelector('#v4mapwin .mwbody'); return JSON.stringify({ top: Math.round(b.scrollTop), h: b.scrollHeight, ch: b.clientHeight }) })()`
const mapBefore = JSON.parse(await ev(`(() => { const b = document.querySelector('#v4mapwin .mwbody'); b.scrollTop = 120; return JSON.stringify({ top: Math.round(b.scrollTop), h: b.scrollHeight, ch: b.clientHeight }) })()`))
const moved = await ev(`(() => { const c = [...document.querySelectorAll('#v4mapwin .wgrid .wcell')]; const here = document.querySelector('#v4mapwin .wcell.cur'); const cand = c.filter(x => x.getAttribute('onclick') && x !== here).slice(0, 6); if (!cand.length) return 'NO-CELL'; cand[0].click(); return 'clicked'; })()`)
await sleep(1600)
const mapAfter = JSON.parse(await ev(mapInfo))
ok('地图窗里滚动的偏移在行动（移动/搜索）之后也保留', moved === 'clicked' && mapAfter.top > 0, JSON.stringify({ before: mapBefore.top, after: mapAfter.top, moved }))

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
