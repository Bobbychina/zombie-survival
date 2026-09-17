/* M56：逃跑与"避战道具"的纯逻辑 —— 用户报的两件事：
 *   ① 「逃跑失败了也不会受伤，完全可以无限逃跑避战」：旧代码逃跑失败只写一行日志，
 *      既不掉血也不被反击，而成功率下限 8% —— 于是"一直点逃跑"= 无限免战（战斗里没有任何代价）。
 *      修法：失败 = 你把后背露给了它们 → **每个还活着的敌人立刻白打你一轮** + 掉体力，
 *      而且**每失败一次，逃跑成功率再 -8%**（连试越难跑），最低仍留 8% 的"侥幸"，不给"必死"。
 *   ② 新增避战道具（气味引诱器，三档）：见 decoy-core。
 */
export interface FleeChanceInput {
  /** 基础值（legacy 用 .42，v4 引擎用 .45） */
  base: number;
  stealthLv?: number;
  hasBoots?: boolean;
  /** 场上有"迅捷"敌人（spd ≥ 2） */
  fast?: boolean;
  /** 负重压身（>1 表示超重） */
  encOver?: boolean;
  /** 这场战斗根本不许逃（守夜战 / 最终决战 / 血月） */
  noFlee?: boolean;
  /** 已经失败过几次 */
  tries?: number;
}

export const FLEE_MIN = 0.08;
export const FLEE_MAX = 0.92;
/** 每失败一次，下一次更难跑（它们已经盯上你了） */
export const FLEE_TRY_PENALTY = 0.08;
/** 逃跑失败一次的体力代价 */
export const FLEE_FAIL_STA = 8;

export function fleeChanceOf(o: FleeChanceInput): number {
  if (o.noFlee) return 0;
  let p = o.base + (o.stealthLv || 0) * 0.035 + (o.hasBoots ? 0.08 : 0);
  if (o.fast) p -= 0.18;
  if (o.encOver) p -= 0.15;
  p -= FLEE_TRY_PENALTY * Math.max(0, Math.floor(o.tries || 0));
  return Math.max(FLEE_MIN, Math.min(FLEE_MAX, p));
}

/** 逃跑失败会发生什么：每个活着的敌人白打一轮 + 体力代价（数值给 UI 与探针读） */
export interface FleeFailPlan { freeAttacks: number; staCost: number; text: string }
export function fleeFailPlan(aliveCount: number): FleeFailPlan {
  const n = Math.max(0, Math.floor(aliveCount));
  return {
    freeAttacks: n,
    staCost: FLEE_FAIL_STA,
    text: n > 0
      ? '❌ 逃跑失败——你把后背露给了它们（' + n + ' 次白挨，体力 -' + FLEE_FAIL_STA + '，下一次逃跑更难）。'
      : '❌ 没跑掉，但你身边暂时没有能追上来的东西。',
  };
}
