/* M57：死亡结算的纯逻辑 —— 把"你死了"讲清楚（HANDOFF §8.4「死亡结算细节」）。
 *
 *  现在的死亡弹窗只有六格数字 + 一个评级，玩家看完不知道"我到底是怎么死的、下次该改什么"。
 *  这里补三件事（都可单测）：
 *    ① 死因：按 gameOver 的文案 + 当时的身体状态归类（失血 / 感染 / 饥渴 / 辐射 / 尸潮 / 实验室…），
 *       每类给一句"这一类是怎么发生的"；
 *    ② 遗言式瞬间：这一局最值得记的几条（最长的一夜、最远走到的区块、最猛的一次清场…）；
 *    ③ 下次怎么做：针对死因给 2~3 条**带数字**的具体建议（不是"注意安全"这种废话）；
 *    ④ 历史最好：本档 vs 本机最好记录（评分 / 天数 / 击杀），并存回本机。
 */
export interface RecapState {
  day: number;
  hp: number;
  hun: number;
  thi: number;
  infect: number;
  rad: number;
  mat: number;
  /** 身上的未处理伤口（出血/骨折…） */
  wounds: string[];
  /** 死在哪儿（'base' | 'lab' | 区域 id） */
  loc: string;
  stats: Record<string, number>;
  visited: number;
  regions: number;
  lore: number;
  baseLv: number;
  score: number;
}

export interface DeathCause { id: string; icon: string; label: string; how: string; fixes: string[] }

/** 死因归类：先看 gameOver 文案（最准），再看身体状态兜底 */
export function causeOfDeath(msg: string, s: Pick<RecapState, 'hun' | 'thi' | 'infect' | 'rad' | 'wounds' | 'loc'>): DeathCause {
  const m = String(msg || '');
  const bleed = s.wounds.some(w => /bleed|出血/.test(w));
  const fracture = s.wounds.some(w => /fracture|骨折/.test(w));
  if (/流干了最后一滴血|出血/.test(m) || (bleed && s.hun > 0)) {
    return { id: 'bleed', icon: '🩸', label: '失血过多', how: '伤口一直在流血，你没有及时处理。',
      fixes: ['随身带 2 卷绷带：人体页 → 受伤部位 → 用绷带', '流血伤口别过夜：每过一夜都在替你扣血', '骨折先上夹板，否则走路与逃跑都打折'] };
  }
  if (/尸潮淹没|被这一带彻底吞掉/.test(m)) {
    return { id: 'horde', icon: '🧟', label: '被尸潮吞没', how: '铺开的敌人把你耗死了（它们比你多）。',
      fixes: ['守夜前先看据点页的「今夜守夜」判词，把门窗/围墙补齐', '身上常备 1 个烟雾弹或引诱器：打不过就脱离接触', '血月（每 7 天）与尸群抵达当晚必打——那两天别乱开枪涨噪音'] };
  }
  if (/身体先一步投降|伤口与饥饿/.test(m) || (s.hun <= 0 || s.thi <= 0)) {
    return { id: 'starve', icon: '🍖', label: '饥饿与脱水', how: '饱食或水分见底，身体开始消耗自己。',
      fixes: ['出门前把饱食/水分顶到 80 以上', '净水装置 + 菜园是"每天自动回血"的两条腿（据点页会算给你看）', '背包常备 2 份口粮 + 2 份水：路途比你想的长'] };
  }
  if (s.infect >= 100 || /病毒攻陷|感染/.test(m)) {
    return { id: 'infect', icon: '🦠', label: '感染攻陷', how: '感染值冲到 100，病毒接管了中枢。',
      fixes: ['被咬后立刻用抗生素（医疗台能做）压感染', '感染 ≥60 就睡觉：夜里身体才会压它', '少打近战、多带防咬装备（护甲/护腿）'] };
  }
  if (s.rad >= 60 || /辐射/.test(m)) {
    return { id: 'rad', icon: '☢️', label: '辐射病', how: '辐射累积过量，身体撑不住了。',
      fixes: ['进辐射区先吃碘片（医疗台 Lv1 能做）', '带防毒面具 + 防化服：实验室与地下的必需品', '受辐照后尽快离开并补水，别硬撑到夜里'] };
  }
  if (s.loc === 'lab' || /实验室|方舟/.test(m)) {
    return { id: 'lab', icon: '☣️', label: '死在方舟实验室', how: '深层的防护与弹药不够。',
      fixes: ['下实验室三件套：防毒面具、防化服、足够弹药', '每一层都要留退路：烟雾弹比子弹更能救命', '第 5 层的最终决战不许逃跑，别裸着进'] };
  }
  return { id: 'unknown', icon: '💀', label: '伤重不治', how: '累积的伤与疲惫一起到了尽头。',
    fixes: ['出门带 1 个急救包 + 1 卷绷带', '生命低于 35% 就撤：活着比清场重要', '每晚回据点睡——床能多回一截生命'] };
}

/** 这一局的几个瞬间（只挑真有料的，宁少勿滥） */
export function highlightsOf(s: RecapState): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = []
  const st = s.stats || {}
  if (st.kills > 0) out.push({ icon: '☠️', text: '共击杀 ' + st.kills + ' 只（近战 ' + (st.meleeKills || 0) + ' 只、穿甲弹 ' + (st.apKills || 0) + ' 只）' })
  if (st.hordes > 0) out.push({ icon: '🛡️', text: '守住了 ' + st.hordes + ' 次夜袭' })
  if (s.visited > 0) out.push({ icon: '🗺️', text: '走过 ' + s.visited + ' 个区块' + (s.regions > 1 ? '，跨过 ' + s.regions + ' 个大区' : '') })
  if (st.scav > 0) out.push({ icon: '🔍', text: '搜刮 ' + st.scav + ' 次（深度搜索 ' + (st.deep || 0) + ' 次）' })
  if (s.baseLv > 0) out.push({ icon: '🏠', text: '据点到 ' + s.baseLv + ' 级设施' })
  if (s.lore > 0) out.push({ icon: '📖', text: '解锁 ' + s.lore + ' 条秘闻' })
  if (!out.length) out.push({ icon: '🌅', text: '你只活到了第 ' + s.day + ' 天——但故事总要有人开头' })
  return out.slice(0, 4)
}

/** 下次怎么做：**先给死因里最相关的一条**，再用"这一局的实际数值"补两条（带数字才有人看） */
export function adviceOf(cause: DeathCause, s: RecapState): string[] {
  const out: string[] = []
  if (cause.fixes[0]) out.push(cause.fixes[0])
  if (s.hun < 30) out.push('你死的时候饱食只有 ' + Math.round(s.hun) + '：背包里常留 2 份口粮再出门');
  if (s.mat >= 40) out.push('你攒了 ' + Math.round(s.mat) + ' 材料没花：材料要变成设施/弹药才算数');
  if (s.day >= 8 && s.baseLv < 3) out.push('第 ' + s.day + ' 天据点才 ' + s.baseLv + ' 级：净水装置与菜园能每天替你回血');
  for (const f of cause.fixes.slice(1)) { if (out.length >= 3) break; if (!out.includes(f)) out.push(f) }
  return out.slice(0, 3)
}

export interface BestRun { score: number; days: number; kills: number }
/** 历史最好：只看三项指标，任何一项破了就更新（分别比，不做加权） */
export function mergeBest(prev: BestRun | null, run: BestRun): { best: BestRun; improved: ('score' | 'days' | 'kills')[] } {
  const p = prev || { score: 0, days: 0, kills: 0 }
  const improved: ('score' | 'days' | 'kills')[] = []
  const best: BestRun = { ...p }
  for (const k of ['score', 'days', 'kills'] as const) {
    if (run[k] > p[k]) { best[k] = run[k]; improved.push(k) }
  }
  return { best, improved }
}

/** 一行"本档 vs 最好"（死的时候给自己一个参照系）。
 *  注意 prev 传的是**本局之前的旧记录**（不是合并后的），新纪录才会显示"旧 X" ——
 *  传合并后的记录会写成"旧 12 已刷新"（旧值正好等于新值，看着像 bug）。 */
export function bestLine(run: BestRun, prev: BestRun | null, improved: ('score' | 'days' | 'kills')[]): string {
  const p = prev || { score: 0, days: 0, kills: 0 };
  const tag = (k: 'score' | 'days' | 'kills', label: string) => {
    const isNew = improved.includes(k);
    return isNew ? label + ' ' + run[k] + ' 🏆新纪录（旧 ' + p[k] + '）' : label + ' ' + run[k] + ' / 最好 ' + p[k];
  }
  return [tag('days', '天数'), tag('score', '评分'), tag('kills', '击杀')].join('　·　');
}
