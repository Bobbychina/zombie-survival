/* M18 区域事件：内容完整性 + 概率/偏向规则 + 效果边界。
   为什么值得单测：这些事件的文案会直接印在日志里（玩家会当成"事实"读），
   一旦写了不存在的物品 id 或一次掉 30 血，游戏不会报错，但体验直接崩。
   抽查逻辑：安全区（危险 1）**永远不许受伤**——那是新手村，不是赌命区。 */
import { describe, expect, it } from 'vitest';
import {
  REGION_EVENTS, auditRegionEvents, eventChance, regionHazardTitles, rollRegionEvent, type RegionEvent,
} from '../src/v4/region-events-core';
import { REGIONS, REGION_TYPES, type RegionType } from '../src/v4/regions-core';
import { itemIds } from './legacy-tables';

const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const all = Object.values(REGION_EVENTS).flat();

describe('M18 区域事件', () => {
  it('九种区域都有自己的事件池，且结构完整（物品 id 真实存在、数值不越界）', () => {
    for (const t of REGION_TYPES) expect(REGION_EVENTS[t], t + ' 没有事件池').toBeTruthy();
    expect(auditRegionEvents(itemIds())).toEqual([]);
  });

  it('事件 id 唯一、文案长度够、每种区域至少 3 条（含 1 条 hazard）', () => {
    expect(new Set(all.map(e => e.id)).size).toBe(all.length);
    for (const t of REGION_TYPES) {
      const pool = REGION_EVENTS[t];
      expect(pool.length, t).toBeGreaterThanOrEqual(3);
      expect(pool.some(e => e.kind === 'hazard'), t + ' 没有危险事件').toBe(true);
      for (const e of pool) {
        expect(e.title.length, e.id).toBeGreaterThan(1);
        expect(e.text.length, e.id).toBeGreaterThan(8);
      }
    }
    // 收益事件必须真的给东西（不然玩家读到"你捡到了"却什么都没有）
    for (const e of all) if (e.kind === 'loot') expect(!!(e.item && e.n) || !!e.mat, e.id).toBe(true);
  });

  it('出事概率随危险度上升，且落在合理区间', () => {
    const c = [1, 2, 3, 4, 5].map(eventChance);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    expect(c[0]).toBeGreaterThanOrEqual(0.15);
    expect(c[4]).toBeLessThanOrEqual(0.75);
  });

  it('掷骰：低随机值必然触发、高随机值必然不触发（可预测、可回放）', () => {
    expect(rollRegionEvent('industry', 5, seq(0.0, 0.0, 0.99))).toBeTruthy();
    expect(rollRegionEvent('industry', 1, seq(0.99, 0.0, 0.0))).toBeNull();
    // 同一个随机序列 → 同一条事件（纯函数）
    const a = rollRegionEvent('ruins', 4, seq(0.1, 0.9, 0.3));
    const b = rollRegionEvent('ruins', 4, seq(0.1, 0.9, 0.3));
    expect(a?.id).toBe(b?.id);
  });

  it('安全区（危险 1）只会撞上好事或氛围，永远不掉血', () => {
    for (const t of REGION_TYPES) {
      for (let i = 0; i < 40; i++) {
        const ev = rollRegionEvent(t, 1, seq(i / 40, (i % 7) / 7, (i % 5) / 5));
        if (ev) expect(ev.hp ?? 0, t + ' 在安全区掉血：' + ev.title).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('越危险越容易撞上危险事件（抽样统计 hazard 占比单调上升）', () => {
    const hazardRate = (tier: number) => {
      let h = 0, n = 0;
      for (let i = 0; i < 300; i++) {
        const ev = rollRegionEvent('industry', tier, seq((i % 97) / 97, (i % 31) / 31, (i % 13) / 13));
        if (!ev) continue;
        n++;
        if (ev.kind === 'hazard') h++;
      }
      return h / Math.max(1, n);
    };
    const r2 = hazardRate(2), r5 = hazardRate(5);
    expect(r5).toBeGreaterThan(r2);
    expect(r5).toBeGreaterThan(0.45);
  });

  it('详情面板能列出"这一带的状况"，且用的都是真实事件标题', () => {
    for (const t of REGION_TYPES) {
      const titles = regionHazardTitles(t, 3);
      expect(titles.length).toBe(3);
      for (const x of titles) expect(REGION_EVENTS[t].map((e: RegionEvent) => e.title)).toContain(x);
    }
  });

  it('每种区域的事件文案都和地貌对得上（不会在农田里漏毒气）', () => {
    const must: [RegionType, string][] = [
      ['industry', '毒气泄漏'], ['military', '军械箱'], ['farm', '野猪群'],
      ['forest', '狼群'], ['water', '涨潮'], ['ruins', '楼板塌陷'],
    ];
    for (const [t, title] of must) expect(REGION_EVENTS[t].map(e => e.title), t).toContain(title);
  });

  it('真实存档里每种区域类型都存在对应事件池（地图上不会出现"没内容的区域"）', () => {
    const seen = new Set(REGIONS.map(r => r.type));
    for (const t of seen) expect(REGION_EVENTS[t].length).toBeGreaterThanOrEqual(3);
  });
});
