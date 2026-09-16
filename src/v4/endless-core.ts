/* M37/M51：通关之后那一段（无尽模式）的纯逻辑。
   为什么单独一个文件：legacy/game.ts 是 3600 行老底座，按文件头约定只能 import 纯公式，不重复实现。
   这里装三件"下一个人很容易改坏"的事：
   1) winContinuePatch —— **通关 = 这一局继续往下走**（M51）。以前通关会把 S.over 置 true（"本局已结束"），
      而 v4 世界面板/区域移动/夜间结算全都以 S.over 为总闸：玩家关掉结局弹窗后整屏就退化成
      旧版探索页（旧版「城市地图」+「本局已通关」图例），必须再点一次「进入无尽模式」才回得来。
      现在通关当场清 over + 开无尽，界面全程是 v4。
   2) resumeFromOver —— 老档/旧路径可能已经把 over 置上了，进无尽时统一清掉（血为 0 的救回三成）。
   3) endDayLabel / endGoalChip —— 无尽里天数会越过 GOAL_DAY，顶栏"101 / 100"看着像坏档。 */

/** 从"已结束"状态复活时给的血量比例（三成：能玩，但依然危险） */
export const ENDLESS_REVIVE_RATE = 0.3;

export interface EndlessSubject {
  over: boolean;
  hp: number;
  hpMax: number;
  ap: number;
  apMax: number;
}

/** 把一局"已结束"的存档切回可玩状态：清 over、补行动力、血为 0 时救回三成。
 *  返回 revived=true 表示这次是从死亡界面点进来的（调用方负责给玩家一条日志）。 */
export function resumeFromOver(s: EndlessSubject): { revived: boolean; hp: number } {
  const revived = !(s.hp > 0);                       // 用 !(>0) 而不是 <=0：NaN/undefined 也当死亡处理
  if (revived) s.hp = Math.max(1, Math.round(s.hpMax * ENDLESS_REVIVE_RATE));
  s.over = false;
  if (!(s.ap > 0)) s.ap = s.apMax;
  return { revived, hp: s.hp };
}

/** M51：通关（取回解药 / 第 100 天救援）之后的状态补丁。
 *  通关不是"本局已结束"，而是转入无尽延续 —— 所以 over 清掉、endless 打开；
 *  血/行动力沿用 resumeFromOver 的兜底（老档可能停在"over=true 且血为 0"的半死状态）。 */
export function winContinuePatch(s: EndlessSubject & { endless: boolean }): { over: boolean; endless: boolean; hp: number; ap: number } {
  const back = resumeFromOver(s);                    // 内部已把 s.over 清成 false
  return { over: false, endless: true, hp: back.hp, ap: s.ap };
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

/* M51：overHint 已删除 —— 通关不再置 over（见 winContinuePatch），所以 over=true 只剩"真死了"一种情形，
   "通关了还活着"的分支永远不可能出现，留着只会让人以为还存在那个中间态。 */
