// M72b 取证：传闻口径（危险度/辐射改成"幸存者传闻"，第一次进区事件概率更高）
//   ① 没去过的大区：只有**传闻** —— 区间（"3~5"）+ 出处（"幸存者说…"）+ 能不能去的定性判断
//   ② 危险度图层上没去过的格子**不摊数值**（画问号，颜色按传闻中点 = 可能不准）
//   ③ 同一存档内传闻稳定：刷新（读档）前后逐字一致
//   ④ 去过之后：传闻变**实测记录**（精确档位 + 上次到访的时间/结果），UI 上换口径
//   ⑤ 首次进区事件概率更高：常量 ×2.2 / 抽样统计两组数字 / 端到端（Math.random 钉在 0.5：首次出事、复访不出事）
//   ⑥ 首次进区的叙事提示（"你第一次踏进这里"+ 概率提示）真的写进日志
//   ⑦ 存档往返：regionFirst/regionLast 没被 sanitize 洗掉（洗掉 = 读档后首次进区判定重算）
// 用法：node docs/_m72b_probe.mjs <cdpPort> <url> <outDir>
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
const j = async (x) => JSON.parse(String(await ev(x)))
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(600)
await ev(`(() => { try {
  ['zombie_survival_save_v2','zombie_survival_save_v2.bak','zombie_survival_backups_v1','zsv-ui-v1','dsh.mapmode','dsh.regionlayer','zsv-lab-v1'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('dsh.tutorial.done','1');
} catch(e){} return 1 })()`)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
/** 干净的起点：一天、够用的行动力与油（跨区要开车）、停在探索页的大区地图 */
const setup = () => ev(`(() => {
  try { localStorage.setItem('dsh.tutorial.done','1'); } catch(e){}
  closeAllModals(); S.over = false; S.ap = 30; S.mat = 200; S.hp = 100;
  S.world.veh = { fuel: 12, hp: 100 };
  const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(b) b.click();
  V4World.mapMode('region'); V4World.regionLayer('danger'); render();
  return 1 })()`)
await setup(); await sleep(1200)
/** 一次跨区出发：先把油与行动力补满（探针不测油耗，M12 已有专测） */
const goto = async (rid) => {
  await ev(`(() => { S.ap = 30; S.world.veh = { fuel: 12, hp: 100 }; return 1 })()`)
  return ev(`(() => { try { V4World.travelRegion('${rid}'); return 'ok' } catch(e) { return 'EXC ' + e.message } })()`)
}
/** 点开某个区域并**等一次渲染落地**再读 DOM（render 有节流：同一轮里读会读到旧面板） */
const pickRegion = async (rid) => { await ev(`(() => { V4World.pickRegion('${rid}'); return 1 })()`); await sleep(500) }
/** 详情面板（选中区域那一块）的文案——只取 .rdetail，别把地图图例里的"传闻"字样算进来 */
const detailText = () => ev(`(() => { const d = document.querySelector('.rdetail:not(.empty)') || document.querySelector('.rdetail'); return d ? String(d.textContent || '').replace(/\\s+/g,' ') : '' })()`)
const openDetail = async (rid) => { await pickRegion(rid); return String(await detailText()) }
const readOf = (rid) => j(`(() => JSON.stringify(V4World.regionRead('${rid}')))()`)
const lines = () => j(`(() => JSON.stringify(S.logBuf.slice(-14).map(p => String(p[1]))))()`)

/* 选目标：一个还没去过、危险度 3、开车够得着的区域（首次进区的倍率在这一档最好看）；
   再挑第二个没去过的区做"端到端"那一项（Math.random 钉在 0.5）。 */
const pick = await j(`(() => {
  const meta = V4World.meta(); const here = S.world.region;
  const cand = meta.regions.filter(r => r.id !== here && V4World.trip(r.id).ok);
  const unseenCand = cand.filter(r => !S.world.seenRegions[r.id]);
  const t3un = unseenCand.filter(r => r.tier === 3);
  const target = (t3un[0] || unseenCand[0] || { id: '' }).id;
  const second = (unseenCand.filter(r => r.id !== target)[0] || { id: '' }).id;
  const unseen = meta.regions.filter(r => r.id !== here && !S.world.seenRegions[r.id]).map(r => r.id);
  return JSON.stringify({ here, target, second, tier: (meta.regions.find(r => r.id === target) || {}).tier || 0, unseen: unseen.slice(0, 8) })
})()`)
const U = pick.target
console.log('  目标区 = ' + U + '（危险度 ' + pick.tier + '）· 当前在 ' + pick.here + ' · 未去过样本 ' + pick.unseen.join(','))

/* ── ① 没去过的大区：只有传闻（区间 + 出处 + 定性判断） ── */
const rum = await readOf(U)
const domRum = await openDetail(U)
if (outDir) await shot('m72b-region-rumor')
ok('① 没去过的区域给的是**传闻**（kind=rumor，不是实测）', rum.seen === false && rum.danger.kind === 'rumor' && rum.rad.kind === 'rumor',
  JSON.stringify({ seen: rum.seen, danger: rum.danger.kind, rad: rum.rad.kind }))
ok('① 传闻带**误差区间**（"3~5"这种，不是精确档位）', /^\d~\d$/.test(rum.danger.band.lo + '~' + rum.danger.band.hi) && rum.danger.band.hi > rum.danger.band.lo,
  rum.danger.brief)
ok('① 传闻带**出处**（"幸存者说…"）+ 原话', /说|写着|刻着|嘟囔/.test(rum.danger.source) && rum.danger.line.indexOf('：「') >= 0,
  rum.danger.line)
ok('① 传闻给出"能不能去"的**定性判断**（不是只有数字）', !!(rum.danger.verdictText && rum.danger.verdictText.length >= 4) &&
  ['safe', 'easy', 'risky', 'hard', 'deadly'].indexOf(rum.danger.verdict) >= 0, rum.danger.verdictText)
ok('① 辐射同样是传闻口径', /传闻辐射/.test(rum.rad.brief) && rum.rad.line.indexOf('：「') >= 0, rum.rad.brief)
const bandTxt = rum.danger.band.lo + '~' + rum.danger.band.hi
ok('① 详情面板真的显示传闻（含区间与出处，不是"危险 3"这种结论）',
  domRum.indexOf('传闻危险') >= 0 && domRum.indexOf(bandTxt) >= 0 && domRum.indexOf('：「') >= 0 &&
  domRum.indexOf('还没去过') >= 0 && domRum.indexOf('这是传闻') >= 0 && !/实测/.test(domRum),
  '面板片段=' + domRum.slice(Math.max(0, domRum.indexOf('传闻危险') - 10), domRum.indexOf('传闻危险') + 120))

/* ── ② 危险度图层：没去过的格子不摊数值（问号 + 传闻上色） ── */
const layer = await j(`(() => {
  const cells = [...document.querySelectorAll('#v4world .rcell2')];
  const un = cells.filter(c => c.classList.contains('unseen'));
  const unNum = un.map(c => { const i = c.querySelector('.rnum'); return i ? i.textContent : null }).filter(x => x !== null);
  const seenNum = cells.filter(c => !c.classList.contains('unseen')).map(c => { const i = c.querySelector('.rnum'); return i ? i.textContent : null }).filter(x => x !== null);
  return JSON.stringify({ unseen: un.length, unNum: unNum.slice(0, 4), qAll: unNum.length > 0 && unNum.every(t => t === '?'), seenNum: seenNum.slice(0, 4) })
})()`)
ok('② 危险度图层：没去过的格子画**问号**（不把数值摊在 UI 上），去过的是实测数字',
  layer.unseen > 0 && layer.qAll && layer.seenNum.length > 0 && layer.seenNum.every(t => /^[1-5]$/.test(t)),
  JSON.stringify({ unseen格: layer.unseen, 问号: layer.unNum, 已去过数字: layer.seenNum }))

/* ── ③ 同一存档内传闻稳定（读档/刷新前后逐字一致） ── */
const sampleIds = pick.unseen.slice(0, 4).concat([U])
const snap = () => j(`(() => JSON.stringify(${JSON.stringify(sampleIds)}.map(id => { const r = V4World.regionRead(id); return id + '|' + r.danger.brief + '|' + r.danger.line + '|' + r.rad.brief + '|' + r.rad.line })))()`)
const before = await snap()
await ev(`(() => { saveGame(true); return 1 })()`); await sleep(900)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(1200)
await setup(); await sleep(700)
const after = await snap()
ok('③ 同一存档内传闻稳定：刷新（读档）前后逐字一致（不是每帧随机）', JSON.stringify(before) === JSON.stringify(after),
  '样例=' + String(before[0]).slice(0, 80))
const dayStable = await j(`(() => { const a = V4World.regionRead('${U}').danger, b = V4World.regionRead('${U}').danger; return JSON.stringify({ same: a.line === b.line && a.brief === b.brief }) })()`)
ok('③ 同一次渲染前后也稳定（纯函数，不依赖调用次数）', dayStable.same === true)

/* ── ④ 去过之后：传闻 → 实测（精确数值 + 上次到访的时间/结果） ── */
const tripOk = await goto(U)
await sleep(700)
const seen0 = await readOf(U)
const logFirst = await lines()
ok('④ 出发到过了这一带（跨区真的落地了）', tripOk === 'ok' && seen0.seen === true && seen0.visits >= 1,
  JSON.stringify({ ret: tripOk, seen: seen0.seen, visits: seen0.visits, day: seen0.day }))
ok('④ 去过之后不再是传闻：danger/rad 都变成**实测**，危险度是精确档位',
  seen0.danger.kind === 'measured' && seen0.rad.kind === 'measured' && seen0.danger.tier === pick.tier,
  '实测档位=' + seen0.danger.tier + '（真值 ' + pick.tier + '）· ' + seen0.danger.brief)
ok('④ 实测记录带**上次到访的时间与结果**', /实测/.test(seen0.danger.line) && seen0.danger.line.indexOf('第 ' + seen0.day + ' 天') >= 0 &&
  /第一次踏进来|到过/.test(seen0.danger.line), seen0.danger.line)
/* 回主城，再点开那个已经去过的区 —— 详情面板应该整块换成实测口径 */
await goto(pick.here); await sleep(600)
const domReal = await openDetail(U)
if (outDir) await shot('m72b-region-measured')
ok('④ 详情面板换口径：已去过的区域显示"实测危险 N"与上次到访，且不再出现"还没去过"/"这是传闻"',
  domReal.indexOf('实测危险') >= 0 && domReal.indexOf('上次') >= 0 && domReal.indexOf('还没去过') < 0 &&
  domReal.indexOf('这是传闻') < 0 && domReal.indexOf('实测危险 ' + pick.tier) >= 0,
  '面板片段=' + domReal.slice(0, 150))

/* ── ⑤ 首次进区事件概率更高 ── */
const odds = await j(`(() => JSON.stringify([1,2,3,4,5].map(t => ({ t, base: V4World.eventOdds(t, false).chance, first: V4World.eventOdds(t, true).chance, mul: V4World.eventOdds(t, true).mul }))))()`)
ok('⑤ 常量口径：首次进区概率 ×2.2、封顶 0.95（3 档 0.45 → 0.95，五档全部提升）',
  odds.every(o => Math.abs(o.mul - 2.2) < 1e-9 && o.first > o.base && Math.abs(o.first - Math.min(0.95, o.base * 2.2)) < 1e-9) &&
  Math.abs(odds[2].base - 0.45) < 1e-9 && Math.abs(odds[2].first - 0.95) < 1e-9 && odds[0].first > odds[0].base * 2.1,
  odds.map(o => o.t + '档 ' + o.base.toFixed(2) + '→' + o.first.toFixed(2)).join(' · '))
const rates = await j(`(() => JSON.stringify({ normal: V4World.eventRate(false, 2000, 20260922, 'industry', 3), first: V4World.eventRate(true, 2000, 20260922, 'industry', 3) }))()`)
ok('⑤ 抽样统计：同一个随机源下首次进区的出事率明显更高（≥1.8 倍，实际 0.44 → 0.95）',
  rates.normal.rate > 0.35 && rates.normal.rate < 0.55 && rates.first.rate > 0.85 && rates.first.rate / rates.normal.rate >= 1.8,
  '熟路=' + rates.normal.rate.toFixed(3) + ' 首次=' + rates.first.rate.toFixed(3) + ' 倍率=' + (rates.first.rate / rates.normal.rate).toFixed(2))
/* 端到端：把 Math.random 钉在 0.5 —— 熟路（0.45）不触发、首次（0.95）必然触发 */
const V = pick.second || pick.unseen.filter(x => x !== U)[0]
await ev(`(() => { window.__m72bRnd = Math.random; Math.random = () => 0.5; return 1 })()`)
const goV = await goto(V)
await sleep(700)
const evV = await j(`(() => JSON.stringify(V4World.regionEvent()))()`)
const logV = await lines()
const seenV = await readOf(V)
ok('⑤ 端到端：Math.random=0.5、首次进区 → 事件**必然**触发（0.45 的熟路概率本来是过不去的）',
  goV === 'ok' && seenV.seen === true && !!evV && evV.region === V, JSON.stringify({ region: evV && evV.region, title: evV && evV.title }))
const goV2pre = await goto(pick.here)   // 先回主城（家里不掷事件），再从主城复访 V
await sleep(600)
const goV2 = await goto(V)              // 复访同一片区域：first=false → 0.45 < 0.5 → 不该再出事
await sleep(700)
const evV2 = await j(`(() => JSON.stringify(V4World.regionEvent()))()`)
ok('⑤ 同一个随机值下的**复访**不出事（倍率只给第一次进区）',
  goV2pre === 'ok' && goV2 === 'ok' && !!evV2 && evV2.region === V && evV2.day === evV.day && evV2.title === evV.title,
  JSON.stringify({ 复访后仍是: evV2 && (evV2.region + '/' + evV2.title + '/第' + evV2.day + '天') }))
await ev(`(() => { Math.random = window.__m72bRnd; return 1 })()`)
ok('⑥ 首次进区有**叙事提示**（"你第一次踏进这里"+ 概率提示），且写明这一趟更容易出事',
  logV.some(l => l.indexOf('你第一次踏进') >= 0) && logV.some(l => l.indexOf('首次进区 ×2.2') >= 0),
  (logV.filter(l => /第一次踏进|首次进区/.test(l))[0] || '').slice(0, 100))

/* ── ⑦ 存档往返：两张新表没被 sanitize 洗掉 ── */
const beforeSave = await j(`(() => JSON.stringify({ first: S.world.regionFirst, last: S.world.regionLast, day: S.day }))()`)
await ev(`(() => { saveGame(true); return 1 })()`); await sleep(900)
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(1200)
const afterSave = await j(`(() => JSON.stringify({ first: S.world.regionFirst, last: S.world.regionLast, day: S.day, region: S.world.region }))()`)
ok('⑦ 存档往返后 regionFirst / regionLast 还在（白名单真的生效，首次进区判定不会重算）',
  !!afterSave.first[U] && afterSave.first[U] === beforeSave.first[U] && !!afterSave.last[U] &&
  afterSave.last[U].day === beforeSave.last[U].day && Object.keys(afterSave.first).length === Object.keys(beforeSave.first).length,
  JSON.stringify({ firstOfU: afterSave.first[U], lastOfU: afterSave.last[U] }))
const seenAfter = await readOf(U)
ok('⑦ 读档后那个区仍然是**实测**口径（传闻不会被"重新听一遍"退回）',
  seenAfter.seen === true && seenAfter.danger.kind === 'measured' && seenAfter.danger.tier === pick.tier,
  seenAfter.danger.brief)

ok('⑧ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log('')
console.log('M72b 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
