/* M64：审计里发现的那几个 bug 的回归钉子（纯逻辑部分）
   ① 命中惩罚真的进战斗（accPenalty 减在 m.acc 上）—— 以前 statMods().hit 写了没人读
   ② 干净胜利的口径字段（b.stats.clean 开局为真、挨打才变假）—— bridge 的 onEnd 靠它记 cleanWins */
import { describe, expect, it } from 'vitest';
import { createBattle, foeTurn, movesFor, playerAct, type PlayerProfile } from '../src/v4/combat';
import type { Foe } from '../src/types';

/** 造一只"打不死的靶子"（att:0 → 永远不会把我们打掉线，方便测命中率）
    注意：这里**不能** import bridge 的 toFoe —— bridge 会 import ../main，而 legacy 底座要 window，
    纯逻辑单测里没有 DOM。 */
const foe = (over: Partial<Foe> = {}): Foe => ({
  id: 'walker', name: '普通丧尸', hp: 9999, hpMax: 9999, atk: 0, def: 0, spd: 1,
  types: ['flesh'], moves: [], statuses: [], traits: [], loot: {}, xp: 1, ...over,
});

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  hp: 100, hpMax: 100, sta: 100, staMax: 100, ammo: 0,
  weaponId: 'crowbar', weaponName: '撬棍', weaponDmg: 8, isGun: false,
  critBonus: 0, dmgMult: 1, dodge: 0, armor: 0, speed: 3, inventory: {},
  ...over,
});

/** 打 N 次（每次新开一场 + 新档案，避免体力耗尽导致后面全打不动），返回命中的次数。
    招式的 id 必须从 movesFor 取（撬棍的第一招是 swing，不是 'strike' —— 写错 id 会被引擎直接拒掉） */
const hits = (n: number, over: Partial<PlayerProfile> = {}) => {
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const p = profile(over);
    const foe1 = foe();
    const b = createBattle([foe1], p, {});
    playerAct(b, p, movesFor(p)[0].id, 0);
    if (foe1.hp < 9999) hit++;
  }
  return hit;
};

describe('M64 命中惩罚（辐射病/部位伤）真的生效', () => {
  it('accPenalty 直接减在命中上：惩罚 0.45 时命中率掉到 ~50%（不惩罚时 ~95%）', () => {
    const clean = hits(200);
    const sick = hits(200, { accPenalty: 0.45 });
    expect(clean).toBeGreaterThan(170);                       // 95% 命中：200 次里 ≥170
    expect(sick).toBeLessThan(clean - 30);                    // 明显更差
    expect(Math.abs(sick / 200 - 0.5)).toBeLessThan(0.15);    // 落在 50% ± 15%（4σ）
  });

  it('惩罚再大也不会把命中率压到 0（保底 5%）', () => {
    const worst = hits(200, { accPenalty: 5 });
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(60);                           // ~5%
  });

  it('不传 accPenalty 时与老口径完全一致（默认 0）', () => {
    const a = hits(120);
    const b = hits(120, { accPenalty: 0 });
    expect(Math.abs(a - b)).toBeLessThan(30);
  });
});

describe('M64 干净胜利的口径字段', () => {
  it('开局 clean=true（onEnd 用它记 cleanWins；挨打才会变假）', () => {
    const b = createBattle([foe()], profile(), {});
    expect(b.stats.clean).toBe(true);
  });

  it('挨打之后 clean 变 false（这一场就不算"不受伤害赢下"）', () => {
    const p = profile({ hp: 100, dodge: 0 });
    const f = foe({ id: 'brute', name: '重型丧尸', atk: 30, types: ['hulk'] });
    const b = createBattle([f], p, {});
    foeTurn(b, p, 0);                                          // 直接让敌人行动一次（确定性：不赌 AI 顺序）
    expect(p.hp).toBeLessThan(100);                             // 挨了打
    expect(b.stats.clean).toBe(false);
  });
});
