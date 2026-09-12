// 本地端到端：注册（拿恢复码）→ 加密上传 → 忘记密码用恢复码找回 → 云存档仍能解开
// 走真实浏览器 + 本地 Worker（tools/dev-api-server.mjs，内存 KV）
const [, , cdpPort, pageUrl] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let target = null
for (let i = 0; i < 60 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    target = list.find((t) => t.type === 'page')
  } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 找不到浏览器 target'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const myId = ++id; pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
// 把 apiBase 指向本地 Worker（等价于站点里注入的 /games/auth-config.js）
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.DSH_AUTH_CONFIG = { api: 'http://127.0.0.1:5199' };` })
await send('Page.navigate', { url: pageUrl })
for (let i = 0; i < 60; i++) { if (await ev('!!(window.V4Account && window.V4)')) break; await sleep(500) }
await sleep(1200)

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
const NAME = 'rc' + Date.now().toString(36)
const PWD1 = 'first-pass-123', PWD2 = 'second-pass-456'

ok('页面加载出账号模块', await ev('!!(window.V4Account && window.V4 && window.DSHAccount)'))
ok('apiBase 指向本地 Worker', (await ev('String(DSHAccount.serverInfo().base)')) === 'http://127.0.0.1:5199')

// 1) 注册 → 恢复码弹窗
await ev('V4Account.open()'); await sleep(300)
await ev(`(() => { document.querySelector('#acc-name').value = ${JSON.stringify(NAME)}; document.querySelector('#acc-pass').value = ${JSON.stringify(PWD1)} })()`)
await ev('V4Account.doRegister()')
await sleep(1200)
const code = await ev(`(document.querySelector('#acc-rc-code') || {}).textContent || ''`)
ok('注册后弹出恢复码（8 组 4 位）', /^([A-Z0-9]{4}-){7}[A-Z0-9]{4}$/.test(code), code)
ok('恢复码弹窗有"复制"与"我抄好了"', await ev(`!!document.querySelector('.modal') && document.body.innerHTML.includes('我抄好了')`))

// 2) 密钥是"解开的"（DEK 已缓存）→ 走玩家真实路径：V4Account.push() 上传一份加密存档
ok('上传前加密已解锁', (await ev('JSON.stringify(DSHAccount.cryptoInfo ? {locked: DSHAccount.cryptoInfo().locked} : {})')).includes('"locked":false'))
const pushed = await ev(`(async () => {
  V4Account.push();                                  // 点面板上那个「⬆️ 上传存档」按钮走的就是它
  await new Promise(r => setTimeout(r, 3000));
  return JSON.stringify({ local: DSHAccount.saveInfo('zombie-survival', 'main') || null });
})()`)
ok('本机槽位已写入（上传前置）', /"updatedAt"/.test(pushed), String(pushed).slice(0, 120))

// 3) 云端那份必须是密文（页面里直接读服务端）
const env = await ev(`(async () => {
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const r = await fetch('http://127.0.0.1:5199/api/save?game=zombie-survival&slot=main', { headers: { authorization: 'Bearer ' + t } });
  const j = await r.json();
  return JSON.stringify({ e: j.data && j.data.e, hasCt: !!(j.data && j.data.ct), enc: j.enc, plainLeak: JSON.stringify(j.data).includes('player') });
})()`)
ok('云端存的是信封密文（无明文残留）', /"e":1/.test(env) && /"hasCt":true/.test(env) && /"plainLeak":false/.test(env), env)

// 4) 额度：默认 10 次/天
const q1 = await ev('DSHAccount.quota().then(q => JSON.stringify(q))')
ok('今日额度 1/10（上传一次后）', /"used":1/.test(q1) && /"limit":10/.test(q1), q1)

// 5) 退出登录 → 忘记密码 → 用恢复码找回
await ev('V4Account.logout()'); await sleep(400)
ok('退出后加密回到锁定态', (await ev('String(DSHAccount.cryptoInfo().locked)')) === 'true')
await ev('V4Account.showRecover()'); await sleep(300)
await ev(`(() => {
  document.querySelector('#acc-rc-name').value = ${JSON.stringify(NAME)};
  document.querySelector('#acc-rc-code2').value = ${JSON.stringify(code.toLowerCase().replace(/-/g, ' '))};
  document.querySelector('#acc-rc-pass').value = ${JSON.stringify(PWD2)};
})()`)
await ev('V4Account.doRecover()')
await sleep(4000)                                    // PBKDF2 两轮（恢复码 + 新口令）在本机跑
const afterRecover = await ev('JSON.stringify({ user: (DSHAccount.current() || {}).name || "", locked: DSHAccount.cryptoInfo().locked })')
ok('用恢复码找回并自动登录', /"user":"rc/.test(afterRecover), afterRecover)
ok('找回后加密密钥也回来了（不用再输口令）', /"locked":false/.test(afterRecover))

// 6) 关键：旧口令失效、新口令可用
const oldLogin = await ev(`DSHAccount.login({ name: ${JSON.stringify(NAME)}, password: ${JSON.stringify(PWD1)} }).then(r => JSON.stringify({ ok: r.ok, err: r.err }))`)
ok('旧密码登不上（已被轮换）', /"ok":false/.test(oldLogin), oldLogin)

// 7) 关键：云端那份存档还能解开（DEK 没变 → 数据没丢）
const pull = await ev(`(async () => {
  V4Account.pull();
  await new Promise(r => setTimeout(r, 2500));
  return JSON.stringify({ local: DSHAccount.saveInfo('zombie-survival', 'main') || null, locked: DSHAccount.cryptoInfo().locked, tampered: V4Integrity ? V4Integrity.tampered() : null });
})()`)
ok('找回后能把云端存档拉回来并解开（DEK 没变 → 数据没丢）', /"updatedAt"/.test(pull) && /"locked":false/.test(pull) && /"tampered":false/.test(pull), String(pull).slice(0, 160))

// 8) 新口令 + 同一恢复码仍可用（恢复码没被消耗）
await ev('V4Account.logout()'); await sleep(300)
const newLogin = await ev(`DSHAccount.login({ name: ${JSON.stringify(NAME)}, password: ${JSON.stringify(PWD2)} }).then(r => JSON.stringify({ ok: r.ok }))`)
ok('新密码可以正常登录', /"ok":true/.test(newLogin), newLogin)

// 9) 配额真的会挡住第 11 次（直接打接口，快）
const quota11 = await ev(`(async () => {
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + t };
  const out = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch('http://127.0.0.1:5199/api/save', { method: 'PUT', headers: H, body: JSON.stringify({ game: 'zombie-survival', slot: 'q' + i, data: { i } }) });
    const j = await r.json();
    out.push(r.status + (j.error ? ':' + j.error : ''));
    if (r.status === 429) break;
  }
  return JSON.stringify(out);
})()`)
ok('第 11 次上传被 429 quota_exceeded 挡住', /429:quota_exceeded/.test(quota11), quota11)
const qMsg = await ev(`(async () => {
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const r = await fetch('http://127.0.0.1:5199/api/save', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ game: 'g', slot: 's', data: {} }) });
  const j = await r.json(); return j.message || '';
})()`)
ok('429 文案是给人看的（说清几点恢复）', /今天的云存档上传次数用完了/.test(qMsg) && /小时/.test(qMsg), qMsg)

console.log('\n测试账号: ' + NAME + ' / 恢复码 ' + code + '（本地内存 KV，重启即消失）')
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
