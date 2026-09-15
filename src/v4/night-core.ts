/* 过夜系统的纯逻辑（不碰 window/legacy，可直接单测）：AP 上限、睡眠债、夜袭概率、点位分档。
   参数集中在这里 —— S1 敏感度矩阵测的就是这几个数。 */
import type { Block } from '../types';

/* M25.2：一天从 9 点行动力提到 14 点 —— 用户原话「一天也太短了」。
   病灶不是"格子走不动"，而是**一整套动作塞不进一天**：走到远处 POI（4~5 点）+ 搜两处（2~4 点）
   + 做一件东西（1 点）就已经见底，玩家根本没机会"这一天我干了三件事"。
   调大一天的同时把成本表**一个都不动**（搜索 1 点、深搜 2 点、走路 1 点/区块、制作/建造 1 点），
   于是同一次出勤能做 14 点的事——难度靠"夜里更饿更渴 + 尸潮风险"来平衡，不靠卡行动力。
   （夜间饥渴/腐坏是按天结算的，白天不再有额外惩罚：见 tickVitals 由行动驱动。） */
export const AP_MAX_BASE = 14;         // 安全屋睡满后的行动力上限
export const DEBT_PER_FIELD = 0.5;     // 野睡一夜涨半档债
export const DEBT_HEAL_BASE = 2;       // 安全屋睡一夜还 2 档
export const DEBT_CAP = 3;             // 债封顶 3 档（AP 上限最低 6）
export const FIELD_RESTORE = 0.65;     // 野睡恢复上限的 60%~70%（取中值，S1 由矩阵定点）
export const RAID_DOOR_MAX = 0.35;     // 血月被啃：门/墙总伤 ≤ 防线耐久 35%
export const RAID_STORE_MAX = 0.2;     // 血月被啃：单次储物损失 ≤ 20%

export type RestKind = 'base' | 'car' | 'shelter' | 'open';

/** AP 上限是睡眠债的派生值（R5：不单独存字段）。半档债不扣上限，攒满一档才 −1。 */
export const apMaxOf = (debt: number) => Math.max(AP_MAX_BASE - DEBT_CAP, AP_MAX_BASE - Math.floor(debt));

/** M25.2：体能技能直接换算成"一天能做多少事"——每 3 级 +1 行动力，最多 +5（14 → 19）。
    这是让"练体能"这件事第一次有了可感知的回报：不只是跑得快，而是这一天能多跑一趟。
    放在这里而不是 legacy 里，是为了让 night.ts 结算与 HUD/地图上的显示用同一个算法。 */
export const fitnessApBonus = (fitnessLevel: number) =>
  Math.max(0, Math.min(5, Math.floor(Math.max(0, Number(fitnessLevel) || 0) / 3)));
/** 含体能加成的行动力上限 */
export const apCapOf = (debt: number, fitnessLevel = 0) => apMaxOf(debt) + fitnessApBonus(fitnessLevel);
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
