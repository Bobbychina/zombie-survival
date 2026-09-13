/* M15 多结局：判定矩阵、抉择倾向、解锁记录、存档过滤。
   这一套的价值全在"条件写对"：结局是玩家玩几十小时才看到的东西，
   条件写错（永远不触发 / 永远触发同一个）比崩溃更糟——所以逐条对着 ctx 过。 */
import { describe, expect, it } from 'vitest';
import {
  ENDINGS, SHARE_CHOICES, archiveTitle, endingById, endingLines, ensureEndings, isSharing,
  resolveEnding, sharedCount, unlockEnding, type EndingCtx, type EndingKind,
} from '../src/v4/endings-core';
import { STORY } from '../src/v4/story-core';

const ctx = (over: Partial<EndingCtx> = {}): EndingCtx => ({
  kind: 'won', day: 40, choices: {}, inLab: false, chapters: 6, kills: 100, unlocked: [], ...over,
});
const resolve = (over: Partial<EndingCtx>) => resolveEnding(ctx(over));

describe('M15 多结局', () => {
  it('8 个结局，字段齐全、正文够长', () => {
    expect(ENDINGS.length).toBe(8);
    for (const e of ENDINGS) {
      expect(e.id).toMatch(/^[a-z_]+$/);
      expect(e.title.length).toBeGreaterThan(1);
      expect(e.sub.length).toBeGreaterThan(4);
      expect(e.tag).toContain('结局');
      expect(e.tip.length).toBeGreaterThan(6);
      expect(e.text.length).toBeGreaterThanOrEqual(3);
      for (const t of e.text) expect(t.length).toBeGreaterThanOrEqual(10);
    }
    expect(new Set(ENDINGS.map(e => e.id)).size).toBe(ENDINGS.length);
  });

  it('判定矩阵：四种收束 × 抉择倾向 → 命中预期的那一个', () => {
    const keep = { ch1: 'keep', ch3: 'own', ch5: 'tape' };
    const share = { ch1: 'share', ch3: 'hand', ch5: 'air' };
    // 通关
    expect(resolve({ kind: 'won', choices: keep }).id).toBe('alone');
    expect(resolve({ kind: 'won', choices: share }).id).toBe('dawn');
    // 救援
    expect(resolve({ kind: 'rescue', choices: keep }).id).toBe('rescue');
    expect(resolve({ kind: 'rescue', choices: { ch1: 'keep', ch3: 'own', ch5: 'air' } }).id).toBe('keeper');
    // 死亡
    expect(resolve({ kind: 'dead', inLab: true }).id).toBe('martyr');
    expect(resolve({ kind: 'dead', inLab: false }).id).toBe('ash');
    // 无尽
    expect(resolve({ kind: 'endless', day: 120 }).id).toBe('endless');
    expect(resolve({ kind: 'endless', day: 150 }).id).toBe('wanderer');
    expect(resolve({ kind: 'endless', day: 300 }).id).toBe('wanderer');
  });

  it('没有"永远触发不到"的结局：8 个都能被某个 ctx 命中', () => {
    const hit = new Set<string>();
    const choiceSets: Record<string, string>[] = [{}, { ch1: 'keep' }, { ch1: 'share' }, { ch1: 'share', ch3: 'hand' }, { ch1: 'keep', ch3: 'own', ch5: 'tape' }];
    for (const kind of ['won', 'rescue', 'dead', 'endless'] as EndingKind[]) {
      for (const choices of choiceSets) {
        for (const inLab of [true, false]) {
          for (const day of [10, 150]) {
            for (const chapters of [0, 6]) {
              hit.add(resolve({ kind, choices, inLab, day, chapters }).id);
            }
          }
        }
      }
    }
    expect([...hit].sort()).toEqual(ENDINGS.map(e => e.id).sort());
  });

  it('分享倾向：只认三个抉择里"给别人"的那一侧', () => {
    expect(SHARE_CHOICES.has('share')).toBe(true);
    expect(SHARE_CHOICES.has('keep')).toBe(false);
    expect(sharedCount({ choices: { ch1: 'share', ch3: 'own', ch5: 'air' } })).toBe(2);
    expect(isSharing(ctx({ choices: { ch1: 'share', ch3: 'hand' } }))).toBe(true);
    expect(isSharing(ctx({ choices: { ch1: 'share' } }))).toBe(false);
    expect(isSharing(ctx({ choices: {} }))).toBe(false);
    // 抉择 id 必须真的存在于 story-core 的选项里（改名了这里会红）
    const allOpts = new Set(STORY.flatMap(c => (c.choice ? c.choice.options.map(o => o.id) : [])));
    for (const id of SHARE_CHOICES) expect(allOpts, '未知选项 ' + id).toContain(id);
  });

  it('解锁记录：新结局进列表、重复不算新、野 id 被拒', () => {
    let list: string[] = [];
    let r = unlockEnding(list, 'dawn');
    expect(r.isNew).toBe(true);
    list = r.list;
    expect(list).toEqual(['dawn']);
    expect(unlockEnding(list, 'dawn').isNew).toBe(false);
    expect(unlockEnding(list, 'nope').isNew).toBe(false);
    expect(unlockEnding(list, 'nope').list).toEqual(['dawn']);
    r = unlockEnding(list, 'ash');
    expect(r.list).toEqual(['dawn', 'ash']);
  });

  it('存档过滤：只留真实 id，并按 ENDINGS 顺序排（档案列表不能乱跳）', () => {
    expect(ensureEndings(['ash', 'dawn', 7, 'nope'])).toEqual(['ash', 'dawn']);   // 顺序跟 ENDINGS 一致
    expect(ensureEndings('x')).toEqual([]);
    expect(ensureEndings(undefined)).toEqual([]);
    expect(archiveTitle(['ash', 'dawn'])).toBe('8 个结局 · 已解锁 2');
  });

  it('正文占位符会换成真实天数', () => {
    const def = endingById('ash')!;
    const lines = endingLines(def, ctx({ day: 77 }));
    expect(lines.join(' ')).toContain('第 77 天');
    expect(lines.join(' ')).not.toContain('{day}');
  });

  it('同一类收束的两种结局文案不同（不是换个标题糊弄）', () => {
    const pairs = [['dawn', 'alone'], ['rescue', 'keeper'], ['martyr', 'ash']];
    for (const [a, b] of pairs) {
      const A = endingById(a)!, B = endingById(b)!;
      expect(A.text.join('')).not.toBe(B.text.join(''));
      expect(A.title).not.toBe(B.title);
      expect(A.tip).not.toBe(B.tip);
    }
  });
});
