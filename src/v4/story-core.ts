/* 「大故事」章节制剧情（纯逻辑，不碰 DOM）—— 用户要的"大故事"那一半。
 *
 * 设计：
 *   · 6 章，从余烬市区一路推到江北/滨海/南港（跨区=要开车，M12 的门槛顺手变成叙事门槛）
 *   · 每章 = 开场叙事 + 2~3 个目标（复用委托系统的 Metric/Snap，不重新造一套计数）
 *   · 章节开放需要两个条件：**主线阶段到位**（legacy S.quest.stage，保证不跳剧情）
 *     + **目标全达成**；两个都满足才推进，推进时发奖并写一条剧情日志
 *   · 目标一律用"绝对值"判定（不是接单基线）：剧情是"你做过这件事"，不是"再去做一次"
 *   · 指标只用不会因为换地图而失效的：区域到访(region:) / 击杀 / 深搜 / 尸潮 / 过夜 / 常见 POI
 */
import { metricLabel, metricNow, type ContractReward, type Metric, type Snap } from './contracts-core';
import { regionName } from './regions-core';

export interface StoryObj { id: string; text: string; metric: Metric; need: number; hint: string }

export interface ChapterDef {
  id: string;
  no: number;                    // 1 起
  title: string;
  sub: string;                   // 一行副标题（UI 里跟标题同一行）
  region: string;                // 主要发生地（跨区章会提示要开车）
  stage: number;                 // 需要 legacy 主线推进到这一阶段
  gate: string;                  // 这道门槛的人话说明（'' = 没有门槛）
  intro: string;                 // 开场叙事
  objs: StoryObj[];
  outro: string;                 // 完成叙事（也进剧情日志）
  reward: ContractReward;
}

export interface StoryEntry { day: number; ch: number; title: string; text: string }

export interface StoryState {
  chapter: number;               // 已完成章数（0 = 第一章进行中）
  done: string[];                // 已完成目标 id（冗余记录，UI 显示用）
  log: StoryEntry[];             // 剧情日志（最多 40 条）
}

export const emptyStory = (): StoryState => ({ chapter: 0, done: [], log: [] });

export const STORY: ChapterDef[] = [
  {
    id: 'ch1', no: 1, title: '余烬', sub: '第 1 章 · 你醒得比城市晚', region: 'ember', stage: 0, gate: '',
    intro: '你在安全屋的地板上醒来，嘴里全是铁锈味。窗外没有车声，没有人声，只有很远的地方传来一声像门轴的声音——拖得很长。桌上有一张被水泡过的值班表，最上面一行写着：圣玛丽医院，三楼，档案室。',
    objs: [
      { id: 'ch1a', text: '摸进圣玛丽医院的档案室', metric: 'zone:hospital', need: 1, hint: '地图上找 🏥 医院（市区/郊区都有）' },
      { id: 'ch1b', text: '清掉门口晃悠的那几只', metric: 'kills', need: 6, hint: '随便打，先把手感找回来' },
    ],
    outro: '档案室里没有人，只有一排排被翻空的柜子。你在最里面那格摸到半本册子：每一页都是一个编号、一个日期，还有一个被划掉的名字。最后一页的日期是七天前。',
    reward: { mat: 18, item: 'bandage', n: 3 },
  },
  {
    id: 'ch2', no: 2, title: '枪与秩序', sub: '第 2 章 · 有人比丧尸更早来过', region: 'ember', stage: 1, gate: '主线：弄到一把枪（搜第 9 分局）',
    intro: '册子上的编号指向第 9 分局的证据室。警察不会把枪留在原地——但抢在所有人之前到的人，总会漏掉点什么。',
    objs: [
      { id: 'ch2a', text: '撬开第 9 分局的枪柜', metric: 'zone:police', need: 1, hint: '地图上找 🚓 警局' },
      { id: 'ch2b', text: '在超市里凑够路上的口粮（搜刮 2 次）', metric: 'zone:market', need: 2, hint: '地图上找 🛒 超市' },
    ],
    outro: '枪柜是空的，但墙角堆着一件没来得及穿走的防弹背心。证据室的登记本上，有人用红笔写了三个字：「都拿走了」。同一天，有人在超市货架之间用罐头摆了个箭头，指着北边。',
    reward: { mat: 22, item: 'ammo', n: 18 },
  },
  {
    id: 'ch3', no: 3, title: '铁壳', sub: '第 3 章 · 门禁卡不长在门上', region: 'ember', stage: 2, gate: '主线：凑齐 3 片门禁卡',
    intro: '箭头尽头是一张贴在电箱上的手写通知：方舟实验室每层都要刷生物识别芯片，而芯片现在挂在那些穿装甲的东西身上。写通知的人签了名——「陈」，后面被划掉了。',
    objs: [
      { id: 'ch3a', text: '从装甲丧尸身上取下 2 片门禁卡', metric: 'killBy:armored', need: 2, hint: '装甲丧尸在市区/工业区/军事区一带' },
      { id: 'ch3b', text: '在废墟里认真翻 3 次（深度搜索）', metric: 'deep', need: 3, hint: '搜索时选"深度搜索"，每次 2 行动力' },
    ],
    outro: '两片芯片、一张写着"陈"的工牌。工牌背面是一串坐标，指向江北的一家化工中试厂——那里存放着抑制剂的半成品。要过江，靠两条腿不行。',
    reward: { mat: 26, item: 'keycard', n: 1 },
  },
  {
    id: 'ch4', no: 4, title: '过江', sub: '第 4 章 · 车是这条路上唯一的货币', region: 'jiangbei', stage: 3, gate: '主线：备好防毒面具与防化服',
    intro: '桥面还在，护栏塌了一半，中间停着一排没人再开的车。你要去江北工业区的中试厂——那里也许还有没被水泡过的药剂，也许只有更多穿装甲的东西。',
    objs: [
      { id: 'ch4a', text: '开车过江，踏上江北工业区', metric: 'region:jiangbei', need: 1, hint: '探索页 → 区域面板 → 江北工业区（要车、要油）' },
      { id: 'ch4b', text: '在江北撑过 3 个夜晚', metric: 'nights', need: 3, hint: '睡觉就会推进一天（任何地方都算）' },
    ],
    outro: '中试厂的冷库里还亮着一盏应急灯，冰柜里整整齐齐码着三十七支安瓿，标签上是同一个批号。取走它们的人没有回来——地上有一双被拖走的鞋印，一直延伸到卷帘门外。',
    reward: { mat: 32, item: 'chem', n: 3 },
  },
  {
    id: 'ch5', no: 5, title: '海边的电台', sub: '第 5 章 · 有人在喊，但喊的不是救援', region: 'binhai', stage: 4, gate: '主线：在据点架设无线电',
    intro: '安瓿上的批号对应一批只发往滨海新区的货。要说清楚这批药是怎么来的，得先找到当年那个广播电台——如果它还在发报，那就有人在守着它。',
    objs: [
      { id: 'ch5a', text: '到滨海新区走一趟', metric: 'region:binhai', need: 1, hint: '区域面板 → 滨海新区（跨区要开车）' },
      { id: 'ch5b', text: '去南港码头看看集装箱', metric: 'region:nangang', need: 1, hint: '区域面板 → 南港码头（危险 5，带够弹药）' },
      { id: 'ch5c', text: '守一次夜，撑过一次尸潮', metric: 'hordes', need: 1, hint: '晚上待在据点，撑过夜袭' },
    ],
    outro: '电台的电子管还热着。录音带里是一个女人的声音，报着位置、报着人数，一遍又一遍：「实验室第六层以下没有通风。如果有人听到——别下去。」',
    reward: { mat: 38, item: 'medkit', n: 2 },
  },
  {
    id: 'ch6', no: 6, title: '下到第六层', sub: '第 6 章 · 结局在那盏灯下面', region: 'ember', stage: 5, gate: '主线：坐标已确认（可以下实验室了）',
    intro: '无线电架起来了，坐标锁在市中心地铁枢纽下方。录音带里那句"别下去"你已经听了七遍。这次带够了弹和药，也带够了别人的名字。',
    objs: [
      { id: 'ch6a', text: '处理掉守在入口的东西（暴君）', metric: 'killBy:tyrant', need: 1, hint: '夜袭与实验室门口会出现暴君' },
      { id: 'ch6b', text: '再深搜 5 次，把装备补满', metric: 'deep', need: 5, hint: '深度搜索累计（从游戏开始算）' },
    ],
    outro: '第六层的门在你身后合上，灯灭了很久。再亮起来的时候，你手里握着一管淡蓝色的东西——它不解决世界，只解决你自己身上正在发生的事。',
    reward: { mat: 50, item: 'serum', n: 2 },
  },
];

export interface ObjView { def: StoryObj; cur: number; done: boolean }
export interface ChapterView {
  def: ChapterDef;
  index: number;
  isCurrent: boolean;
  passed: boolean;            // 已完成
  gateOpen: boolean;          // 主线阶段够
  locked: boolean;            // 还轮不到它（前一章没完成）
  objs: ObjView[];
  complete: boolean;
}

export function chapterView(i: number, st: StoryState, snap: Snap, stage: number): ChapterView {
  const def = STORY[i];
  const objs = def.objs.map(o => ({ def: o, cur: Math.min(o.need, metricNow(o.metric, snap)), done: metricNow(o.metric, snap) >= o.need }));
  const complete = objs.every(o => o.done);
  const gateOpen = stage >= def.stage;
  return {
    def, index: i,
    isCurrent: i === st.chapter,
    passed: i < st.chapter,
    gateOpen,
    locked: i > st.chapter,
    objs,
    complete: complete && gateOpen,
  };
}

/** 当前章（全部完成时返回最后一章） */
export function currentChapter(st: StoryState): ChapterDef { return STORY[Math.min(st.chapter, STORY.length - 1)]; }

/** 剧情日志（章节日志 + 已完成章的叙事，UI 直接铺） */
export function archive(st: StoryState): { ch: number; title: string; text: string; day: number }[] {
  return st.log.slice().reverse();
}

/** 下一个没做完的目标（UI 的"下一步"提示）；全做完就返回空 */
export function nextObjective(st: StoryState, snap: Snap, stage: number): string {
  if (st.chapter >= STORY.length) return '';
  const v = chapterView(st.chapter, st, snap, stage);
  if (!v.gateOpen) return '这一章还要等主线：' + (v.def.gate || '把主线推下去');
  const o = v.objs.find(x => !x.done);
  return o ? o.def.text + '：' + o.cur + '/' + o.def.need + ' —— ' + o.def.hint : '';
}

export interface StoryProgress { state: StoryState; advanced: ChapterDef[]; reward: ContractReward; messages: string[] }

/** 推进章节：目标全达成 + 主线阶段到位 → 结算剧情与奖励（可一次推多章） */
export function storyTick(st: StoryState, snap: Snap, stage: number): StoryProgress {
  const advanced: ChapterDef[] = [];
  const messages: string[] = [];
  const reward: ContractReward = {};
  let guard = 0;
  while (st.chapter < STORY.length && guard++ < STORY.length) {
    const v = chapterView(st.chapter, st, snap, stage);
    if (!v.complete) break;
    const def = v.def;
    for (const o of def.objs) if (!st.done.includes(o.id)) st.done.push(o.id);
    st.chapter++;
    st.log.push({ day: snap.day, ch: def.no, title: def.title, text: def.outro });
    if (st.log.length > 40) st.log.shift();
    advanced.push(def);
    reward.mat = (reward.mat ?? 0) + (def.reward.mat ?? 0);
    if (def.reward.item) reward.item = def.reward.item, reward.n = (reward.n ?? 0) + (def.reward.n ?? 1);
    messages.push('📖 第 ' + def.no + ' 章完成：' + def.title + '（+' + (def.reward.mat ?? 0) + ' 材料' +
      (def.reward.item ? '、' + def.reward.item + '×' + (def.reward.n ?? 1) : '') + '）');
    if (st.chapter < STORY.length) messages.push('📖 第 ' + STORY[st.chapter].no + ' 章开始：' + STORY[st.chapter].title + ' —— ' + STORY[st.chapter].sub);
  }
  return { state: st, advanced, reward, messages };
}

/** 目标文案（UI 与测试共用）：'搜刮 医院 1/1' */
export function objLine(v: ObjView): string {
  return v.def.text + '　' + v.cur + '/' + v.def.need + (v.done ? ' ✅' : '');
}

/** 章节一行摘要（日志/面板标题用） */
export function chapterLine(v: ChapterView): string {
  const total = v.objs.length, done = v.objs.filter(o => o.done).length;
  return '第 ' + v.def.no + ' 章 · ' + v.def.title + '（' + done + '/' + total + ' 目标）';
}

/** 章节主要发生地的提示：跨区章要开车 */
export function chapterRegionHint(v: ChapterView, curRegion: string, hasVehicle: boolean): string {
  const def = v.def;
  if (def.region === curRegion) return '发生地：' + regionName(def.region) + '（你在这儿）';
  return hasVehicle
    ? '发生地：' + regionName(def.region) + '（跨区，开车过去）'
    : '发生地：' + regionName(def.region) + '（跨区——先弄辆车，走路到不了）';
}

/** 目标指标的人话名字（UI 里显示"判定依据"用，避免玩家猜） */
export const objMetricLabel = (o: StoryObj): string => metricLabel(o.metric) + ' ×' + o.need;

/** 存档校验/迁移（**原地修补**，理由同 contracts-core.ensureContracts：调用方握着引用） */
export function ensureStory(raw: unknown): StoryState {
  const s = raw as Partial<StoryState> | undefined;
  if (!s || typeof s !== 'object') return emptyStory();
  s.chapter = Math.max(0, Math.min(STORY.length, Math.floor(Number(s.chapter) || 0)));
  s.done = Array.isArray(s.done) ? s.done.filter(x => typeof x === 'string') : [];
  s.log = Array.isArray(s.log)
    ? s.log.filter((e: any) => e && typeof e.text === 'string')
      .map((e: any) => ({ day: Math.max(1, Math.floor(Number(e.day) || 1)), ch: Math.floor(Number(e.ch) || 1), title: String(e.title || ''), text: String(e.text) }))
      .slice(-40)
    : [];
  return s as StoryState;
}

/** 全部章数（UI/测试用） */
export const STORY_LEN = STORY.length;
