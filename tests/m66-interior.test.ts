/* M66：建筑内部（平面图）的钉子 ——
   平面图确定性（同种子同图，防止"退出重进刷新布局"）· 房间数 3~6 · 锁着的房间抽稀有掉落 ·
   开门决策（撬棍/钥匙/硬踹，永远打得开）· 房间掉落的钥匙概率 · 存档形状与迁移清空 */
import { describe, expect, it } from 'vitest';
import { defaultSaveWorld, ensureSaveWorld } from '../src/v4/worldstate';
import { setActiveRegions } from '../src/v4/regions-core';
import {
  ROOM_KEY, ambushChance, buildInterior, hashStr, interiorHost, isLooted, landForce, mulberry32,
  openDecision, roomState, roomStatus, rollRoomLoot, splitLoot, summary, type RoomDef,
} from '../src/v4/interior-core';

const POI = {
  id: 'hospital', name: '医院', icon: '🏥',
  loot: { bandage: 1, medkit: 0.9, anti: 0.8, fungicide: 0.7, painkiller: 0.6, chem: 0.5, serum: 0.2, purify: 0.15 },
};

describe('M66 平面图生成', () => {
  it('确定性：同一栋楼（poiId + 种子）两次生成完全一致 —— 不然退出重进就能刷新出没锁的布局', () => {
    const a = buildInterior(POI, 'seed-1|r0-0|3,4')!;
    const b = buildInterior(POI, 'seed-1|r0-0|3,4')!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = buildInterior(POI, 'seed-1|r0-0|3,5')!;
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));      // 换一栋楼就是另一张图
  });

  it('3~6 间，且房间 id 唯一；够大的楼至少有一间上锁', () => {
    for (let i = 0; i < 40; i++) {
      const p = buildInterior(POI, 's' + i)!;
      expect(p.rooms.length).toBeGreaterThanOrEqual(3);
      expect(p.rooms.length).toBeLessThanOrEqual(6);
      expect(new Set(p.rooms.map(r => r.id)).size).toBe(p.rooms.length);
      if (p.rooms.length >= 4) expect(p.rooms.some(r => r.lock)).toBe(true);
    }
  });

  it('没有里屋的 POI（营地/教堂/空地）不进这套玩法', () => {
    expect(interiorHost('camp')).toBeNull();
    expect(buildInterior({ ...POI, id: 'camp' }, 's')).toBeNull();
    expect(interiorHost('hospital')).toBe('medical');
  });

  it('锁着的/深处的房间抽"稀有"那半掉落（撬锁必须有收益）', () => {
    const { common, rare } = splitLoot(POI.loot);
    const commonIds = new Set(common.map(e => e[0]));
    const rareIds = new Set(rare.map(e => e[0]));
    expect(rareIds.size).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) {
      const p = buildInterior(POI, 'r' + i)!;
      for (const r of p.rooms) {
        for (const id of Object.keys(r.loot)) {
          expect(commonIds.has(id) || rareIds.has(id)).toBe(true);
          if (r.lock || r.kind === 'vault') expect(rareIds.has(id)).toBe(true);
          else expect(commonIds.has(id)).toBe(true);
        }
      }
    }
  });
});

describe('M66 开门（永远打得开，但要付代价）', () => {
  const locked: RoomDef = { id: 'x', name: '药房', icon: '💊', kind: 'stock', lock: 'crowbar', loot: {} };
  const sealed: RoomDef = { id: 'y', name: '军械库', icon: '🔫', kind: 'vault', lock: 'sealed', loot: {} };

  it('有撬棍：安静撬开，不消耗撬棍', () => {
    const d = openDecision(locked, { crowbar: true, key: false, mat: 0 });
    expect(d.how).toBe('crowbar');
    expect(d.quiet).toBe(true);
    expect(d.cost).toBeUndefined();
  });
  it('没撬棍：硬踹（掉血 + 一定遭遇），但不会卡住', () => {
    const d = openDecision(locked, { crowbar: false, key: false, mat: 0 });
    expect(d.how).toBe('force');
    expect(d.quiet).toBe(false);
    expect(d.cost?.hp).toEqual([3, 8]);
  });
  it('加固门：钥匙优先；没钥匙就用撬棍 + 2 材料；都没有才硬踹', () => {
    expect(openDecision(sealed, { crowbar: true, key: true, mat: 0 }).how).toBe('key');
    const d = openDecision(sealed, { crowbar: true, key: false, mat: 2 });
    expect(d.how).toBe('crowbar');
    expect(d.cost?.mat).toBe(2);
    const f = openDecision(sealed, { crowbar: true, key: false, mat: 1 });
    expect(f.how).toBe('force');
    expect(f.cost?.hp).toEqual([6, 14]);
  });
  it('硬踹的伤害落在各自区间（含边界）', () => {
    expect(landForce(() => 0, locked)).toBe(3);
    expect(landForce(() => 0.999, locked)).toBe(8);
    expect(landForce(() => 0, sealed)).toBe(6);
    expect(landForce(() => 0.999, sealed)).toBe(14);
  });
  it('硬踹必有一场，平地房间比深处安静', () => {
    expect(ambushChance(locked, 1, true)).toBe(1);
    const flat: RoomDef = { ...locked, lock: undefined, kind: 'flat' };
    expect(ambushChance(flat, 0, false)).toBeLessThan(ambushChance(locked, 3, false));
  });
});

describe('M66 房间掉落与进度', () => {
  it('楼里还有没开的加固门、手里又没钥匙时，翻房间有机会翻出楼门钥匙', () => {
    const room: RoomDef = { id: 'r', name: '值班室', icon: '📋', kind: 'flat', loot: { bandage: 1 } };
    const valid = () => true;
    expect(rollRoomLoot(() => 0.1, room, { needKey: true, valid })).toContain(ROOM_KEY);
    expect(rollRoomLoot(() => 0.9, room, { needKey: true, valid })).not.toContain(ROOM_KEY);
    // 已经拿到钥匙 / 楼里没有加固门时不再掉钥匙
    expect(rollRoomLoot(() => 0.1, room, { needKey: false, valid })).not.toContain(ROOM_KEY);
  });

  it('进度：搜过的房间算完成，锁着没开的算"还锁着"；开门后变成可搜', () => {
    const p = buildInterior(POI, 'prog')!;
    const st = { rooms: {} as Record<string, any> };
    const lockedRoom = p.rooms.find(r => r.lock) || null;
    const sum0 = summary(p, st);
    expect(sum0.total).toBe(p.rooms.length);
    expect(sum0.done).toBe(0);
    if (lockedRoom) {
      expect(roomStatus(lockedRoom, st)).toBe('locked');
      roomState(st, lockedRoom.id).opened = 1;
      expect(roomStatus(lockedRoom, st)).toBe('open');
    }
    roomState(st, p.rooms[0].id).looted = 1;
    expect(isLooted(st, p.rooms[0].id)).toBe(true);
    expect(summary(p, st).done).toBe(1);
    expect(summary(p, st).total - summary(p, st).done).toBe(p.rooms.length - 1);
  });

  it('哈希/PRNG 是可复现的（同一输入同一序列）', () => {
    expect(hashStr('a|b')).toBe(hashStr('a|b'));
    const r1 = mulberry32(hashStr('x')), r2 = mulberry32(hashStr('x'));
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe('M66 存档', () => {
  it('新档自带空表；坏形状的条目被丢掉，正常条目保留', () => {
    const seed = 'm66-save';
    setActiveRegions(seed);
    expect(defaultSaveWorld(seed).interiors).toEqual({});
    const w: any = { ...defaultSaveWorld(seed) };
    w.interiors = { '3,4': { rooms: { r0_0: { looted: 1, opened: 1 }, broken: 'x' }, seen: 1 }, junk: 5 };
    const sw = ensureSaveWorld({ seed, world: w });
    expect(sw.interiors['3,4'].rooms.r0_0).toEqual({ looted: 1, opened: 1 });
    expect(sw.interiors['3,4'].rooms.broken).toBeUndefined();
    expect(sw.interiors['3,4'].seen).toBe(1);
    expect(sw.interiors['junk']).toBeUndefined();
    expect(ensureSaveWorld({ seed, world: { ...defaultSaveWorld(seed), interiors: undefined } }).interiors).toEqual({});
  });

  it('地图重画（wv 变了）时内部进度一起清掉 —— 它按坐标记，换了地形就对不上别的楼', () => {
    const seed = 'm66-migrate';
    setActiveRegions(seed);
    const w: any = { ...defaultSaveWorld(seed), wv: 0 };
    w.interiors = { '1,1': { rooms: { a: { looted: 1 } } } };
    expect(ensureSaveWorld({ seed, world: w }).interiors).toEqual({});
  });

  /* 这条是探针抓出来的真 bug 的钉子：ensureSaveWorld 每次 render 都会被调到，
     第一版实现每次都**重建**一张清洗过的表 → 平面图 UI 手里那份 `st` 成了孤儿，
     玩家刚搜过的房间在下一次 render 之后"复原"（实测连搜三间，关掉再进只剩两间）。 */
  it('ensure 保留 interiors 的对象身份（清洗就地做，不重建）', () => {
    const seed = 'm66-identity';
    setActiveRegions(seed);
    const S: any = { seed, world: { ...defaultSaveWorld(seed) } };
    const sw1 = ensureSaveWorld(S);
    const st: any = { rooms: {} };
    sw1.interiors['9,9'] = st;
    const sw2 = ensureSaveWorld(S);
    expect(sw2.interiors['9,9']).toBe(st);
    st.rooms.r0_1 = { looted: 1 };                 // UI 直接往手里的引用上写
    expect(ensureSaveWorld(S).interiors['9,9'].rooms.r0_1).toEqual({ looted: 1 });
  });
});
