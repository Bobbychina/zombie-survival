// M15.1 验收：真浏览器里跑一次"老档 → 地图重画迁移"
// 造一份没有 world.wv（= M12/M15 之前的地形版本）的存档写进 localStorage，重载后检查：
//   1) 日志里出现"地图重画"说明  2) 地形进度清空  3) 人物进度保留  4) 不重复迁移（再加载一次不再清）
// 用法：node docs/_m151_migrate_probe.mjs <cdpPort> <url> <outDir>
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 120))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(4000)

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

// 1) 先正常进一次游戏，拿到一份真实存档，再把它改成"老版本地形"（去掉 world.wv + 塞入旧的地形进度）
const seeded = await ev(`(() => {
  const S = DEV.state();
  S.day = 42; S.mat = 321; S.hp = 66; S.inv = [{ id: 'bandage', n: 4 }];
  S.quest = { stage: 4, keycards: 2, data: 1 };
  S.story = { chapter: 3, done: ['ch1a'], log: [], choices: { ch1: 'keep' } };
  S.endings = ['ash'];
  S.world.wv = undefined;                                  // ← 老档：没有世界版本号
  S.world.visited = { '4,4': 1, '5,5': 1 };
  S.world.left = { '4,4': 0 };
  S.world.stock = { '4,4': 3 };
  S.world.firstPoi = { '4,4': 1 };
  S.world.chop = { '4,4': { left: 1, day: 3 } };
  S.world.intel = true;
  S.world.evac = { x: 9, y: 9, day: 90 };
  S.world.cur = { x: 4, y: 4 };
  S.world.trail = ['旧地图记录'];
  S.world.veh = { fuel: 5, hp: 80 };
  saveGame();
  const raw = JSON.parse(localStorage.getItem('zombie_survival_save_v2') || '{}');
  return JSON.stringify({ wrote: !!raw.world, hasWv: 'wv' in (raw.world || {}), day: raw.day, visited: Object.keys(raw.world.visited||{}).length });
})()`)
console.log('  造老档: ' + seeded)
const SE = JSON.parse(seeded)
ok('成功写入一份"老版本地形"的存档', SE.wrote && SE.hasWv === false && SE.day === 42, JSON.stringify(SE))

// 2) 重载 → 触发迁移
await send('Page.navigate', { url })
await sleep(4500)
const after = await ev(`(() => {
  const S = DEV.state();
  const w = S.world;
  const logText = [...document.querySelectorAll('#log .l, #log div')].map(e => e.textContent || '').join('\\n');
  return JSON.stringify({
    wv: w.wv, day: S.day, mat: S.mat, hp: S.hp, inv: S.inv, quest: S.quest.stage, choices: (S.story||{}).choices, endings: S.endings,
    visited: Object.keys(w.visited).length, left: Object.keys(w.left).length, stock: Object.keys(w.stock).length,
    firstPoi: Object.keys(w.firstPoi).length, chop: Object.keys(w.chop).length, intel: w.intel, evac: w.evac,
    trail: w.trail.length, veh: w.veh, cur: w.cur,
    logMigrate: /地图生成器更新了/.test(logText), logKeep: /人物\\/背包\\/材料\\/据点\\/天数\\/任务都还在/.test(logText),
  });
})()`)
console.log('  迁移后: ' + after)
const AF = JSON.parse(after)
ok('世界版本号补上了', AF.wv >= 2, 'wv=' + AF.wv)
ok('日志明确说明"地图重画了"', AF.logMigrate && AF.logKeep, JSON.stringify({ a: AF.logMigrate, b: AF.logKeep }))
ok('地形进度已清空（visited 只剩脚下那格；left/stock/firstPoi/chop/intel/evac/trail 全清）',
  AF.visited === 1 && AF.left === 0 && AF.stock === 0 && AF.firstPoi === 0 && AF.chop === 0 && AF.intel === false && AF.evac === null && AF.trail === 0,
  JSON.stringify(AF))
ok('人物进度一项不少（天/材料/血/背包/主线/抉择/结局档案/车）',
  AF.day === 42 && AF.mat === 321 && AF.hp === 66 && AF.inv && Object.keys(AF.inv).length > 0 && AF.quest === 4 &&
  AF.choices && AF.choices.ch1 === 'keep' && AF.endings && AF.endings.includes('ash') && AF.veh && AF.veh.hp === 80,
  JSON.stringify({ day: AF.day, mat: AF.mat, hp: AF.hp, inv: AF.inv, quest: AF.quest, choices: AF.choices, endings: AF.endings, veh: AF.veh }))
ok('玩家被挪回本区入口（老坐标不再可信）', AF.cur.x !== 4 || AF.cur.y !== 4, JSON.stringify(AF.cur))

// 3) 再重载一次：不该再迁移（否则每次进游戏都会清一遍探索进度）
await ev(`(() => { const S = DEV.state(); S.world.visited = { '7,7': 1 }; saveGame(); return 1; })()`)
await send('Page.navigate', { url })
await sleep(4200)
const again = await ev(`(() => {
  const S = DEV.state();
  const logText = [...document.querySelectorAll('#log .l, #log div')].map(e => e.textContent || '').join('\\n');
  return JSON.stringify({ visited: Object.keys(S.world.visited).length, logMigrate: /地图生成器更新了/.test(logText) });
})()`)
console.log('  二次加载: ' + again)
const AG = JSON.parse(again)
ok('同版本不会重复迁移（探索进度保住了，也不再提示）', AG.visited === 2 && AG.logMigrate === false, JSON.stringify(AG))

const pageErrs = errs.filter(e => !/favicon/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m151_migrate.json`, JSON.stringify({ checks, errs: pageErrs, seeded: SE, after: AF, again: AG }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
