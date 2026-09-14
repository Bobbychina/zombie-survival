// M22 验收：云存档只有一个入口——「贴令牌码」（OAuth 一键授权 / 设备码 / 诊断 已删）
// 用法：node docs/_m22_account_token_probe.mjs <cdpPort> <url> <outDir>
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

await waitFor(`typeof DEV !== 'undefined'`)
await ev(`['zombie_survival_save_v2','dsh_account_db_v1','dsh_gh_token'].forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); 1`)
await goto()
ok('DEV 钩子可用', (await ev(`typeof DEV !== 'undefined' && typeof V4Account === 'object'`)) === true)
ok('旧的三个入口已从 V4Account 上摘掉', (await ev(`(() => {
  const bad = ['bindGitHub','bindGitHubConfirm','bindGitHubDevice','diagnose'].filter(k => typeof V4Account[k] === 'function');
  return bad.length === 0;
})()`)) === true)
ok('新入口 openTokenBind 在', (await ev(`typeof V4Account.openTokenBind === 'function'`)) === true)

/* 注册一个本机账号（云存档面板只在登录后出现） */
await ev(`(() => { V4Account.open(); return 1; })()`); await sleep(500)
await ev(`(async () => {
  document.getElementById('acc-name').value = 'probe_user';
  document.getElementById('acc-pass').value = 'probe-pass-12345';
  await V4Account.doRegister();
  closeAllModals(); V4Account.open();
  return 'done';
})()`)
await sleep(700)
const summ = String(await ev(`String(V4Account.summary())`))
ok('本机账号注册成功（面板进入已登录态）', /probe_user/.test(summ), summ.slice(0, 70))

/* ── 面板：只留"贴令牌码" ── */
const panel = JSON.parse(await ev(`(() => {
  const last = [...document.querySelectorAll('.overlay')].pop();
  const t = last ? last.textContent : '';
  const btns = last ? [...last.querySelectorAll('button')].map(b => (b.textContent||'').trim()) : [];
  return JSON.stringify({ hasToken: /贴令牌码开启云存档/.test(t), hasBind: /绑定 GitHub 账号/.test(t),
    hasDevice: /设备码/.test(t), hasDiag: /诊断/.test(t), hasOauth: /一键授权|继续授权|Authorize/.test(t),
    hasGistWord: /私有 Gist/.test(t), btns,
    inlineOnclick: [...document.querySelectorAll('[onclick]')].map(e => e.getAttribute('onclick')).filter(s => /bindGitHub|diagnose/.test(s)) });
})()`))
ok('面板有「贴令牌码开启云存档」', panel.hasToken === true)
ok('面板没有「绑定 GitHub 账号」', panel.hasBind === false)
ok('面板/页面里没有设备码/诊断/授权残留', panel.hasDevice === false && panel.hasDiag === false && panel.hasOauth === false,
  JSON.stringify({ device: panel.hasDevice, diag: panel.hasDiag, oauth: panel.hasOauth }))
ok('页面里没有指向已删函数的 onclick', panel.inlineOnclick.length === 0, JSON.stringify(panel.inlineOnclick))
await shot('01_account_panel')

/* ── 令牌弹窗（L.modal 会叠加：取最后一个 overlay） ── */
await ev(`V4Account.openTokenBind()`); await sleep(500)
const modal = JSON.parse(await ev(`(() => {
  const last = [...document.querySelectorAll('.overlay')].pop();
  const t = last ? last.textContent : '';
  const btn = last ? [...last.querySelectorAll('.modal-ft button')].map(b => (b.textContent||'').trim()) : [];
  const link = last ? [...last.querySelectorAll('.modal-bd button')].map(b => b.getAttribute('onclick') || '').join(' ') : '';
  return JSON.stringify({ title: last && last.querySelector('.modal-hd h2') ? last.querySelector('.modal-hd h2').textContent : '',
    input: !!document.getElementById('acc-gh-token'), foot: btn,
    scopeNote: /gist/.test(t), warn: /不想给令牌/.test(t), steps: /Generate token/.test(t),
    tokenPage: /settings\\/tokens\\/new\\?scopes=gist/.test(link) });
})()`))
ok('弹窗标题＝贴令牌码，开启云存档', /贴令牌码/.test(modal.title), modal.title)
ok('弹窗有令牌输入框 + 「保存并启用」', modal.input === true && modal.foot.some(x => /保存并启用/.test(x)), JSON.stringify(modal.foot))
ok('弹窗里没有设备码按钮', !modal.foot.some(x => /设备码/.test(x)))
ok('权限披露还在（gist 全量授权 + 不想给令牌的退路）', modal.scopeNote && modal.warn, JSON.stringify({ scopeNote: modal.scopeNote, warn: modal.warn }))
ok('令牌页链接带 gist 权限', modal.tokenPage === true)
/* 弹窗必须一屏装得下：底部「保存并启用」不许被挤出屏幕（用户对溢出零容忍） */
const fit = JSON.parse(await ev(`(() => {
  const last = [...document.querySelectorAll('.overlay')].pop();
  const mo = last ? last.querySelector('.modal') : null;
  const ft = last ? last.querySelector('.modal-ft') : null;
  if (!mo || !ft) return JSON.stringify({ missing: true });
  const mb = mo.getBoundingClientRect(), fb = ft.getBoundingClientRect();
  return JSON.stringify({ modalH: Math.round(mb.height), viewH: window.innerHeight, top: Math.round(mb.top),
    footBottom: Math.round(fb.bottom), footVisible: fb.bottom <= window.innerHeight + 1 && fb.top >= -1,
    bodyScrolls: (last.querySelector('.modal-bd') || {}).scrollHeight > (last.querySelector('.modal-bd') || {}).clientHeight });
})()`))
ok('令牌弹窗一屏装得下（底部按钮没被挤出屏幕）', fit.footVisible === true, JSON.stringify(fit))
await shot('02_token_modal')

/* ── 粘贴校验：格式不对要立刻报错（不发网络请求） ── */
const bad = await ev(`(async () => {
  document.getElementById('acc-gh-token').value = 'hello';
  await V4Account.bindGitHubToken();
  return (document.getElementById('acc-msg') || {}).textContent || '';
})()`)
ok('乱填的令牌被当场拒绝', /不像 GitHub 令牌/.test(String(bad)), String(bad).slice(0, 60))

/* ── 形状正确但无效的令牌：应当走到网络校验并给出可读错误（本地无网/被拒都算通路可用） ── */
const fake = await ev(`(async () => {
  document.getElementById('acc-gh-token').value = 'ghp_${'A'.repeat(36)}';
  await V4Account.bindGitHubToken();
  return (document.getElementById('acc-msg') || {}).textContent || '';
})()`)
const fakeTxt = String(fake)
ok('无效令牌给出可读错误（不是静默失败）', /令牌无效|缺少权限|校验令牌失败|Failed|fetch|网络/.test(fakeTxt), fakeTxt.slice(0, 80))
await shot('03_token_error')

ok('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '))
const pass = checks.filter(c => c[1]).length
console.log(`\n结果：${pass}/${checks.length} 通过`)
console.log(JSON.stringify(checks.map(([n, c]) => (c ? '✓' : '✗') + n)))
process.exit(pass === checks.length ? 0 : 1)
