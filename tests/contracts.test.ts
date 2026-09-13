/* 委托系统纯逻辑测试：刷板预算、接单占坑、进度从接单起算、期限过期、结算奖励 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIVE, accept, activeLine, abandon, bountyBudget, emptyContracts, ensureContracts, metricNow,
  progressOf, refreshBoard, rollOffers, settle, type Snap,
} from '../src/v4/contracts-core';

const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

const snap = (over: Partial<Snap> = {}): Snap => ({
  day: 1, kills: 0, killBy: {}, zones: {}, deep: 0, hordes: 0, nights: 0, items: {}, regions: {}, ...over,
});

/** 造一个"某个指标 = n"的快照（与具体委托模板无关，板子上刷出哪张都能测） */
const at = (metric: string, n: number, day: number): Snap => {
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

describe('委托板', () => {
  it('每天刷 3 张，且材料奖励总和不超过当日赏金预算', () => {
    for (const day of [1, 5, 12, 30]) {
      for (const stage of [0, 3, 5]) {                            // 主线越往后，挂主线的委托赏金越高
        const offers = rollOffers(day, seq(0.1, 0.5, 0.9, 0.3, 0.7), stage);
        expect(offers.length, 'day ' + day + ' stage ' + stage).toBe(3);
        const mat = offers.reduce((s, o) => s + (o.reward.mat ?? 0), 0);
        expect(mat).toBeLessThanOrEqual(bountyBudget(day));
        expect(new Set(offers.map(o => o.key)).size).toBe(3);      // 同一天不出现重复 key
        expect(new Set(offers.map(o => o.id)).size).toBe(3);       // 也不能有两张同 id 的（不然接不了第二张）
      }
    }
  });

  it('第 3 天起，板子上三张都是真委托（跨区那张不会把预算吃光、逼出零赏金保底）', () => {
    for (const day of [8, 20, 40]) {
      const offers = rollOffers(day, seq(0.1, 0.5, 0.9, 0.3, 0.7), 0, { region: 'ember' });
      expect(offers.length).toBe(3);
      expect(offers.filter(o => o.region).length).toBe(1);                      // 正好一张跨区
      expect(offers.some(o => o.id.startsWith('odd'))).toBe(false);             // 不用发保底差事
      expect(offers.filter(o => o.id.startsWith('do:')).length).toBe(1);        // 本地那张是真模板
    }
  });

  it('跨区委托不会指向玩家当前所在的区域', () => {
    const offers = rollOffers(9, seq(0.1, 0.5, 0.9), 0, { region: 'jiangbei' });
    const far = offers.find(o => o.region);
    expect(far).toBeTruthy();
    expect(far!.region).not.toBe('jiangbei');
    expect(far!.metric).toBe('region:' + far!.region);
  });

  it('当前区域没有某个 POI 时，不发指向它的委托（种子生成的地图不能假设有药房）', () => {
    const none = rollOffers(4, seq(0.1, 0.5, 0.9, 0.3), 0, { hasPoi: () => false, region: 'ember' });
    expect(none.length).toBe(3);
    expect(none.every(o => !String(o.metric).startsWith('zone:'))).toBe(true);
    const onlyKills = rollOffers(4, seq(0.1, 0.5, 0.9, 0.3), 3, { hasPoi: () => false, region: 'ember' });
    expect(onlyKills.length).toBe(3);
    expect(onlyKills.map(o => o.metric)).toContain('kills');
  });

  it('预算随天数上升，但不会是无限材料机', () => {
    expect(bountyBudget(1)).toBe(22);
    expect(bountyBudget(20)).toBe(60);
    expect(bountyBudget(100)).toBe(220);
    expect(bountyBudget(20) / 3).toBeLessThan(60);   // 三张委托均摊后仍是有限数
  });

  it('第 1、2 天不给跨区委托，第 3 天起给（跑远路要开车）', () => {
    const early = rollOffers(1, seq(0.5, 0.5, 0.5), 0);
    expect(early.some(o => o.region)).toBe(false);
    const later = rollOffers(6, seq(0.2, 0.6, 0.8, 0.4, 0.1, 0.9), 0);
    expect(later.some(o => o.region)).toBe(true);
    const far = later.find(o => o.region)!;
    expect(far.days).toBeGreaterThanOrEqual(4);                   // 远途给的时间更宽
    expect(far.desc).toContain('开车');
  });

  it('挂主线的委托跟着主线阶段走', () => {
    const a = rollOffers(4, seq(0.5), 0).find(o => o.key.startsWith('story'))!;
    const b = rollOffers(4, seq(0.5), 3).find(o => o.key.startsWith('story'))!;
    expect(a.metric).toBe('zone:hospital');
    expect(b.metric).toBe('zone:military');
  });

  it('换日会刷新板子（没接的报价作废）', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.3), 0);
    const firstKeys = st.board.map(o => o.key);
    refreshBoard(st, 2, seq(0.3), 0);
    expect(st.day).toBe(2);
    expect(st.board.map(o => o.key)).not.toEqual(firstKeys);
  });
});

describe('接单 / 进度 / 结算', () => {
  it('接单后从板上移出，并记下期限与基线', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    const offer = st.board[0];
    const before = at(offer.metric, 7, 1);                        // 玩家接单前已经攒了 7 点进度
    const r = accept(st, offer.key, before);
    expect(r.ok).toBe(true);
    expect(st.board.some(o => o.key === offer.key)).toBe(false);
    expect(st.active.length).toBe(1);
    const c = st.active[0];
    expect(c.baseline).toBe(7);                                   // 基线 = 接单那一刻
    expect(c.deadlineDay).toBe(1 + offer.days);
  });

  it('进度从接单起算：接单前攒的不算数', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    const offer = st.board[0], m = offer.metric, K = offer.need;
    accept(st, offer.key, at(m, 7, 1));
    const c = st.active[0];
    expect(progressOf(c, at(m, 7, 2)).current).toBe(0);            // 接单时已有的 7 不算
    expect(progressOf(c, at(m, 7 + K - 1, 2)).current).toBe(K - 1);
    expect(progressOf(c, at(m, 7 + K, 2)).current).toBe(K);
    expect(progressOf(c, at(m, 7 + K, 2)).done).toBe(true);
    expect(progressOf(c, at(m, 99 + K, 2)).current).toBe(K);       // 超额封顶在 need
  });

  it('最多同时接 3 个，第 4 个被拦下并给理由', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    const s = snap({ day: 1 });
    // 直接塞三张不同的委托进板子来测上限
    let n = 0;
    while (st.board.length && n < MAX_ACTIVE) { if (accept(st, st.board[0].key, s).ok) n++; else break; }
    expect(st.active.length).toBe(MAX_ACTIVE);
    st.board.push({ id: 'x', title: '加单', desc: '', metric: 'kills', need: 1, days: 1, reward: { mat: 1 }, tier: 1, key: 'extra', expiresDay: 2 });
    const r = accept(st, 'extra', s);
    expect(r.ok).toBe(false);
    expect(r.why).toContain('满了');
  });

  it('完成的委托给奖励并移出；过期的记失败', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    const offer = st.board[0];
    accept(st, offer.key, snap({ day: 1 }));
    const done = settle(st, at(offer.metric, offer.need, 2));
    expect(done.completed.length).toBe(1);
    expect(done.matGain).toBe(offer.reward.mat ?? 0);
    expect(st.active.length).toBe(0);
    expect(st.done).toBe(1);

    // 再来一张，让它过期
    refreshBoard(st, 3, seq(0.2, 0.4, 0.6), 0);
    accept(st, st.board[0].key, snap({ day: 3 }));
    const c = st.active[0];
    const late = settle(st, snap({ day: c.deadlineDay + 1 }));
    expect(late.expired.length).toBe(1);
    expect(st.failed).toBe(1);
    expect(st.active.length).toBe(0);
  });

  it('过期当天（day === deadline）还不算过期', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    accept(st, st.board[0].key, snap({ day: 1 }));
    const c = st.active[0];
    const p = progressOf(c, snap({ day: c.deadlineDay }));
    expect(p.expired).toBe(false);
    expect(p.daysLeft).toBe(0);
  });

  it('放弃算一次失败但不扣东西', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    accept(st, st.board[0].key, snap({ day: 1 }));
    const id = st.active[0].id;
    abandon(st, id, 2);
    expect(st.active.length).toBe(0);
    expect(st.failed).toBe(1);
    expect(st.log.join(' ')).toContain('放弃');
  });

  it('settle 会一次结算多个（完成 + 过期混在一起）', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    const s = snap({ day: 1 });
    const a = accept(st, st.board[0].key, s);
    const b = accept(st, st.board[0].key, s);
    expect(a.ok && b.ok).toBe(true);
    const res = settle(st, snap({ day: 99, kills: 999 }));
    expect(res.expired.length + res.completed.length).toBe(2);
    expect(res.messages.length).toBe(2);
    expect(st.active.length).toBe(0);
  });
});

describe('存档兼容与文案', () => {
  it('老档没有 contracts 字段 → 建空的，不炸', () => {
    const st = ensureContracts(undefined, 7);
    expect(st.day).toBe(7);
    expect(st.board).toEqual([]);
    expect(st.active).toEqual([]);
  });

  it('被改坏的 active（缺 need/期限/奖励）会被补齐，不会把 NaN 传进 UI', () => {
    const st = ensureContracts({ day: 3, board: [], active: [{ id: 'x', title: '坏数据', metric: 'kills' }], done: 0, failed: 0, log: [] }, 3);
    expect(st.active.length).toBe(1);
    const c = st.active[0];
    expect(c.need).toBeGreaterThan(0);
    expect(Number.isFinite(c.baseline)).toBe(true);
    expect(Number.isFinite(c.deadlineDay)).toBe(true);
    expect(c.reward.mat).toBeGreaterThan(0);
  });

  it('ensureContracts 必须原地修补（重建对象会让调用方握着旧引用，写入落进孤儿对象）', () => {
    const raw = { day: 1, board: [{ key: 'k', title: 't', metric: 'kills', need: 1, days: 1, reward: { mat: 1 }, tier: 1, id: 'x', expiresDay: 2 }], active: [], done: 0, failed: 0, log: [] };
    const out = ensureContracts(raw, 5);
    expect(out).toBe(raw);                                    // 同一个引用
    out.day = 9;
    expect((raw as any).day).toBe(9);                         // 写回去能看见
  });

  it('指标都能从快照里读到值（区域/POI/击杀分类）', () => {
    const s = snap({ kills: 5, killBy: { armored: 2 }, zones: { hospital: 1 }, regions: { jiangbei: 1 } });
    expect(metricNow('kills', s)).toBe(5);
    expect(metricNow('killBy:armored', s)).toBe(2);
    expect(metricNow('zone:hospital', s)).toBe(1);
    expect(metricNow('region:jiangbei', s)).toBe(1);
    expect(metricNow('region:nowhere', s)).toBe(0);
  });

  it('activeLine 里的人话进度带天数', () => {
    const st = refreshBoard(emptyContracts(1), 1, seq(0.2, 0.4, 0.6), 0);
    accept(st, st.board[0].key, snap({ day: 1 }));
    const line = activeLine(st.active[0], snap({ day: 2 }));
    expect(line).toMatch(/\d+\/\d+/);
    expect(line).toContain('剩');
  });
});
