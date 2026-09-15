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
  loc: string;
  /** 生命归零（沙盒里不惩罚，只是提示重来） */
  over: boolean;
  inv: Record<string, number>;
  /** 玩家手动指定过的装填弹种 {口径: 弹种 id}（第 2 章"换弹"那条目标用它判定） */
  load: Record<string, string>;
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
  return {
    day: n(S && S.day, 1), hp: n(S && S.hp), hun: n(S && S.hun), thi: n(S && S.thi), ap: n(S && S.ap),
    scav: n(st.scav), deep: n(st.deep), crafted: n(st.crafted), kills: n(st.kills), meleeKills: n(st.meleeKills),
    ammoUsed: n(st.ammoUsed),
    loc: String((S && S.loc) || 'base'), over: !!(S && S.over), inv, load,
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

/** 没写 preset 的章节用这个（第 3~6 章还没做，所以它只是兜底） */
const DEFAULT_PRESET: LabPreset = { seed: 'lab-basic-01', day: 1, ap: 14, mat: 12, hp: 100, hun: 80, thi: 80, sta: 100, inv: { crowbar: 1, can: 1, water: 1 } };

/** 第 2 章「战斗与枪械」的沙盒开局：一把手枪 + 两种 9mm（普通弹与穿甲弹打装甲目标的手感不一样）
    + 撬棍（近战不耗弹但会挨咬）。饱食水分给足 —— 这一章不该被饿肚子打断。 */
export const COMBAT_PRESET: LabPreset = {
  seed: 'lab-combat-01',
  day: 1, ap: 14, mat: 12,
  hp: 100, hun: 85, thi: 85, sta: 100,
  inv: { pistol: 1, crowbar: 1, a9_fmj: 24, a9_ap: 8, bandage: 2, medkit: 1, can: 2, water: 2 },
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
    desc: '把子弹打出去、也把撬棍用起来：招式槽（1~4 出招 / 5 逃跑 / 6 换武器）、噪音、装甲丧尸与穿甲弹。三条目标全绿才算通关。',
    ready: true,
    preset: COMBAT_PRESET,
    objectives: [
      { id: 'gunKill', text: '🔫 用枪打死 1 只（战斗里点招式槽；枪声会拉高噪音）', need: s => s.kills >= 1 && s.ammoUsed >= 1 },
      { id: 'meleeKill', text: '🗡️ 用近战打死 1 只（换上撬棍再打：近战不耗弹、但会挨咬）', need: s => s.meleeKills >= 1 },
      { id: 'loadSwap', text: '🔩 在背包「弹药」区手动装填一次弹种（9mm 普通弹 ↔ 穿甲弹）', need: s => Object.keys(s.load).length > 0 },
    ],
  },
  { id: 'medical', icon: '🩺', name: '第 3 章 · 人体与伤病', desc: '七个部位、急救→手术→康复（下一批做）。', ready: false, preset: DEFAULT_PRESET, objectives: [] },
  { id: 'base', icon: '🏠', name: '第 4 章 · 建造与据点', desc: '净水、菜园、工作站的优先顺序（下一批做）。', ready: false, preset: DEFAULT_PRESET, objectives: [] },
  { id: 'world', icon: '🌐', name: '第 5 章 · 地图与大区', desc: '危险度是从家往外涨的：大区怎么走、辐射区怎么进（下一批做）。', ready: false, preset: DEFAULT_PRESET, objectives: [] },
  { id: 'bag', icon: '🎒', name: '第 6 章 · 背包与制作', desc: '重量、腐坏、弹药按口径装填（下一批做）。', ready: false, preset: DEFAULT_PRESET, objectives: [] },
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

export interface LabProgress { done: Record<string, number> }   // 章节 id → 首次通关时间戳

export function parseProgress(raw: string | null): LabProgress {
  const out: LabProgress = { done: {} };
  if (!raw) return out;
  try {
    const j = JSON.parse(raw);
    const src = (j && typeof j === 'object' && j.done && typeof j.done === 'object') ? j.done : {};
    for (const k in src) { const v = n(src[k]); if (v > 0) out.done[k] = v; }
  } catch { /* 坏偏好当没进度，不抛 */ }
  return out;
}

export const serializeProgress = (p: LabProgress): string => JSON.stringify({ v: 1, done: p.done });

/** 标记通关（已通关的不覆盖时间戳，保留"第一次过"的时刻） */
export function markDone(p: LabProgress, chId: string, now: number): LabProgress {
  const done = { ...p.done };
  if (!done[chId]) done[chId] = now;
  return { done };
}

export const isDone = (p: LabProgress, chId: string): boolean => !!p.done[chId];

/** 进度摘要（章节列表上那行小字） */
export function progressLine(p: LabProgress): string {
  const ready = LAB_CHAPTERS.filter(c => c.ready).length;
  const ok = LAB_CHAPTERS.filter(c => c.ready && isDone(p, c.id)).length;
  return ready ? ('已通关 ' + ok + ' / ' + ready + ' 章') : '暂无可玩章节';
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
