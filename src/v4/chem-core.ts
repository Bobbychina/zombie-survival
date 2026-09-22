/* M72 · 化学品转化链（用户口径：工业区搜到的基础化学品 → 医疗台/弹药台 → 抗生素 / 爆炸物）。
 *
 *  为什么要有这一层：`chem`（化学药剂）在 M70 之前的定位很尴尬 —— 它只出现在少数 POI 的掉落表里
 *  （工业区/地铁/军方，单件获取成本 12~27 AP），却又是医疗台与弹药台**多半个配方表的必需品**。
 *  于是它成了"捡到就攒着、攒着又舍不得用"的死材料。M72 把这条链接成一条**看得见的产线**：
 *
 *    工业区（chem） ──→ ⚗️ 医疗台 ──→ 抗生素 / 消毒剂
 *                    └→ 🔩 弹药台 ──→ 手雷 / 5.56 穿甲弹
 *
 *  三条硬规则（都由单测与探针钉住，别在 legacy 里绕过这里自己算）：
 *    ① **配方在表里**：每行写清 投入（need）/ 产出（out × n）/ 站点等级（lv）/ 当天产能（cap）；
 *    ② **不与制作页抢口径**：同一件成品的投入产出必须与 legacy `RECIPES` 里那行**完全一致**
 *       （anti 就是 chem2+chip1 → 1），M72 给的是"据点里一条产线 + 每日产能"，不是第二套数值。
 *       弹药台的两行是**另一条路线**（用化学品替掉芯片/胶带），按商人估价严格亏，不构成套利；
 *    ③ **材料守恒**：任何一行的产出价值 ≤ 投入价值，且**没有任何一行的产出会回流成另一行的投入**
 *       （chemAudit / chemCycle 两条判据）—— 没有"投入 1 产出 2 再投入"的环。
 *
 *  产能上限的写法刻意与 M70 回收台同构（`cap` + 站点等级加成 + 当日 `used`，跨天清零），
 *  这样 sanitizeSave 的白名单、探针的读法、玩家的心智模型三边一致。
 */
export type ChemStation = 'medlab' | 'loading';

export interface ChemStationDef { icon: string; name: string; /** 这个台子在说什么 */ desc: string }

/** 两个台子的名字/图标只在这里写一份（legacy 渲染与探针都读它，避免两处各写一套） */
export const CHEM_STATIONS: Record<ChemStation, ChemStationDef> = {
  medlab:  { icon: '⚗️', name: '医疗台', desc: '把化学品与净水/元件配成抗生素、消毒剂这类成品药。' },
  loading: { icon: '🔩', name: '弹药台', desc: '把化学品与火药/铁片装成爆炸物与穿甲弹（比复装贵一点，但不吃芯片）。' },
};

export interface ChemRow {
  /** 行 id（= 产出 id；也是 chemUsed 的键，必须唯一） */
  id: string;
  /** 在哪个台子上做 */
  st: ChemStation;
  /** 产出物品 id（必须存在于 legacy ITEMS） */
  out: string;
  /** 一次产出几件 */
  n: number;
  /** 投入：物品 id → 件数（至少一件化学品当主料，这是"化学品转化链"的定义） */
  need: Record<string, number>;
  /** 每天的产能上限（份数），会再叠站点等级加成 */
  cap: number;
  /** 站点等级门槛（与 legacy RECIPES 的 lv 同口径） */
  lv: number;
  /** 为什么这样换（写给玩家看的一句） */
  why: string;
}

/** 配方表：**唯一真值**。改数值只改这里。 */
export const CHEM_ROWS: ChemRow[] = [
  /* ── ⚗️ 医疗台：化学品 → 药 ── */
  {
    id: 'anti', st: 'medlab', out: 'anti', n: 1, need: { chem: 2, chip: 1 }, cap: 3, lv: 2,
    why: '抗生素：化学品做母核、电子元件里的铂丝当催化剂 —— 工业化那一套在废墟里也能凑出来。',
  },
  {
    id: 'antiseptic', st: 'medlab', out: 'antiseptic', n: 2, need: { chem: 2, water: 1 }, cap: 4, lv: 1,
    why: '消毒剂：稀释过的化学品，清创时用来冲洗感染伤口（比酒精稳，不烧肉）。',
  },
  /* ── 🔩 弹药台：化学品 → 爆炸物 / 弹药 ── */
  {
    id: 'grenade', st: 'loading', out: 'grenade', n: 1, need: { chem: 2, powder: 3, metal: 1 }, cap: 2, lv: 2,
    why: '手雷：化学品处理过的装药更钝感，能塞进铁壳里当破片弹（少一层胶带，多两份化学品）。',
  },
  {
    id: 'a556_ap', st: 'loading', out: 'a556_ap', n: 8, need: { chem: 2, powder: 4, metal: 3 }, cap: 2, lv: 2,
    why: '5.56 穿甲弹 ×8：化学品腐蚀出钢芯的硬度 —— 没有芯片也能攒出打装甲的弹（芯片留给更贵的弹种）。',
  },
];

export const chemRowsOf = (st: ChemStation): ChemRow[] => CHEM_ROWS.filter(r => r.st === st);
export const chemRow = (id: string): ChemRow | undefined => CHEM_ROWS.find(r => r.id === id);

/** 站点每高一级，该台**所有**行的产能 +1（升级医疗台/弹药台从此有第二重收益，与 M70 回收台同一套写法） */
export const chemCapBonus = (row: ChemRow, stLv: number): number => Math.max(0, Math.floor(stLv) - row.lv);
/** 这一行今天的产能上限 */
export const chemCapOf = (row: ChemRow, stLv: number): number => Math.max(0, row.cap + chemCapBonus(row, stLv));

export interface ChemState { day: number; used: Record<string, number> }

/** 今天已经做过几份（跨天自动清零；脏数据一律当 0） */
export function chemUsedToday(st: ChemState | null | undefined, day: number): Record<string, number> {
  if (!st || st.day !== day || !st.used || typeof st.used !== 'object') return {};
  const out: Record<string, number> = {};
  for (const k in st.used) { const n = Math.floor(Number(st.used[k])); if (isFinite(n) && n > 0) out[k] = n; }
  return out;
}

export interface ChemShort { id: string; need: number; have: number; short: number }
export interface ChemAfford { max: number; short: ChemShort[]; why: string }
export interface ChemOpts { inv: Record<string, number>; used: number; stLv: number }

/** 材料缺口（缺什么、缺几件），UI 只负责把 id 翻成中文名 */
export function chemMissing(row: ChemRow, inv: Record<string, number>, times = 1): ChemShort[] {
  return Object.keys(row.need).map(id => {
    const need = row.need[id] * Math.max(1, Math.floor(times) || 1);
    const have = Math.max(0, Math.floor(Number(inv[id]) || 0));
    return { id, need, have, short: Math.max(0, need - have) };
  }).filter(x => x.short > 0);
}

/** 这一行今天还能做几份（受"站点等级 × 当天产能 × 手上材料"三重限制） */
export function chemAfford(row: ChemRow, o: ChemOpts): ChemAfford {
  const st = CHEM_STATIONS[row.st];
  const stLv = Math.max(0, Math.floor(o.stLv) || 0);
  if (stLv < row.lv) {
    return { max: 0, short: [], why: stLv <= 0
      ? '要先建' + st.name + '（据点 → 建设）才能开工'
      : st.name + '等级不够：需要 Lv.' + row.lv + '，现在 Lv.' + stLv };
  }
  const cap = chemCapOf(row, stLv);
  const left = Math.max(0, cap - Math.max(0, Math.floor(o.used) || 0));
  if (left <= 0) return { max: 0, short: [], why: '今天的产能用完了（明天回满，或升级' + st.name + ' +1 产能）' };
  /* 按最紧的那件材料算能做几份（一次做多份时缺一件就整体做不了） */
  let byMat = left;
  for (const id of Object.keys(row.need)) byMat = Math.min(byMat, Math.floor(Math.max(0, Math.floor(Number(o.inv[id]) || 0)) / row.need[id]));
  if (byMat <= 0) return { max: 0, short: chemMissing(row, o.inv), why: '' };
  return { max: Math.min(left, byMat), short: [], why: '' };
}

/** 汇总一行给 UI：今天做了几份 / 产能上限 / 还能做几份 / 为什么做不了 */
export function chemLine(row: ChemRow, o: ChemOpts): { used: number; cap: number; can: number; why: string; short: ChemShort[] } {
  const aff = chemAfford(row, o);
  return {
    used: Math.max(0, Math.floor(o.used) || 0),
    cap: chemCapOf(row, Math.max(0, Math.floor(o.stLv) || 0)),
    can: aff.max, why: aff.why, short: aff.short,
  };
}

/** 结算一批（纯函数）：把 times 夹到"材料够得着"的份数，返回**要扣什么、要给什么**。
 *  legacy 只负责把 take 交给 takeItem、把 give 交给 grant —— 账目因此只有一份真值。 */
export function chemBatch(row: ChemRow, times: number, inv: Record<string, number>): { times: number; take: Record<string, number>; give: Record<string, number> } {
  let n = Math.max(0, Math.floor(Number(times) || 0));
  for (const id of Object.keys(row.need)) {
    n = Math.min(n, Math.floor(Math.max(0, Math.floor(Number(inv[id]) || 0)) / row.need[id]));
  }
  const take: Record<string, number> = {}, give: Record<string, number> = {};
  if (n > 0) {
    for (const id of Object.keys(row.need)) take[id] = row.need[id] * n;
    give[row.out] = row.n * n;
  }
  return { times: n, take, give };
}

/* ── 两条"不许套利"的判据（单测用；也挂给探针，改表时当场知道哪行破了规矩） ────────── */

/** 每件的**获取成本当量**（以行动力为尺：搜一趟工业区 ≈ 8~10 AP 拿到 2~3 份化学品 → 5 AP/份，
 *  电子元件要拆旧电器所以更贵，铁片/木料拆解就有一大堆所以便宜）。
 *  为什么不用商人标价：商人卖弹药卖到 9 材料/发，按标价量连 legacy 的复装配方都是"赚的" ——
 *  那条尺子在这里量不出套利，只有**获取成本**能量出"投入 1 能不能产出 2"。
 *  成品也登记在这张表里（值 = 造它大概要多少当量），没登记的会被 chemAudit 列进 unpriced。 */
export const CHEM_COST: Record<string, number> = {
  /* 原料 */
  chem: 5, chip: 6, powder: 3, metal: 1.5, tape: 1.5, water: 1, cloth: 1, wood: 1, fuel: 4, bottle: 1,
  /* 成品（只出现在产出侧） */
  anti: 12, antiseptic: 5, grenade: 12, a556_ap: 0.3,
};

export const chemCostOf = (id: string): number => CHEM_COST[id] || 0;

/** 产出成本 − 投入成本：> 0 就是"做出来比材料还难搞"（可套利），必须 ≤ 0。
 *  @param costOf 每件的获取成本当量（默认 CHEM_COST；测试可换成商人价做交叉核对） */
export function chemAudit(rows: ChemRow[] = CHEM_ROWS, costOf: (id: string) => number = chemCostOf):
{ id: string; inValue: number; outValue: number; ok: boolean; unpriced: string[] }[] {
  return rows.map(r => {
    const unpriced: string[] = [];
    let inValue = 0, outValue = 0;
    for (const id of Object.keys(r.need)) {
      const v = costOf(id) || 0;
      if (!v) unpriced.push(id);
      inValue += v * r.need[id];
    }
    const ov = costOf(r.out) || 0;
    if (!ov) unpriced.push(r.out);
    outValue = ov * r.n;
    return { id: r.id, inValue, outValue, ok: outValue <= inValue, unpriced };
  });
}

/** 找"投入→产出"的环：任一行的产出若能经别的行再变回它自己的投入，就是套利环。
 *  @returns 环上的 id 序列（无环返回 null） */
export function chemCycle(rows: ChemRow[]): string[] | null {
  /* 图的边：投入物品 → 产出物品（同一行内）。从每行的产出出发看能不能走回它的任一投入。 */
  const edges: Record<string, string[]> = {};
  for (const r of rows) for (const inp of Object.keys(r.need)) (edges[inp] = edges[inp] || []).push(r.out);
  const seen = new Set<string>();
  const walk = (node: string, path: string[]): string[] | null => {
    if (path.indexOf(node) >= 0) return path.slice(path.indexOf(node)).concat(node);
    if (seen.has(node)) return null;
    seen.add(node);
    for (const nxt of edges[node] || []) { const hit = walk(nxt, path.concat(node)); if (hit) return hit; }
    return null;
  };
  for (const r of rows) { const hit = walk(r.out, []); if (hit) return hit; }
  return null;
}
