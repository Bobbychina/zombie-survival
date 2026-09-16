// M46 取证：全页签（+ 商人弹窗）扫一遍「内容重复」——把 M45 那类 bug 的排查面从探索页扩到全站
//   ① 每个页签：顶层内容块（.v4card / .card / .grid，只取最外层）的正文两两不重复
//   ② 每个页签：没有标题退化成兜底档「📋 + 正文前 12 字」的 legacy 卡
//   ③ 每个页签：卡片墙 #v4cards 只有 1 个、地图卡 #v4world 全局只有 1 个（不外泄到别的页）
//   ④ 商人弹窗（M44 买/卖页签）里同样不重复
//   ⑤ 0 未捕获异常
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

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await sleep(900)

/* 扫描器 A：只取"最外层"内容块，避免 .v4card 里套着 legacy .card 的自比较 */
const SCAN = (scope) => `(() => {
  const root = ${scope};
  if (!root) return 'NO-SCOPE';
  const all = [...root.querySelectorAll('.v4card, .card, .grid')]
    .filter(e => !(e.parentElement && e.parentElement.closest('.v4card, .card, .grid')));
  const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const items = all.map(e => ({ t: norm(e.querySelector('.card-tt')?.textContent || '').slice(0, 24), b: norm(e.textContent), n: norm(e.textContent).length }));
  const seen = new Map(); const dups = [];
  for (const it of items) {
    if (it.n < 24) continue;                       // 太短的不算（一堆只有标题的空卡）
    if (seen.has(it.b)) dups.push([seen.get(it.b), it.t || '(无标题)']); else seen.set(it.b, it.t || '(无标题)');
  }
  const orphan = items.filter(it => /^📋 /.test(it.t)).map(it => it.t);
  return JSON.stringify({ blocks: items.length, dups, orphan });
})()`

/* 扫描器 B（更狠的通用哨兵）：同父同类的兄弟节点里，正文一字不差的 ≥2 个 = 重复内容。
   只比兄弟节点 → 不会把"弹窗里的列表"和"页面上的列表"这种合法重复算进来。
   M45 那张重复的日历卡就是这个形状（两个同父 .v4card，正文完全相同）。 */
const SCAN_SIBLINGS = (scope, min = 40) => `(() => {
  const root = ${scope};
  if (!root) return 'NO-SCOPE';
  const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const groups = new Map();
  for (const el of root.querySelectorAll('*')) {
    const p = el.parentElement;
    if (!p) continue;
    const key = p.tagName + '|' + (p.className || '') + '|' + el.tagName + '|' + (el.className || '');
    const txt = norm(el.textContent);
    if (txt.length < ${min}) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key);
    g.set(txt, (g.get(txt) || 0) + 1);
  }
  const dups = [];
  for (const [key, g] of groups) for (const [txt, n] of g) if (n >= 2) dups.push({ key, n, txt: txt.slice(0, 60) });
  return JSON.stringify({ dups });
})()`

const TABS = ['explore', 'body', 'base', 'inv', 'craft', 'skills', 'quest', 'codex', 'stats']
let totalDups = 0, totalOrphan = 0
for (const tab of TABS) {
  await ev(`(() => { closeAllModals(); S.over = false; setTab('${tab}'); render(); return 1 })()`)
  await sleep(900)
  const raw = await ev(SCAN(`document.getElementById('view')`))
  if (typeof raw !== 'string' || raw === 'NO-SCOPE') { ok(`${tab} 页扫描`, false, String(raw)); continue }
  const r = JSON.parse(raw)
  totalDups += r.dups.length; totalOrphan += r.orphan.length
  ok(`${tab} 页没有内容重复的块`, r.dups.length === 0, `blocks=${r.blocks}` + (r.dups.length ? ' dups=' + JSON.stringify(r.dups) : ''))
  ok(`${tab} 页没有兜底标题的孤儿卡`, r.orphan.length === 0, r.orphan.length ? JSON.stringify(r.orphan) : '')
  const sib = JSON.parse(await ev(SCAN_SIBLINGS(`document.body`)))
  totalDups += sib.dups.length
  ok(`${tab} 页没有"兄弟节点整块重复"`, sib.dups.length === 0, sib.dups.length ? JSON.stringify(sib.dups.slice(0, 3)) : '')
  await shot(`tab_${tab}`)
}
/* 全局唯一性：卡片墙只在探索页存在（别的页签不参与），地图卡/地图窗全局各 1 份 */
const uniq = await ev(`(() => JSON.stringify({
  tab: S.tab, boards: document.querySelectorAll('#v4cards').length,
  maps: document.querySelectorAll('#v4world').length,
  mapwins: document.querySelectorAll('#v4mapwin').length,
}))()`)
const u = JSON.parse(uniq)
ok('全局只有 1 张地图卡 / 1 个地图窗（卡片墙只属于探索页）', u.maps === 1 && u.mapwins === 1 && u.boards <= 1, uniq)
await ev(`(() => { setTab('explore'); render(); return 1 })()`); await sleep(900)
const u2 = JSON.parse(await ev(`(() => JSON.stringify({ boards: document.querySelectorAll('#v4cards').length, maps: document.querySelectorAll('#v4world').length }))()`))
ok('回到探索页后卡片墙在（且只有 1 个）', u2.boards === 1 && u2.maps === 1, JSON.stringify(u2))

/* 商人弹窗（M44 买/卖两页签）：弹窗内部也不能有重复块 */
await ev(`(() => { closeAllModals(); setTab('explore'); render(); openMerchant(); return 1 })()`)
await sleep(1100)
const modalInfo = await ev(`(() => {
  const m = document.querySelector('[id^="modal"], .modal, .modalbox, [role="dialog"]');
  if (!m) return 'NO-MODAL';
  return JSON.stringify({ id: m.id || '', cls: m.className || '', len: (m.textContent || '').length, sell: /卖|出售/.test(m.textContent || '') });
})()`)
const mi = typeof modalInfo === 'string' && modalInfo !== 'NO-MODAL' ? JSON.parse(modalInfo) : null
ok('商人弹窗打开了（能看到弹窗内容）', !!mi && mi.len > 200, modalInfo)
if (mi) {
  const r = JSON.parse(await ev(SCAN_SIBLINGS(`document.querySelector('[id^="modal"], .modal, .modalbox, [role="dialog"]')`)))
  ok('商人弹窗里没有"兄弟节点整块重复"', r.dups.length === 0, r.dups.length ? JSON.stringify(r.dups.slice(0, 3)) : '')
  await shot('modal_merchant')
}
await ev(`(() => { closeAllModals(); return 1 })()`)

ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log(`\nM46 汇总：重复块 ${totalDups} 个 · 孤儿卡 ${totalOrphan} 张`)
const pass = checks.filter(([, c]) => c).length
console.log(`M46 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
