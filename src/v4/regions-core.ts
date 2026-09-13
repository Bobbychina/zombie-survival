/* 多区域大世界（元地图）——纯逻辑，不碰 DOM、不碰 legacy。
 *
 * 设计：
 *   · 元地图是 3×3 共 9 个区域，每个区域各自是一张 24×24 的格子世界（生成方式与旧的完全一样，
 *     只是 seed 由 "基础种子 + 区域 id" 派生，所以每区地形/POI 都不同且可复现）。
 *   · **区域内**：正常格子走动，不需要任何交通工具（沿用原有寻路与行动力）。
 *   · **跨区域**：必须持有载具且油够（用户设定的硬门槛），只能去"相邻"区域（正交/斜向都算相邻）。
 *       - 没车 → 给明确理由（不是"不能去"，而是"130 公里，走不到"）
 *       - 有车没油 → 提示去加油站/物流园弄油
 *   · 危险度按区域分层：中心（余烬市区）最安全，越往外越硬，给"出门远征"一个梯度。
 */

export interface RegionDef {
  id: string;
  name: string;
  short: string;         // 元地图格子里的短名（2~4 字）
  icon: string;
  col: number;           // 元地图列（0..2）
  row: number;           // 元地图行（0..2）
  tier: number;          // 危险层级 1..5（1 = 主城，5 = 最外圈）
  biomeBias: string;     // 该区的主题（只用于文案与生成提示）
  desc: string;
  /** 只有中心区有安全屋；其余区域算"前哨"，过夜规则更狠 */
  homeBase: boolean;
  /** 首次进入的固定叙事文案（大故事的钩子） */
  firstEnter?: string;
}

/** 3×3 元地图：正中间是玩家起点（旧存档的那张 24×24 就是它，所以老档天然兼容） */
export const REGIONS: RegionDef[] = [
  { id: 'beiling', name: '北岭军管区', short: '北岭', icon: '🪖', col: 0, row: 0, tier: 5, biomeBias: 'military',
    desc: '净空协议的核心区。铁丝网、哨塔，和成排的装甲残骸。', homeBase: false,
    firstEnter: '路障上的字还没被雨水冲掉：「越线者按感染者处理」。' },
  { id: 'kuajiang', name: '跨江新区', short: '跨江', icon: '🌉', col: 1, row: 0, tier: 4, biomeBias: 'industrial',
    desc: '停工的高架与烂尾楼，江风把尸臭吹得到处都是。', homeBase: false },
  { id: 'binhai', name: '滨海新区', short: '滨海', icon: '🌊', col: 2, row: 0, tier: 4, biomeBias: 'water',
    desc: '被潮水泡过的港区，盐和铁锈的味道盖住了一切。', homeBase: false },
  { id: 'xishan', name: '西山山区', short: '西山', icon: '⛰️', col: 0, row: 1, tier: 3, biomeBias: 'forest',
    desc: '林场、隧道和采石场。活人比丧尸更值得提防。', homeBase: false },
  { id: 'ember', name: '余烬市区', short: '余烬', icon: '🏙️', col: 1, row: 1, tier: 1, biomeBias: 'city',
    desc: '你醒来的地方。超市、医院、警局都在这儿，安全屋也在。', homeBase: true },
  { id: 'dongjiao', name: '东郊农场带', short: '东郊', icon: '🌾', col: 2, row: 1, tier: 2, biomeBias: 'farm',
    desc: '成片的农田和谷仓——种子、粮食、柴油，还有守田的人。', homeBase: false,
    firstEnter: '田埂上插着一排木牌，每块都写着同一个日期：爆发那天。' },
  { id: 'laocheng', name: '老城遗址', short: '老城', icon: '🏚️', col: 0, row: 2, tier: 3, biomeBias: 'ruins',
    desc: '塌了一半的旧城区，钢筋和木料遍地，也是最容易迷路的地方。', homeBase: false },
  { id: 'jiangbei', name: '江北工业区', short: '江北', icon: '🏭', col: 1, row: 2, tier: 3, biomeBias: 'industrial',
    desc: '化工厂、电厂、物流园连成一片。毒气和燃料都在这儿。', homeBase: false,
    firstEnter: '厂区广播还在循环一段没人听的疏散通知。' },
  { id: 'nangang', name: '南港码头', short: '南港', icon: '⚓', col: 2, row: 2, tier: 5, biomeBias: 'water',
    desc: '集装箱堆到看不见头。有人说船还在，有人说船早就开走了。', homeBase: false,
    firstEnter: '防波堤上有人用油漆刷了三个字：「别上船」。' },
];

export const HOME_REGION = 'ember';
export const regionById = (id: string): RegionDef | null => REGIONS.find(r => r.id === id) ?? null;
export const regionName = (id: string): string => regionById(id)?.name ?? id;

/** 每个区域一张独立的 24×24 世界：seed 由基础种子派生（同一存档每次进来都一样） */
export const regionSeed = (baseSeed: string, regionId: string): string => baseSeed + '::' + regionId;

/** 元地图上两区是否相邻（含斜向）——只有相邻才能直接跨区 */
export function areAdjacent(a: RegionDef, b: RegionDef): boolean {
  const dx = Math.abs(a.col - b.col), dy = Math.abs(a.row - b.row);
  return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
}

export const META_ROWS = 3;
export const META_COLS = 3;

export interface TravelCtx {
  hasVehicle: boolean;
  fuel: number;          // 载具当前油量
  ap: number;            // 当前行动力
  apMax: number;
  from: string;          // 当前区域 id
  to: string;
}

export interface RegionTrip {
  ok: boolean;
  why?: string;          // 不满足时的具体理由（UI 直接显示）
  hint?: string;         // 补救建议
  hops: number;          // 元地图上的步数（相邻固定 1）
  ap: number;
  fuel: number;
  danger: number;        // 目标区危险层级
}

/** 跨区成本：一"跳"= 3 行动力 + 2 油（斜向 4 行动力 + 3 油，因为要绕路） */
export function regionTravelCost(from: RegionDef, to: RegionDef): { hops: number; ap: number; fuel: number } {
  const diag = Math.abs(from.col - to.col) === 1 && Math.abs(from.row - to.row) === 1;
  return { hops: 1, ap: diag ? 4 : 3, fuel: diag ? 3 : 2 };
}

/** 跨区能不能走：没车/没油/行动力不够都给出人话理由 */
export function planRegionTrip(ctx: TravelCtx): RegionTrip {
  const from = regionById(ctx.from), to = regionById(ctx.to);
  if (!from || !to) return { ok: false, why: '区域不存在', hops: 0, ap: 0, fuel: 0, danger: 0 };
  if (from.id === to.id) return { ok: false, why: '你已经在' + to.name + '了', hops: 0, ap: 0, fuel: 0, danger: to.tier };
  const c = regionTravelCost(from, to);
  const base = { hops: c.hops, ap: c.ap, fuel: c.fuel, danger: to.tier };
  if (!areAdjacent(from, to)) {
    return { ...base, ok: false, why: to.name + '不接壤', hint: '得先走到中间的区域，再往那边跨（元地图上只能一格一格挪）' };
  }
  if (!ctx.hasVehicle) {
    return { ...base, ok: false, why: '这段路要跨区，靠两条腿走不到', hint: '先找辆车：汽车修理厂/物流园里有能修的车（地图上带 🔧 的地方）' };
  }
  if (ctx.fuel < c.fuel) {
    return { ...base, ok: false, why: '油不够（需要 ' + c.fuel + '，车里有 ' + ctx.fuel + '）', hint: '去加油站或物流园抽油，或者用燃料桶补' };
  }
  if (ctx.ap < c.ap) {
    return { ...base, ok: false, why: '行动力不够（需要 ' + c.ap + '，现在 ' + ctx.ap + '）', hint: '回安全屋睡一觉再出发' };
  }
  return { ...base, ok: true };
}

/** 元地图渲染用的矩阵（UI 直接拿去画 3×3 格） */
export function metaGrid(): (RegionDef | null)[][] {
  const g: (RegionDef | null)[][] = [];
  for (let r = 0; r < META_ROWS; r++) {
    const row: (RegionDef | null)[] = [];
    for (let c = 0; c < META_COLS; c++) row.push(REGIONS.find(x => x.col === c && x.row === r) ?? null);
    g.push(row);
  }
  return g;
}

/** 相邻区域 id 列表（UI 只列能去的，避免玩家点一堆"不接壤"） */
export const neighborsOf = (id: string): RegionDef[] => {
  const a = regionById(id);
  return a ? REGIONS.filter(b => b.id !== id && areAdjacent(a, b)) : [];
};

/** 危险层级 → 文案（地图面板显示用） */
export const dangerLabel = (tier: number): string =>
  tier <= 1 ? '相对安全' : tier === 2 ? '有些麻烦' : tier === 3 ? '危险' : tier === 4 ? '很危险' : '九死一生';
