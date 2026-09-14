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
  META_COLS, META_ROWS, MAX_HOPS, REGIONS, REGION_TYPES as TYPES, TYPE_INFO, dangerColor, dangerLabel, homeRegion,
  metaGrid, planRegionTrip, regionById, regionName, typeColor, typeLabel, type RegionDef,
} from './regions-core';
import { poiLeft, searchPoi } from './search';
import { lastRegionEvent, onEnterRegion } from './region-events';
import { regionHazardTitles } from './region-events-core';
import { ghostAt, placeGhosts, raidGhost } from './ghosts';
import { ghostFoes } from './ghosts-core';
import { pendingFragKeys, takeFragment } from './fragments';
import { apMaxOf, isBloodMoonDay, rest, restOptions, tierAt, syncApMax } from './night';
import { ensureEvac, evacAvailable, fireFlare } from './evac';
import { CROPS, SEASON_INFO, WEATHER, growthDays } from './env-core';
import { envLine, envOf, seasonNow, tempPenalty } from './env';
import { farmSummary, cropList, harvest, plant, plotSlots, farmBuildCost } from './farm';
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
    apMax: apMaxOf(s.debt),
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
      const tip = def.name + ' · ' + typeLabel(def.type) + ' · 危险 ' + def.tier + '：' + def.desc +
        (seen ? '' : '（你还没去过这一带，物资是按地貌推的）');
      const bg = dangerMode ? dangerColor(def.tier) : typeColor(def.type);
      /* M24：两个图层各管各的（用户原话："为什么地貌上色还有危险度……危险度不是有单独的上色吗"）。
         地貌层 = 只有颜色（地名/危险数字都不画，看名字点开详情、或切到危险度层）；
         危险度层 = 只有数字。图例、悬停 title、点开的详情都还在，信息没丢。 */
      h += '<div class="' + cls + '" style="background:' + bg + ';--dc:' + dangerColor(def.tier) + '"' +
        ' title="' + esc(tip) + '" role="button" tabindex="0" onclick="V4World.pickRegion(\'' + def.id + '\')">' +
        (dangerMode ? '<i class="rnum d' + def.tier + '">' + def.tier + '</i>' : '') +
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
      L.S.ap + '/' + apMaxOf(s.debt) + '</b>——加油站和物流园能抽油，行动力回安全屋睡一觉。</div>';
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
      '<div class="wname">' + (home ? '🏠 安全屋（' : (poi ? poi.icon + ' ' + poi.name + '（' : '📍 ')) + esc(b.name) + '）</div>' +
      '<div class="hint">' + biomeName(b) + ' · 危险 ' + b.danger + ' · 距实验室 ' + labTxt + '</div>' +
    '</div>' +
    // R5：常驻信息位只有 3 个，睡眠债并进 AP 显示，不新开一格
    '<div class="wveh">' + (s.veh ? '🚗 油 ' + s.veh.fuel + ' · 车况 ' + s.veh.hp + '%' : '🚶 步行') +
      '　⚡ ' + L.S.ap + '/' + apMaxOf(s.debt) + ' · 债 ' + s.debt + ' 档' +
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
  h += '<div class="wbar">';
  h += '<div class="wpreview' + (preview ? (preview.ok ? ' on' : ' bad') : '') + '" id="v4-preview">' + (preview
    ? '<b>' + (preview.ok ? '🧭 路线预览' : '⛔ 走不了') + '</b> · ' + esc(preview.text) +
      (preview.ok ? ' <button class="btn xs primary" onclick="V4World.confirmTrip()">出发</button><button class="btn xs" onclick="V4World.cancelTrip()">取消</button>' : ' <button class="btn xs" onclick="V4World.cancelTrip()">知道了</button>')
    : '<span class="hint">点一个点亮的区块 → 这里显示路线与花费 → 再点一次（或点「出发」）才动身。</span>') + '</div>';
  h += '<div class="whover" id="v4-hover"><span class="hint">鼠标移到格子上（手机点一下）：这里显示那块地的名字、危险、距离和里面有什么。</span></div>';
  h += '</div>';

  /* M19：本地地图也能切"危险度上色"——"越深越红"这件事，一眼就该看得出来 */
  const localDanger = regionLayer === 'danger';
  h += layerTabs();
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
    '<div class="hint" style="margin-top:6px">行动力 <b>' + S.ap + '/' + apMaxOf(s.debt) + '</b> · 搜索 1 点 · 深度搜索 2 点 · 走路 1 点/区块' +
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
  let b = '<div class="hint">' + esc(envLine()) + '</div>';
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
/** 工具条（不是玩法卡）：世界 / 账号云存档 / 分享 / 统计都在这儿。
    用户原话："为什么这个操作面板的配置这么诡异……为什么和云存档放一起"——
    云存档是"关于存档的元操作"，跟"今天砍几棵树"不是一回事，所以从玩法区搬出来。 */
function toolsStrip(): string {
  const who = accountUser();
  return '<div class="v4tools" id="v4tools">' +
    '<button class="btn sm" onclick="V4Worlds.open()" title="多世界 / 挑战码 / 幽灵据点 / 本机统计">🌍 世界 · 分享</button>' +
    '<button class="btn sm" onclick="V4Account.open()" title="' + esc(accountSummary()) + '">' +
      (who ? '👤 ' + esc(String(who).slice(0, 14)) : '👤 注册 / 登录') + '</button>' +
    '<span class="hint">存档、账号、挑战码、统计都在这一行——不占玩法版面</span></div>';
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
  let body = '';
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
  // legacy 的「城市地图」「可搜刮区域」两段由大世界地图取代：标题 + 紧随其后的那块内容一起摘掉
  const titles = Array.from(view.querySelectorAll('.sect-title')) as HTMLElement[];
  for (const t of titles) {
    const txt = (t.textContent || '').trim();
    // 这两块被大世界地图取代（M17），今日行动被 v4 的卡片取代（M21：里面的「睡觉」按钮
    // 直连 sleepNight()，会绕过 v4 的睡眠债/环境/夜袭结算，且和「今夜」卡重复）
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
    现在**任何**没被认领的节点都会被包成一张有标题的卡片。 */
function adoptLegacy(view: HTMLElement, board: HTMLElement) {
  const keep: Element[] = [];
  for (const child of Array.from(view.children)) {
    if (child === board || child.id === 'v4world' || child.id === 'v4tools') continue;
    if ((child as HTMLElement).classList.contains('v4board')) continue;
    keep.push(child);
  }
  for (const el of keep) {
    const e = el as HTMLElement;
    if (e.classList.contains('v4card')) { board.appendChild(e); continue; }
    let title = '', badges: string[] = [], bodyEl: HTMLElement | null = null;
    if (e.classList.contains('sect-title')) {
      // sect-title + 紧随其后的 .card/.grid = 一段完整的 legacy 区块
      title = (e.textContent || '').trim();
      badges = Array.from(e.querySelectorAll('.badge')).map(b => (b.textContent || '').trim());
      const next = e.nextElementSibling as HTMLElement | null;
      bodyEl = next && (next.classList.contains('card') || next.classList.contains('grid')) ? next : null;
      e.remove();
    } else {
      bodyEl = e;                              // 裸卡片/散件：它自己就是内容
      title = legacyTitleOf(e);
    }
    const wrap = document.createElement('div');
    wrap.className = 'v4card';
    wrap.dataset.card = 'legacy';
    wrap.innerHTML = '<div class="card-hd"><span class="card-tt">' + title + '</span>' +
      badges.map(b => '<span class="badge">' + b + '</span>').join('') + '</div>' +
      '<div class="card-bd">' + (bodyEl ? bodyEl.outerHTML : '') + '</div>';
    board.appendChild(wrap);
    if (bodyEl) bodyEl.remove();               // 原件（无论是原节点还是被移出来的那个）都清掉
  }
}

/** 裸 legacy 节点的标题：能认出来的给专名，认不出就给个中性标题（总比没有强） */
function legacyTitleOf(e: HTMLElement): string {
  if (e.classList.contains('v4teaser')) return '📜 委托板';
  const inner = e.querySelector('.sect-title') as HTMLElement | null;
  if (inner) return (inner.textContent || '').trim();
  const h3 = e.querySelector('h3') as HTMLElement | null;
  if (h3) return (h3.textContent || '').trim();
  const txt = (e.textContent || '').trim().slice(0, 12);
  return txt ? '📋 ' + txt : '📋 更多';
}

export function mountWorldPanel() {
  const S = L.S;
  const view = document.getElementById('view');
  if (!view) return;
  // 切到别的页签（背包/任务…）时必须撤掉卡片墙，否则那些内容会被塞进探索页的网格里
  if (!S || S.tab !== 'explore' || S.over) {
    view.classList.remove('v4-board');
    return;
  }
  syncApMax();                  // 读档/换日之后把 AP 上限与睡眠债对齐（R5：债是唯一真值）
  ensureEvac();                 // 第 90 天进入撤离窗口时落盘并提示
  pruneLegacy(view);

  /* M21 版面：左地图 + 右卡片墙（CSS `#view.v4-board`，≥1024px 生效；窄屏自动叠成一列）。
     用户反馈原文："配置不平衡（左边一大堆右边就一个）……为什么不多搞一些卡片"——
     所以详情面板被拆成 9 张卡，卡片墙用 auto-fill 网格自己找平，不再有"三列高矮不一"。 */
  const mapHtml = renderMapPanel();
  const cardsHtml = renderCards();
  const toolsHtml = toolsStrip();
  let tools = document.getElementById('v4tools') as HTMLElement | null;
  let map = document.getElementById('v4world') as HTMLElement | null;
  let board = view.querySelector(':scope > .v4board') as HTMLElement | null;
  if (!map) { map = document.createElement('div'); map.id = 'v4world'; map.className = 'card v4world v4-mapcol'; }
  if (!board) { board = document.createElement('div'); board.id = 'v4cards'; board.className = 'v4board'; }
  if (!tools) { tools = document.createElement('div'); tools.id = 'v4tools'; tools.className = 'v4tools'; }
  // 内容没变就别重写 innerHTML（否则每次 render 都会重置地图滚动位置/悬停态）
  if (map.dataset.sig !== mapHtml) { map.innerHTML = mapHtml; map.dataset.sig = mapHtml; }
  if (board.dataset.sig !== cardsHtml) {
    board.innerHTML = cardsHtml;
    board.dataset.sig = cardsHtml;
    adoptLegacy(view, board);          // 卡片墙重建后，把 legacy 那几张（委托板/日历）重新认领进来
  }
  if (tools.dataset.sig !== toolsHtml) { tools.innerHTML = toolsHtml; tools.dataset.sig = toolsHtml; }

  if (view.firstChild !== tools) view.insertBefore(tools, view.firstChild);
  if (tools.nextSibling !== map) view.insertBefore(map, tools.nextSibling);
  if (map.nextSibling !== board) view.insertBefore(board, map.nextSibling);
  view.classList.add('v4-board');
  requestAnimationFrame(fitMap);        // 按可用高度定格子尺寸：能放大就放大，能放下就不滚
}

/** 地图格子尺寸自适应：算「整列内容总高（含上方标题与工具条）」，超了就缩格子，直到不用滚。
    下限 24px（R4 定的点击命中区），上限 28px（再大就顶出屏幕）。 */
function fitMap() {
  const view = document.getElementById('view');
  const card = document.getElementById('v4world');
  if (!view || !card || !view.classList.contains('v4-board')) return;
  const rgrid = card.querySelector('.rgrid') as HTMLElement | null;
  if (rgrid) { fitRegion(view, card, rgrid); return; }        // 大区图走 12×12 那套算法
  const wrap = card.querySelector('.wmapwrap') as HTMLElement | null;
  const grid = card.querySelector('.wgrid') as HTMLElement | null;
  if (!wrap || !grid) return;
  const cardBox = card.getBoundingClientRect();
  const viewBox = view.getBoundingClientRect();
  const chrome = cardBox.height - wrap.getBoundingClientRect().height;   // 标题行/预览条/悬停行/图例/内边距
  const avail = viewBox.bottom - cardBox.top - chrome - 8;
  if (avail < 300) return;                                             // 太窄就不折腾，交给容器自己滚
  // M21：格子尺寸同时受**宽**约束（左列一旦是固定宽度，高度算出来的 28px 会把地图撑到横向滚动）。
  // 另外给卡片墙留 ~150px「露头」：地图再大也是 24×24，操作卡片一张都看不见才是真问题。
  const availW = wrap.clientWidth - 14;                                 // 减去 .wmapwrap 的内边距与边框
  const byW = Math.floor((availW - 23 * 2) / 24);
  let cell = Math.max(24, Math.min(28, Math.floor((avail - 150 - 46) / 24), byW));
  const apply = (c: number) => {
    const tpl = 'repeat(24, ' + c + 'px)';
    if (grid.style.gridTemplateColumns !== tpl) {
      grid.style.gridTemplateColumns = tpl;
      grid.style.gridAutoRows = c + 'px';
      grid.style.minWidth = '0';
    }
  };
  apply(cell);
  // 兜底微调：把 #view 的上下内边距也算进去（每轮重新量，别用旧坐标），缩到 24px 就停手
  const padB = parseFloat(getComputedStyle(view).paddingBottom) || 0;
  for (let i = 0; i < 2; i++) {
    const cb = card.getBoundingClientRect();
    const vb = view.getBoundingClientRect();
    const totalH = (cb.top - vb.top) + view.scrollTop + card.offsetHeight + padB + 2;
    const over = totalH - view.clientHeight;
    if (over <= 0 || cell <= 24) break;
    cell = Math.max(24, cell - Math.ceil(over / 24));
    apply(cell);
  }
}

/** M21.1：大区图（12×12）也要"一屏装下"。用户报障：详情里的路程报价与「出发」被挤在屏幕外。
    详情已经并到地图右侧，所以高度预算里只剩标题/图例；格子 30~60px（再小就看不清地名与危险数字）。 */
function fitRegion(view: HTMLElement, card: HTMLElement, rgrid: HTMLElement) {
  const col = rgrid.parentElement as HTMLElement | null;
  const box = card.getBoundingClientRect();
  const vbox = view.getBoundingClientRect();
  const availH = vbox.bottom - box.top - 8;
  if (availH < 280) return;
  const chrome = card.offsetHeight - rgrid.offsetHeight;                 // 标题行/图层开关/图例/提示/内边距
  /* M21.1：卡片不够宽就"详情在上、地图在下"（<880px 时并排放不下两张东西），
     这样点完格子立刻看到路程报价与「出发」，不用先滚过整张地图。 */
  const main = card.querySelector('.rmain') as HTMLElement | null;
  if (main) main.classList.toggle('stack', card.clientWidth < 880);
  const byH = Math.floor((availH - chrome - 33) / 12);
  const byW = Math.floor(((col ? col.clientWidth : box.width) - 33) / 12);
  // 下限 24px：和本地地图的点击命中区一致（R4）；≤34px 时地名放不下，只留危险数字（.tiny）
  let cell = Math.max(24, Math.min(60, byH, byW));
  const apply = (c: number) => {
    const tpl = 'repeat(12, ' + c + 'px)';
    if (rgrid.style.gridTemplateColumns !== tpl) {
      rgrid.style.gridTemplateColumns = tpl;
      rgrid.style.justifyContent = 'start';
      rgrid.style.maxWidth = 'none';
    }
    // 名字放不下就只留危险数字（跟窄屏规则一致），免得撑出去
    rgrid.classList.toggle('tiny', c < 28);
  };
  apply(cell);
  const padB = parseFloat(getComputedStyle(view).paddingBottom) || 0;
  for (let i = 0; i < 2; i++) {
    const cb = card.getBoundingClientRect();
    const vb = view.getBoundingClientRect();
    const totalH = (cb.top - vb.top) + view.scrollTop + card.offsetHeight + padB + 2;
    const over = totalH - view.clientHeight;
    if (over <= 0 || cell <= 24) break;
    cell = Math.max(24, cell - Math.ceil(over / 12));
    apply(cell);
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

  /** 悬停/长按详情（R6：可读文本，不依赖 emoji 含义） */
  hover(x: number, y: number) {
    const s = sw(), w = worldOf(s.seed, s.region);
    const b = blockAt(w, x, y);
    const box = document.getElementById('v4-hover');
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
