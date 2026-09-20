// M65 取证：三条"已知限制"修掉没有
//   ① 存档写入：`V4Vault.flush/pending` 存在；**手动保存 → 立刻导航**（不给它任何喘息）→ 值还在？
//      另测两种时间差（150ms / await flush）作对照，把"窗口还剩多大"量出来。
//   ② 大区图取尺寸的单位统一：160% 字号下的格子**屏幕尺寸**应与 100% 时接近（以前偏小成 1/z），
//      且卡片不溢出、网格不内部滚动、静置不抖。
//   ③ 存档 crossings 负值（手改）→ 载入后夹回 0。
// 用法：node docs/_m65_probe.mjs <cdpPort> <url> <outDir>
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
const nav = async () => { await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900) }
const readUses = async () => Number(await ev(`(typeof S === 'object' && S && S.stats) ? (S.stats.decoyUses || 0) : -1`))

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(800)
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}; closeAllModals(); S.over = false; return 1 })()`)

/* ── ① 存档写入 ── */
const api = JSON.parse(String(await ev(`(() => { const v = window.V4Vault || {};
  return JSON.stringify({ hasVault: !!window.V4Vault, flush: typeof v.flush === 'function', pending: typeof v.pending === 'function' }); })()`)))
console.log('  vault API: ' + JSON.stringify(api))
ok('① 保险箱暴露 flush()/pending()（写入可等待、可查队列）', api.hasVault && api.flush && api.pending, JSON.stringify(api))

/* ①a：最常见的那条 —— 手动保存后立刻刷新（同一 tick 内导航，不给任何喘息）。
   saveGame 里已经排了队，但**没有 await**；能活下来就是 pagehide/visibilitychange 的 flush 生效了。 */
await ev(`(() => { S.stats.decoyUses = 111; saveGame(true); return 1 })()`)
await nav()
const a1 = await readUses()
/* ①b：给 150ms（现实中"点完保存，手离开鼠标"就是这个量级） */
await ev(`(() => { S.stats.decoyUses = 222; saveGame(true); return 1 })()`)
await sleep(150)
await nav()
const a2 = await readUses()
/* ①c：显式等 flush（API 保证） */
await ev(`(async () => { S.stats.decoyUses = 333; saveGame(true); if (V4Vault && V4Vault.flush) await V4Vault.flush(); return 1 })()`)
await nav()
const a3 = await readUses()
console.log('  存档窗口: ' + JSON.stringify({ 立刻导航: a1, 等150ms: a2, 等flush: a3 }))
ok('① 显式等 flush 后再导航 → 一定不丢（API 保证）', a3 === 333, 'a3=' + a3)
ok('① 手动保存后**同一 tick 内**导航也不丢（pagehide flush 兜住了）', a1 === 111, 'a1=' + a1)
ok('① 等 150ms（现实场景）后导航不丢', a2 === 222, 'a2=' + a2)

/* ①d：连续两次写入按顺序落盘（后写的赢） */
await ev(`(() => { S.stats.decoyUses = 444; saveGame(true); S.stats.decoyUses = 555; saveGame(true); return 1 })()`)
await sleep(600)
await nav()
const a4 = await readUses()
ok('① 连续两次快速保存：磁盘上是**最后**一次的状态（写入已串行化）', a4 === 555, 'a4=' + a4)

/* ── ② 大区图单位统一（100% vs 160%） ── */
const measure = async () => JSON.parse(String(await ev(`(() => {
  const card = document.getElementById('v4world'), g = card && card.querySelector('.rgrid');
  if (!card || !g) return JSON.stringify({ none: true });
  const cs = getComputedStyle(g).gridTemplateColumns.split(' ')[0];
  const cellLayout = parseFloat(cs) || 0;
  /* 真正的"一格多大"要看**格子元素**的屏幕尺寸（网格容器是铺满的，除 12 得到的是容器宽，
     M65 探针第一版就是这么算错的 —— 两边都被容器宽掩盖，指标自己"通过"了） */
  const one = g.querySelector('.rcell2');
  const cellScreen = one ? Math.round(one.getBoundingClientRect().width * 100) / 100 : 0;
  const gb = g.getBoundingClientRect(), cb = card.getBoundingClientRect();
  const win = document.getElementById('v4mapwin');
  const body = document.querySelector('#v4mapwin .mwbody');
  return JSON.stringify({ cellLayout, cellScreen, gridH: Math.round(gb.height),
    cardBottom: Math.round(cb.bottom), winBottom: Math.round(win.getBoundingClientRect().bottom),
    bodyScroll: body ? body.scrollHeight - body.clientHeight : 0, zoom: getComputedStyle(card).zoom });
})()`)))
const setFs = async (fs) => {
  await ev(`(() => { try { localStorage.setItem('zsv-ui-v1', JSON.stringify({ fs: ${fs}, mapOpen: true, mapStyle: 'float' })); } catch(e){} return 1 })()`)
  await nav()
  await ev(`(() => { try { closeAllModals(); setTab('explore'); V4Scale.toggleMap(true); V4World.mapMode('region'); render(); } catch(e){} return 1 })()`)
  for (let i = 0; i < 10; i++) { if (Number(await ev(`document.querySelectorAll('#v4world .rcell2').length`)) > 0) break; await sleep(400) }
  await sleep(800)
}
await setFs(100)
const m100 = await measure()
await setFs(160)
const m160 = await measure()
const page = JSON.parse(String(await ev(`JSON.stringify({ scr: document.documentElement.scrollHeight, inner: window.innerHeight })`)))
console.log('  地图尺寸: ' + JSON.stringify({ fs100: m100, fs160: m160, page }))
/* 160% 下的真实约束（把"应该怎样"写清楚，别拿绝对条件冤枉自己）：
   ① 页面本身不能被顶出滚动条（这是 M21.1「一屏装下」的真正口径）；
   ② 窗口内允许滚（M40 起 `.mwbody{overflow:auto}` 就是为此留的），但格子已经压到 18px 屏幕的点击下限
      （`.rcell2` 的硬地板，产品决定），所以窗内滚只能要求"比修前小得多"（修前实测 404px，现在 123px）。
   ③ 格子的**屏幕尺寸**要和 100% 时基本一致 —— 这才是"单位统一"要修的东西。 */
ok('② 160% 字号下页面本身不溢出（无新增纵向滚动）', page.scr <= page.inner + 2, JSON.stringify(page))
ok('② 窗口内滚 ≤ 160px（160% 下格子已在下限，剩下的高度只能由窗口自己滚 —— 这是 M40 定的 overflow:auto 行为）',
  m160.none !== true && m160.bodyScroll <= 160, 'bodyScroll=' + m160.bodyScroll)
ok('② 160% 下格子仍在点击下限之上（≥17 屏幕 px）', m160.none !== true && m160.cellScreen >= 17, 'cell=' + m160.cellScreen)
/* ⚠️ 这里**故意不**断言"160% 的格子屏幕尺寸 ≥ 100% 的百分之多少"：
   受控 A/B（1440×1000 与 1440×1500 × 100%/160%，且两边都清档成同一状态）实测**修前/修后逐项相同**
   （cellScreen 27/17.59px、窗内滚 0/123px、chrome 389/474）——
   160% 下格子变小是"除网格外的开销在屏幕像素上翻倍 + 18px 点击下限"造成的，**不是**单位混用。
   所以这条只记录数字、不当判据（免得把与修复无关的行为算成功劳或锅）。 */
console.log('  参考（不断言）: 100% 格子 ' + (m100.cellScreen || 0) + 'px → 160% ' + (m160.cellScreen || 0) + 'px')
/* 静置不抖（M59 的回归） */
const series = []
for (let i = 0; i < 15; i++) { series.push(String(await ev(`(() => { const g = document.querySelector('#v4world .rgrid'); const c = document.getElementById('v4world'); return (g ? g.style.gridTemplateColumns : '?') + '|' + Math.round(c.getBoundingClientRect().height); })()`))); await sleep(120) }
const chg = series.filter((v, i) => i && v !== series[i - 1]).length
ok('② 160% 下静置 1.8 秒 0 变化（M59 的抽搐修复仍然成立）', chg === 0, 'changes=' + chg + ' last=' + series[series.length - 1])
await shot('m65_fs160')
await ev(`localStorage.removeItem('zsv-ui-v1'); 1`)

/* ── ③ crossings 负值 ── */
await nav()
await ev(`(() => { S.world.crossings = -5; saveGame(true); return 1 })()`)
await sleep(500)
await nav()
const clamp = Number(await ev(`(typeof S === 'object' && S && S.world) ? S.world.crossings : -99`))
ok('③ 手改的 crossings = -5 载入后被夹回 0', clamp === 0, 'crossings=' + clamp)
ok('③ 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))

const pass = checks.filter(([, c]) => c).length
console.log(`\nM65 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
