/* M54：据点系统的纯逻辑（据点页"作战室"的全部算式与建议） */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASE_SECTIONS, abandonCost, adviseBuilds, defMaxOf, facilityDelta, missingFor, nightlyYield, raidChance, raidGuaranteed,
  scaledCost, trapCap, verdictOf, waterYield,
} from '../src/v4/base-core';

const TABLE = {
  door: { max: 3, cost: { wood: 4, metal: 3 }, n: '加固门窗' },
  bed: { max: 3, cost: { cloth: 4, wood: 2 }, n: '行军床' },
  filter: { max: 3, cost: { metal: 3, chip: 2, tape: 1 }, n: '净水装置' },
  garden: { max: 3, cost: { wood: 2, cloth: 1, can: 1 }, n: '屋顶菜园' },
  bench: { max: 3, cost: { metal: 3, wood: 2, tape: 1 }, n: '工作台' },
  loading: { max: 3, cost: { metal: 4, wood: 2, tape: 2 }, n: '弹药台' },
  medlab: { max: 3, cost: { metal: 3, chip: 2, chem: 2 }, n: '医疗台' },
  kitchen: { max: 3, cost: { metal: 3, cloth: 1, wood: 3 }, n: '灶台' },
  power: { max: 2, cost: { metal: 6, chip: 4, fuel: 2 }, n: '发电机' },
  storage: { max: 3, cost: { metal: 3, wood: 3 }, n: '储物箱' },
  radio: { max: 1, cost: { chip: 3, metal: 3, tape: 2 }, n: '无线电' },
  wall: { max: 2, cost: { wood: 6, metal: 5 }, n: '围墙工事' },
  pond: { max: 3, cost: { wood: 4, cloth: 2, metal: 1 }, n: '鱼塘' },
};
const base = (over: Record<string, number> = {}) => ({ door: 0, bed: 0, filter: 0, garden: 0, bench: 0, storage: 0, radio: 0, wall: 0, ...over });
const stockOf = (o: Record<string, number> = {}) => ({ wood: 0, metal: 0, cloth: 0, chip: 0, tape: 0, can: 0, chem: 0, fuel: 0, ...o });

describe('分区表', () => {
  it('每个设施恰好归一个分区，且与 legacy BASE_UP 的键一一对应（加设施必须同步分区）', () => {
    const inSections = BASE_SECTIONS.flatMap(s => s.keys);
    expect(new Set(inSections).size).toBe(inSections.length);                  // 不重复
    const src = readFileSync('src/legacy/game.ts', 'utf8');
    const table = src.slice(src.indexOf('const BASE_UP = {'), src.indexOf('/* M25 弹药口径/穿透'));
    const keys = [...table.matchAll(/^\s{2}([a-z]+):\s*\{n:/gm)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    expect([...inSections].sort()).toEqual([...keys].sort());                  // 一一对应
  });
});

describe('scaledCost / defMaxOf', () => {
  it('价目 = 基础价 ×(1+0.6×当前等级) 向上取整', () => {
    expect(scaledCost({ wood: 4, metal: 3 }, 0)).toEqual({ wood: 4, metal: 3 });
    expect(scaledCost({ wood: 4, metal: 3 }, 1)).toEqual({ wood: 7, metal: 5 });
    expect(scaledCost({ chip: 2 }, 3)).toEqual({ chip: 6 });
  });
  it('升级只会更贵（不会出现"越升越便宜"这种反直觉）', () => {
    for (let lv = 0; lv < 3; lv++) {
      const a = scaledCost({ wood: 5 }, lv), b = scaledCost({ wood: 5 }, lv + 1);
      expect(b.wood).toBeGreaterThan(a.wood);
    }
  });
  it('防线上限：门窗 24+26/级，围墙 46/级', () => {
    expect(defMaxOf(0, 0)).toEqual({ door: 24, wall: 0 });
    expect(defMaxOf(1, 1)).toEqual({ door: 50, wall: 46 });
    expect(defMaxOf(3, 2)).toEqual({ door: 102, wall: 92 });
  });
});

describe('尸潮概率与必打判定', () => {
  it('基础 16% + 每晚 1.1% + 噪音每点 3%，封顶 60%', () => {
    expect(raidChance(1, 0)).toBeCloseTo(0.171, 5);
    expect(raidChance(10, 2)).toBeCloseTo(0.16 + 0.11 + 0.06, 5);
    expect(raidChance(100, 50)).toBe(0.6);
    expect(raidChance(-5, -3)).toBeCloseTo(0.16, 5);      // 脏输入不许算出负数
  });
  it('血月与尸群到点 → 今晚必打', () => {
    expect(raidGuaranteed(7, 0)).toBe(true);
    expect(raidGuaranteed(14, 0)).toBe(true);
    expect(raidGuaranteed(3, 1)).toBe(true);              // horde.eta=1 → 今夜抵达
    expect(raidGuaranteed(3, 5)).toBe(false);
  });
});

describe('弃守代价（与 legacy 弃守分支同一算式）', () => {
  it('裸据点：第 10 天弃守 ≈ 掉 15 血 / 丢 18 料', () => {
    const c = abandonCost({ day: 10, doorLv: 0, wallLv: 0, blood: false, mat: 100 });
    expect(c.power).toBe(26);                              // round(26 × 1 × 1)
    expect(c.hpLoss).toBe(13);                             // round(26 × 1 × 0.5)
    expect(c.matLoss).toBe(16);                            // round(26 × 0.6)
  });
  it('门窗/围墙等级越高越轻；血月更狠', () => {
    const bare = abandonCost({ day: 8, doorLv: 0, wallLv: 0, blood: false, mat: 50 });
    const built = abandonCost({ day: 8, doorLv: 3, wallLv: 2, blood: false, mat: 50 });
    expect(built.hpLoss).toBeLessThan(bare.hpLoss);
    expect(built.matLoss).toBeLessThan(bare.matLoss);
    const blood = abandonCost({ day: 8, doorLv: 0, wallLv: 0, blood: true, mat: 50 });
    expect(blood.hpLoss).toBeGreaterThan(bare.hpLoss);
  });
  it('至少掉 2 血；丢料不会超过身上材料', () => {
    expect(abandonCost({ day: 1, doorLv: 3, wallLv: 2, blood: false, mat: 0 }).hpLoss).toBeGreaterThanOrEqual(2);
    expect(abandonCost({ day: 40, doorLv: 0, wallLv: 0, blood: true, mat: 3 }).matLoss).toBe(3);
  });
});

describe('每日产出', () => {
  it('净水：等级 + 发电机 +1；断电要烧汽油，没油就没水', () => {
    expect(waterYield({ filterLv: 0, powerLv: 0, gridOff: false, hasFuel: false }).n).toBe(0);
    expect(waterYield({ filterLv: 2, powerLv: 0, gridOff: false, hasFuel: false }).n).toBe(2);
    expect(waterYield({ filterLv: 2, powerLv: 1, gridOff: true, hasFuel: false })).toMatchObject({ n: 3 });
    expect(waterYield({ filterLv: 2, powerLv: 0, gridOff: true, hasFuel: true })).toMatchObject({ n: 2 });
    expect(waterYield({ filterLv: 2, powerLv: 0, gridOff: true, hasFuel: true }).note).toContain('汽油');
    expect(waterYield({ filterLv: 2, powerLv: 0, gridOff: true, hasFuel: false }).n).toBe(0);
  });
  it('蔬菜按菜园等级；保鲜天数受发电机影响', () => {
    const y = nightlyYield({ base: base({ garden: 2 }), gridOff: false, hasFuel: false, season: 'spring', weather: 'clear', pondFed: false, vegFreshBase: 3 });
    expect(y.veg).toBe(2);
    expect(y.vegSpoilDays).toBe(3);
    const p = nightlyYield({ base: base({ garden: 2, power: 1 }), gridOff: false, hasFuel: false, season: 'spring', weather: 'clear', pondFed: false, vegFreshBase: 3 });
    expect(p.vegSpoilDays).toBe(4);
  });
  it('鱼塘：等级 × 投喂 × 季节（复用 water-core.pondYield，不重算一份）', () => {
    const fed = nightlyYield({ base: base({ pond: 2 }), gridOff: false, hasFuel: false, season: 'spring', weather: 'clear', pondFed: true, vegFreshBase: 3 });
    expect(fed.fish).toBe(2);                              // floor(1.2 × 2.2)
    const winter = nightlyYield({ base: base({ pond: 2 }), gridOff: false, hasFuel: false, season: 'winter', weather: 'clear', pondFed: true, vegFreshBase: 3 });
    expect(winter.fish).toBeLessThan(fed.fish);
    const none = nightlyYield({ base: base({}), gridOff: false, hasFuel: false, season: 'spring', weather: 'clear', pondFed: false, vegFreshBase: 3 });
    expect(none.fish).toBe(0);
    expect(none.fishNote).toContain('鱼塘');
  });
});

describe('守夜判词', () => {
  const V = (over: Partial<Parameters<typeof verdictOf>[0]> = {}) => verdictOf({
    doorHp: 50, wallHp: 46, doorMax: 50, wallMax: 46, traps: { spike: 3, fire: 2, alarm: 1 }, tonightRaid: false, bloodMoon: false, hordeEta: 0, ...over,
  });
  it('防线满 + 有陷阱 → 稳，且 ready 在 0~1', () => {
    const v = V();
    expect(v.tier).toBe('safe');
    expect(v.label).toBe('稳');
    expect(v.ready).toBeLessThanOrEqual(1);
    expect(v.ready).toBeGreaterThanOrEqual(0);
  });
  it('防线被拆穿 → 危险，并告诉你去抢修/建墙', () => {
    const v = V({ doorHp: 0, wallHp: 0, traps: {} });
    expect(v.tier).toBe('danger');
    expect(v.hint).toMatch(/抢修|围墙/);
  });
  it('ready 随门窗血量单调上升（口径不许忽高忽低）', () => {
    const a = V({ doorHp: 10 }).ready, b = V({ doorHp: 30 }).ready, c = V({ doorHp: 50 }).ready;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it('血月/尸群临近时提示里要说出来', () => {
    expect(V({ bloodMoon: true }).hint).toContain('血月');
    expect(V({ hordeEta: 2 }).hint).toContain('尸群');
  });
});

describe('材料差多少 / 陷阱容量', () => {
  it('只列缺的，并给出差额', () => {
    expect(missingFor({ metal: 3, wood: 2 }, { metal: 5, wood: 0 })).toEqual([{ mat: 'wood', need: 2, have: 0, short: 2 }]);
    expect(missingFor({ metal: 3 }, { metal: 3 })).toEqual([]);
  });
  it('警报器只能 1 个，其余 9 个', () => {
    expect(trapCap('alarm')).toBe(1);
    expect(trapCap('spike')).toBe(9);
    expect(trapCap('fire')).toBe(9);
  });
});

describe('该建什么', () => {
  const A = (over: Partial<Parameters<typeof adviseBuilds>[0]> = {}) => adviseBuilds({
    base: base(), stock: stockOf({ wood: 20, metal: 20, cloth: 10, chip: 10, tape: 10, can: 5, chem: 5 }), table: TABLE,
    day: 3, ap: 14, hordeEta: 0, bloodMoonToday: false, ...over,
  });
  it('血月/尸群就在眼前 → 第一条是防御，且标成 urgent', () => {
    const a = A({ bloodMoonToday: true });
    expect(a[0].key).toBe('door');
    expect(a[0].urgent).toBe(true);
    expect(a[0].why).toMatch(/今晚|血月/);
  });
  it('平时优先"每天在产的东西"：没净水 → 先净水；有净水没菜园 → 菜园', () => {
    expect(A()[0].key).toBe('filter');
    expect(A({ base: base({ filter: 1, bench: 1 }) })[0].key).toBe('garden');
  });
  it('最多给三条，且每条都能落到 BASE_UP 里的设施上', () => {
    const a = A({ day: 12, base: base({ filter: 2, garden: 2, bench: 1 }) });
    expect(a.length).toBeLessThanOrEqual(3);
    for (const x of a) expect(TABLE[x.key]).toBeTruthy();
  });
  it('从不推荐已满级的设施；全满级时给一句总结而不是空列表', () => {
    const full = base({ door: 3, bed: 3, filter: 3, garden: 3, bench: 3, storage: 3, radio: 1, wall: 2, loading: 3, medlab: 3, kitchen: 3, power: 2, pond: 3 });
    const a = A({ base: full, day: 20 });
    expect(a.length).toBe(1);
    expect(a[0].key).toBe('');
    expect(a[0].why).toMatch(/满级/);
    const partial = A({ base: base({ door: 3 }), bloodMoonToday: true });
    expect(partial.map(x => x.key)).not.toContain('door');
  });
  it('材料不够时理由里会写明"还差一点"', () => {
    const a = adviseBuilds({ base: base(), stock: stockOf({}), table: TABLE, day: 3, ap: 14, hordeEta: 0, bloodMoonToday: false, buildable: () => false });
    expect(a[0].why).toContain('材料还差一点');
  });
});

describe('升级后多出什么', () => {
  it('每类设施都能给出人话的 delta', () => {
    expect(facilityDelta('door', 2, { powerLv: 0 })).toContain('上限');
    expect(facilityDelta('filter', 2, { powerLv: 1 })).toContain('净水');
    expect(facilityDelta('filter', 2, { powerLv: 1 })).toContain('发电机');
    expect(facilityDelta('storage', 2, { powerLv: 0 })).toContain('12');
    expect(facilityDelta('power', 2, { powerLv: 0 })).toContain('净水');
    expect(facilityDelta('不存在的设施', 1, { powerLv: 0 })).toBeTruthy();
  });
});
