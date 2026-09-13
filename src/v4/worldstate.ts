/* v4.0 大世界状态层（纯逻辑，不碰 DOM、不碰 legacy）：
   - 世界本体（24×24 区块）由 seed 生成，不进存档；进存档的只有玩家进度（到过哪、搜过几次、车况）。
   - 旅行规划 = 寻路 + 行动力/燃油核算；遭遇判定也在这里，UI 只负责展示与落地副作用。 */
import { generateWorld, bkey, blockAt, revealAround, WORLD_W, WORLD_H } from './worldgen';
import { fragSpots } from './quest4';
import { HOME_REGION, regionById, regionSeed } from './regions-core';
import type { Block, WorldState } from '../types';
export interface VehState { fuel: number; hp: number }

/** 单个区域的进度（跨区时整块换进换出，见 switchRegion） */
export interface RegionProgress {
  visited: Record<string, 1>;
  firstPoi: Record<string, 1>;
  left: Record<string, number>;
  stock: Record<string, number>;
  frag: Record<string, 1>;
  forage: Record<string, { left: number; day: number }>;
  salvage: Record<string, { left: number }>;
  fish: Record<string, { left: number; day: number }>;
  chop: Record<string, { left: number; day: number }>;
}

export interface SaveWorld extends RegionProgress {
  v: 1;
  seed: string;
  /** M12：当前所在区域 id（元地图上的一格）。老存档没有这个字段 → 默认余烬市区，
      而老存档里那批 map 本来就是余烬市区的进度，所以旧档**天然兼容**，不需要搬数据。 */
  region: string;
  /** 其他区域的进度（只有离开时才冻进来；当前区域的进度就存在上面那几个顶层字段里）。
      这样设计是为了让 40 多处 `sw.visited[...]` 之类的老代码一行都不用改。 */
  regions: Record<string, RegionProgress>;
  /** 去过哪些区域（首次进入给叙事钩子） */
  seenRegions: Record<string, 1>;
  /** M13：每个区域到访过几次（含主城）——跨区委托/剧情的判定依据（region:<id> 指标） */
  regionVisits: Record<string, number>;
  /** M14：每个区域里各搜刮过几次 `{ 区域: { poiId: 次数 } }`——跨区委托用它判定
      "在那个区真的翻了几个地方"（`rzone:<区域>:*`），而不是"踏进过那个区"。
      按区域各记一份，不随 switchRegion 冻结/摊平（它天然是分区的）。 */
  regionZones: Record<string, Record<string, number>>;
  cur: { x: number; y: number };
  /** 在营地买过情报：碎片点与实验室永久点亮（迷雾每次都由 visited + 这个派生出来） */
  intel: boolean;
  /** 睡眠债（档，0~3）：AP 上限 = 9 - 债，派生值不单独存 */
  debt: number;
  /** 最近一次过夜的结算记录（C01/C02/R3：落盘 + 幂等） */
  lastNight: { day: number; kind: string; tier: string; outcome: string; ap: number } | null;
  /** 血月不在家、据点被啃的那一天（幂等标记，防重复结算） */
  lastRaidDay: number;
  /** 100 天撤离窗口（C07）：坐标与开启日 */
  evac: { x: number; y: number; day: number } | null;
  veh: VehState | null;
  steps: number;                 // 累计走过多少区块
  fights: number;                // 路上打过多少场
  trail: string[];               // 最近若干条旅行/搜刮记录（地图面板显示用）
}

let cache: { key: string; w: WorldState } | null = null;
/** C11：迷雾重放很贵（576 格 ×9 邻居），而 ensure 会被每次 render 调到；
    这里记住"上次重放时的状态指纹"，只有读档/情报/无线电/新到过区块才重放一次。 */
let lastSynced: { S: any; intel: boolean; radio: boolean; visited: number; region: string } | null = null;
/** 迷雾重放次数（C11 的性能指标：反复 render 不该把它越推越高） */
let replays = 0;
export const replayCount = () => replays;

/** 世界对象按 "种子+区域" 缓存：同一存档在同一区域反复 render 不重复生成。
    第二参数是**必填**的——不给区域就默认主城是个很容易埋的坑（会拿着别人的地图算坐标）。 */
export function worldOf(seed: string, region: string): WorldState {
  const key = seed + '::' + region;
  if (!cache || cache.key !== key) cache = { key, w: buildRegionWorld(seed, region) };
  return cache.w;
}

/** 生成某个区域的 24×24 世界：地形按该区域的主题（biomeBias）生成——
 *  "东郊农场带"真的是连片农田、"江北工业区"真的是成片厂房（M15 起偏置真正参与生成）；
 *  危险度按区域层级整体上浮（主城 tier=1 → 与旧版逐格一致，不动老档的平衡）。 */
function buildRegionWorld(seed: string, region: string): WorldState {
  const def = regionById(region);
  const w = generateWorld(regionSeed(seed, region), { bias: def?.biomeBias, label: def?.name });
  const bump = def ? Math.max(0, def.tier - 1) : 0;
  if (bump > 0) {
    for (const k in w.blocks) {
      const b = w.blocks[k];
      b.danger = Math.min(5, b.danger + bump);
    }
  }
  return w;
}

export function markVisited(w: WorldState, sw: SaveWorld, x: number, y: number): string[] {
  const b = blockAt(w, x, y);
  if (!b) return [];
  sw.visited[bkey(x, y)] = 1;
  b.visited = true;
  return revealAround(w, x, y, 1);
}

export function defaultSaveWorld(seed: string): SaveWorld {
  const w = worldOf(seed, HOME_REGION);
  const sw: SaveWorld = {
    v: 1, seed, region: HOME_REGION, regions: {}, seenRegions: { [HOME_REGION]: 1 }, regionVisits: { [HOME_REGION]: 1 }, regionZones: {},
    cur: { x: w.home.x, y: w.home.y },
    visited: {}, firstPoi: {}, left: {}, stock: {}, frag: {}, forage: {}, salvage: {}, fish: {}, chop: {}, intel: false,
    debt: 0, lastNight: null, lastRaidDay: 0, evac: null,
    veh: null, steps: 0, fights: 0, trail: [],
  };
  markVisited(w, sw, w.home.x, w.home.y);
  return sw;
}

/** 把当前区域的进度收进 regions[region]，再把目标区域的进度摊到顶层字段上 */
function stashCurrent(sw: SaveWorld): void {
  sw.regions[sw.region] = {
    visited: sw.visited, firstPoi: sw.firstPoi, left: sw.left, stock: sw.stock, frag: sw.frag,
    forage: sw.forage, salvage: sw.salvage, fish: sw.fish, chop: sw.chop,
  };
}
function loadRegion(sw: SaveWorld, region: string): void {
  const p = sw.regions[region];
  /* 摊到顶层之后就把这份副本删掉：regions 的语义严格是"**其它**区域的进度"，
     否则同一个区域会同时活在顶层和 regions 里，计数与排查都会误导人 */
  delete sw.regions[region];
  sw.visited = p ? p.visited : {};
  sw.firstPoi = p ? p.firstPoi : {};
  sw.left = p ? p.left : {};
  sw.stock = p ? p.stock : {};
  sw.frag = p ? p.frag : {};
  sw.forage = p ? p.forage : {};
  sw.salvage = p ? p.salvage : {};
  sw.fish = p ? p.fish : {};
  sw.chop = p ? p.chop : {};
}

export interface SwitchResult { ok: boolean; why?: string; firstEnter?: string; region: string; home: { x: number; y: number } }

/** 跨区域：换地图 + 换进度 + 落到目标区的安全屋/落脚点。
 *  成本（油/行动力）由 regions-core.planRegionTrip 判定，这里只负责"真的搬过去"。 */
export function switchRegion(S: any, sw: SaveWorld, toRegion: string): SwitchResult {
  const def = regionById(toRegion);
  if (!def) return { ok: false, why: '没有这个区域', region: sw.region, home: sw.cur };
  if (def.id === sw.region) return { ok: true, region: sw.region, home: sw.cur };
  stashCurrent(sw);
  sw.region = def.id;
  const first = !sw.seenRegions[def.id];
  sw.seenRegions[def.id] = 1;
  sw.regionVisits[def.id] = (sw.regionVisits[def.id] || 0) + 1;    // M13：跨区委托"跑一趟"要能数出来
  loadRegion(sw, def.id);
  const w = worldOf(sw.seed, def.id);
  sw.cur = { x: w.home.x, y: w.home.y };      // 跨区落地 = 该区入口（生成器给的 home 点）
  markVisited(w, sw, sw.cur.x, sw.cur.y);
  /* 迷雾是按"当前区域"重放的，换区必须让指纹失效，否则会一直用上一张图的迷雾 */
  lastSynced = null;
  if (S) S.world = sw;
  return { ok: true, region: def.id, home: sw.cur, firstEnter: first ? def.firstEnter : undefined };
}

/** 存档里的 world 字段可能缺字段/被改坏：这里补齐并把迷雾按 visited 重放回来 */
export function ensureSaveWorld(S: any): SaveWorld {
  let sw: SaveWorld | null = S && S.world ? S.world as SaveWorld : null;
  if (!sw || typeof sw !== 'object' || typeof sw.seed !== 'string' || !sw.seed) {
    sw = defaultSaveWorld(String((S && S.seed) || 'ember-01'));
    if (S) S.world = sw;
    return sw;
  }
  const w = worldOf(sw.seed, sw.region);
  sw.v = 1;
  /* M12：多区域字段补齐。老存档没有 region/regions/seenRegions：
     它顶层那批 map 本来就是主城的进度，所以直接认成 region=余烬市区，数据一个都不用搬。 */
  sw.region = typeof sw.region === 'string' && regionById(sw.region) ? sw.region : HOME_REGION;
  sw.regions = sw.regions && typeof sw.regions === 'object' ? sw.regions : {};
  sw.seenRegions = sw.seenRegions && typeof sw.seenRegions === 'object' ? sw.seenRegions : { [sw.region]: 1 as const };
  sw.seenRegions[sw.region] = 1;
  /* M13：到访次数表。老档只知道"去过"，补成 1 次；当前区域至少 1 次（否则站在主城却算没来过）。 */
  const rv = (sw.regionVisits && typeof sw.regionVisits === 'object') ? sw.regionVisits : {};
  sw.regionVisits = {};
  for (const id in rv) { const n = Math.floor(Number(rv[id])); if (isFinite(n) && n > 0) sw.regionVisits[id] = Math.min(9999, n); }
  for (const id in sw.seenRegions) if (!sw.regionVisits[id]) sw.regionVisits[id] = 1;
  sw.regionVisits[sw.region] = Math.max(1, sw.regionVisits[sw.region] || 0);
  /* M14：分区搜刮计数（老档没有 → 补空表；形状不对的条目直接丢掉，不让坏档传染） */
  const rz = sw.regionZones && typeof sw.regionZones === 'object' ? sw.regionZones : {};
  sw.regionZones = {};
  for (const rid in rz) {
    const bag = rz[rid];
    if (!bag || typeof bag !== 'object') continue;
    const out: Record<string, number> = {};
    for (const poi in bag) { const n = Math.floor(Number(bag[poi])); if (isFinite(n) && n > 0) out[poi] = Math.min(9999, n); }
    sw.regionZones[rid] = out;
  }
  sw.cur = validPos(sw.cur) ? { x: sw.cur.x, y: sw.cur.y } : { x: w.home.x, y: w.home.y };
  // M7：水块现在是合法落脚点（可以游过去、可以潜水），所以**不再**把站在水里的玩家挪回陆地——
  // 以前那条"坏档防卡死"的兜底会把刚游下水的玩家瞬移回岸边（潜水功能因此完全失效，探针抓到过）。
  // 只有坐标非法或落在地图外才回安全屋（上面那行已经处理）。
  sw.visited = sw.visited && typeof sw.visited === 'object' ? sw.visited : {};
  sw.firstPoi = sw.firstPoi && typeof sw.firstPoi === 'object' ? sw.firstPoi : {};
  sw.left = sw.left && typeof sw.left === 'object' ? sw.left : {};
  sw.stock = sw.stock && typeof sw.stock === 'object' ? sw.stock : {};
  sw.frag = sw.frag && typeof sw.frag === 'object' ? sw.frag : {};
  sw.forage = sw.forage && typeof sw.forage === 'object' ? sw.forage : {};
  sw.salvage = sw.salvage && typeof sw.salvage === 'object' ? sw.salvage : {};
  sw.fish = sw.fish && typeof sw.fish === 'object' ? sw.fish : {};
  // M8：伐木次数（老存档没有这张表，补空对象；每次伐木只写自己那一格）
  sw.chop = sw.chop && typeof sw.chop === 'object' ? sw.chop : {};
  sw.intel = !!sw.intel;
  sw.debt = Math.max(0, Math.min(3, typeof sw.debt === 'number' && isFinite(sw.debt) ? sw.debt : 0));
  sw.lastNight = sw.lastNight && typeof sw.lastNight === 'object' ? sw.lastNight : null;
  sw.lastRaidDay = num(sw.lastRaidDay);
  sw.evac = sw.evac && typeof sw.evac === 'object' && isPos(sw.evac.x) && isPos(sw.evac.y) ? sw.evac : null;
  sw.trail = Array.isArray(sw.trail) ? sw.trail.slice(-24) : [];
  sw.steps = num(sw.steps); sw.fights = num(sw.fights);
  sw.veh = sw.veh && typeof sw.veh === 'object' ? { fuel: num(sw.veh.fuel), hp: num(sw.veh.hp) || 60 } : null;
  // C11：只有指纹变了才重放迷雾（否则每次 render 都要重放 576 格）
  const radio = !!(S && S.base && S.base.radio);
  const visitedN = Object.keys(sw.visited).length;
  if (lastSynced && lastSynced.S === S && lastSynced.intel === sw.intel && lastSynced.radio === radio && lastSynced.visited === visitedN && lastSynced.region === sw.region) {
    return sw;
  }
  lastSynced = { S, intel: sw.intel, radio, visited: visitedN, region: sw.region };
  replays++;
  // 迷雾恢复：visited 是唯一的真相源，其余 revealed/visited 全部重放
  for (const k in w.blocks) { w.blocks[k].revealed = false; w.blocks[k].visited = false; }
  for (const k in sw.visited) {
    const p = k.split(',').map(Number);
    if (validPos({ x: p[0], y: p[1] })) markVisited(w, sw, p[0], p[1]);
  }
  // 无线电架好 = 拿到实验室坐标：那一格永远点亮（否则玩家在迷雾里根本点不到终点）
  if (radio) {
    const lb = blockAt(w, w.lab.x, w.lab.y);
    if (lb) lb.revealed = true;
  }
  // 买过情报 = 碎片点与实验室所在地永久可见。这里必须"每次重算"而不是只在买东西时点亮一次，
  // 因为迷雾是每次 ensure 都从 visited 重放出来的，一次性的点亮会被下一次重放抹掉。
  if (sw.intel) {
    for (const f of fragSpots(w)) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const b = blockAt(w, f.x + dx, f.y + dy);
        if (b) b.revealed = true;
      }
    }
    const lb = blockAt(w, w.lab.x, w.lab.y);
    if (lb) lb.revealed = true;
  }
  return sw;
}

const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : 0);
const validPos = (p: any) => !!p && typeof p === 'object' && isPos(p.x) && isPos(p.y);
const isPos = (v: any) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < Math.max(WORLD_W, WORLD_H);

/* ── 旅行 ── */

export interface Trip {
  path: Block[];
  steps: number;
  ap: number;
  fuel: number;
  mode: 'foot' | 'car';
  encounters: number;      // 预计遭遇次数（实际由 UI 掷骰决定，这里只给上限参考）
}

export interface TripRequest {
  ap: number;
  veh: VehState | null;
  fractured: boolean;      // 骨折：走路更慢
  night: boolean;
}

/** POI → legacy 区域 id：搜刮 POI 时同步 legacy 的悬赏/支线计数，主线才不会因为换了大世界而卡住 */
const POI_ZONE: Record<string, string> = {
  market: 'market', mall: 'market',
  pharmacy: 'hospital', hospital: 'hospital', clinic: 'hospital',
  police: 'police', military: 'military', prison: 'police', bunker: 'military',
  school: 'oldtown', church: 'oldtown', apartment: 'oldtown', construction: 'oldtown',
  warehouse: 'oldtown', farm: 'oldtown', camp: 'oldtown',
  gas: 'gas', garage: 'gas', waterworks: 'subway', tunnel: 'subway', radio: 'subway',
  outpost: 'oldtown', lab: 'lab',
};
export const zoneOfPoi = (poiId: string | null): string | null => (poiId ? POI_ZONE[poiId] ?? null : null);

const passable = (b: Block) => b.biome !== 'water';
/** M7：步行可以游过水（代价高、有风险），开车不行 */
const passableFor = (b: Block, allowWater: boolean) => b.biome !== 'water' || allowWater;
export const waterSteps = (path: Block[]) => path.filter(b => b.biome === 'water').length;

/** Dijkstra：走路按步数、开车按高速更省的方式找路线；allowWater=true 时水块可以游过去（每格多花 2 AP） */
export function findPath(w: WorldState, from: { x: number; y: number }, to: { x: number; y: number }, mode: 'foot' | 'car', allowWater = false): Block[] | null {
  const start = blockAt(w, from.x, from.y), goal = blockAt(w, to.x, to.y);
  if (!start || !goal || !passableFor(start, allowWater) || !passableFor(goal, allowWater)) return null;
  const key = (b: Block) => bkey(b.x, b.y);
  const cost: Record<string, number> = { [key(start)]: 0 };
  const prev: Record<string, string> = {};
  const nodeOf: Record<string, Block> = { [key(start)]: start };
  const open: string[] = [key(start)];
  const done: Record<string, 1> = {};
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (done[cur]) continue;
    done[cur] = 1;
    const b = nodeOf[cur];
    if (b.x === goal.x && b.y === goal.y) break;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nb = blockAt(w, b.x + dx, b.y + dy);
      if (!nb || !passableFor(nb, allowWater)) continue;
      const nk = key(nb);
      if (done[nk]) continue;
      let step = 1;
      if (mode === 'car') step = nb.biome === 'highway' ? 0.55 : nb.road ? 0.8 : (dx && dy ? 1.35 : 1);
      // 水路很贵（每格相当于 3 格陆路），所以能绕就绕；只有确实更近时才会下水
      if (nb.biome === 'water') step = 3;
      const nc = cost[cur] + step;
      if (cost[nk] === undefined || nc < cost[nk] - 1e-9) {
        cost[nk] = nc; prev[nk] = cur; nodeOf[nk] = nb;
        open.push(nk);
      }
    }
  }
  const gk = key(goal);
  if (cost[gk] === undefined) return null;
  const out: Block[] = [];
  for (let k: string | undefined = gk; k; k = prev[k]) out.unshift(nodeOf[k]);
  return out;
}

/** 一次旅行的报价：够不够行动力/油，不够就明确说原因（UI 直接显示这句话） */
export function planTrip(w: WorldState, from: { x: number; y: number }, to: { x: number; y: number }, req: TripRequest):
  { trip: Trip } | { err: string } {
  // 车坏了（hp<=0）就当没有车：否则玩家会开着一辆 0% 车况的车到处跑
  const veh = req.veh && req.veh.fuel > 0 && req.veh.hp > 0 ? req.veh : null;
  // M7：步行允许游过水（每格水路按 2 AP 算），开车只能走陆路
  const path = findPath(w, from, to, veh ? 'car' : 'foot', !veh);
  if (!path) return { err: veh ? '开车过不去（水域挡着）——换步行可以游过去。' : '没有可以走通的路。' };
  const steps = path.length - 1;
  if (steps <= 0) return { err: '你已经在这个区块了。' };
  const wet = waterSteps(path);
  const footAP = steps + wet + (req.fractured ? Math.ceil(steps / 3) : 0);   // 水路每格多 1 AP（游泳）
  if (veh) {
    const ap = Math.max(1, Math.ceil(steps / 4));
    const fuel = Math.max(1, Math.ceil(steps / 6));
    if (veh.fuel >= fuel && req.ap >= ap) {
      return { trip: { path, steps, ap, fuel, mode: 'car', encounters: Math.max(1, Math.round(steps / 6)) } };
    }
    if (req.ap < ap && req.ap < footAP) return { err: `行动力不够：开车要 ${ap} 点，你只有 ${req.ap} 点。` };
    if (veh.fuel < fuel && req.ap < footAP) return { err: `油不够（要 ${fuel} 桶）也走不动（要 ${footAP} 行动力）。` };
  }
  if (req.ap < footAP) return { err: `行动力不够：走路要 ${footAP} 点（含 ${wet} 公里水路），你只有 ${req.ap} 点。` };
  return { trip: { path, steps, ap: footAP, fuel: 0, mode: 'foot', encounters: Math.max(1, Math.round(steps / 3)) } };
}

/** 路上会不会撞上东西：步数越多、天越黑、区块越危险，越容易。返回到第几步出事（null = 一路平安） */
export function rollTravelEncounter(rng: () => number, opts: { steps: number; night: boolean; danger: number; car: boolean; luck?: number }): number | null {
  let p = 0.10 + opts.danger * 0.03 + (opts.night ? 0.09 : 0);
  if (opts.car) p *= 0.55;
  p *= 1 - Math.min(0.5, opts.luck ?? 0);
  for (let i = 1; i <= opts.steps; i++) if (rng() < p) return i;
  return null;
}
