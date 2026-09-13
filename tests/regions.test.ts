/* M17 元地图（程序化生成的 12×12 = 144 个区域）测试。
   这一组盯的是"地图讲不讲道理"——用户贴的评审意见里最扎眼两条：
   ① 地理逻辑（"跨江"在北、"江北"在南；老城被扔到角落）② 危险度不成辐射梯度（出门往东像散步、往南直接危险 5）。 */
import { describe, expect, it } from 'vitest';
import {
  HOME_REGION, MAX_HOPS, META_COLS, META_ROWS, REGION_COLS, REGION_ROWS, REGIONS, REGION_SHORT_WORD, TYPE_INFO,
  areAdjacent, buildRegions, dangerLabel, homeRegion, metaGrid, neighborsOf, planRegionTrip,
  regionById, regionName, regionPath, regionTravelCost,
} from '../src/v4/regions-core';

const T = buildRegions('regions-test');
const home = T.find(r => r.homeBase)!;
const ctx = (over: Partial<Parameters<typeof planRegionTrip>[0]> = {}) => ({
  hasVehicle: true, fuel: 12, ap: 9, apMax: 9, from: home.id, to: home.id, ...over,
});

describe('M17 元地图：规模与结构', () => {
  it('按种子生成 12×12 = 144 个区域（不再是写死的 9 个）', () => {
    expect(T.length).toBe(REGION_COLS * REGION_ROWS);
    expect(T.length).toBe(144);
    expect(META_COLS).toBe(12);
    expect(META_ROWS).toBe(12);
    expect(new Set(T.map(r => r.id)).size).toBe(144);
    expect(new Set(T.map(r => `${r.col},${r.row}`)).size).toBe(144);
  });

  it('每个区域字段齐全：类型/危险/地名/资源/主题偏置都在范围内', () => {
    for (const r of T) {
      expect(r.col).toBeGreaterThanOrEqual(0); expect(r.col).toBeLessThan(REGION_COLS);
      expect(r.row).toBeGreaterThanOrEqual(0); expect(r.row).toBeLessThan(REGION_ROWS);
      expect(r.tier).toBeGreaterThanOrEqual(1); expect(r.tier).toBeLessThanOrEqual(5);
      expect(TYPE_INFO[r.type], r.type).toBeTruthy();
      expect(r.biomeBias.length).toBeGreaterThan(0);
      expect(r.resources.length).toBeGreaterThan(0);
      expect(r.name.length).toBeGreaterThanOrEqual(2);
      expect(r.short.length).toBeGreaterThanOrEqual(2);
      expect(r.icon.length).toBeGreaterThan(0);
      expect(r.desc.length).toBeGreaterThan(6);
      expect(r.dist).toBe(Math.max(Math.abs(r.col - home.col), Math.abs(r.row - home.row)));
    }
  });

  it('地名基本不重名（重名会加" 2 号"），主城叫余烬市区', () => {
    const names = T.map(r => r.name);
    expect(new Set(names).size).toBeGreaterThan(130);
    expect(home.name).toBe('余烬市区');
    expect(home.type).toBe('core');
    expect(home.icon).toBe('🏠');
    expect(home.tier).toBe(1);
    expect(T.filter(r => r.homeBase).length).toBe(1);
  });

  it('同一 seed 稳定、不同 seed 不一样', () => {
    const a = buildRegions('same-seed'), b = buildRegions('same-seed'), c = buildRegions('other-seed');
    expect(a.map(r => r.id + r.name + r.type)).toEqual(b.map(r => r.id + r.name + r.type));
    expect(a.map(r => r.name + r.type)).not.toEqual(c.map(r => r.name + r.type));
  });

  it('metaGrid 是 12×12 的矩阵，格子与区域一一对应', () => {
    const g = metaGrid();
    expect(g.length).toBe(12);
    for (const row of g) expect(row.length).toBe(12);
    const ids = new Set<string>();
    for (const row of g) for (const cell of row) if (cell) ids.add(cell.id);
    expect(ids.size).toBe(REGIONS.length);
  });
});

describe('M17 地理逻辑（评审 #1：别自相矛盾）', () => {
  it('主城在几何中心附近，居民/城郊紧贴主城，农田/林地/废墟在外圈', () => {
    expect(home.dist).toBe(0);
    const maxDist = Math.max(...T.map(r => r.dist));
    expect(maxDist).toBeGreaterThanOrEqual(5);
    const near = T.filter(r => r.dist === 1);
    expect(near.length).toBeGreaterThanOrEqual(5);
    expect(near.every(r => ['residential', 'suburb', 'core'].includes(r.type))).toBe(true);
    const far = T.filter(r => r.dist >= maxDist - 1);
    expect(far.length).toBeGreaterThan(0);
    expect(far.some(r => ['farm', 'forest', 'ruins', 'military', 'water'].includes(r.type))).toBe(true);
    expect(far.filter(r => r.type === 'core').length).toBe(0);
  });

  it('水域连成一整侧（海岸/大湖），不是随机撒的几个水格子', () => {
    const water = T.filter(r => r.type === 'water');
    expect(water.length).toBeGreaterThan(REGION_COLS / 2);
    const cols = new Set(water.map(r => r.col));
    const rows = new Set(water.map(r => r.row));
    expect(Math.min(cols.size, rows.size)).toBeLessThanOrEqual(3);
  });

  it('山地/军管区占在角落那一侧，不散落全图', () => {
    const rough = T.filter(r => r.type === 'forest' || r.type === 'military');
    expect(rough.length).toBeGreaterThan(3);
    const corner = rough.filter(r => (r.col <= 4 && r.row <= 4) || (r.col >= REGION_COLS - 5 && r.row <= 4));
    expect(corner.length / rough.length).toBeGreaterThan(0.35);
  });
});

describe('M17 危险度辐射梯度（评审 #2 的核心）', () => {
  const maxDist = Math.max(...T.map(r => r.dist));
  const ringAvg = (d: number) => {
    const xs = T.filter(r => r.dist === d).map(r => r.tier);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  it('危险度随离主城的距离单调不减（每一环的平均值都不低于内一环太多）', () => {
    let prev = 0;
    for (let d = 0; d <= maxDist; d++) {
      const a = ringAvg(d);
      if (a === null) continue;
      expect(a, `第 ${d} 环平均危险 ${a.toFixed(2)}（内环 ${prev.toFixed(2)}）`).toBeGreaterThanOrEqual(prev - 0.35);
      prev = a;
    }
    expect(ringAvg(1)!).toBeLessThan(ringAvg(maxDist - 1)!);
    expect(ringAvg(1)!).toBeLessThan(ringAvg(maxDist)!);
  });

  it('主城是"安全区"，最外圈至少危险 4（不会出现"角落很安全"）', () => {
    expect(dangerLabel(home.tier)).toBe('安全区');
    const outer = T.filter(r => r.dist >= maxDist - 1 && r.type !== 'water');
    expect(outer.length).toBeGreaterThan(2);
    for (const r of outer) expect(r.tier, r.name + ' 危险 ' + r.tier).toBeGreaterThanOrEqual(4);
    // 全图要真的用满 1..5 档，不能"最高只有 3"
    expect(Math.max(...T.map(r => r.tier))).toBe(5);
  });

  it('危险度 5 的区域不会紧贴主城（不会"出门第一步就是九死一生"）', () => {
    for (const r of T) if (r.dist <= 1) expect(r.tier).toBeLessThanOrEqual(2);
    /* M17.1：主城 + 紧邻一圈都是安全区——玩家得有个能喘气的"新手村" */
    for (const r of T) if (r.dist <= 1) expect(r.tier, r.name).toBe(1);
  });

  it('危险度不是"随机跳"，相邻两格最多差 1（没有任何例外，军管区也一样）', () => {
    /* M17.2：上一版给军管区额外 +1，于是它旁边会出现"4 挨着 2"的断崖
       （评审 #3：「平民在林地砍柴，一扭头就是重兵把守的哨塔」）。
       现在危险度是纯粹的"离主城圈数"函数 → 相邻差必然 ≤1。 */
    for (const seed of ['ember-01', 'regions-test', 'mig-test', 'same-seed']) {
      const list = buildRegions(seed);
      for (const r of list) {
        for (const nb of list.filter(x => x.id !== r.id && Math.max(Math.abs(x.col - r.col), Math.abs(x.row - r.row)) === 1)) {
          expect(Math.abs(nb.tier - r.tier), seed + '：' + r.name + ' 危险 ' + r.tier + ' 挨着 ' + nb.name + ' 危险 ' + nb.tier)
            .toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('同环内的差异有来源（地形加成），不是纯随机：军事区不比同环居民区更安全', () => {
    const mil = T.filter(r => r.type === 'military');
    expect(mil.length).toBeGreaterThan(0);
    for (const m of mil) {
      const sameRing = T.filter(r => r.dist === m.dist && r.id !== m.id && r.type === 'residential');
      if (sameRing.length) expect(m.tier).toBeGreaterThanOrEqual(sameRing[0].tier);
    }
  });
});

/* ── M17.1：用户截图里那份外部评审的正面回答 ──
   "这哪里是城市规划？这是把大富翁的棋盘放进搅拌机里打碎了再倒出来。"
   四条缰绳：成片（不是马赛克）、类型齐全（少一种就会让某类委托/章节永远做不完）、
   约束（工业不贴市中心、农田林地不进内环、军管只在山角、CBD 只有一片）、短名不截半。 */
describe('M17.1 城市逻辑（评审 #2：约束规则）', () => {
  const SEEDS = ['ember-01', 'regions-test', 'mig-test', 'same-seed'];

  /** 相邻同类占比：随机打散约 0.15，成片的规划图 0.5+ */
  const sameRatio = (list: typeof T) => {
    let same = 0, tot = 0;
    for (const d of list) for (const [dx, dy] of [[0, 1], [1, 0], [-1, 1], [1, 1]]) {
      const n = list.find(x => x.col === d.col + dx && x.row === d.row + dy);
      if (!n) continue;
      tot++;
      if (n.type === d.type) same++;
    }
    return same / tot;
  };

  it('同类型连成片（相邻同类占比 ≥ 0.45，随机打散只有 0.15）', () => {
    for (const seed of SEEDS) {
      const list = buildRegions(seed);
      expect(sameRatio(list), seed + ' 的元地图还是色块马赛克').toBeGreaterThanOrEqual(0.45);
    }
  });

  it('九种类型每一种都在图上（缺哪一类，对应章节/委托就永远做不完）', () => {
    for (const seed of SEEDS) {
      const list = buildRegions(seed);
      const counts: Record<string, number> = {};
      for (const r of list) counts[r.type] = (counts[r.type] ?? 0) + 1;
      for (const t of ['core', 'residential', 'suburb', 'industry', 'military', 'farm', 'forest', 'ruins', 'water'] as const) {
        expect(counts[t] ?? 0, seed + ' 缺 ' + t).toBeGreaterThanOrEqual(t === 'core' ? 1 : 3);
      }
      // 第 4/5 章要"到访一处工业区/水域/废墟"——这三类必须有像样的一片
      for (const t of ['industry', 'water', 'ruins'] as const) {
        expect(counts[t] ?? 0, seed + ' 的 ' + t + ' 太少').toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('工业区不贴市中心，农田/林地不进内环，军管区只在山地那一角', () => {
    for (const seed of SEEDS) {
      const list = buildRegions(seed);
      const home2 = list.find(r => r.homeBase)!;
      const d2 = (r: { col: number; row: number }) => Math.max(Math.abs(r.col - home2.col), Math.abs(r.row - home2.row));
      for (const r of list) {
        const near = list.filter(n => n.id !== r.id && Math.max(Math.abs(n.col - r.col), Math.abs(n.row - r.row)) === 1);
        if (r.type === 'industry') expect(near.some(n => n.type === 'core'), seed + ' 化工园挨着市中心：' + r.name).toBe(false);
        if (r.type === 'core') expect(d2(r), seed + ' 的市中心跑到外环：' + r.name).toBeLessThanOrEqual(2);
        if (r.type === 'farm' || r.type === 'forest') expect(d2(r), seed + ' 的' + r.name + ' 在市中心放牛').toBeGreaterThan(2);
        if (r.type === 'military') {
          const mil = list.filter(x => x.type === 'military');
          expect(mil.length, seed + ' 军管区太多').toBeLessThanOrEqual(6);
          const corner = mil.filter(x => (x.col <= 4 && x.row <= 4) || (x.col >= REGION_COLS - 5 && x.row <= 4));
          expect(corner.length / mil.length, seed + ' 的军管区散落全图').toBeGreaterThanOrEqual(0.75);
        }
      }
    }
  });

  it('CBD 只有一片且连在一起（不会冒出好几个互不相邻的"市中心"）', () => {
    for (const seed of SEEDS) {
      const list = buildRegions(seed);
      const core = list.filter(r => r.type === 'core');
      const seen = new Set<string>();
      let comps = 0;
      for (const c of core) {
        if (seen.has(c.id)) continue;
        comps++;
        const stack = [c];
        seen.add(c.id);
        while (stack.length) {
          const cur = stack.pop()!;
          for (const n of list.filter(x => Math.max(Math.abs(x.col - cur.col), Math.abs(x.row - cur.row)) <= 1 && x.id !== cur.id)) {
            if (n.type === 'core' && !seen.has(n.id)) { seen.add(n.id); stack.push(n); }
          }
        }
      }
      expect(comps, seed + ' 有 ' + comps + ' 片互不相邻的市中心').toBe(1);
      expect(core.length).toBeLessThanOrEqual(9);
    }
  });

  it('短名不是"把全名截一半"：一律 1 字方位 + 2 字地貌，且几乎不重样', () => {
    for (const seed of SEEDS) {
      const list = buildRegions(seed);
      for (const r of list) {
        if (r.homeBase) { expect(r.short).toBe('余烬'); continue; }
        expect(r.short.length, r.name + ' 短名长度不对：' + r.short).toBe(3);
        expect('北南东西中', r.name + ' 短名没有方位字：' + r.short).toContain(r.short[0]);
        expect(REGION_SHORT_WORD[r.type], r.name + ' 短名是半截词：' + r.short).toContain(r.short.slice(1));
      }
      /* 评审 #3：「第 1 行和第 3 行的北林区、第 3 和第 4 行的北山道，依然重复命名」。
         M17.2 把每种类型的地貌词加到 14 个，并按"先避开 2 格内重名"挑词 →
         相邻两格绝不重名，同名块也被推到远处。100% 不重样做不到（方位字受几何限制：
         北半边只剩"北"这一个前缀，143 格共用 5×14 个组合），所以门槛定在 130/144。 */
      const uniq = new Set(list.map(r => r.short)).size;
      expect(uniq, seed + ' 的短名重复太多（' + uniq + '/144）').toBeGreaterThanOrEqual(130);
      for (const r of list) {
        for (const nb of list.filter(x => x.id !== r.id && Math.max(Math.abs(x.col - r.col), Math.abs(x.row - r.row)) === 1)) {
          expect(nb.short, seed + '：' + r.short + ' 旁边又是一格 ' + nb.short).not.toBe(r.short);
        }
      }
    }
  });
});

describe('M17 跨区旅行（多格 + 水面绕行）', () => {
  it('相邻判定含斜向、不含自己', () => {
    const a = regionById(home.id)!;
    for (const nb of neighborsOf(a.id)) {
      expect(nb.id).not.toBe(a.id);
      expect(Math.max(Math.abs(nb.col - a.col), Math.abs(nb.row - a.row))).toBe(1);
      expect(areAdjacent(a, nb)).toBe(true);
    }
    expect(areAdjacent(a, a)).toBe(false);
    expect(neighborsOf(home.id).length).toBeGreaterThanOrEqual(5);
  });

  it('开车路线是沿区域图走的最短路，且不穿水域', () => {
    const targets = T.filter(r => r.type !== 'water' && r.dist >= 3).slice(0, 12);
    for (const t of targets) {
      const path = regionPath(home.id, t.id);
      expect(path, t.name + ' 走不到').not.toBeNull();
      const p = path!;
      expect(p[0].id).toBe(home.id);
      expect(p[p.length - 1].id).toBe(t.id);
      for (let i = 1; i < p.length; i++) {
        expect(areAdjacent(p[i - 1], p[i])).toBe(true);
        expect(p[i].type).not.toBe('water');
      }
      expect(p.length - 1).toBeLessThanOrEqual(2 * Math.max(Math.abs(t.col - home.col), Math.abs(t.row - home.row)) + 2);
    }
  });

  it('水域能开到（沿海公路通到堤岸），但只准当终点、不准当过路通道', () => {
    /* 为什么要有这条：第 5 章的目标是「到访水域」，港区资源与渔获也全在那一片；
       如果水域一律去不了，那一整条海岸线就是纯装饰、剧情也永远做不完。 */
    const ports = T.filter(r => r.type === 'water').sort((a, b) => a.dist - b.dist);
    expect(ports.length).toBeGreaterThan(6);
    const near = ports[0];
    expect(near.dist).toBeGreaterThan(3);                       // 港区在图上最外一圈，得开一段
    const path = regionPath(home.id, near.id);
    expect(path, '最近的港区开不到').not.toBeNull();
    const p = path!;
    expect(p[p.length - 1].id).toBe(near.id);
    for (let i = 1; i < p.length - 1; i++) expect(p[i].type).not.toBe('water');   // 途中一格水都没有
    /* 主城在 12×12 的正中（切比雪夫距离 5~6），所以港区一定超过单次上限——
       这正是"大世界"该有的样子：先开到中途区域落脚，第二段再往海边走。 */
    const legs = (a: string, b: string) => (regionPath(a, b)?.length ?? 99) - 1;
    const hop = T.filter(r => r.type !== 'water' && r.id !== home.id)
      .filter(r => legs(home.id, r.id) <= MAX_HOPS)
      .find(r => legs(r.id, near.id) <= MAX_HOPS);
    expect(hop, '两段路也开不到港区').toBeTruthy();
    expect(planRegionTrip(ctx({ to: hop!.id, ap: 99, fuel: 99 })).ok).toBe(true);
    expect(planRegionTrip(ctx({ from: hop!.id, to: near.id, ap: 99, fuel: 99 })).ok).toBe(true);
    expect(legs(home.id, near.id)).toBeGreaterThan(MAX_HOPS);   // 一趟直开不过去
    const direct = planRegionTrip(ctx({ to: near.id, ap: 99, fuel: 99 }));
    expect(direct.ok).toBe(false);
    expect(direct.why).toContain('太远');
  });

  it('成本按跳数累加，跳数越多越贵；太远（> MAX_HOPS）会让人中途落脚', () => {
    const near = T.find(r => r.dist === 1 && r.type !== 'water')!;
    const c1 = regionTravelCost(homeRegion(), near);
    expect(c1.hops).toBe(1);
    expect(c1.ap).toBeGreaterThanOrEqual(2);                 // 2 行动力/格：上限 9 的体力正好够开满 4 格
    expect(c1.ap).toBeLessThanOrEqual(3);
    expect(c1.fuel).toBeGreaterThanOrEqual(2);
    const maxDist = Math.max(...T.map(r => r.dist));
    const farRegion = T.filter(r => r.type !== 'water' && r.dist === maxDist)
      .find(r => (regionPath(home.id, r.id)?.length ?? 99) - 1 > MAX_HOPS)!;
    expect(farRegion, '找不到超过 MAX_HOPS 的目标').toBeTruthy();
    const c2 = regionTravelCost(homeRegion(), farRegion);
    expect(c2.hops).toBeGreaterThan(MAX_HOPS);
    const plan = planRegionTrip(ctx({ to: farRegion.id }));
    expect(plan.ok).toBe(false);
    expect(plan.why).toContain('太远');
    expect(plan.hint).toContain('落脚');
  });

  it('没车/没油/没行动力，各给出能照着做的人话理由', () => {
    const reachable = T.filter(r => r.type !== 'water' && r.id !== home.id && (regionPath(home.id, r.id)?.length ?? 99) - 1 <= 2);
    const target = reachable[0];
    expect(target, '找不到近处目标').toBeTruthy();
    const noCar = planRegionTrip(ctx({ to: target.id, hasVehicle: false }));
    expect(noCar.ok).toBe(false);
    expect(noCar.why).toContain('走不到');
    expect(noCar.hint).toContain('车');
    const noFuel = planRegionTrip(ctx({ to: target.id, fuel: 0 }));
    expect(noFuel.ok).toBe(false);
    expect(noFuel.why).toContain('油不够');
    const noAp = planRegionTrip(ctx({ to: target.id, ap: 0, fuel: 99 }));
    expect(noAp.ok).toBe(false);
    expect(noAp.why).toContain('行动力');
    const same = planRegionTrip(ctx({ to: home.id }));
    expect(same.ok).toBe(false);
    expect(same.why).toContain('已经在');
    /* 港区没有"海对岸"那种去不了的情况：海岸线是地图最外一圈，沿海公路通到每一段堤岸 */
    for (const port of T.filter(r => r.type === 'water')) {
      const p = planRegionTrip(ctx({ to: port.id, fuel: 99, ap: 99 }));
      expect(p.why ?? '', port.name).not.toContain('过不去');
      expect(p.hops, port.name).toBeGreaterThan(0);
    }
  });

  it('够车够油够行动力时能出发，并给出途经路线', () => {
    const reachable = T.filter(r => r.type !== 'water' && r.id !== home.id && (regionPath(home.id, r.id)?.length ?? 99) - 1 <= 2);
    const target = reachable[0];
    expect(target, '找不到近处目标').toBeTruthy();
    const plan = planRegionTrip(ctx({ to: target.id, fuel: 12, ap: 9 }));
    expect(plan.ok).toBe(true);
    expect(plan.path.length).toBe(plan.hops + 1);
    expect(plan.path[plan.path.length - 1]).toBe(target.id);
    expect(plan.danger).toBe(target.tier);
  });

  it('regionName / 类型颜色文案都能读（UI 用）', () => {
    expect(regionName(home.id)).toBe('余烬市区');
    expect(regionName('nope')).toBe('nope');
    for (const r of T.slice(0, 20)) {
      expect(TYPE_INFO[r.type].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(TYPE_INFO[r.type].label.length).toBeGreaterThan(1);
    }
  });
});

describe('M17 与 active 表（游戏里按存档种子生效）', () => {
  it('REGIONS 默认表规模正确，HOME_REGION 指向主城，每个区域都有类型', () => {
    expect(REGIONS.length).toBe(144);
    expect(regionById(HOME_REGION)?.homeBase).toBe(true);
    expect(REGIONS.every(r => !!r.type)).toBe(true);
  });
});
