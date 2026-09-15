/**
 * M28 大区危险度：**柏林噪声（Perlin noise）驱动的难度场** —— 纯逻辑，可单测。
 *
 * 用户原话：「使用柏林噪声生成大区的每个单元格的难度分级，现在太有规律了」。
 * 旧版是「1 + round(离主城距离 / 最大距离 × 4)」——纯同心圆，一眼看穿，没有"这一带有片特别凶的地方"。
 *
 * 但危险度有三个**不能破的硬约束**（都是被评审和实测打出来的教训）：
 *  ① 主城 + 紧邻一圈 = 安全区（新手村，危险 1）；
 *  ② 相邻两格最多差 1（M17 的"4 挨着 2 断崖"批评就是这个）——所以噪声不能直接铺，
 *     要用"邻居钳制"扫到收敛；
 *  ③ 离主城越远整体越危险（这游戏教给玩家的是"往外走 = 更危险也更有货"，不能反过来）。
 *
 * 做法：基础梯度（径向） + 两层**柏林噪声**（低频定"这一带凶不凶"、高频打破规整的圈）
 * + 一个"深渊孤岛"（少数几块特别凶的地方，让地图有可记忆的地标）。
 * 幅度控制在 ±1.3 档以内 —— 这是量出来的：再大就会把"越往外越危险"单调性打破（测试里钉住了）。
 */

/** 字符串 → 32 位种子（FNV-1a：同一个种子字符串永远生成同一张危险度图） */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 柏林噪声（值噪声实现，2D，返回 -1..1）——与 simplex-noise 同源思路，自己写一份是为了可单测、零依赖 */
export function makePerlin(seed: number): (x: number, y: number) => number {
  const p = new Uint8Array(512);
  let s = (seed >>> 0) || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return (x: number, y: number): number => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = p[X + p[Y]] / 255 * 2 - 1, ab = p[X + p[Y + 1]] / 255 * 2 - 1;
    const ba = p[X + 1 + p[Y]] / 255 * 2 - 1, bb = p[X + 1 + p[Y + 1]] / 255 * 2 - 1;
    return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
  };
}

export interface DangerFieldOpts {
  homeCol: number; homeRow: number;
  /** 离主城最远的那一格的距离（决定径向梯度的陡度） */
  maxDist: number;
  /** 低频柏林噪声：决定"这一带整体凶不凶"（幅度 ±0.9 档） */
  low: (x: number, y: number) => number;
  /** 高频柏林噪声：打破规整的圈，让边界不再是完美同心圆（幅度 ±0.4 档） */
  fine: (x: number, y: number) => number;
  /** 深渊孤岛中心（少数"特别凶"的块，给地图一个可记忆的地标） */
  pit?: { c: number; r: number } | null;
}

/** 单格原始危险值（没做邻居钳制、也没取整） */
export function rawDanger(opts: DangerFieldOpts, c: number, r: number): number {
  const dist = Math.max(Math.abs(c - opts.homeCol), Math.abs(r - opts.homeRow));
  if (dist <= 1) return 1;                                     // 硬约束①：新手村
  const base = 1 + (dist / Math.max(1, opts.maxDist)) * 4;
  /* 噪声坐标除以 3：让"这片凶"覆盖 3×3 格以上，玩家能看出"一整片"，而不是一格一个数 */
  const wob = opts.low(c / 3, r / 3) * 0.9 + opts.fine(c / 1.5, r / 1.5) * 0.4;
  /* 深渊孤岛：离孤岛中心 ≤1 格 +1.7 —— 城里人管那叫"别去的地方"。
     实测 +1.3 时会被边缘衰减吃掉（12×12 里孤岛常常落在离主城 4~5 格的位置），
     整张图只剩 3 格危险 5，"最凶的地方"没有存在感；+1.7 后孤岛稳定成片。 */
  const pitBoost = opts.pit && Math.max(Math.abs(c - opts.pit.c), Math.abs(r - opts.pit.r)) <= 1 ? 1.7 : 0;
  /* 边缘（离主城 ≥ maxDist - 1）是"死地"：M17 的硬约束是"最外圈至少危险 4"（不能出现安全角落），
     所以噪声在这里要**衰减**，否则一个负波谷就会把角落拉到 3（实测就被老测试抓到了）。
     噪声在这里只当微调（±0.45），保证外面一圈落在 4~5、不会掉回 3。 */
  const edge = Math.min(1, Math.max(0, (dist - (opts.maxDist - 2)) / 2));
  const v = 1 + (base - 1 + wob * (1 - edge * 0.65)) + edge * 0.6 + pitBoost;
  return Math.max(1, Math.min(5, v));
}

/**
 * 整张 12×12 的危险度：先取整 + 邻居钳制**扫到收敛**（不是只扫一遍 —— 一遍会留下差值 2 的残余），
 * 再做一次"相邻同类成片"的平滑（同级别超过 6 格的孤立小块往下并一级，让危险区成片、不是雪花点）。
 */
export function buildDangerGrid(opts: DangerFieldOpts, cols: number, rows: number): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) grid[r][c] = Math.max(1, Math.min(5, Math.round(rawDanger(opts, c, r))));
  }
  const nbs = (c: number, r: number) => {
    const out: Array<[number, number]> = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && cc < cols && rr >= 0 && rr < rows) out.push([cc, rr]);
    }
    return out;
  };
  /* 邻居钳制：反复扫，直到没有"差 ≥2"的相邻对（收敛性：每轮把高的一侧往下拉一格，值域有限） */
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (const [cc, rr] of nbs(c, r)) {
        if (grid[r][c] - grid[rr][cc] >= 2) { grid[r][c] = grid[rr][cc] + 1; changed = true; }
      }
    }
    if (!changed) break;
  }
  /* 成片化：把"同级别里孤零零的一格"往下并一级（并完再钳制一次，防止又出现断崖） */
  for (let pass = 0; pass < 4; pass++) {
    const drop: Array<[number, number]> = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = Math.max(Math.abs(c - opts.homeCol), Math.abs(r - opts.homeRow));
      if (d <= 1) continue;
      const same = nbs(c, r).filter(([cc, rr]) => grid[rr][cc] === grid[r][c]).length;
      if (same <= 1 && grid[r][c] > 1) drop.push([c, r]);
    }
    if (!drop.length) break;
    for (const [c, r] of drop) grid[r][c] -= 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (const [cc, rr] of nbs(c, r)) if (grid[r][c] - grid[rr][cc] >= 2) grid[r][c] = grid[rr][cc] + 1;
    }
  }
  return grid;
}

/** 地图统计（探针与 UI 都用得上）：各档格数、相邻最大差、安全区格数 */
export function dangerStats(grid: number[][], homeCol: number, homeRow: number) {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const hist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let maxJump = 0, safe = 0, total = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = grid[r][c];
    hist[v] = (hist[v] ?? 0) + 1; total++;
    if (Math.max(Math.abs(c - homeCol), Math.abs(r - homeRow)) <= 1) safe++;
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      const cc = c + dc, rr = r + dr;
      if (cc < cols && rr < rows) maxJump = Math.max(maxJump, Math.abs(v - grid[rr][cc]));
    }
  }
  return { hist, maxJump, safe, total };
}
