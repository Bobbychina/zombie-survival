// M13 委托（接单制）+ 大故事（章节）验收：真浏览器跑关键路径
// 用法：node docs/_m14_quest_probe.mjs <cdpPort> <url> <outDir>
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

// 干净起步：清档重载（探针自己造场景，不受上一次运行影响）
await ev(`localStorage.removeItem('zombie_survival_save_v2'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url })
await sleep(4200)
const boot = await ev(`JSON.stringify({ dev: !!window.DEV, quest: !!window.V4Quest, hooks: [!!window.__v4QuestTick, !!window.__v4StoryHtml, !!window.__v4ContractsHtml, !!window.__v4QuestTeaser] })`)
console.log('  启动: ' + boot)
ok('v4 委托/剧情已挂上全局（桥 + 渲染函数都在）', /"dev":true/.test(boot) && /"quest":true/.test(boot) && !/false/.test(JSON.parse(boot).hooks.join(',')))

// ── 1) 任务页：大故事 + 委托板渲染 ──
await ev(`(() => { const b = [...document.querySelectorAll('button,.tab')].find(e => /任务/.test(e.textContent||'')); if (b) b.click(); })()`)
await sleep(900)
const tab = await ev(`(() => {
  const t = document.body.innerText;
  const sum = V4Quest.summary();
  return JSON.stringify({
    story: document.querySelectorAll('.v4story').length,
    objs: document.querySelectorAll('.v4obj').length,
    storyTitle: (document.querySelector('.v4story h3') || {}).textContent || '',
    ct: document.querySelectorAll('.v4ct').length,
    board: sum.board.length, activeAll: sum.active.length,
    hasBoardTitle: /今日委托板/.test(t), hasStoryTitle: /大故事/.test(t),
    hasAccept: [...document.querySelectorAll('button')].filter(b => /接受/.test(b.textContent||'')).length,
    budget: sum.board.reduce((s,o) => s + (o.mat||0), 0),
    day: sum.day, region: sum.region, chapter: sum.chapter, chapterTitle: sum.chapterTitle,
  });
})()`)
console.log('  任务页: ' + tab)
const T = JSON.parse(tab)
ok('大故事面板渲染（章节标题 + 目标行）', T.story === 1 && T.objs >= 2 && /第 1 章/.test(T.storyTitle), JSON.stringify(T))
ok('委托板渲染 3 张，且每张都有"接受"按钮', T.board === 3 && T.hasAccept === 3, 'board=' + T.board + ' accept=' + T.hasAccept)
ok('章节数与所在区域正确（新档 = 第 1 章 / 余烬市区）', T.chapter === 0 && T.region === 'ember' && T.chapterTitle === '余烬', JSON.stringify(T))
await shot('m14-quest-tab')

// ── 2) 接单：从板上移出、占坑、写日志 ──
const acceptRes = await ev(`(() => {
  const before = V4Quest.summary();
  const btn = [...document.querySelectorAll('button')].find(b => /接受/.test(b.textContent||''));
  const wanted = before.board[0];
  btn.click();
  const after = V4Quest.summary();
  return JSON.stringify({ ok: true, wanted: wanted.title, beforeBoard: before.board.length, afterBoard: after.board.length,
    active: after.active.length, activeTitle: after.active[0] && after.active[0].title, log: after.log.slice(-1)[0] || '' });
})()`)
await sleep(500)
console.log('  接单: ' + acceptRes)
const A = JSON.parse(acceptRes)
ok('点"接受"后板子少一张、手上多一张', A.afterBoard === A.beforeBoard - 1 && A.active === 1, JSON.stringify(A))
ok('接单写进委托记录（人话日志）', /接了委托/.test(A.log), A.log)

// ── 3) 进度从接单起算 + 自动结算发奖 ──
const settleRes = await ev(`(() => {
  const S = DEV.state();
  const sum = V4Quest.summary();
  const c = S.contracts.active[0];
  // 按委托的判定指标精确灌进度（灌错指标 = 测不出问题，之前就吃过这个亏）
  const bump = (metric, n) => {
    const i = metric.indexOf(':');
    if (i < 0) { S.stats[metric] = (S.stats[metric] || 0) + n; return; }
    const kind = metric.slice(0, i), key = metric.slice(i + 1);
    if (kind === 'killBy') S.stats.killBy[key] = (S.stats.killBy[key] || 0) + n;
    else if (kind === 'zone') S.stats.zoneCnt[key] = (S.stats.zoneCnt[key] || 0) + n;
    else if (kind === 'region') { S.world.regionVisits = S.world.regionVisits || {}; S.world.regionVisits[key] = (S.world.regionVisits[key] || 0) + n; }
  };
  bump(c.metric, c.need + 1);
  const matBefore = S.mat;
  V4Quest.tick();
  const after = V4Quest.summary();
  return JSON.stringify({ metric: c.metric, need: c.need, doneBefore: sum.active.length,
    activeAfter: after.active.length, done: after.done, failed: after.failed,
    matGain: S.mat - matBefore, log: after.log.slice(-2) });
})()`)
await sleep(400)
console.log('  结算: ' + settleRes)
const ST = JSON.parse(settleRes)
ok('接单后完成 → 自动结算（手上清空 + 完成数 +1 + 材料到账）',
  ST.activeAfter === 0 && ST.done >= 1 && ST.matGain > 0, JSON.stringify(ST))
ok('结算日志写明完成/过期', ST.log.some(l => /委托/.test(l)), JSON.stringify(ST.log))

// ── 4) 大故事推进：灌满第 1 章目标 → 章节推进 + 剧情日志 ──
const storyRes = await ev(`(() => {
  const S = DEV.state();
  const before = V4Quest.summary();
  S.stats.kills += 50; S.stats.zoneCnt.hospital = (S.stats.zoneCnt.hospital||0) + 3;
  V4Quest.tick();
  const after = V4Quest.summary();
  const t = document.body.innerText;
  return JSON.stringify({ chapterBefore: before.chapter, chapterAfter: after.chapter,
    pending: after.pendingChoice, prompt: after.choicePrompt, options: after.choiceOptions,
    log: after.storyLog, storyObjs: after.storyObjs.map(o => o.text + ' ' + o.cur + '/' + o.need),
    uiChapter: (document.body.innerText.match(/大故事[\\s\\S]{0,24}/) || [''])[0].replace(/\\n/g,' '),
    archive: /剧情日志/.test(t), storyState: S.story });
})()`)
await sleep(400)
console.log('  剧情(等抉择): ' + storyRes)
const SR = JSON.parse(storyRes)
ok('第 1 章目标达成 → 停在抉择上（不选不推进，这是 M14 的分支入口）',
  SR.chapterAfter === 0 && SR.pending === true && SR.options.length >= 2, JSON.stringify({ ch: SR.chapterAfter, pending: SR.pending, opts: SR.options }))

// 抉择：点第一个选项 → 推进 + 写作日志（含"后果"那句话）+ 分支叙事换掉下一章开场
const choiceRes = await ev(`(() => {
  const S = DEV.state();
  const before = V4Quest.summary();
  const btns = [...document.querySelectorAll('.v4choice .btn')];
  const btnCount = btns.length;
  if (btns[0]) btns[0].click();
  const after = V4Quest.summary();
  return JSON.stringify({ btnCount, matBefore: S.mat,
    chapterAfter: after.chapter, choice: after.choices.ch1 || '', intro: after.intro,
    storyLog: after.storyLog.map(e => ({ ch: e.ch, text: e.text.slice(0, 18) })),
    logLines: S.logBuf ? 0 : 0 });
})()`)
await sleep(500)
console.log('  抉择: ' + choiceRes)
const CR = JSON.parse(choiceRes)
ok('抉择 UI 有两个按钮，点第一个能推进到第 2 章', CR.btnCount >= 2 && CR.chapterAfter === 1, JSON.stringify(CR))
ok('抉择记进存档，且第 2 章开场换成了分支叙事（不再是默认那句）',
  !!CR.choice && /册子还贴在你胸口|半个营地都知道/.test(CR.intro), CR.intro.slice(0, 40))
ok('剧情日志里既有本章收束、也有抉择的后果', CR.storyLog.length >= 2, JSON.stringify(CR.storyLog))
await shot('m14-choice-after')

// ── 5) 跨区委托：没车只能看着；有车 + 到访 → 判定成立 ──
const farRes = await ev(`(() => {
  const S = DEV.state();
  S.day = 6;                                    // 第 3 天起才有跨区委托
  V4Quest.newDay();
  const sum = V4Quest.summary();
  const far = sum.board.find(o => o.region);
  const t = document.body.innerText;
  return JSON.stringify({ day: sum.day, contractsDay: S.contracts.day, hasCar: sum.hasCar,
    farTitle: far && far.title, farRegion: far && far.region, farMetric: far && far.metric,
    boardKeys: sum.board.map(o => o.key), blockedUI: /没车到不了/.test(t), hint: /先弄辆车|没车/.test(t) });
})()`)
await sleep(600)
console.log('  跨区(无车): ' + farRes)
const FR = JSON.parse(farRes)
ok('换日真的刷了新板子（contracts.day 跟上 S.day，且 key 是当天的）',
  FR.contractsDay === 6 && FR.boardKeys.every(k => k.includes(':6')), JSON.stringify({ cd: FR.contractsDay, keys: FR.boardKeys }))
ok('第 3 天起板子上出现跨区委托（判定 = 在那个区搜刮）', !!FR.farTitle && /^rzone:/.test(FR.farMetric || ''), JSON.stringify(FR))
ok('没车时 UI 直接写"没车到不了"', FR.blockedUI && FR.hasCar === false, JSON.stringify(FR))

const acceptBlocked = await ev(`(() => {
  const sum = V4Quest.summary();
  const i = sum.board.findIndex(o => o.region);
  const r = V4Quest.accept(i);
  const after = V4Quest.summary();
  return JSON.stringify({ returned: r, active: after.active.length, board: after.board.length });
})()`)
await sleep(400)
const AB = JSON.parse(acceptBlocked)
ok('没车时接跨区委托被拦下（返回 false，不占坑）', AB.returned === false && AB.active === 0, acceptBlocked)

const farDone = await ev(`(() => {
  const S = DEV.state();
  S.world.veh = { fuel: 8, hp: 100 };                       // 给一辆车
  V4Quest.newDay();
  const sum = V4Quest.summary();
  const i = sum.board.findIndex(o => o.region);
  const far = sum.board[i];
  const okAccept = V4Quest.accept(i);
  // 真的"开车过去"：走 M12 的区域切换（含到访计数）
  V4World.travelRegion(far.region);
  const afterCross = V4Quest.summary();
  V4Quest.tick();                                           // 只是到了那儿 → 不该算完成（M14 判定改成"在那区搜刮"）
  const justThere = V4Quest.summary();
  const progOf = () => { const s = V4Quest.summary(); return s.active[0] ? s.active[0].current : null; };
  /* 在这个区真搜刮（V4World.search 会写 regionZones）。
     用 DEV.gotoPoi()（走玩家真正在玩的那张区域图，跳过实验室/沉没基地/水格），
     并把该格剩余次数补上——searchPoi 对"已搜空"的点会走早退分支、不计数（踩过两次）。 */
  const searchOnce = () => {
    const S2 = DEV.state();
    S2.ap = 9;
    const spot = DEV.gotoPoi();
    if (spot) S2.world.left[spot.x + ',' + spot.y] = 5;
    return V4World.search(0);
  };
  const r1 = searchOnce();
  V4Quest.tick();
  const oneProg = progOf();
  const rs = [r1];
  for (let k = 0; k < 6 && V4Quest.summary().active.length; k++) { rs.push(searchOnce()); V4Quest.tick(); }
  const after = V4Quest.summary();
  return JSON.stringify({ okAccept, far: far.title, farMetric: far.metric, farNeed: far.need, region: far.region,
    regionAfter: afterCross.region, activeMid: afterCross.active.length,
    justThereProg: justThere.active[0] ? justThere.active[0].current : null,
    oneProg, searchReturns: rs, activeAfter: after.active.length, done: after.done,
    rzones: S.world.regionZones, visits: S.world.regionVisits, log: after.log.slice(-2) });
})()`)
await sleep(900)
console.log('  跨区(有车): ' + farDone)
const FD = JSON.parse(farDone)
ok('有车后能接跨区委托，并真的开车跨区', FD.okAccept === true && FD.regionAfter === FD.region, JSON.stringify({ r: FD.region, after: FD.regionAfter }))
ok('跨区到访计数写进存档', (FD.visits || {})[FD.region] >= 1, JSON.stringify(FD.visits))
ok('只到访不算完成（progress 0），判定要"在这个区真的搜刮"', FD.justThereProg === 0 && FD.farNeed >= 2,
  JSON.stringify({ prog: FD.justThereProg, need: FD.farNeed }))
ok('搜一次 → 有进度但没完成；继续搜到满足次数 → 结算', FD.oneProg === 1 && FD.activeAfter === 0 && FD.done >= 1,
  JSON.stringify({ one: FD.oneProg, active: FD.activeAfter, done: FD.done }))
ok('分区搜刮计数（regionZones）落盘到目标区域', !!((FD.rzones || {})[FD.region]), JSON.stringify(FD.rzones))

// ── 6) 换日：板子刷新 + 过期记失败 ──
const dayRes = await ev(`(() => {
  const S = DEV.state();
  S.day = 12;
  V4Quest.newDay();
  const keys1 = S.contracts.board.map(o => o.key).join(',');
  // 接一张，然后把日期推过期限 → 应记一次失败
  const i = 0;
  V4Quest.accept(i);
  const deadline = S.contracts.active.length ? S.contracts.active[0].deadlineDay : 0;
  const failedBefore = S.contracts.failed;
  S.day = deadline + 2;
  V4Quest.newDay();
  const keys2 = S.contracts.board.map(o => o.key).join(',');
  return JSON.stringify({ keys1, keys2, deadline, failedBefore, failedAfter: S.contracts.failed,
    active: S.contracts.active.length, board: S.contracts.board.length, log: S.contracts.log.slice(-3) });
})()`)
await sleep(400)
console.log('  换日: ' + dayRes)
const DR = JSON.parse(dayRes)
ok('换日刷新板子（key 全变）且始终 3 张', DR.keys1 !== DR.keys2 && DR.board === 3, JSON.stringify({ k1: DR.keys1, k2: DR.keys2, board: DR.board }))
ok('过期委托被记一次失败（而不是静默消失）', DR.failedAfter === DR.failedBefore + 1 && DR.active === 0, JSON.stringify(DR))

// ── 7) 探索页摘要 + 存档往返 ──
const misc = await ev(`(() => {
  const b = [...document.querySelectorAll('button,.tab')].find(e => /探索/.test(e.textContent||''));
  if (b) b.click();
  const teaser = document.querySelectorAll('.v4teaser').length;
  const t = document.body.innerText;
  // 存档往返：写盘 → 读回 → 字段还在（老档兼容/白名单没把新字段吃掉）
  const S = DEV.state();
  S.stats.zoneCnt.pharmacy = 2;                 // POI 粒度的计数键（不在 legacy 的 ZONES 里）
  saveGame();
  const raw = JSON.parse(localStorage.getItem('zombie_survival_save_v2') || '{}');
  const san = sanitizeSave(JSON.parse(JSON.stringify(raw)));
  const zk = Object.keys((san.stats||{}).zoneCnt||{});
  return JSON.stringify({ teaser, teaserText: /任务页/.test(t), hasContracts: !!raw.contracts, hasStory: !!raw.story,
    sanBoard: san.contracts && san.contracts.board.length, sanChapter: san.story && san.story.chapter,
    sanZoneCntKeys: zk, poiKeySurvives: zk.includes('pharmacy') });
})()`)
await sleep(500)
console.log('  其他: ' + misc)
const M = JSON.parse(misc)
ok('探索页有委托/剧情摘要入口', M.teaser >= 1 && M.teaserText, JSON.stringify(M))
ok('存档写入并读回：contracts/story 都在，走 sanitizeSave 没被吃掉',
  M.hasContracts && M.hasStory && M.sanBoard === 3 && Number.isFinite(M.sanChapter), JSON.stringify(M))
ok('POI 粒度的 zoneCnt 键（pharmacy）能过存档白名单', M.poiKeySurvives === true, JSON.stringify(M.sanZoneCntKeys))

const pageErrs = errs.filter(e => !/favicon/.test(e))
ok('全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))
await shot('m14-final')

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m14_probe.json`, JSON.stringify({ checks, errs: pageErrs, tab: T, accept: A, settle: ST, story: SR, choice: CR, far: FR, farDone: FD, day: DR, misc: M }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
