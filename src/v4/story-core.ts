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
import { typeColor, typeLabel, type RegionType } from './regions-core';

export interface StoryObj { id: string; text: string; metric: Metric; need: number; hint: string }

/** M14：章节抉择。一章的目标做完后，先做一次选择才推进——
 *  选择会换掉后续章节的开场叙事（见 ChapterDef.introBy），并决定这一章给什么奖励。 */
export interface ChoiceOpt {
  id: string;
  label: string;
  note: string;              // 一行代价/倾向说明（UI 显示在选择按钮下面）
  /** 选完写进剧情日志的那句话（分支的"后果"，玩家回看时能看出自己选过什么） */
  consequence: string;
  reward: ContractReward;
}
export interface ChapterChoice { prompt: string; options: ChoiceOpt[] }

export interface ChapterDef {
  id: string;
  no: number;                    // 1 起
  title: string;
  sub: string;                   // 一行副标题（UI 里跟标题同一行）
  /** M17：主要发生地的**类型**。元地图是程序化生成的（12×12），
      所以剧情只能说"去一片工业区"，不能写死"去江北"。 */
  regionType: RegionType;
  stage: number;                 // 需要 legacy 主线推进到这一阶段
  gate: string;                  // 这道门槛的人话说明（'' = 没有门槛）
  intro: string;                 // 开场叙事
  /** 上一章的某个抉择会把开场叙事换掉（键 = 上一章选项 id） */
  introBy?: Record<string, string>;
  objs: StoryObj[];
  outro: string;                 // 完成叙事（也进剧情日志）
  reward: ContractReward;
  /** 有抉择的章节：目标达成后停下来等玩家选，选完才推进 */
  choice?: ChapterChoice;
}

export interface StoryEntry { day: number; ch: number; title: string; text: string; choice?: string }

export interface StoryState {
  chapter: number;               // 已完成章数（0 = 第一章进行中）
  done: string[];                // 已完成目标 id（冗余记录，UI 显示用）
  log: StoryEntry[];             // 剧情日志（最多 40 条）
  /** 已做的抉择：章 id → 选项 id（M14）。缺失 = 这一章还没选（或不需要选） */
  choices: Record<string, string>;
}

export const emptyStory = (): StoryState => ({ chapter: 0, done: [], log: [], choices: {} });

export const STORY: ChapterDef[] = [
  {
    id: 'ch1', no: 1, title: '余烬', sub: '第 1 章 · 你醒得比城市晚', regionType: 'core', stage: 0, gate: '',
    intro: '你在安全屋的地板上醒来，嘴里全是铁锈味。窗外没有车声，没有人声，只有很远的地方传来一声像门轴的声音——拖得很长。桌上有一张被水泡过的值班表，最上面一行写着：圣玛丽医院，三楼，档案室。',
    objs: [
      { id: 'ch1a', text: '摸进圣玛丽医院的档案室', metric: 'zone:hospital', need: 1, hint: '地图上找 🏥 医院（市区/郊区都有）' },
      { id: 'ch1b', text: '清掉门口晃悠的那几只', metric: 'kills', need: 6, hint: '随便打，先把手感找回来' },
    ],
    outro: '档案室里没有人，只有一排排被翻空的柜子。你在最里面那格摸到半本册子：每一页都是一个编号、一个日期，还有一个被划掉的名字。最后一页的日期是七天前。',
    reward: { mat: 12 },
    choice: {
      prompt: '册子怎么处理？',
      options: [
        { id: 'keep', label: '缝进内袋，谁也不给', note: '你留着唯一的原件——但没人知道你在查什么', consequence: '你把册子缝进内袋。从今天起，这件事只有你一个人知道。', reward: { mat: 6, item: 'bandage', n: 3 } },
        { id: 'share', label: '交给营地里识字的老人', note: '他会抄一份，也会告诉别人你在找什么', consequence: '老人抄了整整一夜。第二天，营地里所有人都知道你在找那个编号。', reward: { mat: 18 } },
      ],
    },
  },
  {
    id: 'ch2', no: 2, title: '枪与秩序', sub: '第 2 章 · 有人比丧尸更早来过', regionType: 'core', stage: 1, gate: '主线：弄到一把枪（搜第 9 分局）',
    intro: '册子上的编号指向第 9 分局的证据室。警察不会把枪留在原地——但抢在所有人之前到的人，总会漏掉点什么。',
    introBy: {
      keep: '那本册子还贴在你胸口，硬邦邦的。编号指向第 9 分局的证据室——你没打算告诉任何人你要去那儿。',
      share: '现在半个营地都知道你在找那个编号。有人替你画了去第 9 分局的路，条件是你回来时讲清楚看到了什么。',
    },
    objs: [
      { id: 'ch2a', text: '撬开第 9 分局的枪柜', metric: 'zone:police', need: 1, hint: '地图上找 🚓 警局' },
      { id: 'ch2b', text: '在超市里凑够路上的口粮（搜刮 2 次）', metric: 'zone:market', need: 2, hint: '地图上找 🛒 超市' },
    ],
    outro: '枪柜是空的，但墙角堆着一件没来得及穿走的防弹背心。证据室的登记本上，有人用红笔写了三个字：「都拿走了」。同一天，有人在超市货架之间用罐头摆了个箭头，指着北边。',
    reward: { mat: 22, item: 'ammo', n: 18 },
  },
  {
    id: 'ch3', no: 3, title: '铁壳', sub: '第 3 章 · 门禁卡不长在门上', regionType: 'core', stage: 2, gate: '主线：凑齐 3 片门禁卡',
    intro: '箭头尽头是一张贴在电箱上的手写通知：方舟实验室每层都要刷生物识别芯片，而芯片现在挂在那些穿装甲的东西身上。写通知的人签了名——「陈」，后面被划掉了。',
    objs: [
      { id: 'ch3a', text: '从装甲丧尸身上取下 2 片门禁卡', metric: 'killBy:armored', need: 2, hint: '装甲丧尸在市区/工业区/军事区一带' },
      { id: 'ch3b', text: '在废墟里认真翻 3 次（深度搜索）', metric: 'deep', need: 3, hint: '搜索时选"深度搜索"，每次 2 行动力' },
    ],
    outro: '两片芯片、一张写着"陈"的工牌。工牌背面是一串坐标，指向江北的一家化工中试厂——那里存放着抑制剂的半成品。要过江，靠两条腿不行。',
    reward: { mat: 14 },
    choice: {
      prompt: '工牌怎么办？',
      options: [
        { id: 'own', label: '芯片和工牌都自己收着', note: '江北那一趟只靠你自己判断', consequence: '你把工牌塞进最里层的口袋。没人知道"陈"是谁，也没人能替你问。', reward: { mat: 12, item: 'keycard', n: 1 } },
        { id: 'hand', label: '把工牌交给识货的收货人', note: '他会给你情报，也会抽一份好处', consequence: '收货人看完工牌，报出了一个坐标和一句警告："那边的中试厂，晚上别去。"', reward: { mat: 26, item: 'chem', n: 2 } },
      ],
    },
  },
  {
    id: 'ch4', no: 4, title: '过江', sub: '第 4 章 · 车是这条路上唯一的货币', regionType: 'industry', stage: 3, gate: '主线：备好防毒面具与防化服',
    intro: '桥面还在，护栏塌了一半，中间停着一排没人再开的车。你要去江北工业区的中试厂——那里也许还有没被水泡过的药剂，也许只有更多穿装甲的东西。',
    introBy: {
      own: '地图上那个坐标是你自己从工牌背面读出来的，没有第二个人知道。桥面还在，护栏塌了一半——你要一个人过江。',
      hand: '收货人给的坐标比工牌上多了一行小字：中试厂，冷库，夜里别开灯。桥面还在，护栏塌了一半。',
    },
    objs: [
      { id: 'ch4a', text: '开车去一片工业区', metric: 'rtype:industry', need: 1, hint: '地图面板 → 大区地图 → 找棕色的工业区（要车、要油）' },
      { id: 'ch4b', text: '在那边撑过 3 个夜晚', metric: 'nights', need: 3, hint: '睡觉就会推进一天（任何地方都算）' },
    ],
    outro: '中试厂的冷库里还亮着一盏应急灯，冰柜里整整齐齐码着三十七支安瓿，标签上是同一个批号。取走它们的人没有回来——地上有一双被拖走的鞋印，一直延伸到卷帘门外。',
    reward: { mat: 32, item: 'chem', n: 3 },
  },
  {
    id: 'ch5', no: 5, title: '海边的电台', sub: '第 5 章 · 有人在喊，但喊的不是救援', regionType: 'water', stage: 4, gate: '主线：在据点架设无线电',
    intro: '安瓿上的批号对应一批只发往滨海新区的货。要说清楚这批药是怎么来的，得先找到当年那个广播电台——如果它还在发报，那就有人在守着它。',
    objs: [
      { id: 'ch5a', text: '到港区/水边的区域走一趟', metric: 'rtype:water', need: 1, hint: '大区地图 → 找蓝色的港区/水域（跨区要开车）' },
      { id: 'ch5b', text: '再去一趟危险 4 以上的外圈区域', metric: 'rtype:ruins', need: 1, hint: '大区地图 → 外圈灰紫色的废墟带（危险 4~5，带够弹药）' },
      { id: 'ch5c', text: '守一次夜，撑过一次尸潮', metric: 'hordes', need: 1, hint: '晚上待在据点，撑过夜袭' },
    ],
    outro: '电台的电子管还热着。录音带里是一个女人的声音，报着位置、报着人数，一遍又一遍：「实验室第六层以下没有通风。如果有人听到——别下去。」',
    reward: { mat: 20 },
    choice: {
      prompt: '录音带怎么办？',
      options: [
        { id: 'tape', label: '把录音带收走，谁也不放', note: '这句话只有你听过', consequence: '录音带进了你的包。这句话从此只有你一个人听过，听了七遍。', reward: { mat: 12, item: 'serum', n: 1 } },
        { id: 'air', label: '用电台把它播出去', note: '会有别人听见，也可能会有人来抢', consequence: '你把录音带推进机器，按下播放。频率那头安静了很久，然后有个陌生的声音回了一句"收到"。', reward: { mat: 30, item: 'medkit', n: 2 } },
      ],
    },
  },
  {
    id: 'ch6', no: 6, title: '下到第六层', sub: '第 6 章 · 结局在那盏灯下面', regionType: 'core', stage: 5, gate: '主线：坐标已确认（可以下实验室了）',
    intro: '无线电架起来了，坐标锁在市中心地铁枢纽下方。录音带里那句"别下去"你已经听了七遍。这次带够了弹和药，也带够了别人的名字。',
    introBy: {
      tape: '录音带还在你包里，磁带被体温捂得发软。那句话你听了七遍，也想过七遍——这次下去，没人会知道结果，除非你自己带回来。',
      air: '广播之后，电台那头回话的人约在实验室入口见面。你到的时候，那里只有一串往下的脚印和一盏亮着的灯。',
    },
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
  /** M14：目标达成但抉择还没做（不选就不推进） */
  pendingChoice: boolean;
  chosen: string;             // 已选选项 id（'' = 没选/不需要选）
}

export function chapterView(i: number, st: StoryState, snap: Snap, stage: number): ChapterView {
  const def = STORY[i];
  const objs = def.objs.map(o => ({ def: o, cur: Math.min(o.need, metricNow(o.metric, snap)), done: metricNow(o.metric, snap) >= o.need }));
  const complete = objs.every(o => o.done);
  const gateOpen = stage >= def.stage;
  const chosen = def.choice ? (st.choices[def.id] || '') : '';
  return {
    def, index: i,
    isCurrent: i === st.chapter,
    passed: i < st.chapter,
    gateOpen,
    locked: i > st.chapter,
    objs,
    complete: complete && gateOpen,
    /** 目标都做完了、但这一章还等你做抉择（UI 要弹选项，不选就不推进） */
    pendingChoice: complete && gateOpen && !!def.choice && !chosen,
    chosen,
  };
}

/** 当前章（全部完成时返回最后一章） */
export function currentChapter(st: StoryState): ChapterDef { return STORY[Math.min(st.chapter, STORY.length - 1)]; }

/** 剧情日志（章节日志 + 已完成章的叙事，UI 直接铺） */
export function archive(st: StoryState): { ch: number; title: string; text: string; day: number }[] {
  return st.log.slice().reverse();
}

/** 当前章的正文（把上一章的抉择换成分支叙事；没有分支就用默认开场） */
export function introOf(def: ChapterDef, st: StoryState, prevCh?: ChapterDef): string {
  const prev = prevCh ?? STORY[def.no - 2];
  const pick = prev && prev.choice ? st.choices[prev.id] : '';
  return (pick && def.introBy && def.introBy[pick]) || def.intro;
}

/** 下一个没做完的目标（UI 的"下一步"提示）；全做完就返回空 */
export function nextObjective(st: StoryState, snap: Snap, stage: number): string {
  if (st.chapter >= STORY.length) return '';
  const v = chapterView(st.chapter, st, snap, stage);
  if (!v.gateOpen) return '这一章还要等主线：' + (v.def.gate || '把主线推下去');
  if (v.pendingChoice) return '这一章该做决定了：' + (v.def.choice?.prompt ?? '');
  const o = v.objs.find(x => !x.done);
  return o ? o.def.text + '：' + o.cur + '/' + o.def.need + ' —— ' + o.def.hint : '';
}

export interface StoryProgress {
  state: StoryState;
  advanced: ChapterDef[];
  reward: ContractReward;
  messages: string[];
  /** 卡在抉择上的那一章（有值 = 需要玩家先做选择才继续） */
  awaiting?: ChapterDef;
}

/** 推进章节：目标全达成 + 主线阶段到位 → 结算剧情与奖励（可一次推多章）。
 *  有抉择的章节：目标达成后**停下来等选择**（推进与奖励都在 choose() 里发）。 */
export function storyTick(st: StoryState, snap: Snap, stage: number): StoryProgress {
  const advanced: ChapterDef[] = [];
  const messages: string[] = [];
  const reward: ContractReward = {};
  let awaiting: ChapterDef | undefined;
  let guard = 0;
  while (st.chapter < STORY.length && guard++ < STORY.length) {
    const v = chapterView(st.chapter, st, snap, stage);
    if (!v.complete) break;
    const def = v.def;
    if (def.choice && !st.choices[def.id]) { awaiting = def; break; }     // 等玩家选
    for (const o of def.objs) if (!st.done.includes(o.id)) st.done.push(o.id);
    st.chapter++;
    st.log.push({ day: snap.day, ch: def.no, title: def.title, text: def.outro, choice: st.choices[def.id] });
    if (st.log.length > 40) st.log.shift();
    advanced.push(def);
    reward.mat = (reward.mat ?? 0) + (def.reward.mat ?? 0);
    if (def.reward.item) reward.item = def.reward.item, reward.n = (reward.n ?? 0) + (def.reward.n ?? 1);
    messages.push('📖 第 ' + def.no + ' 章完成：' + def.title + '（+' + (def.reward.mat ?? 0) + ' 材料' +
      (def.reward.item ? '、' + def.reward.item + '×' + (def.reward.n ?? 1) : '') + '）');
    if (st.chapter < STORY.length) messages.push('📖 第 ' + STORY[st.chapter].no + ' 章开始：' + STORY[st.chapter].title + ' —— ' + STORY[st.chapter].sub);
  }
  return { state: st, advanced, reward, messages, awaiting };
}

export interface ChooseResult extends StoryProgress { ok: boolean; why?: string; opt?: ChoiceOpt }

/** 做抉择：记录选择 → 写日志（含后果那句话）→ 发这一章的基础奖励 + 选项奖励 → 继续推进。
 *  章节推进到"下一章的目标可能早就做完了"时由内部的 storyTick 一次推完。 */
export function choose(st: StoryState, chId: string, optId: string, snap: Snap, stage: number): ChooseResult {
  const idx = STORY.findIndex(c => c.id === chId);
  const def = idx >= 0 ? STORY[idx] : null;
  if (!def || !def.choice) return { ok: false, why: '这一章没有抉择', state: st, advanced: [], reward: {}, messages: [] };
  if (st.choices[def.id]) return { ok: false, why: '已经选过了', state: st, advanced: [], reward: {}, messages: [] };
  if (idx !== st.chapter) return { ok: false, why: '还不是这一章', state: st, advanced: [], reward: {}, messages: [] };
  const v = chapterView(idx, st, snap, stage);
  if (!v.complete) return { ok: false, why: '这一章的目标还没做完', state: st, advanced: [], reward: {}, messages: [] };
  const opt = def.choice.options.find(o => o.id === optId);
  if (!opt) return { ok: false, why: '没有这个选项', state: st, advanced: [], reward: {}, messages: [] };

  st.choices[def.id] = opt.id;
  st.log.push({ day: snap.day, ch: def.no, title: def.title, text: opt.consequence, choice: opt.id });
  if (st.log.length > 40) st.log.shift();
  /* 基础奖励 + 选项奖励一起发（基础奖励在 storyTick 里被"等抉择"拦住了，所以这里补上）。
     有抉择的章节，基础奖励只有材料，物品由选项给——所以这里不用合并两件物品。 */
  const reward: ContractReward = { mat: (def.reward.mat ?? 0) + (opt.reward.mat ?? 0) };
  if (opt.reward.item) { reward.item = opt.reward.item; reward.n = opt.reward.n ?? 1; }
  else if (def.reward.item) { reward.item = def.reward.item; reward.n = def.reward.n ?? 1; }

  const res = storyTick(st, snap, stage);
  const messages = [
    '📖 第 ' + def.no + ' 章抉择：' + opt.label + '（+' + (reward.mat ?? 0) + ' 材料' + (reward.item ? '、' + reward.item + '×' + (reward.n ?? 1) : '') + '）',
    ...res.messages,
  ];
  return { ok: true, state: st, advanced: res.advanced, reward, messages, awaiting: res.awaiting, opt };
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

/** 章节主要发生地的提示：M17 起按**类型**说（"去一片工业区"），并告诉玩家怎么在大区地图上找 */
export function chapterRegionHint(v: ChapterView, curType: RegionType | '', hasVehicle: boolean): string {
  const want = typeLabel(v.def.regionType);
  if (v.def.regionType === curType) return '发生地：' + want + '（你脚下就是这种地方）';
  return hasVehicle
    ? '发生地：' + want + '（得开车过去——在大区地图上找这种颜色的格子）'
    : '发生地：' + want + '（跨区——先弄辆车，走路到不了）';
}

/** 章节发生地的颜色（大区地图上找同色格子用） */
export const chapterColor = (v: ChapterView): string => typeColor(v.def.regionType);

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
      .map((e: any) => ({ day: Math.max(1, Math.floor(Number(e.day) || 1)), ch: Math.floor(Number(e.ch) || 1), title: String(e.title || ''), text: String(e.text), choice: typeof e.choice === 'string' ? e.choice : undefined }))
      .slice(-40)
    : [];
  /* M14 抉择记录：只保留"确实存在的那一章 + 那个选项"的条目（改过章节表的老档不会带上野键） */
  const ch = (s.choices && typeof s.choices === 'object') ? s.choices : {};
  s.choices = {};
  for (const id in ch) {
    const def = STORY.find(c => c.id === id);
    if (def && def.choice && def.choice.options.some(o => o.id === ch[id])) s.choices[id] = ch[id];
  }
  return s as StoryState;
}

/** 全部章数（UI/测试用） */
export const STORY_LEN = STORY.length;
