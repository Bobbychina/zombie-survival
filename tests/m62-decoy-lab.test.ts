/* M62：把 M56 的引诱器接进教学沙盒 —— 第 2 章多一条"打不过就用引诱器脱身"的**硬验证**。
   判定口径：引擎只在引诱器**真的引走了至少一只**时才记账（`stats.decoyUses`），
   引不走（比如拿简易引诱器去赶暴君）既不消耗也不记账 —— 不然"点一下槽"就能交差。
   这里测纯逻辑：快照清洗、目标判定、预设够用、以及 decoy-core 的"不白扔"语义。 */
import { describe, expect, it } from 'vitest';
import { COMBAT_PRESET, chapterById, evalChapter, snapOf } from '../src/v4/sandbox-core';
import { DECOYS, foeTier, planDecoy } from '../src/v4/decoy-core';
import { LAB_CHAPTERS } from '../src/v4/sandbox-core';

const CH2 = chapterById('combat')!;
const obj = (id: string) => CH2.objectives.find(o => o.id === id)!;

describe('M62 第 2 章第 5 条：引诱器要"真的用掉一次"', () => {
  it('目标存在、判定读 stats.decoyUses（有货不算、点槽不算）', () => {
    expect(CH2.objectives.length).toBe(5);
    expect(obj('decoyUse')).toBeTruthy();
    expect(obj('decoyUse').need({ decoyUses: 0 } as any)).toBe(false);
    expect(obj('decoyUse').need({ decoyUses: 1 } as any)).toBe(true);
    expect(obj('decoyUse').text).toMatch(/引诱器/);
    expect(obj('decoyUse').text).toMatch(/引不走的不消耗/);
  });

  it('文案把"简易赶普通 / 强力赶装甲"这条分级讲清楚', () => {
    expect(obj('decoyUse').text).toMatch(/简易/);
    expect(obj('decoyUse').text).toMatch(/装甲/);
  });

  it('快照把 stats.decoyUses 带出来（缺字段/坏值一律 0）', () => {
    expect(snapOf({ stats: { decoyUses: 3 }, world: {} }).decoyUses).toBe(3);
    expect(snapOf({ stats: {}, world: {} }).decoyUses).toBe(0);
    expect(snapOf({ stats: { decoyUses: 'x' }, world: {} }).decoyUses).toBe(0);
    expect(snapOf(null).decoyUses).toBe(0);
  });

  it('沙盒预设发了引诱器：简易 ≥1（赶普通）与强力 ≥1（赶装甲 tier 2）', () => {
    expect(COMBAT_PRESET.inv.decoy1 || 0).toBeGreaterThanOrEqual(1);
    expect(COMBAT_PRESET.inv.decoy2 || 0).toBeGreaterThanOrEqual(1);
    /* 分档与威胁层级对齐：装甲丧尸是 tier 2 → 只有 decoy2 起得动它 */
    expect(foeTier({ id: 'armored' })).toBe(2);
    expect(foeTier({ id: 'tyrant', boss: true })).toBe(3);
    const armoredFoes = [{ id: 'armored', hp: 34 }];
    expect(planDecoy({ decoy1: 1 }, armoredFoes).item).toBe(null);            // 简易的：引不走 → 不消耗、不记账
    expect(planDecoy({ decoy1: 1, decoy2: 1 }, armoredFoes).item).toBe('decoy2');
  });

  it('三档道具都还在（这一章只是"发给你练"，不是改规则）', () => {
    expect(DECOYS.map(d => d.id)).toEqual(['decoy1', 'decoy2', 'decoy3']);
    expect(DECOYS.map(d => d.tier)).toEqual([1, 2, 3]);
  });

  it('章节表的 desc 也说了这条（玩家在卡面上就能看到）', () => {
    expect(CH2.desc).toMatch(/引诱器/);
    expect(LAB_CHAPTERS.find(c => c.id === 'combat')!.desc).toBe(CH2.desc);
  });
});

describe('M62 不白扔：引不走时既不消耗也不记账', () => {
  it('守夜战（noFlee）一律无效 → item=null（引擎不会记账）', () => {
    expect(planDecoy({ decoy3: 2 }, [{ id: 'walker', hp: 5 }], { noFlee: true }).item).toBe(null);
  });
  it('场上没敌人 → item=null', () => {
    expect(planDecoy({ decoy1: 1 }, []).item).toBe(null);
  });
  it('真引走时才给 item（记 1 次）且 clears 时战斗直接脱离', () => {
    const p = planDecoy({ decoy1: 2 }, [{ id: 'walker', hp: 5 }, { id: 'runner', hp: 5 }]);
    expect(p.item).toBe('decoy1');
    expect(p.driven.length).toBe(2);
    expect(p.clears).toBe(true);
  });
});
