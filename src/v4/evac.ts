/* C07：第 90 天开启的撤离窗口——把"活到第 100 天"从挂机变成一趟必须走完的远门。
   纯规则（坐标/窗口/血月顺延）在 evac-gate.ts；这里只做落盘与 legacy 结局的对接。 */
import { ensureSaveWorld, worldOf } from './worldstate';
import { EVAC_DAY, evacAvailable, evacGate, evacOpenDay, evacSite, type EvacSite } from './evac-gate';
import { L } from '../main';

export { EVAC_DAY, evacAvailable, evacGate, evacOpenDay, evacSite };
export type { EvacSite };

/** 读取/初始化存档里的撤离点（首次进入窗口时落盘） */
export function ensureEvac(): { site: EvacSite; open: boolean } {
  const S = L.S, s = ensureSaveWorld(S), w = worldOf(s.seed, s.region);
  const site = evacSite(w);
  const day = evacOpenDay(site.openDay);
  if (!s.evac && S.day >= EVAC_DAY) {
    s.evac = { x: site.x, y: site.y, day };
    L.hr();
    L.log('📻 无线电里突然插进一段循环播放的明码：「第 ' + day + ' 天，城北撤离。带信号枪。」' +
      '——坐标 (' + site.x + ',' + site.y + ')，地图上已经标出来了。', 'success');
    L.log('　 撤离窗口从第 ' + day + ' 天开始；血月当天不发信号（顺延）。', 'dim');
    L.toast('📡 撤离坐标', '地图远端已标出撤离点，带信号枪过去', 'ok');
  }
  // 血月顺延：窗口开启当天是血月就推迟一天
  if (s.evac && S.day % 7 === 0) { /* 今天不发信号，UI 会写明"血月顺延" */ }
  return { site: s.evac ? { ...site, x: s.evac.x, y: s.evac.y, openDay: s.evac.day } : { ...site, openDay: day }, open: !!s.evac };
}

/** 站在撤离点上，且带信号枪，且不在血月 → 打出信号 = 救援结局（复用 legacy 的 rescueEnding） */
export function fireFlare(): boolean {
  const S = L.S, s = ensureSaveWorld(S);
  const { site } = ensureEvac();
  if (!s.evac) { L.toast('还没收到坐标', '第 ' + EVAC_DAY + ' 天无线电会给出撤离点。', 'bad'); return false; }
  if (s.cur.x !== site.x || s.cur.y !== site.y) { L.toast('不在这儿', '撤离点在 (' + site.x + ',' + site.y + ')。', 'bad'); return false; }
  if (S.day % 7 === 0) { L.toast('血月不发信号', '今晚天上不对，等明天（撤离窗口顺延）。', 'bad'); return false; }
  if (L.itemCount('flare') < 1 && S.eq.wpn !== 'flare') { L.toast('没有信号枪', '军事哨所/地下掩体/隧道里能搜到信号枪。', 'bad'); return false; }
  L.takeItem('flare', 1);
  L.hr();
  L.log('🔴 你扣下扳机。一发红色的信号弹钻进云里，整座废墟都被照亮了三秒。', 'narrative');
  L.log('　 远处传来引擎声——有人真的来了。', 'success');
  L.sfx('ok');
  L.autosave();
  L.rescueEnding();
  return true;
}

/** 地图/面板用：撤离点是否要标出来 */
export function evacMarker(): { x: number; y: number } | null {
  const s = ensureSaveWorld(L.S);
  return s.evac ? { x: s.evac.x, y: s.evac.y } : null;
}
