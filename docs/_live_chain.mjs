// 线上全链路验证：在真实浏览器里、从允许的 Origin（bobbychina.github.io）打真 Worker
// 覆盖：注册 → 推存档 → 并发冲突 409 → 换设备登录拉存档 → 未授权 401 → 退登失效 → 删号清空
const [, , cdpPort] = process.argv
const API = 'https://dsh-oauth-relay.bobby-minecraft.workers.dev'
const PAGE = 'https://bobbychina.github.io/games/'
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
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')

// 切到允许的 Origin（Worker 的 CORS 白名单里只有它和自己的本地端口）
await send('Page.navigate', { url: PAGE })
for (let i = 0; i < 40; i++) {
  const u = await evaluate('location.href')
  if (u && u.includes('bobbychina.github.io')) break
  await sleep(500)
}
await sleep(1500)
const origin = await evaluate('location.origin')
console.log('页面 Origin = ' + origin)

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

// 在页面里跑完整链路（页面上下文 = 真实 Origin + 真实 fetch 栈）
const script = `(async () => {
  const API = ${JSON.stringify(API)};
  const log = [];
  const j = async (path, opt = {}) => {
    const r = await fetch(API + path, Object.assign({ headers: Object.assign({ 'content-type': 'application/json' }, opt.headers || {}) }, opt));
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const name = 'cdp' + Date.now().toString(36);
  const rhex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const verifier = rhex(32);   // Worker 要求 64 位 hex（PBKDF2 派生值）
  const salt = rhex(16);       // 32 位 hex

  // 1 注册（pepper 换成 custom 后老账号全废，所以每次都用全新用户名）
  const reg = await j('/api/register', { method: 'POST', body: JSON.stringify({ name, salt, verifier }) });
  log.push(['register', reg.status, reg.body && reg.body.uid ? 'uid=' + reg.body.uid.slice(0, 6) + '…' : JSON.stringify(reg.body).slice(0, 80)]);
  const tokenA = reg.body && reg.body.token;

  // 2 重名注册必须 409
  const dup = await j('/api/register', { method: 'POST', body: JSON.stringify({ name, salt, verifier }) });
  log.push(['register_dup', dup.status, dup.body && dup.body.error]);

  // 3 推一份存档（带 digest）
  const data = { seed: 12345, day: 7, hp: 88, bag: ['axe', 'water', 'seed'] };
  const push = await j('/api/save', { method: 'PUT', headers: { authorization: 'Bearer ' + tokenA }, body: JSON.stringify({ game: 'zombie-survival', slot: 'auto', data, digest: 'sha256:test-abc', enc: false }) });
  log.push(['push', push.status, push.body && push.body.updatedAt]);
  const updatedAt = push.body && push.body.updatedAt;

  // 4 用过期时间戳再推 → 必须 409（乐观并发）
  const stale = await j('/api/save', { method: 'PUT', headers: { authorization: 'Bearer ' + tokenA }, body: JSON.stringify({ game: 'zombie-survival', slot: 'auto', data: { hack: true }, expectUpdatedAt: '2000-01-01T00:00:00.000Z' }) });
  log.push(['conflict_409', stale.status, stale.body && stale.body.error]);

  // 5 换设备：重新登录拿新 token
  const login = await j('/api/login', { method: 'POST', body: JSON.stringify({ name, verifier }) });
  log.push(['login_deviceB', login.status, login.body && login.body.token ? 'token ok' : JSON.stringify(login.body).slice(0, 80)]);
  const tokenB = login.body && login.body.token;

  // 6 错误口令必须 401
  const bad = await j('/api/login', { method: 'POST', body: JSON.stringify({ name, verifier: rhex(32) }) });
  log.push(['login_wrong_pw', bad.status, bad.body && bad.body.error]);

  // 7 设备 B 拉存档 + 校验内容一致
  const pull = await j('/api/save?game=zombie-survival&slot=auto', { headers: { authorization: 'Bearer ' + tokenB } });
  const same = pull.body && JSON.stringify(pull.body.data) === JSON.stringify(data);
  log.push(['pull_deviceB', pull.status, 'digest=' + (pull.body && pull.body.digest) + ' 内容一致=' + same + ' bytes=' + (pull.body && pull.body.bytes)]);

  // 8 索引里能看到这份存档
  const idx = await j('/api/saves?game=zombie-survival', { headers: { authorization: 'Bearer ' + tokenB } });
  log.push(['saves_index', idx.status, 'slots=' + (idx.body && idx.body.slots ? idx.body.slots.length : '?')]);

  // 9 无 token 必须 401
  const noauth = await j('/api/saves');
  log.push(['no_token_401', noauth.status, noauth.body && noauth.body.error]);

  // 10 退登后旧 token 立即失效
  const lo = await j('/api/logout', { method: 'POST', headers: { authorization: 'Bearer ' + tokenB } });
  const after = await j('/api/me', { headers: { authorization: 'Bearer ' + tokenB } });
  log.push(['logout', lo.status, '退登后 /api/me = ' + after.status]);

  // 11 删号（confirm 必须原样传用户名），删完 old token 也失效、存档没了
  const del = await j('/api/deleteAccount', { method: 'POST', headers: { authorization: 'Bearer ' + tokenA }, body: JSON.stringify({ confirm: name }) });
  const meA = await j('/api/me', { headers: { authorization: 'Bearer ' + tokenA } });
  const gone = await j('/api/login', { method: 'POST', body: JSON.stringify({ name, verifier }) });
  log.push(['deleteAccount', del.status, '删后 me=' + meA.status + ' 再登录=' + gone.status]);

  return { log, name };
})()`

let res
try { res = await evaluate(script) } catch (e) { console.log('FAIL 脚本执行异常: ' + e.message); process.exit(2) }
if (!res || !res.log) { console.log('FAIL 没有拿到结果: ' + JSON.stringify(res)); process.exit(2) }

const L = Object.fromEntries(res.log.map((r) => [r[0], r]))
const S = (k) => (L[k] ? L[k][1] : 0)
ok('注册成功 201', S('register') === 201, 'HTTP ' + S('register'))
ok('重名注册被拒 409', S('register_dup') === 409, 'HTTP ' + S('register_dup'))
ok('推存档 200', S('push') === 200, 'HTTP ' + S('push'))
ok('乐观并发冲突 409', S('conflict_409') === 409, 'HTTP ' + S('conflict_409'))
ok('换设备登录 200', S('login_deviceB') === 200, 'HTTP ' + S('login_deviceB'))
ok('错误口令 401', S('login_wrong_pw') === 401, 'HTTP ' + S('login_wrong_pw'))
ok('设备B 拉到同一份存档且内容一致', S('pull_deviceB') === 200 && /内容一致=true/.test(L.pull_deviceB[2]), L.pull_deviceB[2])
ok('存档索引里有 1 个槽位', S('saves_index') === 200 && /slots=1/.test(L.saves_index[2]), L.saves_index[2])
ok('无 token 被拒 401', S('no_token_401') === 401, 'HTTP ' + S('no_token_401'))
ok('退登成功且旧 token 立即失效', S('logout') === 200 && /me = 401/.test(L.logout[2]), L.logout[2])
ok('删号成功且账号清空', S('deleteAccount') === 200 && /再登录=401/.test(L.deleteAccount[2]), L.deleteAccount[2])

console.log('\n明细:')
for (const r of res.log) console.log('  ' + r[0].padEnd(16) + ' HTTP ' + String(r[1]).padEnd(4) + ' ' + (r[2] ?? ''))
console.log('\n测试账号: ' + res.name + '（已删号）')
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
