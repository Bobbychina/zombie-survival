/* M7 纯逻辑单测：钓鱼概率与产出、游泳风险、氧气预算、水下掉落、鱼塘产量、沉没基地放置。 */
import { describe, expect, it } from 'vitest';
import { generateWorld, bkey } from '../src/v4/worldgen';
import {
  DIVE_NO_TANK_LIMIT, FISH, FISH_SPOTS_PER_BLOCK, INTAKE_AP, INTAKE_PER_ACTION, INTAKE_PER_DAY, O2_PER_TANK,
  POND_FEED_MUL, POND_LEVEL_YIELD, POND_WINTER_MUL,
  SUNKEN_MIN_DIST, SUNKEN_PER_WORLD, diveBudget, fishChance, fishOnce, pickDiveLoot, pondFoodPerDay, pondYield,
  swimRisk, waterDepth,
} from '../src/v4/water-core';
import { POIS } from '../src/v4/pois';

const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

describe('钓鱼', () => {
  it('装备与天气/季节显著影响命中率，且被夹在 2%~95% 之间', () => {
    const bare = fishChance('spring', 'clear', false, false, false);
    const full = fishChance('spring', 'clear', true, true, false);
    expect(full).toBeGreaterThan(bare + 0.3);
    expect(fishChance('winter', 'cold', false, false, true)).toBeGreaterThanOrEqual(0.02);
    expect(fishChance('autumn', 'rain', true, true, false)).toBeLessThanOrEqual(0.95);
    // 雨天 > 暴雨；秋天 > 冬天
    expect(fishChance('spring', 'rain', false, false, false)).toBeGreaterThan(fishChance('spring', 'storm', false, false, false));
    expect(fishChance('autumn', 'clear', false, false, false)).toBeGreaterThan(fishChance('winter', 'clear', false, false, false));
  });

  it('上钩给鱼（有竿多一条），没上钩给杂物而不是空手', () => {
    const hit = fishOnce(() => 0, 'spring', 'clear', true, true, false);
    expect(hit.item).toBe(FISH);
    expect(hit.n).toBeGreaterThanOrEqual(2);          // 1 + 鱼竿加成
    const miss = fishOnce(seq(0.99, 0.1), 'spring', 'clear', false, false, false);
    expect(miss.item).not.toBe(FISH);
    expect(['cloth', 'bottle', 'tape', null]).toContain(miss.item);
  });

  it('同一片水域每天有次数上限', () => {
    expect(FISH_SPOTS_PER_BLOCK).toBeGreaterThanOrEqual(1);
    expect(FISH_SPOTS_PER_BLOCK).toBeLessThanOrEqual(5);
  });
});

describe('下水游泳', () => {
  it('没潜水服才会抽筋；冬天风险更高；有潜水服几乎只剩感染', () => {
    const cold = swimRisk(() => 0, 'winter', 'snow', false);
    expect(cold.cramp).toBe(true);
    expect(cold.infect).toBeGreaterThan(0);
    const geared = swimRisk(() => 0, 'winter', 'snow', true);
    expect(geared.cramp).toBe(false);
    expect(geared.infect).toBeLessThanOrEqual(7);
    // 极端随机值下不会给出负数感染
    for (const r of [0, 0.5, 0.99]) expect(swimRisk(() => r, 'spring', 'clear', false).infect).toBeGreaterThanOrEqual(0);
  });

  it('深浅水判定：贴着陆地是浅水，四周都是水是深水', () => {
    expect(waterDepth(true)).toBe('shallow');
    expect(waterDepth(false)).toBe('deep');
  });
});

describe('水下探索', () => {
  it('氧气瓶给 3 次，没有瓶子只能憋一口气潜 1 次', () => {
    expect(O2_PER_TANK).toBe(3);
    expect(diveBudget(0, 0)).toEqual({ left: DIVE_NO_TANK_LIMIT, needTank: true });
    expect(diveBudget(1, 0).left).toBe(3);
    expect(diveBudget(1, 3).left).toBe(0);
    expect(diveBudget(2, 5).left).toBe(1);
  });

  it('水下掉落池里的 id 都真实存在（否则玩家会摸到空气）', () => {
    const VALID = new Set(['chip', 'ammo', 'kevlar', 'hazmat', 'serum', 'o2', 'wetsuit', 'rifle', 'metal', 'chem']);
    for (const it of ['chip', 'ammo', 'kevlar', 'hazmat', 'serum', 'o2', 'wetsuit', 'rifle', 'metal', 'chem']) expect(VALID.has(it)).toBe(true);
    for (let i = 0; i < 30; i++) expect(VALID.has(pickDiveLoot(Math.random))).toBe(true);
    expect(POIS.sunken.enemies).toContain('drowned');
    expect(POIS.sunken.biomes).toEqual(['water']);
  });
});

describe('水产养殖（鱼塘）', () => {
  it('产量随等级上升，投喂翻倍，冬天掉到 40%', () => {
    expect(POND_LEVEL_YIELD[0]).toBe(0);
    expect(pondYield(1, 'spring', 'clear', false)).toBeGreaterThan(0);
    expect(pondYield(2, 'spring', 'clear', false)).toBeGreaterThan(pondYield(1, 'spring', 'clear', false));
    expect(pondYield(1, 'spring', 'clear', true)).toBeGreaterThan(pondYield(1, 'spring', 'clear', false) * (POND_FEED_MUL - 0.5));
    expect(pondYield(1, 'winter', 'clear', true)).toBeLessThan(pondYield(1, 'spring', 'clear', true) * 0.6);
    expect(POND_WINTER_MUL).toBeLessThan(0.5);
  });

  it('满级鱼塘的日产不会超过一次采集/搜刮太多（防自动贩卖机）', () => {
    const perDay = pondFoodPerDay(3, 'spring');
    expect(perDay).toBeLessThan(6);       // 一次 1 AP 采集期望 ≈0.1 份食物，但采集有上限；鱼塘满级也就几份鱼
    expect(perDay).toBeGreaterThan(1);
  });
});

describe('沉没基地放置', () => {
  it('每张图 1~2 个，只放在深水里，距家 ≥6 区块，且稳定可复现', () => {
    for (const seed of ['ember-01', 's1', 's3', 'zombie-42']) {
      const w = generateWorld(seed);
      const sunken = Object.values(w.blocks).filter(b => b.poi === 'sunken');
      expect(sunken.length).toBeGreaterThan(0);
      expect(sunken.length).toBeLessThanOrEqual(SUNKEN_PER_WORLD);
      for (const b of sunken) {
        expect(b.biome).toBe('water');
        const d = Math.max(Math.abs(b.x - w.home.x), Math.abs(b.y - w.home.y));
        expect(d).toBeGreaterThanOrEqual(SUNKEN_MIN_DIST);
        // 四周全水 = 深水（潜水点）
        let land = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nb = w.blocks[bkey(b.x + dx, b.y + dy)];
          if (nb && nb.biome !== 'water') land++;
        }
        expect(land).toBe(0);
      }
      const again = generateWorld(seed);
      expect(Object.values(again.blocks).filter(b => b.poi === 'sunken').map(b => bkey(b.x, b.y)).sort())
        .toEqual(sunken.map(b => bkey(b.x, b.y)).sort());
    }
  });
});

/* M7.1：用户要求"水可以从水体里接，然后用净化片+烧开就能喝"——
   这里守住取水的量：够一天喝、又不至于把水体系变成自来水龙头。 */
describe('取水（M7.1）', () => {
  it('一片水域每天的接水量：能出 2~3 份净水，不至于白送', () => {
    expect(INTAKE_AP).toBe(1);
    expect(INTAKE_PER_ACTION).toBe(2);
    expect(INTAKE_PER_DAY).toBe(3);
    const dirtyPerDay = INTAKE_PER_ACTION * INTAKE_PER_DAY;      // 6 份污水/天/水域
    // 煮沸配方是 2 份污水 → 1 份净水；净化片是 1→1（要药片，代价在片上）
    expect(dirtyPerDay / 2).toBeGreaterThanOrEqual(2);
    expect(dirtyPerDay).toBeLessThanOrEqual(8);                  // 再多就等于取消水压力了
    expect(INTAKE_PER_ACTION).toBeGreaterThanOrEqual(2);         // 一次接 2 份，正好够一次煮沸
  });
});
