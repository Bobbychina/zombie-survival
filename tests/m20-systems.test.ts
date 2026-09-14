/* M20 四个新模块的单测：挑战码（种子分享）/ 多世界 / 死亡台账 / 幽灵据点。
   共同的验收标准就一句话：**玩家之间的数据交换不能出安全事故**——
   码被改一位就得被拒绝、导入的台账不能污染本地、抢来的东西不能超过对方那份快照、
   世界列表在坏档下也得能打开。 */
import { describe, expect, it } from 'vitest';
import { PRESETS, challengeFromSearch, challengeUrl, parseShareCode, randomSeed, shareCode, validSeed } from '../src/v4/share-core';
import {
  MAIN_KEY, createWorld, emptyRegistry, normalizeRegistry, removeWorld, renameWorld, slotKey, sortedWorlds, touchWorld, worldById, worldLine,
} from '../src/v4/worlds-core';
import { addRecord, byCause, byRegion, byType, exportLedger, importLedger, normalizeLedger, report, type RunRecord } from '../src/v4/telemetry-core';
import {
  GHOST_BIOMES, ghostBlockName, ghostCode, ghostFoes, ghostLine, ghostLoot, ghostPlacement, makeGhost, parseGhostCode, resolveGhostSpot,
} from '../src/v4/ghosts-core';

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  kind: 'death', day: 5, cause: '你在战斗里流干了最后一滴血。', region: 'r3-7', rtype: 'industry',
  tier: 3, kills: 23, mat: 40, at: 1700000000000, ...over,
});

describe('M20 挑战码（种子分享）', () => {
  it('编码→解码往返一致（种子 / 预设 / 署名都在）', () => {
    const code = shareCode({ seed: '余烬-317-0913', preset: 'bleak', by: 'bobby' });
    const back = parseShareCode(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.spec.seed).toBe('余烬-317-0913');
    expect(back.spec.preset).toBe('bleak');
    expect(back.spec.by).toBe('bobby');
  });

  it('默认预设是 normal，三种预设都有名字与说明', () => {
    const back = parseShareCode(shareCode({ seed: 'abc-def', preset: 'normal' }));
    expect(back.ok && back.spec.preset).toBe('normal');
    for (const id of ['normal', 'lean', 'bleak'] as const) {
      expect(PRESETS[id].name.length).toBeGreaterThan(1);
      expect(PRESETS[id].desc.length).toBeGreaterThan(6);
    }
    expect(PRESETS.bleak.mat).toBeLessThan(PRESETS.normal.mat);
  });

  it('改一位就被拒（校验和），并且给出人话原因', () => {
    const code = shareCode({ seed: 'tamper-me', preset: 'normal' });
    const bad = code.slice(0, -1) + (code.endsWith('a') ? 'b' : 'a');
    const r = parseShareCode(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toMatch(/校验失败|损坏|格式/);
    expect(parseShareCode('').ok).toBe(false);
    expect(parseShareCode('ZS1-abc').ok).toBe(false);
    expect(parseShareCode('ZS2-whatever-123').ok).toBe(false);
  });

  it('种子长度受限（不让存档被超长种子撑爆）', () => {
    expect(validSeed('abc')).toBe(true);
    expect(validSeed('余烬-317')).toBe(true);
    expect(validSeed('ab')).toBe(false);
    expect(validSeed('x'.repeat(60))).toBe(false);
    expect(validSeed('bad\nseed')).toBe(false);
    expect(() => shareCode({ seed: 'no', preset: 'normal' })).toThrow();
  });

  it('链接里的挑战码能读出来（?challenge=）', () => {
    const code = shareCode({ seed: 'link-test', preset: 'lean' });
    const url = challengeUrl(code);
    expect(url).toContain('?challenge=');
    const parsed = challengeFromSearch(url.slice(url.indexOf('?')));
    expect(parsed?.ok).toBe(true);
    if (parsed?.ok) expect(parsed.spec.seed).toBe('link-test');
    expect(challengeFromSearch('?foo=1')).toBeNull();
  });

  it('随机种子像个人名、且带日期后缀', () => {
    const s = randomSeed(() => 0.5);
    expect(validSeed(s)).toBe(true);
    expect(s).toMatch(/-\d{3}-\d{4}$/);
  });
});

describe('M20 多世界管理', () => {
  it('新建世界 → 成为当前世界；列表按最近游玩排序', () => {
    let reg = emptyRegistry();
    const a = createWorld(reg, { name: '余烬', seed: 'world-a', preset: 'normal', now: 1000, id: 'wa' });
    reg = a.reg;
    const b = createWorld(reg, { name: '地狱开局', seed: 'world-b', preset: 'bleak', now: 2000, id: 'wb' });
    reg = b.reg;
    expect(reg.activeId).toBe('wb');
    expect(reg.worlds.length).toBe(2);
    expect(sortedWorlds(reg)[0].id).toBe('wb');
    reg = touchWorld(reg, 'wa', { lastPlayed: 3000, day: 12, deaths: 3 });
    expect(sortedWorlds(reg)[0].id).toBe('wa');
    expect(worldLine(worldById(reg, 'wa')!)).toContain('第 12 天');
    expect(worldLine(worldById(reg, 'wa')!)).toContain('死过 3 次');
  });

  it('至少留一个世界；删掉当前世界会自动切到剩下的那个', () => {
    let reg = createWorld(emptyRegistry(), { name: 'A', seed: 'aaa', id: 'wa', now: 1 }).reg;
    reg = createWorld(reg, { name: 'B', seed: 'bbb', id: 'wb', now: 2 }).reg;
    reg = removeWorld(reg, 'wb');
    expect(reg.worlds.map(w => w.id)).toEqual(['wa']);
    expect(reg.activeId).toBe('wa');
    expect(removeWorld(reg, 'wa').worlds.length).toBe(1);      // 最后一个删不掉
  });

  it('改名有长度限制（空名/超长名直接忽略）', () => {
    let reg = createWorld(emptyRegistry(), { name: 'A', seed: 'aaa', id: 'wa', now: 1 }).reg;
    reg = renameWorld(reg, 'wa', '  新名字  ');
    expect(worldById(reg, 'wa')!.name).toBe('新名字');
    const before = worldById(reg, 'wa')!.name;
    reg = renameWorld(reg, 'wa', 'x'.repeat(30));
    expect(worldById(reg, 'wa')!.name).toBe(before);
  });

  it('坏档也能打开：字段缺失/重复 id/非法预设全部修回来', () => {
    const reg = normalizeRegistry({ v: 9, activeId: 'nope', worlds: [
      { id: 'dup', name: '', seed: 'ok-seed', preset: 'weird', day: 'x' },
      { id: 'dup', name: '第二个同名 id' },
      null,
      { id: 'ok', name: '正常世界', seed: 'yyy', preset: 'bleak', day: 9, deaths: -3 },
    ] });
    expect(reg.worlds.length).toBe(2);                    // 重复 id 被去掉一个，null 被丢掉
    expect(reg.activeId).toBe('dup');                     // activeId 无效 → 落到第一个
    expect(reg.worlds[0].preset).toBe('normal');          // 非法预设回落到 normal
    expect(reg.worlds[0].day).toBe(1);
    expect(reg.worlds[1].deaths).toBe(0);
    expect(normalizeRegistry(undefined).worlds).toEqual([]);
  });

  it('每个世界一个存档槽键，主键仍然是老地方（不改 legacy 的链路）', () => {
    expect(slotKey('wa')).toBe('zsv_save_wa');
    expect(MAIN_KEY).toBe('zombie_survival_save_v2');
  });
});

describe('M20 死亡台账（开发者回传）', () => {
  it('记录、上限、坏数据过滤', () => {
    let list: RunRecord[] = [];
    for (let i = 0; i < 210; i++) list = addRecord(list, rec({ day: i + 1 }));
    expect(list.length).toBe(200);                        // 只留最近 200 条
    expect(list[list.length - 1].day).toBe(210);
    expect(normalizeLedger([null, 'x', { day: 3 }]).length).toBe(1);
  });

  it('按区域类型/区域/死因聚合，出"哪类地貌在吃人"', () => {
    const list = [rec({ rtype: 'military', region: 'r1-1', day: 4 }), rec({ rtype: 'military', region: 'r1-1', day: 6 }),
      rec({ rtype: 'suburb', region: 'r5-5', day: 20 }), rec({ rtype: 'suburb', region: 'r5-6', day: 24, cause: '一次搜刮要了你的命。' })];
    const t = byType(list);
    expect(t[0].key).toBe('military');
    expect(t[0].deaths).toBe(2);
    expect(t[0].avgDay).toBe(5);
    expect(byRegion(list)[0].key).toBe('r1-1');
    expect(byCause(list)[0].cause).toContain('流干了最后一滴血');
  });

  it('报告给出一句话结论 + 最难/最易清单（空台账也有话说）', () => {
    const empty = report([]);
    expect(empty.runs).toBe(0);
    expect(empty.verdict).toContain('还没有记录');
    const r = report([rec({ rtype: 'water', day: 3 }), rec({ rtype: 'water', day: 5 }), rec({ rtype: 'farm', day: 30 })]);
    expect(r.runs).toBe(3);
    expect(r.deaths).toBe(3);
    expect(r.hardest[0].key).toBe('water');
    expect(r.easiest[0].key).toBe('farm');
    expect(r.medianDay).toBeGreaterThan(0);
    expect(r.verdict).toContain('水域港区');
  });

  it('导出的是匿名化数据（没有账号/存档，天数与击杀都分桶），导入能读回来', () => {
    const text = exportLedger([rec({ kills: 37, mat: 84 })]);
    const o = JSON.parse(text);
    expect(o.game).toBe('zombie-survival');
    expect(JSON.stringify(o)).not.toMatch(/name|token|email|save/i);
    expect(o.exp[0].k10).toBe(30);                        // 击杀数分桶
    expect(o.exp[0].m10).toBe(80);                        // 材料分桶
    const back = importLedger(text);
    expect(back.length).toBe(1);
    expect(back[0].day).toBe(5);
    expect(importLedger('not json').length).toBe(0);
  });
});

describe('M20 幽灵据点（异步 PVP）', () => {
  const spec = makeGhost({ owner: '老周', mat: 120, items: [{ id: 'medkit', n: 3 }, { id: 'can', n: 9 }], day: 40, tag: '来拿啊。' });

  it('码往返一致；改一位就被拒', () => {
    const code = ghostCode(spec);
    const back = parseGhostCode(code);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.spec.owner).toBe('老周');
      expect(back.spec.mat).toBe(120);
      expect(back.spec.item).toBe('can');                 // 数量最多的那件
      expect(back.spec.threat).toBeGreaterThanOrEqual(1);
    }
    const bad = code.slice(0, -1) + (code.endsWith('z') ? 'y' : 'z');
    expect(parseGhostCode(bad).ok).toBe(false);
    expect(parseGhostCode('').ok).toBe(false);
    expect(parseGhostCode('ZG2-xx-yy').ok).toBe(false);
  });

  it('抢来的东西不超过对方那份快照（而且对方存档不受影响——抢的是副本）', () => {
    const loot = ghostLoot(spec);
    expect(loot.mat).toBeGreaterThan(0);
    expect(loot.mat).toBeLessThanOrEqual(spec.mat);
    expect(loot.mat).toBeLessThanOrEqual(60);
    expect(loot.item).toBe(spec.item);
    expect(loot.n).toBe(1);
    const tiny = ghostLoot(makeGhost({ owner: 'x', mat: 2, items: [], day: 3 }));
    expect(tiny.mat).toBeGreaterThanOrEqual(3);           // 太穷也有保底，不然白打
  });

  it('守卫强度随威胁度上升（且 id 都是游戏里真实存在的敌人）', () => {
    const weak = ghostFoes({ ...spec, threat: 1 });
    const strong = ghostFoes({ ...spec, threat: 5 });
    expect(weak.length).toBeLessThan(strong.length);
    expect(strong).toContain('tyrant');
    expect(weak).not.toContain('tyrant');
    expect(new Set(strong).size).toBeLessThanOrEqual(6);
  });

  it('落点稳定、离家 ≥6 格、不压地图边缘', () => {
    const home = { x: 12, y: 12 };
    const p1 = ghostPlacement(spec, 'world-a', 24, 24, home);
    const p2 = ghostPlacement(spec, 'world-a', 24, 24, home);
    expect(p1).toEqual(p2);                               // 同一个码 + 同一张图 = 同一个地方
    expect(Math.max(Math.abs(p1.x - home.x), Math.abs(p1.y - home.y))).toBeGreaterThanOrEqual(6);
    expect(p1.x).toBeGreaterThan(0); expect(p1.x).toBeLessThan(23);
    expect(p1.y).toBeGreaterThan(0); expect(p1.y).toBeLessThan(23);
    const others = ['world-b', 'world-c', 'world-d'].map(s => ghostPlacement(spec, s, 24, 24, home));
    expect(new Set(others.map(p => p.x + ',' + p.y)).size).toBeGreaterThan(1);   // 不同世界落点不同
  });

  it('偏好落点被占（公路/水面）时会往外找一格，而不是静默不生成', () => {
    /* 踩过的坑：哈希出来的点正好压在公路上 → 第一版直接跳过 →
       玩家"导入成功但地图上什么都没有"（静默失败）。 */
    const prefer = { x: 10, y: 10 };
    const blocked = (x: number, y: number) => !(x === prefer.x && y === prefer.y) && x >= 1 && y >= 1 && x <= 22 && y <= 22;
    const spot = resolveGhostSpot(prefer, blocked, 24, 24);
    expect(spot).not.toBeNull();
    expect(spot).not.toEqual(prefer);
    expect(Math.max(Math.abs(spot!.x - prefer.x), Math.abs(spot!.y - prefer.y))).toBe(1);   // 就在旁边一圈
    expect(resolveGhostSpot(prefer, blocked, 24, 24)).toEqual(spot);                        // 确定性
    expect(resolveGhostSpot(prefer, () => false, 24, 24)).toBeNull();                       // 真没地方就明确返回 null
  });

  it('文案与地表白名单齐全（UI 直接用）', () => {
    expect(ghostLine(spec)).toContain('老周');
    expect(ghostLine(spec)).toContain('威胁');
    expect(ghostBlockName(spec)).toContain('幽灵据点');
    expect(GHOST_BIOMES).toContain('city');
    expect(GHOST_BIOMES).not.toContain('water');
  });
});
