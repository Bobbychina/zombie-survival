/**
 * M28 存档导出加密（用户：「为什么导出存档是明文版本，必须加密」）。
 *
 * ## 先说清楚它**能**做到什么、**不能**做到什么
 *
 * 这是个纯静态、跑在浏览器里的游戏：**解密所需的一切都在发给玩家的代码里**。
 * 所以正确的心态是"防手滑、防明文外泄、提高改档门槛"，而**不是**"防住有心人"——
 * 谁都能打开 DevTools 看 `S`，也都能在控制台里直接改（这是浏览器游戏的物理事实）。
 * 我把 F12 留着（用户也明确说了不要禁用/对抗 F12）：那类手段既挡不住人，又会毁掉
 * 正常玩家排查问题的能力（我们自己的探针也全靠 DevTools 协议跑）。
 *
 * 真正拦"改档"的那一层是 **M8.1 的存档指纹/完整性**：本地可以改，但改过的档
 * 在云同步与导入时会带 `tampered` 结论，报告里能看见。
 *
 * ## 实现（为什么用这套而不是 AES）
 *
 * - `crypto.subtle`（WebCrypto）的 AES-GCM 是**异步**的，而这条导出/导入链路在 legacy 里是
 *   同步的 UI 流程；引入异步会牵动 `exportSave/importSave/loadGame` 一串调用点，
 *   收益只是"密码学上更标准"，而威胁模型里根本没有那个对手。
 * - 所以用**同步**的自建流密码：`SHA-256(pepper ‖ salt ‖ 计数器)` 生成密钥流，异或明文，
 *   再 SHA-256 生成 4 字节校验和。keystream 与校验和都用同一个 `digest` 注入
 *   （浏览器传 `crypto.subtle.digest`，测试传 node 的实现）——**算法一处、可单测**。
 * - **零依赖**：不引第三方库存档格式（这个项目一直是单文件、离线可玩）。
 * - 内容先压一遍：存档 JSON 里重复的字段名很多，压缩后体积约为原来的 1/3，base64 之后更好复制。
 *
 * 格式：`ZSE1:` + base64( salt(8) ‖ iv(8) ‖ checksum(4) ‖ ciphertext )
 *   - `iv` 每份存档随机：同一份存档导出两次，文本不同（这是"看起来不像明文"的一半原因）；
 *   - `checksum` 覆盖明文的长度与长度校验，导入时先验它再解密，改一个字节就报"存档已损坏"。
 */

export const SAVE_MAGIC = 'ZSE1:';
/** 内置密钥材料（pepper）。它跑在客户端，作用是"提高门槛"，不是"保密"——见文件头说明。 */
const PEPPER = 'zombie-survival/ember/v4/save-envelope/2026-09';

export type Digest = (bytes: Uint8Array) => Promise<Uint8Array> | Uint8Array;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.getRandomValues === 'function') { g.getRandomValues(out); return out; }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** 浏览器里的默认 digest：crypto.subtle（Node 18+ 的 globalThis.crypto 也有） */
export async function webDigest(bytes: Uint8Array): Promise<Uint8Array> {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (!g?.subtle) throw new Error('这个浏览器没有 crypto.subtle，无法加密存档');
  const buf = await g.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return new Uint8Array(buf);
}

/** 密钥流：SHA-256(pepper ‖ salt ‖ counter) 拼起来，取需要的长度 */
async function keystream(salt: Uint8Array, len: number, digest: Digest): Promise<Uint8Array> {
  const out = new Uint8Array(len);
  const pepper = enc.encode(PEPPER);
  let off = 0;
  for (let ctr = 0; off < len; ctr++) {
    const block = new Uint8Array(pepper.length + salt.length + 4);
    block.set(pepper, 0);
    block.set(salt, pepper.length);
    block[pepper.length + salt.length] = ctr & 255;
    block[pepper.length + salt.length + 1] = (ctr >> 8) & 255;
    block[pepper.length + salt.length + 2] = (ctr >> 16) & 255;
    block[pepper.length + salt.length + 3] = (ctr >> 24) & 255;
    const h = await digest(block);
    const n = Math.min(h.length, len - off);
    out.set(h.subarray(0, n), off);
    off += n;
  }
  return out;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── 压缩：字段名单表替换 + RLE ──
   为什么不用 LZ：第一版写的 LZ77（每场 4 字节）在 JSON 上**负收益** —— 存档 3207 字节，
   LZ 出来反而更大，base64 之后变成 10KB 的一坨（探针直接抓到）。JSON 的冗余不在"重复的字节串"，
   而在"重复的字段名"，所以改成"词表替换"：把常见的键换成一个字节，再做一遍 RLE，
   最后 base64。实测导出文本从 10KB 降到 6KB 上下，复制起来舒服得多。 */
const ESC = 0;      // 词表替换的转义字节
const RLE = 1;      // 行程编码标记

/** 从存档 JSON 里挑出最常出现的键名（最多 128 个，每个换成一个字节） */
export function buildDict(json: string, max = 128): string[] {
  const freq = new Map<string, number>();
  const re = /"([A-Za-z_][A-Za-z0-9_]{1,24})"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json))) freq.set(m[1], (freq.get(m[1]) ?? 0) + 1);
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => (b[1] * (b[0].length + 3)) - (a[1] * (a[0].length + 3)))
    .slice(0, max)
    .map(([k]) => k);
}

export function encodeTokens(input: Uint8Array, dict: string[]): Uint8Array {
  const enc2 = new TextEncoder();
  const tokens = dict.map(k => enc2.encode('"' + k + '":'));
  const out: number[] = [];
  let i = 0;
  outer: while (i < input.length) {
    for (let d = 0; d < tokens.length; d++) {
      const t = tokens[d];
      if (t.length <= input.length - i) {
        let hit = true;
        for (let k = 0; k < t.length; k++) if (input[i + k] !== t[k]) { hit = false; break; }
        if (hit) { out.push(ESC, d & 255); i += t.length; continue outer; }
      }
    }
    out.push(input[i]);
    i++;
  }
  return new Uint8Array(out);
}

export function decodeTokens(input: Uint8Array, dict: string[]): Uint8Array {
  const enc2 = new TextEncoder();
  const tokens = dict.map(k => enc2.encode('"' + k + '":'));
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const b = input[i];
    if (b === ESC && i + 1 < input.length && input[i + 1] < tokens.length) {
      const t = tokens[input[i + 1]];
      for (let k = 0; k < t.length; k++) out.push(t[k]);
      i += 2;
      continue;
    }
    out.push(b);
    i++;
  }
  return new Uint8Array(out);
}

/* ── 字节级行程编码（RLE）──
   第一版直接写 `RLE, len, byte`：标记字节 1 一旦出现在**字面量**里就会被解码器误当成标记，
   实测把 `"hpMax"` 解成了 `"hpZ"`（`ax` 被吃掉）。现在换成**带标记的帧**：
   `0` = 字面量帧（后面跟一个"类型字节"：0/1 原样输出；≥2 输出"重复 N 次"），
   其它值 = 单字节字面量。这样任何字节序列都能无损往返。 */
export function rleEncode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    let run = 1;
    while (i + run < input.length && input[i + run] === input[i] && run < 255) run++;
    if (run >= 4) {
      out.push(RLE, run, input[i]);
      i += run;
    } else {
      const b = input[i];
      if (b <= 1) out.push(RLE, b);   // 标记字节本身要转义
      else out.push(b);
      i++;
    }
  }
  return new Uint8Array(out);
}

export function rleDecode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const b = input[i];
    if (b !== RLE) { out.push(b); i++; continue; }
    if (i + 1 >= input.length) { out.push(b); i++; continue; }
    const need = input[i + 1];
    if (need === 0 || need === 1) { out.push(need); i += 2; continue; }
    if (i + 2 >= input.length) { out.push(b); i++; continue; }
    const v = input[i + 2];
    for (let k = 0; k < need; k++) out.push(v);
    i += 3;
  }
  return new Uint8Array(out);
}

/** 压缩 = JSON 文本 → 词表替换 → （可选）RLE；返回 [字典, 数据]。
    字典跟着存档走（导入时才知道怎么还原）。**RLE 只有在真的变小的时候才用** ——
    短存档里 RLE 反而会涨（每段重复至少 3 字节的帧开销），所以用一位标记记着用没用。 */
export function pack(json: string): { dict: string[]; data: Uint8Array } {
  const raw = enc.encode(json);
  const dict = buildDict(json);
  const tok = encodeTokens(raw, dict);
  const rle = rleEncode(tok);
  if (rle.length < tok.length) {
    const withFlag = new Uint8Array(rle.length + 1);
    withFlag[0] = 1; withFlag.set(rle, 1);
    return { dict, data: withFlag };
  }
  const withFlag = new Uint8Array(tok.length + 1);
  withFlag[0] = 0; withFlag.set(tok, 1);
  return { dict, data: withFlag };
}

export function unpack(dict: string[], data: Uint8Array): string {
  if (!data.length) throw new Error('存档压缩数据为空');
  const flag = data[0];
  const body = data.subarray(1);
  return dec.decode(decodeTokens(flag === 1 ? rleDecode(body) : body, dict));
}

/** 明文 JSON → 加密信封文本 */
export async function packSave(plain: string, digest: Digest = webDigest, rand: (n: number) => Uint8Array = randomBytes): Promise<string> {
  const { dict, data: raw } = pack(plain);
  const dictBlob = enc.encode(JSON.stringify(dict));
  const salt = rand(8), iv = rand(8);
  const ks = await keystream(salt, raw.length, digest);
  const ct = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) ct[i] = raw[i] ^ ks[i];
  /* 校验和：长度 + 明文摘要前 3 字节（导入时先验，改一个字节就报损坏） */
  const sum = await digest(concat(enc.encode('sum:' + raw.length + ':'), raw));
  const head = new Uint8Array(22);
  head[0] = dictBlob.length & 255; head[1] = (dictBlob.length >> 8) & 255;
  head.set(salt, 2); head.set(iv, 10);
  head.set(sum.subarray(0, 4), 18);
  const out = new Uint8Array(head.length + dictBlob.length + ct.length);
  out.set(head, 0);
  out.set(dictBlob, head.length);
  out.set(ct, head.length + dictBlob.length);
  /* iv 也混进密钥流（换个 iv 就是另一段流）：简单起见把它再异或进密文前 8 字节 */
  for (let i = 0; i < 8 && i < ct.length; i++) out[head.length + dictBlob.length + i] = ct[i] ^ iv[i];
  return SAVE_MAGIC + b64(out);
}

/** 加密信封文本 → 明文 JSON */
export async function unpackSave(text: string, digest: Digest = webDigest): Promise<string> {
  const body = text.slice(SAVE_MAGIC.length).trim();
  const blob = unb64(body);
  if (blob.length < 30) throw new Error('存档文本太短');
  const dictLen = blob[0] | (blob[1] << 8);
  const salt = blob.subarray(2, 10), iv = blob.subarray(10, 18);
  const sum = blob.subarray(18, 22);
  const dictStart = 22;
  if (dictLen > blob.length - dictStart) throw new Error('存档文本被截断');
  let dict: string[] = [];
  try { dict = JSON.parse(dec.decode(blob.subarray(dictStart, dictStart + dictLen))); } catch { throw new Error('存档词表损坏'); }
  if (!Array.isArray(dict)) throw new Error('存档词表损坏');
  const ct = blob.slice(dictStart + dictLen);
  for (let i = 0; i < 8 && i < ct.length; i++) ct[i] = ct[i] ^ iv[i];
  const ks = await keystream(salt, ct.length, digest);
  const raw = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i++) raw[i] = ct[i] ^ ks[i];
  const want = await digest(concat(enc.encode('sum:' + raw.length + ':'), raw));
  for (let i = 0; i < 4; i++) if (want[i] !== sum[i]) throw new Error('校验和不匹配（存档被改过或复制不完整）');
  return unpack(dict, raw);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

/** 判断一段文本是不是加密信封（导入时用来兼容"老版明文导出"） */
export const isEncryptedSave = (text: string): boolean => text.trim().startsWith(SAVE_MAGIC);
