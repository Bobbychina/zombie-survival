/* M15 程序化大世界：从"噪声撒群系"改成"按土地利用分区"。
 *
 * 为什么要改（用户要求：工业区扎堆、居民房扎堆，更像真实城市）：
 *   老版是四个独立噪声各自过阈值，结果工业格与住宅格随机交错——地图看着像补丁，
 *   不像城市。真实城市的形态来自几条简单规律：**离市中心越远密度越低**、
 *   **同用途的地块连片**、**工业沿交通线（公路/水系）扎堆**、**商业只长在核心与街角**。
 *   这一版就把这几条写进生成器：
 *     1) 先算"到市中心的距离衰减"得到城市强度 urban（内城高、外城低）
 *     2) 再叠两张低频噪声：工业强度 ind、商业强度 comm（低频 = 成片，不会一格工业一格农田）
 *     3) 按优先级分 zone（cbd / residential / suburb / industry / military / farmland / forest / ruins）
 *     4) zone → biome（地表，用于渲染与移动成本），zone 也决定 POI 池、危险度与地名
 *     5) 修路：主干道十字 + 市域路网 + 家→实验室公路 + 过河桥（保证车能开过去）
 *     6) 最后跑一遍"保底修复"：每种地表至少 N 格（免得某个种子刷出一张没法玩的地图）
 *
 *  世界仍然由存档 seed 决定（同一存档每次一致），区域主题（regions-core.biomeBias）
 *  会真正影响生成——"东郊农场带"真的是农田，"江北工业区"真的连片厂房。
 */
import seedrandom from 'seedrandom';
import { createNoise2D } from 'simplex-noise';
import { POIS } from './pois';
import { SUNKEN_MIN_DIST, SUNKEN_PER_WORLD } from './water-core';
import type { Block, Biome, WorldState, Zone } from '../types';

export const WORLD_W = 24;
export const WORLD_H = 24;

/* ── 地名 ──
   按 zone 起名，让玩家在地图上"读得出这是一个什么区"：
   工业园有厂区编号、农田有屯/渠、林地有林场、市区有街道号。 */
const NAME_ROAD = ['长春', '建设', '红旗', '解放', '和平', '光明', '兴安', '新华', '民主', '富强', '东风', '胜利', '南山', '北岭', '西林', '东湖', '望江', '青石', '铁西', '柳河'];
const NAME_SUFFIX: Record<Zone, string[]> = {
  cbd: ['大道', '广场', '中心'],
  residential: ['路', '街', '巷', '里'],
  suburb: ['街', '屯', '新村', '街坊'],
  industry: ['工业园', '厂区', '产业园', '物流园'],
  military: ['管制区', '营区', '检查站'],
  farmland: ['农田', '农场', '渠', '屯'],
  forest: ['林场', '山道', '岭'],
  ruins: ['废墟', '旧城', '遗址'],
  water: ['河段', '水面', '湖'],
  open: ['空地', '野地'],
};
const ZONE_LABEL: Record<Zone, string> = {
  cbd: '商业中心', residential: '居民区', suburb: '城郊住宅', industry: '工业园',
  military: '军事管制', farmland: '农田', forest: '林地', ruins: '废墟', water: '水域', open: '荒地',
};

export const bkey = (x: number, y: number) => x + ',' + y;
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const zoneLabel = (z: Zone | undefined): string => (z ? ZONE_LABEL[z] : '荒地');

/** 该 zone 偏好的 POI（只是权重，硬过滤仍然是 POIS[id].biomes 必须包含该地表） */
const ZONE_POI: Record<Zone, string[]> = {
  cbd: ['office', 'mall', 'megamart', 'appliance', 'apartment', 'radio'],
  residential: ['apartment', 'school', 'market', 'pharmacy', 'clinic', 'church', 'police'],
  suburb: ['market', 'school', 'clinic', 'apartment', 'camp', 'gas', 'church'],
  industry: ['depot', 'buildmart', 'hardware', 'warehouse', 'sawmill', 'garage', 'prison', 'waterworks', 'outpost', 'construction'],
  military: ['military', 'bunker', 'prison', 'warehouse', 'outpost'],
  farmland: ['farm', 'clinic', 'camp', 'church', 'megamart'],
  forest: ['lumber', 'camp', 'church', 'outpost'],
  ruins: ['outpost', 'bunker', 'church', 'prison', 'construction', 'warehouse'],
  water: [], open: [],
};
/** 稀有度上限：真实城市里医院/军营不会有八个，而超市可以有五个 */
const POI_CAP: Record<string, number> = { hospital: 2, military: 1, bunker: 2, radio: 2, prison: 1, waterworks: 2, mall: 2, lab: 1, sunken: 2, megamart: 2 };
const POI_CAP_DEFAULT = 4;
const MODERN_POIS = new Set(['furniture', 'hardware', 'megamart', 'office', 'appliance', 'depot', 'buildmart', 'lumber', 'sawmill']);

/** 区域主题 → 生成偏置（regions-core.biomeBias 传进来；没有就用中性值） */
export interface GenOpts {
  bias?: string;
  label?: string;
  /** 平滑轮数（默认 3）。0 = 不做平滑，只用于测试里对比"扎堆"效果。 */
  smooth?: number;
}
interface Bias { urban: number; ind: number; comm: number; rural: number; water: number; mil: number }
const NEUTRAL: Bias = { urban: 0, ind: 0, comm: 0, rural: 0, water: 0, mil: 0 };
const BIAS: Record<string, Bias> = {
  city:       { urban: 0.30, ind: -0.10, comm: 0.16, rural: 0, water: 0, mil: 0 },
  industrial: { urban: 0.12, ind: 0.26, comm: -0.05, rural: -0.06, water: 0.02, mil: 0.05 },
  farm:       { urban: -0.20, ind: -0.12, comm: -0.05, rural: 0.30, water: 0.02, mil: 0 },
  forest:     { urban: -0.24, ind: -0.12, comm: -0.05, rural: -0.26, water: 0.02, mil: 0 },
  ruins:      { urban: -0.02, ind: 0.10, comm: -0.08, rural: 0.04, water: -0.02, mil: 0.02 },
  military:   { urban: -0.14, ind: 0.12, comm: -0.08, rural: 0.04, water: -0.04, mil: 0.24 },
  water:      { urban: 0, ind: 0, comm: 0, rural: -0.02, water: 0.16, mil: 0 },
  transit:    { urban: 0.10, ind: 0.06, comm: 0.02, rural: -0.06, water: 0, mil: 0 },
};

export const ZONE_REQUIRED: { zone: Zone; min: number }[] = [
  { zone: 'cbd', min: 2 }, { zone: 'residential', min: 5 }, { zone: 'suburb', min: 4 },
  { zone: 'industry', min: 3 }, { zone: 'farmland', min: 3 }, { zone: 'forest', min: 3 },
];

/** 每一格先算出的原始地貌数据（保底修复阶段要按分数挑格） */
interface Raw {
  b: Block;
  elev: number; urban: number; ind: number; comm: number; rural: number;
  dc: number;                       // 到市中心的距离
}

export function generateWorld(seed: string, opts: GenOpts = {}): WorldState {
  const rng = seedrandom(seed);
  const bias = BIAS[opts.bias ?? ''] ?? NEUTRAL;
  const nElev = createNoise2D(seedrandom(seed + ':elev'));
  const nUrbanCore = createNoise2D(seedrandom(seed + ':urban'));
  const nInd = createNoise2D(seedrandom(seed + ':ind'));
  const nComm = createNoise2D(seedrandom(seed + ':comm'));
  const nRural = createNoise2D(seedrandom(seed + ':rural'));

  const home = { x: Math.floor(WORLD_W / 2), y: Math.floor(WORLD_H / 2) };
  /* 城市中心：真实城市不会正好长在玩家门口，偏移 2~5 格，让"往外走"真的会出城 */
  const ca = rng() * Math.PI * 2, cr = 2 + Math.floor(rng() * 4);
  const center = {
    x: Math.max(2, Math.min(WORLD_W - 3, Math.round(home.x + Math.cos(ca) * cr))),
    y: Math.max(2, Math.min(WORLD_H - 3, Math.round(home.y + Math.sin(ca) * cr))),
  };
  // 实验室仍然放在远端：保证"必须横穿大世界"
  const la = rng() * Math.PI * 2;
  const lr = 10 + Math.floor(rng() * 5);
  let lab = {
    x: Math.max(1, Math.min(WORLD_W - 2, Math.round(home.x + Math.cos(la) * lr))),
    y: Math.max(1, Math.min(WORLD_H - 2, Math.round(home.y + Math.sin(la) * lr))),
  };
  if (dist(home, lab) < 10) lab = { x: Math.min(WORLD_W - 2, home.x + 11), y: home.y };
  /* 军事管制区：一整片营地（不是散点）。真实世界里军营/管制区就是一个封闭片区，
     放在城市外围 6~9 格处，方向随机。 */
  const ma = rng() * Math.PI * 2, mr = 6 + Math.floor(rng() * 4);
  const military = {
    x: Math.max(1, Math.min(WORLD_W - 2, Math.round(home.x + Math.cos(ma) * mr))),
    y: Math.max(1, Math.min(WORLD_H - 2, Math.round(home.y + Math.sin(ma) * mr))),
  };

  /* ── 1) 原始地貌：城市强度 = 低频噪声 − 离市中心的距离衰减 ── */
  const raws: Raw[] = [];
  const at = (x: number, y: number): Raw | null => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) ? null : raws[y * WORLD_W + x];
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const elev = nElev(x * 0.13, y * 0.13);
      const dc = Math.max(Math.abs(x - center.x), Math.abs(y - center.y));
      /* 距离衰减：6 格内不掉（内城连成一片），之后缓慢掉、11 格后掉得更快（出城） */
      const decay = Math.max(0, dc - 6) * 0.05 + Math.max(0, dc - 11) * 0.06;
      const urban = nUrbanCore(x * 0.085 + 50, y * 0.085 + 50) * 0.7 + bias.urban - decay;
      const b: Block = {
        x, y, biome: 'ruins', zone: 'open', road: false, name: '', poi: null,
        danger: 1, searched: 0, depleted: false, visited: false, revealed: false,
      };
      raws.push({
        b, elev, urban,
        ind: nInd(x * 0.04 - 30, y * 0.04 - 30) + bias.ind,
        comm: nComm(x * 0.1 + 120, y * 0.1 + 120) + bias.comm,
        rural: nRural(x * 0.06 + 200, y * 0.06 + 200) + bias.rural,
        dc,
      });
    }
  }

  /* ── 2) 分 zone：优先级照着真实城市的排法（水 > 山 > 工业 > 商业 > 住宅 > 农 > 林 > 废墟） ── */
  const zoneOf = (r: Raw): Zone => {
    if (r.elev < -0.52 + bias.water * 0.9) return 'water';                    // 河谷/湖/海岸：低洼处连片成水
    if (r.elev > 0.62) return 'forest';                                       // 高地 = 丘陵林地
    const dMil = Math.max(Math.abs(r.b.x - military.x), Math.abs(r.b.y - military.y));
    if (dMil <= 2 && r.urban < 0.30 && r.elev > -0.4) return 'military';       // 管制区：一整片营地
    /* 工业园：贴着城市边缘的一圈。现实里工厂既不会开在市中心（地价/扰民），
       也不会开在几十公里外的荒野（没工人没路）。 */
    if (r.ind > 0.34 && r.urban > -0.20 && r.urban < 0.16) return 'industry';
    /* 市中心：地理核心（离中心 ≤2 格且商业不太差）+ 一个次级商业节点（comm 特别高）。
       老写法用 urban 阈值 → 会在地图上撒出五六个"小市中心"，不像城市。 */
    if (r.dc <= 2 && r.comm > -0.42) return 'cbd';
    if (r.dc <= 5 && r.comm > 0.5) return 'cbd';
    if (r.urban > 0.50) return 'residential';
    if (r.urban > 0.26) return 'residential';
    if (r.urban > 0.06) return 'suburb';
    /* 市区里不会突然长出一片林场（老写法按高程判定，市中心会冒出孤立林地） */
    if (r.dc > 4 && r.rural < -0.32) return 'forest';
    if (r.rural > 0.24) return 'farmland';
    if (r.elev > 0.62) return 'forest';
    return 'ruins';
  };
  const BIOME_OF: Record<Zone, Biome> = {
    cbd: 'city', residential: 'city', suburb: 'suburb', industry: 'industrial', military: 'military',
    farmland: 'farm', forest: 'forest', ruins: 'ruins', water: 'water', open: 'ruins',
  };
  for (const r of raws) {
    r.b.zone = zoneOf(r);
    r.b.biome = BIOME_OF[r.b.zone];
  }

  /* ── 2b) 平滑：元胞自动机去噪（这一步就是"扎堆"的来源） ──
     噪声分区的通病是"一格工业、一格农田"插花。真实城市的用地是连片的，
     所以按 8 邻居多数票把孤立格子并进周围：跑两轮，孤立格基本消失。 */
  const smoothPasses = opts.smooth ?? 3;
  for (let pass = 0; pass < smoothPasses; pass++) {
    const want: Zone[] = raws.map(r => r.b.zone!);
    raws.forEach((r, i) => {
      const b = r.b;
      if (b.zone === 'water') return;                                   // 水域不动（连通性要保住）
      const tally: Record<string, number> = {};
      for (const [dx, dy] of NEIGHBORS) {
        const nb = at(b.x + dx, b.y + dy);
        if (!nb || nb.b.zone === 'water') continue;
        tally[nb.b.zone!] = (tally[nb.b.zone!] ?? 0) + 1;
      }
      let best: Zone | null = null, bestN = 0;
      for (const z in tally) if (tally[z] > bestN) { best = z as Zone; bestN = tally[z]; }
      if (best && bestN >= 5 && best !== b.zone) want[i] = best;         // ≥5/8 邻居是同一用途 → 并过去
    });
    raws.forEach((r, i) => {
      if (r.b.zone === 'water') return;
      const z = want[i];
      if (z !== r.b.zone) { r.b.zone = z; r.b.biome = BIOME_OF[z]; }
    });
  }

  /* ── 2c) 合并碎片：小块（<6 格）的用途不该单独存在 ──
     真实城市里不会出现"孤立的一座工厂"或"两个街区的市中心"：小地块会被邻接的用途吸收。
     这一步把 <6 格的连通块整体并进"边界上占多数的那个用途"（水域/军营/家/实验室除外）。
     读图时这一步的效果最明显：工业从"一地小疙瘩"变成"两三条带"。 */
  if (smoothPasses > 0) {
    const mergeMin = 6;
    const key = (x: number, y: number) => y * WORLD_W + x;
    const seen = new Set<number>();
    for (const r0 of raws) {
      const i0 = key(r0.b.x, r0.b.y);
      if (seen.has(i0)) continue;
      const z0 = r0.b.zone!;
      /* 洪水填充出这一块连通区（4 邻接，避免斜角造成的"假连通"） */
      const patch: Raw[] = [];
      const stack = [r0];
      seen.add(i0);
      while (stack.length) {
        const cur = stack.pop()!;
        patch.push(cur);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nb = at(cur.b.x + dx, cur.b.y + dy);
          if (!nb) continue;
          const k = key(nb.b.x, nb.b.y);
          if (seen.has(k) || nb.b.zone !== z0) continue;
          seen.add(k);
          stack.push(nb);
        }
      }
      const protectedZone = z0 === 'water' || z0 === 'military';
      if (protectedZone || patch.length >= mergeMin) continue;
      const homeKey = bkey(home.x, home.y), labKey = bkey(lab.x, lab.y);
      if (patch.some(p => bkey(p.b.x, p.b.y) === homeKey || bkey(p.b.x, p.b.y) === labKey)) continue;
      const border: Record<string, number> = {};
      for (const p of patch) {
        for (const [dx, dy] of NEIGHBORS) {
          const nb = at(p.b.x + dx, p.b.y + dy);
          if (!nb || nb.b.zone === z0 || nb.b.zone === 'water') continue;
          border[nb.b.zone!] = (border[nb.b.zone!] ?? 0) + 1;
        }
      }
      let best: Zone | null = null, bestN = 0;
      for (const z in border) if (border[z] > bestN) { best = z as Zone; bestN = border[z]; }
      if (!best) continue;
      for (const p of patch) { p.b.zone = best; p.b.biome = BIOME_OF[best]; }
    }
  }

  /* ── 2d) 保证有"深水"：潜水点（沉没基地）必须有地方放 ──
     分区生成偶尔会出现"只有零星浅水、没有成片水域"，那 M7 的潜水内容就会凭空消失。
     这里在最合适的位置挖一个 3×3 的湖（离家 ≥6 格、海拔最低、不在军事区/实验室旁），
     放在修路之前——过河桥会在下一步自动补上。 */
  {
    const usable = (r: Raw) => r.b.zone !== 'military' && r.b.zone !== 'water'
      && Math.max(Math.abs(r.b.x - home.x), Math.abs(r.b.y - home.y)) >= SUNKEN_MIN_DIST
      && r.b.x > 1 && r.b.y > 1 && r.b.x < WORLD_W - 2 && r.b.y < WORLD_H - 2
      && Math.max(Math.abs(r.b.x - lab.x), Math.abs(r.b.y - lab.y)) > 1;
    /* 注意：判定必须和沉没基地的放置条件完全一致（离家 ≥ SUNKEN_MIN_DIST）。
       只看"有没有深水"是不够的——家门口一个深水坑会骗过这里，结果第 7 步一个潜水点都放不下。 */
    const hasDeep = raws.some(r => {
      if (r.b.zone !== 'water') return false;
      if (Math.max(Math.abs(r.b.x - home.x), Math.abs(r.b.y - home.y)) < SUNKEN_MIN_DIST) return false;
      for (const [dx, dy] of NEIGHBORS) { const nb = at(r.b.x + dx, r.b.y + dy); if (nb && nb.b.zone !== 'water') return false; }
      return true;
    });
    if (!hasDeep) {
      const spot = raws.filter(usable).sort((a, b) => a.elev - b.elev)[0];
      if (spot) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const r = at(spot.b.x + dx, spot.b.y + dy);
          if (r) { r.b.zone = 'water'; r.b.biome = 'water'; r.b.road = false; }
        }
      }
    }
  }

  /* ── 3) 修路 ──
     两级路网（真实城市就是这样）：**主干道/环线** = 整格 highway（开车快）；
     **市内街道** = 只打 road 标记（格子还是居民区/商业区，但挨着路 → 车能开、店沿街）。
     这样地图上不会出现"27% 的地都是高速"这种假地形。 */
  const setRoad = (x: number, y: number, arterial: boolean) => {
    const r = at(x, y);
    if (!r || r.b.zone === 'water') return;
    r.b.road = true;
    if (arterial) r.b.biome = 'highway';
    if (r.b.zone === 'open') r.b.zone = 'suburb';
  };
  const mainX = Math.max(1, Math.min(WORLD_W - 2, center.x + (rng() < 0.5 ? 0 : 1)));
  const mainY = Math.max(1, Math.min(WORLD_H - 2, center.y + (rng() < 0.5 ? 0 : 1)));
  for (let y = 0; y < WORLD_H; y++) setRoad(mainX, y, true);              // 主干道（纵）
  for (let x = 0; x < WORLD_W; x++) setRoad(x, mainY, true);              // 主干道（横）
  for (const r of raws) {                                                 // 市内街道：每 3 格一条，只做标记
    if (r.b.zone === 'water' || r.b.zone === 'forest' || r.b.zone === 'farmland') continue;
    if (r.dc > 10) continue;
    if ((r.b.x - mainX) % 3 === 0 || (r.b.y - mainY) % 3 === 0) setRoad(r.b.x, r.b.y, false);
  }
  /* 家→实验室：一条真正的公路（保证"横穿大世界"有明确路线） */
  const steps = Math.max(Math.abs(lab.x - home.x), Math.abs(lab.y - home.y));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]] as [number, number][]) {
      const x = Math.round(home.x + (lab.x - home.x) * t) + ox, y = Math.round(home.y + (lab.y - home.y) * t) + oy;
      const r = at(x, y) ?? at(x - ox * 2, y - oy * 2);
      if (r && r.b.zone !== 'water' && rng() < 0.72) setRoad(r.b.x, r.b.y, true);
    }
  }
  /* 军营也通公路（现实里军营一定在路边） */
  const mSteps = Math.max(Math.abs(military.x - home.x), Math.abs(military.y - home.y));
  for (let i = 0; i <= mSteps; i++) {
    const t = i / mSteps;
    const r = at(Math.round(home.x + (military.x - home.x) * t), Math.round(home.y + (military.y - home.y) * t));
    if (r && r.b.zone !== 'water' && rng() < 0.6) setRoad(r.b.x, r.b.y, true);
  }
  /* 过河桥：车不能下水，所以被水切断的地方必须补桥，否则"开车去实验室"会变成死路 */
  const crossWater = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const n = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = Math.round(from.x + (to.x - from.x) * t), y = Math.round(from.y + (to.y - from.y) * t);
      const r = at(x, y);
      if (r && r.b.zone === 'water') { r.b.biome = 'highway'; r.b.zone = 'open'; r.b.road = true; }
    }
  };
  crossWater(home, lab);
  crossWater(home, center);
  crossWater(home, military);

  /* ── 4) 危险度：人多的地方丧尸多（核心区最危险），工业/军事次之 ── */
  for (const r of raws) {
    const b = r.b;
    if (b.zone === 'water') { b.danger = 3; continue; }
    let d = 1 + Math.floor(r.dc / 3);
    if (b.zone === 'cbd') d += 2;
    else if (b.zone === 'residential') d += 1;
    else if (b.zone === 'industry' || b.zone === 'military') d += 1;
    else if (b.zone === 'ruins') d += 1;
    b.danger = Math.max(1, Math.min(5, d));
  }

  /* ── 5) 保底修复：每种地表至少 N 格 ──
     纯噪声 + 距离衰减偶尔会刷出"整张图只有工业"这种没法玩的图（试玩反馈过：
     出门两百格找不到一家超市）。这里按 zone 打分，把最像目标 zone 的格子改过去。 */
  const scoreFor = (r: Raw, z: Zone): number => {
    switch (z) {
      case 'cbd': return r.urban + r.comm;
      case 'residential': return r.urban - Math.abs(r.comm) * 0.5;
      case 'suburb': return 0.30 - Math.abs(r.urban - 0.14);
      case 'industry': return r.ind - r.urban * 0.5;
      case 'farmland': return r.rural;
      case 'forest': return -r.rural + r.elev * 0.3;
      case 'military': return 3 - Math.max(Math.abs(r.b.x - military.x), Math.abs(r.b.y - military.y));
      default: return 0;
    }
  };
  const countZone = (z: Zone) => raws.filter(r => r.b.zone === z).length;
  for (const req of ZONE_REQUIRED) {
    let guard = 0;
    while (countZone(req.zone) < req.min && guard++ < 40) {
      const homeKey = bkey(home.x, home.y), labKey = bkey(lab.x, lab.y);
      const cands = raws
        .filter(r => r.b.zone !== 'water' && r.b.poi === null && r.b.biome !== 'highway'
          && bkey(r.b.x, r.b.y) !== homeKey && bkey(r.b.x, r.b.y) !== labKey)
        .sort((a, b2) => scoreFor(b2, req.zone) - scoreFor(a, req.zone));
      const pick = cands.find(r => r.b.zone !== req.zone && scoreFor(r, req.zone) > -0.4);
      if (!pick) break;
      pick.b.zone = req.zone;
      pick.b.biome = BIOME_OF[req.zone];
    }
  }

  /* ── 6) 撒 POI：按 zone 的偏好加权、沿街的概率更高、稀有建筑有上限 ── */
  const blocks: Record<string, Block> = {};
  const poiCount: Record<string, number> = {};
  const roadAdj = (r: Raw) => NEIGHBORS.some(([dx, dy]) => at(r.b.x + dx, r.b.y + dy)?.b.road);
  const d2home = (b: Block) => Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y));
  for (const r of raws) {
    const b = r.b;
    b.name = blockName(b.x, b.y, b.zone ?? 'open');
    blocks[bkey(b.x, b.y)] = b;
    if (b.zone === 'water' || b.biome === 'highway') continue;
    const d = d2home(b);
    const pref = ZONE_POI[b.zone ?? 'open'] ?? [];
    const pool: { id: string; w: number }[] = [];
    for (const id in POIS) {
      const p = POIS[id];
      if (!p.biomes.includes(b.biome)) continue;              // 硬约束：建筑必须长在合适的地表上
      if (id === 'lab') continue;                             // 实验室单独强放
      if ((poiCount[id] ?? 0) >= (POI_CAP[id] ?? POI_CAP_DEFAULT)) continue;
      let w = 1;
      const idx = pref.indexOf(id);
      if (idx >= 0) w *= 2.6 - idx * 0.15;                    // 越靠前的偏好权重越高
      else w *= 0.28;                                         // 不属于这个区的东西很少见
      if (id === 'camp') w = 0.5 + d * 0.25;
      if (id === 'outpost') w = 0.4 + d * 0.2;
      if (id === 'gas' || id === 'garage') w *= b.biome === ('highway' as Biome) ? 3 : 1.2;
      if (MODERN_POIS.has(id)) w *= 1.5;
      if (roadAdj(r)) w *= 2.2;                               // 商业沿街：真实城市里店铺都在路边
      if (w > 0) pool.push({ id, w });
    }
    if (!pool.length) continue;
    const nearRoad = roadAdj(r);
    const chance = Math.min(0.85, (b.zone === 'cbd' ? 0.72 : b.zone === 'residential' ? 0.55 : 0.4) + (nearRoad ? 0.2 : 0) + d * 0.012);
    if (rng() > chance) continue;
    const total = pool.reduce((a, x) => a + x.w, 0);
    let rr = rng() * total, chosen = pool[pool.length - 1].id;
    for (const p of pool) { rr -= p.w; if (rr <= 0) { chosen = p.id; break; } }
    b.poi = chosen;
    poiCount[chosen] = (poiCount[chosen] ?? 0) + 1;
    if (POIS[chosen].danger > 0) b.danger = Math.max(1, Math.min(5, b.danger + 1));
  }

  /* ── 7) 沉没基地：只在"四周全是水"的深水格，离家 ≥6 格，一张图 1~2 个 ── */
  const deepWater: Block[] = [];
  for (const k in blocks) {
    const b = blocks[k];
    if (b.biome !== 'water' || d2home(b) < SUNKEN_MIN_DIST) continue;
    let land = 0;
    for (const [dx, dy] of NEIGHBORS) { const nb = blocks[bkey(b.x + dx, b.y + dy)]; if (nb && nb.biome !== 'water') land++; }
    if (land === 0) deepWater.push(b);
  }
  deepWater.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  for (let i = 0; i < SUNKEN_PER_WORLD && deepWater.length; i++) {
    const b = deepWater.splice(Math.floor(rng() * deepWater.length), 1)[0];
    b.poi = 'sunken';
    b.danger = Math.max(b.danger, 4);
  }

  /* ── 8) 家与实验室：安全屋强制成"城郊住宅、无 POI、危险 1"；实验室强制放置 ── */
  const hb = blocks[bkey(home.x, home.y)];
  hb.biome = 'suburb'; hb.zone = 'suburb'; hb.poi = null; hb.danger = 1; hb.visited = true; hb.revealed = true;
  hb.name = blockName(home.x, home.y, 'suburb');
  const lb = blocks[bkey(lab.x, lab.y)];
  // 实验室是军管设施：地表必须是它允许的那几种（POIS.lab.biomes），否则地图上会出现"农田里的实验室"
  if (!POIS.lab.biomes.includes(lb.biome)) lb.biome = 'industrial';
  lb.poi = 'lab'; lb.danger = 5;
  lb.zone = 'industry';
  lb.road = true;                                   // 实验室通公路（不然车开不进去）
  lb.name = blockName(lab.x, lab.y, 'industry');

  return { seed, w: WORLD_W, h: WORLD_H, home, lab, blocks };
}

/** 地名：zone 决定后缀（厂区/农田/林场/大道…），坐标决定字号，同一张图里不重名 */
function blockName(x: number, y: number, zone: Zone): string {
  const suf = NAME_SUFFIX[zone] ?? NAME_SUFFIX.open;
  const a = NAME_ROAD[(x * 7 + y * 13) % NAME_ROAD.length];
  const s = suf[(x + y * 3) % suf.length];
  const no = ((x * 5 + y * 11) % 9) + 1;
  return zone === 'industry' || zone === 'military' ? a + s + ' ' + no + ' 号厂区'
    : zone === 'farmland' ? a + s + ' ' + no + ' 号地'
      : zone === 'forest' ? a + s + ' ' + no + ' 号林班'
        : a + s + ' ' + no + ' 号街区';
}

export function blockAt(w: WorldState, x: number, y: number): Block | null {
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return null;
  return w.blocks[bkey(x, y)] ?? null;
}

export const NEIGHBORS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function neighbors(w: WorldState, x: number, y: number): Block[] {
  const out: Block[] = [];
  for (const [dx, dy] of NEIGHBORS) {
    const b = blockAt(w, x + dx, y + dy);
    if (b) out.push(b);
  }
  return out;
}

/** 迷雾：到过一个区块，就点亮它和它周围 1 圈 */
export function revealAround(w: WorldState, x: number, y: number, r = 1): string[] {
  const opened: string[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const b = blockAt(w, x + dx, y + dy);
    if (b && !b.revealed) { b.revealed = true; opened.push(bkey(b.x, b.y)); }
  }
  return opened;
}

/** 直线取整的路径（载具沿路走用） */
export function lineBlocks(w: WorldState, from: { x: number; y: number }, to: { x: number; y: number }): Block[] {
  const out: Block[] = [];
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const b = blockAt(w, Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t));
    if (b) out.push(b);
  }
  return out;
}
