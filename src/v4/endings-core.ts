/* M15 多结局（纯逻辑，不碰 DOM）—— 用户要的第二个大项。
 *
 * 设计：结局不是"看完一段字就完了"，而是**由你做过的事决定**：
 *   · 怎么通关/怎么结束：拿到解药（决战通关）/ 活到第 100 天（救援）/ 死掉 / 进无尽
 *   · **M14 的三个抉择**（独占还是分享）会把同一类收束分成两种口气：
 *       独占 → 「一个人的黎明」「第 100 天」
 *       分享 → 「黎明」「频率上的名字」
 *   · 死在最后一战 vs 死在别处，是两种完全不同的死法
 *   · 无尽模式里活过第 150 天另有一个结局（给"活下去"这个目标一个终点）
 * 一共 8 个，存档里记 `endings: string[]`（跨周目累计），任务页有"结局档案"。
 */
import type { ContractReward } from './contracts-core';

export type EndingKind = 'won' | 'rescue' | 'dead' | 'endless';

export interface EndingCtx {
  kind: EndingKind;
  day: number;
  /** 剧情抉择（story-core 的 choices）：决定"分享 / 独占"倾向 */
  choices: Record<string, string>;
  /** 死在最后一战（进过实验室） */
  inLab?: boolean;
  /** 已完成的章节数（0~6） */
  chapters: number;
  kills: number;
  /** 已解锁的结局 id（跨周目累计） */
  unlocked: string[];
}

export interface EndingDef {
  id: string;
  title: string;
  sub: string;
  /** 结局类别标签（档案里显示） */
  tag: string;
  kind: EndingKind;
  /** 判定：按 ENDINGS 数组顺序，第一个命中的就是你的结局 */
  when: (c: EndingCtx) => boolean;
  /** 结局正文（分段） */
  text: string[];
  /** 一句话总结（档案/日志里显示） */
  tip: string;
  /** 结局奖励（可选，发到这一档的存档里当纪念） */
  reward?: ContractReward;
}

/** 抉择里"分享"的那一侧（share / hand / air 见 story-core 的选项 id） */
export const SHARE_CHOICES = new Set(['share', 'hand', 'air']);
export const sharedCount = (c: { choices: Record<string, string> }) =>
  Object.keys(c.choices).filter(k => SHARE_CHOICES.has(c.choices[k])).length;

/** 分享倾向 ≥2（三个抉择里至少两个选了"给别人"） */
export const isSharing = (c: EndingCtx) => sharedCount(c) >= 2;

export const ENDINGS: EndingDef[] = [
  {
    id: 'martyr', title: '第六层以下', sub: '你在离答案最近的地方停下了', tag: '结局 · 阵亡', kind: 'dead',
    when: c => c.kind === 'dead' && !!c.inLab,
    text: [
      '第七层的灯在你身后一盏一盏灭掉。你听见自己的呼吸，然后是别的什么东西的呼吸。',
      '冷柜里那四十支淡蓝色的液体还锁着。它们会一直锁在那里，直到有人再来——或者直到再没有人来。',
      '电台录下的那句话你终究没有听：第六层以下没有通风。',
    ],
    tip: '死在方舟实验室（最终决战）里。',
  },
  {
    id: 'ash', title: '余烬', sub: '城市没有记住你的名字', tag: '结局 · 阵亡', kind: 'dead',
    when: c => c.kind === 'dead',
    text: [
      '你倒在一条没有名字的街上。雨把血冲进排水口，像什么都没发生过。',
      '第 {day} 天。你留下的东西——背包、绷带、那半本册子——会被下一个路过的人翻走。',
      '末日不挑人。它只是继续。',
    ],
    tip: '在荒野里倒下（未进实验室）。',
  },
  {
    id: 'dawn', title: '黎明', sub: '你带回来的东西不属于你一个人', tag: '结局 · 通关（分享）', kind: 'won',
    when: c => c.kind === 'won' && isSharing(c),
    text: [
      '你把冷柜的钥匙留在了桌上，把坐标抄了三份，塞给三个不同方向来的人。',
      '回程的路上你想的不是那管血清，而是营地那盏一直没灭的灯。',
      '第 {day} 天的太阳升起来的时候，有几十个人知道该往哪儿走了。',
      '末日没有结束。但从今天起，它有了一个对手。',
    ],
    tip: '取回解药，并且一路都选择了"告诉别人"。',
  },
  {
    id: 'alone', title: '一个人的黎明', sub: '你活下来了，没人知道', tag: '结局 · 通关（独占）', kind: 'won',
    when: c => c.kind === 'won',
    text: [
      '你把那管淡蓝色的东西贴身收好，一个人走完了回程。桥上有风，没有别的东西。',
      '你知道它管用。你也知道，只要你不说，就没人会来抢。',
      '安全屋的门在身后合上。灯亮着，只有一盏。',
      '这是你一个人的黎明。',
    ],
    tip: '取回解药，但一路都选择了"自己留着"。',
  },
  {
    id: 'keeper', title: '频率上的名字', sub: '有人在电台那头回了你一句"收到"', tag: '结局 · 救援（分享）', kind: 'rescue',
    when: c => c.kind === 'rescue' && sharedCount(c) >= 1,
    text: [
      '第 {day} 天，直升机按你给出的频率找到了你。飞行员说：那条广播我们听了三个月。',
      '你是第一个报出准确坐标、还愿意留在原地等的人。',
      '你被拉上机舱的时候回头看了一眼——整座城市在下面，安静得像一张被摊开的报纸。',
      '你会回来的。这点你自己知道。',
    ],
    tip: '活到第 100 天被救援，而且你曾经把消息播出去过。',
  },
  {
    id: 'rescue', title: '第 100 天', sub: '你只是活到了那一天', tag: '结局 · 救援', kind: 'rescue',
    when: c => c.kind === 'rescue',
    text: [
      '第 {day} 天，救援来了。他们找的是"还有没有活人"，不是"有没有解药"。',
      '你上了直升机，背着你的包。包里有绷带、有弹药、有半本被水泡过的册子。',
      '地面上那些没来得及说完的事，留在那儿了。',
    ],
    tip: '活到第 100 天被救援（没有把消息传出去）。',
  },
  {
    id: 'wanderer', title: '活得比城市久', sub: '第 150 天，你已经不记得第 1 天的样子了', tag: '结局 · 无尽', kind: 'endless',
    when: c => c.kind === 'endless' && c.day >= 150,
    text: [
      '你已经过了 {day} 天。这座城市里能翻的地方你翻过三遍，能修的东西你都修过。',
      '丧尸进化了很多轮，你也是。你现在听见风就知道哪条街上有活的东西。',
      '没有人给你发奖章。但你还在，城市已经不在了。',
    ],
    tip: '在无尽模式里活过第 150 天。',
  },
  {
    id: 'endless', title: '无尽', sub: '故事结束了，日子还得过', tag: '结局 · 无尽', kind: 'endless',
    when: () => true,
    text: [
      '主线走完了。城市还在，东西还在进化。',
      '你给自己定了个新规矩：每天出门，每天回来，每天在墙上划一道。',
      '墙迟早会划满。在那之前，你继续。',
    ],
    tip: '进入无尽模式继续生存。',
  },
];

/** 解析结局：ENDINGS 是有序表，第一个命中的为准（具体条件排前面，兜底排最后） */
export function resolveEnding(ctx: EndingCtx): EndingDef {
  return ENDINGS.find(e => e.when(ctx)) ?? ENDINGS[ENDINGS.length - 1];
}

/** 正文占位符：`{day}` → 实际天数（正文不写死数字，同一段文本可以复用） */
export const endingLines = (def: EndingDef, ctx: EndingCtx): string[] =>
  def.text.map(t => t.replace(/\{day\}/g, String(ctx.day)));

/** 记录解锁：返回是否是新结局 */
export function unlockEnding(unlocked: string[], id: string): { list: string[]; isNew: boolean } {
  if (!ENDINGS.some(e => e.id === id)) return { list: unlocked, isNew: false };
  if (unlocked.includes(id)) return { list: unlocked, isNew: false };
  return { list: [...unlocked, id], isNew: true };
}

/** 存档校验：只留真实存在的 id，顺序按 ENDINGS 排（档案列表要稳定） */
export function ensureEndings(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : [];
  return ENDINGS.filter(e => arr.includes(e.id)).map(e => e.id);
}

/** 档案文案：'8 个结局 · 已解锁 3' */
export const archiveTitle = (unlocked: string[]) => ENDINGS.length + ' 个结局 · 已解锁 ' + ensureEndings(unlocked).length;

export const endingById = (id: string): EndingDef | undefined => ENDINGS.find(e => e.id === id);
