/* 幸存者 NPC：营地/据点的固定居民 + 他们的货架与要价。
   全部由 (seed, 区块坐标) 决定 → 同一个营地每次进都是同一批人、同一批货（可以用存档反复谈价）。 */
import seedrandom from 'seedrandom';
import type { Block, WorldState } from '../types';

export type NpcRole = 'trader' | 'medic' | 'scout' | 'mechanic' | 'bandit' | 'refugee';

export interface NpcDef {
  id: string;
  name: string;
  role: NpcRole;
  desc: string;
  /** 招募需要的材料（难民/医生便宜，老兵贵） */
  hire: number;
  /** 交易溢价：>1 卖得贵，<1 便宜 */
  mark: number;
}

export interface CampStock { id: string; n: number; cost: number; stock: number }

const ROLES: Record<NpcRole, { icon: string; title: string; desc: string; hire: number; mark: number }> = {
  trader:   { icon: '🧰', title: '货郎',   desc: '背包里什么都有，什么都不便宜。', hire: 999, mark: 1.0 },
  medic:    { icon: '⚕️', title: '急救员', desc: '当过急诊护士，手很稳。',       hire: 90,  mark: 1.15 },
  scout:    { icon: '🔭', title: '斥候',   desc: '记得每条街的走向，也记得哪儿死过。', hire: 70, mark: 1.1 },
  mechanic: { icon: '🔧', title: '机修工', desc: '能把任何一台发动机拆了再装回去。', hire: 80, mark: 1.05 },
  bandit:   { icon: '🔪', title: '拾荒者', desc: '靠抢活着，笑得很有礼貌。',       hire: 999, mark: 1.35 },
  refugee:  { icon: '🧣', title: '难民',   desc: '从北边一路走过来的，身上只剩一把力气。', hire: 45, mark: 1.2 },
};

const FIRST = ['霍', '林', '陈', '阿', '沈', '赵', '许', '白', '秦', '罗', '韩', '杜'];
const GIVEN = ['克', '蛮', '遥', '澈', '岚', '洲', '清', '岸', '舟', '野', '迟', '鹰'];

export function campRng(seed: string, block: Block) {
  return seedrandom(seed + ':camp:' + block.x + ',' + block.y);
}

/** 这个 POI 里住着谁：营地里 2~3 个，拾荒者据点只有一群不友好的 */
export function campRoster(seed: string, block: Block): NpcDef[] {
  const rng = campRng(seed, block);
  const hostile = block.poi === 'outpost';
  const pool: NpcRole[] = hostile ? ['bandit', 'bandit', 'trader'] : ['trader', 'medic', 'scout', 'mechanic', 'refugee', 'refugee'];
  const n = hostile ? 2 : (rng() < 0.5 ? 2 : 3);
  const out: NpcDef[] = [];
  const usedName = new Set<string>();
  for (let i = 0; i < n; i++) {
    const role = pool[Math.floor(rng() * pool.length)];
    let name = FIRST[Math.floor(rng() * FIRST.length)] + GIVEN[Math.floor(rng() * GIVEN.length)];
    while (usedName.has(name)) name += '·' + (i + 1);
    usedName.add(name);
    const r = ROLES[role];
    out.push({ id: role + '-' + i, name: r.title + ' · ' + name, role, desc: r.desc, hire: r.hire, mark: r.mark });
  }
  return out;
}

const GOODS: { id: string; n: number; base: number }[] = [
  { id: 'can', n: 2, base: 20 }, { id: 'water', n: 2, base: 20 }, { id: 'bandage', n: 2, base: 22 },
  { id: 'anti', n: 2, base: 30 }, { id: 'medkit', n: 1, base: 40 },
  /* M32b：弹药按口径/弹种卖（旧版写的是伪 id 'ammo' —— grant 落到 S.ammo 镜像上，等于买了吞材料） */
  { id: 'a9_fmj', n: 12, base: 30 }, { id: 'a12_buck', n: 8, base: 30 },
  { id: 'a556_fmj', n: 10, base: 36 }, { id: 'a9_ap', n: 6, base: 48 },
  { id: 'fuel', n: 2, base: 26 }, { id: 'chip', n: 1, base: 34 }, { id: 'kevlar', n: 1, base: 110 },
  { id: 'machete', n: 1, base: 55 }, { id: 'shotgun', n: 1, base: 120 }, { id: 'gasmask', n: 1, base: 70 },
];

/** 营地货架：4~6 样，价格随天数与角色溢价浮动（%d 越久越贵，通胀） */
export function campStock(seed: string, block: Block, npcs: NpcDef[], day: number): CampStock[] {
  const rng = campRng(seed, block);
  const mark = npcs.length ? npcs.reduce((a, n) => a + n.mark, 0) / npcs.length : 1.1;
  const infl = 1 + Math.min(0.6, (day - 1) * 0.012);
  const idx = GOODS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const pick = idx.slice(0, 4 + Math.floor(rng() * 3));
  return pick.map(i => {
    const g = GOODS[i];
    return { id: g.id, n: g.n, cost: Math.max(4, Math.round(g.base * mark * infl)), stock: 1 + Math.floor(rng() * 2) };
  });
}

/** 玩家卖东西：按买价 45% 回收（免得来回倒手刷材料） */
export const sellPrice = (cost: number) => Math.max(2, Math.round(cost * 0.45));

/** 情报要价：越贵的情报点亮越多（材料计价） */
export const INTEL_PRICE = 18;
