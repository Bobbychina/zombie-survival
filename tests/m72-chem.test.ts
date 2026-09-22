/* M72 化学品转化链：工业区搜到的化学品 → 医疗台/弹药台 → 抗生素 / 爆炸物。
   这一批测的是**配方表本身**与它的两条硬约束：
     ① 材料守恒（产出按商人估价严格便宜于投入）② 没有"投入 1 产出 2 再投入"的套利环。
   纯逻辑都在 src/v4/chem-core.ts；legacy 只接线（合成入口在据点页，探针 docs/_m72_probe.mjs 验 UI）。 */
import { describe, expect, it } from 'vitest';
import {
  CHEM_COST, CHEM_ROWS, CHEM_STATIONS, chemAfford, chemAudit, chemBatch, chemCapBonus, chemCapOf, chemCycle,
  chemLine, chemMissing, chemRow, chemRowsOf, chemUsedToday,
} from '../src/v4/chem-core';
import { itemTable, recipeRows } from './legacy-tables';

const ITEMS = itemTable();

describe('M72 化学品转化链 · 配方表', () => {
  it('每行的产出/投入都在物品表里，id 唯一，且每行都真的吃化学品', () => {
    expect(CHEM_ROWS.length).toBeGreaterThanOrEqual(4);
    const ids = CHEM_ROWS.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);                       // chemUsed 用 id 当键，不能重
    for (const r of CHEM_ROWS) {
      expect(ITEMS[r.out], r.id + ' 的产出不在 ITEMS 里').toBeDefined();
      for (const need of Object.keys(r.need)) expect(ITEMS[need], r.id + ' 的投入 ' + need + ' 不在 ITEMS 里').toBeDefined();
      expect(r.need['chem'], r.id + ' 不含化学品，不是转化链的一环').toBeGreaterThan(0);
      expect(r.n).toBeGreaterThanOrEqual(1);
      expect(r.cap).toBeGreaterThan(0);
      expect(r.lv).toBeLessThanOrEqual(3);                            // 站点满级 3（BASE_UP.max）
      expect(CHEM_STATIONS[r.st]).toBeDefined();
    }
  });

  it('产出一定是"成品"（药/投掷物/弹药），不是可再投入的材料 —— 这条直接堵住套利环的一半', () => {
    for (const r of CHEM_ROWS) expect(['med', 'thr', 'ammo'], r.id + ' 产出成了材料，会被再投进去').toContain(ITEMS[r.out].t);
  });

  it('与制作页口径一致：抗生素那行必须与 legacy RECIPES 里的 anti 一模一样（不是第二套数值）', () => {
    const legacy = recipeRows().find(r => r.out === 'anti');
    expect(legacy, 'legacy RECIPES 里找不到 anti').toBeDefined();
    const mine = chemRow('anti')!;
    expect({ n: mine.n, need: mine.need, st: mine.st, lv: mine.lv })
      .toEqual({ n: legacy!.n, need: legacy!.need, st: legacy!.st, lv: legacy!.lv });
  });

  it('两支台子都接上了：医疗台出药、弹药台出爆炸物/弹药', () => {
    const med = chemRowsOf('medlab'), load = chemRowsOf('loading');
    expect(med.length).toBeGreaterThanOrEqual(2);
    expect(load.length).toBeGreaterThanOrEqual(2);
    for (const r of med) expect(ITEMS[r.out].t).toBe('med');
    for (const r of load) expect(['thr', 'ammo']).toContain(ITEMS[r.out].t);
    expect(load.map(r => r.out)).toContain('grenade');                // 爆炸物：手雷
    expect(load.some(r => ITEMS[r.out].t === 'ammo')).toBe(true);     // 弹药：穿甲弹
  });
});

describe('M72 材料守恒（不许套利）', () => {
  it('每一行按"获取成本当量"都是**亏的**（产出 < 投入），且表里没有漏登记的物品', () => {
    const rows = chemAudit(CHEM_ROWS);
    expect(rows.length).toBe(CHEM_ROWS.length);
    for (const a of rows) {
      expect(a.unpriced, a.id + ' 有物品没进 CHEM_COST，守恒判据会把它当免费').toEqual([]);
      expect(a.outValue, a.id + ' 做出来比材料还便宜搞，可以刷材料').toBeLessThan(a.inValue);
      expect(a.inValue).toBeGreaterThan(0);
    }
  });

  it('同一把尺子量 legacy 的复装配方也成立（说明这尺子不是为 M72 现编的）', () => {
    /* legacy 配方里凡是原料都登记过的（绷带/煮水那种含 fresh 物的跳过），成本必须 ≥ 产出 */
    const known = recipeRows().filter(r => Object.keys(r.need).every(k => CHEM_COST[k] > 0) && CHEM_COST[r.out] > 0);
    expect(known.length).toBeGreaterThanOrEqual(5);   // 复装/制药那几行（成品与原料都登记过的）
    for (const r of known) {
      const inV = Object.keys(r.need).reduce((a, k) => a + CHEM_COST[k] * r.need[k], 0);
      expect(CHEM_COST[r.out] * r.n, 'legacy 配方 ' + r.out + ' 在这把尺子下成了套利').toBeLessThanOrEqual(inV);
    }
  });

  it('没有任何一行的产出会回流成别的行的投入，且整张图无环（chemCycle 为 null）', () => {
    const inputs = new Set<string>();
    for (const r of CHEM_ROWS) for (const k of Object.keys(r.need)) inputs.add(k);
    for (const r of CHEM_ROWS) expect(inputs.has(r.out), r.id + ' 的产出又是别行的投入 → 存在套利环').toBe(false);
    expect(chemCycle(CHEM_ROWS)).toBeNull();
  });

  it('chemBatch 的材料账目 = 单份 × 份数（投入与产出两边都守恒）', () => {
    const r = chemRow('anti')!;
    const b = chemBatch(r, 2, { chem: 99, chip: 99 });
    expect(b.times).toBe(2);
    expect(b.take).toEqual({ chem: r.need['chem'] * 2, chip: r.need['chip'] * 2 });
    expect(b.give).toEqual({ [r.out]: r.n * 2 });
    // 材料不够时被夹到"够得着的最大份数"，绝不透支
    const tight = chemBatch(r, 5, { chem: r.need['chem'] * 3, chip: r.need['chip'] * 3 - 1 });
    expect(tight.times).toBe(2);
    expect(tight.take['chip']).toBe(r.need['chip'] * 2);
    expect(chemBatch(r, 3, { chem: 0, chip: 0 })).toEqual({ times: 0, take: {}, give: {} });
  });
});

describe('M72 每日产能（与 M70 回收台同构：cap + 站点加成 + 当日 used）', () => {
  it('站点等级不够时做不了，并写明"先建"或"需要 Lv.N"', () => {
    const r = chemRow('anti')!;                     // medlab Lv2
    expect(chemAfford(r, { inv: { chem: 99, chip: 99 }, used: 0, stLv: 0 }).max).toBe(0);
    expect(chemAfford(r, { inv: { chem: 99, chip: 99 }, used: 0, stLv: 0 }).why).toContain('先建医疗台');
    expect(chemAfford(r, { inv: { chem: 99, chip: 99 }, used: 0, stLv: 1 }).why).toContain('Lv.2');
    expect(chemAfford(r, { inv: { chem: 99, chip: 99 }, used: 0, stLv: 2 }).max).toBe(r.cap);
  });

  it('产能上限卡住：用完之后 max=0 且给出原因；升级站点每级 +1 产能', () => {
    const r = chemRow('anti')!;
    expect(chemAfford(r, { inv: { chem: 999, chip: 999 }, used: r.cap, stLv: 2 }).max).toBe(0);
    expect(chemAfford(r, { inv: { chem: 999, chip: 999 }, used: r.cap, stLv: 2 }).why).toContain('产能用完');
    expect(chemCapBonus(r, 2)).toBe(0);
    expect(chemCapOf(r, 2)).toBe(r.cap);
    expect(chemCapOf(r, 3)).toBe(r.cap + 1);
    expect(chemAfford(r, { inv: { chem: 999, chip: 999 }, used: r.cap, stLv: 3 }).max).toBe(1);
  });

  it('材料不足时给"缺哪件、缺几件"，额度与材料双重限制取小', () => {
    const r = chemRow('anti')!;
    const short = chemMissing(r, { chem: r.need['chem'] - 1, chip: r.need['chip'] });
    expect(short).toEqual([expect.objectContaining({ id: 'chem', short: 1 })]);
    const line = chemLine(r, { inv: { chem: 1, chip: 1 }, used: 0, stLv: 3 });
    expect(line.can).toBe(0);
    expect(line.short[0]).toEqual(expect.objectContaining({ id: 'chem', need: r.need['chem'], have: 1, short: 1 }));
    expect(line.cap).toBe(r.cap + 1);
    // 材料够但额度不够：can 取额度那一侧
    expect(chemLine(r, { inv: { chem: 999, chip: 999 }, used: r.cap + 1, stLv: 3 }).can).toBe(0);
  });

  it('额度按"天"重置：当天读得出来，隔天归零，脏数据当 0', () => {
    expect(chemUsedToday({ day: 5, used: { anti: 2 } }, 5)).toEqual({ anti: 2 });
    expect(chemUsedToday({ day: 5, used: { anti: 2 } }, 6)).toEqual({});
    expect(chemUsedToday(null, 6)).toEqual({});
    expect(chemUsedToday({ day: 6, used: { anti: 'x' } as any }, 6)).toEqual({});
  });
});
