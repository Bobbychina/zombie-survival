/* M68：把"伤"接到每个动作上（用户 2026-09-22 硬核化路线图 · 短期第 1 项）——
   手臂 → 搜刮产出、头部 → 视野；两条都要**平滑**（按部位血量连续变化）且有下限（永远翻得到东西 / 永远看得见 1 圈）。 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyPenalty, headVisionLoss, hudLine, scavMulOf, scavYield, type BodyState,
} from '../src/v4/medical-core';
import { scoutRadius } from '../src/v4/worldstate';

const mk = (over: Partial<BodyState['parts']> = {}, injuries: BodyState['injuries'] = []): BodyState => ({
  parts: { head: 100, torso: 100, belly: 100, armL: 100, armR: 100, legL: 100, legR: 100, ...over },
  injuries,
  bleedSince: 0,
});

describe('M68 手臂伤 → 搜刮产出', () => {
  it('双手满血 = 1.00；双手报废落到下限 0.45（不是 0：绝不能"伤到翻不出东西"）', () => {
    expect(scavMulOf(mk())).toBe(1);
    expect(scavMulOf(mk({ armL: 0, armR: 0 }))).toBe(0.45);
    expect(scavMulOf(mk({ armL: 0, armR: 0 }))).toBeGreaterThan(0);
  });
  it('是连续的：手臂掉血越多产出越低（单调）', () => {
    const v = [100, 80, 60, 40, 20, 0].map(a => scavMulOf(mk({ armL: a, armR: a })));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1]);
    expect(v[0]).toBeGreaterThan(v[v.length - 1]);
  });
  it('只看手臂：腿断/头伤不影响搜刮倍率', () => {
    expect(scavMulOf(mk({ legL: 0, legR: 0, head: 10 }))).toBe(1);
  });
  it('坏档/缺字段兜底 = 1（老档没有 body 也不能崩）', () => {
    expect(scavMulOf(null)).toBe(1);
    expect(scavMulOf(undefined)).toBe(1);
    expect(scavMulOf({ parts: {} } as unknown as BodyState)).toBe(1);
  });
  it('产出换算：乘完四舍五入，**至少 1**', () => {
    expect(scavYield(10, 1)).toBe(10);
    expect(scavYield(10, 0.45)).toBe(5);          // 4.5 → 5
    expect(scavYield(2, 0.45)).toBe(1);           // 0.9 → 1（不是 0）
    expect(scavYield(1, 0.45)).toBe(1);
    expect(scavYield(9, Number.NaN as unknown as number)).toBe(9);
  });
  it('bodyPenalty 把 scavMul 一起报出来（HUD/人体页/探针共用一份口径）', () => {
    expect(bodyPenalty(mk()).scavMul).toBe(1);
    const hurt = bodyPenalty(mk({ armR: 18 }));
    expect(hurt.scavMul).toBeLessThan(1);
    expect(hudLine(mk({ armR: 18 }, [{ part: 'armR', id: 'fracture', day: 1 }]))).toContain('搜刮产出 -');
  });
});

describe('M68 头部伤 → 视野少一圈', () => {
  it('头 < 55% 或有脑震荡 → 少 1 圈；正常 → 0', () => {
    expect(headVisionLoss(mk())).toBe(0);
    expect(headVisionLoss(mk({ head: 54 }))).toBe(1);
    expect(headVisionLoss(mk({ head: 55 }))).toBe(0);
    expect(headVisionLoss(mk({}, [{ part: 'head', id: 'concuss', day: 1 }]))).toBe(1);
    expect(headVisionLoss(mk({}, [{ part: 'head', id: 'concuss', day: 1, done: true }]))).toBe(0);   // 手术过就不算
  });
  it('坏档兜底 = 0（不能因为读不出 body 就把玩家视野砍了）', () => {
    expect(headVisionLoss(null)).toBe(0);
    expect(headVisionLoss({ parts: {} } as unknown as BodyState)).toBe(0);
  });
});

describe('M68 视野圈数（侦查技能 × 头部伤）', () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => { delete (g as { window?: unknown }).window });

  it('侦查 Lv3 = 2 圈；头伤时掉回 1 圈；**下限永远是 1 圈**', () => {
    g.window = { S: { skills: { scout: 3 }, body: mk() } };
    expect(scoutRadius()).toBe(2);
    g.window = { S: { skills: { scout: 3 }, body: mk({ head: 30 }) } };
    expect(scoutRadius()).toBe(1);
    g.window = { S: { skills: { scout: 6 }, body: mk({ head: 10 }) } };
    expect(scoutRadius()).toBe(2);              // 3 圈 − 1 = 2
    g.window = { S: { skills: { scout: 0 }, body: mk({ head: 10 }) } };
    expect(scoutRadius()).toBe(1);              // 1 − 1 夹回 1：不能瞎
  });
  it('没有 window 的纯逻辑环境照样返回 1 圈（老行为不变）', () => {
    expect(scoutRadius()).toBe(1);
  });
});
