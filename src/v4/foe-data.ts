/* 丧尸的"属性"与"特殊机制"表 —— 纯数据，不碰 DOM、不 import legacy。
   为什么要单独拆出来：bridge.ts 会 import '../main'（那里要 window），
   单测一旦 import bridge 就把整个 App 拖进 Node 环境直接炸。
   纯数据放这里，测试可以放心 import（和 env-core / *-core 同一个套路）。 */
import type { FoeType } from '../types';

/** 丧尸模板 id → 宝可梦式"属性"（决定克制关系） */
export const FOE_TYPES: Record<string, FoeType[]> = {
  walker: ['flesh'], crawler: ['flesh', 'swift'], runner: ['flesh', 'swift'], hound: ['flesh', 'swift'],
  brute: ['flesh', 'hulk'], poison: ['toxic'], screamer: ['flesh', 'swift'],
  armored: ['armor', 'bone'], giant: ['hulk', 'flesh'], bandit: ['flesh'],
  boss_a: ['armor', 'hulk'], boss_b: ['toxic', 'hulk'],
  /* M7 的水下敌人之前漏登记了（靠 toFoe 的兜底当皮肉处理，行为没坏但属性表对不上）；
     一致性测试就是抓这个的。保持 ['flesh'] = 与旧行为完全一致，不顺手改平衡。 */
  drowned: ['flesh'],
  /* M11：自爆者刻意给 toxic（火焰打毒囊效果拔群），和"用火烧就不会炸"的机制呼应 */
  spitter: ['toxic', 'swift'], bomber: ['toxic', 'flesh'], hatcher: ['flesh', 'toxic'], tyrant: ['armor', 'hulk'],
};

/** 丧尸 id → 引擎要用的特殊机制（combat.ts 里消费这些字符串） */
export const FOE_TRAITS: Record<string, string[]> = {
  spitter: ['ranged'],      // 远程酸液：无视格挡，命中叠"护甲腐蚀"
  bomber: ['volatile'],     // 死亡爆炸：被火焰/爆炸打死则不炸（等于提前引爆）
  hatcher: ['spawn'],       // 每两回合产出一只爬行者（上限 2）
  tyrant: ['enrage'],       // 半血后狂暴：攻击 +50%，只触发一次
};

/** 丧尸 id → 招式偏好（威力按它的伤害换算） */
export function foeMoves(id: string, atk: number): string[] {
  const heavy = atk >= 14;
  const swift = id === 'runner' || id === 'hound' || id === 'screamer' || id === 'crawler' || id === 'spitter';
  const out = ['claw'];
  if (heavy) out.push('slam');
  if (swift) out.push('pounce');
  if (id === 'poison' || id === 'boss_b' || id === 'spitter') out.push('spit');
  if (id === 'tyrant') out.push('smash');
  return out;
}
