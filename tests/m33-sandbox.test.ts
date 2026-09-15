/* M33 教程沙盒（分章练习）单测：章节表 / 目标判定 / 快照清洗 / 进度读写 / iframe 地址 / 分岔识别。
 * 这里只测纯逻辑（sandbox-core），DOM 与 iframe 生命周期由 docs/_m33_probe.mjs 在真浏览器里验。 */
import { describe, expect, it } from 'vitest';
import {
  LAB_CHAPTERS, LAB_KEY, SURVIVAL_PRESET, chapterById, evalChapter, isDone, labFromSearch, labStateOf,
  markDone, mergeSticky, parseProgress, progressLine, sandboxUrl, serializeProgress, snapOf, type LabSnap,
} from '../src/v4/sandbox-core';

const snap = (over: Partial<LabSnap> = {}): LabSnap => ({
  day: 1, hp: 100, hun: 62, thi: 58, ap: 14, scav: 0, deep: 0, crafted: 0, kills: 0, meleeKills: 0,
  loc: 'base', over: false, inv: {}, ...over,
});

const CH1 = chapterById('survival')!;

describe('章节表', () => {
  it('第一批只放第 1 章可玩，且它有目标（其余 5 章明确标"下一批"）', () => {
    expect(LAB_CHAPTERS.length).toBe(6);
    expect(LAB_CHAPTERS.filter(c => c.ready).map(c => c.id)).toEqual(['survival']);
    expect(CH1.objectives.length).toBeGreaterThanOrEqual(3);
    for (const c of LAB_CHAPTERS) {
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.desc.length).toBeGreaterThan(0);
      if (!c.ready) expect(c.objectives).toEqual([]);          // 没做的章节不许留"半截目标"
    }
    expect(new Set(LAB_CHAPTERS.map(c => c.id)).size).toBe(6);
  });

  it('第 1 章的沙盒预设：固定种子 + 开局不是满饱食（否则"吃饱喝足"这条一开始就是绿的）', () => {
    expect(SURVIVAL_PRESET.seed).toBe('lab-survival-01');
    expect(SURVIVAL_PRESET.day).toBe(1);
    expect(SURVIVAL_PRESET.hun).toBeLessThan(80);
    expect(SURVIVAL_PRESET.thi).toBeLessThan(80);
    expect(SURVIVAL_PRESET.inv.crowbar).toBeGreaterThan(0);    // 得有把近战武器，不然出门就死
    expect(SURVIVAL_PRESET.inv.can || SURVIVAL_PRESET.inv.water).toBeTruthy();
    expect(labStateOf('survival').seed).toBe(SURVIVAL_PRESET.seed);
    expect(labStateOf('不存在的章节').preset.seed).toBe(SURVIVAL_PRESET.seed);   // 兜底回第 1 章
  });
});

describe('目标判定（全绿才算过）', () => {
  it('开局快照：0/4，没过', () => {
    const ev = evalChapter(CH1, snap());
    expect(ev.green).toBe(0); expect(ev.total).toBe(4); expect(ev.passed).toBe(false);
  });

  it('逐条判绿：搜刮 2 次 / 深度搜索 1 次 / 吃饱喝足 / 睡到第 2 天', () => {
    expect(evalChapter(CH1, snap({ scav: 2 })).items.find(i => i.id === 'scav2')!.done).toBe(true);
    expect(evalChapter(CH1, snap({ scav: 1 })).items.find(i => i.id === 'scav2')!.done).toBe(false);
    expect(evalChapter(CH1, snap({ deep: 1 })).items.find(i => i.id === 'deep1')!.done).toBe(true);
    expect(evalChapter(CH1, snap({ hun: 80, thi: 79 })).items.find(i => i.id === 'feed')!.done).toBe(false);
    expect(evalChapter(CH1, snap({ hun: 80, thi: 80 })).items.find(i => i.id === 'feed')!.done).toBe(true);
    expect(evalChapter(CH1, snap({ day: 2 })).items.find(i => i.id === 'sleep')!.done).toBe(true);
  });

  it('三条绿一条没绿 → 还是没过（这正是"目标清单全绿"的口径）', () => {
    const ev = evalChapter(CH1, snap({ scav: 3, deep: 1, hun: 90, thi: 90 }));
    expect(ev.green).toBe(3); expect(ev.passed).toBe(false);
    const all = evalChapter(CH1, snap({ scav: 3, deep: 1, hun: 90, thi: 90, day: 2 }));
    expect(all.passed).toBe(true); expect(all.green).toBe(all.total);
  });

  it('没有快照（iframe 还没 boot）一律判未完成，不抛错', () => {
    const ev = evalChapter(CH1, null);
    expect(ev.green).toBe(0); expect(ev.passed).toBe(false); expect(ev.items.length).toBe(4);
  });

  it('勾选是单调的：吃到 80 打过勾之后，睡一觉又饿到 79 也不许把勾收回去', () => {
    const fed = evalChapter(CH1, snap({ scav: 2, deep: 1, hun: 85, thi: 90 }));
    const m1 = mergeSticky(fed, new Set<string>());
    expect(m1.ev.items.find(i => i.id === 'feed')!.done).toBe(true);
    // 睡完觉饿下去了（hun 79）——快照不再满足条件，但"达成过"要留住
    const hungry = evalChapter(CH1, snap({ scav: 2, deep: 1, hun: 79, thi: 88, day: 2 }));
    expect(hungry.items.find(i => i.id === 'feed')!.done).toBe(false);
    const m2 = mergeSticky(hungry, m1.sticky);
    expect(m2.ev.items.find(i => i.id === 'feed')!.done).toBe(true);
    expect(m2.ev.passed).toBe(true);
    expect(m2.ev.green).toBe(4);
  });

  it('sticky 只记"达成过"的 id，不认识的 id 不会平白判绿', () => {
    const m = mergeSticky(evalChapter(CH1, snap()), new Set(['瞎写的']));
    expect(m.ev.green).toBe(0);
    expect(m.ev.passed).toBe(false);
  });
});

describe('快照清洗（iframe 里出来的东西一律当不可信输入）', () => {
  it('只带出需要的字段，背包去掉 0 与坏值', () => {
    const s = snapOf({ day: 3, hp: 88, hun: 70, thi: 66, ap: 9, loc: 's1', over: false,
      stats: { scav: 2, deep: 1, crafted: 5, kills: 4, meleeKills: 2 }, inv: { can: 2, water: 0, bad: -3, x: NaN } });
    expect(s).toMatchObject({ day: 3, scav: 2, deep: 1, crafted: 5, kills: 4, loc: 's1', over: false });
    expect(s.inv).toEqual({ can: 2 });
  });

  it('空对象 / 垃圾输入不炸（缺字段给安全默认）', () => {
    expect(snapOf(null)).toMatchObject({ day: 1, hp: 0, over: false });
    expect(snapOf({ day: 'x', stats: 'nope', inv: 7 }).day).toBe(1);
    expect(snapOf({ over: 1 }).over).toBe(true);
  });
});

describe('进度（存父页面，不进 iframe、不进存档）', () => {
  it('坏偏好/空偏好 → 空进度', () => {
    expect(parseProgress(null)).toEqual({ done: {} });
    expect(parseProgress('not json')).toEqual({ done: {} });
    expect(parseProgress('{"done":{"survival":0,"x":-2}}')).toEqual({ done: {} });
  });

  it('往返 + 第一次通关的时间戳不被覆盖', () => {
    const p0 = parseProgress(null);
    const p1 = markDone(p0, 'survival', 111);
    const p2 = markDone(p1, 'survival', 999);
    expect(p2.done.survival).toBe(111);
    expect(isDone(p2, 'survival')).toBe(true);
    expect(isDone(p2, 'combat')).toBe(false);
    expect(parseProgress(serializeProgress(p2)).done).toEqual({ survival: 111 });
    expect(LAB_KEY).toBe('zsv-lab-v1');
  });

  it('进度摘要按"可玩章节"算（下一批那 5 章不计入分母）', () => {
    expect(progressLine(parseProgress(null))).toBe('已通关 0 / 1 章（第 1 批）');
    expect(progressLine(markDone(parseProgress(null), 'survival', 1))).toBe('已通关 1 / 1 章（第 1 批）');
  });
});

describe('iframe 地址与沙盒分岔', () => {
  it('沙盒地址丢掉父页面的查询串，只把 dev 带进去（探针要在沙盒里用 DEV）', () => {
    expect(sandboxUrl('https://x/games/zombie-survival/?dev=ready', 'survival'))
      .toBe('https://x/games/zombie-survival/?sandbox=1&ch=survival&dev=ready');
    expect(sandboxUrl('https://x/games/zombie-survival/?foo=1&bar=2', 'survival'))
      .toBe('https://x/games/zombie-survival/?sandbox=1&ch=survival');
    expect(sandboxUrl('http://127.0.0.1:8791/#hash', 'combat')).toBe('http://127.0.0.1:8791/?sandbox=1&ch=combat');
  });

  it('只有 ?sandbox=1 才算沙盒；章节名不认识就回第 1 章', () => {
    expect(labFromSearch('?sandbox=1&ch=combat')).toEqual({ ch: 'combat' });
    expect(labFromSearch('?sandbox=1')).toEqual({ ch: 'survival' });
    expect(labFromSearch('?sandbox=1&ch=瞎写的')).toEqual({ ch: 'survival' });
    expect(labFromSearch('?dev=ready')).toBeNull();
    expect(labFromSearch('')).toBeNull();
  });
});
