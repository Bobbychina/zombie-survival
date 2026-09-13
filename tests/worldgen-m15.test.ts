/* M15 地图生成：把 9 个区域的 ASCII 地图 dump 出来（人可读），并统计分区是否"扎堆"。
   为什么要有这份 dump：生成逻辑的验收标准是"看起来像真实城市"（工业成片、住宅成片、
   商业在中心、农田林地在外围、路网连成街道），这种东西光看断言数字看不出来——
   直接把图读一遍最快。产物：docs/_m15_mapdump.md */
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld, NEIGHBORS, bkey, WORLD_W, WORLD_H, ZONE_REQUIRED } from '../src/v4/worldgen';
import { REGIONS, HOME_REGION, regionSeed, regionById } from '../src/v4/regions-core';
import { POIS } from '../src/v4/pois';
import type { Block, Zone } from '../src/types';

/** zone → 单字符（读图用） */
const CH: Record<string, string> = {
  cbd: 'C', residential: 'R', suburb: 's', industry: 'I', military: 'M',
  farmland: 'f', forest: 'F', ruins: 'r', water: '~', open: '.',
};
const biomesOf = (blocks: Block[]) => {
  const out: Record<string, number> = {};
  for (const b of blocks) out[b.biome] = (out[b.biome] ?? 0) + 1;
  return out;
};
const zonesOf = (blocks: Block[]) => {
  const out: Record<string, number> = {};
  for (const b of blocks) out[b.zone ?? 'open'] = (out[b.zone ?? 'open'] ?? 0) + 1;
  return out;
};
/** 扎堆指数：与同 zone 邻居的平均占比（0 = 棋盘格乱插，1 = 完全连成一片）。
 *  单看这个数字不好判断，所以同时算"随机基准" Σp²（把同样的区划比例随机打散时的期望值），
 *  比值 ≥3 才算"真的连片"。 */
const clustering = (blocks: Block[]) => {
  const at = new Map(blocks.map(b => [bkey(b.x, b.y), b]));
  let same = 0, tot = 0;
  for (const b of blocks) {
    for (const [dx, dy] of NEIGHBORS) {
      const nb = at.get(bkey(b.x + dx, b.y + dy));
      if (!nb) continue;
      tot++;
      if (nb.zone === b.zone) same++;
    }
  }
  return tot ? same / tot : 0;
};
const randomBaseline = (blocks: Block[]) => {
  const n = blocks.length, tally: Record<string, number> = {};
  for (const b of blocks) tally[b.zone ?? 'open'] = (tally[b.zone ?? 'open'] ?? 0) + 1;
  let s = 0;
  for (const k in tally) s += (tally[k] / n) ** 2;
  return s;
};
/** 把同样的区划比例**打散**到空间上（行主序循环移位，576 与 7 互质 → 双射），
    再算扎堆度。比值 = "结构带来的连片程度"，比跟理论上限比更公平
    （只用了 3~4 种区的图，随机基准本来就高）。 */
const scatteredClustering = (blocks: Block[]) => {
  const zones = blocks.map(b => b.zone ?? 'open');
  const n = zones.length;
  const scattered = blocks.map((b, i) => ({ ...b, zone: zones[(i * 7 + 3) % n] }) as Block);
  return clustering(scattered);
};
const zoneRatio = (z: Record<string, number>, n: number, z2: string) => (z[z2] ?? 0) / n;

const world = (region: string, base = 'ember-01') =>
  generateWorld(regionSeed(base, region), { bias: regionById(region)?.biomeBias });

describe('M15 地图生成（分区式）', () => {
  it('同一个 seed 生成同一个世界（存档只存进度，世界每次重算）', () => {
    const a = generateWorld('determinism-check', { bias: 'city' });
    const b = generateWorld('determinism-check', { bias: 'city' });
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      const k = bkey(x, y);
      expect(a.blocks[k].biome).toBe(b.blocks[k].biome);
      expect(a.blocks[k].poi).toBe(b.blocks[k].poi);
      expect(a.blocks[k].zone).toBe(b.blocks[k].zone);
    }
  });

  it('三种区域主题生成出来的地貌明显不同（偏置真的参与生成，不是只改文案）', () => {
    const city = zonesOf(Object.values(world('ember').blocks));
    const farm = zonesOf(Object.values(world('dongjiao').blocks));
    const ind = zonesOf(Object.values(world('jiangbei').blocks));
    expect(city.cbd + city.residential).toBeGreaterThan(farm.cbd + farm.residential);
    expect(farm.farmland).toBeGreaterThan(city.farmland);
    expect((ind.industry ?? 0)).toBeGreaterThan((city.industry ?? 0));
  });

  it('分区是"扎堆"的：同区邻居占比 ≥ 同样比例随机打散后的 2.5 倍，且平滑确实起作用', () => {
    for (const r of REGIONS) {
      const blocks = Object.values(world(r.id).blocks);
      const k = clustering(blocks), sc = scatteredClustering(blocks);
      expect(k / sc, `${r.name} 连片度 ${k.toFixed(2)} / 打散 ${sc.toFixed(2)}`).toBeGreaterThanOrEqual(2.5);
    }
    // 平滑（元胞自动机）必须真的提升扎堆度——不然"扎堆"只是说说
    const rough = Object.values(generateWorld(regionSeed('ember-01', HOME_REGION), { bias: 'city', smooth: 0 }).blocks);
    const smooth = Object.values(world(HOME_REGION).blocks);
    expect(clustering(smooth)).toBeGreaterThan(clustering(rough) + 0.04);
  });

  it('区域主题看得见：市区住宅成片、农场带农田最多、山区林地最多、工业区厂房最多', () => {
    const share = (region: string, z: string) => {
      const blocks = Object.values(world(region).blocks);
      return zoneRatio(zonesOf(blocks), blocks.length, z);
    };
    expect(share('ember', 'residential') + share('ember', 'cbd') + share('ember', 'suburb'), '市区住宅占比').toBeGreaterThan(0.28);
    expect(share('dongjiao', 'farmland'), '农场带农田占比').toBeGreaterThan(0.2);
    expect(share('xishan', 'forest'), '山区林地占比').toBeGreaterThan(0.28);
    expect(share('jiangbei', 'industry'), '工业区厂房占比').toBeGreaterThan(0.09);
    expect(share('binhai', 'water'), '滨海水域占比').toBeGreaterThan(0.1);
    // 农场带的农田必须比市区多，工业区的厂房必须比山区多（跨区域差异要真的存在）
    expect(share('dongjiao', 'farmland')).toBeGreaterThan(share('ember', 'farmland'));
    expect(share('jiangbei', 'industry')).toBeGreaterThan(share('xishan', 'industry') * 3);
  });

  it('每种地表的格数都在合理范围（不是整张图一种地形）', () => {
    for (const r of REGIONS) {
      const blocks = Object.values(world(r.id).blocks);
      const z = zonesOf(blocks);
      for (const req of ZONE_REQUIRED) {
        expect(z[req.zone] ?? 0, r.name + ' 缺 ' + req.zone).toBeGreaterThanOrEqual(req.min);
      }
      const biomes = biomesOf(blocks);
      expect(biomes.highway ?? 0, r.name + ' 没路').toBeGreaterThanOrEqual(8);
      expect(biomes.water ?? 0, r.name + ' 没水').toBeGreaterThanOrEqual(2);
      const nonWater = blocks.filter(b => b.biome !== 'water').length;
      expect(nonWater / blocks.length, r.name + ' 水太多').toBeGreaterThan(0.6);
    }
  });

  it('POI 长在合适的地表上，稀有建筑有上限，工业区里的建筑像工业区', () => {
    for (const r of REGIONS) {
      const blocks = Object.values(world(r.id).blocks);
      const byId: Record<string, number> = {};
      for (const b of blocks) {
        if (!b.poi) continue;
        expect(POIS[b.poi].biomes, r.name + ' ' + b.poi + ' 长在 ' + b.biome).toContain(b.biome);
        byId[b.poi] = (byId[b.poi] ?? 0) + 1;
      }
      expect(byId.lab).toBe(1);
      expect(byId.hospital ?? 0).toBeLessThanOrEqual(2);
      expect(byId.military ?? 0).toBeLessThanOrEqual(1);
      // 工业区里的建筑应当偏工业（仓库/物流/建材/汽修…），而不是医院学校
      const indPois = blocks.filter(b => b.zone === 'industry' && b.poi).map(b => b.poi!);
      const industrialish = indPois.filter(p => ['warehouse', 'depot', 'buildmart', 'hardware', 'sawmill', 'garage', 'prison', 'waterworks', 'outpost', 'construction', 'gas', 'furniture', 'megamart'].includes(p));
      if (indPois.length >= 3) expect(industrialish.length / indPois.length, r.name).toBeGreaterThan(0.6);
    }
  });

  it('家与实验室的硬约束没变：安全屋是城郊无 POI、实验室在远端且不可达水', () => {
    for (const r of REGIONS) {
      const w = world(r.id);
      const hb = w.blocks[bkey(w.home.x, w.home.y)];
      expect(hb.biome).toBe('suburb');
      expect(hb.poi).toBe(null);
      expect(hb.danger).toBe(1);
      const lb = w.blocks[bkey(w.lab.x, w.lab.y)];
      expect(lb.poi).toBe('lab');
      expect(lb.biome).not.toBe('water');
      expect(Math.max(Math.abs(w.lab.x - w.home.x), Math.abs(w.lab.y - w.home.y))).toBeGreaterThanOrEqual(10);
    }
  });

  it('开车能到实验室：家与实验室之间存在一条不通水的路（含过河桥）', () => {
    const carReach = (blocks: Record<string, Block>, from: { x: number; y: number }, to: { x: number; y: number }) => {
      const seen = new Set<string>([bkey(from.x, from.y)]);
      const q = [from];
      while (q.length) {
        const cur = q.shift()!;
        if (cur.x === to.x && cur.y === to.y) return true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nx = cur.x + dx, ny = cur.y + dy, k = bkey(nx, ny);
          const b = blocks[k];
          if (!b || b.biome === 'water' || seen.has(k)) continue;
          seen.add(k); q.push({ x: nx, y: ny });
        }
      }
      return false;
    };
    for (const r of REGIONS) {
      const w = world(r.id);
      expect(carReach(w.blocks, w.home, w.lab), r.name + ' 开车到不了实验室').toBe(true);
    }
  });

  it('把 9 个区域的 ASCII 地图写进 docs/_m15_mapdump.md（人工读图用）', () => {
    const lines: string[] = ['# M15 地图 dump（seed=ember-01，字符 = 土地利用 zone）',
      '# C 商业中心 R 居民区 s 城郊 I 工业园 M 军事 f 农田 F 林地 r 废墟 ~ 水域',
      '# 大写字母出现在地图上 = 那一带是连片的（扎堆），而不是散点', ''];
    for (const r of REGIONS) {
      const w = world(r.id);
      const blocks = Object.values(w.blocks);
      const z = zonesOf(blocks);
      const k = clustering(blocks), base = randomBaseline(blocks);
      lines.push(`## ${r.name}（${r.id}，tier ${r.tier}，主题 ${r.biomeBias}）扎堆指数 ${k.toFixed(2)}（随机基准 ${base.toFixed(2)}，打散后 ${scatteredClustering(blocks).toFixed(2)} → 连片度 ${(k / scatteredClustering(blocks)).toFixed(1)}x）`);
      lines.push('    ' + Array.from({ length: WORLD_W }, (_, i) => (i % 10)).join(''));
      for (let y = 0; y < WORLD_H; y++) {
        let row = '';
        for (let x = 0; x < WORLD_W; x++) {
          const b = w.blocks[bkey(x, y)];
          if (b.poi === 'lab') { row += 'L'; continue; }
          if (b.poi === 'sunken') { row += 'S'; continue; }
          if (x === w.home.x && y === w.home.y) { row += 'H'; continue; }
          const ch = CH[b.zone ?? 'open'] ?? '?';
          row += b.poi ? ch.toLowerCase() : ch;      // 小写 = 这格有建筑
        }
        lines.push(String(y).padStart(3, ' ') + ' ' + row);
      }
      const top = Object.entries(z).sort((a, b2) => b2[1] - a[1]).map(([k, v]) => k + ':' + v).join(' ');
      const poiN = blocks.filter(b => b.poi).length;
      lines.push(`统计 ${top} · POI ${poiN} 个 · 地表 ${Object.entries(biomesOf(blocks)).map(([k, v]) => k + ':' + v).join(' ')}`);
      lines.push('');
    }
    try { mkdirSync('docs', { recursive: true }); } catch { /* 已存在 */ }
    writeFileSync('docs/_m15_mapdump.md', lines.join('\n'), 'utf8');
    expect(lines.length).toBeGreaterThan(200);
  });
});
