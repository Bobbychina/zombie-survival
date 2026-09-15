/**
 * M32b 商人货架（纯数据 + 兜底校验，legacy 与 v4 营地共用）。
 *
 * 为什么把货架搬到这里：用户报的 bug 是「商人卖的子弹还是旧版，没有各种不同的子弹卖！
 * 买了子弹相当于吞材料！！」——根因是货架上还写着 M25 之前的伪 id `ammo`：
 *   ① 商人只有笼统的"子弹"一件，看不到口径/弹种；
 *   ② 成交走 `grant('ammo')`，而它只加到 `S.ammo` 这个**镜像**上（开一枪就被覆写）→ 材料花了、包里没有弹。
 * 现在弹药按**口径 + 弹种**卖（穿甲弹更贵、量更少），并且成交前必须过 `badShopRows()`
 * ——id 不在 ITEMS 里的一律不许扣材料（同一个坑不许再踩第三次）。
 */

export interface ShopRow {
  id: string;
  n?: number;
  cost: number;
  stock?: number;
  /** 货架分组（商人弹窗按这个分段显示）；缺省 = 物资与装备 */
  sec?: 'ammo';
}

export const MERCHANT_GOODS: ShopRow[] = [
  /* ── 弹药：按口径/弹种卖（M25 的口径表 c9/c12/c556/c762/c308） ── */
  { id: 'a9_fmj',   n: 15, cost: 28, stock: 3, sec: 'ammo' },   // 9mm FMJ：最便宜的入门弹
  { id: 'a12_buck', n: 10, cost: 26, stock: 2, sec: 'ammo' },   // 12 号鹿弹：量大，穿透几乎为零
  { id: 'a556_fmj', n: 12, cost: 34, stock: 2, sec: 'ammo' },
  { id: 'a762_fmj', n: 12, cost: 34, stock: 2, sec: 'ammo' },
  { id: 'a12_slug', n: 8,  cost: 42, stock: 1, sec: 'ammo' },   // 独头弹：能打穿薄钢板
  { id: 'a9_ap',    n: 8,  cost: 46, stock: 2, sec: 'ammo' },   // 穿甲弹起步价
  { id: 'a308_m',   n: 6,  cost: 58, stock: 1, sec: 'ammo' },
  { id: 'a556_ap',  n: 8,  cost: 72, stock: 1, sec: 'ammo' },
  { id: 'a762_ap',  n: 8,  cost: 74, stock: 1, sec: 'ammo' },
  { id: 'a308_ap',  n: 5,  cost: 92, stock: 1, sec: 'ammo' },   // 目前能打穿一切的东西，最贵
  /* ── 物资与装备（M25 之前就在卖的那些，价格一个没动） ── */
  { id: 'medkit',   cost: 34,  stock: 2 },
  { id: 'can',      n: 3, cost: 22, stock: 2 },
  { id: 'water',    n: 3, cost: 22, stock: 2 },
  { id: 'anti',     n: 2, cost: 30, stock: 1 },
  { id: 'gasmask',  cost: 70,  stock: 1 },
  { id: 'hazmat',   cost: 120, stock: 1 },
  { id: 'kevlar',   cost: 110, stock: 1 },
  { id: 'grenade',  n: 2, cost: 60, stock: 1 },
  { id: 'machete',  cost: 60,  stock: 1 },
  { id: 'shotgun',  cost: 130, stock: 1 },
  { id: 'marksman', cost: 210, stock: 1 },
];

/** 弹药行（商人弹窗/探针要单独看一眼"有没有各种子弹"） */
export const ammoShopRows = (rows: ShopRow[] = MERCHANT_GOODS): ShopRow[] => rows.filter(r => r.sec === 'ammo');

/**
 * 兜底校验：货架坏行 = id 不在物品表里 / 数量或价格不是正数。
 * 成交**之前**必须调它——旧版就是"先扣材料、再 grant 一个不存在的 id"，玩家看到的是钱花了子弹没了。
 */
export function badShopRows(
  rows: ShopRow[],
  items: Record<string, { t?: string } | undefined>,
): ShopRow[] {
  return rows.filter(r => !r || typeof r.id !== 'string' || !items[r.id] || !(r.cost > 0) || (r.n !== undefined && !(r.n > 0)));
}

/** 打折后的成交价（商人汇率由 legacy 的 merchantRate() 给，这里只保证"不低于 1 材料"） */
export function shopPrice(row: ShopRow, rate: number): number {
  return Math.max(1, Math.round(row.cost * rate));
}
