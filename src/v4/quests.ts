/* M13 委托（接单制）+ 大故事（章节制）的接线层：
   - 纯逻辑在 contracts-core.ts / story-core.ts（有单测），这里只做三件事：
     ① 把 legacy 存档读成判定用的快照 Snap；② 结算落地（材料/物品/日志/toast）；
     ③ 渲染任务页的两块 HTML（legacy renderQuest 里插进来）。
   换日与进度推送由 legacy 的 rollBounties()/bountyTick() 调用点转进来（见 game.ts 的桥），
   所以睡觉、击杀、搜刮这些老路径一行都不用改。 */
import { L } from '../main';
import {
  MAX_ACTIVE, accept as acceptCore, abandon as abandonCore, activeLine, ensureContracts, metricLabel,
  metricNow, progressOf, regionHint, rollOffers, settle,
  type ActiveContract, type BoardOffer, type ContractReward, type ContractsState, type Snap,
} from './contracts-core';
import {
  STORY, STORY_LEN, archive, chapterLine, chapterRegionHint, chapterView, currentChapter, emptyStory,
  ensureStory, nextObjective, objMetricLabel, storyTick, type StoryState,
} from './story-core';
import { ensureSaveWorld, worldOf, type SaveWorld } from './worldstate';
import { HOME_REGION, REGIONS, regionName } from './regions-core';

const S = () => L.S as any;
const sw = (): SaveWorld => ensureSaveWorld(S());

/* ── ① 快照 ───────────────────────────────────────── */
/** legacy 存档 → 判定快照。委托与剧情共用同一套指标（与旧悬赏板的 metric 命名一致）。 */
export function snapNow(): Snap {
  const s = S(), st = s.stats || {}, w = sw();
  const regions: Record<string, number> = { ...(w.regionVisits || {}) };
  regions[w.region] = Math.max(1, regions[w.region] || 0);          // 站在这个区就算来过
  return {
    day: s.day,
    kills: st.kills || 0,
    deep: st.deep || 0,
    hordes: st.hordes || 0,
    nights: st.nights || 0,
    killBy: { ...(st.killBy || {}) },
    zones: { ...(st.zoneCnt || {}) },
    items: itemCounts(),
    regions,
  };
}

function itemCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  const inv = S().inv;
  if (Array.isArray(inv)) for (const it of inv) if (it && it.id) out[it.id] = (out[it.id] || 0) + (it.n || 1);
  else if (inv && typeof inv === 'object') for (const k in inv) out[k] = Number(inv[k]) || 0;
  return out;
}

/* ── ② 区域里到底有哪些 POI（委托不能指向不存在的地方） ── */
const poiCache = new Map<string, Set<string>>();
function poisIn(region: string): Set<string> {
  const key = sw().seed + '::' + region;
  const hit = poiCache.get(key);
  if (hit) return hit;
  const set = new Set<string>();
  try {
    const w = worldOf(sw().seed, region);
    for (const k in w.blocks) { const p = w.blocks[k].poi; if (p) set.add(p); }
  } catch (e) { console.warn('[v4] 区域 POI 扫描失败', region, e); }
  poiCache.set(key, set);
  return set;
}
export const hasPoiIn = (region: string, poi: string) => poisIn(region).has(poi);
export const hasVehicle = (): boolean => { const v = sw().veh; return !!v && v.hp > 0; };

/* ── ③ 状态保证 + 换日刷板 ─────────────────────────── */
export function ensureQuests(): { ct: ContractsState; sy: StoryState } {
  const s = S();
  s.contracts = ensureContracts(s.contracts, s.day);
  s.story = ensureStory(s.story);
  const ct = s.contracts;
  /* 只有"这一天的板子还没刷过"才刷。刷过之后板子空着就是空着——
     否则玩家把 3 张全接完再打开任务页就会白得一张新板子（等于一天无限接单）。 */
  if (!ct.rolled || ct.day !== s.day) refresh(ct);
  return { ct, sy: s.story };
}

function refresh(ct: ContractsState = S().contracts) {
  const s = S(), w = sw();
  const set = poisIn(w.region);
  ct.day = s.day;
  ct.rolled = true;
  ct.board = rollOffers(s.day, Math.random, s.quest ? s.quest.stage : 0, { hasPoi: p => set.has(p), region: w.region });
}

/** 换日：先结算（完成/过期），再刷一张新板子。legacy 的 rollBounties() 转到这里。
 *  注意：ensure/tick 都会重新指向 S.contracts，所以刷板必须用**更新之后**的引用。 */
export function newDay() {
  ensureQuests();
  tickQuiet();
  refresh();
  L.render?.();
  L.autosave?.();
}

/** 进度推送：击杀/搜刮/过夜之后调用（legacy 的 bountyTick()），做完就结算给奖。 */
export function tick() {
  ensureQuests();
  tickQuiet();
}

function tickQuiet() {
  const s = S(), { ct, sy } = ensureQuests();
  const snap = snapNow();
  const before = ct.active.length;
  const res = settle(ct, snap);
  if (res.completed.length || res.expired.length) {
    s.mat += res.matGain;
    for (const id in res.items) L.grant(id, res.items[id], true);
    s.stats.bounties = (s.stats.bounties || 0) + res.completed.length;
    if (s.stats.bounties >= 10) L.award('a_bounty');
    for (const m of res.messages) L.log(m, res.completed.length ? 'success' : 'dim');
    if (res.completed.length) { L.toast('📋 委托完成 ' + res.completed.length + ' 张', res.completed.map(c => c.title).join('、'), 'ok'); L.sfx('ok'); }
  }
  /* 剧情推进（目标全达成 + 主线阶段到位） */
  const sp = storyTick(sy, snap, s.quest ? s.quest.stage : 0);
  if (sp.advanced.length) {
    applyReward(sp.reward);
    for (const m of sp.messages) L.log(m, 'lore');
    const last = sp.advanced[sp.advanced.length - 1];
    L.toast('📖 第 ' + last.no + ' 章完成：' + last.title, last.sub, 'lore');
    L.sfx('ok');
    L.render?.();
  }
  if (res.completed.length || res.expired.length || before !== ct.active.length) L.render?.();
}

function applyReward(r: ContractReward) {
  if (r.mat) { S().mat += r.mat; }
  if (r.item) L.grant(r.item, r.n || 1, true);
}

/* ── ④ UI ─────────────────────────────────────────── */
const bar = (cur: number, need: number) => {
  const pct = Math.max(0, Math.min(100, Math.round((cur / Math.max(1, need)) * 100)));
  return '<div class="bar thin"><i class="sta" style="width:' + pct + '%"></i></div>';
};
const rewardText = (r: ContractReward) =>
  '🔩' + (r.mat ?? 0) + (r.item ? ' + ' + L.itemName(r.item) + '×' + (r.n ?? 1) : '');

/** 任务页：大故事面板（章节 + 目标 + 剧情日志） */
export function storyHtml(): string {
  const s = S(), { sy } = ensureQuests();
  const snap = snapNow(), stage = s.quest ? s.quest.stage : 0;
  const cur = currentChapter(sy);
  const v = chapterView(Math.min(sy.chapter, STORY_LEN - 1), sy, snap, stage);
  const finished = sy.chapter >= STORY_LEN;
  let h = '<div class="sect-title">大故事 · 余烬 <span class="badge">第 ' +
    Math.min(sy.chapter + 1, STORY_LEN) + ' / ' + STORY_LEN + ' 章</span></div>';
  h += '<div class="card v4story">';
  if (finished) {
    h += '<h3>✅ 全书完结 · ' + cur.title + '</h3><p class="v4story-intro">' + cur.outro + '</p>';
  } else {
    h += '<h3>第 ' + cur.no + ' 章 · ' + cur.title + ' <span class="sub">' + cur.sub + '</span></h3>' +
      '<p class="v4story-intro">' + cur.intro + '</p>';
    h += '<div class="hint">📍 ' + chapterRegionHint(v, sw().region, hasVehicle()) + '</div>';
    for (const o of v.objs) {
      h += '<div class="v4obj' + (o.done ? ' ok' : '') + '">' +
        '<div class="row"><span class="nm">' + (o.done ? '✅ ' : '◇ ') + o.def.text + '</span><span class="spacer"></span>' +
        '<span class="hint mono">' + o.cur + '/' + o.def.need + '</span></div>' +
        bar(o.cur, o.def.need) +
        '<div class="hint">判定：' + objMetricLabel(o.def) + ' · ' + o.def.hint + '</div>' +
        '</div>';
    }
    const next = nextObjective(sy, snap, stage);
    h += '<div class="hint" style="margin-top:8px">下一步：' + (next || '这一章的条件已经齐了，去任务页看看（推进会在下次动作后触发）') + '</div>';
    if (!v.gateOpen) h += '<div class="hint">🔒 ' + (cur.gate || '先推进主线') + '</div>';
    h += '<div class="hint">章节奖励：' + rewardText(cur.reward) + '</div>';
  }
  h += '</div>';
  const log = archive(sy);
  h += '<details class="v4arc"><summary>📜 剧情日志（' + log.length + ' 条）</summary>' +
    (log.length
      ? log.map(e => '<div class="v4arcrow"><div class="nm">第 ' + e.day + ' 天 · 第 ' + e.ch + ' 章 ' + e.title + '</div>' +
        '<div class="ds">' + e.text + '</div></div>').join('')
      : '<p class="muted">还没有记录。完成第一章就会写下第一条。</p>') +
    '</details>';
  return h;
}

/** 任务页：委托（进行中 + 今日板） */
export function contractsHtml(): string {
  const s = S(), { ct } = ensureQuests();
  const snap = snapNow(), w = sw();
  const car = hasVehicle();
  let h = '<div class="sect-title">委托 · 接单 <span class="badge">手上 ' + ct.active.length + ' / ' + MAX_ACTIVE +
    ' · 完成 ' + ct.done + ' · 失败 ' + ct.failed + '</span></div>';

  h += '<div class="grid" style="gap:6px;margin-bottom:12px">';
  if (!ct.active.length) h += '<p class="muted">手上没有委托。接一张——注意期限，过期就作废。</p>';
  ct.active.forEach((c, i) => {
    const p = progressOf(c, snap);
    h += '<div class="lrow v4ct' + (p.done ? ' ok' : '') + '" style="flex-direction:column;align-items:stretch;gap:5px">' +
      '<div class="row"><span class="nm">📋 ' + c.title + '</span><span class="spacer"></span>' +
      '<span class="hint mono">' + p.current + '/' + p.need + '</span>' +
      '<span class="tag ' + (p.daysLeft <= 1 ? 'thr' : '') + '">剩 ' + Math.max(0, p.daysLeft) + ' 天</span></div>' +
      bar(p.current, p.need) +
      '<div class="hint">' + metricLabel(c.metric) + ' ×' + c.need + '（接了以后才算数）' +
      (regionHint(c, w.region, car) ? ' · 🌐 ' + regionHint(c, w.region, car) : '') + '</div>' +
      '<div class="row"><span class="hint">赏金 ' + rewardText(c.reward) + '</span><span class="spacer"></span>' +
      '<button class="btn xs" onclick="V4Quest.abandon(' + i + ')">放弃</button></div>' +
      '</div>';
  });
  h += '</div>';

  h += '<div class="sect-title">今日委托板 <span class="badge">' + ct.board.length + ' 张 · 睡一觉换新的</span></div>';
  h += '<div class="grid" style="gap:6px">';
  ct.board.forEach((o, i) => {
    const far = !!o.region && o.region !== w.region;
    const blocked = far && !car;
    h += '<div class="lrow v4ct" style="flex-direction:column;align-items:stretch;gap:5px">' +
      '<div class="row"><span class="nm">' + (far ? '🌐 ' : '📋 ') + o.title + '</span><span class="spacer"></span>' +
      '<span class="tag gear">' + rewardText(o.reward) + '</span></div>' +
      '<div class="ds">' + o.desc + '</div>' +
      '<div class="hint">判定：' + metricLabel(o.metric) + ' ×' + o.need + ' · 期限 ' + o.days + ' 天' +
      (far ? ' · ' + regionHint(o, w.region, car) : '') + '</div>' +
      '<div class="row">' +
      (blocked
        ? '<span class="tag thr">没车到不了</span>'
        : '<button class="btn xs ok" onclick="V4Quest.accept(' + i + ')">接受</button>') +
      '<span class="hint">接单后进度从这一刻起算</span></div>' +
      '</div>';
  });
  if (!ct.board.length) h += '<p class="muted">今天的板子空了。</p>';
  h += '</div>';
  if (ct.log.length) {
    h += '<details class="v4arc"><summary>📋 委托记录（最近 ' + ct.log.length + ' 条）</summary>' +
      ct.log.slice(-8).reverse().map(t => '<div class="v4arcrow"><div class="ds">' + t + '</div></div>').join('') + '</details>';
  }
  return h;
}

/** 探索页：只放一行摘要，详细板子在任务页 */
export function teaser(): string {
  const s = S(), { ct, sy } = ensureQuests();
  const snap = snapNow();
  const near = ct.active.map(c => c.title + ' ' + (() => { const p = progressOf(c, snap); return p.current + '/' + p.need; })()).join(' · ');
  const ch = currentChapter(sy);
  return '<div class="card v4teaser" style="margin-bottom:12px">' +
    '<div class="row"><span class="nm">📖 第 ' + Math.min(sy.chapter + 1, STORY_LEN) + ' 章 · ' + ch.title + '</span>' +
    '<span class="spacer"></span><button class="btn sm" onclick="setTab(\'quest\')">任务页 →</button></div>' +
    '<div class="hint">' + (near ? '手上委托：' + near : '手上没有委托（今日板上 ' + ct.board.length + ' 张）') + '</div>' +
    '</div>';
}

/* ── ⑤ 内联 onclick 入口（名字与 quests.ts 导出一致；main.ts 挂到 window.V4Quest） ── */
export function accept(i: number): boolean {
  const { ct } = ensureQuests();
  const o = ct.board[i];
  if (!o) return false;
  const far = !!o.region && o.region !== sw().region;
  if (far && !hasVehicle()) { L.toast('去不了', '这张委托在' + regionName(o.region!) + '——先弄辆车（汽修厂/物流园）。', 'bad'); return false; }
  const r = acceptCore(ct, o.key, snapNow());
  if (!r.ok) { L.toast('接不了', r.why || '', 'bad'); return false; }
  L.log('📋 接了委托：' + o.title + '（' + metricLabel(o.metric) + ' ×' + o.need + '，' + o.days + ' 天内）', 'info');
  if (far) L.log('　 🌐 目标在' + regionName(o.region!) + '：探索页 → 区域面板，开车过去。', 'dim');
  L.sfx('ok'); L.render(); L.autosave();
  return true;
}

export function abandon(i: number): boolean {
  const s = S(), { ct } = ensureQuests();
  const c = ct.active[i];
  if (!c) return false;
  abandonCore(ct, c.id, s.day);
  L.log('📋 放弃了委托：' + c.title, 'dim');
  L.toast('已放弃', c.title, 'info');
  L.render(); L.autosave();
  return true;
}

/** 调试/探针用：一次拿全（不做副作用） */
export function summary() {
  const s = S(), { ct, sy } = ensureQuests();
  const snap = snapNow();
  return {
    day: s.day, region: sw().region, hasCar: hasVehicle(),
    chapter: sy.chapter, chapterTitle: currentChapter(sy).title,
    board: ct.board.map(o => ({ key: o.key, title: o.title, metric: o.metric, need: o.need, days: o.days, region: o.region || null, mat: o.reward.mat ?? 0, item: o.reward.item ?? null })),
    active: ct.active.map(c => ({ id: c.id, title: c.title, metric: c.metric, ...progressOf(c, snap) })),
    rolled: !!ct.rolled, contractsDay: ct.day,
    done: ct.done, failed: ct.failed, log: ct.log.slice(-6), storyLog: sy.log.slice(-3),
    storyObjs: chapterView(Math.min(sy.chapter, STORY_LEN - 1), sy, snap, s.quest ? s.quest.stage : 0).objs.map(o => ({ text: o.def.text, cur: o.cur, need: o.def.need, done: o.done })),
  };
}

export const V4Quest = { accept, abandon, summary, storyHtml, contractsHtml, teaser, newDay, tick, snapNow, ensureQuests };
export type { ActiveContract, BoardOffer, ContractsState, StoryState };
export { STORY, REGIONS, HOME_REGION, metricNow, emptyStory, activeLine, chapterLine };
