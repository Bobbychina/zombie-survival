/* C07 撤离点的纯逻辑：坐标由 seed 决定、窗口开启日与血月顺延规则。
   （血月顺延口径由会议定死，避免终局被随机血月撕掉。） */
import seedrandom from 'seedrandom';
import type { Block, WorldState } from '../types';

export const EVAC_DAY = 90;
const HOSTS = ['radio', 'military', 'bunker'];

export interface EvacSite { x: number; y: number; poi: string; openDay: number }

export function evacSite(w: WorldState): EvacSite {
  const rng = seedrandom(w.seed + ':evac');
  const cands: Block[] = [];
  for (const k in w.blocks) {
    const b = w.blocks[k];
    if (!b.poi || b.poi === 'lab') continue;
    const d = Math.max(Math.abs(b.x - w.home.x), Math.abs(b.y - w.home.y));
    if (d < 8) continue;                      // 撤离点必须是一趟远门
    cands.push(b);
  }
  cands.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const hard = cands.filter(b => HOSTS.includes(b.poi!));
  const pool = hard.length ? hard : cands;
  const b = pool[Math.floor(rng() * pool.length)] ?? { x: w.home.x, y: w.home.y, poi: 'radio' };
  return { x: b.x, y: b.y, poi: b.poi ?? 'radio', openDay: EVAC_DAY };
}

/** 窗口开启日：撞血月就顺延一天 */
export const evacOpenDay = (baseDay: number) => (baseDay % 7 === 0 ? baseDay + 1 : baseDay);

/** 今天能不能发信号（血月当天不发） */
export const evacAvailable = (day: number) => day >= EVAC_DAY && day % 7 !== 0;

/** 给 UI 的一句话说明 */
export function evacGate(day: number): string {
  if (day < EVAC_DAY) return '撤离窗口还没开——第 ' + EVAC_DAY + ' 天无线电才会给出坐标。';
  if (day % 7 === 0) return '今天血月：撤离窗口顺延，明天再发信号。';
  return '撤离窗口已开：带上信号枪走到撤离点。';
}
