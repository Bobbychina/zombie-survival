/* ============================================================================
   bobbychina 云账号 + 云存档（Cloudflare Worker，单文件）
   ----------------------------------------------------------------------------
   一个 Worker 干两件事：
     1) /api/*    真正的服务端账号：注册 / 登录 / 会话 / 云存档（存 Cloudflare KV）
     2) /relay/*  原来的 GitHub OAuth 跨域中继（浏览器拿不到 GitHub 的 token 端点响应）

   安全模型（重要，别自我感动）：
     · 口令**不在服务端做 KDF**（Workers 免费版每次调用只有 10ms CPU，PBKDF2 210k 轮跑不动）。
       改为：浏览器用 WebCrypto PBKDF2(210k, 16B 盐) 算出 verifier 再上传；
       服务端只存 SHA256(pepper + verifier)，pepper 是 Worker 的 Secret，**不在数据库里**。
       → 只拿到 KV 数据的人，没有 pepper 就无法构造出可登录的 verifier；只拿到 pepper 也没有哈希。
     · 会话令牌 32 字节随机，服务端只存它的 SHA256（带 TTL），泄漏 KV 也拿不到可用令牌。
     · 登录/注册按 IP 限流（每分钟 20 次）挡暴力猜口令。
     · 只接受白名单 Origin 的跨域请求；所有响应 no-store。

   部署：
     1) 控制台 → Workers & Pages → 你的 Worker → 编辑代码 → 整段粘贴本文件 → Deploy
     2) KV：Workers & Pages → KV → Create namespace（名字随意，如 bobbychina-kv）
        → 回到 Worker → Settings → Bindings → Add → KV namespace
           Variable name 必须是 DSH_KV ，选刚建的 namespace → Save（会提示重新部署，点一下）
     3) Secret：Worker → Settings → Variables and Secrets → Add → Secret
           名称 DSH_PEPPER ／ 值 = 随便一串长随机字符（比如 40 位）
        （不配也能跑，但会退化成固定 pepper，/api/health 里会写明 pepper:"default"）
     4) 自检：浏览器打开 https://<你的>.workers.dev/api/health
           期望 {"ok":true,"kv":true,"pepper":"custom"}

   本地测试：本文件不依赖 Cloudflare 专有 API（只用 env.DSH_KV 的 get/put/delete/list），
   所以 tools/dev-api-server.mjs 能用内存 KV 把它跑在 Node 上，tools/test-worker.mjs 直接跑断言。
   ========================================================================== */

const ALLOW_ORIGINS = ['https://bobbychina.github.io', 'http://127.0.0.1:5180', 'http://localhost:5180'];
const RELAY = {
  '/relay/oauth/access_token': 'https://github.com/login/oauth/access_token',
  '/relay/login/device/code': 'https://github.com/login/device/code',
};
const MAX_SAVE_BYTES = 262144;        // 单份存档 256KB
const SESSION_DAYS = 60;
const RL_PER_MIN = 20;                // 每 IP 每分钟的注册/登录尝试上限
const DEFAULT_PEPPER = 'dsh-default-pepper-please-set-DSH_PEPPER';

/* ---------- 小工具 ---------- */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function rand(n = 32) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const nowISO = () => new Date().toISOString();

/* ---------- KV 包装（Node 测试时注入内存实现） ---------- */
function kv(env) { return env && env.DSH_KV ? env.DSH_KV : null; }
async function kvGet(env, key, json = true) {
  const k = kv(env); if (!k) return null;
  const raw = await k.get(key, json ? 'json' : 'text');
  return raw === undefined ? null : raw;
}
async function kvPut(env, key, val, opts) {
  const k = kv(env); if (!k) throw new Error('KV 未绑定：见文件顶部第 2 步');
  await k.put(key, typeof val === 'string' ? val : JSON.stringify(val), opts);
}

/* ---------- 存档索引 ---------- */
const saveKey = (uid, game, slot) => 'v:' + uid + ':' + game + ':' + slot;
const idxKey = (uid, game) => 'i:' + uid + ':' + game;
async function idxRead(env, uid, game) { return (await kvGet(env, idxKey(uid, game))) || { slots: {} }; }
async function idxWrite(env, uid, game, idx) {
  if (Object.keys(idx.slots).length) await kvPut(env, idxKey(uid, game), idx);
  else { const k = kv(env); if (k) await k.delete(idxKey(uid, game)); }
}

/* ---------- 会话 ---------- */
async function newSession(env, uid, name) {
  const token = rand(32);
  const exp = Date.now() + SESSION_DAYS * 86400000;
  await kvPut(env, 's:' + (await sha256(token)), { uid, name, exp }, { expirationTtl: SESSION_DAYS * 86400 });
  return { token, exp };
}
async function authed(env, req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const s = await kvGet(env, 's:' + (await sha256(m[1].trim())));
  if (!s || (s.exp && s.exp < Date.now())) return null;
  return { uid: s.uid, name: s.name, token: m[1].trim() };
}

/* ---------- 限流 ---------- */
async function rateLimited(env, req) {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local';
  const key = 'rl:' + ip + ':' + Math.floor(Date.now() / 60000);
  const rec = (await kvGet(env, key)) || { n: 0 };
  rec.n++;
  await kvPut(env, key, rec, { expirationTtl: 120 }).catch(() => { });
  return rec.n > RL_PER_MIN;
}

/* ---------- 响应 ---------- */
function cors(req) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}
const json = (req, obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors(req), 'content-type': 'application/json' } });
const err = (req, status, code, msg) => json(req, { error: code, message: msg }, status);
const readJSON = async req => { try { return await req.json(); } catch { return null; } };
const validName = n => typeof n === 'string' && /^[\w\u4e00-\u9fa5.-]{2,24}$/.test(n);
const validVerifier = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);   // PBKDF2-SHA256 → 32B → 64 hex
const validSalt = s => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);        // 16B → 32 hex

/* ============================ 主入口 ============================ */
export async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const pepper = (env && env.DSH_PEPPER) || DEFAULT_PEPPER;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

  /* ---- GitHub OAuth 中继（保留旧路径 /oauth/access_token 兼容已部署的前端） ---- */
  const relayTarget = RELAY[path] || RELAY[path.replace(/^\/(oauth|login)\//, '/relay/$1/')] ||
    (path === '/oauth/access_token' ? RELAY['/relay/oauth/access_token'] : null);
  if (relayTarget && req.method === 'POST') {
    let body = await req.text();
    const secret = env && env.GH_CLIENT_SECRET;
    if (/oauth\/access_token$/.test(relayTarget) && secret && !/(^|&)client_secret=/.test(body)) {
      body += '&client_secret=' + encodeURIComponent(secret);
    }
    try {
      const r = await fetch(relayTarget, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      });
      return new Response(await r.text(), { status: r.status, headers: { ...cors(req), 'content-type': 'application/json' } });
    } catch (e) {
      return err(req, 502, 'upstream_failed', String(e && e.message || e));
    }
  }
  if (RELAY[path] || path === '/oauth/access_token') return err(req, 405, 'method_not_allowed', '只接受 POST');
  if (path === '/' || path === '') return json(req, { ok: true, service: 'bobbychina cloud', api: ['/api/health', '/api/register', '/api/login', '/api/me', '/api/saves', '/api/save'] });

  /* ---- 健康检查 ---- */
  if (path === '/api/health') {
    let kvOk = false;
    try { const k = kv(env); if (k) { await k.put('__health', '1', { expirationTtl: 60 }); kvOk = true; } } catch { kvOk = false; }
    return json(req, { ok: true, kv: kvOk, pepper: (env && env.DSH_PEPPER) ? 'custom' : 'default', time: nowISO() });
  }

  /* ---- 需要 KV 的接口 ---- */
  if (path.startsWith('/api/')) {
    if (!kv(env)) return err(req, 503, 'kv_missing', 'Worker 还没绑定 KV：Settings → Bindings → 添加 DSH_KV');

    if (path === '/api/register' && req.method === 'POST') {
      if (await rateLimited(env, req)) return err(req, 429, 'rate_limited', '请求太频繁，等一分钟再试');
      const b = await readJSON(req);
      if (!b || !validName(b.name)) return err(req, 400, 'bad_name', '用户名 2~24 字，可用中文/字母/数字/._-');
      if (!validVerifier(b.verifier) || !validSalt(b.salt)) return err(req, 400, 'bad_credential', '客户端派生值格式不对');
      const key = 'u:' + String(b.name).toLowerCase();
      if (await kvGet(env, key)) return err(req, 409, 'name_taken', '这个名字已经被注册了');
      const uid = rand(9);
      const rec = {
        uid, name: b.name, email: String(b.email || '').slice(0, 120),
        salt: b.salt, pw: await sha256(pepper + b.verifier), v: 1, createdAt: nowISO(),
      };
      await kvPut(env, key, rec);
      await kvPut(env, 'uid:' + uid, { name: rec.name });
      const s = await newSession(env, uid, rec.name);
      return json(req, { uid, name: rec.name, email: rec.email, createdAt: rec.createdAt, ...s }, 201);
    }

    if (path === '/api/login' && req.method === 'POST') {
      if (await rateLimited(env, req)) return err(req, 429, 'rate_limited', '请求太频繁，等一分钟再试');
      const b = await readJSON(req);
      if (!b || !validName(b.name) || !validVerifier(b.verifier)) return err(req, 400, 'bad_request', '缺用户名或派生值');
      const rec = await kvGet(env, 'u:' + String(b.name).toLowerCase());
      const want = await sha256(pepper + b.verifier);
      // 用户名不存在时也走一次哈希比较，避免用响应时间区分"用户不存在/口令错"
      if (!rec || !timingSafeEq(rec.pw, want)) return err(req, 401, 'bad_credentials', '用户名或口令不对');
      const s = await newSession(env, rec.uid, rec.name);
      return json(req, { uid: rec.uid, name: rec.name, email: rec.email || '', createdAt: rec.createdAt, ...s });
    }

    /* 登录前取盐（公开接口）：用户不存在时也返回一个稳定的假盐，
       避免用响应差异去枚举"哪些用户名已注册" */
    if (path === '/api/salt' && req.method === 'GET') {
      if (await rateLimited(env, req)) return err(req, 429, 'rate_limited', '请求太频繁，等一分钟再试');
      const name = String(url.searchParams.get('name') || '');
      if (!validName(name)) return err(req, 400, 'bad_name', '用户名格式不对');
      const rec = await kvGet(env, 'u:' + name.toLowerCase());
      const salt = (rec && rec.salt) ? rec.salt : (await sha256('nosuch:' + name.toLowerCase() + pepper)).slice(0, 32);
      return json(req, { salt });
    }

    const me = await authed(env, req);
    if (!me) return err(req, 401, 'unauthorized', '没登录或会话过期');

    if (path === '/api/logout' && req.method === 'POST') {
      const k = kv(env); await k.delete('s:' + (await sha256(me.token)));
      return json(req, { ok: true });
    }

    if (path === '/api/me' && req.method === 'GET') {
      const rec = await kvGet(env, 'u:' + String(me.name).toLowerCase());
      const games = {};
      if (rec) {
        const list = await kvList(env, 'i:' + rec.uid + ':');
        for (const k of list) {
          const game = k.name.slice(('i:' + rec.uid + ':').length);
          const idx = await kvGet(env, k.name);
          games[game] = idx ? Object.entries(idx.slots).map(([slot, v]) => ({ slot, ...v })) : [];
        }
      }
      return json(req, { uid: me.uid, name: me.name, email: (rec && rec.email) || '', createdAt: (rec && rec.createdAt) || '', games });
    }

    /* 列出某个游戏（或全部游戏）的存档索引 */
    if (path === '/api/saves' && req.method === 'GET') {
      const want = url.searchParams.get('game');
      if (want) {
        const idx = await idxRead(env, me.uid, want);
        return json(req, { game: want, slots: Object.entries(idx.slots).map(([slot, v]) => ({ slot, ...v })) });
      }
      const out = {};
      for (const k of await kvList(env, 'i:' + me.uid + ':')) {
        const game = k.name.slice(('i:' + me.uid + ':').length);
        const idx = await kvGet(env, k.name);
        out[game] = idx ? Object.entries(idx.slots).map(([slot, v]) => ({ slot, ...v })) : [];
      }
      return json(req, { games: out });
    }

    /* 取一份存档 */
    if (path === '/api/save' && req.method === 'GET') {
      const game = url.searchParams.get('game'), slot = url.searchParams.get('slot');
      if (!game || !slot) return err(req, 400, 'bad_request', '缺 game / slot');
      const rec = await kvGet(env, saveKey(me.uid, game, slot));
      if (!rec) return err(req, 404, 'not_found', '云端没有这份存档');
      return json(req, rec);
    }

    /* 写一份存档（幂等覆盖，带 digest 供客户端校验完整性） */
    if (path === '/api/save' && req.method === 'PUT') {
      const b = await readJSON(req);
      if (!b || !b.game || !b.slot || typeof b.data === 'undefined') return err(req, 400, 'bad_request', '缺 game / slot / data');
      const body = JSON.stringify(b.data);
      if (body.length > MAX_SAVE_BYTES) return err(req, 413, 'too_large', '单份存档上限 ' + Math.round(MAX_SAVE_BYTES / 1024) + 'KB');
      const game = String(b.game).slice(0, 64), slot = String(b.slot).slice(0, 64);
      const rec = { updatedAt: nowISO(), bytes: body.length, digest: b.digest || '', data: b.data };
      await kvPut(env, saveKey(me.uid, game, slot), rec);
      const idx = await idxRead(env, me.uid, game);
      idx.slots[slot] = { updatedAt: rec.updatedAt, bytes: rec.bytes, digest: rec.digest };
      await idxWrite(env, me.uid, game, idx);
      return json(req, { ok: true, slot, updatedAt: rec.updatedAt, bytes: rec.bytes });
    }

    /* 删一份存档 */
    if (path === '/api/save' && req.method === 'DELETE') {
      const game = url.searchParams.get('game'), slot = url.searchParams.get('slot');
      if (!game || !slot) return err(req, 400, 'bad_request', '缺 game / slot');
      const k = kv(env);
      await k.delete(saveKey(me.uid, game, slot));
      const idx = await idxRead(env, me.uid, game);
      delete idx.slots[slot];
      await idxWrite(env, me.uid, game, idx);
      return json(req, { ok: true });
    }

    /* 注销账号：删掉 vault 里这个 uid 的一切（存档 + 索引 + 会话 + 用户名记录） */
    if (path === '/api/deleteAccount' && req.method === 'POST') {
      const b = await readJSON(req);
      if (!b || b.confirm !== me.name) return err(req, 400, 'need_confirm', '要把用户名原样传进 confirm');
      const k = kv(env);
      for (const prefix of ['v:' + me.uid + ':', 'i:' + me.uid + ':']) {
        for (const item of await kvList(env, prefix)) await k.delete(item.name);
      }
      await k.delete('u:' + String(me.name).toLowerCase());
      await k.delete('uid:' + me.uid);
      await k.delete('s:' + (await sha256(me.token)));
      return json(req, { ok: true });
    }

    return err(req, 404, 'no_such_api', '没有这个接口：' + path);
  }

  return err(req, 404, 'not_found', '没这个路径：' + path);
}

/** KV 列表（Node 内存实现与 Cloudflare 都提供 list({prefix, limit, cursor})） */
async function kvList(env, prefix, limit = 1000) {
  const k = kv(env); if (!k) return [];
  const out = [];
  let cursor;
  do {
    const r = await k.list({ prefix, limit, cursor });
    (r.keys || []).forEach(x => out.push(x));
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor && out.length < 5000);
  return out;
}

export default { fetch: (req, env) => handle(req, env) };
