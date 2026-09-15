// M28 取证：① 导出存档是加密信封（不是明文）② 导入能解回来（原样恢复）③ 老格式（base64 明文）仍然能导入
//   ④ 改一个字符就报损坏 ⑤ 柏林噪声难度场在真世界里的三个硬约束
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

/* ── ① 加密导出 ── */
const packed = JSON.parse(await ev(`(async () => {
  const S2 = DEV.state(); S2.day = 7; S2.mat = 123
  const plain = JSON.stringify(S2)
  const code = await window.__v4PackSave(plain)
  return JSON.stringify({ code, plainLen: plain.length, codeLen: code.length,
    head: code.slice(0, 5), 明文片段: /"day"/.test(code) || /余烬/.test(code) })
})()`))
ok('导出是加密信封（ZSE1: 开头）', packed.head === 'ZSE1:', packed.head)
ok('导出文本里没有任何明文字段（day / 余烬 都搜不到）', packed.明文片段 === false, '长度 ' + packed.plainLen + ' → ' + packed.codeLen)
/* base64 本身就要 +33%，再加词表与 22 字节头：实测 ≈1.65×。两倍以内就算"没爆炸"，
   真正的对照组是第一版：那一版 LZ 出来是 3.2 倍（越压越大，探针抓到的）。 */
ok('加密后的长度可控（压缩 + base64 后没有爆炸）', packed.codeLen < packed.plainLen * 2.0, packed.plainLen + ' → ' + packed.codeLen);
await shot('51_export_encrypted')

/* ── ② 解回来一模一样 ── */
const back = JSON.parse(await ev(`(async () => {
  const S2 = DEV.state()
  const plain = JSON.stringify(S2)
  const j = await window.__v4UnpackSave(await window.__v4PackSave(plain))
  return JSON.stringify({ same: j === plain, day: JSON.parse(j).day })
})()`))
ok('解密回来与原文逐字节一致', back.same === true, 'day=' + back.day)

/* ── ③ 改一个字符 → 报损坏 ── */
const tampered = await ev(`(async () => {
  const S2 = DEV.state()
  const code = await window.__v4PackSave(JSON.stringify(S2))
  const i = Math.floor(code.length / 2)
  const bad = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1)
  try { await window.__v4UnpackSave(bad); return 'NO-THROW' } catch (e) { return e.message }
})()`)
ok('改一个字符就报"存档已损坏/校验和不匹配"', /校验和不匹配|损坏|太短/.test(String(tampered)), String(tampered).slice(0, 40))

/* ── ④ UI 走一遍：导出弹窗 → 导入弹窗（加密格式） ──
   先把当天改成 42 再导出：这样"导出的存档里就是第 42 天"，导入之后能验证"读回来的确实是那份存档"，
   而不是碰巧和当前状态一样。 */
await ev(`(() => { DEV.state().day = 42; exportSave(); return 1 })()`); await sleep(1100)
const dlg = JSON.parse(await ev(`(() => {
  const b = document.getElementById('exp-box')
  return JSON.stringify({ has: !!b, val: b ? b.value.slice(0, 5) : '', len: b ? b.value.length : 0,
    warn: /加密/.test(document.body.innerText) })
})()`))
ok('导出弹窗里给的是加密文本（ZSE1:…）且写明"已加密"', dlg.has && dlg.val === 'ZSE1:' && dlg.warn === true, JSON.stringify({ val: dlg.val, len: dlg.len }))
await shot('52_export_dialog')
const code = await ev(`document.getElementById('exp-box').value`)
await ev(`closeAllModals(); 1`); await sleep(300)
const imported = JSON.parse(await ev(`(async () => {
  const S2 = DEV.state(); S2.day = 7                      // 故意改乱：证明是"导入"把它还原回 42
  const want = JSON.parse(${JSON.stringify(code)}.startsWith('ZSE1:') ? await window.__v4UnpackSave(${JSON.stringify(code)}) : '{}')
  importSave()
  await new Promise(r => setTimeout(r, 300))
  document.getElementById('imp-box').value = ${JSON.stringify(code)}
  document.getElementById('imp-go').click()
  await new Promise(r => setTimeout(r, 1500))
  return JSON.stringify({ day: DEV.state().day, 存档里的天: want.day, modalGone: !document.querySelector('.modal'),
    logTail: (document.getElementById('log')||document.body).innerText.split('\\n').slice(-1)[0] })
})()`))
ok('粘回导入弹窗能恢复（存档里的第 42 天原样回来）', imported.day === imported.存档里的天 && imported.day === 42, JSON.stringify(imported))

/* ── ⑤ 老格式（明文 base64）仍然能导入：老玩家的备份不作废 ── */
const legacy = JSON.parse(await ev(`(async () => {
  const S2 = DEV.state(); S2.day = 66
  const old = btoa(unescape(encodeURIComponent(JSON.stringify(S2))))
  S2.day = 1; DEV.state().day = 1
  importSave()
  await new Promise(r => setTimeout(r, 300))
  document.getElementById('imp-box').value = old
  document.getElementById('imp-go').click()
  await new Promise(r => setTimeout(r, 500))
  return JSON.stringify({ day: DEV.state().day })
})()`))
ok('老版明文 base64 存档仍然能导入（向后兼容）', legacy.day === 66, JSON.stringify(legacy))

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
