/* 开发者回传 / 死亡台账（M20）——纯逻辑。
 *
 * 起因（用户 idea）：
 *   「开发者回传（匿名统计）：在玩家的许可下，死亡时自动把"死因、存活天数、地图区块"打点
 *    匿名发到某个统计端点。你能清晰知道哪个区块（比如"北军管"）太难，哪个地方太容易，
 *    从而不断调优你的地图生成算法。」
 *
 * 这里的取舍（重要）：
 *   · **默认只存在本机**，不自动联网。理由：这是个纯静态页游戏，没有我控制的服务器；
 *     而且"自动上传"在隐私上是需要玩家明确同意的行为，不能靠一句注释糊过去。
 *   · 玩家点「导出」才产出可分享的 JSON（复制到剪贴板 / 下载文件），自己发给开发者。
 *   · 台账本身是**调参用的**：按区块类型/具体区域聚合死亡数 + 平均存活天数，
 *     直接就能看出"哪类地貌在吃人"（例如军事管制 vs 城郊）。
 *   · 不含任何账号、姓名、IP、存档内容——只有：天数、死因、区域 id/类型、击杀数、当天材料。
 */
import { typeLabel, type RegionType } from './regions-core';

export type RunKind = 'death' | 'ending';

export interface RunRecord {
  kind: RunKind;
  day: number;
  cause: string;          // 死因（人话，来自 gameOver 的文案，已截断）
  region: string;         // 区域 id（如 r3-7）
  rtype: RegionType | '';  // 区域类型（聚合用；老记录可能没有）
  tier: number;           // 当时那片区域的危险度
  kills: number;
  mat: number;
  kills10?: number;       // 击杀数（分桶，进一步匿名化：10 的倍数）
  at: number;             // 时间戳（只到"天"级别就够，但存毫秒便于排序）
}

export const LEDGER_KEY = 'zsv_runs_v1';
export const MAX_RECORDS = 200;

/** 按天数分桶（导出时用，避免精确时间戳泄露游玩作息） */
const dayBucket = (t: number) => Math.floor(t / 86400000);

export function normalizeLedger(raw: unknown): RunRecord[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter(r => r && typeof r === 'object')
    .map(r => ({
      kind: (r.kind === 'ending' ? 'ending' : 'death') as RunKind,
      day: Math.max(1, Math.floor(Number(r.day) || 1)),
      cause: String(r.cause || '未知').slice(0, 60),
      region: String(r.region || '').slice(0, 12),
      rtype: (typeof r.rtype === 'string' ? r.rtype : '') as RegionType | '',
      tier: Math.max(1, Math.min(5, Math.floor(Number(r.tier) || 1))),
      kills: Math.max(0, Math.floor(Number(r.kills) || 0)),
      mat: Math.max(0, Math.floor(Number(r.mat) || 0)),
      at: Math.max(0, Math.floor(Number(r.at) || 0)),
    }))
    .slice(-MAX_RECORDS);
}

export const addRecord = (list: RunRecord[], rec: RunRecord): RunRecord[] => normalizeLedger([...list, rec]);

export interface RegionStat { key: string; label: string; deaths: number; avgDay: number }

/** 按"区域类型"聚合：哪类地貌在吃人（开发者调地图生成时最想看的一张表） */
export function byType(list: RunRecord[]): RegionStat[] {
  const bag: Record<string, { n: number; days: number }> = {};
  for (const r of list) {
    const k = r.rtype || '未知';
    bag[k] = bag[k] || { n: 0, days: 0 };
    bag[k].n++; bag[k].days += r.day;
  }
  return Object.keys(bag)
    .map(k => ({
      key: k,
      label: k === '未知' ? '未知' : typeLabel(k as RegionType),      // 面板上要显示"水域港区"而不是"water"
      deaths: bag[k].n, avgDay: Math.round((bag[k].days / bag[k].n) * 10) / 10,
    }))
    .sort((a, b) => b.deaths - a.deaths || a.avgDay - b.avgDay);
}

/** 按"具体区域"聚合：经常死在某一块地上的，多半是那块的生成/难度有问题 */
export function byRegion(list: RunRecord[]): RegionStat[] {
  const bag: Record<string, { n: number; days: number }> = {};
  for (const r of list) {
    const k = r.region || '未知';
    bag[k] = bag[k] || { n: 0, days: 0 };
    bag[k].n++; bag[k].days += r.day;
  }
  return Object.keys(bag)
    .map(k => ({ key: k, label: k, deaths: bag[k].n, avgDay: Math.round((bag[k].days / bag[k].n) * 10) / 10 }))
    .sort((a, b) => b.deaths - a.deaths);
}

/** 死因排行（"你在战斗里流干了最后一滴血"之类） */
export function byCause(list: RunRecord[], limit = 5): { cause: string; n: number }[] {
  const bag: Record<string, number> = {};
  for (const r of list) bag[r.cause] = (bag[r.cause] ?? 0) + 1;
  return Object.keys(bag).map(cause => ({ cause, n: bag[cause] })).sort((a, b) => b.n - a.n).slice(0, limit);
}

export interface HotspotReport {
  runs: number;
  deaths: number;
  endings: number;
  avgDay: number;
  medianDay: number;
  hardest: RegionStat[];     // 死亡最多的区块类型
  easiest: RegionStat[];     // 死亡最少的（"太容易"的候选）
  causes: { cause: string; n: number }[];
  /** 一句话结论，直接印在面板上 */
  verdict: string;
}

export function report(list: RunRecord[]): HotspotReport {
  const runs = list.length;
  const days = list.map(r => r.day).sort((a, b) => a - b);
  const avgDay = runs ? Math.round((days.reduce((a, b) => a + b, 0) / runs) * 10) / 10 : 0;
  const medianDay = runs ? days[Math.floor(runs / 2)] : 0;
  const types = byType(list).filter(t => t.key !== '未知');
  const hardest = types.slice(0, 3);
  const easiest = [...types].reverse().slice(0, 3);
  const causes = byCause(list);
  const verdict = !runs ? '还没有记录：死一次或通关一次就会记在这里（只存在本机）。'
    : hardest.length ? `最容易吃人的是「${hardest[0].label}」（${hardest[0].deaths} 次，平均第 ${hardest[0].avgDay} 天）` +
      (causes[0] ? `；最常见的死因是「${causes[0].cause}」` : '')
      : `玩了 ${runs} 局，平均活到第 ${avgDay} 天`;
  return { runs, deaths: list.filter(r => r.kind === 'death').length, endings: list.filter(r => r.kind === 'ending').length, avgDay, medianDay, hardest, easiest, causes, verdict };
}

/** 导出：匿名化的紧凑 JSON（给开发者调参用；不含账号/存档/精确时间） */
export function exportLedger(list: RunRecord[]): string {
  const rows = normalizeLedger(list).map(r => ({
    d: r.day, k: r.kind, c: r.cause, rg: r.region, rt: r.rtype, t: r.tier,
    k10: Math.floor(r.kills / 10) * 10, m10: Math.floor(r.mat / 10) * 10, db: dayBucket(r.at),
  }));
  return JSON.stringify({ v: 1, game: 'zombie-survival', exp: rows }, null, 0);
}

/** 导入（开发者收集别人的台账后合并看）：形状不对的条目直接丢 */
export function importLedger(text: string): RunRecord[] {
  try {
    const o = JSON.parse(text);
    const rows = Array.isArray(o?.exp) ? o.exp : [];
    return normalizeLedger(rows.map((r: Record<string, unknown>) => ({
      kind: r.k === 'ending' ? 'ending' : 'death',
      day: r.d, cause: r.c, region: r.rg, rtype: r.rt, tier: r.t,
      kills: Number(r.k10) || 0, mat: Number(r.m10) || 0, at: (Number(r.db) || 0) * 86400000,
    })));
  } catch { return []; }
}
