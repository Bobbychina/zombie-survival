/* M72b 传闻口径：危险度与辐射从"直接写结论"改成"幸存者传闻"，第一次进区事件概率更高。
 *
 * 这一批盯的是四件事（都是需求原文里的硬话）：
 *   ① 没去过 = 只有**传闻**：给区间（"3~5"）+ 出处（"幸存者说…"）+ "能不能去"的定性判断，
 *      绝不能摊出精确档位；
 *   ② 去过 = **实测记录**：精确数值 + 上次到访的时间与结果；
 *   ③ **同一存档内稳定**：同 (种子, 区域, 天数届次) 逐字一致（刷新/读档不变），换局/跨届才会变；
 *   ④ 首次进区事件概率 ×2.2（常量可调），且老签名 eventChance 不受影响。
 * 纯逻辑在 src/v4/rumor-core.ts 与 region-events-core.ts；legacy/world-ui 只接线与渲染。 */
import { describe, expect, it } from 'vitest';
import {
  RUMOR_EPOCH_DAYS, RUMOR_VER, bandMid, bandText, beliefTier, cleanRumorSave, dangerMeasured, dangerRumor,
  dangerVerdict, noteVisit, radMeasured, radRumor, radVerdict, regionRead, rumorEpoch, rumorSeedOf, visitResult,
} from '../src/v4/rumor-core';
import {
  FIRST_ENTER_CAP, FIRST_ENTER_MUL, eventChance, eventChanceAt, makeRng, rollRegionEvent, sampleEventRate,
} from '../src/v4/region-events-core';
import { REGIONS, dangerLabel } from '../src/v4/regions-core';
import { defaultSaveWorld, ensureSaveWorld } from '../src/v4/worldstate';

const ids = ['r1-1', 'r2-3', 'r5-5', 'r7-9', 'r10-2'];

describe('M72b 传闻口径 · 没去过只有传闻', () => {
  it('给的是**区间**（不是精确档位），始终落在 1~5，且包住真值（误差区间说话算话）', () => {
    for (const id of ids) {
      for (let tier = 1; tier <= 5; tier++) {
        const r = dangerRumor({ seed: 'save-A', id, tier, day: 7 });
        expect(r.band.hi).toBeGreaterThan(r.band.lo);          // 永远是区间，"危险 4"这种准数不许出现
        expect(r.band.lo).toBeGreaterThanOrEqual(1);
        expect(r.band.hi).toBeLessThanOrEqual(5);
        expect(tier).toBeGreaterThanOrEqual(r.band.lo);        // 真值落在传闻区间内
        expect(tier).toBeLessThanOrEqual(r.band.hi);
        expect(bandText(r.band)).toContain('~');
      }
    }
  });

  it('传闻带出处与口供（"谁说的 + 原话"），且 brief 里给的是区间不是精确定论', () => {
    const r = dangerRumor({ seed: 'save-A', id: 'r3-4', tier: 3, day: 2 });
    expect(r.source.length).toBeGreaterThan(4);
    expect(r.quote.length).toBeGreaterThan(8);
    expect(r.line).toContain(r.source);
    expect(r.line).toContain(r.quote);
    expect(r.quote).toContain(bandText(r.band));
    expect(r.brief).toContain('传闻');
    expect(r.brief).toContain(bandText(r.band));
    expect(r.kind).toBe('rumor');
  });

  it('但必须给出"能不能去"的定性判断：区间悲观端越高，判断越重，且两句话都在（多半能应付 / 他们没回来过）', () => {
    expect(dangerVerdict(2).text).toBe('多半能应付');
    expect(dangerVerdict(5).text).toContain('没回来过');
    const rank = [1, 2, 3, 4, 5].map(h => dangerVerdict(h).key);
    expect(new Set(rank).size).toBe(5);                       // 五档各有各的定性判断，不是一句话复用
    /* 传闻取**悲观端**：区间说可能到 5，就得按 5 准备 —— 玩家因此不会因为模糊而没法决策 */
    const r = dangerRumor({ seed: 'save-A', id: 'r9-9', tier: 5, day: 4 });
    expect(r.verdictText).toBe(dangerVerdict(r.band.hi).text);
    const seen = new Set<string>();
    for (const id of ids) for (let tier = 1; tier <= 5; tier++) for (let day = 1; day < 40; day += 3) {
      seen.add(dangerRumor({ seed: 'save-A', id, tier, day }).verdictText);
    }
    expect(seen.has('多半能应付')).toBe(true);
    expect(seen.has('他们说去的人没回来过')).toBe(true);
  });

  it('传闻**会**偏高也会偏低（不能全信），但区间中点才是"你以为的难度"', () => {
    const biases = new Set<string>();
    let high = 0, low = 0, spot = 0;
    for (const id of ids) for (let day = 1; day < 60; day += 2) {
      const r = dangerRumor({ seed: 'save-B', id, tier: 3, day });
      biases.add(r.bias);
      if (r.bias === 'high') { high++; expect(r.mid).toBeGreaterThanOrEqual(3); }
      else if (r.bias === 'low') { low++; expect(r.mid).toBeLessThanOrEqual(3); }
      else { spot++; expect(r.mid).toBe(3); }
      expect(r.mid).toBe(bandMid(r.band));
    }
    expect(biases.size).toBe(3);
    expect(high).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
    expect(spot).toBeGreaterThan(0);
  });

  it('辐射也用传闻口径：干净的地方不说"绝对没事"，脏的地方不会被说成干净', () => {
    const clean = radRumor({ seed: 'save-A', id: 'r2-2', radMax: 0, day: 5 });
    expect(clean.band.lo).toBe(0);
    expect(clean.band.hi).toBeGreaterThanOrEqual(0);
    expect(clean.verdict).toBe('clean');
    expect(clean.brief).toContain('传闻辐射');
    for (const id of ids) for (let day = 1; day < 30; day += 3) {
      const dirty = radRumor({ seed: 'save-A', id, radMax: 3, day });
      expect(dirty.band.hi).toBe(3);                          // 脏地说不干净 = 坑玩家
      expect(dirty.verdict).not.toBe('clean');
      expect(dirty.quote.length).toBeGreaterThan(6);
    }
    expect(radVerdict(0).key).toBe('clean');
    expect(radVerdict(3).text.length).toBeGreaterThan(4);
  });
});

describe('M72b 传闻口径 · 同一存档内稳定', () => {
  it('同 (种子, 区域, 天) 逐字一致（刷新/读档后看到的还是同一句口供）', () => {
    const a = dangerRumor({ seed: 'save-C', id: 'r4-6', tier: 4, day: 12 });
    for (let i = 0; i < 8; i++) {
      const b = dangerRumor({ seed: 'save-C', id: 'r4-6', tier: 4, day: 12 });
      expect(b).toEqual(a);
    }
    expect(radRumor({ seed: 'save-C', id: 'r4-6', radMax: 2, day: 12 }))
      .toEqual(radRumor({ seed: 'save-C', id: 'r4-6', radMax: 2, day: 12 }));
    expect(rumorSeedOf('save-C', 'r4-6', 12, 'danger')).toBe(rumorSeedOf('save-C', 'r4-6', 12, 'danger'));
  });

  it('换一局（换种子）传闻就变一批；同一届内怎么调都不变，跨届才换口供', () => {
    const one = (seed: string) => ids.concat(['r8-8'])
      .map(id => dangerRumor({ seed, id, tier: 3, day: 6 }).line).join('|');
    const a = one('save-D'), b = one('save-E'), c = one('save-F');
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);       // 不同局：至少有一批不一样
    expect(rumorEpoch(1)).toBe(rumorEpoch(RUMOR_EPOCH_DAYS - 1));  // 同届（第 1~4 天是第 0 届）
    expect(rumorEpoch(RUMOR_EPOCH_DAYS + 1)).toBe(1);          // 跨届
    const before = ids.map(id => dangerRumor({ seed: 'save-D', id, tier: 3, day: 1 }).line).join('|');
    const sameEpoch = ids.map(id => dangerRumor({ seed: 'save-D', id, tier: 3, day: RUMOR_EPOCH_DAYS - 1 }).line).join('|');
    expect(sameEpoch).toBe(before);                            // 同届内逐字一致
    const nextEpoch = ids.map(id => dangerRumor({ seed: 'save-D', id, tier: 3, day: RUMOR_EPOCH_DAYS + 1 }).line).join('|');
    expect(nextEpoch).not.toBe(before);
    expect(RUMOR_VER).toBeGreaterThanOrEqual(1);
  });
});

describe('M72b 传闻口径 · 去过之后变实测', () => {
  it('实测记录给精确数值 + 上次到访的时间与结果（撞上什么、掉了多少血）', () => {
    const m = dangerMeasured({ tier: 4, visits: 3, firstDay: 2, last: { day: 12, hp: -14, ev: '毒气泄漏' } });
    expect(m.kind).toBe('measured');
    expect(m.tier).toBe(4);
    expect(m.label).toBe(dangerLabel(4));
    expect(m.brief).toBe('📋 实测危险 4 · ' + dangerLabel(4));
    expect(m.line).toContain('危险 4');
    expect(m.line).toContain('第 12 天');
    expect(m.line).toContain('毒气泄漏');
    expect(m.line).toContain('-14');
    // 只去过一次的：写明"第几天第一次踏进来"（首次进区的那句话）
    expect(dangerMeasured({ tier: 2, visits: 1, firstDay: 6, last: null }).line).toContain('第 6 天第一次踏进来');
    expect(visitResult(null)).toContain('没留下');
    expect(visitResult({ day: 3, hp: 0, ev: '' })).toBe('一路无事');
    expect(visitResult({ day: 3, hp: -8, ev: '游荡者' })).toBe('撞上「游荡者」（生命 -8）');
    expect(radMeasured(0).brief).toContain('没有辐射源');
    expect(radMeasured(3).brief).toContain('3');
  });

  it('regionRead 按"去过没有"切换口径：没去过给传闻，去过给实测（数值才露出来）', () => {
    const base = { seed: 'save-G', id: 'r6-6', tier: 4, radMax: 2, day: 9, visits: 1, firstDay: 3, last: { day: 9, hp: 0, ev: '' } };
    const unseen = regionRead({ ...base, seen: false });
    expect(unseen.seen).toBe(false);
    expect(unseen.danger.kind).toBe('rumor');
    expect(unseen.rad.kind).toBe('rumor');
    expect(beliefTier(unseen.danger)).toBeGreaterThanOrEqual(1);
    const seen = regionRead({ ...base, seen: true });
    expect(seen.seen).toBe(true);
    expect(seen.danger.kind).toBe('measured');
    expect(seen.rad.kind).toBe('measured');
    if (seen.danger.kind === 'measured') expect(seen.danger.tier).toBe(4);   // 去过 = 准数
    expect(beliefTier(seen.danger)).toBe(4);
    if (seen.rad.kind === 'measured') expect(seen.rad.lv).toBe(2);
  });
});

describe('M72b 传闻口径 · 存档白名单', () => {
  it('cleanRumorSave 清脏数据、补空表、**保留对象身份**（ensure 每次 render 都会调）', () => {
    const first: any = { 'r1-1': 3, 'bad': 5, 'r2-2': -1, 'r3-3': 'x', 'r4-4': 9.7 };
    const last: any = { 'r1-1': { day: 5, hp: -9, ev: '毒气泄漏' }, 'r2-2': { day: 0, hp: 1, ev: '' }, 'zz': { day: 2 }, 'r3-3': null };
    const sw: any = { regionFirst: first, regionLast: last };
    const idBefore = sw.regionFirst, lastBefore = sw.regionLast;
    cleanRumorSave(sw);
    expect(sw.regionFirst).toBe(idBefore);
    expect(sw.regionLast).toBe(lastBefore);
    expect(sw.regionFirst).toEqual({ 'r1-1': 3, 'r4-4': 9 });
    expect(sw.regionLast['r1-1']).toEqual({ day: 5, hp: -9, ev: '毒气泄漏' });
    expect(sw.regionLast['r2-2']).toBeUndefined();
    expect(sw.regionLast['zz']).toBeUndefined();
    expect(sw.regionLast['r3-3']).toBeUndefined();
    // 空表/坏表自动补齐
    const empty: any = {};
    cleanRumorSave(empty);
    expect(empty.regionFirst).toEqual({});
    expect(empty.regionLast).toEqual({});
    cleanRumorSave(null);
    // 超长事件名会被截断（免得坏档把详情面板撑爆）
    const long: any = { regionLast: { 'r5-5': { day: 2, hp: 0, ev: 'x'.repeat(80) } } };
    cleanRumorSave(long);
    expect(long.regionLast['r5-5'].ev.length).toBe(24);
  });

  it('noteVisit 只写第一次的天数，之后每次到访只更新"上次到访"', () => {
    const sw: any = {};
    noteVisit(sw, 'r2-2', 4, { hp: -11, ev: '野猪群' });
    expect(sw.regionFirst['r2-2']).toBe(4);
    expect(sw.regionLast['r2-2']).toEqual({ day: 4, hp: -11, ev: '野猪群' });
    noteVisit(sw, 'r2-2', 9, { hp: 0, ev: '' });
    expect(sw.regionFirst['r2-2']).toBe(4);                   // 首次天数不被覆盖
    expect(sw.regionLast['r2-2']).toEqual({ day: 9, hp: 0, ev: '' });
    noteVisit(sw, 'not-a-region', 9, null);
    expect(sw.regionFirst['not-a-region']).toBeUndefined();
  });

  it('ensureSaveWorld 会给老档补齐并清洗（读档后"首次进区"判定不会重算）', () => {
    const seed = 'm72b-save-test';
    const sw: any = defaultSaveWorld(seed);
    const other = REGIONS.find(r => r.id !== sw.region && !r.homeBase)!.id;
    sw.seenRegions[other] = 1;
    sw.regionVisits[other] = 2;
    delete sw.regionFirst; delete sw.regionLast;                // 老档：根本没有这两张表
    const S: any = { seed, day: 12, world: sw };
    const out = ensureSaveWorld(S);
    expect(out.regionFirst[out.region]).toBeGreaterThanOrEqual(1);
    expect(out.regionFirst[other]).toBe(1);                     // 已去过但没记 → 补 1，不是"没有记录"
    expect(out.regionLast).toEqual({});
    // 手改档塞脏数据 → 读档时被清掉：负天数拉回、NaN 天数的条目整条丢掉、超长事件名截断
    out.regionFirst[other] = -5 as any;
    out.regionLast[other] = { day: 8, hp: 1e9, ev: 'x'.repeat(90) } as any;
    out.regionLast['r1-1'] = { day: NaN, hp: 0, ev: '坏档' } as any;
    const out2 = ensureSaveWorld(S);
    expect(out2.regionFirst[other]).toBe(1);
    expect(out2.regionLast[other].ev.length).toBe(24);
    expect(out2.regionLast['r1-1']).toBeUndefined();            // NaN 天数的条目整条丢掉
    expect(out2.regionLast[other].hp).toBe(1000);               // 天文数字夹回安全区间
  });
});

describe('M72b 首次进区事件概率更高', () => {
  it('首次进区 ×2.2 并封顶 0.95；老签名 eventChance 一点没变（别处还在 .map 它）', () => {
    expect(FIRST_ENTER_MUL).toBeCloseTo(2.2, 5);
    for (let tier = 1; tier <= 5; tier++) {
      const base = eventChance(tier);
      expect(eventChanceAt(tier, false)).toBe(base);
      const first = eventChanceAt(tier, true);
      expect(first).toBeGreaterThan(base);                                   // 严格更高
      expect(first).toBeCloseTo(Math.min(FIRST_ENTER_CAP, base * FIRST_ENTER_MUL), 6);
      expect(first).toBeLessThanOrEqual(FIRST_ENTER_CAP);
    }
    expect([1, 2, 3, 4, 5].map(eventChance)).toEqual([1, 2, 3, 4, 5].map(t => eventChance(t)));
    expect(eventChanceAt(3, true)).toBeGreaterThan(0.9);                     // 3 档：0.45 → 0.99
  });

  it('掷骰口径：同一个随机源下首次进区明显更容易出事（抽样率之比 ≥1.8）', () => {
    const base = sampleEventRate('industry', 3, false, 2000, makeRng(20260922));
    const first = sampleEventRate('industry', 3, true, 2000, makeRng(20260922));
    expect(base).toBeGreaterThan(0.35); expect(base).toBeLessThan(0.55);      // ≈ 0.45
    expect(first).toBeGreaterThan(0.9);                                       // ≈ 0.95（封顶）
    expect(first / base).toBeGreaterThanOrEqual(1.8);
    // 可复现：同一个种子 → 同一个数字（探针拿它当真值比对）
    expect(sampleEventRate('industry', 3, true, 500, makeRng(7))).toBe(sampleEventRate('industry', 3, true, 500, makeRng(7)));
    // 分界线上的实证：0.5 这个随机值在"熟路"下不触发、在"首次"下必然触发
    const half = () => 0.5;
    expect(rollRegionEvent('industry', 3, half, false)).toBeNull();
    expect(rollRegionEvent('industry', 3, half, true)).not.toBeNull();
    // 安全区（1）首次进区照样不会受伤：概率变高，但"不受伤"的铁律不变
    for (let i = 0; i < 60; i++) {
      const ev = rollRegionEvent('industry', 1, makeRng(i + 1), true);
      if (ev) expect(ev.hp ?? 0).toBeGreaterThanOrEqual(0);
    }
  });
});
