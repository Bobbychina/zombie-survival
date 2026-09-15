/**
 * M29 存档保险箱（主线程这一侧）：**所有本地存档都走加密**。
 *
 * 用户的要求（原话）：
 *   「强制云端存档或者本地存档，不做可直接导出存档」+「生成 128 位加密密钥放在 worker 里面，
 *     每次上传存档或者本地存储都经过这个加密」
 *
 * 所以这里做三件事：
 *  ① 存档落到 localStorage 之前**一定**经过 worker 的 AES-GCM-256（密文前缀 `ZSV1:`）；
 *  ② 老版本留下的明文存档在**首次启动时自动迁移**成密文，并把明文键删掉（不让读者的旧进度丢）；
 *  ③ 「导出/导入存档」这对按钮**从菜单里去掉了** —— 玩家不再需要（也不该）直接搬运明文。
 *     本机另留一份**加密备份**（`SAVE_KEY.bak` 也是密文），供"主档写坏"时回滚。
 *
 * 读取路径为什么是**同步**的：legacy 的 boot() 是同步流程（读档 → 迁移 → 渲染）。
 * 所以启动时先把密文解出来缓存在内存里，`read()` 同步返回；写入是异步的（加密 + 落盘），
 * 但内存缓存立刻更新 —— 玩家感受不到延迟，autosave 也不会卡住主线程。
 *
 * Worker 不可用时（file:// 或老浏览器）自动降级成**主线程里的 CryptoKey**：
 * 安全性略低一档（密钥对象在主线程），但仍然是 AES-GCM、仍然是 `extractable:false`
 * （拿不到原始字节），而且**存档一样不是明文**。
 */

import { VAULT_WORKER_SRC } from './vault-worker-src';

/** worker 源码：源仓库里 vault-worker-src.ts 是占位符，构建期被 tools/inline-worker.mjs 换成真源码 */
const WORKER_SRC = VAULT_WORKER_SRC;
const MAGIC = 'ZSV1:';

export interface VaultState {
  mode: 'worker' | 'main-thread' | 'none';
  ready: boolean;
  cached: string | null;      // 已解密的内存副本（给同步读取用）
  lastError?: string;
}

const st: VaultState = { mode: 'none', ready: false, cached: null };

/* ── 降级路径：主线程 CryptoKey，密钥存 IndexedDB ── */
const DB = 'zsv-vault', STORE = 'keys', KEY_ID = 'save-key-v1', PARAMS_ID = 'save-key-v1:params';
/* M29 另一半：账号库（src/account/account.js）的存档记录读写是**同步**的，只有主线程 CryptoKey 用得上，
   所以那把密钥必须可导出。工作密钥仍然按"生成时 false → 迁移时换成 true"，落盘的那把不导出。 */
const MAIN_GEN_EXTRACTABLE = true;
let mainKey: CryptoKey | null = null;
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 2);
    rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
function idbGet<T>(k: string): Promise<T | undefined> {
  return openDb().then(db => new Promise<T | undefined>((res, rej) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
    tx.onsuccess = () => res(tx.result as T | undefined);
    tx.onerror = () => rej(tx.error);
  }));
}
function idbPut(k: string, v: unknown): Promise<void> {
  return openDb().then(db => new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k);
    tx.onsuccess = () => res();
    tx.onerror = () => rej(tx.error);
  }));
}
async function mainGetKey(): Promise<CryptoKey> {
  if (mainKey) return mainKey;
  let k = await idbGet<CryptoKey>(KEY_ID).catch(() => undefined);
  if (!k) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, MAIN_GEN_EXTRACTABLE, ['encrypt', 'decrypt']); await idbPut(KEY_ID, k); }
  mainKey = k;
  return k;
}
/** 密钥原文（b64）：只给账号库那条同步链路用；拿不到原文（老版本留下的不可导出密钥）就返回 null */
export async function mainGetKeyRaw(): Promise<string | null> {
  const k = await mainGetKey();
  if (!k.extractable) return null;
  try { return b64(await crypto.subtle.exportKey('raw', k)); } catch { return null; }
}
const b64 = (buf: ArrayBufferLike): string => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function mainEncrypt(plain: string): Promise<string> {
  const k = await mainGetKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain));
  return MAGIC + b64(iv.buffer) + ':' + b64(ct);
}
async function mainDecrypt(text: string): Promise<string> {
  if (!text.startsWith(MAGIC)) throw new Error('不是本机加密存档');
  const rest = text.slice(MAGIC.length);
  const i = rest.indexOf(':');
  if (i < 0) throw new Error('存档格式损坏');
  const k = await mainGetKey();
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rest.slice(0, i)) as unknown as BufferSource }, k, unb64(rest.slice(i + 1)) as unknown as BufferSource);
  return new TextDecoder().decode(pt);
}

/* ── worker 通道 ── */
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: { ok: boolean; data?: string; error?: string }) => void>();

/** worker 挂了（脚本语法错误 / 被 CSP 拦 / 崩了）时，**必须把在等的请求全部结掉** ——
    否则 `await callWorker(...)` 永远不 resolve，整个 boot 卡死（实测过：worker 源码有问题时
    游戏界面出不来，因为 main() 停在 SaveVault.init() 上）。 */
function failAllPending(err: string): void {
  for (const [id, cb] of Array.from(waiting.entries())) { waiting.delete(id); cb({ ok: false, error: err }); }
}
function killWorker(why: string): void {
  st.lastError = why;
  try { worker?.terminate(); } catch { /* 忽略 */ }
  worker = null;
  failAllPending(why);
}

function callWorker(op: 'key' | 'enc' | 'dec' | 'wipe' | 'status' | 'raw', data?: string, params?: unknown): Promise<{ ok: boolean; data?: string; error?: string }> {
  if (!worker) return Promise.resolve({ ok: false, error: 'worker 不可用' });
  const id = ++seq;
  return new Promise((res) => {
    waiting.set(id, res);
    try {
      worker!.postMessage({ id, op, data, params });
    } catch (e) {
      waiting.delete(id);
      res({ ok: false, error: 'postMessage 失败：' + (e instanceof Error ? e.message : String(e)) });
      return;
    }
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); res({ ok: false, error: 'worker 超时' }); } }, 8000);
  });
}

function bootWorker(): boolean {
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return false;
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; data?: string; error?: string }>) => {
      const cb = waiting.get(e.data.id);
      if (cb) { waiting.delete(e.data.id); cb(e.data); }
    };
    /* 脚本本身编译失败时走这里（blob worker 的语法错误不会抛到主线程，只能靠事件）。
       **必须把在等的请求结掉**：否则 await callWorker 永不 resolve，boot 卡死在 init() 上 ——
       实测就是这么卡住的（worker 源码有问题时整局游戏起不来）。 */
    worker.onerror = (ev: ErrorEvent) => killWorker('worker 脚本错误：' + (ev.message || 'unknown'));
    worker.onmessageerror = () => killWorker('worker 消息无法反序列化');
    return true;
  } catch { worker = null; return false; }
}

async function encryptText(plain: string): Promise<string> {
  if (worker) {
    const r = await callWorker('enc', plain);
    if (r.ok && r.data) return r.data;
  }
  st.mode = 'main-thread';
  return mainEncrypt(plain);
}
async function decryptText(text: string): Promise<string> {
  if (worker && text.startsWith(MAGIC)) {
    const r = await callWorker('dec', text);
    if (r.ok && typeof r.data === 'string') return r.data;
    /* worker 解不开就退回主线程密钥：换过浏览器/清过 IndexedDB 时会走到这里 */
  }
  return mainDecrypt(text);
}

export const SaveVault = {
  /** 启动时调用一次：起 worker、要密钥、把磁盘上的密文解进内存（**同步读**就靠它）。
      外面再套一层总超时：**init 绝不允许把 boot 卡住**（起不来就降级成主线程密钥）。 */
  async init(): Promise<VaultState> {
    await Promise.race([this.initInner(), new Promise<void>((res) => setTimeout(res, 4000))]);
    st.ready = true;
    return { ...st };
  },
  async initInner(): Promise<void> {
    const canWorker = bootWorker();
    if (canWorker) {
      const r = await callWorker('key');
      st.mode = r.ok ? 'worker' : 'main-thread';
      if (!r.ok) st.lastError = r.error || 'worker 未就绪';
    } else {
      st.mode = 'main-thread';
    }
    try {
      const raw = localStorage.getItem('zombie_survival_save_v2');
      if (raw) {
        if (raw.startsWith(MAGIC)) {
          st.cached = await decryptText(raw);
        } else {
          /* 老版本的明文存档：读出来 → 立刻加密写回 → 删掉明文（迁移只有这一次） */
          st.cached = raw;
          const enc = await encryptText(raw);
          localStorage.setItem('zombie_survival_save_v2', enc);
          try { localStorage.removeItem('zombie_survival_save_v2.plain'); } catch { /* 忽略 */ }
        }
      }
      const bak = localStorage.getItem('zombie_survival_save_v2.bak');
      if (bak && !bak.startsWith(MAGIC)) {
        const enc = await encryptText(bak);
        localStorage.setItem('zombie_survival_save_v2.bak', enc);
      }
    } catch (e) {
      st.lastError = e instanceof Error ? e.message : String(e);
    }
  },

  /** 同步读（boot 用）：内存缓存里那份解密后的 JSON */
  read(): string | null { return st.cached; },
  readBackup(): string | null { return null; },       // 备份是密文，异步读（见 loadBackup）

  /** 异步读备份（"主档坏了回滚"用）：解出来给调用方 */
  async loadBackup(): Promise<string | null> {
    const raw = localStorage.getItem('zombie_survival_save_v2.bak');
    if (!raw) return null;
    try { return raw.startsWith(MAGIC) ? await decryptText(raw) : raw; } catch { return null; }
  },

  /** 写（autosave / 手动保存）：内存缓存立刻更新，落盘是加密后的密文 */
  write(plain: string, opts: { backup?: boolean; backupRaw?: string | null } = {}): void {
    st.cached = plain;
    const run = async () => {
      try {
        const enc = await encryptText(plain);
        if (opts.backup && opts.backupRaw) {
          try {
            const bakEnc = opts.backupRaw.startsWith(MAGIC) ? opts.backupRaw : await encryptText(opts.backupRaw);
            localStorage.setItem('zombie_survival_save_v2.bak', bakEnc);
          } catch { /* 备份写失败不影响主档 */ }
        }
        localStorage.setItem('zombie_survival_save_v2', enc);
      } catch (e) {
        st.lastError = e instanceof Error ? e.message : String(e);
      }
    };
    void run();
  },

  /** 加密一段文本（云存档上传前用） */
  async encrypt(plain: string): Promise<string> { return encryptText(plain); },
  /** 解密一段文本（云存档下载后用） */
  async decrypt(text: string): Promise<string> { return decryptText(text); },

  /** 密钥原文（b64）——只给账号库那条**同步**链路用（见 account-vault.ts）。
      拿不到（老版本留下的不可导出密钥 / IndexedDB 不可用）就返回 null，调用方按"没加密"处理。 */
  async getKeyRaw(params?: { tag?: string }): Promise<string | null> {
    if (worker) {
      const r = await callWorker('raw', undefined, params);
      if (r.ok && typeof r.data === 'string' && r.data) return r.data;
    }
    st.mode = 'main-thread';
    return mainGetKeyRaw();
  },

  /** 抹掉本机密钥与存档（"清档"用；清了就再也解不开旧密文，属于用户明确要求的操作） */
  async wipe(): Promise<void> {
    st.cached = null;
    if (worker) await callWorker('wipe');
    try { await idbDel(KEY_ID); } catch { /* 忽略 */ }
    mainKey = null;
  },

  status(): VaultState { return { ...st }; },
  /** 探针/调试：当前是不是"存档已加密"状态 */
  isEncryptedSave(text: string): boolean { return text.startsWith(MAGIC); },
};

export const VAULT_MAGIC = MAGIC;
