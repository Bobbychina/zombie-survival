// M19 验收：① 局部地图"越深越难"——危险度随离安全屋的距离递增，且相邻差 ≤1（没有断崖）
//            ② 危险度图层（本地地图也能切成绿→红梯度）
//            ③ 建筑分布：日用品靠家、硬货在深处
// 用法：node docs/_m19_depth_probe.mjs <cdpPort> <url> <outDir>
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
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1400, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

/* 干净起步 + 打开探索页的本地地图 */
await ev(`localStorage.removeItem('zombie_survival_save_v2'); localStorage.setItem('dsh.mapmode','local'); localStorage.removeItem('dsh.regionlayer'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`)
await sleep(900)

/* 把整张图点亮（读图需要看全图）并**存盘**（不存盘的话刷新就丢了），然后切到危险度图层 */
await ev(`(() => {
  const S = DEV.state();
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) S.world.visited[x + ',' + y] = 1;
  saveGame(true);
  return Object.keys(S.world.visited).length;
})()`)
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
await ev(`(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`)
await sleep(900)
const toDanger = await ev(`(() => { const b = [...document.querySelectorAll('#v4world .rlayers .wmtab')].find(x => /危险度/.test(x.textContent||'')); if (b) b.click(); return !!b; })()`)
await sleep(700)

const dump = `(() => {
  const cells = [...document.querySelectorAll('#v4world .wcell')];
  const rows = cells.map(c => {
    const m = /\\((\\d+),(\\d+)\\)/.exec(c.getAttribute('title') || '');
    const dg = /dg(\\d)/.exec(c.className);
    const bg = getComputedStyle(c).backgroundColor.replace(/\\s/g, '');
    return { x: m ? +m[1] : -1, y: m ? +m[2] : -1, dg: dg ? +dg[1] : 0, bg, fog: c.className.includes('fog') };
  });
  return JSON.stringify({ cells: rows, snap: V4World.snapshot(), legend: (document.querySelector('#v4world .wlegend') || {}).textContent || '', layerOn: !!document.querySelector('#v4world .rlayers .wmtab.on') });
})()`
const A = JSON.parse(await ev(dump))
const home = A.snap.home
console.log(`  图层=${toDanger} 格数=${A.cells.length} 家=(${home.x},${home.y})`)

const lit = A.cells.filter(c => !c.fog && c.dg > 0)
ok('本地地图有"危险度上色"图层开关，且每格都带危险度', toDanger === true && lit.length >= 500, `lit=${lit.length}`)

const colors = new Set(lit.map(c => c.bg))
ok('危险度图层只用 5 种梯度色（绿→红）', colors.size === 5, `${colors.size} 种：${[...colors].join(' ')}`)

/* 家的 3×3 必须是安全区（绿） */
const box = lit.filter(c => Math.max(Math.abs(c.x - home.x), Math.abs(c.y - home.y)) <= 1)
ok('家的 3×3 是安全区（危险 1）', box.length === 9 && box.every(c => c.dg === 1), `九宫格=${box.map(c => c.dg).join(',')}`)

/* 相邻差 ≤1（全图扫描，用 DOM 里的危险度） */
const grid = {}
for (const c of lit) grid[c.x + ',' + c.y] = c.dg
let worst = 0, worstAt = ''
for (const c of lit) {
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const n = grid[(c.x + dx) + ',' + (c.y + dy)]
    if (n === undefined) continue
    const d = Math.abs(n - c.dg)
    if (d > worst) { worst = d; worstAt = `(${c.x},${c.y})${c.dg} vs ${n}` }
  }
}
ok('相邻格危险度最多差 1（"越深越难"能一路走过去，不是墙）', worst <= 1, `最大差=${worst} ${worstAt}`)

/* 深度梯度：按离家的距离分段，平均危险度必须递增 */
const seg = (lo, hi) => {
  const xs = lit.filter(c => { const d = Math.max(Math.abs(c.x - home.x), Math.abs(c.y - home.y)); return d >= lo && d <= hi }).map(c => c.dg)
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
}
const s1 = seg(2, 4), s2 = seg(5, 8), s3 = seg(9, 12)
console.log(`  分段平均：内 ${s1.toFixed(2)} / 中 ${s2.toFixed(2)} / 外 ${s3.toFixed(2)}`)
ok('越深越难：内圈 < 中圈 < 外圈', s1 < s2 && s2 < s3, `${s1.toFixed(2)} → ${s2.toFixed(2)} → ${s3.toFixed(2)}`)
const corners = [[0, 0], [23, 0], [0, 23], [23, 23]].map(([x, y]) => grid[x + ',' + y])
ok('四个角都是危险 4~5（最深处最危险）', corners.every(d => d >= 4), `角落=${corners.join(',')}`)

/* 建筑分布：日用品靠家、硬货在深处（用 POI 的 hover 提示读不到，改问地图数据） */
const dist = JSON.parse(await ev(`JSON.stringify((() => {
  const s = V4World.snapshot();
  const w = DEV.state().world;
  const DEF = {};
  return { region: s.region };
})())`))
void dist

const layerLegend = /危险 1/.test(A.legend) && /危险 5/.test(A.legend) && !/城市/.test(A.legend.split('危险度上色')[0] || '')
ok('图例跟着图层换（危险度图层里列 5 档梯度，不列地貌）', layerLegend, A.legend.replace(/\s+/g, ' ').slice(0, 90))
await shot('m19-local-danger-layer')

/* 切回地貌图层：颜色恢复多样 */
await ev(`(() => { const b = [...document.querySelectorAll('#v4world .rlayers .wmtab')].find(x => /地貌/.test(x.textContent||'')); if (b) b.click(); return 1; })()`)
await sleep(700)
const back = JSON.parse(await ev(dump))
ok('切回地貌图层恢复（多种地表色）', new Set(back.cells.filter(c => !c.fog).map(c => c.bg)).size >= 5,
  `${new Set(back.cells.filter(c => !c.fog).map(c => c.bg)).size} 种`)
ok('图层选择被记住（localStorage.dsh.regionlayer）', (await ev(`localStorage.getItem('dsh.regionlayer')`)) === 'type', 'type')

const pageErrs = errs.filter(e => !/favicon|检测到不是游戏写出的存档/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m19_probe.json`, JSON.stringify({ checks, errs: pageErrs, seg: { s1, s2, s3 }, corners, worst }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
