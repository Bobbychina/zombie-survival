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

    推荐用同目录的 wrangler.toml 声明式部署（cd tools && npx wrangler deploy）：
    绑定写在配置里就不会点错，也不用每次往面板贴代码。

    账号安全模型（免费额度下的取舍）：
      · 口令：客户端 PBKDF2-SHA256 210k → verifier；服务端只存 SHA256(pepper + verifier)
      · 会话：KV 里只存 SHA256(token)，退登即删
      · 存档：客户端 AES-GCM 端到端加密，服务端只有密文
      · 存档密钥（DEK）是随机的，被"口令"和"恢复码"各包一份存在用户记录里（wrap.pw / wrap.rc）：
        忘了口令可以拿恢复码解开 DEK、换个口令重包一次，老存档照旧能读
        （代价：拿到 KV 的人可以离线猜口令，PBKDF2 210k 挡着——这是所有端到端方案的固有属性）
      · 配额：每账号每天 SAVE_WRITES_PER_DAY 次云存档上传（护 KV 免费额度 1000 写/天），
        以 UTC+8 零点为界，超了返回 429 quota_exceeded

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
const SAVE_WRITES_PER_DAY = 10;       // 每账号每天云存档上传上限（护 KV 免费额度：1000 写/天）
const QUOTA_TZ_OFFSET = 8 * 3600e3;   // 以 UTC+8 划"一天"，对国内玩家最直观

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
/* 客户端包好的存档密钥（信封加密）：形如 v1.<b64 iv>.<b64 ct>，服务端只存不拆 */
const validWrap = w => typeof w === 'string' && /^v1\.[A-Za-z0-9_-]{12,32}\.[A-Za-z0-9_-]{40,400}$/.test(w);

/* ---------- 每日上传配额 ----------
   免费版 KV 每天只有 1000 次写，所以给每账号每天 10 次云存档上传的机会。
   KV 没有原子自增：并发下最多多放行几次——配额是防滥用，不是计费，容忍这点误差。 */
function dayInfo(ts = Date.now()) {
  const local = ts + QUOTA_TZ_OFFSET;                       // 挪到 UTC+8
  const day = new Date(local).toISOString().slice(0, 10);   // 取日期部分
  const nextMidnightLocal = Math.floor(local / 86400000) * 86400000 + 86400000;
  return {
    day,
    resetAt: new Date(nextMidnightLocal - QUOTA_TZ_OFFSET).toISOString(),
    ttl: Math.ceil((nextMidnightLocal - local) / 1000) + 3600,   // 多留 1 小时，避免边界抖动
  };
}
const quotaKey = (uid, day) => 'q:' + uid + ':' + day;
async function quotaRead(env, uid) {
  const d = dayInfo();
  const rec = await kvGet(env, quotaKey(uid, d.day));
  const used = (rec && Number(rec.n)) || 0;
  return { day: d.day, used, limit: SAVE_WRITES_PER_DAY, left: Math.max(0, SAVE_WRITES_PER_DAY - used), resetAt: d.resetAt, ttl: d.ttl };
}
async function quotaBump(env, uid, q) {
  await kvPut(env, quotaKey(uid, q.day), { n: q.used + 1, day: q.day }, { expirationTtl: q.ttl });
}

/* ---------- 令牌"落地即加密"（AES-GCM，密钥由 DSH_PEPPER 派生） ----------
   为什么不用 PBKDF2 派生这把钥匙：免费版 Worker 只有 10ms CPU，PBKDF2 会超。
   pepper 本身是高熵随机串，单次 SHA-256 做成 AES 密钥在密码学上够用（不涉及抗暴力）。 */
async function atrestKey(env) {
  const seed = await sha256('dsh-at-rest-v1:' + ((env && env.DSH_PEPPER) || DEFAULT_PEPPER));
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = parseInt(seed.substr(i * 2, 2), 16);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await atrestKey(env), enc.encode(JSON.stringify(obj)));
  return 'v1.' + b64(iv) + '.' + b64(ct);
}
async function unseal(env, str) {
  const [v, ivs, cts] = String(str || '').split('.');
  if (v !== 'v1' || !ivs || !cts) throw new Error('密文格式不对');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivs) }, await atrestKey(env), unb64(cts));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- GitHub：token 只在服务端，前端永远拿不到 ---------- */
async function ghApi(token, method, path, body) {
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
      body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data, err: (data && data.message) || ('HTTP ' + r.status) };
}
const GIST_DESC = 'bobbychina.github.io/games 云存档（自动生成，可随时删除）';
const FILE_RE = /^[a-z0-9_-]{1,32}__[a-z0-9_-]{1,32}$/i;          // <game>__<slot>，不接受任意文件名
const fileOf = (game, slot) => String(game).toLowerCase() + '__' + String(slot).toLowerCase();
async function ghState(env, uid) {
  const rec = await kvGet(env, 'gh:' + uid);
  if (!rec) return null;
  try { return Object.assign({}, rec, { token: await unseal(env, rec.tokenEnc) }); }
  catch (e) { return null; }                                        // pepper 换过 → 旧令牌解不开，让用户重绑
}
async function ghSaveState(env, uid, st) {
  await kvPut(env, 'gh:' + uid, { tokenEnc: await seal(env, { t: st.token }), login: st.login, avatar: st.avatar || '', gistId: st.gistId || '', linkedAt: st.linkedAt || nowISO() });
}
/** 只认自己那一个 gist：id 存在 KV 里，别的 gist 一律不碰 */
async function ghEnsureGist(env, uid, st) {
  if (st.gistId) {
    const chk = await ghApi(st.token, 'GET', '/gists/' + st.gistId);
    if (chk.ok) return st.gistId;
  }
  const found = await ghApi(st.token, 'GET', '/gists?per_page=100');
  if (found.ok && Array.isArray(found.data)) {
    const hit = found.data.filter(g => g.description === GIST_DESC)[0];
    if (hit) { st.gistId = hit.id; await ghSaveState(env, uid, st); return hit.id; }
  }
  const made = await ghApi(st.token, 'POST', '/gists', { description: GIST_DESC, public: false, files: { 'manifest.json': { content: '{"files":{}}' } } });
  if (!made.ok) throw new Error(made.err);
  st.gistId = made.data.id;
  await ghSaveState(env, uid, st);
  return st.gistId;
}
async function ghReadGist(env, uid, st) {
  const id = await ghEnsureGist(env, uid, st);
  const g = await ghApi(st.token, 'GET', '/gists/' + id);
  if (!g.ok) throw new Error(g.err);
  let manifest = { files: {} };
  try { manifest = JSON.parse((g.data.files['manifest.json'] || {}).content || '{"files":{}}'); } catch { /* 坏了就重建 */ }
  if (!manifest.files) manifest.files = {};
  return { id, gist: g.data, manifest, version: (g.data.history && g.data.history[0] && g.data.history[0].version) || '' };
}
async function ghWriteFile(env, uid, st, name, payload, opts) {
  const cur = await ghReadGist(env, uid, st);
  if (opts && opts.expectVersion && cur.version && opts.expectVersion !== cur.version) {
    return { conflict: true, version: cur.version };                 // 别的设备刚写过 → 让前端先拉再重试
  }
  const files = {};
  files[name + '.json'] = { content: typeof payload === 'string' ? payload : JSON.stringify(payload) };
  if (opts && opts.delete) files[name + '.json'] = null;
  const manifest = { files: Object.assign({}, cur.manifest.files) };
  if (opts && opts.delete) delete manifest.files[name];
  else manifest.files[name] = { updatedAt: (opts && opts.updatedAt) || nowISO(), bytes: (typeof payload === 'string' ? payload : JSON.stringify(payload)).length };
  files['manifest.json'] = { content: JSON.stringify(manifest) };
  const r = await ghApi(st.token, 'PATCH', '/gists/' + cur.id, { files });
  if (!r.ok) throw new Error(r.err);
  return { ok: true, version: (r.data.history && r.data.history[0] && r.data.history[0].version) || '' };
}

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
  if (path === '/' || path === '') return json(req, { ok: true, service: 'bobbychina cloud', api: ['/api/health', '/api/register', '/api/login', '/api/recover/begin', '/api/recover/commit', '/api/me', '/api/quota', '/api/saves', '/api/save'] });

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
      /* 恢复码是可选的：给了就必须三件套齐全（盐 + 派生值 + 用它包好的存档密钥） */
      const hasRc = b.rcVerifier || b.rcSalt || (b.wrap && b.wrap.rc);
      if (hasRc && !(validVerifier(b.rcVerifier) && validSalt(b.rcSalt) && b.wrap && validWrap(b.wrap.rc))) {
        return err(req, 400, 'bad_recovery', '恢复码字段不完整');
      }
      if (b.wrap && b.wrap.pw && !validWrap(b.wrap.pw)) return err(req, 400, 'bad_wrap', '存档密钥包裹格式不对');
      const key = 'u:' + String(b.name).toLowerCase();
      if (await kvGet(env, key)) return err(req, 409, 'name_taken', '这个名字已经被注册了');
      const uid = rand(9);
      const rec = {
        uid, name: b.name, email: String(b.email || '').slice(0, 120),
        salt: b.salt, pw: await sha256(pepper + b.verifier), v: 1, createdAt: nowISO(),
      };
      if (hasRc) { rec.rcSalt = b.rcSalt; rec.rcPw = await sha256(pepper + b.rcVerifier); }
      if (b.wrap && validWrap(b.wrap.pw)) rec.wrap = { pw: b.wrap.pw, ...(hasRc ? { rc: b.wrap.rc } : {}) };
      await kvPut(env, key, rec);
      await kvPut(env, 'uid:' + uid, { name: rec.name });
      const s = await newSession(env, uid, rec.name);
      return json(req, { uid, name: rec.name, email: rec.email, createdAt: rec.createdAt,
        wrap: rec.wrap || null, hasRecovery: !!rec.rcPw, ...s }, 201);
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
      /* 把"被口令包好的存档密钥"交给客户端：服务端解不开，但忘口令时客户端可用恢复码解开它 */
      return json(req, { uid: rec.uid, name: rec.name, email: rec.email || '', createdAt: rec.createdAt,
        wrap: rec.wrap || null, hasRecovery: !!rec.rcPw, ...s });
    }

    /* ---- 忘记口令：用恢复码找回（两个都是登录前接口，所以放在鉴权之前） ----
       流程：begin 校验恢复码 → 客户端用恢复码解开存档密钥 → commit 换新口令 + 重包密钥
       服务端全程只见到密文，既不知道恢复码也不知道新口令的明文。 */
    if (path === '/api/recover/begin' && req.method === 'POST') {
      if (await rateLimited(env, req)) return err(req, 429, 'rate_limited', '请求太频繁，等一分钟再试');
      const b = await readJSON(req);
      if (!b || !validName(b.name) || !validVerifier(b.rcVerifier)) return err(req, 400, 'bad_request', '缺用户名或恢复码派生值');
      const rec = await kvGet(env, 'u:' + String(b.name).toLowerCase());
      const want = await sha256(pepper + b.rcVerifier);
      if (!rec || !rec.rcPw || !timingSafeEq(rec.rcPw, want)) {
        return err(req, 401, 'bad_recovery', '恢复码不对，或这个账号没有设置恢复码');
      }
      if (!rec.wrap || !rec.wrap.rc) return err(req, 409, 'no_wrap', '这个账号没有可恢复的存档密钥（旧版账号，请用原口令登录后补设恢复码）');
      return json(req, { ok: true, name: rec.name, rcSalt: rec.rcSalt, wrap: { rc: rec.wrap.rc } });
    }
    if (path === '/api/recover/commit' && req.method === 'POST') {
      if (await rateLimited(env, req)) return err(req, 429, 'rate_limited', '请求太频繁，等一分钟再试');
      const b = await readJSON(req);
      if (!b || !validName(b.name) || !validVerifier(b.rcVerifier)) return err(req, 400, 'bad_request', '缺用户名或恢复码派生值');
      if (!validVerifier(b.verifier) || !validSalt(b.salt) || !b.wrap || !validWrap(b.wrap.pw)) {
        return err(req, 400, 'bad_request', '缺新口令派生值 / 新盐 / 重包后的密钥');
      }
      const key = 'u:' + String(b.name).toLowerCase();
      const rec = await kvGet(env, key);
      const want = await sha256(pepper + b.rcVerifier);
      if (!rec || !rec.rcPw || !timingSafeEq(rec.rcPw, want)) return err(req, 401, 'bad_recovery', '恢复码不对');
      rec.pw = await sha256(pepper + b.verifier);     // 换口令哈希
      rec.salt = b.salt;                              // 换口令盐（恢复码的盐不动 → 恢复码继续有效）
      rec.wrap = { pw: b.wrap.pw, ...(rec.wrap && rec.wrap.rc ? { rc: rec.wrap.rc } : {}) };
      rec.recoveredAt = nowISO();
      await kvPut(env, key, rec);
      const s = await newSession(env, rec.uid, rec.name);
      return json(req, { ok: true, uid: rec.uid, name: rec.name, email: rec.email || '', createdAt: rec.createdAt,
        wrap: rec.wrap, hasRecovery: true, recovered: true, ...s });
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

    /* ---- 今日上传额度（账号面板显示"今天还能传几次"） ---- */
    if (path === '/api/quota' && req.method === 'GET') {
      const q = await quotaRead(env, me.uid);
      return json(req, { used: q.used, limit: q.limit, left: q.left, resetAt: q.resetAt });
    }

    /* ---- 补设恢复码（老账号：口令登录后补一份"被恢复码包好的存档密钥"） ---- */
    if (path === '/api/wrap' && req.method === 'POST') {
      const b = await readJSON(req);
      if (!b || !validVerifier(b.rcVerifier) || !validSalt(b.rcSalt) || !b.wrap || !validWrap(b.wrap.rc)) {
        return err(req, 400, 'bad_request', '缺 rcVerifier / rcSalt / wrap.rc');
      }
      const key = 'u:' + String(me.name).toLowerCase();
      const rec = await kvGet(env, key);
      if (!rec) return err(req, 404, 'not_found', '账号记录不见了');
      rec.rcSalt = b.rcSalt;
      rec.rcPw = await sha256(pepper + b.rcVerifier);
      rec.wrap = { ...(rec.wrap || {}), rc: b.wrap.rc };
      if (b.wrap.pw && validWrap(b.wrap.pw)) rec.wrap.pw = b.wrap.pw;   // 老账号同时补口令包，之后就走上信封加密
      await kvPut(env, key, rec);
      return json(req, { ok: true, hasRecovery: true });
    }

    /* ---- 改口令：只重包存档密钥，云端密文一个字节都不用动 ---- */
    if (path === '/api/password' && req.method === 'POST') {
      const b = await readJSON(req);
      if (!b || !validVerifier(b.verifier) || !validSalt(b.salt) || !b.wrap || !validWrap(b.wrap.pw)) {
        return err(req, 400, 'bad_request', '缺新口令派生值 / 新盐 / 重包后的密钥');
      }
      const key = 'u:' + String(me.name).toLowerCase();
      const rec = await kvGet(env, key);
      if (!rec) return err(req, 404, 'not_found', '账号记录不见了');
      rec.pw = await sha256(pepper + b.verifier);
      rec.salt = b.salt;
      rec.wrap = { ...(rec.wrap || {}), pw: b.wrap.pw };
      rec.pwChangedAt = nowISO();
      await kvPut(env, key, rec);
      return json(req, { ok: true });
    }

    /* ---- GitHub 绑定：换 token 只在服务端做，前端拿到的永远只是用户名/头像 ---- */
    if (path === '/api/gh/bind' && req.method === 'POST') {
      const b = await readJSON(req);
      if (!b || !b.code || !b.client_id) return err(req, 400, 'bad_request', '缺 code / client_id');
      const secret = env && env.GH_CLIENT_SECRET;
      if (!secret) return err(req, 503, 'no_secret', 'Worker 没配 GH_CLIENT_SECRET，无法在服务端换 token');
      const form = new URLSearchParams({
        client_id: b.client_id, client_secret: secret, code: String(b.code),
        redirect_uri: String(b.redirect_uri || ''), ...(b.verifier ? { code_verifier: String(b.verifier) } : {}),
      });
      let tok = null;
      try {
        const r = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form.toString(),
        });
        tok = await r.json();
      } catch (e) { return err(req, 502, 'github_unreachable', String(e && e.message || e)); }
      if (!tok || !tok.access_token) {
        /* 把 GitHub 的错误码一并带出来：bad_verification_code = 客户端凭据没问题、只是 code 无效；
           incorrect_client_credentials = client_id/secret 配错了。排查时一眼能分清（这次就是靠它验证 secret 生效的） */
        const code = (tok && tok.error) || '';
        const desc = (tok && tok.error_description) || code || '换 token 失败';
        return json(req, { error: 'exchange_failed', github: code, message: desc + (code ? '（' + code + '）' : '') }, 400);
      }
      const usr = await ghApi(tok.access_token, 'GET', '/user');
      if (!usr.ok) return err(req, 400, 'token_invalid', usr.err);
      const st = { token: tok.access_token, login: usr.data.login, avatar: usr.data.avatar_url || '', gistId: '', linkedAt: nowISO() };
      try { await ghEnsureGist(env, me.uid, st); } catch (e) { /* 建 gist 失败不影响绑定 */ }
      return json(req, { ok: true, login: st.login, avatar: st.avatar, gistId: st.gistId, scope: 'gist read:user' });
    }
    if (path === '/api/gh/token' && req.method === 'POST') {
      const b = await readJSON(req);
      const t = String((b && b.token) || '').trim();
      if (!/^(gh[pousr]_|github_pat_)/.test(t)) return err(req, 400, 'bad_token', '这不像 GitHub 令牌');
      const usr = await ghApi(t, 'GET', '/user');
      if (!usr.ok) return err(req, 400, 'token_invalid', usr.err);
      const st = { token: t, login: usr.data.login, avatar: usr.data.avatar_url || '', gistId: '', linkedAt: nowISO() };
      try { await ghEnsureGist(env, me.uid, st); } catch (e) { }
      return json(req, { ok: true, login: st.login, avatar: st.avatar, gistId: st.gistId });
    }
    if (path === '/api/gh/status' && req.method === 'GET') {
      const st = await ghState(env, me.uid);
      return json(req, st ? { bound: true, login: st.login, avatar: st.avatar, gistId: st.gistId, linkedAt: st.linkedAt }
        : { bound: false });
    }
    if (path === '/api/gh/unbind' && req.method === 'POST') {
      const st = await ghState(env, me.uid);
      let revoked = false;
      if (st) {
        /* 退出就顺手在 GitHub 侧撤销这个 token（用户不用再手动去设置页删） */
        const secret = env && env.GH_CLIENT_SECRET, cid = (await readJSON(req) || {}).client_id;
        if (secret && cid) {
          try {
            const r = await fetch('https://api.github.com/applications/' + cid + '/token', {
              method: 'DELETE', headers: { Authorization: 'Basic ' + btoa(cid + ':' + secret), Accept: 'application/vnd.github+json' },
              body: JSON.stringify({ access_token: st.token }),
            });
            revoked = r.ok || r.status === 204;
          } catch (e) { /* 撤销失败也要把本地令牌删掉 */ }
        }
      }
      const k = kv(env); await k.delete('gh:' + me.uid);
      return json(req, { ok: true, revoked });
    }
    /* 设备码：整条流程也放服务端，前端只拿到 9 位码（token 同样不落地前端） */
    if (path === '/api/gh/device/start' && req.method === 'POST') {
      const b = (await readJSON(req)) || {};
      if (!b.client_id) return err(req, 400, 'bad_request', '缺 client_id');
      let d = null;
      try {
        const r = await fetch('https://github.com/login/device/code', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ client_id: String(b.client_id), scope: 'gist read:user' }).toString(),
        });
        d = await r.json();
      } catch (e) { return err(req, 502, 'github_unreachable', String(e && e.message || e)); }
      if (!d || !d.device_code) return err(req, 502, 'device_failed', (d && (d.error_description || d.error)) || '拿设备码失败');
      await kvPut(env, 'dev:' + me.uid, { device_code: d.device_code, client_id: String(b.client_id) }, { expirationTtl: 900 });
      return json(req, { user_code: d.user_code, verification_uri: d.verification_uri, expires_in: d.expires_in, interval: d.interval });
    }
    if (path === '/api/gh/device/poll' && req.method === 'POST') {
      const rec = await kvGet(env, 'dev:' + me.uid);
      if (!rec) return err(req, 409, 'no_device', '没有进行中的设备码流程');
      let t = null;
      try {
        const r = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ client_id: rec.client_id, device_code: rec.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString(),
        });
        t = await r.json();
      } catch (e) { return err(req, 502, 'github_unreachable', String(e && e.message || e)); }
      if (t && t.access_token) {
        const usr = await ghApi(t.access_token, 'GET', '/user');
        if (!usr.ok) return err(req, 400, 'token_invalid', usr.err);
        const st = { token: t.access_token, login: usr.data.login, avatar: usr.data.avatar_url || '', gistId: '', linkedAt: nowISO() };
        try { await ghEnsureGist(env, me.uid, st); } catch (e) { }
        await kv(env).delete('dev:' + me.uid);
        return json(req, { ok: true, login: st.login, avatar: st.avatar, gistId: st.gistId });
      }
      if (t && t.error && t.error !== 'authorization_pending' && t.error !== 'slow_down') {
        return err(req, 400, 'device_failed', t.error_description || t.error);
      }
      return json(req, { ok: false, pending: true });
    }

    /* 代理读写 Gist：前端只能通过这里，且只允许动我们那一个 gist 里的 <game>__<slot>.json */
    if (path === '/api/gh/saves' && req.method === 'GET') {
      const st = await ghState(env, me.uid);
      if (!st) return err(req, 409, 'not_bound', '这个账号还没绑定 GitHub');
      const game = String(url.searchParams.get('game') || '').toLowerCase();
      try {
        const cur = await ghReadGist(env, me.uid, st);
        const slots = Object.keys(cur.manifest.files)
          .filter(f => FILE_RE.test(f) && (!game || f.split('__')[0] === game))
          .map(f => ({ game: f.split('__')[0], slot: f.split('__')[1], ...cur.manifest.files[f] }));
        return json(req, { ok: true, gistId: cur.id, version: cur.version, slots });
      } catch (e) { return err(req, 502, 'gist_failed', String(e.message)); }
    }
    if (path === '/api/gh/save' && req.method === 'GET') {
      const st = await ghState(env, me.uid);
      if (!st) return err(req, 409, 'not_bound', '这个账号还没绑定 GitHub');
      const name = fileOf(url.searchParams.get('game') || '', url.searchParams.get('slot') || '');
      if (!FILE_RE.test(name)) return err(req, 400, 'bad_name', 'game/slot 只允许字母数字_-');
      try {
        const cur = await ghReadGist(env, me.uid, st);
        const f = cur.gist.files[name + '.json'];
        if (!f) return err(req, 404, 'not_found', 'Gist 里没有这份存档');
        const content = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
        let payload = null; try { payload = JSON.parse(content); } catch { payload = { raw: content }; }
        return json(req, { ok: true, payload, updatedAt: (cur.manifest.files[name] || {}).updatedAt || '', version: cur.version });
      } catch (e) { return err(req, 502, 'gist_failed', String(e.message)); }
    }
    if (path === '/api/gh/save' && req.method === 'PUT') {
      const st = await ghState(env, me.uid);
      if (!st) return err(req, 409, 'not_bound', '这个账号还没绑定 GitHub');
      const b = await readJSON(req);
      const name = fileOf((b && b.game) || '', (b && b.slot) || '');
      if (!FILE_RE.test(name) || !b || typeof b.payload === 'undefined') return err(req, 400, 'bad_request', '缺 game/slot/payload 或名字不合法');
      const body = typeof b.payload === 'string' ? b.payload : JSON.stringify(b.payload);
      if (body.length > MAX_SAVE_BYTES) return err(req, 413, 'too_large', '单份存档上限 ' + Math.round(MAX_SAVE_BYTES / 1024) + 'KB');
      try {
        const r = await ghWriteFile(env, me.uid, st, name, body, { updatedAt: b.updatedAt, expectVersion: b.expectVersion });
        if (r.conflict) return json(req, { error: 'conflict', message: '别的设备刚写过，先拉取再重试', version: r.version }, 409);
        return json(req, { ok: true, version: r.version, updatedAt: b.updatedAt || nowISO() });
      } catch (e) { return err(req, 502, 'gist_failed', String(e.message)); }
    }
    if (path === '/api/gh/save' && req.method === 'DELETE') {
      const st = await ghState(env, me.uid);
      if (!st) return err(req, 409, 'not_bound', '这个账号还没绑定 GitHub');
      const name = fileOf(url.searchParams.get('game') || '', url.searchParams.get('slot') || '');
      if (!FILE_RE.test(name)) return err(req, 400, 'bad_name', 'game/slot 只允许字母数字_-');
      try { await ghWriteFile(env, me.uid, st, name, null, { delete: true }); return json(req, { ok: true }); }
      catch (e) { return err(req, 502, 'gist_failed', String(e.message)); }
    }

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
      /* 每日上传配额：先查后写，超了直接 429，让 KV 免费额度（1000 写/天）撑得住 */
      const q = await quotaRead(env, me.uid);
      if (q.used >= q.limit) {
        const hoursLeft = Math.max(1, Math.ceil((Date.parse(q.resetAt) - Date.now()) / 3600000));
        return json(req, { error: 'quota_exceeded', used: q.used, limit: q.limit, left: 0, resetAt: q.resetAt,
          message: `今天的云存档上传次数用完了（${q.limit}/${q.limit}），${hoursLeft} 小时后（UTC+8 零点）恢复` }, 429);
      }
      const body = JSON.stringify(b.data);
      if (body.length > MAX_SAVE_BYTES) return err(req, 413, 'too_large', '单份存档上限 ' + Math.round(MAX_SAVE_BYTES / 1024) + 'KB');
      const game = String(b.game).slice(0, 64), slot = String(b.slot).slice(0, 64);
      /* 乐观并发：带上你上次看到的 updatedAt，若云端已经被别的设备改过就 409，让前端先拉再重试
         （不放任"最后写入赢"把另一台设备的进度吃掉） */
      const prev = await kvGet(env, saveKey(me.uid, game, slot));
      if (b.expectUpdatedAt && prev && prev.updatedAt && prev.updatedAt !== b.expectUpdatedAt) {
        return json(req, { error: 'conflict', message: '云端这份存档已被别的设备更新', updatedAt: prev.updatedAt }, 409);
      }
      const rec = { updatedAt: nowISO(), bytes: body.length, digest: b.digest || '', data: b.data, enc: !!b.enc };
      await kvPut(env, saveKey(me.uid, game, slot), rec);
      const idx = await idxRead(env, me.uid, game);
      idx.slots[slot] = { updatedAt: rec.updatedAt, bytes: rec.bytes, digest: rec.digest };
      await idxWrite(env, me.uid, game, idx);
      /* 计数放在写成功之后：计数失败就当这次白送，绝不因为配额记账而丢存档 */
      try { await quotaBump(env, me.uid, q); } catch { /* 记账失败不影响存档 */ }
      return json(req, { ok: true, slot, updatedAt: rec.updatedAt, bytes: rec.bytes,
        quota: { used: q.used + 1, limit: q.limit, left: Math.max(0, q.limit - q.used - 1), resetAt: q.resetAt } });
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
      for (const prefix of ['v:' + me.uid + ':', 'i:' + me.uid + ':', 'q:' + me.uid + ':']) {
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
