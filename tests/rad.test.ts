/* M25 辐射模型单测：玩家在核电站周边走一圈会怎样——这些数字直接决定"敢不敢靠近"，
   写错了要么玩家被无声毒死，要么辐射变成摆设。 */
import { describe, expect, it } from 'vitest';
import { RAD_SOURCES, geigerText, radGain, radLevelAt, radProtect, radTier } from '../src/v4/rad-core';

const nuke = [{ x: 10, y: 10, kind: 'nuclear' }];
const waste = [{ x: 3, y: 3, kind: 'waste' }];

describe('辐射场', () => {
  /* 梯度：中心 = min(3, radius)，每远离一格降一级 —— 3 格半径就是 3/2/1，
     "贴着最外圈（1 级）蹭过去"是一种能算清楚的操作，而不是一脚踩进就是 3 级。 */
  it('核电站：中心 3 级，逐格递减，出半径归零', () => {
    expect(radLevelAt(nuke, 10, 10)).toBe(3);
    expect(radLevelAt(nuke, 11, 10)).toBe(2);
    expect(radLevelAt(nuke, 12, 10)).toBe(1);
    expect(radLevelAt(nuke, 13, 10)).toBe(0);
  });

  it('废料场半径小一号（2 格），最高 2 级', () => {
    expect(radLevelAt(waste, 3, 3)).toBe(2);
    expect(radLevelAt(waste, 4, 4)).toBe(1);
    expect(radLevelAt(waste, 5, 3)).toBe(0);
  });

  it('两个源重叠时取高的那个（不会叠成 4 级以上）', () => {
    const both = [{ x: 10, y: 10, kind: 'nuclear' }, { x: 11, y: 10, kind: 'nuclear' }];
    expect(radLevelAt(both, 10, 10)).toBe(3);
    expect(radLevelAt(both, 10, 10)).toBeLessThanOrEqual(3);
  });

  it('未知辐射源被忽略（内容表加了新 POI 但忘了注册时不至于崩）', () => {
    expect(radLevelAt([{ x: 1, y: 1, kind: 'nope' }], 1, 1)).toBe(0);
  });

  it('辐射源表里每个 kind 都有名字和半径', () => {
    for (const k in RAD_SOURCES) {
      expect(RAD_SOURCES[k].n.length).toBeGreaterThan(0);
      expect(RAD_SOURCES[k].radius).toBeGreaterThan(0);
    }
  });
});

describe('辐射累积与防护', () => {
  it('干净地面走路不累积', () => {
    expect(radGain(0, 10, 0)).toBe(0);
  });

  it('等级越高、走得越远，累积越多', () => {
    expect(radGain(3, 1, 0)).toBeGreaterThan(radGain(1, 1, 0));
    expect(radGain(2, 4, 0)).toBeGreaterThan(radGain(2, 2, 0));
  });

  it('防护按比例减，但有 85% 上限（穿全套也不能免疫）', () => {
    const naked = radGain(3, 3, 0);
    expect(radGain(3, 3, 0.6)).toBeLessThan(naked);
    expect(radGain(3, 3, 0.999)).toBe(Math.max(1, Math.round(naked * 0.15)));
  });

  it('进了辐射区最少也吃 1 点（不会因为防护就完全免费）', () => {
    expect(radGain(1, 1, 0.85)).toBeGreaterThanOrEqual(1);
  });

  it('防化服+面具+潜水服叠不到 100%（表里没有这条就会被玩家钻空子）', () => {
    expect(radProtect([{ radProt: 0.6 }, { radProt: 0.25 }, { radProt: 0.1 }])).toBeCloseTo(0.85, 5);
    expect(radProtect([])).toBe(0);
    expect(radProtect([{}, { radProt: 0.6 }])).toBeCloseTo(0.6, 5);
  });
});

describe('辐射分档', () => {
  it('五档阈值边界正确', () => {
    expect(radTier(0).tier).toBe(0);
    expect(radTier(24).tier).toBe(0);
    expect(radTier(25).tier).toBe(1);
    expect(radTier(49).tier).toBe(1);
    expect(radTier(50).tier).toBe(2);
    expect(radTier(74).tier).toBe(2);
    expect(radTier(75).tier).toBe(3);
    expect(radTier(94).tier).toBe(3);
    expect(radTier(95).tier).toBe(4);
    expect(radTier(100).tier).toBe(4);
  });

  it('超出 0~100 的脏存档被夹住（老档/改档不至于算出 undefined）', () => {
    expect(radTier(-5).tier).toBe(0);
    expect(radTier(999).tier).toBe(4);
  });

  it('档位越高越难受：体力上限、夜间掉血、治疗效率都变差', () => {
    let prev = radTier(0);
    for (const v of [30, 60, 80, 99]) {
      const cur = radTier(v);
      expect(cur.staMul).toBeLessThanOrEqual(prev.staMul);
      expect(cur.nightHp).toBeLessThanOrEqual(prev.nightHp);
      expect(cur.healMul).toBeLessThanOrEqual(prev.healMul);
      prev = cur;
    }
    expect(radTier(99).staMul).toBeLessThan(1);
  });
});

describe('盖革计数器文案', () => {
  it('没计数器在辐射区只给模糊线索（不能白送精确等级）', () => {
    const t = geigerText(3, false);
    expect(t).toContain('金属味');
    expect(t).not.toContain('3 级');
  });

  it('有计数器报出具体等级', () => {
    expect(geigerText(2, true)).toContain('辐射 2 级');
    expect(geigerText(0, true)).toContain('背景值');
  });
});
