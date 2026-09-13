/* 门禁卡碎片：钉在世界里三个远点的硬目标，抵达或搜刮到就拿走一块（凑 3 块推进主线阶段 2→3）。
   独立成模块是为了让 search.ts 和 world-ui.ts 都能用，而不互相 import（避免循环依赖）。 */
import { L } from '../main';
import { worldOf } from './worldstate';
import { fragSpots } from './quest4';
import { ensureSaveWorld } from './worldstate';
import { POIS } from './pois';
import type { Block } from '../types';

/** 已经拿走的碎片坐标集合（存档里） */
export function fragTaken(): Record<string, 1> {
  const s = ensureSaveWorld(L.S);
  s.frag = s.frag && typeof s.frag === 'object' ? s.frag : {};
  return s.frag;
}

/** 还没拿走的碎片格子 key 集合（地图上要标 📡） */
export function pendingFragKeys(): Record<string, 1> {
  const s = ensureSaveWorld(L.S);
  const w = worldOf(s.seed, s.region);
  const taken = fragTaken();
  const out: Record<string, 1> = {};
  for (const f of fragSpots(w)) if (!taken[f.key]) out[f.key] = 1;
  return out;
}

/** 站在碎片点上就拿走一块；返回是否真的拿到了 */
export function takeFragment(block: Block): boolean {
  const s = ensureSaveWorld(L.S);
  const w = worldOf(s.seed, s.region);
  const key = block.x + ',' + block.y;
  const f = fragSpots(w).find(x => x.key === key);
  if (!f) return false;
  const taken = fragTaken();
  if (taken[key]) return false;
  taken[key] = 1;
  const S = L.S;
  const got = Math.min(3, (S.quest.keycards || 0) + 1);
  S.quest.keycards = got;
  const poi = block.poi ? POIS[block.poi] : null;
  L.hr();
  L.log('🔑 你在' + (poi ? poi.name : '这一带') + '的地下室里翻出一块门禁卡碎片（' + got + '/3）。' +
    (got >= 3 ? '三块凑齐了——方舟实验室的门能开了。' : '还得再找 ' + (3 - got) + ' 块。'), got >= 3 ? 'success' : 'loot');
  L.log('　 碎片被藏在' + f.poi + '类的据点里：越远的地方，越可能有人替你留着。', 'dim');
  L.sfx('ok');
  try { L.checkQuest(); } catch (e) { console.warn('[v4] checkQuest 失败', e); }
  return true;
}
