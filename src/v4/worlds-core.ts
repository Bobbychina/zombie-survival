/* 多世界管理（M20）——纯逻辑：像 MC/泰拉瑞亚那样开好几个世界，每个世界自己的地图、进度与云同步。
 *
 * 起因（用户 idea）：
 *   「可以创建新的世界：存档用类似 mc/泰拉那种世界化管理方式来管理，自动同步云存档」
 *
 * 设计（对象存储最小化，绝不动 legacy 的那把主键）：
 *   · 注册表存在 `zsv_worlds_v1`：{ v, activeId, worlds:[{ id, name, seed, preset, createdAt, lastPlayed, day, deaths }] }
 *   · **当前世界的存档仍然写在老地方**（`zombie_survival_save_v2`）——
 *     这样指纹校验、自动存档、云同步、导入导出这些既有链路一行都不用改；
 *     切换世界时把当前存档挪到 `zsv_save_<id>`、把目标世界的存档搬回主键。
 *   · 老玩家第一次进来：没有注册表 → 用现有存档的 seed 建一个世界并认领它（不丢档）。
 */
import { isPreset, type Preset, validSeed } from './share-core';

export const REG_KEY = 'zsv_worlds_v1';
export const slotKey = (id: string) => 'zsv_save_' + id;
export const MAIN_KEY = 'zombie_survival_save_v2';

export interface WorldMeta {
  id: string;
  name: string;
  seed: string;
  preset: Preset;
  createdAt: number;
  lastPlayed: number;
  day: number;         // 最近一次看到的游戏天数（列表里显示用）
  deaths: number;      // 这个世界里死过几次（台账里也有一份，这里做列表摘要）
  note?: string;       // 玩家自己写的一句话（挑战码分享时也带上）
}

export interface Registry { v: number; activeId: string; worlds: WorldMeta[] }

export const emptyRegistry = (): Registry => ({ v: 1, activeId: '', worlds: [] });

/** 世界 id：时间戳 + 随机后缀（不依赖 crypto，浏览器/测试都能跑） */
export function newWorldId(now = Date.now(), rng: () => number = Math.random): string {
  return 'w' + now.toString(36) + Math.floor(rng() * 1296).toString(36).padStart(2, '0');
}

export function validWorldName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 16;
}

/** 读注册表：任何形状不对的地方都修回来（坏档不能让世界列表打不开） */
export function normalizeRegistry(raw: unknown): Registry {
  const o = (raw && typeof raw === 'object') ? raw as Partial<Registry> : {};
  const list: WorldMeta[] = Array.isArray(o.worlds) ? o.worlds.filter(w => w && typeof w === 'object').map(w => ({
    id: typeof w.id === 'string' && w.id ? w.id : newWorldId(),
    name: validWorldName(w.name) ? w.name.trim() : '未命名世界',
    seed: validSeed(w.seed) ? w.seed : 'ember-01',
    preset: isPreset(w.preset) ? w.preset : 'normal',
    createdAt: Math.max(0, Math.floor(Number(w.createdAt) || 0)),
    lastPlayed: Math.max(0, Math.floor(Number(w.lastPlayed) || 0)),
    day: Math.max(1, Math.floor(Number(w.day) || 1)),
    deaths: Math.max(0, Math.floor(Number(w.deaths) || 0)),
    note: typeof w.note === 'string' ? w.note.slice(0, 40) : undefined,
  })) : [];
  /* id 去重（坏档里可能出现重复 id，重复 id 会让"切世界"把两份存档写进同一个槽） */
  const seen = new Set<string>();
  const worlds = list.filter(w => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  const activeId = worlds.some(w => w.id === o.activeId) ? String(o.activeId) : (worlds[0]?.id ?? '');
  return { v: 1, activeId, worlds };
}

export function createWorld(reg: Registry, opts: { name: string; seed: string; preset?: Preset; now?: number; id?: string; rng?: () => number }): { reg: Registry; world: WorldMeta } {
  const now = opts.now ?? Date.now();
  const world: WorldMeta = {
    id: opts.id ?? newWorldId(now, opts.rng), name: validWorldName(opts.name) ? opts.name.trim() : '新世界',
    seed: validSeed(opts.seed) ? opts.seed : 'ember-01',
    preset: isPreset(opts.preset) ? opts.preset : 'normal',
    createdAt: now, lastPlayed: now, day: 1, deaths: 0,
  };
  const next = normalizeRegistry({ ...reg, worlds: [...reg.worlds, world] });
  return { reg: { ...next, activeId: world.id }, world };
}

export function removeWorld(reg: Registry, id: string): Registry {
  if (reg.worlds.length <= 1) return reg;                       // 至少留一个世界
  const worlds = reg.worlds.filter(w => w.id !== id);
  const activeId = reg.activeId === id ? worlds[0].id : reg.activeId;
  return { v: 1, activeId, worlds };
}

export function renameWorld(reg: Registry, id: string, name: string): Registry {
  if (!validWorldName(name)) return reg;
  return { ...reg, worlds: reg.worlds.map(w => (w.id === id ? { ...w, name: name.trim() } : w)) };
}

export function touchWorld(reg: Registry, id: string, patch: Partial<WorldMeta>): Registry {
  return { ...reg, worlds: reg.worlds.map(w => (w.id === id ? { ...w, ...patch, id: w.id } : w)) };
}

export const worldById = (reg: Registry, id: string): WorldMeta | null => reg.worlds.find(w => w.id === id) ?? null;

/** 列表排序：最近玩的在最上面 */
export const sortedWorlds = (reg: Registry): WorldMeta[] => [...reg.worlds].sort((a, b) => b.lastPlayed - a.lastPlayed);

/** 世界卡的副标题（列表用） */
export const worldLine = (w: WorldMeta): string =>
  `第 ${w.day} 天 · 种子 ${w.seed} · ${w.deaths ? '死过 ' + w.deaths + ' 次' : '还没死过'}`;
