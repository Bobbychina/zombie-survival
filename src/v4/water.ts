/* M7 · 水体互动的运行时：钓鱼 / 下水（游泳赶路）/ 潜水搜沉没基地 / 鱼塘。
   数值全部来自 water-core.ts（与测试、模拟脚本同源）。 */
import { L } from '../main';
import { POIS } from './pois';
import { bkey, blockAt } from './worldgen';
import { ensureSaveWorld, markVisited, worldOf, type SaveWorld } from './worldstate';
import { WEATHER, seasonOf, tempDeltaText, tempPenalty } from './env-core';
import { envOf, seasonNow, tempTick } from './env';
import { buildCostText } from './farm';
import {
  BAIT, DIVE_AP, DIVE_HP_PER_EXTRA, FISH, FISH_AP, FISH_SPOTS_PER_BLOCK, INTAKE_AP, INTAKE_PER_ACTION, INTAKE_PER_DAY,
  O2, O2_PER_TANK, POND_FEED_ITEMS,
  ROD, SWIM_AP_PER_BLOCK, SWIM_STA, SWIM_TEMP, WETSUIT, diveBudget, fishChance, fishOnce, pickDiveLoot, pondYield, swimRisk,
} from './water-core';
import type { Block } from '../types';

const sw = () => ensureSaveWorld(L.S);
const curBlock = (): Block | null => { const s = sw(); return (worldOf(s.seed, s.region).blocks[bkey(s.cur.x, s.cur.y)] as Block) ?? null; };
const hasWetsuit = () => {
  const S = L.S as any;
  return S.eq?.body === WETSUIT || L.itemCount(WETSUIT) > 0;
};
const isNight = () => { const p = String(L.phaseName ? L.phaseName()[0] : ''); return p.includes('夜') || p.includes('黄'); };

/** 相邻有没有水（能不能站在这儿钓） */
export function waterNearby(): { any: boolean; blocks: Block[] } {
  const s = sw(), w = worldOf(s.seed, s.region), b = curBlock();
  if (!b) return { any: false, blocks: [] };
  const out: Block[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nb = blockAt(w, b.x + dx, b.y + dy);
    if (nb && nb.biome === 'water') out.push(nb);
  }
  return { any: out.length > 0, blocks: out };
}

/* ── 钓鱼 ── */
function fishLeft(s: SaveWorld, key: string): number {
  s.fish = s.fish && typeof s.fish === 'object' ? s.fish : {};
  const rec = s.fish[key];
  if (!rec || rec.day !== L.S.day) return FISH_SPOTS_PER_BLOCK;   // 每天刷新
  return rec.left ?? FISH_SPOTS_PER_BLOCK;
}

export function fishInfo(): { ok: boolean; left: number; chance: number; why?: string } {
  const near = waterNearby();
  const s = sw(), key = bkey(s.cur.x, s.cur.y);
  const rod = L.itemCount(ROD) > 0, bait = L.itemCount(BAIT) > 0;
  const p = fishChance(seasonNow(), envOf().weather, rod, bait, isNight());
  if (!near.any) return { ok: false, left: 0, chance: p, why: '这一带没有水（河边、湖边、水厂才行）' };
  const left = fishLeft(s, key);
  if (left <= 0) return { ok: false, left: 0, chance: p, why: '今天这一片已经钓够了，明天再来' };
  return { ok: true, left, chance: p };
}

export function fish(): boolean {
  const S = L.S, s = sw();
  const near = waterNearby();
  if (!near.any) { L.toast('没水', '河边/湖边才能钓——地图上蓝色的格子。', 'bad'); return false; }
  const key = bkey(s.cur.x, s.cur.y);
  const left = fishLeft(s, key);
  if (left <= 0) { L.toast('今天钓够了', '同一片水域每天最多钓 ' + FISH_SPOTS_PER_BLOCK + ' 次。', 'bad'); return false; }
  if (!L.spendAP(FISH_AP)) return false;
  const rod = L.itemCount(ROD) > 0, bait = L.itemCount(BAIT) > 0;
  if (bait) L.takeItem(BAIT, 1);
  const res = fishOnce(Math.random, seasonNow(), envOf().weather, rod, bait, isNight());
  s.fish = s.fish && typeof s.fish === 'object' ? s.fish : {};
  s.fish[key] = { left: left - 1, day: L.S.day };
  if (res.item) L.grant(res.item, res.n);
  L.log((res.item ? '🎣 ' : '🎣 ') + res.text + `（${SEASON_LINE()}，剩 ${left - 1} 次）`, res.item ? 'loot' : 'dim');
  tempTick(0.5);            // 在水边站着也冷
  L.sfx(res.item ? 'loot' : 'ui');
  L.autosave(); L.render();
  return true;
}
const SEASON_LINE = () => `${({ spring: '春', summer: '夏', autumn: '秋', winter: '冬' } as Record<string, string>)[seasonNow()]}·${WEATHER[envOf().weather].name}`;

/* ── 下水（游泳赶路）── */
export function canSwim(): { ok: boolean; why?: string; note: string } {
  const gear = hasWetsuit();
  const season = seasonNow();
  const cold = season === 'winter' || envOf().weather === 'cold' || envOf().weather === 'snow';
  return {
    ok: true,
    note: (gear ? '🤿 有潜水服：不会被水冻僵，也不会抽筋' : '⚠️ 没潜水服：可能抽筋、感染、丢东西') +
      (cold ? '（现在的水很冷）' : ''),
  };
}

/** 游一格水：扣行动力/体力/体温，掷风险 */
export function swimStep(dir: { x: number; y: number }): boolean {
  const S = L.S as any, s = sw(), w = worldOf(s.seed, s.region);
  const target = blockAt(w, dir.x, dir.y);
  if (!target) return false;
  if (target.biome !== 'water') { L.toast('那儿不是水', '游泳只用来过水。', 'bad'); return false; }
  if (!L.spendAP(SWIM_AP_PER_BLOCK)) return false;
  const gear = hasWetsuit();
  S.sta = Math.max(0, S.sta - SWIM_STA * (gear ? 0.7 : 1));
  const season = seasonNow(), weather = envOf().weather;
  const risk = swimRisk(Math.random, season, weather, gear);
  const tempLoss = SWIM_TEMP * (gear ? 0.5 : 1) - 1;      // 装备好一点就少掉一点
  applyTemp(tempLoss);
  const lines: string[] = ['🌊 你下水了（' + SWIM_AP_PER_STEP() + ' 行动力/格，体温 ' + tempDeltaText(tempLoss) + '）'];
  if (risk.text) lines.push(risk.text);
  if (risk.infect) S.infect = Math.min(100, S.infect + risk.infect);
  if (risk.cramp) {
    S.sta = Math.max(0, S.sta - 15);
    const dmg = L.ri(3, 8); S.hp -= dmg;
    if (S.hp <= 0) { L.gameOver('你在水里抽筋，没能游回岸边。'); return true; }
  }
  if (risk.lost) {
    const inv = Object.keys(S.inv).filter(id => L.ITEMS[id] && id !== ROD && id !== WETSUIT && (S.inv[id] || 0) > 0);
    if (inv.length) { const id = inv[Math.floor(Math.random() * inv.length)]; L.takeItem(id, 1); lines.push('　 沉下去的是 ' + L.itemName(id) + '。'); }
  }
  // 移动
  s.cur = { x: target.x, y: target.y };
  markVisited(w, s, target.x, target.y);
  s.steps++;
  s.trail.push('🏊 → ' + target.name);
  for (const l of lines) L.log(l, risk.cramp ? 'danger' : 'info');
  L.autosave(); L.render();
  return true;
}
const SWIM_AP_PER_STEP = () => SWIM_AP_PER_BLOCK;

function applyTemp(d: number) {
  const e = envOf();
  e.temp = Math.max(0, Math.min(100, e.temp + d));
  const p = tempPenalty(e.temp);
  if (p.note) L.log(p.note, 'danger');
}

/* ── 潜水搜沉没基地 ── */
export function diveInfo(): { ok: boolean; left: number; why?: string } {
  const b = curBlock();
  if (!b || b.poi !== 'sunken') return { ok: false, left: 0, why: '这里没有水下目标（沉没基地在深水里，地图上标着 🤿）' };
  const s = sw();
  const dived = (s.left['dive:' + bkey(b.x, b.y)] as any) ?? 0;
  const tanks = L.itemCount(O2);
  const budget = diveBudget(tanks, dived);
  if (budget.left <= 0) return { ok: false, left: 0, why: '氧气用完了——回水面吧（找氧气瓶再来）' };
  return { ok: true, left: budget.left };
}

export function dive(): boolean {
  const S = L.S as any, s = sw(), b = curBlock();
  if (!b || b.poi !== 'sunken') { L.toast('这里没有水下目标', '沉没基地在深水区。', 'bad'); return false; }
  const info = diveInfo();
  if (!info.ok) { L.toast('下不去', info.why ?? '', 'bad'); return false; }
  if (!L.spendAP(DIVE_AP)) return false;
  const key = 'dive:' + bkey(b.x, b.y);
  const dived = ((s.left[key] as any) ?? 0) + 1;
  s.left[key] = dived as any;
  const tanks = L.itemCount(O2);
  const budget = diveBudget(tanks, dived - 1);
  if (budget.needTank) {
    // 没有氧气瓶：硬撑一次后就得上浮，而且掉血
    L.log('🫁 你没有氧气瓶，憋着一口气翻进沉没基地——胸口开始发紧。', 'danger');
  }
  const loot = pickDiveLoot(Math.random);
  L.grant(loot, loot === 'ammo' ? L.ri(8, 16) : 1);
  L.log(`🤿 水下搜索：摸到 ${L.itemName(loot)}（氧气还剩 ${Math.max(0, budget.left - 1)} 次）`, 'loot');
  // 水下遭遇：溺亡者
  if (Math.random() < 0.4) {
    L.log('☠️ 水里有东西在动——溺亡者顺着气泡游过来了。', 'danger');
    L.startCombat(['drowned', 'drowned'], { title: '🤿 水下遭遇 · ' + b.name, noFlee: true });
  }
  if (budget.left - 1 <= 0 && L.itemCount(O2) <= 0) {
    const dmg = DIVE_HP_PER_EXTRA;
    S.hp -= dmg;
    L.log(`🫁 憋不住了，你拼命往上游（-${dmg} 生命）。想搜得更深，得找氧气瓶。`, 'danger');
    if (S.hp <= 0) { L.gameOver('你没能游回水面。'); return true; }
  }
  applyTemp(SWIM_TEMP);
  s.trail.push('🤿 ' + b.name + ' 水下搜索');
  L.autosave(); L.render();
  return true;
}

/* ── 取水（M7.1：用户要求"水可以从水体里接"）── */
/** 取水点的当日剩余次数（复用 world.fish 这张表，键加前缀区分） */
function intakeLeft(s: SaveWorld, key: string): number {
  s.fish = s.fish && typeof s.fish === 'object' ? s.fish : {};
  const rec = s.fish['w:' + key];
  if (!rec || rec.day !== L.S.day) return INTAKE_PER_DAY;
  return rec.left ?? INTAKE_PER_DAY;
}

export function intakeInfo(): { ok: boolean; left: number; why?: string } {
  const near = waterNearby();
  if (!near.any) return { ok: false, left: 0, why: '旁边没有水（走到水边才能接）' };
  const s = sw(), key = bkey(s.cur.x, s.cur.y);
  const left = intakeLeft(s, key);
  if (left <= 0) return { ok: false, left: 0, why: '今天这一片已经接够了，明天再来' };
  return { ok: true, left };
}

/** 从水体接水（1 AP → 2 份污水；净化片或煮沸都能变成净水） */
export function intake(): boolean {
  const s = sw();
  const info = intakeInfo();
  if (!info.ok) { L.toast('接不到水', info.why ?? '', 'bad'); return false; }
  if (!L.spendAP(INTAKE_AP)) return false;
  const key = bkey(s.cur.x, s.cur.y);
  s.fish = s.fish && typeof s.fish === 'object' ? s.fish : {};
  s.fish['w:' + key] = { left: info.left - 1, day: L.S.day };
  L.grant('dirty', INTAKE_PER_ACTION);
  const hasTab = L.itemCount('purify') > 0;
  L.log(`💧 接水：装满 ${INTAKE_PER_ACTION} 份污水（今天这一片还能接 ${info.left - 1} 次）。` +
    (hasTab ? '身上的净化片可以直接净出一份净水。' : '回去用净化片或煮沸才能喝。'), 'loot');
  L.sfx('loot'); L.autosave(); L.render();
  return true;
}
/* ── 鱼塘（水产养殖） ── */
/** 每天翻日时结算：投喂优先用鱼饵，其次蔬菜/麦子 */
export function pondTick() {
  const S = L.S as any;
  const level = Math.max(0, Math.min(3, S.base?.pond ?? 0));
  if (level <= 0) return;
  let fed = false;
  for (const id of POND_FEED_ITEMS) {
    if (L.itemCount(id) > 0) { L.takeItem(id, 1); fed = true; break; }
  }
  const n = Math.floor(pondYield(level, seasonNow(), envOf().weather, fed));
  if (n > 0) { L.grant(FISH, n); L.log(`🐟 鱼塘收成：${n} 条鱼${fed ? '（投喂过，翻倍）' : '（没投喂，只有基础产量）'}。`, 'success'); }
  else L.log('🐟 鱼塘今天没产出（结冰/没投喂）。', 'dim');
}

export function pondSummary(): string {
  const S = L.S as any;
  const level = Math.max(0, Math.min(3, S.base?.pond ?? 0));
  if (!level) return '还没有鱼塘（据点 → 建设 → 鱼塘：' + buildCostText('pond') + '）';
  const feed = POND_FEED_ITEMS.map(id => (L.itemCount(id) > 0 ? L.itemName(id) + '×' + L.itemCount(id) : null)).filter(Boolean).join('、');
  return `鱼塘 Lv.${level} · 今天预计 ${Math.floor(pondYield(level, seasonNow(), envOf().weather, true))} 条（投喂）/ ` +
    `${Math.floor(pondYield(level, seasonNow(), envOf().weather, false))} 条（不投喂） · 可投喂：${feed || '没有鱼饵/蔬菜/麦子'}`;
}

export const waterInfo = () => ({ nearby: waterNearby(), fish: fishInfo(), intake: intakeInfo(), dive: diveInfo(), swim: canSwim(), pond: pondSummary() });
export { POIS };
