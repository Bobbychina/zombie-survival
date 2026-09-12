// 线上验证（真浏览器 + 真 Worker）：每日配额 / 恢复码找回 / GH_CLIENT_SECRET 是否真的能用
// 用法: node docs/_live_m9.mjs <cdp端口> [client_id]
const [, , cdpPort, clientIdArg] = process.argv
const API = 'https://dsh-oauth-relay.bobby-minecraft.workers.dev'
const PAGE = 'https://bobbychina.github.io/games/'
const CLIENT_ID = clientIdArg || 'Ov23liPzQ7xNDx0FdUdh'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 找不到浏览器 target'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 180000 })
  if (r.result?.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || '').split('\n')[0])
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Page.navigate', { url: PAGE })
for (let i = 0; i < 40; i++) { if ((await ev('location.href'))?.includes('bobbychina.github.io')) break; await sleep(500) }
await sleep(1200)
console.log('页面 Origin = ' + await ev('location.origin') + '\n')

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

const script = `(async () => {
  const API = ${JSON.stringify(API)};
  const CLIENT_ID = ${JSON.stringify(CLIENT_ID)};
  const log = [];
  const enc = new TextEncoder();
  const b64u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const raw = atob(s); const o = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) o[i] = raw.charCodeAt(i); return o; };
  const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const rhex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
  const pbkdf2 = async (secret, saltStr) => {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(saltStr), iterations: 210000, hash: 'SHA-256' }, base, 256));
  };
  const kek = (secret, purpose, name, salt) => pbkdf2(secret, purpose + name.toLowerCase() + ':' + salt);
  const wrap = async (k, dek) => {
    const key = await crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return 'v1.' + b64u(iv) + '.' + b64u(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, dek));
  };
  const unwrap = async (k, s) => {
    try {
      const p = String(s).split('.');
      const key = await crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['decrypt']);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(p[1]) }, key, unb64u(p[2])));
    } catch (e) { return null; }
  };
  const A = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
  const newCode = () => { const b = crypto.getRandomValues(new Uint8Array(20)); let bits = 0, val = 0, o = ''; for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5) { o += A[(val >>> (bits - 5)) & 31]; bits -= 5 } } if (bits) o += A[(val << (5 - bits)) & 31]; return o.replace(/(.{4})(?=.)/g, '$1-'); };
  const j = async (path, opt = {}) => {
    const r = await fetch(API + path, Object.assign({ headers: Object.assign({ 'content-type': 'application/json' }, opt.headers || {}) }, opt));
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };

  const name = 'm9' + Date.now().toString(36);
  const pw1 = 'live-pass-one-1', pw2 = 'live-pass-two-2';
  const salt = rhex(16), rcSalt = rhex(16), rcCode = newCode();
  const verifier = hex(await pbkdf2(pw1, salt));
  const rcVerifier = hex(await pbkdf2(rcCode.replace(/-/g, ''), 'dsh-rcv-v1:' + name.toLowerCase()));
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const wrapPw = await wrap(await kek(pw1, 'dsh-kek-v1:', name, salt), dek);
  const wrapRc = await wrap(await kek(rcCode.replace(/-/g, ''), 'dsh-rek-v1:', name, rcSalt), dek);

  // 1) 带恢复码注册
  const reg = await j('/api/register', { method: 'POST', body: JSON.stringify({ name, salt, verifier, rcSalt, rcVerifier, wrap: { pw: wrapPw, rc: wrapRc } }) });
  log.push(['register', reg.status, 'hasRecovery=' + (reg.body && reg.body.hasRecovery) + ' wrap.rc=' + ((reg.body && reg.body.wrap && reg.body.wrap.rc) === wrapRc)]);
  const token = reg.body && reg.body.token;

  // 2) 推送一份端到端加密的存档
  const data = { e: 1, alg: 'A256GCM', iv: 'x', ct: 'y', day: 3 };
  const push = await j('/api/save', { method: 'PUT', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ game: 'zombie-survival', slot: 'auto', data, enc: true }) });
  log.push(['push', push.status, JSON.stringify(push.body && push.body.quota)]);

  // 3) 配额：一路推到被拒（上限 10）
  const seq = [];
  for (let i = 0; i < 12; i++) {
    const r = await j('/api/save', { method: 'PUT', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ game: 'quota-test', slot: 's' + i, data: { i } }) });
    seq.push(r.status + (r.body && r.body.error ? ':' + r.body.error : ''));
    if (r.status === 429) break;
  }
  log.push(['quota', seq.includes('429:quota_exceeded') ? 429 : 0, seq.join(' ')]);
  const q = await j('/api/quota', { headers: { authorization: 'Bearer ' + token } });
  log.push(['quota_get', q.status, JSON.stringify(q.body)]);

  // 4) 恢复码找回：begin → 用恢复码解开 DEK → commit 换口令
  const begin = await j('/api/recover/begin', { method: 'POST', body: JSON.stringify({ name, rcVerifier }) });
  const dek2 = begin.body ? await unwrap(await kek(rcCode.replace(/-/g, ''), 'dsh-rek-v1:', name, begin.body.rcSalt), begin.body.wrap && begin.body.wrap.rc) : null;
  const sameDek = !!dek2 && hex(dek2) === hex(dek);
  const salt2 = rhex(16);
  const verifier2 = hex(await pbkdf2(pw2, salt2));
  const wrapPw2 = dek2 ? await wrap(await kek(pw2, 'dsh-kek-v1:', name, salt2), dek2) : null;
  const commit = await j('/api/recover/commit', { method: 'POST', body: JSON.stringify({ name, rcVerifier, verifier: verifier2, salt: salt2, wrap: { pw: wrapPw2 } }) });
  log.push(['recover', commit.status, 'DEK 一致=' + sameDek + ' 拿到会话=' + !!(commit.body && commit.body.token)]);
  const oldPw = await j('/api/login', { method: 'POST', body: JSON.stringify({ name, verifier }) });
  const newPw = await j('/api/login', { method: 'POST', body: JSON.stringify({ name, verifier: verifier2 }) });
  log.push(['pw_rotate', oldPw.status + '/' + newPw.status, '旧口令=' + oldPw.status + ' 新口令=' + newPw.status]);
  // 恢复码换口令后还能再用（同一个 DEK 还在）
  const again = await j('/api/recover/begin', { method: 'POST', body: JSON.stringify({ name, rcVerifier }) });
  log.push(['rc_reusable', again.status, 'wrap.rc 相同=' + ((again.body && again.body.wrap && again.body.wrap.rc) === wrapRc)]);

  // 5) 云端那份存档还在（找到 push 进的那份）
  const get = await j('/api/save?game=zombie-survival&slot=auto', { headers: { authorization: 'Bearer ' + token } });
  log.push(['save_alive', get.status, '内容一致=' + (get.body && JSON.stringify(get.body.data) === JSON.stringify(data))]);

  // 6) GH_CLIENT_SECRET 是否真的能用：用一个假 code 去换 token，看 GitHub 报什么错
  //    密钥对 → bad_verification_code（code 本身无效）；密钥错 → incorrect_client_credentials
  const bind = await j('/api/gh/bind', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ code: 'definitely-not-a-real-code', client_id: CLIENT_ID }) });
  log.push(['gh_secret', bind.status, JSON.stringify(bind.body).slice(0, 200)]);

  // 7) 收尾：删号（顺带验证配额键也被清掉）
  const del = await j('/api/deleteAccount', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ confirm: name }) });
  log.push(['delete', del.status, '']);

  return { log, name, rcCode };
})()`

let res
try { res = await ev(script) } catch (e) { console.log('FAIL 脚本异常: ' + e.message); process.exit(2) }
const L = Object.fromEntries(res.log.map((r) => [r[0], r]))
const S = (k) => (L[k] ? L[k][1] : 0)

ok('带恢复码注册成功（wrap 原样存回）', S('register') === 201 && /hasRecovery=true/.test(L.register[2]) && /wrap.rc=true/.test(L.register[2]), L.register[2])
ok('加密存档推送成功，响应带回额度', S('push') === 200 && /"limit":10/.test(L.push[2]), L.push[2])
ok('第 11 次上传 → 429 quota_exceeded', S('quota') === 429, L.quota[2])
ok('/api/quota 能查到已用 10 / 上限 10', S('quota_get') === 200 && /"used":10/.test(L.quota_get[2]) && /"limit":10/.test(L.quota_get[2]), L.quota_get[2])
ok('恢复码能解开同一把存档密钥（DEK 一致）', /DEK 一致=true/.test(L.recover[2]) && S('recover') === 200, L.recover[2])
ok('改用新口令后旧口令失效、新口令可用', /旧口令=401 新口令=200/.test(L.pw_rotate[2]), L.pw_rotate[2])
ok('恢复码换口令后仍可复用（wrap.rc 没变）', S('rc_reusable') === 200 && /wrap.rc 相同=true/.test(L.rc_reusable[2]), L.rc_reusable[2])
ok('换口令后云端密文原样都在（内容一致）', S('save_alive') === 200 && /内容一致=true/.test(L.save_alive[2]), L.save_alive[2])
const ghOk = /bad_verification_code/.test(L.gh_secret[2]) || /code passed is incorrect or expired/.test(L.gh_secret[2])
ok('GH_CLIENT_SECRET 有效（GitHub 只否定了 code，没有否定客户端凭据）', ghOk, L.gh_secret[2])
ok('删号清理成功', S('delete') === 200, 'HTTP ' + S('delete'))

console.log('\n明细:')
for (const r of res.log) console.log('  ' + r[0].padEnd(14) + ' ' + String(r[1]).padEnd(8) + (r[2] ?? ''))
console.log('\n测试账号: ' + res.name + ' / 恢复码 ' + res.rcCode + '（已删号）')
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
