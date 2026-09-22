/* M71 · 商人好感度与解锁（用户：「商人系统你不如参考塔科夫的好感度/做任务解锁购买特定道具」）
 *
 *  塔科夫那套的三根支柱，这里一根不少：
 *    ① **好感度（reputation）**：买卖、做委托都会涨；委托过期/放弃会掉。好感度是"你跟他熟不熟"。
 *    ② **忠诚等级（LL1~4）**：好感度到线就升档，档位决定**能买什么**（弹药穿甲弹这类只给熟人），
 *       而且每档还有一点点折扣（塔科夫是 LL 越高越便宜）。
 *    ③ **委托解锁**：有些货不看你多有礼貌，只看你替他办过几件事 —— `quests: n` = 完成过 n 张委托才卖。
 *
 *  设计口径（写下来免得以后自己跑偏）：
 *    - 好感度只**涨得慢、掉得快**：一笔买卖 1~3 点，一张委托 25 点，一张委托过期 -12 点 ——
 *      "熟客"是一天天攒出来的，不是刷两笔就满。
 *    - 门槛只**锁货，不锁价**：买不到就是买不到（按钮禁用 + 写清差多少），不搞"熟人税"。
 *    - 所有判定都是纯函数：legacy 只负责把 `rep/stats/stage` 传进来、把结果画出来。
 */

export interface TraderDef {
  id: string;
  name: string;
  icon: string;
  tag: string;
  /** 要不要先架起无线电才联系得上（军需官那条线） */
  needRadio?: boolean;
}
export const TRADERS: TraderDef[] = [
  { id: 'peddler', name: '神秘商人', icon: '🏪', tag: '流浪商人：什么都卖一点，货源看运气。' },
  { id: 'quarter', name: '军需官', icon: '🎖️', tag: '只跟熟人做生意：先架起无线电，再谈好感。', needRadio: true },
];
export const traderOf = (id: string): TraderDef | undefined => TRADERS.find(t => t.id === id);

export interface LLTier { lv: number; rep: number; name: string; discount: number }
/** 忠诚档位：好感度到线就升档；折扣按档给（买价 ×(1-discount)） */
export const LL_TIERS: LLTier[] = [
  { lv: 1, rep: 0, name: '陌生人', discount: 0 },
  { lv: 2, rep: 120, name: '熟人', discount: 0.05 },
  { lv: 3, rep: 320, name: '老主顾', discount: 0.1 },
  { lv: 4, rep: 700, name: '自己人', discount: 0.16 },
];

export interface Loyalty { lv: number; name: string; discount: number; next: LLTier | null; progress: number; toNext: number }
/** 当前档位 + 到下一档还差多少（UI 那根进度条与探针共用一份口径） */
export function loyaltyOf(rep: number): Loyalty {
  const r = Math.max(0, Number(rep) || 0);
  let cur = LL_TIERS[0], next: LLTier | null = null;
  for (const t of LL_TIERS) { if (r >= t.rep) cur = t; else { next = t; break; } }
  const span = next ? next.rep - cur.rep : 0;
  const progress = next ? Math.max(0, Math.min(1, (r - cur.rep) / span)) : 1;
  return { lv: cur.lv, name: cur.name, discount: cur.discount, next, progress, toNext: next ? Math.max(0, next.rep - r) : 0 };
}
/** 买价倍率：越高档越便宜（汇率在 legacy 那边另外算，这里只给"熟人折扣"） */
export const priceMulOf = (rep: number): number => 1 - loyaltyOf(rep).discount;

export interface GateRow { trader?: string; ll?: number; quests?: number; needRadio?: boolean; id?: string }
export interface GateCtx {
  rep: number;
  /** 完成过的委托张数（stats.bounties） */
  bounties: number;
  /** 是否已经架起无线电（S.base.radio > 0） */
  radio: boolean;
}
/** 能不能买：返回空串 = 能买；否则是"为什么买不了"（直接给玩家看） */
export function gateReason(row: GateRow, ctx: GateCtx): string {
  const t = traderOf(row.trader || 'peddler');
  if (!t) return '没有这个商人';
  if (t.needRadio && !ctx.radio) return '🔒 还没架起无线电：联系不上' + t.name;
  const need = row.ll || 1;
  const have = loyaltyOf(ctx.rep).lv;
  if (have < need) {
    const tier = LL_TIERS.find(x => x.lv === need);
    return '🔒 好感不够：要 ' + (tier ? tier.name + '（LL' + need + '，好感 ' + tier.rep + '）' : 'LL' + need) +
      '；你现在 ' + loyaltyOf(ctx.rep).name + '（好感 ' + Math.max(0, Math.round(ctx.rep)) + '）';
  }
  if (row.quests && ctx.bounties < row.quests) {
    return '🔒 信任不够：先替他办 ' + row.quests + ' 张委托（当前 ' + ctx.bounties + ' 张）';
  }
  return '';
}

/* ── 好感度怎么变 ── */
/** 卖东西：按成交材料价值给（1 点 / 20 材料，单笔最多 3 点 —— 别让人靠卖垃圾刷满） */
export const repForSell = (matValue: number): number =>
  Math.max(1, Math.min(3, Math.floor(Math.max(0, matValue) / 20)));
/** 买东西：按花的材料给（1 点 / 60 材料，单笔最多 2 点） */
export const repForBuy = (matCost: number): number =>
  Math.max(1, Math.min(2, Math.floor(Math.max(0, matCost) / 60)));
/** 完成一张委托：主要来源（塔科夫也是做任务涨得最多） */
export const repForBounty = (n = 1): number => 25 * Math.max(0, Math.floor(n));
/** 委托过期 / 放弃：掉得比涨得快 */
export const repForExpire = (n = 1): number => -12 * Math.max(0, Math.floor(n));
/** 好感度夹取：不能是负的，也别让它溢出（9999 够用） */
export const clampRep = (v: number): number => Math.max(0, Math.min(9999, Math.round(Number(v) || 0)));

/** 给 UI 的一行总结："🏪 神秘商人 · 熟人（好感 140/320 · 下一档还差 180）" */
export function traderLine(id: string, rep: number): string {
  const t = traderOf(id);
  if (!t) return '';
  const l = loyaltyOf(rep);
  return t.icon + ' ' + t.name + ' · ' + l.name + '（好感 ' + Math.max(0, Math.round(rep)) +
    (l.next ? '/' + l.next.rep + ' · 下一档还差 ' + l.toNext : ' · 已满档') + '）';
}
