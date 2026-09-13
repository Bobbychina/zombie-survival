/* 区域事件的接线层：把纯逻辑的事件结算成游戏状态（血/行动力/材料/物品）+ 日志。
   M18：进区域（跨区落地）时掷一次；在区域里过夜/换日时再掷一次（同一区域待久了也会出事）。 */
import { L } from '../main';
import { ensureSaveWorld } from './worldstate';
import { rollRegionEvent, type RegionEvent } from './region-events-core';
import { regionById, type RegionDef } from './regions-core';

let last: { id: string; title: string; kind: string; day: number; region: string } | null = null;
/** 探针/UI 用：最近一次区域事件 */
export const lastRegionEvent = () => last;

/** 结算一个事件（不掉到负数；材料不为负；物品走 L.grant 的统一入口） */
export function applyRegionEvent(ev: RegionEvent, regionId: string): void {
  const S = L.S as any;
  const sw = ensureSaveWorld(S);
  const where = regionById(regionId)?.name ?? regionId;
  if (ev.hp) { S.hp = Math.max(1, S.hp + ev.hp); }          // 事件不会直接致死：最多打到 1 血，剩下的交给玩家
  if (ev.ap) S.ap = Math.max(0, S.ap + ev.ap);
  if (ev.mat) S.mat = Math.max(0, S.mat + ev.mat);
  if (ev.item && ev.n) L.grant(ev.item, ev.n);
  const tone = ev.kind === 'hazard' ? 'danger' : ev.kind === 'loot' ? 'loot' : 'info';
  L.log('📌 ' + where + ' · ' + ev.title + '：' + ev.text +
    (ev.hp ? '（生命 ' + ev.hp + '）' : '') + (ev.mat ? '（材料 ' + (ev.mat > 0 ? '+' : '') + ev.mat + '）' : '') +
    (ev.item && ev.n ? '（' + L.itemName(ev.item) + ' ×' + ev.n + '）' : '') +
    (ev.ap ? '（行动力 ' + (ev.ap > 0 ? '+' : '') + ev.ap + '）' : ''), tone as any);
  if (ev.kind === 'hazard') L.sfx('hurt'); else L.sfx('loot');
  try { sw.trail.push('📌 ' + ev.title + '（' + where + '）'); if (sw.trail.length > 24) sw.trail.shift(); } catch { /* 老档没有 trail 就算了 */ }
  last = { id: ev.id, title: ev.title, kind: ev.kind, day: S.day, region: regionId };
}

/** 跨区落地：掷一次事件（安全区不会受伤） */
export function onEnterRegion(def: RegionDef | null | undefined): RegionEvent | null {
  if (!def) return null;
  /* 家里（主城）不掷事件：安全屋是唯一"绝对安全"的地方 */
  if (def.homeBase) return null;
  const ev = rollRegionEvent(def.type, def.tier, Math.random);
  if (ev) {
    applyRegionEvent(ev, def.id);
    L.autosave();
  }
  return ev;
}

/** 换日时还在外面：再掷一次（在危险区过夜本来就该有代价） */
export function onDayInRegion(): RegionEvent | null {
  const S = L.S as any;
  const sw = ensureSaveWorld(S);
  const def = regionById(sw.region);
  if (!def || def.homeBase) return null;
  const ev = rollRegionEvent(def.type, def.tier, Math.random);
  if (ev) { applyRegionEvent(ev, def.id); L.autosave(); }
  return ev;
}
