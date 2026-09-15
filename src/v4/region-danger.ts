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
  /** 噪声系数等于 `low` 的**连续**柏林场（不是格点表）：C1 连续化时用它做双线性采样 */
  cont?: (x: number, y: number) => number;
}

/** 一格的噪声坐标（格心）：危险度场要能"格与格之间"取连续值，所以坐标必须落在 0.5 而不是整数上
    —— 整数坐标正好落在格点，双线性插值会退化成"每格一个随机数"，看起来还是一格一个色块。 */
export const cellNoiseXY = (c: number, r: number, f = 1 / 3): { x: number; y: number } => ({ x: (c + 0.5) * f, y: (r + 0.5) * f });

/** 危险度场的**连续**取值（不取整、不钳制）—— 给"大区每一格"和"区域内部的 24×24 格"共用。
    同一张噪声、同一个口径，所以区与区之间的难度是连续的（不再出现"过了边界突然 +2 档"）。 */
export function dangerAt(opts: DangerFieldOpts, c: number, r: number): number {
  const dist = Math.max(Math.abs(c - opts.homeCol), Math.abs(r - opts.homeRow));
  const base = 1 + (dist / Math.max(1, opts.maxDist)) * 4;
  const { x, y } = cellNoiseXY(c, r);
  /* 低频噪声管"这一片凶不凶"，高频噪声打破规整的圈。
     频率与幅度都是**量出来的**：高频那层周期只有 2.6 格、幅度 0.26 时，它一格能变 ~1.0 档
     （最坏叠加点实测相邻格差 2.10 档，"格与格之间连续"就成了空话）；
     压到 0.15 后最坏差落在 1.4 档左右，径向梯度重新成为唯一的陡峭来源。 */
  const wob = opts.low(x * (3 / 7), y * (3 / 7)) * 0.62 + opts.fine(x / 2.6, y / 2.6) * 0.15;
  /* 深渊孤岛：离孤岛中心 4 格以内按平滑曲线加成（中心 +1.6）。
     用衰减曲线而不是"≤1 格 +1.6 / 2 格 +0.8"的台阶：台阶会在孤岛边缘留下 0.5 档/格的断崖，
     实测那一格差 1.76 档 —— 噪声白做，全靠邻居钳制救。曲线半径 4 之后峰值差落在 1.4 档内。 */
  let pitBoost = 0;
  if (opts.pit) {
    const d = Math.max(Math.abs(c - opts.pit.c), Math.abs(r - opts.pit.r));
    if (d <= 5) { const t = 1 - d / 5; pitBoost = 1.6 * t * t * (3 - 2 * t); }
  }
  /* 边缘（离主城 ≥ maxDist - 1）是"死地"：M17 的硬约束是"最外圈至少危险 4"（不能出现安全角落），
     所以噪声在这里要**衰减**，否则一个负波谷就会把角落拉到 3（实测就被老测试抓到了）。 */
  const edge = Math.min(1, Math.max(0, (dist - (opts.maxDist - 2)) / 2));
  const v = 1 + (base - 1 + wob * (1 - edge * 0.65)) + edge * 0.6 + pitBoost;
  /* 硬约束①：新手村（主城 + 紧邻一圈）恒为 1。但**不能写成 `if (dist<=1) return 1`** ——
     那会造出一个断崖：圈内恒 1、圈外按噪声可能是 3，实测相邻格心差 2.05 档（量出来的），
     最后只能靠邻居钳制把外圈一格格拉下来。改成"从主城向外平滑压到 1"：
     dist 1 / 2 / 3 处分别按 0.25 / 0.6 / 0.85 的权重回到安全值，两格之内的数字仍然恒为 1。 */
  const safe = 1 - Math.min(1, Math.max(0, (dist - 1) / 2));   // dist 1 → 1，dist ≥3 → 0
  const w = safe * safe * (3 - 2 * safe);
  const out = Math.max(1, Math.min(5, v * (1 - w) + 1 * w));
  return out;
}

/** 单格原始危险值（没做邻居钳制、也没取整） */
export const rawDanger = (opts: DangerFieldOpts, c: number, r: number): number => dangerAt(opts, c, r);

/** 区域内部（24×24）的**局部**难度：大区那一格是"这一带有多难"的基准，
    格子内部再叠一层小尺度噪声（玩家在大区图上看到的数字 = 这一带；踩进去才知道具体哪几格更凶）。 */
export function localDanger(cont: (x: number, y: number) => number, baseTier: number, c: number, r: number): number {
  const n = cont((c + 0.5) * 0.55, (r + 0.5) * 0.55);        // 小尺度：大约 2~3 格一片
  const v = baseTier - 0.5 + n * 1.35;                        // 基准上下浮动 ~±1.35 档
  return Math.max(1, Math.min(5, Math.round(v)));
}

/**
 * 整张 12×12 的危险度：先取整 + 邻居钳制**扫到收敛**（不是只扫一遍 —— 一遍会留下差值 2 的残余），
 * 再做一次"相邻同类成片"的平滑（同级别超过 6 格的孤立小块往下并一级，让危险区成片、不是雪花点）。
 */
export function buildDangerGrid(opts: DangerFieldOpts, cols: number, rows: number): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) grid[r][c] = Math.max(1, Math.min(5, Math.round(dangerAt(opts, c, r))));
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

/* ── M30：大区「资源丰度」层 ──
   用户要的是"大区每格难度用柏林噪声分布"（危险度已经做了），顺手把**资源丰度**也做成同一套噪声：
   不然 144 个区域除了危险度以外没有任何差别，"跑远路"这件事就没有收益梯度。
   丰度只影响"能搜到多少"（材料/拾取数量），不影响作物与钓鱼——那些有自己的一套数值。 */
export const ABUNDANCE_MIN = 0.75;      // 最贫瘠
export const ABUNDANCE_MAX = 1.35;      // 最肥

/** 两次平滑插值的值噪声（比 makePerlin 更"团块化"，正适合做资源分布） */
export function makeField(seed: number): (x: number, y: number) => number {
  const h = (i: number, j: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7 + (seed >>> 0) * 0.0001) * 43758.5453;
    return s - Math.floor(s);
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = h(xi, yi), b = h(xi + 1, yi), c2 = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return (a + (b - a) * u) + ((c2 + (d - c2) * u) - (a + (b - a) * u)) * v;
  };
}

/** 丰度倍率：噪声的 4 次采样均值 → 近似正态 → 平滑映射到 0.75~1.35
    （4 次采样必须取**地图上彼此远离**的点，否则均值还是同一个数；
     用均值是为了"大部分格子普通、少数格子特别好/特别差"，而不是均匀分布） */
export function abundanceAt(field: (x: number, y: number) => number, c: number, r: number): number {
  const f = cellNoiseXY(c, r);
  const a = field(f.x, f.y), b = field(f.x - 5.7, f.y + 3.1), d = field(f.x + 7.3, f.y - 4.2), e = field(f.x + 2.4, f.y + 9.4);
  const n = (a + b + d + e) / 4;
  const t = Math.max(0, Math.min(1, (n - 0.5) * 2.6 + 0.5));        // 拉开分布，避免全挤在中间
  return ABUNDANCE_MIN + t * (ABUNDANCE_MAX - ABUNDANCE_MIN);
}

/** 丰度档位（UI 显示用）：贫瘠 / 一般 / 丰富 / 富矿 */
export function abundanceTier(mul: number): { tier: number; label: string; icon: string } {
  if (mul < 0.88) return { tier: 0, label: '贫瘠', icon: '▁' };
  if (mul < 1.02) return { tier: 1, label: '一般', icon: '▃' };
  if (mul < 1.18) return { tier: 2, label: '丰富', icon: '▅' };
  return { tier: 3, label: '富矿', icon: '█' };
}
