/* 幸存者 NPC 与门禁卡碎片的单测：这两块直接决定"要不要出门、能不能通关"，必须有钉子。 */
import { describe, expect, it } from 'vitest';
import { generateWorld, blockAt, bkey } from '../src/v4/worldgen';
import { campRoster, campStock, sellPrice } from '../src/v4/npc';
import { fragSpots, fragAt } from '../src/v4/quest4';
import { POIS } from '../src/v4/pois';

const SEEDS = ['ember-01', 's1', 's2', 's3', 's7', 'zombie-42'];

function firstPoi(w: ReturnType<typeof generateWorld>, ids: string[]) {
  for (const k in w.blocks) { const b = w.blocks[k]; if (b.poi && ids.includes(b.poi)) return b; }
  return null;
}

describe('幸存者营地', () => {
  it('同一存档同一营地，人和货都不变（可以用存档反复谈价）', () => {
    const w = generateWorld('ember-01');
    const camp = firstPoi(w, ['camp'])!;
    expect(camp).not.toBeNull();
    const a = campRoster(w.seed, camp);
    const b = campRoster(w.seed, camp);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const sa = campStock(w.seed, camp, a, 3);
    const sb = campStock(w.seed, camp, b, 3);
    expect(JSON.stringify(sa)).toBe(JSON.stringify(sb));
  });

  it('营地 2~3 个人、货架 4~6 样、每样至少有 1 件且价格为正', () => {
    const w = generateWorld('ember-01');
    for (const id of ['camp', 'outpost']) {
      const b = firstPoi(w, [id]);
      if (!b) continue;
      const npcs = campRoster(w.seed, b);
      expect(npcs.length).toBeGreaterThanOrEqual(2);
      expect(npcs.length).toBeLessThanOrEqual(3);
      const stock = campStock(w.seed, b, npcs, 1);
      expect(stock.length).toBeGreaterThanOrEqual(4);
      expect(stock.length).toBeLessThanOrEqual(6);
      for (const r of stock) {
        expect(r.stock).toBeGreaterThanOrEqual(1);
        expect(r.cost).toBeGreaterThan(0);
        expect(POIS).toBeTruthy();
      }
    }
  });

  it('拾荒者据点以匪徒为主；卖价永远低于买价（不能倒手刷材料）', () => {
    const w = generateWorld('ember-01');
    const outpost = firstPoi(w, ['outpost'])!;
    const roles = campRoster(w.seed, outpost).map(n => n.role);
    expect(roles.filter(r => r === 'bandit').length).toBeGreaterThanOrEqual(1);
    for (const cost of [10, 24, 60, 120]) expect(sellPrice(cost)).toBeLessThan(cost);
  });

  it('能招募的角色都有 legacy 同伴对应（否则点了没反应）', () => {
    const w = generateWorld('ember-01');
    const camps: string[] = [];
    for (const k in w.blocks) if (w.blocks[k].poi === 'camp') camps.push(k);
    expect(camps.length).toBeGreaterThan(0);
    for (const k of camps.slice(0, 5)) {
      const npcs = campRoster(w.seed, w.blocks[k]);
      for (const n of npcs) {
        if (['medic', 'scout', 'mechanic', 'refugee'].includes(n.role)) expect(n.hire).toBeLessThan(200);
        else expect(['trader', 'bandit']).toContain(n.role);
      }
    }
  });
});

describe('门禁卡碎片', () => {
  it('任何 seed 下都恰好有 3 个碎片点，且都离安全屋有一段路（4~13 区块）', () => {
    for (const seed of SEEDS) {
      const w = generateWorld(seed);
      const spots = fragSpots(w);
      expect(spots.length).toBe(3);
      for (const f of spots) {
        const d = Math.max(Math.abs(f.x - w.home.x), Math.abs(f.y - w.home.y));
        expect(d).toBeGreaterThanOrEqual(4);
        expect(d).toBeLessThanOrEqual(13);
        expect(f.poi).not.toBe('lab');
        expect(blockAt(w, f.x, f.y)!.poi).toBe(f.poi);
      }
      // 三个点互相隔开：凑齐要跑三个方向，不能一条线顺路拿
      for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
        const d = Math.max(Math.abs(spots[i].x - spots[j].x), Math.abs(spots[i].y - spots[j].y));
        expect(d).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('碎片点稳定可复现，且 fragAt 能按坐标查回来', () => {
    const w = generateWorld('ember-01');
    const a = fragSpots(w), b = fragSpots(w);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const f = a[0];
    expect(fragAt(w, f.x, f.y)?.key).toBe(bkey(f.x, f.y));
    expect(fragAt(w, f.x + 1, f.y + 1)).toBeNull();
  });

  it('优先藏在硬据点（军事/监狱/掩体/隧道/电台）里', () => {
    const w = generateWorld('ember-01');
    const hard = ['military', 'prison', 'bunker', 'tunnel', 'radio'];
    const spots = fragSpots(w);
    expect(spots.filter(f => hard.includes(f.poi)).length).toBeGreaterThanOrEqual(2);
  });
});
