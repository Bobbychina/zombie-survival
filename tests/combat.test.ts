import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());
import { advance, canUse, createBattle, foeTurn, movesFor, playerAct, tickStatuses, tryFlee, type PlayerProfile } from '../src/v4/combat';
import { TYPE_CHART, effectivenessText, typeMult, weaponMoves } from '../src/v4/moves';
import { FOE_TRAITS, FOE_TYPES } from '../src/v4/foe-data';
import { POIS } from '../src/v4/pois';
import type { Foe } from '../src/types';

import { zombieTable } from './legacy-tables';
const ZOMBIES = zombieTable();


const mkFoe = (over: Partial<Foe> = {}): Foe => ({
  id: 'walker', name: '普通丧尸', hp: 40, hpMax: 40, atk: 8, def: 2, spd: 1,
  types: ['flesh'], moves: [], statuses: [], traits: [], ...over,
});

const mkPlayer = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  hp: 100, hpMax: 100, sta: 100, staMax: 100, ammo: 30,
  weaponId: 'crowbar', weaponName: '撬棍', weaponDmg: 14, isGun: false,
  critBonus: 0, dmgMult: 1, dodge: 0, armor: 0, speed: 2,
  inventory: { bandage: 1 }, ...over,
});

describe('属性克制表', () => {
  it('斩击克皮肉、枪弹克装甲吃亏、火焰克毒囊', () => {
    expect(TYPE_CHART.slash.flesh).toBe(2);
    expect(TYPE_CHART.bullet.armor).toBeCloseTo(0.5);
    expect(TYPE_CHART.fire.toxic).toBe(2);
    expect(TYPE_CHART.blast.hulk).toBe(2);
  });
  it('多属性相乘，文案分级正确', () => {
    expect(typeMult('bullet', ['flesh', 'swift'])).toBeCloseTo(2.25);
    expect(typeMult('slash', ['armor', 'bone'])).toBeCloseTo(0.5);
    expect(effectivenessText(2)).toContain('拔群');
    expect(effectivenessText(0.5)).toContain('不佳');
    expect(effectivenessText(1)).toBe('');
  });
});

describe('招式槽', () => {
  it('近战武器给 3 招（速击/重击/横扫），枪械给点射+连发+压制或散射', () => {
    const melee = weaponMoves('crowbar', 14, false, {});
    expect(melee.map(m => m.id)).toEqual(['swing', 'smash', 'sweep']);
    const gun = weaponMoves('pistol', 21, true, {});
    expect(gun.map(m => m.id)).toEqual(['shot', 'burst', 'suppress']);
    const shotgun = weaponMoves('shotgun', 46, true, { spread: true });
    expect(shotgun[2].target).toBe('all');
  });
  it('玩家 4 个招式槽：武器两招 + 战术 + 物品', () => {
    const p = mkPlayer({ inventory: { molotov: 1 } });
    const moves = movesFor(p);
    expect(moves.length).toBe(4);
    expect(moves[3].id).toBe('molotov');
  });
  it('消耗不足时不可用（PP 语义）', () => {
    const p = mkPlayer({ ammo: 0, weaponId: 'pistol', isGun: true });
    const m = movesFor(p)[0];
    expect(canUse(p, m).ok).toBe(false);
    expect(canUse(p, m).why).toContain('弹药');
  });
});

describe('回合制引擎', () => {
  it('玩家出手能造成伤害，且斩击打皮肉是拔群', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 固定随机：避免命中/暴击把断言变成掷骰子
    const p = mkPlayer({ weaponId: 'machete', weaponDmg: 23 });
    const b = createBattle([mkFoe({ hp: 200, hpMax: 200 })], p, {});
    expect(advance(b, p, 10)).toBe(true);            // 轮到玩家
    const before = b.foes[0].hp;
    playerAct(b, p, 'smash', 0);
    const dealt = before - b.foes[0].hp;
    expect(dealt).toBeGreaterThan(15);               // 23×1.6 威力 ×2 倍克制
    expect(b.stats.dealt).toBe(dealt);
  });

  it('防御能显著降低受到的伤害', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 固定随机：否则这条断言就是在掷骰子
    const taken = (guard: number) => {
      const p = mkPlayer();
      const b = createBattle([mkFoe({ spd: 9, atk: 20 })], p, {});   // 丧尸更快，先出手
      b.player.guard = guard;
      const before = p.hp;
      advance(b, p, 1);
      return before - p.hp;
    };
    expect(taken(0.55)).toBeLessThan(taken(0));
  });
  it('防御架势确实按倍率减伤（30 回合均值）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const measure = (guard: number) => {
      let taken = 0; const rounds = 30;
      for (let i = 0; i < rounds; i++) {
        const p = mkPlayer();
        const b = createBattle([mkFoe({ spd: 9, atk: 20 })], p, {});
        b.player.guard = guard;
        const before = p.hp;
        advance(b, p, 1);
        taken += before - p.hp;
      }
      return taken / rounds;
    };
    const plain = measure(0), guarded = measure(0.55);
    expect(plain).toBeGreaterThan(0);
    expect(guarded).toBeLessThan(plain * 0.6);
  });

  it('眩晕会让丧尸跳过回合', () => {
    const p = mkPlayer();
    const foe = mkFoe({ spd: 9, atk: 20 });
    foe.statuses.push({ kind: 'stun', turns: 2, power: 0 });
    const b = createBattle([foe], p, {});
    const hp0 = p.hp;
    advance(b, p, 1);
    expect(p.hp).toBe(hp0);                          // 被眩晕 → 没打到人
  });

  it('全部清空即胜利；玩家掉到 0 即失败', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const p = mkPlayer({ weaponId: 'machete', weaponDmg: 60 });
    const b = createBattle([mkFoe({ hp: 10 })], p, {});
    let guard = 0;
    while (!b.over && guard++ < 40) {
      if (advance(b, p, 10)) playerAct(b, p, 'smash', 0);
      else break;
    }
    expect(b.over).toBe('win');

    vi.restoreAllMocks();
    const p2 = mkPlayer({ hp: 5, hpMax: 5 });
    const b2 = createBattle([mkFoe({ spd: 9, atk: 50 })], p2, {});
    b2.player.guard = 0;
    advance(b2, p2, 1);
    expect(b2.over).toBe('lose');
  });

  it('状态异常按回合扣血（燃烧/流血）', () => {
    const p = mkPlayer();
    const foe = mkFoe({ hp: 100, hpMax: 100 });
    foe.statuses.push({ kind: 'burn', turns: 2, power: 8 });
    const b = createBattle([foe], p, {});
    alive: {
      let guard = 0;
      while (!b.over && guard++ < 10) { if (!advance(b, p, 10)) break; playerAct(b, p, 'swing', 0); }
    }
    expect(b.foes[0].hp).toBeLessThanOrEqual(100 - 16);   // 至少吃了两次燃烧
  });

  it('烟雾弹必定脱离；逃跑是概率判定且有下限', () => {
    const p = mkPlayer({ inventory: { smoke: 1 }, speed: 0 });
    const b = createBattle([mkFoe()], p, {});
    advance(b, p, 10);
    playerAct(b, p, 'smoke', 0);
    expect(b.over).toBe('flee');
    const b2 = createBattle([mkFoe({ spd: 3 })], p, { noFlee: true });
    expect(tryFlee(b2, p)).toBe(false);
  });
});

/* ── M11 新敌人机制：自爆 / 孵化 / 远程腐蚀 / 狂暴 ── */
describe('M11 特殊机制', () => {
  it('自爆者：被近战打死会炸（玩家掉血）', () => {
    const p = mkPlayer({ weaponDmg: 999 });
    const bomber = mkFoe({ id: 'bomber', name: '自爆者', hp: 5, hpMax: 40, traits: ['volatile'], spd: 0.1 });
    const b = createBattle([bomber], p, {});
    /* 速击有 5% 会 miss，所以循环打到死为止——测试不能靠运气 */
    let guard = 0;
    while (b.foes[0].hp > 0 && guard++ < 10) { if (!advance(b, p, 10)) break; playerAct(b, p, 'swing', 0); }
    expect(b.foes[0].hp).toBe(0);
    expect(p.hp).toBeLessThan(100);
    expect(b.log.map(e => (e as { text?: string }).text ?? '').join(' ')).toContain('炸开');
  });

  it('自爆者：被火焰打死则提前引爆，玩家不掉血', () => {
    const p2 = mkPlayer({ inventory: { molotov: 3 }, weaponDmg: 999 });
    const bomber2 = mkFoe({ id: 'bomber', name: '自爆者', hp: 5, hpMax: 40, traits: ['volatile'], spd: 0.1 });
    const b2 = createBattle([bomber2], p2, {});
    let g2 = 0;
    while (b2.foes[0].hp > 0 && g2++ < 5) { if (!advance(b2, p2, 10)) break; playerAct(b2, p2, 'molotov', 0); }   // fire → 不炸
    expect(b2.foes[0].hp).toBe(0);
    expect(p2.hp).toBe(100);
    expect(b2.log.map(e => (e as { text?: string }).text ?? '').join(' ')).toContain('没来得及炸');
  });

  it('自爆者：被持续伤害耗死也不会炸', () => {
    /* sta:0 → 战术槽是"架势"（0 伤害），玩家全程不出手，只让燃烧把它烧死 */
    /* 不经过玩家回合，直接推状态结算——这条要验的是"faint 没拿到 killerType 就不炸"，
       混进玩家行动会引入随机（暴击/命中）导致偶发失败（这个测试第一版就偶发红过） */
    const p = mkPlayer();
    const bomber = mkFoe({ id: 'bomber', name: '自爆者', hp: 12, hpMax: 40, traits: ['volatile'], spd: 0.1 });
    const b = createBattle([bomber], p, {});
    bomber.statuses.push({ kind: 'burn', turns: 5, power: 10 });
    tickStatuses(b, p);
    tickStatuses(b, p);
    expect(b.foes[0].hp).toBe(0);
    expect(p.hp).toBe(100);
    expect(b.log.map(e => (e as { text?: string }).text ?? '').join(' ')).not.toContain('炸开');
  });

  it('孵化者：每两回合产出一只爬行者，且不超过 2 只', () => {
    const p = mkPlayer({ hp: 999, hpMax: 999 });
    const mom = mkFoe({ id: 'hatcher', name: '孵化者', hp: 400, hpMax: 400, atk: 1, traits: ['spawn'], spd: 0.1 });
    const b = createBattle([mom], p, {});
    let guard = 0;
    while (!b.over && b.round <= 8 && guard++ < 60) { if (!advance(b, p, 1)) break; playerAct(b, p, 'guard', 0); }
    const babies = b.foes.filter(f => f.traits?.includes('spawned'));
    expect(babies.length).toBe(2);
    expect(babies[0].name).toContain('爬行者');
    expect(b.log.map(e => (e as { text?: string }).text ?? '').join(' ')).toContain('钻了出来');
  });

  it('喷吐者：护甲被腐蚀后，同样一击挨得更疼', () => {
    /* 单次伤害有 ±8% 随机浮动，而"护甲 6 → 视为 4"只差约 17%，单样本会偶发反超
       （这个测试第一版就是这么偶发红的）。所以取 30 次的均值来比。 */
    const mk = () => mkFoe({ id: 'spitter', name: '喷吐者', hp: 500, hpMax: 500, atk: 20, traits: ['ranged'], spd: 3 });
    const sample = (corroded: boolean): number => {
      let sum = 0;
      for (let i = 0; i < 30; i++) {
        const p = mkPlayer({ hp: 500, hpMax: 500, armor: 6, dodge: 0 });
        const b = createBattle([mk()], p, {});
        if (corroded) b.player.statuses.push({ kind: 'corrode', turns: 3, power: 0 });
        b.player.guard = 0;
        advance(b, p, 1);
        sum += 500 - p.hp;
      }
      return sum / 30;
    };
    const clean = sample(false);
    const corroded = sample(true);
    expect(clean).toBeGreaterThan(0);
    expect(corroded).toBeGreaterThan(clean);
  });

  it('喷吐者的酸液无视格挡', () => {
    const p = mkPlayer({ hp: 500, hpMax: 500, armor: 0, dodge: 0 });
    const b = createBattle([mkFoe({ id: 'spitter', name: '喷吐者', hp: 500, hpMax: 500, atk: 20, traits: ['ranged'], spd: 3 })], p, {});
    b.player.guard = 0.9;
    advance(b, p, 1);
    expect(500 - p.hp).toBeGreaterThan(10);
  });

  it('暴君：半血后狂暴，且只触发一次', () => {
    const p = mkPlayer({ hp: 999, hpMax: 999 });
    const tyrant = mkFoe({ id: 'tyrant', name: '暴君', hp: 100, hpMax: 100, atk: 10, traits: ['enrage'], spd: 0.1 });
    const b = createBattle([tyrant], p, {});
    const atk0 = b.foes[0].atk;
    b.foes[0].hp = 40;
    foeTurn(b, p, 0);              // 直接走它的回合（玩家速度更高时 advance 会停在等玩家）
    const atk1 = b.foes[0].atk;
    expect(atk1).toBeGreaterThan(atk0);
    foeTurn(b, p, 0);
    expect(b.foes[0].atk).toBe(atk1);
    expect(b.log.map(e => (e as { text?: string }).text ?? '').join(' ')).toContain('疯了');
  });
});

/* ── 内容表一致性：POI 里写的敌人必须真的存在（防手滑写错 id） ── */
describe('内容表一致性', () => {
  it('每个 POI 的敌人 id 都在丧尸表里，且都有属性映射', () => {
    const missing: string[] = [];
    for (const [poiId, poi] of Object.entries(POIS)) {
      for (const e of poi.enemies) {
        if (!ZOMBIES[e]) missing.push(`${poiId} → 丧尸表缺 ${e}`);
        if (!FOE_TYPES[e]) missing.push(`${poiId} → 属性表缺 ${e}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('M11 新敌人四处都登记了（表 / 属性 / 机制 / 掉落）', () => {
    for (const id of ['spitter', 'bomber', 'hatcher', 'tyrant']) {
      expect(ZOMBIES[id], id).toBeTruthy();
      expect(FOE_TYPES[id], id).toBeTruthy();
      expect(FOE_TRAITS[id], id).toBeTruthy();
      expect(ZOMBIES[id].n.length).toBeGreaterThan(1);
      expect(Object.keys(ZOMBIES[id].loot).length).toBeGreaterThan(0);
    }
    expect(FOE_TRAITS.spitter).toContain('ranged');
    expect(FOE_TRAITS.bomber).toContain('volatile');
    expect(FOE_TRAITS.hatcher).toContain('spawn');
    expect(FOE_TRAITS.tyrant).toContain('enrage');
  });
});
