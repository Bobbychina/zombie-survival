/* M60：教学沙盒两件事 ——
   ① 第 5 章目标③从"有车"改成**真的跨一次大区**（硬验证：`world.crossings` 计数只在真的搬过去时才 +1）；
   ② 「按顺序解锁」开关（默认关 = 六章都能直接练；开着才按 1→6 硬解锁）。
   用户口径：「不能让想练第 6 章的人被第 1 章卡住」。 */
import { describe, expect, it } from 'vitest';
import {
  LAB_CHAPTERS, chapterBadge, chapterById, chapterUnlocked, evalChapter, firstOpenChapter, isDone, lockGateOf, lockReason,
  markDone, mergeSticky, parseProgress, serializeProgress, toggleSeq, type LabProgress,
} from '../src/v4/sandbox-core';
import { defaultSaveWorld, ensureSaveWorld, switchRegion } from '../src/v4/worldstate';
import { HOME_REGION, REGIONS, setActiveRegions } from '../src/v4/regions-core';

const prog = (done: string[] = [], seq = false): LabProgress => ({ done: Object.fromEntries(done.map((d, i) => [d, 1000 + i])), seq });
const snapLike = (over: Record<string, unknown> = {}) => ({
  day: 1, hp: 100, hun: 80, thi: 80, ap: 12, scav: 0, deep: 0, crafted: 0, kills: 0, meleeKills: 0, ammoUsed: 0,
  apKills: 0, loc: 'base', over: false, inv: {}, load: {}, injuries: [], base: {}, steps: 0, visited: 0, regions: 1,
  veh: false, crossings: 0, invKinds: 0, ...over,
});

describe('M60 第 5 章目标③：跨大区要"真走一遍"', () => {
  const world = () => chapterById('world')!;
  const cross = () => world().objectives.find(o => o.id === 'cross5')!;

  it('只有车、没跨过区 → 目标③不绿（"弄到车"证明不了会开过去）', () => {
    expect(cross().need(snapLike({ veh: true, crossings: 0 }) as any)).toBe(false);
    const ev = evalChapter(world(), snapLike({ veh: true, crossings: 0, visited: 8, deep: 1 }) as any);
    expect(ev.green).toBe(2);
    expect(ev.passed).toBe(false);
  });

  it('真的跨过一次 → 目标③绿，三条全绿才通关', () => {
    expect(cross().need(snapLike({ veh: true, crossings: 1 }) as any)).toBe(true);
    expect(cross().need(snapLike({ veh: false, crossings: 1 }) as any)).toBe(true);   // 回来时车坏了也不该把勾收回（sticky 同理）
    const ev = evalChapter(world(), snapLike({ veh: true, crossings: 1, visited: 8, deep: 1 }) as any);
    expect(ev.green).toBe(3);
    expect(ev.passed).toBe(true);
  });

  it('文案里写清"修车 + 出发"这条动作链（不是只写"弄到一辆车"）', () => {
    expect(cross().text).toMatch(/修辆车/);
    expect(cross().text).toMatch(/出发/);
    expect(cross().text).toMatch(/大区地图/);
  });

  it('计数点位只有一个：switchRegion 里成功换图才 +1（原地"跨"到自己不算）', () => {
    const seed = 'm60-cross';
    setActiveRegions(seed);
    const sw = defaultSaveWorld(seed);
    expect(sw.crossings).toBe(0);
    const other = REGIONS.find(r => r.id !== HOME_REGION && r.type !== 'water')!.id;
    const r1 = switchRegion({}, sw, other);
    expect(r1.ok).toBe(true);
    expect(sw.crossings).toBe(1);
    const again = switchRegion({}, sw, other);           // 已经在别的区了 → 不算跨区
    expect(again.ok).toBe(true);
    expect(sw.crossings).toBe(1);
    const back = switchRegion({}, sw, HOME_REGION);
    expect(back.ok).toBe(true);
    expect(sw.crossings).toBe(2);
  });

  it('老档没有 crossings 字段 → 补 0，不是 NaN', () => {
    const seed = 'm60-old';
    setActiveRegions(seed);
    const S: any = { seed, world: { ...defaultSaveWorld(seed), crossings: undefined } };
    const sw = ensureSaveWorld(S);
    expect(sw.crossings).toBe(0);
  });
});

describe('M60 按顺序解锁（默认关）', () => {
  it('默认：六章全部可进（软建议顺序不能变成硬门槛）', () => {
    const p = prog();
    expect(p.seq).toBe(false);
    for (const c of LAB_CHAPTERS) expect(chapterUnlocked(c.id, p)).toBe(true);
  });

  it('打开开关：第 1 章可进、后面全锁；通关一章解锁下一章', () => {
    let p = prog([], true);
    expect(chapterUnlocked('survival', p)).toBe(true);
    expect(chapterUnlocked('combat', p)).toBe(false);
    expect(chapterUnlocked('world', p)).toBe(false);
    p = markDone(p, 'survival', 111);
    expect(chapterUnlocked('combat', p)).toBe(true);
    expect(chapterUnlocked('medical', p)).toBe(false);
    for (const id of ['combat', 'medical', 'base']) p = markDone(p, id, 222);
    expect(chapterUnlocked('world', p)).toBe(true);
    expect(chapterUnlocked('bag', p)).toBe(false);
  });

  it('关掉开关：无论进度如何都全开（"想练第 6 章"永远有出口）', () => {
    const p = prog([], true);
    expect(toggleSeq(p).seq).toBe(false);
    for (const c of LAB_CHAPTERS) expect(chapterUnlocked(c.id, toggleSeq(p))).toBe(true);
  });

  it('toggleSeq 不动通关记录；markDone 不丢开关状态', () => {
    const p = prog(['survival'], true);
    expect(toggleSeq(p).done).toEqual(p.done);
    expect(markDone(p, 'combat', 5).seq).toBe(true);
    expect(markDone(p, 'combat', 5).done.survival).toBe(p.done.survival);
  });

  it('firstOpenChapter 只挑"已解锁且没通关"的章', () => {
    const locked = prog([], true);
    expect(firstOpenChapter(locked)).toBe('survival');
    const afterTwo = markDone(markDone(locked, 'survival', 1), 'combat', 2);
    expect(firstOpenChapter(afterTwo)).toBe('medical');
    const free = prog(['survival', 'combat'], false);
    expect(firstOpenChapter(free)).toBe('medical');     // 关着开关时与"第一个没通关的"一致
  });

  it('徽章与原因文案：锁着的章给锁 + 一句"怎么关掉开关"', () => {
    const p = prog([], true);
    expect(chapterBadge(chapterById('combat')!, p).text).toMatch(/🔒/);
    expect(chapterBadge(chapterById('survival')!, p).text).toMatch(/建议从这里开始/);
    expect(lockReason('combat', p)).toMatch(/开关/);
    expect(lockGateOf('combat', p)!.id).toBe('survival');
    expect(lockGateOf('survival', p)).toBe(null);
  });

  it('进度读写的边界：坏 JSON / 老格式 / 缺字段都不炸，seq 默认关', () => {
    expect(parseProgress(null).seq).toBe(false);
    expect(parseProgress('{{{').done).toEqual({});
    expect(parseProgress('{{{').seq).toBe(false);
    expect(parseProgress(JSON.stringify({ v: 1, done: { survival: 9 } })).seq).toBe(false);   // M60 之前的老进度
    expect(parseProgress(JSON.stringify({ v: 1, done: { survival: 9 } })).done.survival).toBe(9);
    const bad = parseProgress(JSON.stringify({ done: { survival: 'x', combat: -5 }, seq: 'yes' }));
    expect(bad.done).toEqual({});
    expect(bad.seq).toBe(false);                        // 只有严格 true 才算开着
    expect(parseProgress(JSON.stringify({ done: {}, seq: true })).seq).toBe(true);
    const rt = parseProgress(serializeProgress(prog(['survival'], true)));
    expect(rt.done.survival).toBe(1000);
    expect(rt.seq).toBe(true);
  });

  it('三章目标全绿才算过、勾选仍然单调（M33 的老口径没被改坏）', () => {
    const ev = evalChapter(chapterById('world')!, snapLike({ visited: 8, deep: 1, crossings: 1 }) as any);
    expect(ev.passed).toBe(true);
    const st = mergeSticky({ items: [{ id: 'walk8', text: '', done: true }, { id: 'deep5', text: '', done: false }], green: 1, total: 2, passed: false },
      new Set<string>());
    expect(st.ev.items[0].done).toBe(true);
    expect(isDone(prog(['world']), 'world')).toBe(true);
  });
});
