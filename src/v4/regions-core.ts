/* 多区域大世界（元地图）——纯逻辑，不碰 DOM、不碰 legacy。
 *
 * M17 重做：**元地图从写死的 3×3 变成按种子程序化生成的 12×12**（144 个区域）。
 * 为什么改（用户反馈 + 一份外部评审）：
 *   · 3×3 只有 9 格，"大世界"太小，而且 9 个地名是手写的 → 地理逻辑自相矛盾
 *     （"跨江"在北、"江北"在南，一条江横穿三行；老城被扔在角落；东郊紧贴市中心）
 *   · 危险度是手写的 → 出门往南是危险 5、往东是危险 2，梯度不成形
 *   · 没有"区域类型"的概念，地图上只能写 9 个名字，没法一眼看出哪片是工业区
 * 现在改成：
 *   · **区域类型**（与 M15 的 24×24 局部地图同一套词汇：城市核心/居民/城郊/工业/军事/农田/林地/水域/废墟）
 *     —— 地图格子按类型上色，一眼就能看出"这一带是工业区 / 那是农田"
 *   · **危险度严格按离主城的距离辐射递增**（中心安全区 → 外圈递进），再叠地形加成（军事/水域 +1）
 *   · **地名按类型 + 方位生成**（北岭/东郊/西林/南港…），保证不重名、且读起来像地名
 *   · **跨区可以一次开好几个格**（沿路网 BFS，水面上不能开），成本按跳数累加
 *
 * 兼容性：表是**按存档种子生成**的。老档里的区域 id（ember/dongjiao/…）在新表里不存在
 * → 统一落到主城（worldstate 的迁移逻辑会一并清掉按区域记的进度）。BETA 阶段允许。
 */
import seedrandom from 'seedrandom';

export type RegionType = 'core' | 'residential' | 'suburb' | 'industry' | 'military' | 'farm' | 'forest' | 'water' | 'ruins';

export interface RegionDef {
  id: string;
  name: string;          // 全名（"江北工业区"）
  short: string;         // 元地图格子里的短名（2~3 字）
  icon: string;
  col: number;           // 元地图列 0..REGION_COLS-1
  row: number;           // 元地图行 0..REGION_ROWS-1
  tier: number;          // 危险层级 1..5
  type: RegionType;      // M17：区域类型（决定上色、资源标签、生成主题）
  biomeBias: string;     // 传给 24×24 生成器的主题偏置
  desc: string;
  resources: string[];   // M17：这区能弄到什么（评审建议：地图上要有玩法暗示）
  homeBase: boolean;
  dist: number;          // 离主城的切比雪夫距离（UI 显示 + 危险度依据）
  firstEnter?: string;
}

/** 元地图尺寸：12×12 = 144 个区域（每个区域内部还是一张 24×24 的格子图） */
export const REGION_COLS = 12;
export const REGION_ROWS = 12;
/** 一次跨区最多开几格（12×12 的元地图里，一天的体力/一箱油最多跑 4 格 ≈ 100 公里；再远得中途落脚） */
export const MAX_HOPS = 4;

export const TYPE_INFO: Record<RegionType, { label: string; color: string; biomeBias: string; icon: string; resources: string[]; desc: string[] }> = {
  core: {
    label: '城市核心', color: '#3b4152', biomeBias: 'city', icon: '🏙️',
    resources: ['超市', '医院', '警局', '写字楼'],
    desc: ['高楼和商铺挤在一起的旧市中心，物资最全，也最挤。', '商业街的橱窗还亮着应急灯，玻璃后面全是人影。'],
  },
  residential: {
    label: '居民区', color: '#3a4250', biomeBias: 'city', icon: '🏢',
    resources: ['公寓', '学校', '诊所', '布料'],
    desc: ['成片的居民楼与学校，药品、布料、罐头都藏在楼道里。', '阳台上晾着没人收的衣服，风一吹像有人在招手。'],
  },
  suburb: {
    label: '城郊', color: '#33403a', biomeBias: 'transit', icon: '🏘️',
    resources: ['超市', '加油站', '修车铺'],
    desc: ['城市边缘的住宅与沿街小店，是出城前最后一块补给带。', '路灯下停着一排没开走的车，钥匙都还在。'],
  },
  industry: {
    label: '工业区', color: '#4a4038', biomeBias: 'industrial', icon: '🏭',
    resources: ['物流园', '建材', '燃料', '汽修'],
    desc: ['厂房、仓库、物流园连成一片，材料与燃料最多，毒气也最多。', '厂区广播还在循环一段没人听的疏散通知。'],
  },
  military: {
    label: '军事管制', color: '#40352c', biomeBias: 'military', icon: '🪖',
    resources: ['军械', '弹药', '防化装备'],
    desc: ['铁丝网、哨塔和成排的装甲残骸。越线者按感染者处理。', '路障上的字还没被雨水冲掉：「越线者按感染者处理」。'],
  },
  farm: {
    label: '农田', color: '#3d3a24', biomeBias: 'farm', icon: '🌾',
    resources: ['粮食', '种子', '柴油'],
    desc: ['成片的农田和谷仓——种子、粮食、柴油，还有守田的人。', '田埂上插着一排木牌，每块都写着同一个日期：爆发那天。'],
  },
  forest: {
    label: '林地山区', color: '#2b3a2c', biomeBias: 'forest', icon: '⛰️',
    resources: ['木材', '草药', '野味'],
    desc: ['林场、隧道和采石场。木头管够，活人比丧尸更值得提防。', '伐木道边的树被砍了一整排，切口还是新的。'],
  },
  water: {
    label: '水域港区', color: '#1d2c3e', biomeBias: 'water', icon: '🌊',
    resources: ['渔获', '净化片', '潜水点'],
    desc: ['码头、滩涂和被潮水泡过的仓库，水产丰富，水里也不干净。', '防波堤上有人用油漆刷了三个字：「别上船」。'],
  },
  ruins: {
    label: '废墟', color: '#3a3138', biomeBias: 'ruins', icon: '🏚️',
    resources: ['拆解材料', '拾荒者据点'],
    desc: ['塌了一半的旧街区，钢筋和木料遍地，也是最容易迷路的地方。', '楼板塌成斜坡，下面压着别人的半辆车。'],
  },
};

const SUFFIX: Record<RegionType, string[]> = {
  core: ['市中心', '老城区', '商业街', '广场'],
  residential: ['居民区', '新村', '街坊', '学区'],
  suburb: ['城郊', '开发区', '环城带', '近郊'],
  industry: ['工业区', '化工园', '物流城', '厂区'],
  military: ['军管区', '靶场', '检查站', '营地'],
  farm: ['农场带', '粮仓区', '农垦区', '屯'],
  forest: ['山区', '林场', '采石场', '岭'],
  water: ['港区', '码头', '滩涂', '水库'],
  ruins: ['遗址', '废墟带', '旧街区', '棚户区'],
};
/** 方位词：按该区域相对主城的方位挑（地图像真地名，而不是"区域 7"） */
const DIRS: [string, string][] = [
  ['北', 'n'], ['南', 's'], ['东', 'e'], ['西', 'w'], ['中', 'c'],
];
const dirWord = (dx: number, dy: number): string => {
  const ns = dy <= -3 ? '北' : dy >= 3 ? '南' : '';
  const ew = dx <= -3 ? '西' : dx >= 3 ? '东' : '';
  if (ns + ew) return ns + ew;
  if (dy < 0) return '北';
  if (dy > 0) return '南';
  if (dx < 0) return '西';
  if (dx > 0) return '东';
  return '中';
};

/** 每种区域"第一次踏进去"的一句话（主城除外） */
const FIRST_ENTER: Record<RegionType, string> = {
  core: '这里的十字路口还留着事故当天的车流，一辆都没动。',
  residential: '楼道口的公告栏贴着最后一张通知，字迹被雨泡花了。',
  suburb: '沿街卷帘门全拉着，只有一家小卖部的灯还亮着。',
  industry: '厂区广播还在循环一段没人听的疏散通知。',
  military: '路障上的字还没被雨水冲掉：「越线者按感染者处理」。',
  farm: '田埂上插着一排木牌，每块都写着同一个日期：爆发那天。',
  forest: '伐木道边的树被砍了一整排，切口还是新的。',
  water: '防波堤上有人用油漆刷了三个字：「别上船」。',
  ruins: '楼板塌成斜坡，下面压着别人的半辆车。',
};

/** 生成整张元地图。同一 seed 稳定；纯函数（除模块级 active 表外无副作用） */
export function buildRegions(seed: string): RegionDef[] {
  const rng = seedrandom(seed + ':regions');
  const homeCol = Math.floor(REGION_COLS / 2) - 1 + Math.floor(rng() * 2);
  const homeRow = Math.floor(REGION_ROWS / 2) - 1 + Math.floor(rng() * 2);
  /* 两个"地理大势"：一条海岸（东/南边）和一片山地（西北角）——这样水与林不会随机乱撒，
     而是像真实地图那样占掉一整侧（评审说的"地理合理性"）。 */
  const coastSide = rng() < 0.5 ? 'east' : 'south';
  const mountSide = coastSide === 'east' ? 'northwest' : 'northeast';
  const used: Record<string, number> = {};
  /* 危险度要铺满 1..5 整档，所以按"到主城的最远距离"归一化——
     12×12 里主城在中心时最远只有 6 格，用固定除数会让全图最高只有危险 4（评审 #2 说的"角落也很安全"）。 */
  const maxDist = Math.max(homeCol, REGION_COLS - 1 - homeCol, homeRow, REGION_ROWS - 1 - homeRow);

  const out: RegionDef[] = [];
  for (let row = 0; row < REGION_ROWS; row++) {
    for (let col = 0; col < REGION_COLS; col++) {
      const dx = col - homeCol, dy = row - homeRow;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const isHome = col === homeCol && row === homeRow;
      const urban = rng();        // 粗噪声：城市/居民/城郊的分布
      const ind = rng();
      const rural = rng();

      let type: RegionType;
      if (isHome) type = 'core';
      else if (coastSide === 'east' ? col === REGION_COLS - 1 : row === REGION_ROWS - 1) type = 'water';
      else if (mountSide === 'northwest' ? (col <= 1 && row <= 2) : (col >= REGION_COLS - 2 && row <= 2)) type = rng() < 0.25 ? 'military' : 'forest';
      else if (dist === 1 && urban < 0.6) type = 'residential';
      else if (dist <= 2) type = urban < 0.45 ? 'residential' : urban < 0.75 ? 'suburb' : 'core';
      else if (dist <= 4) type = ind > 0.62 ? 'industry' : urban > 0.5 ? 'suburb' : 'ruins';
      else if (dist <= 6) type = ind > 0.55 ? 'industry' : rural > 0.5 ? 'farm' : 'ruins';
      else type = rural > 0.45 ? 'farm' : rng() < 0.3 ? 'forest' : rng() < 0.2 ? 'military' : 'ruins';
      /* 军事与水域在远处更常见（前哨/港口都在外围） */
      if (!isHome && dist >= 5 && rng() < 0.12) type = rng() < 0.5 ? 'military' : 'forest';
      if (!isHome && dist >= 7 && rural > 0.7) type = 'farm';

      const info = TYPE_INFO[type];
      const dir = dirWord(dx, dy);
      /* 危险度：**严格按离主城的距离辐射递增**（评审 #2），再叠地形加成 */
      const terrain = type === 'military' ? 1 : type === 'water' || type === 'industry' ? (dist >= 4 ? 1 : 0) : 0;
      const tier = isHome ? 1 : Math.max(1, Math.min(5, 1 + Math.round((dist / maxDist) * 4) + terrain));
      const key = dir + SUFFIX[type][Math.floor(rng() * SUFFIX[type].length)];
      used[key] = (used[key] ?? 0) + 1;
      const name = isHome ? '余烬市区' : key + (used[key] > 1 ? ' ' + used[key] + ' 号' : '');
      const desc = info.desc[Math.floor(rng() * info.desc.length)];

      out.push({
        id: 'r' + col + '-' + row,
        name, short: isHome ? '余烬' : key.slice(0, 3), icon: isHome ? '🏠' : info.icon,
        col, row, tier, type, biomeBias: info.biomeBias,
        desc: isHome ? '你醒来的地方。超市、医院、警局都在这儿，安全屋也在。' : desc,
        resources: info.resources, homeBase: isHome, dist,
        /* 每个非主城区域第一次踏进去都有一句固定叙事（跨区是有仪式感的事，不该只有几个类型才有） */
        firstEnter: isHome ? undefined : FIRST_ENTER[type],
      });
    }
  }
  return out;
}

/** 当前生效的元地图（按存档种子生成，worldstate / worldOf 会调用 setActiveRegions 对齐） */
export let REGIONS: RegionDef[] = buildRegions('ember-01');
export let HOME_REGION = REGIONS.find(r => r.homeBase)?.id ?? 'r5-5';
let activeSeed = 'ember-01';

/** 切换当前种子对应的元地图（就地替换数组内容，外部持有的引用同样生效） */
export function setActiveRegions(seed: string): void {
  if (seed === activeSeed) return;
  activeSeed = seed;
  const table = buildRegions(seed);
  REGIONS.length = 0;
  for (const r of table) REGIONS.push(r);
  HOME_REGION = table.find(r => r.homeBase)?.id ?? table[0].id;
}

export const META_COLS = REGION_COLS;
export const META_ROWS = REGION_ROWS;

export const regionById = (id: string): RegionDef | null => REGIONS.find(r => r.id === id) ?? null;
export const regionName = (id: string): string => regionById(id)?.name ?? id;
export const homeRegion = (): RegionDef => regionById(HOME_REGION) ?? REGIONS[0];

/** 每个区域一张独立的 24×24 世界：seed 由基础种子派生（同一存档每次进来都一样） */
export const regionSeed = (baseSeed: string, regionId: string): string => baseSeed + '::' + regionId;

/** 元地图上两区是否相邻（含斜向） */
export function areAdjacent(a: RegionDef, b: RegionDef): boolean {
  const dx = Math.abs(a.col - b.col), dy = Math.abs(a.row - b.row);
  return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
}

/* 一格的成本：正交 2 行动力 + 2 油；斜向 3 + 3（要绕路）。
   为什么是 2 而不是 3：行动力上限只有 9（安全屋睡满）——按 3/4 算，一次跨区最多只能开 2 格，
   12×12 的世界就走不动了（用户要的是"大世界"，不是"家门口"）。2 行动力/格 ≈ 4 格/天，够走到临省。 */
export const stepCost = (diag: boolean) => (diag ? { ap: 3, fuel: 3 } : { ap: 2, fuel: 2 });

export interface TravelCtx {
  hasVehicle: boolean;
  fuel: number;
  ap: number;
  apMax: number;
  from: string;
  to: string;
}

export interface RegionTrip {
  ok: boolean;
  why?: string;
  hint?: string;
  hops: number;          // 沿路走几格（0 = 原地）
  ap: number;
  fuel: number;
  danger: number;
  path: string[];        // 途经区域 id（含终点）
}

/* 区域图上的行车路线：BFS 最短路，**水面只是绕不过去，但可以开进去**——
   港区/码头沿海而建，沿海公路通到堤岸上（不然水域那一片资源和第 5 章「到访水域」永远做不完）；
   但水面不能当"过路通道"：路的中间绝不会出现水域。 */
export function regionPath(from: string, to: string): RegionDef[] | null {
  const a = regionById(from), b = regionById(to);
  if (!a || !b || a.id === b.id) return null;
  const key = (r: RegionDef) => r.id;
  const prev: Record<string, string> = {};
  const seen: Record<string, 1> = { [key(a)]: 1 };
  const q: RegionDef[] = [a];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of REGIONS) {
      if (seen[key(nb)] || !areAdjacent(cur, nb)) continue;
      if (nb.type === 'water' && nb.id !== b.id) continue;   // 过路不行，终点可以（堤岸/码头）
      seen[key(nb)] = 1; prev[key(nb)] = key(cur);
      if (nb.id === b.id) {
        const out: RegionDef[] = [nb];
        let k = key(nb);
        while (prev[k]) { const p = regionById(prev[k])!; out.unshift(p); k = prev[k]; }
        return out;
      }
      q.push(nb);
    }
  }
  return null;
}

/** 元地图上的行程报价：沿 BFS 路线累加每格成本 */
export function regionTravelCost(from: RegionDef, to: RegionDef): { hops: number; ap: number; fuel: number } {
  const path = regionPath(from.id, to.id);
  if (!path || path.length < 2) {
    /* 直线估算（拿不到路线时给个近似值，UI 仍会以 planRegionTrip 的结论为准） */
    const steps = Math.max(Math.abs(from.col - to.col), Math.abs(from.row - to.row));
    const diag = Math.min(Math.abs(from.col - to.col), Math.abs(from.row - to.row));
    const c = stepCost(diag > 0);
    return { hops: steps, ap: c.ap * steps, fuel: c.fuel * steps };
  }
  let ap = 0, fuel = 0;
  for (let i = 1; i < path.length; i++) {
    const diag = path[i].col !== path[i - 1].col && path[i].row !== path[i - 1].row;
    const c = stepCost(diag);
    ap += c.ap; fuel += c.fuel;
  }
  return { hops: path.length - 1, ap, fuel };
}

/** 跨区能不能走：没车 / 没路 / 太远 / 没油 / 没行动力，各给一句人话理由 */
export function planRegionTrip(ctx: TravelCtx): RegionTrip {
  const from = regionById(ctx.from), to = regionById(ctx.to);
  if (!from || !to) return { ok: false, why: '区域不存在', hops: 0, ap: 0, fuel: 0, danger: 0, path: [] };
  if (from.id === to.id) return { ok: false, why: '你已经在' + to.name + '了', hops: 0, ap: 0, fuel: 0, danger: to.tier, path: [] };
  const c = regionTravelCost(from, to);
  const base = { hops: c.hops, ap: c.ap, fuel: c.fuel, danger: to.tier, path: (regionPath(from.id, to.id) ?? []).map(r => r.id) };
  if (!ctx.hasVehicle) {
    return { ...base, ok: false, why: '这段路有 ' + Math.round(c.hops * 20) + ' 公里，靠两条腿走不到', hint: '先找辆车：汽车修理厂/物流园里有能修的车（地图上带 🔧 的地方）' };
  }
  if (!base.path.length) {
    return { ...base, ok: false, why: to.name + '开车过不去', hint: '中间隔着水域（港区/水库），得绕别的路——在地图上点中间的区域看看' };
  }
  if (c.hops > MAX_HOPS) {
    return { ...base, ok: false, why: '太远了（要开 ' + c.hops + ' 格，一箱油跑不到）', hint: '一次最多开 ' + MAX_HOPS + ' 格：先开到中途的区域落脚，再往那边走' };
  }
  if (ctx.fuel < c.fuel) {
    return { ...base, ok: false, why: '油不够（需要 ' + c.fuel + '，车里有 ' + ctx.fuel + '）', hint: '去加油站或物流园抽油，或者用燃料桶补' };
  }
  if (ctx.ap < c.ap) {
    return { ...base, ok: false, why: '行动力不够（需要 ' + c.ap + '，现在 ' + ctx.ap + '）', hint: '回安全屋睡一觉再出发' };
  }
  return { ...base, ok: true };
}

/** 元地图渲染用的矩阵（UI 直接拿去画格子）。按坐标查表而不是每格 find 一遍（144×144 太浪费） */
export function metaGrid(): (RegionDef | null)[][] {
  const at: Record<string, RegionDef> = {};
  for (const r of REGIONS) at[r.col + ',' + r.row] = r;
  const g: (RegionDef | null)[][] = [];
  for (let r = 0; r < REGION_ROWS; r++) {
    const row: (RegionDef | null)[] = [];
    for (let c = 0; c < REGION_COLS; c++) row.push(at[c + ',' + r] ?? null);
    g.push(row);
  }
  return g;
}

/** 相邻区域（含斜向） */
export const neighborsOf = (id: string): RegionDef[] => {
  const a = regionById(id);
  return a ? REGIONS.filter(b => b.id !== id && areAdjacent(a, b)) : [];
};

/** 危险层级 → 文案（地图面板显示用） */
export const dangerLabel = (tier: number): string =>
  tier <= 1 ? '安全区' : tier === 2 ? '有些麻烦' : tier === 3 ? '危险' : tier === 4 ? '很危险' : '九死一生';

/** 危险层级 → 颜色：格子上那条底边用它上色，一眼看出"危险度是往外涨的"（绿→黄→红） */
export const DANGER_COLORS = ['#78c98a', '#c6d06a', '#e0b45c', '#e08a5c', '#ef6f6f'];
export const dangerColor = (tier: number): string => DANGER_COLORS[Math.max(1, Math.min(5, Math.round(tier))) - 1];

/** 类型 → 颜色（地图格子用；与 24×24 局部地图同一套地表色） */
export const typeColor = (t: RegionType): string => TYPE_INFO[t].color;
export const typeLabel = (t: RegionType): string => TYPE_INFO[t].label;

/** 图例用的类型顺序（城 → 乡 → 野 → 水，读起来像一张地图的图例） */
export const REGION_TYPES: RegionType[] = ['core', 'residential', 'suburb', 'industry', 'military', 'farm', 'forest', 'ruins', 'water'];
