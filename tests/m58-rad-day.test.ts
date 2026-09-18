/* M58：辐射的白天症状（纯逻辑）—— 分档阈值与 radTier 完全一致，症状单调递增 */
import { describe, expect, it } from 'vitest';
import { RAD_SOURCES, radBrief, radGain, radLevelAt, radProtect, radSymptomTable, radSymptomText, radSymptoms, radTier } from '../src/v4/rad-core';

describe('白天症状分档', () => {
  it('阈值与 radTier 一一对应（不另立一份阈值）', () => {
    for (const rad of [0, 10, 24, 25, 49, 50, 74, 75, 94, 95, 100]) {
      expect(radSymptoms(rad).tier).toBe(radTier(rad).tier);
      expect(radSymptoms(rad).label).toBe(radTier(rad).label);
    }
  });

  it('干净档：一切倍率都是 1、没有惩罚', () => {
    const s = radSymptoms(0);
    expect(s.staDrainMul).toBe(1);
    expect(s.thirstMul).toBe(1);
    expect(s.hitPenalty).toBe(0);
    expect(s.dodgePenalty).toBe(0);
    expect(s.hpPerStep).toBe(0);
    expect(s.vomitChance).toBe(0);
    expect(radSymptomText(s)).toBe('无症状');
  });

  it('症状随档位**单调加重**（不许出现"高辐射反而更轻"）', () => {
    const rows = [0, 30, 60, 80, 97].map(r => radSymptoms(r));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].staDrainMul).toBeGreaterThanOrEqual(rows[i - 1].staDrainMul);
      expect(rows[i].thirstMul).toBeGreaterThanOrEqual(rows[i - 1].thirstMul);
      expect(rows[i].hitPenalty).toBeGreaterThanOrEqual(rows[i - 1].hitPenalty);
      expect(rows[i].dodgePenalty).toBeGreaterThanOrEqual(rows[i - 1].dodgePenalty);
      expect(rows[i].hpPerStep).toBeGreaterThanOrEqual(rows[i - 1].hpPerStep);
      expect(rows[i].vomitChance).toBeGreaterThanOrEqual(rows[i - 1].vomitChance);
    }
  });

  it('掉血只在重度以上（轻微/明显不该默默扣血，玩家会以为是 bug）', () => {
    expect(radSymptoms(30).hpPerStep).toBe(0);
    expect(radSymptoms(60).hpPerStep).toBe(0);
    expect(radSymptoms(80).hpPerStep).toBeGreaterThan(0);
    expect(radSymptoms(97).hpPerStep).toBeGreaterThan(radSymptoms(80).hpPerStep);
  });

  it('呕吐只在"明显"以上出现，致命档最频繁', () => {
    expect(radSymptoms(30).vomitChance).toBe(0);
    expect(radSymptoms(60).vomitChance).toBeGreaterThan(0);
    expect(radSymptoms(97).vomitChance).toBeGreaterThan(radSymptoms(60).vomitChance);
  });

  it('每一档都给"怎么办"，且从"明显"起点名具体药', () => {
    expect(radSymptoms(0).care).toMatch(/不用处理/);
    expect(radSymptoms(30).care).toMatch(/碘片/);
    expect(radSymptoms(60).care).toMatch(/碘片|抗辐射药/);
    expect(radSymptoms(80).care).toMatch(/抗辐射药/);
    expect(radSymptoms(97).care).toMatch(/撤退|抗辐射药/);
  });

  it('文案摘要能读：包含惩罚项、不含"undefined"', () => {
    const t = radSymptomText(radSymptoms(80));
    expect(t).toMatch(/命中 -10%/);
    expect(t).toMatch(/每步 -1 生命/);
    expect(t).toMatch(/口渴/);
    expect(t).not.toContain('undefined');
    expect(radSymptomText(radSymptoms(30))).toMatch(/口渴/);
  });

  it('脏输入（负数/超界/NaN）不会算出奇怪档位', () => {
    expect(radSymptoms(-50).tier).toBe(0);
    expect(radSymptoms(1e9).tier).toBe(4);
    expect(radSymptoms(NaN).tier).toBe(0);
  });

  it('对照表正好 5 档、顺序与标签对得上（图鉴直接拿它渲染）', () => {
    const t = radSymptomTable();
    expect(t.map(s => s.tier)).toEqual([0, 1, 2, 3, 4]);
    expect(t.map(s => s.label)).toEqual(['干净', '轻微', '明显', '重度', '致命']);
    for (const row of t) expect(row.care.length).toBeGreaterThan(8);
  });

  it('HUD 短摘要：短、干净档为空、不出现 undefined', () => {
    expect(radBrief(radSymptoms(0))).toBe('');
    for (const rad of [30, 60, 80, 97]) {
      const b = radBrief(radSymptoms(rad));
      expect(b.length).toBeGreaterThan(0);
      expect(b.length).toBeLessThanOrEqual(30);
      expect(b.split(' · ').length).toBeLessThanOrEqual(3);
      expect(b).not.toContain('undefined');
    }
    expect(radBrief(radSymptoms(80))).toMatch(/掉血 1\/步/);
    expect(radBrief(radSymptoms(60))).toMatch(/命中 -5%/);
  });
});

describe('辐射场与防护（回归：M58 不改这套数值）', () => {
  it('距离梯度还是"贴边缘能绕着走"', () => {
    const src = [{ x: 10, y: 10, kind: 'nuclear' }];
    expect(radLevelAt(src, 10, 10)).toBe(3);
    expect(radLevelAt(src, 12, 10)).toBe(1);
    expect(radLevelAt(src, 20, 10)).toBe(0);
    expect(RAD_SOURCES.nuclear.radius).toBe(3);
  });
  it('防护叠加有 85% 上限', () => {
    expect(radProtect([{ radProt: 0.6 }, { radProt: 0.25 }])).toBeCloseTo(0.85, 5);
    expect(radProtect([{ radProt: 0.6 }, { radProt: 0.6 }])).toBeCloseTo(0.85, 5);
  });
  it('站在辐射里走路才涨，走远不涨', () => {
    expect(radGain(0, 3)).toBe(0);
    expect(radGain(2, 1)).toBeGreaterThan(0);
    expect(radGain(2, 1, 0.85)).toBeLessThan(radGain(2, 1));
  });
});
