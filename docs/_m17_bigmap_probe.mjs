// M17 验收：大区地图 = 程序化生成的 12×12 = 144 格元地图（用户 + 外部评审的三条意见）
//   ① 地理：区域不再是手写 9 个，而是按种子生成、地名按方位+地貌、海岸占满一整侧
//   ② 危险度：严格按离主城的距离辐射递增（中心安全区 → 角落九死一生），格子上标数字
//   ③ UI：格子按地貌上色 + 资源暗示 + 点选联动详情（描述/物资/油耗/途经）+ 危险图例
// 用法：node docs/_m17_bigmap_probe.mjs <cdpPort> <url> <outDir>
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 120))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
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
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1200, deviceScaleFactor: 1, mobile: false })
/* DEV 钩子只在 ?dev= 下挂载：给车/给油这类探针动作必须走这个 URL（不然 DEV.state() 直接抛） */
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const openWorldTab = `(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`
const toRegion = `(() => { const b = [...document.querySelectorAll('#v4world .wmtab')].find(x => /大区/.test(x.textContent||'')); if (b && !b.className.includes('on')) b.click(); return 1; })()`

await ev(`localStorage.removeItem('zombie_survival_save_v2'); localStorage.setItem('dsh.mapmode','region'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
ok('DEV 钩子可用（走 ?dev=ready 才有）', (await ev(`typeof DEV !== 'undefined' && typeof V4World !== 'undefined'`)) === true)
await ev(openWorldTab)
await sleep(900)
await ev(toRegion)
await sleep(600)

/* 页面侧取样：格子的底色/危险数字/可见性都从真实 DOM 里读，不看源码里的常量 */
const dump = `(() => {
  const cs = [...document.querySelectorAll('#v4world .rcell2')];
  const cell = (c) => {
    const m = /pickRegion\\('([^']+)'\\)/.exec(c.getAttribute('onclick') || '');
    return {
      id: m ? m[1] : '',
      bg: (getComputedStyle(c).backgroundColor || '').replace(/\\s/g, ''),
      /* M59：危险度取自格子类名 d{n} —— M24 起「地貌层只画颜色、危险度层才画数字」，
         .rnum 在地貌层根本不存在，老写法会把它读成 tier=0（探针自己过期了，不是地图坏了）。 */
      tier: Number((c.className.match(/(?:^|\\s)d([1-5])(?:\\s|$)/) || [])[1] || (c.querySelector('.rnum') || {}).textContent || 0),
      dc: (c.getAttribute('style') || '').replace(/.*--dc:\s*([^;"']+).*/, '$1'),
      name: (c.querySelector('.rnm') || {}).textContent || '',
      unseen: c.className.includes('unseen'),
      here: c.className.includes('here'),
      home: c.className.includes('home'),
      sel: c.className.includes('sel'),
      onpath: c.className.includes('onpath'),
    };
  };
  const card = document.getElementById('v4world') || document.body;
  return JSON.stringify({
    cells: cs.map(cell),
    legends: [...document.querySelectorAll('#v4world .rlg')].map(x => x.textContent.trim()),
    tabs: [...document.querySelectorAll('#v4world .wmtab')].map(b => b.textContent.trim()),
    badge: (document.querySelector('#v4world .sect-title') || {}).textContent || '',
    cur: (document.querySelector('#v4world .rcur') || {}).textContent || '',
    /* M17.1：格子按 DOM 顺序（12×12 行优先）取"地貌标签"，用来验"成片/约束" */
    grid: cs.map(c => {
      const m = /·\\s*([^·]+?)\\s*·\\s*危险/.exec(c.getAttribute('title') || '');
      return m ? m[1].trim() : '';
    }),
    detail: (document.querySelector('#v4world .rdetail') || {}).textContent || '',
    detailHtml: (document.querySelector('#v4world .rdetail') || {}).innerHTML || '',
    hasGoBtn: !!document.querySelector('#v4world .rdetail .rgo button'),
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  });
})()`

const first = await ev(dump)
if (typeof first !== 'string' || first.startsWith('EXC')) { console.log('FAIL 取样失败: ' + first); process.exit(1) }
const A = JSON.parse(first)
console.log(`  格子数=${A.cells.length} 图例行=${A.legends.length} 标题=${A.badge.trim().slice(0, 40)}`)

ok('大区地图是 12×12 = 144 格（不再是 3×3 的 9 格）', A.cells.length === 144 && /12×12/.test(A.tabs[1] || ''), `cells=${A.cells.length} tab=${A.tabs[1] || ''}`)
ok('标题写明 144 个区域 + 已到过计数', /144 个区域/.test(A.badge) && /已到过 \d+\/144/.test(A.cur), `${A.badge.trim().slice(0, 40)} | ${A.cur.trim()}`)

const colors = new Set(A.cells.map(c => c.bg))
ok('按地貌类型上色：至少 6 种地表色同时在图上', colors.size >= 6, `distinct=${colors.size}`)

/* M17.2：图层切换（评审 #3："红绿蓝黄交替看久了让人眼瞎"）——危险度图层只该剩 5 种梯度色 */
const clickedDanger = await ev(`(() => {
  const b = [...document.querySelectorAll('#v4world .rlayers .wmtab')].find(x => /危险度/.test(x.textContent||''));
  if (b) b.click();
  return !!b;
})()`)
await sleep(600)
const D2 = JSON.parse(await ev(dump))
const dColors = new Set(D2.cells.map(c => c.bg))
/* computed style 给的是 rgb()，所以把期望的十六进制换成同样的写法再比 */
const hex2rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`   // computed style 不带空格
const want = ['#78c98a', '#c6d06a', '#e0b45c', '#e08a5c', '#ef6f6f'].map(hex2rgb)
ok('能切到「危险度上色」图层：底色收敛成 5 种梯度色（绿→红）',
  clickedDanger === true && dColors.size === 5 && want.every(h => dColors.has(h)),
  `危险度图层色数=${dColors.size} [${[...dColors].join(' ')}] want=[${want.join(' ')}]`)
ok('危险度图层里地貌图例让位（不再同时堆两套图例）', D2.legends.length === 1 && /九死一生/.test(D2.legends[0]), `图例行=${D2.legends.length}`)
await shot('m17-danger-layer')
const backToType = await ev(`(() => { const b = [...document.querySelectorAll('#v4world .rlayers .wmtab')].find(x => /地貌/.test(x.textContent||'')); if (b) b.click(); return 1; })()`)
void backToType
await sleep(600)
const A2 = JSON.parse(await ev(dump))
ok('切回地貌图层恢复正常（9 色 + 两套图例）',
  new Set(A2.cells.map(c => c.bg)).size >= 6 && A2.legends.length === 2,
  `色数=${new Set(A2.cells.map(c => c.bg)).size} 图例=${A2.legends.length}`)
A.cells = A2.cells; A.grid = A2.grid; A.legends = A2.legends      // 后面的检查用切回来的地貌图层

const tiers = A.cells.map(c => c.tier)
ok('每格都标了危险度 1~5，且五个档位都出现（梯度铺满）',
  tiers.every(t => t >= 1 && t <= 5) && new Set(tiers).size === 5, `tiers=${[...new Set(tiers)].sort().join(',')}`)

const home = A.cells.find(c => c.home)
ok('主城「余烬」在图上唯一、危险度 1、有发光标记', !!home && home.tier === 1 && A.cells.filter(c => c.home).length === 1,
  home ? `${home.name} tier=${home.tier}` : 'no home cell')

/* 危险度必须是**辐射梯度**：中心低、外圈高。用页面自己的 dist 分组算平均 */
const meta = JSON.parse(await ev(`JSON.stringify(V4World.meta())`))
const distOf = {}; for (const r of meta.regions) distOf[r.id] = r.dist
const rows = A.cells.map(c => ({ d: distOf[c.id], t: c.tier })).filter(r => r.d !== undefined)
const avg = (lo, hi) => { const a = rows.filter(r => r.d >= lo && r.d <= hi); return a.reduce((s, r) => s + r.t, 0) / a.length }
const a1 = avg(0, 1), a2 = avg(2, 3), a3 = avg(4, 5), a4 = avg(6, 9)
ok('危险度成辐射梯度（中心 < 中圈 < 外圈 < 角落）', a1 < a2 && a2 < a3 && a3 <= a4 + 0.001,
  `avg: 0-1=${a1.toFixed(2)} 2-3=${a2.toFixed(2)} 4-5=${a3.toFixed(2)} 6+=${a4.toFixed(2)}`)
const corners = [[0, 0], [11, 0], [0, 11], [11, 11]].map(([c, r]) => meta.regions.find(x => x.col === c && x.row === r).tier)
ok('四个角落都是危险 4~5（评审说的"角落也很安全"已经修掉）', corners.every(t => t >= 4), `corners=${corners.join(',')}`)
const nearCenter = meta.regions.filter(r => r.dist <= 1).map(r => r.tier)
ok('主城一圈内都是危险 1~2（出门不该直接撞上九死一生）', nearCenter.every(t => t <= 2), `ring1=${nearCenter.join(',')}`)

ok('地貌图例 + 危险图例都在（颜色/数字各有一套说明）',
  A.legends.length >= 2 && /工业区/.test(A.legends[0]) && /九死一生/.test(A.legends[1]),
  A.legends.map(l => l.slice(0, 30)).join(' | '))
ok('没去过的格子被灰掉（unseen），主城不算', A.cells.filter(c => c.unseen).length >= 140 && !!home && !home.unseen,
  `unseen=${A.cells.filter(c => c.unseen).length}`)
await shot('m17-bigmap-desktop')

/* 底边条 = 危险度：同一档位必须同色、不同档位必须不同色（不然"梯度"只是嘴上说说） */
const dcOf = {}; for (const c of A.cells) (dcOf[c.tier] = dcOf[c.tier] || new Set()).add(c.dc)
const dcOk = [1, 2, 3, 4, 5].every(t => dcOf[t] && dcOf[t].size === 1) && new Set([1, 2, 3, 4, 5].map(t => [...dcOf[t]][0])).size === 5
ok('底边条按危险度上色（同档同色、五档五色，图上能看出"越往外越红"）', dcOk,
  [1, 2, 3, 4, 5].map(t => t + ':' + (dcOf[t] ? [...dcOf[t]][0] : '?')).join(' '))

/* M17.1：用户截图评审的核心——"色块马赛克、工业区贴着市中心"。
   这里直接在 DOM 上量：相邻同类占比 + 工业区是否贴着主城。 */
const G = A.grid
ok('每格的"地貌标签"都能从 DOM 里读出来（下面的成片/约束检查靠它）', G.filter(t => t).length === 144, `解析到 ${G.filter(t => t).length}/144`)
const at = (r, c) => (r < 0 || r > 11 || c < 0 || c > 11 ? '' : G[r * 12 + c])
let sameN = 0, totN = 0
for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
  if (c < 11) { totN++; if (at(r, c) === at(r, c + 1)) sameN++ }
  if (r < 11) { totN++; if (at(r, c) === at(r + 1, c)) sameN++ }
}
const ratio = sameN / totN
ok('同类型连成片，不是色块马赛克（相邻同类占比 ≥0.45，随机打散约 0.15）', ratio >= 0.45 && ratio < 1, `ratio=${ratio.toFixed(2)}`)
const homeIdx = A.cells.findIndex(c => c.home)
const homeRC = [Math.floor(homeIdx / 12), homeIdx % 12]
const homeNb = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dr, dc]) => at(homeRC[0] + dr, homeRC[1] + dc)).filter(Boolean)
ok('工业区不贴市中心（主城四周没有化工园）', homeNb.length === 4 && homeNb.every(t => t !== '工业区'), `主城四周=${homeNb.join('/')}`)
const box = A.cells.filter((c, i) => Math.max(Math.abs(Math.floor(i / 12) - homeRC[0]), Math.abs((i % 12) - homeRC[1])) <= 1)
ok('主城 + 紧邻一圈都是安全区（危险度 1），玩家有"新手村"',
  box.length === 9 && box.every(c => c.tier === 1), `九宫格危险度=${box.map(c => c.tier).join(',')}`)

/* ② 点一格 → 详情联动（评审："缺资源暗示、描述不与选中区域联动"） */
const hop1 = meta.regions.filter(r => r.dist === 1 && r.type !== 'water')[0]
const sel1 = await ev(`(() => { V4World.pickRegion('${hop1.id}'); return 1; })()`)
void sel1
await sleep(500)
const B = JSON.parse(await ev(dump))
const selCell = B.cells.find(c => c.id === hop1.id)
ok('点一格只选中、不动身（选中态出现在那一格上）', !!selCell && selCell.sel, `sel=${!!selCell && selCell.sel}`)
ok('详情联动：地名 + 地貌 + 危险度 + 离主城距离 + 物资暗示 + 描述全在',
  B.detail.includes(hop1.name) && /危险 \d/.test(B.detail) &&
  /离余烬 \d 格/.test(B.detail) && /这儿能弄到/.test(B.detail) && hop1.resources.every(t => B.detail.includes(t)) && B.detail.length > 40,
  B.detail.slice(0, 90))
ok('附近的一格：没车时详情直接给原因 + 怎么办（不是干瞪眼）',
  /⛔/.test(B.detail) && /车/.test(B.detail) && !B.hasGoBtn, B.detail.replace(/\s+/g, ' ').slice(0, 120))
await shot('m17-select-nocar')

/* ③ 给车/给油 → 出发按钮出现，路线亮出来 */
await ev(`(() => { const S = DEV.state(); S.world.veh = { fuel: 12, hp: 100 }; S.ap = 9; return 1; })()`)
await ev(`(() => { V4World.pickRegion('${hop1.id}'); return 1; })()`)   // pickRegion 内部会 L.render()，UI 才跟着变
await sleep(600)
const C = JSON.parse(await ev(dump))
ok('有车有油后出现「出发」按钮，并给出 ⚡/⛽ 报价',
  C.hasGoBtn && /⚡\d/.test(C.detail) && /⛽\d/.test(C.detail), C.detail.replace(/\s+/g, ' ').slice(0, 120))
ok('选中目标的整条路线在地图上亮出来（onpath）', C.cells.some(c => c.onpath), `onpath=${C.cells.filter(c => c.onpath).length}`)

/* ④ 多跳：挑一个 2~3 跳的目标，验证"途经"逐段写明 */
const multi = JSON.parse(await ev(`JSON.stringify((() => {
  const ms = V4World.meta().regions.filter(r => r.id !== V4World.meta().home);
  for (const r of ms) { const t = V4World.trip(r.id); if (t.ok && t.hops >= 2 && t.hops <= 3) return { target: r, trip: t }; }
  return null;
})())`))
ok('存在 2~3 跳可达的目标（大世界真的能一次开好几个格）', !!multi, multi ? `${multi.target.name} hops=${multi.trip.hops}` : 'none')
if (multi) {
  await ev(`(() => { V4World.pickRegion('${multi.target.id}'); return 1; })()`)
  await sleep(500)
  const D = JSON.parse(await ev(dump))
  const viaNames = multi.trip.path.slice(0, -1).map(pid => meta.regions.find(r => r.id === pid).name)
  ok('多跳详情写明跳数/油耗/途经（途经逐段列出，与真实路线一致）',
    D.detail.includes(`${multi.trip.hops} 格`) && viaNames.every(n => D.detail.includes(n)),
    `途经=${viaNames.join(' → ')}`)
  ok('路线上每一格都亮着（含途经区域）',
    multi.trip.path.every(pid => D.cells.find(c => c.id === pid).onpath), `path=${multi.trip.path.length} 格`)
  await shot('m17-multihop')

  /* ⑤ 真的出发：区域切换、成本扣除、落地后选中态清空 */
  const before = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
  await ev(`(() => { V4World.travelRegion('${multi.target.id}'); return 1; })()`)
  await sleep(900)
  const E = JSON.parse(await ev(dump))
  const after = JSON.parse(await ev(`JSON.stringify(V4World.snapshot())`))
  const hereCell = E.cells.find(c => c.here)
  ok('点「出发」真的跨区：落在目标区域、车况/油/行动力都扣了',
    after.region === multi.target.id && after.veh.fuel === before.veh.fuel - multi.trip.fuel && after.ap === before.ap - multi.trip.ap,
    `region ${before.region}→${after.region} 油 ${before.veh.fuel}→${after.veh.fuel} ⚡ ${before.ap}→${after.ap}`)
  ok('落地后「当前所在」标记跟着走，选中态清空', !!hereCell && hereCell.id === multi.target.id && !E.cells.some(c => c.sel),
    `here=${hereCell ? hereCell.name : 'none'}`)
  await shot('m17-arrived')
}

/* ⑥ 手机窄屏：不横向溢出、格子仍在（名字让位给颜色+数字） */
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true })
await sleep(600)
const F = JSON.parse(await ev(dump))
ok('手机窄屏不横向溢出，144 格仍在（颜色+数字仍可读）',
  F.cells.length === 144 && F.scrollW <= F.clientW + 8, `scrollW=${F.scrollW} clientW=${F.clientW} cells=${F.cells.length}`)
await shot('m17-bigmap-narrow')
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1200, deviceScaleFactor: 1, mobile: false })

const pageErrs = errs.filter(e => !/favicon/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m17_probe.json`, JSON.stringify({ checks, errs: pageErrs, meta: meta.regions.length, tiers, a1, a2, a3, a4, corners, multi }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
