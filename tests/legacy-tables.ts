/* 测试公用的"从 legacy 源码里读数据表"helper。
   为什么不在测试里 import legacy：那份代码在模块顶层就摸 window（matchMedia / localStorage），
   在 Node 里一 import 就炸。所以按 items.test.ts 的老办法——读源码文本解析。
   这样做的价值：内容表加了新条目时，测试**自动跟上**，不需要再手工维护一份 KNOWN 名单
   （world.test.ts 原来就是手写名单，加了新丧尸会误报）。 */
import { readFileSync } from 'node:fs';

const src = (): string => readFileSync('src/legacy/game.ts', 'utf8');

export interface LegacyZombie { n: string; loot: Record<string, number> }

/** 解析 const ZOMBIES = { ... } 这一块 */
export function zombieTable(): Record<string, LegacyZombie> {
  const text = src();
  const block = /const ZOMBIES = \{([\s\S]*?)\n\};/.exec(text);
  const out: Record<string, LegacyZombie> = {};
  if (!block) return out;
  const re = /(\w+):\s*\{n:'([^']+)'[^}]*?loot:\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) {
    const loot: Record<string, number> = {};
    m[3].split(',').forEach(pair => {
      const [k, v] = pair.split(':');
      if (k && v) loot[k.trim()] = Number(v);
    });
    out[m[1]] = { n: m[2], loot };
  }
  return out;
}

export const zombieIds = (): string[] => Object.keys(zombieTable());

/** legacy 的 ITEMS 里所有物品 id（委托/剧情的奖励物品必须在里面，否则 grant 会空摔） */
export function itemIds(): string[] {
  const text = src();
  const ids = new Set<string>();
  const tables = [...text.matchAll(/Object\.assign\(ITEMS, \{([\s\S]*?)\n\}\);/g), /const ITEMS = \{([\s\S]*?)\n\};/.exec(text)]
    .filter(Boolean) as RegExpExecArray[];
  for (const t of tables) {
    const body = t[1] ?? '';
    for (const m of body.matchAll(/(?:^|\n)\s*([a-z_][a-z0-9_]*)\s*:\s*\{/g)) ids.add(m[1]);
  }
  /* M32b：'ammo' 仍是掉落/委托表里在用的"杂牌弹药"来源 id（商人货架上不许再出现它），
     grant() 会先把它折成真弹（见 ammo-core.resolveAmmoId）再进背包。 */
  ids.add('ammo');
  return [...ids];
}

/** legacy ITEMS 里的弹药条目：{ id: {cal, pen} }（M32b：货架/掉落的口径核对要用） */
export function ammoItems(): Record<string, { cal: string; pen: number; dmgMul: number }> {
  const text = src();
  const out: Record<string, { cal: string; pen: number; dmgMul: number }> = {};
  const re = /(?:^|\n)\s*([a-z_][a-z0-9_]*)\s*:\s*\{n:'[^']*',\s*t:'ammo',[^}]*?cal:'(\w+)',\s*pen:(\d+),\s*dmgMul:([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1]] = { cal: m[2], pen: Number(m[3]), dmgMul: Number(m[4]) };
  return out;
}
