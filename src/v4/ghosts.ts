/* 幽灵据点的接线层（M20）：
   · 导入/导出的幽灵码存在 `zsv_ghosts_v1`（本机）；
   · 打开一张局部图时，把每个幽灵按"码 + 世界种子"钉到一格上（幂等：同一张图每次都钉在同一格）；
   · 在那格上搜刮 = 打一场按威胁度缩放的守卫战，赢了抢走快照里的部分材料（**上传者本人不受影响**）。 */
import { L } from '../main';
import { ghostLoot, ghostPlacement, ghostBlockName, parseGhostCode, resolveGhostSpot, type GhostSpec } from './ghosts-core';
import { GHOST_BIOMES } from './ghosts-core';
import { bkey } from './worldgen';
import type { WorldState } from '../types';
import { ensureSaveWorld } from './worldstate';

export const GHOST_KEY = 'zsv_ghosts_v1';
export const GHOST_POI = 'ghost';

export interface StoredGhost { spec: GhostSpec; addedAt: number; cleared?: boolean }

export function loadGhosts(): StoredGhost[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GHOST_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(g => g && typeof g === 'object' && g.spec && typeof g.spec.owner === 'string')
      .slice(0, 20)
      .map(g => ({ spec: g.spec as GhostSpec, addedAt: Number(g.addedAt) || 0, cleared: !!g.cleared }));
  } catch { return []; }
}

function save(list: StoredGhost[]): void {
  try { localStorage.setItem(GHOST_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* 隐私模式：存不下就只在内存里 */ }
}

/** 导入一个幽灵码（重复码会被忽略，不让列表无限膨胀） */
export function importGhost(code: string): { ok: boolean; why?: string; spec?: GhostSpec } {
  const r = parseGhostCode(code);
  if (!r.ok) return { ok: false, why: r.why };
  const list = loadGhosts();
  const dup = list.some(g => JSON.stringify(g.spec) === JSON.stringify(r.spec));
  if (dup) return { ok: false, why: '这个幽灵已经在你的地图上了' };
  if (list.length >= 20) return { ok: false, why: '最多挂 20 个幽灵据点，先清掉几个' };
  list.push({ spec: r.spec, addedAt: Date.now() });
  save(list);
  L.log('👻 幽灵据点已挂上你的地图：' + ghostBlockName(r.spec) + '（打赢能拿到它的仓库，对方本人不受影响）。', 'lore');
  L.autosave();
  return { ok: true, spec: r.spec };
}

export function clearGhosts(): void { save([]); }

/** 把幽灵据点钉到地图上（幂等；只钉在合适的地表、且不在安全屋门口） */
export function placeGhosts(w: WorldState): number {
  const list = loadGhosts().filter(g => !g.cleared);
  let n = 0;
  for (const g of list) {
    const p = ghostSpot(w, g.spec);
    if (!p) { console.warn('[v4] 幽灵据点没找到落脚点', g.spec.owner); continue; }   // 绝不静默失败
    const b = w.blocks[bkey(p.x, p.y)];
    b.poi = GHOST_POI;
    b.name = ghostBlockName(g.spec);
    b.danger = Math.max(b.danger, 3);
    n++;
  }
  return n;
}

/** 某一格能不能放幽灵据点（地表合适、不是实验室/沉没基地/安全屋） */
function canPlace(w: WorldState, x: number, y: number): boolean {
  const b = w.blocks[bkey(x, y)];
  if (!b) return false;
  if (!GHOST_BIOMES.includes(b.biome)) return false;
  if (b.poi === 'lab' || b.poi === 'sunken') return false;
  if (x === w.home.x && y === w.home.y) return false;
  return true;
}

/** 这个幽灵在"这张图上"到底落在哪：偏好点不合法就往外找（确定性，同一图同码永远同一格） */
export function ghostSpot(w: WorldState, spec: GhostSpec): { x: number; y: number } | null {
  const prefer = ghostPlacement(spec, w.seed, w.w, w.h, w.home);
  return resolveGhostSpot(prefer, (x, y) => canPlace(w, x, y), w.w, w.h);
}

/** 这一格是哪个幽灵（按落点反查） */
export function ghostAt(w: WorldState, x: number, y: number): StoredGhost | null {
  for (const g of loadGhosts().filter(g => !g.cleared)) {
    const p = ghostSpot(w, g.spec);
    if (p && p.x === x && p.y === y) return g;
  }
  return null;
}

/** 打赢：抢走快照里的材料与一件压箱底的东西（上传者不受影响），并把它标记为已清 */
export function raidGhost(w: WorldState, block: { x: number; y: number }): void {
  const g = ghostAt(w, block.x, block.y);
  if (!g) return;
  const loot = ghostLoot(g.spec);
  const S = L.S as any;
  S.mat = Math.max(0, S.mat + loot.mat);
  L.grant(loot.item, loot.n);
  const list = loadGhosts().map(x => (x.addedAt === g.addedAt ? { ...x, cleared: true } : x));
  save(list);
  L.log('👻 你清掉了 ' + g.spec.owner + ' 的幽灵据点：翻出 ' + loot.mat + ' 材料，还有一份「' + L.itemName(loot.item) + '」。' +
    '（这是你导入的那份快照，' + g.spec.owner + ' 本人的存档没有被动过。）', 'loot');
  L.toast('幽灵据点已清', g.spec.owner + '：+' + loot.mat + ' 材料', 'ok');
  L.sfx('loot');
  L.autosave();
  L.render();
}

/** 从"自己的仓库"造一份快照给人挑战 */
export function myGhostSpec(owner: string, tag: string): GhostSpec | null {
  const S = L.S as any;
  const sw = ensureSaveWorld(S);
  const items: { id: string; n: number }[] = [];
  try {
    const inv = S.inv || {};
    for (const id in inv) {
      const n = typeof inv[id] === 'number' ? inv[id] : (inv[id]?.n ?? 0);
      if (n > 0) items.push({ id, n });
    }
  } catch { /* 背包形状不对就当没有 */ }
  const day = Number(S.day) || 1;
  const veh = sw.veh ? 1 : 0;
  return {
    owner: String(owner || '幸存者').slice(0, 8),
    mat: Math.max(0, Math.floor(Number(S.mat) || 0)),
    item: items.slice().sort((a, b) => b.n - a.n)[0]?.id ?? 'can',
    itemN: items.slice().sort((a, b) => b.n - a.n)[0]?.n ?? 1,
    threat: Math.max(1, Math.min(5, 1 + Math.floor(day / 15) + veh)),
    day,
    tag: String(tag || '来拿啊。').slice(0, 20),
  };
}
