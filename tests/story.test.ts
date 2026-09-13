/* 「大故事」章节制剧情 + 委托奖励物品的完整性测试。
   剧情是**玩家可见的目标文本**，判定条件写错（例如指向一个本地根本不存在的 POI、
   或者要一只游戏里没有的丧尸）会让整章永远做不完——所以这里逐条查表。 */
import { describe, expect, it } from 'vitest';
import {
  STORY, STORY_LEN, chapterView, currentChapter, emptyStory, ensureStory, introOf, nextObjective, objLine,
  storyTick, choose, archive, chapterLine,
} from '../src/v4/story-core';
import { bountyBudget, metricLabel, metricNow, rollOffers, settle, accept } from '../src/v4/contracts-core';
import { POIS } from '../src/v4/pois';
import { REGIONS } from '../src/v4/regions-core';
import { zombieIds, itemIds } from './legacy-tables';
import type { Snap } from '../src/v4/contracts-core';

const snap = (over: Partial<Snap> = {}): Snap => ({
  day: 1, kills: 0, killBy: {}, zones: {}, deep: 0, hordes: 0, nights: 0, items: {}, regions: {}, rzones: {}, ...over,
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
    else if (kind === 'rzone') {
      const j = key.indexOf(':');
      const region = key.slice(0, j), poi = key.slice(j + 1);
      s.rzones[region] = { [poi === '*' ? 'market' : poi]: n };
    }
    else if (kind === 'rtype') {                                        // M17：第 4/5 章改成"到访某类型区域"
      const r = REGIONS.find(x => x.type === key);
      if (r) s.regions[r.id] = n;
    }
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
    for (const r in one.rzones) out.rzones[r] = { ...(out.rzones[r] || {}), ...one.rzones[r] };
  }
  return out;
};
/** 前 n 章的所有目标指标（含跨章累加） */
const pairsUpTo = (n: number): [string, number][] => {
  const pairs: [string, number][] = [];
  for (const c of STORY.slice(0, n)) for (const o of c.objs) pairs.push([String(o.metric), o.need]);
  return pairs;
};
/** 推进（自动替玩家做抉择，取第 idx 个选项）——测"能推多远"时用它 */
const pushAll = (st: ReturnType<typeof emptyStory>, snapAll: Snap, stage: number, optIdx = 0) => {
  const r = storyTick(st, snapAll, stage);
  let guard = 0;
  while (r.awaiting && guard++ < STORY_LEN) {
    const def = r.awaiting;
    choose(st, def.id, def.choice!.options[optIdx].id, snapAll, stage);
    const again = storyTick(st, snapAll, stage);
    if (!again.awaiting) break;
    r.awaiting = again.awaiting;
  }
  return st;
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

  it('章节发生地都是真实的区域类型，且中途确实要跑别的区（大世界用得上）', () => {
    const types = new Set(REGIONS.map(r => r.type));
    for (const c of STORY) expect(types, '未知类型 ' + c.regionType).toContain(c.regionType);
    const away = STORY.filter(c => c.regionType !== 'core');
    expect(away.length).toBeGreaterThanOrEqual(2);
    // 跨区章必须带 rtype: 目标（M17：元地图程序化生成，只能说"去一片工业区"）
    for (const c of away) expect(c.objs.some(o => String(o.metric).startsWith('rtype:'))).toBe(true);
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

    // 第 1 章目标做完：有抉择 → 停下来等选（不选不推进、也不发奖）
    let r = storyTick(st, withAll(all), 0);
    expect(ch1.stage).toBe(0);
    expect(r.awaiting?.id).toBe('ch1');
    expect(st.chapter).toBe(0);
    expect(r.advanced.length).toBe(0);
    // 选完才推进并拿到"基础 + 选项"奖励
    const ch = choose(st, 'ch1', ch1.choice!.options[0].id, withAll(all), 0);
    expect(ch.ok).toBe(true);
    expect(st.chapter).toBe(1);
    expect(ch.reward.mat).toBe((ch1.reward.mat ?? 0) + (ch1.choice!.options[0].reward.mat ?? 0));
    expect(st.choices.ch1).toBe(ch1.choice!.options[0].id);
    expect(st.log.some(e => e.text === ch1.choice!.options[0].consequence)).toBe(true);

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

  it('抉择：没选完不给推进、不能重复选、选错章节/选项会被拒', () => {
    const st = emptyStory();
    const snapAll = withAll(pairsUpTo(3), 9);
    const r = storyTick(st, snapAll, 5);
    expect(r.awaiting?.id).toBe('ch1');
    expect(st.chapter).toBe(0);
    expect(choose(st, 'ch1', 'nope', snapAll, 5).ok).toBe(false);          // 不存在的选项
    expect(choose(st, 'ch3', STORY[2].choice!.options[0].id, snapAll, 5).ok).toBe(false);   // 还不是这一章
    expect(choose(st, 'ch1', STORY[0].choice!.options[1].id, snapAll, 5).ok).toBe(true);
    expect(st.chapter).toBeGreaterThanOrEqual(1);
    expect(choose(st, 'ch1', STORY[0].choice!.options[0].id, snapAll, 5).ok).toBe(false);   // 已经选过
  });

  it('分支：上一章的抉择会换掉下一章的开场叙事', () => {
    const a = emptyStory(), b = emptyStory();
    const snapAll = withAll(pairsUpTo(2), 9);
    storyTick(a, snapAll, 5); choose(a, 'ch1', 'keep', snapAll, 5);
    storyTick(b, snapAll, 5); choose(b, 'ch1', 'share', snapAll, 5);
    const ch2 = STORY[1];
    expect(introOf(ch2, a)).toBe(ch2.introBy!.keep);
    expect(introOf(ch2, b)).toBe(ch2.introBy!.share);
    expect(introOf(ch2, a)).not.toBe(introOf(ch2, b));
    // 没做过抉择 → 用默认开场（老档/新档都安全）
    expect(introOf(ch2, emptyStory())).toBe(ch2.intro);
  });

  it('每个抉择选项的奖励物品都真实存在，且两边的取舍不同（不是换个名字）', () => {
    const its = itemIds();
    for (const c of STORY) {
      if (!c.choice) continue;
      expect(c.choice.options.length).toBeGreaterThanOrEqual(2);
      const sigs = c.choice.options.map(o => {
        if (o.reward.item) expect(its, o.reward.item).toContain(o.reward.item);
        expect(o.label.length).toBeGreaterThan(2);
        expect(o.note.length).toBeGreaterThan(4);
        expect(o.consequence.length).toBeGreaterThan(10);
        return (o.reward.mat ?? 0) + '|' + (o.reward.item ?? '-');
      });
      expect(new Set(sigs).size).toBe(sigs.length);            // 两个选项的收益不能完全一样
    }
  });

  it('可以一次推多章（回到老档/一口气做完也不卡住）', () => {
    const st = emptyStory();
    pushAll(st, withAll(pairsUpTo(4), 12), 5);
    expect(st.chapter).toBe(4);
    expect(st.log.length).toBeGreaterThanOrEqual(4);
  });

  it('全部完成后不再重复发奖（幂等）', () => {
    const st = emptyStory();
    const snapAll = withAll(pairsUpTo(STORY_LEN), 30);
    pushAll(st, snapAll, 5);
    expect(st.chapter).toBe(STORY_LEN);
    const second = storyTick(st, snapAll, 5);
    expect(second.advanced.length).toBe(0);
    expect(second.reward.mat ?? 0).toBe(0);
    expect(second.awaiting).toBeUndefined();
    // 抉择奖励也拿过：材料总量 = 各章基础 + 各章所选项
    const base = STORY.reduce((s, c) => s + (c.reward.mat ?? 0), 0);
    const opts = STORY.reduce((s, c) => s + (c.choice ? c.choice.options[0].reward.mat ?? 0 : 0), 0);
    expect(base + opts).toBeGreaterThan(150);
  });

  it('章节视图：当前章/已过章/未解锁章的标记正确，目标进度会封顶', () => {
    const st = { chapter: 1, done: [], log: [], choices: {} };
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

  it('nextObjective 会指出下一个没做的目标（或主线门槛/待抉择）', () => {
    const st = emptyStory();
    const line = nextObjective(st, snap(), 0);
    expect(line).toContain(STORY[0].objs[0].text);
    expect(line).toContain('0/');
    // 第 2 章目标做完但主线阶段没到 → nextObjective 必须告诉玩家卡在主线哪里
    expect(nextObjective({ chapter: 1, done: [], log: [], choices: {} }, byMetric(String(STORY[1].objs[0].metric), 9), 0)).toContain('主线');
    // 目标做完但有抉择 → 提示去做决定，而不是显示"已经齐了"
    const done1 = withAll(pairsUpTo(1));
    expect(nextObjective(emptyStory(), done1, 5)).toContain('决定');
  });

  it('存档修复：坏档不会把 chapter 顶出界，日志与抉择能过滤', () => {
    expect(ensureStory(undefined).chapter).toBe(0);
    expect(ensureStory({ chapter: 99, done: 'x', log: [{ day: 'a', text: 5 }] }).chapter).toBe(STORY_LEN);
    const ok = ensureStory({ chapter: 2, done: ['ch1a', 7], log: [{ day: 3, ch: 1, title: '余烬', text: '记录' }] });
    expect(ok.chapter).toBe(2);
    expect(ok.done).toEqual(['ch1a']);
    expect(archive(ok).length).toBe(1);
    // 抉择记录：野键/野选项被剔掉，合法条目留着（老档没有这个字段 → 补空表）
    const c = ensureStory({ chapter: 1, done: [], log: [], choices: { ch1: 'keep', ch9: 'x', ch3: 'nope' } });
    expect(c.choices).toEqual({ ch1: 'keep' });
    expect(ensureStory({ chapter: 0, done: [], log: [] }).choices).toEqual({});
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
