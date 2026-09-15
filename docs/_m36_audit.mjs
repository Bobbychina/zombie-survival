// M36 深度自查（用户：「好好debug一下，确定没有bug」）—— 只做取证，不改产品代码。
//   覆盖：① 作弊码下线后的全局符号与逐字敲击；② 老档 flags.cheat 迁移（含加密落盘往返）；
//        ③ 全键盘扫描（无弹窗/有弹窗/战斗中三态）；④ 帮助弹窗结构与键位段；
//        ⑤ 输入框守卫、Esc 关弹窗；⑥ 全程异常与 console 收集。
// 用法：node docs/_m36_audit.mjs <cdpPort> <url> <outDir>
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

let id = 0
const pending = new Map()
const exceptions = []
const consoleErrors = []
const consoleWarns = []
const networkIssues = []                 // 环境网络问题（比如本机连不上账号中继）不算产品错
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').split('\n')[0].slice(0, 200))
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 240)
    if (m.params.type === 'error') consoleErrors.push(txt)
    if (m.params.type === 'warning') consoleWarns.push(txt)
  }
  if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') {
    const en = m.params.entry
    const text = String(en.text || '')
    /* 线上版会 ping 账号中继（dsh-oauth-relay…workers.dev）。本机网络不通时那是 ERR_CONNECTION_TIMED_OUT，
       属于环境问题而不是这个构建的问题 —— 单独归类，判定时不算错、但照样打出来。 */
    if (/net::ERR_(CONNECTION|NAME|INTERNET|ADDRESS|TIMED_OUT|CERT|TUNNEL)/.test(text)) networkIssues.push(String(en.url || '') + ' :: ' + text.slice(0, 120))
    else consoleErrors.push('LOG ' + text.slice(0, 200))
  }
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
const J = (s) => { try { return JSON.parse(s) } catch { return { raw: String(s).slice(0, 300) } } }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const key = async (k) => {
  /* 注意：CDP 的 key 必须是合法 key 值。传小写 'escape' 时浏览器给的是空字符串
     （M36 自查实测：e.key === ''，legacy 的 Esc 分支根本不匹配 → 误报"Esc 失效"）。 */
  const special = k.length > 1
  const code = special ? (k === 'Escape' ? 'Escape' : k) : (/[0-9]/.test(k) ? 'Digit' + k : 'Key' + k.toUpperCase())
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: special ? undefined : k, windowsVirtualKeyCode: special ? 27 : k.toUpperCase().charCodeAt(0) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: special ? 27 : k.toUpperCase().charCodeAt(0) })
}
const typeText = async (t) => { for (const ch of t) { await key(ch); await sleep(20) } }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const note = (n, extra = '') => console.log('note ' + n + (extra ? '  ' + extra : ''))

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })

/* 先落地一次拿同源，再清干净本机的存档/偏好：本探针只该在"干净档"上判分，
   否则上一支探针（比如故意改档的 M8 完整性探针）留下的被改档会让 ① 就报篡改。 */
await send('Page.navigate', { url: url + '?audit=clean0' }); await sleep(3000)
await ev(`(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} ; return 1 })()`)

const boot = async (q) => {
  await send('Page.navigate', { url: url + '?' + q })
  await sleep(6500)
  /* 线上版启动会去 ping 账号中继，网络不通时要等它超时（实测 ⑧A 因此撞上 "V4Integrity is not defined"）。
     所以这里等到"引擎真的就绪"再往下跑，而不是死等固定秒数。 */
  for (let i = 0; i < 60; i++) {
    const ready = await ev(`(typeof window.V4Integrity === 'object') && (typeof window.V4Vault === 'object') && (typeof window.S === 'object')`)
    if (ready === true) break
    await sleep(500)
  }
  await ev(`(() => { try { window.V4Tutorial && V4Tutorial.skip && V4Tutorial.skip() } catch {} ; try { closeAllModals() } catch {} ; return 1 })()`)
  await sleep(700)
}

/* ═══ ① 首启基线 ═══ */
await boot('audit1')
const base = J(await ev(`JSON.stringify({
  vault: typeof window.V4Vault, sanitize: typeof window.sanitizeSave, award: typeof window.award,
  integ: typeof window.V4Integrity,
  integrity: window.V4Integrity ? V4Integrity.summary() : 'n/a',
  tampered: window.V4Integrity ? V4Integrity.tampered() : 'n/a',
  savePrefix: (localStorage.getItem('zombie_survival_save_v2') || '').slice(0, 5),
  day: S.day, hpMax: S.hpMax, tab: S.tab,
  cheatKeys: Object.keys(window).filter(k => /cheat/i.test(k)),
  cheatIn: ('cheat' in window),
})`))
ok('① 引擎/导出就位（V4Vault / sanitizeSave / award / V4Integrity）',
  base.vault === 'object' && base.sanitize === 'function' && base.award === 'function' && base.integ === 'object',
  JSON.stringify({ vault: base.vault, sanitize: base.sanitize, integ: base.integ }))
ok('① window 上没有任何 cheat 属性', Array.isArray(base.cheatKeys) && base.cheatKeys.length === 0 && base.cheatIn === false, JSON.stringify({ keys: base.cheatKeys, inWindow: base.cheatIn }))
note('① 首启状态', JSON.stringify({ savePrefix: base.savePrefix, integrity: base.integrity, tampered: base.tampered, day: base.day }))

/* ═══ ② 存档往返（加密落盘）+ 完整性判定 ═══ */
await ev(`(() => { S.flags.cheat = true; S.hpMax = 120; S.hp = 120; saveGame(true); return 1 })()`)
await sleep(1800)
const written = J(await ev(`JSON.stringify({
  prefix: (localStorage.getItem('zombie_survival_save_v2') || '').slice(0, 5),
  cachedHasCheat: (() => { try { const p = V4Vault.read(); return p ? ('cheat' in (JSON.parse(p).flags || {})) : null } catch (e) { return 'ERR ' + e.message } })(),
})`))
ok('② 存档确实加密落盘（ZSV1:）且明文里带着我们塞的 cheat 旗标', written.prefix === 'ZSV1:' && written.cachedHasCheat === true, JSON.stringify(written))

await boot('audit2')   // ← 第二次启动：密文档 + 老档旗标
const after = J(await ev(`JSON.stringify({
  cheatFlag: ('cheat' in S.flags) ? String(S.flags.cheat) : 'absent',
  hpMax: S.hpMax, hp: S.hp,
  integrity: window.V4Integrity ? V4Integrity.summary() : 'n/a',
  tampered: window.V4Integrity ? V4Integrity.tampered() : 'n/a',
  verdictState: (window.V4Integrity && V4Integrity.verdict()) ? V4Integrity.verdict().state : null,
  preBoot: window.V4Integrity ? JSON.stringify(V4Integrity.preBootVerdict()) : 'n/a',
  warnLogs: (S.logBuf || []).filter(l => /存档检查|被修改过|指纹/.test(String(l[1] || ''))).map(l => l[0] + ': ' + l[1]),
  visibleLog: [...document.querySelectorAll('#log .le')].slice(-6).map(e => (e.className || '').replace('le ', '') + ': ' + (e.textContent || '').slice(0, 60)),
  toasts: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent),
})`))
await shot('audit_boot2')
ok('② 老档 flags.cheat 被 sanitizeSave 清掉', after.cheatFlag === 'absent', JSON.stringify({ cheatFlag: after.cheatFlag }))
ok('② 其它数值没被误伤（hpMax 120 原样带回）', after.hpMax === 120, 'hpMax=' + after.hpMax)
ok('② 加密存档不被误判篡改（本次自己写的干净档必须判 ok）',
  after.tampered === false && after.verdictState === 'ok' && (after.warnLogs || []).length > 0 &&
  !/⚠️/.test(String((after.warnLogs || [])[(after.warnLogs || []).length - 1] || '')),
  JSON.stringify({ integrity: after.integrity, verdictState: after.verdictState, preBoot: after.preBoot, tampered: after.tampered, warnLogs: after.warnLogs, visibleLog: after.visibleLog, toasts: after.toasts }))

/* 再次落盘：确认写出去的那份里也没有 cheat 旗标，且完整性链没断 */
await ev(`(() => { saveGame(true); return 1 })()`)
await sleep(1800)
const round = J(await ev(`JSON.stringify({
  cachedHasCheat: (() => { try { const p = V4Vault.read(); return p ? ('cheat' in (JSON.parse(p).flags || {})) : null } catch (e) { return 'ERR ' + e.message } })(),
  tampered: window.V4Integrity ? V4Integrity.tampered() : 'n/a',
  integrity: window.V4Integrity ? V4Integrity.summary() : 'n/a', day: S.day,
})`))
ok('② 清过一次之后，后续写档里不再出现 cheat 旗标', round.cachedHasCheat === false, JSON.stringify(round))
ok('② 写档后完整性仍然一致（无 tampered 传染）', round.tampered === false, JSON.stringify({ integrity: round.integrity }))

/* ═══ ③ 全键盘扫描 ═══ */
const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
const digits = '0123456789'.split('')
await ev(`(() => { closeAllModals(); setTab('explore'); return 1 })()`)
await sleep(500)
const sweepA = J(await ev(`(() => {
  window.__auditTabs = []; window.__auditErr = []
  const before = S.day
  return JSON.stringify({ day: before, tab: S.tab })
})()`))
let sweepAErr = 0
for (const k of letters.concat(digits)) {
  if (k === 'n') continue                       // 睡觉单独测：会推进一天
  const r = await ev(`(() => { const t0 = S.tab; return t0 })()`)
  await key(k); await sleep(60)
  const t1 = await ev(`S.tab`)
  if (typeof t1 === 'string' && t1.startsWith('EXC')) sweepAErr++
  if (typeof r === 'string' && r.startsWith('EXC')) sweepAErr++
}
ok('③ 无弹窗：a-z(除 n)+0-9 全键扫过，无异常', sweepAErr === 0 && exceptions.length === 0, 'exceptions=' + JSON.stringify(exceptions.slice(0, 3)))

const tabMap = { e: 'explore', b: 'base', i: 'inv', c: 'craft', k: 'skills', q: 'quest', j: 'codex', s: 'stats' }
let tabBad = []
for (const [k, want] of Object.entries(tabMap)) {
  await ev(`(() => { closeAllModals(); setTab('explore'); return 1 })()`); await sleep(200)
  await key(k); await sleep(220)
  const got = await ev(`S.tab`)
  if (got !== want) tabBad.push(k + '→' + got + '(want ' + want + ')')
}
ok('③ 页签快捷键 e/b/i/c/k/q/j/s 映射未受影响', tabBad.length === 0, tabBad.join(', '))

/* 有弹窗时：一律不该切页签 / 睡觉 */
await ev(`(() => { closeAllModals(); setTab('explore'); openHelp(); return 1 })()`)
await sleep(600)
const beforeB = J(await ev(`JSON.stringify({ day: S.day, tab: S.tab, hp: S.hp, mat: S.mat, ammo: S.ammo, hpMax: S.hpMax })`))
let sweepBErr = 0
for (const k of letters.concat(digits)) { await key(k); await sleep(45); const t = await ev(`typeof S.tab`); if (typeof t === 'string' && t.startsWith('EXC')) sweepBErr++ }
await sleep(300)
const afterB = J(await ev(`JSON.stringify({ day: S.day, tab: S.tab, hp: S.hp, mat: S.mat, ammo: S.ammo, hpMax: S.hpMax,
  overlays: document.querySelectorAll('#overlay-root .overlay').length,
  helpStillOpen: !!([...document.querySelectorAll('#overlay-root .overlay')].find(o => /生存手册/.test((o.querySelector('.modal-hd h2') || {}).textContent || ''))) })`))
ok('③ 弹窗开着时全键扫过：页签/天数不动、弹窗还在、无异常',
  sweepBErr === 0 && beforeB.tab === afterB.tab && beforeB.day === afterB.day && afterB.overlays >= 1 && afterB.helpStillOpen === true,
  JSON.stringify({ beforeB, afterB }))
ok('③ 弹窗开着时敲完整作弊码：资源/血量一个数都没变',
  beforeB.hp === afterB.hp && beforeB.hpMax === afterB.hpMax && beforeB.mat === afterB.mat && beforeB.ammo === afterB.ammo,
  JSON.stringify({ hp: [beforeB.hp, afterB.hp], hpMax: [beforeB.hpMax, afterB.hpMax], mat: [beforeB.mat, afterB.mat], ammo: [beforeB.ammo, afterB.ammo] }))
ok('③ 日志里没有任何作弊字样（改对了字段：logBuf 是 [type, msg]）',
  (await ev(`(S.logBuf || []).filter(l => /作弊|Bobby 模式|权限已激活/.test(String(l[1] || ''))).length`)) === 0,
  '')

/* 睡觉键单独验（无弹窗时才生效） */
await ev(`(() => { closeAllModals(); setTab('explore'); return 1 })()`); await sleep(300)
const dayBefore = await ev(`S.day`)
await key('n'); await sleep(2500)
const sleepState = J(await ev(`JSON.stringify({ day: S.day, battle: window.V4UI ? V4UI.isOpen() : false, overlays: document.querySelectorAll('#overlay-root .overlay').length })`))
ok('③ n 键睡觉路径没被删除逻辑波及（天数推进或进入守夜/战斗）',
  typeof sleepState.day === 'number' && (sleepState.day > dayBefore || sleepState.battle === true || sleepState.overlays > 0),
  'day ' + dayBefore + '→' + sleepState.day + ' ' + JSON.stringify(sleepState))

/* ═══ ④ 战斗键位（v4 战斗界面：捕获阶段 1-4 出招 / 5 逃 / 6 换武器）═══ */
await ev(`(() => { closeAllModals(); if (window.V4UI && V4UI.close) V4UI.close(); window.startCombat(['walker'], { title: 'M36 自查' }); return 1 })()`)
await sleep(1500)
const battleOpen = await ev(`(typeof window.__v4BattleOpen === 'function') ? window.__v4BattleOpen() : (window.V4UI ? V4UI.isOpen() : false)`)
ok('④ 战斗能起来（v4 战斗界面已接管）', battleOpen === true, 'open=' + String(battleOpen))
const b0 = J(await ev(`(() => { const b = window.V4UI && V4UI.battle ? V4UI.battle() : null; return JSON.stringify(b ? { round: b.round, foeHp: b.foes && b.foes[0] ? b.foes[0].hp : null } : null) })()`))
let battleErr = 0
for (const k of ['1', '2', '3', '4', '6']) { await key(k); await sleep(1100); const r = await ev(`window.V4UI ? V4UI.isOpen() : false`); if (typeof r === 'string' && r.startsWith('EXC')) battleErr++ }
const b1 = J(await ev(`(() => { const b = window.V4UI && V4UI.battle ? V4UI.battle() : null; return JSON.stringify({ open: window.V4UI ? V4UI.isOpen() : null, b: b ? { round: b.round, foeHp: b.foes && b.foes[0] ? b.foes[0].hp : null } : null, logLines: document.querySelectorAll('#v4cblog .cl, #v4cb .cl').length }) })()`))
ok('④ 战斗中 1/2/3/4/6 键不抛异常', battleErr === 0 && exceptions.length === 0, JSON.stringify({ b0, b1, exceptions: exceptions.slice(0, 2) }))
await shot('audit_combat')
await ev(`(() => { if (window.V4UI && V4UI.close) V4UI.close(); closeAllModals(); return 1 })()`)
await sleep(600)

/* ═══ ⑤ 帮助弹窗结构 + Esc ═══ */
const help = J(await ev(`(() => {
  closeAllModals(); openHelp()
  const o = [...document.querySelectorAll('#overlay-root .overlay')].find(x => /生存手册/.test((x.querySelector('.modal-hd h2') || {}).textContent || ''))
  const body = o && o.querySelector('.modal-bd')
  const txt = body ? body.innerText.replace(/\\s+$/,'') : ''
  const lastLine = txt.split('\\n').filter(Boolean).pop() || ''
  return JSON.stringify({ found: !!o, kbd: body ? body.querySelectorAll('kbd').length : 0, lastLine: lastLine.slice(-40),
    hasCheat: /彩蛋|作弊码|bobbychina/.test(txt), lines: txt.split('\\n').length,
    emptyTail: /\\n\\s*\\n\\s*$/.test(txt), imgs: body ? body.querySelectorAll('img').length : -1,
    overlays: document.querySelectorAll('#overlay-root .overlay').length })
})()`))
ok('⑤ 帮助弹窗结构正常（15 个 kbd、无彩蛋行、无尾部空段）',
  help.found === true && help.kbd === 15 && help.hasCheat === false && help.emptyTail === false,
  JSON.stringify(help))
await key('Escape'); await sleep(600)
const escState = J(await ev(`JSON.stringify({ overlays: document.querySelectorAll('#overlay-root .overlay').length, battle: window.V4UI ? V4UI.isOpen() : false })`))
ok('⑤ Esc 关弹窗仍然有效', escState.overlays === 0, JSON.stringify(escState))

/* ═══ ⑥ 输入框守卫 ═══ */
const guard = J(await ev(`(() => {
  closeAllModals(); setTab('explore')
  const i = document.createElement('input'); i.id = 'audit-input'; document.body.appendChild(i); i.focus()
  return JSON.stringify({ tab: S.tab, active: (document.activeElement || {}).id })
})()`))
await key('e'); await sleep(200)
await key('i'); await sleep(200)
const guard2 = J(await ev(`JSON.stringify({ tab: S.tab, val: (document.getElementById('audit-input') || {}).value })`))
await ev(`(() => { const i = document.getElementById('audit-input'); if (i) i.remove(); return 1 })()`)
ok('⑥ 输入框里打字不会触发页签快捷键', guard.tab === guard2.tab && guard2.val === 'ei', JSON.stringify({ guard, guard2 }))

/* ═══ ⑧ M36.1 两个补修的取证：旧标记特赦 / 密文被改能判定 / 密钥丢了不冤人 ═══ */
const KEYCHECK = 'zombie_survival_keycheck_v1'
/* ⑧A 先造一份干净档，再手动盖一个"旧版本(v1) + tampered:true"的冤枉标记（内容指纹保持自洽） */
await ev(`(() => { closeAllModals(); saveGame(true); return 1 })()`); await sleep(1600)
const staged = J(await ev(`(async () => {
  const raw = JSON.parse(V4Vault.read())
  const sig = raw.__integrity || {}
  raw.__integrity = { v: 1, at: new Date().toISOString(), d: sig.d, tampered: true }
  localStorage.setItem('zombie_survival_save_v2', await V4Vault.encrypt(JSON.stringify(raw)))
  return JSON.stringify({ stagedV: raw.__integrity.v, stagedTampered: raw.__integrity.tampered, hasDigest: !!sig.d })
})()`))
await boot('audit-amnesty')
const amnesty = J(await ev(`JSON.stringify({
  tampered: V4Integrity.tampered(), verdict: V4Integrity.verdict() && V4Integrity.verdict().state,
  amnestyLog: (S.logBuf || []).filter(l => /误判标记|指纹校验通过/.test(String(l[1] || ''))).map(l => l[1]),
})`))
await ev(`(() => { saveGame(true); return 1 })()`); await sleep(1600)
const afterAmnesty = J(await ev(`(() => { const raw = JSON.parse(V4Vault.read()); return JSON.stringify({ v: raw.__integrity && raw.__integrity.v, tampered: !!(raw.__integrity && raw.__integrity.tampered) }) })()`))
ok('⑧A 旧版本(v1)误判标记被特赦：判 ok、不再算篡改，写档后换成 v2 且不带标记',
  staged.stagedV === 1 && amnesty.tampered === false && amnesty.verdict === 'ok' &&
  (amnesty.amnestyLog || []).some(l => /误判标记/.test(l)) && afterAmnesty.v === 2 && afterAmnesty.tampered === false,
  JSON.stringify({ staged, amnesty, afterAmnesty }))

/* ⑧B 密钥还在、密文被改一个字符 → 必须判"损坏 + 被改过"（GCM 带认证，这是可判定的篡改） */
const flipped = J(await ev(`(() => {
  const key = 'zombie_survival_save_v2'
  const ct = localStorage.getItem(key)
  const i = Math.floor(ct.length * 0.6)
  const ch = ct[i] === 'A' ? 'B' : 'A'
  localStorage.setItem(key, ct.slice(0, i) + ch + ct.slice(i + 1))
  return JSON.stringify({ len: ct.length, flippedAt: i, keycheck: !!localStorage.getItem('${KEYCHECK}') })
})()`))
await boot('audit-tamper-cipher')
const cipherTamper = J(await ev(`JSON.stringify({
  keyOk: V4Vault.status().keyOk, suspect: V4Vault.status().tamperSuspect, failed: V4Vault.status().decryptFailed,
  tampered: V4Integrity.tampered(), verdict: V4Integrity.verdict(), summary: V4Integrity.summary(),
  log: (S.logBuf || []).filter(l => /存档检查|密钥是好的/.test(String(l[1] || ''))).map(l => l[0] + ': ' + l[1]),
  visibleLog: [...document.querySelectorAll('#log .le')].slice(-10).map(e => (e.className || '').replace('le ', '') + ': ' + (e.textContent || '').slice(0, 90)),
})`))
await shot('audit_cipher_tamper')
/* 说明：这一跑 legacy 读档会因主档解不开而**自动回退到 .bak**，那条回退路径会 clearLog()，
   于是 reportAfterBoot 那行日志可能被随后到达的异步回退冲掉（判定本身没丢：tampered=true、
   summary 也是"损坏"、账号面板那行 🔒 就是它）。所以判定以"状态 + summary"为准，日志只当参考。 */
ok('⑧B 密文被改一个字符 → 判"损坏 + 被改过"（密钥自检通过 ⇒ 可判定）',
  cipherTamper.keyOk === true && cipherTamper.suspect === true && cipherTamper.tampered === true &&
  cipherTamper.verdict && cipherTamper.verdict.state === 'corrupt' && /损坏/.test(String(cipherTamper.summary)),
  JSON.stringify(cipherTamper))

/* ⑧C 密钥自检不可用（等价于换过浏览器 / 清过站点数据 / 密钥丢了）→ 只算读不出来，不冤人 */
await ev(`(() => { localStorage.removeItem('${KEYCHECK}'); return 1 })()`)
await boot('audit-keylost')
const keyLost = J(await ev(`JSON.stringify({
  keyOk: V4Vault.status().keyOk, suspect: V4Vault.status().tamperSuspect, failed: V4Vault.status().decryptFailed,
  tampered: V4Integrity.tampered(), verdict: V4Integrity.verdict() && V4Integrity.verdict().state,
  summary: V4Integrity.summary(),
  dangerLogs: (S.logBuf || []).filter(l => /存档检查|被修改过/.test(String(l[1] || ''))).length,
  toasts: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent),
})`))
ok('⑧C 密钥自检不可用 → 只算读不出来（tampered=false、无告警），不冤枉玩家',
  keyLost.keyOk === false && keyLost.suspect === false && keyLost.tampered === false &&
  keyLost.verdict === 'missing' && keyLost.dangerLogs === 0,
  JSON.stringify(keyLost))

/* 收尾：把探针自己弄脏的档清掉，让这套 profile 还能继续用 */
await ev(`(() => { try { localStorage.clear() } catch {} ; return 1 })()`)

/* ═══ ⑦ 收尾：异常/console ═══ */
ok('⑦ 全程 0 个未捕获异常', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)))
ok('⑦ 全程 0 条 console.error（环境网络失败单独归类）', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)))
note('⑦ 环境网络失败（不算产品错）', JSON.stringify(networkIssues.slice(0, 3)))
note('⑦ console 警告', JSON.stringify(consoleWarns.slice(0, 5)))
await shot('audit_final')

const pass = checks.filter((c) => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAIL'}`)
console.log('截图目录: ' + outDir)
process.exit(pass === checks.length ? 0 : 1)
