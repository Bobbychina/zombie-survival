// M20 验收：① 挑战码（种子分享）② 多世界管理 ③ 幽灵据点（导入→地图上刷出→打赢拿材料）
//          ④ 死亡台账（只存本机 + 匿名导出）
// 用法：node docs/_m20_systems_probe.mjs <cdpPort> <url> <outDir>
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
const send = (method, params = {}, ms = 20000) => new Promise((res) => {
  const i = ++id; pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
  /* 页面卡死时不能把整个探针拖住（踩过一次：CDP 不回包 → node 顶层 await 永久挂起） */
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: { exceptionDetails: { exception: { description: 'TIMEOUT ' + method } } } }) } }, ms)
})
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
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1300, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
await sleep(3000)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const openWorld = `(() => { const b = [...document.querySelectorAll('.tab, button')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); return 1; })()`
/** 等游戏真的加载完（新 profile 首屏比固定 sleep 慢；拿 about:blank 读 localStorage 会 SecurityError） */
const waitFor = async (expr, ms = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await ev(expr)) === true) return true
    await sleep(500)
  }
  return false
}
const goto = async () => {
  await send('Page.navigate', { url: pageUrl })
  return waitFor(`typeof DEV !== 'undefined' && !!DEV.runs`)
}

/* 干净起步（顺手清掉 M20 的新键） */
await waitFor(`typeof DEV !== 'undefined'`)
await ev(`['zombie_survival_save_v2','zsv_worlds_v1','zsv_ghosts_v1','zsv_runs_v1','dsh.mapmode'].forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); 1`)
await goto()
ok('DEV 钩子可用（?dev=ready）', (await ev(`typeof DEV !== 'undefined' && !!(DEV.ghosts && DEV.runs && DEV.worlds)`)) === true)

/* ── 1) 世界面板：老档认领 + 挑战码 ── */
await ev(`(() => { V4Worlds.open(); return 1; })()`)
await sleep(500)
const panel = JSON.parse(await ev(`(() => {
  const t = (document.querySelector('.v4worlds') || {}).textContent || '';
  const reg = JSON.parse(localStorage.getItem('zsv_worlds_v1') || 'null');
  const html = (document.querySelector('.v4worlds') || {}).innerHTML || '';
  const m = /ZS1-[A-Za-z0-9_-]+-[a-z0-9]+/.exec(html);
  return JSON.stringify({ has: !!document.querySelector('.v4worlds'), text: t.slice(0, 160), reg, code: m ? m[0] : '' });
})()`))
console.log('  面板: ' + panel.text.replace(/\s+/g, ' ').slice(0, 100))
ok('「世界」面板能打开并列出当前世界（名字/种子/预设/天数）',
  panel.has && /当前/.test(panel.text) && /种子/.test(panel.text) && panel.reg?.worlds?.length === 1,
  JSON.stringify({ n: panel.reg?.worlds?.length }))
ok('老档被自动认领成第 1 个世界（种子取自现有存档）',
  !!panel.reg?.worlds?.[0]?.seed && panel.reg.activeId === panel.reg.worlds[0].id, JSON.stringify(panel.reg?.worlds?.[0] ?? {}))
ok('面板里能拿到自己的挑战码（ZS1-…）', /^ZS1-/.test(panel.code), panel.code.slice(0, 44))
await shot('m20-world-panel')

const codeInfo = JSON.parse(await ev(`(() => {
  const r = DEV.share.parseShareCode(${JSON.stringify(panel.code)});
  const bad = DEV.share.parseShareCode(${JSON.stringify(panel.code)}.slice(0, -1) + 'x');
  return JSON.stringify({ ok: r.ok, seed: r.ok ? r.spec.seed : '', preset: r.ok ? r.spec.preset : '', badOk: bad.ok, why: bad.ok ? '' : bad.why });
})()`))
ok('挑战码能解回同一个种子；改一位就被拒（校验和）',
  codeInfo.ok === true && codeInfo.seed === panel.reg.worlds[0].seed && codeInfo.badOk === false, JSON.stringify(codeInfo))

/* 用"朋友的挑战码"建新世界（地狱开局） */
const newWorld = JSON.parse(await ev(`(() => {
  const reg0 = JSON.parse(localStorage.getItem('zsv_worlds_v1'));
  const before = reg0.worlds.length;
  const code = DEV.share.shareCode({ seed: 'hell-' + reg0.worlds[0].seed, preset: 'bleak', by: '朋友' });
  const r = DEV.worlds.startWorld(code, '朋友的挑战');        // 面板按钮走的就是这个函数
  const reg = JSON.parse(localStorage.getItem('zsv_worlds_v1'));
  const w = reg.worlds.find(x => x.id === reg.activeId);
  return JSON.stringify({ before, after: reg.worlds.length, seed: w.seed, preset: w.preset, name: w.name, active: reg.activeId === w.id, why: r.why || '' });
})()`))
await sleep(800)
console.log('  新世界: ' + JSON.stringify(newWorld))
ok('粘贴挑战码能建出同种子的新世界（含开局预设），并切过去',
  newWorld.after === newWorld.before + 1 && newWorld.preset === 'bleak' && /^hell-/.test(newWorld.seed) && newWorld.active === true,
  JSON.stringify(newWorld))

/* ── 2) 幽灵据点：导入 → 地图上刷出 → 打赢拿材料 ── */
await goto()
await ev(openWorld); await sleep(1000)
const imported = JSON.parse(await ev(`(() => {
  const spec = { owner: '老周', mat: 200, item: 'medkit', itemN: 3, threat: 3, day: 40, tag: '来拿啊。' };
  const code = DEV.ghostCore.ghostCode(spec);
  const r = DEV.ghosts.importGhost(code);
  const dup = DEV.ghosts.importGhost(code);
  const bad = DEV.ghosts.importGhost(code.slice(0, -1) + 'x');
  const list = DEV.ghosts.loadGhosts();
  return JSON.stringify({ ok: r.ok, n: list.length, owner: list[0]?.spec?.owner, dupOk: dup.ok, badOk: bad.ok, why: dup.why });
})()`))
console.log('  导入幽灵: ' + JSON.stringify(imported))
ok('幽灵码能导入（合法接受 / 重复被拒 / 改一位被拒）',
  imported.ok === true && imported.n === 1 && imported.owner === '老周' && imported.dupOk === false && imported.badOk === false,
  JSON.stringify(imported))

await goto()
/* 幽灵据点不点亮是看不见的（本来就是"探索到才会发现"），所以这里先把那一格点亮 */
const revealed = JSON.parse(await ev(`(() => {
  const spec = DEV.ghosts.loadGhosts()[0].spec;
  const s = DEV.state();
  const w = DEV.localWorld();
  const p = DEV.ghosts.ghostSpot(w, spec);
  s.world.visited[p.x + ',' + p.y] = 1;
  saveGame(true);
  return JSON.stringify({ x: p.x, y: p.y, home: w.home, seed: w.seed });
})()`))
console.log('  幽灵落点: ' + JSON.stringify(revealed))
await goto()
await ev(openWorld); await sleep(1000)
const placed = JSON.parse(await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4world .wcell')];
  const g = cells.find(c => (c.textContent || '').includes('👻'));
  return JSON.stringify({ found: !!g, title: g ? (g.getAttribute('title') || '').slice(0, 46) : '' });
})()`))
console.log('  幽灵格: ' + JSON.stringify(placed))
ok('导入的幽灵据点真的长在本地地图上（👻 标记 + tooltip 写明是谁的据点）',
  placed.found === true && /幽灵据点/.test(placed.title), JSON.stringify(placed))
await shot('m20-ghost-on-map')

const raid = JSON.parse(await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4world .wcell')];
  const g = cells.find(c => (c.textContent || '').includes('👻'));
  const m = /^\\((\\d+),(\\d+)\\)/.exec(g.getAttribute('title') || '');
  const x = +m[1], y = +m[2];
  const S = DEV.state();
  S.world.visited[x + ',' + y] = 1;
  S.mat = 5;
  V4World.teleport(x, y);
  const spec = DEV.ghosts.loadGhosts()[0].spec;
  const fought = DEV.ghostCore.ghostFoes(spec);            // 打之前先看守卫名单
  DEV.ghosts.raidGhost(DEV.localWorld(), { x, y });        // 等价于"打赢那一刻"的结算
  return JSON.stringify({ x, y, mat: DEV.state().mat, loot: DEV.ghostCore.ghostLoot(spec), cleared: DEV.ghosts.loadGhosts()[0].cleared, foes: fought.length, specMat: spec.mat });
})()`))
await sleep(700)
console.log('  打幽灵: ' + JSON.stringify(raid))
ok('打赢幽灵据点拿到材料（不超过对方快照、不超过 60）',
  raid.mat > 5 && raid.loot.mat > 0 && raid.loot.mat <= 60 && raid.loot.mat <= raid.specMat,
  `材料 5 → ${raid.mat}（抢到 ${raid.loot.mat}，对方快照 ${raid.specMat}）`)
ok('守卫按威胁度生成（3 档 → 6 只以上）', raid.foes >= 6, `守卫 ${raid.foes} 只`)
ok('打完标记为已清（同一个幽灵不会被刷第二遍）', raid.cleared === true, JSON.stringify({ cleared: raid.cleared }))

/* ── 3) 死亡台账：记账 → 聚合 → 匿名导出 ── */
const tel = JSON.parse(await ev(`(() => {
  DEV.worlds.recordRun({ kind: 'death', day: 12, cause: '你在战斗里流干了最后一滴血。', region: 'r3-7', rtype: 'industry', tier: 4, kills: 37, mat: 84, at: Date.now() });
  DEV.worlds.recordRun({ kind: 'death', day: 30, cause: '一次搜刮要了你的命。', region: 'r1-1', rtype: 'military', tier: 5, kills: 12, mat: 20, at: Date.now() });
  const rep = DEV.runs.report(DEV.worlds.ledger());
  return JSON.stringify({ n: DEV.worlds.ledger().length, verdict: rep.verdict, hardest: rep.hardest.map(x => x.label), exp: DEV.runs.exportLedger(DEV.worlds.ledger()) });
})()`))
console.log('  台账: ' + tel.verdict + ' | ' + tel.exp.slice(0, 96))
ok('死亡会记进本机台账，并聚合成"哪类地貌在吃人"',
  tel.n === 2 && tel.hardest.length > 0 && /吃人|活到/.test(tel.verdict), JSON.stringify({ n: tel.n, hardest: tel.hardest }))
ok('导出的是匿名 JSON（无账号/存档字段，击杀与材料分桶）',
  /"game":"zombie-survival"/.test(tel.exp) && !/name|token|email/i.test(tel.exp) && /"k10":30/.test(tel.exp), tel.exp.slice(0, 84))

await ev(`(() => { V4Worlds.open(); return 1; })()`)
await sleep(400)
const panel2 = JSON.parse(await ev(`(() => {
  const t = (document.querySelector('.v4worlds') || {}).textContent || '';
  return JSON.stringify({ worlds: /世界/.test(t), ghost: /幽灵据点/.test(t), stats: /开发者统计/.test(t), verdict: /吃人|活到/.test(t) });
})()`))
ok('面板三块齐全（世界 / 幽灵据点 / 开发者统计），统计里带结论', panel2.worlds && panel2.ghost && panel2.stats && panel2.verdict, JSON.stringify(panel2))
await shot('m20-stats')

/* ── 4) 世界列表：切换/改名/删除都只是元数据操作（不破坏当前存档） ── */
const manage = JSON.parse(await ev(`(() => {
  const reg0 = JSON.parse(localStorage.getItem('zsv_worlds_v1'));
  const other = reg0.worlds.find(w => w.id !== reg0.activeId);
  const renameOk = V4Worlds.rename && true;
  DEV.worlds.rename(other.id, '改名测试');
  const after = JSON.parse(localStorage.getItem('zsv_worlds_v1'));
  const n0 = after.worlds.length;
  DEV.worlds.deleteWorld(other.id);
  const after2 = JSON.parse(localStorage.getItem('zsv_worlds_v1'));
  return JSON.stringify({ renameOk, renamed: after.worlds.find(w => w.id === other.id)?.name, n0, n1: after2.worlds.length, activeKept: after2.activeId === reg0.activeId });
})()`))
console.log('  世界管理: ' + JSON.stringify(manage))
ok('改名/删除世界正常，且当前世界的槽位不动',
  manage.renamed === '改名测试' && manage.n1 === manage.n0 - 1 && manage.activeKept === true, JSON.stringify(manage))

const pageErrs = errs.filter(e => !/favicon|检测到不是游戏写出的存档/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m20_probe.json`, JSON.stringify({ checks, errs: pageErrs, panel, newWorld, imported, placed, raid, tel: { n: tel.n, verdict: tel.verdict }, manage }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
