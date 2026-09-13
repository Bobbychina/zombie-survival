/* M15.1：地图重画迁移（BETA：改生成器就 +1 世界版本）。
   用户明确说了"生成器改掉，反正是 beta 版本"——那就把这件事做干净：
   地形相关的进度按坐标存，地形一换就全是脏数据，所以版本对不上时清地形进度、保人物进度。
   这一组测试盯的就是"清什么、留什么、会不会重复清、位置会不会卡在水里"。 */
import { describe, expect, it } from 'vitest';
import {
  WORLD_VER, defaultSaveWorld, ensureSaveWorld, takeWorldMigration, worldOf, switchRegion, planTrip,
} from '../src/v4/worldstate';
import { HOME_REGION, REGIONS, regionSeed, setActiveRegions } from '../src/v4/regions-core';
import { bkey } from '../src/v4/worldgen';
import { fragSpots } from '../src/v4/quest4';

/** 造一份"老版本世界存档"：地形进度齐全 + 人物进度也在。
    M17：元地图按种子生成，所以先对齐 seed 再取 HOME_REGION（它是活绑定，会跟着变）。 */
const oldSave = (over: Record<string, unknown> = {}) => {
  const seed = 'mig-test';
  setActiveRegions(seed);
  const HOME = HOME_REGION;
  const other = REGIONS.find(r => r.id !== HOME && r.type !== 'water')!.id;
  const sw: any = {
    v: 1, seed, region: HOME, regions: { [other]: { visited: { '1,1': 1 } } },
    seenRegions: { [HOME]: 1, [other]: 1 }, regionVisits: { [HOME]: 3, [other]: 2 },
    regionZones: { [other]: { lumber: 2 } },
    cur: { x: 3, y: 3 },
    visited: { '4,4': 1, '5,5': 1 }, firstPoi: { '4,4': 1 }, left: { '4,4': 0 }, stock: { '4,4': 2 },
    frag: { '4,4': 1 }, forage: { '4,4': { left: 1, day: 3 } }, salvage: { '4,4': { left: 1 } },
    fish: { '4,4': { left: 1, day: 2 } }, chop: { '4,4': { left: 1, day: 1 } },
    intel: true, debt: 1, lastNight: { day: 3, kind: 'bed', tier: 'home', outcome: 'ok', ap: 9 },
    lastRaidDay: 7, evac: { x: 9, y: 9, day: 90 }, veh: { fuel: 5, hp: 80 }, steps: 40, fights: 4,
    trail: ['旧地图上的一条记录'],
    // 人物进度（在 S 上，不在 world 上）
    ...over,
  };
  const S: any = {
    seed, day: 33, mat: 250, hp: 71, world: sw,
    inv: [{ id: 'bandage', n: 3 }], ach: ['a_cure'], quest: { stage: 4 }, flags: { won: true },
    contracts: { day: 33 }, story: { chapter: 3 },
  };
  return { S, sw, HOME, other };
};

describe('M15.1 地图重画迁移', () => {
  it('老档（没有 wv）→ 清地形进度、保人物进度，并回到本区入口', () => {
    takeWorldMigration();                       // 清掉上一条测试留下的标记
    const { S, HOME } = oldSave();
    const out = ensureSaveWorld(S);
    expect(out.wv).toBe(WORLD_VER);
    // 地形相关：全清（**只剩脚下那一格**——用户报过"迁移完整张图全黑，一步都走不了"）
    expect(Object.keys(out.visited)).toEqual([bkey(out.cur.x, out.cur.y)]);
    expect(out.left).toEqual({});
    expect(out.stock).toEqual({});
    expect(out.firstPoi).toEqual({});
    expect(out.frag).toEqual({});
    expect(out.chop).toEqual({});
    expect(out.forage).toEqual({});
    expect(out.regions).toEqual({});
    expect(out.regionVisits).toEqual({ [HOME]: 1 });
    expect(out.regionZones).toEqual({});
    expect(out.intel).toBe(false);
    expect(out.evac).toBeNull();
    expect(out.trail).toEqual([]);
    expect(out.steps).toBe(0);
    expect(out.region).toBe(HOME);              // M17：老区域 id 不存在 → 落到本种子生成的主城
    expect(out.intel).toBe(false);
    expect(out.evac).toBeNull();
    expect(out.trail).toEqual([]);
    expect(out.steps).toBe(0);
    // 人物进度：一个都不能少
    expect(S.day).toBe(33);
    expect(S.mat).toBe(250);
    expect(S.hp).toBe(71);
    expect(S.inv).toEqual([{ id: 'bandage', n: 3 }]);
    expect(S.ach).toEqual(['a_cure']);
    expect(S.quest.stage).toBe(4);
    expect(S.contracts.day).toBe(33);
    expect(S.story.chapter).toBe(3);
    // 位置回本区入口（老坐标在新地形上可能是水）
    const w = worldOf(out.seed, out.region);
    expect(out.cur).toEqual({ x: w.home.x, y: w.home.y });
    expect(takeWorldMigration()).toBe(true);    // 报告一次
    expect(takeWorldMigration()).toBe(false);   // 只报一次
  });

  it('同一版本不会重复迁移（第二次调用只补脚下那格，不动已有进度）', () => {
    const { S } = oldSave();
    const first = ensureSaveWorld(S);
    takeWorldMigration();                       // 第一次迁移的标记先消费掉
    first.visited = { [bkey(6, 6)]: 1 };
    first.left = { [bkey(6, 6)]: 3 };
    const again = ensureSaveWorld(S);
    /* 第 6,6 格的进度必须原样活着；额外的 12,12 是"脚下永远点亮"的兜底，不是迁移 */
    expect(again.visited[bkey(6, 6)]).toBe(1);
    expect(Object.keys(again.visited).sort()).toEqual([bkey(6, 6), bkey(again.cur.x, again.cur.y)].sort());
    expect(again.left).toEqual({ [bkey(6, 6)]: 3 });
    expect(takeWorldMigration()).toBe(false);
  });

  it('脚下那格永远是亮的（用户报的 bug：迁移后整张图全黑、一步都走不了）', () => {
    /* 只能点"已点亮"的格子 → 只要脚下不亮，玩家就真的动不了。
       这里两种情况都钉住：① 刚迁移完的老档 ② visited 被写坏的档。 */
    takeWorldMigration();                       // 先把上一条测试留下的迁移标记清掉
    const { S } = oldSave();
    const out = ensureSaveWorld(S);
    let w = worldOf(out.seed, out.region);
    let here = w.blocks[bkey(out.cur.x, out.cur.y)];
    expect(here.revealed, '迁移后脚下没点亮').toBe(true);
    const lit = Object.keys(w.blocks).filter(k => w.blocks[k].revealed).length;
    expect(lit, '只有脚下亮着还不够——周围也得能看见，不然没地方可点').toBeGreaterThanOrEqual(6);
    takeWorldMigration();                       // 别把标记留给后面的测试

    const S2: any = { seed: 'broken-save', world: { ...defaultSaveWorld('broken-save'), visited: {} } };
    const out2 = ensureSaveWorld(S2);
    w = worldOf(out2.seed, out2.region);
    here = w.blocks[bkey(out2.cur.x, out2.cur.y)];
    expect(here.revealed, 'visited 被清空后脚下也没点亮').toBe(true);
    expect(Object.keys(w.blocks).filter(k => w.blocks[k].revealed).length).toBeGreaterThanOrEqual(6);
  });

  it('新档直接就是当前版本，不需要迁移', () => {
    const sw = defaultSaveWorld('fresh-seed');
    expect(sw.wv).toBe(WORLD_VER);
    const S: any = { seed: 'fresh-seed', world: sw };
    ensureSaveWorld(S);
    expect(takeWorldMigration()).toBe(false);
  });

  it('迁移后玩家落在陆地上、车还在（不会因为地图重画把车弄丢）', () => {
    const { S } = oldSave();
    const out = ensureSaveWorld(S);
    const w = worldOf(out.seed, out.region);
    const here = w.blocks[bkey(out.cur.x, out.cur.y)];
    expect(here).toBeTruthy();
    expect(here.biome).not.toBe('water');
    expect(out.veh).toEqual({ fuel: 5, hp: 80 });
  });

  it('迁移后跨区依旧可用（区域表不在世界存档里）', () => {
    const { S, HOME, other } = oldSave();
    const out = ensureSaveWorld(S);
    const r = switchRegion(S, out, other);        // M17：相邻区由种子生成，不能再写死区名
    expect(r.ok).toBe(true);
    expect(out.region).toBe(other);
    expect(out.regionVisits[other]).toBe(1);
    const back = switchRegion(S, out, HOME);
    expect(back.ok).toBe(true);
  });
});

describe('M15.1 碎片点放置（地形换了也不能把碎片扔进水里）', () => {
  it('每张图都给满 3 个碎片点，且都在陆地上的 POI 里、彼此隔开', () => {
    for (const r of REGIONS) {
      const w = worldOf(regionSeed('frag-check', r.id), r.id);
      const frags = fragSpots(w);
      expect(frags.length, r.name + ' 碎片点不足').toBe(3);
      for (const f of frags) {
        const b = w.blocks[bkey(f.x, f.y)];
        expect(b.biome, r.name + ' 碎片在水里').not.toBe('water');
        expect(b.poi).toBeTruthy();
        expect(b.poi).not.toBe('lab');
      }
      for (const a of frags) for (const b of frags) {
        if (a === b) continue;
        expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(4);
      }
      // 离家的距离在 4~13 之间（太近没意义，太远第一天够不着）
      for (const f of frags) {
        const d = Math.max(Math.abs(f.x - w.home.x), Math.abs(f.y - w.home.y));
        expect(d).toBeGreaterThanOrEqual(4);
        expect(d).toBeLessThanOrEqual(13);
      }
    }
  });

  it('碎片点所在格可以站着搜刮（不是水/不是实验室）', () => {
    for (const r of REGIONS) {
      const w = worldOf(regionSeed('frag-check-2', r.id), r.id);
      for (const f of fragSpots(w)) {
        const trip = planTrip(w, w.home, { x: f.x, y: f.y }, { ap: 99, veh: null, fractured: false, night: false });
        expect('trip' in trip, r.name + ' 走路到不了碎片点').toBe(true);
      }
    }
  });
});
