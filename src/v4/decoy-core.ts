/* M56：避战道具（气味引诱器）—— 用户：「增加几个道具：气味引诱器…分成几个等级，
 *   简易的可以让普通僵尸离开，高阶的可以赶走高级僵尸」「可以让僵尸离开…避战用的」「可以找到或者自己做」。
 *
 *  三档，覆盖不同的威胁层级：
 *    ① 简易气味引诱器（tier 1）：腐肉 + 布料扎的臭味包 —— 引走**普通**丧尸；
 *    ② 强力气味引诱器（tier 2）：浓缩化学臭味 —— 连**进阶**（壮汉/毒尸/猎犬/喷吐者/巨型…）也扛不住；
 *    ③ 军用信息素诱饵（tier 3）：军用级配方 —— **精英与暴君**也会转身离开。
 *
 *  规则（都在这里，UI 只读）：
 *    - 只会用"够档"的**最低档**道具（省着用高级货）；
 *    - 一只都引不走时**不消耗**道具，只提示（别让玩家白扔）；
 *    - 引走一部分 → 剩下的继续打（引走的**不掉战利品、不给经验** —— 它们没死）；
 *    - 全部引走 = 战斗以"脱离"结束（等同逃跑，但不用赌成功率）；
 *    - 守夜战 / 最终决战 / 血月（noFlee 场合）**一律无效**：血味盖过引诱剂。
 */
export interface DecoyDef { id: string; tier: 1 | 2 | 3; name: string; icon: string; drives: string }
export const DECOYS: DecoyDef[] = [
  { id: 'decoy1', tier: 1, name: '简易气味引诱器', icon: '🧪', drives: '普通丧尸' },
  { id: 'decoy2', tier: 2, name: '强力气味引诱器', icon: '⚗️', drives: '进阶丧尸（壮汉 / 毒尸 / 猎犬 / 喷吐者…）' },
  { id: 'decoy3', tier: 3, name: '军用信息素诱饵', icon: '🪖', drives: '精英与暴君' },
];
export const DECOY_BY_ID: Record<string, DecoyDef> = Object.fromEntries(DECOYS.map(d => [d.id, d]));

/** 普通丧尸（tier 1）：新手区那些 */
const TIER1 = ['walker', 'runner', 'crawler', 'hound', 'drowned', 'rotter'];
/** 进阶（tier 2）：有点手段的 */
const TIER2 = ['brute', 'poison', 'spitter', 'hatcher', 'giant', 'armored', 'screamer', 'bandit', 'soldier'];

/** 判定一个敌人的威胁层级（精英与 boss 一律 3；未知 id 按 2 保守处理 —— 别让新怪被一档道具白嫖） */
export function foeTier(f: { id?: string; boss?: boolean; elite?: boolean; traits?: string[] }): 1 | 2 | 3 {
  if (f.boss) return 3;
  if (f.elite) return 3;
  if (f.traits && (f.traits.includes('boss') || f.traits.includes('elite'))) return 3;
  const id = String(f.id || '');
  if (TIER1.includes(id)) return 1;
  if (TIER2.includes(id)) return 2;
  return 2;
}

export interface DecoyPlan {
  /** 实际会用掉的道具（null = 一个都用不了） */
  item: string | null;
  /** 会被引走的敌人下标 */
  driven: number[];
  /** 留下来的敌人下标（继续打） */
  stays: number[];
  /** 给玩家的一句话 */
  text: string;
  /** 全部引走 = 战斗直接结束（等同脱离） */
  clears: boolean;
}

export function planDecoy(
  inv: Record<string, number | undefined>,
  foes: { id?: string; boss?: boolean; elite?: boolean; traits?: string[]; hp: number }[],
  opts: { noFlee?: boolean } = {},
): DecoyPlan {
  const alive = foes.map((f, i) => ({ f, i })).filter(x => x.f.hp > 0);
  if (!alive.length) return { item: null, driven: [], stays: [], text: '场上已经没有敌人了。', clears: true };
  if (opts.noFlee) {
    return { item: null, driven: [], stays: alive.map(x => x.i), text: '血味盖过了引诱剂：这种场合（血月 / 守夜战 / 决战）引诱器没用。', clears: false };
  }
  const tiers = alive.map(x => foeTier(x.f));
  const maxTier = Math.max(...tiers) as 1 | 2 | 3;
  const owned = DECOYS.filter(d => (inv[d.id] ?? 0) > 0).sort((a, b) => a.tier - b.tier);
  const best = owned.find(d => d.tier >= maxTier);
  if (best) {
    return { item: best.id, driven: alive.map(x => x.i), stays: [], clears: true,
      text: best.icon + ' ' + best.name + '：' + best.drives + '全被引开了，你趁机脱离接触。' };
  }
  const partial = owned.length ? owned[owned.length - 1] : null;
  if (partial) {
    const driven = alive.filter((x, k) => tiers[k] <= partial.tier).map(x => x.i);
    const stays = alive.filter((x, k) => tiers[k] > partial.tier).map(x => x.i);
    if (!driven.length) {
      return { item: null, driven: [], stays: alive.map(x => x.i), clears: false,
        text: '这些家伙不吃这一套（' + partial.name + ' 只对 ' + partial.drives + ' 有效），道具没浪费，但也没用。' };
    }
    return { item: partial.id, driven, stays, clears: false,
      text: partial.icon + ' ' + partial.name + '：引走了 ' + driven.length + ' 只，剩下 ' + stays.length + ' 只还得打。' };
  }
  return { item: null, driven: [], stays: alive.map(x => x.i), text: '身上没有气味引诱器（工作台能做，超市 / 诊所 / 军方的箱子里也能搜到）。', clears: false };
}
