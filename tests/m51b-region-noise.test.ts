/* M51b：大区地图的难度划分改成**和小区域地图一样的柏林噪声随机铺**。
   用户原话：「将大区域的地图的难度划分改成与小区域地图一样的柏林噪声随机生成」——
   M28 已经加过噪声，但那版噪声是**加在一个没被撼动的径向梯度上**的，实测还是"同心方框"：
   12×12 每环只有一格宽，梯度一旦当主角、再叠一点平滑噪声，等值线必然是方框。
   M51b 的改法（三件事，代码都在 region-danger.ts）：
     ① **域扭曲**：先拿低频柏林噪声揉"离主城几格"，再算径向趋势；
     ② 两层噪声定形状（低频团块 + 中频打散），幅度大到真能顶动一档；
     ③ 收尾不变量抽成 `enforceDangerInvariants()`，**大区 12×12 与区域内部 24×24 共用同一份**
        （这就是用户要的"一样"，不是"看起来差不多"）。
   这一组测试盯两件事：**形状真的不规整了**（有量化指纹，不是"看着像"），
   以及**四条硬约束一条都没破**（新手村 / 相邻差≤1 / 外圈危险 / 越往外越难）。 */
import { describe, expect, it } from 'vitest';
import { buildRegions, REGION_COLS, REGION_ROWS } from '../src/v4/regions-core';
import { enforceDangerInvariants } from '../src/v4/region-danger';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** 一张 12×12 危险度图的"规整度指纹"。旧版（M28）与新版（M51b）的实测值写在断言注释里。 */
function fingerprint(seed: string) {
  const list = buildRegions(seed);
  const home = list.find(r => r.homeBase)!;
  const g: number[][] = Array.from({ length: REGION_ROWS }, () => new Array(REGION_COLS).fill(0));
  for (const r of list) g[r.row][r.col] = r.tier;
  const dOf = (c: number, r: number) => Math.max(Math.abs(c - home.col), Math.abs(r - home.row));
  const maxDist = Math.max(...list.map(r => r.dist));
  let single = 0, rings = 0, rangeSum = 0;
  for (let d = 2; d <= maxDist - 1; d++) {
    const v: number[] = [];
    for (let r = 0; r < REGION_ROWS; r++) for (let c = 0; c < REGION_COLS; c++) if (dOf(c, r) === d) v.push(g[r][c]);
    if (v.length < 4) continue;                    // 主城偏到角上时某些环只有 3 格，样本太少不计
    rings++;
    if (new Set(v).size <= 1) single++;
    rangeSum += Math.max(...v) - Math.min(...v);
  }
  const hist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of g) for (const v of row) hist[v]++;
  return {
    g, home, maxDist, list, single, rings, rangeSum,
    dupLines: (REGION_ROWS - new Set(g.map(r => r.join(''))).size) + (REGION_COLS - new Set(g[0].map((_, c) => g.map(r => r[c]).join(''))).size),
    topTier: Math.max(...[1, 2, 3, 4, 5].map(t => hist[t])),
    hist,
  };
}

describe('M51b 大区难度：柏林噪声随机铺（形状指纹）', () => {
  it('不再是"同一圈同一个数"：单值环 ≤ 25%（旧版实测 15/32）', () => {
    let single = 0, rings = 0;
    for (const s of SEEDS) { const f = fingerprint(s); single += f.single; rings += f.rings; }
    expect(single / rings, `单值环 ${single}/${rings}`).toBeLessThanOrEqual(0.25);
  });

  it('没有整行/整列的复制（同心方框最直接的指纹）：8 个种子合计 ≤ 12 条（旧版实测 52 条）', () => {
    let dup = 0;
    for (const s of SEEDS) dup += fingerprint(s).dupLines;
    expect(dup, '重复行+列 ' + dup).toBeLessThanOrEqual(12);
  });

  it('环内档位真的散开了：极差之和 ≥ 30（旧版实测 17）', () => {
    let sum = 0;
    for (const s of SEEDS) sum += fingerprint(s).rangeSum;
    expect(sum).toBeGreaterThanOrEqual(30);
  });

  it('没有哪一档吃掉整张图：单档最多 55/144（旧版最差 63 格）', () => {
    for (const s of SEEDS) expect(fingerprint(s).topTier, s).toBeLessThanOrEqual(55);
  });

  it('五个档位都用上（玩家要能看出"这一片特别凶"）', () => {
    for (const s of SEEDS) {
      const h = fingerprint(s).hist;
      for (const t of [1, 2, 3, 4, 5]) expect(h[t], s + ' 缺档 ' + t).toBeGreaterThan(0);
    }
  });
});

describe('M51b 大区难度：四条硬约束一条没破', () => {
  it('新手村（主城 + 紧邻一圈）恒为 1；第二圈封顶 2', () => {
    for (const s of SEEDS) {
      const { list } = fingerprint(s);
      for (const r of list) {
        if (r.dist <= 1) expect(r.tier, s + ' ' + r.name).toBe(1);
        if (r.dist === 2) expect(r.tier, s + ' ' + r.name).toBeLessThanOrEqual(2);
      }
    }
  });

  it('相邻两格最多差 1（"越深越难"要能一路走过去，不能是墙）', () => {
    for (const s of SEEDS) {
      const { g } = fingerprint(s);
      for (let r = 0; r < REGION_ROWS; r++) for (let c = 0; c < REGION_COLS; c++) {
        for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
          const cc = c + dc, rr = r + dr;
          if (cc < REGION_COLS && rr < REGION_ROWS) {
            expect(Math.abs(g[r][c] - g[rr][cc]), s + ' (' + c + ',' + r + ')').toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('地图边缘不许有安全角落：最外圈 ≥4、外两圈 ≥3（四个角也在内）', () => {
    for (const s of SEEDS) {
      const { g, home, maxDist } = fingerprint(s);
      const dOf = (c: number, r: number) => Math.max(Math.abs(c - home.col), Math.abs(r - home.row));
      for (let r = 0; r < REGION_ROWS; r++) for (let c = 0; c < REGION_COLS; c++) {
        const d = dOf(c, r);
        if (d >= maxDist) expect(g[r][c], s + ' 最外圈(' + c + ',' + r + ')').toBeGreaterThanOrEqual(4);
        else if (d >= maxDist - 1) expect(g[r][c], s + ' 外两圈(' + c + ',' + r + ')').toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('越往外整体越危险：环平均值单调不减（允许 ±0.35 的噪声浮动）', () => {
    for (const s of SEEDS) {
      const { g, home, maxDist } = fingerprint(s);
      const dOf = (c: number, r: number) => Math.max(Math.abs(c - home.col), Math.abs(r - home.row));
      let prev = 0;
      for (let d = 0; d <= maxDist; d++) {
        const v: number[] = [];
        for (let r = 0; r < REGION_ROWS; r++) for (let c = 0; c < REGION_COLS; c++) if (dOf(c, r) === d) v.push(g[r][c]);
        if (!v.length) continue;
        const avg = v.reduce((a, b) => a + b, 0) / v.length;
        expect(avg, s + ' 第 ' + d + ' 环平均 ' + avg.toFixed(2) + '（内环 ' + prev.toFixed(2) + '）').toBeGreaterThanOrEqual(prev - 0.35);
        prev = avg;
      }
    }
  });
});

describe('M51b 收尾不变量：大区与区域内部共用的那一份', () => {
  it('返回**新网格**、不动入参（踩过这个坑：世界生成把没修过的网格写了回去，等于整段没生效）', () => {
    const src = [[1, 5, 1], [1, 1, 1], [1, 1, 1]];
    const out = enforceDangerInvariants(src, { distOf: (c, r) => Math.max(c, r), maxDist: 2, safeR: 0, outerMin: 0 });
    expect(src[0][1]).toBe(5);                 // 入参原样
    expect(out[0][1]).toBeLessThanOrEqual(2);  // 出参被钳到邻居 +1
    expect(out).not.toBe(src);
  });

  it('断崖网格被修成 |Δ|≤1，且安全区/外圈地板都守住', () => {
    const g = Array.from({ length: 9 }, () => new Array(9).fill(1));
    g[0][0] = 5; g[1][1] = 5; g[8][8] = 1;
    const out = enforceDangerInvariants(g, { distOf: (c, r) => Math.max(Math.abs(c - 4), Math.abs(r - 4)), maxDist: 4, safeR: 1, outerMin: 4 });
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        if (c + dc < 9 && r + dr < 9) expect(Math.abs(out[r][c] - out[r + dr][c + dc])).toBeLessThanOrEqual(1);
      }
      const d = Math.max(Math.abs(c - 4), Math.abs(r - 4));
      if (d <= 1) expect(out[r][c]).toBe(1);
      else if (d === 2) expect(out[r][c]).toBeLessThanOrEqual(2);
      else if (d >= 4) expect(out[r][c]).toBeGreaterThanOrEqual(4);
    }
  });
});
