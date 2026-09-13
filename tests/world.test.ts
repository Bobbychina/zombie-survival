/* 大世界层的单元测试：旅行报价、迷雾恢复、搜刮纯逻辑。
   这些是"玩家每天都点"的路径，出错会直接卡住主线，所以用测试钉住。 */
import { describe, expect, it } from 'vitest';
import { zombieIds } from './legacy-tables';
import { bkey, blockAt, generateWorld } from '../src/v4/worldgen';
import {
  defaultSaveWorld, ensureSaveWorld, findPath, markVisited, planTrip, rollTravelEncounter, switchRegion, zoneOfPoi, worldOf,
  type SaveWorld,
} from '../src/v4/worldstate';
import { foesFor, pickLoot, rollSearchKind, searchWeights } from '../src/v4/search-core';
import { POIS } from '../src/v4/pois';
import { HOME_REGION, REGIONS, regionById } from '../src/v4/regions-core';

const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const w = worldOf('test-seed-1', HOME_REGION);

describe('大世界状态', () => {
  it('同一 seed 生成的世界是稳定的', () => {
    const a = generateWorld('s1'), b = generateWorld('s1'), c = generateWorld('s2');
    expect(a.home).toEqual(b.home);
    expect(a.lab).toEqual(b.lab);
    expect(Object.keys(a.blocks).length).toBe(24 * 24);
    expect(JSON.stringify(a.blocks[bkey(3, 4)])).toBe(JSON.stringify(b.blocks[bkey(3, 4)]));
    expect(a.lab).not.toEqual(c.lab);
  });

  it('实验室离安全屋至少 10 个区块（必须横穿大世界）', () => {
    for (const s of ['s1', 's2', 's3', 's4', 's5']) {
      const g = generateWorld(s);
      const d = Math.max(Math.abs(g.lab.x - g.home.x), Math.abs(g.lab.y - g.home.y));
      expect(d).toBeGreaterThanOrEqual(10);
    }
  });

  it('新档从安全屋出发，且安全屋是点亮的', () => {
    const sw = defaultSaveWorld('test-seed-1');
    const home = blockAt(w, w.home.x, w.home.y)!;
    expect(sw.cur).toEqual({ x: w.home.x, y: w.home.y });
    expect(sw.visited[bkey(w.home.x, w.home.y)]).toBe(1);
    expect(home.revealed).toBe(true);
    expect(sw.veh).toBeNull();
  });

  it('坏档/空档不会让世界炸掉，且能按 visited 恢复迷雾', () => {
    const S: any = { seed: 'test-seed-1' };
    const sw = ensureSaveWorld(S);
    expect(S.world).toBe(sw);
    expect(sw.seed).toBe('test-seed-1');
    // 手改一份：只留两个到过的区块，恢复后其余区块必须重新变回迷雾
    const fake: SaveWorld = { ...defaultSaveWorld('test-seed-1'), visited: { '1,1': 1, '2,2': 1 } };
    const S2: any = { world: fake };
    const sw2 = ensureSaveWorld(S2);
    expect(Object.keys(sw2.visited).sort()).toEqual(['1,1', '2,2']);
    expect(blockAt(w, 1, 1)!.revealed).toBe(true);
    expect(blockAt(w, 2, 2)!.revealed).toBe(true);
    expect(blockAt(w, 20, 20)!.revealed).toBe(false);
    // 越界坐标要被拉回安全屋
    const S3: any = { world: { seed: 'test-seed-1', cur: { x: 999, y: -3 } } };
    expect(ensureSaveWorld(S3).cur).toEqual({ x: w.home.x, y: w.home.y });
  });
});

describe('旅行报价', () => {
  const from = { x: w.home.x, y: w.home.y };

  it('走路按步数收行动力，骨折要多花', () => {
    const to = { x: from.x + 2, y: from.y };
    const r = planTrip(w, from, to, { ap: 9, veh: null, fractured: false, night: false });
    expect('trip' in r).toBe(true);
    if (!('trip' in r)) return;
    expect(r.trip.mode).toBe('foot');
    expect(r.trip.steps).toBe(2);
    expect(r.trip.ap).toBe(2);
    const f = planTrip(w, from, to, { ap: 9, veh: null, fractured: true, night: false });
    if ('trip' in f) expect(f.trip.ap).toBeGreaterThan(r.trip.ap);
  });

  it('行动力不够就不让走，并给出一句人话', () => {
    const r = planTrip(w, from, { x: from.x + 3, y: from.y }, { ap: 1, veh: null, fractured: false, night: false });
    expect('err' in r).toBe(true);
    if ('err' in r) expect(r.err).toContain('行动力');
  });

  it('开车省行动力但要烧油；没油自动改走路', () => {
    // 目标区块不能随手挑：水域会把直线挡掉，先按寻路结果找一个"走路 3~12 步"的真目标
    let to: { x: number; y: number } | null = null;
    let footSteps = 0;
    for (let d = 3; d <= 12 && !to; d++) {
      for (const cand of [{ x: from.x + d, y: from.y }, { x: from.x, y: from.y + d }, { x: from.x + d, y: from.y + d }]) {
        const p = findPath(w, from, cand, 'foot');
        if (p && p.length - 1 === d) { to = cand; footSteps = d; break; }
      }
    }
    expect(to).not.toBeNull();
    if (!to) return;
    const car = planTrip(w, from, to, { ap: 9, veh: { fuel: 9, hp: 100 }, fractured: false, night: false });
    expect('trip' in car).toBe(true);
    if ('trip' in car) {
      expect(car.trip.mode).toBe('car');
      expect(car.trip.ap).toBeLessThan(footSteps);
      expect(car.trip.fuel).toBeGreaterThan(0);
    }
    const dry = planTrip(w, from, to, { ap: 9, veh: { fuel: 0, hp: 100 }, fractured: false, night: false });
    if ('trip' in dry) expect(dry.trip.mode).toBe('foot');
  });

  it('原地不动会被拒绝', () => {
    const r = planTrip(w, from, from, { ap: 9, veh: null, fractured: false, night: false });
    expect('err' in r).toBe(true);
  });

  it('寻路不会穿水，也绕得开', () => {
    const water: [number, number][] = [];
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const b = blockAt(w, x, y)!;
      if (b.biome === 'water') water.push([x, y]);
    }
    if (water.length >= 2) {
      const path = findPath(w, { x: w.home.x, y: w.home.y }, { x: 0, y: 0 }, 'foot');
      if (path) {
        expect(path.length).toBeGreaterThanOrEqual(Math.max(Math.abs(w.home.x), Math.abs(w.home.y)) + 1);
        expect(path.some(b => b.biome === 'water')).toBe(false);
      }
    }
    const p2 = findPath(w, { x: 1, y: 1 }, { x: 22, y: 22 }, 'car');
    if (p2) expect(p2.some(b => b.biome === 'water')).toBe(false);
  });
});

describe('路上遭遇', () => {
  it('步数越多越可能出事；0 步永远平安', () => {
    expect(rollTravelEncounter(Math.random, { steps: 0, night: false, danger: 1, car: false })).toBeNull();
    const hit = rollTravelEncounter(seq(0.001), { steps: 6, night: true, danger: 5, car: false });
    expect(hit).not.toBeNull();
    expect(hit!).toBeLessThanOrEqual(6);
    const none = rollTravelEncounter(() => 0.999, { steps: 6, night: false, danger: 1, car: false });
    expect(none).toBeNull();
  });

  it('开车比走路安全（同样骰点下更不容易出事）', () => {
    const foot = rollTravelEncounter(() => 0.2, { steps: 4, night: false, danger: 4, car: false });
    const car = rollTravelEncounter(() => 0.2, { steps: 4, night: false, danger: 4, car: true });
    expect(car === null || (foot !== null && car >= foot)).toBe(true);
  });
});

describe('搜刮与 POI', () => {
  it('每个 legacy 主线区域都能被某个 POI 代表（换大世界也不会卡主线）', () => {
    const need = ['hospital', 'police', 'market', 'subway', 'oldtown', 'military'];
    const got = new Set(Object.keys(POIS).map(id => zoneOfPoi(id)).filter(Boolean) as string[]);
    for (const z of need) expect(got.has(z)).toBe(true);
  });

  it('掉落表里的 id 全部真实存在（否则玩家会抽到空气）', () => {
    const VALID = new Set(['ammo',   // ammo 是独立计数（S.ammo），不在 ITEMS 里但 grant() 认它
      'flare',  // v4.0 C07：信号枪（撤离结局用），已加进 legacy ITEMS
      'fish', 'fish_cooked', 'rod', 'bait', 'wetsuit', 'o2', 'purify',   // M7/M7.1：水体互动的物品 + 净化片
      'berry', 'mushroom', 'grain', 'dried', 'pickle', 'seed_veg', 'seed_grain',   // M6：农业/采集/加工
      'can', 'biscuit', 'jerky', 'choco', 'water', 'dirty', 'cola', 'bandage', 'medkit', 'painkiller', 'anti',
      'serum', 'antitoxin', 'cloth', 'metal', 'tape', 'powder', 'wood', 'chip', 'chem', 'fuel', 'bottle', 'molotov', 'grenade',
      'smoke', 'crowbar', 'machete', 'axe', 'pistol', 'shotgun', 'rifle', 'marksman', 'gasmask', 'hazmat', 'vest', 'kevlar',
      'helmet', 'boots', 'backpack', 'keycard', 'data', 'cure']);
    const bad: string[] = [];
    for (const id in POIS) for (const it in POIS[id].loot) if (!VALID.has(it)) bad.push(id + ':' + it);
    expect(bad).toEqual([]);
  });

  it('敌人都能在 legacy 丧尸表里找到', () => {
    /* 不手写 KNOWN 名单：直接从 legacy 源码解析（加新丧尸时测试自动跟上，不会误报） */
    const KNOWN = zombieIds();
    const bad: string[] = [];
    for (const id in POIS) for (const e of POIS[id].enemies) if (!KNOWN.includes(e)) bad.push(id + ':' + e);
    expect(bad).toEqual([]);
    expect(KNOWN.length).toBeGreaterThan(10);
  });

  it('权重掷结果落在唯一非零项上；抽掉落会过滤非法 id', () => {
    const w0 = { fight: 0, item: 1, mats: 0, food: 0, lore: 0, trap: 0, empty: 0 };
    expect(rollSearchKind(() => 0.5, w0)).toBe('item');
    expect(pickLoot(() => 0.5, { nope: 1, can: 1 }, id => id === 'can')).toBe('can');
    expect(pickLoot(() => 0.5, { nope: 1 }, () => false)).toBeNull();
  });

  it('危险越高越容易打起来，深搜更贪也更危险', () => {
    const low = searchWeights('market', 1, false, 0);
    const high = searchWeights('lab', 6, false, 0);
    expect(high.fight).toBeGreaterThan(low.fight);
    const deep = searchWeights('market', 1, true, 0);
    expect(deep.item).toBeGreaterThan(low.item);
    expect(deep.fight).toBeGreaterThan(low.fight);
  });

  it('遭遇数量在 1~3 之间且都是该 POI 的敌人', () => {
    for (let i = 0; i < 30; i++) {
      const foes = foesFor(Math.random, 'hospital', 4, i % 2 === 0);
      expect(foes.length).toBeGreaterThanOrEqual(1);
      expect(foes.length).toBeLessThanOrEqual(3);
      for (const f of foes) expect(POIS.hospital.enemies).toContain(f);
    }
  });
});

describe('M12 多区域大世界', () => {
  it('老存档（没有 region 字段）自动认成主城，原有进度一个不丢', () => {
    const sw: any = defaultSaveWorld('old-save-1');
    delete sw.region; delete sw.regions; delete sw.seenRegions;
    sw.visited['3,4'] = 1;                       // 老档在主城踩过的格子
    const fixed = ensureSaveWorld({ seed: 'old-save-1', world: sw });
    expect(fixed.region).toBe(HOME_REGION);
    expect(fixed.visited['3,4']).toBe(1);        // 顶层 map 就是主城的进度，没被搬走
    expect(fixed.seenRegions[HOME_REGION]).toBe(1);
    expect(fixed.regions).toEqual({});
  });

  it('跨区：进度会被冻结、换回来还能接着用；坐标落到新区域的落脚点', () => {
    const S: any = { seed: 'multi-1', world: null };
    const sw = defaultSaveWorld('multi-1');
    S.world = sw;
    /* M17：邻居和"最外圈"都要从**这个世界真实的区域表**里取（元地图是程序化生成的） */
    const neighbor = REGIONS.find(r => r.id !== HOME_REGION && r.type !== 'water'
      && Math.max(Math.abs(r.col - regionById(HOME_REGION)!.col), Math.abs(r.row - regionById(HOME_REGION)!.row)) === 1)!;
    const wHome = worldOf(sw.seed, HOME_REGION);
    markVisited(wHome, sw, wHome.home.x, wHome.home.y);
    sw.visited['5,5'] = 1;                       // 主城里踩过的一格

    const r1 = switchRegion(S, sw, neighbor.id);
    expect(r1.ok).toBe(true);
    expect(sw.region).toBe(neighbor.id);
    expect(sw.visited['5,5']).toBeUndefined();   // 换区后顶层 map 是这个区域的（空）
    expect(r1.firstEnter).toBeTruthy();          // 首次进入给叙事钩子
    const wNew = worldOf(sw.seed, neighbor.id);
    expect(sw.cur).toEqual({ x: wNew.home.x, y: wNew.home.y });
    expect(sw.seenRegions[neighbor.id]).toBe(1);
    expect(sw.regions[HOME_REGION].visited['5,5']).toBe(1);   // 主城进度被冻住了

    sw.visited['2,2'] = 1;                       // 在新区域踩一格
    const r2 = switchRegion(S, sw, HOME_REGION);
    expect(r2.ok).toBe(true);
    expect(sw.visited['5,5']).toBe(1);           // 回主城：老进度还在
    expect(sw.visited['2,2']).toBeUndefined();   // 那边的进度留在那边
    expect(sw.regions[neighbor.id].visited['2,2']).toBe(1);
    expect(r2.firstEnter).toBeUndefined();       // 不是第一次来主城
  });

  it('每个区域的 24×24 世界不一样（同一存档、不同区域），且危险度按区域层级上浮', () => {
    const a = worldOf('multi-2', HOME_REGION);
    const outer = REGIONS.filter(r => r.type !== 'water').sort((x, y) => y.tier - x.tier)[0];
    const b = worldOf('multi-2', outer.id);
    const aTerra = Object.keys(a.blocks).map(k => a.blocks[k].biome).join('');
    const bTerra = Object.keys(b.blocks).map(k => b.blocks[k].biome).join('');
    expect(aTerra).not.toBe(bTerra);
    // 外圈（危险层级更高）的整体危险度更高
    const avg = (w: typeof a) => Object.keys(w.blocks).reduce((s, k) => s + w.blocks[k].danger, 0) / Object.keys(w.blocks).length;
    expect(outer.tier).toBeGreaterThan(1);
    expect(avg(b)).toBeGreaterThan(avg(a));
  });

  it('同区域反复取世界对象是同一个实例（有缓存，不在 render 里重建）', () => {
    expect(worldOf('multi-3', HOME_REGION)).toBe(worldOf('multi-3', HOME_REGION));
    expect(worldOf('multi-3', HOME_REGION)).not.toBe(worldOf('multi-3', 'xishan'));
  });

  it('switchRegion 对不存在的区域不生效', () => {
    const S: any = { seed: 'multi-4', world: null };
    const sw = defaultSaveWorld('multi-4');
    S.world = sw;
    const r = switchRegion(S, sw, 'no-such-region');
    expect(r.ok).toBe(false);
    expect(sw.region).toBe(HOME_REGION);
  });
});