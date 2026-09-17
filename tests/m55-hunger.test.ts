/* M55：饥饿/脱水的夜间结算 —— 用户报的"只睡觉速通"漏洞的根因与修法都在这里 */
import { describe, expect, it } from 'vitest';
import { DOUBLE_WEAK, STARVE_CAP, THIRST_CAP, nightConsumption, sleepHealMul, sleepWarning, starvationTick } from '../src/v4/hunger-core';

describe('starvationTick', () => {
  it('吃饱喝足：不掉血、连饿计数归零', () => {
    const r = starvationTick({ hun: 60, thi: 55, starveN: 5, thirstN: 3 });
    expect(r.hpLoss).toBe(0);
    expect(r.starveN).toBe(0);
    expect(r.thirstN).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('归零就掉血，而且**连睡会加剧**（这是堵漏洞的关键：躺着也得付出代价）', () => {
    const n1 = starvationTick({ hun: 0, thi: 50 });
    const n2 = starvationTick({ hun: 0, thi: 50, starveN: n1.starveN });
    const n3 = starvationTick({ hun: 0, thi: 50, starveN: n2.starveN });
    expect(n1.hpLoss).toBeGreaterThan(0);
    expect(n2.hpLoss).toBeGreaterThan(n1.hpLoss);
    expect(n3.hpLoss).toBeGreaterThan(n2.hpLoss);
    expect(n1.starveN).toBe(1);
    expect(n3.starveN).toBe(3);
  });

  it('脱水比挨饿更狠；两者都归零再叠一层"双重衰竭"', () => {
    const hun = starvationTick({ hun: 0, thi: 60 }).hpLoss;
    const thi = starvationTick({ hun: 60, thi: 0 }).hpLoss;
    expect(thi).toBeGreaterThan(hun);
    const both = starvationTick({ hun: 0, thi: 0 });
    expect(both.hpLoss).toBe(hun + thi + DOUBLE_WEAK);
    expect(both.lines.length).toBe(3);
  });

  it('伤害封顶（不会一晚直接抹平满血玩家，但躺不平）', () => {
    expect(starvationTick({ hun: 0, thi: 60, starveN: 99 }).hpLoss).toBe(STARVE_CAP);
    expect(starvationTick({ hun: 60, thi: 0, thirstN: 99 }).hpLoss).toBe(THIRST_CAP);
  });

  it('每一晚的提示里都告诉玩家吃什么/喝什么', () => {
    const r = starvationTick({ hun: 0, thi: 0 });
    expect(r.lines.join(' ')).toMatch(/罐头|饼干|肉/);
    expect(r.lines.join(' ')).toMatch(/水/);
  });

  it('漏洞不变量：不吃不喝连睡 20 晚，累计伤害足以杀死满血玩家（睡觉回血也算上）', () => {
    /* 最宽松的情形：在据点、行军床满级（回血 39 × 0.25 ≈ 10/晚） */
    const heal = Math.round((12 + 3 * 9) * 1 * 0.25);
    let hp = 100 + 3 * 10;            // 第 5/10/15 天各 +10 上限（病毒进化）→ 估算上限 130
    let starveN = 0, thirstN = 0;
    for (let night = 0; night < 20; night++) {
      const r = starvationTick({ hun: 0, thi: 0, starveN, thirstN });
      starveN = r.starveN; thirstN = r.thirstN;
      hp = hp - r.hpLoss + heal;
      if (hp <= 0) break;
    }
    expect(hp).toBeLessThanOrEqual(0);      // 20 晚之内必死 —— 速通这条路被堵死
  });
});

describe('sleepHealMul', () => {
  it('空腹或脱水：回血只剩四分之一', () => {
    expect(sleepHealMul(50, 50)).toBe(1);
    expect(sleepHealMul(0, 50)).toBe(0.25);
    expect(sleepHealMul(50, 0)).toBe(0.25);
    expect(sleepHealMul(0, 0)).toBe(0.25);
  });
});

describe('nightConsumption', () => {
  it('据点是 12/14；野外 ×1.5（没热饭没净水）', () => {
    expect(nightConsumption(true)).toEqual({ hun: 12, thi: 14 });
    expect(nightConsumption(false)).toEqual({ hun: 18, thi: 21 });
  });
});

describe('sleepWarning', () => {
  it('饿/渴到归零时给出会掉血的警告；正常时闭嘴', () => {
    expect(sleepWarning(50, 50)).toBe('');
    expect(sleepWarning(0, 50)).toMatch(/掉血/);
    expect(sleepWarning(50, 0)).toMatch(/掉血/);
    expect(sleepWarning(0, 0)).toMatch(/要命/);
    expect(sleepWarning(10, 50)).toMatch(/打折|吃点/);
  });
});
