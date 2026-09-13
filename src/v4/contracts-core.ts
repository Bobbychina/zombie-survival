/* 委托系统（纯逻辑，不碰 DOM、不碰 legacy）—— 用户要的"接委托"那一半。
 *
 * 和旧的"委托板"区别（旧版在 legacy 里：每晚刷 3 张、做完自动结算、没有接单概念）：
 *   · 要**接单**：未接的只是"报价"，接了才占坑（最多 3 个），接了才开始算进度
 *   · 有**期限**：2~5 天，过期作废（记一次失败，不扣东西——这游戏惩罚已经够多了）
 *   · 进度**从接单那一刻起算**：baseline 快照，避免"你早就搜过医院了所以秒完成"
 *   · 跨区委托：目标在别的区域 → 没车就只能看着（接上 M12 的区域门槛）。
 *     M14 起判定用 `rzone:<区域>:*`（在那个区域搜刮过 N 次），不再只是"踏进那个区"——
 *     否则开车过去再开回来就完成了，跨区委托会退化成"跑腿费"。
 *   · 赏金预算：同一天刷出来的委托，材料奖励总和不超过 `20 + 2×天数`（防止委托变成无限材料机）
 */
import { MAX_HOPS, REGIONS, regionById, regionName, regionPath, regionTravelCost, type RegionType, typeLabel } from './regions-core';
import { AP_MAX_BASE } from './night-core';
import { foeName, poiName } from './labels';

export type Metric =
  | 'kills' | 'deep' | 'hordes' | 'nights'
  | `killBy:${string}` | `zone:${string}` | `region:${string}`
  /** M14：在某个区域里搜刮（`rzone:<区域>:<poiId|*>`，`*` = 该区域任意地点） */
  | `rzone:${string}`
  /** M17：到访过某种**类型**的区域（`rtype:industry`）——元地图改成程序化生成后，
      剧情/委托不能再写死"去江北"，只能写"去一片工业区" */
  | `rtype:${RegionType}`;

export interface ContractReward { mat?: number; item?: string; n?: number }

export interface ContractDef {
  id: string;
  title: string;
  desc: string;
  metric: Metric;
  need: number;
  days: number;
  reward: ContractReward;
  /** 目标所在区域（跨区委托用；UI 会提示"要开车过去"） */
  region?: string;
  /** M14：谁托的这件事（营地里的名字，UI 里显示成"—— 老周"） */
  from?: string;
  tier: number;              // 1..3 难度档（影响期限与奖励）
}

export interface ActiveContract {
  id: string;
  title: string;
  desc: string;
  metric: Metric;
  need: number;
  reward: ContractReward;
  region?: string;
  from?: string;
  acceptedDay: number;
  deadlineDay: number;
  baseline: number;          // 接单时的进度基线
}

export interface BoardOffer extends ContractDef { key: string; expiresDay: number }

export interface ContractsState {
  day: number;                       // 这份板子是哪天刷的
  board: BoardOffer[];
  active: ActiveContract[];
  done: number;                      // 累计完成
  failed: number;                    // 累计过期/放弃
  log: string[];                     // 最近的委托事件（UI 显示）
  /** 这一天的板子是否已经刷过。用来区分"还没刷"和"刷了、被玩家接完了"——
      后者不能在下次 render 时白送一张新板子（等于一天无限接单）。 */
  rolled?: boolean;
}

export const MAX_ACTIVE = 3;

export interface Snap {
  day: number;
  kills: number;
  killBy: Record<string, number>;
  zones: Record<string, number>;       // poiId → 搜刮次数
  deep: number;
  hordes: number;
  nights: number;
  items: Record<string, number>;
  regions: Record<string, number>;     // regionId → 到访次数
  /** M14：regionId → (poiId → 该区域里的搜刮次数)。跨区委托判定用，按区各记一份。 */
  rzones: Record<string, Record<string, number>>;
}

export function emptyContracts(day = 1): ContractsState {
  return { day, board: [], active: [], done: 0, failed: 0, log: [], rolled: false };
}

/** `rzone:<区域>:<poi|*>` 的三个字段（解析失败返回 null，让调用方兜底成 0） */
function parseRzone(key: string): { region: string; poi: string } | null {
  const j = key.indexOf(':');
  if (j < 0) return null;
  return { region: key.slice(0, j), poi: key.slice(j + 1) };
}

export function metricNow(metric: Metric, snap: Snap): number {
  const i = metric.indexOf(':');
  if (i < 0) {
    switch (metric) {
      case 'kills': return snap.kills;
      case 'deep': return snap.deep;
      case 'hordes': return snap.hordes;
      case 'nights': return snap.nights;
      default: return 0;
    }
  }
  const kind = metric.slice(0, i), key = metric.slice(i + 1);
  if (kind === 'killBy') return snap.killBy[key] ?? 0;
  if (kind === 'zone') return snap.zones[key] ?? 0;
  if (kind === 'region') return snap.regions[key] ?? 0;
  if (kind === 'rtype') {
    /* 该类型的所有区域里，到访次数之和（去过的算 1 次以上） */
    let sum = 0;
    for (const r of REGIONS) if (r.type === key) sum += (snap.regions[r.id] ?? 0);
    return sum;
  }
  if (kind === 'rzone') {
    const p = parseRzone(key);
    if (!p) return 0;
    const bag = (snap.rzones ?? {})[p.region] ?? {};
    if (p.poi !== '*') return bag[p.poi] ?? 0;
    let sum = 0;                                  // `*` = 该区域任意地点，求和
    for (const k in bag) sum += bag[k] || 0;
    return sum;
  }
  return 0;
}

/** 人话进度文案（UI 直接用） */
export function metricLabel(metric: Metric): string {
  const i = metric.indexOf(':');
  if (i < 0) return metric === 'kills' ? '击杀丧尸' : metric === 'deep' ? '深度搜索' : metric === 'hordes' ? '守夜/尸潮' : metric === 'nights' ? '过夜' : metric;
  const kind = metric.slice(0, i), key = metric.slice(i + 1);
  if (kind === 'killBy') return '击杀 ' + foeName(key);
  if (kind === 'zone') return '搜刮 ' + poiName(key);
  if (kind === 'region') return '前往 ' + regionName(key);
  if (kind === 'rtype') return '到访' + typeLabel(key as RegionType) + '（任意一处）';
  if (kind === 'rzone') {
    const p = parseRzone(key);
    if (!p) return metric;
    const where = '在' + regionName(p.region);
    return p.poi === '*' ? where + '搜刮（任意地点）' : where + '搜刮 ' + poiName(p.poi);
  }
  return metric;
}

/** 当日赏金预算：同一天刷出来的委托，材料奖励总和不超过这个数。
 *  比旧版（9 + 天数/2）宽一些——因为现在有"最多同时接 3 个 + 有期限"这两道闸，
 *  不需要靠预算本身去卡产量；预算是防"一天刷出一堆高赏金随便接"。 */
export const bountyBudget = (day: number): number => 20 + Math.max(1, day) * 2;

/* ── 委托模板 ──
   tier 1：本地跑腿（1~2 天）
   tier 2：要跑远一点（3 天）
   tier 3：跨区/硬目标（4~5 天，奖励最好） */
interface Tpl { title: (k?: string) => string; desc: string; metric: (k?: string) => Metric; need: number; days: number; mat: number; item?: string; n?: number; tier: number; from?: string }

const T = (t: Tpl) => t;
/* 委托人：谁托的这件事。纯风味，但玩家一眼就知道"这活是谁给的"，
   也让"营地里的名字"和委托挂上钩（M14）。 */
const LOCAL: Tpl[] = [
  T({ tier: 1, title: () => '清理周边', desc: '安全屋附近总有东西在晃。清掉几只，今晚睡得安稳点。', metric: () => 'kills', need: 4, days: 2, mat: 6, from: '老周（守门的）' }),
  T({ tier: 1, title: () => '补给清单', desc: '抗生素永远不够用。去药房翻一趟。', metric: () => 'zone:pharmacy', need: 1, days: 2, mat: 5, item: 'bandage', n: 2, from: '林医生' }),
  T({ tier: 1, title: () => '深挖一层', desc: '浅尝辄止翻不到好东西——有人要你认真搜两次。', metric: () => 'deep', need: 2, days: 2, mat: 8, from: '一个不肯说名字的人' }),
  T({ tier: 2, title: () => '枪柜里的东西', desc: '警局的枪柜还有货，前提是你能进去。', metric: () => 'zone:police', need: 1, days: 3, mat: 10, item: 'ammo', n: 12, from: '阿蛮' }),
  T({ tier: 2, title: () => '守一夜', desc: '有人愿意付钱让你替他盯一晚尸潮。', metric: () => 'hordes', need: 1, days: 3, mat: 12, item: 'medkit', n: 1, from: '营地值夜的人' }),
  T({ tier: 2, title: () => '猎犬问题', desc: '变异猎犬把北边的路堵死了，猎户出价请你解决。', metric: () => 'killBy:hound', need: 3, days: 3, mat: 10, item: 'jerky', n: 3, from: '霍克' }),
  T({ tier: 3, title: () => '装甲猎物', desc: '有人想要装甲丧尸身上的那层壳。价格开得很高，风险也一样。', metric: () => 'killBy:armored', need: 2, days: 4, mat: 16, item: 'kevlar', n: 1, from: '镇上来的收货人' }),
];
/** 跨区委托：目标在别的区域，必须有车才跑得动（M12 区域门槛）。
 *  判定 = `rzone:<区域>:*`（在那个区域里搜刮 N 次）。为什么不指具体 POI：
 *  各区域地形是种子生成的，"那片工业区一定有化工厂"这种假设会让委托永远做不完；
 *  为什么不是"到访一次"：开车过去立刻回来就完成了，跨区委托会退化成跑腿费。
 *  M17：元地图是程序化生成的（12×12），所以这里改成**按区域类型挑目标**——
 *  模板里写"要一片工业区/农田/港区"，实际挑哪个区由当前世界的区域表决定。 */
const FAR: { want: RegionType; title: string; desc: string; days: number; need: number; mat: number; item?: string; n?: number; tier: number; from: string }[] = [
  { want: 'farm', title: '跑一趟农田', desc: '城外农场带的人捎话过来：开车过去，在那边翻两处地方，把货带回来。', days: 4, need: 2, mat: 12, item: 'seed_veg', n: 3, tier: 2, from: '捎话的农夫' },
  { want: 'suburb', title: '城郊的托运', desc: '城郊仓库区有批材料等人去拉——靠两条腿走过去太远，得有车。那边至少翻两处。', days: 4, need: 2, mat: 13, item: 'tape', n: 4, tier: 2, from: '跑这条线的人' },
  { want: 'ruins', title: '废墟里的旧图', desc: '塌掉的旧街区下面埋着旧管网图，值不少材料。开车去，别贪黑，翻三处再回来。', days: 4, need: 3, mat: 15, item: 'data', n: 2, tier: 3, from: '一个收旧图的老头' },
  { want: 'industry', title: '工业区的托运', desc: '工业区有批材料等人去拉——走路不现实，得开车。到了那边翻三处。', days: 4, need: 3, mat: 16, item: 'chip', n: 2, tier: 3, from: '收货的货主' },
  { want: 'forest', title: '山里的木料', desc: '林区的木料堆在路边没人管：有车，就是你的。翻两处就够装一车。', days: 4, need: 2, mat: 14, item: 'wood', n: 6, tier: 3, from: '据点管建材的' },
  { want: 'water', title: '港区的渔获', desc: '港区的水产仓库还锁着，钥匙在跑这条线的人手里。在那边翻三处。', days: 5, need: 3, mat: 18, item: 'fish', n: 4, tier: 3, from: '跑海货的' },
  { want: 'industry', title: '集装箱码头', desc: '码头堆着没人认领的集装箱。开车去，翻三处，装得下多少算多少。', days: 5, need: 3, mat: 20, item: 'metal', n: 6, tier: 3, from: '码头上的人' },
  { want: 'military', title: '军管区的通行证', desc: '没人敢去军管区。开价的人只说了一句："你开车去，别走路，在那边翻两处。"', days: 5, need: 2, mat: 24, item: 'keycard', n: 1, tier: 3, from: '不露面的人' },
  { want: 'residential', title: '居民区的清单', desc: '居民楼里还有没人带走的东西。开车过去，翻两处，把清单上的凑齐。', days: 4, need: 2, mat: 11, item: 'choco', n: 3, tier: 2, from: '营地管账的' },
];

export interface RollOpts {
  /** 当前区域里有没有这个 POI（跨区以后地形是种子生成的，本地委托不能指向不存在的地方） */
  hasPoi?: (poi: string) => boolean;
  /** 玩家当前所在区域：不给本站发"跨区"委托 */
  region?: string;
}

/** 满状态出发的预算：行动力上限（安全屋睡满）+ 油箱上限。跨区委托必须落在预算内，否则就是废委托 */
const FUEL_CAP = 12;

/** M17：按类型挑一个"真能开车去"的目标区域。三条硬约束（都是实测踩出来的）：
 *   ① 别再发"一趟开不到"的委托——超过 MAX_HOPS 格玩家接了也完不成；
 *   ② 也别发"开得到但花不起"的——满状态出发的预算就是 AP 上限 9 + 油箱 12，
 *      斜向格 3 行动力/3 油，4 格斜着走要 12 行动力，照样到不了（探针实测：目标 r1-10 hops=4 却拦下来了）；
 *   ③ 同类型里挑最近的几个随机一个，避免每天都发同一处。
 *  实在没有一趟能到的（例如军管区只在深山角落），退化成"最近的那个"（玩家分两天跑）。 */
function pickFarRegion(want: RegionType, curId: string | undefined, rng: () => number) {
  const cur = curId ? REGIONS.find(r => r.id === curId) : null;
  const full = (id: string) => {
    if (!cur) return { hops: 0, ap: 0, fuel: 0 };
    const c = regionTravelCost(cur, regionById(id)!);
    return { hops: (regionPath(cur.id, id)?.length ?? 99) - 1, ap: c.ap, fuel: c.fuel };
  };
  const pool = REGIONS
    .filter(r => r.type === want && r.id !== curId && !r.homeBase && r.type !== 'water')
    .map(r => ({ r, d: cur ? Math.max(Math.abs(r.col - cur.col), Math.abs(r.row - cur.row)) : r.dist, trip: full(r.id) }))
    .sort((a, b) => a.d - b.d);
  if (!pool.length) return null;
  const affordable = pool.filter(x => x.trip.hops <= MAX_HOPS && x.trip.ap <= AP_MAX_BASE && x.trip.fuel <= FUEL_CAP);
  const cands = (affordable.length ? affordable : pool).slice(0, 4);
  return cands[Math.floor(rng() * cands.length)].r;
}

/** 目标区在当前区的哪个方向（文案用："往东北"） */
function directionWord(target: { col: number; row: number }, curId: string | undefined): string {
  const cur = curId ? REGIONS.find(r => r.id === curId) : null;
  if (!cur) return '外面';
  const dx = target.col - cur.col, dy = target.row - cur.row;
  const ns = dy < 0 ? '北' : dy > 0 ? '南' : '';
  const ew = dx < 0 ? '西' : dx > 0 ? '东' : '';
  return (ns + ew) || '隔壁';
}

/** 刷委托板：每天固定 3 张（挂主线的 1 张 + 跨区 1 张（第 3 天起）+ 本地若干），受赏金预算约束 */
export function rollOffers(day: number, rng: () => number, mainStage = 0, opts: RollOpts = {}): BoardOffer[] {
  const { hasPoi, region: cur } = opts;
  const budget = bountyBudget(day);
  const out: BoardOffer[] = [];
  let spent = 0;
  const push = (d: ContractDef, key: string) => {
    const cost = d.reward.mat ?? 0;
    if (spent + cost > budget) return false;      // 超预算就不刷（不给玩家"无限材料机"）
    spent += cost;
    out.push({ ...d, key, expiresDay: day + 1 });
    return true;
  };
  const metricOk = (m: Metric) => {
    if (m.indexOf('zone:') !== 0 || !hasPoi) return true;
    return hasPoi(m.slice(5));
  };

  /* 1) 一张挂主线的（沿用旧版"每晚有一张指向主线"的设计，但改成可接的委托） */
  const stages: { t: string; d: string; metric: Metric; need: number; mat: number; item?: string; n?: number }[] = [
    { t: '医院里的线索', d: '有人在打听圣玛丽医院的事——他说里面有你需要的第一个答案。', metric: 'zone:hospital', need: 1, mat: 8, item: 'bandage', n: 2 },
    { t: '九分局的枪柜', d: '枪柜还锁着，钥匙在某个穿制服的人身上。', metric: 'zone:police', need: 1, mat: 8, item: 'ammo', n: 12 },
    { t: '门禁卡碎片', d: '三片门禁卡碎片能拼出实验室的门。有人愿意先付定金。', metric: 'killBy:armored', need: 1, mat: 12, item: 'keycard', n: 1 },
    { t: '面具与防护服', d: '没有面具和防护服，实验室的通风井就是你的坟。', metric: 'zone:military', need: 1, mat: 12, item: 'chem', n: 2 },
    { t: '无线电零件', d: '据点那台无线电还差几个电子件。', metric: 'zone:appliance', need: 1, mat: 10, item: 'chip', n: 2 },
    { t: '清路', d: '通往实验室的路要清干净。', metric: 'kills', need: 4, mat: 16, item: 'medkit', n: 1 },
  ];
  /* 主线那张必须落在"这一带真有这个 POI"的模板上：从当前阶段往下找，找不到就用击杀兜底 */
  const stageAt = Math.min(Math.max(0, mainStage), stages.length - 1);
  const st = stages.slice(stageAt).find(x => metricOk(x.metric)) || { t: '清路', d: '通往实验室的路要清干净。', metric: 'kills' as Metric, need: 4, mat: 16, item: 'medkit', n: 1 };
  push({ id: 'story', title: st.t, desc: st.d, metric: st.metric, need: st.need, days: 3, reward: { mat: st.mat, item: st.item, n: st.n }, tier: 2 }, 'story:' + day);

  /* 2) 一张跑远路的（跨区）：只有第 3 天起才给。
        随机起手，但赏金要"留出本地那张的份"（最便宜的本地模板 5 材料，留 6 的余量），
        否则一张 24 材料的北岭委托会把预算吃光，第三张只能发零赏金保底（板上看着像坏的）。
        都不满足就退一步取最便宜的那张，至少板子上还有跨区委托。 */
  if (day >= 3) {
    const start = Math.floor(rng() * FAR.length);
    const order = FAR.map((_, i) => FAR[(start + i) % FAR.length]);
    /* 先把模板映射成"这个世界里真实存在的目标区域"：按类型挑，挑最近的几个之一（别发一张
       要横穿整张元地图的委托——一箱油跑不到）。 */
    const targets = order
      .map(f => ({ f, region: pickFarRegion(f.want, cur, rng) }))
      .filter((x): x is { f: typeof FAR[number]; region: NonNullable<ReturnType<typeof pickFarRegion>> } => !!x.region);
    const fits = targets.find(x => spent + x.f.mat + 6 <= budget);
    const chosen = fits ?? targets.slice().sort((a, b) => a.f.mat - b.f.mat)[0];
    if (chosen) {
      const { f, region } = chosen;
      push({
        id: 'far:' + region.id, title: f.title, desc: f.desc + '（得开车过去：' + region.name + '，往' + directionWord(region, cur) + '）',
        metric: ('rzone:' + region.id + ':*') as Metric, need: f.need, days: f.days, from: f.from,
        reward: { mat: f.mat, item: f.item, n: f.n }, region: region.id, tier: f.tier,
      }, 'far:' + day);
    }
  }

  /* 3) 剩下的坑用本地普通活填满（永远 3 张）：模板池里挑还塞得进预算的，
        挑不到就发一张零赏金的保底差事（材料奖励 0，不会再超预算）。 */
  const pool = LOCAL.slice();
  while (out.length < 3) {
    const slot = out.filter(o => o.id.startsWith('do:') || o.id.startsWith('odd')).length;
    let picked = false;
    while (pool.length && !picked) {
      const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      if (!metricOk(t.metric())) continue;                        // 这一带没这个 POI 就别发
      picked = push({ id: 'do:' + t.title() + slot, title: t.title(), desc: t.desc, metric: t.metric(), need: t.need, days: t.days, from: t.from, reward: { mat: t.mat, item: t.item, n: t.n }, tier: t.tier }, 'do:' + day + ':' + slot);
    }
    if (!picked) push({ id: 'odd' + slot, title: slot ? '搭把手' : '顺手帮个忙', desc: '营地的人只要求你别空手回来，不给材料，管顿饭。', metric: 'kills', need: 2, days: 2, from: '营地的人', reward: { item: 'bandage', n: 1 }, tier: 1 }, 'odd:' + day + ':' + slot);
  }

  /* 兜底：连零赏金都进不去（不可能，除非预算被改成负数）也要有一张能接的 */
  if (!out.length) {
    push({ id: 'fallback', title: '帮个忙', desc: '营地的人只要求你别空手回来。', metric: 'kills', need: 2, days: 2, reward: { mat: 4 }, tier: 1 }, 'fb:' + day);
  }
  return out;
}

export interface AcceptResult { ok: boolean; why?: string; state: ContractsState }

/** 接单：占一个坑（最多 3 个），期限从今天算起，进度基线取接单那一刻 */
export function accept(state: ContractsState, key: string, snap: Snap): AcceptResult {
  const offer = state.board.find(o => o.key === key);
  if (!offer) return { ok: false, why: '这张委托已经不在板子上了', state };
  if (state.active.length >= MAX_ACTIVE) return { ok: false, why: '手上的委托已经满了（最多 ' + MAX_ACTIVE + ' 个），先做完或放弃一个', state };
  if (state.active.some(a => a.id === offer.id)) return { ok: false, why: '这个委托你已经接了', state };
  const c: ActiveContract = {
    id: offer.id, title: offer.title, desc: offer.desc, metric: offer.metric, need: offer.need,
    reward: offer.reward, region: offer.region, from: offer.from, acceptedDay: snap.day, deadlineDay: snap.day + offer.days,
    baseline: metricNow(offer.metric, snap),
  };
  state.active.push(c);
  state.board = state.board.filter(o => o.key !== key);
  state.log.push('第 ' + snap.day + ' 天接了委托：' + offer.title);
  return { ok: true, state };
}

/** 放弃：直接算失败次数（不扣东西），进度作废 */
export function abandon(state: ContractsState, id: string, day: number): ContractsState {
  const c = state.active.find(a => a.id === id);
  if (!c) return state;
  state.active = state.active.filter(a => a.id !== id);
  state.failed++;
  state.log.push('第 ' + day + ' 天放弃了委托：' + c.title);
  return state;
}

export interface ContractProgress { current: number; need: number; left: number; daysLeft: number; done: boolean; expired: boolean }

export function progressOf(c: ActiveContract, snap: Snap): ContractProgress {
  const now = metricNow(c.metric, snap);
  const current = Math.max(0, now - c.baseline);
  const need = c.need;
  return {
    current: Math.min(current, need), need, left: Math.max(0, need - current),
    daysLeft: c.deadlineDay - snap.day,
    done: current >= need,
    expired: !(current >= need) && snap.day > c.deadlineDay,
  };
}

export interface SettleResult {
  state: ContractsState;
  completed: { title: string; reward: ContractReward }[];
  expired: { title: string }[];
  matGain: number;
  items: Record<string, number>;
  messages: string[];
}

/** 结算：完成的给奖励并移出，过期的记失败并移出。奖励由调用方落到 legacy 存档里。 */
export function settle(state: ContractsState, snap: Snap): SettleResult {
  const completed: { title: string; reward: ContractReward }[] = [];
  const expired: { title: string }[] = [];
  const items: Record<string, number> = {};
  let matGain = 0;
  const keep: ActiveContract[] = [];
  for (const c of state.active) {
    const p = progressOf(c, snap);
    if (p.done) {
      completed.push({ title: c.title, reward: c.reward });
      matGain += c.reward.mat ?? 0;
      if (c.reward.item && c.reward.n) items[c.reward.item] = (items[c.reward.item] ?? 0) + c.reward.n;
      state.done++;
      state.log.push('第 ' + snap.day + ' 天完成委托：' + c.title);
    } else if (p.expired) {
      expired.push({ title: c.title });
      state.failed++;
      state.log.push('第 ' + snap.day + ' 天委托过期：' + c.title);
    } else keep.push(c);
  }
  state.active = keep;
  state.log = state.log.slice(-12);
  const messages = [
    ...completed.map(c => '✅ 委托完成：' + c.title + '（+' + (c.reward.mat ?? 0) + ' 材料' + (c.reward.item ? '、' + c.reward.item + '×' + (c.reward.n ?? 1) : '') + '）'),
    ...expired.map(c => '⌛ 委托过期：' + c.title),
  ];
  return { state, completed, expired, matGain, items, messages };
}

/** 换日：刷新板子（没接的报价作废），并返回新的一天的状态 */
export function refreshBoard(state: ContractsState, day: number, rng: () => number, mainStage = 0, opts: RollOpts = {}): ContractsState {
  state.day = day;
  state.board = rollOffers(day, rng, mainStage, opts);
  state.rolled = true;
  return state;
}

/** 存档校验/迁移：老档没有 contracts 字段就建一个空的。
 *  **原地修补**（不重建对象）：调用方常常握着这份状态的引用（S.contracts），
 *  重建对象会让它后续的写入落进孤儿对象——"换日刷了板子但存档里没变"就是这么来的
 *  （实测：S.day=6 后 newDay() 把板子写进了旧引用，S.contracts 还是第 1 天那张）。 */
export function ensureContracts(raw: unknown, day = 1): ContractsState {
  const s = raw as Partial<ContractsState> | undefined;
  if (!s || typeof s !== 'object' || !Array.isArray((s as ContractsState).board)) return emptyContracts(day);
  const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  s.day = num(s.day, day);
  s.board = Array.isArray(s.board) ? s.board.filter(o => o && typeof o.key === 'string' && typeof o.title === 'string') : [];
  s.active = Array.isArray(s.active) ? s.active.filter(a => a && typeof a.id === 'string' && typeof a.metric === 'string') : [];
  s.done = num(s.done); s.failed = num(s.failed);
  s.log = Array.isArray(s.log) ? s.log.filter(x => typeof x === 'string').slice(-12) : [];
  s.rolled = !!s.rolled;
  /* 老档/被改坏的档：期限和基线补齐，避免 NaN 一路传到 UI */
  for (const a of s.active) {
    a.need = Math.max(1, num(a.need, 1));
    a.baseline = num(a.baseline);
    a.acceptedDay = num(a.acceptedDay, s.day);
    a.deadlineDay = num(a.deadlineDay, a.acceptedDay + 3);
    if (!a.reward || typeof a.reward !== 'object') a.reward = { mat: 5 };
  }
  return s as ContractsState;
}

/** 委托板文案（UI/日志共用；纯字符串，方便测试） */
export function offerLine(o: BoardOffer, snap?: Snap): string {
  const p = snap ? metricNow(o.metric, snap) : 0;
  return o.title + '（' + metricLabel(o.metric) + ' ×' + o.need + '，' + o.days + ' 天内' +
    (p >= o.need ? '，条件已满足' : '') + '）';
}

/** 已接委托文案 */
export function activeLine(c: ActiveContract, snap: Snap): string {
  const p = progressOf(c, snap);
  return c.title + ' ' + p.current + '/' + p.need + '（剩 ' + Math.max(0, p.daysLeft) + ' 天）';
}

/** 供 UI 显示的"目标区域"提示：跨区且没车就直说 */
export function regionHint(c: { region?: string }, curRegion: string, hasVehicle: boolean): string {
  if (!c.region || c.region === curRegion) return '';
  const name = regionName(c.region);
  return hasVehicle ? '目标在' + name + '（开车过去）' : '目标在' + name + '——没车到不了，先去弄辆车';
}

/** 区域表给 UI 用（避免 UI 再 import 一次 regions-core） */
export const regionList = () => REGIONS.map(r => ({ id: r.id, name: r.name, tier: r.tier }));
