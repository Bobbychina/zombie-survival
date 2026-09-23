/* M72b 传闻口径：大区的**危险度与辐射**不再直接给结论，而是"你要么自己去过、要么听别人说"。
 *
 * 用户口径（ROADMAP 第 5 条后半）原话：
 *   「危险度与辐射从"直接写结论"改成"幸存者传闻"，第一次进区事件概率更高。」
 *
 * 三条设计规则（都由单测 + 探针钉住）：
 *   ① **没去过 = 只有传闻**：不给精确档位，只给一个**区间**（"危险 3~5"）与**出处**（"幸存者说…"），
 *      但必须给出"能不能去"的**定性判断**（多半能应付 / 他们没回来过）——不能因为模糊就让玩家没法决策；
 *   ② **去过 = 实测记录**：精确数值 + 上次到访的时间与结果（撞上什么、掉了多少血）；
 *   ③ **同一存档内稳定**：传闻由「存档种子 + 区域 id + 传闻届次」派生（`rumorSeedOf`），
 *      既不是每帧随机、也不是全局常量 —— 换一局（换种子）传闻就变一批，天数往后走幸存者口供也会换届
 *      （`RUMOR_EPOCH_DAYS`）。同一天内刷新/读档，看到的传闻**逐字一致**。
 *
 * 一个刻意的取舍：传闻区间**总是包住**真值（偏高/偏低体现在区间的偏斜上），
 * 但"信以为真的档位"= 区间中点（`mid`）可以偏 1 档 —— 危险度图层按 `mid` 上色，
 * 所以没去过的格子颜色就是"你以为的难度"，可能不准；去过之后才换成实测色。
 */
import { hash32 } from './region-danger';
import { dangerLabel } from './regions-core';

/** 传闻换届周期（天）：幸存者的口供每 4 天换一批（同一存档内稳定，跨届会变） */
export const RUMOR_EPOCH_DAYS = 4;
/** 措辞/权重/文案池改了要 +1：旧存档的传闻会被重掷到新口径（不是坏档，只是"传闻变了"） */
export const RUMOR_VER = 1;

export type VerdictKey = 'safe' | 'easy' | 'risky' | 'hard' | 'deadly' | 'clean' | 'warm' | 'hot' | 'dead';

export interface RumorBand { lo: number; hi: number }

/** 区间文案（"3~5"；只有一格宽时退化成单个数字） */
export const bandText = (b: RumorBand): string => (b.hi > b.lo ? b.lo + '~' + b.hi : String(b.lo));
/** 区间中点 = 玩家"信以为真"的那一档（危险度图层上色、悬停文案都用它） */
export const bandMid = (b: RumorBand): number => Math.round((b.lo + b.hi) / 2);

const clampTier = (v: number): number => Math.max(1, Math.min(5, Math.round(Number(v) || 1)));
const clampRad = (v: number): number => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));

/** 32 位小 PRNG（同一个 key 永远同一条口供；不引依赖、可单测） */
function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 第 day 天属于第几届传闻（0 起） */
export const rumorEpoch = (day: number): number =>
  Math.floor(Math.max(0, Math.floor(Number(day) || 0)) / RUMOR_EPOCH_DAYS);

/** 传闻的随机种子：**同存档 + 同区域 + 同届** → 同一个数（刷新/读档逐字一致就靠它） */
export const rumorSeedOf = (seed: string, id: string, day: number, salt: string): number =>
  hash32(String(seed ?? '') + '|' + String(id ?? '') + '|' + rumorEpoch(day) + '|' + salt + '|v' + RUMOR_VER);

/* ── 出处与口供的文案池（都写成"有人在转述"，不是系统在报数） ───────────────────── */
const SOURCES = [
  '一个从北边绕回来的幸存者说',
  '集散点换水时，一个瘸腿的老兵说',
  '无线电里有人插进来一句',
  '加油站墙上有人用炭笔写着',
  '一个用两盒罐头换你半瓶水的人说',
  '守夜的人压着嗓子说',
  '地下室那家人隔着门缝说',
  '路上碰到的拾荒者说',
  '补给点的门板上有人刻着一行字',
  '一个刚从那边逃回来的女人说',
];

/** 口供按"传闻偏凶 / 偏轻 / 差不多"三档给（{lo}/{hi} 会被填成区间） */
const DANGER_QUOTES: Record<'spot' | 'high' | 'low', string[]> = {
  high: [
    '别去，那地方危险 {lo}~{hi}，我们仨进去只回来俩。',
    '那边真不是人待的，危险 {lo}~{hi} 往上——我鞋都跑丢了一只。',
    '听我的绕开，危险 {lo}~{hi}，白天的队都折在里面过。',
  ],
  low: [
    '没传的那么邪，顶多危险 {lo}~{hi}，白天进去转一圈就出来。',
    '危险 {lo}~{hi} 吧，贴边走、别贪，能捞着东西。',
    '他们说得吓人，其实危险 {lo}~{hi}，我上礼拜刚去过。',
  ],
  spot: [
    '危险大概 {lo}~{hi}，走一趟心里得有数。',
    '我们量过，危险 {lo}~{hi} 上下，带够弹药再去。',
    '危险 {lo}~{hi}，别一个人去，也别在那儿过夜。',
  ],
};

const RAD_QUOTES_DIRTY = [
  '那片的计数器响得停不下来，我是贴着边绕过去的。',
  '别往那片走，嘴里的金属味半天散不掉。',
  '我进去过一次，回来吐了三天，头发一抓一把。',
  '铁皮摸上去都发烫，那地方不是给人待的。',
];
const RAD_QUOTES_CLEAN = [
  '那片没听说过有辐射，计数器一直是安静的。',
  '我在那边睡过一晚，没觉得哪儿不对。',
  '有人说干净，也有人说铁皮发烫——你自己掂量。',
];

const fill = (tpl: string, b: RumorBand): string => tpl.replace(/\{lo\}/g, String(b.lo)).replace(/\{hi\}/g, String(b.hi));

/**
 * 造一个**包住真值**的区间，并按 bias 决定"信以为真的中点"偏哪一边。
 *   · 区间永远含真值 —— 这是"误差区间"的底线（传得再离谱也不许把危险 5 说成 1~2）；
 *    · 偏斜体现在区间的**形状**上：传得更凶就往高处长（3 档 → 3~4 / 3~5），
 *      传得更轻就往低处长（3 档 → 2~3 / 1~3），传得准就以真值居中（3 档 → 2~4）；
 *    · 贴到 1/5 边界时向另一侧长（tier=5 又想往高处传 → 3~5，正好是需求里那个例子）。
 * 可证：无论如何 `lo <= tier <= hi` 且 `hi > lo`（spread ≥ 1）。
 */
export function bandFor(tier: number, bias: 'spot' | 'high' | 'low', spread: number): RumorBand {
  const t = clampTier(tier);
  const n = Math.max(1, Math.floor(spread) || 1);
  const grow: ('hi' | 'lo')[] = bias === 'high' ? new Array(n).fill('hi')
    : bias === 'low' ? new Array(n).fill('lo')
      : n === 1 ? ['lo'] : ['hi', 'lo'];
  let lo = t, hi = t;
  for (const side of grow) {
    if (side === 'hi') { if (hi < 5) hi++; else lo = Math.max(1, lo - 1); }
    else { if (lo > 1) lo--; else hi = Math.min(5, hi + 1); }
  }
  return { lo, hi };
}

/* ── 定性判断（"能不能去"）—— 取区间的**悲观端**：传闻说可能到 5，就得按 5 准备 ──── */
export function dangerVerdict(hi: number): { key: VerdictKey; text: string } {
  const h = clampTier(hi);
  if (h <= 1) return { key: 'safe', text: '闭着眼都能走' };
  if (h === 2) return { key: 'easy', text: '多半能应付' };
  if (h === 3) return { key: 'risky', text: '能去，但得带够弹药' };
  if (h === 4) return { key: 'hard', text: '一个人最好别去' };
  return { key: 'deadly', text: '他们说去的人没回来过' };
}

export function radVerdict(hi: number): { key: VerdictKey; text: string } {
  const h = clampRad(hi);
  if (h <= 0) return { key: 'clean', text: '应该没有辐射源' };
  if (h === 1) return { key: 'warm', text: '有点脏，别在那儿过夜' };
  if (h === 2) return { key: 'hot', text: '得带碘片，进去就快点出来' };
  return { key: 'dead', text: '那片基本是死地' };
}

/* ── ① 没去过：传闻 ───────────────────────────────────────────────────────── */
export interface DangerRumor {
  kind: 'rumor';
  band: RumorBand;
  /** 玩家"信以为真"的档位（= 区间中点；可能就是错的） */
  mid: number;
  bias: 'spot' | 'high' | 'low';
  source: string;
  quote: string;
  verdict: VerdictKey;
  verdictText: string;
  /** 短句（格子悬停/标签用） */
  brief: string;
  /** 整句（"谁说的 + 原话"，详情面板用） */
  line: string;
}

export function dangerRumor(o: { seed: string; id: string; tier: number; day: number }): DangerRumor {
  const rnd = mulberry32(rumorSeedOf(o.seed, o.id, o.day, 'danger'));
  const r = rnd();
  /* 45% 传得差不多、27% 传得更凶、28% 传得更轻 —— 三种都能遇到，玩家不能全信 */
  const bias: DangerRumor['bias'] = r < 0.45 ? 'spot' : r < 0.72 ? 'high' : 'low';
  const spread = rnd() < 0.4 ? 2 : 1;                 // 区间宽度：多数 1 档，少数 2 档（"3~5"那种）
  const band = bandFor(o.tier, bias, spread);
  const source = SOURCES[Math.floor(rnd() * SOURCES.length)] ?? SOURCES[0];
  const pool = DANGER_QUOTES[bias];
  const quote = fill(pool[Math.floor(rnd() * pool.length)] ?? pool[0], band);
  const v = dangerVerdict(band.hi);
  return {
    kind: 'rumor', band, mid: bandMid(band), bias, source, quote,
    verdict: v.key, verdictText: v.text,
    brief: '🗣️ 传闻危险 ' + bandText(band) + ' · ' + v.text,
    line: source + '：「' + quote + '」',
  };
}

export interface RadRumor {
  kind: 'rumor';
  band: RumorBand;
  mid: number;
  source: string;
  quote: string;
  verdict: VerdictKey;
  verdictText: string;
  brief: string;
  line: string;
}

export function radRumor(o: { seed: string; id: string; radMax: number; day: number }): RadRumor {
  const rnd = mulberry32(rumorSeedOf(o.seed, o.id, o.day, 'rad'));
  const real = clampRad(o.radMax);
  let band: RumorBand, quote: string;
  if (real <= 0) {
    /* 真值干净也要给不确定性：有人说干净、有人说不一定 —— 但定性判断仍是"应该没有辐射源" */
    band = { lo: 0, hi: 1 };
    quote = RAD_QUOTES_CLEAN[Math.floor(rnd() * RAD_QUOTES_CLEAN.length)] ?? RAD_QUOTES_CLEAN[0];
  } else {
    const hi = clampRad(real + (rnd() < 0.4 ? 1 : 0));               // 传闻常把辐射往更脏的方向传
    const lo = clampRad(hi - (1 + (rnd() < 0.35 ? 1 : 0)));
    band = { lo: Math.min(lo, hi), hi };
    quote = RAD_QUOTES_DIRTY[Math.floor(rnd() * RAD_QUOTES_DIRTY.length)] ?? RAD_QUOTES_DIRTY[0];
  }
  const source = SOURCES[Math.floor(rnd() * SOURCES.length)] ?? SOURCES[0];
  /* 定性判断按**区间悲观端**：干净的地方也别把玩家吓跑（区间已经留了 0~1 的不确定性），
     所以"真值干净"时判断取洁端；真值脏的时候照旧按最脏的那端说。 */
  const v = real <= 0 ? radVerdict(0) : radVerdict(band.hi);
  return {
    kind: 'rumor', band, mid: bandMid(band), source, quote,
    verdict: v.key, verdictText: v.text,
    brief: '☢️ 传闻辐射 ' + bandText(band) + ' 级 · ' + v.text,
    line: source + '：「' + quote + '」',
  };
}

/* ── ② 去过：实测记录（精确数值 + 上次到访的时间/结果） ─────────────────────── */
export interface VisitRecord { day: number; hp: number; ev: string }

/** 上次到访的结果一句话（事件标题 + 掉血；没记录就直说没记录） */
export function visitResult(v: VisitRecord | null | undefined): string {
  if (!v || typeof v !== 'object') return '没留下别的记录';
  const ev = typeof v.ev === 'string' && v.ev ? '撞上「' + v.ev + '」' : '一路无事';
  const hp = Math.floor(Number(v.hp) || 0);
  return ev + (hp ? '（生命 ' + hp + '）' : '');
}

export interface DangerMeasured {
  kind: 'measured';
  tier: number;
  label: string;
  visits: number;
  firstDay: number;
  last: VisitRecord | null;
  brief: string;
  line: string;
}

export function dangerMeasured(o: { tier: number; visits?: number; firstDay?: number; last?: VisitRecord | null }): DangerMeasured {
  const tier = clampTier(o.tier);
  const label = dangerLabel(tier);
  const visits = Math.max(0, Math.floor(Number(o.visits) || 0));
  const firstDay = Math.max(0, Math.floor(Number(o.firstDay) || 0));
  const last = o.last && typeof o.last === 'object' ? o.last : null;
  const bits = ['实测：危险 ' + tier + '（' + label + '）'];
  if (visits > 1) bits.push('到过 ' + visits + ' 次');
  else if (visits === 1) bits.push('第 ' + (firstDay || 1) + ' 天第一次踏进来');
  if (last) bits.push('上次（第 ' + Math.max(0, Math.floor(Number(last.day) || 0)) + ' 天）：' + visitResult(last));
  return {
    kind: 'measured', tier, label, visits, firstDay, last,
    brief: '📋 实测危险 ' + tier + ' · ' + label,
    line: bits.join(' · '),
  };
}

export interface RadMeasured { kind: 'measured'; lv: number; brief: string; line: string }

export function radMeasured(lv: number): RadMeasured {
  const v = clampRad(lv);
  return {
    kind: 'measured', lv: v,
    brief: v <= 0 ? '☢️ 实测：没有辐射源' : '☢️ 实测辐射 最高 ' + v + ' 级',
    line: v <= 0
      ? '实测：这一带没有辐射源（盖革计数器一路安静）。'
      : '实测：最高 ' + v + ' 级 —— 核电站/废料场周边，越往里越强。',
  };
}

/* ── 组合读法（UI / 探针都只调这一个） ─────────────────────────────────────── */
export type DangerRead = DangerRumor | DangerMeasured;
export type RadRead = RadRumor | RadMeasured;

export interface RegionReadInput {
  seed: string;
  id: string;
  /** 真实危险度（传闻由它派生，但**不直接**露给玩家） */
  tier: number;
  /** 真实辐射上限 0~3（这一带最脏的那一格的等级） */
  radMax: number;
  day: number;
  /** 去过没有（= 存档里的 seenRegions） */
  seen: boolean;
  visits?: number;
  firstDay?: number;
  last?: VisitRecord | null;
}

export interface RegionRead { seen: boolean; danger: DangerRead; rad: RadRead }

export function regionRead(o: RegionReadInput): RegionRead {
  const seen = !!o.seen;
  const danger: DangerRead = seen
    ? dangerMeasured({ tier: o.tier, visits: o.visits, firstDay: o.firstDay, last: o.last })
    : dangerRumor({ seed: o.seed, id: o.id, tier: o.tier, day: o.day });
  const rad: RadRead = seen ? radMeasured(o.radMax) : radRumor({ seed: o.seed, id: o.id, radMax: o.radMax, day: o.day });
  return { seen, danger, rad };
}

/** UI 的"信以为真档位"：没去过按传闻中点、去过按实测 —— 危险度图层与格子角标都用它 */
export const beliefTier = (d: DangerRead): number => (d.kind === 'measured' ? d.tier : d.mid);

/* ── 存档白名单（ensureSaveWorld / legacy sanitizeSave 共用同一份清洗） ─────────
   两个字段都挂在 `S.world`（SaveWorld）上：
     · regionFirst: { 区域id: 第一次踏进来的第几天 }
     · regionLast : { 区域id: { day, hp, ev } } = 最近一次到访的时间与结果（实测记录要显示它）
   不清洗的后果与 M70/M72 前半踩过的坑一模一样：读档后"首次进区"判定重算
   → 事件概率又翻倍一次，而且"上次到访"会退回到没有记录。 */
const RID_RE = /^r\d{1,2}-\d{1,2}$/;

export interface RumorSaveFields { regionFirst?: Record<string, number>; regionLast?: Record<string, VisitRecord> }

/** 就地清洗（保留对象身份：ensure 每次 render 都会调，换新表会让 UI 手里的引用成孤儿） */
export function cleanRumorSave(sw: any): void {
  if (!sw || typeof sw !== 'object') return;
  const first = (sw.regionFirst && typeof sw.regionFirst === 'object') ? sw.regionFirst : (sw.regionFirst = {});
  for (const k in first) {
    const n = Math.floor(Number(first[k]));
    if (!RID_RE.test(k) || !isFinite(n) || n <= 0) delete first[k];
    else first[k] = Math.min(1e6, n);
  }
  const last = (sw.regionLast && typeof sw.regionLast === 'object') ? sw.regionLast : (sw.regionLast = {});
  for (const k in last) {
    const v = last[k];
    if (!RID_RE.test(k) || !v || typeof v !== 'object') { delete last[k]; continue; }
    const day = Math.floor(Number(v.day));
    const hp = Math.floor(Number(v.hp));
    const ev = typeof v.ev === 'string' ? v.ev.slice(0, 24) : '';
    if (!isFinite(day) || day <= 0) { delete last[k]; continue; }
    last[k] = { day: Math.min(1e6, day), hp: isFinite(hp) ? Math.max(-1000, Math.min(1000, hp)) : 0, ev };
  }
}

/** 记一次到访（首次进区时同时写下 regionFirst；纯函数式写法，UI 只管把结果塞回存档） */
export function noteVisit(sw: RumorSaveFields, id: string, day: number, rec?: { hp?: number; ev?: string } | null): void {
  if (!sw || !RID_RE.test(String(id))) return;
  const d = Math.max(1, Math.floor(Number(day) || 1));
  if (!sw.regionFirst || typeof sw.regionFirst !== 'object') sw.regionFirst = {};
  if (!sw.regionLast || typeof sw.regionLast !== 'object') sw.regionLast = {};
  if (!sw.regionFirst[id]) sw.regionFirst[id] = d;
  sw.regionLast[id] = { day: d, hp: Math.floor(Number(rec && rec.hp) || 0), ev: String((rec && rec.ev) || '').slice(0, 24) };
}
