/* M6 · 野外采集与拆解（会议 F01/C5/C8）：
   - 采集：林地/农田/郊区等区块，1 AP，产出野果/蘑菇/木料/污水/种子；每区块有次数上限**且**季节再生，冬天几乎归零。
   - 拆解：报废车辆/废墟，1 AP，产材料；每区块资源池拆光为止（禁止无限材料机）。
   M8 · 伐木（玩家反馈"木头找不到"）：第三种就地动作，数值全在 wood-core.ts。
   与采集的区别：木头**任何季节都有保底**（冬天不掉到 0），代价是只能去有树的地方、且每天次数有限。 */
import { L } from '../main';
import { bkey } from './worldgen';
import { ensureSaveWorld, worldOf, type SaveWorld } from './worldstate';
import { FORAGE_AP, FORAGE_POOL, FORAGE_REGEN_DAYS, SALVAGE_AP, SALVAGE_POOL, forageYields, salvageYields } from './env-core';
import {
  CHOP_AP, chopEstimate, chopLeft, chopOnce, chopSpots, chopToolOf, type ChopTool,
} from './wood-core';
import { envOf, seasonNow, tempTick } from './env';
import type { Block } from '../types';

const sw = () => ensureSaveWorld(L.S);
const curBlock = (): Block | null => { const s = sw(); return (worldOf(s.seed, s.region).blocks[bkey(s.cur.x, s.cur.y)] as Block) ?? null; };

/** 采集点的剩余次数：每区块一份，采完要等几天再生 */
function forageLeft(s: SaveWorld, b: Block): number {
  const k = bkey(b.x, b.y);
  s.forage = s.forage && typeof s.forage === 'object' ? s.forage : {};
  const rec = s.forage[k];
  const pool = FORAGE_POOL[b.biome] ?? 2;
  if (!rec) return pool;
  // 再生：每 FORAGE_REGEN_DAYS 天回 1 点（用"上次采的天数"记账）
  const regen = Math.floor((L.S.day - (rec.day || L.S.day)) / FORAGE_REGEN_DAYS);
  return Math.max(0, Math.min(pool, (rec.left ?? pool) + regen));
}
function useForage(s: SaveWorld, b: Block) {
  const k = bkey(b.x, b.y);
  s.forage = s.forage && typeof s.forage === 'object' ? s.forage : {};
  const left = forageLeft(s, b) - 1;
  s.forage[k] = { left: Math.max(0, left), day: L.S.day };
}

export function forageInfo(): { ok: boolean; left: number; why?: string } {
  const b = curBlock();
  if (!b) return { ok: false, left: 0, why: '不知道你在哪' };
  const pool = FORAGE_POOL[b.biome] ?? 0;
  if (pool <= 0) return { ok: false, left: 0, why: '这一带没有能采的东西（林地/农田/郊区才行）' };
  const left = forageLeft(sw(), b);
  if (left <= 0) return { ok: false, left: 0, why: '这一片被你采光了，过几天再来' };
  return { ok: true, left };
}

/** 采集（1 AP） */
export function forage(): boolean {
  const S = L.S, s = sw(), b = curBlock();
  const info = forageInfo();
  if (!b) return false;
  if (!info.ok) { L.toast('采不到', info.why ?? '', 'bad'); return false; }
  const used = forageYields(Math.random, b.biome, seasonNow(), envOf().weather);
  const total = used.items.reduce((a, i) => a + i.n, 0);
  if (total === 0) {
    // 冬天/恶劣天气：扣了 AP 但基本空手——这就是"冬天采集≈0"的代价
    if (!L.spendAP(FORAGE_AP)) return false;
    useForage(s, b);
    L.log(`🧺 你在${b.name}转了一圈：这个季节什么也没采到（${seasonIcon()}）。`, 'dim');
    tempTick(1);
    L.autosave(); L.render();
    return true;
  }
  if (!L.spendAP(FORAGE_AP)) return false;
  useForage(s, b);
  /* M24 采集技能：产量 +8%/级；Lv3 perk 每次再多 1 份 */
  const bonus = Math.min(0.6, Number((L.S as any).skills?.gather ?? 0) * 0.08);
  const extra = scoutExtra(used.items.length);
  for (const it of used.items) {
    const n = Math.max(1, Math.round(it.n * (1 + bonus))) + (extra ? 1 : 0);
    L.grant(it.id, n);
    it.n = n;
  }
  L.addXP('gather', 1);
  L.log(`🧺 采集：${used.items.map(i => L.itemName(i.id) + '×' + i.n).join('、')}（这里还能采 ${Math.max(0, info.left - 1)} 次）。` +
    (extra ? '　🪓 采集技能 +1' : ''), 'loot');
  tempTick(1);
  L.sfx('loot'); L.autosave(); L.render();
  return true;
}

const seasonIcon = () => ({ spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' } as Record<string, string>)[seasonNow()] ?? '';

/** M24 采集 Lv3 perk：每类产出再多 1 份（伐木/采集/拆解共用） */
function scoutExtra(_n: number): number {
  return Number((L.S as any).skills?.gather ?? 0) >= 3 ? 1 : 0;
}

/* ── M8 · 伐木 ── */
const chopRec = (s: SaveWorld, b: Block) => {
  s.chop = s.chop && typeof s.chop === 'object' ? s.chop : {};
  return s.chop[bkey(b.x, b.y)];
};

export const chopToolNow = (): ChopTool => chopToolOf(L.itemCount('axe'), L.itemCount('crowbar'));
const toolLabel = (t: ChopTool) => (t === 'axe' ? '消防斧加成' : t === 'crowbar' ? '撬棍加成' : '徒手');

/** 伐木面板要的全部信息：能不能砍、今天还剩几次、这一斧大约几根木头、为什么不能砍 */
export function chopInfo(): { ok: boolean; left: number; est: number; tool: ChopTool; why?: string } {
  const b = curBlock();
  const tool = chopToolNow();
  if (!b) return { ok: false, left: 0, est: 0, tool, why: '不知道你在哪' };
  const est = chopEstimate(b.biome, seasonNow(), envOf().weather, tool);
  if (chopSpots(b.biome) <= 0) return { ok: false, left: 0, est, tool, why: '这一带没有树（林地/废墟/农田/郊区才能砍）' };
  const left = chopLeft(chopRec(sw(), b), L.S.day, b.biome);
  if (left <= 0) return { ok: false, left: 0, est, tool, why: '今天的柴火砍够了，明天再来' };
  return { ok: true, left, est, tool };
}

/** 伐木（1 AP）→ 木料为主，少量附带树枝捆/废铁；每天每区块有次数上限 */
export function chop(): boolean {
  const S = L.S, s = sw(), b = curBlock();
  if (!b) return false;
  const info = chopInfo();
  if (!info.ok) { L.toast('砍不动', info.why ?? '', 'bad'); return false; }
  // 先掷骰再扣 AP：上限/群系不合格时一分行动力都不该花
  const res = chopOnce(Math.random, {
    biome: b.biome, season: seasonNow(), weather: envOf().weather, tool: info.tool, left: info.left,
  });
  if (!res.ok) { L.toast('砍不动', res.why ?? '', 'bad'); return false; }
  if (!L.spendAP(CHOP_AP)) return false;
  s.chop = s.chop && typeof s.chop === 'object' ? s.chop : {};
  s.chop[bkey(b.x, b.y)] = { left: res.left, day: S.day };
  /* M24 采集技能：伐木也吃加成（+8%/级，Lv3 起每斧再多 1 根） */
  const bonus = Math.min(0.6, Number((L.S as any).skills?.gather ?? 0) * 0.08);
  const wood = Math.max(1, Math.round(res.wood * (1 + bonus))) + scoutExtra(1);
  const parts = ['木料×' + wood];
  L.grant('wood', wood);
  for (const it of res.extra) { L.grant(it.id, it.n); parts.push(L.itemName(it.id) + '×' + it.n); }
  L.addXP('gather', 1);
  L.log(`🪵 伐木：${parts.join('、')}（${toolLabel(info.tool)}，这里今天还能砍 ${res.left} 次）`, 'loot');
  tempTick(1.5);        // 抡斧头是重体力活：比采集更掉体温
  L.sfx('loot'); L.autosave(); L.render();
  return true;
}

/** 拆解点的剩余资源 */
function salvageLeft(s: SaveWorld, b: Block): number {
  const k = bkey(b.x, b.y);
  s.salvage = s.salvage && typeof s.salvage === 'object' ? s.salvage : {};
  const rec = s.salvage[k];
  const pool = SALVAGE_POOL[b.biome] ?? 2;
  return rec ? Math.max(0, rec.left ?? pool) : pool;
}

export function salvageInfo(): { ok: boolean; left: number; why?: string } {
  const b = curBlock();
  if (!b) return { ok: false, left: 0, why: '不知道你在哪' };
  const pool = SALVAGE_POOL[b.biome] ?? 0;
  if (pool <= 0) return { ok: false, left: 0, why: '这一带没有能拆的东西' };
  const left = salvageLeft(sw(), b);
  if (left <= 0) return { ok: false, left: 0, why: '这一带的废料被你拆光了' };
  return { ok: true, left };
}

/** 拆解（1 AP）→ 材料为主 */
export function salvage(): boolean {
  const S = L.S, s = sw(), b = curBlock();
  const info = salvageInfo();
  if (!b) return false;
  if (!info.ok) { L.toast('拆不了', info.why ?? '', 'bad'); return false; }
  if (!L.spendAP(SALVAGE_AP)) return false;
  const k = bkey(b.x, b.y);
  s.salvage = s.salvage && typeof s.salvage === 'object' ? s.salvage : {};
  s.salvage[k] = { left: Math.max(0, info.left - 1) };
  const got = salvageYields(Math.random, b.biome, b.danger);
  /* M24 采集技能：拆解同样吃加成 */
  const bonus = Math.min(0.6, Number((L.S as any).skills?.gather ?? 0) * 0.08);
  const extra = scoutExtra(1);
  const parts: string[] = [];
  for (const it of got.items) {
    const n = Math.max(1, Math.round(it.n * (1 + bonus))) + extra;
    if (it.id === 'MAT') { S.mat += n; parts.push('材料×' + n); }
    else { L.grant(it.id, n); parts.push(L.itemName(it.id) + '×' + n); }
  }
  L.addXP('gather', 1);
  // 噪音：拆东西很吵
  S.noise += 1;
  L.log(`🔧 拆解：${parts.join('、')}（这里还能拆 ${Math.max(0, info.left - 1)} 次）`, 'loot');
  tempTick(1);
  L.sfx('loot'); L.autosave(); L.render();
  return true;
}
