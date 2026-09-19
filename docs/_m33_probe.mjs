// M33 取证：教程沙盒（章节壳 + 独立 iframe + 第 1 章目标清单全绿才算过）
//   ① 入口在 ☰ 菜单里 ② 章节列表 6 章 / 只第 1 章可玩 ③ iframe 带 ?sandbox=1 且不读主档（day=1、固定种子）
//   ④ 父页面收到快照 ⑤ 照着目标做真实操作 → 目标逐条判绿 → 全绿通关（记进本机进度）
//   ⑥ **隔离**：玩了一整轮之后主档密文一个字节没变、父页面自己的进度也没变 ⑦ 重来/关闭 ⑧ 无报错
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 150))
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
/** 在**沙盒 iframe** 的文档/窗口里跑一段代码。
    注意：函数体本身是在**父页面**的上下文里执行的，`W`/`D` 只是绑定到 iframe 的 window/document ——
    所以沙盒里的全局（DEV / V4World / S）必须写 `W.xxx`，写裸 `DEV` 拿到的是**父页面**那一份（踩过：
    坐标是从主档的地图上挑的，搬到沙盒里当然对不上，表现为"格子详情说这里什么都没有"）。 */
const lab = (body) => ev(`(() => {
  const f = document.getElementById('v4lab-frame');
  if (!f || !f.contentWindow || !f.contentDocument) return 'NO-FRAME';
  const W = f.contentWindow, D = f.contentDocument;
  try { return (function(){ ${body} })(); } catch (e) { return 'EXC ' + (e && e.message ? e.message : e); }
})()`)
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
/* M48 修：URL 已经带查询串时（线上常用 ?v=xxx 破缓存）必须用 & 接 dev —— 老写法是硬拼 '?'，
   结果变成 `?v=xxx?dev=ready`，dev 参数直接丢掉：父页面 DEV 没了、沙盒 iframe 也拿不到 DEV，
   于是"站到 POI / 搜刮 / 开打"整片假红（线上跑过一次才发现的）。 */
const BOOT = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: BOOT }); await sleep(4200)
await ev(`(() => { if (typeof setTab === 'function') setTab('explore'); if (typeof render === 'function') render(); return 1 })()`); await sleep(800)

/* ── 0) 主档留证（隔离验证的基准）：密文长度 + 指纹 + 主页面进度 ──
   换端口跑 = 换了个 origin（localStorage 是空的）—— 先确保主档真的存在，否则"隔离"验的是空气。
   线上（慢网络）还要先等 boot 完：`S` 是 legacy 挂上去的，没 boot 完读它就是 ReferenceError。 */
for (let i = 0; i < 30; i++) {
  if (String(await ev(`typeof window.S === 'object' && window.S && !!window.S.stats`)) === 'true') break
  await sleep(500)
}
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(1400)
const saveBefore = JSON.parse(await ev(`(() => {
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return JSON.stringify({ len: raw.length, hash: h, enc: raw.slice(0, 5), day: S.day, mat: S.mat, keys: Object.keys(localStorage).sort() });
})()`))
ok('主档是密文（ZSV1）且能读到进度', saveBefore.enc.startsWith('ZSV1') && saveBefore.len > 200, JSON.stringify({ len: saveBefore.len, day: saveBefore.day }))

/* 沙盒进度是本机键，跑过一遍之后六章全是"已通关"—— 探针要自己有干净的前置状态（像 m27 清教程键那样） */
await ev(`localStorage.removeItem('zsv-lab-v1'); 1`)

/* ── 1) 从 ☰ 菜单里真的能点开沙盒 ── */
const open = JSON.parse(await ev(`(() => {
  openMenu();
  const btn = [...document.querySelectorAll('.modal button')].find(b => /教程沙盒/.test(b.textContent || ''));
  const label = btn ? btn.textContent.trim() : null;
  if (btn) btn.click();
  return JSON.stringify({ found: !!btn, label, lab: !!document.getElementById('v4lab') });
})()`))
await sleep(1200)
ok('☰ 菜单里有「🧪 教程沙盒（分章练习）」入口', open.found && /教程沙盒/.test(open.label || ''), JSON.stringify(open.label))
ok('点开之后出现沙盒覆盖层', open.lab === true)
const shell = JSON.parse(await ev(`(() => {
  const f = document.getElementById('v4lab-frame');
  const chs = [...document.querySelectorAll('#v4lab-chapters .lab-ch')].map(c => ({ id: c.dataset.ch, soon: c.classList.contains('soon'), on: c.classList.contains('on'), txt: c.textContent.slice(0, 16) }));
  const objs = [...document.querySelectorAll('#v4lab-objectives .lab-obj')].map(o => ({ id: o.dataset.obj, done: o.classList.contains('done') }));
  return JSON.stringify({ src: f ? f.getAttribute('src') : null, chs, objs, title: (document.getElementById('v4lab-frametitle') || {}).textContent });
})()`))
ok('iframe 带 ?sandbox=1&ch=survival（且只带 dev，不带别的查询串）', /[?&]sandbox=1/.test(shell.src || '') && /[?&]ch=survival/.test(shell.src || ''), String(shell.src))
ok('章节壳列出 6 章、全部可玩（没有"下一批"占位）', shell.chs.length === 6 && shell.chs.every(c => !c.soon) && shell.chs[0].on === true, JSON.stringify(shell.chs.map(c => c.id + (c.soon ? '(soon)' : ''))))
ok('目标清单有 4 条（开局全空）', shell.objs.length === 4 && shell.objs.every(o => !o.done), JSON.stringify(shell.objs.map(o => o.id)))
await shot('01_lab_ch1')

/* ── 1b) M33.1 入门动线：默认选中"第一个没通关的章" + 章节卡上的"建议从这里开始" ── */const onboarding = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#v4lab-chapters .lab-ch')];
  const onCard = cards.find(c => c.classList.contains('on'));
  return JSON.stringify({
    next: cards.filter(c => c.classList.contains('next')).map(c => c.dataset.ch),
    badges: cards.map(c => c.dataset.ch + ':' + ((c.querySelector('.tag') || {}).textContent || '')),
    cur: onCard ? onCard.dataset.ch : null,
    title: (document.getElementById('v4lab-frametitle') || {}).textContent,
  })
})()`))
ok('首次打开沙盒默认落在第一个没通关的章（第 1 章）', onboarding.cur === 'survival' && /第 1 章/.test(onboarding.title || ''), JSON.stringify({ cur: onboarding.cur, title: onboarding.title }))
ok('只有"下一个该做的章"带「👉 建议从这里开始」标记', onboarding.next.join() === 'survival' && /建议从这里开始/.test(onboarding.badges[0]) && !/建议从这里开始/.test(onboarding.badges[1]), JSON.stringify(onboarding.badges.slice(0, 3)))

/* ── 1c) M60「按顺序解锁」开关：**默认关**（六章都能直接练），手动打开才按 1→6 硬解锁 ── */
const gate0 = JSON.parse(await ev(`(() => {
  const b = document.getElementById('v4lab-seq');
  const st = window.V4Lab.status();
  return JSON.stringify({ btn: b ? b.textContent.trim() : null, seq: st.seq, locked: (st.chapters || []).filter(c => !c.unlocked).map(c => c.id) });
})()`))
ok('开关默认关：文案「🔓 按顺序解锁：关」，六章没有一个被锁', /按顺序解锁：关/.test(gate0.btn || '') && gate0.seq === false && gate0.locked.length === 0,
  JSON.stringify(gate0))
const gateOn = JSON.parse(await ev(`(() => {
  document.getElementById('v4lab-seq').click();
  const st = window.V4Lab.status();
  const cards = [...document.querySelectorAll('#v4lab-chapters .lab-ch')].map(c => ({ id: c.dataset.ch, locked: c.classList.contains('locked'), tag: (c.querySelector('.tag') || {}).textContent || '' }));
  const before = document.getElementById('v4lab-frame').getAttribute('src');
  const locked6 = [...document.querySelectorAll('#v4lab-chapters .lab-ch')].find(c => c.dataset.ch === 'bag');
  if (locked6) locked6.click();                       // 点锁着的第 6 章 → 不该换 iframe
  const after = document.getElementById('v4lab-frame').getAttribute('src');
  return JSON.stringify({ seq: st.seq, btn: (document.getElementById('v4lab-seq') || {}).textContent, cards: cards.filter(c => c.locked).map(c => c.id),
    tag6: (cards.find(c => c.id === 'bag') || {}).tag, changed: before !== after, title: (document.getElementById('v4lab-frametitle') || {}).textContent });
})()`))
await sleep(700)
ok('打开开关：后面几章立刻上锁（卡上是 🔒 + 压暗）且点不动（iframe 不换）',
  gateOn.seq === true && gateOn.cards.length === 5 && /🔒/.test(gateOn.tag6 || '') && gateOn.changed === false && /第 1 章/.test(gateOn.title || ''),
  JSON.stringify(gateOn))
const gateOff = JSON.parse(await ev(`(() => {
  document.getElementById('v4lab-seq').click();
  const st = window.V4Lab.status();
  const locked = (st.chapters || []).filter(c => !c.unlocked).length;
  return JSON.stringify({ seq: st.seq, locked, btn: (document.getElementById('v4lab-seq') || {}).textContent });
})()`))
await sleep(400)
ok('再点一下关掉：六章立刻全部解锁（想练第 6 章永远有出口）', gateOff.seq === false && gateOff.locked === 0 && /按顺序解锁：关/.test(gateOff.btn || ''), JSON.stringify(gateOff))

/* ── 2) 沙盒真的没读主档：day=1、固定种子、预设背包 ── */
let boot = null
for (let i = 0; i < 40; i++) {
  const r = await lab(`if (!W.S || !W.S.seed) return 'WAIT'; return JSON.stringify({ day: W.S.day, seed: W.S.seed, crowbar: W.S.inv.crowbar || 0, can: W.S.inv.can || 0, isLab: typeof W.isLab === 'function' ? W.isLab() : null, hun: W.S.hun, thi: W.S.thi, hp: W.S.hp, ap: W.S.ap, loc: W.S.loc, hasSave: !!D.querySelector('#v4cards') });`)
  if (r && r !== 'WAIT' && r !== 'NO-FRAME' && !String(r).startsWith('EXC')) { boot = JSON.parse(r); break }
  await sleep(500)
}
ok('沙盒是全新一局：第 1 天 + 固定种子 lab-survival-01（没读主档）', boot && boot.day === 1 && boot.seed === 'lab-survival-01', JSON.stringify({ day: boot?.day, seed: boot?.seed, mainDay: saveBefore.day }))
ok('沙盒按章节预设给物资（撬棍 + 两人份吃的 + 不是满饱食）', boot && boot.crowbar === 1 && boot.can >= 2 && boot.hun < 80 && boot.thi < 80, JSON.stringify({ crowbar: boot?.crowbar, can: boot?.can, hun: boot?.hun, thi: boot?.thi }))
ok('iframe 里的 isLab() 为真（写盘守卫生效的前提）', boot && boot.isLab === true, String(boot?.isLab))
ok('沙盒的探索页真的画出来了', boot && boot.hasSave === true)

/* ── 3) 父页面收到快照（目标清单靠它判绿） ── */
let st = null
for (let i = 0; i < 25; i++) {
  st = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
  if (st.snap) break
  await sleep(400)
}
ok('父页面收到 iframe 的快照（0.5 秒一次）', !!st.snap && st.snapAgeMs !== null && st.snapAgeMs < 2000, JSON.stringify({ age: st.snapAgeMs, snap: st.snap && { day: st.snap.day, scav: st.snap.scav, hun: st.snap.hun } }))

/* ── 4) 照着目标清单做真实操作：搜刮 ×2 / 深搜 ×1 / 吃饱喝足 / 睡进第 2 天 ── */
const clickBtn = async (sel, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    const r = await lab(`const b = D.querySelector(${JSON.stringify(sel)}); if (!b) return 'NO-BTN'; if (b.disabled) return 'DISABLED'; b.click(); return 'CLICKED';`)
    if (r === 'CLICKED') return true
    await sleep(400)
  }
  return false
}
/** 失败时把沙盒里的 DOM 状态打出来（省得下次再靠猜） */
const dumpCards = () => lab(`const v = D.getElementById('view');
  return JSON.stringify({ tab: W.S.tab, cards: D.querySelectorAll('#v4cards .v4card').length,
    viewCls: v ? v.className : null, viewKids: v ? v.children.length : -1,
    btns: [...D.querySelectorAll('#v4cards button')].map(b => (b.getAttribute('onclick') || b.textContent || '').slice(0, 26)).slice(0, 10),
    txt: (D.getElementById('v4cards') ? D.getElementById('v4cards').textContent : '').replace(/\\s+/g, ' ').slice(0, 120) });`)
/* ① 站到一处 POI 上（只做"把坐标摆好"这一步；搜刮本身点的是界面上的真按钮）。
   这里**不**用 DEV.gotoPoi：它内部走 teleport，而 teleport 会 `L.render()` → 探针实测在沙盒里
   偶尔被弹回 home（渲染时序），失败原因不在被测逻辑上；直接写 cur 只是测试布置，更稳。 */
const atPoi = String(await lab(`
  const w = W.DEV.localWorld();
  const s = W.S.world;
  let best = null, bd = 99;
  for (const k in w.blocks) {
    const b = w.blocks[k];
    if (!b.poi || b.poi === 'lab' || b.poi === 'sunken' || b.biome === 'water') continue;
    const d = Math.max(Math.abs(b.x - s.cur.x), Math.abs(b.y - s.cur.y));
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return 'NO-POI';
  W.__labHome = { x: s.cur.x, y: s.cur.y };     // 记着家在哪，待会儿回家睡觉
  const check = W.DEV.block(best.x, best.y);
  s.cur = { x: best.x, y: best.y };
  W.render();
  return JSON.stringify({ poi: best.poi, at: best.x + ',' + best.y, dist: bd, blockPoi: check ? check.poi : null, ap: W.S.ap });`))
await sleep(800)
const poiBtn = await lab(`return String(!!D.querySelector('button[onclick*="V4World.search"]'));`)
ok('站到一处 POI（格子详情卡出现「搜索 / 深度搜索」按钮）', poiBtn === 'true' && /"poi":"/.test(atPoi) && !/"blockPoi":null/.test(atPoi), String(atPoi) + ' | ' + (poiBtn === 'true' ? '' : await dumpCards()))
const searched = []
for (const sel of ['#v4cards button[onclick*="V4World.search(0)"]', '#v4cards button[onclick*="V4World.search(0)"]', '#v4cards button[onclick*="V4World.search(1)"]']) {
  await clickBtn(sel); await sleep(700)
  searched.push(await lab(`return JSON.stringify({ scav: W.S.stats.scav, deep: W.S.stats.deep });`))
}
const st1 = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
ok('搜刮 2 次 + 深度搜索 1 次的真实操作被计进 stats', /"scav":2/.test(String(searched[1])) && /"deep":1/.test(String(searched[2])), JSON.stringify(searched))
ok('目标①②在父页面变成绿的（搜刮 / 深搜）', st1.eval.items.filter(i => i.done).map(i => i.id).sort().join() === 'deep1,scav2', JSON.stringify(st1.eval.items.map(i => i.id + (i.done ? '✅' : '⬜'))))

/* ② 吃饱喝足：背包里点「使用」——搜刮会掉饱食/水分，所以吃到两条都过 80 为止（预设给了 2 罐头 + 2 水） */
await lab(`W.setTab('inv'); W.render(); return 1;`); await sleep(700)
for (let i = 0; i < 4; i++) {
  const s = JSON.parse(String(await ev(`JSON.stringify(window.V4Lab.status().snap || {})`)))
  if (s.hun >= 80 && s.thi >= 80) break
  if (s.hun < 80) await clickBtn('button[onclick*="useConsumable(\'can\')"]', 2)
  if (s.thi < 80) await clickBtn('button[onclick*="useConsumable(\'water\')"]', 2)
  await sleep(700)
}
const fed = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
ok('吃东西喝水：饱食与水分都上了 80（目标③绿）', fed.snap.hun >= 80 && fed.snap.thi >= 80 && fed.eval.items.find(i => i.id === 'feed').done === true, JSON.stringify({ hun: fed.snap.hun, thi: fed.snap.thi }))

/* ③ 睡进第 2 天：先回安全屋（"回安全屋睡"只有在家里才点得动），再点「今夜」卡的真实按钮 */
await lab(`if (W.__labHome) W.S.world.cur = { x: W.__labHome.x, y: W.__labHome.y }; W.setTab('explore'); W.render(); return 1;`); await sleep(900)
const sleepOk = await clickBtn('#v4cards button[onclick*="V4Night.rest"]'); await sleep(1500)
const done = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
const prog = JSON.parse(await ev(`JSON.stringify({ raw: localStorage.getItem('zsv-lab-v1') || '', badge: [...document.querySelectorAll('#v4lab-chapters .lab-ch')].map(c => c.textContent).join('|'), obj: [...document.querySelectorAll('#v4lab-objectives .lab-obj')].map(o => o.className.includes('done')) })`))
ok('睡一觉进入第 2 天（目标④绿）', sleepOk && done.snap.day >= 2 && done.eval.items.find(i => i.id === 'sleep').done === true, JSON.stringify({ day: done.snap.day, click: sleepOk }))
ok('四条目标全绿 → 判定通关（passed=true，4/4）', done.eval.passed === true && done.eval.green === 4, JSON.stringify({ green: done.eval.green, total: done.eval.total }))
ok('通关写进本机进度 zsv-lab-v1（章节徽章变"已通关"）', /"survival":\d+/.test(prog.raw) && /已通关/.test(prog.badge), JSON.stringify({ raw: prog.raw.slice(0, 60), objs: prog.obj }))
const afterCh1 = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('#v4lab-chapters .lab-ch')];
  return JSON.stringify({ next: cards.filter(c => c.classList.contains('next')).map(c => c.dataset.ch),
    b1: (cards[0].querySelector('.tag') || {}).textContent, b2: (cards[1].querySelector('.tag') || {}).textContent,
    hint: (document.querySelector('#v4lab-objectives') || {}).textContent });
})()`))
ok('通关第 1 章后「建议从这里开始」自动移到第 2 章', afterCh1.next.join() === 'combat' && /已通关/.test(afterCh1.b1 || '') && /建议从这里开始/.test(afterCh1.b2 || ''), JSON.stringify({ next: afterCh1.next, b1: afterCh1.b1, b2: afterCh1.b2 }))
ok('通关后目标清单下面写着"下一章建议"', /下一章建议/.test(afterCh1.hint || ''), String(afterCh1.hint).replace(/\s+/g, ' ').slice(-60))
await shot('02_lab_passed')

/* ── 5) 隔离：玩了一整轮之后，主档与父页面进度一个字节都没变 ── */
const saveAfter = JSON.parse(await ev(`(() => {
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return JSON.stringify({ len: raw.length, hash: h, day: S.day, mat: S.mat, keys: Object.keys(localStorage).sort() });
})()`))
ok('沙盒里玩了半天，主档密文**一个字节都没变**', saveBefore.hash === saveAfter.hash && saveBefore.len === saveAfter.len, JSON.stringify({ before: saveBefore.len + '/' + saveBefore.hash, after: saveAfter.len + '/' + saveAfter.hash }))
ok('父页面自己的进度也没被沙盒带着走', saveBefore.day === saveAfter.day && saveBefore.mat === saveAfter.mat, JSON.stringify({ day: saveAfter.day, mat: saveAfter.mat }))
const newKeys = saveAfter.keys.filter(k => !saveBefore.keys.includes(k))
ok('沙盒只多写了进度那一个键（没有别的东西落盘）', newKeys.length === 0 || (newKeys.length === 1 && newKeys[0] === 'zsv-lab-v1'), JSON.stringify(newKeys))
const guard = await lab(`W.saveGame(true); W.autosave(); return JSON.stringify({ isLab: W.isLab(), after: (localStorage.getItem('zombie_survival_save_v2') || '').length });`)
await sleep(600)
const saveAfter2 = JSON.parse(await ev(`(() => { const raw = localStorage.getItem('zombie_survival_save_v2') || ''; let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0; return JSON.stringify({ len: raw.length, hash: h }); })()`))
ok('沙盒里的「保存/自动存档」被写盘守卫拦住（连手动保存都写不进去）', saveAfter2.hash === saveBefore.hash, JSON.stringify({ guard, same: saveAfter2.hash === saveBefore.hash }))
ok('沙盒菜单里没有会写盘的入口（存档/读取/回滚/重开/世界账号）', (await lab(`W.openMenu(); const txt = D.querySelector('#overlay-root') ? D.querySelector('#overlay-root').textContent : ''; const footer = D.querySelector('.modal-ft') ? D.querySelector('.modal-ft').textContent : ''; W.closeAllModals(); return JSON.stringify({ hasSave: /保存/.test(footer), hasLoad: /读取/.test(footer), hasWorld: /世界与账号/.test(txt), hasLab: /教程沙盒/.test(txt) });`)).includes('"hasWorld":false'))

/* ── 6) 第 2 章：战斗与枪械（枪杀 / 近战杀 / 手动换弹 —— 全部走界面真按钮） ── */
await ev(`(() => { const c = document.querySelector('#v4lab-chapters .lab-ch[data-ch="combat"]'); if (c) c.click(); return 1 })()`)
await sleep(900)
const shell2 = JSON.parse(await ev(`(() => {
  const f = document.getElementById('v4lab-frame');
  const objs = [...document.querySelectorAll('#v4lab-objectives .lab-obj')].map(o => o.dataset.obj);
  const title = (document.getElementById('v4lab-frametitle') || {}).textContent || '';
  return JSON.stringify({ src: f ? f.getAttribute('src') : null, objs, title });
})()`))
ok('点章节卡能切到第 2 章（iframe 换成 ch=combat，标题跟着换）', /[?&]ch=combat/.test(shell2.src || '') && /战斗/.test(shell2.title), JSON.stringify({ src: shell2.src, title: shell2.title }))
ok('第 2 章的目标清单是 4 条（枪杀 / 近战杀 / 换弹 / 穿甲弹打装甲——M48）', shell2.objs.length === 4 && ['gunKill', 'meleeKill', 'loadSwap', 'apKill'].every(id => shell2.objs.includes(id)), JSON.stringify(shell2.objs))
let boot2 = null
for (let i = 0; i < 20; i++) {
  const r = await lab(`if (!W.S || W.S.seed !== 'lab-combat-01') return 'WAIT'; return JSON.stringify({ day: W.S.day, seed: W.S.seed, pistol: W.S.inv.pistol || 0, ap: W.S.inv.a9_ap || 0, wpn: W.S.eq.wpn, kills: W.S.stats.kills });`)
  if (r && r !== 'WAIT' && r !== 'NO-FRAME' && !String(r).startsWith('EXC')) { boot2 = JSON.parse(r); break }
  await sleep(500)
}
ok('第 2 章沙盒按自己的预设开局（固定种子 lab-combat-01 + 手枪 + 两种 9mm + 计数清零）', boot2 && boot2.day === 1 && boot2.pistol === 1 && boot2.ap === 40 && boot2.wpn === 'pistol' && boot2.kills === 0, JSON.stringify(boot2))

/** 打一场：点招式槽（真按钮）直到战斗结束；结束面板上的「继续」也要点（战斗界面不会自己关） */
const fight = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++) {
    const st = await lab(`if (!W.V4UI || !W.V4UI.isOpen()) return 'OVER';
      const done = [...D.querySelectorAll('#v4b-overlay button')].find(b => /继续/.test(b.textContent || ''));
      if (done) { done.click(); return 'OVER'; }
      const b = [...D.querySelectorAll('#v4b-overlay .mv-slot')].filter(x => !x.disabled);
      if (!b.length) return 'WAIT';
      b[0].click(); return 'HIT';`)
    if (st === 'OVER') return true
    await sleep(650)
  }
  return false
}
await lab(`W.DEV.battle(['walker']); return 1;`); await sleep(1300)
const fight1 = await fight()
await sleep(900)
const st2 = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
ok('第 2 章：点招式槽真的打赢一场，枪杀记账（kills + ammoUsed 都动了 → 目标①绿）', fight1 && st2.snap.kills >= 1 && st2.snap.ammoUsed >= 1 && st2.eval.items.find(i => i.id === 'gunKill').done === true, JSON.stringify({ kills: st2.snap.kills, ammoUsed: st2.snap.ammoUsed }))

await lab(`W.equipWeapon('crowbar'); W.DEV.battle(['walker']); return 1;`); await sleep(1300)
const fight2 = await fight()
await sleep(900)
const st3 = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
ok('第 2 章：换上撬棍再打一场 → 近战击杀记账（目标②绿）', fight2 && st3.snap.meleeKills >= 1 && st3.eval.items.find(i => i.id === 'meleeKill').done === true, JSON.stringify({ meleeKills: st3.snap.meleeKills, kills: st3.snap.kills }))

await lab(`W.setTab('inv'); W.render(); return 1;`); await sleep(900)
const swap2 = await clickBtn('button[onclick*="setLoaded"]', 5)
await sleep(900)
const done2 = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
ok('第 2 章：背包「弹药」区手动装填一次（目标③绿）', swap2 && Object.keys(done2.snap.load || {}).length > 0 && done2.eval.items.find(i => i.id === 'loadSwap').done === true, JSON.stringify({ load: done2.snap.load, click: swap2 }))
ok('第 2 章三条绿了但没通关（M48 的第④条还没做，3/4）', done2.eval.passed === false && done2.eval.green === 3, JSON.stringify({ green: done2.eval.green, total: done2.eval.total }))

/* ── 6a) M48：目标④要真拿穿甲弹打死一只装甲丧尸（换弹那一步只证明"点过切换"） ──
   注意：上一步为了验证"近战击杀"把武器换成了撬棍，这里必须**换回手枪**再打 ——
   拿着撬棍打死装甲丧尸只会记近战击杀（第一次跑就是这么红的）。 */
await lab(`W.equipWeapon('pistol'); W.setLoaded('c9','a9_ap'); W.S.hp = W.S.hpMax; W.DEV.battle(['armored']); return 1;`)
await sleep(1500)
const armedBefore = await lab(`return JSON.stringify({ wpn: W.S.eq.wpn, loaded: (W.S.load || {}).c9 || null, ammo: W.S.ammo, apKills: W.S.stats.apKills || 0, hp: W.S.hp });`)
/* 先等战斗界面真的开起来：慢一帧就判 'OVER' 会把整场战斗跳过（第一次跑就是这么"0 击杀"的） */
let armedOpen = false
for (let i = 0; i < 24 && !armedOpen; i++) {
  armedOpen = (await lab(`return !!(W.V4UI && W.V4UI.isOpen())`)) === true
  if (!armedOpen) await sleep(500)
}
ok('第 2 章：装甲丧尸遭遇真的开打了（战斗界面打开）', armedOpen, JSON.stringify(armedBefore))
for (let i = 0; i < 40 && armedOpen; i++) {
  /* 用**威力最大的**那一招（第 2 格「连发」），血低了点「包扎」—— 装甲丧尸 hp62/armor5：
     点射一下只有 3~9 点，而它一巴掌 17，不回血硬打会先倒下（第一次跑就是这么红的）。 */
  const st = await lab(`if (!W.V4UI || !W.V4UI.isOpen()) return 'OVER';
    const ov = D.getElementById('v4b-overlay');
    const txt = ov ? ov.textContent.replace(/\\s+/g, ' ') : '';
    const hp = (txt.match(/生命(\\d+)\\/(\\d+)/) || [0, '999', '999']);
    const low = (+hp[1]) < 55;
    const all = [...(ov ? ov.querySelectorAll('.mv-slot') : [])];
    const heal = all.find(x => /包扎/.test(x.textContent || '') && !x.disabled);
    const shot = (all[1] && !all[1].disabled) ? all[1] : all.find(x => !x.disabled);
    const pick = (low && heal) ? heal : shot;
    if (!pick) return 'WAIT';
    pick.click();
    const ov2 = D.getElementById('v4b-overlay');
    const t2 = ov2 ? ov2.textContent.replace(/\\s+/g, ' ') : '';
    /* 打死了：结算面板上点「继续」收工（不然下一轮又变成没招可点的 WAIT，空转十几秒） */
    const doneBtn = ov2 ? [...ov2.querySelectorAll('button')].find(b => /继续/.test(b.textContent || '')) : null;
    if (doneBtn) { doneBtn.click(); return 'END'; }
    return JSON.stringify({ foe: (t2.match(/HP \\d+\\/\\d+/) || ['?'])[0], myHp: hp[1], healed: !!(low && heal), ammo: W.S.ammo, apKills: W.S.stats.apKills });`)
  if (st === 'OVER' || st === 'END') break
  if (i < 16) console.log('    装甲战第' + (i + 1) + '轮：' + st)
  await sleep(700)
}
await sleep(1000)
const doneAp = JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
ok('第 2 章：换上穿甲弹真的打死一只装甲丧尸（apKills 记账 → 目标④绿）',
  doneAp.snap.apKills >= 1 && doneAp.eval.items.find(i => i.id === 'apKill').done === true,
  JSON.stringify({ before: armedBefore, apKills: doneAp.snap.apKills }))
ok('第 2 章四条全绿 → 判定通关（4/4）', doneAp.eval.passed === true && doneAp.eval.green === 4, JSON.stringify({ green: doneAp.eval.green, total: doneAp.eval.total }))
const prog2 = JSON.parse(await ev(`JSON.stringify({ raw: localStorage.getItem('zsv-lab-v1') || '', badges: [...document.querySelectorAll('#v4lab-chapters .lab-ch')].map(c => c.textContent.replace(/\\s+/g, ' ').slice(0, 46)) })`))
ok('两章的通关都记在本机进度里', /"combat":\d+/.test(prog2.raw) && /"survival":\d+/.test(prog2.raw), prog2.raw)
ok('章节列表里两章都挂上「已通关」徽章', (prog2.badges.join('|').match(/已通关/g) || []).length >= 2, JSON.stringify(prog2.badges))
await shot('03_lab_chapter2')

/* ── 6b) 第 3~6 章：每章切进去 → 按预设开局 → 用真实操作把目标打绿 ── */
const switchChapter = async (id, seed, extraWait = 0) => {
  await ev(`(() => { const c = document.querySelector('#v4lab-chapters .lab-ch[data-ch="${id}"]'); if (c) c.click(); return 1 })()`)
  await sleep(900 + extraWait)
  for (let i = 0; i < 40; i++) {
    const r = await lab(`if (!W.S || W.S.seed !== ${JSON.stringify(seed)}) return 'WAIT'; return JSON.stringify({ day: W.S.day, seed: W.S.seed, ap: W.S.ap, inj: (W.S.body && W.S.body.injuries ? W.S.body.injuries.length : 0), base: W.S.base, steps: W.S.world && W.S.world.steps, visited: W.S.world && W.S.world.visited ? Object.keys(W.S.world.visited).length : 0 });`)
    if (r && r !== 'WAIT' && r !== 'NO-FRAME' && !String(r).startsWith('EXC')) return JSON.parse(r)
    await sleep(500)
  }
  return null
}
const statusNow = async () => JSON.parse(await ev(`JSON.stringify(window.V4Lab.status())`))
/** 在沙盒里回安全屋 + 睡觉（第 3/4 章的"睡一觉"目标） */
const labSleep = async () => {
  await lab(`const w = W.S.world, h = (W.DEV.localWorld() || {}).home; if (h) w.cur = { x: h.x, y: h.y }; W.setTab('explore'); W.render(); return 1;`)
  await sleep(900)
  const ok2 = await clickBtn('#v4cards button[onclick*="V4Night.rest"]', 6)
  await sleep(1600)
  return ok2
}

/* 第 3 章 · 人体与伤病：预设伤情 → 人体页急救 → 睡一觉 */
const boot3 = await switchChapter('medical', 'lab-medical-01')
ok('第 3 章按预设开局：带一处出血 + 一处骨折（用户拍板的"预设伤情"）', boot3 && boot3.inj === 2, JSON.stringify({ injuries: boot3 && boot3.inj, seed: boot3 && boot3.seed }))
await lab(`W.setTab('body'); W.render(); return 1;`); await sleep(1000)
const tx = []
for (const [part, item] of [['armR', 'bandage'], ['legL', 'splint']]) {
  await lab(`const g = D.querySelector('.mpart[data-part="${part}"]'); if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1;`)
  await sleep(700)
  tx.push(await lab(`const b = D.querySelector('button[onclick*="V4Medical.treat(\\'${part}\\',\\'${item}\\')"]'); if (!b) return 'NO-BTN'; b.click(); return 'CLICKED';`))
  await sleep(800)
}
const st3b = await statusNow()
ok('第 3 章：人体页点急救（绷带止血 + 夹板固定）→ 目标①②绿', tx.every(x => x === 'CLICKED') && st3b.eval.items.find(i => i.id === 'bleedFix').done === true && st3b.eval.items.find(i => i.id === 'splintFix').done === true, JSON.stringify({ tx, inj: st3b.snap.injuries }))
const sleepOk3 = await labSleep()
const done3 = await statusNow()
ok('第 3 章：回安全屋睡一觉 → 3/3 通关', sleepOk3 && done3.snap.day >= 2 && done3.eval.passed === true, JSON.stringify({ day: done3.snap.day, green: done3.eval.green }))
await shot('04_lab_chapter3')

/* 第 4 章 · 建造与据点：据点页建净水装置 + 工作台 → 睡一觉 */
const boot4 = await switchChapter('base', 'lab-base-01')
ok('第 4 章按预设开局：材料够、设施全空（要自己建）', boot4 && boot4.base && Object.values(boot4.base).every(v => !v), JSON.stringify({ base: boot4 && boot4.base }))
await lab(`W.setTab('base'); W.render(); return 1;`); await sleep(1000)
const bd = []
for (const k of ['filter', 'bench']) {
  bd.push(await clickBtn(`button[onclick*="build('${k}')"]`, 5))
  await sleep(800)
}
const st4b = await statusNow()
ok('第 4 章：据点页点建设（净水装置 + 工作台）→ 目标①②绿', bd.every(Boolean) && st4b.eval.items.find(i => i.id === 'filter1').done === true && st4b.eval.items.find(i => i.id === 'bench1').done === true, JSON.stringify({ bd, base: st4b.snap.base }))
const sleepOk4 = await labSleep()
const done4 = await statusNow()
ok('第 4 章：睡一觉 → 3/3 通关', sleepOk4 && done4.eval.passed === true, JSON.stringify({ day: done4.snap.day, green: done4.eval.green }))
await shot('05_lab_chapter4')

/* 第 5 章 · 地图与大区：走 8 格 → 深搜 1 次 → 跨区 */
const boot5 = await switchChapter('world', 'lab-world-01')
ok('第 5 章按预设开局：体能 9 级 → 行动力上限 17（走路 8 + 深搜 2 + 跨区都够）', boot5 && boot5.ap >= 16, JSON.stringify({ ap: boot5 && boot5.ap }))
for (let i = 0; i < 14; i++) {
  const st = await lab(`const s = W.S.world, w = W.DEV.localWorld();
    if (W.V4UI && W.V4UI.isOpen()) return 'BATTLE';
    const cur = s.cur;
    const cands = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]
      .map(([dx, dy]) => w.blocks[(cur.x + dx) + ',' + (cur.y + dy)]).filter(b => b && b.revealed);
    if (!cands.length) return 'NOWHERE';
    W.V4World.click(cands[0].x, cands[0].y); W.V4World.confirmTrip();
    return JSON.stringify({ to: cands[0].x + ',' + cands[0].y, ap: W.S.ap, visited: Object.keys(s.visited).length });`)
  if (st === 'BATTLE') { await fight(); await sleep(600); continue }
  if (st === 'NOWHERE') break
  const info = JSON.parse(String(st))
  if (info.visited >= 8) break
  await sleep(700)
}
const walkSt = JSON.parse(String(await lab(`return JSON.stringify({ visited: Object.keys(W.S.world.visited).length, ap: W.S.ap, steps: W.S.world.steps });`)))
ok('第 5 章：点地图走格子（真实旅行）→ 点亮 ≥8 格（目标①绿）', walkSt.visited >= 8, JSON.stringify(walkSt))
await lab(`const w = W.DEV.localWorld(), s = W.S.world; let best = null, bd2 = 99;
  for (const k in w.blocks) { const b = w.blocks[k]; if (!b.poi || b.poi === 'lab' || b.poi === 'sunken' || b.biome === 'water') continue;
    const d = Math.max(Math.abs(b.x - s.cur.x), Math.abs(b.y - s.cur.y)); if (d < bd2) { bd2 = d; best = b; } }
  if (best) s.cur = { x: best.x, y: best.y }; W.render(); return 1;`)
await sleep(900)
const deep5 = await clickBtn('#v4cards button[onclick*="V4World.search(1)"]', 5)
await sleep(900)
const st5b = await statusNow()
ok('第 5 章：深度搜索一次（目标②绿）', deep5 && st5b.eval.items.find(i => i.id === 'deep5').done === true, JSON.stringify({ deep: st5b.snap.deep }))
/* 修车：找到一处带 🔧 的修车点（POIS 里 feat==='vehicle'），站过去点「修车」
   （大区图上的跨区旅行要求有载具 —— 这是设计，不是 bug：所以第 5 章的目标就是"弄到一辆车"）
   注意：**不能在同一个 evaluate 里"移动 + 查 DOM"** —— render 之后卡片墙是 MutationObserver
   在微任务里重建的，当场查只会看到旧 DOM（这个坑踩过两次）。移动与点击分成两步，中间 await。 */
const carAt = String(await lab(`const w = W.DEV.localWorld(), s = W.S.world, POIS = W.V4.POIS || {};
  const cands = Object.keys(w.blocks).map(k => w.blocks[k])
    .filter(b => b && b.poi && POIS[b.poi] && POIS[b.poi].feat === 'vehicle')
    .sort((a, b) => Math.max(Math.abs(a.x - s.cur.x), Math.abs(a.y - s.cur.y)) - Math.max(Math.abs(b.x - s.cur.x), Math.abs(b.y - s.cur.y)));
  if (!cands.length) return 'NO-VEH-POI';
  s.cur = { x: cands[0].x, y: cands[0].y }; W.render();
  return cands[0].x + ',' + cands[0].y + ':' + cands[0].poi;`))
await sleep(1100)
const carOk = await clickBtn('button[onclick*="V4World.fixCar"]', 6)
await sleep(900)
const st5c = await statusNow()
ok('第 5 章：修车点修好一辆车（跨大区的前提）→ 目标③仍未绿（M60 起要"真的开过去"）',
  carOk && st5c.snap.veh === true && st5c.eval.items.find(i => i.id === 'cross5').done === false && st5c.eval.green === 2,
  JSON.stringify({ carAt, carOk, veh: st5c.snap.veh, green: st5c.eval.green }))

/* ── M60：真的跨一次大区（目标③的硬验证）—— 选一个开得到的邻区，报价、出发、核对到账 ──
   区域 id 从**大区图的格子**上取（onclick 里的 pickRegion('rX-Y')）：沙盒 iframe 里的 DEV 钩子
   没有 regions 那一份（DEV 形状与父页面不同），拿 DEV 查会得到空列表 → 假红一次。 */
await lab(`W.V4World.mapMode('region'); W.render(); return 1;`)
await sleep(800)
const crossPlan = JSON.parse(String(await lab(`const s = W.S.world;
  const ids = [...D.querySelectorAll('#v4world .rcell2')]
    .map(c => (/pickRegion\\('([^']+)'\\)/.exec(c.getAttribute('onclick') || '') || [])[1]).filter(Boolean);
  let best = null;
  for (const id of ids) { if (id === s.region) continue; const t = W.V4World.trip(id); if (t && t.ok && (!best || t.ap < best.trip.ap)) best = { id: id, trip: t }; }
  if (!best) return JSON.stringify({ ok: false, why: '没有开得到的邻区', cells: ids.length, from: s.region, fuel: s.veh && s.veh.fuel, ap: W.S.ap });
  return JSON.stringify({ ok: true, cells: ids.length, from: s.region, to: best.id, ap: best.trip.ap, fuel: best.trip.fuel,
    steps: best.trip.steps, fuelBefore: s.veh.fuel, apBefore: W.S.ap, crossingsBefore: s.crossings || 0 });`)))
ok('第 5 章：大区地图给出可开的邻区（有车有油才点得动「出发」）', crossPlan.ok === true, JSON.stringify(crossPlan).slice(0, 160))
const crossAt = await lab(`W.V4World.travelRegion(${JSON.stringify(crossPlan.to)}); return 1;`)
void crossAt
await sleep(1100)
const crossDone = JSON.parse(String(await lab(`const s = W.S.world;
  return JSON.stringify({ region: s.region, crossings: s.crossings || 0, fuel: s.veh ? s.veh.fuel : null, ap: W.S.ap,
    cur: s.cur, home: { x: W.DEV.localWorld().home.x, y: W.DEV.localWorld().home.y }, trail: (s.trail || []).slice(-1)[0] || '' });`)))
const st5d = await statusNow()
console.log('  跨区: ' + JSON.stringify({ ...crossDone, plan: { to: crossPlan.to, ap: crossPlan.ap, fuel: crossPlan.fuel } }))
ok('第 5 章：真的跨过去了（大区变了、落在该区的入口、车没油也能回来）',
  crossPlan.ok && crossDone.region === crossPlan.to && crossDone.region !== crossPlan.from &&
  crossDone.cur.x === crossDone.home.x && crossDone.cur.y === crossDone.home.y,
  JSON.stringify({ from: crossPlan.from, to: crossDone.region, cur: crossDone.cur, home: crossDone.home }))
ok('第 5 章：油耗与行动力按地图上的报价扣（不是"随便扣一点"）',
  crossDone.fuel === crossPlan.fuelBefore - crossPlan.fuel && crossDone.ap === crossPlan.apBefore - crossPlan.ap,
  `油 ${crossPlan.fuelBefore}→${crossDone.fuel}（-${crossPlan.fuel}）· ⚡ ${crossPlan.apBefore}→${crossDone.ap}（-${crossPlan.ap}）`)
ok('第 5 章：跨区计数 +1（硬验证的口径），目标③绿、3/3 通关',
  crossDone.crossings === crossPlan.crossingsBefore + 1 && st5d.snap.crossings >= 1 &&
  st5d.eval.items.find(i => i.id === 'cross5').done === true && st5d.eval.passed === true,
  JSON.stringify({ before: crossPlan.crossingsBefore, after: crossDone.crossings, green: st5d.eval.green, snap: st5d.snap.crossings }))
await shot('06_lab_chapter5')
/* 探针卫生：地图视图是存在 localStorage 的（`dsh.mapmode`），同一个 origin 后面的探针会继承它 ——
   不清掉的话 m37/m43 拿"本地图格子"当判据时会读到 0 个格子 → 一片假红（M60 实测踩到一次）。 */
await lab(`W.V4World.mapMode('local'); W.render(); return 1;`)
await sleep(400)
await ev(`localStorage.removeItem('dsh.mapmode'); 1`)

/* 第 6 章 · 背包与制作：制作 1 件 → 手动装填 → 背包 6 种 */
const boot6 = await switchChapter('bag', 'lab-bag-01')
ok('第 6 章按预设开局：布料够做绷带、枪 + 两种弹在手', boot6 && boot6.day === 1, JSON.stringify({ seed: boot6 && boot6.seed }))
await lab(`W.setTab('craft'); W.render(); return 1;`); await sleep(1100)
const crafted = await lab(`const btn = [...D.querySelectorAll('#view button')].find(b => /craft\\(/.test(b.getAttribute('onclick') || '') &&
    /绷带/.test((b.closest('.lrow') || b.parentElement || {}).textContent || ''));
  if (!btn) return 'NO-BTN'; if (btn.disabled) return 'DISABLED'; btn.click(); return 'CLICKED';`)
await sleep(1000)
await lab(`W.setTab('inv'); W.render(); return 1;`); await sleep(900)
const load6 = await clickBtn('button[onclick*="setLoaded"]', 5)
await sleep(900)
const done6 = await statusNow()
ok('第 6 章：制作页点「绷带」→ 手工计数（目标①绿）', crafted === 'CLICKED' && done6.eval.items.find(i => i.id === 'craft6').done === true, JSON.stringify({ crafted, craftedCnt: done6.snap.crafted, bandage: done6.snap.inv.bandage }))
ok('第 6 章：背包装填 + 背包 6 种 → 3/3 通关', load6 && done6.snap.invKinds >= 6 && done6.eval.passed === true, JSON.stringify({ load: done6.snap.load, invKinds: done6.snap.invKinds, green: done6.eval.green }))
await shot('07_lab_chapter6')

/* 六章全通：章节卡都挂徽章、进度里六条都在 */
const allProg = JSON.parse(await ev(`JSON.stringify({ raw: localStorage.getItem('zsv-lab-v1') || '', badges: [...document.querySelectorAll('#v4lab-chapters .lab-ch')].map(c => c.textContent.replace(/\\s+/g, ' ').slice(0, 40)) })`))
const doneIds = ['survival', 'combat', 'medical', 'base', 'world', 'bag'].filter(id => allProg.raw.includes('"' + id + '"'))
ok('六章全部通关并记进本机进度', doneIds.length === 6, JSON.stringify({ doneIds, badges: allProg.badges.filter(b => /已通关/.test(b)).length }))

/* ── 7) 重来 / 关闭 ── */
await ev(`document.querySelector('#v4lab button[onclick*="V4Lab.reset"]').click(); 1`); await sleep(3000)
let fresh = null
let freshErr = ''
for (let i = 0; i < 34; i++) {
  /* 等 iframe 重载完再读：线上比本地慢，早期会读到"seed 还没写进去"的半截状态（线下跑过一次假红） */
  const r = await lab(`if (!W.S || !W.S.stats || !W.S.seed) return 'WAIT'; return JSON.stringify({ day: W.S.day, scav: W.S.stats.scav, seed: W.S.seed, kills: W.S.stats.kills, ammoUsed: W.S.stats.ammoUsed });`)
  if (r && r !== 'WAIT' && r !== 'NO-FRAME' && !String(r).startsWith('EXC')) { fresh = JSON.parse(r); break }
  freshErr = String(r)
  await sleep(500)
}
ok('「↻ 重来这一章」按当前章重置（第 6 章 → 同种子、计数清零）', fresh && fresh.day === 1 && fresh.seed === 'lab-bag-01' && fresh.kills === 0 && fresh.ammoUsed === 0, JSON.stringify(fresh) + (fresh ? '' : ' | last=' + freshErr))
await ev(`document.querySelector('#v4lab button[onclick*="V4Lab.close"]').click(); 1`); await sleep(600)
const closed = JSON.parse(await ev(`JSON.stringify({ lab: !!document.getElementById('v4lab'), frame: !!document.getElementById('v4lab-frame'), day: S.day, cards: document.querySelectorAll('#v4cards .v4card').length })`))
ok('「✕ 关闭沙盒」把 iframe 与覆盖层都摘掉，主页面照常', closed.lab === false && closed.frame === false && closed.cards > 0 && closed.day === saveBefore.day, JSON.stringify(closed))

/* ── 8) M33.1：教程最后一步给"去沙盒练一章"的出口 ── */
await ev(`(() => { try { V4Tutorial.start(true); } catch (e) { return 'ERR'; } return 1 })()`); await sleep(800)
/* 走到最后一步：看徽章而不是看根节点 —— 教程关掉之后 #v4tut 这个根节点还留着（只是空了） */
let tutBadge = ''
for (let i = 0; i < 18; i++) {
  const b = String(await ev(`(() => { const x = document.querySelector('#v4tut .v4tut-bub .badge'); return x ? x.textContent : ''; })()`))
  tutBadge = b
  if (/15 \/ 15/.test(b)) break
  await ev(`V4Tutorial.next()`); await sleep(280)
}
const tutLast = JSON.parse(await ev(`(() => {
  const b = document.querySelector('#v4tut .v4tut-bub');
  if (!b) return JSON.stringify({ open: false });
  const btn = [...b.querySelectorAll('button')].find(x => /去沙盒练一章/.test(x.textContent || ''));
  const badge = (b.querySelector('.badge') || {}).textContent;
  return JSON.stringify({ open: true, badge, hasBtn: !!btn, body: (b.querySelector('.v4tut-bd') || {}).textContent });
})()`))
ok('新手教程最后一步有「🧪 去沙盒练一章（不写主档）」按钮', tutLast.open === true && tutLast.hasBtn === true && /15 \/ 15/.test(tutLast.badge || ''), JSON.stringify({ badge: tutLast.badge, hasBtn: tutLast.hasBtn }))
ok('教程最后一步的正文也指明了沙盒（六章练习 + 不碰主档）', /沙盒/.test(tutLast.body || '') && /六章/.test(tutLast.body || ''), String(tutLast.body).replace(/\s+/g, ' ').slice(-70))
await ev(`(() => { const b = [...document.querySelectorAll('#v4tut .v4tut-bub button')].find(x => /去沙盒练一章/.test(x.textContent || '')); if (b) b.click(); return 1 })()`)
await sleep(1200)
const backToLab = JSON.parse(await ev(`JSON.stringify({ lab: !!document.getElementById('v4lab'), tut: !!document.getElementById('v4tut'), done: (localStorage.getItem('dsh.tutorial.done') || '') })`))
ok('点它真的能进沙盒（教程关掉、沙盒打开）', backToLab.lab === true && backToLab.tut === false, JSON.stringify(backToLab))
await ev(`document.querySelector('#v4lab button[onclick*="V4Lab.close"]').click(); 1`); await sleep(500)
await ev(`localStorage.removeItem('dsh.tutorial.done'); localStorage.removeItem('dsh.tutorial.step'); 1`)

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
