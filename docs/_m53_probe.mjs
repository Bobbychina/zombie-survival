// M53 取证：其它页签也走「卡片语言」（P3 视觉统一：技能/制作/任务/统计/背包/据点）
//   ① 每个页签顶层不再剩裸的 .sect-title（都包成了 .v4card）
//   ② 每张包出来的卡都有卡头标题 + 非空卡身
//   ③ 包卡之后内容不许重复、不许横向溢出
//   ④ 地图卡仍然只有 1 张（没被搬动）、页签里不该冒出卡片墙
//   ⑤ 探索页那套没被带坏：卡片墙 1 个 + 日历只 1 份 + 地图 1 张
//   ⑥ 0 未捕获异常
// 用法：node docs/_m53_probe.mjs <cdpPort> <url> <outDir>
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
/* 字号锁回默认：别的探针把它留在 160% 会让"卡片宽度/溢出"这类判定飘（M47 的教训） */
await ev(`(() => { try { localStorage.removeItem('zsv-ui-v1') } catch (e) {} return 1 })()`)
await sleep(700)

const SCAN = `(() => {
  const v = document.getElementById('view');
  const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const bareTitles = [...v.children].filter(e => e.classList.contains('sect-title')).map(e => norm(e.textContent).slice(0, 18));
  const cards = [...v.children].filter(e => e.classList.contains('v4card'));
  const bad = cards.filter(c => {
    const hd = c.querySelector(':scope > .card-hd .card-tt');
    const bd = c.querySelector(':scope > .card-bd');
    return !hd || !norm(hd.textContent) || !bd || !norm(bd.textContent);
  }).map(c => norm(c.textContent).slice(0, 24));
  /* 兄弟节点整块重复哨兵（M46 同款） */
  const groups = new Map();
  for (const el of v.querySelectorAll('*')) {
    const p = el.parentElement; if (!p) continue;
    const key = p.className + '|' + el.tagName + '|' + el.className;
    const txt = norm(el.textContent); if (txt.length < 40) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key); g.set(txt, (g.get(txt) || 0) + 1);
  }
  const dups = [];
  for (const [key, g] of groups) for (const [txt, n] of g) if (n >= 2) dups.push({ key: String(key).slice(0, 40), txt: txt.slice(0, 40) });
  return JSON.stringify({
    bareTitles, cards: cards.length, bad, dups,
    overflowX: v.scrollWidth > v.clientWidth + 2,
    pageScroll: document.scrollingElement.scrollHeight > innerHeight + 1,
    maps: document.querySelectorAll('#v4world').length,
    boards: document.querySelectorAll('#v4cards').length,
  });
})()`

const TABS = [['body', '人体'], ['base', '据点'], ['inv', '背包'], ['craft', '制作'], ['skills', '技能'], ['quest', '任务'], ['codex', '图鉴'], ['stats', '统计']]
for (const [tab, name] of TABS) {
  await ev(`(() => { closeAllModals(); S.over = false; setTab('${tab}'); render(); return 1 })()`)
  await sleep(1000)
  const r = JSON.parse(await ev(SCAN))
  ok(`${name}页：顶层不再剩裸标题（分段都包成卡了）`, r.bareTitles.length === 0, r.bareTitles.length ? JSON.stringify(r.bareTitles) : `cards=${r.cards}`)
  ok(`${name}页：包出来的卡都有标题 + 非空卡身`, r.bad.length === 0, r.bad.length ? JSON.stringify(r.bad) : '')
  ok(`${name}页：无重复内容 / 无横向溢出 / 地图卡仍 1 张 / 没冒卡片墙`,
    r.dups.length === 0 && r.overflowX === false && r.maps === 1 && r.boards === 0,
    JSON.stringify({ dups: r.dups.slice(0, 2), overflowX: r.overflowX, maps: r.maps, boards: r.boards, pageScroll: r.pageScroll }))
  await shot(`tab_${tab}`)
}
/* 探索页别被带坏 */
await ev(`(() => { setTab('explore'); render(); return 1 })()`); await sleep(1400)
const ex = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#v4cards > .v4card')];
  const cal = [...document.querySelectorAll('#view .card')].filter(c => /每 7 天一次/.test(c.textContent || '')).length;
  return JSON.stringify({ n: cards.length, cal, boards: document.querySelectorAll('#v4cards').length,
    maps: document.querySelectorAll('#v4world').length, mapwins: document.querySelectorAll('#v4mapwin').length });
})()`))
ok('探索页没被带坏（日历 1 份 / 卡片墙 1 个 / 地图卡 1 张 / 地图窗 1 个）',
  ex.cal === 1 && ex.boards === 1 && ex.maps === 1 && ex.mapwins === 1 && ex.n >= 9, JSON.stringify(ex))
await shot('tab_explore')
ok('0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM53 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
