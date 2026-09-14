/* 异步联机 · 幽灵据点（M20）——纯逻辑。
 *
 * 起因（用户 idea）：
 *   「异步联机（PVP 掠夺）：让玩家可以把自己的"安全屋仓库数据"上传到一个公共的 Gist 或 JSONBin。
 *    其他玩家探索地图时，有几率刷出这个"幽灵据点"，打赢就能抢走对方存档里的部分材料。」
 *
 * 这一版做到哪一步（诚实说明）：
 *   · **幽灵码**（导入/导出）已经能玩：把自己仓库压成一段码，朋友粘进去，他的地图上就会长出你的据点；
 *   · 打赢抢到的是**你上传的那份快照里的材料**，你本人的存档**一点都不会少**（快照是副本）。
 *     这一点在 UI 里会明说，免得玩家以为自己被偷了。
 *   · 公共池（Gist / JSONBin 的自动上传与拉取）留到下一轮：那需要账号绑定 + 隐私开关，
 *     而且"往公共池写别人能读到的东西"值得单独做一次确认。这里先把数据格式与玩法闭环打通。
 *
 * 码格式：ZG1-<payload>-<checksum>，payload = base64url(JSON)，字段极短（手机上手打不了，但能粘贴）
 */
import type { RegionType } from './regions-core';

const CODE_VER = 'ZG1';

export interface GhostSpec {
  owner: string;        // 玩家自取的名字（≤8 字，建议不要用真名）
  mat: number;          // 仓库里的材料
  item: string;         // 压箱底的那件东西（物品 id）
  itemN: number;
  threat: number;       // 1~5：据点的守卫强度（上传时按自己的战力/天数算）
  day: number;          // 上传时的天数
  tag: string;          // 一句话挑衅（≤20 字）
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h.toString(36).padStart(7, '0').slice(-7);
}
const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** 从"自己的仓库"生成一份幽灵快照：材料、压箱底的东西、威胁度 */
export function makeGhost(opts: {
  owner: string; mat: number; items: { id: string; n: number }[]; day: number; threat?: number; tag?: string;
}): GhostSpec {
  const best = opts.items.slice().sort((a, b) => b.n - a.n)[0] ?? { id: 'can', n: 1 };
  const threat = Math.max(1, Math.min(5, Math.round(opts.threat ?? (1 + opts.day / 20))));
  return {
    owner: String(opts.owner || '无名幸存者').slice(0, 8),
    mat: Math.max(0, Math.floor(Number(opts.mat) || 0)),
    item: String(best.id || 'can').slice(0, 16),
    itemN: Math.max(1, Math.floor(Number(best.n) || 1)),
    threat, day: Math.max(1, Math.floor(opts.day || 1)),
    tag: String(opts.tag || '来拿啊。').slice(0, 20),
  };
}

export function ghostCode(spec: GhostSpec): string {
  const body = { o: spec.owner, m: spec.mat, i: spec.item, n: spec.itemN, t: spec.threat, d: spec.day, g: spec.tag };
  const payload = b64u(JSON.stringify(body));
  return CODE_VER + '-' + payload + '-' + fnv(CODE_VER + payload);
}

export type GhostParse = { ok: true; spec: GhostSpec } | { ok: false; why: string };

export function parseGhostCode(code: string): GhostParse {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  if (!raw) return { ok: false, why: '没有输入幽灵码' };
  const parts = raw.split('-');
  if (parts.length < 3) return { ok: false, why: '幽灵码格式不对（应该像 ZG1-xxxx-yyyyyyy）' };
  if (parts[0] !== CODE_VER) return { ok: false, why: '这是别的版本的幽灵码（' + parts[0] + '）' };
  const payload = parts[1], sum = parts.slice(2).join('-');
  if (fnv(CODE_VER + payload) !== sum) return { ok: false, why: '幽灵码校验失败（可能复制少了几位）' };
  let body: Record<string, unknown>;
  try { body = JSON.parse(unb64u(payload)); } catch { return { ok: false, why: '幽灵码内容损坏（base64 解不开）' }; }
  const mat = Math.max(0, Math.floor(Number(body.m) || 0));
  return {
    ok: true,
    spec: {
      owner: String(body.o || '无名幸存者').slice(0, 8),
      mat: Math.min(9999, mat),
      item: String(body.i || 'can').slice(0, 16),
      itemN: Math.max(1, Math.min(99, Math.floor(Number(body.n) || 1))),
      threat: Math.max(1, Math.min(5, Math.floor(Number(body.t) || 1))),
      day: Math.max(1, Math.floor(Number(body.d) || 1)),
      tag: String(body.g || '').slice(0, 20),
    },
  };
}

/** 幽灵据点在地图上的落点：由"码 + 世界种子"决定（同一个码在同一张图上总在同一个地方，
 *  但不同玩家的图落点不同——不然所有幽灵都堆在家门口）。避开安全屋周围 6 格。 */
export function ghostPlacement(spec: GhostSpec, worldSeed: string, w: number, h: number, home: { x: number; y: number }): { x: number; y: number } {
  const h1 = parseInt(fnv(worldSeed + '|' + ghostCode(spec)).slice(0, 5), 36);
  const h2 = parseInt(fnv(ghostCode(spec) + '|' + worldSeed).slice(0, 5), 36);
  let x = h1 % w, y = h2 % h;
  const far = Math.max(Math.abs(x - home.x), Math.abs(y - home.y)) >= 6;
  if (!far) { x = (x + 7) % w; y = (y + 5) % h; }               // 落到家门口就挪一格象限
  return { x: Math.max(1, Math.min(w - 2, x)), y: Math.max(1, Math.min(h - 2, y)) };
}

/** 打赢能抢走多少：对方材料的一部分（最多 60、至少 3），外加拿走他压箱底那件东西的 1 份。
 *  注意：抢的是**快照里的数字**，上传者本人的存档不受影响。 */
export function ghostLoot(spec: GhostSpec): { mat: number; item: string; n: number } {
  return { mat: Math.max(3, Math.min(60, Math.round(spec.mat * 0.35))), item: spec.item, n: 1 };
}

/** 守卫：按威胁度给一份敌人名单（威胁 1 = 三只普通；威胁 5 = 一群混编 + 一个暴君） */
export function ghostFoes(spec: GhostSpec): string[] {
  const t = Math.max(1, Math.min(5, spec.threat));
  const out: string[] = [];
  const push = (id: string, n: number) => { for (let i = 0; i < n; i++) out.push(id); };
  push('walker', 2 + t);
  if (t >= 2) push('runner', t - 1);
  if (t >= 3) push('crawler', 1);
  if (t >= 4) push('brute', 1);
  if (t >= 5) { push('hound', 1); push('tyrant', 1); }
  return out;
}

/** UI 用的一句话描述 */
export const ghostLine = (spec: GhostSpec): string =>
  `${spec.owner} 的据点 · 第 ${spec.day} 天 · 威胁 ${spec.threat} · 仓库里大约 ${spec.mat} 材料`;

/** 落点标签（地图上那一格的名字/提示用） */
export const ghostBlockName = (spec: GhostSpec): string => `${spec.owner} 的幽灵据点`;

/** 幽灵据点允许落在哪些地表上（水里/山上/公路上不合适） */
export const GHOST_BIOMES: string[] = ['city', 'suburb', 'industrial', 'ruins', 'military', 'farm'];

/**
 * 把"偏好落点"落成"真正能放的那一格"：从偏好点往外一圈圈找，直到找到合法的格子。
 * 为什么需要它：偏好点是纯哈希出来的，可能正好压在公路/水面上——第一版直接放弃，
 * 于是玩家会遇到"导入成功但地图上什么都没有"（静默失败，最糟的那种）。
 * 扫描顺序固定 → 同一张图 + 同一个码，落点永远一致。
 */
export function resolveGhostSpot(
  prefer: { x: number; y: number },
  isValid: (x: number, y: number) => boolean,
  w: number, h: number, maxRing = 6,
): { x: number; y: number } | null {
  if (isValid(prefer.x, prefer.y)) return prefer;
  for (let r = 1; r <= maxRing; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;      // 只走当前这一圈
        const x = prefer.x + dx, y = prefer.y + dy;
        if (x < 1 || y < 1 || x > w - 2 || y > h - 2) continue;
        if (isValid(x, y)) return { x, y };
      }
    }
  }
  return null;
}
