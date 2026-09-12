/* 招式表 + 属性克制（宝可梦式）：4 个招式槽、速度决定出手、克制倍率给"效果拔群"的爽感 */
import type { DamageType, FoeType, Move } from '../types';

export const TYPE_NAME: Record<DamageType, string> = {
  blunt:'打击', slash:'斩击', bullet:'枪弹', fire:'火焰', blast:'爆炸', toxic:'毒素', shock:'电击',
};
export const FOE_TYPE_NAME: Record<FoeType, string> = {
  flesh:'皮肉', bone:'骨骼', armor:'装甲', toxic:'毒囊', swift:'迅捷', hulk:'巨躯',
};
export const FOE_TYPE_ICON: Record<FoeType, string> = {
  flesh:'🩸', bone:'🦴', armor:'🛡️', toxic:'☣️', swift:'💨', hulk:'🐘',
};

/** 攻方属性 → 守方属性 的倍率 */
export const TYPE_CHART: Record<DamageType, Record<FoeType, number>> = {
  blunt:  { flesh:1,   bone:0.5, armor:1.5, toxic:1,   swift:1,   hulk:1.5 },
  slash:  { flesh:2,   bone:1,   armor:0.5, toxic:1.5, swift:1.5, hulk:1   },
  bullet: { flesh:1.5, bone:1,   armor:0.5, toxic:1,   swift:1.5, hulk:1   },
  fire:   { flesh:1,   bone:1,   armor:1,   toxic:2,   swift:1,   hulk:1   },
  blast:  { flesh:1.5, bone:1.5, armor:1.5, toxic:1.5, swift:1,   hulk:2   },
  toxic:  { flesh:0.5, bone:1,   armor:0.5, toxic:0.5, swift:1,   hulk:1   },
  shock:  { flesh:1,   bone:1,   armor:2,   toxic:1,   swift:1.5, hulk:0.5 },
};

export function typeMult(t: DamageType, types: FoeType[]): number {
  return types.reduce((m, ft) => m * (TYPE_CHART[t]?.[ft] ?? 1), 1);
}

/** 武器 → 招式组。damage 是武器基础伤害，这里换算成招式威力。 */
export function weaponMoves(weaponId: string, dmg: number, isGun: boolean, tags: { apen?: boolean; spread?: boolean }): Move[] {
  const P = Math.max(4, Math.round(dmg));
  if (isGun) {
    const out: Move[] = [
      { id:'shot',   name:'点射',   type:'bullet', power:P,        acc:.92, crit:.15, cost:{ ammo:1 }, target:'one', priority:1, desc:'稳定的一发，出手更快。' },
      { id:'burst',  name:'连发',   type:'bullet', power:Math.round(P*1.7), acc:.78, crit:.2, cost:{ ammo:2 }, target:'one', desc:'两发压上去，威力大但容易打飘。' },
      { id:'suppress', name:'压制射击', type:'bullet', power:Math.round(P*0.5), acc:.85, crit:.1, cost:{ ammo:2 }, target:'one', status:'weak', statusChance:1, desc:'打得它抬不起头：目标伤害 -25%（2 回合）。' },
    ];
    if (tags.spread) out[2] = { id:'spread', name:'散射', type:'bullet', power:Math.round(P*0.8), acc:.8, crit:.08, cost:{ ammo:3 }, target:'all', desc:'一次打向所有敌人。' };
    return out;
  }
  const out: Move[] = [
    { id:'swing', name:'速击', type:'blunt', power:Math.round(P*0.75), acc:.95, crit:.12, cost:{ sta:6 }, target:'one', priority:1, desc:'快而轻，抢在它前面。' },
    { id:'smash', name:'重击', type:'blunt', power:Math.round(P*1.6), acc:.78, crit:.18, cost:{ sta:14 }, target:'one', desc:'抡圆了砸下去，破甲最好用。' },
  ];
  if (tags.apen) out[1] = { id:'smash', name:'破甲劈砍', type:'blunt', power:Math.round(P*1.5), acc:.8, crit:.15, cost:{ sta:15 }, target:'one', desc:'专挑关节与护甲缝下手。' };
  out.push({ id:'sweep', name:'横扫', type:'blunt', power:Math.round(P*0.6), acc:.82, crit:.1, cost:{ sta:12 }, target:'all', desc:'一圈扫过去，打所有敌人。' });
  return out;
}

/** 通用战术与物品招式 */
export const TACTIC_MOVES: Move[] = [
  { id:'guard',  name:'架势', type:'blunt', power:0, acc:1, crit:0, cost:{}, target:'self', priority:2, self:{ guard:.55, sta:14 }, desc:'减伤 55% 并回 14 体力。' },
  { id:'focus',  name:'专注', type:'blunt', power:0, acc:1, crit:0, cost:{}, target:'self', priority:2, self:{ critUp:1 }, desc:'下一次攻击必定暴击。' },
  { id:'lunge',  name:'突进', type:'blunt', power:6, acc:.9, crit:.1, cost:{ sta:8 }, target:'one', priority:3, desc:'抢一步先手，打断它的动作（眩晕 1 回合）。', status:'stun', statusChance:.45 },
];
export const ITEM_MOVES: Move[] = [
  { id:'bandage', name:'包扎', type:'blunt', power:0, acc:1, crit:0, cost:{ item:'bandage' }, target:'self', priority:2, desc:'回 15 血并止血。', require:{ item:'bandage' } },
  { id:'medkit',  name:'急救', type:'blunt', power:0, acc:1, crit:0, cost:{ item:'medkit' }, target:'self', priority:2, desc:'回 50 血并止血。', require:{ item:'medkit' } },
  { id:'molotov', name:'燃烧瓶', type:'fire', power:48, acc:.9, crit:.05, cost:{ item:'molotov' }, target:'all', desc:'全体火焰伤害，并点燃（每回合掉血）。', status:'burn', statusChance:1, require:{ item:'molotov' } },
  { id:'grenade', name:'手雷',  type:'blast', power:70, acc:.9, crit:.05, cost:{ item:'grenade' }, target:'all', desc:'全体爆炸伤害。', require:{ item:'grenade' } },
  { id:'smoke',   name:'烟雾弹', type:'toxic', power:0, acc:1, crit:0, cost:{ item:'smoke' }, target:'self', priority:3, self:{ acc:-1 }, desc:'必逃：脱离战斗。', require:{ item:'smoke' } },
  { id:'antitoxin', name:'解毒剂', type:'blunt', power:0, acc:1, crit:0, cost:{ item:'antitoxin' }, target:'self', priority:2, desc:'解除中毒。', require:{ item:'antitoxin' } },
];

export const STATUS_NAME: Record<string, { name: string; icon: string; desc: string }> = {
  bleed:  { name:'流血', icon:'🩸', desc:'每回合失去生命' },
  poison: { name:'中毒', icon:'☠️', desc:'每回合失去生命，伤害 -20%' },
  burn:   { name:'燃烧', icon:'🔥', desc:'每回合失去较多生命' },
  stun:   { name:'眩晕', icon:'💫', desc:'跳过它的回合' },
  weak:   { name:'被压制', icon:'⬇️', desc:'造成的伤害 -25%' },
};

export function effectivenessText(m: number): string {
  if (m >= 2) return '效果拔群！';
  if (m > 1) return '有效。';
  if (m <= 0.5) return '效果不佳…';
  return '';
}
