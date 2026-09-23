/* M73 · 技能硬门槛 + 死亡扣进度（纯逻辑，唯一真值）
 * ---------------------------------------------------------------------------
 * 硬核化线的口径（docs/DESIGN-HARDCORE.md §三）：**不做反人类体验** ——
 *   · 高级武器/防具：技能不够 = 装不上（东西不丢、永远有低阶替代，升级就能用）；
 *   · 军事管制区 / 实验室：技能不够 = 搜刮效率腰斩，**不锁死**（玩家永远有路走，只是更贵）；
 *   · 死亡：清空"当前等级"的经验条，**等级保留**（丢的是进度，不是全部积累）。
 * 判定只在这里一处：legacy 的 searchZone/equipWeapon 与 v4 的 searchPoi 都读同一套函数，
 * 免得又出现"UI 写了但没生效"的死代码（M64 抓过一次）。 */

/** 技能表（S.skills 的形状：key → 等级 0~10） */
export type SkillMap = { [k: string]: number | undefined };

/** 门槛用到的技能中文名（UI 文案统一从这儿取，别各写各的） */
export const GATE_SKILL_NAME: Record<string, string> = {
  shoot: '射击', melee: '近战', fitness: '体能', survival: '生存',
};

/* ── 武器 / 防具门槛 ────────────────────────────────────────────────────── */

/** 分档阈值：按"伤害/防护有多硬"分档，而不是按物品 id 写死 —— 新加的武器自动有门槛。
 *  取值的依据是现有物品表：枪 21/26 → 46/58/64；近战 14/23 → 34；重甲 护甲 5 / 防化服 4 折伤。 */
export const EQUIP_GATE = {
  GUN_T1_DMG: 40,      // 霰弹枪 46 起：射击 Lv.3
  GUN_T2_DMG: 55,      // 精准步枪 64 / M14 58：射击 Lv.5
  MELEE_T1_DMG: 34,    // 消防斧 34：近战 Lv.3
  ARMOR_T1: 5,         // 防弹衣 护甲 5：体能 Lv.3
  DMG_CUT_T1: 0.3,     // 防化服 减伤 40%：算重甲，同样要体能
} as const;

export interface EquipGate {
  ok: boolean;
  tier: '' | '枪械' | '近战' | '重甲';
  skill: string;    // 需要哪条技能（ok 时为 ''）
  need: number;     // 需要几级
  lv: number;       // 现在几级
  why: string;      // 一句人话（直接给玩家看）
}

export interface ItemLike {
  t?: string; dmg?: number; ammo?: number; armor?: number; dmgCut?: number; slot?: string; n?: string;
}

/** 这个物品要不要技能门槛？（不吃门槛的返回 gate.ok = true） */
export function equipGate(item: ItemLike | null | undefined, skills: SkillMap | undefined): EquipGate {
  const none: EquipGate = { ok: true, tier: '', skill: '', need: 0, lv: 0, why: '' };
  if (!item) return none;
  const lvOf = (k: string) => Math.max(0, Math.floor(Number(skills?.[k]) || 0));
  const judge = (tier: EquipGate['tier'], skill: string, need: number): EquipGate => {
    const lv = lvOf(skill);
    const ok = lv >= need;
    return {
      ok, tier, skill, need, lv,
      why: ok ? '' : (item.n || '这件东西') + '要「' + (GATE_SKILL_NAME[skill] || skill) + '」Lv.' + need + '（现在 Lv.' + lv + '）—— 先拿低一档的用，练上去再回来。',
    };
  };

  const dmg = Number(item.dmg) || 0;
  if (item.t === 'wpn') {
    if (item.ammo) {                                   // 枪：吃射击
      if (dmg >= EQUIP_GATE.GUN_T2_DMG) return judge('枪械', 'shoot', 5);
      if (dmg >= EQUIP_GATE.GUN_T1_DMG) return judge('枪械', 'shoot', 3);
      return none;
    }
    if (dmg >= EQUIP_GATE.MELEE_T1_DMG) return judge('近战', 'melee', 3);   // 重近战：吃近战技能
    return none;
  }
  const armor = Number(item.armor) || 0;
  const cut = Number(item.dmgCut) || 0;
  if (armor >= EQUIP_GATE.ARMOR_T1 || cut >= EQUIP_GATE.DMG_CUT_T1) return judge('重甲', 'fitness', 3);
  return none;
}

/* ── 区域搜刮门槛（军事管制区 / 实验室）──────────────────────────────────── */

/** 不够级时效率腰斩（**下限写在 gateYield 里，永远至少给 1**）。 */
export const ZONE_GATE_MUL = 0.5;

/** 哪些区域吃「生存」技能门槛：军事管制区 Lv.3、实验室 Lv.5。
 *  这两个区是主线后段的高价值区：不拦你进，但你手法生疏就只刮得到一半。 */
export const ZONE_GATES: Record<string, { need: number; label: string }> = {
  military: { need: 3, label: '军方检查站' },
  lab: { need: 5, label: '方舟实验室外围' },
};

export interface ZoneGate {
  id: string;          // 命中的区域 id（没命中为 ''）
  gated: boolean;      // 是否"技能不够、效率打折"
  mul: number;         // 产出倍率（1 或 ZONE_GATE_MUL）
  skill: string;
  need: number;
  lv: number;
  label: string;
}

export function zoneGate(zoneId: string | null | undefined, skills: SkillMap | undefined): ZoneGate {
  const id = String(zoneId || '');
  const g = ZONE_GATES[id];
  const lv = Math.max(0, Math.floor(Number(skills?.survival) || 0));
  if (!g) return { id: '', gated: false, mul: 1, skill: 'survival', need: 0, lv, label: '' };
  const gated = lv < g.need;
  return { id, gated, mul: gated ? ZONE_GATE_MUL : 1, skill: 'survival', need: g.need, lv, label: g.label };
}

/** 打折后的产出：**至少 1**（设计口径：门槛只降效率不锁死，不能出现"搜了半天什么都没有"）。 */
export function gateYield(v: number, mul: number): number {
  return Math.max(1, Math.round(Number(v || 0) * (mul > 0 ? mul : 1)));
}

/** 门槛提示（只在该说的时候返回人话，日志里别刷屏） */
export function zoneGateNote(g: ZoneGate): string {
  if (!g.gated) return '';
  return '（这一片的门道你还没摸透：想要「生存」Lv.' + g.need + '，你在 Lv.' + g.lv +
    ' → 这趟搜刮效率 -' + Math.round((1 - g.mul) * 100) + '%，产出至少留 1 份）';
}

/* ── 死亡扣进度 ────────────────────────────────────────────────────────── */

/** 死亡清空"当前等级进度条"，等级保留。返回新的 xp 表与总共丢了多少经验。 */
export function wipeLevelXp(xp: Record<string, number> | undefined): { xp: Record<string, number>; lost: number; n: number } {
  const out: Record<string, number> = {};
  let lost = 0, n = 0;
  for (const k in xp || {}) {
    const v = Math.max(0, Math.floor(Number((xp as any)[k]) || 0));
    out[k] = 0;
    if (v > 0) { lost += v; n++; }
  }
  return { xp: out, lost, n };
}

/** 死亡结算那行的文案（技能面板/死亡弹窗共用一份口径）。 */
export function deathXpLine(lost: number, n: number): string {
  if (lost <= 0) return '死前你正好没有半条经验压在进度条上（等级都留着）。';
  return '死亡清空了 ' + n + ' 条技能的进度条：' + lost + ' 点经验没了（**等级保留**）。';
}
