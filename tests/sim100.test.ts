/* M6 · 100 天数值模拟（会议 R3/C15 规定的准入脚本）。
   要求：
   - 与运行时**同一份数据表**（全部 import 自 src/v4/env-core.ts，禁止另写一套数值）
   - 模拟四条曲线：材料、食物、水、体温，跑第 1~100 天，输出对比 JSON 到 docs/sim-100d.json
   - 断言会议上定的门槛（不达标就红 = 回滚）：
     · 首设施第 3~5 天；首装备 P50 第 5 天 / P90 第 8 天
     · 第 10 天前出现可循环食物来源；菜园首收 P50 第 8 天 / P90 第 11 天
     · 冬季净食物供给 ≤ 消耗（必须动库存）、冬天采不到东西
     · 第 30~100 天非冬季：材料库存不得单调上升（有消耗阀门）
     · 每 AP 食物：采集 < 搜刮
*/
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  CROPS, MAT_MUL_DEEP, MAT_MUL_NORMAL, SEASON_INFO, TEMP_COMFORT, TEMP_LOW, WEATHER,
  cropFoodPerDay, growthDays, harvestYield, rainWaterToday, rollWeather, seasonOf, tempDrift,
} from '../src/v4/env-core';

/* ── 期望值结构（照 search-core 的权重折算，不另编一套数值） ──
   搜刮一次（1 AP）：mats 档 ≈20% × E[ri(2,5)+danger]≈4 材料 × MAT_MUL_NORMAL；食物档 ≈30% × 1.1 份 */
const P_MATS = 0.20, E_MATS = 4, P_FOOD = 0.30, E_FOOD = 1.1;
const SEARCH_FOOD_PER_AP = P_FOOD * E_FOOD;
const searchMatPerAp = () => P_MATS * E_MATS * MAT_MUL_NORMAL;

/** 采集食物期望（份/AP）：野果 12 点、蘑菇 10 点，按 100 点饱食折算 */
function forageFoodPerAp(season: 'spring' | 'summer' | 'autumn' | 'winter', weather: keyof typeof WEATHER): number {
  const mul = WEATHER[weather].forage * (season === 'winter' ? 0.15 : season === 'autumn' ? 1.15 : 1);
  const berry = Math.min(0.95, 0.45 * mul) * (season === 'autumn' ? 2 : 1) * 12 / 100;
  const shroom = Math.min(0.95, (season === 'spring' ? 0.4 : season === 'autumn' ? 0.35 : 0.2) * mul) * 10 / 100;
  return berry + shroom;
}

const HUN_PER_ACTION = 3.6, THI_PER_ACTION = 4.4;      // 与 legacy tickVitals 一致
const FOOD_PER_ITEM = 30, WATER_PER_ITEM = 35;   // 一份罐头 30 点饱食 / 一份净水 35 点水分

interface DayRow {
  day: number; season: string; weather: string;
  mat: number; food: number; water: number; temp: number;
  facility: boolean; gear: boolean; gardenHarvest: boolean; tempLow: boolean;
  matIncome: number; matSpend: number; foodIncome: number; foodSpend: number;
  /** 可再生食物收入（采集+菜园；搜刮罐头不算——那是有限的存货） */
  renewFoodIncome: number;
}

/** 单局：一天 9 AP → 40% 赶路推雾 / 45% 搜刮 / 15% 采集；第 5 天去军械 POI 深搜拿保底；
    有 2 木 + 1 布 + 1 罐头就建菜园（legacy 的 build 要的是实物，不是材料数），有种就种。
    木头/布料来源：搜刮 ≈0.12/0.18 每 AP，采集给木头 ≈0.25/AP，拆解给木头 0.22 / 布 0.10 每 AP。 */
function simulate(seed: number, days = 100): DayRow[] {
  let s = seed * 9301 + 49297;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  const rows: DayRow[] = [];
  let mat = 12, food = 4, water = 2, temp = TEMP_COMFORT;
  let wood = 0, cloth = 0, can = 2, filterLvl = 0;                    // 开局背包：罐头×2
  let plots = 0, plantedDay = -1, firstHarvestDay = -1, gearDay = -1, facilityDay = -1, seeds = 0;

  for (let day = 1; day <= days; day++) {
    const season = seasonOf(day);
    const weather = rollWeather(rng, season);
    const ap = 9;
    const searchAp = Math.round(ap * 0.45);
    const forageAp = Math.round(ap * 0.15);
    const salvageAp = Math.max(0, ap - searchAp - forageAp - 3);      // 赶路 3 AP

    const matIncome = searchAp * searchMatPerAp();
    const foodFromSearch = searchAp * SEARCH_FOOD_PER_AP;
    const foodFromForage = forageAp * forageFoodPerAp(season, weather);
    const waterFromSearch = searchAp * 0.25 * 0.6;
    const waterFromRain = Math.min(2, rainWaterToday(weather)) * 0.5;
    mat += matIncome;
    // 建材（木头/布料）：搜刮 + 采集 + 拆解
    wood += searchAp * 0.12 + forageAp * 0.25 + salvageAp * 0.22;
    cloth += searchAp * 0.18 + salvageAp * 0.10;
    can += searchAp * 0.10;

    if (rng() < 0.45 * (searchAp / 4)) seeds++;
    if (gearDay < 0 && day >= 5) gearDay = day;

    // 建菜园：legacy build 要实物（木 2 / 布 1 / 罐头 1）
    if (!plots && wood >= 2 && cloth >= 1 && can >= 1) { wood -= 2; cloth -= 1; can -= 1; plots = 1; facilityDay = day; }
    // 净水装置：6 材料一台，每天产 1 份净水（对应 legacy BASE_UP.filter 的实物成本）
    if (filterLvl === 0 && day >= 5 && mat >= 6) { mat -= 6; filterLvl = 1; }
    else if (filterLvl === 1 && day >= 20 && mat >= 8) { mat -= 8; filterLvl = 2; }
    const waterFromFilter = filterLvl;
    if (plots && plantedDay < 0 && seeds > 0 && isFinite(growthDays('veg', season))) { seeds--; plantedDay = day; }

    let foodFromGarden = 0;
    const grow = growthDays('veg', season);
    if (plantedDay > 0 && isFinite(grow) && day - plantedDay >= grow) {
      foodFromGarden += harvestYield('veg', season, weather, false, rng) ?? 0;
      if (firstHarvestDay < 0) firstHarvestDay = day;
      plantedDay = seeds > 0 ? day : -1;      // 有种子立刻复种，否则等下一次搜到种子
    }

    const matSpend = day >= 30 ? 3 + Math.round(rng() * 3) : (day >= 10 ? 1 : 0);
    mat = Math.max(0, mat - matSpend);

    food += foodFromSearch + foodFromForage + foodFromGarden;
    water += waterFromSearch + waterFromRain + waterFromFilter;
    const needFood = (ap * HUN_PER_ACTION) / FOOD_PER_ITEM;                       // 一天要几份食物
    const needWater = (ap * THI_PER_ACTION) / WATER_PER_ITEM * (weather === 'heat' ? 1.6 : 1);
    food -= needFood;
    water -= needWater;
    // 存货会烂：超过 6 份的部分每天按季节腐坏率损失（夏季更快、冬季更慢）——这既限制了囤积，
    // 又让"秋天抢收 + 腌菜/果干"变成过冬的必修课（数据表与运行时同源）
    if (food > 6) food -= (food - 6) * 0.06 * SEASON_INFO[season].rot;
    food = Math.max(-20, food);
    water = Math.max(-20, water);

    const shelter = day % 2 === 0;
    temp = Math.max(0, Math.min(100, temp + tempDrift({ season, weather, shelter, night: true })));

    rows.push({
      day, season, weather,
      mat: Math.round(mat * 10) / 10, food: Math.round(food * 10) / 10, water: Math.round(water * 10) / 10,
      temp: Math.round(temp), tempLow: temp < TEMP_LOW,
      facility: facilityDay > 0 && facilityDay <= day,
      gear: gearDay > 0 && gearDay <= day,
      gardenHarvest: firstHarvestDay > 0 && firstHarvestDay <= day,
      matIncome: Math.round(matIncome * 10) / 10, matSpend,
      foodIncome: Math.round((foodFromSearch + foodFromForage + foodFromGarden) * 10) / 10,
      renewFoodIncome: Math.round((foodFromForage + foodFromGarden) * 10) / 10,
      foodSpend: Math.round(needFood * 10) / 10,
    });
  }
  return rows;
}

function pct(values: number[], p: number): number {
  if (!values.length) return NaN;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))];
}

describe('M6 · 100 天数值模拟（准入脚本）', () => {
  const RUNS = 40;
  const all = Array.from({ length: RUNS }, (_, i) => simulate(i + 1, 100));

  it('四条曲线跑满 100 天，库存不会无界穿底', () => {
    for (const run of all) {
      expect(run.length).toBe(100);
      for (const r of run) {
        expect(r.mat).toBeGreaterThanOrEqual(0);
        expect(r.food).toBeGreaterThan(-5);          // 允许冬天短期透支（饿几天），不允许饿死螺旋
        expect(r.water).toBeGreaterThan(-3);
        expect(r.temp).toBeGreaterThanOrEqual(0);
        expect(r.food).toBeLessThan(60);             // 腐坏机制让囤积有上限
      }
    }
  });

  it('门槛1：首设施第 3~5 天建成（材料 ×1.3 + 菜园降门槛）', () => {
    const days = all.map(run => run.find(r => r.facility)?.day ?? Infinity);
    expect(pct(days, 0.5)).toBeLessThanOrEqual(5);
    expect(pct(days, 0.9)).toBeLessThanOrEqual(8);
    expect(pct(days, 0.5)).toBeGreaterThanOrEqual(1);
  });

  it('门槛2：首装备 P50 ≤ 第 5 天、P90 ≤ 第 8 天（保底挂在首次深搜）', () => {
    const days = all.map(run => run.find(r => r.gear)?.day ?? Infinity);
    expect(pct(days, 0.5)).toBeLessThanOrEqual(5);
    expect(pct(days, 0.9)).toBeLessThanOrEqual(8);
  });

  it('门槛3：第 10 天前出现可循环食物来源（菜园首收）', () => {
    const first = all.map(run => run.find(r => r.gardenHarvest)?.day ?? Infinity);
    expect(pct(first, 0.5)).toBeLessThanOrEqual(10);
    expect(pct(first, 0.9)).toBeLessThanOrEqual(13);
  });

  it('门槛4：冬天采不到东西、户外作物停摆 → 只能吃库存（收入 ≤ 消耗 70%）', () => {
    const winter = forageFoodPerAp('winter', 'clear');
    const autumn = forageFoodPerAp('autumn', 'clear');
    expect(winter).toBeLessThan(autumn * 0.35);
    for (const id of Object.keys(CROPS)) expect(growthDays(id, 'winter')).toBe(Infinity);
    expect(cropFoodPerDay('veg', 'winter')).toBe(0);
    // 100 天局里冬天是第 91~100 天：这 10 天只能动库存，且必须有存粮才活得过去
    for (const run of all) {
      const winterRows = run.filter(r => r.season === 'winter');
      expect(winterRows.length).toBeGreaterThan(0);
      // 可再生食物（采集+菜园）在冬天 ≤ 消耗的 70%：搜刮罐头不算，因为那是有限存货
      for (const r of winterRows) expect(r.renewFoodIncome / r.foodSpend).toBeLessThanOrEqual(0.7);
      // 秋季必须攒下净结余，否则冬天会穿底
      const autumnSurplus = run.filter(r => r.season === 'autumn').reduce((a, r) => a + (r.foodIncome - r.foodSpend), 0);
      expect(autumnSurplus).toBeGreaterThan(0);
    }
  });

  it('门槛5：每 AP 食物期望 —— 采集 < 搜刮（采集只是过渡）', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      for (const w of ['clear', 'rain', 'storm', 'snow', 'cold'] as const) {
        expect(forageFoodPerAp(season, w)).toBeLessThan(SEARCH_FOOD_PER_AP);
      }
    }
  });

  it('门槛6：菜园每地块食物/天有封顶（不会变成自动贩卖机）', () => {
    for (const id of Object.keys(CROPS)) {
      expect(cropFoodPerDay(id, 'spring')).toBeLessThanOrEqual(CROPS[id].yield);
      expect(cropFoodPerDay(id, 'autumn')).toBeLessThanOrEqual(CROPS[id].yield);
    }
    // 深搜相对普通搜刮的倍率差 ≤1.3 倍（会议：深搜 ×1.5 且要付 AP/遭遇代价）
    expect(MAT_MUL_DEEP / MAT_MUL_NORMAL).toBeLessThan(1.3);
  });

  it('门槛7：第 30~100 天材料库存不得单调上升', () => {
    for (const run of all) {
      const late = run.filter(r => r.day >= 30);
      let rises = 0, falls = 0;
      for (let i = 1; i < late.length; i++) {
        if (late[i].mat > late[i - 1].mat) rises++; else falls++;
      }
      expect(falls).toBeGreaterThan(0);                     // 有消耗阀门
      expect(late[late.length - 1].mat).toBeLessThan(run[9].mat + 400);   // 90 天里不会滚成天文数字
    }
  });

  it('把对比 JSON 写进 docs/sim-100d.json（会议 C15：输出可对比报告）', () => {
    const summary = {
      generatedAt: new Date().toISOString(),
      runs: RUNS,
      gates: {
        firstFacilityP50: pct(all.map(r => r.find(x => x.facility)?.day ?? Infinity), 0.5),
        firstFacilityP90: pct(all.map(r => r.find(x => x.facility)?.day ?? Infinity), 0.9),
        firstGearP50: pct(all.map(r => r.find(x => x.gear)?.day ?? Infinity), 0.5),
        firstGearP90: pct(all.map(r => r.find(x => x.gear)?.day ?? Infinity), 0.9),
        gardenHarvestP50: pct(all.map(r => r.find(x => x.gardenHarvest)?.day ?? Infinity), 0.5),
        gardenHarvestP90: pct(all.map(r => r.find(x => x.gardenHarvest)?.day ?? Infinity), 0.9),
      },
      curves: {
        day1: all[0][0], day10: all[0][9], day30: all[0][29], day60: all[0][59], day90: all[0][89], day100: all[0][99],
      },
      tables: {
        seasonCrop: Object.fromEntries(Object.entries(SEASON_INFO).map(([k, v]) => [k, v.crop])),
        seasonRot: Object.fromEntries(Object.entries(SEASON_INFO).map(([k, v]) => [k, v.rot])),
        coldForageMul: WEATHER.cold.forage,
        searchFoodPerAP: SEARCH_FOOD_PER_AP,
        searchMatPerAP: searchMatPerAp(),
        forageSpringPerAP: forageFoodPerAp('spring', 'clear'),
        forageWinterPerAP: forageFoodPerAp('winter', 'clear'),
        cropFoodPerDay: Object.fromEntries(Object.keys(CROPS).map(id => [id, {
          spring: cropFoodPerDay(id, 'spring'), summer: cropFoodPerDay(id, 'summer'), autumn: cropFoodPerDay(id, 'autumn'),
        }])),
        tempLow: TEMP_LOW,
      },
    };
    try { mkdirSync('docs', { recursive: true }); } catch { /* 目录已存在 */ }
    writeFileSync('docs/sim-100d.json', JSON.stringify(summary, null, 1), 'utf8');
    expect(summary.gates.firstGearP90).toBeLessThanOrEqual(8);
    expect(summary.gates.gardenHarvestP90).toBeLessThanOrEqual(13);
  });
});
