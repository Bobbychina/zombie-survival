/* C01/C02/C03 过夜系统的 S1 敏感度矩阵 + C07 撤离点的确定性。
   会议把 S1 定为 C01+C02 的准入门槛，所以这里不是"顺手补的测试"，而是门槛本身。 */
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/v4/worldgen';
import { AP_MAX_BASE, DEBT_CAP, DEBT_HEAL_BASE, DEBT_PER_FIELD, FIELD_RESTORE, apMaxOf, raidChance } from '../src/v4/night-core';
import { evacSite, evacOpenDay, evacAvailable, evacGate, EVAC_DAY } from '../src/v4/evac-gate';

/** 连续野睡 N 夜：返回每天的 AP 上限与行动力 */
function simulateFieldNights(n: number) {
  let debt = 0;
  const out: { day: number; cap: number; ap: number; debt: number }[] = [];
  for (let i = 1; i <= n; i++) {
    debt = Math.min(DEBT_CAP, debt + DEBT_PER_FIELD);
    const cap = apMaxOf(debt);
    out.push({ day: i, cap, ap: Math.max(1, Math.round(cap * FIELD_RESTORE)), debt });
  }
  return out;
}

describe('S1 敏感度矩阵：过夜参数必须过三条及格线', () => {
  it('① 连续野睡第 7 天不得触底（AP 上限 ≥6）', () => {
    const week = simulateFieldNights(7);
    expect(week[6].cap).toBeGreaterThanOrEqual(6);
    // 第 3 / 5 天分别落在 2 档与 3 档（苏黎推演的 1.5 / 2.5 / 触底 6 是同一套数的表述）
    expect(week[2].debt).toBe(1.5);
    expect(week[4].debt).toBe(2.5);
    expect(week[6].debt).toBe(DEBT_CAP);
  });

  it('② 单人 3 天远征可行：每天净推进 ≥3 个区块', () => {
    const days = simulateFieldNights(3);
    for (const d of days) expect(d.ap).toBeGreaterThanOrEqual(3);
    expect(days.reduce((a, d) => a + d.ap, 0)).toBeGreaterThanOrEqual(9);   // 3 天至少推进 9 个区块
  });

  it('③ 安全屋相对野睡的净收益 ≥2 行动力（回家是有意义的）', () => {
    // 最差情况：债已满，野睡 6*0.65≈4，回家睡满格并还 2 档 → 上限回到 8
    const fieldAp = Math.round(apMaxOf(DEBT_CAP) * FIELD_RESTORE);
    const safeDebt = Math.max(0, DEBT_CAP - DEBT_HEAL_BASE);
    const safeAp = apMaxOf(safeDebt);
    expect(safeAp - fieldAp).toBeGreaterThanOrEqual(2);
    expect(apMaxOf(0)).toBe(AP_MAX_BASE);
  });

  it('夜袭概率：只有安全屋是 0，露天 > 车里 > 掩体，且随天数上涨', () => {
    expect(raidChance('base', 30, 0)).toBe(0);
    expect(raidChance('open', 1, 0)).toBeGreaterThan(raidChance('car', 1, 0));
    expect(raidChance('car', 1, 0)).toBeGreaterThan(raidChance('shelter', 1, 0));
    expect(raidChance('open', 40, 3)).toBeGreaterThan(raidChance('open', 1, 0));
    expect(raidChance('open', 99, 9)).toBeLessThanOrEqual(0.85);
  });

  it('参数落在一处（改常量就能整体调难度）', () => {
    expect(FIELD_RESTORE).toBeGreaterThanOrEqual(0.6);
    expect(FIELD_RESTORE).toBeLessThanOrEqual(0.7);
    expect(apMaxOf(0)).toBe(9);
    expect(apMaxOf(3)).toBe(6);
    expect(apMaxOf(99)).toBe(6);
  });
});

describe('C07 撤离点', () => {
  it('窗口第 90 天开启；撞血月顺延一天（口径写死）', () => {
    expect(EVAC_DAY).toBe(90);
    expect(evacOpenDay(90)).toBe(90);          // 90 % 7 = 6，不是血月
    expect(evacOpenDay(91)).toBe(92);          // 91 % 7 = 0 → 顺延
    expect(evacAvailable(89)).toBe(false);
    expect(evacAvailable(90)).toBe(true);
    expect(evacAvailable(91)).toBe(false);     // 血月当天不发信号
    expect(evacGate(89)).toContain('第 90 天');
    expect(evacGate(91)).toContain('顺延');
  });

  it('撤离点稳定、离家 ≥8 区块、优先硬据点', () => {
    for (const seed of ['ember-01', 's1', 's3', 'zombie-42']) {
      const w = generateWorld(seed);
      const a = evacSite(w), b = evacSite(w);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const d = Math.max(Math.abs(a.x - w.home.x), Math.abs(a.y - w.home.y));
      expect(d).toBeGreaterThanOrEqual(8);
      expect(a.poi).not.toBe('lab');
      expect(['radio', 'military', 'bunker', 'prison', 'tunnel', 'camp', 'outpost', 'waterworks', 'hospital', 'police']).toContain(a.poi);
    }
  });
});
