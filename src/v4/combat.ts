/* 宝可梦式回合制引擎（纯逻辑，可单测）：
   - 每回合按"速度 + 先制度"排出行动顺序，玩家和丧尸轮流出手
   - 4 个招式槽（武器 2~3 个 + 战术 + 物品），招式有消耗（体力/弹药/道具 = PP）
   - 属性克制给倍率，状态异常按回合结算
   - 引擎不碰 DOM，也不直接读全局 S：由 bridge 注入玩家数值、由 UI 层同步回存档 */
import { ITEM_MOVES, STATUS_NAME, TACTIC_MOVES, typeMult, effectivenessText, weaponMoves } from './moves';
import { penMul } from './ammo-core';        // M25：子弹穿透 vs 装甲（口径弹种规则与 legacy 共用一份）
import { fleeChanceOf, fleeFailPlan } from './flee-core';   // M56：逃跑成功率（含"连试递减"）与失败代价
import { DECOYS, planDecoy } from './decoy-core';           // M56：避战道具（气味引诱器三档）
import type { ActorRef, Battle, BattleEvent, DamageType, Foe, Move, PlayerCombatState, StatusKind } from '../types';

export interface PlayerProfile {
  hp: number; hpMax: number; sta: number; staMax: number; ammo: number;
  /** M25：当前装填弹种的穿透等级（参考塔科夫）。pen ≥ 目标装甲才算"打得动" */
  pen?: number;
  weaponId: string; weaponName: string; weaponDmg: number; isGun: boolean;
  apen?: boolean; spread?: boolean;
  critBonus: number;        // 来自技能/改装
  /** M24：暴击伤害倍率（默认 1.8；射击 Lv5 perk 给 2.1）——纯逻辑层不读全局存档，由 bridge 注入 */
  critMult?: number;
  dmgMult: number;          // 来自状态与技能
  dodge: number;            // 0..0.5
  /** M64：命中惩罚（辐射病 / 部位伤等，0~0.5）—— 由 bridge 从 statMods().hit 注入，命中判定里直接减 */
  accPenalty?: number;
  armor: number;            // 平摊减伤
  speed: number;            // 先手基础值
  inventory: Record<string, number>;
  guardPenalty?: number;    // 重伤之类的额外承伤
}

let uid = 0;
const rnd = () => Math.random();

export function movesFor(p: PlayerProfile): Move[] {
  const w = weaponMoves(p.weaponId, p.weaponDmg, p.isGun, { apen: p.apen, spread: p.spread });
  const out: Move[] = [w[0], w[1]];
  // 战术槽：有体力就带突进，否则带架势
  const tactic = p.sta >= 8 ? TACTIC_MOVES.find(m => m.id === 'lunge')! : TACTIC_MOVES.find(m => m.id === 'guard')!;
  out.push(tactic);
  // M56：避战道具槽（身上有气味引诱器才出现）—— 引走敌人，能全引走就直接脱离接触
  if (DECOYS.some(d => (p.inventory[d.id] ?? 0) > 0)) out.push(DECOY_MOVE);
  // 物品槽：优先能救命/能清场的
  const itemMove = ITEM_MOVES.find(m => (p.inventory[m.cost.item!] ?? 0) > 0);
  out.push(itemMove ?? TACTIC_MOVES.find(m => m.id === 'focus')!);
  return out;
}

/** M56：引诱器在战斗里占一个槽（用哪一档由 decoy-core 按场上威胁自动挑；本体不造成伤害） */
export const DECOY_MOVE: Move = {
  id: 'decoy', name: '引诱器', desc: '投放气味引诱器把敌人引开（够档的最低档；引不走的不消耗）',
  type: 'shock', power: 0, acc: 1, crit: 0, cost: {}, target: 'all',
};

export function canUse(p: PlayerProfile, m: Move): { ok: boolean; why?: string } {
  if (m.cost.sta && p.sta < m.cost.sta) return { ok: false, why: '体力不足' };
  if (m.cost.ammo && p.ammo < m.cost.ammo) return { ok: false, why: '弹药不足' };
  if (m.cost.item && (p.inventory[m.cost.item] ?? 0) <= 0) return { ok: false, why: '没有这件物品' };
  return { ok: true };
}

export function playerSpeed(p: PlayerProfile): number {
  return 8 + p.speed;
}

export function createBattle(foes: Foe[], player: PlayerProfile, opts: Battle['opts'] = {}): Battle {
  const b: Battle = {
    foes,
    player: { hp: player.hp, sta: player.sta, ammo: player.ammo, guard: 0, critUp: 0, weak: false, statuses: [] },
    queue: [], idx: 0, round: 0, events: [], log: [], over: null, opts, target: 0,
    playerSpeed: playerSpeed(player),
    stats: { dealt: 0, taken: 0, clean: true, decoys: 0 },
  };
  startRound(b, b.playerSpeed);
  logLine(b, opts.title ? `${opts.title}：${foes.map(f => f.name).join('、')} 挡住了你。` : '遭遇：' + foes.map(f => f.name).join('、'), 'sys');
  return b;
}

/* ── 回合与队列 ── */
export function startRound(b: Battle, pSpeed: number) {
  b.round++;
  /* M11 特性三：孵化者每两回合产出一只爬行者（上限 2 只，免得滚雪球滚到没法收场） */
  hatchSpawn(b);
  const order: { ref: ActorRef; spd: number }[] = [{ ref: { side: 'player' }, spd: pSpeed }];
  b.foes.forEach((f, i) => { if (f.hp > 0) order.push({ ref: { side: 'foe', index: i }, spd: f.spd * 10 }); });
  order.sort((a, z) => z.spd - a.spd);
  b.queue = order.map(o => o.ref);
  b.idx = 0;
  b.player.guard = 0;
}

/** 孵化者：每 2 回合吐出一只爬行者（血量按幼体算，别让玩家面对满血爬行者洪流） */
function hatchSpawn(b: Battle): void {
  if (b.round < 2 || b.round % 2 !== 0) return;
  const moms = b.foes.filter(f => f.hp > 0 && f.traits?.includes('spawn'));
  if (!moms.length) return;
  let spawned = b.foes.filter(f => f.id === 'crawler' && f.traits?.includes('spawned')).length;
  for (const mom of moms) {
    if (spawned >= 2) break;
    const baby: Foe = {
      id: 'crawler', name: '刚破壳的爬行者', hp: Math.max(6, Math.round(mom.hpMax * 0.18)), hpMax: Math.max(6, Math.round(mom.hpMax * 0.18)),
      atk: Math.max(4, Math.round(mom.atk * 0.8)), def: 0, spd: 1, types: ['flesh', 'swift'], moves: ['claw'],
      statuses: [], traits: ['spawned'], xp: 4,
    };
    b.foes.push(baby);
    spawned++;
    push(b, { kind: 'status', text: `🥚 ${mom.name} 的躯干撑破了——一只爬行者钻了出来。` });
  }
}

export function currentActor(b: Battle): ActorRef | null {
  return b.queue[b.idx] ?? null;
}

export function aliveFoes(b: Battle): number[] {
  return b.foes.map((f, i) => (f.hp > 0 ? i : -1)).filter(i => i >= 0);
}

function logLine(b: Battle, text: string, cls = 'sys') {
  b.log.push({ text, cls });
  if (b.log.length > 120) b.log.shift();
}

function finish(b: Battle, result: 'win' | 'lose' | 'flee') {
  if (b.over) return;
  b.over = result;
  b.opts.hooks?.onEnd?.(result);
}

function push(b: Battle, e: BattleEvent) {
  b.events.push(e);
  logLine(b, e.text, e.kind === 'damage' ? 'hit' : e.kind === 'faint' ? 'good' : e.kind === 'end' ? 'sys' : 'sys');
}

/* 玩家这次行动结束 → 推进队列并一路跑到"下一次该玩家出手"或战斗结束。
   没有这一步玩家会无限连动（单测抓到的真实缺陷）。 */
function endPlayerAction(b: Battle, p: PlayerProfile) {
  if (b.over) return;
  b.idx++;
  advance(b, p, b.playerSpeed);
}

/** 玩家做了一件"占用回合"的事（比如换武器）→ 直接把回合让出去 */
export function passTurn(b: Battle, p: PlayerProfile) {
  endPlayerAction(b, p);
}

/* ── 玩家行动 ── */
export function playerAct(b: Battle, p: PlayerProfile, moveId: string, targetIdx: number): void {
  if (b.over) return;
  const a = currentActor(b);
  if (!a || a.side !== 'player') return;
  const moves = movesFor(p);
  const m = moves.find(x => x.id === moveId) ?? moves[0];
  const chk = canUse(p, m);
  if (!chk.ok) { push(b, { kind: 'info', text: '不能使用 ' + m.name + '：' + chk.why }); return; }
  // 扣消耗（写回 profile，UI 层再同步进存档）
  if (m.cost.sta) { p.sta -= m.cost.sta; b.player.sta = p.sta; }
  if (m.cost.ammo) { p.ammo -= m.cost.ammo; b.player.ammo = p.ammo; }
  if (m.cost.item) { p.inventory[m.cost.item] = (p.inventory[m.cost.item] ?? 0) - 1; }
  if (moveId === 'smoke') { push(b, { kind: 'end', text: '💨 烟雾弹炸开，你脱离了接触。' }); finish(b, 'flee'); return; }
  /* M56：引诱器 —— 按场上威胁自动挑"够档的最低档"；全引走 = 脱离接触，剩下几只继续打；
     引不走的不消耗道具。引走的敌人**不算击杀**（不掉落、不给经验），所以只打 driven 标记 + 归零血量。 */
  if (moveId === 'decoy') {
    const plan = planDecoy(p.inventory, b.foes, { noFlee: !!b.opts.noFlee });
    if (!plan.item) { push(b, { kind: 'info', text: plan.text }); return; }     // 不消耗、不占回合
    p.inventory[plan.item] = (p.inventory[plan.item] ?? 0) - 1;
    b.stats.decoys = (b.stats.decoys || 0) + 1;      // M62：真的引走了才记一笔（教学第 2 章的目标读它）
    for (const i of plan.driven) { const f = b.foes[i]; f.hp = 0; (f as Foe & { driven?: boolean }).driven = true; }
    push(b, { kind: 'effect', text: plan.text });
    if (plan.clears) { push(b, { kind: 'end', text: '🚪 你趁着它们被引开，脱离了接触。' }); finish(b, 'flee'); return; }
    endPlayerAction(b, p);
    return;
  }

  if (m.self) {
    if (m.self.guard) { b.player.guard = m.self.guard; }
    if (m.self.critUp) { b.player.critUp += m.self.critUp; }
    if (m.self.sta) { p.sta = Math.min(p.staMax, p.sta + m.self.sta); b.player.sta = p.sta; }
    if (m.self.acc === -1) { finish(b, 'flee'); push(b, { kind: 'end', text: '💨 你借着烟雾脱离了战斗。' }); return; }
    push(b, { kind: 'effect', text: `你使用了 ${m.name}。` + (m.desc || '') });
    endPlayerAction(b, p);
    return;
  }
  if (moveId === 'bandage' || moveId === 'medkit') {
    const heal = moveId === 'bandage' ? 15 : 50;
    p.hp = Math.min(p.hpMax, p.hp + heal);
    b.player.hp = p.hp;
    b.player.statuses = b.player.statuses.filter(s => s.kind !== 'bleed');
    push(b, { kind: 'effect', text: `你用了 ${m.name}：生命 +${heal}，流血止住了。` });
    endPlayerAction(b, p);
    return;
  }
  if (moveId === 'antitoxin') {
    b.player.statuses = b.player.statuses.filter(s => s.kind !== 'poison');
    push(b, { kind: 'effect', text: '解毒剂压下了毒素。' });
    endPlayerAction(b, p);
    return;
  }

  // 目标解析：单目标要防"目标已死/全死"（曾经这里会拿到 undefined 直接崩）
  const alive = aliveFoes(b);
  const picked = m.target === 'all' ? alive : [alive.includes(targetIdx) ? targetIdx : alive[0]];
  const targets = picked.filter(i => typeof i === 'number' && i >= 0 && b.foes[i] && b.foes[i].hp > 0);
  if (!targets.length) { push(b, { kind: 'info', text: '已经没有可以打的目标了。' }); return; }
  let anyCrit = false;
  for (const ti of targets) {
    const foe = b.foes[ti];
    const acc = Math.max(0.05, m.acc - (p.accPenalty || 0));   // M64：辐射病/部位伤的命中惩罚真的生效
    if (rnd() > acc) { push(b, { kind: 'miss', text: `${foe.name} 闪开了 ${m.name}。` }); continue; }
    const mult = typeMult(m.type, foe.types);
    let dmg = m.power * (0.6 + 0.4 * (p.dmgMult || 1));
    dmg *= mult;
    const crit = b.player.critUp > 0 || rnd() < (m.crit + p.critBonus);
    /* 暴击倍率由上层注入（射击 Lv5 perk 会给到 2.1；纯逻辑层不读全局存档） */
    if (crit) { dmg *= p.critMult ?? 1.8; anyCrit = true; }
    if (b.player.weak) dmg *= 0.75;
    dmg *= 0.92 + rnd() * 0.16;
    /* M25 穿透：foe.def 里含"装甲等级"（bridge 按 t.armor 折算），子弹穿透不够会被挡下大半伤害。
       近战不吃装甲（甲是防弹的），所以只有 isGun 才走 penMul。 */
    const def = foe.def * (p.isGun ? penMul(p.pen || 0, foe.armor || 0) : 1);
    dmg = Math.max(1, Math.round(dmg - def * 0.8));
    foe.hp -= dmg;
    b.stats.dealt += dmg;
    const eff = effectivenessText(mult);
    push(b, { kind: 'damage', text: `${m.name} 命中 ${foe.name}：-${dmg}${crit ? '（暴击）' : ''}${eff ? ' · ' + eff : ''}`, target: { side: 'foe', index: ti }, amount: dmg, crit, effectiveness: mult });
    if (m.status && rnd() < (m.statusChance ?? 0.3)) applyStatus(foe.statuses, m.status, 3, m.type === 'fire' ? 8 : 5, foe.name);
    if (foe.hp <= 0) faint(b, ti, m.type, p);
  }
  if (anyCrit) b.player.critUp = 0;
  endPlayerAction(b, p);
}

export function applyStatus(list: { kind: StatusKind; turns: number; power: number }[], kind: StatusKind, turns: number, power: number, who: string) {
  const cur = list.find(s => s.kind === kind);
  if (cur) { cur.turns = Math.max(cur.turns, turns); cur.power = Math.max(cur.power, power); }
  else list.push({ kind, turns, power });
}

function faint(b: Battle, i: number, killerType?: DamageType, p?: PlayerProfile) {
  const f = b.foes[i];
  f.hp = 0;
  push(b, { kind: 'faint', text: `☠️ ${f.name} 倒下了。`, target: { side: 'foe', index: i } });
  /* M11 特性四：自爆者死亡时爆炸。用火焰/爆炸类招式打死 = 提前引爆，不会炸到你；
     被流血/中毒这类持续伤害耗死（killerType 为空）也不会炸。 */
  if (f.traits?.includes('volatile')) {
    const safe = !killerType || killerType === 'fire' || killerType === 'blast';
    if (safe) {
      push(b, { kind: 'info', text: `🔥 ${f.name} 体内的气体被引燃，没来得及炸。` });
    } else if (p) {
      const boom = Math.max(4, Math.round(f.hpMax * 0.55));
      const dmg = Math.max(1, Math.round(boom * (b.player.guard ? 0.5 : 1)));
      p.hp -= dmg;
      b.player.hp = p.hp;
      b.stats.taken += dmg;
      b.stats.clean = false;
      push(b, { kind: 'damage', text: `💥 ${f.name} 的尸体炸开了：-${dmg}`, target: { side: 'player' }, amount: dmg });
      if (p.hp <= 0) { b.opts.hooks?.onPlayerFaint?.(); finish(b, 'lose'); push(b, { kind: 'end', text: '你被那一下炸倒了……' }); return; }
    }
  }
  b.opts.hooks?.onFoeFaint?.(f);
}

/* ── 丧尸行动（AI：血少优先拼命，装甲型爱硬扛） ── */
export function foeTurn(b: Battle, p: PlayerProfile, i: number): void {
  const f = b.foes[i];
  if (f.hp <= 0) return;
  const stun = f.statuses.find(s => s.kind === 'stun');
  if (stun) { stun.turns--; if (stun.turns <= 0) f.statuses = f.statuses.filter(s => s !== stun); push(b, { kind: 'info', text: `${f.name} 还在眩晕中，动作僵住了。` }); return; }
  /* M11 特性一：狂暴（暴君半血后攻击 +50%，只触发一次） */
  if (f.traits?.includes('enrage') && !(f as Foe & { enraged?: boolean }).enraged && f.hp <= f.hpMax / 2) {
    (f as Foe & { enraged?: boolean }).enraged = true;
    f.atk = Math.round(f.atk * 1.5);
    push(b, { kind: 'status', text: `💢 ${f.name} 彻底疯了：攻击大幅提升！` });
  }
  /* M11 特性二：远程（喷吐者隔着距离吐酸液——格挡没用，护甲会被啃薄） */
  const ranged = !!f.traits?.includes('ranged');
  const corrode = b.player.statuses.find(s => s.kind === 'corrode');
  const effArmor = Math.max(0, p.armor - (corrode ? 2 : 0));       // 被腐蚀时护甲按 -2 算
  const dodge = Math.min(0.55, p.dodge);
  const hits = f.spd >= 2 ? 2 : 1;
  for (let n = 0; n < hits; n++) {
    if (rnd() < dodge) { push(b, { kind: 'miss', text: `你侧身躲开了 ${f.name} 的攻击。` }); continue; }
    let dmg = f.atk * (0.85 + rnd() * 0.3);
    dmg *= 1 - Math.min(0.45, effArmor * 0.05);
    if (b.player.guard && !ranged) dmg *= 1 - b.player.guard;      // 远程吐酸：举盾挡不住
    if (f.statuses.some(s => s.kind === 'weak')) dmg *= 0.75;
    dmg = Math.max(1, Math.round(dmg));
    p.hp -= dmg;
    b.player.hp = p.hp;
    b.stats.taken += dmg;
    b.stats.clean = false;
    push(b, { kind: 'damage', text: `${f.name} ${ranged ? '吐出的酸液溅到你' : '命中你'}：-${dmg}`, target: { side: 'player' }, amount: dmg });
    if (ranged && rnd() < 0.6) {
      applyStatus(b.player.statuses, 'corrode', 3, 0, '你');
      push(b, { kind: 'status', text: `🧪 酸液啃在护甲上——护甲暂时变薄了。` });
    } else if (rnd() < 0.12) applyStatus(b.player.statuses, 'bleed', 3, 5, '你');
    if (p.hp <= 0) { b.opts.hooks?.onPlayerFaint?.(); finish(b, 'lose'); push(b, { kind: 'end', text: '你倒下了……' }); return; }
  }
  const burst = f.types.includes('toxic') && rnd() < 0.25;
  if (burst) { applyStatus(b.player.statuses, 'poison', 3, 5, '你'); push(b, { kind: 'status', text: `${f.name} 喷出一口毒雾，你中毒了。` }); }
}

/* ── 回合结算：状态 DOT、顺序推进 ── */
export function tickStatuses(b: Battle, p: PlayerProfile): void {
  for (const s of b.player.statuses.slice()) {
    /* M11：护甲腐蚀不是伤害型状态——只倒计时，效果体现在 foeTurn 的护甲扣除里 */
    if (s.kind === 'corrode') {
      s.turns--;
      if (s.turns <= 0) { b.player.statuses = b.player.statuses.filter(x => x !== s); push(b, { kind: 'info', text: '🧪 护甲上的酸液干掉了。' }); }
      continue;
    }
    const dmg = s.power;
    p.hp -= dmg; b.player.hp = p.hp; b.stats.taken += dmg; b.stats.clean = false;
    push(b, { kind: 'damage', text: `${STATUS_NAME[s.kind].icon} ${STATUS_NAME[s.kind].name}：你失去 ${dmg} 生命`, target: { side: 'player' }, amount: dmg });
    s.turns--;
    if (s.turns <= 0) b.player.statuses = b.player.statuses.filter(x => x !== s);
    if (p.hp <= 0) { b.opts.hooks?.onPlayerFaint?.(); finish(b, 'lose'); return; }
  }
  b.foes.forEach((f, i) => {
    if (f.hp <= 0) return;
    for (const s of f.statuses.slice()) {
      const dmg = s.power;
      f.hp -= dmg;
      push(b, { kind: 'damage', text: `${STATUS_NAME[s.kind].icon} ${f.name} 因${STATUS_NAME[s.kind].name}失去 ${dmg} 生命`, target: { side: 'foe', index: i }, amount: dmg });
      s.turns--;
      if (s.turns <= 0) f.statuses = f.statuses.filter(x => x !== s);
      if (f.hp <= 0) { faint(b, i); break; }
    }
  });
}

/** 推进到下一个需要玩家决策的时点；返回是否在等玩家 */
export function advance(b: Battle, p: PlayerProfile, pSpeed: number): boolean {
  if (b.over) return false;
  let guard = 0;
  while (!b.over && guard++ < 64) {
    if (b.idx >= b.queue.length) {
      tickStatuses(b, p);
      if (b.over) break;
      if (!aliveFoes(b).length) { finish(b, 'win'); push(b, { kind: 'end', text: '🏁 全部清空，你活下来了。' }); break; }
      startRound(b, pSpeed);
      continue;
    }
    const a = b.queue[b.idx];
    if (a.side === 'player') return true;          // 等玩家操作
    foeTurn(b, p, a.index);
    b.idx++;
    if (!aliveFoes(b).length && !b.over) { finish(b, 'win'); push(b, { kind: 'end', text: '🏁 全部清空，你活下来了。' }); }
  }
  return false;
}

export function fleeChance(b: Battle, p: PlayerProfile): number {
  /* M56：成功率算式搬进 flee-core，并带上"这一场已经失败过几次"的递减（连试越难跑）。
     `b.opts.noFlee`（守夜战 / 最终决战）直接给 0 —— 以前是在里面 -1 再被 8% 下限抬回来，等于永远有 8% 能溜。 */
  if (b.opts.noFlee) return 0;
  const fast = b.foes.some(f => f.hp > 0 && f.spd >= 2);
  return fleeChanceOf({ base: 0.45 + p.speed * 0.02, fast, noFlee: false, tries: b.fleeTries || 0 });
}
/** M56：逃跑失败 = **真的挨打**（每个活着的敌人白打一轮 + 掉体力 + 下一次更难跑）。
 *  用户报的漏洞就是这里：旧版失败只写一行日志，于是"一直点逃跑"= 无限免战。 */
export function tryFlee(b: Battle, p: PlayerProfile): boolean {
  if (rnd() < fleeChance(b, p)) { finish(b, 'flee'); push(b, { kind: 'end', text: '🏃 你甩开了它们。' }); return true; }
  const alive = aliveFoes(b);
  const plan = fleeFailPlan(alive.length);
  b.fleeTries = (b.fleeTries || 0) + 1;
  p.sta = Math.max(0, p.sta - plan.staCost);
  b.player.sta = p.sta;
  push(b, { kind: 'info', text: plan.text });
  for (const i of alive) foeTurn(b, p, i);                     // 白挨一轮（引擎自己算伤害）
  if (!b.over) push(b, { kind: 'info', text: '（下一次逃跑成功率：' + Math.round(fleeChance(b, p) * 100) + '%）' });
  return false;
}
