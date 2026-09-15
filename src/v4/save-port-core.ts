/**
 * M39：口令加密的存档导出 / 导入（跨设备搬档）。
 *
 * 背景：M29 之后本机存档是 AES-GCM 密文，密钥只在**本机** worker 里、且不可导出 ——
 * 好处是"别人拿到 localStorage 也读不出你的档"，代价是**换设备搬不走**（菜单里连"导出明文"都不提供）。
 * 这里的做法不是把明文还回去，而是给玩家一条**口令**：导出时用 PBKDF2(口令+随机盐, SHA-256, 15 万次)
 * 派生一把一次性密钥，再用 AES-GCM 加密；导入时用同一口令重新派生。口令**不入代码、不落盘**，
 * 导出文本即使被贴到聊天窗口里，没有口令也只是一串 base64。
 *
 * 文本格式（单行，可整段复制粘贴）：
 *   ZSVEXP1:<iter>:<b64 salt>:<b64 iv>:<b64 ciphertext>
 * 为什么把 iter 写进去：以后调高迭代次数时，老文本仍然能解（按它自己那份参数派生）。
 */

export const PORT_MAGIC = 'ZSVEXP1:';
/** 默认迭代次数：手机上约 100~200ms，够挡住"拿到文本后暴力试口令" */
export const PORT_ITER = 150000;
export const PORT_MIN_PW = 6;

export interface PortOpts { iter?: number; salt?: Uint8Array; iv?: Uint8Array }

const enc = () => new TextEncoder();
const dec = () => new TextDecoder();

function toB64(buf: ArrayBufferLike | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc().encode(passphrase) as unknown as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 导出：明文存档 JSON → 口令加密文本（默认 15 万次 PBKDF2 + 随机 16 字节盐 + 随机 12 字节 IV） */
export async function exportSaveText(plain: string, passphrase: string, opts: PortOpts = {}): Promise<string> {
  const bad = passphraseIssue(passphrase);
  if (bad) throw new Error(bad);
  const iter = Math.max(1000, Math.floor(opts.iter ?? PORT_ITER));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = opts.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, enc().encode(plain) as unknown as BufferSource);
  return PORT_MAGIC + iter + ':' + toB64(salt) + ':' + toB64(iv) + ':' + toB64(ct);
}

/** 导入：口令加密文本 → 明文存档 JSON。口令错/文本被改 → GCM 认证失败，统一翻成人话。 */
export async function importSaveText(text: string, passphrase: string): Promise<string> {
  const head = parsePortText(text);
  if (!head) throw new Error('这段文本不是本游戏的导出备份（开头应该是 ' + PORT_MAGIC + '）。');
  if (!passphrase) throw new Error('请先填口令。');
  const key = await deriveKey(passphrase, head.salt, head.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: head.iv as unknown as BufferSource }, key, head.ct as unknown as BufferSource);
    return dec().decode(pt);
  } catch {
    /* AES-GCM 带认证：解不开只有两种可能——口令不对，或者文本被改过 */
    throw new Error('口令不对（或者这段文本被改动过）。');
  }
}

export interface PortHead { iter: number; salt: Uint8Array; iv: Uint8Array; ct: Uint8Array }

/** 只解析头部（不看口令）——UI 用来先判断"这段文本像不像导出备份" */
export function parsePortText(text: string): PortHead | null {
  const t = String(text || '').trim();
  if (!t.startsWith(PORT_MAGIC)) return null;
  const parts = t.slice(PORT_MAGIC.length).split(':');
  if (parts.length !== 4) return null;
  const iter = Math.floor(Number(parts[0]));
  if (!Number.isFinite(iter) || iter < 1000 || iter > 5_000_000) return null;
  try {
    const salt = fromB64(parts[1]);
    const iv = fromB64(parts[2]);
    const ct = fromB64(parts[3]);
    if (!salt.length || iv.length !== 12 || !ct.length) return null;
    return { iter, salt, iv, ct };
  } catch { return null; }
}

/** 口令体检：太短直接拦，偏短给提示（不拦，玩家自己决定） */
export function passphraseIssue(pw: string): string {
  const s = String(pw ?? '');
  if (s.length < PORT_MIN_PW) return '口令至少 ' + PORT_MIN_PW + ' 位（推荐一整句话，别用 "123456"）。';
  if (/^\d+$/.test(s)) return '全数字口令太好猜了，混点字母或中文。';
  return '';
}
export function passphraseWeak(pw: string): boolean {
  return !passphraseIssue(pw) && String(pw).length < 10;
}

/** 导出文本的体量（KB）——贴给玩家看"这一坨有多大" */
export function portSizeKb(text: string): string {
  return (String(text).length / 1024).toFixed(1) + ' KB';
}

/** 导入前的预览：这段明文里到底是第几天、打成什么样（解析不了就返回 null） */
export function portSummary(plain: string): { day: number; kills: number; hp: number; invKinds: number; savedAt: number | null } | null {
  try {
    const d = JSON.parse(plain);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;   // 数组/标量都不是存档
    if (!('day' in d)) return null;                                     // 连天数都没有 = 不是本游戏的档
    const st = d.stats || {};
    return {
      day: Math.max(1, Math.floor(Number(d.day) || 1)),
      kills: Math.max(0, Math.floor(Number(st.kills) || 0)),
      hp: Math.max(0, Math.round(Number(d.hp) || 0)),
      invKinds: d.inv && typeof d.inv === 'object' ? Object.keys(d.inv).length : 0,
      savedAt: Number.isFinite(Number(d.savedAt)) ? Number(d.savedAt) : null,
    };
  } catch { return null; }
}

/** 建议的导出文件名（不带时间戳的乱码，一眼能认出是哪一档） */
export function portFileName(day: number, at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return 'zombie-survival-d' + Math.max(1, Math.floor(day)) + '-' + at.getFullYear() + p(at.getMonth() + 1) + p(at.getDate()) + '-' + p(at.getHours()) + p(at.getMinutes()) + '.zsv.txt';
}
