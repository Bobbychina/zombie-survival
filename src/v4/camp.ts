/* 幸存者玩法：营地交易 / 情报 / 招募，拾荒者据点的买路钱或火并。
   副作用统一走 legacy 的 log/grant/takeItem/sfx，数值沿用价格表（npc.ts 里是纯函数，可单测）。 */
import { L } from '../main';
import { POIS } from './pois';
import { blockAt } from './worldgen';
import { worldOf } from './worldstate';
import { ensureSaveWorld, type SaveWorld } from './worldstate';
import { campRoster, campStock, sellPrice, INTEL_PRICE, type NpcDef } from './npc';
import { fragSpots } from './quest4';
import type { Block } from '../types';

const sw = () => ensureSaveWorld(L.S);
const curBlock = (): Block | null => { const s = sw(); return blockAt(worldOf(s.seed, s.region), s.cur.x, s.cur.y); };

export interface CampView { block: Block; npcs: NpcDef[]; stock: ReturnType<typeof campStock>; hostile: boolean }

export function campView(): CampView | null {
  const b = curBlock();
  if (!b || !b.poi) return null;
  const poi = POIS[b.poi];
  if (poi.feat !== 'npc') return null;
  const s = sw();
  const npcs = campRoster(s.seed, b);
  return { block: b, npcs, stock: campStock(s.seed, b, npcs, L.S.day), hostile: b.poi === 'outpost' };
}

/** 买卖/情报之后刷新弹窗：legacy 的 modal 是叠加的，必须先关掉旧的再开 */
function refresh() { L.closeAllModals(); L.render(); openCamp(); }

/** 买东西：材料 → 物品，扣当日库存 */
function buy(i: number) {
  const s = sw(), view = campView();
  if (!view) return;
  const row = view.stock[i];
  if (!row) return;
  const S = L.S;
  const k = view.block.poi! + i;
  const left = s.stock?.[k] ?? row.stock;
  if (left <= 0) { L.toast('卖完了', '这一样今天没有了。', 'bad'); return; }
  if (S.mat < row.cost) { L.toast('材料不够', '要 ' + row.cost + ' 材料，你有 ' + S.mat + '。', 'bad'); return; }
  S.mat -= row.cost;
  L.grant(row.id, row.n);
  s.stock = s.stock || {};
  s.stock[k] = left - 1;
  L.log('🧰 你花 ' + row.cost + ' 材料换了 ' + L.itemName(row.id) + ' ×' + row.n + '。', 'loot');
  L.sfx('loot'); L.autosave(); refresh();
}

/** 卖东西：按买价 45% 折成材料 */
function sell(itemId: string) {
  const view = campView();
  if (!view) return;
  const equipped = new Set(Object.values(L.S.eq || {}).filter(Boolean) as string[]);
  if (equipped.has(itemId)) { L.toast('这件不能卖', '正拿在手里/穿在身上呢。', 'bad'); return; }
  const base = view.stock.find(r => r.id === itemId)?.cost ?? 20;
  if (L.itemCount(itemId) <= 0) { L.toast('没有这件东西', L.itemName(itemId) + ' 不在背包里。', 'bad'); return; }
  L.takeItem(itemId, 1);
  const gain = sellPrice(base);
  L.S.mat += gain;
  L.log('💰 你卖掉 ' + L.itemName(itemId) + '，换回 ' + gain + ' 材料。', 'loot');
  L.sfx('ui'); L.autosave(); refresh();
}

/** 情报：花材料买地图（点亮远处一片 + 标出碎片点） */
function intel() {
  const S = L.S, s = sw(), w = worldOf(s.seed, s.region);
  if (S.mat < INTEL_PRICE) { L.toast('材料不够', '情报要 ' + INTEL_PRICE + ' 材料。', 'bad'); return; }
  const spots = fragSpots(w);
  S.mat -= INTEL_PRICE;
  s.intel = true;         // 派生状态：迷雾每次都由 visited 重放，所以点亮必须是"每次重算"而不是一次性
  let opened = 0;
  for (const f of spots) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const b = blockAt(w, f.x + dx, f.y + dy);
      if (b && !b.revealed) { b.revealed = true; opened++; }
    }
  }
  // 顺带把实验室那一格也点出来（和无线电一个效果：知道往哪儿走，但去不去得成还得看行动力）
  const lb = blockAt(w, w.lab.x, w.lab.y);
  if (lb && !lb.revealed) { lb.revealed = true; opened++; }
  L.log('🗺️ 营地的人给你标了地图：' + spots.map(f => '(' + f.x + ',' + f.y + ')').join('、') +
    ' 可能藏着门禁卡碎片，实验室方向也一并点了（新点亮 ' + opened + ' 格）。', 'info');
  L.sfx('ok'); L.autosave(); refresh();
}

/** 招募：把 NPC 变成同伴 —— 直接复用 legacy 的 recruit()，连支线开启也一并继承 */
function recruit(npcId: string) {
  const S = L.S, view = campView();
  if (!view) return;
  const npc = view.npcs.find(n => n.id === npcId);
  if (!npc) return;
  const comp = npcToComp(npc);
  if (!comp) { L.toast('他不走', npc.name + '摇了摇头：「我还有事。」', 'info'); return; }
  if (S.comp) { L.toast('已经有同伴了', '队伍里只能带一个人。', 'bad'); return; }
  if (S.mat < npc.hire) { L.toast('拿不出这个数', npc.name + '要 ' + npc.hire + ' 材料的安家费。', 'bad'); return; }
  S.mat -= npc.hire;
  L.log('🤝 ' + npc.name + ' 收下了 ' + npc.hire + ' 材料，开始收拾东西。', 'info');
  L.recruit(comp);                     // legacy：写入队伍、开启该同伴的支线、重绘界面
  L.autosave();
}

/** 营地角色 → legacy 同伴 id（trader/bandit 不跟你走） */
function npcToComp(npc: NpcDef): string | null {
  switch (npc.role) {
    case 'medic': return 'nurse';
    case 'scout': return 'hunter';
    case 'mechanic': return 'hunter';
    case 'refugee': return 'hunter';
    default: return null;
  }
}

/** 拾荒者据点：交买路钱 或 火并 */
function bribe() {
  const S = L.S;
  if (S.mat < 15) { L.toast('拿不出', '他们要 15 材料。', 'bad'); return; }
  S.mat -= 15;
  L.log('💸 你交了 15 材料买路钱。他们让开了，但眼神一直跟着你。', 'dim');
  L.closeAllModals(); L.autosave(); L.render();
}
function fightCamp() {
  L.closeAllModals();
  L.log('🔪 你决定不交钱——据点里的人抄起了家伙。', 'danger');
  L.startCombat(['bandit', 'bandit'], { title: '拾荒者据点 · 火并' });
}

/** 把营地/据点弹窗画出来（内联 onclick 只能看到 window 上的名字） */
export function openCamp() {
  const view = campView();
  if (!view) { L.toast('这里没有人', '营地或拾荒者据点才有幸存者。', 'dim'); return; }
  const s = sw();
  const S = L.S;
  const b = view.block;
  const poiDef = POIS[b.poi!];
  const stock = view.stock;
  let body = '<p class="muted">' + poiDef.icon + ' ' + poiDef.desc + '</p>' +
    '<div class="row" style="margin-bottom:8px">' +
      '<span class="chip">🧑\u200d🤝\u200d🧑 ' + view.npcs.length + ' 人</span>' +
      '<span class="chip gold">🔩 材料 <b>' + S.mat + '</b></span>' +
      '<span class="chip">📅 第 ' + S.day + ' 天</span>' +
      (S.comp ? '<span class="chip med">🤝 ' + L.COMPANIONS[S.comp].n + '</span>' : '') +
    '</div>';

  body += '<div class="sect-title">在场的人</div>';
  for (const n of view.npcs) {
    const canHire = ['medic', 'scout', 'mechanic', 'refugee'].includes(n.role);
    body += '<div class="lrow"><span class="nm">' + n.name + '</span><span class="ds">' + n.desc + '</span>' +
      '<span class="rt">' + (canHire
        ? '<button class="btn sm ok" onclick="V4Camp.recruit(\'' + n.id + '\')" ' + (S.comp ? 'disabled' : '') + '>招募 ' + n.hire + ' 材料</button>'
        : '<span class="tag">不跟你走</span>') + '</span></div>';
  }

  if (view.hostile) {
    body += '<div class="sect-title">他们的条件</div>' +
      '<p class="muted">把东西留下三成，人就可以走。不想留，也可以试试。</p>' +
      '<div class="row"><button class="btn ok" onclick="V4Camp.bribe()">💸 交 15 材料买路</button>' +
      '<button class="btn danger" onclick="V4Camp.fight()">🔪 火并</button></div>';
    L.modal({ title: '🏴 ' + poiDef.name, body, footer: '<button class="btn" data-close>退出</button>' });
    return;
  }

  body += '<div class="sect-title">交换 <span class="badge">营地定价</span></div>';
  stock.forEach((r, i) => {
    const left = (s.stock?.[b.poi! + i] ?? r.stock);
    body += '<div class="lrow"><span class="nm">' + L.itemName(r.id) + ' ×' + r.n + '</span>' +
      '<span class="ds">' + (L.ITEMS[r.id]?.desc || '') + '</span>' +
      '<span class="rt"><span class="tag ' + (left > 0 ? '' : 'warn') + '">剩 ' + Math.max(0, left) + '</span>' +
      '<button class="btn sm' + (left > 0 && S.mat >= r.cost ? ' primary' : '') + '" onclick="V4Camp.buy(' + i + ')" ' + (left > 0 ? '' : 'disabled') + '>' + r.cost + ' 材料</button></span></div>';
  });
  body += '<div class="sect-title">你背包里能卖的</div><div class="row">';
  // 身上穿着的、手里拿的不能卖：卖掉武器再打起来会很难看
  const equipped = new Set(Object.values(S.eq || {}).filter(Boolean) as string[]);
  const sellable = Object.keys(S.inv).filter(id => L.ITEMS[id] && !equipped.has(id));
  if (!sellable.length) body += '<span class="hint">背包里没有能出手的东西。</span>';
  for (const id of sellable.slice(0, 12)) {
    const base = stock.find(r => r.id === id)?.cost ?? 20;
    body += '<button class="btn sm" onclick="V4Camp.sell(\'' + id + '\')">卖 ' + L.itemName(id) + ' ×' + L.itemCount(id) + '（+' + sellPrice(base) + '）</button>';
  }
  body += '</div>';

  body += '<div class="sect-title">情报</div>' +
    '<p class="muted">他们知道哪儿有门禁卡碎片——要 ' + INTEL_PRICE + ' 材料，换一张标好的地图。</p>' +
    '<div class="row"><button class="btn warn" onclick="V4Camp.intel()">🗺️ 买情报（' + INTEL_PRICE + ' 材料）</button>' +
    '<span class="hint">会点亮碎片点与实验室方向，但路还是要自己走。</span></div>';

  L.modal({ title: '⛺ ' + poiDef.name + ' · ' + b.name, body, footer: '<button class="btn" data-close>离开营地</button>' });
}

export const V4Camp = { open: openCamp, buy, sell, intel, recruit, bribe, fight: fightCamp };
