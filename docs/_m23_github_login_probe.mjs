// M23 验收：① 账号 = GitHub（设备码 / 令牌码两条登录路）② UI 上**没有注册** ③ 老账号（带密码）仍能登录
// 用法：node docs/_m23_github_login_probe.mjs <cdpPort> <url> <outDir> [live]
const [, , cdpPort, url, outDir, liveFlag] = process.argv
const LIVE = !!liveFlag
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
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res)
  ws.send(JSON.stringify({ id: i, method, params }))
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'
await send('Page.navigate', { url: pageUrl })
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await ev(expr)) === true) return true; await sleep(400) } return false }
const goto = async () => { await send('Page.navigate', { url: pageUrl }); return waitFor(`typeof DEV !== 'undefined'`) }
const lastModal = `[...document.querySelectorAll('.overlay')].pop()`

await waitFor(`typeof DEV !== 'undefined'`)
await ev(`['zombie_survival_save_v2','dsh.accounts.v1','dsh.session.v1','dsh.ghtok.v1','dsh.ghtok.keep.v1'].forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); 1`)
await goto()
ok('DEV 钩子可用', (await ev(`typeof DEV !== 'undefined' && typeof V4Account === 'object'`)) === true)

/* ── 1) UI 上没有注册 ── */
ok('V4Account 上没有 doRegister', (await ev(`typeof V4Account.doRegister === 'undefined'`)) === true)
await ev(`V4Account.open()`); await sleep(500)
const out = JSON.parse(await ev(`(() => {
  const last = ${lastModal};
  const t = last ? last.textContent : '';
  const btns = last ? [...last.querySelectorAll('button')].map(b => (b.textContent||'').replace(/\\s+/g,' ').trim()) : [];
  return JSON.stringify({ btns, regBtn: btns.filter(b => /注册/.test(b)), regField: !!document.getElementById('acc-mail'),
    hasDevice: btns.some(b => /设备码登录/.test(b)), hasToken: btns.some(b => /粘贴令牌码/.test(b)),
    hasLegacy: btns.some(b => /旧账号/.test(b)), text: t.replace(/\\s+/g,' ').slice(0, 200) });
})()`))
ok('登录页有「设备码登录」与「粘贴令牌码」两条路', out.hasDevice === true && out.hasToken === true, JSON.stringify(out.btns))
ok('没有任何"注册"按钮或注册输入框（文案里写"不需要注册"是说明，不算入口）', out.regBtn.length === 0 && out.regField === false,
  'regBtn=' + JSON.stringify(out.regBtn) + ' mail=' + out.regField)
ok('老账号入口还在（旧账号（密码））', out.hasLegacy === true)
await shot(LIVE ? '01_login_live' : '01_login_local')

/* ── 2) 老账号登录弹窗：能登录、不能注册 ── */
await ev(`V4Account.legacyLogin()`); await sleep(400)
const leg = JSON.parse(await ev(`(() => {
  const last = ${lastModal}; const t = last ? last.textContent : '';
  const btns = last ? [...last.querySelectorAll('button')].map(b => (b.textContent||'').trim()) : [];
  return JSON.stringify({ name: !!document.getElementById('acc-name'), pass: !!document.getElementById('acc-pass'),
    mail: !!document.getElementById('acc-mail'), btns, regBtn: btns.filter(b => /注册/.test(b)), recover: /恢复码/.test(t) });
})()`))
ok('老账号弹窗：用户名/密码输入 + 登录按钮，且没有注册按钮', leg.name && leg.pass && leg.btns.some(b => /登录/.test(b)) && leg.regBtn.length === 0 && leg.mail === false,
  JSON.stringify(leg.btns))
ok('老账号弹窗里还留着「恢复码找回」', leg.recover === true)
await ev(`closeAllModals()`); await sleep(300)

/* ── 3) 令牌码弹窗（登录态文案） ── */
await ev(`V4Account.openTokenBind()`); await sleep(400)
const tok = JSON.parse(await ev(`(() => {
  const last = ${lastModal}; const t = last ? last.textContent : '';
  const btns = last ? [...last.querySelectorAll('.modal-ft button')].map(b => (b.textContent||'').trim()) : [];
  return JSON.stringify({ title: last && last.querySelector('.modal-hd h2') ? last.querySelector('.modal-hd h2').textContent : '',
    input: !!document.getElementById('acc-gh-token'), btns, warn: /不想给令牌/.test(t), scope: /gist/.test(t) });
})()`))
ok('未登录时令牌弹窗是「用令牌码登录」', /用令牌码登录/.test(tok.title), tok.title)
ok('令牌弹窗：输入框 + 「登录并启用云存档」', tok.input === true && tok.btns.some(b => /登录并启用/.test(b)), JSON.stringify(tok.btns))
ok('权限披露与退路仍在', tok.scope === true && tok.warn === true)
await ev(`closeAllModals()`); await sleep(300)

/* ── 4) 设备码：点一下要能拿到 9 位码（本地无 client_id 时给出可读错误） ── */
await ev(`V4Account.open()`); await sleep(300)
await ev(`V4Account.loginDevice()`)
let dev = { code: '', err: '' }
for (let i = 0; i < 24; i++) {
  await sleep(700)
  const r = JSON.parse(await ev(`(() => {
    const el = document.getElementById('acc-dev-code');
    const msg = document.getElementById('acc-msg');
    return JSON.stringify({ code: el ? el.textContent.trim() : '', err: msg ? msg.textContent.trim() : '' });
  })()`))
  dev = r
  if (r.code || r.err) break
}
ok('设备码通道有响应（出码 或 明确可读的错误）', !!(dev.code || dev.err), 'code=' + dev.code + ' err=' + dev.err.slice(0, 70))
if (LIVE) ok('线上设备码真的出了 9 位码（clientId + 中继都活着）', /^[A-Z0-9-]{6,12}$/.test(dev.code), dev.code)
if (dev.code) await shot(LIVE ? '02_device_code_live' : '02_device_code_local')
await ev(`closeAllModals()`); await sleep(300)

/* ── 5) GitHub 账号的已登录态（注入一条 gh- 账号 + 记住的令牌） ── */
await ev(`(() => {
  const now = new Date().toISOString();
  const uid = 'gh-probe-gh';
  localStorage.setItem('dsh.accounts.v1', JSON.stringify({ v: 1, users: { [uid]: {
    uid, name: 'probe-gh', email: '', createdAt: now, providers: { github: { login: 'probe-gh', name: 'Probe GH', avatar: '', boundAt: now } }, games: {}
  } } }));
  localStorage.setItem('dsh.session.v1', JSON.stringify({ uid, exp: Date.now() + 30 * 86400000 }));
  localStorage.setItem('dsh.ghtok.keep.v1', JSON.stringify({ uid, login: 'probe-gh', token: 'ghp_${'B'.repeat(36)}', at: now }));
  return 1;
})()`)
await goto()
await sleep(800)
const summary = String(await ev(`String(V4Account.summary())`))
ok('注入的 GitHub 账号被认成已登录', /probe-gh/.test(summary), summary.slice(0, 80))
await ev(`V4Account.open()`); await sleep(500)
const panel = JSON.parse(await ev(`(() => {
  const last = ${lastModal}; const t = last ? last.textContent : '';
  const btns = last ? [...last.querySelectorAll('button')].map(b => (b.textContent||'').trim()) : [];
  return JSON.stringify({ btns, githubAccount: /GitHub 账号（没有密码）/.test(t), gist: /GitHub 私有 Gist/.test(t),
    noPassOps: !btns.some(b => /改密码/.test(b)) && !btns.some(b => /恢复码/.test(b)),
    unbind: btns.some(b => /GitHub @probe-gh/.test(b)), saved: /解绑/.test(t) });
})()`))
ok('面板认这是「GitHub 账号（没有密码）」', panel.githubAccount === true)
ok('GitHub 账号不显示改密码/恢复码（那是有密码账号的事）', panel.noPassOps === true, JSON.stringify(panel.btns.slice(0, 8)))
ok('面板给出 GitHub @login ✕ 解绑 + 云盘=私有 Gist', panel.unbind === true && panel.gist === true)
await shot(LIVE ? '03_gh_account_live' : '03_gh_account_local')

/* 退出登录后：登录页要能「用记住的令牌一键进」 */
await ev(`V4Account.logout()`); await sleep(400)
await ev(`V4Account.open()`); await sleep(400)
const back = JSON.parse(await ev(`(() => {
  const last = ${lastModal}; const t = last ? last.textContent : '';
  const btns = last ? [...last.querySelectorAll('button')].map(b => (b.textContent||'').trim()) : [];
  return JSON.stringify({ remembered: btns.some(b => /记住的 GitHub/.test(b)), regBtn: btns.filter(b => /注册/.test(b)) });
})()`))
ok('登出后登录页有「⚡ 用这台设备记住的 GitHub 直接进」', back.remembered === true)
ok('登出后登录页依然没有注册入口', back.regBtn.length === 0, JSON.stringify(back.regBtn))
await shot(LIVE ? '04_relogin_live' : '04_relogin_local')

ok('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '))
const pass = checks.filter(c => c[1]).length
console.log(`\n结果：${pass}/${checks.length} 通过` + (LIVE ? '（线上）' : '（本地）'))
console.log(JSON.stringify(checks.map(([n, c]) => (c ? '✓' : '✗') + n)))
process.exit(pass === checks.length ? 0 : 1)
