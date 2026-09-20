/* 大世界地图界面：24×24 个 1km² 区块 + 迷雾 + 区块内 POI + 跨区块旅行（走路/开车）。
   legacy 的「城市地图」和「可搜刮区域」两块由这里接管（mount 时把那两段 DOM 摘掉），
   其余探索页内容（今日行动 / 委托板 / 日历）保持原样。 */
import { L } from '../main';
import { POIS, BIOME_INFO } from './pois';
import { blockAt, bkey, WORLD_W, WORLD_H, zoneLabel } from './worldgen';
import {
  ensureSaveWorld, markVisited, planTrip, rollTravelEncounter, switchRegion, worldOf, zoneOfPoi,
  type SaveWorld, type Trip,
} from './worldstate';
import {
  META_COLS, META_ROWS, MAX_HOPS, REGIONS, REGION_TYPES as TYPES, TYPE_INFO, dangerColor, dangerLabel, homeRegion,  metaGrid, planRegionTrip, regionById, regionName, typeColor, typeLabel, type RegionDef,
} from './regions-core';
import { poiLeft, searchPoi } from './search';
import { cellTargets, fitCellSize, CELL_HARD_FLOOR } from './ui-scale-core';   // M40/M41：地图格子的目标尺寸与"一屏装下"的取舍（纯函数）
import { lastRegionEvent, onEnterRegion } from './region-events';
import { regionHazardTitles } from './region-events-core';
import { ghostAt, placeGhosts, raidGhost } from './ghosts';
import { ghostFoes } from './ghosts-core';
import { pendingFragKeys, takeFragment } from './fragments';
import { apCapOf, isBloodMoonDay, rest, restOptions, tierAt, syncApMax } from './night';
import { claimPlan, fallbackTitle, sectionGroups, bodyIsEmpty, type LegacyKind } from './card-wall-core';   // M45：legacy 节点认领计划（防重复卡）；M50：其它页签的分段包卡
/** M32.1：当前字号倍率（#v4world / #v4cards 上的 zoom）。这里不 import ui-scale（会和 main 形成
    循环），走 main.ts 挂在 window 上的那份；拿不到就按 1 算。fitMap/fitRegion 用它把"像素下限"
    换算成**渲染后**的尺寸 —— zoom 之后本地 24px 在 160% 下是 38px，窗口宽度却不会跟着变。 */
const uiZoom = (): number => {
  const z = Number((window as any).V4Scale?.zoomNow?.() ?? 1);
  return (isFinite(z) && z > 0) ? z : 1;
};
/** M34：地图摆法（float=右上角悬浮窗 / inline=探索页顶部）。理由同 uiZoom —— 不 import ui-scale，走 window 上那份。 */
const prefsMapStyle = (): 'float' | 'inline' => {
  try { return (window as any).V4Scale?.mapStyle?.() === 'inline' ? 'inline' : 'float'; } catch { return 'float'; }
};
/** M40：是不是触屏（手机/平板）—— 决定地图格子的点击命中区（手指 24px 太难点）。
 *  用 `(hover:none), (pointer:coarse)` 而不是 UA 判断：平板接鼠标、手机接键盘都能正确分流。 */
const coarsePointer = (): boolean => {
  try { return typeof matchMedia === 'function' && matchMedia('(hover:none), (pointer:coarse)').matches; } catch { return false; }
};
/** M25.2：当前体能等级 —— 行动力上限的加成来源（每 3 级 +1，最多 +5），面板与地图必须用同一个数 */
const fitLv = (): number => Number((L.S as any)?.skills?.fitness ?? 0);
import { ensureEvac, evacAvailable, fireFlare } from './evac';
import { CROPS, SEASON_INFO, WEATHER, growthDays } from './env-core';
import { envLine, envOf, seasonNow, tempPenalty } from './env';
import { abundanceTier } from './region-danger';       // M30：资源丰度档位（大区格子右下角那格小方块）
import { farmSummary, cropList, harvest, plant, plotSlots, farmBuildCost } from './farm';
import { radGain, radLevelAt, radProtect, RAD_SOURCES, geigerText } from './rad-core';
import { chopInfo, forageInfo, salvageInfo } from './gather';
import { diveInfo, fishInfo, intakeInfo, canSwim, pondSummary, swimStep, waterNearby, fish as doFish, dive as doDive } from './water';
import { accountSummary, currentUser as accountUser } from './account-ui';
import type { Block, WorldState } from '../types';

/** 面板用的薄包装：默认参数与图标都在 water.ts 里 */
const swimCan = () => waterNearby().any;
const diveOk = () => diveInfo().ok;
const diveLeft = () => diveInfo().left;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** C10 路线预览：点一次出报价，点第二次（或点确认）才真的走 */
let preview: { x: number; y: number; path: string[]; text: string; ok: boolean } | null = null;

const biomeName = (b: Block) => BIOME_INFO[b.biome]?.name ?? b.biome;
const poiOf = (b: Block | null) => (b && b.poi ? POIS[b.poi] : null);
const homeKey = (sw: SaveWorld) => { const w = worldOf(sw.seed, sw.region); return bkey(w.home.x, w.home.y); };

function sw(): SaveWorld { return ensureSaveWorld(L.S); }
function curBlock(): Block { const s = sw(); const w = localWorld(s); return blockAt(w, s.cur.x, s.cur.y) as Block; }

/** M24：技能 perk 查询（到级即生效，和 legacy 的 hasPerk 同一套规则）。
    写在 world-ui 里而不是各模块各写一遍——技能判定只该有一处真相。 */
export function perkOn(skill: string, lv: number): boolean {
  return Number((L.S as any)?.skills?.[skill] ?? 0) >= lv;
}

/* ── M25 辐射：地图上的辐射场 + 走动累积 ── */
/** 这张图上所有辐射源（核电站 / 废料填埋场）。按世界实例记忆——576 格每个都扫一遍太浪费 */
let radSrcCache: { w: WorldState; src: { x: number; y: number; kind: string }[] } | null = null;
function radSourcesOf(w: WorldState): { x: number; y: number; kind: string }[] {
  if (radSrcCache && radSrcCache.w === w) return radSrcCache.src;
  const out: { x: number; y: number; kind: string }[] = [];
  for (const k in w.blocks) {
    const b = w.blocks[k];
    if (b.poi && RAD_SOURCES[b.poi]) out.push({ x: b.x, y: b.y, kind: b.poi });
  }
  radSrcCache = { w, src: out };
  return out;
}
/** 玩家身上的辐射防护（防化服 / 防毒面具 / 潜水服 叠加，上限 85%） */
function myRadProtect(): number {
  const eq = (L.S as any)?.eq || {};
  const gear = [eq.body, eq.mask, eq.feet].map((id: string) => (id && L.ITEMS[id]) || null);
  return radProtect(gear as any);
}
const hasGeiger = (): boolean => L.itemCount('geiger') > 0 || (L.S as any)?.eq?.trinket === 'geiger';
/** 走完一段路之后结算辐射：按每一格自己的等级累加，并给一句盖革读数 */
function radAfterWalk(w: WorldState, path: { x: number; y: number }[], steps: number): void {
  const src = radSourcesOf(w);
  if (!src.length) return;
  const prot = myRadProtect();
  let gain = 0, maxLv = 0;
  for (let i = 1; i <= steps && i < path.length; i++) {
    const lv = radLevelAt(src, path[i].x, path[i].y);
    if (lv > 0) { gain += radGain(lv, 1, prot); maxLv = Math.max(maxLv, lv); }
  }
  if (!gain) return;
  const S = L.S as any;
  S.rad = Math.max(0, Math.min(100, Math.round(S.rad + gain)));
  L.log(geigerText(maxLv, hasGeiger()) + '　体内辐射 +' + gain + '（现在 ' + Math.round(S.rad) + '）' +
    (prot > 0 ? '　🛡️ 防护 -' + Math.round(prot * 100) + '%' : '　⚠️ 没有任何防护，碘片/防化服能少吸收一半以上'), 'danger');
}
/** 当前这一格的辐射等级（面板/详情用） */
function radHere(w: WorldState): number {
  const s = sw();
  return radLevelAt(radSourcesOf(w), s.cur.x, s.cur.y);
}
/** M24 机械技能：修车材料按等级打折（Lv3 起再 -30%） */
export function repairCost(base: number): number {
  const lv = Number((L.S as any)?.skills?.mechanic ?? 0);
  const cut = Math.min(0.5, lv * 0.08 + (lv >= 3 ? 0.3 : 0));
  return Math.max(1, Math.round(base * (1 - cut)));
}

/** M20：把导入的幽灵据点钉到当前世界上（幂等，每个世界只钉一次） */
const ghostPlaced: Record<string, true> = {};
function withGhosts(w: WorldState): WorldState {
  const key = w.seed;
  if (!ghostPlaced[key]) { ghostPlaced[key] = true; try { placeGhosts(w); } catch (e) { console.warn('[v4] 幽灵据点放置失败', e); } }
  return w;
}
/** 取"当前区域那张图"（带上幽灵据点） */
const localWorld = (s: SaveWorld): WorldState => withGhosts(worldOf(s.seed, s.region));

/** 骨折：走路要额外花行动力（legacy 的伤口系统里叫 fracture） */
function fractured(): boolean {
  return !!(L.S.wounds || []).some((w: any) => w.t === 'fracture');
}
const isNight = () => {
  const p = String(L.phaseName ? L.phaseName()[0] : '');
  return p.includes('夜') || p.includes('黄');
};

/* ── 面板渲染 ── */

function cellHtml(b: Block, s: SaveWorld, frags: Record<string, 1>, dangerMode = false): string {
  const w = worldOf(s.seed, s.region);
  const cur = b.x === s.cur.x && b.y === s.cur.y;
  const isHome = bkey(b.x, b.y) === bkey(w.home.x, w.home.y);
  const labKnown = !!L.S.base.radio && b.poi === 'lab';
  const isFrag = !!frags[bkey(b.x, b.y)];
  const ev = ensureEvac();
  const isEvac = ev.open && ev.site.x === b.x && ev.site.y === b.y;
  const radLv = radLevelAt(radSourcesOf(w), b.x, b.y);      // M25：这一格的辐射等级
  const onPath = !!preview && preview.path.includes(bkey(b.x, b.y));
  const isTarget = !!preview && preview.x === b.x && preview.y === b.y;
  /* M19：危险度图层——格子底色换成"越深越红"的梯度（贴着安全屋是绿的），
     地貌色让位；其余状态（迷雾/当前格/路线/角标）照旧。 */
  const cls = ['wcell', dangerMode ? 'dlayer' : 'b-' + b.biome];
  if (dangerMode && b.revealed) cls.push('dg' + b.danger);
  if (!b.revealed) cls.push('fog');
  else cls.push('seen');
  if (cur) cls.push('cur');
  if (isHome) cls.push('home');
  if (isFrag) cls.push('frag');
  if (isEvac) cls.push('evac');
  if (onPath) cls.push('path');
  if (isTarget) cls.push('target');
  // M15：有路的格子加一个角标（真实城市的"沿街"比"整格都是路"常见得多）
  if (b.revealed && b.road && b.biome !== 'water') cls.push(b.biome === 'highway' ? 'arterial' : 'road');
  let icon = '';
  if (b.revealed) {
    if (isHome) icon = '🏠';
    else if (b.poi === 'ghost') icon = '👻';          // M20：幽灵据点一眼可见（不要求已到访）
    else if (isEvac) icon = '📡';
    else if (labKnown) icon = '☣️';
    else if (isFrag) icon = '🔑';
    else if (b.poi === 'sunken') icon = '🤿';
    else if (b.biome === 'water') icon = '🌊';
    else if (b.visited && b.poi) icon = POIS[b.poi].icon;
  }
  const tip = !b.revealed ? '未探索区域'
    : (b.zone ? zoneLabel(b.zone) + ' · ' : '') + biomeName(b) + ' · 危险 ' + b.danger
      + (radLv > 0 ? ' · ☢️ 辐射 ' + radLv + ' 级' : '')
      + (b.visited && b.poi ? ' · ' + POIS[b.poi].name : '')
      + (b.biome === 'water' ? ' · 水域：可以游过去（2 行动力/格），水边能钓鱼' : b.biome === 'highway' ? ' · 主干道：开车最快' : b.road ? ' · 沿街：开车比越野快' : '')
      + (b.poi === 'sunken' ? ' · 沉没基地：需要潜水（氧气瓶）' : '')
      + (isFrag ? ' · 疑似门禁卡碎片' : '')
      + (isEvac ? ' · 撤离点' : '')
      + (b.revealed && !b.visited ? ' · 未去过' : '');
  const click = b.revealed ? ' onclick="V4World.click(' + b.x + ',' + b.y + ')"' : '';
  // C10/R6：悬停/长按显示可读详情（不依赖 emoji），点击命中区由 CSS 保证 ≥24px
  const hover = b.revealed ? ' onmouseenter="V4World.hover(' + b.x + ',' + b.y + ')"' : '';
  return '<div class="' + cls.join(' ') + '" role="button" tabindex="0" title="(' + b.x + ',' + b.y + ') ' + esc(tip) + '"' + click + hover + '>' + icon + '</div>';
}

/** 地图块（宽屏时单独占一列：标题 + 状态行 + 24×24 格 + 预览/悬停/图例） */
/* ── M17 大区面板：12×12 = 144 格的元地图，按**地貌类型**上色 ──
   为什么推倒重做（用户反馈 + 一份外部评审）：
     · 3×3 只有 9 格，"大世界"名不副实；9 个地名是手写的 → 地理逻辑互相打架
     · 危险度看不出梯度，格子上也没有"这地方是什么、能弄到什么"的暗示
   现在的做法：
     · 格子底色 = 区域类型（工业区/农田/林地…），一眼看出哪片是什么
     · 右上角数字 = 危险度 1~5（离余烬越远越危险），配一条危险图例
     · 点一格先**选中**（不动身）：下面出详情（类型/危险/距离/物资/途经路线/出发按钮）
     · 选中会点亮整条行车路线，去不了就直说为什么、怎么办 */
let selectedRegion: string | null = null;      // 选中的区域（和"当前所在"分开：点错了不会把你开出去）
let selectedNote = '';                         // 详情区的一句话提示（出发失败等）

/* ── M17.2：大区地图的两种"上色图层" ──
   评审 #3 原话："配色依然是灾难级的……红绿蓝黄交替，看久了让人眼瞎"。
   地貌色对"这地方是什么"最有用，危险度色对"往哪跑"最有用，两个诉求打架——
   所以给一个图层开关：地貌上色（默认）/ 危险度上色（绿→红单色渐变，一眼看出该往哪边躲）。 */
export type RegionLayer = 'type' | 'danger';
const LAYER_KEY = 'dsh.regionlayer';
let regionLayer: RegionLayer = (() => {
  try { return localStorage.getItem(LAYER_KEY) === 'danger' ? 'danger' : 'type'; } catch { return 'type'; }
})();
export const currentRegionLayer = (): RegionLayer => regionLayer;
export function setRegionLayer(m: string): boolean {
  const next: RegionLayer = m === 'danger' ? 'danger' : 'type';
  if (next === regionLayer) return false;
  regionLayer = next;
  try { localStorage.setItem(LAYER_KEY, next); } catch { /* 隐私模式：记不住就算了 */ }
  try { mountWorldPanel(); } catch (e) { console.warn('[v4] 切换图层失败', e); }
  return true;
}

/** 大区行程报价（车况/油/行动力都算进去） */
function regionTripFor(s: SaveWorld, to: string) {
  return planRegionTrip({
    hasVehicle: !!s.veh && s.veh.hp > 0,
    fuel: s.veh ? s.veh.fuel : 0,
    ap: L.S.ap,
    apMax: apCapOf(s.debt, fitLv()),
    from: s.region,
    to,
  });
}

/* ── M16：本地地图 / 大区地图合并到一个面板，用一个按钮切换 ──
   用户反馈：3×3 大区地图和 24×24 本地地图分成两块太占地方，也不方便来回看。
   两张图其实是"同一件事的两个缩放级"，所以合成一块、记住上次看的是哪个视图。 */
export type MapMode = 'local' | 'region';
const MAP_MODE_KEY = 'dsh.mapmode';
let mapMode: MapMode = (() => {
  try { return localStorage.getItem(MAP_MODE_KEY) === 'region' ? 'region' : 'local'; } catch { return 'local'; }
})();
export const currentMapMode = (): MapMode => mapMode;
export function setMapMode(m: string): boolean {
  const next: MapMode = m === 'region' ? 'region' : 'local';
  if (next === mapMode) return false;
  mapMode = next;
  try { localStorage.setItem(MAP_MODE_KEY, next); } catch { /* 隐私模式：记不住就算了 */ }
  try { mountWorldPanel(); } catch (e) { console.warn('[v4] 切换地图视图失败', e); }
  return true;
}
/** 视图切换按钮（两个按钮做成一段 segmented control） */
function mapTabs(): string {
  const tab = (id: MapMode, label: string, badge: string) =>
    '<button class="wmtab' + (mapMode === id ? ' on' : '') + '" onclick="V4World.mapMode(\'' + id + '\')">' + label +
    ' <span class="mbadge">' + badge + '</span></button>';
  return '<div class="wmtabs">' + tab('local', '🗺️ 本地地图', '24×24') +
    tab('region', '🌐 大区地图', META_COLS + '×' + META_ROWS) + '</div>';
}

/** 类型色图例（和格子底色同一套颜色） */
const typeLegend = () =>
  '<div class="wlegend rlg">' + TYPES.map(t =>
    '<span class="lg"><i class="sw" style="background:' + TYPE_INFO[t].color + '"></i>' + TYPE_INFO[t].label + '</span>'
  ).join('') + '</div>';

/** 危险度图例：数字 + 颜色 + 人话（评审说"余烬没标危险、看不出梯度"） */
const dangerLegend = () =>
  '<div class="wlegend rlg">' + [1, 2, 3, 4, 5].map(t =>
    '<span class="lg"><i class="rnum d' + t + '">' + t + '</i>危险 ' + t + ' · ' + dangerLabel(t) + '</span>'
  ).join('') + '</div>';

/** 图层切换（地貌 / 危险度）——两个诉求打架时，给玩家一个开关而不是替他决定 */
function layerTabs(): string {
  const tab = (id: RegionLayer, label: string) =>
    '<button class="wmtab' + (regionLayer === id ? ' on' : '') + '" onclick="V4World.regionLayer(\'' + id + '\')">' + label + '</button>';
  return '<div class="wmtabs rlayers">' + tab('type', '🎨 地貌上色') + tab('danger', '🔥 危险度上色') + '</div>';
}

/** 选中区域的详情：干什么用、能弄到什么、开过去要多少油、去不了是什么原因 */
function renderRegionDetail(s: SaveWorld, here: RegionDef, sel: RegionDef, trip: ReturnType<typeof regionTripFor>): string {
  const seen = sel.id === here.id || !!s.seenRegions[sel.id];
  const visits = s.regionVisits[sel.id] ?? 0;
  let h = '<div class="rdetail">';
  h += '<div class="rdhd">' + sel.icon + ' <b>' + esc(sel.name) + '</b>' +
    '<span class="tag">' + typeLabel(sel.type) + '</span>' +
    '<span class="tag">危险 ' + sel.tier + ' · ' + dangerLabel(sel.tier) + '</span>' +
    '<span class="tag">离余烬 ' + sel.dist + ' 格</span>' +
    (seen ? '<span class="tag ok">已到过' + (visits > 1 ? ' ' + visits + ' 次' : '') + '</span>' : '<span class="tag">还没去过</span>') +
    '<button class="btn xs rclose" onclick="V4World.clearPick()" title="取消选中">✕</button>' +
    '</div>';
  h += '<div class="hint">' + esc(sel.desc) + '</div>';
  h += '<div class="rtags">这儿能弄到：' + sel.resources.map(r => '<span class="tag">' + esc(r) + '</span>').join('') + '</div>';
  /* M18：把该类型的区域事件摆出来——出发前就知道会撞上什么，地貌分区才不只是颜色 */
  const hazards = regionHazardTitles(sel.type, 3);
  if (hazards.length) h += '<div class="rtags">这一带的状况：' + hazards.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>';
  if (trip.ok) {
    const via = trip.path.slice(0, -1).map(id => regionName(id));
    h += '<div class="rgo ok">🧭 开过去 <b>' + trip.hops + ' 格</b> · ⚡' + trip.ap + ' · ⛽' + trip.fuel +
      '<button class="btn primary" onclick="V4World.travelRegion(\'' + sel.id + '\')">出发</button>' +
      (via.length ? '<div class="hint">途经：' + esc(via.join(' → ')) + '</div>' : '') + '</div>';
  } else {
    h += '<div class="rgo bad">⛔ ' + esc(trip.why || '去不了') +
      (trip.hint ? '<div class="hint">' + esc(trip.hint) + '</div>' : '') + '</div>';
  }
  if (selectedNote) h += '<div class="hint">' + esc(selectedNote) + '</div>';
  return h + '</div>';
}

export function renderRegionPanel(s: SaveWorld): string {
  const here = regionById(s.region) ?? homeRegion();
  const sel = selectedRegion && selectedRegion !== here.id ? regionById(selectedRegion) : null;
  const trip = sel ? regionTripFor(s, sel.id) : null;
  const onPath: Record<string, 1> = {};
  if (trip) for (const id of trip.path) onPath[id] = 1;
  const seenN = Object.keys(s.seenRegions).length;

  let h = '<div class="rcur">📍 当前在 <b>' + esc(here.name) + '</b> · ' + typeLabel(here.type) +
    ' · ' + dangerLabel(here.tier) + '　<span class="badge">已到过 ' + seenN + '/' + REGIONS.length + '</span></div>';
  h += layerTabs();
  h += '<div class="hint">' + (regionLayer === 'danger'
    ? '现在是<b>危险度上色</b>：绿=安全、红=九死一生（越红越别去）。想认"哪片是工业区/农田"就切回地貌上色。'
    : '格子的<b>颜色是地貌</b>（工业区、农田、林地…）、<b>数字是危险度</b>：离余烬越远越危险。' +
      '想只看"该往哪跑"就切到危险度上色。') +
    '点一格看详情，再点「出发」才动身——地图上会亮出整条路线。</div>';

  const dangerMode = regionLayer === 'danger';
  /* M21.1：12×12 大区图与"选中详情"并排（详情 = 地名/危险/路程报价/出发按钮）。
     用户报障："这边也溢出了"——详情原先堆在地图下面，一屏放不下就被切在屏幕外，
     想出发还得往下滚。宽卡片时并排、窄卡片时自动换行，两边都不用滚。 */
  h += '<div class="rmain">';
  h += '<div class="rgridcol">';
  h += '<div class="rgrid' + (dangerMode ? ' rl-danger' : '') + '">';
  for (const row of metaGrid()) {
    for (const def of row) {
      if (!def) { h += '<div class="rcell2 none"></div>'; continue; }
      const isHere = def.id === here.id;
      const seen = isHere || !!s.seenRegions[def.id];
      const cls = 'rcell2 d' + def.tier + (isHere ? ' here' : '') + (def.homeBase ? ' home' : '') +
        (sel && sel.id === def.id ? ' sel' : '') + (onPath[def.id] ? ' onpath' : '') + (seen ? '' : ' unseen');
      /* M30：悬停/详情里带上**资源丰度**档位（"跑这一趟值不值"的另一个维度） */
      const ab = abundanceTier(def.abundance ?? 1);
      const tip = def.name + ' · ' + typeLabel(def.type) + ' · 危险 ' + def.tier + '：' + def.desc +
        ' · 资源' + ab.icon + ab.label + '（×' + (def.abundance ?? 1).toFixed(2) + '）' +
        (seen ? '' : '（你还没去过这一带，物资是按地貌推的）');
      const bg = dangerMode ? dangerColor(def.tier) : typeColor(def.type);
      /* M24：两个图层各管各的（用户原话："为什么地貌上色还有危险度……危险度不是有单独的上色吗"）。
         地貌层 = 只有颜色（地名/危险数字都不画，看名字点开详情、或切到危险度层）；
         危险度层 = 只有数字。图例、悬停 title、点开的详情都还在，信息没丢。
         M30：右下角一个小方块标资源丰度（0~3 格，不写字，免得盖住地图）。 */
      h += '<div class="' + cls + '" style="background:' + bg + ';--dc:' + dangerColor(def.tier) + '"' +
        ' title="' + esc(tip) + '" role="button" tabindex="0" onclick="V4World.pickRegion(\'' + def.id + '\')">' +
        (dangerMode ? '<i class="rnum d' + def.tier + '">' + def.tier + '</i>' : '') +
        '<i class="rab ab' + ab.tier + '" title="资源' + ab.label + '"></i>' +
        (isHere ? '<i class="rpin">📍</i>' : '') +
        '</div>';
    }
  }
  h += '</div>';

  // M21.1：两个图例折进 `<details>`（跟本地地图一致）：常驻两三行图例会占掉一屏的 1/5，
  // 玩家真正要看的"选中详情 + 出发"反而被挤到屏幕外——用户报障"这边也溢出了"。
  h += '<details class="wlegend-box"><summary>图例与说明</summary>' +
    (dangerMode ? '' : typeLegend()) + dangerLegend() +
    '<div class="hint">点一格看详情，再点「出发」才动身——地图上会亮出整条路线。</div></details>';
  h += '</div>';

  if (sel && trip) h += renderRegionDetail(s, here, sel, trip);
  else h += '<div class="rdetail empty">👆 点任意一格：显示那一带的地名、地貌、危险度、能弄到的物资，' +
    '以及开过去要花多少油和行动力。</div>';
  h += '</div>';

  /* 去不了的原因在详情里已经逐条给了，这里只说"整体状态"，不重复念。
     只在"切比雪夫距离 ≤ MAX_HOPS"的格子里算（更远的必然超跳数，不必跑 BFS） */
  const near = REGIONS.filter(d => d.id !== here.id && d.dist <= MAX_HOPS && regionTripFor(s, d.id).ok).length;
  if (!s.veh) {
    h += '<div class="hint">🚗 <b>没有载具</b>：区域里面的格子随便走，跨区得开车——' +
      '汽车修理厂 / 物流园里有能修的车，先弄辆车再说。「本地地图」看区域内部（哪条街、哪栋楼）。</div>';
  } else if (!near) {
    h += '<div class="hint">车在门口，但油/行动力不够开到任何一格：<b>油 ' + s.veh.fuel + '</b> · <b>行动力 ' +
      L.S.ap + '/' + apCapOf(s.debt, fitLv()) + '</b>——加油站和物流园能抽油，行动力回安全屋睡一觉。</div>';
  } else {
    h += '<div class="hint">车已就绪：现在有 <b>' + near + '</b> 个区域开得到（一箱油 + 一天体力最多 ' + MAX_HOPS +
      ' 格，再远得中途落脚）。「本地地图」看区域内部的格子。</div>';
  }
  return h;
}

export function renderMapPanel(): string {
  const s = sw(), w = localWorld(s), b = curBlock();
  const poi = poiOf(b);
  const home = bkey(b.x, b.y) === homeKey(s);
  const dLab = Math.max(Math.abs(b.x - w.lab.x), Math.abs(b.y - w.lab.y));
  const labTxt = L.S.base.radio ? (dLab + ' 公里（' + (dLab <= 3 ? '快到了' : dLab <= 8 ? '还有一段' : '很远') + '）') : '未定位（据点架设无线电后解锁）';
  const frags = pendingFragKeys();

  let h = '<div class="sect-title">' + (mapMode === 'region' ? '🌐 大区地图' : '🗺️ 本地地图') +
    ' <span class="badge">' + (mapMode === 'region'
      ? META_COLS + '×' + META_ROWS + ' · ' + REGIONS.length + ' 个区域 · 跨区要开车'
      : '区块 (' + b.x + ',' + b.y + ') · 1km²') + '</span>' +
    '<span class="badge">走过 ' + s.steps + ' 个区块</span></div>';
  h += mapTabs();
  h += '<div class="whead">' +
    '<div class="wmeta">' +
      '<div class="wname">' + (home ? '🏠 安全屋（' : (poi ? poi.icon + ' ' + poi.name + '（' : '📍 ')) + esc(b.name) + '）' +
        /* M25.4：把"地貌 · 危险 · 距实验室"并到同一行 —— 地图格子尺寸是靠"地图框还能拿多少高度"决定的，
           省下的每一行都是格子变大的一像素（原来这条 hint 单独占一行）。 */
        '<span class="hint" style="font-weight:400;margin-left:8px">' + biomeName(b) + ' · 危险 ' + b.danger + ' · 距实验室 ' + labTxt + '</span></div>' +
    '</div>' +
    // R5：常驻信息位只有 3 个，睡眠债并进 AP 显示，不新开一格
    '<div class="wveh">' + (s.veh ? '🚗 油 ' + s.veh.fuel + ' · 车况 ' + s.veh.hp + '%' : '🚶 步行') +
      '　⚡ ' + L.S.ap + '/' + apCapOf(s.debt, fitLv()) + ' · 债 ' + s.debt + ' 档' +
      (isBloodMoonDay(L.S.day) ? '　🩸 血月' : '') + '</div>' +
  '</div>';

  /* 大区视图：只铺 12×12 那张元地图 + 选中详情；本地视图：格子地图 + 预览/悬停 + 图例。
     两张图不再同时铺开——这是"不占空间"的关键。 */
  if (mapMode === 'region') {
    h += renderRegionPanel(s);
    h += '<details class="wlegend-box"><summary>图例与说明</summary><div class="wlegend">' +
      '<span class="lg"><i class="sw ic">📍</i>当前所在</span>' +
      '<span class="lg"><i class="sw sel-sw"></i>选中的目标（路线会亮出来）</span>' +
      '<span class="lg"><i class="sw path-sw"></i>行车路线（含途经区域）</span>' +
      '<span class="lg"><i class="sw un-sw"></i>灰掉 = 还没去过（描述是按地貌推的）</span>' +
      '<span class="hint">地名一直可见（地理常识），但每个区域第一次进去会有一段现场叙事。「余烬市区」是你醒来的地方，' +
      '越往外越危险；一箱油 + 一天体力最多开 4 格，再远得中途落脚。</span>' +
      '</div></details>';
    return h;
  }

  // C10/R4：预览条与悬停详情放在**地图上方**（用户反馈：放地图下面等于藏到屏幕最底部，
  // 而这两行恰恰是"这格是谁、去一趟多少钱"的关键信息，必须一眼看到）。
  // M25.4：宽屏（≥1700px，地图与卡片墙并排）时悬停行合并进预览条（见 .wbar.hoveroff）——
  // 格子尺寸靠"地图框能拿多少高度"决定，省下的一行直接变成格子更大。
  h += '<div class="wbar hoveroff">';
  h += '<div class="wpreview' + (preview ? (preview.ok ? ' on' : ' bad') : '') + '" id="v4-preview">' + (preview
    ? '<b>' + (preview.ok ? '🧭 路线预览' : '⛔ 走不了') + '</b> · ' + esc(preview.text) +
      (preview.ok ? ' <button class="btn xs primary" onclick="V4World.confirmTrip()">出发</button><button class="btn xs" onclick="V4World.cancelTrip()">取消</button>' : ' <button class="btn xs" onclick="V4World.cancelTrip()">知道了</button>')
    : '<span class="hint">点一个点亮的区块 → 这里显示路线与花费 → 再点一次（或点「出发」）才动身。</span>') + '</div>';
  /* M25.4：悬停行保留在 DOM 里（宽屏被 CSS 藏起来、详情改写到预览条），窄屏它才是那一行 */
  h += '<div class="whover" id="v4-hover"><span class="hint">鼠标移到格子上（手机点一下）：这里显示那块地的名字、危险、距离和里面有什么。</span></div>';
  h += '</div>';

  /* M19：本地地图也能切"危险度上色"——"越深越红"这件事，一眼就该看得出来 */
  const localDanger = regionLayer === 'danger';
  h += layerTabs();
  /* M40：`repeat(24,1fr)` 保持"能缩"（窄容器里 24 列会一起缩到 11.8px，不会横向溢出；
     桌面宽屏则由 fitMap 用内联列宽接管到 24~28px）。触屏要的"26px 起、可以单指拖"写在
     样式表的 `@media (hover:none)` 里，并且带 `!important` —— 内联样式压得过普通样式表规则，
     不带 !important 那条媒体查询永远生效不了（实测手机上格子一直 18px）。 */
  h += '<div class="wmapwrap"><div class="wgrid' + (localDanger ? ' rl-danger' : '') + '" style="grid-template-columns:repeat(' + WORLD_W + ',1fr)">';
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const bb = blockAt(w, x, y);
    if (bb) h += cellHtml(bb, s, frags, localDanger);
  }
  h += '</div></div>';
  h += '<details class="wlegend-box"><summary>图例与说明</summary><div class="wlegend">' +
    (localDanger
      ? '<span class="lg">危险度上色：</span>' + [1, 2, 3, 4, 5].map(t =>
          '<span class="lg"><i class="sw dg' + t + '"></i>危险 ' + t + ' · ' + dangerLabel(t) + '</span>').join('')
      : (['city', 'suburb', 'industrial', 'forest', 'farm', 'ruins', 'military', 'highway', 'water'] as const)
        .map(k => '<span class="lg"><i class="sw b-' + k + '"></i>' + BIOME_INFO[k].name + '</span>').join('')) +
    '<span class="lg"><i class="sw ic">🏠</i>安全屋</span><span class="lg"><i class="sw ic">☣️</i>方舟实验室</span>' +
    '<span class="lg"><i class="sw ic">🔑</i>门禁卡碎片</span><span class="lg"><i class="sw ic">📡</i>撤离点</span>' +
    '<span class="lg"><i class="sw ic">🌊</i>水域（可游/可钓）</span><span class="lg"><i class="sw ic">🤿</i>沉没基地（要潜水）</span>' +
    '<span class="lg"><i class="sw cur-sw"></i>你所在区块</span><span class="lg"><i class="sw path-sw"></i>预览路线</span>' +
    '<span class="hint">只有点亮的格子能去。**越往深处越危险**（安全屋一圈是 1，最外圈是 5），好东西也在深处：军械、监狱、大型商超、物流园都往外圈跑，日用品（超市/药房/加油站/汽修）就开在家附近。走路 1 行动力/区块（骨折 +1/3），开车 1 行动力/4 区块 + 1 油/6 区块；夜里更容易撞上东西。</span>' +
    '</div></details>';
  return h;
}

/** M21：一张卡片 = 标题行 + 内容。探索页从"三列大杂烩"改成**卡片墙**——
    每张卡只讲一件事（今日/环境/采集/水体/菜园/格子/今夜…），窄屏自动退成单列，
    不再出现"左边一大堆、右边孤零零一张卡"的怪版面。 */
function card(id: string, title: string, body: string, badges: string[] = []): string {
  return '<div class="v4card" data-card="' + id + '">' +
    '<div class="card-hd"><span class="card-tt">' + title + '</span>' +
    badges.filter(Boolean).map(x => '<span class="badge">' + x + '</span>').join('') + '</div>' +
    '<div class="card-bd">' + body + '</div></div>';
}

/** 今日行动：行动力 + 就地把状态补回来 + 商人。**睡觉只有「今夜」卡一个入口**
    （legacy 那个「睡觉」按钮直连 sleepNight()，会绕过 v4 的睡眠债/环境/夜袭整套结算，是重复入口 + 真 bug）。 */
function todayCard(): string {
  const S = L.S as any;
  const s = sw();
  let b = '<div class="row">' +
    '<button class="btn ok" onclick="restHere()">☕ 就地休整 <span class="mono">(1 行动力)</span></button>' +
    '<button class="btn" onclick="openMerchant()">🏪 呼叫商人</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:6px">行动力 <b>' + S.ap + '/' + apCapOf(s.debt, fitLv()) + '</b> · 搜索 1 点 · 深度搜索 2 点 · 走路 1 点/区块' +
    (s.veh ? ' · 开车 1 点/4 区块' : '') + '</div>';
  b += '<div class="hint">' + (S.ap <= 0
    ? '⚠️ 今天已经没有行动力了。硬撑着继续只会让饥饿和感染追上来——去「今夜」卡睡觉。'
    : '搜刮会消耗饱食与水分，战斗会消耗弹药与体力。' + (S.base.radio ? '无线电已架设：方舟实验室坐标已解锁。' : '架设无线电（据点 → 建设）后才能定位方舟实验室。')) + '</div>';
  return card('today', '🎯 今日行动', b, ['第 ' + L.S.day + ' 天 ' + String(L.phaseName ? L.phaseName()[0] : '')]);
}

/** M6 · 环境卡：季节天气体温 + 每日系数 + 断粮/缺木的出路（原来混在采集里，说不清是"环境"还是"操作"） */
function envCard(): string {
  const S = L.S as any;
  const env = envOf();
  const p = tempPenalty(env.temp);
  const fi = forageInfo(), ci = chopInfo();
  const badges = [SEASON_INFO[seasonNow()].name + '季', WEATHER[env.weather].icon + WEATHER[env.weather].name];
  if (p.note) badges.push('⚠️ 体温异常');
  /* M30：湿度/病症也进徽章与正文（否则玩家得去 HUD 悬停才知道自己为什么掉体力） */
  const svHud = (window as any).V4Survival as { riskLine?: () => string; status?: () => { conds: string[]; hum: number } } | undefined;
  const conds = svHud?.status ? svHud.status().conds : [];
  for (const c of conds) badges.push('🩺 ' + c);
  let b = '<div class="hint">' + esc(envLine()) + '</div>';
  if (svHud?.riskLine) b += '<div class="hint" style="color:#e0b06a">' + esc(svHud.riskLine()) + '</div>';
  /* M50：病症的详细面板（症状/代价/吃什么药）搬进人体页了；这张卡只留"去处理"的入口 */
  if (conds.length) b += '<div class="row" style="margin-top:6px"><button class="btn sm warn" onclick="setTab(\'body\')">🩺 身上的 ' +
    conds.length + ' 项病症 → 人体页处理</button></div>';
  if (p.note) b += '<div class="hint" style="color:#e0b06a">' + esc(p.note) + '</div>';
  b += '<div class="hint">今日：采集 ×' + WEATHER[env.weather].forage + ' · 作物 ×' + WEATHER[env.weather].crop +
    ' · 腐坏 ×' + (SEASON_INFO[seasonNow()].rot * WEATHER[env.weather].rot).toFixed(2) +
    (WEATHER[env.weather].fire ? '' : ' · ⛔ 生不了火') + '</div>';
  // X03：断粮/断水时把出路写清楚，别只说"打开背包"
  if (S.hun < 25 || S.thi < 25) {
    const ways: string[] = [];
    if (fi.ok) ways.push('🧺 就地采集（1 行动力）');
    if (ci.ok) ways.push('🪵 就地伐木（约 ' + ci.est + ' 木：煮沸污水/做夹板都要它）');
    const fi2 = fishInfo(), ik = intakeInfo();
    if (fi2.ok) ways.push('🎣 钓鱼（' + Math.round(fi2.chance * 100) + '% 命中）');
    if (ik.ok) ways.push('💧 就地接水（污水要煮沸或用净化片）');
    if (L.S.base?.pond) ways.push('🐟 鱼塘收鱼（投喂鱼饵/蔬菜翻倍）');
    if (plotSlots().length) ways.push('🌱 收菜园 / 播种');
    if (env.rainToday > 0) ways.push('💧 煮沸雨水（雨水今天收到 ' + env.rainToday + ' 份）');
    ways.push('🏪 找营地/商人换（营地地图上标着 ⛺）');
    b += '<div class="hint" style="color:#e0b06a;margin-top:6px">⚠️ ' +
      (S.hun < 25 ? '饱食 ' + Math.round(S.hun) : '水分 ' + Math.round(S.thi)) + ' 告急，出路：' + ways.join(' · ') + '</div>';
  }
  return card('env', '🌦️ 环境', b, badges);
}

/** 采集与拆解：采集/拆解/伐木三件事一张卡（都是"花 1 行动力换材料"） */
function gatherCard(): string {
  const S = L.S as any;
  const fi = forageInfo(), si = salvageInfo(), ci = chopInfo();
  let b = '<div class="row">' +
    '<button class="btn' + (fi.ok ? ' ok' : ' ghost') + '"' + (fi.ok ? '' : ' disabled') +
      ' onclick="V4Gather.forage()" title="' + esc(fi.ok ? '这一带还能采 ' + fi.left + ' 次' : (fi.why ?? '')) + '">🧺 采集 <span class="mono">(1 行动力' + (fi.ok ? ' · 剩 ' + fi.left : '') + ')</span></button>' +
    '<button class="btn' + (si.ok ? '' : ' ghost') + '"' + (si.ok ? '' : ' disabled') +
      ' onclick="V4Gather.salvage()" title="' + esc(si.ok ? '这一带还能拆 ' + si.left + ' 次' : (si.why ?? '')) + '">🔧 拆解 <span class="mono">(1 行动力' + (si.ok ? ' · 剩 ' + si.left : '') + ')</span></button>' +
    // M8 伐木：木头的主渠道。不可用时禁用 + 下方 hint 写明原因（没树 / 今天砍够了）
    '<button class="btn' + (ci.ok ? ' ok' : ' ghost') + '"' + (ci.ok ? '' : ' disabled') +
      ' onclick="V4Gather.chop()" title="' + esc(ci.ok ? '这一带今天还能砍 ' + ci.left + ' 次，一斧约 ' + ci.est + ' 木' : (ci.why ?? '')) + '">🪵 伐木 <span class="mono">(1 行动力' + (ci.ok ? ' · 剩 ' + ci.left + ' · 约 ' + ci.est + ' 木' : '') + ')</span></button>' +
    '</div>';
  if (!fi.ok && fi.why) b += '<div class="hint">🧺 ' + esc(fi.why) + '</div>';
  if (!si.ok && si.why) b += '<div class="hint">🔧 ' + esc(si.why) + '</div>';
  if (!ci.ok && ci.why) b += '<div class="hint">🪵 ' + esc(ci.why) + '</div>';
  // M8：缺木料（手上有污水要煮沸 / 骨折要夹板）时把伐木这条出路摆出来
  const needWood = (S.inv?.dirty || 0) > 0 || (L.S.wounds || []).some((w: any) => w.t === 'fracture');
  if (needWood && L.itemCount('wood') < 2 && ci.ok) {
    b += '<div class="hint" style="color:#e0b06a">🪵 木料不够：煮沸污水/固定骨折都要它——就地砍几斧（1 行动力 · 约 ' + ci.est + ' 木/次，今天还能砍 ' + ci.left + ' 次）</div>';
  }
  return card('gather', '🧺 采集与拆解', b);
}

/** 菜园卡 */
function farmCard(): string {
  const slots = plotSlots();
  /* M24.1：没菜园时拆成两行（长句子 + 一长串材料清单挤一行容易顶到卡片边框；
     材料那行单独一行，窄卡片也只是换行，不会溢出） */
  let b = slots.length
    ? '<div class="hint">' + esc(farmSummary()) + '</div>'
    : '<div class="hint">还没有菜园：据点 → 建设 → 屋顶菜园</div>' +
      '<div class="hint">材料：' + esc(farmBuildCost()) + '</div>';
  if (slots.length) {
    b += '<div class="row" style="margin-top:6px">';
    slots.forEach((pl, i) => {
      if (!pl.crop) {
        b += '<span class="wplot">地' + (i + 1) + '·空：</span>';
        for (const c of cropList()) {
          const have = L.itemCount(c.seed);
          b += '<button class="btn sm' + (have > 0 ? '' : ' ghost') + '"' + (have > 0 ? '' : ' disabled') +
            ' onclick="V4Farm.plant(' + i + ',\'' + c.id + '\')" title="' + esc(c.desc) + '">播' + c.icon + c.name + '（种子 ' + have + '）</button>';
        }
      } else {
        const c = CROPS[pl.crop] ?? { icon: '?', name: pl.crop, seed: '' };
        const need = growthDays(pl.crop, seasonNow());
        const ready = isFinite(need) && (pl.day || 0) >= need;
        b += '<button class="btn sm' + (ready ? ' ok' : ' ghost') + '"' + (ready ? '' : ' disabled') +
          ' onclick="V4Farm.harvest(' + i + ',false)">收地' + (i + 1) + c.icon + '</button>' +
          (ready ? '<button class="btn sm" onclick="V4Farm.harvest(' + i + ',true)" title="留种少收一茬，但拿回 1 份种子">留种收</button>' : '');
      }
    });
    b += '</div>';
    const seeds = cropList().filter(c => L.itemCount(c.seed) > 0).map(c => c.icon + c.name + '种子×' + L.itemCount(c.seed));
    b += '<div class="hint">种子：' + (seeds.length ? seeds.join('、') : '没有（搜农场/超市/学校，或找营地买）') + '</div>';
  }
  return card('farm', '🌱 菜园', b, [slots.length + ' 块地']);
}

/** M7 · 水体卡：钓鱼 / 下水 / 潜水搜沉没基地 / 鱼塘 */
function waterCard(): string {
  const b0 = curBlock();
  const fi2 = fishInfo(), ik = intakeInfo();
  let b = '<div class="row">' +
    '<button class="btn' + (fi2.ok ? '' : ' ghost') + '"' + (fi2.ok ? '' : ' disabled') +
      ' onclick="V4Water.fish()" title="' + esc(fi2.ok ? '今天还能钓 ' + fi2.left + ' 次' : (fi2.why ?? '')) + '">🎣 钓鱼 <span class="mono">(1 行动力 · 命中 ' + Math.round(fi2.chance * 100) + '%' + (fi2.ok ? ' · 剩 ' + fi2.left : '') + ')</span></button>' +
    // M7.1：用户要求"水可以从水体里接"——1 行动力接 2 份污水，回去用净化片或煮沸变净水
    '<button class="btn' + (ik.ok ? '' : ' ghost') + '"' + (ik.ok ? '' : ' disabled') +
      ' onclick="V4Water.intake()" title="' + esc(ik.ok ? '今天这一片还能接 ' + ik.left + ' 次' : (ik.why ?? '')) + '">💧 取水 <span class="mono">(1 行动力 · 2 份污水' + (ik.ok ? ' · 剩 ' + ik.left : '') + ')</span></button>' +
    (swimCan() ? '<button class="btn" onclick="V4Water.swim()" title="朝最近的水块游一格：2 行动力，掉体力与体温，没潜水服有风险">🏊 下水 <span class="mono">(2 行动力/格)</span></button>' : '') +
    (diveOk() ? '<button class="btn ok" onclick="V4Water.dive()">🤿 潜水搜索 <span class="mono">(2 行动力 · 氧气 ' + diveLeft() + ')</span></button>' : '') +
    '</div>';
  b += '<div class="hint">' + esc(canSwim().note) + (fi2.chance < 0.3 ? ' · 🎣 现在鱼口很差（天太冷/天气不好）' : '') + '</div>';
  if (fi2.why) b += '<div class="hint">🎣 ' + esc(fi2.why) + '</div>';
  if (ik.why) b += '<div class="hint">💧 ' + esc(ik.why) + '</div>';
  b += '<div class="hint">💧 污水不能直接喝：背包 → 制作里「煮沸」（污水×2 + 木×1）或「净化片」（污水×1 + 净化片×1，不用生火）都能变成净水。</div>';
  if (diveInfo().why && b0?.poi === 'sunken') b += '<div class="hint">🤿 ' + esc(diveInfo().why ?? '') + '</div>';
  b += '<div class="hint">🐟 ' + esc(pondSummary()) + '</div>';
  return card('water', '🌊 水体', b, [waterNearby().any ? '旁边有水' : '没有水']);
}
/** M26：存档 / 世界 / 账号这些**元操作**搬到 ☰ 菜单里的「世界与账号」分区。
    用户原话：「这是什么，为什么在地图上面，放到设置的 subpage 里面」——
    探索页只该有玩法（地图 + 卡片墙），存档账号属于设置。按钮 HTML 交给 legacy 的 openMenu 渲染。 */
export function toolsButtonsHtml(): string {
  const who = accountUser();
  /* M32：地图开关也放这里（用户要「在哪里都能开」）——顶栏还有一个 🗺️ 按钮，两处等价 */
  const mapOpen = (window as any).V4Scale ? (window as any).V4Scale.mapOpen() : true;
  /* M34：地图摆法可配置，说明文案跟着偏好走（免得写成"地图是悬浮窗"而玩家其实选的是嵌入） */
  const mapWhere = (() => {
    try { return String((window as any).V4Scale?.mapStyleNote?.() || ''); } catch { return ''; }
  })() || '地图是右上角的悬浮窗（任何页签都能开关，按 M 也行）。';
  return '<div class="row">' +
    '<button class="btn sm ' + (mapOpen ? 'ok' : '') + '" onclick="closeAllModals();V4Scale.toggleMap()" title="本地/大区地图（快捷键 M）">🗺️ 地图：' + (mapOpen ? '开' : '关') + '</button>' +
    '<button class="btn sm" onclick="closeAllModals();V4Worlds.open()" title="多世界 / 挑战码 / 幽灵据点 / 本机统计">🌍 世界 · 分享</button>' +
    '<button class="btn sm" onclick="closeAllModals();V4Account.open()" title="' + esc(accountSummary()) + '">' +
      (who ? '👤 ' + esc(String(who).slice(0, 14)) : '👤 注册 / 登录') + '</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:6px">' + mapWhere + '　多世界、挑战码、幽灵据点、本机统计与云存档也都在这里。</div>';
}

/** 当前区块卡（原来的"POI 面板"）：这一格有什么、能搜什么、有什么活儿可干。
    「就地休整」只留在「今日行动」卡里（用户反馈：同一个操作出现在两处就是重复）。 */
function poiCard(): string {
  const s = sw(), b = curBlock();
  const poi = poiOf(b);
  const zone = zoneOfPoi(b.poi);
  const home = bkey(b.x, b.y) === homeKey(s);
  const left = poi ? poiLeft(b, s) : 0;
  const frags = pendingFragKeys();
  const hereFrag = !!frags[bkey(b.x, b.y)];
  const gh = ghostAt(localWorld(s), b.x, b.y);
  const radLv = radHere(localWorld(s));                    // M25：这一格的辐射等级
  let body = '';
  if (radLv > 0) body += '<div class="hint" style="color:' + (radLv >= 2 ? '#e0736a' : '#e0b06a') + '">' +
    esc(geigerText(radLv, hasGeiger())) + '　待在这里每走一步都会累积。</div>';
  if (poi) {
    body += '<p class="muted">' + esc(poi.desc) + '</p>' +
      (hereFrag ? '<div class="hint" style="color:#d8c07a">🔑 情报说这一带藏着门禁卡碎片——搜一次就能拿到。</div>' : '') +
      (poi.feat === 'npc' ? '<div class="hint" style="color:#7fd6a8">里面有活人：能换东西、买情报、也可能想抢你。</div>' : '') +
      (gh ? '<div class="hint" style="color:#c9a6ff">👻 ' + esc(gh.spec.owner) + ' 的幽灵据点就在这一格：搜刮＝打一场守卫战，赢了抢他仓库的一部分。</div>' : '') +
      '<div class="hint">可能遇上：' + poi.enemies.map(e => esc(L.ZOMBIES?.[e]?.n ?? e)).join('、') + '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button class="btn primary" onclick="V4World.search(0)">🔍 搜索 <span class="mono">(1 行动力)</span></button>' +
        '<button class="btn warn" onclick="V4World.search(1)">🔦 深度搜索 <span class="mono">(2 行动力 · 更危险 · 更多)</span></button>' +
        (poi.feat === 'npc' ? '<button class="btn ok" onclick="V4Camp.open()">🚪 进去看看 <span class="mono">(幸存者)</span></button>' : '') +
        (poi.feat === 'vehicle' && !s.veh ? '<button class="btn ok" onclick="V4World.fixCar()">🔧 修车 <span class="mono">(12 材料 + 2 汽油)</span></button>' : '') +
        (poi.feat === 'vehicle' && s.veh && s.veh.hp < 100 ? '<button class="btn ok" onclick="V4World.repairCar()">🔧 修车况 <span class="mono">(6 材料 → +40%)</span></button>' : '') +
        ((poi.feat === 'fuel' || poi.id === 'gas') && s.veh ? '<button class="btn" onclick="V4World.refuel()">⛽ 加油 <span class="mono">(1 汽油 → 3 油)</span></button>' : '') +
      '</div>' +
      '<div class="hint" style="margin-top:6px">负重 ' + L.carryWeight() + '/' + L.capWeight() +
        (zone ? ' · 这里算作「' + (L.ZONES?.[zone]?.n ?? zone) + '」，主线与悬赏都认' : '') + '</div>';
  } else {
    body += '<p class="muted">' + (home ? '这里是你的安全屋。' : '这一带什么都没有——只有风、灰和远处拖行的声音。') +
      '往相邻的点亮区块走，找一个有东西的地方。</p>' +
      (gh ? '<div class="hint" style="color:#c9a6ff">👻 ' + esc(gh.spec.owner) + ' 的幽灵据点就在这一格。</div>' : '') +
      '<div class="hint">在上面那张图里点一个亮着的格子就能走：走路 1 行动力/区块' + (s.veh ? ' · 开车 1 行动力/4 区块' : '') + '</div>';
  }
  return card('poi', '📍 格子详情 (' + b.x + ',' + b.y + ') · ' + esc(b.name), body,
    [poi ? '危险 ' + (b.danger + poi.danger) : '危险 ' + b.danger, poi ? '可搜 ' + left + '/' + poi.searches + ' 次' : '空地']);
}

/** C01/C02：今夜怎么睡（安全屋满额零风险；野睡打折 + 必掷夜袭）。
    **全游戏唯一的睡觉入口**：legacy 那个「睡觉」按钮直连 sleepNight()，会绕过 v4 的
    睡眠债/环境结算/野睡夜袭/据点被啃这一整套账（重复入口 + 真 bug），已从探索页摘掉。 */
function nightCard(): string {
  const s = sw(), b = curBlock();
  const restOpts = restOptions(b);
  const badges = ['第 ' + L.S.day + ' 天 → ' + (L.S.day + 1) + ' 天'];
  if (isBloodMoonDay(L.S.day)) badges.push('⚠️ 血月：不在家会被啃据点');
  const body = '<div class="row">' + restOpts.map(o =>
      '<button class="btn sm' + (o.ok ? (o.kind === 'base' ? ' ok' : '') : ' ghost') + '"' + (o.ok ? '' : ' disabled') +
      ' onclick="V4Night.rest(\'' + o.kind + '\')" title="' + esc(o.why ?? o.detail) + '">' + o.icon + ' ' + esc(o.name) + '</button>').join('') +
    '</div>' +
    '<div class="hint" style="margin-top:6px">' + esc(restOpts.filter(o => o.kind === tierAt(b, !!s.veh && s.veh.fuel > 0 && s.veh.hp > 0))
      .map(o => o.detail)[0] ?? '') + '</div>' +
    '<div class="hint">睡在野外恢复 65% 行动力并涨半档睡眠债（上限 9 → 最低 6，且必掷夜袭）；回家睡满格、还 2 档债、不掷夜袭。</div>';
  return card('night', '🌙 今夜', body, badges);
}

/** C07 撤离点卡（只在窗口开着时出现） */
function evacCard(): string {
  const b = curBlock();
  const ev = ensureEvac();
  if (!ev.open) return '';
  const here = ev.site.x === b.x && ev.site.y === b.y;
  const body = '<div class="hint">' + (evacAvailable(L.S.day)
      ? (here ? '你已经站在撤离点上了：打出一发信号枪，救援就回来。' : '窗口已开：带上信号枪走到撤离点。')
      : '今天是血月——撤离窗口顺延（明天再发信号）。') +
    (L.itemCount('flare') > 0 ? ' 身上的信号枪：' + L.itemCount('flare') + ' 发。' : ' 你还没有信号枪（军事哨所/地下掩体/隧道里能搜到）。') +
    '</div>' +
    (here ? '<div class="row"><button class="btn ok" onclick="V4World.flare()">🔴 打出信号弹（救援结局）</button></div>' : '');
  return card('evac', '📡 撤离点', body, ['(' + ev.site.x + ',' + ev.site.y + ')']);
}

/** 旅途记录卡 */
function trailCard(): string {
  const s = sw();
  if (!s.trail.length) return '';
  return card('trail', '🧭 旅途记录', '<div class="trail">' +
    s.trail.slice(-5).reverse().map(t => '<div>' + esc(t) + '</div>').join('') + '</div>');
}

/** 探索页卡片墙（除地图卡以外的全部玩法卡）。顺序＝用到的频率：
    今日 → 这一格 → 环境 → 采集 → 水体 → 菜园 → 今夜 → 撤离 → 旅途；委托板与日历由 legacy 拼在后面。 */
export function renderCards(): string {
  return todayCard() + poiCard() + envCard() + gatherCard() + waterCard() + farmCard() +
    nightCard() + evacCard() + trailCard();
}

/** 兼容旧调用点：M21 之前这里是"一整块详情面板"，现在拆成卡片墙（地图卡在上方单列） */
export function renderDetailPanel(): string {
  return renderCards();
}

/* ── 与 legacy 探索页拼接 ── */

function pruneLegacy(view: HTMLElement) {
  // 「可搜刮区域」这块由大世界地图取代：标题 + 紧随其后的那块内容一起摘掉
  const titles = Array.from(view.querySelectorAll('.sect-title')) as HTMLElement[];
  for (const t of titles) {
    const txt = (t.textContent || '').trim();
    // 这两块被大世界地图取代（M17；M51 起「城市地图」在 legacy 里已经整块删除，这里留着只是兜底），
    // 今日行动被 v4 的卡片取代（M21：里面的「睡觉」按钮直连 sleepNight()，
    // 会绕过 v4 的睡眠债/环境/夜袭结算，且和「今夜」卡重复）
    if (txt.startsWith('城市地图') || txt.startsWith('可搜刮区域') || txt.startsWith('今日行动')) {
      const next = t.nextElementSibling;
      t.remove();
      if (next) next.remove();
    }
  }
}

/** 把 legacy 自己的内容统一包成 v4 卡片：探索页只剩一种卡片语言。
    M24 修：以前只有"标题 + 紧随的 .card/.grid"会被包成卡片，裸的 .card（委托板 teaser、结局说明…）
    会原样塞进卡片墙 → 界面里出现没有标题、宽度和别的卡不一样的"诡异空白块"（用户报障）。
    现在**任何**没被认领的节点都会被包成一张有标题的卡片。
    M45 修：`.sect-title` 连带认领的正文块当时也在待认领名单里 → 被包装第二遍，整个日历出现两次
    （用户报「有重复的」）。认领计划（card-wall-core.claimPlan）保证每个节点只被认领一次。 */
function adoptLegacy(view: HTMLElement, board: HTMLElement) {
  const kids = Array.from(view.children) as HTMLElement[];
  const plan = claimPlan(kids.map(legacyKindOf));
  for (const step of plan) {
    if (step.act === 'skip') continue;                 // 宿主节点 / 已被上一张卡当正文领走
    const e = kids[step.i];
    if (e.classList.contains('v4card')) { board.appendChild(e); continue; }   // 已经是 v4 卡：直接搬进墙里
    let title: string, badges: string[], bodyEl: HTMLElement | null;
    if (step.act === 'title') {
      title = (e.textContent || '').trim();
      badges = Array.from(e.querySelectorAll('.badge')).map(b => (b.textContent || '').trim());
      bodyEl = step.body === null ? null : kids[step.body];
    } else {
      bodyEl = e;                                      // 裸卡片/散件：它自己就是内容
      title = legacyTitleOf(e);
      badges = [];
    }
    const wrap = document.createElement('div');
    wrap.className = 'v4card';
    wrap.dataset.card = 'legacy';
    wrap.innerHTML = '<div class="card-hd"><span class="card-tt">' + title + '</span>' +
      badges.map(b => '<span class="badge">' + b + '</span>').join('') + '</div>' +
      '<div class="card-bd">' + (bodyEl ? bodyEl.outerHTML : '') + '</div>';   // outerHTML：正文原件的类名/行内样式一并带走（保持修复前的外观）
    board.appendChild(wrap);
    e.remove()                                         // 原件（无论它自己就是正文，还是光杆标题）都清掉
    if (bodyEl && bodyEl !== e) bodyEl.remove();       // 正文原件同理 —— 上面已经搬进卡片里了
  }
}

/** 节点类型（供 claimPlan 用）：跳过的宿主节点 / 标题 / 正文候选 / 裸内容 */
function legacyKindOf(e: HTMLElement): LegacyKind {
  if (e.id === 'v4world' || e.id === 'v4tools' || e.classList.contains('v4board')) return 'skip';
  if (e.classList.contains('sect-title')) return 'title';
  if (e.classList.contains('card') || e.classList.contains('grid')) return 'body';
  return 'other';
}

/** M53（P3 视觉统一）：把**非探索页**按 `.sect-title` 分段，每段原地包成一张 v4 卡片。
 *
 *  以前只有探索页走卡片语言，技能/制作/任务/统计/背包/据点几页还是"裸标题 + 裸卡片"的老样子：
 *  标题没有卡头、卡片宽度和探索页对不上、badge 也不在标题行上。这里复用同一套卡头/卡身结构。
 *  与探索页的区别：**原地包**（不搬进 #v4cards、不动地图卡），所以地图悬浮窗/内嵌逻辑完全不受影响。
 *  幂等：包完页面顶层就不剩 `.sect-title` 了，MutationObserver 再进来一次会直接跳过。 */
function unifyTab(view: HTMLElement) {
  const kids = Array.from(view.children) as HTMLElement[];
  if (!kids.some(e => e.classList.contains('sect-title'))) return;    // 已经包过（或这页本来没有分段结构）
  const groups = sectionGroups(kids.map(legacyKindOf));
  for (const g of groups) {
    const head = kids[g.title];
    const body = g.body.map(i => kids[i]).filter(e => e && e.parentElement === view);
    if (bodyIsEmpty(body.map(e => e.textContent || ''))) continue;    // 空段不包（省一张空卡）
    const wrap = document.createElement('div');
    wrap.className = 'v4card';
    wrap.dataset.card = 'legacy';
    const badges = Array.from(head.querySelectorAll('.badge')).map(b => (b.textContent || '').trim());
    wrap.innerHTML = '<div class="card-hd"><span class="card-tt">' + (head.textContent || '').trim() + '</span>' +
      badges.map(b => '<span class="badge">' + b + '</span>').join('') + '</div><div class="card-bd"></div>';
    const bd = wrap.querySelector('.card-bd') as HTMLElement;
    view.insertBefore(wrap, head);
    for (const b of body) bd.appendChild(b);                          // 顺序 = 原来的 DOM 顺序
    head.remove();                                                    // 标题换成卡头，原件清掉
  }
}

/** 裸 legacy 节点的标题：能认出来的给专名，认不出就给个中性标题（总比没有强） */
function legacyTitleOf(e: HTMLElement): string {
  if (e.classList.contains('v4teaser')) return '📜 委托板';
  if (e.classList.contains('v4quick')) return '⌨️ 补给快捷';      // M45：别再退化成「📋 ⌨️ 补给快捷（键盘数字」
  const inner = e.querySelector('.sect-title') as HTMLElement | null;
  if (inner) return (inner.textContent || '').trim();
  const h3 = e.querySelector('h3') as HTMLElement | null;
  if (h3) return (h3.textContent || '').trim();
  return fallbackTitle(e.textContent || '');
}

/** M51：本局结束（死亡）时探索页上唯一该出现的卡 —— 旧版探索页整块隐藏，只留这一张 + 悬浮地图窗。
 *  幂等：卡片已在且已是第一个子节点就直接返回（再 insertBefore 也算一次 childList 变更，
 *  会触发 main.ts 那个 MutationObserver → mountWorldPanel 再进来 → 死循环）。 */
function mountOverCard(view: HTMLElement) {
  view.classList.add('v4-over');
  let card = view.querySelector<HTMLElement>('#v4over');
  if (!card) {
    const s = L.S as any;
    card = document.createElement('div');
    card.id = 'v4over';
    card.className = 'v4card';
    card.dataset.card = 'over';
    card.innerHTML =
      '<div class="card-hd"><span class="card-tt">💀 本局结束</span>' +
      '<span class="badge">第 ' + Math.max(1, Number(s?.day) || 1) + ' 天</span></div>' +
      '<div class="card-bd"><div class="hint">这一档到这里收尾了。重开一局，或者读回上一次存档。</div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn warn" onclick="restart()">🔄 重新开始</button>' +
      '<button class="btn" onclick="loadGame()">📂 读取存档</button></div></div>';
  }
  if (view.firstChild !== card) view.insertBefore(card, view.firstChild);
}

export function mountWorldPanel() {
  const S = L.S;
  const view = document.getElementById('view');
  if (!view) return;
  /* M32：地图不再塞进探索页 —— 它住在右上角的悬浮窗里（#v4mapwin），**任何页签都能开**。
     所以 mountWorldPanel 现在管两件事：
       ① 把地图卡摆到该在的地方（M34：摆法可配置 —— 悬浮窗 / 探索页顶部，同一张 #v4world 换个宿主）；
       ② 探索页这边只维护卡片墙（整宽、单列），并把 legacy 的旧节点收进卡片墙。 */
  ensureMapWindow();
  const style = prefsMapStyle();
  const winBody = document.querySelector('#v4mapwin .mwbody') as HTMLElement | null;
  /* inline 只在探索页生效：背包/人体页里地图卡留在窗 body 待命，
     否则它会跟着 legacy 那些页面的内容一起渲染出来（那不叫"嵌入探索页"）。 */
  const inlineHere = style === 'inline' && !!S && !S.over && S.tab === 'explore';
  let map = document.getElementById('v4world') as HTMLElement | null;
  if (!map) { map = document.createElement('div'); map.id = 'v4world'; map.className = 'card v4world'; }
  const host = inlineHere ? view : (winBody || view);
  if (map.parentElement !== host) host.appendChild(map);     // 换宿主（两种摆法共用同一张卡）
  if (!S || S.over) {
    /* M51：本局结束（现在只剩"死亡"这一种情形 —— 通关改成无尽延续，不再置 over）也**不把探索页
       交回 legacy**：那正是用户报的"通关后整个界面退回老版本"（旧版城市地图 +「本局已通关」图例）。
       v4 自己挂一张结束卡，并给 #view 打上 v4-over（CSS 把旧版内容整块隐藏）。 */
    if (S && S.tab === 'explore') mountOverCard(view);
    else view.classList.remove('v4-over');
    view.classList.remove('v4-board');
    paintMapWindow();
    return;
  }
  view.classList.remove('v4-over');            // 重开/读档后不能再带着结束态（那张卡随 legacy 重画一起没了）
  if (S.tab === 'explore') {
    /* M25.2：读档/换日之后把 AP 上限与睡眠债 + 体能对齐（R5：债是唯一真值）。 */
    const capBefore = L.S.apMax;
    syncApMax();
    if (L.S.apMax !== capBefore) { L.renderHud(); L.renderTop(); }
    ensureEvac();                 // 第 90 天进入撤离窗口时落盘并提示
  }
  /* M26：探索页不再有工具条（世界/账号搬进 ☰ 菜单）——顺手把老版留下的 #v4tools 节点清掉，
     否则「整页不可滚」那条布局账会把它算进去（它已经不是网格的一部分了）。 */
  const staleTools = document.getElementById('v4tools');
  if (staleTools) staleTools.remove();
  pruneLegacy(view);

  const mapHtml = renderMapPanel();
  const cardsHtml = renderCards();
  /* M32：**必须自己创建** #v4world（旧代码是插进 #view 时顺手建的，
     改成悬浮窗之后那条路径没了，实测第一次就是这里漏了：窗口在、body 空的、地图压根没画）。 */
  if (map.dataset.sig !== mapHtml) { map.innerHTML = mapHtml; map.dataset.sig = mapHtml; }
  paintMapWindow();

  if (S.tab !== 'explore') {
    /* 别的页签：地图窗还在就行，卡片墙不参与（那些页由 legacy/人体页渲染）——
       M53：但**卡片语言要统一**：把这些页的 `.sect-title` 分段包成 v4 卡片（原地包，不搬家、不动地图卡）。 */
    view.classList.remove('v4-board');
    unifyTab(view);
    return;
  }
  let board = view.querySelector(':scope > .v4board') as HTMLElement | null;
  if (!board) { board = document.createElement('div'); board.id = 'v4cards'; board.className = 'v4board'; }
  // 内容没变就别重写 innerHTML（否则每次 render 都会重置悬停态）
  if (board.dataset.sig !== cardsHtml) {
    board.innerHTML = cardsHtml;
    board.dataset.sig = cardsHtml;
    adoptLegacy(view, board);          // 卡片墙重建后，把 legacy 那几张（委托板/日历）重新认领进来
  }
  /* M34：inline 时地图卡也在 #view 里，而且必须排在卡片墙**前面**（DOM 顺序 = 网格行顺序：地图在上）。
     守卫要写全：节点已经是第一个子节点时再 insertBefore 也算一次 childList 变更，
     会触发 main.ts 那个 MutationObserver → mountWorld 再进来一次（死循环）。
     ⚠ 探针实测抓到的坑：legacy 的 render() 会把 #view 的 outerHTML 整块换掉 —— 卡片墙是**新建**的
     （`board.parentElement` 为 null），所以 inline 分支里也必须把它挂回 #view，否则嵌入模式下
     行动卡片整块消失（地图在、卡片没了）。 */
  if (inlineHere) {
    if (view.firstChild !== map) view.insertBefore(map, view.firstChild);
    if (board.parentElement !== view) view.appendChild(board);
  } else if (view.firstChild !== board) {
    view.insertBefore(board, view.firstChild);
  }
  view.classList.add('v4-board');
  /* M32：卡片墙是刚刚才建的，字号（zoom）要在这里补一次 —— applyScale 在 boot 时跑过一次，
     那时 #v4cards 还不存在（实测：探针读到的 zoom 一直是 none）。 */
  try { (window as any).V4Scale?.paintMap(); } catch { /* 忽略 */ }
  try { (window as any).V4Scale?.applyCardsZoom?.(); } catch { /* 忽略 */ }
  /* M25.1：fitMap 必须等**两次** rAF —— 第一次 rAF 时容器高度还在布局中途，量出来的是旧值。 */
  requestAnimationFrame(() => requestAnimationFrame(fitMap));
  /* 窗口尺寸变化 / 折叠展开时重算格子尺寸；只在尺寸真的变了才动，避免"改格子→触发 observer→死循环" */
  if (typeof ResizeObserver !== 'undefined') {
    const mapCard = document.getElementById('v4world');        // 注意：本函数里 `card` 是"造卡片"的工具函数，别撞名
    const ro = mapCard ? (mapCard as any).__ro as ResizeObserver | undefined : undefined;
    if (mapCard && !ro) {
      let lastW = 0, lastH = 0;
      /* M59：fit 自己就会改变卡片高度 —— 把"我刚摆出来的尺寸"记下来，observer 再报同一个数就跳过。
         否则「fit → 卡片变高 → observer → fit」会一直互相推动（用户报障的"抽搐"，见 fitRegion 注释）。 */
      let fitW = 0, fitH = 0;
      const obs = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (!r) return;
        const w = Math.round(r.width), h = Math.round(r.height);
        if (Math.abs(w - fitW) < 4 && Math.abs(h - fitH) < 4) return;     // 这是我们自己刚摆出来的尺寸
        if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;   // 格子尺寸变化引起的高度抖动忽略
        lastW = w; lastH = h;
        requestAnimationFrame(() => {
          fitMap();
          const b = mapCard.getBoundingClientRect();
          fitW = Math.round(b.width); fitH = Math.round(b.height);
        });
      });
      obs.observe(mapCard);
      (mapCard as any).__ro = obs;
    }
  }
}

/** M32 · 地图悬浮窗：右上角一个浮层，头部有标题与关闭键，折叠后只剩一条小条 */
export function ensureMapWindow(): void {
  let win = document.getElementById('v4mapwin') as HTMLElement | null;
  if (!win) {
    win = document.createElement('div');
    win.id = 'v4mapwin';
    win.innerHTML = '<div class="mwhead">' +
      '<span class="mwname" id="v4mapwin-title">🗺️ 地图</span>' +
      '<span class="hint" style="margin:0">按 <span class="mono">M</span> 折叠</span>' +
      '<button class="btn sm" onclick="V4Scale.toggleMap()" title="折叠地图（M）">✕ 收起</button>' +
      '</div><div class="mwbody"></div>';
    document.body.appendChild(win);
  }
  let bar = document.getElementById('v4mapbar') as HTMLElement | null;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'v4mapbar';
    bar.setAttribute('role', 'button');
    bar.title = '打开地图（M）';
    bar.innerHTML = '🗺️ <b>地图</b> <span class="hint" style="margin:0">M</span>';
    bar.addEventListener('click', () => { try { (window as any).V4Scale?.toggleMap(true); } catch { /* 忽略 */ } });
    document.body.appendChild(bar);
  }
  const btn = document.getElementById('btn-v4map');
  if (!btn) {
    const tools = document.querySelector('#topbar .tools');
    if (tools) {
      const b = document.createElement('button');
      b.id = 'btn-v4map';
      b.className = 'icobtn';
      b.title = '地图：本地/大区（快捷键 M）';
      b.textContent = '🗺️';
      b.addEventListener('click', () => { try { (window as any).V4Scale?.toggleMap(); } catch { /* 忽略 */ } });
      tools.insertBefore(b, tools.firstChild);
    }
  }
}

/** 头部标题跟着当前模式/区域变（本地 ↔ 大区） */
export function paintMapWindow(): void {
  const win = document.getElementById('v4mapwin');
  if (!win) return;
  const t = document.getElementById('v4mapwin-title');
  if (t) {
    const here = homeRegion();
    t.textContent = mapMode === 'region' ? '🌐 大区地图 · ' + here.name : '🗺️ 本地地图 · ' + here.short;
  }
  try { (window as any).V4Scale?.paintMap(); } catch { /* 还没装好 */ }
}

/** 地图格子尺寸自适应：算「整列内容总高（含上方标题与工具条）」，超了就缩格子，直到不用滚。
    下限 24px（R4 定的点击命中区），上限 28px（再大就顶出屏幕）。 */
function fitMap() {
  const view = document.getElementById('view');
  const card = document.getElementById('v4world');
  if (!view || !card || !view.classList.contains('v4-board')) return;
  /* M32：地图在悬浮窗里，折叠时量不到尺寸 —— 直接跳过（否则会拿 0 去反推格子边长）。
     M34：inline 模式下地图在探索页里，"窗开着没"不再是判据 —— 改成看**卡片自己有没有尺寸**，
     两种摆法（悬浮窗折叠 / 嵌入页折叠）都由这一条兜住。 */
  const win = document.getElementById('v4mapwin');
  if (prefsMapStyle() !== 'inline' && (!win || !win.classList.contains('open'))) return;
  if (!card.offsetWidth && !card.offsetHeight) return;
  const rgrid = card.querySelector('.rgrid') as HTMLElement | null;
  if (rgrid) { fitRegion(view, card, rgrid); return; }        // 大区图走 12×12 那套算法
  const wrap = card.querySelector('.wmapwrap') as HTMLElement | null;
  const grid = card.querySelector('.wgrid') as HTMLElement | null;
  if (!wrap || !grid) return;
  const cardBox = card.getBoundingClientRect();
  const viewBox = view.getBoundingClientRect();
  /* M40：可用高度按**卡片所在的宿主**量（float 摆法下地图卡在悬浮窗里，不属于 #view）。
     M41 修正：不再拿 `Math.min(viewBox.bottom, …)` —— 手机上 #view 被日志栏压得很矮（实测 86px），
     一取 min 就把地图判成"没地方放"而放弃适配。宿主是谁就用谁的底边。 */
  const hostBox = (card.parentElement || view).getBoundingClientRect();
  const chrome0 = cardBox.height - wrap.getBoundingClientRect().height;   // 标题行/预览条/悬停行/图例/内边距
  if (hostBox.bottom - cardBox.top - chrome0 - 8 < 300) return;           // 太窄就不折腾，交给容器自己滚
  /* M25.4：下限从 18px 回到 **24px**（R4 定的点击命中区）——之前那版 18px 是为了掩盖"缩不下去"的
     假象：真正让地图塞得下的手段是方块尺寸**由列宽推导**（不再写死行高）+ 不在别处覆盖列宽。
     现在 byBox 算得准了，24px 也能塞进 512px 的地图框（24×24 + 2px 缝 = 622px 的内容，
     靠 .wcell 的 box-sizing:border-box 与 2px 缝的边界取整刚好收进容器）。
     M32.1：格子下限/上限要按**渲染后**的像素算 —— #v4world 带 zoom，本地 24px 在 160% 下渲染成
     38px，而悬浮窗的宽度是定死的，于是 24×24 的网格横向溢出（实测 57px，右列被切）；
     高度同理会把窗口顶出屏幕。除以 zoom 之后屏幕上仍是 24~28px（R4 的点击命中区不变）。 */
  const z = uiZoom();
  /* M40：触屏把点击命中区的**目标**从 24px 提到 30px（手指点 24px 的方块就是在赌运气）。
     M41：它只是"想要多大"，不再强制 —— 用户明确要求"地图别把主区域吃满、压缩回以前那样"，
     所以先保证一屏装下（fitCellSize 把 byBox/byW 当硬约束），装得下才用目标尺寸。
     规则本体在 ui-scale-core.cellTargets / fitCellSize（纯函数、有单测）。 */
  const { max: capCell } = cellTargets(coarsePointer(), z);
  /* 触屏的绝对下限抬到 16px：手指点 11px 的方块不现实；宁可让地图比框宽一点（单指拖着看）。 */
  const hardMin = coarsePointer() ? 16 : CELL_HARD_FLOOR;
  const budget = (): { byBox: number; byW: number } => {
    /* M41：基准必须**稳定** —— 悬浮窗的高度是跟着地图卡走的（地图缩→窗缩→可用高度又变小），
       拿"宿主底边"当基准会变成正反馈：格子一路缩到硬下限 12px（实测 100% 下从 24px 掉到 12px）。
       所以：inline 用 #view 的底边（网格轨道，与地图无关）；float 用**屏幕**底边（窗口自己那份
       max-height 是 `/var(--fs)` 的视口高度，也是稳定值）。 */
    const b = card.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const chrome = b.height - wb.height;
    const hostEl = card.parentElement || view;
    const stableBottom = (hostEl === view) ? view.getBoundingClientRect().bottom : (window.innerHeight - 12);
    const avail = stableBottom - b.top - chrome - 8;
    return {
      byBox: Math.floor((avail - 16 - 46) / 24),          // 16 = 上下 padding+边框，46 = 缝与余量
      byW: Math.floor((wrap.clientWidth - 14 - 46) / 24),
    };
  };
  const pickCell = (): number => {
    const { byBox, byW } = budget();
    const c = fitCellSize({ byBox, byW, cap: capCell, hardMin });
    try { ((window as any).__fitLog = (window as any).__fitLog || []).push({ byBox, byW, cell: c, chrome: Math.round(card.getBoundingClientRect().height - wrap.getBoundingClientRect().height), cardH: Math.round(card.getBoundingClientRect().height), hostBottom: Math.round((card.parentElement || view).getBoundingClientRect().bottom) }); } catch { /* 忽略 */ }
    return c;
  };
  let cell = pickCell();
  const apply = (c: number) => {
    const tpl = 'repeat(24, ' + c + 'px)';
    if (grid.style.gridTemplateColumns !== tpl) {
      grid.style.gridTemplateColumns = tpl;
      /* M25.4：**不要再写 gridAutoRows** —— 行高与列宽分别写两个数，改一个忘一个就会出现
         "列 28px 行 21px"的扁方块（用户截图：「地图方块被压缩了，现在是扁的长方体」）。
         格子自己有 aspect-ratio:1/1，让**行高由列宽推导**：只维护一个数，方块永远是正方形。 */
      grid.style.gridAutoRows = '';
      grid.style.gridTemplateRows = '';
      grid.style.alignItems = 'start';        // 行框比格子高时也不许拉伸（双保险）
      grid.style.minWidth = '0';
    }
  };
  apply(cell);
  /* M41：**再收敛一次** —— 上面第一次 pickCell 量到的 chrome 可能是换字号那一帧的旧值，
     直接定死会留下偏大的格子（实测 160% 下窗里还得滚 268px）。apply() 会同步改变布局，
     所以这里量第二遍、必要时再定一次，最多三轮。 */
  for (let pass = 0; pass < 3; pass++) {
    const next = pickCell();
    if (next === cell) break;
    cell = next;
    apply(cell);
  }
  /* M25.4：把"溢出多少就缩多少"改成**直接算目标边长**再一步到位 ——
     原来按溢出量减，一次会缩过头（实测 24px 时溢出约 103px、算出减 5 → 19px，
     比真正需要的 23px 小 4px，格子白白小了 17%）。这里按"网格高度 = 24c + 46"反解 c。 */
  /* M26.1：46 改成 44 —— 实测 24px 时地图卡比可视区高 31px（#view 会滚 31px），
     而 `网格高 = 24c + 2×23(缝) + 2(边框取整)` 在 c 较小时余量给多了，导致 23px 明明塞得下却被判"还不 fit"。
     少留 2px 就能让循环收到 23px（格子肉眼无差、但整页/容器都不再滚）。 */
  const shrinkTo = (cur: number, over: number, rows = 24): number =>
    Math.max(CELL_HARD_FLOOR, Math.min(cur, Math.floor((rows * cur + 44 - over - 48) / rows)));
  let guard = 6;
  while (wrap.scrollWidth > wrap.clientWidth + 1 && cell > CELL_HARD_FLOOR && guard-- > 0) apply(--cell);   // 先保宽度不滚
  guard = 6;
  while (wrap.scrollHeight > wrap.clientHeight + 1 && cell > CELL_HARD_FLOOR && guard-- > 0) {
    const over = wrap.scrollHeight - wrap.clientHeight;
    const next = shrinkTo(cell, over);
    apply(next >= cell ? cell - 1 : next);
  }
}

/** M21.1 / M26.2 / M59：大区图（12×12）一屏装下。
    ⚠️ M59 修的是用户报障的「大区地图会一直抽搐」：旧预算里的 `card.clientHeight` 与 `col.clientHeight`
    **都含网格本身** —— 格子一大卡片就变高、下一遍算出的可用高度又变小 → 缩 → 又变矮 → 再变大，
    配上 fitMap 的 ResizeObserver 就是永动机（实测 1280×900 悬浮窗 2.5 秒内换了 11 次边长 21~27px、卡高 674~746px）。
    现在预算全部取**与格子大小无关**的量：宿主底边（悬浮窗=视口底、inline=#view 底）+ 除网格外的固定开销 chrome。 */
function fitRegion(view: HTMLElement, card: HTMLElement, rgrid: HTMLElement) {
  const col = rgrid.parentElement as HTMLElement | null;
  /* M21.1：卡片不够宽就"详情在上、地图在下"（<880px 时并排放不下两张东西），
     这样点完格子立刻看到路程报价与「出发」，不用先滚过整张地图。 */
  const main = card.querySelector('.rmain') as HTMLElement | null;
  if (main) main.classList.toggle('stack', card.clientWidth < 880);
  const z = uiZoom();                                   // M32.1：同样的"下限按渲染像素算"（见 fitMap）
  const minRCell = Math.max(8, Math.round(18 / z));
  const maxRCell = Math.max(minRCell, Math.round(72 / z));
  /* M41 同款口径：悬浮窗的高度是跟着卡片走的，所以基准取**与格子无关**的固定边界：
     inline = #view 底边（网格轨道）；悬浮窗 = min(#view 底边, 窗口自己的 max-height 底边, 视口底)。
     —— 窗口是"固定右上角、按内容长高到 max-height 为止"，上限写在 CSS 里，所以同样稳定；
     再跟 #view 底边取小是因为"整张卡一屏装下"一直是按 #view 量的（M21.1 用户报障"这边也溢出了"）。
     窗口头部（.mwhead）不是卡片的地盘，要扣掉。
     ⚠️ M65：**全部换回布局像素**（拿到的矩形/innerHeight 都要 ÷z）。宿主带 `zoom: var(--fs)`，
     矩形与 `innerHeight` 是屏幕像素，而 `offsetHeight`、常量 40/12/33 与内联列宽都是布局像素 ——
     以前混着减：① 预算偏小成 1/z（160% 下白缩一档）；② 窗口上限那块也一样混，
     160% 下反而算出"放得下"→ 卡片顶出窗口、窗内要滚 404px（M65 探针实测）。 */
  const px = (v: number) => v / z;                       // 屏幕像素 → 布局像素
  const inlineHost = card.parentElement === view;
  let stableBottom = px(view.getBoundingClientRect().bottom);
  if (!inlineHost) {
    const win = document.getElementById('v4mapwin');
    const maxH = win ? parseFloat(getComputedStyle(win).maxHeight) : NaN;      // 已经是布局像素
    const headH = win ? ((win.querySelector('.mwhead') as HTMLElement | null)?.offsetHeight || 0) : 0;
    const winBottom = (win && isFinite(maxH)) ? px(win.getBoundingClientRect().top) + maxH - headH - 6 : Infinity;
    stableBottom = Math.min(stableBottom, winBottom, px(window.innerHeight - 12));
  }
  /** 按当前实测算一次（chrome 与卡片都随字号/详情开合变，所以算两遍：先摆一次、再按新布局修一次） */
  const decide = (): number => {
    const avail = stableBottom - px(card.getBoundingClientRect().top) - 8;
    if (avail < 280) return 0;                                                // 太窄就不折腾，交给容器自己滚
    /* 除网格以外的开销：标题行/图层条/说明/图例/详情/内边距 —— details 开合会变，但与格子边长无关 */
    const chrome = Math.max(0, card.offsetHeight - rgrid.offsetHeight);
    const byBox = Math.floor((avail - chrome - 40) / 12);
    const byW = Math.floor(((col ? col.clientWidth : card.clientWidth) - 33) / 12);
    return Math.max(minRCell, Math.min(maxRCell, byBox, byW));
  };
  const cell0 = decide();
  if (!cell0) return;
  apply(cell0);
  /* 第二遍：apply 之后 chrome 可能变了（详情换行、图例折行），按新布局再定一次；
     然后按**真实溢出量**收一次（补 `.rcell2{min-height:34px}` 那 ~4px/行）。都只做一次、不回环 ——
     这正是 M59 的教训：任何"循环到收敛"的写法配上 ResizeObserver 都会变成永动机。 */
  const cell1 = decide() || cell0;
  if (cell1 !== cell0) apply(cell1);
  const over = px(card.getBoundingClientRect().bottom) - (stableBottom + 2);  // 布局像素溢出量
  if (over > 0 && cell1 > minRCell) apply(Math.max(minRCell, cell1 - Math.ceil(over / 12)));

  function apply(c: number): void {
    const tpl = 'repeat(12, ' + c + 'px)';
    if (rgrid.style.gridTemplateColumns !== tpl) {
      rgrid.style.gridTemplateColumns = tpl;
      rgrid.style.justifyContent = 'start';
      rgrid.style.maxWidth = 'none';
    }
    // 名字放不下就只留危险数字（跟窄屏规则一致），免得撑出去
    rgrid.classList.toggle('tiny', c < 28);
  }
}

/* ── 交互 ── */

function tripText(t: Trip): string {
  return t.mode === 'car'
    ? ('🚗 开车 ' + t.steps + ' 公里：' + t.ap + ' 行动力 + ' + t.fuel + ' 油')
    : ('🚶 步行 ' + t.steps + ' 公里：' + t.ap + ' 行动力' + (fractured() ? '（骨折，走得慢）' : ''));
}

function biomeEnemies(b: Block): string[] {
  const poi = poiOf(b);
  if (poi) return poi.enemies;
  switch (b.biome) {
    case 'city': case 'suburb': return ['walker', 'runner', 'crawler'];
    case 'forest': case 'farm': return ['hound', 'walker'];
    case 'industrial': case 'ruins': return ['walker', 'brute', 'poison'];
    case 'military': return ['armored', 'screamer', 'brute'];
    case 'highway': return ['hound', 'runner'];
    default: return ['walker'];
  }
}

/** 走完一段路：逐格推进 + 掷遭遇；撞上东西就停在那一格打起来（打完可以继续走） */
function runTrip(target: { x: number; y: number }, t: Trip) {
  const S = L.S, s = sw(), w = worldOf(s.seed, s.region);
  if (!L.spendAP(t.ap)) return;
  if (t.mode === 'car' && s.veh) {
    s.veh.fuel = Math.max(0, s.veh.fuel - t.fuel);
    s.veh.hp = Math.max(0, s.veh.hp - Math.round(t.steps * 0.4));
  }
  const stop = rollTravelEncounter(Math.random, {
    steps: t.steps, night: isNight(), danger: curBlock().danger, car: t.mode === 'car',
    // M24 潜行：基础 -3%/级（上限 25%），Lv6 起再 -10%（perk「遭遇率再 -10%」）
    luck: L.skillBonus('stealth', 0.03, perkOn('stealth', 6) ? 0.35 : 0.25) + (perkOn('stealth', 6) ? 0.10 : 0),
  });
  const walk = stop ?? t.steps;
  for (let i = 1; i <= walk; i++) {
    const b = blockAt(w, t.path[i].x, t.path[i].y);
    if (!b) break;
    const fresh = !s.visited[bkey(b.x, b.y)];      // M24 侦查：走到没去过的地方才涨
    s.cur = { x: b.x, y: b.y };
    markVisited(w, s, b.x, b.y);
    s.steps++;
    L.addXP('fitness', 1);                        // M24：走路涨体能（以前体能永远 Lv.0）
    if (fresh) L.addXP('scout', 2);
  }
  if (stop === null) L.addXP('stealth', 1);       // 一路没撞上东西 = 潜行有用
  const here = curBlock();
  const zid = zoneOfPoi(here.poi);
  radAfterWalk(w, t.path as any, walk);          // M25：辐射区里走一趟，体内辐射会累积
  S.loc = zid ?? (bkey(here.x, here.y) === homeKey(s) ? 'base' : S.loc);
  s.trail.push((t.mode === 'car' ? '🚗' : '🚶') + ' → ' + here.name + (here.poi ? '（' + POIS[here.poi].name + '）' : ''));
  if (s.trail.length > 24) s.trail.shift();
  L.sfx('ui');
  takeFragment(here);      // 抵达碎片点就顺手把碎片揣走（不用再搜一次）

  if (stop !== null) {
    const pool = biomeEnemies(here);
    const n = 1 + (here.danger >= 4 ? 1 : 0);
    const foes: string[] = [];
    for (let i = 0; i < n; i++) foes.push(pool[Math.floor(Math.random() * pool.length)]);
    s.fights++;
    L.log('☠️ 走到' + here.name + '时，' + foes.map(id => L.ZOMBIES?.[id]?.n ?? '丧尸').join('、') + '从阴影里出来了。', 'danger');
    L.render();
    L.autosave();
    L.startCombat(foes, { title: '路上 · ' + here.name });
    return;
  }
  L.log('🧭 你到了' + here.name + (here.poi ? '（' + POIS[here.poi].icon + ' ' + POIS[here.poi].name + '）' : '') +
    '。走了 ' + t.steps + ' 公里，用了 ' + t.ap + ' 行动力' + (t.fuel ? ' 和 ' + t.fuel + ' 油' : '') + '。', 'info');
  L.autosave();
  L.render();
}

export const V4World = {
  /** M34：重挂一次世界面板（切换地图摆法后必须重挂 —— 地图卡要换宿主） */
  remount() { try { mountWorldPanel(); } catch (e) { console.warn('[v4] 世界面板重挂失败', e); } },
  /** M16：本地地图 / 大区地图切换（内联 onclick：V4World.mapMode('region')） */
  mapMode(m: string) { return setMapMode(m); },
  /** M17.2：大区地图上色图层（地貌 / 危险度） */
  regionLayer(m: string) { return setRegionLayer(m); },
  /** C10：点格子 = 先出路线预览（第一次），同一个目标再点一次才出发（手机 tap 等价路径） */
  click(x: number, y: number) {
    const s = sw(), w = worldOf(s.seed, s.region);
    const b = blockAt(w, x, y);
    if (!b) return;
    if (b.x === s.cur.x && b.y === s.cur.y) { L.toast('你就在这儿', '搜刮下面的 POI，或者点别的区块出发。', 'info'); preview = null; L.render(); return; }
    if (!b.revealed) { L.toast('地图上是黑的', '只能去已经点亮的区块。先到边界，把雾推出去。', 'bad'); return; }
    const r = planTrip(w, s.cur, b, { ap: L.S.ap, veh: s.veh, fractured: fractured(), night: isNight() });
    if ('err' in r) {
      preview = { x, y, path: [], text: r.err, ok: false };
      L.render();
      return;
    }
    // 已经预览过同一个目标 → 第二次点击视为确认（tap 等价路径）
    if (preview && preview.ok && preview.x === x && preview.y === y) { V4World.confirmTrip(); return; }
    preview = {
      x, y, path: r.trip.path.map(p => bkey(p.x, p.y)), ok: true,
      text: tripText(r.trip) + ' · 预计遭遇 ' + r.trip.encounters + ' 次' + (isNight() ? '（夜里更危险）' : ''),
    };
    L.render();
  },

  /** 悬停/长按详情（R6：可读文本，不依赖 emoji 含义）。
      M25.4：宽屏把悬停行收进预览条（CSS `.v4world .wbar.hoveroff .whover{display:none}`）——
      所以这里要按"谁看得见"来写：悬停行被藏起来时，详情就写进预览条，别写进一个看不见的盒子。 */
  hover(x: number, y: number) {
    const s = sw(), w = worldOf(s.seed, s.region);
    const b = blockAt(w, x, y);
    const hidden = document.getElementById('v4-hover');
    const merged = hidden ? getComputedStyle(hidden).display === 'none' : false;
    const box = merged ? document.getElementById('v4-preview') : hidden;
    if (!b || !box) return;
    if (!b.revealed) { box.innerHTML = '<span class="lb">📍 格子详情</span>(' + x + ',' + y + ') 未探索区域——走到边上才能看清。'; return; }
    const d = Math.max(Math.abs(b.x - s.cur.x), Math.abs(b.y - s.cur.y));
    const poi = poiOf(b);
    const parts = [
      '<span class="lb">📍 格子详情</span>',
      '<b>(' + b.x + ',' + b.y + ') ' + esc(b.name) + '</b>',
      biomeName(b),
      '危险 ' + b.danger,
      '距你 ' + d + ' 公里',
      poi ? (b.visited ? poi.icon + ' ' + esc(poi.name) + '（可搜 ' + poiLeft(b, s) + ' 次）' : '有建筑（没进去过）') : '空地',
      b.visited ? '去过' : '没去过',
    ];
    box.innerHTML = parts.join(' · ');
  },

  cancelTrip() { preview = null; L.render(); },

  /** M12 只读快照：探针/自检用（不提供任何写能力；区域、载具、进度计数都在这里） */
  snapshot() {
    const s = sw();
    const w = worldOf(s.seed, s.region);
    return {
      seed: s.seed,
      region: s.region,
      cur: { x: s.cur.x, y: s.cur.y },
      home: { x: w.home.x, y: w.home.y },          // M19：危险度是"离家的深度"，探针要拿它算环
      lab: { x: w.lab.x, y: w.lab.y },
      seenRegions: Object.keys(s.seenRegions),
      frozenRegions: Object.keys(s.regions),
      visitedKeys: Object.keys(s.visited).length,
      crossings: Number((s as any).crossings) || 0,      // M60：真的跨过大区几次（教学第 5 章目标③）
      veh: s.veh ? { fuel: s.veh.fuel, hp: s.veh.hp } : null,
      ap: L.S.ap,
    };
  },

  /** M17：点一格 = 选中它（不动身）——详情里再按「出发」，避免手滑把自己开出去 */
  pickRegion(id: string) {
    const s = sw();
    selectedNote = '';
    /* 点"当前所在"那格 = 取消选中（不然没有取消的出口；详情里也有一个 × ） */
    selectedRegion = id === s.region ? null : id;
    L.render();
  },

  /** 取消选中（详情面板右上角的 ×） */
  clearPick() { selectedRegion = null; selectedNote = ''; L.render(); },

  /** M17 只读快照：大区元地图本身（探针/自检用，不给任何写能力） */
  meta() {
    return {
      cols: META_COLS, rows: META_ROWS, home: homeRegion().id,
      regions: REGIONS.map(r => ({
        id: r.id, name: r.name, short: r.short, type: r.type, tier: r.tier,
        col: r.col, row: r.row, dist: r.dist, resources: r.resources,
      })),
    };
  },

  /** M17 只读：某个区域的行车报价（含途经路线），探针用它挑"多跳目标"来验收 */
  trip(id: string) { return regionTripFor(sw(), id); },

  /** M18 只读：最近一次区域事件（探针/UI 显示"刚才撞上了什么"） */
  regionEvent() { return lastRegionEvent(); },

  /** M12 跨区域：先判定（没车/没油/行动力不够都给理由），通过才扣成本再换图 */
  travelRegion(id: string) {
    const S = L.S, s = sw();
    const trip = regionTripFor(s, id);
    if (!trip.ok) {
      selectedRegion = id;
      selectedNote = '出发失败：' + (trip.why || '') + (trip.hint ? '　' + trip.hint : '');
      L.toast('去不了 ' + regionName(id), (trip.why || '') + (trip.hint ? '　' + trip.hint : ''), 'bad');
      L.render();
      return;
    }
    const fuelCost = trip.fuel, apCost = trip.ap;
    const r = switchRegion(S, s, id);
    if (!r.ok) { L.toast('跨区失败', r.why || '未知原因', 'bad'); return; }
    S.ap = Math.max(0, S.ap - apCost);
    if (s.veh) {
      s.veh.fuel = Math.max(0, s.veh.fuel - fuelCost);
      s.veh.hp = Math.max(0, s.veh.hp - 4);          // 长途磨损：车况掉到 0 就得修
    }
    s.trail.push('🚗 跨区 → ' + regionName(id) + '（⚡-' + apCost + ' ⛽-' + fuelCost + '）');
    s.trail = s.trail.slice(-24);
    L.log('🚗 你上了高速，往「' + regionName(id) + '」去了（行动力 -' + apCost + '，油 -' + fuelCost + '）。', 'success');
    if (r.firstEnter) L.log('📖 ' + r.firstEnter, 'dim');
    /* M18：落地就掷一次区域事件（工业区可能漏毒气、军管区可能捡到军械箱…）。
       主城不掷——安全屋是唯一"绝对安全"的地方。 */
    onEnterRegion(regionById(id));
    if (s.veh && s.veh.hp <= 0) L.log('🔧 车在半路就开始冒烟了——得找地方修车，不然回不去。', 'danger');
    preview = null;
    selectedRegion = null; selectedNote = '';        // 落地了就别继续高亮"上一个目标"
    L.render();
  },

  confirmTrip() {
    if (!preview || !preview.ok) { preview = null; L.render(); return; }
    const { x, y } = preview;
    preview = null;
    V4World.travel(x, y);
  },

  /** C01/C02：按点位档位过夜（base/car/shelter/open） */
  sleep(kind: string) { rest(kind as any); },

  /** C07：在撤离点打出信号弹 */
  flare() { fireFlare(); },

  /** M7：钓鱼（1 AP） */
  fish() { doFish(); },
  /** M7：朝最近的水块游一格 */
  swim() {
    const s = sw(), w = worldOf(s.seed, s.region);
    const near = waterNearby();
    if (!near.blocks.length) { L.toast('旁边没水', '游水只用来过河/过湖：先走到水边。', 'bad'); return; }
    // 选离目标方向最近的那一格水（这里简单选第一格，玩家可反复点）
    const t = near.blocks[0];
    void w;
    swimStep({ x: t.x, y: t.y });
  },
  /** M7：水下搜索沉没基地 */
  dive() { doDive(); },

  travel(x: number, y: number) {
    const s = sw(), w = worldOf(s.seed, s.region);
    const b = blockAt(w, x, y);
    if (!b) return;
    const r = planTrip(w, s.cur, b, { ap: L.S.ap, veh: s.veh, fractured: fractured(), night: isNight() });
    if ('err' in r) { L.toast('走不了', r.err, 'bad'); return; }
    runTrip(b, r.trip);
  },

  search(deep: number) {
    const b = curBlock();
    /* M20：幽灵据点不是普通 POI——踩上去就是一场守卫战，赢了才结算战利品。
       （不打就不给东西，所以这里先拦截，不走 searchPoi 的掉落表。） */
    const gh = ghostAt(localWorld(sw()), b.x, b.y);
    if (gh) {
      L.log('👻 ' + gh.spec.owner + ' 的幽灵据点：' + gh.spec.tag + '（威胁 ' + gh.spec.threat + '）', 'lore');
      L.toast('遭遇幽灵守卫', gh.spec.owner + ' · 威胁 ' + gh.spec.threat, 'bad');
      L.startCombat(ghostFoes(gh.spec), {
        title: gh.spec.owner + ' 的幽灵据点',
        onWin: () => raidGhost(localWorld(sw()), b),
      });
      return;
    }
    const got = takeFragment(b);          // 碎片先结算，再走搜刮（避免战斗中拿不到）
    searchPoi(b, sw(), !!deep);
    if (got) L.render();
  },

  /** 汽修厂修车：有材料就能弄出一辆能跑的（M24：机械技能降材料） */
  fixCar() {
    const S = L.S, s = sw();
    if (s.veh) { L.toast('已经有车了', '车就停在门口。', 'info'); return; }
    const mat = repairCost(12), fuelN = 2;
    if (S.mat < mat || L.itemCount('fuel') < fuelN) { L.toast('材料不够', '修车要 ' + mat + ' 材料 + ' + fuelN + ' 汽油。', 'bad'); return; }
    S.mat -= mat; L.takeItem('fuel', fuelN);
    s.veh = { fuel: 4, hp: 100 };
    L.addXP('mechanic', 4);
    L.log('🔧 你把升降机上的车弄活了：油箱里还有一点底油，够跑到最近的加油站。' +
      (mat < 12 ? '（机械技能省了 ' + (12 - mat) + ' 材料）' : ''), 'success');
    L.sfx('loot'); L.autosave(); L.render();
  },

  /** 汽修厂修车况：6 材料换 40% 车况（M24：机械技能降材料） */
  repairCar() {
    const S = L.S, s = sw();
    if (!s.veh) { L.toast('没有车', '先修一辆出来。', 'bad'); return; }
    if (s.veh.hp >= 100) { L.toast('车况良好', '不用修。', 'info'); return; }
    const cost = repairCost(6);
    if (S.mat < cost) { L.toast('材料不够', '修车况要 ' + cost + ' 材料。', 'bad'); return; }
    S.mat -= cost;
    s.veh.hp = Math.min(100, s.veh.hp + 40);
    L.addXP('mechanic', 3);
    L.log('🔧 你把车架起来敲了一遍，车况回到 ' + s.veh.hp + '%。', 'info');
    L.sfx('loot'); L.autosave(); L.render();
  },

  /** 加油站补油：1 桶汽油 → 3 点油量（机械 Lv6 起 → 4 点） */
  refuel() {
    const s = sw();
    if (!s.veh) { L.toast('没有车', '先找汽修厂修一辆。', 'bad'); return; }
    if (L.itemCount('fuel') < 1) { L.toast('没有汽油', '在加油站/仓库搜到「汽油」再来。', 'bad'); return; }
    if (s.veh.fuel >= 12) { L.toast('油箱满了', '最多 12 点油量。', 'info'); return; }
    const add = perkOn('mechanic', 6) ? 4 : 3;
    L.takeItem('fuel', 1);
    s.veh.fuel = Math.min(12, s.veh.fuel + add);
    L.addXP('mechanic', 2);
    L.log('⛽ 加满一桶油（+' + add + '），油量 ' + s.veh.fuel + '/12。', 'info');
    L.sfx('loot'); L.autosave(); L.render();
  },

  /** 调试/测试用：把玩家瞬移到某个区块（不花行动力） */
  teleport(x: number, y: number) {
    const s = sw(), w = worldOf(s.seed, s.region);
    const b = blockAt(w, x, y); if (!b) return;
    s.cur = { x, y }; markVisited(w, s, x, y); L.render();
  },
};
