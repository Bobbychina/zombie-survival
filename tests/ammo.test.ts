/* M25 弹药口径/穿透单测（参考塔科夫）：
   这里的算法同时被 legacy 战斗和 v4 引擎使用，两边算不一样就是"面板说能打穿、实战却没伤害"的 bug 源头。 */
import { describe, expect, it } from 'vitest';
import { CALIBERS, ammoShortName, ammoTable, penMul, pickLoadedAmmo } from '../src/v4/ammo-core';

/** 假物品表：形状跟 legacy ITEMS 一致（t/cal/pen/dmgMul） */
const ITEMS: Record<string, { t?: string; cal?: string; pen?: number; dmgMul?: number }> = {
  a9_fmj: { t: 'ammo', cal: 'c9', pen: 2, dmgMul: 1 },
  a9_ap: { t: 'ammo', cal: 'c9', pen: 4, dmgMul: 1.05 },
  a556_ap: { t: 'ammo', cal: 'c556', pen: 5, dmgMul: 1.12 },
  pistol: { t: 'wpn', cal: 'c9' },          // 不是弹，不该被收进弹种表
  bandage: { t: 'med' },
};

describe('口径表', () => {
  it('每个口径都有全名与短名（HUD 用短名）', () => {
    for (const c in CALIBERS) {
      const d = CALIBERS[c];
      expect(d.n.length).toBeGreaterThan(0);
      expect(d.short.length).toBeGreaterThan(0);
    }
  });

  it('弹种按穿透升序分组（UI 列表与"自动挑最好的"都依赖这个顺序）', () => {
    const t = ammoTable(ITEMS);
    expect(t.c9.map(a => a.id)).toEqual(['a9_fmj', 'a9_ap']);
    expect(t.c556.map(a => a.id)).toEqual(['a556_ap']);
    expect(t.c12).toEqual([]);                 // 没有 12 号弹时给空数组，不是 undefined
  });

  it('非弹药物品不会混进弹种表', () => {
    const ids = Object.values(ammoTable(ITEMS)).flat().map(a => a.id);
    expect(ids).not.toContain('pistol');
    expect(ids).not.toContain('bandage');
  });
});

describe('装填选择', () => {
  const list = ammoTable(ITEMS).c9;

  it('玩家指定了就听玩家的（哪怕不是最高穿透）', () => {
    expect(pickLoadedAmmo(list, { a9_fmj: 5, a9_ap: 5 }, { c9: 'a9_fmj' }, 'c9')).toBe('a9_fmj');
  });

  it('指定那种打光了就退回自动挑（不会选中 0 发的弹）', () => {
    expect(pickLoadedAmmo(list, { a9_ap: 3 }, { c9: 'a9_fmj' }, 'c9')).toBe('a9_ap');
  });

  it('自动模式挑穿透最高且有货的', () => {
    expect(pickLoadedAmmo(list, { a9_fmj: 9, a9_ap: 1 }, {}, 'c9')).toBe('a9_ap');
  });

  it('全空也返回一个名字（HUD 要写"9mm·FMJ ×0"，不能是 undefined）', () => {
    expect(pickLoadedAmmo(list, {}, {}, 'c9')).toBe('a9_fmj');
  });

  it('口径没有对应弹种时返回 null', () => {
    expect(pickLoadedAmmo([], { a9_fmj: 1 }, {}, 'c12')).toBeNull();
  });
});

describe('穿透 vs 装甲', () => {
  it('无甲目标不吃惩罚（打丧尸不亏）', () => {
    expect(penMul(0, 0)).toBe(1);
    expect(penMul(2, 0)).toBe(1);
  });

  it('穿透达标就是满伤', () => {
    expect(penMul(5, 5)).toBe(1);
    expect(penMul(6, 5)).toBe(1);
  });

  it('穿透不足按差值线性减伤，差太多时被 15% 地板托住', () => {
    expect(penMul(4, 5)).toBeCloseTo(0.82, 5);
    expect(penMul(3, 5)).toBeCloseTo(0.64, 5);
    expect(penMul(0, 5)).toBe(0.15);             // 1-(5-0)*0.18 = 0.1 → 被地板抬到 0.15
  });

  it('差得再多也不会变成 0（否则新手一枪打不出数字，像 bug）', () => {
    expect(penMul(0, 5)).toBe(0.15);
    expect(penMul(-3, 9)).toBe(0.15);
  });

  it('同一种弹打装甲目标明显比打无甲亏——这才是"要换穿甲弹"的动力', () => {
    const soft = penMul(2, 0);
    const hard = penMul(2, 5);
    expect(soft / hard).toBeGreaterThan(1.5);
  });
});

describe('弹种短名', () => {
  it('取名字最后一段（"9mm FMJ" → "FMJ"）', () => {
    expect(ammoShortName('9mm FMJ')).toBe('FMJ');
    expect(ammoShortName('7.62N 穿甲')).toBe('穿甲');
    expect(ammoShortName('单段')).toBe('单段');
  });
});
