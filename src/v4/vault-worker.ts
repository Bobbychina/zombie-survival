/**
 * M29 存档保险箱 Worker —— **纯 JS**（故意不用 TS 语法）。
 *
 * 为什么：这个文件的内容会被**原样**内联进主线程模块（单文件构建用 blob URL 起 worker），
 * 内联是"文本搬运"、不过编译器 —— 写成 TS 的话产物里会留着 `<Req>`、`Partial<Res>` 这类注解，
 * Worker 一建就语法错误（第一版就是这么踩的：密钥逻辑没错，但 worker 起不来 → 悄悄降级成主线程）。
 * 所以这里用 JSDoc 标注类型、并整体 `@ts-nocheck` 跳过 tsc（正文的合法性由 `node --check` + 浏览器探针保证）。
 *
 * ## 这个 worker 干什么
 *  - 生成/持有 **AES-GCM-256** 密钥（`extractable:false`，连它自己都导不出原始字节）；
 *  - 密钥存 IndexedDB（存的是 CryptoKey 对象本身），主线程**拿不到密钥**，只能请它加密/解密；
 *  - 每次加密用随机 12 字节 IV，密文前缀 `ZSV1:`；
 *  - `raw` 操作把密钥原文交给主线程 —— **只给账号库那条同步链路用**（account.js 的记录读写是同步的，
 *    只能用主线程 CryptoKey 解，而同步 API 拿不到 IndexedDB 里的不可导出密钥）。见 account-vault.ts。
 *
 * 诚实边界：纯前端游戏的解密能力一定在客户端，这套设计挡的是"存档在磁盘/云上是明文"
 * 与"手改文件会悄悄生效"，挡不住在控制台里直接改运行中的状态。
 */

/* eslint-disable no-var */
/* 这个文件**故意关掉 tsc 检查**：它的正文会被原样内联成一段字符串、再作为 Worker 脚本运行，
   所以正文必须是"合法的 JS 源码"而不是"TS 转译前的源码"。tsc 对匿名 Promise 回调（`res()` 的参数）
   与 `keyCache` 的窄化有意见，但那些都是类型推断问题，运行时完全正确 ——
   所以这里宁可 `@ts-nocheck`，用 `node --check` 与浏览器里的探针来保证它的正确性。 */
// @ts-nocheck

/** @typedef {{ id: number, op: 'key'|'enc'|'dec'|'wipe'|'status', data?: string }} Req */
/** @typedef {{ id: number, ok: boolean, data?: string, error?: string }} Res */

var DB_NAME = 'zsv-vault';
var STORE_NAME = 'keys';
var KEY_ID = 'save-key-v1';
var MAGIC = 'ZSV1:';
var DB_VER = 2;
/* 主钥匙**绝不导出**：它只用来加解密游戏主档（zombie_survival_save_v2）。
   账号库那条同步链路要的是密钥原文，走下面的 `raw` 操作 —— 那把会另存在 RAW_ID 里、天生可导出，见 rawKey()。 */
var GEN_EXTRACTABLE = false;

/** 缓存的密钥（不可导出） @type {any} */
var keyCache = null;

/** @param {number} ver @returns {Promise<any>} */
function openDb(ver) {
  return new Promise(function (res, rej) {
    var rq = indexedDB.open(DB_NAME, ver || DB_VER);
    rq.onupgradeneeded = function () {
      var db = rq.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    rq.onsuccess = function () { res(rq.result); };
    rq.onerror = function () { rej(rq.error); };
  });
}

/** @param {string} k @returns {Promise<any>} */
function idbGet(k) {
  return openDb().then(function (db) {
    return new Promise(function (res, rej) {
      var rq = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(k);
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  });
}

/** @param {string} k @param {any} v @returns {Promise<any>} */
function idbPut(k, v) {
  return openDb().then(function (db) {
    return new Promise(function (res, rej) {
      var rq = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(v, k);
      rq.onsuccess = function () { res(true); };
      rq.onerror = function () { rej(rq.error); };
    });
  });
}

/** @param {string} k @returns {Promise<any>} */
function idbDel(k) {
  return openDb().then(function (db) {
    return new Promise(function (res, rej) {
      var rq = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(k);
      rq.onsuccess = function () { res(true); };
      rq.onerror = function () { rej(rq.error); };
    });
  });
}

/** 导出密钥原文（b64）——只给账号库那条同步链路用 @param {any} k @returns {Promise<string|null>} */
function exportRaw(k) {
  if (!k || !k.extractable) return Promise.resolve(null);
  return crypto.subtle.exportKey('raw', k).then(function (raw) { return b64(raw); }).catch(function () { return null; });
}

/** 取（或首次生成）主钥匙：CryptoKey 存在 IndexedDB 里，**不可导出**，只服务游戏主档 @returns {Promise<any>} */
function getKey() {
  if (keyCache) return Promise.resolve(keyCache);
  /* 先按 v2 打开（顺带升级老库）；被别处的旧连接挡住时退回 v1 读 */
  var open = openDb(DB_VER);
  var guard = new Promise(function (res) { setTimeout(function () { res(null); }, 2500); });
  return Promise.race([open.catch(function () { return null; }), guard]).then(function (db) {
    if (!db) return openDb(1).catch(function () { return null; });
    return db;
  }).then(function (db) {
    if (!db) throw new Error('IndexedDB 打不开（无痕模式？）');
    return new Promise(function (res, rej) {
      var rq = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY_ID);
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    }).catch(function () { return null; });
  }).then(function (k) {
    if (k && !k.extractable) { keyCache = k; return k; }
    /* 老库里的主钥匙是可导出的（M29 早期为了账号库那条同步链路临时这么生成过）——
       不重新生成（那会把已有存档全变成解不开的密文），而是**降级修复**：
       把原文复制到账号库钥匙位，再把主钥匙换成不可导出的同值密钥写回。 */
    if (k && k.extractable) return repairKey(k);
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, GEN_EXTRACTABLE, ['encrypt', 'decrypt'])
      .then(function (nk) { return idbPut(KEY_ID, nk).then(function () { keyCache = nk; return nk; }); });
  });
}

/** 把一把"可导出的主钥匙"修成"不可导出"，同时保证账号库还能拿到原文 */
function repairKey(k) {
  return exportRaw(k).then(function (b) {
    if (!b) return k;
    rawCache = b;
    var keep = idbPut(RAW_ID, b).then(function () { return idbPut(RAW_ID + ':params', { tag: 'legacy' }); });
    return keep.then(function () {
      return crypto.subtle.importKey('raw', unb64(b), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }).then(function (safe) {
      return idbPut(KEY_ID, safe).then(function () { keyCache = safe; return safe; });
    });
  });
}

/** 账号库那把钥匙的存放位置（`save-key-v1` 是主钥匙、**不可导出**，两把必须分开） */
var RAW_ID = 'account-key-v1';
var rawCache = null;
var rawParams = null;

/** 取（或生成）账号库那把钥匙的原文 b64 @param {any} params @returns {Promise<string>} */
function rawKey(params) {
  var want = String((params && params.tag) || 'default');
  var ready = rawCache ? Promise.resolve(rawCache) : idbGet(RAW_ID).then(function (b) { return typeof b === 'string' ? b : null; });
  return ready.then(function (have) {
    return Promise.all([have ? Promise.resolve(rawParams) : getParams(), Promise.resolve(have)]).then(function (r) {
      var p = r[0], b64raw = r[1];
      if (b64raw && p && p.tag === want) { rawCache = b64raw; return b64raw; }
      return freshRawKey(params || { tag: want });
    });
  });
}

/** 生成一把可导出的新钥匙（**只给账号库那条同步链路**），记为当前账号库钥匙 */
function freshRawKey(params) {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']).then(function (nk) {
    return exportRaw(nk).then(function (b) {
      if (!b) throw new Error('生成的钥匙导不出原文');
      rawCache = b; rawParams = params;
      return idbPut(RAW_ID, b).then(function () {
        return idbPut(RAW_ID + ':params', params).then(function () { return b; });
      });
    });
  });
}

/** 旧库兼容：早先版本把"可导出"的钥匙存在主钥匙位上 —— 搬一份到账号库钥匙位，让已加密的账号档还能读 */
function adoptLegacyRawKey() {
  return getKey().then(function (k) {
    return exportRaw(k).then(function (b) {
      if (!b) return null;
      rawCache = b; rawParams = { tag: 'legacy' };
      return idbPut(RAW_ID, b).then(function () { return idbPut(RAW_ID + ':params', { tag: 'legacy' }); }).then(function () { return b; });
    });
  });
}

/** 密钥参数（按 tag 区分用途） @returns {Promise<any>} */
function getParams() { return idbGet(RAW_ID + ':params').catch(function () { return null; }); }

/** @param {ArrayBuffer|Uint8Array} buf @returns {string} */
function b64(buf) {
  var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** @param {string} s @returns {Uint8Array} */
function unb64(s) {
  var bin = atob(s);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {string} plain @returns {Promise<string>} */
function encrypt(plain) {
  return getKey().then(function (k) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(plain)).then(function (ct) {
      return MAGIC + b64(iv) + ':' + b64(ct);
    });
  });
}

/** @param {string} text @returns {Promise<string>} */
function decrypt(text) {
  if (text.indexOf(MAGIC) !== 0) return Promise.reject(new Error('这段数据不是本机保险箱的格式'));
  var rest = text.slice(MAGIC.length);
  var i = rest.indexOf(':');
  if (i < 0) return Promise.reject(new Error('存档格式损坏'));
  var iv = unb64(rest.slice(0, i));
  var ct = unb64(rest.slice(i + 1));
  return getKey().then(function (k) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct).then(function (pt) {
      return new TextDecoder().decode(pt);
    });
  });
}

/** worker 的 `self` 在 DOM lib 里是 window 类型（没有 postMessage/onmessage）—— 这里窄化一次 */
var workerScope = /** @type {any} */ (self);

workerScope.onmessage = function (e) {
  var req = e.data;
  var reply = function (r) { workerScope.postMessage(Object.assign({ id: req.id }, r)); };
  var fail = function (err) { reply({ ok: false, error: (err && err.message) ? err.message : String(err) }); };
  try {
    if (req.op === 'key') {
      getKey().then(function () { reply({ ok: true, data: 'ready' }); }).catch(fail);
    } else if (req.op === 'enc') {
      encrypt(String(req.data || '')).then(function (out) { reply({ ok: true, data: out }); }).catch(fail);
    } else if (req.op === 'dec') {
      decrypt(String(req.data || '')).then(function (out) { reply({ ok: true, data: out }); }).catch(fail);
    } else if (req.op === 'raw') {
      rawKey(req.params)
        .then(function (out) { reply({ ok: true, data: out }); })
        .catch(function () { return adoptLegacyRawKey(); })          // 旧库里主钥匙可导出 → 搬一份给账号库
        .then(function (out) { if (out) reply({ ok: true, data: out }); else reply({ ok: false, error: '拿不到账号库钥匙' }); })
        .catch(fail);
    } else if (req.op === 'wipe') {
      keyCache = null; rawCache = null;
      idbDel(KEY_ID).then(function () { return idbDel(RAW_ID).catch(function () { return null; }); })
        .then(function () { return idbDel(KEY_ID + ':params').catch(function () { return null; }); })
        .then(function () { return idbDel(RAW_ID + ':params').catch(function () { return null; }); })
        .then(function () { reply({ ok: true }); }).catch(fail);
    } else if (req.op === 'status') {
      idbGet(KEY_ID).catch(function () { return null; }).then(function (k) { reply({ ok: true, data: k ? 'key-present' : 'no-key' }); });
    } else {
      reply({ ok: false, error: 'unknown op' });
    }
  } catch (err) { fail(err); }
};
