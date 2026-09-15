// M35 取证：搜刮记账与"有没有出货"解耦 —— 用户报障「委托让你去药房翻一趟，搜了还是完不成」
//   ① 药房还有剩余次数：搜一次 → zone:pharmacy 委托完成（对照组，别把好的改坏）
//   ② 药房已被搜空（left=0，早退分支）：搜一次照样记账 → 委托 1/1 完成、奖励到账、日志写明
//   ③ 空点深搜同样算 deep（'深挖一层' 这类判定不会因为周围被翻空而永远做不完）
//   ④ 空点深搜扣 2 行动力（不给"空点 1 行动力刷 deep"的口子）
//   ⑤ 跨区委托口径 rzone:<区>:* 也认这一次（regionZones 落账）
//   ⑥ 大故事第 1 章「摸进圣玛丽医院的档案室」（zone:hospital）被这一次搜刮推进
//   ⑦ 行动力不够时不记账（账只跟着真的花掉的那一次走）
//   ⑧ 全程无 console 报错；任务页/探索页截图存档
// 用法：node docs/_m35_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
// 干净起步（探针自己造场景，不吃上一次运行的存档）
await send('Page.navigate', { url })
await sleep(3000)
await ev(`localStorage.removeItem('zombie_survival_save_v2'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(5000)
console.log('  启动: ' + await ev(`JSON.stringify({ dev: !!window.DEV, q: !!window.V4Quest, w: !!window.V4World })`))

/* 站在药房上、把剩余次数设成 left、板上摆一张真的「补给清单」并接单（判定走真逻辑 + 真基线快照） */
const arm = (left) => `(() => {
  const S = DEV.state();
  const w = DEV.localWorld();
  const ph = Object.keys(w.blocks).map(k => w.blocks[k]).filter(b => b.poi === 'pharmacy');
  if (!ph.length) return 'ERR 当前区域没有药房';
  const b = ph[0];
  V4World.teleport(b.x, b.y);
  S.world.left[b.x + ',' + b.y] = ${left};
  S.contracts.board = [{ key: 'probe', id: 'do:probe', title: '补给清单', desc: '抗生素永远不够用。去药房翻一趟。',
    metric: 'zone:pharmacy', need: 1, days: 2, from: '林医生', tier: 1, reward: { mat: 5, item: 'bandage', n: 2 }, expiresDay: S.day + 1 }];
  S.contracts.active = [];
  V4Quest.accept(0);
  S.ap = 9;
  return JSON.stringify({ xy: b.x + ',' + b.y, poi: b.poi, active: S.contracts.active.length, metric: S.contracts.active[0] && S.contracts.active[0].metric,
    baseline: S.contracts.active[0] && S.contracts.active[0].baseline, ap: S.ap });
})()`

const searchOnce = (deep) => `(() => {
  const S = DEV.state();
  const before = { pharmacy: (S.stats.zoneCnt || {}).pharmacy || 0, hospital: (S.stats.zoneCnt || {}).hospital || 0,
    deep: S.stats.deep || 0, ap: S.ap, mat: S.mat,
    rz: ((S.world.regionZones || {})[S.world.region] || {}).pharmacy || 0 };
  const r = V4World.search(${deep});
  const c = S.contracts.active[0];
  const after = { pharmacy: (S.stats.zoneCnt || {}).pharmacy || 0, hospital: (S.stats.zoneCnt || {}).hospital || 0,
    deep: S.stats.deep || 0, ap: S.ap, mat: S.mat,
    rz: ((S.world.regionZones || {})[S.world.region] || {}).pharmacy || 0 };
  return JSON.stringify({ returned: r, before, after, activeLeft: S.contracts.active.length, done: S.contracts.done,
    prog: c ? 'active' : 'closed', logs: (S.logBuf || []).slice(-4).map(x => x.text || String(x)),
    storyObj0: (V4Quest.summary().storyObjs || [])[0] || null });
})()`

// ── ① 对照组：药房还有次数 → 搜一次就完成 ──
console.log('  ① 药房 left=4: ' + await ev(arm(4)))
const c1 = JSON.parse(await ev(searchOnce(0)))
console.log('     ' + JSON.stringify(c1))
ok('① 药房还有次数时：搜一次 → zone:pharmacy 委托完成结算（对照组）',
  c1.after.pharmacy === 1 && c1.activeLeft === 0 && c1.done === 1, JSON.stringify(c1))
await sleep(400)

// ── ② 药房已被搜空：搜一次照样算（用户报障的那条路径） ──
console.log('  ② 药房 left=0: ' + await ev(arm(0)))
const c2 = JSON.parse(await ev(searchOnce(0)))
console.log('     ' + JSON.stringify(c2))
ok('② 药房已搜空（早退分支）搜一次 → 账照样记（zoneCnt.pharmacy +1）',
  c2.after.pharmacy === c2.before.pharmacy + 1, JSON.stringify(c2.before) + ' → ' + JSON.stringify(c2.after))
ok('② 这张委托完成并被结算（用户报障：以前永远停在 0/1）',
  c2.activeLeft === 0 && c2.done === 2, JSON.stringify({ activeLeft: c2.activeLeft, done: c2.done }))
ok('② 日志里说明"这一趟照样记进任务进度"（不再让玩家以为白搜了）',
  /记进任务进度/.test((c2.logs || []).join(' ')), JSON.stringify(c2.logs))
await sleep(400)

// ── ③④ 空点上深搜：算 deep、扣 2 行动力 ──
console.log('  ③ 药房 left=0 + 深搜: ' + await ev(arm(0)))
const c3 = JSON.parse(await ev(searchOnce(1)))
console.log('     ' + JSON.stringify(c3))
ok('③ 空点深搜也算 deep（\'深挖一层\'/章节目标不会因为周围被翻空而永久卡住）',
  c3.after.deep === c3.before.deep + 1, JSON.stringify({ deep: c3.before.deep + '→' + c3.after.deep }))
ok('④ 空点深搜扣 2 行动力（关掉"空点 1 行动力刷账"的口子）',
  c3.before.ap - c3.after.ap === 2, JSON.stringify({ ap: c3.before.ap + '→' + c3.after.ap }))
ok('⑤ 跨区委托口径 regionZones 也落账（rzone:<区>:* 判定用）',
  c3.after.rz === c3.before.rz + 1, JSON.stringify({ rz: c3.before.rz + '→' + c3.after.rz }))
ok('⑥ 大故事第 1 章「摸进圣玛丽医院的档案室」（zone:hospital）被这次搜刮推进',
  c3.after.hospital > c3.before.hospital && Number(c3.storyObj0 && c3.storyObj0.cur) >= 1,
  JSON.stringify({ hospital: c3.before.hospital + '→' + c3.after.hospital, storyObj0: c3.storyObj0 }))
await sleep(400)

// ── ⑦ 行动力不够：不记账 ──
const c4 = JSON.parse(await ev(`(() => {
  const S = DEV.state();
  S.ap = 0;
  const before = { pharmacy: (S.stats.zoneCnt || {}).pharmacy || 0, ap: S.ap };
  V4World.search(0);                                   // V4World.search 不回传值，只能看账变没变
  const after = { pharmacy: (S.stats.zoneCnt || {}).pharmacy || 0, ap: S.ap };
  return JSON.stringify({ before, after });
})()`))
console.log('  ⑦ 行动力 0: ' + JSON.stringify(c4))
ok('⑦ 行动力不够时搜不动、也不记账（账只跟着真花掉的那一次走）',
  c4.after.pharmacy === c4.before.pharmacy && c4.after.ap === 0, JSON.stringify(c4))

// 任务页截图（给人看的证据）
await ev(`(() => { const b = [...document.querySelectorAll('button,.tab')].find(e => /任务/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(900)
await shot('m35-quest-tab')
await ev(`(() => { const b = [...document.querySelectorAll('button,.tab')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(900)
await shot('m35-explore')

const pageErrs = errs.filter(e => !/favicon|hit\.off|Failed to load resource/i.test(e))
ok('⑧ 全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m35_probe.json`, JSON.stringify({ checks, errs: pageErrs, case1: c1, case2: c2, case3: c3, case4: c4 }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
