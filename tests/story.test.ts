/* 「大故事」章节制剧情 + 委托奖励物品的完整性测试。
   剧情是**玩家可见的目标文本**，判定条件写错（例如指向一个本地根本不存在的 POI、
   或者要一只游戏里没有的丧尸）会让整章永远做不完——所以这里逐条查表。 */
import { describe, expect, it } from 'vitest';
import {
  STORY, STORY_LEN, chapterView, currentChapter, emptyStory, ensureStory, nextObjective, objLine,
  storyTick, archive, chapterLine,
} from '../src/v4/story-core';
import { bountyBudget, metricLabel, metricNow, rollOffers, settle, accept } from '../src/v4/contracts-core';
import { POIS } from '../src/v4/pois';
import { REGIONS } from '../src/v4/regions-core';
import { zombieIds, itemIds } from './legacy-tables';
import type { Snap } from '../src/v4/contracts-core';

const snap = (over: Partial<Snap> = {}): Snap => ({
  day: 1, kills: 0, killBy: {}, zones: {}, deep: 0, hordes: 0, nights: 0, items: {}, regions: {}, ...over,
});
const byMetric = (metric: string, n: number, day = 1): Snap => {
  const s = snap({ day });
  const i = metric.indexOf(':');
  if (i < 0) {
    if (metric === 'kills') s.kills = n; else if (metric === 'deep') s.deep = n;
    else if (metric === 'hordes') s.hordes = n; else if (metric === 'nights') s.nights = n;
  } else {
    const kind = metric.slice(0, i), key = metric.slice(i + 1);
    if (kind === 'killBy') s.killBy[key] = n; else if (kind === 'zone') s.zones[key] = n;
    else if (kind === 'region') s.regions[key] = n;
  }
  return s;
};
/** 把若干指标一起灌进一个快照（一章的目标可能跨好几种指标） */
const withAll = (pairs: [string, number][], day = 1): Snap => {
  const s = snap({ day });
  const out: Snap = { ...s };
  for (const [m, n] of pairs) {
    const one = byMetric(m, n, day);
    out.kills = Math.max(out.kills, one.kills); out.deep = Math.max(out.deep, one.deep);
    out.hordes = Math.max(out.hordes, one.hordes); out.nights = Math.max(out.nights, one.nights);
    Object.assign(out.killBy, one.killBy); Object.assign(out.zones, one.zones); Object.assign(out.regions, one.regions);
  }
  return out;
};

describe('大故事（章节）', () => {
  it('6 章，编号连续，字段齐全', () => {
    expect(STORY_LEN).toBe(6);
    STORY.forEach((c, i) => {
      expect(c.no).toBe(i + 1);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.intro.length).toBeGreaterThan(20);          // 开场叙事不能是一句话糊弄
      expect(c.outro.length).toBeGreaterThan(20);
      expect(c.objs.length).toBeGreaterThanOrEqual(2);
      expect(c.reward.mat).toBeGreaterThan(0);
    });
  });

  it('章节发生地都是真实区域，且中途确实要跑别的区（大世界用得上）', () => {
    const ids = REGIONS.map(r => r.id);
    for (const c of STORY) expect(ids).toContain(c.region);
    const away = STORY.filter(c => c.region !== 'ember');
    expect(away.length).toBeGreaterThanOrEqual(2);
    // 跨区章必须带 region: 目标，否则"去别的区"这件事根本没判定
    for (const c of away) expect(c.objs.some(o => String(o.metric).startsWith('region:'))).toBe(true);
  });

  it('目标指向的 POI 与丧尸都真实存在（写错名字 = 这章永远做不完）', () => {
    const zs = zombieIds(), its = itemIds();
    for (const c of STORY) {
      if (c.reward.item) expect(its, '奖励物品 ' + c.reward.item).toContain(c.reward.item);
      for (const o of c.objs) {
        const m = String(o.metric);
        if (m.startsWith('zone:')) expect(Object.keys(POIS), m).toContain(m.slice(5));
        if (m.startsWith('killBy:')) expect(zs, m).toContain(m.slice(7));
        if (m.startsWith('region:')) expect(REGIONS.map(r => r.id), m).toContain(m.slice(7));
        expect(o.need).toBeGreaterThan(0);
        expect(o.hint.length).toBeGreaterThan(0);          // 每条目标都要告诉玩家去哪做
      }
    }
  });

  it('委托模板里的奖励物品也必须在 legacy 的 ITEMS 里', () => {
    const its = itemIds();
    for (const day of [1, 4, 9, 20]) {
      for (const o of rollOffers(day, Math.random, 3)) {
        if (o.reward.item) expect(its, '委托 ' + o.title + ' 的奖励 ' + o.reward.item).toContain(o.reward.item);
      }
    }
  });

  it('主线阶段不够时章节不开放；够 + 目标全达成 → 推进并发奖', () => {
    const st = emptyStory();
    const ch1 = STORY[0];
    const all: [string, number][] = ch1.objs.map(o => [String(o.metric), o.need]);

    // 只做目标、主线阶段不到 → 卡住
    let r = storyTick(st, withAll(all), 0);
    expect(ch1.stage).toBe(0);
    expect(r.advanced.length).toBe(1);                      // 第 1 章 stage 门槛就是 0，直接过
    expect(st.chapter).toBe(1);

    // 第 2 章要 stage>=1：目标做完但 stage 不够 → 不推进
    const before = st.chapter;
    const ch2all: [string, number][] = STORY[1].objs.map(o => [String(o.metric), o.need]);
    r = storyTick(st, withAll(all.concat(ch2all)), 0);
    expect(st.chapter).toBe(before);
    expect(r.advanced.length).toBe(0);

    // 阶段补上 → 推进
    r = storyTick(st, withAll(all.concat(ch2all)), 1);
    expect(r.advanced.map(c => c.no)).toContain(2);
    expect(r.reward.mat).toBeGreaterThan(0);
    expect(st.log.length).toBeGreaterThanOrEqual(2);
  });

  it('可以一次推多章（回到老档/一口气做完也不卡住）', () => {
    const st = emptyStory();
    const pairs: [string, number][] = [];
    for (const c of STORY.slice(0, 4)) for (const o of c.objs) pairs.push([String(o.metric), o.need]);
    const r = storyTick(st, withAll(pairs, 12), 5);
    expect(st.chapter).toBe(4);
    expect(r.advanced.length).toBe(4);
    expect(r.messages.length).toBeGreaterThanOrEqual(4);
    expect(r.reward.mat).toBe(STORY.slice(0, 4).reduce((s, c) => s + (c.reward.mat ?? 0), 0));
  });

  it('全部完成后不再重复发奖（幂等）', () => {
    const st = emptyStory();
    const pairs: [string, number][] = [];
    for (const c of STORY) for (const o of c.objs) pairs.push([String(o.metric), o.need]);
    const snapAll = withAll(pairs, 30);
    const first = storyTick(st, snapAll, 5);
    expect(st.chapter).toBe(STORY_LEN);
    const second = storyTick(st, snapAll, 5);
    expect(second.advanced.length).toBe(0);
    expect(second.reward.mat ?? 0).toBe(0);
    expect(first.reward.mat).toBeGreaterThan(100);
  });

  it('章节视图：当前章/已过章/未解锁章的标记正确，目标进度会封顶', () => {
    const st = { chapter: 1, done: [], log: [] };
    const v0 = chapterView(0, st, snap(), 0);
    expect(v0.passed).toBe(true);
    const v1 = chapterView(1, st, byMetric(String(STORY[1].objs[0].metric), 99), 5);
    expect(v1.isCurrent).toBe(true);
    expect(v1.objs[0].cur).toBe(v1.objs[0].def.need);      // 封顶
    expect(v1.objs[0].done).toBe(true);
    expect(v1.complete).toBe(false);                        // 还有别的目标
    const v2 = chapterView(2, st, snap(), 5);
    expect(v2.locked).toBe(true);
  });

  it('nextObjective 会指出下一个没做的目标（或主线门槛）', () => {
    const st = emptyStory();
    const line = nextObjective(st, snap(), 0);
    expect(line).toContain(STORY[0].objs[0].text);
    expect(line).toContain('0/');
    // 第 2 章目标做完但主线阶段没到 → nextObjective 必须告诉玩家卡在主线哪里
    expect(nextObjective({ chapter: 1, done: [], log: [] }, byMetric(String(STORY[1].objs[0].metric), 9), 0)).toContain('主线');
  });

  it('存档修复：坏档不会把 chapter 顶出界，日志能过滤', () => {
    expect(ensureStory(undefined).chapter).toBe(0);
    expect(ensureStory({ chapter: 99, done: 'x', log: [{ day: 'a', text: 5 }] }).chapter).toBe(STORY_LEN);
    const ok = ensureStory({ chapter: 2, done: ['ch1a', 7], log: [{ day: 3, ch: 1, title: '余烬', text: '记录' }] });
    expect(ok.chapter).toBe(2);
    expect(ok.done).toEqual(['ch1a']);
    expect(archive(ok).length).toBe(1);
  });

  it('文案：目标行带进度勾，章节行带 x/y 目标', () => {
    const st = emptyStory();
    const v = chapterView(0, st, snap(), 0);
    expect(objLine(v.objs[0])).toMatch(/\d+\/\d+/);
    expect(objLine(v.objs[0])).not.toContain('✅');
    expect(chapterLine(v)).toContain('第 1 章');
    expect(chapterLine(v)).toContain('0/' + v.objs.length);
  });

  it('剧情指标与委托系统共用同一套翻译（不会出现两种说法）', () => {
    for (const c of STORY) for (const o of c.objs) {
      expect(metricLabel(o.metric).length).toBeGreaterThan(0);
      expect(metricNow(o.metric, snap())).toBe(0);
    }
  });
});

describe('委托与剧情的联动', () => {
  it('委托结算给的奖励能落进同一套计数器（不会和剧情抢指标）', () => {
    // 剧情要 kills>=6：接一张击杀委托并完成，killBy/kills 计数是同一份快照
    const offers = rollOffers(2, Math.random, 0);
    const killOffer = offers.find(o => o.metric === 'kills') || offers[0];
    const st = { day: 2, board: offers, active: [], done: 0, failed: 0, log: [] as string[] };
    accept(st, killOffer.key, snap({ day: 2 }));
    const res = settle(st, byMetric(killOffer.metric, killOffer.need, 3));
    expect(res.completed.length).toBe(1);
    expect(res.matGain).toBe(killOffer.reward.mat ?? 0);
    expect(res.matGain).toBeLessThanOrEqual(bountyBudget(2));
  });
});
