/* M50：病症的**主动治疗**（用户报障「真菌感染没有在人体 subpage 内显示，也无法治疗」）。
   这批把"病症 → 药"做成真数据。为什么值得写单测：M30 起 CONDS[*].cure 只是一句文案，
   里面写着"抗真菌药"，而**这件东西在 ITEMS 里根本不存在** —— 真菌感染只能等环境回落自己消退。
   下面第一条就是钉这个：COND_CURE 里写的每件药都必须在 legacy 物品表里真的存在。 */
import { describe, expect, it } from 'vitest';
import { COND_CURE, COND_IDS, COND_OF_ITEM, CONDS, condPenaltyText } from '../src/v4/survival-core';
import { INJURIES } from '../src/v4/medical-core';
import { itemTable } from './legacy-tables';

const ITEMS = itemTable();

describe('M50 病症治疗表', () => {
  it('每种病症都有治疗手段，而且那件药真的存在于物品表里（M30 的坑）', () => {
    expect(COND_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of COND_IDS) {
      const c = COND_CURE[id];
      expect(c, id).toBeTruthy();
      expect(c.item.length, id).toBeGreaterThan(0);
      expect(c.n, id).toBeGreaterThan(0);
      expect(c.how.length, id).toBeGreaterThan(1);
      expect(ITEMS[c.item], id + ' 的药「' + c.item + '」不在 ITEMS 里').toBeTruthy();
      /* 药得是"能用/能吃"的东西：med（抗生素/抗真菌药）或 drink（净水——脱水与中暑靠补水降温） */
      expect(['med', 'drink'], id + ' 的药类型').toContain(ITEMS[c.item].t);
    }
  });

  it('真菌感染有药了（用户报障的那一条）', () => {
    expect(COND_CURE.fungal.item).toBe('fungicide');
    expect(ITEMS.fungicide?.n).toBe('抗真菌药');
  });

  it('反向表 COND_OF_ITEM 与正表逐条对得上（背包里「使用」走它）', () => {
    expect(Object.keys(COND_OF_ITEM).length).toBeGreaterThanOrEqual(2);
    for (const [item, id] of Object.entries(COND_OF_ITEM)) {
      expect(COND_CURE[id].item, item).toBe(item);
      expect(ITEMS[item], item).toBeTruthy();
    }
  });

  it('每种病症都写了症状 / 代价 / 怎么好（人体页与图鉴直接印这三行）', () => {
    for (const id of COND_IDS) {
      expect(CONDS[id].symptom.length, id).toBeGreaterThan(4);
      expect(CONDS[id].cure.length, id).toBeGreaterThan(4);
      expect(condPenaltyText(id).length, id).toBeGreaterThan(2);
    }
  });

  it('伤情表每条也都写了"怎么治"（图鉴 → 治疗指南 印的就是它）', () => {
    const keys = Object.keys(INJURIES);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of keys) expect(INJURIES[k].cure.length, k).toBeGreaterThan(2);
  });
});
