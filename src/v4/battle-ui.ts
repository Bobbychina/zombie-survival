/* 宝可梦式战斗界面：4 个招式槽 + 出手顺序 + 属性克制 + 状态异常。
   接管方式：main.ts 里把 window.startCombat 换成 startV4Combat，legacy 的所有调用点
   （遭遇、守夜战、最终决战、路上事件）都会自动走到这里。 */
import { L } from '../main';
import {
  advance, createBattle, currentActor, fleeChance, movesFor, passTurn, playerAct, tryFlee, canUse,
  type PlayerProfile,
} from './combat';
import { FOE_TYPE_ICON, FOE_TYPE_NAME, STATUS_NAME, TYPE_NAME, typeMult } from './moves';
import { onEnd, onFoeFaint, onPlayerHit, playerProfile, syncBack, toFoe } from './bridge';
import { repeatTarget, repeatLabel } from './qol-core';   // M38：重复上次动作（挑目标/按钮文案）
import type { Battle, Foe, Move } from '../types';

let cur: { b: Battle; p: PlayerProfile; srcs: any[]; opts: any } | null = null;
const OV = 'v4b-overlay';
/* M38：战斗「重复上次」—— 记住上一次成功出招（招式 id + 当时的目标），一键再打一次。
   连打十只丧尸不用每次都点两下（选招 + 选目标）。 */
let lastAct: { id: string; target: number } | null = null;

function esc(s: unknown) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c)); }

function bar(pct: number, cls = 'foe') {
  return `<div class="bar thin"><i class="${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
}

function foeCard(f: Foe, i: number, b: Battle) {
  const dead = f.hp <= 0;
  const eff = b.player.hp > 0 ? Math.max(...(movesForSafe().map(m => typeMult(m.type, f.types)))) : 1;
  const types = f.types.map(t => `<span class="type-chip t-${t}" title="${FOE_TYPE_NAME[t]}">${FOE_TYPE_ICON[t]}${FOE_TYPE_NAME[t]}</span>`).join('');
  const st = f.statuses.map(s => `<span class="status-chip" title="${STATUS_NAME[s.kind].desc}">${STATUS_NAME[s.kind].icon}${STATUS_NAME[s.kind].name}${s.turns}</span>`).join('');
  return `<div class="enemy${dead ? ' dead' : ''}${b.target === i ? ' target' : ''}${f.elite ? ' elite' : ''}" id="v4foe-${i}" ${dead ? '' : `onclick="V4UI.target(${i})"`}>
    <div class="en">${esc(f.name)}${f.elite ? '<span class="tr elite">精英</span>' : ''}<span class="mono" style="font-size:11px;color:var(--dim)">${dead ? '已清除' : 'HP ' + Math.max(0, Math.round(f.hp)) + '/' + f.hpMax}</span></div>
    ${bar(f.hp / f.hpMax * 100)}
    <div class="traits" style="margin-top:6px">${types}${st}<span class="tr">⚔️ ${f.atk}</span><span class="tr">💨 ${f.spd}</span></div>
  </div>`;
}
let cachedMoves: Move[] = [];
function movesForSafe(): Move[] { return cachedMoves; }

/** M38：「重复上次」按钮 —— 没打过 / 招式已经用不了（没弹药、没那个道具）时置灰并说明原因 */
function repeatBtn(waitPlayer: boolean): string {
  if (!cur || !lastAct) return '';
  const { b, p } = cur;
  const m = movesFor(p).find(x => x.id === lastAct!.id);
  const chk = m ? canUse(p, m) : { ok: false, why: '这招现在没有对应武器' };
  const label = repeatLabel(lastAct.id, m?.name);
  if (!label) return '';
  const why = chk.ok ? '' : `<span class="hint" style="margin-left:6px">${esc((chk as any).why || '')}</span>`;
  return `<div class="row" style="margin-top:8px"><button class="btn sm ok" ${chk.ok && waitPlayer ? '' : 'disabled'} onclick="V4UI.repeat()">${esc(label)}</button>${why}</div>`;
}

function render() {
  if (!cur) return;
  const { b, p, opts } = cur;
  const root = document.getElementById(OV);
  if (!root) return;
  const pd = b.player;
  const moves = movesFor(p);
  cachedMoves = moves;
  const waitPlayer = currentActor(b)?.side === 'player' && !b.over;
  const alive = b.foes.filter(f => f.hp > 0).length;
  const title = opts?.title || '⚔️ 遭遇战';
  const sub = opts?.sub || (b.foes.length > 1 ? `${b.foes.length} 个目标` : '');

  const myStatuses = pd.statuses.map(s => `<span class="status-chip" title="${STATUS_NAME[s.kind].desc}">${STATUS_NAME[s.kind].icon}${STATUS_NAME[s.kind].name}${s.turns}</span>`).join('');

  const slot = (m: Move, i: number) => {
    const chk = canUse(p, m);
    const typeCls = 't-' + (m.type === 'blunt' ? 'bone' : m.type === 'slash' ? 'flesh' : m.type === 'bullet' ? 'swift' : m.type === 'fire' ? 'toxic' : m.type === 'blast' ? 'hulk' : m.type === 'toxic' ? 'toxic' : 'armor');
    const cost = [m.cost.sta ? `⚡${m.cost.sta}` : '', m.cost.ammo ? `🔫${m.cost.ammo}` : '', m.cost.item ? `🎒${L.itemName(m.cost.item)}` : ''].filter(Boolean).join(' ');
    return `<button class="mv-slot${chk.ok ? '' : ' off'}" ${chk.ok && waitPlayer ? '' : 'disabled'} onclick="V4UI.move('${m.id}')" title="${esc(m.desc)}">
      <span class="mv-name">${i + 1}. ${esc(m.name)}</span>
      <span class="mv-meta"><span class="type-chip ${typeCls}">${TYPE_NAME[m.type]}</span>${m.power ? `<span class="mono">威力 ${m.power}</span>` : '<span class="mono">辅助</span>'}${m.target === 'all' ? '<span class="mono">全体</span>' : ''}${m.priority ? `<span class="mono">先制+${m.priority}</span>` : ''}${cost ? `<span class="mono">${cost}</span>` : ''}</span>
      ${chk.ok ? '' : `<span class="mv-why">${chk.why}</span>`}
    </button>`;
  };

  root.innerHTML = `<div class="modal v4b">
    <div class="strip"></div>
    <div class="modal-hd"><h2>${esc(title)}${sub ? ` <span class="muted">· ${esc(sub)}</span>` : ''}</h2>
      <span class="hint mono">第 ${b.round} 回合 · 剩余 ${alive}</span></div>
    <div class="modal-bd">
      <div class="combat-grid">
        <div class="grid" style="gap:8px">
          ${b.foes.map((f, i) => foeCard(f, i, b)).join('')}
          <div class="round-log" id="v4log" style="height:150px;margin-top:4px">${b.log.slice(-40).map(l => `<div class="${l.cls}">${esc(l.text)}</div>`).join('')}</div>
        </div>
        <div>
          <div class="card" style="padding:10px">
            <h3 style="margin-bottom:6px">🧑 你的状态</h3>
            <div class="hbar"><div class="top"><span>❤️ 生命</span><b>${Math.max(0, Math.round(p.hp))}/${p.hpMax}</b></div>${bar(p.hp / p.hpMax * 100, 'hp')}</div>
            <div class="hbar" style="margin-top:5px"><div class="top"><span>⚡ 体力</span><b>${Math.round(p.sta)}</b></div>${bar(p.sta / p.staMax * 100, 'sta')}</div>
            <div class="hbar" style="margin-top:5px"><div class="top"><span>🔫 弹药</span><b>${p.ammo}</b></div>${bar(Math.min(1, p.ammo / 60) * 100, 'ammo')}</div>
            <div class="row" style="margin-top:8px;gap:4px">
              <span class="tr">🗡️ ${esc(p.weaponName)}</span>
              ${pd.guard ? '<span class="tr" style="color:var(--med)">🛡️ 架势</span>' : ''}
              ${pd.critUp ? '<span class="tr" style="color:var(--warn)">🎯 蓄力</span>' : ''}
              ${myStatuses}
            </div>
            <div class="hint" style="margin-top:6px">出手顺序 ${b.queue.length}：${b.queue.map(a => a.side === 'player' ? '你' : esc(b.foes[a.index]?.name ?? '?')).join(' → ')}</div>
          </div>
          <div class="card" style="padding:10px;margin-top:8px">
            <h3 style="margin-bottom:6px">招式</h3>
            <div class="mv-grid">${moves.map((m, i) => slot(m, i)).join('')}</div>
            <div class="row" style="margin-top:8px">
              <button class="btn sm" ${waitPlayer ? '' : 'disabled'} onclick="V4UI.switchWeapon()">🔄 换武器（消耗回合）</button>
              <button class="btn sm danger" ${waitPlayer && !b.opts.noFlee ? '' : 'disabled'} onclick="V4UI.flee()">🏃 ${b.opts.noFlee ? '无路可退' : '逃跑 ' + Math.round(fleeChance(b, p) * 100) + '%'}</button>
            </div>
            ${repeatBtn(waitPlayer)}
            ${opts?.hint ? `<div class="hint" style="margin-top:6px">💡 ${esc(opts.hint)}</div>` : ''}
            ${b.opts.siege ? `<div class="hint" style="margin-top:6px">🚪 门户 ${Math.round(L.S.def.doorHp)} · 🧱 围墙 ${Math.round(L.S.def.wallHp)}　<button class="btn xs ok" onclick="V4UI.repair()">抢修</button></div>` : ''}
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const lg = document.getElementById('v4log');
  if (lg) lg.scrollTop = lg.scrollHeight;
  if (b.over) showEnd();
}

function showEnd() {
  if (!cur) return;
  const { b } = cur;
  const box = document.querySelector('#' + OV + ' .modal-bd') as HTMLElement | null;
  if (!box || document.getElementById('v4end')) return;
  const txt = b.over === 'win' ? '🏁 战斗结束：你活下来了' : b.over === 'lose' ? '💀 你倒下了' : '🏃 你脱离了战斗';
  const div = document.createElement('div');
  div.id = 'v4end';
  div.className = 'row';
  div.style.marginTop = '12px';
  div.innerHTML = `<span class="chip ${b.over === 'win' ? 'med' : 'heavy'}">${txt} · 输出 ${b.stats.dealt} · 承受 ${b.stats.taken}</span>
    <button class="btn primary" onclick="V4UI.close()">继续</button>`;
  box.appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
}

function killFoeHelpers() {
  if (!cur) return;
  // 同伴：每回合跟着你打一下（护士改成回血）
  const S = L.S;
  if (!S.comp || S.compHp <= 0 || !cur.b.foes.some(f => f.hp > 0)) return;
  const c = L.COMPANIONS[S.comp];
  if (S.comp === 'nurse') {
    const h = 7 + Math.floor(S.day / 4);
    cur.p.hp = Math.min(cur.p.hpMax, cur.p.hp + h);
    cur.b.player.hp = cur.p.hp;
    cur.b.log.push({ text: `💉 ${c.n} 替你处理了伤口（+${h}）。`, cls: 'good' });
  } else {
    const alive = cur.b.foes.filter(f => f.hp > 0);
    const t = alive[Math.floor(Math.random() * alive.length)];
    const d = Math.round(c.dmg * (1 + Math.floor(S.day / 6) * .1));
    t.hp -= d;
    cur.b.log.push({ text: `🤝 ${c.n} 出手，${t.name} 受到 ${d} 点伤害。`, cls: 'good' });
    if (t.hp <= 0) { onFoeFaint(cur.srcs[cur.b.foes.indexOf(t)], t); }
  }
}

export const V4UI = {
  /** 由 main.ts 挂到 window，供界面按钮与键盘调用 */
  target(i: number) { if (cur) { cur.b.target = i; render(); } },
  move(id: string) {
    if (!cur || cur.b.over) return;
    const { b, p } = cur;
    const tgt = b.target;                       // M38：记下这次打谁，给"重复上次"用
    const evFrom = b.events.length;
    playerAct(b, p, id, b.target);
    killFoeHelpers();
    // 击杀奖励（引擎只负责判定，奖励走 legacy）
    b.foes.forEach((f, i) => {
      if (f.hp <= 0 && !(f as any).__rewarded) { (f as any).__rewarded = true; onFoeFaint(cur!.srcs[i], f); }
    });
    // 只对这次行动新产生的伤害做飘字/抖动
    let hurt = 0;
    for (const e of b.events.slice(evFrom)) {
      if (e.kind === 'damage' && e.target && (e.target as any).side === 'foe') flashFoe((e.target as any).index, e);
      else if (e.kind === 'damage' && e.target && (e.target as any).side === 'player') {
        const hpEl = document.querySelector('#hud .bar i.hp');
        L.floatText('-' + (e.amount ?? ''), 'self', hpEl);
        hurt += Number(e.amount) || 0;
      }
    }
    /* M31：这一回合挨了多少 → 交给人体系统判定伤病（四个掉血入口只在这一个地方接，免得漏） */
    if (hurt > 0) {
      const md = (window as any).V4Medical as { onPlayerHurt?: (n: number) => void } | undefined;
      try { md?.onPlayerHurt?.(hurt); } catch (e) { console.warn('[v4] 伤病判定失败', e); }
    }
    b.events.length = 0;
    syncBack(p);
    lastAct = { id, target: tgt };              // M38：成功出招才记（失败的点击不覆盖）
    render();
  },
  /** M38：重复上次动作（R 键 / 按钮）—— 目标死了自动改打第一只活的；招式用不了就明说为什么 */
  repeat() {
    if (!cur || cur.b.over || !lastAct) return false;
    const { b, p } = cur;
    const m = movesFor(p).find(x => x.id === lastAct!.id);
    if (!m) { L.toast('重复不了', '上次那招的武器不在手上了。', 'bad'); return false; }
    const chk = canUse(p, m);
    if (!chk.ok) { L.toast('重复不了', chk.why, 'bad'); return false; }
    const t = repeatTarget(lastAct.target, b.foes);
    if (t < 0) return false;
    b.target = t;
    V4UI.move(m.id);
    return true;
  },
  switchWeapon() {
    if (!cur || cur.b.over) return;
    const S = L.S;
    const owned = Object.keys(S.inv).filter(id => L.ITEMS[id]?.t === 'wpn');
    if (owned.length < 2) { L.toast('没有别的武器', '背包里只有这一件武器。', 'bad'); return; }
    const idx = owned.indexOf(S.eq.wpn);
    S.eq.wpn = owned[(idx + 1) % owned.length];
    L.log('🔄 换上了 ' + L.ITEMS[S.eq.wpn].n + '（这一回合让给对方）。', 'info');
    cur.p = playerProfile();
    passTurn(cur.b, cur.p);
    syncBack(cur.p);
    render();
  },
  flee() {
    if (!cur || cur.b.over) return;
    if (tryFlee(cur.b, cur.p)) { syncBack(cur.p); render(); } else { syncBack(cur.p); render(); }
  },
  repair() {
    if (!cur) return;
    L.combatRepair();
    render();
  },
  close() {
    if (!cur) return;
    const { b, opts } = cur;
    const result = b.over ?? 'flee';
    L.closeModal(OV);
    cur = null;
    if (result === 'win' && opts?.onWin) opts.onWin();
    if (result === 'flee' && opts?.onFlee) opts.onFlee();
    if (result === 'lose' && opts?.onLose) opts.onLose();
    if (result === 'win') { L.log('🏁 战斗结束：你活下来了。', 'success'); L.sfx('ok'); }
    /* M27：第一场胜利后给一次"招式槽/噪音/装甲丧尸"的提示（战斗界面是模态，教程只能这样接） */
    if (result === 'win') { try { (window as any).__v4TutorialBattleTip?.(); } catch { /* 忽略 */ } }
    onEnd(result);
  },
  key(e: KeyboardEvent) {
    if (!cur) return false;
    const k = e.key;
    if (k >= '1' && k <= '4') { const m = movesFor(cur.p)[+k - 1]; if (m) V4UI.move(m.id); return true; }
    if (k === '5') { V4UI.flee(); return true; }
    if (k === '6') { V4UI.switchWeapon(); return true; }
    if (k === 'r' || k === 'R') { V4UI.repeat(); return true; }   // M38：重复上次
    return false;
  },
  isOpen() { return !!cur; },
  /** M38：验证/调试用 —— 当前记着的"上次动作" */
  last() { return lastAct; },
  /** 验证/调试用：拿到当前战斗对象（探针要能强制结算来测 onWin 链） */
  battle() { return cur ? cur.b : null; },
};

function flashFoe(i: number, e: any) {
  const el = document.getElementById('v4foe-' + i);
  if (!el) return;
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  const r = el.getBoundingClientRect();
  const cls = e.effectiveness >= 2 ? 'crit' : (e.crit ? 'crit' : '');
  const txt = (e.effectiveness >= 2 ? '拔群 ' : '') + (e.crit ? '暴击 ' : '') + (e.amount ?? '');
  L.floatText(txt, cls, el);
  if (e.effectiveness >= 2) L.shake();
}

/** legacy 的 startCombat 签名：foes 可以是 id 字符串，也可以是完整的怪对象 */
export function startV4Combat(foes: any[], opts: any = {}) {
  // 守夜战但人不在家：不该开战（玩家在十公里外"守"据点说不通）。交给 night.ts 注册的处理函数结算成"据点被啃"。
  const away = (window as any).__v4AwaySiege;
  if (opts.siege && typeof away === 'function' && away(opts)) return null;
  // 未知 id 不能让整场战斗炸掉：legacy 的 mkFoe 遇到表里没有的 id 会抛 TypeError，
  // 这里降级成普通丧尸并留下一条警告，避免"遭遇直接没反应"这种哑火。
  const srcs: any[] = foes.map(f => {
    if (typeof f !== 'string') return f;
    try { return L.mkFoe(f); }
    catch {
      console.warn('[v4] 未知敌人 id，已降级为 walker:', f);
      L.log('⚠️ 未知敌人类型 ' + f + '，已按普通丧尸处理。', 'bad');
      return L.mkFoe('walker');
    }
  });
  const v4foes: Foe[] = srcs.map(s => toFoe(s));
  const p = playerProfile();
  const battle = createBattle(v4foes, p, {
    ...opts,
    hooks: {
      onPlayerHit: (dmg, foe) => onPlayerHit(dmg, foe),
      onPlayerFaint: () => L.sfx('lose'),
      onFoeFaint: () => { /* 奖励在 V4UI.move 里按 srcs 对齐发放 */ },
    },
  });
  cur = { b: battle, p, srcs, opts };
  lastAct = null;                               // M38：新战斗没有"上次动作"
  // 守夜战的"提前准备回报"：legacy 是在 startCombat 之后自己改 battle.foes 的，那套现在够不到 v4 的战场，
  // 所以在这里按同样的数值补上（警报器/钉刺/燃烧各消耗一次）。
  if (opts.siege) applySiegeTraps(battle);
  L.closeAllModals();
  const root = document.createElement('div');
  root.className = 'overlay';
  root.id = OV;
  document.getElementById('overlay-root')!.appendChild(root);
  L.sfx('bad');
  advance(battle, p, battle.playerSpeed);
  render();
  return battle;
}

export function isV4BattleOpen() { return !!cur; }

/** 守夜战开场陷阱：与 legacy 同数值（警报器 -20%、钉刺 -22、燃烧 -26），用掉一次就少一次 */
function applySiegeTraps(b: Battle) {
  const tr = L.S?.def?.traps;
  if (!tr) return;
  const dmgAll = (n: number, why: string) => {
    b.foes.forEach(f => { if (f.hp > 0) f.hp = Math.max(0, f.hp - n); });
    b.log.push({ text: why, cls: 'good' });
  };
  if (tr.alarm > 0) {
    tr.alarm--;
    b.foes.forEach(f => { if (f.hp > 0) f.hp = Math.max(1, Math.round(f.hp * 0.8)); });
    b.log.push({ text: '📡 警报器提前暴露了它们（全体 -20% 生命）。', cls: 'good' });
  }
  if (tr.spike > 0) { tr.spike--; dmgAll(22, '🔺 钉刺陷阱撕开了最前面那只（-22）。'); }
  if (tr.fire > 0) { tr.fire--; dmgAll(26, '🔥 燃烧陷阱烧成一片（全体 -26）。'); }
}
