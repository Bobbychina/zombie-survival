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
  };
  var listeners = [];
  var popup = null;

  /* ---------- 小工具 ---------- */
  function cfg() {
    var c = global.DSH_AUTH_CONFIG || {};
    return {
      github: Object.assign({ clientId: '', scope: 'gist read:user' }, c.github || {}),
      microsoft: Object.assign({ clientId: '', tenant: 'common', scope: 'openid profile offline_access User.Read Files.ReadWrite.AppFolder' }, c.microsoft || {}),
      redirect: c.redirect || (location.origin + '/games/oauth-callback.html'),
    };
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
    return { uid: u.uid, name: u.name, email: u.email || '', createdAt: u.createdAt, providers: p,
      hasPassword: !!u.hash, saveGames: Object.keys(u.games || {}) };
  }

  var Account = {
    version: VERSION,
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
      var salt = b64url(bytes(16));
      var hash = await hashPassword(pass, salt, PBKDF2_ITER);
      var u = { uid: uid(), name: name, email: String((opts && opts.email) || ''), salt: salt, hash: hash,
        iter: PBKDF2_ITER, createdAt: nowISO(), providers: {}, games: {} };
      db.users[u.uid] = u;
      var w = saveDB(db);
      if (!w.ok) return { ok: false, err: w.err };
      Account._setSession(u.uid);
      emit();
      return { ok: true, uid: u.uid, user: publicUser(u) };
    },
    login: async function (opts) {
      var name = String((opts && opts.name) || '').trim().toLowerCase();
      var pass = String((opts && opts.password) || '');
      var db = loadDB();
      var u = Object.keys(db.users).map(function (k) { return db.users[k]; })
        .filter(function (x) { return x.name.toLowerCase() === name; })[0];
      if (!u) return { ok: false, err: '没有这个账号（先注册）' };
      if (!u.hash) return { ok: false, err: '这个账号是用第三方登录建的，请用「' + Object.keys(u.providers || {}).join('/') + '」登录' };
      var h = await hashPassword(pass, u.salt, u.iter || PBKDF2_ITER);
      if (!safeEqual(h, u.hash)) return { ok: false, err: '密码不对' };
      Account._setSession(u.uid);
      emit();
      return { ok: true, uid: u.uid, user: publicUser(u) };
    },
    logout: function () { removeKey(K.session); emit(); return { ok: true }; },
    /** 会话：uid + 过期时间，存在 localStorage（同一台设备免登录） */
    _setSession: function (u) {
      writeJSON(K.session, { uid: u, exp: Date.now() + SESSION_DAYS * 86400000 });
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
    /** 删账号 = 删本地记录 + 本地存档（云端 gist/OneDrive 里的文件需要用户自己去删） */
    deleteAccount: function (confirmName) {
      var db = loadDB(), id = Account.currentUid(), u = db.users[id];
      if (!u) return { ok: false, err: '先登录' };
      if (String(confirmName || '').trim() !== u.name) return { ok: false, err: '名字不匹配' };
      Object.keys(u.games || {}).forEach(function (g) {
        Account.slots(g).forEach(function (s) { Account.saveDelete(g, s.slot, true); });
        removeKey(K.manifest(id, g));
      });
      delete db.users[id];
      saveDB(db);
      removeKey(K.session);
      emit();
      return { ok: true };
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
    /** extra 里可以带 refresh/exp（OAuth App 勾了「Expire user access tokens」时 GitHub 会发刷新令牌） */
    bindGitHubToken: async function (token, extra) {
      token = String(token || '').trim();
      if (!/^(gh[pousr]_|github_pat_)/.test(token)) return { ok: false, err: '这不像 GitHub 令牌（应以 ghp_ / github_pat_ 开头）' };
      var me = await gh('GET', '/user', token);
      if (!me.ok) return { ok: false, err: '令牌无效或缺少权限：' + me.err };
      return Account._bind('github', Object.assign({
        token: token, login: me.data.login, name: me.data.name || me.data.login,
        avatar: me.data.avatar_url, boundAt: nowISO(),
      }, extra || {}));
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
      /* 换 token：先试 form（简单请求，不触发预检），再试 json。历史上这条接口不给 CORS 头，
         但"预检没过"和"完全没开 CORS"是两回事——两种都试过才知道属于哪种。 */
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
     *  同样先用 form（不触发预检）再退到 json。 */
    bindGitHubDevice: async function (onCode) {
      var c = cfg().github;
      if (!c.clientId) return { ok: false, err: '还没配 GitHub client_id（见 /games/auth-config.js）' };
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
    unbind: function (provider) {
      var db = loadDB(), u = db.users[Account.currentUid()];
      if (!u || !u.providers || !u.providers[provider]) return { ok: false, err: '没绑定这个' };
      delete u.providers[provider];
      saveDB(db); emit();
      return { ok: true };
    },
    _bind: function (provider, data) {
      var db = loadDB(), u = db.users[Account.currentUid()];
      if (!u) return { ok: false, err: '先登录' };
      u.providers = u.providers || {};
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
        if (!p.exp || Date.now() < p.exp) return p.token;
        if (!p.refresh) return null;                     // 过期的长期令牌只能重新绑定
        /* OAuth App 开了「Expire user access tokens」时：用 refresh_token 换新的一对 */
        var c = cfg().github;
        var nt = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_id: c.clientId, grant_type: 'refresh_token', refresh_token: p.refresh }),
        }).then(function (x) { return x.json(); }).catch(function () { return {}; });
        if (!nt.access_token) return null;
        p.token = nt.access_token;
        p.refresh = nt.refresh_token || p.refresh;
        p.exp = Date.now() + (nt.expires_in || 28800) * 1000 - 60000;
        saveDB(db);
        return p.token;
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
    /** 把本地某游戏的槽位与云端对齐：谁新用谁；返回 {pulled, pushed, provider, err?} */
    syncNow: async function (game) {
      var u = Account.current();
      if (!u) return { ok: false, err: '先登录' };
      var provider = u.providers.github ? 'github' : (u.providers.microsoft ? 'microsoft' : null);
      if (!provider) return { ok: false, err: '还没绑定 GitHub 或微软账号，只能在本地存' };
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
      var provider = u.providers.github ? 'github' : (u.providers.microsoft ? 'microsoft' : null);
      if (!provider) return { ok: false, err: '还没绑定云账号' };
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
      var provider = u.providers.github ? 'github' : (u.providers.microsoft ? 'microsoft' : null);
      if (!provider) return { ok: false, err: '还没绑定云账号' };
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
      var provider = u.providers.github ? 'github' : (u.providers.microsoft ? 'microsoft' : null);
      if (!provider) return { ok: false, err: '未绑定云账号' };
      var token = await Account._cloudToken(provider);
      if (!token) return { ok: false, err: '云令牌失效' };
      try {
        var remote = provider === 'github' ? await ghManifest(token, game) : await msManifest(token, game);
        return { ok: true, provider: provider, remote: remote };
      } catch (e) { return { ok: false, err: e.message }; }
    },
    /** 删掉云端某个槽位（GitHub：files[name]=null；Graph：DELETE 到条目路径） */
    cloudDelete: async function (game, slot) {
      var u = Account.current(); if (!u) return { ok: false, err: '先登录' };
      var provider = u.providers.github ? 'github' : (u.providers.microsoft ? 'microsoft' : null);
      if (!provider) return { ok: false, err: '未绑定云账号' };
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
