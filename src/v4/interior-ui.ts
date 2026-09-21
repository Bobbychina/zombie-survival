/* M66 建筑内部界面：把"进楼"做成一张 3~6 间的小平面图（每间一间房一个按钮）。
   玩法账（重要）：
   - 每间房搜一次 = 1 行动力，**照旧记进 legacy 的任务账**（`tallySearch` + checkQuest/bountyTick/sideTick）。
     M35 的教训：账必须记在"你来过、你翻了"上，否则"去药房翻一趟"这类委托会被新玩法饿死。
   - 房间进度写进存档（`sw.interiors[区块]`），所以关掉弹窗、出去打一架、甚至换一天再来，都能接着搜。
   - 一旦触发埋伏就**先关掉平面图**再开战：v4 战斗覆盖层与这块卡片两层叠在一起（M64 修过一次同类问题）。 */
import { L } from '../main';
import { POIS } from './pois';
import { bkey, blockAt } from './worldgen';
import { ensureSaveWorld, worldOf, zoneOfPoi } from './worldstate';
import { foesFor, tallySearch } from './search-core';
import { poiLeft } from './search';
import {
  ROOM_KEY, ambushChance, buildInterior, interiorHost, isUnlocked, kindLabel, landForce, lockLabel,
  openDecision, roomState, roomStatus, rollRoomLoot, summary,
  type InteriorPlan, type InteriorState, type RoomDef,
} from './interior-core';

const OV = 'v4i-overlay';
let cur: { plan: InteriorPlan; st: InteriorState; key: string; poiId: string; danger: number; s: any; b: any } | null = null;

function esc(s: unknown) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c)); }

/** 当前格子 + 存档 + 这栋楼的平面图（进不去就返回 null，并说明原因） */
function ctx() {
  const s = ensureSaveWorld(L.S);
  const w = worldOf(s.seed, s.region);
  const b = blockAt(w, s.cur.x, s.cur.y);
  if (!b || !b.poi) return null;
  const poi = POIS[b.poi];
  if (!poi || !interiorHost(b.poi)) return null;
  const key = bkey(b.x, b.y);
  const st: InteriorState = (s.interiors[key] = s.interiors[key] || { rooms: {} });
  const plan = buildInterior(poi, s.seed + '|' + s.region + '|' + key);
  if (!plan) return null;
  return { s, b, poi, key, st, plan, danger: (b.danger || 0) + (poi.danger || 0) };
}

function tickQuests() {
  try { L.checkQuest(); L.bountyTick(); L.sideTick(); } catch (e) { console.warn('[v4] 收尾 tick 失败', e); }
}

function roomCard(room: RoomDef): string {
  if (!cur) return '';
  const { st } = cur;
  const status = roomStatus(room, st);
  const chip = status === 'looted' ? '<span class="tag eq">✅ 已搜空</span>'
    : status === 'locked' ? '<span class="tag short">🔒 ' + lockLabel(room.lock) + '</span>'
      : '<span class="tag gate">🚪 可以进</span>';
  const have = { crowbar: L.itemCount('crowbar') > 0, key: L.itemCount(ROOM_KEY) > 0, mat: L.S.mat };
  const dec = openDecision(room, have);
  let btns = '';
  if (status === 'looted') {
    btns = '<span class="hint">这间已经翻干净了。</span>';
  } else if (status === 'locked') {
    const main = dec.how === 'crowbar' || dec.how === 'key'
      ? '<button class="btn primary" onclick="V4Interior.act(\'' + room.id + '\')">' +
        (dec.how === 'key' ? '🔑 用钥匙开' : '🪓 撬开') + ' <span class="mono">(1 行动力)</span></button>'
      : '<button class="btn warn" onclick="V4Interior.act(\'' + room.id + '\')">🦶 硬踹 <span class="mono">(1 行动力 · 一定招来东西)</span></button>';
    btns = '<div class="row">' + main +
      (dec.how === 'force' ? '' : '<button class="btn sm ghost" onclick="V4Interior.force(\'' + room.id + '\')">🦶 直接踹</button>') +
      '</div><div class="hint">' + esc(dec.why) + '</div>';
  } else {
    btns = '<button class="btn primary" onclick="V4Interior.act(\'' + room.id + '\')">🔍 搜刮 <span class="mono">(1 行动力)</span></button>';
  }
  return '<div class="card" style="padding:10px">' +
    '<div class="row" style="justify-content:space-between"><b>' + room.icon + ' ' + esc(room.name) + '</b>' + chip + '</div>' +
    '<div class="hint">' + kindLabel(room.kind) + (room.lock ? ' · ' + lockLabel(room.lock) : '') + '</div>' +
    btns + '</div>';
}

function render() {
  const root = document.getElementById(OV);
  if (!root || !cur) return;
  const { plan, st } = cur;
  const sum = summary(plan, st);
  const left = poiLeft(cur.b, cur.s);
  root.innerHTML = '<div class="modal">' +
    '<div class="strip"></div>' +
    '<div class="modal-hd"><h2>' + plan.icon + ' ' + esc(plan.name) + ' · 里面</h2>' +
      '<button class="icobtn" onclick="V4Interior.leave()">✕</button></div>' +
    '<div class="modal-bd">' +
      '<div class="hint">已搜 <b>' + sum.done + '/' + sum.total + '</b> 间' +
        (sum.lockedLeft + sum.sealedLeft ? ' · 还锁着 <b>' + (sum.lockedLeft + sum.sealedLeft) + '</b> 间' : '') +
        ' · 这地方还能搜 ' + left + ' 次（每间 1 行动力，剩 ' + L.S.ap + '）</div>' +
      '<div class="hint" style="margin:4px 0 10px">锁着的房间里才是好东西：常见货在明面上，稀有的都锁起来了。' +
        '没钥匙就翻别的房间（有几率翻出楼门钥匙），或者用撬棍 / 硬踹。</div>' +
      '<div class="grid" style="gap:8px">' + plan.rooms.map(roomCard).join('') + '</div>' +
    '</div>' +
    '<div class="modal-ft"><div class="row">' +
      '<button class="btn ok" onclick="V4Interior.leave()">🏃 出去（进度留着）</button>' +
      '<span class="hint">走出去再回来，剩下的房间还在这儿。</span>' +
    '</div></div>' +
  '</div>';
  root.querySelectorAll('.btn').forEach(b => { (b as HTMLElement).style.minWidth = '44px'; });
}

function close() {
  const el = document.getElementById(OV);
  cur = null;
  if (el) el.remove();
}

export const V4Interior = {
  /** 进楼：只有 INTERIOR_HOSTS 里那批建筑有平面图 */
  open() {
    const c = ctx();
    if (!c) { L.toast('这里没有里屋', '这地方是露天的，直接在门口翻就行。', 'info'); return null; }
    close();                                    // 幂等：重复点不会叠出两个覆盖层
    cur = { plan: c.plan, st: c.st, key: c.key, poiId: c.poi.id, danger: c.danger, s: c.s, b: c.b };
    if (!c.st.seen) {                           // 第一次进来：给一句叙事（"几间锁着"是这栋楼的关键信息）
      c.st.seen = 1;
      const first = c.plan.rooms.filter(r => r.lock).length;
      L.log('🚪 你推开' + c.poi.icon + c.poi.name + '的侧门：里面 ' + c.plan.rooms.length + ' 间房' +
        (first ? '，其中 ' + first + ' 间锁着。' : '，门都开着。'), 'narrative');
    }
    const root = document.createElement('div');
    root.className = 'overlay';
    root.id = OV;
    document.getElementById('overlay-root')!.appendChild(root);
    L.sfx('ok');
    render();
    return c.plan;
  },

  /** 主要动作：锁着就开门，开着就搜刮 */
  act(roomId: string) {
    if (!cur) return false;
    const room = cur.plan.rooms.find(r => r.id === roomId);
    if (!room) return false;
    const status = roomStatus(room, cur.st);
    if (status === 'looted') { L.toast('已经翻过了', '这间房是空的。', 'info'); return false; }
    if (status === 'locked') return V4Interior.open2(room, false);
    return V4Interior.loot(room);
  },

  /** 跳过撬锁直接硬踹（玩家可以选：不想惊动东西就别用这个） */
  force(roomId: string) {
    if (!cur) return false;
    const room = cur.plan.rooms.find(r => r.id === roomId);
    if (!room) return false;
    if (roomStatus(room, cur.st) !== 'locked') return V4Interior.act(roomId);
    return V4Interior.open2(room, true);
  },

  /** 开门：花 1 行动力；能安静开就安静开，否则硬踹（掉血 + 一定遭遇） */
  open2(room: RoomDef, forceIt: boolean) {
    const c = cur;
    if (!c) return false;
    const have = { crowbar: L.itemCount('crowbar') > 0, key: L.itemCount(ROOM_KEY) > 0, mat: L.S.mat };
    let dec = openDecision(room, have);
    if (forceIt && dec.how !== 'force') dec = { how: 'force', ok: true, quiet: false, cost: { hp: room.lock === 'sealed' ? [6, 14] : [3, 8] }, why: '你选择直接把门踹开' };
    if (!L.spendAP(1)) { L.toast('行动力不够', '今天没力气撬门了，先休息。', 'bad'); return false; }
    if (dec.cost?.mat) { L.S.mat -= dec.cost.mat; }
    if (dec.how === 'force') {
      const dmg = landForce(Math.random, room);
      L.S.hp -= dmg;
      L.S.noise = (L.S.noise || 0) + 2;
      L.log('🦶 你一脚踹在' + esc(room.name) + '（' + lockLabel(room.lock) + '）的门上：锁舌崩了，' + '你也撞得生疼（-' + dmg + ' 生命）。', 'hurt');
      L.sfx('hurt');
      if (L.S.hp <= 0) { close(); L.gameOver('撬门把自己撬死了。'); return false; }
    } else if (dec.how === 'key') {
      L.log('🔑 楼门钥匙插进' + esc(room.name) + '：一转到底，门开了。', 'success');
      L.sfx('ok');
    } else if (dec.how === 'crowbar') {
      L.log('🪓 ' + esc(dec.why) + '：' + esc(room.name) + '开了。' + (dec.cost?.mat ? '（-2 材料）' : ''), 'success');
      L.sfx('ok');
    }
    roomState(c.st, room.id).opened = 1;
    // 硬踹/破门一定招来东西 —— 这就是"安静撬开"的价值
    if (Math.random() < ambushChance(room, c.danger, dec.how === 'force')) return ambush(room);
    L.autosave(); L.render(); render();
    return true;
  },

  /** 搜这一间（1 行动力，账照旧记给任务系统） */
  loot(room: RoomDef) {
    const c = cur;
    if (!c) return false;
    const { s, b } = c;
    if (!L.spendAP(1)) { L.toast('行动力不够', '今天翻不动了，先休息。', 'bad'); return false; }
    const zone = zoneOfPoi(b.poi);
    tallySearch(L.S.stats, (s.regionZones = s.regionZones || {}), s.region, b.poi!, zone, false);
    const left = poiLeft(b, s);
    s.left[c.key] = Math.max(0, left - 1);
    roomState(c.st, room.id).looted = 1;
    L.tickVitals(1);
    L.addXP('survival', 2);
    if (L.S.hp <= 0) { close(); L.gameOver('你的身体先一步投降了。'); return false; }
    if (left <= 0) {                                     // 这地方被搜空了：只剩刮材料（与门口快搜同口径）
      const d = Math.max(1, Math.round(L.ri(1, 2) + c.danger * 0.6));
      L.S.mat += d;
      L.log('🧹 ' + room.icon + esc(room.name) + '也早被翻空了，你只刮出 ' + d + ' 份材料。', 'loot');
      tickQuests(); L.autosave(); L.render(); render();
      return true;
    }
    const needKey = c.plan.rooms.some(r => r.lock === 'sealed' && !isUnlocked(c.st, r.id)) && L.itemCount(ROOM_KEY) <= 0;
    const got = rollRoomLoot(Math.random, room,
      { needKey, valid: (id) => id === ROOM_KEY || id === 'ammo' || !!L.ITEMS[id] });
    L.hr();
    L.log('🔍 你搜' + room.icon + esc(room.name) + '（' + c.plan.icon + esc(c.plan.name) + '）……', 'narrative');
    if (!got.length) {
      L.log('…什么都没有。只有灰尘和更深的安静。', 'dim');
    }
    for (const id of got) {
      if (id === ROOM_KEY) {
        L.grant(ROOM_KEY, 1); L.sfx('ok');
        L.log('🔑 你在抽屉最里面翻到一把楼门钥匙——加固门能开了。', 'success');
        continue;
      }
      const n = id === 'ammo' ? L.ri(4, 10) : (Math.random() < 0.25 ? 2 : 1);
      L.grant(id, n);
      L.sfx('loot');
      L.log('📦 ' + L.itemName(id) + ' ×' + n, 'loot');
    }
    if (Math.random() < ambushChance(room, c.danger, false)) return ambush(room);
    tickQuests();
    L.autosave(); L.render(); render();
    return true;
  },

  leave() { close(); L.render(); },
  isOpen: () => !!cur,
  /** 探针用：不点 DOM 也能核对"这一栋楼长什么样、进度到哪" */
  debug() {
    const c = cur;
    if (!c) return null;
    return {
      poiId: c.poiId, key: c.key,
      rooms: c.plan.rooms.map(r => ({ id: r.id, name: r.name, kind: r.kind, lock: r.lock || null, status: roomStatus(r, c.st) })),
      summary: summary(c.plan, c.st),
      left: poiLeft(c.b, c.s),
    };
  },
};

/** 埋伏：先关掉平面图（避免两层覆盖层叠着），再交给 v4 战斗 */
function ambush(room: RoomDef): boolean {
  if (!cur) return false;
  const { poiId, danger, plan } = cur;
  const foes = foesFor(Math.random, poiId, danger, !!room.lock);
  close();
  L.log('☠️ ' + room.icon + esc(room.name) + '里有东西在等着你！', 'danger');
  L.sfx('bad');
  L.startCombat(foes, { title: plan.icon + ' ' + plan.name + ' · ' + room.name });
  L.autosave(); L.render();
  return true;
}
