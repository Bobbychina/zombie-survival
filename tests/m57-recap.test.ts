/* M57：死亡结算的纯逻辑单测（死因归类 / 瞬间 / 建议 / 历史最好） */
import { describe, expect, it } from 'vitest';
import { adviceOf, bestLine, causeOfDeath, highlightsOf, mergeBest, type RecapState } from '../src/v4/recap-core';

const state = (over: Partial<RecapState> = {}): RecapState => ({
  day: 10, hp: 0, hun: 70, thi: 65, infect: 0, rad: 0, mat: 5, wounds: [], loc: 'oldtown',
  stats: { kills: 12, meleeKills: 4, apKills: 1, scav: 20, deep: 3, hordes: 2 }, visited: 14, regions: 1, lore: 3, baseLv: 5, score: 380,
  ...over,
});

describe('死因归类（文案优先，身体状态兜底）', () => {
  it('失血：文案提到"流干了最后一滴血"', () => {
    const c = causeOfDeath('你在废墟里流干了最后一滴血。', state());
    expect(c.id).toBe('bleed');
    expect(c.label).toContain('失血');
    expect(c.fixes.join(' ')).toMatch(/绷带/);
  });

  it('尸潮：撤离时被淹没 / 搜刮时被吞掉', () => {
    expect(causeOfDeath('你在撤离时被尸潮淹没了。', state()).id).toBe('horde');
    expect(causeOfDeath('你在搜刮时被这一带彻底吞掉了。', state()).id).toBe('horde');
    expect(causeOfDeath('你在撤离时被尸潮淹没了。', state()).fixes.join(' ')).toMatch(/引诱器|烟雾|守夜/);
  });

  it('饥渴：文案或状态里饱食/水分见底', () => {
    expect(causeOfDeath('伤口与饥饿在夜里一起收走了你。', state()).id).toBe('starve');
    expect(causeOfDeath('你的身体先一步投降了。', state({ hun: 0 })).id).toBe('starve');
    expect(causeOfDeath('随便什么', state({ thi: 0 })).id).toBe('starve');
  });

  it('感染与辐射：按状态阈值判定，建议里带对应药品', () => {
    expect(causeOfDeath('', state({ infect: 100 })).id).toBe('infect');
    expect(causeOfDeath('', state({ infect: 100 })).fixes.join(' ')).toMatch(/抗生素/);
    expect(causeOfDeath('', state({ rad: 80 })).id).toBe('rad');
    expect(causeOfDeath('', state({ rad: 80 })).fixes.join(' ')).toMatch(/碘片|防毒面具/);
  });

  it('死在实验室：有专门的收束与建议', () => {
    const c = causeOfDeath('', state({ loc: 'lab' }));
    expect(c.id).toBe('lab');
    expect(c.fixes.join(' ')).toMatch(/防毒面具|防化服/);
  });

  it('兜底：都不匹配时给"伤重不治"，也必须有建议（不许空着）', () => {
    const c = causeOfDeath('', state());
    expect(c.id).toBe('unknown');
    expect(c.fixes.length).toBeGreaterThan(0);
  });

  it('三类都带"怎么发生的"一句话（玩家要看得懂）', () => {
    for (const msg of ['你在废墟里流干了最后一滴血。', '你在撤离时被尸潮淹没了。', '伤口与饥饿在夜里一起收走了你。']) {
      const c = causeOfDeath(msg, state());
      expect(c.how.length).toBeGreaterThan(4);
      expect(c.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('这一局的瞬间', () => {
  it('有料的才上：击杀/守夜/走路/搜刮/据点/秘闻', () => {
    const h = highlightsOf(state());
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(h.length).toBeLessThanOrEqual(4);
    expect(h.map(x => x.text).join(' ')).toMatch(/击杀 12/);
    expect(h.map(x => x.text).join(' ')).toMatch(/夜袭/);
  });

  it('空白档案也给一条像样的话（不许空列表）', () => {
    const h = highlightsOf(state({ stats: {}, visited: 0, regions: 1, lore: 0, baseLv: 0 }));
    expect(h.length).toBe(1);
    expect(h[0].text).toMatch(/第 10 天/);
  });

  it('跨大区时才写"跨过 N 个大区"', () => {
    expect(highlightsOf(state({ regions: 3 })).map(x => x.text).join(' ')).toMatch(/跨过 3 个大区/);
    expect(highlightsOf(state({ regions: 1 })).map(x => x.text).join(' ')).not.toMatch(/跨过/);
  });
});

describe('下次怎么做（带数字，不是空话）', () => {
  it('死因建议在前，最多三条', () => {
    const c = causeOfDeath('你在废墟里流干了最后一滴血。', state());
    const a = adviceOf(c, state({ hun: 10, mat: 60, day: 20, baseLv: 1 }));
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a[0]).toContain('随身带 2 卷绷带');
    expect(a.join(' ')).toMatch(/饱食只有 10/);
    expect(a.join(' ')).toMatch(/材料没花/);
  });

  it('开局就死（第 2 天、据点 0 级）不会硬塞"据点等级"那条', () => {
    const c = causeOfDeath('', state());
    const a = adviceOf(c, state({ day: 2, baseLv: 0, mat: 0, hun: 60 }));
    expect(a.join(' ')).not.toMatch(/据点才/);
  });
});

describe('历史最好：三项分别比，破了就记新纪录', () => {
  it('第一次死：三项全是新纪录', () => {
    const { best, improved } = mergeBest(null, { score: 380, days: 10, kills: 12 });
    expect(best).toEqual({ score: 380, days: 10, kills: 12 });
    expect(improved.sort()).toEqual(['days', 'kills', 'score']);
  });

  it('只破一项：只更新那一项', () => {
    const { best, improved } = mergeBest({ score: 500, days: 10, kills: 12 }, { score: 380, days: 14, kills: 3 });
    expect(best).toEqual({ score: 500, days: 14, kills: 12 });
    expect(improved).toEqual(['days']);
  });

  it('全没破：最好记录原样保留', () => {
    const { best, improved } = mergeBest({ score: 500, days: 20, kills: 30 }, { score: 100, days: 3, kills: 1 });
    expect(best).toEqual({ score: 500, days: 20, kills: 30 });
    expect(improved).toEqual([]);
  });

  it('一行文案能同时表达"本档 / 最好"和"新纪录（旧 X）"', () => {
    const prev = { score: 500, days: 10, kills: 12 };
    const { best, improved } = mergeBest(prev, { score: 380, days: 14, kills: 3 });
    const line = bestLine({ score: 380, days: 14, kills: 3 }, prev, improved);
    expect(line).toContain('天数 14 🏆新纪录（旧 10）');
    expect(line).toContain('评分 380 / 最好 500');
    expect(line).toContain('击杀 3 / 最好 12');
    expect(best.days).toBe(14);
  });

  it('第一次死（没有旧记录）：新纪录里写"旧 0"，不出现 undefined', () => {
    const { best, improved } = mergeBest(null, { score: 100, days: 3, kills: 2 });
    const line = bestLine({ score: 100, days: 3, kills: 2 }, null, improved);
    expect(line).toContain('天数 3 🏆新纪录（旧 0）');
    expect(line).not.toContain('undefined');
    expect(best.score).toBe(100);
  });
});
