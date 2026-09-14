/* 挑战码 / 世界分享（M20）——纯逻辑：把"一个世界"压成一段可以发给朋友的短码。
 *
 * 起因（用户 idea）：
 *   「MC/泰拉瑞亚式的种子分享：玩家可以把自己的地图生成种子和初始状态导出，发给朋友：
 *    "来挑战我这张地狱开局的地图"」
 *
 * 设计：
 *   · 世界 = 种子（决定 12×12 元地图 + 每张 24×24 局部图）+ 开局预设（normal / lean / bleak）
 *   · 码形如 `ZS1-<payload>-<checksum>`，payload 是 base64url(JSON)，checksum 用同一套 FNV-1a（抄 integrity-core）
 *   · 解析要**严格**：校验和不对 / 版本不认识 / 种子非法 → 返回 null + 人话原因，绝不半信半疑地开局
 *   · 不联网：码就是个字符串，发微信/QQ/贴吧都行；URL 只是附带糖
 */
const CODE_VER = 'ZS1';

export type Preset = 'normal' | 'lean' | 'bleak';

export interface PresetInfo { id: Preset; name: string; desc: string; mat: number; veh: boolean; day: number }

/** 开局预设：影响"起手有多惨"，不影响地图本身（地图只由种子决定） */
export const PRESETS: Record<Preset, PresetInfo> = {
  normal: { id: 'normal', name: '标准开局', desc: '常规物资与一条命：适合第一次玩这张图。', mat: 12, veh: false, day: 1 },
  lean: { id: 'lean', name: '清贫开局', desc: '材料减半、没有备用绷带：逼你去搜刮。', mat: 4, veh: false, day: 1 },
  bleak: { id: 'bleak', name: '地狱开局', desc: '材料 0、开局带伤、第 2 天就是血月。', mat: 0, veh: false, day: 1 },
};

export interface ChallengeSpec { seed: string; preset: Preset; by?: string }

export function isPreset(x: unknown): x is Preset { return x === 'normal' || x === 'lean' || x === 'bleak'; }

/** FNV-1a（32 位）：和 integrity-core 同一套，稳定且够短 */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h.toString(36).padStart(7, '0').slice(-7);
}

const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** 校验：种子必须是可打印的短字符串（太长的种子会让存档很大） */
export function validSeed(seed: unknown): seed is string {
  return typeof seed === 'string' && seed.length >= 3 && seed.length <= 48 && /^[\w \-.:#\u4e00-\u9fa5]+$/.test(seed);
}

/** 生成挑战码 */
export function shareCode(spec: ChallengeSpec): string {
  if (!validSeed(spec.seed)) throw new Error('种子不合法');
  const preset: Preset = isPreset(spec.preset) ? spec.preset : 'normal';
  const body = { s: spec.seed, p: preset, b: (spec.by || '').slice(0, 12) };
  const payload = b64u(JSON.stringify(body));
  return CODE_VER + '-' + payload + '-' + fnv(CODE_VER + payload);
}

export type ParseResult = { ok: true; spec: ChallengeSpec } | { ok: false; why: string };

/** 解析挑战码（严格：任何一处不对都拒绝，并给出人话原因） */
export function parseShareCode(code: string): ParseResult {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (!raw) return { ok: false, why: '没有输入挑战码' };
  const parts = raw.split('-');
  if (parts.length < 3) return { ok: false, why: '挑战码格式不对（应该像 ZS1-xxxx-yyyyyyy）' };
  const ver = parts[0];
  if (ver !== CODE_VER) return { ok: false, why: '这是别的版本的挑战码（' + ver + '），当前游戏读不了' };
  const payload = parts[1], sum = parts[2];
  if (fnv(ver + payload) !== sum) return { ok: false, why: '挑战码校验失败（可能复制少了几位）' };
  let body: { s?: string; p?: string; b?: string };
  try { body = JSON.parse(unb64u(payload)); } catch { return { ok: false, why: '挑战码内容损坏（base64 解不开）' }; }
  if (!validSeed(body.s)) return { ok: false, why: '挑战码里的种子不合法' };
  return { ok: true, spec: { seed: body.s, preset: isPreset(body.p) ? body.p : 'normal', by: typeof body.b === 'string' ? body.b : '' } };
}

/** 带挑战码的链接（发给朋友直接点） */
export const challengeUrl = (code: string, base = 'https://bobbychina.github.io/games/zombie-survival/'): string =>
  base + '?challenge=' + encodeURIComponent(code);

/** 从 location.search 里读挑战码（页面加载时用） */
export function challengeFromSearch(search: string): ParseResult | null {
  const m = /[?&]challenge=([^&]+)/.exec(search || '');
  if (!m) return null;
  return parseShareCode(decodeURIComponent(m[1]));
}

/** 随机种子（"换一张地图"用）：用中文词 + 数字，读起来像个存档名 */
const WORDS = ['余烬', '铁锈', '灰烬', '长夜', '寒风', '断桥', '孤灯', '枯井', '雪原', '荒腔', '旧钟', '北岸'];
export function randomSeed(rng: () => number = Math.random): string {
  const w = WORDS[Math.floor(rng() * WORDS.length)];
  const n = 100 + Math.floor(rng() * 900);
  const d = new Date();
  return w + '-' + n + '-' + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
