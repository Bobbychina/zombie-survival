/* 区域事件（M18）——纯逻辑：进一片区域时会撞上什么。
 *
 * 起因（评审 #4 的建议原话）：
 *   "既然地图区块做好了，可以在里面填上随机事件。比如'西工业区'有概率触发毒气泄漏、
 *    '北军管'有概率捡到高级武器，让死板的网格活起来。"
 * 设计要点：
 *   · 事件按**区域类型**给（工业区漏毒气、农田有野猪、废墟会塌方…），而不是全图一套随机表——
 *     这样"看颜色就知道自己要冒什么险"，地貌分区才真正参与玩法
 *   · 概率与**危险度**挂钩：安全区只会遇到好事/无事的插曲，越往外越容易出事
 *   · 效果只允许小幅、可解释的增减（血/行动力/材料/物品），并且**安全区永远不受伤**
 *   · 纯函数：同样的 (类型, 危险度, 天数, 随机序列) → 同样的事件，方便测试与回放
 */
import { type RegionType } from './regions-core';

export type RegionEventKind = 'hazard' | 'loot' | 'encounter' | 'flavor';

export interface RegionEvent {
  id: string;
  title: string;
  text: string;
  kind: RegionEventKind;
  hp?: number;      // 负 = 受伤（永不为正：事件不直接治疗，治疗归医疗用品）
  ap?: number;      // 行动力增减（负 = 耽误时间）
  mat?: number;     // 材料增减
  item?: string;    // 物品 id（必须在 legacy ITEMS 里存在）
  n?: number;
}

/** 每个区域类型的事件池：hazard 会掉血，loot/flavor 是收益或氛围 */
export const REGION_EVENTS: Record<RegionType, RegionEvent[]> = {
  core: [
    { id: 'core-supermarket', title: '超市残货', text: '一家被翻过三遍的超市，货架底下还压着没拆封的东西。', kind: 'loot', item: 'can', n: 2 },
    { id: 'core-horde', title: '街口尸群', text: '十字路口的车流里钻出十几张脸——它们还认得活人的味道。', kind: 'hazard', hp: -12, ap: -1 },
    { id: 'core-radio', title: '循环广播', text: '市政喇叭还在念撤离路线，念到一半就跳回开头。你记下了两个地名。', kind: 'flavor' },
    { id: 'core-pharmacy', title: '药房后门', text: '卷帘门被人撬开过，处方柜里剩了几包没拿走的药。', kind: 'loot', item: 'bandage', n: 2 },
  ],
  residential: [
    { id: 'res-survivor', title: '敲窗的人', text: '三楼有人敲窗，用手势比划着要换点吃的——他给你一卷胶带。', kind: 'encounter', item: 'tape', n: 2 },
    { id: 'res-gas', title: '楼道煤气', text: '有人走的时候没关煤气，你划亮火柴的那一秒才想起来。', kind: 'hazard', hp: -10 },
    { id: 'res-closet', title: '壁橱', text: '壁橱里挂着一排没穿过的大衣，口袋里有零钱和一把钥匙。', kind: 'loot', item: 'cloth', n: 3 },
    { id: 'res-flavor', title: '晾台', text: '阳台上的衣服还在风里摆，主人大概再也不会回来收。', kind: 'flavor' },
  ],
  suburb: [
    { id: 'sub-roadblock', title: '路障', text: '一排翻倒的隔离墩挡住半条路，你得把车挪开才过得去。', kind: 'encounter', ap: -1 },
    { id: 'sub-fuel', title: '抛锚的车', text: '一辆车横在路边，油箱里还抽得出小半桶。', kind: 'loot', item: 'fuel', n: 2 },
    { id: 'sub-strays', title: '游荡者', text: '沿街的卷帘门后面有东西在跟着你走，一直跟到路口。', kind: 'hazard', hp: -8 },
    { id: 'sub-flavor', title: '小卖部', text: '小卖部的灯还亮着，是太阳能在硬撑。', kind: 'flavor' },
  ],
  industry: [
    { id: 'ind-gas', title: '毒气泄漏', text: '管廊在漏气，那种甜腥味一进鼻子就开始烧。你憋着气往外跑。', kind: 'hazard', hp: -14 },
    { id: 'ind-blast', title: '管道爆燃', text: '厂区里的残压突然炸开，冲击波把你掀到墙上。', kind: 'hazard', hp: -16 },
    { id: 'ind-warehouse', title: '夜班仓库', text: '仓库门虚掩着，里面整箱的建材没人来得及拉走。', kind: 'loot', item: 'metal', n: 4 },
    { id: 'ind-parts', title: '机修间', text: '机修间的工具箱还锁着，撬开是一堆能用的零件。', kind: 'loot', item: 'chip', n: 2 },
  ],
  military: [
    { id: 'mil-cache', title: '军械箱', text: '哨位下面压着一只没撬开的军械箱——你撬开了它。', kind: 'loot', item: 'ammo', n: 12 },
    { id: 'mil-drone', title: '巡逻无人机', text: '一架无人机在头顶盘旋，然后俯冲下来扫了一梭子。', kind: 'hazard', hp: -15 },
    { id: 'mil-mine', title: '雷区边线', text: '铁丝网后面插着褪色的雷区牌，你退回去的时候踩空了。', kind: 'hazard', hp: -12 },
    { id: 'mil-filter', title: '防化柜', text: '防化柜被撬开过，里面还剩一只完好的滤罐。', kind: 'loot', item: 'gasmask', n: 1 },
  ],
  farm: [
    { id: 'farm-boar', title: '野猪群', text: '田里窜出一群野猪，它们比你更饿，也更不讲道理。', kind: 'hazard', hp: -11 },
    { id: 'farm-granary', title: '粮囤', text: '粮囤底下那层没受潮，你装满了一包。', kind: 'loot', item: 'can', n: 3 },
    { id: 'farm-well', title: '老井', text: '井水还清，你灌满了两瓶。', kind: 'loot', item: 'water', n: 2 },
    { id: 'farm-flavor', title: '田埂', text: '田埂上的木牌写着同一个日期，字迹被雨泡花了。', kind: 'flavor' },
  ],
  forest: [
    { id: 'for-wolves', title: '狼群', text: '林子里窸窸窣窣围过来一圈影子——不是丧尸，是更饿的东西。', kind: 'hazard', hp: -13 },
    { id: 'for-camp', title: '伐木营地', text: '伐木队的营地里堆着成材，锯子还插在木头上。', kind: 'loot', item: 'wood', n: 5 },
    { id: 'for-slide', title: '山体滑坡', text: '整段路基垮了下来，你滚进沟里，背包也丢了一半。', kind: 'hazard', hp: -12, mat: -5 },
    { id: 'for-herb', title: '药圃', text: '背阴坡上有人种过一片草药，长得比人还高。', kind: 'loot', item: 'painkiller', n: 2 },
  ],
  water: [
    { id: 'wat-storm', title: '涨潮', text: '潮水比你想的快，退路被淹了半公里，你只能蹚过去。', kind: 'hazard', hp: -9, ap: -1 },
    { id: 'wat-catch', title: '渔获', text: '退潮的浅坑里困着一堆鱼，你捡了满手。', kind: 'loot', item: 'fish', n: 3 },
    { id: 'wat-barge', title: '搁浅驳船', text: '一条驳船斜搁在滩上，货舱里还有没拆的箱子。', kind: 'loot', item: 'metal', n: 3 },
    { id: 'wat-flavor', title: '防波堤', text: '堤上有人用油漆刷了三个字：别上船。', kind: 'flavor' },
  ],
  ruins: [
    { id: 'rui-collapse', title: '楼板塌陷', text: '脚下的楼板整块陷了下去，你抓住钢筋才没掉到底层。', kind: 'hazard', hp: -13 },
    { id: 'rui-trap', title: '拾荒者的陷阱', text: '一脚踩进绳套——这地方有人来过，而且不想被打扰。', kind: 'hazard', hp: -10 },
    { id: 'rui-safe', title: '旧保险柜', text: '塌了一半的墙里露出保险柜，撬开后是一叠还能用的票据和金属。', kind: 'loot', item: 'metal', n: 4 },
    { id: 'rui-wire', title: '废线缆', text: '整捆的铜线被人割下来堆在墙角，主人显然不在了。', kind: 'loot', item: 'chip', n: 2 },
  ],
};

/* M72b：**第一次进区**时事件概率显著提高（用户口径原话「第一次进区事件概率更高」）。
   为什么单独给一档：陌生地带没有经验可借 —— 玩家第一次踏进去，撞上事的概率该比熟门熟路高得多，
   这一趟也正好承担"教玩家这片区域会出什么事"的职责（首次进区的叙事提示见 world-ui 的 travelRegion）。 */
export const FIRST_ENTER_MUL = 2.2;      // 首次进区的概率倍率
export const FIRST_ENTER_CAP = 0.95;     // 封顶（"必然出事"会让叙事提示与首次探索变得太僵）

/** 出事概率：安全区（1）最低，最外圈（5）最高（老签名保持不变 —— 别处有 `[1..5].map(eventChance)` 这种用法） */
export const eventChance = (tier: number): number => Math.min(0.75, 0.18 + Math.max(1, Math.min(5, tier)) * 0.09);

/** 带"首次进区"口径的出事概率：`first=true` 时 ×FIRST_ENTER_MUL（封顶 FIRST_ENTER_CAP）。
 *  刻意拆成第二个函数而不是给 eventChance 加可选参数：`[1,2,3,4,5].map(eventChance)`
 *  会把数组下标当第二个实参传进来，加可选参数会让这类调用悄悄变成"首次进区"。 */
export function eventChanceAt(tier: number, first: boolean): number {
  const base = eventChance(tier);
  return first ? Math.min(FIRST_ENTER_CAP, base * FIRST_ENTER_MUL) : base;
}

/** 事件池里"坏事"的占比：危险度越高，越容易抽到 hazard */
const hazardBias = (tier: number) => Math.min(0.75, 0.12 + Math.max(1, Math.min(5, tier)) * 0.11);

/**
 * 掷一次区域事件。
 * @param type 区域类型
 * @param tier 危险度 1~5
 * @param rng  0~1 的随机源（测试里传定值序列）
 * @param first 这一趟是不是**第一次**进这片区域（M72b：概率 ×FIRST_ENTER_MUL）
 * @returns 事件；没触发返回 null
 */
export function rollRegionEvent(type: RegionType, tier: number, rng: () => number, first = false): RegionEvent | null {
  if (rng() > eventChanceAt(tier, first)) return null;
  const pool = REGION_EVENTS[type] ?? [];
  if (!pool.length) return null;
  const hazards = pool.filter(e => e.kind === 'hazard');
  const rest = pool.filter(e => e.kind !== 'hazard');
  /* 安全区（危险 1）永远不会受伤：危险事件直接换成氛围/收益事件 */
  const useHazard = tier > 1 && hazards.length > 0 && rng() < hazardBias(tier);
  const pick = useHazard ? hazards : (rest.length ? rest : pool);
  return pick[Math.floor(rng() * pick.length) % pick.length];
}

/** 详情面板用：这一带"常见状况"的标题（让玩家出发前就知道会撞上什么） */
export const regionHazardTitles = (type: RegionType, limit = 3): string[] =>
  (REGION_EVENTS[type] ?? []).slice(0, limit).map(e => e.title);

/** 统计口径（单测/探针共用）：跑 n 次掷骰，返回"出事率"——随机源可复现（同一个种子 → 同一个数字）。
 *  探针用它把"首次进区概率更高"变成两组可比数字，而不是一句"感觉更容易出事"。 */
export function sampleEventRate(type: RegionType, tier: number, first: boolean, n: number, rng: () => number = makeRng(20260922)): number {
  const total = Math.max(1, Math.floor(Number(n) || 1));
  let hit = 0;
  for (let i = 0; i < total; i++) if (rollRegionEvent(type, tier, rng, first)) hit++;
  return hit / total;
}

/** 可复现的 0~1 随机源（xorshift32；种子里塞个非零常数，免得 seed=0 时退化成全 0 序列） */
export function makeRng(seed: number): () => number {
  let s = (Math.floor(Number(seed) || 0) >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 事件池自检（单测与 UI 都可能用）：返回结构性问题列表，空数组 = 干净 */
export function auditRegionEvents(knownItems: string[]): string[] {
  const bad: string[] = [];
  const ids = new Set<string>();
  for (const type in REGION_EVENTS) {
    const pool = REGION_EVENTS[type as RegionType];
    if (pool.length < 3) bad.push(type + ' 事件太少（' + pool.length + '）');
    if (!pool.some(e => e.kind === 'hazard')) bad.push(type + ' 没有 hazard 事件');
    for (const e of pool) {
      if (ids.has(e.id)) bad.push('事件 id 重复：' + e.id);
      ids.add(e.id);
      if (!e.title || !e.text || e.text.length < 6) bad.push(e.id + ' 文案不完整');
      if (e.item && knownItems.indexOf(e.item) < 0) bad.push(e.id + ' 用了不存在的物品：' + e.item);
      if (e.item && !(e.n && e.n > 0)) bad.push(e.id + ' 给了物品却没给数量');
      if (e.hp && e.hp > 0) bad.push(e.id + ' 事件不该直接回血');
      if (e.hp && e.hp < -25) bad.push(e.id + ' 一次掉血太多：' + e.hp);
      if (e.mat && Math.abs(e.mat) > 20) bad.push(e.id + ' 材料增减过大：' + e.mat);
      if (e.ap && Math.abs(e.ap) > 3) bad.push(e.id + ' 行动力增减过大：' + e.ap);
    }
  }
  return bad;
}
