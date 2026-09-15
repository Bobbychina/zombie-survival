// M28 取证（M29 后已收窄）：柏林噪声难度场在真世界里的三个硬约束。
//   原来这里的"加密导出 / 粘贴导入 / 老明文兼容"五条随 M29 **下线**（导出/导入入口整体删除，
//   存档改成 worker 密钥落地加密）——那部分现在由 `docs/_m29_probe.mjs` 负责（23 条）。
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
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
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3500)

/* ── ① M29 之后：导出/导入这条路必须彻底没了 ── */
const gone = JSON.parse(await ev(`JSON.stringify({
  exportSave: typeof window.exportSave, importSave: typeof window.importSave,
  pack: typeof window.__v4PackSave, unpack: typeof window.__v4UnpackSave,
})`))
ok('旧的导出/导入函数已经不在 window 上（exportSave / importSave / pack / unpack）',
  gone.exportSave === 'undefined' && gone.importSave === 'undefined' && gone.pack === 'undefined' && gone.unpack === 'undefined',
  JSON.stringify(gone))
const saveHead = await ev(`(async () => {
  const S2 = DEV.state(); S2.day = 66; saveGame(true)
  await new Promise(r => setTimeout(r, 800))
  const raw = localStorage.getItem('zombie_survival_save_v2') || ''
  return JSON.stringify({ head: raw.slice(0, 5), 明文可见: /"day"/.test(raw) })
})()`)
const sh = JSON.parse(saveHead)
ok('本机主档是 M29 的 ZSV1: 密文（M28 的 ZSE1 信封已退役）', sh.head === 'ZSV1:' && sh.明文可见 === false, JSON.stringify(sh))

/* ── ⑥ 大区难度场：三个硬约束 ──
   必须先切到"大区地图"再量：本地视图里根本没有 .rcell2（线上探针第一版就在这儿量到 144 个 0）。 */
await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
await sleep(700)
await ev(`V4World.mapMode('region')`)
await sleep(1400)
const grid = JSON.parse(await ev(`(() => {
  const cells = document.querySelectorAll('#v4world .rcell2')
  const g = []
  for (let r = 0; r < 12; r++) { const row = []; for (let c = 0; c < 12; c++) { const m = /d(\\d)/.exec(cells[r*12+c]?.className || ''); row.push(m ? +m[1] : 0) } g.push(row) }
  /* 注意：localWorld().home 是**本地 24×24** 的坐标，大区图是 12×12 —— 用 .home 那个格子反推大区坐标 */
  const homeEl = document.querySelector('#v4world .rcell2.home')
  const all = [...document.querySelectorAll('#v4world .rcell2')]
  const hi = all.indexOf(homeEl)
  const home = { x: hi % 12, y: Math.floor(hi / 12) }
  let jump = 0, safe = 0, hist = {}
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
    hist[g[r][c]] = (hist[g[r][c]] || 0) + 1
    const d = Math.max(Math.abs(c - home.x), Math.abs(r - home.y))
    if (d <= 1) safe++
    if (c < 11) jump = Math.max(jump, Math.abs(g[r][c] - g[r][c+1]))
    if (r < 11) jump = Math.max(jump, Math.abs(g[r][c] - g[r+1][c]))
  }
  return JSON.stringify({ g, jump, hist, homeXY: [home.x, home.y] })
})()`))
ok('大区图危险度：相邻最多差 1（无断崖）', grid.jump <= 1, 'maxJump=' + grid.jump)
const safeBad = grid.g.flatMap((row, r) => row.map((v, c) => (Math.max(Math.abs(c - grid.homeXY[0]), Math.abs(r - grid.homeXY[1])) <= 1 && v !== 1) ? 1 : 0)).reduce((a, b) => a + b, 0)
ok('新手村（主城 + 紧邻一圈）恒为危险 1', safeBad === 0, '异常格=' + safeBad)
ok('五个危险档都用上了（不是只剩两三档）', [1,2,3,4,5].every(t => (grid.hist[t] || 0) > 0), JSON.stringify(grid.hist))
ok('"太有规律"真的改了：同一圈里出现多种危险度', (() => {
  const byRing = {}
  grid.g.forEach((row, r) => row.forEach((v, c) => { const d = Math.max(Math.abs(c - grid.homeXY[0]), Math.abs(r - grid.homeXY[1])); (byRing[d] = byRing[d] || new Set()).add(v) }))
  return Object.values(byRing).some(s => s.size >= 2)
})(), '')
ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
