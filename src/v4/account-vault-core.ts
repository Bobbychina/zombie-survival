/**
 * M29 账号库「记录级」加密（**纯逻辑**，DOM-free / 可单测）。
 *
 * ## 为什么还要这一层
 * 游戏自己的档（`zombie_survival_save_v2`）已经由 `save-vault.ts` 用 worker 里的
 * AES-GCM-256 加密了。但账号库（`src/account/account.js`，大厅与游戏共用）还有**第二条落盘链路**：
 *   · 本机：`DSHAccount.savePut()` 把存档**明文对象**写进 localStorage（`dsh.acc.save.*`）；
 *   · GitHub / OneDrive 那条云路：`ghFilePut()` 上传的也是**明文 JSON**（只有自建后端那条路自带口令加密）。
 * 用户的要求是「每次上传存档或者本地存储都经过这个加密」，所以这一层把账号库的**记录正文**
 * 也换成密文串：落盘、上云、Gist 里看到的都是 `ZSV2:` 开头的密文。
 *
 * ## 为什么必须"同步密码"
 * `account.js` 的 `saveGet()` 是**同步** API（被 `JSON.stringify`、被 pull→applySave 同步用），
 * 而 `crypto.subtle` 只有异步接口。所以这里：
 *   ① 密钥仍是 **worker 生成**的（`SaveVault.getKeyRaw`），主线程只拿一份原文给这条链路；
 *   ② 主线程按 **计数器前缀预生成 AES-CTR 密钥流**（异步一次、之后同步 XOR）；
 *   ③ 完整性 = 明文校验和（改一个字节就报错）+ 游戏自己的存档指纹（integrity.ts）双保险。
 * **前缀（16 字节计数器块的前 8 字节）必须进信封**：同步解密只有靠它才能重建同一段密钥流。
 * 只用"游标"不行 —— "加密一次 → 解密两次"就会把位置吃错（第一版就这么红的）。
 * 诚实边界：挡的是"存档在磁盘/Gist 上是明文"和"手改文件悄悄生效"，挡不住在控制台里改运行态
 * —— 纯前端游戏的解密能力必然在客户端。
 */

/* ── 小工具 ── */
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function b64to(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 明文校验和：长度 + FNV-1a（够抓"手改一个字符"） */
export function checksum(plain: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < plain.length; i++) { h ^= plain.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return plain.length.toString(36) + '-' + (h >>> 0).toString(36);
}

export const ENVELOPE_MAGIC = 'ZSV2:';
export const isEnvelope = (v: unknown): boolean => typeof v === 'string' && v.startsWith(ENVELOPE_MAGIC);

/* ── 同步密码：按计数器前缀预生成 AES-CTR 密钥流 ── */
export interface SyncCipherDeps {
  subtle: SubtleCrypto;
  /** 计数器前缀（浏览器里是 crypto.getRandomValues） */
  randomBytes(n: number): Uint8Array;
}

export interface SyncCipher {
  /** 备好 `[off, off+n)` 这段密钥流（加、解密都先调这个） */
  prepare(prefix: string, n: number, off?: number): Promise<void>;
  /** 同步加密：给了 prefix 就用它（必须已 prepare），否则随机挑一个（同样必须已 prepare） */
  encryptSync(plain: string, prefix?: string): { prefix: string; ct: string };
  /** 同步解密：必须用信封里带回来的那个前缀 */
  decryptSync(prefix: string, ct: string): string;
}

const BLOCK = 1 << 16;                        // 一次生成 64KB 密钥流

export function makeCipher(key: CryptoKey, deps: SyncCipherDeps): SyncCipher {
  /* prefix → 该前缀下的密钥流（同一前缀永远生成同一段字节，所以加解密起点都是 0） */
  const cache = new Map<string, Uint8Array>();

  const gen = async (prefix: Uint8Array, bytes: number): Promise<Uint8Array> => {
    const counter = new Uint8Array(16);
    counter.set(prefix.subarray(0, 8), 0);
    const out = await deps.subtle.encrypt(
      { name: 'AES-CTR', counter: counter as unknown as BufferSource, length: 64 },
      key, new Uint8Array(bytes) as unknown as BufferSource,
    );
    return new Uint8Array(out);
  };

  const ensure = async (prefixS: string, need: number): Promise<Uint8Array> => {
    const had = cache.get(prefixS);
    if (had && had.length >= need) return had;
    const bytes = Math.max(BLOCK, need + 16);
    const buf = await gen(b64to(prefixS), bytes);
    if (cache.size > 48) { const first = cache.keys().next().value; if (first !== undefined && first !== prefixS) cache.delete(first); }
    cache.set(prefixS, buf);
    return buf;
  };

  const stream = (prefixS: string, len: number): Uint8Array => {
    const buf = cache.get(prefixS);
    if (!buf || buf.length < len) throw new Error('密钥流没备好（先 await prepare(prefix, len)）');
    return buf;
  };

  return {
    async prepare(prefix: string, n: number, _off = 0): Promise<void> { await ensure(prefix, Math.max(0, n)); },
    encryptSync(plain: string, prefix?: string) {
      const p = prefix ?? b64of(deps.randomBytes(8));
      const data = enc.encode(plain);
      /* 同步 API 里不能 await —— 调用方必须**先** `await prepare(p, data.length)` 备好这段流 */
      const ks = stream(p, data.length);
      for (let i = 0; i < data.length; i++) data[i] ^= ks[i];
      return { prefix: p, ct: b64of(data) };
    },
    decryptSync(prefix: string, ct: string): string {
      const bytes = b64to(ct);
      const ks = stream(prefix, bytes.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks[i];
      return dec.decode(bytes);
    },
  };
}

/* ── 记录信封：`ZSV2:<校验和>:<前缀>:<密文>` ── */

/** 生一个计数器前缀（信封里要带着它走，否则冷读时重建不出同一段密钥流） */
export const newPrefix = (deps: SyncCipherDeps): string => b64of(deps.randomBytes(8));

/** 建信封：`prefix` 必须已经 `await prepare(prefix, bytes)` 过 */
export function sealText(c: SyncCipher, plain: string, prefix?: string): string {
  const { prefix: p, ct } = c.encryptSync(plain, prefix);
  return ENVELOPE_MAGIC + checksum(plain) + ':' + p + ':' + ct;
}
/** 信封拆解：`{ sig(明文校验和), prefix, ct, bytes }`；不合法返回 null */
export function parseEnvelope(text: string): { sig: string; prefix: string; ct: string; bytes: number } | null {
  if (!isEnvelope(text)) return null;
  const parts = text.slice(ENVELOPE_MAGIC.length).split(':');
  if (parts.length !== 3) return null;
  try { return { sig: parts[0], prefix: parts[1], ct: parts[2], bytes: b64to(parts[2]).length }; } catch { return null; }
}
/** 信封里密文的字节数（不合法返回 0）——调用方用它决定 prepare 多长 */
export function envelopeBytes(text: string): number { return parseEnvelope(text)?.bytes ?? 0; }

export function unsealText(c: SyncCipher, text: string): string {
  const env = parseEnvelope(text);
  if (!env) throw new Error('不是账号库加密存档');
  const plain = c.decryptSync(env.prefix, env.ct);
  const want = text.slice(ENVELOPE_MAGIC.length).split(':')[0];
  if (checksum(plain) !== want) throw new Error('存档校验和不匹配（被改过？）');
  return plain;
}

/* ── 存档对象 ↔ 密文串 ── */
export const worthSealing = (data: unknown): boolean => !!data && typeof data === 'object';

/** 把一个存档对象封成密文串；打包不了（循环引用等）返回 null */
export function sealSave(c: SyncCipher, data: unknown, prefix?: string): string | null {
  if (!worthSealing(data)) return null;
  try { return sealText(c, JSON.stringify(data), prefix); } catch { return null; }
}
export function unsealSave(c: SyncCipher, text: string): unknown {
  try { return JSON.parse(unsealText(c, text)); } catch { return null; }
}

/* ── M42：账号库那份副本"解不开"时的处理策略 ──
   背景（用户报障原话「什么鬼」）：acccount-vault 里有个 15 秒一次的预热循环，每轮都对每个槽
   `hydrate()` 一次；只要那份副本是用**旧密钥**写的（换过浏览器 / 清过站点数据），
   每 15 秒就往日志里甩一行「⚠️ 账号库里那份存档解不开」——挂机十分钟就是四十行。
   策略（纯函数，便于单测）：
   ① warn：只在**第一次**警告，绝不刷屏；
   ② retry：解不开之后不再反复试同一份（省 CPU / 省日志），直到有人写了新副本；
   ③ heal：手里有"当前进度"当兜底时，直接**用它重建**这份副本（自愈，比一直提示有用）。 */
export function unreadablePolicy(state: { warned: boolean; hasFallback: boolean }): { warn: boolean; retry: boolean; heal: boolean } {
  if (!state.warned) return { warn: true, retry: false, heal: state.hasFallback };
  return { warn: false, retry: false, heal: state.hasFallback };
}
/** 给"这份副本解不开"的日志加一句人话（要能说清"你的进度没事"） */
export function unreadableHint(hasFallback: boolean): string {
  return hasFallback
    ? '账号库里那份是旧密钥写的，本机解不开 —— 已用当前进度重建（本地进度一直没事）。'
    : '账号库里那份存档解不开（换过浏览器 / 清过站点数据？）—— 本地进度不受影响；下次「存档到账号」会用当前进度覆盖它。';
}
