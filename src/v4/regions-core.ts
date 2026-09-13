/* 多区域大世界（元地图）——纯逻辑，不碰 DOM、不碰 legacy。
 *
 * M17 重做：**元地图从写死的 3×3 变成按种子程序化生成的 12×12**（144 个区域）。
 * 为什么改（用户反馈 + 一份外部评审）：
 *   · 3×3 只有 9 格，"大世界"太小，而且 9 个地名是手写的 → 地理逻辑自相矛盾
 *     （"跨江"在北、"江北"在南，一条江横穿三行；老城被扔在角落；东郊紧贴市中心）
 *   · 危险度是手写的 → 出门往南是危险 5、往东是危险 2，梯度不成形
 *   · 没有"区域类型"的概念，地图上只能写 9 个名字，没法一眼看出哪片是工业区
 * 现在改成：
 *   · **区域类型**（与 M15 的 24×24 局部地图同一套词汇：城市核心/居民/城郊/工业/军事/农田/林地/水域/废墟）
 *     —— 地图格子按类型上色，一眼就能看出"这一带是工业区 / 那是农田"
 *   · **危险度严格按离主城的距离辐射递增**（中心安全区 → 外圈递进），再叠地形加成（军事/水域 +1）
 *   · **地名按类型 + 方位生成**（北岭/东郊/西林/南港…），保证不重名、且读起来像地名
 *   · **跨区可以一次开好几个格**（沿路网 BFS，水面上不能开），成本按跳数累加
 *
 * 兼容性：表是**按存档种子生成**的。老档里的区域 id（ember/dongjiao/…）在新表里不存在
 * → 统一落到主城（worldstate 的迁移逻辑会一并清掉按区域记的进度）。BETA 阶段允许。
 */
import seedrandom from 'seedrandom';
import { createNoise2D } from 'simplex-noise';

export type RegionType = 'core' | 'residential' | 'suburb' | 'industry' | 'military' | 'farm' | 'forest' | 'water' | 'ruins';

export interface RegionDef {
  id: string;
  name: string;          // 全名（"江北工业区"）
  short: string;         // 元地图格子里的短名（2~3 字）
  icon: string;
  col: number;           // 元地图列 0..REGION_COLS-1
  row: number;           // 元地图行 0..REGION_ROWS-1
  tier: number;          // 危险层级 1..5
  type: RegionType;      // M17：区域类型（决定上色、资源标签、生成主题）
  biomeBias: string;     // 传给 24×24 生成器的主题偏置
  desc: string;
  resources: string[];   // M17：这区能弄到什么（评审建议：地图上要有玩法暗示）
  homeBase: boolean;
  dist: number;          // 离主城的切比雪夫距离（UI 显示 + 危险度依据）
  firstEnter?: string;
}

/** 元地图尺寸：12×12 = 144 个区域（每个区域内部还是一张 24×24 的格子图） */
export const REGION_COLS = 12;
export const REGION_ROWS = 12;
/** 一次跨区最多开几格（12×12 的元地图里，一天的体力/一箱油最多跑 4 格 ≈ 100 公里；再远得中途落脚） */
export const MAX_HOPS = 4;

export const TYPE_INFO: Record<RegionType, { label: string; color: string; biomeBias: string; icon: string; resources: string[]; desc: string[] }> = {
  core: {
    label: '城市核心', color: '#4e5566', biomeBias: 'city', icon: '🏙️',
    resources: ['超市', '医院', '警局', '写字楼'],
    desc: ['高楼和商铺挤在一起的旧市中心，物资最全，也最挤。', '商业街的橱窗还亮着应急灯，玻璃后面全是人影。'],
  },
  residential: {
    label: '居民区', color: '#3c414e', biomeBias: 'city', icon: '🏢',
    resources: ['公寓', '学校', '诊所', '布料'],
    desc: ['成片的居民楼与学校，药品、布料、罐头都藏在楼道里。', '阳台上晾着没人收的衣服，风一吹像有人在招手。'],
  },
  suburb: {
    label: '城郊', color: '#404b47', biomeBias: 'transit', icon: '🏘️',
    resources: ['超市', '加油站', '修车铺'],
    desc: ['城市边缘的住宅与沿街小店，是出城前最后一块补给带。', '路灯下停着一排没开走的车，钥匙都还在。'],
  },
  industry: {
    label: '工业区', color: '#5f452f', biomeBias: 'industrial', icon: '🏭',
    resources: ['物流园', '建材', '燃料', '汽修'],
    desc: ['厂房、仓库、物流园连成一片，材料与燃料最多，毒气也最多。', '厂区广播还在循环一段没人听的疏散通知。'],
  },
  military: {
    label: '军事管制', color: '#5f3336', biomeBias: 'military', icon: '🪖',
    resources: ['军械', '弹药', '防化装备'],
    desc: ['铁丝网、哨塔和成排的装甲残骸。越线者按感染者处理。', '路障上的字还没被雨水冲掉：「越线者按感染者处理」。'],
  },
  farm: {
    label: '农田', color: '#5e5b34', biomeBias: 'farm', icon: '🌾',
    resources: ['粮食', '种子', '柴油'],
    desc: ['成片的农田和谷仓——种子、粮食、柴油，还有守田的人。', '田埂上插着一排木牌，每块都写着同一个日期：爆发那天。'],
  },
  forest: {
    label: '林地山区', color: '#33503a', biomeBias: 'forest', icon: '⛰️',
    resources: ['木材', '草药', '野味'],
    desc: ['林场、隧道和采石场。木头管够，活人比丧尸更值得提防。', '伐木道边的树被砍了一整排，切口还是新的。'],
  },
  water: {
    label: '水域港区', color: '#2a4a6d', biomeBias: 'water', icon: '🌊',
    resources: ['渔获', '净化片', '潜水点'],
    desc: ['码头、滩涂和被潮水泡过的仓库，水产丰富，水里也不干净。', '防波堤上有人用油漆刷了三个字：「别上船」。'],
  },
  ruins: {
    label: '废墟', color: '#4b4650', biomeBias: 'ruins', icon: '🏚️',
    resources: ['拆解材料', '拾荒者据点'],
    desc: ['塌了一半的旧街区，钢筋和木料遍地，也是最容易迷路的地方。', '楼板塌成斜坡，下面压着别人的半辆车。'],
  },
};

const SUFFIX: Record<RegionType, string[]> = {
  core: ['市中心', '老城区', '商业街', '中心广场'],
  residential: ['居民区', '新村', '街坊', '学区'],
  suburb: ['城郊', '开发区', '环城带', '近郊'],
  industry: ['工业区', '化工园', '物流城', '厂区'],
  military: ['军管区', '靶场', '检查站', '营地'],
  farm: ['农场带', '粮仓区', '农垦区', '屯垦区'],
  forest: ['山区', '林场', '采石场', '林岭'],
  water: ['港区', '码头', '滩涂', '水库'],
  ruins: ['遗址', '废墟区', '旧街区', '棚户区'],
};

/* 元地图格子里显示的**短名**：统一"1 字方位 + 2 字地貌"（如 北化工 / 西粮仓 / 东码头）。
   上一版是"把全名截前 3 个字"，截出来的是「北西废」「北西日」这种半截词——用户截图里的评审
   骂得对（"听起来像在骂人"）。短名单独维护一张表，就不会再截断到一半。 */
/* 短名词表：每种类型 18 个**意义上彼此分得开**的两字词。
   M17.3 扩表的原因（评审 #4）：上一版虽然只剩十来个重名，但同类型的词太像
   （"林区/林场/林岭/林海"四个都是林、"天井/胡同"各出现两次），读起来还是一片复制粘贴——
   换成"枯木/野径/断崖/采石…"这种一眼能区分的地貌词，并把"同一个词"也纳入去重。 */
const SHORT_WORD: Record<RegionType, string[]> = {
  core: ['市中', '老城', '商街', '广场', '中央', '商埠', '钟楼', '旧署', '十字', '牌楼', '市集', '城隍', '骑楼', '大戏', '钟塔', '礼堂', '公署', '宿站'],
  residential: ['居民', '新村', '学区', '街坊', '公寓', '里弄', '宿舍', '家园', '楼群', '胡同', '住宅', '坊巷', '单元', '天井', '筒子', '院落', '门洞', '晾台'],
  suburb: ['城郊', '近郊', '环城', '开发', '新区', '外围', '城乡', '驿道', '匝口', '道口', '集散', '货场', '站前', '货栈', '堆场', '棚圈', '路障', '车场'],
  industry: ['厂区', '化工', '物流', '工业', '仓储', '机修', '冶炼', '建材', '铸造', '纸厂', '油库', '钢构', '装配', '窑厂', '焦化', '水泥', '冷库', '车间'],
  military: ['靶场', '营地', '哨卡', '军管', '封锁', '禁区', '哨塔', '屯兵', '工事', '雷达', '仓场', '检查', '驻地', '军械', '雷区', '碉堡', '跑道', '军港'],
  farm: ['农场', '粮仓', '农垦', '田庄', '果园', '牧点', '大棚', '菜地', '猪场', '渔塘', '苗圃', '晒场', '油坊', '桑田', '麦垄', '稻场', '蜂场', '药圃'],
  forest: ['林场', '山区', '采石', '林岭', '山道', '松岭', '矿口', '林区', '杉岭', '崖口', '伐区', '山坳', '峡口', '林海', '枯木', '野径', '断崖', '火道'],
  water: ['港区', '码头', '滩涂', '水库', '渔港', '船坞', '堤岸', '滩头', '渡口', '闸口', '海湾', '栈桥', '沙洲', '溢洪', '暗渠', '礁石', '锚地', '闸门'],
  ruins: ['遗址', '废址', '棚户', '旧街', '危楼', '塌区', '空城', '残垣', '断桥', '焦土', '瓦砾', '塌楼', '无名', '灰区', '废井', '断墙', '荒场', '旧站'],
};
/** 方位词：按该区域相对主城的方位挑（地图像真地名，而不是"区域 7"） */
const dirWord = (dx: number, dy: number): string => {
  const ns = dy <= -3 ? '北' : dy >= 3 ? '南' : '';
  const ew = dx <= -3 ? '西' : dx >= 3 ? '东' : '';
  if (ns + ew) return ns + ew;
  if (dy < 0) return '北';
  if (dy > 0) return '南';
  if (dx < 0) return '西';
  if (dx > 0) return '东';
  return '中';
};

/** 每种区域"第一次踏进去"的一句话（主城除外） */
const FIRST_ENTER: Record<RegionType, string> = {
  core: '这里的十字路口还留着事故当天的车流，一辆都没动。',
  residential: '楼道口的公告栏贴着最后一张通知，字迹被雨泡花了。',
  suburb: '沿街卷帘门全拉着，只有一家小卖部的灯还亮着。',
  industry: '厂区广播还在循环一段没人听的疏散通知。',
  military: '路障上的字还没被雨水冲掉：「越线者按感染者处理」。',
  farm: '田埂上插着一排木牌，每块都写着同一个日期：爆发那天。',
  forest: '伐木道边的树被砍了一整排，切口还是新的。',
  water: '防波堤上有人用油漆刷了三个字：「别上船」。',
  ruins: '楼板塌成斜坡，下面压着别人的半辆车。',
};

/* ── 元地图的生成：和 24×24 局部地图同一套思路（分带 → 平滑 → 合并小碎块 → 硬约束）──
 * M17.1 重做：上一版是**每格独立摇号**，结果就是用户截图里那份评审说的"把大富翁棋盘放进搅拌机"——
 * 居民区隔壁是化工园、农田和军管区像打地鼠一样散落，色块呈马赛克状（"光敏性癫痫"）。
 * 现在的做法：
 *   ① 地理大势：主城居中、海岸占满一整侧、山地/军管锁在对角
 *   ② 按"离主城的圈数"分带（0 核心 / 1 居民 / 2 居民·城郊 / 3 城郊·工业 / 4 工业·农田·废墟 / 5+ 农田·林地·废墟）
 *      带的边界用**绕圈采样的连续噪声**扰动（±1 圈），所以城市不是同心圆，而是不规则的团块
 *   ③ 带内选类型用**同一张平滑噪声场**：空间上连续 → 相邻格子倾向选同一个类型 → 自然成片
 *   ④ 3 轮元胞自动机平滑（8 邻域取多数）+ 合并 <3 格的碎块
 *   ⑤ 硬约束收尾：工业区不与城市核心相邻、核心只在 2 圈内、农田/林地不在 2 圈内、军管只在山地那一角
 * ①~⑤ 全部只依赖 seed，同一存档每次生成的地图完全一致。 */
const MOUNT_W = 3, MOUNT_H = 3;          // 山地/军管那一角占 3×3 个区域

/* 每个"带"里各类型占多少（按该带内噪声值排序后切片 → 既有比例控制，又成片）：
   0 核心 / 1 居民 · 2 居民+城郊 / 3 工业带 · 4 近郊混合 / 5 远郊农林 */
const BAND_PLAN: Record<number, [RegionType, number][]> = {
  1: [['core', 0.35], ['residential', 0.65]],
  2: [['residential', 0.35], ['suburb', 0.45], ['ruins', 0.2]],
  3: [['industry', 0.45], ['suburb', 0.3], ['ruins', 0.25]],
  4: [['farm', 0.35], ['suburb', 0.25], ['industry', 0.15], ['ruins', 0.25]],
  5: [['farm', 0.4], ['forest', 0.25], ['ruins', 0.35]],
};

export function buildRegions(seed: string): RegionDef[] {
  const rng = seedrandom(seed + ':regions');
  const nz = createNoise2D(seedrandom(seed + ':regions-zone'));
  const na = createNoise2D(seedrandom(seed + ':regions-angle'));
  const nc = createNoise2D(seedrandom(seed + ':regions-coast'));
  const homeCol = Math.floor(REGION_COLS / 2) - 1 + Math.floor(rng() * 2);
  const homeRow = Math.floor(REGION_ROWS / 2) - 1 + Math.floor(rng() * 2);
  /* 两个"地理大势"：一条海岸（东/南边）和一片山地（对角）——水与林不会随机乱撒，
     而是像真实地图那样占掉一整侧/一角。 */
  const coastSide = rng() < 0.5 ? 'east' : 'south';
  const mountSide = coastSide === 'east' ? 'northwest' : 'northeast';
  const used: Record<string, number> = {};
  const usedShort: Record<string, number> = {};
  /* 危险度要铺满 1..5 整档，所以按"到主城的最远距离"归一化——
     12×12 里主城在中心时最远只有 6 格，用固定除数会让全图最高只有危险 4（评审 #2 说的"角落也很安全"）。 */
  const maxDist = Math.max(homeCol, REGION_COLS - 1 - homeCol, homeRow, REGION_ROWS - 1 - homeRow);

  const at = (c: number, r: number) => (c >= 0 && c < REGION_COLS && r >= 0 && r < REGION_ROWS ? r * REGION_COLS + c : -1);
  const coord = (i: number) => ({ c: i % REGION_COLS, r: Math.floor(i / REGION_COLS) });
  const distOf = (c: number, r: number) => Math.max(Math.abs(c - homeCol), Math.abs(r - homeRow));
  const isCoast = (c: number, r: number) => (coastSide === 'east' ? c === REGION_COLS - 1 : r === REGION_ROWS - 1);
  const isMount = (c: number, r: number) => (mountSide === 'northwest'
    ? (c < MOUNT_W && r < MOUNT_H) : (c >= REGION_COLS - MOUNT_W && r < MOUNT_H));
  const NB8: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const NB4: [number, number][] = [[0, -1], [-1, 0], [1, 0], [0, 1]];

  const N = REGION_COLS * REGION_ROWS;
  const type: (RegionType | null)[] = new Array(N).fill(null);
  /** 短名去重用的"同名格子在哪"（M17.2：优先避开 2 格以内的重名，其次才看全图用量） */
  const placedShort: Record<string, { c: number; r: number }[]> = {};
  /** M17.3：同一个"地貌词"（不含方位）出现的位置 + 用量——避免"北天井/南天井"贴在一起 */
  const wordAt: Record<string, { c: number; r: number }[]> = {};
  const wordUse: Record<string, number> = {};

  /* ① 海岸与山角：先钉死，后面的平滑不许动它们 */
  const fixed = new Array<boolean>(N).fill(false);
  for (let r = 0; r < REGION_ROWS; r++) for (let c = 0; c < REGION_COLS; c++) {
    /* 最外一整侧是海；再让沿岸的平滑噪声啃掉第二列的一部分 → 海岸线有湾，不是一条直尺 */
    const depth = coastSide === 'east' ? REGION_COLS - 1 - c : REGION_ROWS - 1 - r;
    const along = coastSide === 'east' ? r : c;
    if (depth === 0 || (depth === 1 && nc(along * 0.45, 3.3) > 0.05)) { type[at(c, r)] = 'water'; fixed[at(c, r)] = true; }
  }
  /* 山角：整块林地，里面嵌一小片军管区（靶场/检查站），并且**必须成片** */
  const milSeed = { c: mountSide === 'northwest' ? 0 : REGION_COLS - 1, r: 1 };
  for (let r = 0; r < MOUNT_H; r++) for (let c = 0; c < MOUNT_W; c++) {
    const cc = mountSide === 'northwest' ? c : REGION_COLS - 1 - c;
    if (fixed[at(cc, r)]) continue;
    /* 军管区是角落里的**一小块**（2×2），其余是林地——上一版 6 格军管把半个山角都占了 */
    const inMil = Math.max(Math.abs(cc - milSeed.c), Math.abs(r - milSeed.r)) <= 1 && r <= 1;
    type[at(cc, r)] = inMil ? 'military' : 'forest';
    fixed[at(cc, r)] = true;
  }
  type[at(homeCol, homeRow)] = 'core';
  fixed[at(homeCol, homeRow)] = true;

  /* ② 分带（绕主城取连续噪声扰动 ±1 圈，所以城市是不规则团块而不是同心圆）
     ③ 带内按噪声值排序切片分类型：比例可控 + 空间连续 → 同类自然成片 */
  const cells: number[] = [];
  const bandOf = new Map<number, number>();
  const uOf = new Map<number, number>();
  for (let r = 0; r < REGION_ROWS; r++) {
    for (let c = 0; c < REGION_COLS; c++) {
      const i = at(c, r);
      if (fixed[i] || type[i]) continue;
      const d = distOf(c, r);
      const dx = (c - homeCol) / Math.max(1, d), dy = (r - homeRow) / Math.max(1, d);
      const ang = na(dx * 1.4, dy * 1.4);
      const shift = ang > 0.42 ? 1 : ang < -0.42 ? -1 : 0;
      bandOf.set(i, Math.max(1, Math.min(5, d - 1 + shift)));
      uOf.set(i, nz(c * 0.36, r * 0.36));
      cells.push(i);
    }
  }
  for (const band of [1, 2, 3, 4, 5]) {
    const group = cells.filter(i => bandOf.get(i) === band).sort((a, b) => uOf.get(a)! - uOf.get(b)!);
    if (!group.length) continue;
    const plan = BAND_PLAN[band];
    let idx = 0;
    for (let p = 0; p < plan.length; p++) {
      const n = p === plan.length - 1 ? group.length - idx : Math.round(group.length * plan[p][1]);
      for (let k = 0; k < n && idx < group.length; k++, idx++) type[group[idx]] = plan[p][0];
    }
    while (idx < group.length) type[group[idx++]] = plan[plan.length - 1][0];
  }

  /* ④ 元胞自动机平滑：只在"邻居里压倒性多数"时才改（≥5/8），跑 2 轮。
     为什么这么保守：第一版跑 3 轮无门槛多数派，结果居民区把工业带、农田、废墟全吃了
     （144 格里 56 格变成居民区、农田只剩 3 格）——平滑是为了去椒盐，不是重新分配城市。
     水面也不许"长"出来：没临海的非水格子不可能被邻居投票成水。 */
  const neighbors = (i: number, nb: [number, number][]) => {
    const { c, r } = coord(i);
    return nb.map(([ox, oy]) => at(c + ox, r + oy)).filter(j => j >= 0);
  };
  for (let pass = 0; pass < 1; pass++) {
    const next = type.slice();
    for (let i = 0; i < N; i++) {
      if (fixed[i]) continue;
      const cnt: Partial<Record<RegionType, number>> = {};
      for (const j of neighbors(i, NB8)) if (type[j]) cnt[type[j]!] = (cnt[type[j]!] ?? 0) + 1;
      for (const k in cnt) {
        const n = cnt[k as RegionType]!;
        if (k === 'water' && type[i] !== 'water') continue;            // 水不扩散
        if (n >= 6 && n > (cnt[type[i]!] ?? 0)) { next[i] = k as RegionType; break; }
      }
    }
    for (let i = 0; i < N; i++) type[i] = next[i];
  }
  /* 合并 <3 格的同类碎块：整块并进"接壤边界最长"的邻居类型（和 24×24 局部地图同一招）。
     孤立格/双格碎块是"色块马赛克"的最后来源，这一趟跑完，图上就只剩成片的区域了。
     两条护栏（都是踩出来的）：
       · **保底**：某类型已经少于下限时，不许把它的小块并掉——第一版没这道闸，废墟被并到 0 格，
         而第 5 章的目标正好是「到访一处废墟」，主线直接死锁；
       · **封顶**：接壤最多的那类如果已经超出上限，就退而选第二多的——不然居民区会把全图吃掉。
     不动的：水面、军管/山角、城市核心（CBD 不能并进居民区）。 */
  const MIN_COUNT: Record<RegionType, number> = {
    core: 2, residential: 12, suburb: 10, industry: 8, military: 3, farm: 8, forest: 5, water: 8, ruins: 8,
  };
  const MAX_COUNT: Record<RegionType, number> = {
    core: 8, residential: 44, suburb: 40, industry: 24, military: 6, farm: 30, forest: 24, water: 40, ruins: 34,
  };
  const typeCount = () => {
    const c: Partial<Record<RegionType, number>> = {};
    for (const t of type) if (t) c[t] = (c[t] ?? 0) + 1;
    return c;
  };
  const mergeSmallPatches = (minSize = 3) => {
    for (let round = 0; round < 4; round++) {
      const counts = typeCount();
      const seen = new Array<boolean>(N).fill(false);
      let merged = false;
      for (let i = 0; i < N; i++) {
        if (seen[i] || !type[i]) continue;
        const t = type[i]!;
        const comp: number[] = [];
        const stack = [i];
        seen[i] = true;
        while (stack.length) {
          const k = stack.pop()!;
          comp.push(k);
          for (const j of neighbors(k, NB4)) if (!seen[j] && type[j] === t) { seen[j] = true; stack.push(j); }
        }
        if (comp.length >= minSize) continue;
        if (comp.some(k => fixed[k]) || t === 'water' || t === 'core') continue;
        if ((counts[t] ?? 0) <= MIN_COUNT[t]) continue;                  // 保底：稀有的类型不并
        const cnt: Partial<Record<RegionType, number>> = {};
        for (const k of comp) for (const j of neighbors(k, NB4)) {
          if (comp.indexOf(j) >= 0 || !type[j] || type[j] === t) continue;
          const nt = type[j]!;
          if (nt === 'water') continue;                       // 陆地不并进海里
          cnt[nt] = (cnt[nt] ?? 0) + 1;
        }
        let best: RegionType | null = null, bestN = 0;
        for (const k in cnt) {
          const nt = k as RegionType, n = cnt[nt]!;
          if ((counts[nt] ?? 0) >= MAX_COUNT[nt]) continue;    // 封顶：已经太大的类型不再接盘
          if (n > bestN) { best = nt; bestN = n; }
        }
        if (!best) continue;
        for (const k of comp) type[k] = best;
        counts[best] = (counts[best] ?? 0) + comp.length;
        counts[t] = (counts[t] ?? 0) - comp.length;
        merged = true;
      }
      if (!merged) break;
    }
  };
  mergeSmallPatches();

  /* CBD 只能有一片：城市核心必须是连在一起的一团（主城所在那团），其余孤立的"核心"降级成居民区。
     不这么做的话，地图上会冒出好几个互不相邻的"市中心"，看着就像随机撒的。 */
  const unifyCore = () => {
    const seen = new Array<boolean>(N).fill(false);
    const comps: number[][] = [];
    for (let i = 0; i < N; i++) {
      if (seen[i] || type[i] !== 'core') continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = true;
      while (stack.length) {
        const k = stack.pop()!;
        comp.push(k);
        for (const j of neighbors(k, NB4)) if (!seen[j] && type[j] === 'core') { seen[j] = true; stack.push(j); }
      }
      comps.push(comp);
    }
    if (comps.length <= 1) return;
    const homeIdx = at(homeCol, homeRow);
    comps.sort((a, b) => (b.indexOf(homeIdx) >= 0 ? 1 : 0) - (a.indexOf(homeIdx) >= 0 ? 1 : 0) || b.length - a.length);
    for (const comp of comps.slice(1)) for (const k of comp) type[k] = 'residential';
  };
  unifyCore();

  /* ⑤ 硬约束收尾（评审给的那几条"缰绳"）：
        · 工业区不与城市核心相邻（居民不用闻化工味）
        · 城市核心只在 2 圈内（老城不会长到外环）
        · 农田/林地不在 2 圈内（市中心不放牛）
        · 军管区只在山地那一角（前哨不会是城市飞地） */
  const inSet = (t: RegionType, set: RegionType[]) => set.indexOf(t) >= 0;
  for (let i = 0; i < N; i++) {
    if (fixed[i]) continue;
    const { c, r } = coord(i);
    const d = distOf(c, r);
    const t = type[i]!;
    if (t === 'industry' && neighbors(i, NB8).some(j => type[j] === 'core')) type[i] = d >= 3 ? 'ruins' : 'suburb';
    else if (t === 'core' && d > 2) type[i] = d <= 3 ? 'suburb' : 'ruins';
    else if (inSet(t, ['farm', 'forest']) && d <= 2) type[i] = 'suburb';
    else if (t === 'military' && !isMount(c, r)) type[i] = d >= 4 ? 'ruins' : 'industry';
  }
  mergeSmallPatches();          // 约束刚改过一批格子，再合并一次碎块

  const out: RegionDef[] = [];
  for (let r = 0; r < REGION_ROWS; r++) {
    for (let c = 0; c < REGION_COLS; c++) {
      const i = at(c, r);
      const dx = c - homeCol, dy = r - homeRow;
      const dist = distOf(c, r);
      const isHome = c === homeCol && r === homeRow;
      const t = type[i] ?? 'ruins';
      const info = TYPE_INFO[t];
      const dir = dirWord(dx, dy);
      /* 危险度：**严格按离主城的距离辐射递增**——主城与紧邻的一圈都是安全区（新手村），
         之后按圈数均匀铺满 1~5。M17.2 起**没有任何地形加成**：上一版给军管区 +1，
         结果它旁边一格能出现"4 挨着 2"的断崖（评审 #3 抓到的"平民砍柴一扭头就是哨塔"）。
         军管的可怕改为由区域内部的生成主题承担（军事 POI 更多、格子更危险）。 */
      const tier = isHome || dist <= 1 ? 1 : Math.max(1, Math.min(5, 1 + Math.round((dist / maxDist) * 4)));
      const key = dir + SUFFIX[t][Math.floor(rng() * SUFFIX[t].length)];
      used[key] = (used[key] ?? 0) + 1;
      const name = isHome ? '余烬市区' : key + (used[key] > 1 ? ' ' + used[key] + ' 号' : '');
      /* 短名 = 1 字方位 + 2 字地貌。挑词优先级（M17.3 加严）：
         ① 同一个**词**不要出现在 1 格以内（"北天井"旁边不该是"南天井"）
         ② 同一个"方位+词"不要出现在 2 格以内
         ③ 再看全图用量、最后随机 —— 词表 18 个，够铺满一层。 */
      const dir1 = dir.slice(0, 1);
      let short = dir1 + SHORT_WORD[t][0], bestScore = -Infinity;
      for (const w of SHORT_WORD[t]) {
        const cand = dir1 + w;
        const sameWordNear = (wordAt[w] ?? []).some(p => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= 1);
        const sameNameNear = (placedShort[cand] ?? []).some(p => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= 2);
        const score = (sameWordNear ? -100000 : 0) + (sameNameNear ? -1000 : 0)
          - (wordUse[w] ?? 0) * 10 - (usedShort[cand] ?? 0) + rng();
        if (score > bestScore) { short = cand; bestScore = score; }
      }
      usedShort[short] = (usedShort[short] ?? 0) + 1;
      wordUse[short.slice(1)] = (wordUse[short.slice(1)] ?? 0) + 1;
      (placedShort[short] = placedShort[short] ?? []).push({ c, r });
      (wordAt[short.slice(1)] = wordAt[short.slice(1)] ?? []).push({ c, r });
      const desc = info.desc[Math.floor(rng() * info.desc.length)];

      out.push({
        id: 'r' + c + '-' + r,
        name, short: isHome ? '余烬' : short, icon: isHome ? '🏠' : info.icon,
        col: c, row: r, tier, type: t, biomeBias: info.biomeBias,
        desc: isHome ? '你醒来的地方。超市、医院、警局都在这儿，安全屋也在。' : desc,
        resources: info.resources, homeBase: isHome, dist,
        /* 每个非主城区域第一次踏进去都有一句固定叙事（跨区是有仪式感的事，不该只有几个类型才有） */
        firstEnter: isHome ? undefined : FIRST_ENTER[t],
      });
    }
  }
  return out;
}

/** 当前生效的元地图（按存档种子生成，worldstate / worldOf 会调用 setActiveRegions 对齐） */
export let REGIONS: RegionDef[] = buildRegions('ember-01');
export let HOME_REGION = REGIONS.find(r => r.homeBase)?.id ?? 'r5-5';
let activeSeed = 'ember-01';

/** 切换当前种子对应的元地图（就地替换数组内容，外部持有的引用同样生效） */
export function setActiveRegions(seed: string): void {
  if (seed === activeSeed) return;
  activeSeed = seed;
  const table = buildRegions(seed);
  REGIONS.length = 0;
  for (const r of table) REGIONS.push(r);
  HOME_REGION = table.find(r => r.homeBase)?.id ?? table[0].id;
}

export const META_COLS = REGION_COLS;
export const META_ROWS = REGION_ROWS;

export const regionById = (id: string): RegionDef | null => REGIONS.find(r => r.id === id) ?? null;
export const regionName = (id: string): string => regionById(id)?.name ?? id;
export const homeRegion = (): RegionDef => regionById(HOME_REGION) ?? REGIONS[0];

/** 每个区域一张独立的 24×24 世界：seed 由基础种子派生（同一存档每次进来都一样） */
export const regionSeed = (baseSeed: string, regionId: string): string => baseSeed + '::' + regionId;

/** 元地图上两区是否相邻（含斜向） */
export function areAdjacent(a: RegionDef, b: RegionDef): boolean {
  const dx = Math.abs(a.col - b.col), dy = Math.abs(a.row - b.row);
  return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
}

/* 一格的成本：正交 2 行动力 + 2 油；斜向 3 + 3（要绕路）。
   为什么是 2 而不是 3：行动力上限只有 9（安全屋睡满）——按 3/4 算，一次跨区最多只能开 2 格，
   12×12 的世界就走不动了（用户要的是"大世界"，不是"家门口"）。2 行动力/格 ≈ 4 格/天，够走到临省。 */
export const stepCost = (diag: boolean) => (diag ? { ap: 3, fuel: 3 } : { ap: 2, fuel: 2 });

export interface TravelCtx {
  hasVehicle: boolean;
  fuel: number;
  ap: number;
  apMax: number;
  from: string;
  to: string;
}

export interface RegionTrip {
  ok: boolean;
  why?: string;
  hint?: string;
  hops: number;          // 沿路走几格（0 = 原地）
  ap: number;
  fuel: number;
  danger: number;
  path: string[];        // 途经区域 id（含终点）
}

/* 区域图上的行车路线：BFS 最短路，**水面只是绕不过去，但可以开进去**——
   港区/码头沿海而建，沿海公路通到堤岸上（不然水域那一片资源和第 5 章「到访水域」永远做不完）；
   但水面不能当"过路通道"：去陆地区域的路上绝不会出现水域。
   例外：海岸线是有湾的（第二列也可能是海），所以"开到深处那个港区"允许沿海南北向贴着水走一段——
   此时才放宽水格中转（只对水域目的地生效）。 */
export function regionPath(from: string, to: string): RegionDef[] | null {
  const a = regionById(from), b = regionById(to);
  if (!a || !b || a.id === b.id) return null;
  const bfs = (waterThrough: boolean): RegionDef[] | null => {
    const prev: Record<string, string> = {};
    const seen: Record<string, 1> = { [a.id]: 1 };
    const q: RegionDef[] = [a];
    while (q.length) {
      const cur = q.shift()!;
      for (const nb of REGIONS) {
        if (seen[nb.id] || !areAdjacent(cur, nb)) continue;
        const isTarget = nb.id === b.id;
        if (nb.type === 'water' && !isTarget && !waterThrough) continue;   // 过路不行，终点可以（堤岸/码头）
        seen[nb.id] = 1; prev[nb.id] = cur.id;
        if (isTarget) {
          const out: RegionDef[] = [nb];
          let k = nb.id;
          while (prev[k]) { const p = regionById(prev[k])!; out.unshift(p); k = prev[k]; }
          return out;
        }
        q.push(nb);
      }
    }
    return null;
  };
  return bfs(false) ?? (b.type === 'water' ? bfs(true) : null);
}

/** 元地图上的行程报价：沿 BFS 路线累加每格成本 */
export function regionTravelCost(from: RegionDef, to: RegionDef): { hops: number; ap: number; fuel: number } {
  const path = regionPath(from.id, to.id);
  if (!path || path.length < 2) {
    /* 直线估算（拿不到路线时给个近似值，UI 仍会以 planRegionTrip 的结论为准） */
    const steps = Math.max(Math.abs(from.col - to.col), Math.abs(from.row - to.row));
    const diag = Math.min(Math.abs(from.col - to.col), Math.abs(from.row - to.row));
    const c = stepCost(diag > 0);
    return { hops: steps, ap: c.ap * steps, fuel: c.fuel * steps };
  }
  let ap = 0, fuel = 0;
  for (let i = 1; i < path.length; i++) {
    const diag = path[i].col !== path[i - 1].col && path[i].row !== path[i - 1].row;
    const c = stepCost(diag);
    ap += c.ap; fuel += c.fuel;
  }
  return { hops: path.length - 1, ap, fuel };
}

/** 跨区能不能走：没车 / 没路 / 太远 / 没油 / 没行动力，各给一句人话理由 */
export function planRegionTrip(ctx: TravelCtx): RegionTrip {
  const from = regionById(ctx.from), to = regionById(ctx.to);
  if (!from || !to) return { ok: false, why: '区域不存在', hops: 0, ap: 0, fuel: 0, danger: 0, path: [] };
  if (from.id === to.id) return { ok: false, why: '你已经在' + to.name + '了', hops: 0, ap: 0, fuel: 0, danger: to.tier, path: [] };
  const c = regionTravelCost(from, to);
  const base = { hops: c.hops, ap: c.ap, fuel: c.fuel, danger: to.tier, path: (regionPath(from.id, to.id) ?? []).map(r => r.id) };
  if (!ctx.hasVehicle) {
    return { ...base, ok: false, why: '这段路有 ' + Math.round(c.hops * 20) + ' 公里，靠两条腿走不到', hint: '先找辆车：汽车修理厂/物流园里有能修的车（地图上带 🔧 的地方）' };
  }
  if (!base.path.length) {
    return { ...base, ok: false, why: to.name + '开车过不去', hint: '中间隔着水域（港区/水库），得绕别的路——在地图上点中间的区域看看' };
  }
  if (c.hops > MAX_HOPS) {
    return { ...base, ok: false, why: '太远了（要开 ' + c.hops + ' 格，一箱油跑不到）', hint: '一次最多开 ' + MAX_HOPS + ' 格：先开到中途的区域落脚，再往那边走' };
  }
  if (ctx.fuel < c.fuel) {
    return { ...base, ok: false, why: '油不够（需要 ' + c.fuel + '，车里有 ' + ctx.fuel + '）', hint: '去加油站或物流园抽油，或者用燃料桶补' };
  }
  if (ctx.ap < c.ap) {
    return { ...base, ok: false, why: '行动力不够（需要 ' + c.ap + '，现在 ' + ctx.ap + '）', hint: '回安全屋睡一觉再出发' };
  }
  return { ...base, ok: true };
}

/** 元地图渲染用的矩阵（UI 直接拿去画格子）。按坐标查表而不是每格 find 一遍（144×144 太浪费） */
export function metaGrid(): (RegionDef | null)[][] {
  const at: Record<string, RegionDef> = {};
  for (const r of REGIONS) at[r.col + ',' + r.row] = r;
  const g: (RegionDef | null)[][] = [];
  for (let r = 0; r < REGION_ROWS; r++) {
    const row: (RegionDef | null)[] = [];
    for (let c = 0; c < REGION_COLS; c++) row.push(at[c + ',' + r] ?? null);
    g.push(row);
  }
  return g;
}

/** 相邻区域（含斜向） */
export const neighborsOf = (id: string): RegionDef[] => {
  const a = regionById(id);
  return a ? REGIONS.filter(b => b.id !== id && areAdjacent(a, b)) : [];
};

/** 危险层级 → 文案（地图面板显示用） */
export const dangerLabel = (tier: number): string =>
  tier <= 1 ? '安全区' : tier === 2 ? '有些麻烦' : tier === 3 ? '危险' : tier === 4 ? '很危险' : '九死一生';

/** 危险层级 → 颜色：格子上那条底边用它上色，一眼看出"危险度是往外涨的"（绿→黄→红） */
export const DANGER_COLORS = ['#78c98a', '#c6d06a', '#e0b45c', '#e08a5c', '#ef6f6f'];
export const dangerColor = (tier: number): string => DANGER_COLORS[Math.max(1, Math.min(5, Math.round(tier))) - 1];

/** 类型 → 颜色（地图格子用；与 24×24 局部地图同一套地表色） */
export const typeColor = (t: RegionType): string => TYPE_INFO[t].color;
export const typeLabel = (t: RegionType): string => TYPE_INFO[t].label;

/** 图例用的类型顺序（城 → 乡 → 野 → 水，读起来像一张地图的图例） */
export const REGION_TYPES: RegionType[] = ['core', 'residential', 'suburb', 'industry', 'military', 'farm', 'forest', 'ruins', 'water'];

/** 短名词表（单测拿它校验"地图上的短名不是把全名截一半"，例如不该再出现「北西废」） */
export const REGION_SHORT_WORD: Record<RegionType, string[]> = SHORT_WORD;
