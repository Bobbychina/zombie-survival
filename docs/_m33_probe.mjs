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
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(4200)
await ev(`(() => { if (typeof setTab === 'function') setTab('explore'); if (typeof render === 'function') render(); return 1 })()`); await sleep(800)

/* ── 0) 主档留证（隔离验证的基准）：密文长度 + 指纹 + 主页面进度 ──
   换个端口跑 = 换了个 origin（localStorage 是空的）——先确保主档真的存在，否则"隔离"验的是空气。 */
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(1400)
const saveBefore = JSON.parse(await ev(`(() => {
  const raw = localStorage.getItem('zombie_survival_save_v2') || '';
  let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return JSON.stringify({ len: raw.length, hash: h, enc: raw.slice(0, 5), day: S.day, mat: S.mat, keys: Object.keys(localStorage).sort() });
})()`))
ok('主档是密文（ZSV1）且能读到进度', saveBefore.enc.startsWith('ZSV1') && saveBefore.len > 200, JSON.stringify({ len: saveBefore.len, day: saveBefore.day }))

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
ok('章节壳列出 6 章：前两章可玩、其余 4 章标"下一批"', shell.chs.length === 6 && shell.chs.slice(0, 2).every(c => !c.soon) && shell.chs.slice(2).every(c => c.soon) && shell.chs[0].on === true, JSON.stringify(shell.chs.map(c => c.id + (c.soon ? '(soon)' : ''))))
ok('目标清单有 4 条（开局全空）', shell.objs.length === 4 && shell.objs.every(o => !o.done), JSON.stringify(shell.objs.map(o => o.id)))
await shot('01_lab_ch1')

/* ── 2) 沙盒真的没读主档：day=1、固定种子、预设背包 ── */
let boot = null
for (let i = 0; i < 20; i++) {
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
for (let i = 0; i < 12; i++) {
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
ok('第 2 章的目标清单是 3 条（枪杀 / 近战杀 / 换弹）', shell2.objs.length === 3 && shell2.objs.includes('gunKill') && shell2.objs.includes('meleeKill') && shell2.objs.includes('loadSwap'), JSON.stringify(shell2.objs))
let boot2 = null
for (let i = 0; i < 20; i++) {
  const r = await lab(`if (!W.S || W.S.seed !== 'lab-combat-01') return 'WAIT'; return JSON.stringify({ day: W.S.day, seed: W.S.seed, pistol: W.S.inv.pistol || 0, ap: W.S.inv.a9_ap || 0, wpn: W.S.eq.wpn, kills: W.S.stats.kills });`)
  if (r && r !== 'WAIT' && r !== 'NO-FRAME' && !String(r).startsWith('EXC')) { boot2 = JSON.parse(r); break }
  await sleep(500)
}
ok('第 2 章沙盒按自己的预设开局（固定种子 lab-combat-01 + 手枪 + 两种 9mm + 计数清零）', boot2 && boot2.day === 1 && boot2.pistol === 1 && boot2.ap === 8 && boot2.wpn === 'pistol' && boot2.kills === 0, JSON.stringify(boot2))

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
ok('第 2 章三条全绿 → 判定通关（3/3）', done2.eval.passed === true && done2.eval.green === 3, JSON.stringify({ green: done2.eval.green, total: done2.eval.total }))
const prog2 = JSON.parse(await ev(`JSON.stringify({ raw: localStorage.getItem('zsv-lab-v1') || '', badges: [...document.querySelectorAll('#v4lab-chapters .lab-ch')].map(c => c.textContent.replace(/\\s+/g, ' ').slice(0, 46)) })`))
ok('两章的通关都记在本机进度里', /"combat":\d+/.test(prog2.raw) && /"survival":\d+/.test(prog2.raw), prog2.raw)
ok('章节列表里两章都挂上「已通关」徽章', (prog2.badges.join('|').match(/已通关/g) || []).length >= 2, JSON.stringify(prog2.badges))
await shot('03_lab_chapter2')

/* ── 7) 重来 / 关闭 ── */
await ev(`document.querySelector('#v4lab button[onclick*="V4Lab.reset"]').click(); 1`); await sleep(3000)
let fresh = null
let freshErr = ''
for (let i = 0; i < 34; i++) {
  const r = await lab(`if (!W.S || !W.S.stats) return 'WAIT'; return JSON.stringify({ day: W.S.day, scav: W.S.stats.scav, seed: W.S.seed, kills: W.S.stats.kills, ammoUsed: W.S.stats.ammoUsed });`)
  if (r && r !== 'WAIT' && r !== 'NO-FRAME' && !String(r).startsWith('EXC')) { fresh = JSON.parse(r); break }
  freshErr = String(r)
  await sleep(500)
}
ok('「↻ 重来这一章」按当前章重置（第 2 章 → 同种子、计数清零）', fresh && fresh.day === 1 && fresh.seed === 'lab-combat-01' && fresh.kills === 0 && fresh.ammoUsed === 0, JSON.stringify(fresh) + (fresh ? '' : ' | last=' + freshErr))
await ev(`document.querySelector('#v4lab button[onclick*="V4Lab.close"]').click(); 1`); await sleep(600)
const closed = JSON.parse(await ev(`JSON.stringify({ lab: !!document.getElementById('v4lab'), frame: !!document.getElementById('v4lab-frame'), day: S.day, cards: document.querySelectorAll('#v4cards .v4card').length })`))
ok('「✕ 关闭沙盒」把 iframe 与覆盖层都摘掉，主页面照常', closed.lab === false && closed.frame === false && closed.cards > 0 && closed.day === saveBefore.day, JSON.stringify(closed))

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
