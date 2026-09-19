/**
 * M33 教程沙盒（分章练习）—— **纯逻辑层**：章节表 / 目标判定 / 沙盒预设 / 进度读写。
 *
 * 用户拍板的四条形态（2026-09-15）：
 *   ① 沙盒**完全隔离**：独立 iframe，里面怎么玩都不回主档（一个字节都不许落盘）；
 *   ② 章节完成判定 = **目标清单全绿**；
 *   ③ 失败 = 章内无限重来、不惩罚（死了就给「重来这一章」）；
 *   ④ 第一批只做「章节壳 + iframe 沙盒 + 第 1 章（生存基础）」，其余 5 章下一批。
 *
 * 为什么目标判定要放在这里：父页面拿不到 iframe 里的游戏对象（跨文档虽然同源，但一旦改动
 * 就两边一起崩），所以 iframe 每 0.5 秒把一份**快照**postMessage 出来，父页面用这里的纯函数判绿。
 * 快照字段全部来自已有的存档字段 / 统计计数器，不为了教学新造仪表盘。
 */

export interface LabSnap {
  day: number; hp: number; hun: number; thi: number; ap: number;
  /** stats 里的计数器（都是老字段） */
  scav: number; deep: number; crafted: number; kills: number; meleeKills: number; ammoUsed: number;
  /** M48：用"打得动装甲的弹种"完成的击杀数（教学第 2 章那条硬验证用它判定） */
  apKills: number;
  loc: string;
  /** 生命归零（沙盒里不惩罚，只是提示重来） */
  over: boolean;
  inv: Record<string, number>;
  /** 玩家手动指定过的装填弹种 {口径: 弹种 id}（第 2 章"换弹"那条目标用它判定） */
  load: Record<string, string>;
  /** 伤病（第 3 章）：每条只留"是什么 / 在哪 / 急没急救过 / 手术没" */
  injuries: { id: string; part: string; field: boolean; done: boolean }[];
  /** 据点设施等级（第 4 章） */
  base: Record<string, number>;
  /** 走过多少区块 / 点亮多少格 / 见过几个大区（第 5 章） */
  steps: number; visited: number; regions: number;
  /** 有没有车（第 5 章：跨大区的前置条件） */
  veh: boolean;
  /** M60：真的跨过大区几次（第 5 章目标③的硬验证 —— "有车"证明不了会开过去） */
  crossings: number;
  /** 背包里有几种东西（第 6 章） */
  invKinds: number;
}

export interface LabObjective {
  id: string;
  text: string;
  /** 达成条件（快照 → 布尔）。写成函数而不是字符串表达式：类型能查、单测能直接喂假快照 */
  need: (s: LabSnap) => boolean;
}

export interface LabChapter {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** 这一章能不能进（第一批只有第 1 章；其余显示"下一批"） */
  ready: boolean;
  objectives: LabObjective[];
  /** 沙盒开局（固定种子 → 同一章每次进来地图一模一样，方便照着攻略走） */
  preset: LabPreset;
}

export interface LabPreset {
  seed: string;
  day: number;
  ap: number;
  mat: number;
  hp: number; hun: number; thi: number; sta: number;
  inv: Record<string, number>;
  /** 据点设施等级（第 4 章：想让玩家"从零建"，就别给） */
  base?: Record<string, number>;
  /** 预设伤情（第 3 章：用户拍板的"预设伤情"就落在这里） */
  injuries?: { id: string; part: string; day?: number; field?: boolean }[];
  /** 预设身体部位血量（默认全满） */
  parts?: Record<string, number>;
  /** 预设技能等级（第 5 章给体能 9 级 → 行动力上限 +3；教学章不该被行动力卡住） */
  skills?: Record<string, number>;
  /** M48：教学保证 —— 把这些敌人塞进沙盒里**所有**区的敌人表。
      第 2 章要"用穿甲弹打死装甲丧尸"，而装甲丧尸平时只在地铁/军方/实验室那几区刷，
      靠运气走进去太玄学；只在沙盒生效，主档不受影响。 */
  extraEnemies?: string[];
  /** M55：教学保证（2）—— 把这些敌人的血量按倍率压下来（**只在沙盒的内存里改**）。
      第 2 章那只装甲丧尸 62 血、手枪打上去一下只有 3~11 点，探针实测经常"打得对但弹药见底"，
      教学章不该被运气卡住：给它半个血条当"训练靶"，打法（换穿甲弹 + 连发 + 包扎）照样得学。 */
  foeHpMul?: Record<string, number>;
}

/** 沙盒快照 → 通用读取（缺字段一律给安全默认，坏快照不许把父页面判绿/判崩） */
const n = (v: unknown, def = 0): number => (typeof v === 'number' && isFinite(v)) ? v : def;

export function snapOf(S: any): LabSnap {
  const st = (S && S.stats) || {};
  const inv: Record<string, number> = {};
  const src = (S && S.inv) || {};
  for (const k in src) { const v = n(src[k]); if (v > 0) inv[k] = v; }
  const load: Record<string, string> = {};
  const ld = (S && S.load) || {};
  for (const cal in ld) { if (typeof ld[cal] === 'string' && ld[cal]) load[cal] = ld[cal]; }
  /* 伤病：只带出判定需要的四个字段（iframe 里出来的东西一律当不可信输入） */
  const injuries: LabSnap['injuries'] = [];
  const inj = (S && S.body && Array.isArray(S.body.injuries)) ? S.body.injuries : [];
  for (const i of inj) {
    if (!i || typeof i.id !== 'string') continue;
    injuries.push({ id: i.id, part: String(i.part || ''), field: !!i.field, done: !!i.done });
  }
  const base: Record<string, number> = {};
  const bs = (S && S.base) || {};
  for (const k in bs) { const v = n(bs[k]); if (v > 0) base[k] = v; }
  const sw = (S && S.world) || {};
  const visited = sw.visited && typeof sw.visited === 'object' ? Object.keys(sw.visited).length : 0;
  const regions = sw.seenRegions && typeof sw.seenRegions === 'object' ? Object.keys(sw.seenRegions).length : 0;
  /* 背包里"几种东西"：按 ITEMS 里认得的 id 数（坏档里塞的假 id 不算） */
  const ITEMS = (globalThis as any).ITEMS;
  const kinds = Object.keys(inv).filter(id => !ITEMS || !!ITEMS[id]).length;
  return {
    day: n(S && S.day, 1), hp: n(S && S.hp), hun: n(S && S.hun), thi: n(S && S.thi), ap: n(S && S.ap),
    scav: n(st.scav), deep: n(st.deep), crafted: n(st.crafted), kills: n(st.kills), meleeKills: n(st.meleeKills),
    ammoUsed: n(st.ammoUsed), apKills: n(st.apKills),
    loc: String((S && S.loc) || 'base'), over: !!(S && S.over), inv, load,
    injuries, base, steps: n(sw.steps), visited, regions, invKinds: kinds,
    veh: !!sw.veh, crossings: n(sw.crossings),
  };
}

/** 第 1 章「生存基础」的沙盒开局：饿一点、渴一点（不然"吃饱喝足"这个目标一开始就是绿的），
    手上有撬棍和两份吃的，够走出去搜两处、睡一觉。 */
export const SURVIVAL_PRESET: LabPreset = {
  seed: 'lab-survival-01',
  day: 1, ap: 14, mat: 12,
  hp: 100, hun: 62, thi: 58, sta: 100,
  inv: { crowbar: 1, can: 2, water: 2, bandage: 1, cloth: 2, wood: 1 },
};

/** 兜底预设：章节没写 preset 时用它（6 章现在都有各自的预设，这个只防手滑） */
const DEFAULT_PRESET: LabPreset = { seed: 'lab-basic-01', day: 1, ap: 14, mat: 12, hp: 100, hun: 80, thi: 80, sta: 100, inv: { crowbar: 1, can: 1, water: 1 } };

/** 第 2 章「战斗与枪械」的沙盒开局：一把手枪 + 两种 9mm（普通弹与穿甲弹打装甲目标的手感不一样）
    + 撬棍（近战不耗弹但会挨咬）。饱食水分给足 —— 这一章不该被饿肚子打断。
    M48：穿甲弹从 8 发加到 24 发、并给一件防弹衣 + 更多急救（探针实测：装甲丧尸 hp62/armor5，
    打上去一下只有 3~9 点，而它一巴掌 17 —— 不换弹/不包扎的裸装玩家会先倒下，8 发更是必然卡章），
    并把装甲丧尸塞进所有区的敌人表（extraEnemies），让"用穿甲弹打死装甲目标"这条目标真的做得到。
    M54：再加到 40 发 + 绷带 5 —— 回归时撞上过一次"打得对但弹药见底、怪还剩 16 血"的倒霉局：
    教学章不该被运气卡住（手枪打装甲本来就费弹，这一章正好教"带够弹、该包扎就包扎"）。 */
export const COMBAT_PRESET: LabPreset = {
  seed: 'lab-combat-01',
  day: 1, ap: 14, mat: 12,
  hp: 100, hun: 85, thi: 85, sta: 100,
  inv: { pistol: 1, crowbar: 1, a9_fmj: 24, a9_ap: 40, kevlar: 1, bandage: 5, medkit: 2, can: 2, water: 2 },
  extraEnemies: ['armored'],
  foeHpMul: { armored: 0.55 },        // 训练靶：半个血条（打法照学，别让运气卡住教学章）
};

/** 第 3 章「人体与伤病」：用户拍板的"预设伤情"落在这里 —— 开局就带一处小出血 + 一处骨折，
    背包里给绷带/夹板/急救包，教学重点是"急救 → 手术 → 康复"里的第一步（先止住）。 */
export const MEDICAL_PRESET: LabPreset = {
  seed: 'lab-medical-01',
  day: 1, ap: 14, mat: 12,
  hp: 100, hun: 80, thi: 80, sta: 100,
  inv: { crowbar: 1, bandage: 3, splint: 2, medkit: 1, suture: 1, can: 2, water: 2 },
  injuries: [{ id: 'bleedS', part: 'armR' }, { id: 'fracture', part: 'legL' }],
};

/** 第 4 章「建造与据点」：材料给够建两样（净水装置 + 工作台，两样都要胶带 —— 第一次探针就是
    因为没给 tape 而"按钮点了没反应"，其实是材料不足被禁用了），其余靠玩家自己安排顺序。 */
export const BASE_PRESET: LabPreset = {
  seed: 'lab-base-01',
  day: 1, ap: 14, mat: 20,
  hp: 100, hun: 85, thi: 85, sta: 100,
  inv: { crowbar: 1, wood: 10, metal: 10, cloth: 6, chip: 4, tape: 4, can: 2, water: 2, bandage: 1 },
};

/** 第 5 章「地图与大区」：走路 8 格 + 深搜 2 点 + 修车 1 点 —— 一天 14 点不够，
    所以给体能 9 级（每 3 级 +1 行动力上限 → 17 点）。修车要 12 材料 + 2 汽油，预设都给上。
    教学点：**跨大区得开车**（靠两条腿走不到），所以第三章目标是"弄到一辆车"。 */
export const WORLD_PRESET: LabPreset = {
  seed: 'lab-world-01',
  day: 1, ap: 17, mat: 20,
  hp: 100, hun: 85, thi: 85, sta: 100,
  inv: { crowbar: 1, can: 2, water: 2, bandage: 2, fuel: 2, a9_fmj: 12, pistol: 1 },
  skills: { fitness: 9 },
};

/** 第 6 章「背包与制作」：布料够做绷带（工作台 Lv.0 就能做，不用先造站台），另给枪与两种弹练装填。 */
export const BAG_PRESET: LabPreset = {
  seed: 'lab-bag-01',
  day: 1, ap: 14, mat: 20,
  hp: 100, hun: 85, thi: 85, sta: 100,
  inv: { crowbar: 1, pistol: 1, a9_fmj: 12, a9_ap: 6, cloth: 6, wood: 4, chem: 2, can: 2, water: 2 },
};

export const LAB_CHAPTERS: LabChapter[] = [
  {
    id: 'survival', icon: '🔥', name: '第 1 章 · 生存基础',
    desc: '活过第一天：看懂五条命、走出去搜两处、把肚子填上、睡进第二天。四条目标全绿就算通关。',
    ready: true,
    preset: SURVIVAL_PRESET,
    objectives: [
      { id: 'scav2', text: '🔍 搜刮 2 个区块（探索页 → 格子详情 → 搜索）', need: s => s.scav >= 2 },
      { id: 'deep1', text: '🔦 深度搜索 1 次（2 行动力，东西更好但更危险）', need: s => s.deep >= 1 },
      { id: 'feed', text: '🍖 把饱食与水分都补到 80 以上（背包里点「使用」）', need: s => s.hun >= 80 && s.thi >= 80 },
      { id: 'sleep', text: '😴 睡一觉进入第 2 天（「今夜」卡 → 就地生火过夜/回安全屋睡）', need: s => s.day >= 2 },
    ],
  },
  {
    id: 'combat', icon: '🔫', name: '第 2 章 · 战斗与枪械',
    desc: '把子弹打出去、也把撬棍用起来：招式槽（1~4 出招 / 5 逃跑 / 6 换武器）、噪音、装甲丧尸与穿甲弹。四条目标全绿才算通关。',
    ready: true,
    preset: COMBAT_PRESET,
    objectives: [
      { id: 'gunKill', text: '🔫 用枪打死 1 只（战斗里点招式槽；枪声会拉高噪音）', need: s => s.kills >= 1 && s.ammoUsed >= 1 },
      { id: 'meleeKill', text: '🗡️ 用近战打死 1 只（换上撬棍再打：近战不耗弹、但会挨咬）', need: s => s.meleeKills >= 1 },
      { id: 'loadSwap', text: '🔩 在背包「弹药」区手动装填一次弹种（9mm 普通弹 ↔ 穿甲弹）', need: s => Object.keys(s.load).length > 0 },
      /* M48：光"点过换弹"证明不了会用 —— 这条要真拿打得动装甲的弹种杀掉一只装甲目标。
         判定口径 pen ≥ armor（装甲丧尸 armor 5）：普通弹 pen 2 打出来不算，近战也不算。 */
      { id: 'apKill', text: '🛡️ 用穿甲弹打死 1 只装甲丧尸（各区都会刷；它很硬：用「连发」、该包扎就包扎、别舍不得穿甲弹）', need: s => s.apKills >= 1 },
    ],
  },
  {
    id: 'medical', icon: '🩺', name: '第 3 章 · 人体与伤病',
    desc: '开局自带两处伤（出血 + 骨折）：先急救止血、再给骨折上夹板，然后睡一觉让身体开始康复。三条目标全绿就算通关。',
    ready: true,
    preset: MEDICAL_PRESET,
    objectives: [
      { id: 'bleedFix', text: '🩸 把出血处理掉（人体页 → 选受伤部位 → 用绷带/急救包）', need: s => s.injuries.filter(i => i.id === 'bleedS' || i.id === 'bleedL').every(i => i.field || i.done) },
      { id: 'splintFix', text: '🦴 给骨折上夹板（夹板只是临时固定；要复位得回据点动手术）', need: s => s.injuries.filter(i => i.id === 'fracture').every(i => i.field || i.done) },
      { id: 'sleep3', text: '😴 睡一觉（吃着睡：康复要靠营养 + 睡觉，夜里翻倍）', need: s => s.day >= 2 },
    ],
  },
  {
    id: 'base', icon: '🏠', name: '第 4 章 · 建造与据点',
    desc: '长期变强全靠据点：先把净水装置和工作台立起来，再睡一觉看看"在家睡"和"野外睡"的差别。三条目标全绿就算通关。',
    ready: true,
    preset: BASE_PRESET,
    objectives: [
      { id: 'filter1', text: '🚰 建「净水装置」（据点 → 建设：之后每天产水）', need: s => (s.base.filter || 0) >= 1 },
      { id: 'bench1', text: '🛠️ 建「工作台」（解锁制作；材料来自搜刮与拆解）', need: s => (s.base.bench || 0) >= 1 },
      { id: 'sleep4', text: '😴 睡一觉进入第 2 天（安全屋睡满格、零夜袭）', need: s => s.day >= 2 },
    ],
  },
  {
    id: 'world', icon: '🌐', name: '第 5 章 · 地图与大区',
    desc: '危险度是从家往外涨的：走远一点、深搜一次，再修辆车**真的开去别的区**（跨大区的前提是车 + 油）。三条目标全绿就算通关。',
    ready: true,
    preset: WORLD_PRESET,
    objectives: [
      { id: 'walk8', text: '🥾 走过 8 个区块（走路 1 行动力/格，越往外危险度越高）', need: s => s.visited >= 8 },
      { id: 'deep5', text: '🔦 深度搜索 1 次（2 行动力：更容易出稀有物，但更危险）', need: s => s.deep >= 1 },
      /* M60：原来这条只要求"有车"（`s.veh`）—— 弄到车不等于会跨区，用户要的是"真的走一遍"。
         现在判定改成**真的搬过大区**（worldstate.switchRegion 里的 crossings 计数）：
         得先修车（🔧 修车点：12 材料 + 2 汽油），再在大区地图上点一个别的区、按「出发」。 */
      { id: 'cross5', text: '🚗 修辆车，真的开去另一个大区（大区地图 → 点别的区域 → 「出发」；一箱油 + 一天体力最多 4 格）',
        need: s => s.crossings >= 1 },
    ],
  },
  {
    id: 'bag', icon: '🎒', name: '第 6 章 · 背包与制作',
    desc: '背包是第一生产力：做点东西、按口径装填子弹、把家当攒起来。三条目标全绿就算通关。',
    ready: true,
    preset: BAG_PRESET,
    objectives: [
      { id: 'craft6', text: '🔨 制作 1 件东西（制作页 → 工作台 → 绷带：布料×2，不用先造站台）', need: s => s.crafted >= 1 },
      { id: 'load6', text: '🔩 在背包「弹药」区手动装填一次弹种（9mm 普通弹 ↔ 穿甲弹）', need: s => Object.keys(s.load).length > 0 },
      { id: 'bag6', text: '🎒 背包里攒到 6 种不同的东西（重量有上限，别什么都往身上塞）', need: s => s.invKinds >= 6 },
    ],
  },
];

export const chapterById = (id: string): LabChapter | null => LAB_CHAPTERS.find(c => c.id === id) || null;

export interface LabEvalItem { id: string; text: string; done: boolean }
export interface LabEval { items: LabEvalItem[]; green: number; total: number; passed: boolean }

/** 章节目标逐条判绿；**全绿才算过**（用户拍板的口径） */
export function evalChapter(ch: LabChapter, snap: LabSnap | null): LabEval {
  const items = ch.objectives.map(o => ({ id: o.id, text: o.text, done: !!snap && !!o.need(snap) }));
  const green = items.filter(i => i.done).length;
  const total = items.length;
  return { items, green, total, passed: total > 0 && green === total };
}

/**
 * 勾选是**单调**的：达成过就不再收回。
 * 为什么需要：目标里有"把饱食与水分补到 80"这种会被后续行为反噬的条目 —— 探针实测
 * 吃饱（81/100）→ 睡一觉 → 夜里又饿到 79，那一条就变回未完成，章节永远差一条。
 * 教学清单的口径应该是"做到过就算过"，所以由调用方维护一份"达成过"的 id 集合，这里做合并。
 */
export function mergeSticky(ev: LabEval, sticky: ReadonlySet<string>): { ev: LabEval; sticky: Set<string> } {
  const next = new Set(sticky);
  const items = ev.items.map(i => {
    if (i.done) next.add(i.id);
    return { ...i, done: i.done || next.has(i.id) };
  });
  const green = items.filter(i => i.done).length;
  return { ev: { items, green, total: items.length, passed: items.length > 0 && green === items.length }, sticky: next };
}

/* ── 进度（存父页面，不进 iframe、不进存档） ── */
export const LAB_KEY = 'zsv-lab-v1';

/** M60：`seq` = 「按顺序解锁」开关。**默认关**（六章都直接可玩、只给软建议顺序）——
 *  用户口径：「硬解锁只在菜单里手动打开，不能让想练第 6 章的人被第 1 章卡住」。 */
export interface LabProgress { done: Record<string, number>; seq: boolean }

export function parseProgress(raw: string | null): LabProgress {
  const out: LabProgress = { done: {}, seq: false };
  if (!raw) return out;
  try {
    const j = JSON.parse(raw);
    const src = (j && typeof j === 'object' && j.done && typeof j.done === 'object') ? j.done : {};
    for (const k in src) { const v = n(src[k]); if (v > 0) out.done[k] = v; }
    out.seq = !!(j && typeof j === 'object' && j.seq === true);      // 坏偏好当"关"，不抛
  } catch { /* 坏偏好当没进度，不抛 */ }
  return out;
}

export const serializeProgress = (p: LabProgress): string => JSON.stringify({ v: 2, done: p.done, seq: !!p.seq });

/** 切换「按顺序解锁」（只动这个开关，不动通关记录） */
export const toggleSeq = (p: LabProgress): LabProgress => ({ done: p.done, seq: !p.seq });

/** 标记通关（已通关的不覆盖时间戳，保留"第一次过"的时刻） */
export function markDone(p: LabProgress, chId: string, now: number): LabProgress {
  const done = { ...p.done };
  if (!done[chId]) done[chId] = now;
  return { done, seq: p.seq };
}

export const isDone = (p: LabProgress, chId: string): boolean => !!p.done[chId];

/**
 * M60：这一章现在能不能进。
 * 默认（`seq=false`）**全部可进** —— 软建议顺序只体现在卡上的「👉 建议从这里开始」；
 * 打开「按顺序解锁」后要**前面所有可玩章节都通关**才放行（这才叫硬解锁）。
 */
export function chapterUnlocked(id: string, p: LabProgress): boolean {
  if (!p.seq) return true;
  const idx = LAB_CHAPTERS.findIndex(c => c.id === id);
  if (idx < 0) return false;
  return LAB_CHAPTERS.slice(0, idx).filter(c => c.ready).every(c => isDone(p, c.id));
}

/** 锁着的话，先该做哪一章（排在它前面、还没通关的第一个） */
export function lockGateOf(id: string, p: LabProgress): LabChapter | null {
  const idx = LAB_CHAPTERS.findIndex(c => c.id === id);
  if (idx < 0) return null;
  return LAB_CHAPTERS.slice(0, idx).find(c => c.ready && !isDone(p, c.id)) || null;
}

/** 锁定原因（含"怎么关掉"的出口，别让玩家卡在门上找不到开关） */
export function lockReason(id: string, p: LabProgress): string {
  const gate = lockGateOf(id, p);
  return '「按顺序解锁」开着：先通关 ' + (gate ? gate.icon + ' ' + gate.name : '前面几章') +
    '；只想练这一章就把沙盒右上角的开关关掉。';
}

/** 进度摘要（章节列表上那行小字） */
export function progressLine(p: LabProgress): string {
  const ready = LAB_CHAPTERS.filter(c => c.ready).length;
  const ok = LAB_CHAPTERS.filter(c => c.ready && isDone(p, c.id)).length;
  return ready ? ('已通关 ' + ok + ' / ' + ready + ' 章') : '暂无可玩章节';
}

/**
 * M33.1 入门动线：**第一个还没通关的可玩章节**（M60：还要是"已解锁"的）。
 * 六章默认没有硬解锁（都直接可玩），但新手需要一个"从哪开始"的答案：
 * 章节卡上给它挂「👉 建议从这里开始」，打开沙盒时也默认选中它。
 * 全通关了就回第一章（复看/重练）。
 */
export function firstOpenChapter(p: LabProgress): string {
  const open = LAB_CHAPTERS.filter(c => c.ready && chapterUnlocked(c.id, p));
  const next = open.find(c => !isDone(p, c.id));
  return (next || open[0] || LAB_CHAPTERS[0]).id;
}

/** 章节卡右上角那枚徽章（文案在这里，UI 只负责贴） */
export function chapterBadge(ch: LabChapter, p: LabProgress): { text: string; cls: string } {
  if (!ch.ready) return { text: '下一批', cls: 'wpn' };
  if (!chapterUnlocked(ch.id, p)) return { text: '🔒 按顺序解锁中', cls: 'wpn' };
  if (isDone(p, ch.id)) return { text: '✅ 已通关', cls: 'key' };
  return ch.id === firstOpenChapter(p) ? { text: '👉 建议从这里开始', cls: 'ok' } : { text: '可玩', cls: '' };
}

/** 通关一章之后给一句接话（没有下一章就说"六章都通了"） */
export function nextChapterHint(p: LabProgress, justDone: string): string {
  const next = LAB_CHAPTERS.find(c => c.ready && c.id !== justDone && !isDone(p, c.id));
  if (!next) return '🎉 六章全部通关 —— 想复看的话随时点章节卡重进。';
  return '下一章建议：' + next.icon + ' ' + next.name + '（点左边的章节卡继续）。';
}

/**
 * 沙盒 iframe 的地址：**丢掉父页面除 `dev` 之外的查询串**（`?dev=ready` 这类开发标记要带进去 ——
 * 探针要在沙盒里用 `DEV.gotoPoi` 之类；生产环境父页面本来就没有 dev 参数，所以等于不带），
 * 只保留路径 + `sandbox=1&ch=<章节>`。
 */
export function sandboxUrl(href: string, chId: string): string {
  const raw = String(href || '');
  const path = raw.split('?')[0].split('#')[0];
  const dev = new URLSearchParams(raw.split('?')[1] ? raw.split('?')[1].split('#')[0] : '').get('dev');
  return path + '?sandbox=1&ch=' + encodeURIComponent(chId) + (dev ? '&dev=' + encodeURIComponent(dev) : '');
}

/** iframe 里跑的就是沙盒（main.ts 用它决定"不读档、不落盘、不弹教程"） */
export function labFromSearch(search: string): { ch: string } | null {
  const q = new URLSearchParams(String(search || ''));
  if (q.get('sandbox') !== '1') return null;
  const id = q.get('ch') || 'survival';
  return { ch: chapterById(id) ? id : 'survival' };
}

/** 沙盒开局的存档对象（legacy 侧只负责套用，判定逻辑都在这儿） */
export function labStateOf(chId: string): { seed: string; preset: LabPreset } {
  const ch = chapterById(chId) || LAB_CHAPTERS[0];
  return { seed: ch.preset.seed, preset: ch.preset };
}
