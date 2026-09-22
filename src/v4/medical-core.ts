/* M31 · 人体与伤病（塔科夫式分部位 + 双轨制）的**纯逻辑与唯一数值表**（DOM-free、可单测）。
 *
 * 用户原话：「单开一个"人体状态"的分页，用类似于塔科夫的健康系统（但是角色健康通过 svg 绘制，
 *   就搞几个方块头方块身子就行了）添加贯穿伤啊，骨折啊，大出血小出血啊啥的」。
 *
 * M30 讨论确认的口径（16 题里的 Q1/Q2/Q3）：
 *   · **双轨制**：单条 HP 仍然决定生死（M25 已验收的战斗数值一个都不推翻），
 *     部位伤只做 **debuff 与治疗链** —— 这是改动最小、又真的有"塔科夫味"的做法；
 *   · 第一批伤病 8 种：小出血 / 大出血 / 骨折 / 贯穿伤 / 烧伤 / 脑震荡 / 感染伤口 / 肢体失灵；
 *   · 治疗链 = **急救 → 手术 → 康复** 三档（用户选的是"第一个和塔科夫式融合"）：
 *       急救：绷带止血、夹板固定（临时，能走但慢）、止痛药压症状（不治病）
 *       手术：要医疗台 + 手术剪/缝合包，**成功率和医疗技能挂钩**，失败则伤口感染加重
 *       康复：手术之后部位仍然"带伤"几天（负重/命中/闪避有折扣），靠时间 + 营养恢复
 *   · 截肢/断肢（长期 debuff）明确进待办，本批不做。
 *
 * 为什么单独一张表：战斗、HUD、人体页、治疗弹窗、探针五处都要读它 —— 数值只写一遍。
 */

export type BodyPart = 'head' | 'torso' | 'belly' | 'armL' | 'armR' | 'legL' | 'legR';
export const PARTS: BodyPart[] = ['head', 'torso', 'belly', 'armL', 'armR', 'legL', 'legR'];

export const PART_INFO: Record<BodyPart, { name: string; icon: string; /** 身体总 HP 的分摊权重 */ w: number; vital: boolean }> = {
  head:  { name: '头部',   icon: '🧠', w: 0.5, vital: true },
  torso: { name: '胸部',   icon: '🫁', w: 1.3, vital: true },
  belly: { name: '腹部',   icon: '🫃', w: 0.9, vital: true },
  armL:  { name: '左臂',   icon: '💪', w: 0.7, vital: false },
  armR:  { name: '右臂',   icon: '💪', w: 0.7, vital: false },
  legL:  { name: '左腿',   icon: '🦵', w: 0.9, vital: false },
  legR:  { name: '右腿',   icon: '🦵', w: 0.9, vital: false },
};

/* ── 伤病表 ── */
export type InjuryId = 'bleedS' | 'bleedL' | 'fracture' | 'pierce' | 'burn' | 'concuss' | 'infected' | 'limb';

export interface InjuryDef {
  id: InjuryId;
  name: string;
  icon: string;
  color: string;
  /** 一次命中最多造成几条（同类不会叠加，只升级：bleedS → bleedL） */
  weight: number;              // 抽签权重
  /** 每 tick（若干行动）掉血 */
  bleedPerTick: number;
  /** 属性折扣 */
  hit: number;                 // 命中 −x（手臂/头部）
  dodge: number;               // 闪避 −x（腿部/脑震荡）
  dmgMul: number;              // 伤害 ×
  carryMul: number;            // 负重上限 ×（骨折/手臂）
  moveMul: number;             // 走路成本 ×（腿）
  /** 只影响这些部位（空 = 任意部位） */
  parts?: BodyPart[];
  /** 能治它的"急救"道具（field） */
  field?: string;
  /** 能治它的"手术"道具（surgery） */
  surgery?: string;
  /** 康复天数（手术之后还要养几天） */
  recoverDays: number;
  desc: string;
  cure: string;
}

export const INJURIES: Record<InjuryId, InjuryDef> = {
  bleedS: {
    id: 'bleedS', name: '小出血', icon: '🩸', color: '#e0736a', weight: 30, bleedPerTick: 1,
    hit: 0, dodge: 0, dmgMul: 1, carryMul: 1, moveMul: 1, recoverDays: 2,
    field: 'bandage',
    desc: '皮肉被划开，血在渗。不处理会慢慢掉血，但一时半会儿死不了。',
    cure: '绷带（急救）→ 自己长好',
  },
  bleedL: {
    id: 'bleedL', name: '大出血', icon: '🩸', color: '#ef6f6f', weight: 10, bleedPerTick: 3,
    hit: 0, dodge: -0.05, dmgMul: 1, carryMul: 1, moveMul: 1, recoverDays: 2,
    field: 'medkit', surgery: 'suture',
    desc: '动脉被打断了：每走几步就掉一截血，硬扛会死。',
    cure: '急救包止血（急救）→ 缝合包（手术）',
  },
  fracture: {
    id: 'fracture', name: '骨折', icon: '🦴', color: '#e0b45c', weight: 14, bleedPerTick: 0,
    hit: -0.05, dodge: -0.12, dmgMul: 1, carryMul: 0.6, moveMul: 1.6, recoverDays: 4,
    parts: ['legL', 'legR', 'armL', 'armR'],
    field: 'splint', surgery: 'surgerykit',
    desc: '骨头断了。夹板能让你走，但走不快也背不动；要复位得动手术。',
    cure: '夹板（急救，临时）→ 手术包（手术，复位）',
  },
  pierce: {
    id: 'pierce', name: '贯穿伤', icon: '🗡️', color: '#d98ab4', weight: 12, bleedPerTick: 2,
    hit: -0.08, dodge: -0.06, dmgMul: 0.9, carryMul: 1, moveMul: 1.1, recoverDays: 3,
    surgery: 'surgerykit',
    desc: '开了个对穿的洞，靠绷带堵不住，得清创缝合。',
    cure: '手术包（手术）',
  },
  burn: {
    id: 'burn', name: '烧伤', icon: '🔥', color: '#ef8f5c', weight: 10, bleedPerTick: 0,
    hit: -0.06, dodge: -0.04, dmgMul: 0.92, carryMul: 0.9, moveMul: 1,
    field: 'burncream', recoverDays: 4,
    desc: '皮肤焦了，一动就疼，还容易感染。',
    cure: '烧伤药膏（急救）+ 时间',
  },
  concuss: {
    id: 'concuss', name: '脑震荡', icon: '💫', color: '#8ab4d8', weight: 8, bleedPerTick: 0,
    hit: -0.15, dodge: -0.08, dmgMul: 1, carryMul: 1, moveMul: 1,
    parts: ['head'],
    field: 'painkiller', recoverDays: 3,
    desc: '眼前发花、耳鸣，瞄不准也躲不快。只能靠睡。',
    cure: '止痛药（压症状）+ 睡觉（真正的药）',
  },
  infected: {
    id: 'infected', name: '感染伤口', icon: '🦠', color: '#b98ad8', weight: 9, bleedPerTick: 0,
    hit: -0.05, dodge: -0.05, dmgMul: 0.95, carryMul: 1, moveMul: 1,
    surgery: 'antiseptic', recoverDays: 3,
    desc: '伤口发烫、流脓，拖下去会败血。',
    cure: '消毒剂清创（手术台）+ 抗生素',
  },
  limb: {
    id: 'limb', name: '肢体失灵', icon: '🦾', color: '#9aa4b2', weight: 6, bleedPerTick: 1,
    hit: -0.12, dodge: -0.15, dmgMul: 0.85, carryMul: 0.5, moveMul: 1.8, recoverDays: 5,
    parts: ['armL', 'armR', 'legL', 'legR'],
    surgery: 'surgerykit',
    desc: '这条肢体暂时不听使唤了（神经/肌腱受损）。能治，但要躺几天。',
    cure: '手术包（手术）→ 静养康复',
  },
};

export const INJURY_IDS = Object.keys(INJURIES) as InjuryId[];

/* ── 状态与生成 ── */
export interface Injury { part: BodyPart; id: InjuryId; day: number; /** 已手术，正在康复 */ done?: boolean; /** 已急救（临时处理） */ field?: boolean }
export interface BodyState {
  /** 部位 → 生命（0~100 的相对值；总 HP 换算成绝对血量时乘以 hpMax/100） */
  parts: Record<BodyPart, number>;
  injuries: Injury[];
  /** 大出血累计（用于"再不处理就完了"的提示与掉血加速） */
  bleedSince: number;
}

export const emptyBody = (): BodyState => ({
  parts: { head: 100, torso: 100, belly: 100, armL: 100, armR: 100, legL: 100, legR: 100 },
  injuries: [],
  bleedSince: 1,
});

/** 老档迁移：按当前 HP 比例铺到各部位（比"一律满血"诚实，也不会把重伤玩家洗成健康人） */
export function bodyFromHp(hp: number, hpMax: number, day: number): BodyState {
  const ratio = Math.max(0, Math.min(1, hpMax > 0 ? hp / hpMax : 1));
  const b = emptyBody();
  for (const p of PARTS) b.parts[p] = Math.round(ratio * 100);
  b.bleedSince = day;
  return b;
}

/** 部位权重（命中抽签 + 伤害分摊用）：胸/腹更容易被打中，头最少 */
const HIT_WEIGHT: Record<BodyPart, number> = { head: 8, torso: 30, belly: 16, armL: 11, armR: 11, legL: 12, legR: 12 };

/** 命中哪个部位（rng 注入，便于测试复现） */
export function rollPart(rng: () => number): BodyPart {
  const total = PARTS.reduce((a, p) => a + HIT_WEIGHT[p], 0);
  let r = rng() * total;
  for (const p of PARTS) { r -= HIT_WEIGHT[p]; if (r <= 0) return p; }
  return 'torso';
}

/** 这个部位已经有的伤（用于"同类升级"判定） */
export const injuryAt = (b: BodyState, part: BodyPart): Injury | undefined => b.injuries.find(i => i.part === part);

/**
 * 判定一次受伤：返回**新**的 BodyState（纯函数）+ 要写的日志。
 * @param dmg 这次掉了多少血（占 hpMax 的比例决定伤势轻重）
 * @param armor 护甲（≥2 有概率把"贯穿"降级成"小出血"）
 * @param force 教学/剧情用：直接指定部位与伤病
 */
export function applyHit(
  b: BodyState, dmg: number, hpMax: number, day: number, rng: () => number,
  opts: { armor?: number; force?: { part?: BodyPart; id?: InjuryId } } = {},
): { body: BodyState; logs: string[] } {
  const next: BodyState = { parts: { ...b.parts }, injuries: b.injuries.map(i => ({ ...i })), bleedSince: b.bleedSince };
  const logs: string[] = [];
  const frac = hpMax > 0 ? dmg / hpMax : 0;
  const part = opts.force?.part ?? rollPart(rng);
  /* 部位血量按伤害分摊（胸/腹权重高 → 掉得更少，四肢掉得更快，符合直觉） */
  const share = frac * 100 * (1.1 / PART_INFO[part].w);
  next.parts[part] = Math.max(0, next.parts[part] - share);

  /* 抽签：**先判轻重、再在档内挑具体哪一种** —— 这样"轻伤"小出血不会因为同类权重高
     把重伤的概率吃掉（第一版用一张大权重表，实测"同一部位反复挨轻伤永远升不成大出血"）。 */
  const sev = Math.min(1, frac * 6);                       // 一次掉 1/6 血 = 必出重伤
  const HEAVY: InjuryId[] = ['bleedL', 'pierce', 'fracture', 'limb'];
  const LIGHT: InjuryId[] = ['bleedS', 'burn', 'concuss'];
  const heavyP = Math.min(0.95, 0.05 + sev * 0.8);
  const fitHeavy = HEAVY.filter(id => !INJURIES[id].parts || INJURIES[id].parts!.indexOf(part) >= 0);
  const fitLight = LIGHT.filter(id => !INJURIES[id].parts || INJURIES[id].parts!.indexOf(part) >= 0);
  const bucket = (rng() < heavyP ? fitHeavy : fitLight).filter(Boolean);
  if (!bucket.length) return { body: next, logs };
  const total = bucket.reduce((a, id) => a + INJURIES[id].weight, 0);
  let r = rng() * total;
  let picked: InjuryId = bucket[0];
  for (const id of bucket) { r -= INJURIES[id].weight; if (r <= 0) { picked = id; break; } }
  /* 护甲：有概率把贯穿/大出血降级（护甲不是免疫，是"少挨一刀深的"） */
  if ((opts.armor ?? 0) >= 2 && (picked === 'pierce' || picked === 'bleedL') && rng() < Math.min(0.5, (opts.armor ?? 0) * 0.1)) {
    picked = 'bleedS';
  }
  const exist = next.injuries.find(i => i.part === part);
  if (exist) {
    /* 同类升级：小出血 → 大出血；其他同类只刷新受伤日 */
    if (exist.id === 'bleedS' && picked === 'bleedL') { exist.id = 'bleedL'; exist.done = false; exist.field = false; logs.push(`🩸 ${PART_INFO[part].name}的小出血变成了**大出血**！`); }
    else if (exist.id === picked) logs.push(`🩸 ${PART_INFO[part].name}的${INJURIES[picked].name}又挨了一下。`);
    else if (INJURIES[picked].weight > INJURIES[exist.id].weight) { exist.id = picked; exist.day = day; exist.done = false; exist.field = false; logs.push(`🩸 ${PART_INFO[part].name}：伤情加重为${INJURIES[picked].name}。`); }
    else logs.push(`🩸 ${PART_INFO[part].name}又添了一道伤。`);
  } else {
    next.injuries.push({ part, id: picked, day });
    logs.push(`🩸 你伤到了${PART_INFO[part].name}：${INJURIES[picked].icon}${INJURIES[picked].name}（${INJURIES[picked].cure}）`);
  }
  if (next.injuries.some(i => i.id === 'bleedL')) next.bleedSince = next.bleedSince || day;
  return { body: next, logs };
}

/* ── 惩罚与走路成本 ── */
export interface BodyPenalty {
  hit: number; dodge: number; dmgMul: number; carryMul: number; moveMul: number; bleed: number;
  /** M68：搜刮产出倍率（手臂越坏越少）—— 用户路线图「手臂受伤 → 搜刮产出下降」 */
  scavMul: number;
  note: string[];
}

/* ── M68：把"伤"接到动作上（用户 2026-09-22 的硬核化路线图 短期第 1 项）──
   在此之前部位伤只影响命中/闪避/走路/负重/伤害，玩家在楼里翻东西、在野外探路时**感受不到**胳膊和脑袋的伤。
   这两条都做成**平滑的**（按部位血量连续变化，不是"伤了就砍一半"），并且有下限：
   手臂再烂也能翻到东西，头再晕也至少看得见 1 圈（见 scoutRadius）。 */
/** 读部位血量：不是有限数就当**满血**（坏档/老档缺字段时不该反过来惩罚玩家） */
function partVal(v: unknown, dflt = 100): number {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : dflt;
}
export function armFactor(b: BodyState): number {
  return (partVal(b.parts.armL) + partVal(b.parts.armR)) / 200;
}
/** 搜刮产出倍率：双手满血 = 1.00，双手报废 = 0.45（下限） */
export function scavMulOf(b: BodyState | null | undefined): number {
  if (!b || !b.parts) return 1;
  return Math.round(Math.max(0.45, Math.min(1, 0.45 + 0.55 * armFactor(b))) * 100) / 100;
}
/** 头部伤 → 视野少几圈：头 < 55 或有脑震荡 = 少 1 圈（不叠加，永远保留 1 圈） */
export function headVisionLoss(b: BodyState | null | undefined): number {
  if (!b || !b.parts) return 0;
  const head = Number(b.parts.head);
  const concuss = Array.isArray(b.injuries) && b.injuries.some(i => i && i.id === 'concuss' && !i.done);
  return (isFinite(head) && head < 55) || concuss ? 1 : 0;
}

/** 搜刮产出落到整数：**至少 1**（"翻半天一无所获"应该由掷点决定，不该由手臂伤势决定） */
export function scavYield(base: number, mul: number): number {
  return Math.max(1, Math.round(base * (isFinite(mul) ? mul : 1)));
}

/** 合并所有伤病的惩罚（未处理的比处理过的更重：急救 −60%、手术 −80%） */
export function bodyPenalty(b: BodyState): BodyPenalty {
  const out: BodyPenalty = { hit: 0, dodge: 0, dmgMul: 1, carryMul: 1, moveMul: 1, bleed: 0, scavMul: 1, note: [] };
  for (const i of b.injuries) {
    const d = INJURIES[i.id];
    if (!d) continue;
    const relief = i.done ? 0.2 : i.field ? 0.4 : 1;      // 手术过 → 只留两成；急救过 → 四成
    out.hit += d.hit * relief;
    out.dodge += d.dodge * relief;
    out.dmgMul *= 1 + (d.dmgMul - 1) * relief;
    out.carryMul *= 1 + (d.carryMul - 1) * relief;
    out.moveMul *= 1 + (d.moveMul - 1) * relief;
    out.bleed += d.bleedPerTick * (i.done ? 0 : i.field ? 0.5 : 1);
    out.note.push(PART_INFO[i.part].name + d.name);
  }
  out.hit = Math.max(-0.5, out.hit);
  out.dodge = Math.max(-0.5, out.dodge);
  out.dmgMul = Math.max(0.4, out.dmgMul);
  out.carryMul = Math.max(0.35, out.carryMul);
  out.moveMul = Math.min(2.2, out.moveMul);
  out.scavMul = scavMulOf(b);
  return out;
}

/** 走路额外行动力（腿伤/骨折）：返回要额外加几点（0 = 不受影响） */
export const travelExtra = (b: BodyState): number => {
  const p = bodyPenalty(b);
  return p.moveMul > 1.05 ? Math.round((p.moveMul - 1) * 2) : 0;
};

/* ── 治疗链 ── */
export interface TreatResult { ok: boolean; body?: BodyState; why?: string; log?: string; needSurgery?: boolean }

/**
 * 治疗：先试急救道具，再试手术道具。
 * 成功率和医疗技能挂钩（手术尤其吃技能：0 级 55% → 5 级 100%）。
 */
export function treat(b: BodyState, part: BodyPart, itemId: string, day: number, medicLv: number, rng: () => number): TreatResult {
  const inj = b.injuries.find(i => i.part === part);
  if (!inj) return { ok: false, why: '这个部位没有伤' };
  const d = INJURIES[inj.id];
  const next: BodyState = { parts: { ...b.parts }, injuries: b.injuries.map(i => ({ ...i })), bleedSince: b.bleedSince };
  const t = next.injuries.find(i => i.part === part)!;

  if (d.field === itemId) {
    if (t.field) return { ok: false, why: PART_INFO[part].name + '已经做过急救了' };
    t.field = true;
    t.day = day;
    return { ok: true, body: next, log: `🩹 急救：${PART_INFO[part].name}的${d.name}做了临时处理（出血与疼痛减半，要手术才能根治）。` };
  }
  if (d.surgery === itemId) {
    if (t.done) return { ok: false, why: '这个部位已经手术过了，剩下的是康复' };
    const chance = Math.min(1, 0.55 + Math.max(0, medicLv) * 0.09);
    if (rng() > chance) {
      /* 失败：伤口感染加重（这才是"手术有风险"的意义） */
      t.id = 'infected';
      t.field = false; t.done = false;
      return { ok: true, body: next, log: `🩸 手术失败（成功率 ${Math.round(chance * 100)}%）：伤口感染了，先压住炎症再来一次。` };
    }
    t.done = true; t.field = true; t.day = day;
    return { ok: true, body: next, log: `🧰 手术成功：${PART_INFO[part].name}的${d.name}处理好了，接下来 ${d.recoverDays} 天养着。` };
  }
  return { ok: false, why: INJURIES[inj.id].name + '不能用' + itemId + '治', needSurgery: !!d.surgery };
}

/** 可用道具清单（UI 与探针共用）：哪个部位能用哪件东西 */
export function treatOptions(b: BodyState, part: BodyPart): { item: string; kind: 'field' | 'surgery'; done: boolean }[] {
  const inj = b.injuries.find(i => i.part === part);
  if (!inj) return [];
  const d = INJURIES[inj.id];
  const out: { item: string; kind: 'field' | 'surgery'; done: boolean }[] = [];
  if (d.field) out.push({ item: d.field, kind: 'field', done: !!inj.field });
  if (d.surgery) out.push({ item: d.surgery, kind: 'surgery', done: !!inj.done });
  return out;
}

/* ── 推进：出血掉血 + 康复 ── */
export interface TickResult { body: BodyState; hp: number; healed: string[]; logs: string[] }

/** 每 tick（若干行动）走一次：出血扣血；手术过的伤按天数康复 */
export function tickBody(b: BodyState, day: number, opts: { nutrition: number; resting?: boolean } = { nutrition: 100 }): TickResult {
  const next: BodyState = { parts: { ...b.parts }, injuries: b.injuries.map(i => ({ ...i })), bleedSince: b.bleedSince };
  const logs: string[] = [], healed: string[] = [];
  let hp = 0;
  const p = bodyPenalty(next);
  if (p.bleed > 0) hp -= Math.max(1, Math.round(p.bleed));
  for (const i of next.injuries.slice()) {
    const d = INJURIES[i.id];
    /* 部位血量随康复回一点（康复速度：营养 >70 才回；睡觉翻倍） */
    if (i.done) {
      const rate = (opts.nutrition >= 70 ? 1 : 0) * (opts.resting ? 2 : 1);
      if (rate > 0) next.parts[i.part] = Math.min(100, next.parts[i.part] + rate);
      const days = day - i.day;
      if (days >= d.recoverDays) {
        next.injuries = next.injuries.filter(x => x !== i);
        healed.push(PART_INFO[i.part].name + d.name);
      }
    } else if (i.field && !d.surgery) {
      /* 急救过的**非手术类**伤（小出血/烧伤）：时间够就自己长好（慢一点） */
      if (day - i.day >= d.recoverDays + 2) { next.injuries = next.injuries.filter(x => x !== i); healed.push(PART_INFO[i.part].name + d.name); }
    }
  }
  if (healed.length) logs.push('✅ 康复：' + healed.join('、'));
  return { body: next, hp, healed, logs };
}

/** 人体页的伤情清单与总览 */
export function bodySummary(b: BodyState, hp: number, hpMax: number): { worst: BodyPart | null; text: string } {
  let worst: BodyPart | null = null, worstV = 101;
  for (const p of PARTS) if (b.parts[p] < worstV) { worstV = b.parts[p]; worst = p; }
  const list = b.injuries.map(i => PART_INFO[i.part].icon + PART_INFO[i.part].name + INJURIES[i.id].name);
  const text = b.injuries.length
    ? `生命 ${Math.round(hp)}/${hpMax} · ${b.injuries.length} 处伤：${list.join('、')}`
    : `生命 ${Math.round(hp)}/${hpMax} · 身上没有未处理的伤`;
  return { worst, text };
}

/** HUD 那一行（有伤才显示） */
export function hudLine(b: BodyState): string {
  if (!b.injuries.length) return '';
  const p = bodyPenalty(b);
  const parts: string[] = [];
  if (p.bleed > 0) parts.push('流血 -' + Math.round(p.bleed) + '/步');
  if (p.hit < -0.01) parts.push('命中 -' + Math.round(-p.hit * 100) + '%');
  if (p.dodge < -0.01) parts.push('闪避 -' + Math.round(-p.dodge * 100) + '%');
  if (p.moveMul > 1.05) parts.push('走路 +' + travelExtra(b) + ' 行动力');
  if (p.scavMul < 0.95) parts.push('搜刮产出 -' + Math.round((1 - p.scavMul) * 100) + '%');   // M68：手臂
  if (headVisionLoss(b)) parts.push('视野 -1 圈');                                            // M68：头部
  return b.injuries.map(i => INJURIES[i.id].icon + PART_INFO[i.part].name + INJURIES[i.id].name).join(' ') + '（' + parts.join(' · ') + '）';
}
