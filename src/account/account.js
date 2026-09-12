/* ============================================================================
   DSH Account —— bobbychina.github.io/games 的账号 + 云存档库
   ----------------------------------------------------------------------------
   纯前端、零依赖、无后端：注册/登录在后端不存在的情况下只能用浏览器本地存储 +
   WebCrypto（PBKDF2-SHA256）做口令校验；跨设备靠"绑定第三方账号"把存档同步到
   用户自己的云盘：
     · GitHub  → 私有 Gist（api.github.com 支持跨域，已验证）
     · Microsoft → OneDrive 应用文件夹（Graph 支持跨域，已验证）
   安全边界（必须知道）：
     1. 这是"本地账号"，口令只是防止同一台电脑上别人随手打开你的存档；
        真正持有浏览器 profile 的人可以直接读 localStorage —— 不是密码保险箱。
     2. 绑定的访问令牌存在 localStorage 里，同源 XSS 能偷走；所以只申请最小权限
        （gist / Files.ReadWrite.AppFolder）。
   用法：<script src="/games/account.js"></script> 之后用 window.DSHAccount
   ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var PBKDF2_ITER = 210000;
  var SESSION_DAYS = 30;
  var MAX_SAVE_BYTES = 1024 * 1024;          // 单份存档上限 1MB（localStorage 5MB 总配额）
  var K = {
    accounts: 'dsh.accounts.v1',
    session: 'dsh.session.v1',
    manifest: function (uid, game) { return 'dsh.saves.v1.' + uid + '.' + game; },
    save: function (uid, game, slot) { return 'dsh.save.v1.' + uid + '.' + game + '.' + slot; },
    oauth: 'dsh.oauth.pending',
    ghtok: 'dsh.ghtok.v1',                                 // 本机模式的 GitHub 令牌：只放 sessionStorage
  };
  var listeners = [];
  var popup = null;
  var INTEGRITY_FIELD = '__integrity';        // 只有取指纹时用，避免与游戏侧耦合

  /* ---------- 小工具 ---------- */
  function cfg() {
    var c = global.DSH_AUTH_CONFIG || {};
    return {
      api: String(c.api || '').replace(/\/+$/, ''),          // 云账号后端（Cloudflare Worker）；留空 = 纯本机账号
      github: Object.assign({ clientId: '', scope: 'gist read:user' }, c.github || {}),
      microsoft: Object.assign({ clientId: '', tenant: 'common', scope: 'openid profile offline_access User.Read Files.ReadWrite.AppFolder' }, c.microsoft || {}),
      redirect: c.redirect || (location.origin + '/games/oauth-callback.html'),
    };
  }
  var apiOk = null;                                        // /api/health 的缓存结果
  function apiBase() { return cfg().api; }
  /** 云后端可用吗（只探一次，失败也不再骚扰） */
  async function apiAvailable() {
    if (!apiBase()) return false;
    if (apiOk !== null) return apiOk;
    try {
      var r = await fetch(apiBase() + '/api/health', { cache: 'no-store' });
      var b = await r.json();
      apiOk = !!(r.ok && b && b.ok);
      if (apiOk && !b.kv) console.warn('[account] 云后端没绑 KV，账号无法注册/登录（见 tools/cf-worker.js 顶部步骤）');
      return apiOk;
    } catch (e) { apiOk = false; return false; }
  }
  /** 调云后端：统一错误话术，网络失败单独标出来（便于 UI 说"离线"） */
  async function api(path, opt) {
    opt = opt || {};
    var tok = serverToken();
    try {
      var r = await fetch(apiBase() + path, {
        method: opt.method || 'GET',
        headers: Object.assign({ Accept: 'application/json' },
          opt.body ? { 'Content-Type': 'application/json' } : {},
          (opt.token || tok) ? { Authorization: 'Bearer ' + (opt.token || tok) } : {}),
        body: opt.body ? JSON.stringify(opt.body) : undefined,
      });
      var text = await r.text();
      var data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
      if (!r.ok) return { ok: false, status: r.status, err: (data && (data.message || data.error)) || ('HTTP ' + r.status), offline: false };
      return { ok: true, status: r.status, data: data };
    } catch (e) {
      return { ok: false, err: '连不上云后端（离线？）', offline: true };
    }
  }
  function serverToken() {
    var s = readJSON(K.session, null);
    return s && s.token ? s.token : '';
  }
  var serverMode = () => !!serverToken();

  /* ---------- 端到端加密（上传前加密，密钥只在本机内存/本标签页会话里） ----------
     为什么加密：KV 与 Gist 都不是"只有你能看"的地方（Secret Gist 拿到 URL 就能读）。
     方案：AES-GCM-256，密钥 = PBKDF2(password, 'dsh-enc-v1:' + 用户名 + 服务端盐, 210k)，
     每个文件独立随机 IV，密文带版本头 { e:1, alg, kdf, salt, iv, ct }。
     密钥缓存在 sessionStorage（关掉标签页即失效），不写 localStorage；
     代价：换密码后旧密文解不开，所以改密时会把已有存档重新加密一遍。 */
  var ENC_KEY = 'dsh.eckey.v1';
  var ENC_VERSION = 1;
  function encSaltKey(name, saltHex) { return 'dsh-enc-v1:' + String(name).toLowerCase() + ':' + saltHex; }
  async function deriveKey(password, name, saltHex) {
    var base = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveKey']);
    /* extractable=true：需要把密钥原文缓存进 sessionStorage（本标签页有效），
       否则每次刷新页面都要重新输口令。密钥只在 sessionStorage，不写 localStorage。 */
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc(encSaltKey(name, saltHex)), iterations: PBKDF2_ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function cacheKey(password, name, saltHex) {
    var k = await deriveKey(password, name, saltHex);
    var raw = await crypto.subtle.exportKey('raw', k);
    writeJSON(ENC_KEY, { v: 1, name: String(name).toLowerCase(), salt: saltHex, k: b64url(raw) });
    return k;
  }
  async function currentKey() {
    var rec = readJSON(ENC_KEY, null);
    if (!rec || !rec.k || !rec.salt) return null;
    var raw; try { raw = fromB64url(rec.k); } catch (e) { return null; }
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  function encLocked() { return !readJSON(ENC_KEY, null); }
  var isEnvelope = v => !!(v && typeof v === 'object' && v.e === ENC_VERSION && v.ct && v.iv);
  async function encryptSave(obj) {
    var key = await currentKey();
    if (!key) return null;
    var iv = bytes(12);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc(JSON.stringify(obj)));
    var rec = readJSON(ENC_KEY, {});
    return { e: ENC_VERSION, alg: 'A256GCM', kdf: 'PBKDF2-SHA256-' + PBKDF2_ITER, salt: rec.salt || '', iv: b64url(iv), ct: b64url(ct) };
  }
  async function decryptSave(env2) {
    if (!isEnvelope(env2)) return env2;                      // 老数据/明文：原样返回
    var key = await currentKey();
    if (!key) return null;                                   // 锁着：让 UI 提示输入口令解锁
    try {
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(env2.iv) }, key, fromB64url(env2.ct));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { console.warn('[account] 解密失败（换过密码？）', e); return null; }
  }
  function nowISO() { return new Date().toISOString(); }
  function uid() {
    var b = crypto.getRandomValues(new Uint8Array(9));
    return 'u' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function b64url(buf) {
    var s = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function enc(str) { return new TextEncoder().encode(str); }
  function bytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  async function hashPassword(password, saltB64, iter) {
    var key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64url(saltB64), iterations: iter || PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
    return b64url(bits);
  }
  /** 云后端要的是 hex 形式（服务端只做一次 SHA256(pepper+verifier)，KDF 全在浏览器里跑） */
  async function pbkdf2Hex(password, saltHex, iter) {
    var key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(saltHex), iterations: iter || PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function fromHex(s) {
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  function toHex(buf) {
    return [...new Uint8Array(buf)].map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  /** 常数时间比较（防止按字符提前返回） */
  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  async function sha256b64(str) { return b64url(await crypto.subtle.digest('SHA-256', enc(str))); }

  /* ---------- 本地存储 ---------- */
  function readJSON(key, def) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : def; }
    catch (e) { console.warn('[account] 读失败', key, e); return def; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return { ok: true }; }
    catch (e) {
      var quota = /quota|exceed/i.test(String(e && e.name) + String(e && e.message));
      return { ok: false, err: quota ? '浏览器本地存储已满（清理一些旧存档再试）' : '本地存储不可用（无痕模式？）' };
    }
  }
  function removeKey(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  /* 会话级存储：GitHub 令牌（仅本机模式才会用到）放这里，关掉标签页即消失，不落 localStorage */
  function readSess(key, def) { try { var r = sessionStorage.getItem(key); return r ? JSON.parse(r) : def; } catch (e) { return def; } }
  function writeSess(key, v) { try { sessionStorage.setItem(key, JSON.stringify(v)); return { ok: true }; } catch (e) { return { ok: false, err: 'sessionStorage 不可用（无痕模式？）' }; } }

  /* ---------- 账号 ---------- */
  function loadDB() { return readJSON(K.accounts, { v: 1, users: {} }); }
  function saveDB(db) { return writeJSON(K.accounts, db); }

  function publicUser(u) {
    if (!u) return null;
    var p = {};
    Object.keys(u.providers || {}).forEach(function (k) {
      var v = u.providers[k];
      p[k] = k === 'github'
        ? { login: v.login, name: v.name, avatar: v.avatar, boundAt: v.boundAt }
        : { name: v.name, email: v.email, oid: v.oid, boundAt: v.boundAt };
    });
    return { uid: u.uid, name: u.name, email: u.email || '', createdAt: u.createdAt, server: !!u.server,
      providers: p, saveGames: Object.keys(u.games || {}), hasPassword: !!u.hash };
  }

    var Account = {
    version: VERSION,
    /** 云后端信息（UI 用它显示"服务器账号 / 本机账号"） */
    serverInfo: function () { return { base: apiBase(), enabled: !!apiBase(), loggedIn: serverMode() }; },
    serverAvailable: apiAvailable,
    /** 端到端加密的状态与解锁（UI 用）：锁着的时候只存本地、不上传 */
    cryptoInfo: function () {
      var rec = readJSON(ENC_KEY, null);
      return { locked: !rec, name: rec ? rec.name : '', alg: 'AES-GCM-256 / PBKDF2-SHA256-' + PBKDF2_ITER };
    },
    /** 重新输入口令解锁（不重新登录，只重新派生加密密钥） */
    unlock: async function (password) {
      var u = Account.current();
      if (!u) return { ok: false, err: '先登录' };
      if (!apiBase()) { await cacheKey(password, u.name, 'local'); return { ok: true }; }
      var sr = await api('/api/salt?name=' + encodeURIComponent(u.name));
      var saltHex = sr.ok && sr.data && sr.data.salt ? sr.data.salt : null;
      if (!saltHex) return { ok: false, err: '拿不到盐，无法解锁' };
      /* 拿一份云存档试着解一下：口令不对就当解锁失败（避免"假解锁"后把新存档写成解不开的密文） */
      await cacheKey(password, u.name, saltHex);
      var probe = await api('/api/saves?game=zombie-survival');
      if (probe.ok && probe.data && probe.data.slots && probe.data.slots.length) {
        var one = await api('/api/save?game=zombie-survival&slot=main');
        if (one.ok && one.data && isEnvelope(one.data.data)) {
          var dec = await decryptSave(one.data.data);
          if (!dec) { removeKey(ENC_KEY); return { ok: false, err: '口令不对（解不开云端存档）' }; }
        }
      }
      emit();
      return { ok: true };
    },
    /** GitHub 绑定状态（云模式下来自服务端；本地模式来自本机记录） */
    ghStatus: async function () {
      if (serverMode()) {
        var r = await api('/api/gh/status');
        if (r.ok) return r.data;
      }
      var u = Account.current();
      var g = u && u.providers && u.providers.github;
      return { bound: !!g, login: g ? g.login : '', avatar: g ? g.avatar : '', serverSide: false };
    },
    /* ----- 注册 / 登录 / 会话 ----- */
    register: async function (opts) {
      var name = String((opts && opts.name) || '').trim();
      var pass = String((opts && opts.password) || '');
      if (name.length < 2) return { ok: false, err: '用户名至少 2 个字符' };
      if (name.length > 24) return { ok: false, err: '用户名最长 24 个字符' };
      if (pass.length < 6) return { ok: false, err: '密码至少 6 位' };
      var db = loadDB();
      var lower = name.toLowerCase();
      var clash = Object.keys(db.users).some(function (k) { return db.users[k].name.toLowerCase() === lower; });
      if (clash) return { ok: false, err: '这个名字已经被注册了（换一个，或直接登录）' };
      var salt = toHex(bytes(16));

      /* ① 云后端优先：口令派生在本机做，只有 verifier 上传（服务端再叠一层 pepper 哈希） */
      if (await apiAvailable()) {
        var verifier = await pbkdf2Hex(pass, salt, PBKDF2_ITER);
        var r = await api('/api/register', { method: 'POST', body: { name: name, email: String((opts && opts.email) || ''), verifier: verifier, salt: salt } });
        if (!r.ok) return { ok: false, err: r.err };
        /* 本地同时留一份"壳"：能记住头像/绑定，且断网时还能用本地口令登录 */
        var lu = { uid: r.data.uid, name: r.data.name, email: r.data.email || '', salt: b64url(fromHex(salt)),
          hash: await hashPassword(pass, b64url(fromHex(salt)), PBKDF2_ITER), iter: PBKDF2_ITER,
          createdAt: r.data.createdAt || nowISO(), providers: {}, games: {}, server: true };
        db.users[lu.uid] = lu;
        var w = saveDB(db);
        if (!w.ok) return { ok: false, err: w.err };
        Account._setSession(lu.uid, { token: r.data.token, exp: r.data.exp });
        await cacheKey(pass, name, salt);                    // 派生并缓存加密密钥（本标签页）
        emit();
        return { ok: true, uid: lu.uid, user: publicUser(lu), server: true };
      }

      /* ② 没有云后端：老的本机账号 */
      var saltB64 = b64url(bytes(16));
      var hash = await hashPassword(pass, saltB64, PBKDF2_ITER);
      var u = { uid: uid(), name: name, email: String((opts && opts.email) || ''), salt: saltB64, hash: hash,
        iter: PBKDF2_ITER, createdAt: nowISO(), providers: {}, games: {} };
      db.users[u.uid] = u;
      var w2 = saveDB(db);
      if (!w2.ok) return { ok: false, err: w2.err };
      Account._setSession(u.uid);
      emit();
      return { ok: true, uid: u.uid, user: publicUser(u), server: false };
    },
    login: async function (opts) {
      var name = String((opts && opts.name) || '').trim();
      var pass = String((opts && opts.password) || '');
      var db = loadDB();
      var u = Object.keys(db.users).map(function (k) { return db.users[k]; })
        .filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
      var isServerAccount = !!(u && u.server);

      /* ① 云账号：先问服务端要盐 → 本机派生 verifier → 登录 */
      if (apiBase() && (isServerAccount || !u) && await apiAvailable()) {
        var sr = await api('/api/salt?name=' + encodeURIComponent(name));
        var saltHex = sr.ok && sr.data && sr.data.salt ? sr.data.salt : null;
        if (!saltHex && u && u.salt) saltHex = toHex(fromB64url(u.salt));
        if (saltHex) {
          var verifier = await pbkdf2Hex(pass, saltHex, PBKDF2_ITER);
          var r = await api('/api/login', { method: 'POST', body: { name: name, verifier: verifier } });
          if (!r.ok) {
            if (!r.offline) return { ok: false, err: r.err };
          } else {
            if (!u) {   // 这台设备第一次登录：补一份本地壳
              u = { uid: r.data.uid, name: r.data.name, email: r.data.email || '', salt: b64url(fromHex(saltHex)),
                hash: await hashPassword(pass, b64url(fromHex(saltHex)), PBKDF2_ITER), iter: PBKDF2_ITER,
                createdAt: r.data.createdAt || nowISO(), providers: {}, games: {}, server: true };
              db.users[u.uid] = u;
              saveDB(db);
            }
            Account._setSession(u.uid, { token: r.data.token, exp: r.data.exp });
            await cacheKey(pass, name, saltHex);             // 派生并缓存加密密钥（本标签页）
            emit();
            return { ok: true, uid: u.uid, user: publicUser(u), server: true };
          }
        }
      }

      /* ② 本机账号（或断网时用本地口令兜底） */
      if (!u) return { ok: false, err: '没有这个账号（先注册）' };
      if (!u.hash) return { ok: false, err: '这个账号是用第三方登录建的，请用「' + Object.keys(u.providers || {}).join('/') + '」登录' };
      var h = await hashPassword(pass, u.salt, u.iter || PBKDF2_ITER);
      if (!safeEqual(h, u.hash)) return { ok: false, err: '密码不对' };
      Account._setSession(u.uid);
      emit();
      return { ok: true, uid: u.uid, user: publicUser(u), server: false };
    },
    logout: async function () {
      /* 必须等这一次请求发完再清会话：否则服务端那份 token 还活着（探针里就是这么抓到的） */
      if (serverMode()) { try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* 离线也要能登出 */ } }
      removeKey(K.session); emit(); return { ok: true };
    },
    /** 会话：uid + 过期时间（云账号会额外存服务端 token），同一台设备免登录 */
    _setSession: function (u, extra) {
      writeJSON(K.session, Object.assign({ uid: u, exp: Date.now() + SESSION_DAYS * 86400000 }, extra || {}));
    },
    currentUid: function () {
      var s = readJSON(K.session, null);
      if (!s || !s.uid) return null;
      if (s.exp && s.exp < Date.now()) { removeKey(K.session); return null; }
      return s.uid;
    },
    current: function () {
      var id = Account.currentUid();
      if (!id) return null;
      var u = loadDB().users[id];
      if (!u) { removeKey(K.session); return null; }
      return publicUser(u);
    },
    _raw: function () {                                   // 内部：拿含密钥的原始记录
      var id = Account.currentUid();
      return id ? loadDB().users[id] : null;
    },
    changePassword: async function (oldPass, newPass) {
      var db = loadDB(), u = db.users[Account.currentUid()];
      if (!u) return { ok: false, err: '先登录' };
      if (u.hash) {
        var h = await hashPassword(String(oldPass || ''), u.salt, u.iter || PBKDF2_ITER);
        if (!safeEqual(h, u.hash)) return { ok: false, err: '原密码不对' };
      }
      if (String(newPass || '').length < 6) return { ok: false, err: '新密码至少 6 位' };
      u.salt = b64url(bytes(16));
      u.hash = await hashPassword(String(newPass), u.salt, PBKDF2_ITER);
      u.iter = PBKDF2_ITER;
      saveDB(db);
      return { ok: true };
    },
    /** 删账号 = 删本地记录 + 本地存档（云后端账号顺带删服务端；gist/OneDrive 里的文件要用户自己删） */
    deleteAccount: async function (confirmName) {
      var db = loadDB(), id = Account.currentUid(), u = db.users[id];
      if (!u) return { ok: false, err: '先登录' };
      if (String(confirmName || '').trim() !== u.name) return { ok: false, err: '名字不匹配' };
      var serverNote = '';
      if (u.server && serverMode()) {
        var r = await api('/api/deleteAccount', { method: 'POST', body: { confirm: u.name } });
        serverNote = r.ok ? '服务端账号已删除' : ('服务端删除失败：' + r.err);
      }
      Object.keys(u.games || {}).forEach(function (g) {
        Account.slots(g).forEach(function (s) { Account.saveDelete(g, s.slot, true); });
        removeKey(K.manifest(id, g));
      });
      delete db.users[id];
      saveDB(db);
      removeKey(K.session);
      emit();
      return { ok: true, note: serverNote };
    },

    /* ----- 存档槽（本地，按账号隔离） ----- */
    slots: function (game) {
      var id = Account.currentUid();
      if (!id) return [];
      var m = readJSON(K.manifest(id, game), {});
      return Object.keys(m).map(function (slot) { return { slot: slot, updatedAt: m[slot].updatedAt, bytes: m[slot].bytes }; })
        .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    },
    saveGet: function (game, slot) {
      var id = Account.currentUid();
      if (!id) return null;
      var rec = readJSON(K.save(id, game, slot), null);
      return rec && typeof rec.data !== 'undefined' ? rec.data : null;
    },
    saveInfo: function (game, slot) {
      var id = Account.currentUid();
      if (!id) return null;
      var rec = readJSON(K.save(id, game, slot), null);
      return rec ? { updatedAt: rec.updatedAt, bytes: rec.bytes, cloud: rec.cloud || null } : null;
    },
    savePut: function (game, slot, data, opts) {
      var id = Account.currentUid();
      if (!id) return { ok: false, err: '先登录再存' };
      var body = JSON.stringify(data);
      if (body.length > MAX_SAVE_BYTES) return { ok: false, err: '这份存档太大了（>' + Math.round(MAX_SAVE_BYTES / 1024) + 'KB）' };
      var rec = { updatedAt: nowISO(), bytes: body.length, data: data, cloud: (opts && opts.cloud) || null };
      var w = writeJSON(K.save(id, game, slot), rec);
      if (!w.ok) return { ok: false, err: w.err };
      var m = readJSON(K.manifest(id, game), {});
      m[slot] = { updatedAt: rec.updatedAt, bytes: rec.bytes };
      writeJSON(K.manifest(id, game), m);
      /* 记一下"这个账号玩过哪些游戏"，删号时要能清干净 */
      var db = loadDB(), u = db.users[id];
      if (u) { u.games = u.games || {}; u.games[game] = true; saveDB(db); }
      /* 云账号：顺手推到服务端（失败不阻塞本地存档，由 syncNow/下次上传补）
         上传的是**密文**（未解锁就不传，避免明文落库） */
      if (serverMode() && !(opts && opts.noServer)) {
        void (async function () {
          var envl = await encryptSave(data);
          if (!envl) { console.warn('[account] 未解锁（缺少加密密钥），这次只存了本地'); return; }
          var r = await api('/api/save', { method: 'PUT', body: { game: game, slot: slot, data: envl, enc: true, expectUpdatedAt: (opts && opts.expectUpdatedAt) || '' } });
          if (!r.ok && !r.offline && r.status !== 409) console.warn('[account] 服务端存档失败：' + r.err);
        })();
      }
      emit({ type: 'save', game: game, slot: slot });
      return { ok: true, updatedAt: rec.updatedAt, bytes: rec.bytes };
    },
    saveDelete: function (game, slot, quiet) {
      var id = Account.currentUid();
      if (!id) return { ok: false, err: '先登录' };
      removeKey(K.save(id, game, slot));
      var m = readJSON(K.manifest(id, game), {});
      delete m[slot];
      // 槽位空了就把这张"游戏清单"整条删掉，免得删号/删档之后留一堆空壳键
      if (Object.keys(m).length) writeJSON(K.manifest(id, game), m); else removeKey(K.manifest(id, game));
      if (!quiet) emit({ type: 'save-delete', game: game, slot: slot });
      return { ok: true };
    },

    /* ----- 第三方绑定 ----- */
    config: cfg,
    providerInfo: function () { return Account.current() ? Account.current().providers : {}; },
    /** extra 里可以带 refresh/exp（本地模式才需要；云模式下 token 不进前端，见 _bindServerGithub） */
    bindGitHubToken: async function (token, extra) {
      token = String(token || '').trim();
      if (!/^(gh[pousr]_|github_pat_)/.test(token)) return { ok: false, err: '这不像 GitHub 令牌（应以 ghp_ / github_pat_ 开头）' };
      /* 云模式：令牌只发给自己的 Worker，由服务端保存（前端不留 token，gist 授权太宽，不能落地） */
      if (serverMode()) {
        var sr = await api('/api/gh/token', { method: 'POST', body: { token: token } });
        if (!sr.ok) return { ok: false, err: '服务端校验令牌失败：' + sr.err };
        return Account._bindServerGithub(sr.data);
      }
      var me = await gh('GET', '/user', token);
      if (!me.ok) return { ok: false, err: '令牌无效或缺少权限：' + me.err };
      return Account._bind('github', Object.assign({
        token: token, login: me.data.login, name: me.data.name || me.data.login,
        avatar: me.data.avatar_url, boundAt: nowISO(),
      }, extra || {}));
    },
    /** 服务端绑定成功后只记"身份"，不记令牌 */
    _bindServerGithub: function (d) {
      return Account._bind('github', {
        login: d.login, name: d.login, avatar: d.avatar || '', gistId: d.gistId || '',
        serverSide: true, boundAt: nowISO(),
      });
    },
    /** GitHub OAuth（PKCE）：需要 auth-config.js 里填 clientId；设备码流程见 bindGitHubDevice */
    bindGitHubOAuth: async function () {
      var c = cfg().github;
      if (!c.clientId) return { ok: false, err: '还没配 GitHub client_id（见 /games/auth-config.js）' };
      var pk = await Account._pkce();
      // state 带上 provider 前缀：回调页只拿到 state 与 code，靠前缀才知道是谁的授权
      pk.state = 'github:' + pk.state;
      var url = 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
        client_id: c.clientId, redirect_uri: cfg().redirect, scope: c.scope,
        state: pk.state, code_challenge: pk.challenge, code_challenge_method: 'S256',
      });
      var code = await Account._popup(url, 'github', pk.state);
      if (!code) return { ok: false, err: '授权被取消' };
      /* 云模式：把 code 交给服务端去换 token（带 PKCE verifier），令牌永远不进这个页面 */
      if (serverMode()) {
        var sr = await api('/api/gh/bind', {
          method: 'POST',
          body: { code: code, client_id: c.clientId, redirect_uri: cfg().redirect, verifier: pk.verifier },
        });
        if (!sr.ok) return { ok: false, err: '服务端换 token 失败：' + sr.err, tried: ['server-side: ' + sr.err] };
        return Account._bindServerGithub(sr.data);
      }
      /* 本机模式（没配云后端）：只能在前端换 token —— 存 sessionStorage 而不是 localStorage，
         并且明确提示这条路的风险（gist 是全量授权） */
      var ex = await ghTokenWithFallback({ client_id: c.clientId, code: code, code_verifier: pk.verifier, redirect_uri: cfg().redirect });
      if (!ex.data || !ex.data.access_token) {
        return {
          ok: false,
          err: '换 token 失败：' + (ex.data ? (ex.data.error_description || ex.data.error || '未知') : '浏览器读不到 GitHub 的响应') +
            '（尝试记录：' + ex.tried.join(' ｜ ') + '）',
          tried: ex.tried,
        };
      }
      return Account.bindGitHubToken(ex.data.access_token, ghTokenExtra(ex.data));
    },
    /** 通道诊断：用户点一下就出结论（纯 GET/POST 空跑，用假 code，不会产生任何令牌） */
    diagnoseGitHub: probeGitHubChannel,
    /** GitHub 设备码流程：只需 client_id（OAuth App 里要勾选 Enable Device Flow）
     *  云模式：整条流程在 Worker 里跑，前端只拿到 9 位码；本机模式：先 form 再 json 直连。 */
    bindGitHubDevice: async function (onCode) {
      var c = cfg().github;
      if (!c.clientId) return { ok: false, err: '还没配 GitHub client_id（见 /games/auth-config.js）' };

      if (serverMode()) {
        var start = await api('/api/gh/device/start', { method: 'POST', body: { client_id: c.clientId } });
        if (!start.ok) return { ok: false, err: '拿设备码失败：' + start.err };
        if (onCode) onCode({ user_code: start.data.user_code, verification_uri: start.data.verification_uri, expires_in: start.data.expires_in });
        var deadline = Date.now() + Math.min(start.data.expires_in || 900, 900) * 1000;
        var wait = Math.max(3, start.data.interval || 5) * 1000;
        while (Date.now() < deadline) {
          await new Promise(function (s) { setTimeout(s, wait); });
          var p = await api('/api/gh/device/poll', { method: 'POST' });
          if (p.ok && p.data && p.data.ok) return Account._bindServerGithub(p.data);
          if (!p.ok) return { ok: false, err: '设备码失败：' + p.err };
          if (p.ok && p.data && !p.data.pending) return { ok: false, err: '设备码没被授权' };
        }
        return { ok: false, err: '设备码超时（重新发起即可）' };
      }

      var dc = await ghTokenWithFallback({ client_id: c.clientId, scope: c.scope }, 'https://github.com/login/device/code');
      var r = dc.data || {};
      if (!r.device_code) return { ok: false, err: '拿设备码失败：' + (r.error || '网络/CORS 受限') + '（尝试记录：' + dc.tried.join(' ｜ ') + '）', tried: dc.tried };
      if (onCode) onCode({ user_code: r.user_code, verification_uri: r.verification_uri, expires_in: r.expires_in });
      var deadline = Date.now() + Math.min(r.expires_in || 900, 900) * 1000;
      while (Date.now() < deadline) {
        await new Promise(function (s) { setTimeout(s, (r.interval || 5) * 1000); });
        var t = await ghTokenWithFallback({
          client_id: c.clientId, device_code: r.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
        var tj = t.data || {};
        if (tj.access_token) return Account.bindGitHubToken(tj.access_token, ghTokenExtra(tj));
        if (tj.error && tj.error !== 'authorization_pending' && tj.error !== 'slow_down') {
          return { ok: false, err: '设备码失败：' + (tj.error_description || tj.error) + '（' + t.tried.join(' ｜ ') + '）' };
        }
        if (!t.data) return { ok: false, err: '设备码轮询被挡：' + t.tried.join(' ｜ ') };
      }
      return { ok: false, err: '设备码超时（重新发起即可）' };
    },
    /** 微软账号：授权码 + PKCE（SPA 平台注册，无需 client secret） */
    bindMicrosoft: async function () {
      var c = cfg().microsoft;
      if (!c.clientId) return { ok: false, err: '还没配 Microsoft client_id（见 /games/auth-config.js）' };
      var pk = await Account._pkce();
      pk.state = 'microsoft:' + pk.state;
      var url = 'https://login.microsoftonline.com/' + c.tenant + '/oauth2/v2.0/authorize?' + new URLSearchParams({
        client_id: c.clientId, response_type: 'code', redirect_uri: cfg().redirect, response_mode: 'query',
        scope: c.scope, state: pk.state, code_challenge: pk.challenge, code_challenge_method: 'S256', prompt: 'select_account',
      });
      var code = await Account._popup(url, 'microsoft', pk.state);
      if (!code) return { ok: false, err: '授权被取消' };
      var tok = await Account._msToken({ grant_type: 'authorization_code', code: code, code_verifier: pk.verifier });
      if (!tok.access_token) return { ok: false, err: '换 token 失败：' + (tok.error_description || tok.error || '未知') };
      var me = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + tok.access_token } })
        .then(function (r) { return r.json(); }).catch(function () { return {}; });
      return Account._bind('microsoft', {
        access: tok.access_token, refresh: tok.refresh_token || '', exp: Date.now() + (tok.expires_in || 3600) * 1000 - 60000,
        oid: me.id || '', name: me.displayName || me.userPrincipalName || '微软用户', email: me.mail || me.userPrincipalName || '', boundAt: nowISO(),
      });
    },
    unbind: async function (provider) {
      var db = loadDB(), u = db.users[Account.currentUid()];
      if (!u || !u.providers || !u.providers[provider]) return { ok: false, err: '没绑定这个' };
      var note = '';
      if (provider === 'github') {
        if (u.providers.github.serverSide && serverMode()) {
          /* 云模式：让 Worker 去 GitHub 撤销这个 token（用户不用再手动去设置页删） */
          var r = await api('/api/gh/unbind', { method: 'POST', body: { client_id: cfg().github.clientId } });
          note = r.ok ? (r.data && r.data.revoked ? '已同时撤销 GitHub 授权' : '服务端记录已删除') : ('撤销失败：' + r.err);
        } else {
          var bag = readSess(K.ghtok, {});
          delete bag[u.uid];
          writeSess(K.ghtok, bag);                       // 本机模式：令牌只在内存/本标签页，删掉即失效
          note = '本机令牌已清除（可去 GitHub 设置里再撤销那次授权）';
        }
      }
      delete u.providers[provider];
      saveDB(db); emit();
      return { ok: true, note: note };
    },
    _bind: function (provider, data) {
      var db = loadDB(), u = db.users[Account.currentUid()];
      if (!u) return { ok: false, err: '先登录' };
      u.providers = u.providers || {};
      /* 本机模式的 GitHub 令牌一律不写进账号记录（那是 localStorage）：挪到 sessionStorage */
      if (provider === 'github' && data && data.token) {
        var bag = readSess(K.ghtok, {});
        bag[u.uid] = data.token;
        writeSess(K.ghtok, bag);
        data = Object.assign({}, data);
        delete data.token;
      }
      u.providers[provider] = data;
      var w = saveDB(db);
      if (!w.ok) return { ok: false, err: w.err };
      emit({ type: 'bind', provider: provider });
      return { ok: true, provider: provider, info: publicUser(u).providers[provider] };
    },
    _pkce: async function () {
      var verifier = b64url(bytes(48));
      var challenge = b64url(await crypto.subtle.digest('SHA-256', enc(verifier)));
      return { verifier: verifier, challenge: challenge, state: b64url(bytes(16)) };
    },
    /** 开弹窗 → 回调页把 code postMessage 回来；关掉弹窗也算取消 */
    _popup: function (url, provider, state) {
      return new Promise(function (resolve) {
        var w = 640, h = 720;
        var left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - h) / 2);
        popup = global.open(url, 'dsh-oauth', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
        if (!popup) { resolve(null); return; }
        writeJSON(K.oauth, { provider: provider, state: state, at: Date.now() });
        var done = false;
        function finish(code) {
          if (done) return; done = true;
          removeKey(K.oauth);
          removeEventListener('message', onMsg);
          clearInterval(timer);
          try { if (popup && !popup.closed) popup.close(); } catch (e) { /* ignore */ }
          resolve(code);
        }
        function onMsg(e) {
          var d = e.data || {};
          if (d.type !== 'dsh-oauth' || d.provider !== provider) return;
          if (d.state !== state) { finish(null); return; }        // state 不匹配 = 可能被塞了别人的 code
          finish(d.code || null);
        }
        addEventListener('message', onMsg);
        var timer = setInterval(function () { if (popup && popup.closed) finish(null); }, 700);
        setTimeout(function () { finish(null); }, 5 * 60 * 1000);
      });
    },
    _msToken: async function (params) {
      var c = cfg().microsoft;
      return fetch('https://login.microsoftonline.com/' + c.tenant + '/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.assign({ client_id: c.clientId, redirect_uri: cfg().redirect, scope: c.scope }, params)).toString(),
      }).then(function (r) { return r.json(); }).catch(function (e) { return { error: 'cors', error_description: String(e.message) }; });
    },
    /** 拿一个还能用的云访问令牌（微软与 GitHub 的会顺手刷新） */
    _cloudToken: async function (provider) {
      var db = loadDB(), u = db.users[Account.currentUid()];
      var p = u && u.providers && u.providers[provider];
      if (!p) return null;
      if (provider === 'github') {
        /* 本机模式的令牌在 sessionStorage；云模式的令牌在服务端，前端根本拿不到 */
        var bag = readSess(K.ghtok, {});
        var gtok = bag[u.uid];
        if (!gtok) return null;
        return gtok;
      }
      if (Date.now() < (p.exp || 0)) return p.access;
      if (!p.refresh) return null;
      var t = await Account._msToken({ grant_type: 'refresh_token', refresh_token: p.refresh });
      if (!t.access_token) return null;
      p.access = t.access_token; p.refresh = t.refresh_token || p.refresh;
      p.exp = Date.now() + (t.expires_in || 3600) * 1000 - 60000;
      saveDB(db);
      return p.access;
    },

    /* ----- 云同步 ----- */
    /** 这份账号现在能往哪同步：优先云后端，其次绑定的 GitHub/微软云盘 */
    backend: function () {
      var u = Account.current();
      if (!u) return null;
      if (serverMode()) return 'server';
      if (u.providers.github) return 'github';
      if (u.providers.microsoft) return 'microsoft';
      return null;
    },
    /** 把本地某游戏的槽位与云端对齐：谁新用谁；返回 {pulled, pushed, provider, err?} */
    syncNow: async function (game) {
      var u = Account.current();
      if (!u) return { ok: false, err: '先登录' };
      var provider = Account.backend();
      if (!provider) return { ok: false, err: '还没绑定云账号（也没连上云后端），只能在本地存' };
      if (provider === 'server') return serverSync(game);
      var token = await Account._cloudToken(provider);
      if (!token) return { ok: false, err: '云令牌失效了，重新绑定一下' };
      var remote;
      try { remote = provider === 'github' ? await ghManifest(token, game) : await msManifest(token, game); }
      catch (e) { return { ok: false, err: '云盘读取失败：' + e.message }; }
      var local = Account.slots(game), pulled = [], pushed = [];
      var map = {};
      local.forEach(function (s) { map[s.slot] = s; });
      for (var i = 0; i < remote.length; i++) {
        var r = remote[i], l = map[r.slot];
        if (!l || String(r.updatedAt) > String(l.updatedAt)) {
          var data = provider === 'github' ? await ghFileGet(token, r.id || r.slot) : await msFileGet(token, game, r.slot);
          if (data) {
            Account.savePut(game, r.slot, data, { cloud: { provider: provider, at: nowISO() } });
            pulled.push(r.slot);
          }
        }
      }
      local = Account.slots(game).filter(function (s) { return !pulled.length || pulled.indexOf(s.slot) < 0; });
      for (var j = 0; j < local.length; j++) {
        var s2 = local[j], rr = remote.filter(function (x) { return x.slot === s2.slot; })[0];
        if (!rr || String(s2.updatedAt) > String(rr.updatedAt)) {
          var okp = provider === 'github'
            ? await ghFilePut(token, game, s2.slot, Account.saveGet(game, s2.slot))
            : await msFilePut(token, game, s2.slot, Account.saveGet(game, s2.slot));
          if (okp) pushed.push(s2.slot);
        }
      }
      emit({ type: 'sync', game: game });
      return { ok: true, provider: provider, pulled: pulled, pushed: pushed };
    },
    /** 只上传 / 只下载（手动按钮用） */
    pushAll: async function (game) {
      var u = Account.current(); if (!u) return { ok: false, err: '先登录' };
      var provider = Account.backend();
      if (!provider) return { ok: false, err: '还没绑定云账号' };
      if (provider === 'server') return serverPushAll(game);
      var token = await Account._cloudToken(provider); if (!token) return { ok: false, err: '云令牌失效' };
      var slots = Account.slots(game), done = [];
      for (var i = 0; i < slots.length; i++) {
        var okp = provider === 'github' ? await ghFilePut(token, game, slots[i].slot, Account.saveGet(game, slots[i].slot))
          : await msFilePut(token, game, slots[i].slot, Account.saveGet(game, slots[i].slot));
        if (okp) done.push(slots[i].slot);
      }
      return { ok: true, provider: provider, pushed: done };
    },
    pullAll: async function (game) {
      var u = Account.current(); if (!u) return { ok: false, err: '先登录' };
      var provider = Account.backend();
      if (!provider) return { ok: false, err: '还没绑定云账号' };
      if (provider === 'server') return serverPullAll(game);
      var token = await Account._cloudToken(provider); if (!token) return { ok: false, err: '云令牌失效' };
      var remote = provider === 'github' ? await ghManifest(token, game) : await msManifest(token, game);
      var done = [];
      for (var i = 0; i < remote.length; i++) {
        var data = provider === 'github' ? await ghFileGet(token, remote[i].slot) : await msFileGet(token, game, remote[i].slot);
        if (data) { Account.savePut(game, remote[i].slot, data, { cloud: { provider: provider, at: nowISO() } }); done.push(remote[i].slot); }
      }
      return { ok: true, provider: provider, pulled: done };
    },
    cloudSummary: async function (game) {
      var u = Account.current(); if (!u) return { ok: false, err: '先登录' };
      var provider = Account.backend();
      if (!provider) return { ok: false, err: '未绑定云账号' };
      if (provider === 'server') {
        var sr = await api('/api/saves?game=' + encodeURIComponent(game));
        if (!sr.ok) return { ok: false, err: sr.err };
        return { ok: true, provider: 'server', remote: (sr.data && sr.data.slots) || [] };
      }
      var token = await Account._cloudToken(provider);
      if (!token) return { ok: false, err: '云令牌失效' };
      try {
        var remote = provider === 'github' ? await ghManifest(token, game) : await msManifest(token, game);
        return { ok: true, provider: provider, remote: remote };
      } catch (e) { return { ok: false, err: e.message }; }
    },
    /** 删掉云端某个槽位（云后端 / GitHub / OneDrive 三条路） */
    cloudDelete: async function (game, slot) {
      var u = Account.current(); if (!u) return { ok: false, err: '先登录' };
      var provider = Account.backend();
      if (!provider) return { ok: false, err: '未绑定云账号' };
      if (provider === 'server') {
        var r0 = await api('/api/save?game=' + encodeURIComponent(game) + '&slot=' + encodeURIComponent(slot), { method: 'DELETE' });
        return { ok: r0.ok, err: r0.err };
      }
      var token = await Account._cloudToken(provider);
      if (!token) return { ok: false, err: '云令牌失效' };
      if (provider === 'microsoft') {
        var d = await fetch(msUrl(game, slot, ''), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
          .catch(function (e) { return { ok: false, status: 0, err: e.message }; });
        var okDel = d.ok || d.status === 404;
        return { ok: okDel, err: okDel ? undefined : 'HTTP ' + d.status };
      }
      var id = await gistEnsure(token);
      var g = await gh('GET', '/gists/' + id, token);
      if (!g.ok) return { ok: false, err: g.err };
      var fname = gistName(game, slot);
      var m = { games: {} };
      try { m = JSON.parse((g.data.files['manifest.json'] || {}).content || '{"games":{}}'); } catch (e) { /* 坏了就重建 */ }
      if (m.games) delete m.games[fname];
      var files = {}; files[fname] = null; files['manifest.json'] = { content: JSON.stringify(m) };
      var r = await gh('PATCH', '/gists/' + id, token, { files: files });
      return { ok: r.ok, err: r.err };
    },

    /* ----- 备份 / 迁移 ----- */
    exportAll: function () {
      var db = loadDB(), id = Account.currentUid(), u = db.users[id];
      if (!u) return { ok: false, err: '先登录' };
      var bag = { v: 1, exportedAt: nowISO(), account: { name: u.name, email: u.email }, saves: {} };
      Object.keys(u.games || {}).forEach(function (g) {
        bag.saves[g] = {};
        Account.slots(g).forEach(function (s) { bag.saves[g][s.slot] = Account.saveGet(g, s.slot); });
      });
      return { ok: true, json: JSON.stringify(bag), name: u.name };
    },
    importAll: function (json) {
      var u = Account.current(); if (!u) return { ok: false, err: '先登录' };
      var bag; try { bag = JSON.parse(json); } catch (e) { return { ok: false, err: '不是合法 JSON' }; }
      if (!bag || !bag.saves) return { ok: false, err: '缺少存档内容' };
      var n = 0;
      Object.keys(bag.saves).forEach(function (g) {
        Object.keys(bag.saves[g]).forEach(function (slot) {
          if (Account.savePut(g, slot, bag.saves[g][slot]).ok) n++;
        });
      });
      return { ok: true, count: n };
    },

    /* ----- 事件 ----- */
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
  };

  function emit(ev) { listeners.forEach(function (fn) { try { fn(ev || {}); } catch (e) { console.warn(e); } }); }

  /* ---------- GitHub 换 token：多策略 + 诊断 ----------
     GitHub 的 /login/oauth/access_token 对"简单请求"（form-urlencoded，浏览器不发 OPTIONS 预检）
     与 JSON 请求（先发 OPTIONS 预检）的待遇可能不同。所以按 form → json 的顺序都试一遍，
     并把每一次的失败原因记下来——失败面板会把这份记录显示给用户，用来判断到底是
     "没开 CORS" 还是"只是预检没过"，而不是笼统一句 Failed to fetch。 */
  var GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
  /** 配了中继（Cloudflare Worker，见 tools/oauth-relay-worker.js）就把这两个端点改成走中继 */
  function ghUrl(url) {
    var relay = String((cfg().github.relay) || '').replace(/\/+$/, '');
    if (!relay) return url;
    var map = {};
    map[GH_TOKEN_URL] = relay + '/oauth/access_token';
    map['https://github.com/login/device/code'] = relay + '/login/device/code';
    return map[url] || url;
  }
  function ghCandidates(url) {
    var direct = url, viaRelay = ghUrl(url);
    return viaRelay === direct ? [direct] : [viaRelay, direct];    // 配了中继就优先走中继，中继挂了再试直连
  }
  async function ghPost(url, body, mode) {
    var headers = { Accept: 'application/json' };
    var payload;
    if (mode === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    var r = await fetch(url, { method: 'POST', headers: headers, body: payload });
    var text = await r.text();
    var json = null;
    try { json = JSON.parse(text); } catch (e) { json = { raw: String(text).slice(0, 120) }; }
    return { status: r.status, ok: r.ok, json: json };
  }
  function why(e) {
    if (!e) return '未知';
    if (e.name === 'TypeError') return 'CORS/网络被挡(TypeError)';
    return (e.name || 'Error') + ': ' + (e.message || '');
  }
  /** 依次用 form / json（并在配了中继时先走中继）POST；返回 {data, tried, mode} */
  async function ghTokenWithFallback(body, url) {
    var tried = [];
    var targets = ghCandidates(url || GH_TOKEN_URL);
    var modes = ['form', 'json'];
    for (var t = 0; t < targets.length; t++) {
      var label = targets.length > 1 && t === 0 ? 'relay' : 'direct';
      for (var i = 0; i < modes.length; i++) {
        try {
          var res = await ghPost(targets[t], body, modes[i]);
          if (res.json && (res.json.access_token || res.json.error || res.json.device_code)) {
            tried.push(label + '/' + modes[i] + ' → HTTP ' + res.status + (res.json.error ? ' (' + res.json.error + ')' : ' ✓'));
            return { data: res.json, tried: tried, mode: label + '/' + modes[i], status: res.status };
          }
          tried.push(label + '/' + modes[i] + ' → HTTP ' + res.status + ' 响应无法解析');
        } catch (e) {
          tried.push(label + '/' + modes[i] + ' → ' + why(e));
        }
      }
    }
    return { data: null, tried: tried };
  }
  /** 用假 code 空跑一遍，看浏览器到底能不能读到 GitHub 的响应（用户点一下就出结论） */
  async function probeGitHubChannel() {
    var c = cfg().github;
    var rows = [];
    var cases = [
      { name: 'form 换 token（不触发预检）', run: function () { return ghPost(ghUrl(GH_TOKEN_URL), { client_id: c.clientId, code: 'diagnostic', code_verifier: 'v'.repeat(43), redirect_uri: cfg().redirect }, 'form'); } },
      { name: 'json 换 token（触发预检）', run: function () { return ghPost(ghUrl(GH_TOKEN_URL), { client_id: c.clientId, code: 'diagnostic', code_verifier: 'v'.repeat(43), redirect_uri: cfg().redirect }, 'json'); } },
      { name: 'form 申请设备码', run: function () { return ghPost(ghUrl('https://github.com/login/device/code'), { client_id: c.clientId, scope: c.scope }, 'form'); } },
      { name: '读取 api.github.com/user', run: function () { return fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) { return { status: r.status, ok: r.ok, json: { note: '匿名请求（401 也算跨域正常）' } }; }); } },
    ];
    for (var i = 0; i < cases.length; i++) {
      try {
        var r = await cases[i].run();
        rows.push({ name: cases[i].name, ok: true, status: r.status, body: JSON.stringify(r.json).slice(0, 160) });
      } catch (e) {
        rows.push({ name: cases[i].name, ok: false, status: 0, body: why(e) });
      }
    }
    return rows;
  }

  /** GitHub 的 token 响应在「Expire user access tokens」开启时会多带 refresh_token / expires_in，
      这里把过期时间换算成本地时间戳存下来；没开就是空对象（长期令牌）。 */
  function ghTokenExtra(t) {
    if (!t || !t.refresh_token) return {};
    return { refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 28800) * 1000 - 60000 };
  }

  /* ---------- 云后端（Cloudflare Worker）的存档同步 ----------
     与 GitHub 那条路同样的语义：按 updatedAt 谁新用谁，最后写回本地镜像。 */
  async function serverRemote(game) {
    var r = await api('/api/saves?game=' + encodeURIComponent(game));
    if (!r.ok) throw new Error(r.err);
    return (r.data && r.data.slots) || [];
  }
  async function serverGet(game, slot) {
    var r = await api('/api/save?game=' + encodeURIComponent(game) + '&slot=' + encodeURIComponent(slot));
    if (!r.ok || !r.data) return null;
    return await decryptSave(r.data.data);                  // 密文就地解密；明文（老数据）原样返回
  }
  async function serverPut(game, slot, data) {
    var envl = await encryptSave(data);
    if (!envl) return false;
    var r = await api('/api/save', { method: 'PUT', body: { game: game, slot: slot, data: envl, enc: true } });
    if (r.status === 409) return { conflict: true, updatedAt: (r.data && r.data.updatedAt) || '' };
    return r.ok;
  }
  async function serverSync(game) {
    if (!serverMode()) return { ok: false, err: '云会话过期了，重新登录' };
    var remote;
    try { remote = await serverRemote(game); } catch (e) { return { ok: false, err: '云端读取失败：' + e.message }; }
    var local = Account.slots(game), pulled = [], pushed = [];
    var map = {};
    local.forEach(function (s) { map[s.slot] = s; });
    for (var i = 0; i < remote.length; i++) {
      var rr = remote[i], l = map[rr.slot];
      if (!l || String(rr.updatedAt) > String(l.updatedAt)) {
        var data = await serverGet(game, rr.slot);
        if (data) { Account.savePut(game, rr.slot, data, { cloud: { provider: 'server', at: nowISO() }, noServer: true }); pulled.push(rr.slot); }
      }
    }
    var rest = Account.slots(game).filter(function (s) { return pulled.indexOf(s.slot) < 0; });
    for (var j = 0; j < rest.length; j++) {
      var s2 = rest[j];
      var match = remote.filter(function (x) { return x.slot === s2.slot; })[0];
      if (!match || String(s2.updatedAt) > String(match.updatedAt)) {
        if (await serverPut(game, s2.slot, Account.saveGet(game, s2.slot))) pushed.push(s2.slot);
      }
    }
    return { ok: true, provider: 'server', pulled: pulled, pushed: pushed };
  }
  async function serverPushAll(game) {
    if (!serverMode()) return { ok: false, err: '云会话过期了，重新登录' };
    var slots = Account.slots(game), done = [];
    for (var i = 0; i < slots.length; i++) {
      if (await serverPut(game, slots[i].slot, Account.saveGet(game, slots[i].slot))) done.push(slots[i].slot);
    }
    return { ok: true, provider: 'server', pushed: done };
  }
  async function serverPullAll(game) {
    if (!serverMode()) return { ok: false, err: '云会话过期了，重新登录' };
    var remote;
    try { remote = await serverRemote(game); } catch (e) { return { ok: false, err: '云端读取失败：' + e.message }; }
    var done = [];
    for (var i = 0; i < remote.length; i++) {
      var data = await serverGet(game, remote[i].slot);
      if (data) { Account.savePut(game, remote[i].slot, data, { cloud: { provider: 'server', at: nowISO() }, noServer: true }); done.push(remote[i].slot); }
    }
    return { ok: true, provider: 'server', pulled: done };
  }

  /* ---------- GitHub 云盘（私有 Gist，一个账号一个 gist，里面按 <game>-<slot>.json 存） ---------- */
  function gh(method, path, token, body) {
    return fetch('https://api.github.com' + path, {
      method: method,
      headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(async function (r) {
      var t = await r.text();
      var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* 非 JSON */ }
      if (!r.ok) return { ok: false, err: (j && j.message) || ('HTTP ' + r.status), status: r.status };
      return { ok: true, data: j, status: r.status };
    }).catch(function (e) { return { ok: false, err: '网络或跨域失败：' + e.message }; });
  }
  var GIST_DESC = 'bobbychina.github.io/games 云存档（自动生成，可随时删除）';
  async function gistEnsure(token) {
    var db = loadDB(), uidRaw = Account.currentUid();
    var u = db.users[uidRaw];
    var p = u.providers.github;
    if (p.gistId) {
      var chk = await gh('GET', '/gists/' + p.gistId, token);
      if (chk.ok) return p.gistId;
    }
    var found = await gh('GET', '/gists?per_page=100', token);
    if (found.ok && Array.isArray(found.data)) {
      var hit = found.data.filter(function (g) { return g.description === GIST_DESC; })[0];
      if (hit) { p.gistId = hit.id; saveDB(db); return hit.id; }
    }
    var made = await gh('POST', '/gists', token, { description: GIST_DESC, public: false, files: { 'manifest.json': { content: '{"games":{}}' } } });
    if (!made.ok) throw new Error(made.err);
    p.gistId = made.data.id; saveDB(db);
    return p.gistId;
  }
  function gistName(game, slot) { return game + '__' + slot + '.json'; }
  async function ghManifest(token, game) {
    var id = await gistEnsure(token);
    var g = await gh('GET', '/gists/' + id, token);
    if (!g.ok) throw new Error(g.err);
    var files = g.data.files || {}, out = [];
    Object.keys(files).forEach(function (f) {
      if (f.indexOf(game + '__') !== 0) return;
      out.push({ slot: f.slice(game.length + 2).replace(/\.json$/, ''), updatedAt: files[f].truncated ? '' : readUpdated(g.data, f), id: f });
    });
    return out;
  }
  /** GitHub 不在文件列表里给修改时间，用 manifest.json 自己记 */
  function readUpdated(gist, fname) {
    try {
      var m = JSON.parse((gist.files['manifest.json'] || {}).content || '{}');
      return (m.games || {})[fname] || '';
    } catch (e) { return ''; }
  }
  async function ghFileGet(token, fname) {
    var id = loadDB().users[Account.currentUid()].providers.github.gistId;
    var g = await gh('GET', '/gists/' + id, token);
    if (!g.ok) return null;
    var f = (g.data.files || {})[fname];
    if (!f) return null;
    if (f.truncated) {
      var raw = await fetch(f.raw_url).then(function (r) { return r.text(); }).catch(function () { return null; });
      return raw ? JSON.parse(raw) : null;
    }
    try { return JSON.parse(f.content); } catch (e) { return null; }
  }
  async function ghFilePut(token, game, slot, data) {
    var id = await gistEnsure(token);
    var fname = gistName(game, slot);
    var g = await gh('GET', '/gists/' + id, token);
    var m = { games: {} };
    try { m = JSON.parse((g.data.files['manifest.json'] || {}).content || '{"games":{}}'); } catch (e) { /* 坏了就重建 */ }
    m.games = m.games || {}; m.games[fname] = nowISO();
    var files = {}; files[fname] = { content: JSON.stringify(data) };
    files['manifest.json'] = { content: JSON.stringify(m) };
    var r = await gh('PATCH', '/gists/' + id, token, { files: files });
    return r.ok;
  }

  /* ---------- OneDrive 云盘（应用文件夹 /dsh-saves/<game>/<slot>.json） ---------- */
  function msUrl(game, slot, suffix) {
    var base = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:';
    var p = '/dsh-saves/' + encodeURIComponent(game) + '/' + encodeURIComponent(slot) + '.json';
    return base + p + (suffix || '');
  }
  async function msManifest(token, game) {
    var res = await fetch('https://graph.microsoft.com/v1.0/me/drive/special/approot:/dsh-saves/' + encodeURIComponent(game) + ':/children', { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 404) return [];          // 还没上传过：应用文件夹里没有这个游戏（正常，不是错误）
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var r = await res.json();
    return (r.value || []).map(function (f) { return { slot: String(f.name).replace(/\.json$/, ''), updatedAt: f.lastModifiedDateTime }; });
  }
  async function msFileGet(token, game, slot) {
    var r = await fetch(msUrl(game, slot, ':/content'), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    try { return await r.json(); } catch (e) { return null; }
  }
  async function msFilePut(token, game, slot, data) {
    var r = await fetch(msUrl(game, slot, ':/content'), {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return r.ok;
  }

  Account._internal = { gh: gh, gistEnsure: gistEnsure, K: K, hashPassword: hashPassword };
  global.DSHAccount = Account;
})(window);
