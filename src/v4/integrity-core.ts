/* M8 · 存档完整性（纯逻辑，可单测）
   ---------------------------------------------------------------------------
   先把定位说清楚：这是单机游戏，代码、存档、运行环境全在玩家手里，
   **纯前端不可能"阻止"修改**——能做的只有三件事，而且都有明确边界：
     1) 防"损坏"（写一半断了、storage 被截断、同步合并出错）→ 校验和一眼看出；
     2) 防"静默篡改"（有人在 devtools 或 Gist 网页上改了几个数字）→ 校验和对不上；
        注意：会写代码的人可以重算校验和，所以这拦不住蓄意造假，只拦"顺手改一下"；
     3) 让诚实玩家能**自证**没改过（未被标记 = 成就计入），而不是靠嘴。
   因此这里的输出不是"拦截"，而是**结论 + 标记**：ok / tampered / corrupt 三态，
   由界面决定怎么呈现（警告、停用成就、拉云端时二次确认）。

   与 legacy sanitizeSave 的分工：sanitize 负责"把越界值夹回合法区间"（防崩），
   本文件负责"在夹之前先看原始值是否越界"——因为合法存档永远是夹过的，
   原始值一旦越界，就说明有人在 sanitize 之外动过手（这是最有用的篡改信号）。
*/
export const INTEGRITY_KEY = '__integrity';
/** 指纹格式版本。M36.1 起 v2：v1 的标记可能来自"加密存档被误判损坏"那个 bug，校验自洽时会一次性特赦（见 legacyTamperMarker） */
export const INTEGRITY_V = 2;
export const LEGACY_INTEGRITY_V = 1;

export type IntegrityVerdict = 'ok' | 'missing' | 'mismatch' | 'implausible' | 'corrupt';

export interface Stamp {
  v: number;
  at: string;
  d: string;          // 本次存档内容的指纹
  prev?: string;      // 上一次的指纹（链式：改过中间某一环就对不上）
}
export interface Verdict {
  state: IntegrityVerdict;
  ok: boolean;
  detail: string;
  tampered: boolean;
}

/** 稳定序列化：键排序 + 去掉指纹字段本身，保证"同一份存档"永远得到同一个字符串。
 *  M36 修：**要和 JSON.stringify 保持同一套口径** —— 值为 undefined / 函数的键在 JSON 里会被丢掉，
 *  而这里以前会写成 `"k":null`，于是"内存里的 S"和"落盘的字符串"算出两个指纹：
 *  实测（M36 自查）委托里的 `reward:{item:undefined, mat:8, n:undefined}` 就会让
 *  `liveDigest() !== digest(payload)` → 盖章被静默跳过（本地档永远没有指纹、上传云端的档验不过）。
 *  存档对象来自 JSON，所以对已经落盘的档没有任何行为变化；变的只是"活对象"这一侧。 */
export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter(k => k !== INTEGRITY_KEY && o[k] !== undefined && typeof o[k] !== 'function').sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}

/** FNV-1a 双通道 → 16 位十六进制。用于"发现损坏/顺手改"，不是密码学签名（见文件头 2)）。 */
export function digest(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/** 合法存档必须满足这些不变量（sanitizeSave 每次写档都会夹一遍，所以原始值一旦违反 = 有人在外面动过手） */
const BOUNDS: [string, number, number][] = [
  ['day', 1, 1000000], ['ap', 0, 99], ['apMax', 1, 99],
  ['hpMax', 1, 10000], ['staMax', 1, 10000],
  ['hun', 0, 100], ['thi', 0, 100], ['infect', 0, 100],
  ['ammo', 0, 1000000], ['mat', 0, 10000000], ['noise', 0, 99], ['compHp', 0, 10000],
];

/** 在 sanitize 之前跑：原始值违反不变量 = 有人在 sanitize 之外改过（或写坏了）。
 *  这里刻意检查"相对关系"（hp ≤ hpMax 等）而不只是绝对区间——把 hp 改成 99999 而 hpMax 还是 100 是最典型的改档手法。 */
export function implausible(raw: Record<string, unknown>): string | null {
  const num = (k: string): number | null => {
    const v = raw?.[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !isFinite(v)) return NaN;
    return v;
  };
  for (const [k, lo, hi] of BOUNDS) {
    const v = num(k);
    if (v === null) continue;
    if (Number.isNaN(v)) return k + ' 不是合法数字（' + String(raw[k]) + '）';
    if (v < lo || v > hi) return k + ' = ' + v + '（合法区间 ' + lo + '~' + hi + '）';
  }
  const rel: [string, string][] = [['hp', 'hpMax'], ['sta', 'staMax'], ['ap', 'apMax']];
  for (const [a, b] of rel) {
    const va = num(a), vb = num(b);
    if (va === null || vb === null || Number.isNaN(va) || Number.isNaN(vb)) continue;
    if (va > vb) return a + ' = ' + va + ' 超过 ' + b + ' = ' + vb;
    if (va < 0) return a + ' = ' + va;
  }
  const inv = raw?.inv;
  if (inv && typeof inv === 'object') {
    for (const id of Object.keys(inv as Record<string, unknown>)) {
      const n = (inv as Record<string, unknown>)[id];
      if (typeof n !== 'number' || !isFinite(n) || n < 0 || n > 9999) return '背包 ' + id + ' = ' + String(n);
    }
  }
  return null;
}

/** 给一份存档盖上指纹（prev 传上一枚指纹即为链式） */
export function stamp(state: Record<string, unknown>, prev?: string, now?: string): Stamp {
  return {
    v: INTEGRITY_V,
    at: now ?? new Date().toISOString(),
    d: digest(canon(state)),
    ...(prev ? { prev } : {}),
  };
}

/** 校验：raw 是**未经 sanitize 的原始对象**（含它自己的 __integrity） */
export function verify(raw: unknown, prevDigest?: string): Verdict {
  if (!raw || typeof raw !== 'object') return { state: 'corrupt', ok: false, detail: '存档不是对象', tampered: true };
  const obj = raw as Record<string, unknown>;
  const sig = obj[INTEGRITY_KEY] as Stamp | undefined;
  const bad = implausible(obj);
  if (bad) return { state: 'implausible', ok: false, detail: bad, tampered: true };
  if (!sig || typeof sig !== 'object' || typeof sig.d !== 'string') {
    return { state: 'missing', ok: false, detail: '这份存档没有指纹（老版本存档，或被人为抹掉）', tampered: false };
  }
  const want = digest(canon(obj));
  if (want !== sig.d) return { state: 'mismatch', ok: false, detail: '内容与指纹对不上（被改过）', tampered: true };
  if (prevDigest && sig.prev && sig.prev !== prevDigest) {
    return { state: 'mismatch', ok: false, detail: '链条断了（中间某一环被替换过）', tampered: true };
  }
  return { state: 'ok', ok: true, detail: '指纹一致', tampered: false };
}

/** M29 之后主档在 localStorage 里是 `ZSV1:` 密文（MAGIC 见 v4/save-vault.ts）：
 *  这里纯逻辑地判"这次启动该拿哪一份来验"，因为直接 JSON.parse 密文必然失败、
 *  会被误判成 corrupt + tampered（实测就是这个原因让每次启动都弹「存档被修改过」）。
 *    · 保险箱解出了明文 → 用明文
 *    · 只有密文且没解开（保险箱未就绪 / 本机密钥丢了）→ 不验，且不算玩家改档
 *    · 明文存档（M29 之前的老档、或降级直写路径）→ 原样验 */
export const SAVE_MAGIC = 'ZSV1:';
export function rawForInspect(stored: string | null, decrypted: string | null): { text: string | null; encryptedUnreadable: boolean } {
  if (typeof decrypted === 'string' && decrypted) return { text: decrypted, encryptedUnreadable: false };
  if (typeof stored === 'string' && stored.startsWith(SAVE_MAGIC)) return { text: null, encryptedUnreadable: true };
  return { text: stored, encryptedUnreadable: false };
}

/** M36.1 一次性特赦：指纹版本 ≤ v1 的 `tampered` 标记不一定是真的 ——
 *  "加密存档被误判损坏"那个 bug 每次启动都会把标记盖进档里（实测），是真冤枉。
 *  所以只有"标记是老的（v≤1）**且**本档内容指纹自洽（verify 已判 ok）"时才清：
 *  真被改过的档过不了 verify（mismatch / implausible），标记照旧留着。 */
export function legacyTamperMarker(sig: unknown): boolean {
  const s = sig as { v?: unknown; tampered?: unknown } | undefined;
  return !!s && s.tampered === true && typeof s.v === 'number' && s.v <= LEGACY_INTEGRITY_V;
}

/** 密文解不开时的结论（M36.1）：AES-GCM 是**带认证**的加密——
 *  如果本机密钥自检通过（能解开密钥自检位），却解不开存档密文，那就是密文被改过或写坏了，
 *  这是可判定的篡改/损坏；密钥本身都不对（换过浏览器 / 清过站点数据 / 密钥丢了）就不冤人。 */
export function unreadableVerdict(keyOk: boolean): Verdict {
  return keyOk
    ? { state: 'corrupt', ok: false, detail: '加密存档解不开，而本机密钥是好的 —— 密文被改过或写坏了', tampered: true }
    : { state: 'missing', ok: false, detail: '存档是加密的，这次没解开（保险箱未就绪，或本机密钥丢了）', tampered: false };
}

/** 人话结论（界面直接用） */
export function verdictText(v: Verdict): string {
  switch (v.state) {
    case 'ok': return '✅ 存档完整（指纹一致）';
    case 'missing': return v.detail && v.detail.indexOf('加密') >= 0 ? 'ℹ️ ' + v.detail : 'ℹ️ 老存档：没有指纹，无法判断是否被改过';
    case 'mismatch': return '⚠️ 存档被外部修改过（指纹对不上）——成就/排行不计入';
    case 'implausible': return '⚠️ 存档里有越界数值：' + v.detail;
    default: return '⛔ 存档损坏：' + v.detail;
  }
}
