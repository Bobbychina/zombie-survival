/* M66 建筑内部（纯逻辑，不碰 DOM / legacy）：
   把"进楼 = 点一下搜刮"变成一张 3~6 间的小平面图 —— 房间各有自己的掉落、有的上了锁
   （撬棍能撬 / 找到楼门钥匙能开 / 也能硬踹但一定招来东西）、有的房间一进去就有人等着。
   进度按**区块坐标**存在存档里（`sw.interiors`），所以一栋楼可以分两趟搜完。

   设计口径（别不小心改掉）：
   - 平面图是**确定性**的：同一栋楼（poiId + 世界种子）每次进去都是同一张图、同样的房间与锁。
     不然玩家退出再进就能"刷新"出没锁的布局，等于白送。
   - **锁着的房间才是好房间**：掉落从 POI 掉落表里按权重切成"常见"与"稀有"两半，
     上锁/深处的房间抽稀有那一半 —— 撬锁的收益必须看得见，否则这个机制就是纯摩擦。
   - 门永远打得开：没有撬棍、没有钥匙也能**硬踹**（掉血 + 一定触发遭遇），不允许出现"卡住"。 */
import type { PoiDef } from './pois';

export type LockKind = 'crowbar' | 'sealed';
export type RoomKind = 'flat' | 'stock' | 'vault';

export interface RoomDef {
  id: string;
  name: string;
  icon: string;
  kind: RoomKind;
  /** 没有 lock = 推门就进 */
  lock?: LockKind;
  loot: Record<string, number>;
}
export interface InteriorPlan {
  poiId: string;
  name: string;
  icon: string;
  kit: string;
  rooms: RoomDef[];
}
export interface RoomState { looted?: 1; opened?: 1 }
export interface InteriorState { rooms: Record<string, RoomState>; seen?: 1 }

/* ── 房间模板：每个 kit 一套 6 间，按"从门口往深处"的顺序排 ── */
interface RoomTpl { n: string; i: string; k: RoomKind; lock?: LockKind | 'maybe' }
const KITS: Record<string, RoomTpl[]> = {
  medical: [
    { n: '门诊大厅', i: '🪑', k: 'flat' },
    { n: '值班室', i: '📋', k: 'flat' },
    { n: '候诊走廊', i: '🚪', k: 'flat' },
    { n: '药房', i: '💊', k: 'stock', lock: 'crowbar' },
    { n: '手术室', i: '🧤', k: 'vault', lock: 'maybe' },
    { n: '地下库房', i: '📦', k: 'vault', lock: 'sealed' },
  ],
  food: [
    { n: '收银区', i: '🧾', k: 'flat' },
    { n: '货架区', i: '🥫', k: 'stock' },
    { n: '生鲜区', i: '🥬', k: 'stock' },
    { n: '员工休息室', i: '☕', k: 'flat', lock: 'maybe' },
    { n: '后仓', i: '📦', k: 'stock', lock: 'crowbar' },
    { n: '冷库', i: '🧊', k: 'vault', lock: 'sealed' },
  ],
  retail: [
    { n: '中庭', i: '🛗', k: 'flat' },
    { n: '样板间', i: '🛋️', k: 'stock' },
    { n: '试衣间', i: '🚪', k: 'flat', lock: 'maybe' },
    { n: '仓储区', i: '📦', k: 'stock', lock: 'crowbar' },
    { n: '保安室', i: '📹', k: 'vault', lock: 'maybe' },
    { n: '顶楼仓库', i: '🏗️', k: 'vault', lock: 'sealed' },
  ],
  office: [
    { n: '前台', i: '🛎️', k: 'flat' },
    { n: '开放工位', i: '💻', k: 'stock' },
    { n: '会议室', i: '📊', k: 'flat', lock: 'maybe' },
    { n: '档案室', i: '🗄️', k: 'stock', lock: 'crowbar' },
    { n: '机房', i: '🖥️', k: 'vault', lock: 'maybe' },
    { n: '天台', i: '🌤️', k: 'vault' },
  ],
  tools: [
    { n: '门厅', i: '🚪', k: 'flat' },
    { n: '车间', i: '🛠️', k: 'stock' },
    { n: '工具间', i: '🧰', k: 'stock', lock: 'maybe' },
    { n: '材料库', i: '🧱', k: 'stock', lock: 'crowbar' },
    { n: '装卸区', i: '🚚', k: 'flat' },
    { n: '保险库', i: '🔐', k: 'vault', lock: 'sealed' },
  ],
  armed: [
    { n: '门厅', i: '🚪', k: 'flat' },
    { n: '值班室', i: '📻', k: 'flat' },
    { n: '拘留区', i: '⛓️', k: 'stock', lock: 'maybe' },
    { n: '证物室', i: '📦', k: 'stock', lock: 'crowbar' },
    { n: '军械库', i: '🔫', k: 'vault', lock: 'sealed' },
    { n: '地下通道', i: '🕳️', k: 'vault', lock: 'maybe' },
  ],
};

/** 哪些 POI 有内部平面图（其余 POI 保持"门口翻一遍"的老玩法） */
export const INTERIOR_HOSTS: Record<string, string> = {
  pharmacy: 'medical', hospital: 'medical', clinic: 'medical',
  market: 'food', megamart: 'food',
  mall: 'retail', furniture: 'retail', appliance: 'retail', apartment: 'retail', school: 'retail',
  office: 'office', radio: 'office',
  hardware: 'tools', warehouse: 'tools', depot: 'tools', buildmart: 'tools',
  garage: 'tools', construction: 'tools', lumber: 'tools', sawmill: 'tools', waterworks: 'tools',
  police: 'armed', military: 'armed', prison: 'armed', bunker: 'armed', lab: 'armed',
};

/** M66 新增道具：楼门钥匙（开加固门用；找不到就用撬棍+材料硬撬，或者干脆踹）。 */
export const ROOM_KEY = 'roomkey';

export function interiorHost(poiId: string | undefined | null): string | null {
  return poiId && INTERIOR_HOSTS[poiId] ? INTERIOR_HOSTS[poiId] : null;
}

/** FNV-1a：把 "poi|seed" 折成一个 32 位整数种子（同一栋楼 → 同一张图） */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** 小巧的确定性 PRNG（mulberry32）：平面图与掉落子集都从它出，便于单测"同种子同结果" */
export function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** 掉落表切成"常见 / 稀有"两半（按权重降序；少于一件的表就整份当常见用） */
export function splitLoot(loot: Record<string, number>): { common: [string, number][]; rare: [string, number][] } {
  const all = Object.entries(loot).sort((a, b) => b[1] - a[1]);
  const half = Math.ceil(all.length / 2);
  return { common: all.slice(0, half), rare: all.slice(half) };
}

function pickSome(pool: [string, number][], n: number, rng: () => number): Record<string, number> {
  if (!pool.length) return {};
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {           // Fisher-Yates（用注入的 rng，保证确定性）
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const out: Record<string, number> = {};
  idx.slice(0, Math.max(1, Math.min(n, idx.length))).forEach(i => { out[pool[i][0]] = pool[i][1]; });
  return out;
}

/** 生成一栋楼的平面图：3~6 间，至少 1 间上锁（够大时），锁着的抽稀有掉落 */
export function buildInterior(poi: Pick<PoiDef, 'id' | 'name' | 'icon' | 'loot'>, seed: string): InteriorPlan | null {
  const kit = interiorHost(poi.id);
  if (!kit) return null;
  const tpls = KITS[kit];
  const rng = mulberry32(hashStr(poi.id + '|' + seed));
  const count = 3 + Math.floor(rng() * 4);             // 3~6 间
  const idx = tpls.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const picked = idx.slice(0, Math.min(count, tpls.length)).sort((a, b) => a - b);   // 保留"由外到内"的顺序
  // ① 先定锁（`maybe` 由 rng 决定），再按最终的锁算掉落 —— 顺序不能反：
  //    下面那条"兜底锁一间"的补丁会把一个已经算好掉落的前厅变成上锁房间。
  const locks: (LockKind | undefined)[] = picked.map(t => {
    const lk = tpls[t].lock;
    return lk === 'maybe' ? (rng() < 0.45 ? 'crowbar' : undefined) : lk;
  });
  if (picked.length >= 4 && !locks.some(Boolean)) locks[locks.length - 2] = 'crowbar';
  const { common, rare } = splitLoot(poi.loot || {});
  const rooms: RoomDef[] = picked.map((t, n) => {
    const tp = tpls[t];
    const lock = locks[n];
    // 深处与上锁的房间抽稀有那半；门口与普通房间抽常见那半
    const deep = !!lock || tp.k === 'vault';
    const pool = deep && rare.length ? rare : common;
    const loot = deep && tp.k === 'vault' && rare.length > 2
      ? pickSome(rare, 2 + Math.floor(rng() * 2), rng)
      : pickSome(pool, 2 + Math.floor(rng() * 2), rng);
    return { id: 'r' + n + '_' + t, name: tp.n, icon: tp.i, kind: tp.k, lock, loot };
  });
  return { poiId: poi.id, name: poi.name, icon: poi.icon, kit, rooms };
}

export function roomState(st: InteriorState, id: string): RoomState {
  return (st.rooms[id] = st.rooms[id] || {});
}
export function isLooted(st: InteriorState, id: string): boolean { return !!roomState(st, id).looted; }
export function isUnlocked(st: InteriorState, id: string): boolean { return !!roomState(st, id).opened; }
export function roomStatus(room: RoomDef, st: InteriorState): 'looted' | 'locked' | 'open' {
  if (isLooted(st, room.id)) return 'looted';
  if (room.lock && !isUnlocked(st, room.id)) return 'locked';
  return 'open';
}

export interface HaveTools { crowbar: boolean; key: boolean; mat: number }
export interface OpenDecision {
  how: 'none' | 'crowbar' | 'key' | 'force';
  ok: boolean;
  quiet: boolean;
  cost?: { mat?: number; hp?: [number, number] };
  why: string;
}
/** 开门决策（纯函数）：有撬棍免费撬；加固门要钥匙，没钥匙就撬棍+材料硬撬；都没有就硬踹。 */
export function openDecision(room: RoomDef, have: HaveTools): OpenDecision {
  if (!room.lock) return { how: 'none', ok: true, quiet: true, why: '推门就进' };
  if (room.lock === 'crowbar') {
    if (have.crowbar) return { how: 'crowbar', ok: true, quiet: true, why: '撬棍一别，锁舌就开了' };
    return { how: 'force', ok: true, quiet: false, cost: { hp: [3, 8] }, why: '没撬棍：硬踹会弄出很大动静' };
  }
  // sealed：加固/电子门
  if (have.key) return { how: 'key', ok: true, quiet: true, why: '楼门钥匙一转到底' };
  if (have.crowbar && have.mat >= 2) return { how: 'crowbar', ok: true, quiet: true, cost: { mat: 2 }, why: '用撬棍加两块材料硬撬（-2 材料）' };
  return { how: 'force', ok: true, quiet: false, cost: { hp: [6, 14] }, why: '门是加固的：只能硬踹，一定招来东西' };
}

/** 硬踹的伤害（上锁的门比普通门更狠） */
export function landForce(rng: () => number, room: RoomDef): number {
  const [lo, hi] = room.lock === 'sealed' ? [6, 14] : [3, 8];
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** 进这间房有没有人等着：危险越高越容易，锁着/深处更容易，硬踹过的必有一场 */
export function ambushChance(room: RoomDef, danger: number, forced: boolean): number {
  if (forced) return 1;
  const base = 0.16 + danger * 0.05 + (room.kind === 'flat' ? 0 : 0.07) + (room.lock ? 0.05 : 0);
  return Math.max(0, Math.min(0.85, base));
}

/** 抽这间房的东西：1~3 件；楼里还有没开的加固门、玩家又没钥匙时，有机会翻出楼门钥匙 */
export function rollRoomLoot(
  rng: () => number,
  room: RoomDef,
  opts: { needKey: boolean; valid: (id: string) => boolean },
): string[] {
  const out: string[] = [];
  if (opts.needKey && rng() < 0.38) out.push(ROOM_KEY);
  const keys = Object.keys(room.loot).filter(opts.valid);
  if (!keys.length) return out;
  const n = 1 + Math.floor(rng() * Math.min(3, keys.length));
  for (let i = 0; i < n; i++) out.push(keys[Math.floor(rng() * keys.length)]);
  return out;
}

export function summary(plan: InteriorPlan, st: InteriorState): { total: number; done: number; lockedLeft: number; sealedLeft: number } {
  let done = 0, lockedLeft = 0, sealedLeft = 0;
  for (const r of plan.rooms) {
    if (isLooted(st, r.id)) done++;
    else if (r.lock && !isUnlocked(st, r.id)) { if (r.lock === 'sealed') sealedLeft++; else lockedLeft++; }
  }
  return { total: plan.rooms.length, done, lockedLeft, sealedLeft };
}

export function lockLabel(lock: LockKind | undefined): string {
  return lock === 'sealed' ? '加固门' : lock === 'crowbar' ? '上锁' : '开门';
}
export function kindLabel(kind: RoomKind): string {
  return kind === 'vault' ? '深处 · 好东西' : kind === 'stock' ? '库房' : '前厅';
}
