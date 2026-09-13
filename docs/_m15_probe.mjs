// M15 验收：分区式地图生成（扎堆）+ 多结局（8 个）
// 用法：node docs/_m15_probe.mjs <cdpPort> <url> <outDir>
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(4500)
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await ev(`localStorage.removeItem('zombie_survival_save_v2'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url })
await sleep(4200)

// ── 1) 地图：分区扎堆（读格子的 b-<biome> 类名，迷雾不影响类名） ──
await ev(`(() => { const b = [...document.querySelectorAll('button,.tab')].find(e => /探索/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(1200)
const cluster = await ev(`(() => {
  const cells = [...document.querySelectorAll('.wcell')];
  const biomeOf = (c) => (c.className.match(/b-([a-z]+)/) || [])[1] || 'fog';
  let same = 0, tot = 0;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const c = cells[y*24+x]; if (!c) continue;
    for (const [dx,dy] of [[1,0],[0,1]]) {
      const n = cells[(y+dy)*24+(x+dx)]; if (!n) continue;
      tot++; if (biomeOf(c) === biomeOf(n)) same++;
    }
  }
  const tally = {}; for (const c of cells) { const k = biomeOf(c); tally[k] = (tally[k]||0)+1; }
  const road = cells.filter(c => /(^|\\s)(road|arterial)($|\\s)/.test(c.className)).length;
  return JSON.stringify({ cells: cells.length, sameRatio: tot ? +(same/tot).toFixed(2) : 0, tally, road });
})()`)
console.log('  地图: ' + cluster)
const CL = JSON.parse(cluster)
ok('大地图渲染出 24×24 格子（576）', CL.cells === 576, 'cells=' + CL.cells)
ok('地图上有多种地表（≥4 种，不是一种刷满）', Object.keys(CL.tally).length >= 4, JSON.stringify(CL.tally))
ok('同用途的格子连成片（相邻同类占比 ≥ 0.55；随机打散约 0.15）', CL.sameRatio >= 0.55, 'ratio=' + CL.sameRatio)
ok('路网画在地图上（主干道/沿街角标）', CL.road > 0, 'road=' + CL.road)
await shot('m15-map')

// ── 2) 结局：8 个都能触发，且各自记录进档案 ──
const endingsRes = await ev(`(() => {
  const S = DEV.state();
  const ids = [];
  const run = (kind, extra) => {
    const def = V4Endings.show(kind, { ...(extra||{}), silent: true });
    ids.push(def.id);
    return def.title;
  };
  S.day = 40; S.story = { chapter: 6, done: [], log: [], choices: { ch1:'keep', ch3:'own', ch5:'tape' } };
  const keepWon = run('won');
  S.story.choices = { ch1:'share', ch3:'hand', ch5:'air' };
  const shareWon = run('won');
  S.story.choices = { ch1:'keep' };
  const rescueKeep = run('rescue');
  S.story.choices = { ch1:'keep', ch3:'own', ch5:'air' };
  const rescueShare = run('rescue');
  S.flags.finalTried = false;
  const ash = run('dead', { inLab: false });
  S.flags.finalTried = true;
  const martyr = run('dead', { inLab: true });
  S.day = 120;
  const endless = run('endless');
  S.day = 160;
  const wanderer = run('endless');
  const list = V4Endings.list();
  const logTail = (S.logBuf && S.logBuf.length) ? S.logBuf.slice(-3) : [];
  return JSON.stringify({ ids, titles: { keepWon, shareWon, rescueKeep, rescueShare, ash, martyr, endless, wanderer },
    list, count: list.length, logTail: logTail.length });
})()`)
await sleep(600)
console.log('  结局: ' + endingsRes)
const EN = JSON.parse(endingsRes)
ok('8 个结局全部可达（判定矩阵与单测一致）', new Set(EN.ids).size === 8, JSON.stringify(EN.titles))
ok('同一类收束因抉择不同而不同（独占 vs 分享）',
  EN.titles.keepWon !== EN.titles.shareWon && EN.titles.rescueKeep !== EN.titles.rescueShare,
  JSON.stringify({ w: [EN.titles.keepWon, EN.titles.shareWon], r: [EN.titles.rescueKeep, EN.titles.rescueShare] }))
ok('死在实验室 ≠ 死在荒野', EN.titles.ash !== EN.titles.martyr, JSON.stringify([EN.titles.ash, EN.titles.martyr]))
ok('结局记进存档（8/8 解锁）', EN.count === 8, JSON.stringify(EN.list))

// ── 3) 结局档案面板 + 存档往返 ──
const archRes = await ev(`(() => {
  const b = [...document.querySelectorAll('button,.tab')].find(e => /任务/.test(e.textContent||''));
  if (b) b.click();
  const t = document.body.innerText;
  const boxes = document.querySelectorAll('.v4end');
  const unlocked = [...boxes].filter(x => x.className.includes('ok')).length;
  const title = (document.body.innerText.match(/结局档案[^\\n]*/) || [''])[0];
  saveGame();
  const raw = JSON.parse(localStorage.getItem('zombie_survival_save_v2') || '{}');
  const san = sanitizeSave(JSON.parse(JSON.stringify(raw)));
  return JSON.stringify({ boxes: boxes.length, unlocked, title, saveEndings: raw.endings && raw.endings.length, sanEndings: san.endings && san.endings.length });
})()`)
await sleep(700)
console.log('  档案: ' + archRes)
const AR = JSON.parse(archRes)
ok('任务页有「结局档案」，8 格全解锁', AR.boxes === 8 && AR.unlocked === 8 && /结局档案/.test(AR.title), JSON.stringify(AR))
ok('结局写进存档并过 sanitizeSave', AR.saveEndings === 8 && AR.sanEndings === 8, JSON.stringify(AR))
await shot('m15-endings')

const pageErrs = errs.filter(e => !/favicon/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m15_probe.json`, JSON.stringify({ checks, errs: pageErrs, zone: CL, endings: EN, archive: AR }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
