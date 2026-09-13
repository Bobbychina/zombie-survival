/* POI 搜刮：把 legacy 那套「搜索 1 点 / 深搜 2 点」的账接到大世界的 POI 上。
   与 legacy searchZone 的差别：搜刮对象是 POI（有自己的掉落表与剩余次数），
   但悬赏/支线/经验/饥渴这些账仍然记在 legacy 的区域计数上，主线不会因为换了大世界而卡住。 */
import { L } from '../main';
import { POIS } from './pois';
import { bkey } from './worldgen';
import { zoneOfPoi, type SaveWorld } from './worldstate';
import { foesFor, matYield, pickLoot, rollSearchKind, searchWeights } from './search-core';
import { GEAR_HOSTS, MAT_MUL_DEEP, MAT_MUL_NORMAL, pickGear } from './env-core';
import type { Block } from '../types';

export { rollSearchKind, searchWeights, pickLoot, foesFor, matYield } from './search-core';
export type { SearchKind, SearchWeights } from './search-core';

export function poiLeft(block: Block, sw: SaveWorld): number {
  const poi = block.poi ? POIS[block.poi] : null;
  if (!poi) return 0;
  const k = bkey(block.x, block.y);
  if (sw.left[k] === undefined) sw.left[k] = poi.searches;
  return sw.left[k];
}

function trail(sw: SaveWorld, line: string) {
  sw.trail.push(line);
  if (sw.trail.length > 24) sw.trail.shift();
}

/** 在玩家当前所在的区块搜刮（UI 已经保证人就在这儿） */
export function searchPoi(block: Block, sw: SaveWorld, deep: boolean): boolean {
  const S = L.S;
  const poi = block.poi ? POIS[block.poi] : null;
  if (!poi) { L.log('这里只是一片空地，没什么可搜的。', 'dim'); return false; }
  const left = poiLeft(block, sw);
  const zone = zoneOfPoi(block.poi);
  if (left <= 0) {
    // 搜空的 POI 不再产出好东西，但还能刮出一点材料（不让玩家白跑一趟）
    if (!L.spendAP(1)) return false;
    const d = Math.max(1, Math.round(L.ri(1, 2) + block.danger * 0.6));
    S.mat += d; L.tickVitals(0.5); L.sfx('loot');
    L.log('🧹 ' + poi.icon + poi.name + '已经被翻得底朝天，你只刮出 ' + d + ' 份材料。', 'loot');
    L.render(); L.autosave();
    return true;
  }

  const cost = deep ? 2 : 1;
  if (!L.spendAP(cost)) return false;
  const pk = bkey(block.x, block.y);
  const first = !sw.firstPoi[pk];                  // 第一次踏进这个 POI
  sw.firstPoi[pk] = 1;
  sw.left[pk] = Math.max(0, left - (deep ? 2 : 1));
  S.stats.scav++;
  if (zone) S.stats.zoneCnt[zone] = (S.stats.zoneCnt[zone] || 0) + 1;   // 悬赏/支线按区域计数
  // M13：再按 POI 粒度记一次（药房/警局/家电城…）。legacy 的映射很粗（药房→医院、农场→老城），
  // 委托文案写的是"去药房翻一趟"，判定就得按药房算，否则文案和进度对不上。
  S.stats.zoneCnt[block.poi!] = (S.stats.zoneCnt[block.poi!] || 0) + 1;
  // M14：再按"区域 + POI"记一次，跨区委托靠它判定"在那个区真的翻了几个地方"
  const rz = (sw.regionZones = sw.regionZones || {});
  const bag = (rz[sw.region] = rz[sw.region] || {});
  bag[block.poi!] = (bag[block.poi!] || 0) + 1;
  if (deep) S.stats.deep++;
  L.tickVitals(deep ? 1.5 : 1);
  L.addXP('survival', deep ? 5 : 3);
  if (S.hp <= 0) { L.gameOver('你的身体先一步投降了。'); return true; }
  L.hr();
  L.log((deep ? '🔦 你在' + poi.name + '深处翻找，每一秒都在赌命……' : '🔍 你搜索' + poi.name + '……'), 'narrative');
  if (deep) { S.noise += 1; L.noiseCheck(); }
  trail(sw, (deep ? '🔦 ' : '🔍 ') + poi.name + '（剩 ' + sw.left[pk] + ' 次）');

  // 第一次到访这块地方：点亮 legacy 的区域（悬赏/支线/首次奖励都挂在那上面），只发一次
  if (first && zone && !S.seen[zone]) {
    S.seen[zone] = 1;
    L.log('📍 你第一次摸清这一带：' + poi.name + '的坐标记进了地图。', 'info');
    try { L.applyFirst(zone); } catch (e) { console.warn('[v4] applyFirst 失败', e); }
    try { L.bountyTick(); L.sideTick(); } catch (e) { console.warn('[v4] tick 失败', e); }
  }
  if (poi.firstFind && first) L.log('📖 ' + poi.firstFind, 'lore');

  // M6/P02：danger≥2 的军械类 POI，**首次深搜**必出一件装备（每 POI 一次）——
  // 试玩里 11 天一件装备都没见到，就是因为纯靠 5% 抽卡；保底挂在"深搜"上，代价是 2 AP + 更高遭遇率。
  const gearKey = 'gear:' + pk;
  if (deep && block.danger >= 2 && GEAR_HOSTS.includes(block.poi!) && !sw.firstPoi[gearKey as any]) {
    (sw.firstPoi as any)[gearKey] = 1;
    const gear = pickGear(Math.random, block.danger);
    L.grant(gear, 1);
    L.sfx('ok');
    L.log('🎖️ 军械柜！你在' + poi.name + '深处翻出一件装备：' + L.itemName(gear) +
      '（每个据点第一次深搜都有保底，越危险的地方越好）。', 'success');
    trail(sw, '🎖️ ' + poi.name + '：' + L.itemName(gear));
  }
  // M6/F03：种子来源——农场/超市/学校/营地翻得到
  if (['farm', 'market', 'mall', 'school', 'camp'].includes(block.poi!) && Math.random() < 0.45) {
    const seed = Math.random() < 0.6 ? 'seed_veg' : 'seed_grain';
    L.grant(seed, 1);
    L.log('🌱 你还翻到一包' + L.itemName(seed) + '（菜园里能种）。', 'loot');
  }

  const stealth = L.skillBonus('stealth', 0.04, 0.32);
  const kind = rollSearchKind(Math.random, searchWeights(block.poi!, block.danger, deep, stealth));
  switch (kind) {
    case 'fight': {
      const foes = foesFor(Math.random, block.poi!, block.danger, deep);
      L.log('☠️ 翻动的声音把' + foes.map(id => (L.ZOMBIES?.[id]?.n ?? '丧尸')).join('、') + '引了过来！', 'danger');
      L.sfx('bad');
      L.startCombat(foes, { title: poi.icon + ' ' + poi.name + ' · 遭遇' });
      break;
    }
    case 'item': {
      const id = pickLoot(Math.random, poi.loot, k => k === 'ammo' || !!L.ITEMS[k]);   // ammo 不在 ITEMS 里，是独立计数
      if (!id) { const m = L.ri(3, 7); S.mat += m; L.log('🔩 只翻出一堆废料（+' + m + ' 材料）。', 'loot'); break; }
      const n = id === 'ammo' ? L.ri(6, 14) : (Math.random() < 0.25 ? 2 : 1);
      L.grant(id, n);
      L.sfx('loot');
      trail(sw, '📦 ' + poi.name + '：' + L.itemName(id) + ' ×' + n);
      break;
    }
    case 'mats': {
      // M6/P01：材料产出 ×1.3（普通）/ ×1.5（深搜）——深搜本身多花 1 AP 且更危险，这就是代价
      // M7.1：建材类 POI（家具城/五金建材城/建材市场/物流园…）额外多给 matBonus——用户反馈建材偏少
      const m = matYield(Math.random, block.danger, deep, poi.matBonus ?? 0, MAT_MUL_NORMAL, MAT_MUL_DEEP);
      S.mat += m; L.sfx('loot');
      L.log('🔩 你撬开一堆残骸，回收了 ' + m + ' 份材料。', 'loot');
      break;
    }
    case 'food': {
      const id = poi.feat === 'water' ? 'water' : 'can';
      L.grant(id, 1); L.sfx('loot');
      L.log(poi.feat === 'water' ? '💧 你灌满了一瓶还能喝的水。' : '🍖 你找到了一点能吃的。', 'loot');
      break;
    }
    case 'lore': {
      const l = L.ri(2, 6);
      L.addXP('survival', l);
      L.log('📖 你在' + poi.name + '的角落里翻到几页记录，学到了一些东西（生存经验 +' + l + '）。', 'lore');
      break;
    }
    case 'trap': {
      const d = L.ri(3, 8) + block.danger;
      S.hp -= d;
      L.log('💥 脚下的东西塌了，你被砸中（-' + d + ' 生命）。', 'hurt');
      L.sfx('hurt');
      if (S.hp <= 0) { L.gameOver('一次搜刮要了你的命。'); return true; }
      break;
    }
    default:
      L.log('…什么都没有。只有灰尘和更深的安静。', 'dim');
  }
  try { L.checkQuest(); L.bountyTick(); L.sideTick(); } catch (e) { console.warn('[v4] 收尾 tick 失败', e); }
  L.autosave();
  L.render();
  return true;
}
