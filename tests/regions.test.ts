/* 多区域大世界的纯逻辑测试：种子派生、相邻判定、载具门槛、成本核算 */
import { describe, expect, it } from 'vitest';
import {
  HOME_REGION, REGIONS, areAdjacent, dangerLabel, metaGrid, neighborsOf, planRegionTrip,
  regionById, regionSeed, regionTravelCost,
} from '../src/v4/regions-core';

describe('区域元地图', () => {
  it('3×3 共 9 个区域，坐标不重复，且中心是玩家起点', () => {
    expect(REGIONS.length).toBe(9);
    const seen = new Set(REGIONS.map(r => r.col + ',' + r.row));
    expect(seen.size).toBe(9);
    const home = regionById(HOME_REGION);
    expect(home).toBeTruthy();
    expect(home!.col).toBe(1);
    expect(home!.row).toBe(1);
    expect(home!.homeBase).toBe(true);
    expect(REGIONS.filter(r => r.homeBase).length).toBe(1);   // 安全屋只有一处
  });

  it('元地图矩阵铺满 3×3，没有空洞', () => {
    const g = metaGrid();
    expect(g.length).toBe(3);
    for (const row of g) { expect(row.length).toBe(3); for (const cell of row) expect(cell).not.toBeNull(); }
  });

  it('每个区域的 24×24 世界种子都不一样，且同区域可复现', () => {
    const seeds = REGIONS.map(r => regionSeed('ember-01', r.id));
    expect(new Set(seeds).size).toBe(REGIONS.length);
    expect(regionSeed('ember-01', 'ember')).toBe(regionSeed('ember-01', 'ember'));
    expect(regionSeed('ember-01', 'ember')).not.toBe(regionSeed('ember-02', 'ember'));
  });

  it('危险层级：主城最低、外圈最高', () => {
    expect(regionById('ember')!.tier).toBe(1);
    expect(Math.max(...REGIONS.map(r => r.tier))).toBe(5);
    expect(dangerLabel(1)).toContain('安全');
    expect(dangerLabel(5)).toContain('九死');
  });
});

describe('相邻与成本', () => {
  it('正交与斜向都算相邻，自己和自己不算', () => {
    const ember = regionById('ember')!;
    const dongjiao = regionById('dongjiao')!;   // 正东
    const binhai = regionById('binhai')!;       // 东北（斜向）
    const beiling = regionById('beiling')!;     // 西北（斜向）
    const nangang = regionById('nangang')!;     // 东南（斜向）
    expect(areAdjacent(ember, dongjiao)).toBe(true);
    expect(areAdjacent(ember, binhai)).toBe(true);
    expect(areAdjacent(ember, beiling)).toBe(true);
    expect(areAdjacent(ember, nangang)).toBe(true);
    expect(areAdjacent(ember, ember)).toBe(false);
    // 正对角线的两格不相邻（西山 vs 南港）
    expect(areAdjacent(regionById('xishan')!, nangang)).toBe(false);
  });

  it('中心区有 8 个邻居（3×3 的中间格）', () => {
    expect(neighborsOf('ember').length).toBe(8);
    expect(neighborsOf('beiling').length).toBe(3);   // 角上只有 3 个
  });

  it('斜向跨区比正交贵', () => {
    const ember = regionById('ember')!;
    const orth = regionTravelCost(ember, regionById('dongjiao')!);
    const diag = regionTravelCost(ember, regionById('binhai')!);
    expect(orth.ap).toBe(3); expect(orth.fuel).toBe(2);
    expect(diag.ap).toBeGreaterThan(orth.ap);
    expect(diag.fuel).toBeGreaterThan(orth.fuel);
  });
});

describe('载具门槛（这轮的核心规则）', () => {
  const base = { fuel: 5, ap: 9, apMax: 9, from: 'ember', to: 'dongjiao' };

  it('没有载具：跨区被拦，并给出可操作的建议', () => {
    const r = planRegionTrip({ ...base, hasVehicle: false });
    expect(r.ok).toBe(false);
    expect(r.why).toContain('走不到');
    expect(r.hint).toContain('车');
  });

  it('有车但油不够：拦下来并提示加油', () => {
    const r = planRegionTrip({ ...base, hasVehicle: true, fuel: 1 });
    expect(r.ok).toBe(false);
    expect(r.why).toContain('油不够');
    expect(r.hint).toContain('油');
  });

  it('行动力不够：拦下来并提示睡觉', () => {
    const r = planRegionTrip({ ...base, hasVehicle: true, ap: 1 });
    expect(r.ok).toBe(false);
    expect(r.why).toContain('行动力');
  });

  it('有车有油有行动力：放行，并报出成本与目的地危险度', () => {
    const r = planRegionTrip({ ...base, hasVehicle: true });
    expect(r.ok).toBe(true);
    expect(r.ap).toBe(3);
    expect(r.fuel).toBe(2);
    expect(r.danger).toBe(regionById('dongjiao')!.tier);
  });

  it('不接壤的区域不能直接跨（只能一格一格挪）', () => {
    const r = planRegionTrip({ hasVehicle: true, fuel: 9, ap: 9, apMax: 9, from: 'xishan', to: 'nangang' });
    expect(r.ok).toBe(false);
    expect(r.why).toContain('不接壤');
  });

  it('已经在目标区域时不再收钱', () => {
    const r = planRegionTrip({ hasVehicle: true, fuel: 9, ap: 9, apMax: 9, from: 'ember', to: 'ember' });
    expect(r.ok).toBe(false);
    expect(r.why).toContain('已经在');
  });
});
