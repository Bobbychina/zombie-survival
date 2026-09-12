/* 主线 v4 层：把「三块门禁卡碎片」钉在三个相隔很远的目标点上。
   目的（用户要求）：通关必须横穿大世界 —— 碎片位置由 seed 决定，只在地图上点亮后才找得到；
   到了、搜了才能拿到，凑齐 3 块才推得动 legacy 的主线阶段 2 → 3。 */
import seedrandom from 'seedrandom';
import type { Block, WorldState } from '../types';
import { bkey } from './worldgen';

/** 碎片藏在哪些类型的 POI（都是远处的硬骨头） */
const HOSTS = ['military', 'prison', 'bunker', 'tunnel', 'radio'];

export interface Frag { x: number; y: number; poi: string; key: string; taken: boolean }

/** 三个碎片点：距家 4~13 区块，互不相邻，按 seed 稳定。
    先挑 HOSTS 里的硬据点；凑不满 3 个就退而求其次挑任意 POI，
    保证"碎片一定存在"——否则玩家只能靠随机掉落凑门禁卡，主线会变成看脸。 */
export function fragSpots(w: WorldState): Frag[] {
  const rng = seedrandom(w.seed + ':frag');
  const near = (b: Block) => {
    const d = Math.max(Math.abs(b.x - w.home.x), Math.abs(b.y - w.home.y));
    return d >= 4 && d <= 13;
  };
  const shuffle = (arr: Block[]) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const pick = (cands: Block[], out: Frag[], need: number) => {
    for (const b of cands) {
      if (out.length >= need) break;
      if (!b.poi || b.poi === 'lab') continue;
      if (out.some(f => Math.max(Math.abs(f.x - b.x), Math.abs(f.y - b.y)) < 4)) continue;   // 三个点别挤在一块
      out.push({ x: b.x, y: b.y, poi: b.poi, key: bkey(b.x, b.y), taken: false });
    }
  };
  const all: Block[] = [];
  for (const k in w.blocks) {
    const b = w.blocks[k];
    if (b.poi && b.poi !== 'lab' && near(b)) all.push(b);
  }
  // 稳一点：先按坐标排序再洗牌，避免不同引擎的枚举顺序影响结果
  all.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const hard = shuffle(all.filter(b => HOSTS.includes(b.poi!)));
  const rest = shuffle(all.filter(b => !HOSTS.includes(b.poi!)));
  const out: Frag[] = [];
  pick(hard, out, 3);
  pick(rest, out, 3);
  return out;
}

/** 这一格有没有（还没被拿走的）碎片 */
export function fragAt(w: WorldState, x: number, y: number): Frag | null {
  const k = bkey(x, y);
  return fragSpots(w).find(f => f.key === k) ?? null;
}
