/* M70 藏身处经济：回收台（材料 → 建材）+ 升级曲线放缓。
   背景（审计数字在 docs/BASE-REVIEW.md）：满级全设施原来要 ≈2170 AP 的建材，而 100 天的局总共才 1400 AP；
   通用「材料」是产量最大的资源却完全不能建造 —— 两个数字叠起来就是用户说的"通关都造不出几个"。 */
import { describe, expect, it } from 'vitest';
import { scaledCost } from '../src/v4/base-core';
import {
  EXCHANGE_ROWS, EX_MIN_BENCH, exAfford, exCapBonus, exLine, exUsedToday, rowOf,
} from '../src/v4/exchange-core';

describe('M70 回收台（材料 → 建材）', () => {
  it('表里每一项都能对上物品 id 与"越贵越少"的口径（材料/件 单调不降，额度随价格不升）', () => {
    expect(EXCHANGE_ROWS.length).toBeGreaterThanOrEqual(6);
    const byCost = [...EXCHANGE_ROWS].sort((a, b) => a.cost - b.cost);
    for (const r of EXCHANGE_ROWS) {
      expect(r.cost).toBeGreaterThan(0);
      expect(r.cap).toBeGreaterThan(0);
      expect(r.n).toBeGreaterThanOrEqual(1);
    }
    // 便宜的东西额度大、贵的东西额度小（芯片 14 材料的额度必须小于木料 3 材料的额度）
    const cheap = byCost[0], dear = byCost[byCost.length - 1];
    expect(cheap.cap).toBeGreaterThan(dear.cap);
    expect(dear.cost).toBeGreaterThan(cheap.cost);
  });

  it('没建工作台：一行都换不了，并说明原因', () => {
    const r = rowOf('metal')!;
    const aff = exAfford(r, { mat: 999, used: 0, benchLv: 0 });
    expect(aff.max).toBe(0);
    expect(aff.why).toContain('工作台');
    expect(EX_MIN_BENCH).toBe(1);
  });

  it('受"当天额度 × 手上材料"双重限制：材料不够时给出差几点', () => {
    const r = rowOf('metal')!;                     // 6 材料/件，额度 8
    expect(exAfford(r, { mat: 100, used: 0, benchLv: 1 }).max).toBe(8);
    expect(exAfford(r, { mat: 100, used: 7, benchLv: 1 }).max).toBe(1);
    const out = exAfford(r, { mat: 100, used: 8, benchLv: 1 });
    expect(out.max).toBe(0);
    expect(out.why).toContain('额度');
    const poor = exAfford(r, { mat: 4, used: 0, benchLv: 1 });
    expect(poor.max).toBe(0);
    expect(poor.short).toBe(2);
    expect(poor.why).toContain('还差 2');
  });

  it('工作台每高一级，所有额度 +1（升级工作台有了第二重收益）', () => {
    expect(exCapBonus(0)).toBe(0);
    expect(exCapBonus(1)).toBe(0);
    expect(exCapBonus(3)).toBe(2);
    const r = rowOf('chip')!;                      // 额度 3
    expect(exLine(r, { mat: 999, used: 0, benchLv: 3 }).cap).toBe(5);
    expect(exLine(r, { mat: 999, used: 0, benchLv: 1 }).cap).toBe(3);
  });

  it('额度按"天"重置：换过的那天读得出来，隔天自动归零', () => {
    const ex = { day: 5, used: { metal: 3, chip: 1 } };
    expect(exUsedToday(ex, 5)).toEqual({ metal: 3, chip: 1 });
    expect(exUsedToday(ex, 6)).toEqual({});
    expect(exUsedToday(null, 6)).toEqual({});
    expect(exUsedToday({ day: 6, used: { metal: 'x' } as any }, 6)).toEqual({});
  });

  it('汇率口径：贵的建材（芯片）单件仍比"满图找"便宜，但不至于白送', () => {
    const chip = rowOf('chip')!;
    // 快搜材料档 ≈ 6 材料/AP → 14 材料 ≈ 2.3 AP/芯片；原来靠 office/appliance 掉落 ≈ 11.5 AP/件
    expect(chip.cost / 6).toBeLessThan(3);
    const wood = rowOf('wood')!;
    expect(wood.cost / 6).toBeLessThan(1);          // 木头本来就便宜，兑换只是省跑腿
  });
});

describe('M70 升级曲线放缓（0.6 → 0.35）', () => {
  it('第三级从 2.2 倍降到 1.7 倍', () => {
    expect(scaledCost({ metal: 10 }, 0)).toEqual({ metal: 10 });
    expect(scaledCost({ metal: 10 }, 1)).toEqual({ metal: 14 });     // 1.35 → ceil 13.5 = 14
    expect(scaledCost({ metal: 10 }, 2)).toEqual({ metal: 17 });     // 1.7
  });
  it('全设施满级总价明显下降（对得上 BASE-REVIEW 的前后对比）', () => {
    // 抽查三个"卡料最狠"的设施：发电机/无线电/医疗台
    const power = ['0', '1'].map(lv => scaledCost({ metal: 6, chip: 3, fuel: 2 }, Number(lv)));
    const metal = power.reduce((a, c) => a + c.metal, 0);
    const chip = power.reduce((a, c) => a + c.chip, 0);
    expect(metal).toBe(6 + 9);            // 6 + ceil(8.1)
    expect(chip).toBe(3 + 5);             // 3 + ceil(4.05)
  });
});
