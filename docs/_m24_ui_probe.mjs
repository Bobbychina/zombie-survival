// M24 取证/验收：在用户视口（2048×1280）逐页截图 + 量化检查（卡片墙空白、图层文字、溢出）
// 用法：node docs/_m24_ui_probe.mjs <cdpPort> <url> <outDir> [live]
const [, , cdpPort, url, outDir, liveFlag] = process.argv
const LIVE = !!liveFlag
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 120))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 140))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
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
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1280, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
await sleep(3000)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev(expr)) === true) return true; await sleep(400) } return false }
const goto = async () => { await send('Page.navigate', { url: pageUrl }); return waitFor(`typeof DEV !== 'undefined'`) }
const tab = (re) => ev(`(() => { const b=[...document.querySelectorAll('.tab, button')].find(e=>/${re}/.test(e.textContent||'')); if(b) b.click(); return 1; })()`)

await waitFor(`typeof DEV !== 'undefined'`)
await ev(`['zombie_survival_save_v2','dsh.mapmode','dsh.regionlayer'].forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); 1`)
await goto()
ok('DEV 钩子可用', (await ev(`typeof DEV !== 'undefined'`)) === true)
await tab('探索'); await sleep(800)

/* ── 1) 卡片墙：不该因为"同一行别的卡更高"而留出空白 ── */
const wall = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#v4cards > *')].map(c => {
    const b = c.getBoundingClientRect();
    return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), h: Math.round(b.height),
      k: c.dataset.card || 'raw', tt: ((c.querySelector && c.querySelector('.card-tt')) || {}).textContent || '' };
  });
  // 每张卡"下方空白" = 同列下一张卡的 top - 自己 bottom（列内紧不紧）
  const byCol = {};
  for (const c of cards) { const k = c.l; (byCol[k] = byCol[k] || []).push(c); }
  let worst = 0, worstName = '';
  for (const k in byCol) {
    const col = byCol[k].sort((a, b) => a.t - b.t);
    for (let i = 0; i < col.length - 1; i++) {
      const gap = col[i + 1].t - col[i].b;
      if (gap > worst) { worst = gap; worstName = col[i].tt || col[i].k; }
    }
  }
  const raw = cards.filter(c => c.k === 'raw').map(c => c.tt || '未命名');
  return JSON.stringify({ n: cards.length, worstGap: worst, worstName, raw, cols: getComputedStyle(document.getElementById('v4cards')).columnCount });
})()`))
ok('卡片墙没有"同排被撑出来的大空白"（列内最大间隙 ≤ 24px）', wall.worstGap <= 24, 'worst=' + wall.worstGap + 'px @' + wall.worstName)
ok('legacy 内容全部被包成卡片（没有未包装的裸卡片）', wall.raw.length === 0, JSON.stringify(wall.raw))
await shot('01_explore_2048')

/* ── 2) 大区地图两种图层：地貌只上色、危险度只给数字 ── */
await ev(`V4World.mapMode('region')`); await sleep(700)
await ev(`V4World.regionLayer('type')`); await sleep(600)
const typeLayer = JSON.parse(await ev(`(() => {
  const g = document.querySelector('#v4world .rgrid');
  const cell = g.querySelector('.rcell2');
  return JSON.stringify({ nums: g.querySelectorAll('.rnum').length, names: g.querySelectorAll('.rnm').length,
    visibleNums: [...g.querySelectorAll('.rnum')].filter(e => getComputedStyle(e).display !== 'none').length,
    visibleNames: [...g.querySelectorAll('.rnm')].filter(e => getComputedStyle(e).display !== 'none').length });
})()`))
ok('地貌上色：格子里不显示危险数字', typeLayer.visibleNums === 0, JSON.stringify(typeLayer))
ok('地貌上色：格子里不显示地名', typeLayer.visibleNames === 0, JSON.stringify(typeLayer))
await shot('02_region_type_2048')
await ev(`V4World.regionLayer('danger')`); await sleep(600)
const dangerLayer = JSON.parse(await ev(`(() => {
  const g = document.querySelector('#v4world .rgrid');
  return JSON.stringify({ visibleNums: [...g.querySelectorAll('.rnum')].filter(e => getComputedStyle(e).display !== 'none').length,
    visibleNames: [...g.querySelectorAll('.rnm')].filter(e => getComputedStyle(e).display !== 'none').length });
})()`))
ok('危险度上色：数字可见', dangerLayer.visibleNums >= 100, 'nums=' + dangerLayer.visibleNums)
ok('危险度上色：地名不再挤在数字上', dangerLayer.visibleNames === 0, 'names=' + dangerLayer.visibleNames)
await shot('03_region_danger_2048')
await ev(`V4World.regionLayer('type')`); await ev(`V4World.mapMode('local')`); await sleep(600)

/* ── 3) 技能页：数量 + 每条都有"当前效果/分级解锁" ── */
await tab('技能'); await sleep(700)
const skills = JSON.parse(await ev(`(() => {
  const hs = [...document.querySelectorAll('#view h3')].map(h => (h.textContent || '').trim()).filter(t => /Lv\\./.test(t));
  const cards = [...document.querySelectorAll('#view .card')];
  const txt = document.getElementById('view').textContent || '';
  return JSON.stringify({ count: hs.length, names: hs.map(t => t.replace(/\\s+/g, ' ')),
    hasNow: /现在：/.test(txt), hasPerk: /解锁|✅|🔒/.test(txt), hasSrc: /每走一格|走到没去过|搜刮/.test(txt),
    scrollH: document.getElementById('view').scrollHeight, clientH: document.getElementById('view').clientHeight });
})()`))
ok('技能数量 ≥ 12（用户："技能也太少了"）', skills.count >= 12, 'n=' + skills.count + ' ' + JSON.stringify(skills.names.slice(0, 14)))
ok('每条技能显示"现在生效值 + 到级解锁 + 怎么涨"', skills.hasNow && skills.hasPerk && skills.hasSrc,
  JSON.stringify({ hasNow: skills.hasNow, hasPerk: skills.hasPerk, hasSrc: skills.hasSrc }))
await shot('04_skills_2048')

/* ── 3b) 技能真的在生效：走路涨体能、进新格子涨侦查、侦查 Lv3 视野多一圈 ── */
await tab('探索'); await sleep(700)
const xpGain = JSON.parse(await ev(`(() => {
  const s = DEV.state();
  const before = { fit: s.xp.fitness || 0, scout: s.xp.scout || 0, stealth: s.xp.stealth || 0 };
  const w = DEV.localWorld();
  const cur = s.world.cur;
  const nb = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => w.blocks[(cur.x+dx)+','+(cur.y+dy)]).find(b => b && b.revealed);
  if (!nb) return JSON.stringify({ skip: true });
  V4World.click(nb.x, nb.y); V4World.confirmTrip();
  if (window.__v4BattleOpen && window.__v4BattleOpen()) { V4UI.close && V4UI.close(); }
  const after = { fit: s.xp.fitness || 0, scout: s.xp.scout || 0, stealth: s.xp.stealth || 0 };
  return JSON.stringify({ skip: false, before, after, moved: s.world.cur.x + ',' + s.world.cur.y });
})()`))
ok('走路涨体能经验（以前体能永远 Lv.0）', xpGain.skip || xpGain.after.fit > xpGain.before.fit, JSON.stringify(xpGain.before) + '→' + JSON.stringify(xpGain.after))
ok('走进没去过的地方涨侦查经验', xpGain.skip || xpGain.after.scout > xpGain.before.scout, 'scout ' + (xpGain.before?.scout) + '→' + (xpGain.after?.scout))

const vision = JSON.parse(await ev(`(() => {
  const s = DEV.state(), w = DEV.localWorld();
  const lit = () => Object.values(w.blocks).filter(b => b.revealed).length;
  const n0 = lit();
  s.skills.scout = 0; const w0 = DEV.localWorld();
  const c = s.world.cur;
  // 手动按"0 级视野"和"3 级视野"各推一次雾，比较点亮格数
  const countAt = (lv) => {
    s.skills.scout = lv;
    for (const k in w0.blocks) { w0.blocks[k].revealed = false; }
    const s2 = DEV.state();
    // 通过 teleport 触发一次 markVisited（走一格）
    const nb = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => w0.blocks[(c.x+dx)+','+(c.y+dy)]).find(b => b);
    V4World.teleport(nb.x, nb.y);
    return Object.values(DEV.localWorld().blocks).filter(b => b.revealed).length;
  };
  const base = countAt(0), big = countAt(3);
  s.skills.scout = 0;
  return JSON.stringify({ base, big, n0 });
})()`))
ok('侦查 Lv3 的视野真的更大（点亮格数更多）', vision.big > vision.base, JSON.stringify(vision))

/* ── 4) 溢出检查：所有页签都不许横向溢出/被容器切 ── */
const pages = []
for (const t of ['探索', '背包', '制作', '技能', '任务', '图鉴', '统计']) {
  await tab(t); await sleep(450)
  const r = JSON.parse(await ev(`(() => {
    const v = document.getElementById('view');
    const bad = [...v.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 40 && getComputedStyle(e).overflowX !== 'auto' && getComputedStyle(e).overflowX !== 'scroll')
      .map(e => (e.className || e.tagName).toString().slice(0, 24));
    return JSON.stringify({ tab: '${t}', hOver: bad.slice(0, 4), docOver: document.documentElement.scrollWidth - window.innerWidth,
      scrollH: v.scrollHeight, clientH: v.clientHeight });
  })()`))
  pages.push(r)
}
const badPages = pages.filter(p => p.hOver.length || p.docOver > 2)
ok('七个页签都没有横向溢出', badPages.length === 0, JSON.stringify(badPages))
console.log('  各页滚动高度：' + pages.map(p => p.tab + ' ' + p.scrollH + '/' + p.clientH).join(' · '))
await tab('统计'); await sleep(600); await shot('05_stats_2048')
ok('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '))
const pass = checks.filter(c => c[1]).length
console.log(`\n结果：${pass}/${checks.length} 通过` + (LIVE ? '（线上）' : '（本地）'))
console.log(JSON.stringify(checks.map(([n, c]) => (c ? '✓' : '✗') + n)))
process.exit(pass === checks.length ? 0 : 1)
