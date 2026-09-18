// M59 取证：大区地图不再"抽搐"（fitRegion ↔ ResizeObserver 正反馈）
//   ① 大区图静止：1280×900 悬浮窗下 2.5 秒采样，格子边长与卡片高度 0 变化（修前实测 11 次）
//   ② 窗口更大 → 格子更大（没有为了"稳"把图缩死）
//   ③ 本地 ↔ 大区 来回切 3 次后仍然静止
//   ④ 大区图仍然"一屏装下"：卡片底不越过视口底、网格不产生内部滚动
//   ⑤ 点选一个区域（详情/路线出来）之后不再抖
//   ⑥ 本地地图同样静止（M41 的正反馈修复没被碰坏）
//   ⑦ 0 未捕获异常 + 截图
// 用法：node docs/_m59_probe.mjs <cdpPort> <url> <outDir>
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
/** 采样：格子边长 / 网格尺寸 / 卡片高度 / 卡片顶 —— 返回去重后的取值列表 */
const sample = async (n = 25, ms = 100) => {
  const rows = []
  for (let i = 0; i < n; i++) {
    rows.push(String(await ev(`(() => {
      const card = document.getElementById('v4world');
      const g = card && card.querySelector('.rgrid, .wgrid');
      if (!card || !g) return 'no-map';
      const gb = g.getBoundingClientRect(), cb = card.getBoundingClientRect();
      return (g.style.gridTemplateColumns || 'css') + '|' + Math.round(gb.width) + 'x' + Math.round(gb.height) + '|card' + Math.round(cb.height) + '|top' + Math.round(cb.top);
    })()`)))
    await sleep(ms)
  }
  const uniq = Array.from(new Set(rows))
  return { changes: rows.filter((v, i) => i && v !== rows[i - 1]).length, uniq, last: rows[rows.length - 1] || '' }
}
const cellOf = (s) => { const m = String(s).match(/repeat\(\d+,\s*(\d+)px\)/); return m ? Number(m[1]) : 0 }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(700)
/* 固定字号与摆法（悬浮窗 100%），免得把别的会话踩过的 pref 污染带进来 */
await ev(`(() => { try { localStorage.setItem('dsh.tutorial.done','1'); localStorage.setItem('zsv-ui-v1', JSON.stringify({ fs: 100, mapOpen: true, mapStyle: 'float' })); } catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
await ev(`(() => { try { closeAllModals() } catch(e){}; try { setTab('explore') } catch(e){}; return 1 })()`)
await sleep(900)
const opened = await ev(`(() => { try { V4Scale.toggleMap(true) } catch(e){}; try { V4World.mapMode('region') } catch(e) { return 'EXC ' + e } return 'ok' })()`)
ok('地图窗能开、大区图能切（探针前置）', opened === 'ok', String(opened))
await sleep(900)

/* ① 大区图静止 */
const s1 = await sample(25, 100)
console.log('  大区(1280×900) 采样行: ' + s1.last + ' | 变化 ' + s1.changes + ' 次')
ok('① 大区图不抽搐：2.5 秒里格子/卡片尺寸 0 变化', s1.changes === 0, 'changes=' + s1.changes + ' uniq=' + JSON.stringify(s1.uniq.slice(0, 4)))
await shot('01_region_stable')

/* ② 窗口更大 → 格子更大（不是靠缩小图求稳） */
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await sleep(1200)
const big = await ev(`(() => { try { V4World.mapMode('region') } catch(e){} return 1 })()`)
await sleep(700)
const s2 = await sample(15, 100)
const c2 = cellOf(s2.last)
console.log('  大区(1920×1080): ' + s2.last + ' → cell=' + c2)
ok('② 1920×1080 下格子明显更大（≥32px）且依然静止', c2 >= 32 && s2.changes === 0, 'cell=' + c2 + ' changes=' + s2.changes)
await shot('02_region_1920')

/* ③ 本地 ↔ 大区 来回切 3 次后仍然静止 */
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(900)
for (let i = 0; i < 3; i++) {
  await ev(`(() => { try { V4World.mapMode('local') } catch(e){} return 1 })()`); await sleep(450)
  await ev(`(() => { try { V4World.mapMode('region') } catch(e){} return 1 })()`); await sleep(450)
}
const s3 = await sample(20, 100)
ok('③ 本地↔大区切 3 次后仍然静止（不累积抖动）', s3.changes === 0, 'changes=' + s3.changes + ' | ' + s3.last)

/* ④ 一屏装下：卡片底不越过视口底太多，网格不产生内部滚动 */
const fit = JSON.parse(await ev(`(() => {
  const card = document.getElementById('v4world'), g = card.querySelector('.rgrid');
  const cb = card.getBoundingClientRect();
  const win = document.getElementById('v4mapwin');
  return JSON.stringify({ cardBottom: Math.round(cb.bottom), winBottom: Math.round(win.getBoundingClientRect().bottom), innerH: window.innerHeight,
    gridH: Math.round(g.getBoundingClientRect().height), gridScrollH: g.scrollHeight, gridCliH: g.clientHeight,
    mwBodyScrollH: (() => { const b = document.querySelector('#v4mapwin .mwbody'); return b ? b.scrollHeight : 0 })(),
    mwBodyCliH: (() => { const b = document.querySelector('#v4mapwin .mwbody'); return b ? b.clientHeight : 0 })() });
})()`))
console.log('  装得下吗: ' + JSON.stringify(fit))
ok('④ 卡片不越过窗口底 40px 以内（窗口自己会滚，但地图不把自己撑爆）', fit.cardBottom <= fit.winBottom + 40, `card ${fit.cardBottom} vs win ${fit.winBottom}`)
ok('④ 网格没有内部纵向滚动（行高由边长推导）', fit.gridScrollH <= fit.gridCliH + 2, `${fit.gridScrollH} vs ${fit.gridCliH}`)

/* ⑤ 点选一个区域后不再抖 */
await ev(`(() => { const cs = Array.from(document.querySelectorAll('#v4world .rcell2:not(.none)')); const t = cs.find(c => !c.classList.contains('here')) || cs[0]; if (t) t.click(); return 1 })()`)
await sleep(900)
const s5 = await sample(20, 100)
const detail = await ev(`(() => { const d = document.querySelector('#v4world .rdetail'); return d ? d.textContent.replace(/\\s+/g,' ').slice(0, 48) : 'NONE' })()`)
console.log('  选中后: ' + s5.last + ' | 详情 ' + detail)
ok('⑤ 点选目标（详情/路线出现）后仍然静止', s5.changes === 0 && detail !== 'NONE', 'changes=' + s5.changes + ' | ' + detail)
await shot('03_region_selected')

/* ⑥ 本地地图同样静止（M41 的正反馈修复没被碰坏） */
await ev(`(() => { try { V4World.mapMode('local') } catch(e){} return 1 })()`)
await sleep(900)
const s6 = await sample(20, 100)
console.log('  本地图: ' + s6.last + ' | 变化 ' + s6.changes + ' 次')
ok('⑥ 本地地图也静止（20 采样 0 变化）', s6.changes === 0, 'changes=' + s6.changes + ' | ' + s6.last + ' | uniq=' + JSON.stringify(s6.uniq.slice(0, 3)))

ok('⑦ 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM59 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
