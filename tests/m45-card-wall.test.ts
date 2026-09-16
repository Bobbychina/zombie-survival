/* M45：探索页 legacy 节点认领计划 —— 防「重复的卡片」（用户报障：日历整块出现两次） */
import { describe, expect, it } from 'vitest';
import { claimPlan, fallbackTitle, type ClaimStep, type LegacyKind } from '../src/v4/card-wall-core';

const acts = (kinds: LegacyKind[]) => claimPlan(kinds).map(s => s.act);
const stepOf = (kinds: LegacyKind[], i: number): ClaimStep => claimPlan(kinds)[i];

describe('claimPlan', () => {
  it('标题 + 紧随的正文块 = 一张卡，正文不再单独成卡（M45 的重复就是这里漏的）', () => {
    const p = claimPlan(['title', 'body']);
    expect(p).toEqual([{ i: 0, act: 'title', body: 1 }, { i: 1, act: 'skip' }]);
  });

  it('探索页真实形状：裸卡 / teaser / 日历(标题+卡) → 日历正文只被认领一次', () => {
    const kinds: LegacyKind[] = ['body', 'other', 'title', 'body'];
    const p = claimPlan(kinds);
    expect(p).toEqual([
      { i: 0, act: 'bare' },
      { i: 1, act: 'bare' },
      { i: 2, act: 'title', body: 3 },
      { i: 3, act: 'skip' },
    ]);
    /* 修复前这里会有第二个 {act:'bare'} —— 也就是那张「📋 🩸 血月 2 天后🔌」孤儿卡 */
    expect(p.filter(s => s.act === 'bare').length).toBe(2);
  });

  it('连续两个标题：各自成卡（第二个没有正文）', () => {
    expect(acts(['title', 'title'])).toEqual(['title', 'title']);
    expect(stepOf(['title', 'title'], 0)).toEqual({ i: 0, act: 'title', body: null });
  });

  it('标题在末尾 / 标题后面是别的类型 → 光杆标题卡', () => {
    expect(stepOf(['title'], 0)).toEqual({ i: 0, act: 'title', body: null });
    expect(stepOf(['title', 'other'], 0)).toEqual({ i: 0, act: 'title', body: null });
  });

  it('夹着跳过节点时，标题不会跨过去抢正文（正文仍是 body，自己成裸卡）', () => {
    const p = claimPlan(['title', 'skip', 'body']);
    expect(p).toEqual([
      { i: 0, act: 'title', body: null },
      { i: 1, act: 'skip' },
      { i: 2, act: 'bare' },
    ]);
  });

  it('宿主节点（卡片墙 / 地图卡 / 工具条）一律 skip', () => {
    expect(acts(['skip', 'skip', 'other'])).toEqual(['skip', 'skip', 'bare']);
  });

  it('不变量：每个非 skip 节点恰好被认领一次（标题带走的正文除外）', () => {
    const combos: LegacyKind[][] = [
      [], ['body'], ['other'], ['title'],
      ['title', 'body', 'title', 'body'],
      ['other', 'title', 'body', 'other', 'body'],
      ['skip', 'title', 'body', 'skip'],
      ['title', 'title', 'body'],
      ['body', 'body'],
    ];
    for (const kinds of combos) {
      const p = claimPlan(kinds);
      expect(p.length).toBe(kinds.length);
      const claimed = p.flatMap(s => (s.act === 'title' ? (s.body === null ? [s.i] : [s.i, s.body]) : s.act === 'bare' ? [s.i] : []));
      expect(new Set(claimed).size).toBe(claimed.length);                       // 没有节点被认领两次
      kinds.forEach((k, i) => { if (k !== 'skip') expect(claimed).toContain(i); });   // 也没有节点被漏掉
    }
  });

  it('空列表不炸', () => { expect(claimPlan([])).toEqual([]); });
});

describe('fallbackTitle', () => {
  it('空白压平后取前 12 字（避免标题里带换行）', () => {
    expect(fallbackTitle('  绷带 ×12\n 净水 ×23  ')).toBe('📋 绷带 ×12 净水 ×2');
  });
  it('短文本原样加前缀', () => { expect(fallbackTitle('干净水')).toBe('📋 干净水'); });
  it('空文本给中性标题', () => { expect(fallbackTitle('   ')).toBe('📋 更多'); });
});
