/* 搜刮的纯逻辑（不碰 window/legacy，可直接单测）：掷结果、抽掉落、决定遇到几只 */
import { POIS } from './pois';

export type SearchKind = 'fight' | 'item' | 'mats' | 'food' | 'lore' | 'trap' | 'empty';
export interface SearchWeights { fight: number; item: number; mats: number; food: number; lore: number; trap: number; empty: number }

/** 按权重掷结果 */
export function rollSearchKind(rng: () => number, w: SearchWeights): SearchKind {
  const keys = Object.keys(w) as SearchKind[];
  const total = keys.reduce((a, k) => a + w[k], 0);
  let r = rng() * total;
  for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
  return 'empty';
}

/** POI 搜刮的权重：危险越高越容易打起来；深搜收益更高但更吵更疼 */
export function searchWeights(poiId: string, danger: number, deep: boolean, luck: number): SearchWeights {
  const feat = POIS[poiId]?.feat;
  return {
    fight: (0.28 + danger * 0.045) * (deep ? 1.35 : 1) * (1 - luck),
    item: (feat === 'food' || feat === 'medical' || feat === 'tools' ? 0.26 : 0.17) * (deep ? 1.4 : 1),
    mats: deep ? 0.16 : 0.20,
    food: feat === 'food' || feat === 'water' ? 0.14 : 0.04,
    lore: 0.07 * (deep ? 2.2 : 1),
    trap: 0.06 + danger * 0.012,
    empty: deep ? 0.07 : 0.13,
  };
}

/** 从掉落表里按权重抽一件（过滤掉 legacy 里不存在的 id，避免"抽到空气"） */
export function pickLoot(rng: () => number, table: Record<string, number>, valid: (id: string) => boolean): string | null {
  const keys = Object.keys(table).filter(valid);
  if (!keys.length) return null;
  const total = keys.reduce((a, k) => a + table[k], 0);
  let r = rng() * total;
  for (const k of keys) { r -= table[k]; if (r <= 0) return k; }
  return keys[keys.length - 1];
}

/** 拆解材料档的产出：普通 ×1.3 / 深搜 ×1.5，再叠加该 POI 的 matBonus（建材类建筑专属加成，M7.1）。
 *  抽成纯函数是为了能单测"建材市场确实比小卖部多给"这件事——不然只能靠跑图撞运气。 */
export function matYield(rng: () => number, danger: number, deep: boolean, bonus: number, mulNormal: number, mulDeep: number): number {
  const base = deep ? (4 + Math.floor(rng() * 6) + danger * 3 + 4) : (2 + Math.floor(rng() * 4) + danger);
  return Math.max(1, Math.round(base * (deep ? mulDeep : mulNormal)) + bonus);
}

/** 搜刮要记的账（悬赏板 / 委托 / 大故事章节 / 成就都读这几本账）。
 *  **必须与"这一趟有没有出货"解耦**：账记的是"你来过、你搜了"，不是"你搜到了"。
 *  M35 用户报障的根因就在这里 —— 药房被搜空之后走的是早退分支，那支不记账，
 *  于是「补给清单：去药房翻一趟」怎么搜都推不动（实测：zoneCnt 一直不动、委托卡 0/1）。 */
export interface SearchStats { scav?: number; deep?: number; zoneCnt?: Record<string, number> }

export function tallySearch(
  stats: SearchStats,
  rzones: Record<string, Record<string, number>>,
  region: string,
  poiId: string,
  zone: string | null,
  deep: boolean,
): void {
  stats.scav = (stats.scav || 0) + 1;
  if (deep) stats.deep = (stats.deep || 0) + 1;
  const zc = (stats.zoneCnt = stats.zoneCnt || {});
  if (zone) zc[zone] = (zc[zone] || 0) + 1;        // legacy 区域粒度（老悬赏板按这个判）
  zc[poiId] = (zc[poiId] || 0) + 1;                // M13：POI 粒度（委托文案写的是"药房"）
  const bag = (rzones[region] = rzones[region] || {});
  bag[poiId] = (bag[poiId] || 0) + 1;              // M14：区域 + POI（跨区委托 `rzone:<区>:*`）
}

/** 这个 POI 会派出哪些丧尸：危险越高、深搜时数量越多 */
export function foesFor(rng: () => number, poiId: string, danger: number, deep: boolean): string[] {
  const pool = POIS[poiId]?.enemies ?? ['walker'];
  const max = Math.max(1, Math.min(3, 1 + Math.floor(danger / 3) + (deep ? 1 : 0)));
  const n = 1 + Math.floor(rng() * max);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.floor(rng() * pool.length)] ?? 'walker');
  return out;
}
