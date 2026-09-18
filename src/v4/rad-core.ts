/* M25 辐射（纯逻辑，可单测）：
   核电站与废料填埋场周边有辐射场，越靠近越强（0~3 级）。站在里面会累积体内辐射，
   累积到阈值后开始掉血、压体力上限、影响治疗——碘片/抗辐射药能把数值压回去。

   为什么做成"场"而不是"格子上一个布尔值"：POI 是种子生成的，位置每局不同；
   用"到辐射源的距离"算强度，玩家在地图上就能看出"越靠近越危险"，也方便以后加更多辐射源。
*/
export interface RadSource { x: number; y: number; kind: string }

/** 辐射源定义：半径按切比雪夫距离（与地图移动一格=1 的直觉一致） */
export const RAD_SOURCES: Record<string, { n: string; radius: number }> = {
  nuclear: { n: '核电站', radius: 3 },
  waste: { n: '废料填埋场', radius: 2 },
};

/** 某个坐标的辐射等级 0~3（0 = 干净）。
    梯度：中心 = min(3, radius)，每远离一格降一级，超出 radius 归零 —— 
    "贴着边缘绕着走"是有意义的操作，而不是一脚踩进 3 级。 */
export function radLevelAt(sources: RadSource[], x: number, y: number): number {
  let lv = 0;
  for (const s of sources) {
    const def = RAD_SOURCES[s.kind];
    if (!def) continue;
    const dist = Math.max(Math.abs(s.x - x), Math.abs(s.y - y));
    if (dist > def.radius) continue;
    lv = Math.max(lv, Math.min(3, def.radius - dist));
  }
  return lv;
}

/** 站在这一格、走这么远，体内辐射涨多少（护具减免后） */
export function radGain(level: number, steps: number, protect = 0): number {
  if (level <= 0) return 0;
  const base = level * 2 * Math.max(1, steps);
  return Math.max(1, Math.round(base * (1 - Math.max(0, Math.min(0.85, protect)))));
}

/** 防护：防化服 60% / 防毒面具 25% / 潜水服 10%，叠加但有上限 85% */
export function radProtect(gear: { radProt?: number }[]): number {
  let p = 0;
  for (const g of gear) if (g && g.radProt) p += g.radProt;
  return Math.min(0.85, p);
}

export interface RadTier { tier: number; label: string; note: string; staMul: number; nightHp: number; eatChance: number; healMul: number }

/** 体内辐射分档：0 干净 / 1 轻微 / 2 明显 / 3 重度 / 4 致命 */
export function radTier(rad: number): RadTier {
  const v = Math.max(0, Math.min(100, rad));
  if (v >= 95) return { tier: 4, label: '致命', note: '牙龈在渗血，头发一抓一把——再待下去就是倒在路边慢慢烂掉。', staMul: 0.6, nightHp: -15, eatChance: 0.6, healMul: 0.5 };
  if (v >= 75) return { tier: 3, label: '重度', note: '持续呕吐与腹泻，伤口不再愈合。', staMul: 0.7, nightHp: -8, eatChance: 0.35, healMul: 0.6 };
  if (v >= 50) return { tier: 2, label: '明显', note: '乏力、头晕，皮肤上出现红斑。', staMul: 0.85, nightHp: -3, eatChance: 0.15, healMul: 0.8 };
  if (v >= 25) return { tier: 1, label: '轻微', note: '有点恶心，血象已经不太对劲了。', staMul: 1, nightHp: 0, eatChance: 0, healMul: 0.95 };
  return { tier: 0, label: '干净', note: '暂时没有异常。', staMul: 1, nightHp: 0, eatChance: 0, healMul: 1 };
}

/** 盖革计数器的"咔哒"文案：有计数器才报具体等级，没有就只有模糊线索 */
export function geigerText(level: number, hasGeiger: boolean): string {
  if (level <= 0) return hasGeiger ? '☢️ 盖革计数器：背景值，安静。' : '';
  if (!hasGeiger) return '☢️ 空气里有股金属味，舌尖发麻——这里不太对劲。';
  const clicks = ['偶尔一声咔哒。', '咔哒声断断续续。', '咔哒咔哒咔哒……很密。', '几乎连成一片啸叫。'][Math.min(3, level - 1)];
  return '☢️ 盖革计数器：<b>辐射 ' + level + ' 级</b>——' + clicks;
}

/* M58：辐射的**白天症状**（HANDOFF §8.4 挂账）。
   以前只有"压体力上限 + 夜里掉血 + 拖慢愈合"，白天照跑照打，玩家看不出"我现在被辐射害了"。
   现在每档都给白天的可感后果：体力消耗更快、口渴更快、命中/闪避下降、重度以上每步掉血、随时呕吐。
   —— 与 `radTier` 的分档一一对应（同一份阈值），夜里那部分仍归 night.ts，不重复扣。 */
export interface RadSymptoms {
  tier: number; label: string; note: string;
  /** 每步体力消耗倍率（≥1） */
  staDrainMul: number;
  /** 水分消耗倍率（≥1） */
  thirstMul: number;
  /** 命中惩罚（0~1，直接加到 statMods 的减伤上） */
  hitPenalty: number;
  /** 闪避惩罚（0~1） */
  dodgePenalty: number;
  /** 每步掉血（0 = 不掉） */
  hpPerStep: number;
  /** 每步呕吐概率（掉饱食） */
  vomitChance: number;
  /** 一行处理建议（带具体药名） */
  care: string;
}

/** 症状表的一行：档位/标签/文案都从 radTier 取，这里只存"白天怎么难受"的数值 */
type RadRow = Omit<RadSymptoms, 'label' | 'note'>;

const RAD_SYMPTOMS: RadRow[] = [
  { tier: 0, staDrainMul: 1, thirstMul: 1, hitPenalty: 0, dodgePenalty: 0, hpPerStep: 0, vomitChance: 0,
    care: '不用处理：辐射值会随时间与净水慢慢回落。' },
  { tier: 1, staDrainMul: 1.05, thirstMul: 1.1, hitPenalty: 0, dodgePenalty: 0, hpPerStep: 0, vomitChance: 0,
    care: '离开辐射区、多喝水；碘片（医疗台 Lv1）能把这 25 点直接压回去。' },
  { tier: 2, staDrainMul: 1.15, thirstMul: 1.2, hitPenalty: 0.05, dodgePenalty: 0.03, hpPerStep: 0, vomitChance: 0.06,
    care: '吃碘片（-25）或抗辐射药（-55），今天别再进辐射区；净水要喝够。' },
  { tier: 3, staDrainMul: 1.35, thirstMul: 1.35, hitPenalty: 0.1, dodgePenalty: 0.06, hpPerStep: 1, vomitChance: 0.12,
    care: '抗辐射药优先（碘片不够用），回据点睡觉；给药期间别硬撑打架。' },
  { tier: 4, staDrainMul: 1.6, thirstMul: 1.5, hitPenalty: 0.18, dodgePenalty: 0.1, hpPerStep: 3, vomitChance: 0.25,
    care: '立刻撤退：抗辐射药 + 净水 + 睡觉。这一档每走一步都在掉血，别贪那点物资。' },
];

/** 白天辐射症状（按体内辐射值分档；档位/标签/文案都取自 radTier，这里只加"白天怎么难受"的数值） */
export function radSymptoms(rad: number): RadSymptoms {
  const t = radTier(rad);
  const row = RAD_SYMPTOMS[t.tier] || RAD_SYMPTOMS[0];
  return { ...row, label: t.label, note: t.note };
}

/** 全部症状档（图鉴/治疗指南拿它生成对照表，不手抄第二份）：每档取一个代表值走同一条函数 */
const RAD_TIER_SAMPLE = [0, 30, 60, 80, 97];
export function radSymptomTable(): RadSymptoms[] { return RAD_TIER_SAMPLE.map(radSymptoms); }

/** 极短摘要（HUD chip 里用）：只挑最要命的三条，长了会把状态栏挤爆 */
export function radBrief(s: RadSymptoms): string {
  if (s.tier <= 0) return '';
  const bits: string[] = [];
  if (s.hpPerStep) bits.push('掉血 ' + s.hpPerStep + '/步');
  if (s.hitPenalty) bits.push('命中 -' + Math.round(s.hitPenalty * 100) + '%');
  if (!bits.length && s.vomitChance) bits.push('呕吐 ' + Math.round(s.vomitChance * 100) + '%');
  if (!bits.length && s.thirstMul > 1) bits.push('口渴 ×' + s.thirstMul.toFixed(2).replace(/0$/, ''));
  if (!bits.length && s.staDrainMul > 1) bits.push('体力 ×' + s.staDrainMul.toFixed(2).replace(/0$/, ''));
  return bits.slice(0, 3).join(' · ');
}

/** 症状的一句话摘要（HUD / 人体页 / 图鉴都用它，避免三处各写一份） */
export function radSymptomText(s: RadSymptoms): string {
  if (s.tier <= 0) return '无症状';
  const bits: string[] = [];
  if (s.hitPenalty) bits.push('命中 -' + Math.round(s.hitPenalty * 100) + '%');
  if (s.dodgePenalty) bits.push('闪避 -' + Math.round(s.dodgePenalty * 100) + '%');
  if (s.hpPerStep) bits.push('每步 -' + s.hpPerStep + ' 生命');
  if (s.thirstMul > 1) bits.push('口渴 ×' + s.thirstMul.toFixed(2).replace(/0$/, ''));
  if (s.staDrainMul > 1) bits.push('体力消耗 ×' + s.staDrainMul.toFixed(2).replace(/0$/, ''));
  if (s.vomitChance) bits.push('呕吐 ' + Math.round(s.vomitChance * 100) + '%');
  return bits.join(' · ') || '无症状';
}
