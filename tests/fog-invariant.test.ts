/* M21：全图迷雾不变量（用户报"动不了"＝整张地图连脚下都是黑的，一格都点不了）。
   根因：worldOf 以前只缓存 **1 个**世界实例，而 quests.poisIn() 为了扫"别区有没有某种 POI"
   会调 worldOf(seed, 别的区域)，把当前区域的世界挤掉；下一次 ensureSaveWorld 拿到的
   就是一个**刚重建、全黑**的实例，可"指纹（visited 条数/情报/无线电）没变就不重放迷雾"的
   性能优化又跳过了重放 —— 于是整张图全黑、连脚下都不亮，玩家一步都动不了（死锁）。
   修法：①世界缓存改多槽 LRU；②指纹里带上**世界实例本身**，实例换了就一定重放。
   这两条断言必须一直绿——它是"玩家能不能动"的唯一入口。 */
import { describe, expect, it } from 'vitest';
import { ensureSaveWorld, worldOf } from '../src/v4/worldstate';
import { HOME_REGION, REGIONS, setActiveRegions } from '../src/v4/regions-core';
import { blockAt } from '../src/v4/worldgen';

/** 数一张图上被点亮的格子（探针与测试用的是同一套真实数据） */
function litCount(seed: string, region: string): number {
  const w = worldOf(seed, region);
  let n = 0;
  for (const k in w.blocks) if (w.blocks[k].revealed) n++;
  return n;
}

function freshSave(seed: string) {
  const S: any = { seed, day: 1 };
  const sw = ensureSaveWorld(S);
  ensureSaveWorld(S);        // 第二次调用才会写下"迷雾指纹"，第 1 次走的是建新档分支（不写指纹）
  return { S, sw };
}

describe('M21 迷雾不变量：脚下永远亮着', () => {
  it('扫别区 POI（worldOf 别的区域）之后，当前区域仍是同一个实例、脚下仍亮', () => {
    const seed = 'fog-a';
    setActiveRegions(seed);
    const { S, sw } = freshSave(seed);
    const w1 = worldOf(sw.seed, sw.region);
    expect(blockAt(w1, sw.cur.x, sw.cur.y)!.revealed).toBe(true);
    const before = litCount(sw.seed, HOME_REGION);
    expect(before).toBeGreaterThanOrEqual(5);          // 离家一圈基本都亮（贴边时略少）

    // 这就是 quests.poisIn() 干的事：为了扫别区的 POI 去拿另一张图
    const other = REGIONS.find(r => r.id !== sw.region && r.type !== 'water')!;
    worldOf(sw.seed, other.id);
    expect(worldOf(sw.seed, sw.region)).toBe(w1);      // 多槽缓存：当前区域没被挤掉

    ensureSaveWorld(S);                                // 下一次渲染
    expect(blockAt(worldOf(sw.seed, sw.region), sw.cur.x, sw.cur.y)!.revealed).toBe(true);
    expect(litCount(sw.seed, HOME_REGION)).toBe(before);
  });

  it('缓存被挤爆、当前区域的世界被重建，迷雾也必须重放（不许出现全黑图）', () => {
    const seed = 'fog-b';
    setActiveRegions(seed);
    const { S, sw } = freshSave(seed);
    const before = litCount(sw.seed, HOME_REGION);
    const w1 = worldOf(sw.seed, sw.region);
    expect(blockAt(w1, sw.cur.x, sw.cur.y)!.revealed).toBe(true);

    // 连开 12 个区域：LRU 一定会把当前区域挤出去（它的实例随即变成"全黑的新对象"）
    const others = REGIONS.filter(r => r.id !== sw.region).slice(0, 12);
    for (const r of others) worldOf(sw.seed, r.id);

    ensureSaveWorld(S);
    const w2 = worldOf(sw.seed, sw.region);
    expect(w2).not.toBe(w1);                                            // 确认真的重建过
    expect(blockAt(w2, sw.cur.x, sw.cur.y)!.revealed).toBe(true);        // 重建后必须重新点亮脚下
    expect(litCount(sw.seed, HOME_REGION)).toBe(before);
  });
});
