/* M37：通关之后那一段（无尽模式）的纯逻辑。
   为什么单独一个文件：legacy/game.ts 是 3600 行老底座，按文件头约定只能 import 纯公式，不重复实现。
   这里装三件"下一个人很容易改坏"的事：
   1) resumeFromOver —— 进无尽 = 清掉"本局已结束"总闸。rescueEnding()（第 100 天好结局）和
      gameOver() 都会把 S.over 置 true，而 v4 世界面板/区域移动/夜间结算全都以 S.over 为总闸
      （world-ui 的 `if (!S || S.over)` 会整块退出渲染）——不清理就会出现玩家报的那个坏档：
      "通关好结局 → 进无尽模式 → 直接死（动不了）+ 地图变回旧版探索页"。
   2) endDayLabel —— 无尽里天数会越过 GOAL_DAY，顶栏"101 / 100"看着像坏档。
   3) endGoalChip —— 通关后日历上的目标牌换成无尽提示。 */

/** 从"已结束"状态复活时给的血量比例（三成：能玩，但依然危险） */
export const ENDLESS_REVIVE_RATE = 0.3;

export interface EndlessSubject {
  over: boolean;
  hp: number;
  hpMax: number;
  ap: number;
  apMax: number;
}

/** 把一局"已结束"（通关或死亡）的存档切回可玩状态：清 over、补行动力、血为 0 时救回三成。
 *  返回 revived=true 表示这次是从死亡界面点进来的（调用方负责给玩家一条日志）。 */
export function resumeFromOver(s: EndlessSubject): { revived: boolean; hp: number } {
  const revived = !(s.hp > 0);                       // 用 !(>0) 而不是 <=0：NaN/undefined 也当死亡处理
  if (revived) s.hp = Math.max(1, Math.round(s.hpMax * ENDLESS_REVIVE_RATE));
  s.over = false;
  if (!(s.ap > 0)) s.ap = s.apMax;
  return { revived, hp: s.hp };
}

/** 顶栏天数：普通局 "12 / 100"，无尽局 "第 132 天 · 无尽"。
 *  字数刻意跟 "999 / 100" 差不多——顶栏是个窄格子，别把 HUD 撑破。 */
export function endDayLabel(day: number, endless: boolean, goalDay: number): string {
  return endless ? ('第 ' + day + ' 天 · 无尽') : (day + ' / ' + goalDay);
}

/** 日历上的目标牌（无尽局不再说"活到第 100 天"） */
export function endGoalChip(endless: boolean, goalDay: number): string {
  return endless
    ? '♾️ <b>无尽模式 · 难度随天数长</b>'
    : '🎯 <b>活到第 ' + goalDay + ' 天</b>';
}

/** 处于"本局已结束"（S.over=true）时，"下一步"该说什么。
 *  老实现一律说"你倒下了"，通关后（还活着、只是这局收尾了）看起来就像坏档。
 *  hp>0 且已通关 → 指向无尽模式（点进去会清 over 复活继续）；否则才是真的倒下了。 */
export function overHint(s: { won: boolean; endless: boolean; hp: number }): { txt: string; act: string; btn: string } {
  const aliveWin = s.won && !s.endless && s.hp > 0;
  return aliveWin
    ? { txt: '你已经走完这条线了。想继续活下去就进无尽模式：地图、据点、图鉴都还在。', act: 'enterEndless()', btn: '♾️ 进入无尽' }
    : { txt: '你倒下了。可以重新开始，或读取上一次存档。', act: 'loadGame()', btn: '读取存档' };
}
