/* M6 纯逻辑单测：季节/天气/体温/作物/采集/拆解/保底。
   这些都是"每天都要跑一次"的数值，改错了玩家第二天就会发现，所以钉死。 */
import { describe, expect, it } from 'vitest';
import {
  CROPS, FORAGE_POOL, GEAR_BY_DANGER, MAT_MUL_DEEP, MAT_MUL_NORMAL, RAIN_CAP_PER_DAY, SEASON_INFO,
  TEMP_COMFORT, TEMP_HIGH, TEMP_LOW, WEATHER, WEATHER_LIST, cropFoodPerDay, forageYields, growthDays,
  harvestYield, pickGear, rainWaterToday, rollWeather, rotDays, seasonOf, tempDrift, tempPenalty,
} from '../src/v4/env-core';

const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

describe('季节', () => {
  it('每 30 天一个季节，100 天里四个季节都出现', () => {
    expect(seasonOf(1)).toBe('spring');
    expect(seasonOf(30)).toBe('spring');
    expect(seasonOf(31)).toBe('summer');
    expect(seasonOf(60)).toBe('summer');
    expect(seasonOf(61)).toBe('autumn');
    expect(seasonOf(90)).toBe('autumn');
    expect(seasonOf(91)).toBe('winter');
    expect([1, 40, 70, 100].map(seasonOf)).toEqual(['spring', 'summer', 'autumn', 'winter']);
  });

  it('系数：春 1.0 / 夏 0.8 / 秋 1.3 / 冬 0（户外停摆）', () => {
    expect([SEASON_INFO.spring.crop, SEASON_INFO.summer.crop, SEASON_INFO.autumn.crop, SEASON_INFO.winter.crop]).toEqual([1, 0.8, 1.3, 0]);
  });

  it('腐坏：夏天更快、冬天更慢', () => {
    expect(rotDays('veg', 'summer', 4)).toBeLessThan(rotDays('veg', 'winter', 4));
    expect(rotDays('veg', 'spring', 4)).toBe(4);
  });
});

describe('天气', () => {
  it('按季节权重掷，冬天会下雪、不会有暴雨/热浪', () => {
    for (let i = 0; i < 50; i++) {
      const w = rollWeather(Math.random, 'winter');
      expect(['snow', 'cold', 'clear', 'cloudy', 'rain', 'fog']).toContain(w);
      expect(WEATHER[w].w.winter).toBeGreaterThan(0);
    }
    for (let i = 0; i < 30; i++) expect(WEATHER[rollWeather(Math.random, 'summer')].w.summer).toBeGreaterThan(0);
  });

  it('天气影响：暴雨不能生火、寒潮让采集归零、雨天有积水且封顶', () => {
    expect(WEATHER.storm.fire).toBe(false);
    expect(WEATHER.cold.forage).toBeLessThanOrEqual(0.05);
    expect(rainWaterToday('rain')).toBeGreaterThan(0);
    expect(rainWaterToday('snow')).toBeGreaterThan(0);
    expect(rainWaterToday('clear')).toBe(0);
    expect(rainWaterToday('storm')).toBeLessThanOrEqual(RAIN_CAP_PER_DAY);
  });

  it('所有天气的权重表四季齐全（避免某个季节掷不出天气）', () => {
    for (const id of WEATHER_LIST) {
      for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) {
        expect(typeof WEATHER[id].w[s]).toBe('number');
      }
      expect(WEATHER[id].w.spring + WEATHER[id].w.summer + WEATHER[id].w.autumn + WEATHER[id].w.winter).toBeGreaterThan(0);
    }
  });
});

describe('体温', () => {
  it('舒适区不惩罚；低了扣一档 AP 与命中；高了只提醒喝水', () => {
    expect(tempPenalty(TEMP_COMFORT)).toEqual({ ap: 0, hit: 0, note: null });
    const cold = tempPenalty(TEMP_LOW - 1);
    expect(cold.ap).toBe(-1);
    expect(cold.hit).toBeLessThan(0);
    const hot = tempPenalty(TEMP_HIGH + 1);
    expect(hot.ap).toBe(0);
    expect(hot.note).toContain('水分');
  });

  it('冬天户外掉得快，火堆/室内完全对抗（会议口径：不做持续掉血）', () => {
    const outside = tempDrift({ season: 'winter', weather: 'snow', shelter: false });
    const inside = tempDrift({ season: 'winter', weather: 'snow', shelter: true });
    expect(outside).toBeLessThan(-5);
    expect(inside).toBeGreaterThan(0);
    // 寒潮 + 冬天：连续 5 次暴露就会跌破阈值（可测惩罚）
    let t = TEMP_COMFORT;
    for (let i = 0; i < 5; i++) t += tempDrift({ season: 'winter', weather: 'cold', shelter: false });
    expect(t).toBeLessThan(TEMP_LOW);
    // 同样的条件下躲在室内：不会跌破
    let t2 = TEMP_COMFORT;
    for (let i = 0; i < 5; i++) t2 += tempDrift({ season: 'winter', weather: 'cold', shelter: true });
    expect(t2).toBeGreaterThanOrEqual(TEMP_LOW);
  });
});

describe('作物', () => {
  it('至少两种作物：快熟低产 vs 慢熟高产（否则"种什么"是伪决策）', () => {
    const list = Object.values(CROPS);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const fast = list.reduce((a, b) => (a.days < b.days ? a : b));
    const slow = list.reduce((a, b) => (a.days > b.days ? a : b));
    expect(fast.days).toBeLessThan(slow.days);
    expect(fast.yield).toBeLessThan(slow.yield);
  });

  it('生长天数 = 基准 ÷ 季节系数；冬天户外不长', () => {
    expect(growthDays('veg', 'spring')).toBe(5);
    expect(growthDays('veg', 'autumn')).toBe(4);
    expect(growthDays('veg', 'summer')).toBe(7);
    expect(growthDays('veg', 'winter')).toBe(Infinity);
    expect(cropFoodPerDay('veg', 'spring')).toBeGreaterThan(0);
    expect(cropFoodPerDay('veg', 'winter')).toBe(0);
  });

  it('留种少收一茬；绝收时返回 0/null 而不是负收益', () => {
    const normal = harvestYield('veg', 'spring', 'clear', false, () => 0.5)!;
    const keep = harvestYield('veg', 'spring', 'clear', true, () => 0.5)!;
    expect(keep).toBeLessThan(normal);
    expect(harvestYield('veg', 'winter', 'clear', false, () => 0.5)).toBeNull();
    expect(harvestYield('veg', 'spring', 'snow', false, () => 0.5)).toBeNull();
  });
});

describe('采集 / 拆解 / 装备保底', () => {
  it('冬天采集几乎归零，其他季节有产出（不会空手，但也不无限）', () => {
    let winter = 0, autumn = 0;
    for (let i = 0; i < 200; i++) {
      winter += forageYields(Math.random, 'forest', 'winter', 'clear').items.reduce((a, b) => a + b.n, 0);
      autumn += forageYields(Math.random, 'forest', 'autumn', 'clear').items.reduce((a, b) => a + b.n, 0);
    }
    expect(winter).toBeLessThan(autumn * 0.35);
  });
  it('每个区块都有采集/拆解上限（禁止无限刷）', () => {
    for (const b of ['forest', 'farm', 'suburb', 'city', 'industrial', 'ruins']) expect(FORAGE_POOL[b]).toBeGreaterThan(0);
    expect(FORAGE_POOL.water).toBe(0);
  });
  it('装备保底按危险度分档，越高越硬', () => {
    const low = new Set(GEAR_BY_DANGER[2]);
    const high = new Set(GEAR_BY_DANGER[5]);
    expect(low.has('rifle')).toBe(false);
    expect(high.has('kevlar') || high.has('hazmat')).toBe(true);
    for (const d of [2, 3, 4, 5]) expect(GEAR_BY_DANGER[d].length).toBeGreaterThan(2);
    expect(pickGear(() => 0, 5)).toBeTruthy();
  });
  it('材料提速倍率就是会议上定的 ×1.3 / ×1.5', () => {
    expect(MAT_MUL_NORMAL).toBe(1.3);
    expect(MAT_MUL_DEEP).toBe(1.5);
  });
  it('随机数极端值也不会把采集掷成负数', () => {
    for (const r of [0, 0.5, 1]) {
      const out = forageYields(() => r, 'forest', 'spring', 'rain');
      for (const it of out.items) expect(it.n).toBeGreaterThan(0);
    }
    void seq;
  });
});
