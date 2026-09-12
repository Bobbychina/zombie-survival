/* M7 · 水体互动的**纯逻辑与数值表**：钓鱼 / 下水游泳 / 水下探索 / 水产养殖。
   与 M6 一样，运行时与模拟脚本共用这一份，禁止另写数值。
   设计口径：
   - 钓鱼：站在水边（相邻有水）用 1 AP；鱼竿 +命中，鱼饵 +命中且被消耗；季节/天气影响很大（冬天 0.35、寒潮 0.1）。
   - 下水：水块可以走，但每格 2 AP、掉体力、体温骤降；没潜水服有抽筋/感染/丢东西的风险。
   - 水下探索：沉没基地（sunken）只能潜水搜，需要氧气（氧气瓶 3 次，否则每次下水只有 1 次机会）。
   - 水产养殖：据点鱼塘每天产鱼，喂饵/菜能翻倍；冬天产量掉到 40%（结冰）。
*/
import type { Season, WeatherId } from './env-core';
import { SEASON_INFO, WEATHER } from './env-core';

/* ── 物品与装备口径 ── */
export const ROD = 'rod';            // 鱼竿（工具，不消耗）
export const BAIT = 'bait';          // 鱼饵（每次消耗 1）
export const FISH = 'fish';          // 鱼
export const COOKED = 'fish_cooked'; // 烤鱼
export const WETSUIT = 'wetsuit';    // 潜水服（body 槽）
export const O2 = 'o2';              // 氧气瓶（水下搜索消耗）

/* ── 钓鱼 ── */
export const FISH_AP = 1;
export const FISH_SPOTS_PER_BLOCK = 3;     // 每个水边点位每天能钓几次
export const FISH_REGEN_DAYS = 1;

export interface FishResult { item: string | null; n: number; text: string }

/** 命中率：基础 0.45 + 鱼竿 0.25 + 鱼饵 0.20，再乘季节与天气 */
export function fishChance(season: Season, weather: WeatherId, hasRod: boolean, hasBait: boolean, night: boolean): number {
  const base = 0.45 + (hasRod ? 0.25 : 0) + (hasBait ? 0.20 : 0);
  const seasonMul = season === 'spring' ? 1.0 : season === 'summer' ? 1.15 : season === 'autumn' ? 1.2 : 0.35;
  const w = WEATHER[weather];
  const weatherMul = w.id === 'rain' ? 1.25 : w.id === 'storm' ? 0.8 : w.id === 'snow' ? 0.5 : w.id === 'cold' ? 0.1 : w.id === 'fog' ? 0.9 : 1;
  const nightMul = night ? 0.9 : 1.05;
  return Math.max(0.02, Math.min(0.95, base * seasonMul * weatherMul * nightMul));
}

/** 一次钓鱼的结果（rng 注入便于测试） */
export function fishOnce(rng: () => number, season: Season, weather: WeatherId, hasRod: boolean, hasBait: boolean, night: boolean): FishResult {
  const p = fishChance(season, weather, hasRod, hasBait, night);
  if (rng() < p) {
    const bonus = hasRod ? 1 : 0;
    const n = 1 + bonus + (rng() < 0.18 ? 1 : 0);
    return { item: FISH, n, text: `🐟 上钩了！${n} 条鱼` };
  }
  const junk = rng();
  if (junk < 0.3) return { item: 'cloth', n: 1, text: '🪝 钓上来一团湿透的破布' };
  if (junk < 0.55) return { item: 'bottle', n: 1, text: '🪝 一个空瓶子' };
  if (junk < 0.75) return { item: 'tape', n: 1, text: '🪝 一段还能用的胶带' };
  return { item: null, n: 0, text: '…水面很静，什么也没有' };
}

/* ── 下水游泳 ── */
export const SWIM_AP_PER_BLOCK = 2;        // 水块每格 2 行动力
export const SWIM_STA = 12;                // 每格掉 12 体力
export const SWIM_TEMP = -6;               // 每格额外体温损失（有潜水服减半）

export interface SwimRisk { cramp: boolean; infect: number; lost: boolean; text: string }

/** 每走一格水的风险：没潜水服才会抽筋/丢东西（有潜水服只留感染风险） */
export function swimRisk(rng: () => number, season: Season, weather: WeatherId, hasWetsuit: boolean): SwimRisk {
  const cold = season === 'winter' || weather === 'snow' || weather === 'cold';
  const crampP = hasWetsuit ? 0 : cold ? 0.42 : 0.25;
  const infectP = hasWetsuit ? 0.06 : 0.15;
  const lostP = hasWetsuit ? 0.02 : 0.10;
  const cramp = rng() < crampP;
  const infect = rng() < infectP ? (cold ? 7 : 5) : 0;
  const lost = rng() < lostP;
  const parts: string[] = [];
  if (cramp) parts.push('腿抽筋（多花体力、掉血）');
  if (infect) parts.push(`污水感染 +${infect}%`);
  if (lost) parts.push('丢了一件小东西');
  return { cramp, infect, lost, text: parts.length ? '🌊 水里有东西拽了你一下：' + parts.join('、') + '。' : '' };
}

/* ── 水下探索（沉没基地） ── */
export const DIVE_AP = 2;
export const O2_PER_TANK = 3;              // 一瓶氧气能搜 3 次
export const DIVE_NO_TANK_LIMIT = 1;       // 没氧气瓶：一次下水只能搜 1 次
export const DIVE_HP_PER_EXTRA = 6;        // 没氧气硬撑：每次掉 6 血

/** 这次水下搜索还能搜几次（氧气上限） */
export function diveBudget(o2Tanks: number, dived: number): { left: number; needTank: boolean } {
  const total = o2Tanks > 0 ? o2Tanks * O2_PER_TANK : DIVE_NO_TANK_LIMIT;
  return { left: Math.max(0, total - dived), needTank: o2Tanks <= 0 };
}

/** 水下战利品（沉没基地的掉落池，越深越肥：这里用"已搜次数"模拟深度） */
export const DIVE_LOOT: { id: string; w: number }[] = [
  { id: 'chip', w: 4 }, { id: 'ammo', w: 3 }, { id: 'kevlar', w: 1.2 }, { id: 'hazmat', w: 1 },
  { id: 'serum', w: 1.4 }, { id: 'o2', w: 2 }, { id: 'wetsuit', w: 0.5 }, { id: 'rifle', w: 0.6 },
  { id: 'metal', w: 3 }, { id: 'chem', w: 2 },
];
export function pickDiveLoot(rng: () => number): string {
  const total = DIVE_LOOT.reduce((a, b) => a + b.w, 0);
  let r = rng() * total;
  for (const it of DIVE_LOOT) { r -= it.w; if (r <= 0) return it.id; }
  return 'metal';
}

/* ── 水产养殖（据点鱼塘） ── */
export const POND_LEVEL_YIELD = [0, 0.6, 1.2, 2.0];   // 每级每天基础产鱼（未投喂）
export const POND_FEED_MUL = 2.2;                     // 投喂后的倍率
export const POND_WINTER_MUL = 0.4;                   // 冬天结冰
export const POND_FEED_ITEMS = ['bait', 'veg', 'grain'];   // 可投喂的东西

/** 鱼塘当天产鱼（含季节与投喂） */
export function pondYield(level: number, season: Season, weather: WeatherId, fed: boolean): number {
  const base = POND_LEVEL_YIELD[Math.max(0, Math.min(3, level))] ?? 0;
  if (base <= 0) return 0;
  const sMul = season === 'winter' ? POND_WINTER_MUL : season === 'summer' ? 1.1 : 1;
  const wMul = weather === 'cold' ? 0.5 : weather === 'snow' ? 0.7 : weather === 'heat' ? 0.8 : 1;
  const raw = base * sMul * wMul * (fed ? POND_FEED_MUL : 1);
  return Math.round(raw * 10) / 10;
}

/** 每 AP/天能拿到多少食物（用于和钓鱼/采集对比，防止鱼塘变成自动贩卖机） */
export function pondFoodPerDay(level: number, season: Season): number {
  return pondYield(level, season, 'clear', true);
}

/* ── 世界放置：沉没基地 ── */
export const SUNKEN_PER_WORLD = 2;      // 每张图 1~2 个水下目标
export const SUNKEN_MIN_DIST = 6;       // 离家 ≥6 区块（要专门跑一趟）
export const SUNKEN_BIOME = 'water';

/** 水块是"浅水"还是"深水"：贴着陆地算浅水（能站、能钓），四周全水算深水（潜水点候选） */
export function waterDepth(isNeighborLand: boolean): 'shallow' | 'deep' {
  return isNeighborLand ? 'shallow' : 'deep';
}

export const seasonFishText = (season: Season) =>
  season === 'winter' ? '❄️ 结冰了：只有凿开冰面才有一点点机会' :
    season === 'autumn' ? '🍂 入秋：鱼最肥的时候' :
      season === 'summer' ? '☀️ 夏天：鱼活跃，但水也臭得快' : '🌱 春天：鱼开始回游';

/* ── M7.1 取水（用户要求"水可以从水体里接"，接回来用净化片或煮沸变净水）── */
export const INTAKE_AP = 1;              // 接一次水花 1 行动力
export const INTAKE_PER_ACTION = 2;      // 一次接 2 份污水（煮沸配方正好 2 份 → 1 份净水）
export const INTAKE_PER_DAY = 3;         // 同一片水域每天最多接 3 次（= 6 份污水/天）

export { SEASON_INFO };
