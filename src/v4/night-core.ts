/* 过夜系统的纯逻辑（不碰 window/legacy，可直接单测）：AP 上限、睡眠债、夜袭概率、点位分档。
   参数集中在这里 —— S1 敏感度矩阵测的就是这几个数。 */
import type { Block } from '../types';

export const AP_MAX_BASE = 9;          // 安全屋睡满后的行动力上限
export const DEBT_PER_FIELD = 0.5;     // 野睡一夜涨半档债
export const DEBT_HEAL_BASE = 2;       // 安全屋睡一夜还 2 档
export const DEBT_CAP = 3;             // 债封顶 3 档（AP 上限最低 6）
export const FIELD_RESTORE = 0.65;     // 野睡恢复上限的 60%~70%（取中值，S1 由矩阵定点）
export const RAID_DOOR_MAX = 0.35;     // 血月被啃：门/墙总伤 ≤ 防线耐久 35%
export const RAID_STORE_MAX = 0.2;     // 血月被啃：单次储物损失 ≤ 20%

export type RestKind = 'base' | 'car' | 'shelter' | 'open';

/** AP 上限是睡眠债的派生值（R5：不单独存字段）。半档债不扣上限，攒满一档才 −1。 */
export const apMaxOf = (debt: number) => Math.max(AP_MAX_BASE - DEBT_CAP, AP_MAX_BASE - Math.floor(debt));
export const isBloodMoonDay = (day: number) => day % 7 === 0;

/** 过夜后的债：安全屋还 2 档，野外涨半档 */
export function nextDebt(debt: number, atBase: boolean): number {
  return atBase ? Math.max(0, debt - DEBT_HEAL_BASE) : Math.min(DEBT_CAP, debt + DEBT_PER_FIELD);
}

/** 夜袭概率：只有安全屋是 0（野睡必须有实质劣势，韩铮红线） */
export function raidChance(kind: RestKind, day: number, noise: number): number {
  if (kind === 'base') return 0;
  const base = kind === 'shelter' ? 0.16 : kind === 'car' ? 0.30 : 0.42;
  return Math.min(0.85, base + day * 0.008 + noise * 0.03);
}

/** 当前点位能提供哪种过夜体验：安全屋 > 掩体类 > 车里 > 教堂/营地 > 露天 */
export function restTierOf(block: Block | null, hasCar: boolean, home: { x: number; y: number }, poiFeat: string | null, poiId: string | null): RestKind {
  if (block && block.x === home.x && block.y === home.y) return 'base';
  if (poiId && ['bunker', 'prison', 'military', 'tunnel'].includes(poiId)) return 'shelter';
  if (hasCar) return 'car';
  if (poiFeat === 'npc' || poiFeat === 'rest') return 'open';
  return 'open';
}
