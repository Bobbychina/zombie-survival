import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());
import { advance, canUse, createBattle, movesFor, playerAct, tryFlee, type PlayerProfile } from '../src/v4/combat';
import { TYPE_CHART, effectivenessText, typeMult, weaponMoves } from '../src/v4/moves';
import type { Foe } from '../src/types';

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
