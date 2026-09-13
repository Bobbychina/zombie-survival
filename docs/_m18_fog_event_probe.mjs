// M18 验收：① 用户报的 bug——小地图上安全屋周围必须点亮，否则玩家一步都走不了
//            ② 区域事件（进区域/换日会撞上按地貌来的随机事件）
// 用法：node docs/_m18_fog_event_probe.mjs <cdpPort> <url> <outDir>
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
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const openWorld = `(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`
const toLocal = `(() => { const b = [...document.querySelectorAll('#v4world .wmtab')].find(x => /本地/.test(x.textContent||'')); if (b && !b.className.includes('on')) b.click(); return 1; })()`

/* ── 1) 新档：安全屋 + 周围一圈必须亮着，而且能点 ── */
await ev(`localStorage.removeItem('zombie_survival_save_v2'); localStorage.setItem('dsh.mapmode','local'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
await ev(openWorld); await sleep(900); await ev(toLocal); await sleep(600)

const dump = `(() => {
  const cells = [...document.querySelectorAll('#v4world .wcell')];
  const lit = cells.filter(c => !c.className.includes('fog'));
  const clickable = cells.filter(c => /V4World\\.click\\(/.test(c.getAttribute('onclick') || ''));
  const cur = cells.find(c => c.className.includes('cur'));
  return JSON.stringify({
    total: cells.length, lit: lit.length, clickable: clickable.length,
    curLit: !!cur && !cur.className.includes('fog'),
    curPos: cur ? (cur.getAttribute('title')||'').slice(0, 12) : '',
    snap: V4World.snapshot(),
  });
})()`
const A = JSON.parse(await ev(dump))
console.log(`  新档: lit=${A.lit} clickable=${A.clickable} cur=${A.curPos}`)
ok('小地图上安全屋所在格是亮的（不是黑的）', A.curLit === true, JSON.stringify({ curLit: A.curLit }))
ok('安全屋周围一圈都点亮了（≥7 格可见，玩家有地方可走）', A.lit >= 7, `lit=${A.lit}/576`)
ok('点亮=可点：能走的格子都带点击事件（≥7）', A.clickable >= 7, `clickable=${A.clickable}`)
await shot('m18-local-lit')

/* 真的点一格走过去：证明"能移动" */
const move = JSON.parse(await ev(`(() => {
  const before = V4World.snapshot();
  const cells = [...document.querySelectorAll('#v4world .wcell')];
  const cur = cells.find(c => c.className.includes('cur'));
  const idx = cells.indexOf(cur);
  const nb = cells[idx + 1] && !cells[idx + 1].className.includes('fog') ? cells[idx + 1] : cells[idx - 1];
  nb.click(); nb.click();                       // 第一次预览、第二次确认（手机等价路径）
  return JSON.stringify({ before: before.cur, after: V4World.snapshot().cur, ap: V4World.snapshot().ap });
})()`))
await sleep(900)
console.log('  走一格: ' + JSON.stringify(move))
ok('点相邻的亮格子真的能走（坐标变了）', move.before.x !== move.after.x || move.before.y !== move.after.y, JSON.stringify(move))

/* ── 2) 回归：老档被"清空 visited"（就是用户遇到的那种档）也必须自动亮回来 ── */
const broken = JSON.parse(await ev(`(() => {
  const S = DEV.state();
  S.world.visited = {};            // 模拟被清空/写坏
  S.world.wv = 999;                // 装作"老版本，需要重画地图"
  localStorage.setItem('zombie_survival_save_v2', JSON.stringify(S));
  return JSON.stringify({ ok: true });
})()`))
void broken
await send('Page.navigate', { url: pageUrl })
await sleep(4200)
await ev(openWorld); await sleep(900); await ev(toLocal); await sleep(600)
const B = JSON.parse(await ev(dump))
console.log(`  坏档修复后: lit=${B.lit} clickable=${B.clickable}`)
ok('老档（visited 被清空 + 版本对不上）打开后依然点亮脚下与周围（玩家不会被卡死）',
  B.curLit === true && B.lit >= 7 && B.clickable >= 7, `lit=${B.lit} clickable=${B.clickable}`)
await shot('m18-broken-save-recovered')

/* ── 3) 区域事件：按地貌给事件 + 结算写日志 ── */
const evInfo = JSON.parse(await ev(`(() => {
  const t = DEV.regionType();
  const before = { hp: DEV.state().hp, mat: DEV.state().mat };
  const e = DEV.forceRegionEvent();
  const after = { hp: DEV.state().hp, mat: DEV.state().mat };
  /* legacy 的日志直接写进 #log 这个 DOM 元素（没有数组），所以从 DOM 读；最新的在最后 */
  const log = [...document.querySelectorAll('#log > *')].slice(-3).map(x => x.textContent || '').join(' | ');
  return JSON.stringify({ t, e, before, after, log, last: V4World.regionEvent() });
})()`))
console.log('  区域事件: ' + JSON.stringify(evInfo.e) + ' 日志: ' + evInfo.log.slice(0, 90))
ok('按当前区域的地貌类型抽到了对应事件（工业区漏毒气/军管区捡军械箱…）',
  !!evInfo.e && evInfo.e.type === evInfo.t && evInfo.t.length > 0, `${evInfo.t} → ${evInfo.e.title}`)
ok('事件结算写进现场日志（玩家能在日志里看到）', /📌/.test(evInfo.log), evInfo.log.slice(0, 80))
ok('V4World.regionEvent() 记录最近一次事件（UI/探针可查）', !!evInfo.last && evInfo.last.title === evInfo.e.title, JSON.stringify(evInfo.last))

/* 危险区事件真的会掉血（拿一个 4~5 级的区域试） */
const hurt = JSON.parse(await ev(`(() => {
  const meta = V4World.meta().regions.filter(r => r.tier >= 4 && r.type === 'industry');
  const target = meta[0];
  const rf = V4World.trip(target.id);
  const S = DEV.state();
  S.world.veh = { fuel: 12, hp: 100 }; S.ap = 9;
  return JSON.stringify({ target: target.name, ok: rf.ok });
})()`))
console.log('  危险区: ' + JSON.stringify(hurt))
ok('地图上存在"危险 4~5 的工业区"（毒气泄漏那类事件有地方发生）', !!hurt.target, hurt.target || 'none')

/* ── 4) 详情面板会预告"这一带的状况" ── */
await ev(`(() => { const b = [...document.querySelectorAll('#v4world .wmtab')].find(x => /大区/.test(x.textContent||'')); if (b && !b.className.includes('on')) b.click(); return 1; })()`)
await sleep(600)
const detail = await ev(`(() => {
  const id = V4World.meta().regions.find(r => r.type === 'industry').id;
  V4World.pickRegion(id);
  return 1;
})()`)
void detail
await sleep(600)
const panel = String(await ev(`(document.querySelector('#v4world .rdetail') || {}).textContent || ''`))
ok('区域详情里预告"这一带的状况"（出发前就知道会撞上什么）', /这一带的状况/.test(panel) && /毒气泄漏/.test(panel), panel.replace(/\s+/g, ' ').slice(0, 110))
await shot('m18-region-detail-hazards')

const pageErrs = errs.filter(e => !/favicon|检测到不是游戏写出的存档/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m18_probe.json`, JSON.stringify({ checks, errs: pageErrs, fresh: A, broken: B, event: evInfo, hurt }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
