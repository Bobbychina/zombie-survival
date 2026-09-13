/* 判定指标的"人话"名字（纯数据，不碰 DOM）。
   为什么单独放一个文件：委托/剧情的判定文案会直接给玩家看（"搜刮 hospital ×1" 这种
   半中半英的句子一眼就是没做完的半成品），而中文名分散在两个地方——
   POI 在 v4/pois.ts，丧尸在 legacy 的 ZOMBIES 表（legacy 不能 import，v4 也不能 import legacy）。
   这里集中一张表，并由 tests/labels.test.ts 对照两个真源头逐条核对，改名/加条目时会自动报警。 */
import { POIS } from './pois';

/** legacy 的区域 id（不是 v4 的 POI id）：老悬赏板用的是这一套，委托文案可能读到 */
export const ZONE_ZH: Record<string, string> = {
  market: '超市', oldtown: '老城区', subway: '地铁三号线', hospital: '圣玛丽医院',
  police: '第 9 分局', gas: '城西加油站', military: '军方检查站', lab: '方舟实验室',
};

/** legacy 丧尸 id → 中文名（与 game.ts 的 ZOMBIES 表逐字一致，测试会核对） */
export const KILL_ZH: Record<string, string> = {
  walker: '普通丧尸', crawler: '爬行者', runner: '奔跑者', hound: '变异猎犬', brute: '重型丧尸',
  poison: '毒气丧尸', screamer: '尖叫者', armored: '装甲丧尸', giant: '巨型丧尸', bandit: '拾荒者',
  drowned: '溺亡者', spitter: '喷吐者', bomber: '自爆者', hatcher: '孵化者', tyrant: '暴君',
};

/** 点位名：v4 POI 优先，其次 legacy 区域名，最后退回 id（至少不会崩） */
export const poiName = (id: string): string => POIS[id]?.name ?? ZONE_ZH[id] ?? id;
/** 丧尸名 */
export const foeName = (id: string): string => KILL_ZH[id] ?? id;
