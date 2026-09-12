/* M6 · 季节 / 天气 / 体温 / 作物的**纯逻辑与唯一数值表**。
   运行时（src/v4/env.ts、farm.ts）与 100 天模拟脚本（tests/sim100.test.ts）都必须读这一份，
   避免"脚本一套数值、游戏另一套"（会议 C15 硬性要求）。
   会议上锁定的口径：
   - 每 30 天一个季节：春 1-30 / 夏 31-60 / 秋 61-90 / 冬 91+
   - 作物系数 春 1.0 / 夏 0.8 / 秋 1.3 / 冬 0（户外停摆）
   - 腐坏 夏 ×1.5 / 冬 ×0.6
   - 体温 0~100（50 = 舒适），单阈值 + 一档惩罚，火堆/室内可对抗，不做持续掉血
   - 天气每天掷一次、可预报明天，影响采集/作物/腐坏/火堆/移动/体温/取水
*/

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherId = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'heat' | 'cold';

export const SEASON_LEN = 30;
export const seasonOf = (day: number): Season =>
  day <= 30 ? 'spring' : day <= 60 ? 'summer' : day <= 90 ? 'autumn' : 'winter';

export const SEASON_INFO: Record<Season, { name: string; icon: string; crop: number; rot: number; tempBase: number; desc: string }> = {
  spring: { name: '春', icon: '🌱', crop: 1.0, rot: 1.0, tempBase: 0, desc: '回暖、多雨，正是播种的时候。' },
  summer: { name: '夏', icon: '☀️', crop: 0.8, rot: 1.5, tempBase: 4, desc: '热、缺水，食物烂得快，尸体的味道也更冲。' },
  autumn: { name: '秋', icon: '🍂', crop: 1.3, rot: 0.85, tempBase: -1, desc: '抢收季：产量最高，但白天在变短。' },
  winter: { name: '冬', icon: '❄️', crop: 0.0, rot: 0.6, tempBase: -7, desc: '户外种不了东西，体温掉得比什么都快。' },
};

export interface WeatherDef {
  id: WeatherId;
  name: string;
  icon: string;
  /** 各季节出现权重（0 = 该季节不会出现） */
  w: Record<Season, number>;
  forage: number;      // 采集产出倍率（0 = 基本采不到）
  crop: number;        // 作物生长倍率
  rot: number;         // 腐坏速度倍率
  fire: boolean;       // 能不能生火
  moveAP: number;      // 每 4 公里额外行动力
  tempDelta: number;   // 每次暴露的体温变化
  water: number;       // 每天自动积水（污水）
  encounter: number;   // 遭遇率倍率
  desc: string;
}

const W = (d: Partial<WeatherDef> & { id: WeatherId; name: string; icon: string; w: Record<Season, number> }): WeatherDef => ({
  forage: 1, crop: 1, rot: 1, fire: true, moveAP: 0, tempDelta: 0, water: 0, encounter: 1, desc: '', ...d,
});

export const WEATHER: Record<WeatherId, WeatherDef> = {
  clear: W({ id: 'clear', name: '晴', icon: '☀️', w: { spring: 3, summer: 5, autumn: 3, winter: 2 }, desc: '能见度好，适合出门。' }),
  cloudy: W({ id: 'cloudy', name: '阴', icon: '☁️', w: { spring: 4, summer: 3, autumn: 4, winter: 4 }, crop: 0.95, desc: '不晒也不冷。' }),
  rain: W({ id: 'rain', name: '雨', icon: '🌧️', w: { spring: 5, summer: 3, autumn: 4, winter: 1 }, forage: 1.2, crop: 1.15, rot: 1.2, water: 1, tempDelta: -1, desc: '雨水能接，火堆难生。' }),
  storm: W({ id: 'storm', name: '暴雨', icon: '⛈️', w: { spring: 2, summer: 2, autumn: 2, winter: 0 }, forage: 0.7, crop: 0.8, rot: 1.3, fire: false, moveAP: 1, water: 2, tempDelta: -3, encounter: 1.1, desc: '生不了火，走路更慢，但能接不少水。' }),
  fog: W({ id: 'fog', name: '雾', icon: '🌫️', w: { spring: 2, summer: 1, autumn: 3, winter: 2 }, forage: 0.8, crop: 0.9, encounter: 1.35, desc: '看不远：更容易撞上东西。' }),
  snow: W({ id: 'snow', name: '雪', icon: '🌨️', w: { spring: 0, summer: 0, autumn: 1, winter: 6 }, forage: 0.15, crop: 0, rot: 0.7, moveAP: 1, water: 1, tempDelta: -6, desc: '雪水能化，但体温掉得很快。' }),
  heat: W({ id: 'heat', name: '热浪', icon: '🔥', w: { spring: 0, summer: 4, autumn: 1, winter: 0 }, forage: 0.85, crop: 0.7, rot: 1.5, tempDelta: 6, water: 0, desc: '水分流失加快，作物会被烤。' }),
  cold: W({ id: 'cold', name: '寒潮', icon: '🧊', w: { spring: 1, summer: 0, autumn: 2, winter: 5 }, forage: 0.05, crop: 0, rot: 0.6, moveAP: 1, tempDelta: -12, desc: '采集几乎归零，户外作物停摆，体温暴跌。' }),
};

export const WEATHER_LIST = Object.keys(WEATHER) as WeatherId[];

/** 按季节权重掷今天的天气（rng 注入，便于模拟与测试复现） */
export function rollWeather(rng: () => number, season: Season): WeatherId {
  const total = WEATHER_LIST.reduce((a, id) => a + WEATHER[id].w[season], 0);
  if (total <= 0) return 'cloudy';
  let r = rng() * total;
  for (const id of WEATHER_LIST) { r -= WEATHER[id].w[season]; if (r <= 0) return id; }
  return 'cloudy';
}

/** 明天天气（预报用，确定性：由 seed + 天数决定） */
export function forecastWeather(rng: () => number, day: number): WeatherId {
  return rollWeather(rng, seasonOf(day + 1));
}

/* ── 体温 ── */
export const TEMP_COMFORT = 50;          // 0~100，50 = 舒服
export const TEMP_LOW = 30;              // 低于此值触发一档惩罚
export const TEMP_HIGH = 80;             // 高于此值水分流失加快
export const TEMP_MIN = 0, TEMP_MAX = 100;

export interface TempInput {
  season: Season;
  weather: WeatherId;
  /** 据点室内 / 火堆旁：把天气影响完全抵消 */
  shelter: boolean;
  /** 有保暖衣物（第二波的衣物槽；没有就是 0） */
  warmClothes?: number;
  night?: boolean;
}

/** 一次"暴露"（一次行动或一个晚上）后的体温变化量 */
export function tempDrift(inp: TempInput): number {
  const s = SEASON_INFO[inp.season].tempBase;          // 冬 -7 / 夏 +4：基线越冷，漂移越负
  const w = inp.weather ? WEATHER[inp.weather].tempDelta : 0;
  if (inp.shelter) return Math.min(4, 6 + s * 0.5);    // 火堆/室内：回一点，天气完全不算
  let d = (s * 0.6) + w + (inp.night ? -2 : 0) + (inp.warmClothes ?? 0);
  return Math.max(-14, Math.min(6, d));
}

/** 体温落到阈值以下的惩罚：一档（AP 上限 −1、命中 −10%），不做持续掉血（会议口径） */
export function tempPenalty(temp: number): { ap: number; hit: number; note: string | null } {
  if (temp < TEMP_LOW) return { ap: -1, hit: -0.1, note: '❄️ 体温过低：行动力上限 −1、命中 −10%（去火堆或室内缓一缓）' };
  if (temp > TEMP_HIGH) return { ap: 0, hit: 0, note: '🔥 体温偏高：水分流失加快' };
  return { ap: 0, hit: 0, note: null };
}

/** 高温时水分的额外流失倍率 */
export const heatWaterMul = (temp: number) => (temp > TEMP_HIGH ? 1.6 : 1);

/* ── 作物 ── */
export interface CropDef {
  id: string;
  name: string;
  icon: string;
  seed: string;          // 种子物品 id
  out: string;           // 收获物
  days: number;          // 基准生长天数（再除以季节系数）
  yield: number;         // 每地块每茬产量（封顶，不许再乘）
  keepSeedCost: number;  // 留种要少收几份
  desc: string;
}

export const CROPS: Record<string, CropDef> = {
  veg: { id: 'veg', name: '蔬菜', icon: '🥬', seed: 'seed_veg', out: 'veg', days: 5, yield: 2, keepSeedCost: 1, desc: '快熟低产：5 天就能吃上，但每块地只收 2 份。' },
  grain: { id: 'grain', name: '麦子', icon: '🌾', seed: 'seed_grain', out: 'grain', days: 9, yield: 5, keepSeedCost: 2, desc: '慢熟高产：9 天，收 5 份，还能磨成面粉。' },
};
export const CROP_LIST = Object.keys(CROPS);

/** 实际生长天数 = 基准 ÷ 季节系数（向上取整；系数 0 = 户外停摆） */
export function growthDays(cropId: string, season: Season): number {
  const c = CROPS[cropId];
  const mul = SEASON_INFO[season].crop;
  if (!c || mul <= 0) return Infinity;
  return Math.max(1, Math.ceil(c.days / mul));
}

/** 一茬收成（含天气折损与留种代价），返回 null 表示这一茬绝收 */
export function harvestYield(cropId: string, season: Season, weather: WeatherId, keepSeed: boolean, rng: () => number): number | null {
  const c = CROPS[cropId];
  if (!c) return null;
  const mul = SEASON_INFO[season].crop * WEATHER[weather].crop;
  if (mul <= 0) return null;
  const base = Math.round(c.yield * mul);
  if (base <= 0) return null;
  const jitter = rng() < 0.15 ? -1 : 0;
  const n = base + jitter - (keepSeed ? c.keepSeedCost : 0);
  return Math.max(0, n);
}

/** 每天的菜园产出期望（每地块，食物份/天）—— 采集与菜园的封顶比较都用它 */
export function cropFoodPerDay(cropId: string, season: Season): number {
  const c = CROPS[cropId];
  const d = growthDays(cropId, season);
  if (!c || !isFinite(d)) return 0;
  return c.yield / d;
}

/** 生鲜腐坏天数（季节修正）：夏更短、冬更长 */
export function rotDays(itemId: string, season: Season, base = 4): number {
  return Math.max(1, Math.round(base / SEASON_INFO[season].rot));
}

/* ── 取水 ── */
export const RAIN_CAP_PER_DAY = 2;        // 每天最多靠接雨水拿到 2 份污水（会议 C2 的每日上限）
export const rainWaterToday = (weather: WeatherId) => Math.min(RAIN_CAP_PER_DAY, WEATHER[weather].water);

/* ── 采集与拆解（会议 C5/C8 的上限口径） ── */
export interface ForageYields { items: { id: string; n: number }[]; ap: number }
export const FORAGE_AP = 1;
export const FORAGE_POOL: Record<string, number> = { forest: 5, farm: 4, suburb: 3, ruins: 3, city: 2, industrial: 2, military: 2, highway: 1, water: 0 };
export const FORAGE_REGEN_DAYS = 3;       // 采过之后几天回一点

/** 一次采集的产出（季节/天气决定倍率，冬天几乎归零） */
export function forageYields(
  rng: () => number, biome: string, season: Season, weather: WeatherId,
): ForageYields {
  const mul = WEATHER[weather].forage * (season === 'winter' ? 0.15 : season === 'autumn' ? 1.15 : 1);
  if (mul <= 0.05) return { items: [], ap: FORAGE_AP };
  const n = (base: number) => (rng() < Math.min(0.95, base * mul) ? 1 : 0);
  const items: { id: string; n: number }[] = [];
  const berries = n(season === 'autumn' ? 0.6 : 0.45);
  if (berries) items.push({ id: 'berry', n: season === 'autumn' ? 2 : 1 });
  const shrooms = n(season === 'spring' ? 0.4 : season === 'autumn' ? 0.35 : 0.2);
  if (shrooms) items.push({ id: 'mushroom', n: 1 });
  const wood = n(biome === 'forest' ? 0.5 : 0.25);
  if (wood) items.push({ id: 'wood', n: 1 });
  const water = n((biome === 'farm' || biome === 'suburb') ? 0.2 : 0.12);
  if (water) items.push({ id: 'dirty', n: 1 });
  const seed = n(0.18);
  if (seed) items.push({ id: rng() < 0.6 ? 'seed_veg' : 'seed_grain', n: 1 });
  return { items, ap: FORAGE_AP };
}

/** 拆解：每区块有资源池，拆光了就没了（禁止无限材料机） */
export const SALVAGE_AP = 1;
export const SALVAGE_POOL: Record<string, number> = { industrial: 6, ruins: 5, city: 4, military: 5, suburb: 3, highway: 3, farm: 2, forest: 2, water: 0 };
export function salvageYields(rng: () => number, biome: string, danger: number): { items: { id: string; n: number }[]; ap: number } {
  const mats = 2 + Math.floor(rng() * 2) + Math.floor(danger / 2);
  const items: { id: string; n: number }[] = [{ id: 'MAT', n: mats }];
  if (rng() < 0.3) items.push({ id: 'metal', n: 1 });
  if (rng() < 0.22) items.push({ id: 'wood', n: 1 });
  if (rng() < 0.12) items.push({ id: 'tape', n: 1 });
  if (rng() < 0.1) items.push({ id: 'cloth', n: 1 });
  return { items, ap: SALVAGE_AP };
}

/* ── 装备保底（会议 C6/C13） ── */
/** danger≥2 的军械类 POI，首次深搜必出一件装备，按危险度分档 */
export const GEAR_HOSTS = ['police', 'military', 'prison', 'bunker', 'tunnel', 'outpost'];
export const GEAR_BY_DANGER: Record<number, string[]> = {
  2: ['vest', 'helmet', 'boots', 'backpack', 'machete'],
  3: ['vest', 'helmet', 'boots', 'backpack', 'kevlar', 'shotgun', 'gasmask'],
  4: ['kevlar', 'helmet', 'hazmat', 'rifle', 'gasmask', 'backpack'],
  5: ['kevlar', 'hazmat', 'rifle', 'marksman', 'gasmask'],
};
export function pickGear(rng: () => number, danger: number): string {
  const tier = danger >= 5 ? 5 : danger >= 4 ? 4 : danger >= 3 ? 3 : 2;
  const pool = GEAR_BY_DANGER[tier];
  return pool[Math.floor(rng() * pool.length)] ?? 'vest';
}

/* ── 材料产出提速（会议 C5：普通 ×1.3、深搜 ×1.5，且深搜本身有 AP/遭遇代价） ── */
export const MAT_MUL_NORMAL = 1.3;
export const MAT_MUL_DEEP = 1.5;
