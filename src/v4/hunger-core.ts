/* M55：饥饿与脱水的**夜间**结算 —— 用户报的速通漏洞的根因就在这里。
 *
 *  漏洞复现（探针实录）：把角色扔在野外、不吃不喝连点 24 次「睡觉」——HP 从 100 一路涨到 140，
 *  饱食/水分停在 0 也毫无代价，最后一路睡到第 100 天直接通关。
 *  为什么以前没拦住：`tickVitals()` 里的"归零掉血"只在**行动**时结算（每次行动 -4/-5），
 *  而睡觉走的是 nightTick —— 那里只扣 12 饱食 / 14 水分，从没调过饥饿伤害，
 *  于是"只睡觉"这条路上饥饿永远不会伤人，而睡觉每晚还稳定回血。**免费过夜 = 免费通关**。
 *
 *  修法（都在这一份可单测的纯逻辑里）：
 *    ① 夜里也结算饥饿/脱水伤害，且**连续挨饿会加剧**（睡一晚饿得更狠，封顶）；
 *    ② 饱食或水分见底时，睡眠回血只剩 25%（空着肚子睡不安稳，别想靠睡觉把血睡回来）；
 *    ③ 不在据点过夜，饱食/水分消耗 ×1.5（没热饭、没净水，冻一夜更耗人）。
 */
export interface StarveStep {
  hpLoss: number;
  starveN: number;
  thirstN: number;
  /** 给玩家看的日志（一句一条，最多两条） */
  lines: string[];
}

/** 挨饿/脱水每多一晚，伤害递增（封顶），避免"归零了但躺着不掉血" */
export const STARVE_BASE = 4, STARVE_PER_NIGHT = 2, STARVE_CAP = 18;
export const THIRST_BASE = 5, THIRST_PER_NIGHT = 3, THIRST_CAP = 24;
/** 又饿又渴：双重衰竭的额外伤害 */
export const DOUBLE_WEAK = 4;

export function starvationTick(o: { hun: number; thi: number; starveN?: number; thirstN?: number }): StarveStep {
  const starving = o.hun <= 0, parched = o.thi <= 0;
  const starveN = starving ? Math.max(0, Math.floor(o.starveN || 0)) + 1 : 0;
  const thirstN = parched ? Math.max(0, Math.floor(o.thirstN || 0)) + 1 : 0;
  let hpLoss = 0;
  const lines: string[] = [];
  if (starving) {
    const d = Math.min(STARVE_CAP, STARVE_BASE + STARVE_PER_NIGHT * starveN);
    hpLoss += d;
    lines.push('🍖 饥饿第 ' + starveN + ' 晚：身体开始吃自己（-' + d + ' 生命）。背包里有罐头/饼干/肉就吃一口。');
  }
  if (parched) {
    const d = Math.min(THIRST_CAP, THIRST_BASE + THIRST_PER_NIGHT * thirstN);
    hpLoss += d;
    lines.push('💧 脱水第 ' + thirstN + ' 晚：嘴唇裂开、视线发黑（-' + d + ' 生命）。喝一口水（净水/雨水都行）。');
  }
  if (starving && parched) {
    hpLoss += DOUBLE_WEAK;
    lines.push('☠️ 又饿又渴：这一夜把你掏空了（额外 -' + DOUBLE_WEAK + '）。');
  }
  return { hpLoss, starveN, thirstN, lines };
}

/** 睡眠回血倍率：空腹或脱水时只剩 1/4（别想靠睡觉把血睡回来） */
export function sleepHealMul(hun: number, thi: number): number {
  return (hun <= 0 || thi <= 0) ? 0.25 : 1;
}

/** 过夜的饱食/水分消耗：据点里 12 / 14；野外 ×1.5（没热饭、没净水，冻一夜更耗人） */
export function nightConsumption(atBase: boolean): { hun: number; thi: number } {
  return atBase ? { hun: 12, thi: 14 } : { hun: 18, thi: 21 };
}

/** 睡觉前的劝告（HUD/日志用一句话把风险说清） */
export function sleepWarning(hun: number, thi: number): string {
  if (hun <= 0 && thi <= 0) return '⚠️ 又饿又渴：先吃点东西喝水再睡，不然这一夜会要命。';
  if (hun <= 0) return '⚠️ 空着肚子睡觉：会掉血，而且回不了多少生命（包里找点吃的）。';
  if (thi <= 0) return '⚠️ 严重脱水：会掉血，而且回不了多少生命（喝一口水再睡）。';
  if (hun < 18 || thi < 18) return '⚠️ 饿/渴得厉害：睡之前吃点喝点，夜里恢复会打折。';
  return '';
}
