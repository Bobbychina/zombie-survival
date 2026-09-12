/* M8 · 伐木（玩家反馈"木头找不到"）：把木头做成**可靠、有代价、有成长**的就地来源。
   纯逻辑与唯一数值表：运行时（gather.ts）与单测（tests/wood.test.ts）都读这一份。

   口径（为什么这么定）：
   - 徒手也能砍，且**任何季节都不会砍出 0**（下界 1）：木头是被砍的，不会被"季节"没收；
     采集(forage)在冬天几乎归零（×0.15）已经够狠，木头再归零就等于"冬天没有建材来源"。
   - 季节只调产量：秋 > 春 > 夏 > 冬（冬天地面冻硬、雪里扒不出干柴，×0.4）。
     不学作物的"冬天 0"：作物是活的，木头是死的。
   - 工具只加倍率、不改下限：撬棍 ×1.25（当楔子撬）、消防斧 ×1.6（真正顺手的工具），
     所以"有斧头"是从 1 份变 2 份的成长，而不是"没斧头就砍不到"的墙。
   - 天气只做小幅修正（湿木更重、冻硬更难劈），不让天气盖过季节。
   - 每区块每日次数上限（每天刷新，与钓鱼同款）：林地 6 次最肥，废墟/农田/郊区是"没树林也能捡点柴"的兜底，
     城市/工业/军事/公路/水域 = 0（那里没有树，按钮直接禁用并说明原因）。
   - 附带产出只做"树枝捆/废铁"的量级：每次最多 1 布 + 1 铁，概率低（别把伐木变成万能材料机）。
   - 骰子只有一颗：产量用「随机进位」（floor + 小数位进 1），所以
     ① 同一个 rng 序列下工具/季节的加法关系严格单调（斧头 ≥ 撬棍 ≥ 徒手，逐次可比）；
     ② 同 seed 完全可复现（测试直接断言）。
   值域：可砍群系每次产量 ∈ [1, CHOP_MAX_WOOD(8)]，实际最大 6（林地·秋·斧头）。 */

import type { Season, WeatherId } from './env-core';

export type ChopTool = 'none' | 'crowbar' | 'axe';

export const CHOP_AP = 1;
/** 一次伐木的产量上限（防爆表：季节×天气×工具的浮点连乘也不会超过它） */
export const CHOP_MAX_WOOD = 8;
/** 每次伐木的附带产出概率（树枝捆 / 废铁），刻意压得很低 */
export const CHOP_CLOTH_CHANCE = 0.22;

/** 群系基产（0 = 没树，不可伐） */
export const CHOP_BASE: Record<string, number> = { forest: 3, ruins: 1, farm: 1, suburb: 1 };
/** 每区块每日可伐次数（次日刷新；0 = 不可伐） */
export const CHOP_POOL: Record<string, number> = { forest: 6, ruins: 3, farm: 3, suburb: 2 };
/** 季节系数：秋天好砍（枯枝多、地上干），冬天地面冻硬、干柴被雪埋 —— 冬天不等于 0 */
export const CHOP_SEASON_MUL: Record<Season, number> = { spring: 1.0, summer: 0.9, autumn: 1.25, winter: 0.4 };
/** 天气系数：湿木更重、冻硬更难劈；晴天最好 */
export const CHOP_WEATHER_MUL: Record<WeatherId, number> = {
  clear: 1.0, cloudy: 1.0, rain: 0.95, storm: 0.8, fog: 0.95, snow: 0.8, heat: 0.9, cold: 0.75,
};
/** 工具系数：徒手 < 撬棍（当楔子）< 消防斧 */
export const CHOP_TOOL_MUL: Record<ChopTool, number> = { none: 1, crowbar: 1.25, axe: 1.6 };
/** 各群系的废铁概率（树枝里缠着的铁丝、钉子；林地最低） */
export const CHOP_METAL_CHANCE: Record<string, number> = { forest: 0.08, farm: 0.12, suburb: 0.15, ruins: 0.25 };

export const chopSpots = (biome: string): number => CHOP_POOL[biome] ?? 0;
export const canChop = (biome: string): boolean => chopSpots(biome) > 0;

/** 有斧头就用斧头，其次撬棍，都没有就徒手 */
export function chopToolOf(axes: number, crowbars: number): ChopTool {
  return axes > 0 ? 'axe' : crowbars > 0 ? 'crowbar' : 'none';
}

export interface ChopRec { left: number; day: number }

/** 当日剩余次数：隔天自动回满（与钓鱼/取水同款"每天刷新"） */
export function chopLeft(rec: ChopRec | undefined, day: number, biome: string): number {
  const spots = chopSpots(biome);
  if (!rec || rec.day !== day) return spots;
  const left = typeof rec.left === 'number' && isFinite(rec.left) ? rec.left : spots;
  return Math.max(0, Math.min(spots, Math.floor(left)));
}

/** 一次伐木的产量（可砍群系恒 ∈ [1, CHOP_MAX_WOOD]） */
export function chopWood(rng: () => number, biome: string, season: Season, weather: WeatherId, tool: ChopTool): number {
  const base = CHOP_BASE[biome] ?? 0;
  if (base <= 0) return 0;
  const mul = CHOP_SEASON_MUL[season] * (CHOP_WEATHER_MUL[weather] ?? 1) * CHOP_TOOL_MUL[tool];
  const y = Math.min(CHOP_MAX_WOOD, base * mul);
  const f = Math.floor(y);
  // 单颗骰子的"随机进位"：既带来浮动，又让 y 的单调性逐次可比（同一 u 下斧头必 ≥ 撬棍）
  const n = f + (rng() < y - f ? 1 : 0);
  return Math.max(1, Math.min(CHOP_MAX_WOOD, n));   // 下界 1：木头永远砍得到，这才是"可靠来源"
}

export interface ChopInput {
  biome: string; season: Season; weather: WeatherId; tool: ChopTool; left: number;
}
export interface ChopResult { ok: boolean; wood: number; extra: { id: string; n: number }[]; left: number; why?: string }

/** 面板"约 X 木"用的期望值（同 chopWood 的均值取整，下限 1） */
export function chopEstimate(biome: string, season: Season, weather: WeatherId, tool: ChopTool): number {
  const base = CHOP_BASE[biome] ?? 0;
  if (base <= 0) return 0;
  const y = Math.min(CHOP_MAX_WOOD, base * CHOP_SEASON_MUL[season] * (CHOP_WEATHER_MUL[weather] ?? 1) * CHOP_TOOL_MUL[tool]);
  return Math.max(1, Math.round(y));
}

export const CHOP_NO_TREE_WHY = '这一带没有树（林地/废墟/农田/郊区才能砍）';
export const CHOP_DAILY_LIMIT_WHY = '今天的柴火砍够了，明天再来';

/** 一次完整的伐木结算（纯函数：上限判定 + 产量 + 附带产出 + 扣次数），上限用尽时 ok=false 且不产出 */
export function chopOnce(rng: () => number, o: ChopInput): ChopResult {
  if (!canChop(o.biome)) return { ok: false, wood: 0, extra: [], left: 0, why: CHOP_NO_TREE_WHY };
  if (o.left <= 0) return { ok: false, wood: 0, extra: [], left: 0, why: CHOP_DAILY_LIMIT_WHY };
  const wood = chopWood(rng, o.biome, o.season, o.weather, o.tool);
  const extra: { id: string; n: number }[] = [];
  if (rng() < CHOP_CLOTH_CHANCE) extra.push({ id: 'cloth', n: 1 });          // 树枝捆/藤条 → 当布料用
  const metal = CHOP_METAL_CHANCE[o.biome] ?? 0;
  if (metal > 0 && rng() < metal) extra.push({ id: 'metal', n: 1 });         // 钉子/铁丝
  return { ok: true, wood, extra, left: o.left - 1 };
}
