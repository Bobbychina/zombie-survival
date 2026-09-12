/* legacy 底座 ↔ v4 新系统的桥：v4 只通过这里读写存档、拿玩家数值、发奖励。
   目的：新代码不直接摸 window 上那 200 个名字；等 legacy 逐步被替换掉，这里就是唯一需要改的地方。 */
import { L } from '../main';
import type { Foe, FoeType } from '../types';
import type { PlayerProfile } from './combat';

/** 丧尸模板 id → 宝可梦式"属性"（决定克制关系） */
export const FOE_TYPES: Record<string, FoeType[]> = {
  walker: ['flesh'], crawler: ['flesh', 'swift'], runner: ['flesh', 'swift'], hound: ['flesh', 'swift'],
  brute: ['flesh', 'hulk'], poison: ['toxic'], screamer: ['flesh', 'swift'],
  armored: ['armor', 'bone'], giant: ['hulk', 'flesh'], bandit: ['flesh'],
  boss_a: ['armor', 'hulk'], boss_b: ['toxic', 'hulk'],
};

/** 丧尸 id → 招式偏好（威力按它的伤害换算） */
function foeMoves(id: string, atk: number): string[] {
  const heavy = atk >= 14;
  const swift = id === 'runner' || id === 'hound' || id === 'screamer' || id === 'crawler';
  const out = ['claw'];
  if (heavy) out.push('slam');
  if (swift) out.push('pounce');
  if (id === 'poison' || id === 'boss_b') out.push('spit');
  return out;
}

/** legacy 的丧尸（mkFoe 出来的）→ v4 Foe。legacy 用 dmg/spd/t，v4 用 atk/def/types/moves。 */
export function toFoe(src: any): Foe {
  const t = src.t ?? {};
  const affix = src.affix ? String(src.affix) : undefined;
  const id = src.id ?? 'walker';
  const types = (FOE_TYPES[id] ?? ['flesh']).slice();
  if (affix === 'armored' && !types.includes('armor')) types.push('armor');
  if (affix === 'corrupt') types.push('bone');
  return {
    id,
    name: src.n ?? src.name ?? '丧尸',
    hp: src.hp, hpMax: src.hpMax ?? src.hp,
    atk: src.dmg ?? 6,
    def: (t.armGun ? 6 : 0) + (t.armMelee ? 3 : 0) + (src.boss ? 4 : 0),
    spd: src.spd ?? 1,
    types,
    moves: foeMoves(id, src.dmg ?? 6),
    statuses: [],
    elite: !!src.elite,
    affix,
    traits: [],
    loot: t.loot,
    xp: src.xp,
    boss: !!src.boss,
  };
}

/** 从存档拼出引擎需要的玩家档案（伤害/命中/闪避都沿用 legacy 的公式，避免两套数值打架） */
export function playerProfile(): PlayerProfile {
  const S = L.S;
  const wid: string = (S.eq.wpn && L.ITEMS[S.eq.wpn]) ? S.eq.wpn : 'crowbar';
  const w = L.ITEMS[wid];
  const isGun = !!w.ammo;
  const e = L.effDmg(w, isGun);
  const mods = L.statMods();
  const inv: Record<string, number> = {};
  ['bandage', 'medkit', 'molotov', 'grenade', 'smoke', 'antitoxin'].forEach(id => { if (L.itemCount(id) > 0) inv[id] = L.itemCount(id); });
  return {
    hp: S.hp, hpMax: S.hpMax, sta: S.sta, staMax: S.staMax, ammo: S.ammo,
    weaponId: wid, weaponName: w.n, weaponDmg: e.d, isGun,
    apen: !!w.apen, spread: isGun && L.ITEMS[wid].n === '霰弹枪',
    critBonus: Math.max(0, e.crit - (w.crit ?? 0)),
    dmgMult: mods.dmgMul,
    dodge: Math.max(0, Math.min(0.5, (S.eq.feet && L.ITEMS[S.eq.feet]?.dodge ? L.ITEMS[S.eq.feet].dodge : 0) + L.skillBonus('stealth', 0.015, 0.2))),
    armor: L.armorTotal(),
    speed: 2 + S.skills.fitness * 0.3 + S.skills.stealth * 0.2,
    inventory: inv,
  };
}

/** 引擎跑完一轮后把消耗写回存档（体力/弹药/生命/物品） */
export function syncBack(p: PlayerProfile) {
  const S = L.S;
  // X01：生命必须 clamp 到上限（试玩档出现过 186/128：治疗与"每 5 天 +10 上限"叠加后没人收口）
  S.hp = Math.max(0, Math.min(S.hpMax, Math.round(p.hp)));
  S.sta = Math.max(0, Math.min(p.staMax, p.sta));
  S.ammo = Math.max(0, p.ammo);
  ['bandage', 'medkit', 'molotov', 'grenade', 'smoke', 'antitoxin'].forEach(id => {
    const want = p.inventory[id] ?? 0;
    const have = L.itemCount(id);
    if (want < have) L.takeItem(id, have - want);
  });
}

/** 击杀奖励：沿用 legacy 的掉落/经验/门禁卡/统计，再由 UI 层提示 */
export function onFoeFaint(src: any, foe: Foe) {
  const S = L.S;
  S.stats.kills++;
  S.stats.killBy[foe.id] = (S.stats.killBy[foe.id] || 0) + 1;
  if (foe.elite) S.stats.elites++;
  const w = L.ITEMS[S.eq.wpn];
  if (!w || !w.ammo) S.stats.meleeKills++;
  L.log('✅ 击杀 ' + foe.name + '。', 'success');
  if (w && w.ammo) L.addXP('shoot', foe.xp || 4); else L.addXP('melee', foe.xp || 4);
  const t = src?.t ?? {};
  const got: string[] = [];
  if (t.loot) for (const id in t.loot) {
    if (Math.random() < (t.loot as any)[id] * (1 + L.skillBonus('survival', .08, .5))) { L.grant(id, 1, true); got.push(L.itemName(id)); }
  }
  if (t.keycard && Math.random() < t.keycard && S.quest.keycards < 3) { S.quest.keycards++; got.push('门禁卡碎片(' + S.quest.keycards + '/3)'); L.checkQuest(); }
  const mats = L.ri(2, 4) + Math.floor(S.day / 6) + (foe.elite ? 10 : 0);
  S.mat += mats;
  got.push('材料 ×' + mats);
  if (t.burst) { const bd = L.ri(8, 14); S.hp -= bd; L.log('💥 它炸开了，冲击波把你掀翻（-' + bd + ' 生命）。', 'combat'); }
  L.log('📦 战利品：' + got.join('、'), 'loot');
  L.bountyTick(); L.sideTick();
}

/** 玩家挨打：流血/骨折/咬伤感染，沿用 legacy 的伤口与感染系统 */
export function onPlayerHit(dmg: number, foe: Foe) {
  const S = L.S;
  const hazmat = S.eq.body === 'hazmat';
  if (Math.random() < (hazmat ? .08 : .16)) L.addWound('bleed', 1);
  if (dmg >= 12 && Math.random() < .10) L.addWound('fracture', 1);
  if (foe.types.includes('toxic') && S.eq.mask !== 'gasmask' && Math.random() < .3) {
    let inc = Math.round(L.rnd(10, 17) * (1 - L.skillBonus('medic', .05, .5)));
    if (hazmat) inc = Math.max(1, Math.round(inc * .75));
    S.infect = Math.min(100, S.infect + inc);
    L.log('🦠 你被咬伤，感染 +' + inc + '%。', 'danger');
  }
  L.sfx('hurt');
}

export function onEnd(result: 'win' | 'lose' | 'flee') {
  const S = L.S;
  if (result === 'lose') { L.gameOver('你在战斗里流干了最后一滴血。'); return; }
  if (result === 'win') { L.checkQuest(); L.checkAch(); }
  L.autosave();
  L.render();
}
