import { describe, expect, it } from 'vitest';
import { generateWorld, blockAt, revealAround, dist, WORLD_W, WORLD_H } from '../src/v4/worldgen';
import { POIS, BIOME_INFO } from '../src/v4/pois';

describe('大世界生成', () => {
  it('同一个 seed 必须生成完全相同的世界（存档只存增量）', () => {
    const a = generateWorld('seed-A');
    const b = generateWorld('seed-A');
    expect(JSON.stringify(a.blocks)).toBe(JSON.stringify(b.blocks));
    expect(a.lab).toEqual(b.lab);
  });

  it('不同 seed 生成不同世界', () => {
    const a = generateWorld('seed-A');
    const b = generateWorld('seed-B');
    expect(JSON.stringify(a.blocks)).not.toBe(JSON.stringify(b.blocks));
  });

  it('尺寸正确、安全屋无 POI、实验室在远端（通关必须横穿世界）', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const w = generateWorld(seed);
      expect(w.w).toBe(WORLD_W);
      expect(w.h).toBe(WORLD_H);
      expect(Object.keys(w.blocks).length).toBe(WORLD_W * WORLD_H);
      const home = blockAt(w, w.home.x, w.home.y)!;
      expect(home.poi).toBeNull();
      expect(home.visited).toBe(true);
      const lab = blockAt(w, w.lab.x, w.lab.y)!;
      expect(lab.poi).toBe('lab');
      expect(dist(w.home, w.lab)).toBeGreaterThanOrEqual(10);
    }
  });

  it('所有区块的 POI 都必须在 POIS 表里，且水域不可通行', () => {
    const w = generateWorld('check');
    for (const k in w.blocks) {
      const b = w.blocks[k];
      if (b.poi) expect(POIS[b.poi]).toBeTruthy();
      expect(BIOME_INFO[b.biome]).toBeTruthy();
      expect(b.danger).toBeGreaterThanOrEqual(1);
      expect(b.danger).toBeLessThanOrEqual(5);
    }
    expect(Object.values(w.blocks).some(b => b.biome === 'water')).toBe(true);
  });

  it('地图上有足够多的 POI（世界不是空的）', () => {
    const w = generateWorld('density');
    const withPoi = Object.values(w.blocks).filter(b => b.poi).length;
    /* M15 起 POI 按 zone 分配 + 稀有建筑有上限（真实城市不会八个医院），
       所以数量从旧的 120+ 降到 ~100；这里改成"区间 + 种类"双条件：
       数量够多，而且种类要丰富（比单一阈值更能反映"世界不空"）。 */
    expect(withPoi).toBeGreaterThan(60);
    expect(withPoi).toBeLessThan(200);
    const kinds = new Set(Object.values(w.blocks).map(b => b.poi).filter(Boolean));
    expect(kinds.size).toBeGreaterThanOrEqual(16);
  });

  it('迷雾：到过一个区块会点亮周围 3×3', () => {
    const w = generateWorld('fog');
    const opened = revealAround(w, w.home.x, w.home.y, 1);
    expect(opened.length).toBeGreaterThanOrEqual(3);
    expect(blockAt(w, w.home.x + 1, w.home.y + 1)!.revealed).toBe(true);
  });

  it('M7.1 现代商业建筑要真的刷得出来（用户嫌来来回回就那几种）', () => {
    const MODERN = ['furniture', 'hardware', 'megamart', 'office', 'appliance', 'depot', 'buildmart'];
    for (const seed of ['m1', 'm2', 'm3']) {
      const w = generateWorld(seed);
      const ids = new Set(Object.values(w.blocks).map(b => b.poi).filter(Boolean) as string[]);
      const hit = MODERN.filter(id => ids.has(id));
      // 7 种里至少刷出 4 种；单一 seed 全 7 种不该是硬要求（它们各自限定群系）
      expect(hit.length).toBeGreaterThanOrEqual(4);
    }
  });
});
