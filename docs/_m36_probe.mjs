// M36 取证：作弊码机制已下线（用户：「删除作弊码机制」）
//   ① window.cheat / window.cheatBuf 都不该存在；② 真键盘敲 bobbychina32747 不该有任何反应；
//   ③ 帮助弹窗里"彩蛋：老版本的作弊码仍然有效"这行必须没了（快捷键段还在）；
//   ④ 老档里遗留的 flags.cheat 会被 sanitizeSave 清掉，且不再锁死成就解锁。
// 走真浏览器 + 真键盘事件（CDP Input.dispatchKeyEvent），不走 eval 直调。
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 180))
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
const J = (s) => { try { return JSON.parse(s) } catch { return { raw: String(s).slice(0, 200) } } }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
}
/* 逐字敲键：keyDown 带 text 才会同时触发 keydown 与字符输入 */
const typeText = async (text) => {
  for (const ch of text) {
    const code = 'Key' + ch.toUpperCase()
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) })
    await sleep(25)
  }
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?m36=ready' })
await sleep(6000)
await ev(`(() => { if (typeof closeAllModals === 'function') closeAllModals(); if (typeof setTab === 'function') setTab('explore'); return 1 })()`)
await sleep(1200)

/* ── ① 全局符号：cheat / cheatBuf 都不该再挂出来 ── */
const sym = J(await ev(`JSON.stringify({ cheat: typeof window.cheat, cheatBuf: typeof window.cheatBuf, help: typeof window.openHelp })`))
ok('① window.cheat / window.cheatBuf 均已移除', sym.cheat === 'undefined' && sym.cheatBuf === 'undefined', JSON.stringify(sym))
ok('① 复核：openHelp 这类正常导出没被误删', sym.help === 'function', 'openHelp=' + sym.help)

/* ── ② 真键盘敲老作弊码：状态一个数都不许动 ── */
const before = J(await ev(`JSON.stringify({ hp:S.hp, hpMax:S.hpMax, mat:S.mat, ammo:S.ammo, infect:S.infect, logLen:S.logBuf.length, active:(document.activeElement||{}).tagName })`))
await typeText('bobbychina32747')
await sleep(900)
const after = J(await ev(`JSON.stringify({ hp:S.hp, hpMax:S.hpMax, mat:S.mat, ammo:S.ammo, infect:S.infect, logLen:S.logBuf.length,
  cheatFlag:S.flags.cheat === undefined ? 'absent' : String(S.flags.cheat),
  cheatText:(S.logBuf||[]).filter(l => /作弊|Bobby 模式|权限已激活/.test(l.t||'')).length })`))
const frozen = before.hp === after.hp && before.hpMax === after.hpMax && before.mat === after.mat && before.ammo === after.ammo && before.infect === after.infect
ok('② 敲完 bobbychina32747 资源/血量纹丝不动', frozen, JSON.stringify({ before, after }))
ok('② 日志里没有"作弊模式/权限已激活"', after.cheatText === 0 && after.cheatFlag === 'absent', JSON.stringify({ cheatText: after.cheatText, cheatFlag: after.cheatFlag }))
await shot('a2_after_typing_code')

/* ── ③ 帮助弹窗：彩蛋那行必须没了，快捷键段还在 ── */
const help = J(await ev(`(() => {
  if (typeof closeAllModals === 'function') closeAllModals()
  openHelp()
  const body = document.querySelector('#overlay-root .modal-bd') || document.querySelector('.overlay .modal-bd')
  const txt = body ? body.innerText : ''
  const closeBtn = document.querySelector('#overlay-root .modal-ft .btn, .overlay .modal-ft .btn')
  return JSON.stringify({ hasBody: !!body, len: txt.length,
    cheatLine: /彩蛋|作弊码/.test(txt), hasKeySection: /快捷键/.test(txt) && /战斗/.test(txt),
    kbdCount: (body ? body.querySelectorAll('kbd').length : 0), head: txt.slice(0, 40) })
})()`))
ok('③ 帮助弹窗里不再有"彩蛋/作弊码"文案', help.hasBody && !help.cheatLine, JSON.stringify(help))
ok('③ 快捷键段没被误伤（kbd 还在）', help.hasKeySection && help.kbdCount >= 12, 'kbd=' + help.kbdCount)
await shot('a3_help_modal')

/* ── ④ 老档：flags.cheat 被 sanitizeSave 清掉，且不再锁死成就 ── */
const san = J(await ev(`(() => {
  const out = sanitizeSave({ v: 4, day: 3, hp: 60, hpMax: 100, flags: { cheat: true, gotGun: true } })
  return JSON.stringify({ cheat: out && out.flags ? ('cheat' in out.flags) : 'no-flags', gotGun: !!(out && out.flags && out.flags.gotGun) })
})()`))
ok('④ sanitizeSave 清掉老档 flags.cheat（其它旗标保留）', san.cheat === false && san.gotGun === true, JSON.stringify(san))

const ach = J(await ev(`(() => {
  closeAllModals()
  const id = ACHIEVEMENTS[0].id
  const backup = { ach: S.ach.slice(), cheat: S.flags.cheat }
  S.ach = []; S.flags.cheat = true          // 伪造"作弊模式下的老档"
  award(id)
  const got = S.ach.indexOf(id) >= 0
  S.ach = backup.ach; if (backup.cheat === undefined) delete S.flags.cheat; else S.flags.cheat = backup.cheat
  return JSON.stringify({ id, got, cheatGuardGone: got })
})()`))
ok('④ 成就解锁不再被 flags.cheat 拦（守卫已删）', ach.got === true, JSON.stringify(ach))

ok('⑤ 全程无未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))

const pass = checks.filter((c) => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAIL'}`)
console.log('截图目录: ' + outDir)
process.exit(pass === checks.length ? 0 : 1)
