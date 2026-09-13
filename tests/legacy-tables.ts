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
