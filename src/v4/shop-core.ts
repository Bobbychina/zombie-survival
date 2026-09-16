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

/* ── M39：批量购买 ──────────────────────────────────────────────
   玩家一天要补几十发子弹，点十几次"购买"很烦。这里把"能买几次"算清楚：
   同时受 材料 / 今日库存 / 单次上限（99，防手滑把材料全砸进去）三条约束，
   并把"为什么买不到你要的次数"翻译成人话（材料只够 N 份 / 今天只剩 N 份）。 */
export interface BuyPlan {
  /** 实际成交份数 */
  times: number;
  /** 每份价格（已含汇率） */
  each: number;
  /** 总价 = each × times */
  total: number;
  /** 在当前材料/库存下最多能买几份（UI 用来写"买满×N"） */
  max: number;
  /** 买不满时的原因（买满时不填） */
  reason: string;
}

export function buyPlan(row: ShopRow, rate: number, mat: number, left: number, want: number | 'max'): BuyPlan {
  const each = shopPrice(row, rate);
  const stock = Math.max(0, Math.floor(Number(left) || 0));
  const money = Math.max(0, Math.floor(Number(mat) || 0));
  const afford = Math.floor(money / each);
  const max = Math.max(0, Math.min(stock, afford, 99));
  const wantN = want === 'max' ? max : Math.max(0, Math.floor(Number(want) || 0));
  const times = Math.min(wantN, max);
  let reason = '';
  if (stock <= 0) reason = '这件货今天卖完了。';
  else if (afford <= 0) reason = '材料不够（一份要 ' + each + '）。';
  else if (times < wantN) {
    reason = '只能买 ' + times + ' 份：' + (times === stock ? '今天只剩 ' + stock + ' 份。' : '材料只够 ' + afford + ' 份。');
  }
  return { times, each, total: each * times, max, reason };
}

/* ── M44：把多余的东西卖回给商人 ──────────────────────────────────
   用户：「可以让用户将自己的多余物品出售给商人（收购价格比购买价格更低）」。
   三条已确认的口径：
     ① 回收价 = **买价的 45%**（与营地 npc.sellPrice 同一个数，一个是 45% 就到处是 45%）；
     ② 除了剧情道具与身上穿/手里拿的，**什么都能卖**（掉落物、制作物也都收 —— 不然"多余"两个字没意义）；
     ③ 批量出售要**二次确认**（材料不可逆，手滑清空背包代价太大）。
   死守一条不变量：**一批货卖回去的钱一定少于买进来**（单测钉死），否则商人就成了刷材料机。 */
export const SELL_RATE = 0.45;

/** 剧情/撤离道具：卖了主线就断（门禁卡 → 实验室、数据 → 真配方、解药 → 结局、信号枪 → 撤离） */
export const NO_SELL: string[] = ['keycard', 'data', 'cure', 'flare'];

/** 每件原价（= 商人卖给玩家的价，不含汇率）。**货架行的价自动从货架推**（见 ITEM_BASE），
    免得以后调货架价时这里忘了跟；其余是掉落/采集/制作出来的东西，按有用程度定价。 */
const LOOT_BASE: Record<string, number> = {
  /* 食物 / 饮水 */
  biscuit: 8, jerky: 7, choco: 9, dirty: 3, cola: 7,
  veg: 8, stew: 16, rot: 2, berry: 6, meat: 7, cooked: 14, mushroom: 5, grain: 4, dried: 11, pickle: 12, fish: 9, fish_cooked: 15,
  /* 医疗 */
  bandage: 9, painkiller: 12, serum: 45, antitoxin: 14, burncream: 8, suture: 14, surgerykit: 30,
  antiseptic: 10, iodine: 12, radaway: 22, splint: 8, nurse_kit: 60, purify: 6,
  /* 材料 */
  cloth: 4, metal: 6, tape: 5, powder: 6, wood: 4, chip: 8, chem: 7, fuel: 9, bottle: 3,
  seed_veg: 4, seed_grain: 5, rod: 10, bait: 3, o2: 12,
  /* 装备 */
  geiger: 34, vest: 45, helmet: 35, boots: 30, backpack: 40, hygro: 25, wetsuit: 55, hunter_charm: 40,
  /* 武器 / 投掷物 */
  crowbar: 18, axe: 65, pistol: 90, rifle: 170, hk_m14: 260, molotov: 28, smoke: 20,
};

/** 货架每行的"每件原价" = 标价 ÷ 份数（货架改价这里自动跟上，单测再钉一次同步性） */
const shelfBase = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of MERCHANT_GOODS) out[r.id] = r.cost / (r.n || 1);
  return out;
};

/** 原价表：**货架的价永远压过手写价**（同一件东西两边都写了的话，以货架为准 → 回收价必然低于卖价） */
export const ITEM_BASE: Record<string, number> = { ...LOOT_BASE, ...shelfBase() };

/** 兜底价：新加的物品就算忘了进表也能卖，价格由类型兜底（不会出现"值 0 材料"或天价） */
const TYPE_BASE: Record<string, number> = { food: 8, drink: 7, med: 16, mat: 5, ammo: 3, thr: 20, wpn: 40, gear: 30 };

export interface SellItem { t?: string; unique?: boolean }

/** 为什么不能卖（空串 = 能卖）。UI 只显示"能卖的"，这个函数同时给探针/单测当判据 */
export function sellBlockReason(
  id: string,
  items: Record<string, SellItem | undefined>,
  equipped: string[] = [],
): string {
  const it = items[id];
  if (!it) return '这东西不在物品表里，他不收。';
  if (it.t === 'key') return '这是主线的命根子，他不收。';
  if (NO_SELL.indexOf(id) >= 0) return '这件卖了你再也拿不回来，他不收。';
  if (it.unique) return '独一份的东西（同伴给的），卖了就没了 —— 他不收。';
  if (equipped.indexOf(id) >= 0) return '正拿在手里／穿在身上，先卸下来再卖。';
  return '';
}

/** 能不能卖（剧情道具、独一份、身上穿的都不行） */
export const canSell = (id: string, items: Record<string, SellItem | undefined>, equipped: string[] = []): boolean =>
  sellBlockReason(id, items, equipped) === '';

/** 每件原价：表里有就用表里的，没有就按类型兜底 */
export function baseValueOf(id: string, items: Record<string, SellItem | undefined> = {}): number {
  const hit = ITEM_BASE[id];
  if (hit > 0) return hit;
  return TYPE_BASE[items[id]?.t || ''] || 10;
}

/** 卖 k 件的总回收价：一批只取一次整（免得"一件件卖"比"整叠卖"多赚），且每笔至少 1 材料 */
export function sellValue(id: string, k: number, rate = 1, items: Record<string, SellItem | undefined> = {}): number {
  const n = Math.max(0, Math.floor(Number(k) || 0));
  if (!n) return 0;
  const raw = baseValueOf(id, items) * SELL_RATE * (rate > 0 ? rate : 1) * n;
  return Math.max(1, Math.floor(raw));
}

export interface SellPlan {
  /** 实际卖几件 */
  times: number;
  /** 每件回收价（UI 上写「+N」） */
  each: number;
  /** 总收入（整批取整，不一定等于 each × times） */
  total: number;
  /** 背包里最多能卖几件 */
  max: number;
  /** 卖不了/卖不满的原因（卖满时不填） */
  reason: string;
}

/** 卖东西的方案：UI 与结算都走它 —— 校验（能不能卖／有几件）只有这一处 */
export function sellPlan(
  id: string,
  want: number | 'max',
  ctx: { have: number; rate?: number; items?: Record<string, SellItem | undefined>; equipped?: string[] },
): SellPlan {
  const items = ctx.items || {};
  const have = Math.max(0, Math.floor(Number(ctx.have) || 0));
  const each = sellValue(id, 1, ctx.rate ?? 1, items);
  const block = sellBlockReason(id, items, ctx.equipped || []);
  const wantN = want === 'max' ? have : Math.max(0, Math.floor(Number(want) || 0));
  const times = block ? 0 : Math.min(wantN, have);
  let reason = block;
  if (!reason && have <= 0) reason = '背包里没有这件东西。';
  else if (!reason && times < wantN) reason = '背包里只有 ' + have + ' 件。';
  return { times, each, total: sellValue(id, times, ctx.rate ?? 1, items), max: block ? 0 : have, reason };
}

export interface SellBatch {
  /** 能卖的物品 id（已按"能卖"过滤） */
  ids: string[];
  /** 一共几件 */
  items: number;
  /** 一共能换多少材料 */
  total: number;
}

/** 批量出售（"把这一类全卖"）的合计：给二次确认弹窗与结算共用，省得两处算法不一致 */
export function sellBatchPlan(
  ids: string[],
  inv: Record<string, number | undefined>,
  ctx: { rate?: number; items?: Record<string, SellItem | undefined>; equipped?: string[] } = {},
): SellBatch {
  const out: SellBatch = { ids: [], items: 0, total: 0 };
  for (const id of ids || []) {
    const p = sellPlan(id, 'max', { have: inv?.[id] || 0, rate: ctx.rate, items: ctx.items, equipped: ctx.equipped });
    if (!p.times) continue;
    out.ids.push(id); out.items += p.times; out.total += p.total;
  }
  return out;
}
