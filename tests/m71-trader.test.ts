/* M71 商人好感度与解锁（用户：「商人系统你不如参考塔科夫的好感度/做任务解锁购买特定道具」）——
   好感度涨得慢掉得快、档位决定能买什么并给折扣、有些货要"替他办过 N 张委托"才卖。 */
import { describe, expect, it } from 'vitest';
import { MERCHANT_GOODS, badShopRows, shopPrice } from '../src/v4/shop-core';
import {
  LL_TIERS, TRADERS, clampRep, gateReason, loyaltyOf, priceMulOf, repForBounty, repForBuy, repForExpire, repForSell,
  traderLine, traderOf,
} from '../src/v4/trader-core';

const ctx = (over: Partial<{ rep: number; bounties: number; radio: boolean }> = {}) =>
  ({ rep: 0, bounties: 0, radio: false, ...over });
const row = (id: string) => MERCHANT_GOODS.find(r => r.id === id)!;

describe('M71 忠诚档位与折扣', () => {
  it('好感 0/120/320/700 对应 LL1~4，档位名与折扣照表', () => {
    expect(loyaltyOf(0).lv).toBe(1);
    expect(loyaltyOf(119).lv).toBe(1);
    expect(loyaltyOf(120).lv).toBe(2);
    expect(loyaltyOf(320).lv).toBe(3);
    expect(loyaltyOf(700).lv).toBe(4);
    expect(loyaltyOf(99999).lv).toBe(4);
    expect(loyaltyOf(700).next).toBeNull();
    expect(priceMulOf(0)).toBe(1);
    expect(priceMulOf(320)).toBeCloseTo(0.9, 5);
    expect(priceMulOf(700)).toBeCloseTo(0.84, 5);
  });
  it('进度条：到下一档的比例 + 还差多少', () => {
    const l = loyaltyOf(220);                    // LL2 起 120 → 下一档 320
    expect(l.lv).toBe(2);
    expect(l.toNext).toBe(100);
    expect(l.progress).toBeCloseTo(0.5, 5);
    expect(loyaltyOf(700).progress).toBe(1);
  });
  it('好感度夹取：负数归零、离谱值封顶', () => {
    expect(clampRep(-30)).toBe(0);
    expect(clampRep(1e9)).toBe(9999);
    expect(clampRep(NaN as unknown as number)).toBe(0);
  });
});

describe('M71 门槛（好感度 + 委托解锁）', () => {
  it('普通弹谁都能买；穿甲弹要熟人（LL2）；最顶的货要军需官 + 无线电 + 办过委托', () => {
    expect(gateReason(row('a9_fmj'), ctx())).toBe('');
    expect(gateReason(row('a9_ap'), ctx({ rep: 0 }))).toContain('好感不够');
    expect(gateReason(row('a9_ap'), ctx({ rep: 120 }))).toBe('');
    expect(gateReason(row('a308_ap'), ctx({ rep: 9999, bounties: 9, radio: false }))).toContain('无线电');
    expect(gateReason(row('a308_ap'), ctx({ rep: 9999, bounties: 9, radio: true }))).toBe('');
    expect(gateReason(row('hazmat'), ctx({ rep: 120, bounties: 1, radio: true }))).toContain('办 2 张委托');
    expect(gateReason(row('hazmat'), ctx({ rep: 120, bounties: 2, radio: true }))).toBe('');
  });
  it('写清"差什么"：档位名 + 当前好感都在提示里（M61 的缺口视觉口径）', () => {
    const why = gateReason(row('kevlar'), ctx({ rep: 140 }));
    expect(why).toContain('老主顾');
    expect(why).toContain('320');
    expect(why).toContain('140');
  });
  it('货架上的门槛都是"有效门槛"：LL 在 1~4、委托数非负、商人 id 存在', () => {
    for (const r of MERCHANT_GOODS) {
      expect(badShopRows([r], { [r.id]: { t: 'mat' } })).toEqual([]);
      if (r.ll !== undefined) expect(r.ll).toBeGreaterThanOrEqual(1), expect(r.ll).toBeLessThanOrEqual(4);
      if (r.quests !== undefined) expect(r.quests).toBeGreaterThan(0);
      expect(traderOf(r.trader || 'peddler')).toBeTruthy();
    }
    expect(TRADERS.map(t => t.id)).toEqual(['peddler', 'quarter']);
  });
  it('折扣只作用在价格上，不改门槛：同一行货 LL4 更便宜', () => {
    const r = { id: 'a9_ap', cost: 46, n: 8 };
    expect(shopPrice(r, 1 * priceMulOf(0))).toBe(46);
    expect(shopPrice(r, 1 * priceMulOf(700))).toBe(Math.round(46 * 0.84));
  });
});

describe('M71 好感度怎么涨', () => {
  it('卖东西 1~3 点（按成交价值，封顶 3，不让卖垃圾刷满）', () => {
    expect(repForSell(5)).toBe(1);
    expect(repForSell(60)).toBe(3);
    expect(repForSell(1000)).toBe(3);
  });
  it('买东西 1~2 点', () => {
    expect(repForBuy(10)).toBe(1);
    expect(repForBuy(300)).toBe(2);
  });
  it('委托是主要来源：完成 +25/张，过期 −12/张（掉得比涨得快）', () => {
    expect(repForBounty(1)).toBe(25);
    expect(repForBounty(3)).toBe(75);
    expect(repForExpire(1)).toBe(-12);
    expect(Math.abs(repForExpire(1))).toBeLessThan(repForBounty(1));
    // 攒到"熟人"要办 5 张委托（0 → 125）
    expect(repForBounty(5)).toBeGreaterThanOrEqual(LL_TIERS[1].rep);
  });
  it('UI 一行：档位名 + 进度 + 到下一档还差多少', () => {
    expect(traderLine('peddler', 0)).toContain('陌生人');
    expect(traderLine('peddler', 140)).toContain('熟人');
    expect(traderLine('peddler', 140)).toContain('还差 180');
    expect(traderLine('quarter', 700)).toContain('已满档');
  });
});
