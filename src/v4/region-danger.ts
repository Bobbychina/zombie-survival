/**
 * M28/M51b 大区危险度：**柏林噪声（Perlin noise）随机铺出来的难度场** —— 纯逻辑，可单测。
 *
 * 用户原话（M28）：「使用柏林噪声生成大区的每个单元格的难度分级，现在太有规律了」。
 * 用户原话（M51b）：「将大区域的地图的难度划分改成与**小区域地图一样**的柏林噪声随机生成」。
 *
 * M28 那版为什么还是"太有规律"（M51b 实测复盘）：它把噪声加在了一个**没被撼动**的径向梯度上 ——
 *   ① 低频噪声取 (c+0.5)/7：12 格只跨 **1.7 个噪声周期**，等于给全图糊了一层平滑倾斜，
 *      等值线还是同心方框（实测 seed-A 第 5~7 行一模一样：554321112344 ×3，左列整排 5）；
 *   ② 相邻差 ≤1 的钳制遇上"每环只有一格宽"的 12×12，会把每一环钉死在它自己的基准档上。
 * 这一版按**区域内部那张 24×24 图的口径**重做：让噪声真正决定形状，梯度只当趋势。
 *   · **域扭曲（domain warp）**：先拿低频柏林噪声把"离主城几格"揉一遍，再算径向趋势 ——
 *     梯度落在不规则团块上，难度才是"这一片凶"，而不是"第几圈"；
 *   · 两层噪声定形状（低频团块 ~2~3 格 + 中频打散等值线），幅度大到真能顶动一档；
 *   · 收尾不变量与 24×24 共用同一套：`enforceDangerInvariants()`（新手村/梯度钳制/外圈地板）。
 *
 * 三个**不能破的硬约束**（都是被评审和实测打出来的教训）：
 *  ① 主城 + 紧邻一圈 = 安全区（新手村，危险 1）；
 *  ② 相邻两格最多差 1（M17 的"4 挨着 2 断崖"批评就是这个）——所以噪声不能直接铺，
 *     要用"邻居钳制"扫到收敛；
 *  ③ 离主城越远整体越危险（这游戏教给玩家的是"往外走 = 更危险也更有货"，不能反过来）——
 *     现在是**统计意义**上的（每环平均值单调不减），不再要求每一格都等于它那一环的基准档。
 * 外加一条玩法契约：**最外一圈 ≥ 4**，地图边缘不许出现安全角落（M17 评审 #2 的原话）。
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

/* ── M51b 难度场的调参（全部是量出来的，别再拍脑袋改）──
   WARP_AMP/FREQ：域扭曲把切比雪夫圈揉成不规则团块。频率 0.7 → 12 格跨 ~2.8 个周期，
     幅度 2.6 格 ≈ 让"离主城几格"整体抖动 ±2.6 格（一层到两层环宽）——再大就会把
     "越往外越危险"的环平均单调性打翻（下面单测钉着），再小则等值线重新变回同心方框。
   BAND_*：低频团块（"这一带整体凶不凶"，团块 ~2~3 格）+ 中频打散等值线。
     频率 1.35/2.7 → 全图跨 ~6 / ~12 个噪声周期（M28 那版只跨 1.7，所以像倾斜不像噪声）。 */
const WARP_FREQ = 0.7, WARP_AMP = 2.4;
const BAND_FREQ = 1.05, BAND_AMP = 1.55;
const FINE_FREQ = 2.4, FINE_AMP = 0.5;

/** 危险度场的**连续**取值（不取整、不钳制）—— 给"大区每一格"和"区域内部的 24×24 格"共用。
    同一张噪声、同一个口径，所以区与区之间的难度是连续的（不再出现"过了边界突然 +2 档"）。 */
export function dangerAt(opts: DangerFieldOpts, c: number, r: number): number {
  const dist = Math.max(Math.abs(c - opts.homeCol), Math.abs(r - opts.homeRow));
  const { x, y } = cellNoiseXY(c, r);
  /* ① 域扭曲：先揉圈数，再算径向趋势 —— 这是"不再像同心圆"的关键一步。
     12×12 每一环只有一格宽，直接拿圈数当梯度、再叠一点平滑噪声，等值线必然是同心方框；
     揉过之后同样的趋势落在不规则团块上，相邻格的圈数差不再是整齐的 0/1 台阶。 */
  const warp = opts.low(x * WARP_FREQ, y * WARP_FREQ) * WARP_AMP;
  const dw = Math.max(0, Math.min(opts.maxDist, dist + warp));
  const base = 1 + (dw / Math.max(1, opts.maxDist)) * 4;
  /* ② 噪声定形状：低频团块管"这一片凶不凶"，中频把等值线打散。
     采样点带偏移（+7.3/-3.1）是为了跟上面做域扭曲的那次采样去相关——同一张场采两次不同的点，
     不能用同一处，否则"揉圈"和"定形状"会一起朝同一个方向推。 */
  const wob = opts.low(x * BAND_FREQ + 7.3, y * BAND_FREQ - 3.1) * BAND_AMP
    + opts.fine(x * FINE_FREQ, y * FINE_FREQ) * FINE_AMP;
  /* 深渊孤岛：离孤岛中心 5 格以内按平滑曲线加成（中心 +1.6）。
     用衰减曲线而不是台阶：台阶会在孤岛边缘留下断崖，实测那一格差 1.76 档。 */
  let pitBoost = 0;
  if (opts.pit) {
    const d = Math.max(Math.abs(c - opts.pit.c), Math.abs(r - opts.pit.r));
    if (d <= 5) { const t = 1 - d / 5; pitBoost = 1.6 * t * t * (3 - 2 * t); }
  }
  /* 边缘（离主城 ≥ maxDist - 1）是"死地"：最外圈至少危险 4 的契约要靠它兜底，
     所以噪声在这里**衰减**，否则一个负波谷就会把角落拉到 3。 */
  const edge = Math.min(1, Math.max(0, (dist - (opts.maxDist - 2)) / 2));
  const v = 1 + (base - 1 + wob * (1 - edge * 0.6)) + edge * 0.6 + pitBoost;
  /* 硬约束①：新手村（主城 + 紧邻一圈）恒为 1。但**不能写成 `if (dist<=1) return 1`** ——
     那会造出一个断崖：圈内恒 1、圈外按噪声可能是 3。
     M51b 把这条"平滑压回"的半径从 3 圈收到 2 圈：原来 dist=2 那一圈被压到 0.6 的权重，
     一整片 2 被人为摁成 1（实测长出一块 3×5 的"1 平原"），看着比同心圆还假。 */
  const safe = 1 - Math.min(1, Math.max(0, dist - 1));   // dist 1 → 1，dist ≥2 → 0
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

export interface DangerInvariantOpts {
  /** 这一格离"安全屋"几格（切比雪夫） */
  distOf: (c: number, r: number) => number;
  /** 全图最远的那一格的距离（最外圈的判据） */
  maxDist: number;
  /** 安全区半径：`dist <= safeR` 恒为 1（默认 1 = 家 + 紧邻一圈） */
  safeR?: number;
  /** 最外圈的**地板**：离主城最远那一圈至少这么危险（默认 4；传 0 表示不管） */
  outerMin?: number;
  /** 地板管几圈（默认 2）：最外圈 = `outerMin`，往里每圈降 1（4 / 3）。
      为什么要管两圈：主城不在正中时，切比雪夫距离下**四个角并不都在最外圈**
      （主城偏下一格时左下角只有 maxDist-1），只管一圈会让"地图角落"漏出安全区。 */
  outerBand?: number;
}

/**
 * 危险度网格的**收尾不变量** —— 大区 12×12 与"区域内部"那张 24×24 **共用同一套口径**
 * （用户要的"两张图一样"，落点就是这里，而不是只把噪声调到看起来差不多）：
 *   · 安全区（`dist <= safeR`）= 1、第二圈封顶 2 —— 玩家总得有个能喘气的地方；
 *   · 最外圈 ≥ `outerMin` —— 地图边缘不许出现安全角落（M17 评审 #2 的原话）；
 *   · 相邻两格最多差 1（双向：既不许"5 挨着 3"，也不许"3 挨着 1"）。
 *
 * **为什么不是"循环跑几遍钳制"**（M28 的写法，M51b 实测翻车）：三条约束会互相顶 ——
 * 控制轮把第二圈按回 2，钳制轮又因为外圈的地板把它顶回 3，两个方向来回拉，跑到上限也不收敛。
 * 实测 8 个种子里 6 个留下 |Δ|=2、2 个留下 |Δ|=3 的断崖（正好是"相邻最多差 1"这条铁律）。
 * 现在改成**一次算清楚**（三条都是单调传播，必然收敛，不用试次数）：
 *   ① 每格先有自己的上下限（`need` / `cap`）；
 *   ② 下限从"外圈地板"往内一格衰减 1 地传（`need[i] = max(need[i], need[j]-1)`，只增、有上界 5）；
 *   ③ 上限从"安全区"往外一格放宽 1 地传（`cap[i] = min(cap[i], cap[j]+1)`，只减、有下界 1）；
 *   ④ 噪声值夹进 [need, cap]，再跑**只降不升**的松弛到收敛 —— 只降保证单调收敛，
 *      而 `need` 本身是 |Δ|≤1 一致的，所以降完仍然 ≥ need（不会把外圈地板降掉）。
 * 可证：最终 state 满足 `need ≤ v ≤ cap` 且任意相邻 |Δ|≤1；而 need ≤ cap 对
 * maxDist ≥ 3 的图恒成立（安全区那一侧的上限爬得比外侧地板衰减得快）。
 */
export function enforceDangerInvariants(grid: number[][], o: DangerInvariantOpts): number[][] {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const safeR = o.safeR ?? 1, outerMin = o.outerMin ?? 4;
  const N = rows * cols;
  const idx = (c: number, r: number) => r * cols + c;
  const nbs: number[][] = new Array(N);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const list: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && cc < cols && rr >= 0 && rr < rows) list.push(idx(cc, rr));
    }
    nbs[idx(c, r)] = list;
  }
  /* ① 自己的上下限 */
  const need = new Int32Array(N).fill(1), cap = new Int32Array(N).fill(5);
  const band = Math.max(1, o.outerBand ?? 2);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = o.distOf(c, r), i = idx(c, r);
    cap[i] = d <= safeR ? 1 : d === safeR + 1 ? 2 : 5;
    need[i] = outerMin > 0 && d >= o.maxDist - band + 1
      ? Math.max(1, outerMin - (o.maxDist - d)) : 1;
  }
  /* ②③ 两条约束各自单调传播到不动点 */
  for (let pass = 0, moved = true; moved && pass < N; pass++) {
    moved = false;
    for (let i = 0; i < N; i++) {
      for (const j of nbs[i]) {
        if (need[j] - 1 > need[i]) { need[i] = Math.min(5, need[j] - 1); moved = true; }
        if (cap[j] + 1 < cap[i]) { cap[i] = Math.max(1, cap[j] + 1); moved = true; }
      }
    }
  }
  /* ④ 噪声值夹进可行区间，再"只降"松弛到相邻差 ≤1（need 是 |Δ|≤1 一致的，所以降不破下限） */
  const flat = new Array<number>(N);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    const hi = Math.max(cap[i], need[i]);                 // 极小图上两者可能打架，以下限为准
    flat[i] = Math.max(need[i], Math.min(hi, grid[r][c]));
  }
  for (let pass = 0, moved = true; moved && pass < N; pass++) {
    moved = false;
    for (let i = 0; i < N; i++) {
      let m = 5;
      for (const j of nbs[i]) m = Math.min(m, flat[j]);
      if (flat[i] > m + 1) { flat[i] = m + 1; moved = true; }
    }
  }
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(flat[idx(c, r)]);
    out.push(row);
  }
  return out;
}

/** 撒盐化清理：同级别里**孤零零的一格**（8 邻域没有同伴）并到邻居的中位档上。
    噪声地形本来就会长出零星单格，读图时会像噪点；这一步只动真正的孤立点，成片的团块一律不碰。 */
function despeckle(grid: number[][]): number[][] {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const drop: Array<[number, number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const around: number[] = [];
    let same = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue;
      around.push(grid[rr][cc]);
      if (grid[rr][cc] === grid[r][c]) same++;
    }
    if (!same && around.length) {
      around.sort((a, b) => a - b);
      drop.push([c, r, around[Math.floor(around.length / 2)]]);
    }
  }
  for (const [c, r, v] of drop) grid[r][c] = v;
  return grid;
}

/**
 * 整张 12×12 的危险度：**噪声取整 → 去孤立点 → 收尾不变量扫到收敛**。
 * 大区和"区域内部"两张图共用 `enforceDangerInvariants()`，所以口径是一样的（用户要的"一样"在这）。
 */
export function buildDangerGrid(opts: DangerFieldOpts, cols: number, rows: number): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) grid[r][c] = Math.max(1, Math.min(5, Math.round(dangerAt(opts, c, r))));
  }
  const distOf = (c: number, r: number) => Math.max(Math.abs(c - opts.homeCol), Math.abs(r - opts.homeRow));
  despeckle(grid);
  return enforceDangerInvariants(grid, { distOf, maxDist: opts.maxDist, safeR: 1, outerMin: 4 });
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
