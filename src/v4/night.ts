/* C01/C02/C03：过夜系统。legacy 的 sleepNight() 已经把"翻日"的全部账（饥渴、感染、腐坏、伤口、
   据点产出、尸潮/血月判定、每日刷新、断水断电）都算好了，所以这里**不重写**，只在它外面加一层：
   - 过夜点位分档（安全屋 / 车里 / 教堂营地 / 掩体），野睡恢复打折 + 必掷夜袭（R1/R2）
   - 睡眠债：AP 上限 = 9 - 债，是派生值（R5：并进 AP 显示，不新开常驻位）
   - 血月不在家：据点被啃（掉防线 + 丢储物），幂等（R3：lastRaidDay）
   参数全部集中在下面常量里，方便按 S1 敏感度矩阵调。 */
import { L } from '../main';
import { radTier } from './rad-core';
import { POIS } from './pois';
import { blockAt } from './worldgen';
import { ensureSaveWorld, worldOf, type SaveWorld } from './worldstate';
import {
  apMaxOf, isBloodMoonDay, nextDebt, raidChance, restTierOf,
  AP_MAX_BASE, DEBT_CAP, DEBT_HEAL_BASE, DEBT_PER_FIELD, FIELD_RESTORE, RAID_DOOR_MAX, RAID_STORE_MAX,
  type RestKind,
} from './night-core';
import { envDayTick, envOf, farmGrow, tempPenalty } from './env';
import { pondTick } from './water';   // M7：鱼塘每天产出
import type { Block } from '../types';

// 参数真值在 night-core（纯逻辑、可单测）；这里再导出一份，方便 UI 与探针取用
export { AP_MAX_BASE, DEBT_CAP, DEBT_HEAL_BASE, DEBT_PER_FIELD, FIELD_RESTORE, RAID_DOOR_MAX, RAID_STORE_MAX, apMaxOf, isBloodMoonDay, raidChance };
export type { RestKind };

export interface RestOption { kind: RestKind; icon: string; name: string; detail: string; ok: boolean; why?: string }

/** 当前站在哪儿能怎么睡（把 POI 信息喂给纯函数） */
export function tierAt(block: Block | null, hasCar: boolean): RestKind {
  const s = ensureSaveWorld(L.S), w = worldOf(s.seed, s.region);
  const poi = block?.poi ? POIS[block.poi] : null;
  return restTierOf(block, hasCar, w.home, poi?.feat ?? null, poi?.id ?? null);
}
export const restTierOfLive = tierAt;

export function restOptions(block: Block | null): RestOption[] {
  const s = ensureSaveWorld(L.S);
  const hasCar = !!s.veh && s.veh.fuel > 0 && s.veh.hp > 0;
  const tier = tierAt(block, hasCar);
  const debt = s.debt;
  const cap = apMaxOf(debt);
  const field = Math.round(cap * FIELD_RESTORE);
  const nextDebtSafe = Math.max(0, debt - DEBT_HEAL_BASE);
  const nextDebtField = Math.min(DEBT_CAP, debt + DEBT_PER_FIELD);
  const px = '明早 ' + field + ' 行动力';
  const rb = '债 ' + debt + '→' + nextDebtSafe + ' 档 · AP 上限 ' + apMaxOf(nextDebtSafe);
  const rf = '债 ' + debt + '→' + nextDebtField + ' 档 · AP 上限 ' + apMaxOf(nextDebtField);
  const night = isBloodMoonDay(L.S.day);
  return [
    { kind: 'base', icon: '🏠', name: '回安全屋睡', detail: 'AP 回满 · ' + rb + ' · 零夜袭' + (night ? ' · 血月夜：这里会打守夜战' : ''),
      ok: tier === 'base', why: tier === 'base' ? undefined : '你不在这儿（安全屋在 (' + worldOf(s.seed, s.region).home.x + ',' + worldOf(s.seed, s.region).home.y + ')）' },
    { kind: 'shelter', icon: '🚪', name: '睡在掩体里', detail: px + ' · ' + rf + ' · 夜袭 低档', ok: tier === 'shelter', why: '需要掩体/监狱/军事哨所/隧道这类硬据点' },
    { kind: 'car', icon: '🚗', name: '睡在车里', detail: px + ' · ' + rf + ' · 夜袭 中档 · 耗 1 油', ok: tier === 'car', why: hasCar ? '走到空旷处就能睡，但你不在合适的位置' : '没有可用的车（车况/油）' },
    { kind: 'open', icon: '🔥', name: '就地生火过夜', detail: px + ' · ' + rf + ' · 夜袭 高档', ok: true },
  ];
}

/** 不在家过夜：据点被啃（门/墙掉血 + 丢储物），幂等 */
function chewBase(day: number, s: SaveWorld, why: string) {
  if (s.lastRaidDay === day) return null;      // 同一天只结算一次（R3 幂等）
  s.lastRaidDay = day;
  const S = L.S;
  const doorMax = L.defMax().door, wallMax = L.defMax().wall;
  const dmg = Math.round(doorMax * RAID_DOOR_MAX * 0.5);
  const wdmg = Math.round(wallMax * RAID_DOOR_MAX * 0.5);
  S.def.doorHp = Math.max(0, Math.round(S.def.doorHp - dmg));
  S.def.wallHp = Math.max(0, Math.round(S.def.wallHp - wdmg));
  // 储物：Material 与据点仓库各丢一点，总量不超过 20%
  const matLoss = Math.min(S.mat, Math.round(S.mat * RAID_STORE_MAX));
  S.mat -= matLoss;
  let itemLoss = 0;
  const store = Object.keys(S.store || {});
  for (const id of store) {
    const n = S.store[id] || 0;
    const cut = Math.floor(n * RAID_STORE_MAX);
    if (cut > 0) { S.store[id] = n - cut; itemLoss += cut; if (S.store[id] <= 0) delete S.store[id]; }
  }
  L.hr();
  L.log('🩸 ' + why + '你在外面：尸群顺着你的脚印摸到了安全屋。门 -' + dmg + '、墙 -' + wdmg +
    '，储物被拖走 ' + itemLoss + ' 件、材料少 ' + matLoss + '。', 'danger');
  L.log('　 下一次血月（第 ' + (day + 7) + ' 天）之前记得回来——家没人，防线就是摆设。', 'dim');
  return { dmg, wdmg, matLoss, itemLoss };
}

/** 野睡夜袭：三档递进（打断睡眠 → 丢物资 → 守夜战），只有安全屋不掷。
    M24 生存 Lv3 perk：夜袭概率 ×0.75 */
function rollFieldRaid(kind: RestKind, block: Block | null, s: SaveWorld): { outcome: string; text: string; foes: string[] } {
  const S = L.S;
  const perk = Number((S as any).skills?.survival ?? 0) >= 3 ? 0.75 : 1;
  const p = raidChance(kind, S.day, S.noise) * perk;
  if (Math.random() >= p) return { outcome: 'quiet', text: '', foes: [] };
  const roll = Math.random();
  if (roll < 0.45) return { outcome: 'wake', text: '👣 半夜有东西从外面走过去，你一夜没敢合眼。', foes: [] };
  if (roll < 0.75) return { outcome: 'loot', text: '🐀 等你醒来，背包被翻过了——有东西趁你睡着摸走了点物资。', foes: [] };
  const pool = block?.poi ? POIS[block.poi].enemies : ['walker', 'runner'];
  const n = 2 + (S.day >= 20 ? 1 : 0);
  const foes: string[] = [];
  for (let i = 0; i < n; i++) foes.push(pool[Math.floor(Math.random() * pool.length)] ?? 'walker');
  return { outcome: 'fight', text: '☠️ 你被压在睡袋里醒过来：' + foes.map(id => L.ZOMBIES?.[id]?.n ?? '丧尸').join('、') + ' 已经围上来了。', foes };
}

/** 过夜主入口：kind 由 UI 给出，非法就用当前点位该有的档 */
export function rest(kind?: RestKind): void {
  const S = L.S;
  if (S.over) return;
  const s = ensureSaveWorld(S);
  const w = worldOf(s.seed, s.region);
  const block = blockAt(w, s.cur.x, s.cur.y) ?? null;
  const hasCar = !!s.veh && s.veh.fuel > 0 && s.veh.hp > 0;
  const allowed = tierAt(block, hasCar);
  const opts = restOptions(block);
  let use: RestKind = kind && opts.some(o => o.kind === kind && o.ok) ? kind : allowed;
  if (use === 'shelter' && allowed !== 'shelter') use = allowed === 'base' ? 'base' : allowed;
  const atBase = use === 'base';
  const day0 = S.day;

  // 车中过夜要烧油（R2）
  if (use === 'car' && s.veh) { s.veh.fuel = Math.max(0, s.veh.fuel - 1); L.log('🚗 你缩在驾驶座上过夜（-1 油）。', 'dim'); }
  if (!atBase) L.log('🌙 今夜你不在家：' + (use === 'shelter' ? '掩体里还算安全。' : use === 'car' ? '车里能挡风，挡不住手。' : '露天过夜，火堆就是全部的墙。'), 'dim');

  // 人不在家就不会有"守夜战"：legacy 的 sleepNight 判定血月/尸群到点后会直接开据点防守战，
  // 而在玩家远在十公里外时那是说不通的。拦截点在 battle-ui（siege + 不在家 → 结算成"据点被啃"），
  // 见下面注册的 window.__v4AwaySiege。
  // 交给 legacy 翻日（饥渴/感染/腐坏/伤口/据点产出/尸潮判定/每日刷新）
  L.sleepNight();
  if (S.day === day0) return;          // 没翻日（比如已通关/死亡）就什么都不做

  // ── 醒来后的账（R1/R5）──
  // M6：先走环境（掷天气、接雨水、体温过夜、菜园生长），体温低于阈值会再扣一档 AP 上限
  try { envDayTick(); farmGrow(); pondTick(); } catch (e) { console.warn('[v4] 环境结算失败', e); }
  const tPen = tempPenalty(envOf().temp);
  /* M24 体能 Lv3 perk：睡醒多还 1 档睡眠债（把"到处跑"和"睡得好"连起来） */
  const debt = Math.max(0, nextDebt(s.debt, atBase) - (atBase && Number((S as any).skills?.fitness ?? 0) >= 3 ? 1 : 0));
  const cap = Math.max(1, apMaxOf(debt) + tPen.ap);
  let raid: { outcome: string; text: string; foes: string[] } = { outcome: 'none', text: '', foes: [] };
  if (!atBase) raid = rollFieldRaid(use, block, s);
  if (raid.outcome === 'wake') { /* 打断睡眠：行动力再打折 */ }
  const ap = atBase ? cap : Math.max(1, Math.round(cap * FIELD_RESTORE * (raid.outcome === 'wake' ? 0.5 : 1)));
  s.debt = debt;
  S.apMax = cap;                       // legacy 的 apMax 是投影值，真值在 s.debt
  S.ap = ap;
  s.lastNight = { day: day0, kind: use, tier: use, outcome: raid.outcome, ap };
  if (!atBase) {
    L.log('😴 野外过夜：睡了 ' + ap + ' / 上限 ' + cap + ' 行动力（债 ' + debt + ' 档）。' +
      (debt >= DEBT_CAP ? '你已经连着太久没睡好了——再撑下去手会抖。' : ''), debt >= 2 ? 'danger' : 'info');
    if (raid.text) { L.log(raid.text, raid.outcome === 'fight' ? 'danger' : 'dim'); if (raid.outcome === 'loot') { const lost = Math.min(S.mat, L.ri(3, 9)); S.mat -= lost; L.log('　 材料少了 ' + lost + '。', 'dim'); } }
  } else {
    L.log('🏠 睡在自己的床上：AP 满格 ' + cap + '，睡眠债还到 ' + debt + ' 档。', 'success');
  }
  /* M24 医疗 Lv3 perk：每夜自动回 3 点生命（"会包扎的人睡一觉也在回血"） */
  if (Number((S as any).skills?.medic ?? 0) >= 3 && S.hp > 0 && S.hp < S.hpMax) {
    const heal = Math.min(3, S.hpMax - S.hp);
    S.hp += heal;
    L.log('💉 医疗技能让你在睡梦里也在恢复：+ ' + heal + ' 生命。', 'dim');
  }
  /* M25 辐射的夜间结算：累积到阈值就掉血/呕吐；干净的时候身体会自己代谢掉一点 */
  {
    const rad = Number((S as any).rad) || 0;
    const rt = radTier(rad);
    if (rt.nightHp < 0 && S.hp > 1) {
      const loss = Math.min(S.hp - 1, -rt.nightHp);
      S.hp -= loss;
      L.log('☢️ 辐射病发作（' + rt.label + '）：一夜之间流失 ' + loss + ' 生命。' + rt.note, 'danger');
    }
    if (rt.eatChance > 0 && Math.random() < rt.eatChance) {
      const foods = Object.keys(S.inv || {}).filter(id => L.ITEMS?.[id]?.t === 'food' && (S.inv[id] || 0) > 0);
      if (foods.length) {
        const id = foods[Math.floor(Math.random() * foods.length)];
        const n = Math.min(S.inv[id], 1 + (rt.tier >= 4 ? 2 : 0));
        L.takeItem(id, n);
        L.log('🤮 你吐得停不下来，糟蹋了 ' + L.itemName(id) + '×' + n + '。', 'danger');
      }
    }
    if (rad > 0 && rad < 25) {
      (S as any).rad = Math.max(0, Math.round(rad - 2));       // 轻度：身体慢慢代谢
    }
  }

  // 血月/尸群不在家 → 据点被啃（C03）。夜里那场"守夜战"如果被 legacy 开出来，
  // 会先撞上 __v4AwaySiege 钩子并被折算成同一笔账（幂等按天）。
  const blood = isBloodMoonDay(day0);
  const hordeHere = hordeTonight(day0);
  if (!atBase && (blood || hordeHere)) {
    const r = chewBase(day0, s, blood ? '血月' : '尸群');
    if (r && L.S.horde.size > 0) L.S.horde = { eta: 0, size: 0 };
  }

  L.autosave();
  L.render();
  if (raid.outcome === 'fight' && raid.foes.length) {
    L.startCombat(raid.foes, { title: '夜袭 · 第 ' + S.day + ' 天清晨', sub: '睡袋争夺战' });
  }
}

/** 调试/测试用：把当前 AP 上限按债重算（读档后调用一次，保证 HUD 与债一致） */
export function syncApMax(): void {
  const s = ensureSaveWorld(L.S);
  const cap = apMaxOf(s.debt);
  if (L.S.apMax !== cap) { L.S.apMax = cap; if (L.S.ap > cap) L.S.ap = cap; }
}

/* ── 不在家时的"守夜战"拦截 ──
   legacy 的 nightRaid() 会无条件开一场据点防守战；玩家不在家时那场仗没有意义，
   改成"据点被啃"结算（幂等，按天记账）。battle-ui 在开战前会问这个钩子。 */
function atBaseNow(): boolean {
  const s = ensureSaveWorld(L.S);
  const w = worldOf(s.seed, s.region);
  return s.cur.x === w.home.x && s.cur.y === w.home.y;
}

function hordeTonight(day: number): boolean {
  const h = L.S.horde;
  return h.eta > 0 && h.eta - 1 <= 0;
}

export function registerAwaySiegeHook(): void {
  (window as any).__v4AwaySiege = (opts: any) => {
    if (atBaseNow()) return false;                 // 在家照常打守夜战
    const s = ensureSaveWorld(L.S);
    const day = L.S.day;                            // 注意：legacy 已经把 day++ 过了，这里记的是"醒来这天"
    const blood = isBloodMoonDay(day - 1);
    const horde = hordeTonight(day - 1);
    if (s.lastRaidDay === day - 1 || s.lastNight?.day === day - 1) {
      // 野睡那条路径已经结算过同一夜了（lastNight 落盘即幂等），这里不重复啃
      if (s.lastRaidDay === day - 1) return true;
    }
    chewBase(day - 1, s, blood ? '血月' : (horde ? '尸群' : '尸潮'));
    if (L.S.horde.size > 0) { L.S.horde = { eta: 0, size: 0 }; }
    L.log('🏚️ 它们砸了半宿门窗才走。你不在家：没人按警报器，也没人补门板。', 'danger');
    L.autosave();
    L.render();
    return true;
  };
}

registerAwaySiegeHook();
