/* M56：逃跑失败的代价 + 避战道具（气味引诱器三档）—— 纯逻辑单测 */
import { describe, expect, it } from 'vitest';
import { FLEE_FAIL_STA, FLEE_MAX, FLEE_MIN, FLEE_TRY_PENALTY, fleeChanceOf, fleeFailPlan } from '../src/v4/flee-core';
import { DECOYS, DECOY_BY_ID, foeTier, planDecoy } from '../src/v4/decoy-core';

describe('逃跑成功率（M56：反复失败会越来越难跑）', () => {
  it('基础值 + 潜行 + 军靴，迅捷/超重扣分，始终夹在 8%~92%', () => {
    expect(fleeChanceOf({ base: 0.45 })).toBeCloseTo(0.45, 5);
    expect(fleeChanceOf({ base: 0.45, stealthLv: 2 })).toBeCloseTo(0.52, 5);
    expect(fleeChanceOf({ base: 0.45, hasBoots: true })).toBeCloseTo(0.53, 5);
    expect(fleeChanceOf({ base: 0.45, fast: true })).toBeCloseTo(0.27, 5);
    expect(fleeChanceOf({ base: 0.45, encOver: true })).toBeCloseTo(0.30, 5);
    expect(fleeChanceOf({ base: 0.45, stealthLv: 99 })).toBe(FLEE_MAX);
    expect(fleeChanceOf({ base: 0.45, stealthLv: -99 })).toBe(FLEE_MIN);
  });

  it('每失败一次再 -8%（最低仍留 8% 的侥幸，不给"必死"）', () => {
    const c0 = fleeChanceOf({ base: 0.45, tries: 0 });
    const c1 = fleeChanceOf({ base: 0.45, tries: 1 });
    const c3 = fleeChanceOf({ base: 0.45, tries: 3 });
    expect(c0 - c1).toBeCloseTo(FLEE_TRY_PENALTY, 5);
    expect(c3).toBeCloseTo(0.45 - 3 * FLEE_TRY_PENALTY, 5);
    expect(fleeChanceOf({ base: 0.45, tries: 99 })).toBe(FLEE_MIN);
  });

  it('不许逃的场合（守夜战 / 决战 / 血月）永远是 0', () => {
    expect(fleeChanceOf({ base: 0.45, noFlee: true })).toBe(0);
    expect(fleeChanceOf({ base: 0.9, noFlee: true, stealthLv: 10, hasBoots: true })).toBe(0);
  });
});

describe('逃跑失败 = 真的挨打（这就是用户报的漏洞）', () => {
  it('每个还活着的敌人白打你一轮，并掉体力', () => {
    const p1 = fleeFailPlan(1), p3 = fleeFailPlan(3);
    expect(p1.freeAttacks).toBe(1);
    expect(p3.freeAttacks).toBe(3);
    expect(p3.staCost).toBe(FLEE_FAIL_STA);
    expect(p3.text).toMatch(/后背|白挨/);
  });

  it('场上没人时不会凭空扣血', () => {
    const p0 = fleeFailPlan(0);
    expect(p0.freeAttacks).toBe(0);
    expect(p0.text).toMatch(/没有能追上来/);
  });
});

describe('避战道具：三档与覆盖层级', () => {
  it('三档齐备（简易 / 强力 / 军用），档位 1~3', () => {
    expect(DECOYS.map(d => d.id)).toEqual(['decoy1', 'decoy2', 'decoy3']);
    expect(DECOYS.map(d => d.tier)).toEqual([1, 2, 3]);
    for (const d of DECOYS) expect(DECOY_BY_ID[d.id]).toBe(d);
  });

  it('普通丧尸 = 1 档；进阶 = 2 档；精英 / 暴君 = 3 档；未知 id 保守按 2 档', () => {
    expect(foeTier({ id: 'walker' })).toBe(1);
    expect(foeTier({ id: 'brute' })).toBe(2);
    expect(foeTier({ id: 'armored' })).toBe(2);
    expect(foeTier({ id: 'tyrant', boss: true })).toBe(3);
    expect(foeTier({ id: 'walker', elite: true })).toBe(3);
    expect(foeTier({ id: 'brand_new_thing' })).toBe(2);
  });

  it('用"够档的最低档"：普通丧尸用 1 档，别浪费高级货', () => {
    const plan = planDecoy({ decoy1: 1, decoy3: 1 }, [{ id: 'walker', hp: 10 }, { id: 'runner', hp: 8 }]);
    expect(plan.item).toBe('decoy1');
    expect(plan.driven.length).toBe(2);
    expect(plan.clears).toBe(true);
  });

  it('低档面对高阶：不消耗、只提示（别让玩家白扔）', () => {
    const plan = planDecoy({ decoy1: 2 }, [{ id: 'tyrant', boss: true, hp: 100 }]);
    expect(plan.item).toBe(null);
    expect(plan.clears).toBe(false);
    expect(plan.text).toMatch(/不吃这一套/);
    expect(plan.stays.length).toBe(1);
  });

  it('混合场面：引走能引走的，剩下的继续打', () => {
    const plan = planDecoy({ decoy1: 1 }, [{ id: 'walker', hp: 10 }, { id: 'brute', hp: 40 }]);
    expect(plan.item).toBe('decoy1');
    expect(plan.driven).toEqual([0]);
    expect(plan.stays).toEqual([1]);
    expect(plan.clears).toBe(false);
    expect(plan.text).toMatch(/剩下 1 只/);
  });

  it('高阶道具能把暴君也引开（全部引走 → 脱离接触）', () => {
    const plan = planDecoy({ decoy3: 1 }, [{ id: 'tyrant', boss: true, hp: 100 }, { id: 'walker', hp: 10 }]);
    expect(plan.item).toBe('decoy3');
    expect(plan.clears).toBe(true);
    expect(plan.driven.length).toBe(2);
  });

  it('血月 / 守夜战 / 决战：引诱器一律无效（血味盖过去了）', () => {
    const plan = planDecoy({ decoy3: 2 }, [{ id: 'walker', hp: 10 }], { noFlee: true });
    expect(plan.item).toBe(null);
    expect(plan.clears).toBe(false);
    expect(plan.text).toMatch(/血味|没用/);
  });

  it('身上没有引诱器：给一句"哪来的"提示', () => {
    const plan = planDecoy({}, [{ id: 'walker', hp: 10 }]);
    expect(plan.item).toBe(null);
    expect(plan.text).toMatch(/工作台/);
  });

  it('不变量：只用身上真有的道具，不会消耗比身上还多的数量', () => {
    const inv = { decoy1: 1, decoy2: 3 };
    for (const foes of [[{ id: 'walker', hp: 5 }], [{ id: 'brute', hp: 5 }], [{ id: 'tyrant', boss: true, hp: 5 }], [{ id: 'walker', hp: 5 }, { id: 'tyrant', boss: true, hp: 5 }]]) {
      const plan = planDecoy(inv, foes as { id: string; hp: number; boss?: boolean }[]);
      if (plan.item) expect(inv[plan.item as 'decoy1' | 'decoy2']).toBeGreaterThan(0);
    }
  });
});
