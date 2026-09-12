/* 程序化大世界：24×24 个 1km² 区块，用 simplex 噪声铺生物群系，再按群系撒 POI。
   世界由存档里的 seed 决定 → 同一存档每次生成结果一致（测试可断言、存档只存增量）。 */
import seedrandom from 'seedrandom';
import { createNoise2D } from 'simplex-noise';
import { POIS } from './pois';
import { SUNKEN_MIN_DIST, SUNKEN_PER_WORLD } from './water-core';
import type { Block, Biome, WorldState } from '../types';

export const WORLD_W = 24;
export const WORLD_H = 24;

const NAME_A = ['长春','建设','红旗','解放','和平','光明','兴安','新华','民主','富强','东风','胜利','南山','北岭','西林','东湖','望江','青石','铁西','柳河'];
const NAME_B = ['路','街','大道','巷','桥','屯','站','口'];

export const bkey = (x: number, y: number) => x + ',' + y;
/** M7.1 新增的现代商业/建材建筑：刷点权重更高，避免地图上永远只有那几种老 POI
    M8 追加 lumber（林场）/ sawmill（木材加工厂）——木头要能在地图上"看得见、跑得到" */
const MODERN_POIS = new Set(['furniture', 'hardware', 'megamart', 'office', 'appliance', 'depot', 'buildmart', 'lumber', 'sawmill']);
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function blockName(x: number, y: number) {
  return NAME_A[(x * 7 + y * 13) % NAME_A.length] + NAME_B[(x + y * 3) % NAME_B.length] + (x + y) + ' 号街区';
}

/** 按群系加权挑一个 POI（找不到就返回 null = 空地） */
function pickPoi(rng: () => number, biome: Biome, d2home: number): string | null {
  const pool: { id: string; w: number }[] = [];
  for (const id in POIS) {
    const p = POIS[id];
    if (!p.biomes.includes(biome)) continue;
    if (id === 'lab') continue;                       // 实验室只在地图远端强制放置
    let w = 1;
    if (id === 'camp') w = 0.5 + d2home * 0.25;       // 越远越容易遇到营地
    if (id === 'outpost') w = 0.4 + d2home * 0.2;
    if (id === 'gas' || id === 'garage') w = biome === 'highway' ? 6 : 1.2;
    if (biome === 'highway') w *= id === 'gas' || id === 'garage' || id === 'warehouse' ? 3 : 0.4;
    // M7.1：现代商业建筑（家具城/五金/仓储超市/写字楼/家电城/物流园/建材市场）+ M8 的林场/木材加工厂刷得更勤，别老是那几种
    if (MODERN_POIS.has(id)) w *= 1.8;
    pool.push({ id, w });
  }
  if (!pool.length) return null;
  const total = pool.reduce((a, b) => a + b.w, 0);
  if (rng() > Math.min(0.85, 0.42 + d2home * 0.03)) return null;   // 不是每个区块都有东西
  let r = rng() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.id; }
  return pool[pool.length - 1].id;
}

export function generateWorld(seed: string): WorldState {
  const rng = seedrandom(seed);
  const nElev = createNoise2D(seedrandom(seed + ':elev'));
  const nUrban = createNoise2D(seedrandom(seed + ':urban'));
  const nInd = createNoise2D(seedrandom(seed + ':ind'));
  const nRural = createNoise2D(seedrandom(seed + ':rural'));

  const home = { x: Math.floor(WORLD_W / 2), y: Math.floor(WORLD_H / 2) };
  // 实验室放在远端（保证"必须横穿大世界"）：距离 10~14 个区块
  const angle = rng() * Math.PI * 2;
  const radius = 10 + Math.floor(rng() * 5);
  let lab = {
    x: Math.max(1, Math.min(WORLD_W - 2, Math.round(home.x + Math.cos(angle) * radius))),
    y: Math.max(1, Math.min(WORLD_H - 2, Math.round(home.y + Math.sin(angle) * radius))),
  };
  if (dist(home, lab) < 10) lab = { x: Math.min(WORLD_W - 2, home.x + 11), y: home.y };

  const blocks: Record<string, Block> = {};
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const elev = nElev(x * 0.14, y * 0.14);
      const urban = nUrban(x * 0.09 + 50, y * 0.09 + 50);
      const ind = nInd(x * 0.2 - 30, y * 0.2 - 30);
      const rural = nRural(x * 0.11 + 200, y * 0.11 + 200);
      let biome: Biome = 'ruins';
      if (elev < -0.42) biome = 'water';
      else if (ind > 0.42 && urban > -0.15) biome = 'industrial';
      else if (urban > 0.3) biome = 'city';
      else if (urban > 0.05) biome = 'suburb';
      else if (rural < -0.25) biome = 'forest';
      else if (rural > 0.25) biome = 'farm';
      blocks[bkey(x, y)] = {
        x, y, biome, name: blockName(x, y), poi: null,
        danger: 1, searched: 0, depleted: false, visited: false, revealed: false,
      };
    }
  }

  // 沿"家 → 实验室"修一条公路骨架：让载具与远程旅行有明确路线
  const steps = Math.max(Math.abs(lab.x - home.x), Math.abs(lab.y - home.y));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(home.x + (lab.x - home.x) * t);
    const y = Math.round(home.y + (lab.y - home.y) * t);
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]] as [number, number][]) {
      const b = blocks[bkey(x + ox, y + oy)] ?? blocks[bkey(x - ox, y - oy)];
      if (b && b.biome !== 'water' && rng() < 0.7) b.biome = 'highway';
    }
  }

  const d2home = (b: Block) => Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y));
  for (const k in blocks) {
    const b = blocks[k];
    if (b.biome === 'water') continue;              // 水域的 POI 由下面的"沉没基地"单独放
    const d = d2home(b);
    b.danger = Math.max(1, Math.min(5, 1 + Math.floor(d / 3) + (b.biome === 'city' ? 1 : 0) + (b.biome === 'military' ? 1 : 0)));
    b.poi = pickPoi(rng, b.biome, d);
    if (b.poi) b.danger = Math.max(1, Math.min(5, b.danger + (POIS[b.poi].danger > 0 ? 1 : 0)));
  }

  // M7：沉没基地——只放在"深水"区块（四周全是水），距家 ≥6 区块，一张图 1~2 个
  const deepWater: Block[] = [];
  for (const k in blocks) {
    const b = blocks[k];
    if (b.biome !== 'water' || d2home(b) < SUNKEN_MIN_DIST) continue;
    let land = 0;
    for (const [dx, dy] of NEIGHBORS) { const nb = blocks[bkey(b.x + dx, b.y + dy)]; if (nb && nb.biome !== 'water') land++; }
    if (land === 0) deepWater.push(b);
  }
  deepWater.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  for (let i = 0; i < SUNKEN_PER_WORLD && deepWater.length; i++) {
    const b = deepWater.splice(Math.floor(rng() * deepWater.length), 1)[0];
    b.poi = 'sunken';
    b.danger = Math.max(b.danger, 4);
  }

  // 家：强制为郊区、无 POI（安全屋），实验室：强制放置
  const hb = blocks[bkey(home.x, home.y)];
  hb.biome = 'suburb'; hb.poi = null; hb.danger = 1; hb.visited = true; hb.revealed = true;
  const lb = blocks[bkey(lab.x, lab.y)];
  if (lb.biome === 'water') lb.biome = 'industrial';
  lb.poi = 'lab'; lb.danger = 5; lb.biome = lb.biome === 'highway' ? 'industrial' : lb.biome;

  return { seed, w: WORLD_W, h: WORLD_H, home, lab, blocks };
}

export function blockAt(w: WorldState, x: number, y: number): Block | null {
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return null;
  return w.blocks[bkey(x, y)] ?? null;
}

export const NEIGHBORS: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

export function neighbors(w: WorldState, x: number, y: number): Block[] {
  const out: Block[] = [];
  for (const [dx, dy] of NEIGHBORS) {
    const b = blockAt(w, x + dx, y + dy);
    if (b) out.push(b);
  }
  return out;
}

/** 迷雾：到过一个区块，就点亮它和它周围 1 圈 */
export function revealAround(w: WorldState, x: number, y: number, r = 1): string[] {
  const opened: string[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const b = blockAt(w, x + dx, y + dy);
    if (b && !b.revealed) { b.revealed = true; opened.push(bkey(b.x, b.y)); }
  }
  return opened;
}

/** 直线取整的路径（载具沿路走用） */
export function lineBlocks(w: WorldState, from: { x: number; y: number }, to: { x: number; y: number }): Block[] {
  const out: Block[] = [];
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const b = blockAt(w, Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t));
    if (b) out.push(b);
  }
  return out;
}
