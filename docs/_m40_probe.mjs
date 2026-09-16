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
const bodyOverY100 = m100.bodyOver ? m100.bodyOver[1] : 0
/* M41：100% 下地图就该"刚好装下"——不再把整个行动主区域吃满（用户报障："为何整个地图占了整个行动主区域"）。
   验收口径：窗口在视口内 + 窗里不用滚（body 纵向溢出 ≤ 2px）+ 网格不宽于容器 + 格子仍有 18px 以上。 */
ok('100%：地图刚好装下（窗里不用滚、网格不溢出、格子 ≥18px）', m100.bottomOK && m100.rightOK && bodyOverY100 <= 2 && wrapOverX <= 1 && m100.gridW <= m100.wrapW + 2 && m100.cell >= 18, JSON.stringify({ cell: m100.cell, bodyOverY: bodyOverY100, gridW: m100.gridW, wrapW: m100.wrapW }))
ok('100%：纵向只有一个滚动容器（不再套两层纵向滚动条）', m100.nScrollers <= 1, JSON.stringify({ n: m100.nScrollers, wrapOver: m100.wrapOver, bodyOver: m100.bodyOver }))

const big = {}
for (const fsx of [145, 160]) {
  await ev(`(() => { V4Scale.set(${fsx}); return 1 })()`); await sleep(2000)
  big[fsx] = JSON.parse(await ev(mapFacts))
}
ok('145%/160%：地图窗不再被顶出视口（底部/右侧都在屏幕内）', big[145].bottomOK && big[145].rightOK && big[160].bottomOK && big[160].rightOK, JSON.stringify({ f145: big[145], f160: big[160] }))
ok('145%/160%：纵向仍然只有一个滚动容器（不再套两层纵向滚动条）', big[145].nScrollers <= 1 && big[160].nScrollers <= 1, JSON.stringify({ f145: big[145].nScrollers, f160: big[160].nScrollers }))
ok('大字号下地图仍然装得下（格子不小于 14px，窗里纵向滚动 < 200px）', big[145].cell >= 14 && big[160].cell >= 14 && (big[145].bodyOver ? big[145].bodyOver[1] : 0) < 200 && (big[160].bodyOver ? big[160].bodyOver[1] : 0) < 200, JSON.stringify({ c100: m100.cell, c145: big[145].cell, c160: big[160].cell, over145: big[145].bodyOver, over160: big[160].bodyOver }))
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
ok('手机（390×844，触屏）：地图压缩进一屏（网格不宽于容器，卡片不高于视口）', mob.cell >= 10 && mob.gridW <= mob.wrapW + 2 && mob.win[1] <= mob.vh, JSON.stringify({ cell: mob.cell, gridW: mob.gridW, wrapW: mob.wrapW, winH: mob.win[1], vh: mob.vh }))
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

/* 单指拖动得在"地图真的比屏幕大"的时候验：把字号调到 160%，格子按 zoom 仍会被撑出容器，
   这时单指拖动必须能平移地图（M41 之后 100% 下地图是压缩进一屏的，没得拖 —— 那是预期）。 */
await ev(`(() => { V4Scale.set(160); return 1 })()`); await sleep(2200)
const mobBig = JSON.parse(await ev(mapFacts))
ok('手机 + 160%：地图比屏幕大时，单指拖动才有意义（网格宽于容器）', mobBig.gridW > mobBig.wrapW + 2, JSON.stringify({ gridW: mobBig.gridW, wrapW: mobBig.wrapW, cell: mobBig.cell }))

/* 真的拖一下：手动合成单指触摸序列（touchStart → 8×touchMove → touchEnd）。
   为什么不用 Input.synthesizeScrollGesture：实测它在带 touch-action 的嵌套容器上不动
   （scrollLeft 一直 0），换成手动触摸序列就正常 —— 而且这才是"单指拖动"的真实路径。
   注意：M41 之后地图默认**压缩进一屏**，没有溢出时本来就没得拖 —— 这时断言"装得下"，
   有溢出时才断言"拖得动"（两种情况都必须成立其一，不许出现"溢出了但拖不动"）。 */
/* 注意单位：#v4mapwin 带 zoom —— `gridW` 是 getBoundingClientRect 的**视觉**像素，
   `wrapW` 是 clientWidth 的**本地**像素，两者不能直接比（第一版就比错了，冤枉成"溢出但拖不动"）。 */
const overflow = mobBig.gridW / (mobBig.fs / 100) > mobBig.wrapW + 2
const before = JSON.parse(await ev(`(() => { const w = document.querySelector('#v4mapwin .wmapwrap'), b = document.querySelector('#v4mapwin .mwbody'); return JSON.stringify({ wrap: w.scrollLeft, body: b.scrollLeft, sw: w.scrollWidth, cw: w.clientWidth }) })()`))
const rect = JSON.parse(await ev(`(() => { const r = document.querySelector('#v4mapwin .wmapwrap').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(120, Math.max(20, r.height / 2))) }) })()`))
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y, id: 1 }] })
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x - i * 18, y: rect.y, id: 1 }] })
  await sleep(40)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(900)
const after = JSON.parse(await ev(`(() => { const w = document.querySelector('#v4mapwin .wmapwrap'), b = document.querySelector('#v4mapwin .mwbody'); return JSON.stringify({ wrap: w.scrollLeft, body: b.scrollLeft }) })()`))
if (overflow) {
  ok('手机：地图比容器宽时单指真的拖得动（横向滚动量变化）', after.wrap > before.wrap || after.body > before.body, JSON.stringify({ before, after }))
} else {
  ok('手机：地图压缩进一屏（没有溢出、不需要拖）', true, JSON.stringify({ gridW: mobBig.gridW, wrapW: mobBig.wrapW, cell: mobBig.cell }))
}

/* 点一格：触摸点选地图格子仍能触发移动/详情（压缩后格子小，但点选链路必须通） */
const tap = JSON.parse(await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4mapwin .wcell[onclick]')].slice(0, 60);
  const big = cells.map(c => ({ c, r: c.getBoundingClientRect() })).filter(x => x.r.width >= 8);
  if (!big.length) return JSON.stringify({ err: 'NO-CELL' });
  const t = big[Math.floor(big.length / 2)];
  return JSON.stringify({ w: Math.round(t.r.width), x: Math.round(t.r.x + t.r.width / 2), y: Math.round(t.r.y + t.r.height / 2), n: big.length });
})()`))
if (tap.err) {
  ok('手机：可点格子存在（压缩后仍点得到）', false, JSON.stringify(tap))
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
