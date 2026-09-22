/* M54：据点系统的**纯逻辑**（用户：「全面革新据点系统，现在还是太何意味了」）。
 *
 *  革新的核心不是加新建筑，而是把"据点到底在干什么"变成看得见的数字与决策：
 *    ① 今夜的处境：尸潮概率（血月/尸群必打）、防线上限与当前血量、守得住吗的判词、弃守的代价；
 *    ② 明天的收成：每个设施每天真给多少（净水/蔬菜/鱼），以及断电时要烧什么；
 *    ③ 该建什么：按"当下局势 + 手上材料"排出前三名并给理由（不让玩家对着 15 张一样的卡发呆）；
 *    ④ 设施分区：守夜 / 产线 / 工坊 / 基建 —— 每张卡写清楚"升级后会多出什么"。
 *
 *  这里的算式原先散在 legacy（nightTick 的尸潮概率、弃守分支的损失、defMax、scaledCost），
 *  现在统一成一份真值：legacy 与它自己的探针都读这里，改数值只改这一个文件。
 */
import { pondYield, POND_FEED_ITEMS } from './water-core';
import type { Season, WeatherId } from './env-core';

/** 设施分区：keys 必须与 legacy BASE_UP 的键一一对应（单测钉住） */
export const BASE_SECTIONS: { id: string; name: string; icon: string; keys: string[] }[] = [
  { id: 'watch', name: '守夜', icon: '🌙', keys: ['door', 'wall', 'bed'] },
  { id: 'produce', name: '产线', icon: '🌾', keys: ['filter', 'garden', 'pond', 'storage'] },
  { id: 'workshop', name: '工坊', icon: '🛠️', keys: ['bench', 'loading', 'medlab', 'kitchen'] },
  { id: 'infra', name: '基建', icon: '🔌', keys: ['power', 'radio'] },
];

/** 建造/升级价：基础价 × (1 + 当前等级 × **0.35**)，向上取整。
 *  M70 把系数从 0.6 降到 0.35 —— 审计发现满级全设施的建材要 ≈2170 AP（按当时产出率），
 *  而一局 100 天总共才 1400 AP：**通关都建不出几个**（用户原话）。
 *  第三级因此从 2.2 倍降到 1.7 倍；再配合回收台（材料→建材）与更便宜的发电机/无线电。 */
export function scaledCost(base: Record<string, number>, lv: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c in base) out[c] = Math.ceil(base[c] * (1 + lv * 0.35));
  return out;
}

/** 防线上限：门窗 24 + 每级 26，围墙 每级 46（老规则，别改） */
export function defMaxOf(doorLv: number, wallLv: number): { door: number; wall: number } {
  return { door: 24 + Math.max(0, doorLv) * 26, wall: Math.max(0, wallLv) * 46 };
}

/** 今夜尸潮概率（0.16 起，每晚 +0.011，噪音每点 +0.03，封顶 60%） */
export function raidChance(day: number, noise: number, cap = 0.6): number {
  return Math.min(cap, 0.16 + Math.max(0, day) * 0.011 + Math.max(0, noise) * 0.03);
}

/** 血月 / 尸群到点 → 今晚必打（与 nightTick 的判定同源） */
export function raidGuaranteed(day: number, hordeEta: number): boolean {
  return day % 7 === 0 || (hordeEta > 0 && hordeEta - 1 <= 0);
}

/** 弃守据点的代价（与 legacy 弃守分支一字不差：守卫系数 → 伤害 → 掉血/掉料） */
export function abandonCost(o: { day: number; doorLv: number; wallLv: number; blood: boolean; mat: number }): { hpLoss: number; matLoss: number; power: number } {
  const guard = 1 - Math.max(0, o.doorLv) * 0.25 - Math.max(0, o.wallLv) * 0.15;
  const power = Math.round((10 + o.day * 1.6) * Math.max(0.25, guard) * (o.blood ? 1.6 : 1));
  const hasWall = o.wallLv > 0;
  const hpLoss = Math.max(2, Math.round(power * (hasWall ? 0.5 : 1) * 0.5));
  const matLoss = Math.min(Math.max(0, o.mat), Math.round(power * 0.6 * (hasWall ? 0.4 : 1)));
  return { hpLoss, matLoss, power };
}

/** 净水装置每晚产出（断电时要烧 1 汽油；发电机自供电不看电网脸色） */
export function waterYield(o: { filterLv: number; powerLv: number; gridOff: boolean; hasFuel: boolean }): { n: number; note: string } {
  if (o.filterLv <= 0) return { n: 0, note: '还没建净水装置' };
  const n = o.filterLv + (o.powerLv > 0 ? 1 : 0);
  if (o.powerLv > 0) return { n, note: '发电机供电 +1' };
  if (!o.gridOff) return { n, note: '' };
  if (o.hasFuel) return { n, note: '电网已断：每晚烧 1 汽油' };
  return { n: 0, note: '电网已断且没汽油：今天没有净水' };
}

/** 明天的收成：净水 / 蔬菜 / 鱼（各带一句"为什么是这个数"） */
export function nightlyYield(o: {
  base: Record<string, number>;
  gridOff: boolean;
  hasFuel: boolean;
  season: Season;
  weather: WeatherId;
  /** 鱼塘会不会被投喂（背包里有 鱼饵/蔬菜/麦子 就算） */
  pondFed: boolean;
  /** 蔬菜保鲜基数（ITEMS.veg.fresh），发电机在转时 +1 天 */
  vegFreshBase: number;
}): { water: number; waterNote: string; veg: number; vegSpoilDays: number; fish: number; fishNote: string } {
  const filterLv = o.base.filter || 0, gardenLv = o.base.garden || 0, pondLv = o.base.pond || 0, powerLv = o.base.power || 0;
  const w = waterYield({ filterLv, powerLv, gridOff: o.gridOff, hasFuel: o.hasFuel });
  const fish = Math.floor(pondYield(pondLv, o.season, o.weather, o.pondFed));
  return {
    water: w.n,
    waterNote: w.note,
    veg: gardenLv,
    vegSpoilDays: o.vegFreshBase + (powerLv > 0 ? 1 : 0),
    fish,
    fishNote: pondLv <= 0 ? '还没建鱼塘'
      : pondYield(pondLv, o.season, o.weather, false) <= 0 ? '这个季节/天气不产鱼'
        : o.pondFed ? '已投喂（翻倍）' : '没投喂：只有基础产量（背包里放 ' + POND_FEED_ITEMS.map(x => x).join('/') + ' 会自动投喂）',
  };
}

/** 陷阱容量：警报器只能 1 个，其余各 9 个 */
export const trapCap = (key: string): number => (key === 'alarm' ? 1 : 9);

/** 守夜判词：防线 + 陷阱 → 稳 / 悬 / 危险，并给一句该干什么 */
export function verdictOf(o: {
  doorHp: number; wallHp: number; doorMax: number; wallMax: number;
  traps: Record<string, number>; tonightRaid: boolean; bloodMoon: boolean; hordeEta: number;
}): { tier: 'safe' | 'risky' | 'danger'; label: string; hint: string; ready: number } {
  const doorPct = o.doorMax > 0 ? Math.min(1, o.doorHp / o.doorMax) : 0;
  const wallPct = o.wallMax > 0 ? Math.min(1, o.wallHp / o.wallMax) : 0;
  const trapTotal = Object.keys(o.traps).reduce((a, k) => a + (o.traps[k] || 0), 0);
  const ready = Math.max(0, Math.min(1, 0.5 * doorPct + 0.3 * wallPct + 0.2 * Math.min(1, trapTotal / 6)));
  const tier = ready >= 0.75 ? 'safe' : ready >= 0.45 ? 'risky' : 'danger';
  const label = tier === 'safe' ? '稳' : tier === 'risky' ? '悬' : '危险';
  const bits: string[] = [];
  if (doorPct < 0.9) bits.push('门窗 ' + Math.round(o.doorHp) + '/' + o.doorMax + '：点「抢修防线」补满（1 AP + 铁片2/木料2）');
  if ((o.wallMax || 0) <= 0) bits.push('还没围墙：建围墙工事（尸潮先砸门、再砸墙，墙在就少掉一半血和物资）');
  else if (wallPct < 0.9) bits.push('围墙 ' + Math.round(o.wallHp) + '/' + o.wallMax + '：抢修能同时补门与墙');
  if (trapTotal < 3) bits.push('陷阱只有 ' + trapTotal + ' 个：钉刺/燃烧/警报都是开场就结算的"提前准备的回报"');
  if (o.bloodMoon) bits.push('今晚是血月：规模 ×1.9，别裸着睡');
  else if (o.hordeEta > 0 && o.hordeEta <= 2) bits.push('尸群 ' + o.hordeEta + ' 天后到：这两天必须把防线补齐');
  if (!bits.length) bits.push('防线完好、陷阱也够：今晚可以安心睡，把行动力留给白天');
  return { tier, label, hint: bits.slice(0, 2).join('；'), ready };
}

/** 材料还差多少（建造按钮禁用时要写清楚差什么，而不是灰着不说话） */
export function missingFor(cost: Record<string, number>, stock: Record<string, number>): { mat: string; need: number; have: number; short: number }[] {
  return Object.keys(cost).map(m => ({ mat: m, need: cost[m], have: stock[m] || 0, short: Math.max(0, cost[m] - (stock[m] || 0)) })).filter(x => x.short > 0);
}

export interface AdviceInput {
  base: Record<string, number>;
  /** 手上有多少材料（只用于"现在就能建"与理由里的数字） */
  stock: Record<string, number>;
  table: Record<string, { max: number; cost: Record<string, number>; n: string }>;
  day: number;
  ap: number;
  hordeEta: number;
  bloodMoonToday: boolean;
  /** 手里有几种材料够建（调用方算好：避免这里依赖 itemCount） */
  buildable?: (key: string) => boolean;
}

/** 「该建什么」：按当下局势排前三，并给一句带数字的理由。
 *  排序规则（可解释，别藏玄机）：先"马上要用的"（今夜/明晚的防御），再"每天产出"的，最后"长期解锁"的。 */
export function adviseBuilds(inp: AdviceInput): { key: string; why: string; urgent: boolean }[] {
  const lv = (k: string) => inp.base[k] || 0;
  const maxed = (k: string) => { const t = inp.table[k]; return !t || lv(k) >= t.max; };
  const can = (k: string) => (inp.buildable ? inp.buildable(k) : true);
  const raidSoon = inp.bloodMoonToday || (inp.hordeEta > 0 && inp.hordeEta <= 2);
  const out: { key: string; why: string; urgent: boolean; w: number }[] = [];
  const add = (key: string, why: string, w: number, urgent = false) => { if (!maxed(key)) out.push({ key, why, urgent, w }); };

  /* ① 今晚就要挨打：防御优先 */
  if (raidSoon) {
    add('door', '今晚就要打：门窗每级 +26 上限、尸潮伤害 -25%（现在 Lv.' + lv('door') + '）', 100, true);
    if (lv('wall') <= 0) add('wall', '还没有围墙：它让弃守损失减半，有墙时尸潮也更难砸穿', 95, true);
    else add('wall', '围墙 Lv.' + lv('wall') + '：每级 +46 上限，尸潮先砸门再砸墙', 80, true);
  } else {
    if (lv('door') <= 0) add('door', '门窗是尸潮的第一道门槛：每级 +26 上限、伤害 -25%', 60);
  }
  /* ② 每天在产的东西（没建 = 每天白丢） */
  if (lv('filter') <= 0) add('filter', '净水装置：每天 ' + (lv('power') > 0 ? 2 : 1) + ' 份净水，缺水会掉水分与体力', 85);
  else if (lv('garden') <= 0) add('garden', '屋顶菜园：每天收新鲜蔬菜（材料便宜，第 3~5 天就该立起来）', 78);
  else if (lv('filter') < 2) add('filter', '净水 Lv.' + lv('filter') + ' → Lv.' + (lv('filter') + 1) + '：每天多 1 份水', 55);
  /* ③ 工坊：解锁制作 = 唯一能变强的途径 */
  if (lv('bench') <= 0) add('bench', '工作台：解锁绷带/胶带/燃烧瓶这些基础配方，没有它制作页是空的', 82);
  if (lv('power') <= 0 && (lv('filter') >= 2 || lv('garden') >= 2)) add('power', '发电机：净水 +1、菜园保鲜 +1 天、医疗台 +1 份 —— 产线升级的中枢', 70);
  if (lv('radio') <= 0 && inp.day >= 5) add('radio', '无线电：解锁方舟实验室坐标与更多商人来访（主线第 4 阶段要）', 50);
  if (lv('bed') <= 0 && inp.day >= 4) add('bed', '行军床：每级睡眠恢复 +9 生命，受伤的日子里很值', 45);
  if (lv('storage') <= 0 && inp.day >= 3) add('storage', '储物箱：每级 12 格，把不背的东西留在家里', 40);
  if (lv('pond') <= 0 && lv('garden') >= 2) add('pond', '鱼塘：每天产鱼（投喂翻倍、冬天减产），食物第二条腿', 38);

  out.sort((a, b) => b.w - a.w || a.key.localeCompare(b.key));
  const top = out.slice(0, 3).map(o => ({ key: o.key, why: o.why, urgent: o.urgent }));
  if (!top.length) return [{ key: '', why: '设施全满级了 —— 把材料花在弹药台/医疗台的配方与陷阱上。', urgent: false }];
  return top.map(o => (can(o.key) ? o : { ...o, why: o.why + '（材料还差一点）' }));
}

/** 升级后会多出什么（设施卡上的"→"那半句） */
export function facilityDelta(key: string, nextLv: number, ctx: { powerLv: number }): string {
  const powered = ctx.powerLv > 0;
  switch (key) {
    case 'door': return '上限 +26（尸潮伤害再 -25%）';
    case 'wall': return '上限 +46（弃守损失减半）';
    case 'bed': return '睡眠恢复 +9 生命';
    case 'filter': return '每天多 1 份净水' + (powered ? '（发电机再 +1）' : '');
    case 'garden': return '每天多 1 份蔬菜' + (powered ? '（保鲜 +1 天）' : '');
    case 'pond': return '每天多约 ' + (nextLv === 3 ? '0.8' : '0.6') + ' 条鱼（投喂翻倍）';
    case 'storage': return '储物格 +12';
    case 'bench': return '解锁下一档工作台配方';
    case 'loading': return '解锁下一档弹药配方（穿甲/独头弹）';
    case 'medlab': return '解锁下一档药品配方' + (powered ? '（发电机 +1 份）' : '');
    case 'kitchen': return '解锁下一档熟食配方（回得更多、更抗腐坏）';
    case 'power': return '净水 +1 · 菜园保鲜 +1 天 · 医疗台 +1 份';
    case 'radio': return '解锁方舟实验室坐标与更多商人';
    default: return '效果提升';
  }
}
