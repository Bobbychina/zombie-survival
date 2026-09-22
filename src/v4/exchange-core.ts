/* M70 · 回收台（用户："藏身处太单调，耗材单一且难找，通关了都造不出几个"）——
   审计发现的核心病根：**全世界产量最大的通用「材料」完全不能用于建造**。
   建造吃 8 种物品（木料/铁片/布/胶带/芯片/化学品/汽油/罐头），其中芯片、化学品、汽油、胶带
   每件的获取成本是 12~27 点行动力（来源只有少数几个 POI 的掉落表），而拆解/快搜随手就是 3.5~6 点材料/AP。
   于是"材料"变成了只能买车、抢修防线、找商人换东西的**半废货币**，据点却永远差料。

   回收台把这条断链接上：交点材料，把废品拆成建材。数值口径（按 AP 经济定）：
     - 材料基准产出 ≈ 6/AP（快搜材料档）→ 1 材料 ≈ 0.17 AP
     - 各行的汇率让"换建材"比"跑图找建材"更划算，但**不能无限换**（每天有额度，得靠工作台升级才能开）
     - 硬骨头（芯片/化学品）额度小，仍然鼓励去危险区搜刮；兑换只是保底，不是替代 */
export interface ExRow {
  /** 产出物品 id（与 legacy ITEMS 对齐） */
  id: string;
  /** 一份要多少通用材料 */
  cost: number;
  /** 一次换几件 */
  n: number;
  /** 每天最多换几份 */
  cap: number;
  /** 为什么这样换（写给玩家看的一句） */
  why: string;
}

export const EXCHANGE_ROWS: ExRow[] = [
  { id: 'wood',  cost: 3,  n: 1, cap: 12, why: '把家具、托盘、窗框劈成木料' },
  { id: 'metal', cost: 6,  n: 1, cap: 8,  why: '熔掉铁皮、钢筋头，铸成能用的铁片' },
  { id: 'cloth', cost: 4,  n: 1, cap: 8,  why: '旧窗帘、沙发套洗净剪开就是布' },
  { id: 'tape',  cost: 8,  n: 1, cap: 4,  why: '回收旧胶带（粘性差一点，但能粘住）' },
  { id: 'chem',  cost: 12, n: 1, cap: 4,  why: '从清洁剂、农药、蓄电池里提炼化学品' },
  { id: 'fuel',  cost: 10, n: 1, cap: 3,  why: '从废弃车油箱里抽出来的混油（能烧）' },
  { id: 'chip',  cost: 14, n: 1, cap: 3,  why: '拆旧电器里的电路板——据点里唯一稳定的芯片来源' },
];

/** 工作台到几级才能开回收台（Lv1：有了工具与台面才谈得上拆解） */
export const EX_MIN_BENCH = 1;
/** 工作台每高一级，所有额度 +1（升级工作台从此也有第二重收益） */
export const exCapBonus = (benchLv: number): number => Math.max(0, Math.floor(benchLv) - EX_MIN_BENCH);

export interface ExState { day: number; used: Record<string, number> }
export const rowOf = (id: string): ExRow | undefined => EXCHANGE_ROWS.find(r => r.id === id);

/** 今天已经换过几份（跨天自动清零） */
export function exUsedToday(ex: ExState | null | undefined, day: number): Record<string, number> {
  if (!ex || ex.day !== day || !ex.used || typeof ex.used !== 'object') return {};
  const out: Record<string, number> = {};
  for (const k in ex.used) { const n = Math.floor(Number(ex.used[k])); if (isFinite(n) && n > 0) out[k] = n; }
  return out;
}

/** 这一行今天还能换几份（受额度与手上材料双重限制；材料不够时给"差多少"） */
export function exAfford(row: ExRow, o: { mat: number; used: number; benchLv: number }): { max: number; short: number; why: string } {
  if (o.benchLv < EX_MIN_BENCH) return { max: 0, short: 0, why: '要先建工作台（Lv' + EX_MIN_BENCH + '）才能开回收台' };
  const cap = row.cap + exCapBonus(o.benchLv);
  const left = Math.max(0, cap - Math.max(0, Math.floor(o.used)));
  if (left <= 0) return { max: 0, short: 0, why: '今天的额度用完了（明天再来，或升级工作台 +1 额度）' };
  const byMat = Math.floor(Math.max(0, o.mat) / row.cost);
  if (byMat <= 0) return { max: 0, short: row.cost - Math.max(0, Math.floor(o.mat)), why: '材料还差 ' + (row.cost - Math.max(0, Math.floor(o.mat))) + ' 点' };
  return { max: Math.min(left, byMat), short: 0, why: '' };
}

/** 汇总一行给 UI：今天换了几份 / 上限多少 / 材料够不够 */
export function exLine(row: ExRow, o: { mat: number; used: number; benchLv: number }): { used: number; cap: number; can: number; why: string } {
  const cap = row.cap + exCapBonus(o.benchLv);
  const aff = exAfford(row, o);
  return { used: Math.max(0, Math.floor(o.used)), cap, can: aff.max, why: aff.why };
}
