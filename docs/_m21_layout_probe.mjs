// M21 验收：① 全图迷雾不变量（"动不了"根因：扫别区 POI 挤掉世界实例）② 探索页卡片墙改版
//   —— 去重（就地休整/睡觉）、云存档移出玩法区、卡片墙平衡、地图仍可点击移动
// 用法：node docs/_m21_layout_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 140))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}, ms = 20000) => new Promise((res) => {
  const i = ++id; pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT ' + method } } } }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
await sleep(2500)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const waitFor = async (expr, ms = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if ((await ev(expr)) === true) return true; await sleep(400) }
  return false
}
const goto = async () => { await send('Page.navigate', { url: pageUrl }); return waitFor(`typeof DEV !== 'undefined'`) }
const toExplore = `(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`

/* 干净起步 */
await waitFor(`typeof DEV !== 'undefined'`)
await ev(`['zombie_survival_save_v2','zsv_worlds_v1','zsv_ghosts_v1','zsv_runs_v1','dsh.mapmode','dsh.regionlayer'].forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); 1`)
await goto()
ok('DEV 钩子可用（含 scanRegion）', (await ev(`typeof DEV !== 'undefined' && typeof DEV.scanRegion === 'function' && !!DEV.localWorld`)) === true)
await ev(toExplore); await sleep(600)

/* ── 1) 迷雾不变量：脚下必亮 + 邻居可点（"动不了"的直接判据） ── */
const fog1 = JSON.parse(await ev(`(() => {
  const w = DEV.localWorld(); const s = DEV.state().world;
  const lit = Object.values(w.blocks).filter(b => b.revealed).length;
  const neigh = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => w.blocks[(s.cur.x+dx)+','+(s.cur.y+dy)]).filter(Boolean);
  return JSON.stringify({ lit, cur: s.cur, curLit: !!w.blocks[s.cur.x+','+s.cur.y]?.revealed, nbLit: neigh.filter(b => b.revealed).length });
})()`))
ok('新档：脚下亮着', fog1.curLit === true, 'lit=' + fog1.lit)
ok('新档：至少 7 格点亮（可走）', fog1.lit >= 7, 'lit=' + fog1.lit + ' 邻格亮 ' + fog1.nbLit)
ok('新档：邻格可点 ≥2', fog1.nbLit >= 2, 'nbLit=' + fog1.nbLit)

/* ── 2) 复现"动不了"的真实路径：刷委托板扫别区 POI → worldOf(别区) 挤掉当前世界 ── */
const scan = await ev(`(() => { const r = DEV.scanRegion(); render(); return JSON.stringify(r); })()`)
await sleep(400)
const fog2 = JSON.parse(await ev(`(() => {
  const w = DEV.localWorld(); const s = DEV.state().world;
  const lit = Object.values(w.blocks).filter(b => b.revealed).length;
  return JSON.stringify({ lit, curLit: !!w.blocks[s.cur.x+','+s.cur.y]?.revealed, domFog: document.querySelectorAll('#v4world .wcell.fog').length });
})()`))
ok('扫别区 POI 之后：脚下仍然亮（M21 修复点）', fog2.curLit === true, 'lit=' + fog2.lit + ' 扫到 ' + scan)
ok('扫别区 POI 之后：不是全黑图（lit≥7）', fog2.lit >= 7, 'lit=' + fog2.lit)
ok('扫别区 POI 之后：DOM 里迷雾格没被吃掉（576-点亮数）', fog2.domFog <= 576 - 7, 'fog格=' + fog2.domFog)

/* 走一步：点邻居 → 确认出发 → 位置真的变了 */
const walk = JSON.parse(await ev(`(() => {
  const w = DEV.localWorld(); const s = DEV.state().world;
  const p = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => w.blocks[(s.cur.x+dx)+','+(s.cur.y+dy)]).find(b => b && b.revealed);
  if (!p) return JSON.stringify({ ok: false });
  const from = s.cur.x + ',' + s.cur.y;
  V4World.click(p.x, p.y); V4World.confirmTrip();
  const now = DEV.state().world.cur;
  return JSON.stringify({ ok: true, from, to: now.x + ',' + now.y, ap: DEV.state().ap });
})()`))
ok('点邻居能真的走一步（动得了）', walk.ok && walk.from !== walk.to, JSON.stringify(walk))

/* ── 3) 卡片墙版面 ── */
const layout = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#v4cards > .v4card')];
  /* M24 起卡片墙是**多列流**（CSS columns），没有 grid-template-columns 了：
     直接数"卡片有几条不同的左边界"，排版换了这条断言也照样成立 */
  const cols = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size;
  const txt = document.getElementById('view').textContent || '';
  const btns = [...document.querySelectorAll('#view button')].map(b => (b.textContent||'').replace(/\\s+/g,' ').trim());
  const rest = btns.filter(t => /就地休整/.test(t)).length;
  const sleep = btns.filter(t => /^🌙 睡觉/.test(t)).length;
  const names = cards.map(c => c.dataset.card + ':' + (c.querySelector('.card-tt')?.textContent || '').trim());
  return JSON.stringify({ n: cards.length, cols, rest, sleep, names,
    board: document.getElementById('view').classList.contains('v4-board'),
    tools: !!document.getElementById('v4tools'),
    toolsBtns: [...document.querySelectorAll('#v4tools button')].map(b => (b.textContent||'').trim()),
    acctInCards: cards.some(c => /账号与云存档|注册 \\/ 登录/.test(c.textContent||'')),
    accountInView: /账号与云存档/.test(txt),
    mapCard: !!document.querySelector('#v4world .wgrid'),
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth });
})()`))
ok('探索页用卡片墙（#view.v4-board）', layout.board === true)
ok('卡片数 ≥ 9（用户要的"多搞一些卡片"）', layout.n >= 9, 'n=' + layout.n)
ok('卡片墙 ≥2 列（1440 宽）', layout.cols >= 2, 'cols=' + layout.cols)
ok('「就地休整」全页只有 1 个', layout.rest === 1, 'count=' + layout.rest)
ok('legacy「睡觉」按钮已摘掉（睡觉只在今夜卡）', layout.sleep === 0, 'count=' + layout.sleep)
ok('云存档不在玩法卡里', layout.acctInCards === false && layout.accountInView === false)
ok('工具条有世界 + 账号两个入口', layout.tools && layout.toolsBtns.length === 2, JSON.stringify(layout.toolsBtns))
ok('地图卡还在（24×24 网格）', layout.mapCard === true)
ok('无横向溢出', layout.scrollW <= layout.innerW + 2, layout.scrollW + ' vs ' + layout.innerW)
console.log('  卡片：' + layout.names.join(' | '))

/* ── 4) 世界面板里能改账号 / 存档（搬家的落点） ── */
await ev(`(() => { V4Worlds.open(); return 1; })()`); await sleep(500)
const panel = JSON.parse(await ev(`(() => {
  const t = (document.querySelector('.v4worlds') || {}).textContent || '';
  return JSON.stringify({ acct: /账号与云存档/.test(t), save: /世界/.test(t), ghost: /幽灵据点/.test(t), stats: /开发者统计/.test(t) });
})()`))
ok('世界面板里有「账号与云存档」', panel.acct === true)
ok('世界面板四块齐全（世界/账号/幽灵/统计）', panel.save && panel.acct && panel.ghost && panel.stats)
await ev(`closeAllModals()`); await sleep(200)

/* ── 5) 玩法动作可用性冒烟：采集真的扣行动力 ── */
const smoke = JSON.parse(await ev(`(() => {
  const btn = [...document.querySelectorAll('#v4cards button')].find(b => /采集/.test(b.textContent||'') && !b.disabled);
  if (!btn) return JSON.stringify({ skip: true });
  const ap0 = DEV.state().ap, day = DEV.state().day;
  btn.click();
  return JSON.stringify({ skip: false, ap0, ap1: DEV.state().ap, day });
})()`))
ok('「采集」按钮能点且扣行动力', smoke.skip || smoke.ap1 < smoke.ap0, JSON.stringify(smoke))
await sleep(300)
await ev(`render()`); await sleep(400)
ok('渲染无异常', (await ev(`!window.__renderErr`)) === true)

/* ── 5b) 今日行动卡的「就地休整」+ 今夜卡的「就地处火过夜」都要真的能跑 ── */
const rest1 = JSON.parse(await ev(`(() => {
  const btn = [...document.querySelectorAll('[data-card="today"] button')].find(b => /就地休整/.test(b.textContent||''));
  if (!btn) return JSON.stringify({ found: false });
  const ap0 = DEV.state().ap, sta0 = DEV.state().sta;
  btn.click();
  return JSON.stringify({ found: true, ap0, ap1: DEV.state().ap, sta0, sta1: DEV.state().sta });
})()`))
ok('今日行动卡「就地休整」可用（扣 1 AP、回体力）', rest1.found && rest1.ap1 === rest1.ap0 - 1 && rest1.sta1 >= rest1.sta0, JSON.stringify(rest1))
await sleep(300); await ev(`render()`); await sleep(400)
const sleepRes = JSON.parse(await ev(`(() => {
  const btn = [...document.querySelectorAll('[data-card="night"] button')].find(b => /生火过夜/.test(b.textContent||'') && !b.disabled);
  if (!btn) return JSON.stringify({ found: false });
  const d0 = DEV.state().day;
  btn.click();
  return JSON.stringify({ found: true, d0, d1: DEV.state().day, debt: DEV.state().world.debt, ap: DEV.state().ap, lastNight: DEV.state().world.lastNight });
})()`))
ok('今夜卡「就地生火过夜」翻到第二天（唯一睡觉入口）', sleepRes.found && sleepRes.d1 === sleepRes.d0 + 1, JSON.stringify(sleepRes))
ok('过夜走了 v4 结算（睡眠债记账 + lastNight）', !!(sleepRes.lastNight && typeof sleepRes.debt === 'number'), 'debt=' + sleepRes.debt)
await sleep(600)

/* ── 6b) 大区视图不许溢出（用户第二次报障："这边也溢出了"——选中详情/出发被挤到屏幕外） ── */
await send('Emulation.setDeviceMetricsOverride', { width: 1056, height: 1151, deviceScaleFactor: 1, mobile: false })
await ev(`window.dispatchEvent(new Event('resize')); 1`); await sleep(500)
await ev(`V4World.mapMode('region')`); await sleep(700)
await ev(`(() => { const c=[...document.querySelectorAll('#v4world .rcell2')].find(e=>!/here/.test(e.className)); if(c) c.click(); return 1; })()`)
await sleep(600)
const reg = JSON.parse(await ev(`(() => {
  const v = document.getElementById('view'), card = document.getElementById('v4world');
  const det = document.querySelector('#v4world .rdetail'), go = document.querySelector('#v4world .rdetail .rgo');
  const vb = v.getBoundingClientRect(), cb = card.getBoundingClientRect(), db = det ? det.getBoundingClientRect() : null;
  const gb = go ? go.getBoundingClientRect() : null;
  return JSON.stringify({ cardH: Math.round(cb.height), viewH: Math.round(vb.height),
    cardFits: Math.round(cb.bottom) <= Math.round(vb.bottom) + 1,
    detailVisible: db ? Math.round(db.bottom) <= Math.round(vb.bottom) + 1 : false,
    goVisible: gb ? (gb.bottom <= vb.bottom + 1 && gb.top >= vb.top) : false,
    cell: getComputedStyle(document.querySelector('#v4world .rgrid')).gridTemplateColumns.split(' ')[0],
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth });
})()`))
ok('大区视图：选中详情首屏可见（不再被挤到屏幕外）', reg.detailVisible === true, JSON.stringify(reg))
ok('大区视图：「出发/走不了」那条报价首屏可见', reg.goVisible === true)
ok('大区视图：整张地图卡一屏装下（1056×1151）', reg.cardFits === true, 'cardH=' + reg.cardH + ' viewH=' + reg.viewH)
ok('大区视图：无横向溢出', reg.scrollW <= reg.innerW + 2, reg.scrollW + ' vs ' + reg.innerW)
await shot('04_region_1056')
await ev(`V4World.mapMode('local')`); await sleep(500)

/* ── 6) 截图（1440 宽 + 用户报障时的 1056×1151） ── */
await shot('01_explore_1440')
/* 卡片墙在地图下面：滚过去再拍一张，才能看到"卡片墙"本身（用户要的"多搞一些卡片"） */
await ev(`(() => { const v = document.getElementById('view'); v.scrollTop = document.getElementById('v4world').offsetHeight + 40; return v.scrollTop; })()`)
await sleep(500)
await shot('01b_cards_1440')
const box = JSON.parse(await ev(`(() => { const c = document.getElementById('v4cards').getBoundingClientRect(); return JSON.stringify({ h: Math.round(c.height), w: Math.round(c.width) }); })()`))
console.log('  卡片墙尺寸 ' + box.w + '×' + box.h)
await send('Emulation.setDeviceMetricsOverride', { width: 1056, height: 1151, deviceScaleFactor: 1, mobile: false })
await ev(`window.dispatchEvent(new Event('resize')); 1`); await sleep(600)
const narrow = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#v4cards > .v4card')];
  const cols = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size;
  return JSON.stringify({ cols, n: cards.length, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    rest: [...document.querySelectorAll('#view button')].filter(b => /就地休整/.test(b.textContent||'')).length });
})()`))
ok('1056 宽（用户报障尺寸）：仍是卡片墙、无横向溢出', narrow.cols >= 1 && narrow.scrollW <= narrow.innerW + 2, JSON.stringify(narrow))
await shot('02_explore_1056')
await ev(`V4Worlds.open()`); await sleep(400); await shot('03_world_panel_1056')
await ev(`closeAllModals()`); await sleep(200)

ok('无 JS 运行时错误', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(c => c[1]).length
console.log(`\n结果：${pass}/${checks.length} 通过`)
console.log(JSON.stringify(checks.map(([n, c]) => (c ? '✓' : '✗') + n)))
process.exit(pass === checks.length ? 0 : 1)
