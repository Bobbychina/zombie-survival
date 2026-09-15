/* M33 教程沙盒（分章练习）单测：章节表 / 目标判定 / 快照清洗 / 进度读写 / iframe 地址 / 分岔识别。
 * 这里只测纯逻辑（sandbox-core），DOM 与 iframe 生命周期由 docs/_m33_probe.mjs 在真浏览器里验。 */
import { describe, expect, it } from 'vitest';
import {
  BAG_PRESET, BASE_PRESET, COMBAT_PRESET, LAB_CHAPTERS, LAB_KEY, MEDICAL_PRESET, SURVIVAL_PRESET, WORLD_PRESET,
  chapterById, evalChapter, isDone, labFromSearch, labStateOf, markDone, mergeSticky, parseProgress, progressLine,
  sandboxUrl, serializeProgress, snapOf, type LabSnap,
} from '../src/v4/sandbox-core';

const snap = (over: Partial<LabSnap> = {}): LabSnap => ({
  day: 1, hp: 100, hun: 62, thi: 58, ap: 14, scav: 0, deep: 0, crafted: 0, kills: 0, meleeKills: 0, ammoUsed: 0,
  loc: 'base', over: false, inv: {}, load: {}, injuries: [], base: {}, steps: 0, visited: 1, regions: 1, invKinds: 1,
  veh: false,
  ...over,
});

const CH1 = chapterById('survival')!;
const CH2 = chapterById('combat')!;
const CH3 = chapterById('medical')!;
const CH4 = chapterById('base')!;
const CH5 = chapterById('world')!;
const CH6 = chapterById('bag')!;

describe('章节表', () => {
  it('六章全部可玩，各自都有目标（没有半截章节）', () => {
    expect(LAB_CHAPTERS.length).toBe(6);
    expect(LAB_CHAPTERS.filter(c => c.ready).map(c => c.id)).toEqual(['survival', 'combat', 'medical', 'base', 'world', 'bag']);
    for (const c of LAB_CHAPTERS) {
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.desc.length).toBeGreaterThan(0);
      expect(c.objectives.length).toBeGreaterThanOrEqual(3);
      expect(new Set(c.objectives.map(o => o.id)).size).toBe(c.objectives.length);   // 目标 id 不许重名
      expect(c.preset.seed).toMatch(/^lab-/);
      expect(c.preset.ap).toBeGreaterThanOrEqual(14);
    }
    expect(new Set(LAB_CHAPTERS.map(c => c.id)).size).toBe(6);
    expect(new Set(LAB_CHAPTERS.map(c => c.preset.seed)).size).toBe(6);              // 六章种子互不相同
  });

  it('第 2 章的预设：给枪给两种 9mm 给撬棍（三条目标都做得到），种子固定', () => {
    expect(COMBAT_PRESET.seed).toBe('lab-combat-01');
    expect(COMBAT_PRESET.inv.pistol).toBe(1);
    expect(COMBAT_PRESET.inv.a9_fmj).toBeGreaterThan(0);
    expect(COMBAT_PRESET.inv.a9_ap).toBeGreaterThan(0);
    expect(COMBAT_PRESET.inv.crowbar).toBe(1);
    expect(COMBAT_PRESET.hun).toBeGreaterThanOrEqual(80);      // 这一章不该被饿肚子打断
    expect(labStateOf('combat').seed).toBe(COMBAT_PRESET.seed);
  });

  it('第 2 章的三条目标：枪杀（要真的开过枪）/ 近战杀 / 手动换弹', () => {
    const g = (s: LabSnap) => evalChapter(CH2, s).items.find(i => i.id === 'gunKill')!.done;
    expect(g(snap({ kills: 1, ammoUsed: 0 }))).toBe(false);     // 近战杀的不能被算成"用枪打死"
    expect(g(snap({ kills: 1, ammoUsed: 2 }))).toBe(true);
    const m = evalChapter(CH2, snap({ meleeKills: 1 })).items.find(i => i.id === 'meleeKill')!.done;
    expect(m).toBe(true);
    const l = (ld: Record<string, string>) => evalChapter(CH2, snap({ load: ld })).items.find(i => i.id === 'loadSwap')!.done;
    expect(l({})).toBe(false);
    expect(l({ c9: 'a9_ap' })).toBe(true);
    expect(evalChapter(CH2, snap({ kills: 1, ammoUsed: 3, meleeKills: 1, load: { c9: 'a9_fmj' } })).passed).toBe(true);
  });

  it('第 3 章「人体与伤病」：预设带两处伤，目标是"处理掉"而不是"受过伤"', () => {
    expect((MEDICAL_PRESET.injuries || []).map(i => i.id).sort()).toEqual(['bleedS', 'fracture']);
    expect(MEDICAL_PRESET.inv.bandage).toBeGreaterThan(0);     // 治出血要绷带
    expect(MEDICAL_PRESET.inv.splint).toBeGreaterThan(0);      // 上夹板要夹板
    const inj = (list: LabSnap['injuries']) => evalChapter(CH3, snap({ injuries: list }));
    const idOf = (ev: ReturnType<typeof evalChapter>, id: string) => ev.items.find(i => i.id === id)!.done;
    // 开局两条都还没处理 → 0/3
    expect(inj([{ id: 'bleedS', part: 'armR', field: false, done: false }, { id: 'fracture', part: 'legL', field: false, done: false }]).green).toBe(0);
    // 只处理了出血 → 只有那一条绿
    expect(idOf(inj([{ id: 'bleedS', part: 'armR', field: true, done: false }, { id: 'fracture', part: 'legL', field: false, done: false }]), 'bleedFix')).toBe(true);
    expect(idOf(inj([{ id: 'bleedS', part: 'armR', field: true, done: false }, { id: 'fracture', part: 'legL', field: false, done: false }]), 'splintFix')).toBe(false);
    // 康复掉了（数组里没有）也算处理过 —— 单调口径
    expect(idOf(inj([]), 'bleedFix')).toBe(true);
    expect(idOf(inj([]), 'splintFix')).toBe(true);
    // 手术过的也算（大出血要缝合包）
    expect(idOf(inj([{ id: 'bleedL', part: 'torso', field: false, done: true }]), 'bleedFix')).toBe(true);
    expect(evalChapter(CH3, snap({ injuries: [], day: 2 })).passed).toBe(true);
  });

  it('第 4 章「建造与据点」：净水装置 + 工作台 + 睡一觉', () => {
    expect(BASE_PRESET.inv.wood).toBeGreaterThanOrEqual(6);    // 材料够建两样
    expect(BASE_PRESET.inv.metal).toBeGreaterThanOrEqual(6);
    expect(BASE_PRESET.inv.tape).toBeGreaterThanOrEqual(2);    // 净水装置与工作台都要胶带（少了按钮会禁用）
    expect(BASE_PRESET.base).toBeUndefined();                  // "从零建"：不给现成设施
    const d = (base: Record<string, number>, day = 1) => evalChapter(CH4, snap({ base, day }));
    expect(d({}).green).toBe(0);
    expect(d({ filter: 1 }).items.find(i => i.id === 'filter1')!.done).toBe(true);
    expect(d({ filter: 1 }).items.find(i => i.id === 'bench1')!.done).toBe(false);
    expect(d({ filter: 1, bench: 1 }).green).toBe(2);
    expect(d({ filter: 1, bench: 1 }, 2).passed).toBe(true);
  });

  it('第 5 章「地图与大区」：走 8 格 / 深搜 1 次 / 弄到一辆车（跨区得开车）', () => {
    expect(WORLD_PRESET.skills?.fitness).toBeGreaterThanOrEqual(9);   // 9 级 → 行动力上限 +3（17 点）
    expect(WORLD_PRESET.ap).toBeGreaterThanOrEqual(16);
    expect(WORLD_PRESET.mat).toBeGreaterThanOrEqual(12);              // 修车要 12 材料
    expect(WORLD_PRESET.inv.fuel).toBeGreaterThanOrEqual(2);          // 修车要 2 汽油
    const w = (visited: number, deep = 0, veh = false) => evalChapter(CH5, snap({ visited, deep, veh }));
    expect(w(1).green).toBe(0);
    expect(w(8).items.find(i => i.id === 'walk8')!.done).toBe(true);
    expect(w(8, 0, true).items.find(i => i.id === 'cross5')!.done).toBe(true);
    expect(w(8, 1, true).passed).toBe(true);
  });

  it('第 6 章「背包与制作」：做一件 / 手动装填 / 背包 6 种', () => {
    expect(BAG_PRESET.inv.cloth).toBeGreaterThanOrEqual(2);    // 绷带＝布料×2，工作台 Lv.0 就能做
    expect(BAG_PRESET.inv.a9_fmj).toBeGreaterThan(0);
    expect(BAG_PRESET.inv.a9_ap).toBeGreaterThan(0);
    const b = (o: Partial<LabSnap>) => evalChapter(CH6, snap(o));
    expect(b({}).green).toBe(0);
    expect(b({ crafted: 1 }).items.find(i => i.id === 'craft6')!.done).toBe(true);
    expect(b({ load: { c9: 'a9_fmj' } }).items.find(i => i.id === 'load6')!.done).toBe(true);
    expect(b({ invKinds: 5 }).items.find(i => i.id === 'bag6')!.done).toBe(false);
    expect(b({ invKinds: 6 }).items.find(i => i.id === 'bag6')!.done).toBe(true);
    expect(b({ crafted: 1, load: { c9: 'a9_fmj' }, invKinds: 6 }).passed).toBe(true);
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

  it('进度摘要按"可玩章节"算（六章全可玩）', () => {
    expect(progressLine(parseProgress(null))).toBe('已通关 0 / 6 章');
    expect(progressLine(markDone(parseProgress(null), 'survival', 1))).toBe('已通关 1 / 6 章');
    expect(progressLine(markDone(parseProgress(null), 'world', 1))).toBe('已通关 1 / 6 章');
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
