/* M8 伐木纯逻辑单测：季节差异、工具加成单调性与保底、每日上限、值域、可复现性、附带产出。
   数值全部来自 src/v4/wood-core.ts（与游戏运行时同源），不碰 window。 */
import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import {
  CHOP_AP, CHOP_BASE, CHOP_MAX_WOOD, CHOP_POOL, CHOP_TOOL_MUL, canChop, chopEstimate, chopLeft, chopOnce,
  chopSpots, chopToolOf, chopWood, type ChopTool,
} from '../src/v4/wood-core';
import type { Season, WeatherId } from '../src/v4/env-core';

/** 固定的一串骰点：同一颗骰子下比较不同参数，才能看出"倍率"的单调性 */
const dice = (n: number, seed = 'dice') => { const r = seedrandom(seed); return Array.from({ length: n }, () => r()); };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const roll = (us: number[], fn: (u: number) => number) => us.map(fn);
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const WEATHERS: WeatherId[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'heat', 'cold'];
const TOOLS: ChopTool[] = ['none', 'crowbar', 'axe'];

describe('伐木 · 群系门槛', () => {
  it('只有林地/废墟/农田/郊区能砍，其它群系明确不可用', () => {
    expect(CHOP_POOL.forest).toBeGreaterThanOrEqual(4);
    for (const b of ['forest', 'ruins', 'farm', 'suburb']) expect(canChop(b)).toBe(true);
    for (const b of ['city', 'industrial', 'military', 'highway', 'water']) {
      expect(canChop(b)).toBe(false);
      expect(chopSpots(b)).toBe(0);
      expect(chopWood(() => 0, b, 'autumn', 'clear', 'axe')).toBe(0);
    }
    // 林地基产最高：砍木头的主战场
    expect(CHOP_BASE.forest).toBeGreaterThan(CHOP_BASE.ruins);
  });
});

describe('伐木 · 季节', () => {
  it('秋 > 春 > 夏 > 冬（同一颗骰点逐次比较，冬天地面冻硬产量最低）', () => {
    const us = dice(200, 'season');
    const forest = (s: Season) => sum(roll(us, u => chopWood(() => u, 'forest', s, 'clear', 'axe')));
    const autumn = forest('autumn'), spring = forest('spring'), summer = forest('summer'), winter = forest('winter');
    expect(autumn).toBeGreaterThan(spring);
    expect(spring).toBeGreaterThan(summer);
    expect(summer).toBeGreaterThan(winter);
    expect(winter).toBeLessThan(spring * 0.6);      // 冬天确实被"冻掉"一大截
    // 逐次（同骰点）也不许出现冬 > 春的反例
    for (const u of us) {
      expect(chopWood(() => u, 'forest', 'winter', 'clear', 'axe'))
        .toBeLessThanOrEqual(chopWood(() => u, 'forest', 'spring', 'clear', 'axe'));
    }
  });
});

describe('伐木 · 工具', () => {
  it('加成单调：斧头 ≥ 撬棍 ≥ 徒手（逐次 + 合计 + 面板估计值）', () => {
    const us = dice(300, 'tool');
    const t = (tool: ChopTool) => roll(us, u => chopWood(() => u, 'forest', 'spring', 'clear', tool));
    const none = t('none'), bar = t('crowbar'), axe = t('axe');
    for (let i = 0; i < us.length; i++) {
      expect(axe[i]).toBeGreaterThanOrEqual(bar[i]);
      expect(bar[i]).toBeGreaterThanOrEqual(none[i]);
    }
    expect(sum(axe)).toBeGreaterThan(sum(bar));
    expect(sum(bar)).toBeGreaterThan(sum(none));
    expect(CHOP_TOOL_MUL.axe).toBeGreaterThan(CHOP_TOOL_MUL.crowbar);
    expect(CHOP_TOOL_MUL.crowbar).toBeGreaterThan(CHOP_TOOL_MUL.none);
    const est = (tool: ChopTool) => chopEstimate('forest', 'spring', 'clear', tool);
    expect(est('axe')).toBeGreaterThan(est('crowbar'));
    expect(est('crowbar')).toBeGreaterThan(est('none'));
  });

  it('装备判定：有斧头优先用斧头，其次撬棍，都没有才徒手', () => {
    expect(chopToolOf(1, 1)).toBe('axe');
    expect(chopToolOf(0, 2)).toBe('crowbar');
    expect(chopToolOf(0, 0)).toBe('none');
  });
});

describe('伐木 · 无工具保底', () => {
  it('徒手在林地任意季节/天气都至少砍到 1 木（这是"可靠来源"的底线）', () => {
    for (const s of SEASONS) for (const w of WEATHERS) {
      for (const u of [0, 0.25, 0.5, 0.75, 0.999]) {
        const n = chopWood(() => u, 'forest', s, w, 'none');
        expect(n).toBeGreaterThanOrEqual(1);
      }
      // 期望值同样 ≥1：面板显示的"约 X 木"不能是 0
      expect(chopEstimate('forest', s, w, 'none')).toBeGreaterThanOrEqual(1);
      expect(chopEstimate('ruins', s, w, 'none')).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('伐木 · 值域', () => {
  it('所有群系/季节/天气/工具组合都在 [1, CHOP_MAX_WOOD]，不会 0 也不会爆表', () => {
    let max = 0;
    for (const b of Object.keys(CHOP_BASE)) for (const s of SEASONS) for (const w of WEATHERS) for (const tool of TOOLS) {
      for (const u of [0, 0.1, 0.33, 0.5, 0.67, 0.9, 0.999999]) {
        const n = chopWood(() => u, b, s, w, tool);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(CHOP_MAX_WOOD);
        max = Math.max(max, n);
      }
    }
    // 上限是真的用得上但不是随便撞到：最肥的组合（林地·秋·斧头）= base3 × 1.25 × 1.6 = 6
    expect(max).toBe(6);
    expect(chopEstimate('forest', 'autumn', 'clear', 'axe')).toBe(6);
    expect(chopEstimate('forest', 'autumn', 'clear', 'axe')).toBeLessThanOrEqual(CHOP_MAX_WOOD);
  });
});

describe('伐木 · 每日上限', () => {
  it('上限用尽后 ok=false、不产出，隔天回满；次数被夹在 [0, pool] 内', () => {
    const pools = chopSpots('forest');
    const args = { biome: 'forest', season: 'spring' as Season, weather: 'clear' as WeatherId, tool: 'axe' as ChopTool };
    let left = pools, wood = 0;
    for (let i = 0; i < pools; i++) {
      const r = chopOnce(Math.random, { ...args, left });
      expect(r.ok).toBe(true);
      expect(r.wood).toBeGreaterThanOrEqual(1);
      left = r.left; wood += r.wood;
    }
    expect(left).toBe(0);
    expect(wood).toBeGreaterThan(0);
    const over = chopOnce(Math.random, { ...args, left: 0 });
    expect(over.ok).toBe(false);
    expect(over.wood).toBe(0);
    expect(over.extra).toEqual([]);
    expect(over.why).toContain('砍够');
    // 面板同款读取：当天记 0，隔天自动回满
    expect(chopLeft({ left: 0, day: 12 }, 12, 'forest')).toBe(0);
    expect(chopLeft({ left: 0, day: 12 }, 13, 'forest')).toBe(pools);
    expect(chopLeft(undefined, 12, 'forest')).toBe(pools);
    expect(chopLeft({ left: 999, day: 12 }, 12, 'forest')).toBe(pools);   // 坏档夹回上限
    expect(chopLeft({ left: -5, day: 12 }, 12, 'forest')).toBe(0);
  });
});

describe('伐木 · 可复现', () => {
  it('同 seed 同骰点得到完全相同的产量序列，不同 seed 会不同', () => {
    const run = (seed: string) => {
      const rng = seedrandom(seed);
      const out: number[][] = [];
      for (let i = 0; i < 12; i++) {
        const r = chopOnce(rng, { biome: 'forest', season: 'autumn', weather: 'rain', tool: 'crowbar', left: 12 });
        out.push([r.wood, r.extra.length, r.left]);
      }
      return JSON.stringify(out);
    };
    expect(run('repro-1')).toBe(run('repro-1'));
    expect(run('repro-1')).not.toBe(run('repro-2'));
  });
});

describe('伐木 · 附带产出', () => {
  it('每次最多 1 布 + 1 铁（量小），废铁只在有建筑残骸的群系出', () => {
    const tally: Record<string, number> = {};
    const rng = seedrandom('extra');
    for (let i = 0; i < 2000; i++) {
      const r = chopOnce(rng, { biome: 'forest', season: 'spring', weather: 'clear', tool: 'axe', left: 5 });
      const cloth = r.extra.find(e => e.id === 'cloth')?.n ?? 0;
      const metal = r.extra.find(e => e.id === 'metal')?.n ?? 0;
      expect(cloth).toBeLessThanOrEqual(1);
      expect(metal).toBeLessThanOrEqual(1);
      expect(r.extra.reduce((a, e) => a + e.n, 0)).toBeLessThanOrEqual(2);
      for (const e of r.extra) tally[e.id] = (tally[e.id] || 0) + 1;
    }
    // "有概率"而不是必出：布大约两成，铁在林地只是零星
    expect(tally.cloth ?? 0).toBeGreaterThan(200);
    expect(tally.cloth ?? 0).toBeLessThan(700);
    expect(tally.metal ?? 0).toBeLessThan(350);
    expect(tally.cloth ?? 0).toBeGreaterThan(tally.metal ?? 0);
  });

  it('行动力代价固定 1 点，产量与次数都写进结果里', () => {
    expect(CHOP_AP).toBe(1);
    const r = chopOnce(seedrandom('ap'), { biome: 'farm', season: 'winter', weather: 'snow', tool: 'none', left: 2 });
    expect(r).toMatchObject({ ok: true, left: 1 });
    expect(r.wood).toBeGreaterThanOrEqual(1);
  });
});
