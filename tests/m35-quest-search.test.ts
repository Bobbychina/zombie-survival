/* M35：搜刮记账与"有没有出货"解耦 —— 用户报障「委托让你去药房翻一趟，搜了还是完不成」。
   根因：searchPoi 的早退分支（POI 已被搜空）不记 zoneCnt/deep/regionZones 这几本账，
   于是 zone:pharmacy 的委托永远停在 0/1。这里钉住"空点也记账"这件事，
   并顺带钉住它喂给委托判定的结果（progressOf / settle 真的会完成）。 */
import { describe, expect, it } from 'vitest';
import { tallySearch, type SearchStats } from '../src/v4/search-core';
import { accept, emptyContracts, metricNow, progressOf, settle, type ContractDef, type Snap } from '../src/v4/contracts-core';

const snap = (over: Partial<Snap> = {}): Snap => ({
  day: 1, kills: 0, killBy: {}, zones: {}, deep: 0, hordes: 0, nights: 0, items: {}, regions: {}, rzones: {}, ...over,
});

/** 把账本拼成判定用的快照（跟 quests.ts 的 snapNow 一个口径） */
const snapOf = (stats: SearchStats, rzones: Snap['rzones'] = {}, over: Partial<Snap> = {}): Snap =>
  snap({ zones: { ...(stats.zoneCnt || {}) }, deep: stats.deep || 0, rzones, ...over });

const pharmacyQuest = (): ContractDef => ({
  id: 'do:补给清单0', title: '补给清单', desc: '抗生素永远不够用。去药房翻一趟。',
  metric: 'zone:pharmacy', need: 1, days: 2, reward: { mat: 5, item: 'bandage', n: 2 }, from: '林医生', tier: 1,
});

describe('M35 搜刮记账', () => {
  it('药房已被搜空（早退分支）也要记账：区域粒度 + POI 粒度 + 分区粒度 + 拾荒数', () => {
    const stats: SearchStats = {};
    const rzones: Snap['rzones'] = {};
    // 空点的这次搜索：zoneOfPoi('pharmacy') === 'hospital'（legacy 的粗映射）
    tallySearch(stats, rzones, 'ember', 'pharmacy', 'hospital', false);
    expect(stats.zoneCnt).toEqual({ hospital: 1, pharmacy: 1 });
    expect(stats.scav).toBe(1);
    expect(stats.deep ?? 0).toBe(0);                       // 普通搜索不写 deep
    expect(rzones.ember).toEqual({ pharmacy: 1 });         // 跨区委托 rzone:<区>:* 认这个
  });

  it('空点上一次深搜同样算 deep（判定是"你去搜了"，不是"你搜到了"）', () => {
    const stats: SearchStats = {};
    tallySearch(stats, {}, 'ember', 'pharmacy', 'hospital', true);
    expect(stats.deep).toBe(1);
    expect(stats.zoneCnt).toEqual({ hospital: 1, pharmacy: 1 });
  });

  it('同名的 legacy 区域（医院）两个粒度写同一个键 → 一次搜索记 2（M13 起的既有行为，别顺手改）', () => {
    const stats: SearchStats = {};
    tallySearch(stats, {}, 'ember', 'hospital', 'hospital', false);
    expect(stats.zoneCnt).toEqual({ hospital: 2 });
  });

  it('用户场景：接「补给清单」后在被搜空的药房里搜一次 → 委托应当完成并结算', () => {
    const state = emptyContracts(3);
    state.board = [{ ...pharmacyQuest(), key: 'probe', expiresDay: 4 }];
    const before = snap();
    expect(accept(state, 'probe', before).ok).toBe(true);
    expect(state.active[0].baseline).toBe(0);                         // 接单那一刻的进度基线
    expect(progressOf(state.active[0], before).done).toBe(false);

    // 玩家走进药房按下"搜索"——这一格已经 0/4 次了（走的是早退分支）
    const stats: SearchStats = {};
    const rzones: Snap['rzones'] = {};
    tallySearch(stats, rzones, 'ember', 'pharmacy', 'hospital', false);
    const after = snapOf(stats, rzones, { day: 3 });

    expect(metricNow('zone:pharmacy', after)).toBe(1);
    expect(progressOf(state.active[0], after)).toMatchObject({ current: 1, need: 1, done: true, expired: false });
    const res = settle(state, after);
    expect(res.completed.map(c => c.title)).toEqual(['补给清单']);     // 奖励真的发出去（材料由调用方落库）
    expect(res.matGain).toBe(5);
    expect(state.active.length).toBe(0);
  });

  it('跨区委托（rzone:<区>:*）也认空点的那一次搜刮', () => {
    const stats: SearchStats = {};
    const rzones: Snap['rzones'] = {};
    tallySearch(stats, rzones, 'jiangbei', 'pharmacy', 'hospital', false);
    tallySearch(stats, rzones, 'jiangbei', 'market', 'market', false);
    const s = snapOf(stats, rzones);
    expect(metricNow('rzone:jiangbei:*', s)).toBe(2);
    expect(metricNow('rzone:jiangbei:pharmacy', s)).toBe(1);
    expect(metricNow('rzone:ember:*', s)).toBe(0);                     // 别的区不会被带涨
  });
});
