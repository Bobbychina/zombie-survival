/* 云账号后端（Cloudflare Worker）的端到端测试：不连 Cloudflare，用内存 KV 把 handle() 跑起来。
   覆盖：注册/重名/坏参数、登录/错口令、会话与鉴权、存档增删查改、跨设备同步、限流、
        注销清空、CORS 白名单、以及 GitHub 中继的转发（fetch 打桩）。
   用法：node tools/test-worker.mjs      （退出码 0 = 全绿） */
import { handle } from './cf-worker.js';
import { memoryKV } from './memory-kv.mjs';

const env = { DSH_KV: memoryKV(), DSH_PEPPER: 'test-pepper-please-change', GH_CLIENT_SECRET: 'ghs_fake' };
const ORIGIN = 'https://bobbychina.github.io';
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push('  ✅ ' + name); }
  else { fail++; results.push('  ⛔ ' + name + (extra ? '  → ' + extra : '')); }
}
const req = (method, path, { body, token, origin = ORIGIN } = {}) => new Request('https://api.test' + path, {
  method,
  headers: {
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: 'Bearer ' + token } : {}),
    ...(origin ? { origin } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const j = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } };
/* 客户端派生值：真机上由浏览器 WebCrypto 算，这里直接给固定 64 hex */
const VER = 'a'.repeat(64), VER2 = 'b'.repeat(64), SALT = 'c'.repeat(32);

console.log('\n=== bobbychina 云账号后端 · 端到端测试 ===\n');

/* 1. 健康检查 */
{
  const r = await handle(req('GET', '/api/health'), env);
  const b = await j(r);
  ok('health 200 + kv 已绑定 + pepper 自定义', r.status === 200 && b.kv === true && b.pepper === 'custom', JSON.stringify(b));
  const r2 = await handle(req('GET', '/api/health'), { ...env, DSH_KV: null });
  ok('没绑 KV 时 health 仍可用并如实报告 kv:false', r2.status === 200 && (await j(r2)).kv === false);
}

/* 2. 注册 */
let token1 = '', uid1 = '';
{
  const bad = await handle(req('POST', '/api/register', { body: { name: 'a', verifier: VER, salt: SALT } }), env);
  ok('用户名太短 → 400', bad.status === 400, String(bad.status));
  const badVer = await handle(req('POST', '/api/register', { body: { name: 'tester', verifier: 'xyz', salt: SALT } }), env);
  ok('派生值格式不对 → 400', badVer.status === 400, String(badVer.status));
  const r = await handle(req('POST', '/api/register', { body: { name: 'tester', verifier: VER, salt: SALT, email: 't@example.com' } }), env);
  const b = await j(r);
  token1 = b.token; uid1 = b.uid;
  ok('注册成功 201 + 返回 uid/token', r.status === 201 && !!b.uid && !!b.token, JSON.stringify(b).slice(0, 120));
  ok('服务器不存明文口令（KV 里只有 pepper+verifier 的哈希）', !JSON.stringify(env.DSH_KV._dump()).includes(VER));
  const dup = await handle(req('POST', '/api/register', { body: { name: 'TESTER', verifier: VER2, salt: SALT } }), env);
  ok('重名（大小写不敏感）→ 409', dup.status === 409, String(dup.status));
}

/* 3. 登录 */
{
  const wrong = await handle(req('POST', '/api/login', { body: { name: 'tester', verifier: VER2 } }), env);
  ok('口令错 → 401', wrong.status === 401, String(wrong.status));
  const ghost = await handle(req('POST', '/api/login', { body: { name: 'nobody', verifier: VER } }), env);
  ok('用户不存在 → 401（与口令错同样话术）', ghost.status === 401);
  const r = await handle(req('POST', '/api/login', { body: { name: 'tester', verifier: VER } }), env);
  const b = await j(r);
  ok('登录成功 + 新 token', r.status === 200 && !!b.token && b.uid === uid1);
}

/* 4. 会话与鉴权 */
{
  const noTok = await handle(req('GET', '/api/me'), env);
  ok('无 token → 401', noTok.status === 401);
  const badTok = await handle(req('GET', '/api/me', { token: 'deadbeef' }), env);
  ok('伪造 token → 401', badTok.status === 401);
  const me = await j(await handle(req('GET', '/api/me', { token: token1 }), env));
  ok('/api/me 返回账号信息', me.name === 'tester' && me.uid === uid1, JSON.stringify(me).slice(0, 120));
}

/* 5. 存档：写 → 读 → 列表 → 跨设备 → 删 */
{
  const save = { day: 12, hp: 88, mat: 41, inv: { wood: 9 }, __integrity: { d: 'abc' } };
  const put = await handle(req('PUT', '/api/save', { token: token1, body: { game: 'zombie-survival', slot: 'main', data: save, digest: 'abc' } }), env);
  ok('PUT 存档 200', put.status === 200, String(put.status));
  const got = await j(await handle(req('GET', '/api/save?game=zombie-survival&slot=main', { token: token1 }), env));
  ok('GET 存档内容一致', JSON.stringify(got.data) === JSON.stringify(save));
  ok('GET 带 updatedAt/bytes/digest', !!got.updatedAt && got.bytes > 0 && got.digest === 'abc');
  const list = await j(await handle(req('GET', '/api/saves?game=zombie-survival', { token: token1 }), env));
  ok('索引里有 main 槽', list.slots.length === 1 && list.slots[0].slot === 'main', JSON.stringify(list));
  /* 新设备 = 新登录 */
  const t2 = (await j(await handle(req('POST', '/api/login', { body: { name: 'tester', verifier: VER } }), env))).token;
  const list2 = await j(await handle(req('GET', '/api/saves?game=zombie-survival', { token: t2 }), env));
  const got2 = await j(await handle(req('GET', '/api/save?game=zombie-survival&slot=main', { token: t2 }), env));
  ok('另一台设备能列出并拉到同一份存档', list2.slots.length === 1 && JSON.stringify(got2.data) === JSON.stringify(save));
  const big = await handle(req('PUT', '/api/save', { token: token1, body: { game: 'zombie-survival', slot: 'huge', data: 'x'.repeat(300000) } }), env);
  ok('超大存档 → 413', big.status === 413, String(big.status));
  const del = await handle(req('DELETE', '/api/save?game=zombie-survival&slot=main', { token: token1 }), env);
  const gone = await handle(req('GET', '/api/save?game=zombie-survival&slot=main', { token: token1 }), env);
  ok('DELETE 后读到 404', del.status === 200 && gone.status === 404);
  const list3 = await j(await handle(req('GET', '/api/saves?game=zombie-survival', { token: token1 }), env));
  ok('索引同步清理（空游戏不再出现在 /api/me 里）', list3.slots.length === 0);
}

/* 6. 登出使 token 失效 */
{
  const t = (await j(await handle(req('POST', '/api/login', { body: { name: 'tester', verifier: VER } }), env))).token;
  await handle(req('POST', '/api/logout', { token: t }), env);
  const after = await handle(req('GET', '/api/me', { token: t }), env);
  ok('登出后 token 立刻失效', after.status === 401);
}

/* 7. CORS 白名单 */
{
  const good = await handle(req('GET', '/api/health', { origin: ORIGIN }), env);
  ok('允许的 Origin 原样回显', good.headers.get('access-control-allow-origin') === ORIGIN, String(good.headers.get('access-control-allow-origin')));
  const evil = await handle(req('GET', '/api/health', { origin: 'https://evil.example' }), env);
  ok('陌生 Origin 不回显它（只给默认站点）', evil.headers.get('access-control-allow-origin') === ORIGIN, String(evil.headers.get('access-control-allow-origin')));
  const pre = await handle(req('OPTIONS', '/api/login', { origin: ORIGIN }), env);
  ok('OPTIONS 预检 204', pre.status === 204);
}

/* 8. 限流（每 IP 每分钟 20 次） */
{
  const e2 = { ...env, DSH_KV: memoryKV(), DSH_PEPPER: env.DSH_PEPPER };
  await handle(req('POST', '/api/register', { body: { name: 'rl', verifier: VER, salt: SALT } }), e2);
  let limited = false, codes = [];
  for (let i = 0; i < 25; i++) {
    const r = await handle(req('POST', '/api/login', { body: { name: 'rl', verifier: VER2 } }), e2);
    codes.push(r.status);
    if (r.status === 429) { limited = true; break; }
  }
  ok('暴力猜口令会被限流（429）', limited, '状态序列 ' + codes.join(','));
}

/* 9. 注销账号 */
{
  const e3 = { ...env, DSH_KV: memoryKV() };
  const t = (await j(await handle(req('POST', '/api/register', { body: { name: 'gone', verifier: VER, salt: SALT } }), e3))).token;
  await handle(req('PUT', '/api/save', { token: t, body: { game: 'g', slot: 's', data: { a: 1 } } }), e3);
  const wrong = await handle(req('POST', '/api/deleteAccount', { token: t, body: { confirm: 'nope' } }), e3);
  ok('注销需要原样确认用户名', wrong.status === 400);
  const del = await handle(req('POST', '/api/deleteAccount', { token: t, body: { confirm: 'gone' } }), e3);
  const relog = await handle(req('POST', '/api/login', { body: { name: 'gone', verifier: VER } }), e3);
  /* 只允许剩下限流计数器（rl:<ip>:<分钟>，自带 TTL）——账号、会话、存档索引都必须清干净 */
  const leftovers = Object.keys(e3.DSH_KV._dump()).filter(k => !k.startsWith('rl:'));
  ok('注销后账号没了、存档也清了', del.status === 200 && relog.status === 401 && leftovers.length === 0, '剩余 ' + JSON.stringify(leftovers));
}

/* 10. 并发保护 + GitHub 绑定（token 只在服务端、加密落盘、只能碰自己那一个 gist） */
{
  const e = { ...env, DSH_KV: memoryKV(), GH_CLIENT_SECRET: 'ghs_fake' };
  const t = (await j(await handle(req('POST', '/api/register', { body: { name: 'ghuser', verifier: VER, salt: SALT } }), e))).token;
  /* KV 存档的乐观并发 */
  await handle(req('PUT', '/api/save', { token: t, body: { game: 'g', slot: 'main', data: { a: 1 } } }), e);
  const first = await j(await handle(req('GET', '/api/save?game=g&slot=main', { token: t }), e));
  const okPut = await handle(req('PUT', '/api/save', { token: t, body: { game: 'g', slot: 'main', data: { a: 2 }, expectUpdatedAt: first.updatedAt } }), e);
  ok(('带上最新的 updatedAt 可以正常覆盖'), okPut.status === 200);
  const stale = await handle(req('PUT', '/api/save', { token: t, body: { game: 'g', slot: 'main', data: { a: 3 }, expectUpdatedAt: '2020-01-01T00:00:00.000Z' } }), e);
  const staleBody = await j(stale);
  ok('拿着过期 updatedAt 写入 → 409 conflict（不吃掉别的设备的进度）', stale.status === 409 && staleBody.error === 'conflict', JSON.stringify(staleBody));

  /* GitHub：把 fetch 打桩成"假 GitHub" */
  const realFetch = globalThis.fetch;
  const ghCalls = [];
  const gistFiles = {};
  globalThis.fetch = async (url, init) => {
    const u = String(url), m = (init && init.method) || 'GET';
    ghCalls.push(m + ' ' + u.replace('https://api.github.com', '').replace('https://github.com', ''));
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.includes('github.com/login/oauth/access_token')) {
      const body = String(init.body || '');
      if (!body.includes('client_secret=ghs_fake')) return J({ error: 'incorrect_client_credentials' }, 200);
      return J({ access_token: 'ghp_SERVERSIDE', token_type: 'bearer', scope: 'gist read:user' });
    }
    if (u.endsWith('/user')) return J({ login: 'bobby', avatar_url: 'https://x/a.png' });
    if (u.includes('/gists?per_page')) return J([]);
    if (m === 'POST' && /\/gists$/.test(u)) { gistFiles['manifest.json'] = { content: '{"files":{}}' }; return J({ id: 'gist1', files: gistFiles }, 201); }
    if (m === 'GET' && u.includes('/gists/gist1')) return J({ id: 'gist1', files: gistFiles, history: [{ version: 'v' + ghCalls.length }] });
    if (m === 'PATCH' && u.includes('/gists/gist1')) {
      const body = JSON.parse(init.body);
      for (const [k, v] of Object.entries(body.files)) { if (v === null) delete gistFiles[k]; else gistFiles[k] = { content: v.content }; }
      return J({ id: 'gist1', files: gistFiles, history: [{ version: 'v' + ghCalls.length }] });
    }
    if (m === 'DELETE' && u.includes('/applications/')) return new Response(null, { status: 204 });
    return J({ message: 'unstubbed ' + m + ' ' + u }, 404);
  };

  const bind = await j(await handle(req('POST', '/api/gh/bind', { token: t, body: { code: 'CODE1', client_id: 'Ov23liXX', redirect_uri: 'https://bobbychina.github.io/games/oauth-callback.html' } }), e));
  ok('绑定 GitHub：服务端换 token，前端只拿到 login（token 不出现）', bind.ok === true && bind.login === 'bobby' && !('token' in bind) && !JSON.stringify(bind).includes('ghp_'), JSON.stringify(bind));
  const dump = JSON.stringify(e.DSH_KV._dump());
  ok('令牌在 KV 里是密文（AES-GCM v1. 前缀，找不到明文）', dump.includes('v1.') && !dump.includes('ghp_SERVERSIDE'));
  const st = await j(await handle(req('GET', '/api/gh/status', { token: t }), e));
  ok('状态接口只回 login/头像/gistId', st.bound === true && st.login === 'bobby' && st.gistId === 'gist1' && !JSON.stringify(st).includes('ghp_'));

  const putGh = await j(await handle(req('PUT', '/api/gh/save', { token: t, body: { game: 'zombie-survival', slot: 'main', payload: { enc: 'CIPHERTEXT' }, updatedAt: '2026-09-12T00:00:00.000Z' } }), e));
  ok('通过 Worker 代理写 Gist（前端不碰 token）', putGh.ok === true, JSON.stringify(putGh));
  const listGh = await j(await handle(req('GET', '/api/gh/saves?game=zombie-survival', { token: t }), e));
  ok('列 Gist 里的槽位', listGh.slots.length === 1 && listGh.slots[0].slot === 'main');
  const getGh = await j(await handle(req('GET', '/api/gh/save?game=zombie-survival&slot=main', { token: t }), e));
  ok('读回 Gist 内容', JSON.stringify(getGh.payload) === JSON.stringify({ enc: 'CIPHERTEXT' }));
  const conflict = await handle(req('PUT', '/api/gh/save', { token: t, body: { game: 'zombie-survival', slot: 'main', payload: { enc: 'X' }, expectVersion: 'vOLD' } }), e);
  ok('Gist 版本对不上 → 409（不自作主张覆盖）', conflict.status === 409, String(conflict.status));
  const evil = await handle(req('PUT', '/api/gh/save', { token: t, body: { game: '../../evil', slot: 'x', payload: {} } }), e);
  ok('非法 game/slot 名 → 400（不许写到别的文件）', evil.status === 400, String(evil.status));
  const delGh = await handle(req('DELETE', '/api/gh/save?game=zombie-survival&slot=main', { token: t }), e);
  const listAfter = await j(await handle(req('GET', '/api/gh/saves?game=zombie-survival', { token: t }), e));
  ok('删掉 Gist 里的存档', delGh.status === 200 && listAfter.slots.length === 0);
  const unbind = await j(await handle(req('POST', '/api/gh/unbind', { token: t, body: { client_id: 'Ov23liXX' } }), e));
  const stAfter = await j(await handle(req('GET', '/api/gh/status', { token: t }), e));
  ok('解绑会去 GitHub 撤销 token 并清掉服务端记录', unbind.revoked === true && stAfter.bound === false,
    'revoked=' + unbind.revoked + ' ghCalls=' + ghCalls.filter(c => c.startsWith('DELETE')).join(','));
  const notBound = await handle(req('GET', '/api/gh/saves?game=g', { token: t }), e);
  ok('解绑后再调 Gist 接口 → 409 not_bound', notBound.status === 409);
  globalThis.fetch = realFetch;
}

console.log(results.join('\n'));
console.log(`\n${fail === 0 ? '✅ 全绿' : '⛔ 有失败'}：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
