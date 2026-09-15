// M40 取证：QoL 第三批（地图窗内滚 / 字号跟随所有页签与沙盒 / 手机单指拖动 + 触控命中区）
//   ① 145% / 160%：地图悬浮窗整个留在视口内（不再被顶出屏幕），窗里只有**一个**滚动容器
//   ② 字号：背包行、任务页折叠条、教程沙盒都跟着 --fs 一起放大（以前只有探索页卡片墙跟随）
//   ③ 手机：地图格子 ≥26px 命中区、单指拖动真的能平移地图（合成触摸手势后 scrollLeft 变了）
//   ④ 桌面回归：1600 宽下地图依旧一屏装下（格子 24px、无横向滚动）
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

const mapFacts = `(() => {
  const win = document.getElementById('v4mapwin');
  if (!win) return JSON.stringify({ err: 'NO-WIN' });
  const r = win.getBoundingClientRect();
  const body = win.querySelector('.mwbody'), wrap = win.querySelector('.wmapwrap'), grid = win.querySelector('.wgrid');
  /* 真正的"滚动容器"= 该轴 overflow 是 auto/scroll 且内容超了（overflow:visible 的元素 scrollWidth 也会大，
     但它不可滚，不该算进来 —— 第一版就是这么误判成 2 层的） */
  const scrolls = (e, axis) => {
    if (!e) return false;
    const cs = getComputedStyle(e);
    const ov = axis === 'x' ? cs.overflowX : cs.overflowY;
    if (ov !== 'auto' && ov !== 'scroll') return false;
    return axis === 'x' ? e.scrollWidth - e.clientWidth > 2 : e.scrollHeight - e.clientHeight > 2;
  };
  const scrollers = [body, wrap].filter(e => scrolls(e, 'x') || scrolls(e, 'y'));
  const cell = win.querySelector('.wcell');
  return JSON.stringify({
    fs: window.V4Scale.prefs().fs,
    win: [Math.round(r.width), Math.round(r.height), Math.round(r.bottom), Math.round(r.right)],
    vw: window.innerWidth, vh: window.innerHeight,
    bottomOK: Math.round(r.bottom) <= window.innerHeight - 4, rightOK: Math.round(r.right) <= window.innerWidth - 4,
    nScrollers: scrollers.length,
    scrollerDetail: [['body', body], ['wrap', wrap]].map(([n, e]) => e ? [n, getComputedStyle(e).overflowX, getComputedStyle(e).overflowY, e.scrollWidth - e.clientWidth, e.scrollHeight - e.clientHeight] : [n, 'none']),
    wrapOver: wrap ? [wrap.scrollHeight - wrap.clientHeight, wrap.scrollWidth - wrap.clientWidth] : null,
    bodyOver: body ? [body.scrollHeight - body.clientHeight, body.scrollWidth - body.clientWidth] : null,
    gridW: grid ? Math.round(grid.getBoundingClientRect().width) : null, wrapW: wrap ? wrap.clientWidth : null,
    cell: cell ? +cell.getBoundingClientRect().width.toFixed(1) : null,
  });
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })

/* ───────── ① + ④ 桌面：145% / 160% 地图窗 + 回归 100% ───────── */
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 0 })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { S.over = false; closeAllModals(); window.V4Scale.setMapStyle('float'); setTab('explore'); V4World.mapMode('local'); V4Scale.toggleMap(true); return 1 })()`)
await sleep(1600)
await ev(`(() => { V4Scale.set(100); return 1 })()`); await sleep(1800)
const m100 = JSON.parse(await ev(mapFacts))
const wrapOverX = m100.wrapOver ? m100.wrapOver[1] : 0
ok('100%：地图一屏装下（无横向溢出、格子 24px）', m100.bottomOK && m100.rightOK && wrapOverX <= 1 && m100.gridW <= m100.wrapW + 2 && m100.cell >= 24, JSON.stringify(m100))
ok('100%：窗里只有一个滚动容器', m100.nScrollers === 1, JSON.stringify({ n: m100.nScrollers, wrapOver: m100.wrapOver, bodyOver: m100.bodyOver }))

const big = {}
for (const fsx of [145, 160]) {
  await ev(`(() => { V4Scale.set(${fsx}); return 1 })()`); await sleep(2000)
  big[fsx] = JSON.parse(await ev(mapFacts))
}
ok('145%/160%：地图窗不再被顶出视口（底部/右侧都在屏幕内）', big[145].bottomOK && big[145].rightOK && big[160].bottomOK && big[160].rightOK, JSON.stringify({ f145: big[145], f160: big[160] }))
ok('145%/160%：窗里仍然只有一个滚动容器（不再套两层滚动条）', big[145].nScrollers === 1 && big[160].nScrollers === 1, JSON.stringify({ f145: big[145].nScrollers, f160: big[160].nScrollers }))
ok('大字号下格子也跟着放大（可读可点）', big[145].cell > m100.cell && big[160].cell > big[145].cell, JSON.stringify({ c100: m100.cell, c145: big[145].cell, c160: big[160].cell }))
await shot('01_mapwin_160')

/* ───────── ② 字号跟随：背包行 / 折叠条 / 沙盒 ───────── */
const rowH = async () => JSON.parse(await ev(`(() => { const e = document.querySelector('#view .lrow .nm'); const r = e ? e.getBoundingClientRect() : null; return JSON.stringify({ h: r ? +r.height.toFixed(1) : null }) })()`))
const arcH = async () => JSON.parse(await ev(`(() => { const e = document.querySelector('.v4arc > summary'); const r = e ? e.getBoundingClientRect() : null; return JSON.stringify({ h: r ? +r.height.toFixed(1) : null }) })()`))
await ev(`(() => { V4Scale.set(100); setTab('inv'); return 1 })()`); await sleep(1100)
const row100 = await rowH()
await ev(`(() => { S.inv.can = S.inv.can || 2; render(); return 1 })()`); await sleep(600)
const row100b = await rowH()
await ev(`(() => { setTab('quest'); return 1 })()`); await sleep(900)
const arc100 = await arcH()
await shot('02_quest_100')
await ev(`(() => { V4Scale.set(160); setTab('inv'); return 1 })()`); await sleep(1400)
const row160 = await rowH()
await ev(`(() => { setTab('quest'); return 1 })()`); await sleep(1000)
const arc160 = await arcH()
ok('背包行字号跟着 --fs 放大（以前只有探索页卡片墙跟随）', row100b.h > 0 && row160.h / row100b.h > 1.4, JSON.stringify({ h100: row100b.h, h160: row160.h, ratio: +(row160.h / row100b.h).toFixed(2) }))
ok('任务页的折叠条也跟着放大（玩家点开剧情日志那一行）', arc100.h > 0 && arc160.h / arc100.h > 1.4, JSON.stringify({ h100: arc100.h, h160: arc160.h, ratio: +(arc160.h / arc100.h).toFixed(2) }))
await shot('03_quest_160')

const labZoom = await ev(`(() => {
  if (!window.V4Lab || typeof V4Lab.open !== 'function') return 'NO-LAB';
  V4Lab.open();
  return 'opened';
})()`)
await sleep(2600)
const labInfo = JSON.parse(await ev(`(() => {
  const l = document.getElementById('v4lab');
  if (!l) return JSON.stringify({ err: 'NO-LAB-NODE' });
  const ch = l.querySelector('.lab-ch');
  return JSON.stringify({ zoom: getComputedStyle(l).zoom, chRect: ch ? Math.round(ch.getBoundingClientRect().height) : null,
    w: Math.round(l.getBoundingClientRect().width), vw: window.innerWidth });
})()`))
ok('教程沙盒打开后整体跟随字号（#v4lab zoom = 当前倍率）', labZoom === 'opened' && labInfo.zoom === '1.6', JSON.stringify({ labZoom, labInfo }))
await shot('04_lab_160')
await ev(`(() => { if (window.V4Lab && V4Lab.close) V4Lab.close(); V4Scale.set(100); return 1 })()`); await sleep(1200)

/* ───────── ③ 手机：触控命中区 + 单指拖动平移 ───────── */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { S.over = false; window.V4Scale.setMapStyle('float'); setTab('explore'); V4World.mapMode('local'); V4Scale.toggleMap(true); V4Scale.set(100); return 1 })()`)
await sleep(2600)
const mob = JSON.parse(await ev(mapFacts))
ok('手机（390×844，触屏）：格子命中区 ≥26px', mob.cell >= 26, JSON.stringify({ cell: mob.cell, wrap: mob.wrapW, gridW: mob.gridW }))
const touchCss = JSON.parse(await ev(`(() => {
  const body = document.querySelector('#v4mapwin .mwbody'), wrap = document.querySelector('.v4world .wmapwrap');
  const isScroller = (e) => {
    if (!e) return false;
    const cs = getComputedStyle(e);
    const canX = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth - e.clientWidth > 2;
    const canY = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight - e.clientHeight > 2;
    return canX || canY;
  };
  return JSON.stringify({ bodyTouch: body ? getComputedStyle(body).touchAction : null, wrapTouch: wrap ? getComputedStyle(wrap).touchAction : null,
    coarse: matchMedia('(hover:none), (pointer:coarse)').matches,
    nScrollers: [body, wrap].filter(isScroller).length,
    wrapOverflow: wrap ? getComputedStyle(wrap).overflowX : null });
})()`))
ok('手机：滚动容器声明了单指平移（touch-action: pan-x pan-y）且只有一个滚动层', /pan-x pan-y/.test(touchCss.bodyTouch) && touchCss.coarse && touchCss.nScrollers === 1, JSON.stringify(touchCss))
await shot('05_mobile_map')

/* 真的拖一下：手动合成单指触摸序列（touchStart → 8×touchMove → touchEnd）。
   为什么不用 Input.synthesizeScrollGesture：实测它在带 touch-action 的嵌套容器上不动
   （scrollLeft 一直 0），换成手动触摸序列就正常 —— 而且这才是"单指拖动"的真实路径。 */
const before = JSON.parse(await ev(`(() => { const b = document.querySelector('#v4mapwin .mwbody'); return JSON.stringify({ l: b.scrollLeft, t: b.scrollTop, sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight }) })()`))
const rect = JSON.parse(await ev(`(() => { const r = document.querySelector('#v4mapwin .mwbody').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }) })()`))
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y, id: 1 }] })
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x - i * 18, y: rect.y - i * 10, id: 1 }] })
  await sleep(40)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(900)
const after = JSON.parse(await ev(`(() => { const b = document.querySelector('#v4mapwin .mwbody'); return JSON.stringify({ l: b.scrollLeft, t: b.scrollTop }) })()`))
ok('手机：单指一划，地图真的平移了（scrollLeft 变化）', after.l > before.l || after.t > before.t, JSON.stringify({ before, after, at: rect }))

/* 点一格：触摸点选地图格子仍能触发移动/详情（命中区够大才点得准） */
const tap = JSON.parse(await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4mapwin .wcell[onclick]')].slice(0, 60);
  const big = cells.map(c => ({ c, r: c.getBoundingClientRect() })).filter(x => x.r.width >= 24);
  if (!big.length) return JSON.stringify({ err: 'NO-BIG-CELL' });
  const t = big[Math.floor(big.length / 2)];
  return JSON.stringify({ w: Math.round(t.r.width), x: Math.round(t.r.x + t.r.width / 2), y: Math.round(t.r.y + t.r.height / 2), n: big.length });
})()`))
if (tap.err) {
  ok('手机：可点格子存在且尺寸够点', false, JSON.stringify(tap))
} else {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tap.x, y: tap.y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(1200)
  const tapped = await ev(`(() => { const d = document.querySelector('#v4mapwin .wpreview, #v4mapwin .whover'); return d ? d.textContent.replace(/\\s+/g, ' ').slice(0, 60) : 'NONE' })()`)
  ok('手机：单指点击地图格子有反馈（预览条更新）', tapped !== 'NONE' && tapped.length > 0, JSON.stringify({ tapped }))
}

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
