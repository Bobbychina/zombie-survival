/* M38：QoL 第一批的纯逻辑（背包筛选/分批丢弃·存入 / 探索补给快捷键 / 战斗"重复上次"）。
   为什么单独一个文件：legacy/game.ts 与 battle-ui.ts 都只允许 import 纯逻辑（见 game.ts 文件头约定），
   而这三件事的判定规则（哪件算哪类、能丢几个、能存几个、快捷键指向哪件、重复时打谁）
   全是"看着简单、改一次错一次"的地方 —— 放这里就能单测。 */

export type BagFilter = 'all' | 'food' | 'drink' | 'med' | 'mat' | 'wpn' | 'gear' | 'thr' | 'key' | 'ammo';

export interface QolItem { n?: string; t?: string; desc?: string; heal?: number; hun?: number; thi?: number; sta?: number }

export const BAG_FILTERS: { id: BagFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'food', label: '🍖 食物' },
  { id: 'drink', label: '💧 饮水' },
  { id: 'med', label: '💊 医疗' },
  { id: 'mat', label: '🔩 材料' },
  { id: 'wpn', label: '🗡️ 武器' },
  { id: 'gear', label: '🧥 装备' },
  { id: 'thr', label: '💣 投掷' },
  { id: 'key', label: '🔑 剧情' },
  { id: 'ammo', label: '🔫 弹药' },
];

/** 过滤条：只保留"当前背包里真的有的类"（空类不占地方，但有物品的类一定在）。
 *  all 永远在第一位；未知类型的物品只在 all 里出现（别把坏档物品藏起来）。 */
export function filterTabs(ids: string[], items: Record<string, QolItem | undefined>): { id: BagFilter; label: string; n: number }[] {
  const counts = filterCounts(ids, items);
  return BAG_FILTERS.filter(f => f.id === 'all' || counts[f.id] > 0)
    .map(f => ({ id: f.id, label: f.label, n: counts[f.id] }));
}

export function bagMatch(item: QolItem | undefined, f: BagFilter): boolean {
  if (f === 'all') return true;
  return !!item && item.t === f;
}

export function filterInv(ids: string[], items: Record<string, QolItem | undefined>, f: BagFilter): string[] {
  return ids.filter(id => bagMatch(items[id], f));
}

export function filterCounts(ids: string[], items: Record<string, QolItem | undefined>): Record<BagFilter, number> {
  const out = { all: 0, food: 0, drink: 0, med: 0, mat: 0, wpn: 0, gear: 0, thr: 0, key: 0, ammo: 0 } as Record<BagFilter, number>;
  out.all = ids.length;
  for (const id of ids) {
    const t = items[id]?.t as BagFilter | undefined;
    if (t && t in out && t !== 'all') out[t]++;
  }
  return out;
}

/** 丢几个：'all' 或数字；结果夹在 [0, have]，非法输入（NaN / 负数 / 小数）一律拉回整数 */
export function dropCount(have: number, want: number | 'all'): number {
  const h = Math.max(0, Math.floor(Number(have) || 0));
  if (want === 'all') return h;
  const w = Math.floor(Number(want) || 0);
  return Math.max(0, Math.min(h, w));
}

/** 存几个：储物箱容量按"件数"算（与 legacy 一致：storage 级 × 12）。
 *  返回实际能存的件数 + 不能全存时的原因（给玩家一句人话）。 */
export function depositCount(have: number, used: number, cap: number): { n: number; reason: string } {
  const h = Math.max(0, Math.floor(Number(have) || 0));
  const u = Math.max(0, Math.floor(Number(used) || 0));
  const c = Math.max(0, Math.floor(Number(cap) || 0));
  if (c === 0) return { n: 0, reason: '你还没有储物箱（据点 → 建设）。' };
  const room = Math.max(0, c - u);
  if (room <= 0) return { n: 0, reason: '储物箱满了（' + u + '/' + c + '），先升级或取出一些。' };
  if (room < h) return { n: room, reason: '储物箱只剩 ' + room + ' 格：先存 ' + room + ' 件，其余的还在背包里。' };
  return { n: h, reason: '' };
}

/* ── 探索页补给快捷键：槽位含义固定且互不重叠（1 治疗 / 2 补水 / 3 进食 / 4 状态药），
      每槽一条候选链，取背包里第一件有的 —— 键位不会因为"今天少带了绷带"就整体错位。 ── */
export const QUICK_CHAIN: { key: string; hint: string; ids: string[] }[] = [
  { key: '1', hint: '治疗·止血', ids: ['bandage', 'medkit'] },
  { key: '2', hint: '补水', ids: ['water', 'cola'] },
  { key: '3', hint: '进食', ids: ['can', 'biscuit', 'jerky', 'choco', 'veg'] },
  { key: '4', hint: '状态药', ids: ['anti', 'iodine', 'radaway', 'painkiller'] },
];

export function quickSlots(inv: Record<string, number | undefined>, items: Record<string, QolItem | undefined>): { key: string; hint: string; id: string; n: number }[] {
  const out: { key: string; hint: string; id: string; n: number }[] = [];
  for (const slot of QUICK_CHAIN) {
    const id = slot.ids.find(k => (inv[k] || 0) > 0 && !!items[k]);
    if (id) out.push({ key: slot.key, hint: slot.hint, id, n: Math.floor(inv[id] || 0) });
  }
  return out;
}

/** 快捷键按下去之后：返回要用的物品 id，或 null（槽位空） */
export function quickPick(inv: Record<string, number | undefined>, items: Record<string, QolItem | undefined>, key: string): string | null {
  const slot = QUICK_CHAIN.find(s => s.key === key);
  if (!slot) return null;
  return slot.ids.find(k => (inv[k] || 0) > 0 && !!items[k]) || null;
}

/** 战斗「重复上次」：上次打的那只还活着就继续打它，死了就改打第一只活的；都没有则 -1 */
export function repeatTarget(preferred: number, foes: { hp: number }[]): number {
  const p = Math.floor(Number(preferred));
  if (Number.isFinite(p) && p >= 0 && p < foes.length && foes[p].hp > 0) return p;
  return foes.findIndex(f => f.hp > 0);
}

/** 「重复上次」按钮上写什么（没有可重复动作时返回 null，按钮不显示） */
export function repeatLabel(lastId: string | null, moveName: string | undefined, key = 'R'): string | null {
  if (!lastId || !moveName) return null;
  return '↻ 重复上次：' + moveName + '（' + key + '）';
}
