/* 静态数据体检：专治"背包里显示 undefined"这类问题（用户实测：麦子和种子显示 undefined——
   根因是新增物品用了 t:'item'，而 TYPE_LABEL 只认 food/drink/med/mat/wpn/gear/thr/key）。
   不 import legacy（它要 DOM），直接读源码文本，把物品表 / 配方 / 建造 / 掉落里出现的 id 全核对一遍。
   注意：M6/M7 的新物品是用 Object.assign(ITEMS, {...}) 追加的、配方是 RECIPES.push(...)，
   所以这里按"块"扫描时必须把两种写法都收进来，否则会漏掉一半（本测试第一版就漏了）。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { matYield } from '../src/v4/search-core';
import { MAT_MUL_DEEP, MAT_MUL_NORMAL } from '../src/v4/env-core';

const legacy = readFileSync('src/legacy/game.ts', 'utf8');
const poisSrc = readFileSync('src/v4/pois.ts', 'utf8');

/** 收集所有匹配的区块：从 `const X = {` / `Object.assign(X, {` 起，到下一个顶格的 } 或 ) 行止 */
function blocks(text: string, startRe: RegExp): string {
  const re = new RegExp(startRe.source, 'gm');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index);
    const end = /\n(?=[})])/.exec(rest);
    out.push(end ? rest.slice(0, end.index) : rest);
    re.lastIndex = m.index + (end ? end.index : rest.length);
  }
  if (!out.length) throw new Error('没找到区块：' + startRe);
  return out.join('\n');
}

const itemsBlock = blocks(legacy, /^(?:const ITEMS = \{|Object\.assign\(ITEMS, \{)/);
const typeLabelBlock = blocks(legacy, /^const TYPE_LABEL = \{/);

/** ITEMS 里的 id（顶层两空格缩进的键） */
function itemIds(text: string): string[] {
  return [...text.matchAll(/^ {2}([A-Za-z_]\w*):\s*\{/gm)].map(m => m[1]);
}
/** 平坦对象里的键名（如 TYPE_LABEL / need / loot 的花括号内容） */
function keysIn(text: string): string[] {
  return [...text.matchAll(/([A-Za-z_]\w*)\s*:/g)].map(m => m[1]);
}

const IDS = itemIds(itemsBlock);
const TYPES = keysIn(typeLabelBlock);
const SPECIAL = new Set(['ammo']);                       // 弹药是独立计数，不在 ITEMS 里
const known = (id: string) => IDS.includes(id) || SPECIAL.has(id);

describe('物品表完整性（防 undefined）', () => {
  it('每件物品都有名字，且 t 必须是 TYPE_LABEL 认得的类型', () => {
    const bad = [...itemsBlock.matchAll(/\bt:\s*'([^']*)'/g)].map(m => m[1]).filter(t => !TYPES.includes(t));
    expect(bad).toEqual([]);                             // 出现 t:'item' 这种野类型就会挂在背包里
    expect(TYPES.length).toBeGreaterThanOrEqual(8);
    expect(IDS.length).toBeGreaterThan(45);
  });

  it('每行走物品都带 n:（没名字 = 界面上就是空白）', () => {
    const named = (itemsBlock.match(/\{n:\s*'/g) ?? []).length;
    expect(named).toBe(IDS.length);
  });

  it('物品 id 不重复', () => {
    expect(new Set(IDS).size).toBe(IDS.length);
  });
});

describe('配方 / 建造 / 掉落表只引用存在的物品', () => {
  it('RECIPES 的 out 与 need 都在 ITEMS 里', () => {
    const recipes = blocks(legacy, /^(?:const RECIPES = \[|RECIPES\.push\()/);
    const outs = [...recipes.matchAll(/out:\s*'([^']+)'/g)].map(m => m[1]);
    expect(outs.length).toBeGreaterThan(15);
    expect(outs.filter(id => !known(id))).toEqual([]);
    const needs: string[] = [];
    for (const m of recipes.matchAll(/need:\s*\{([^}]*)\}/g)) needs.push(...keysIn(m[1]));
    expect(needs.length).toBeGreaterThan(20);
    expect(needs.filter(id => !known(id))).toEqual([]);
  });

  it('BASE_UP（据点升级）的 cost 都在 ITEMS 里', () => {
    const base = blocks(legacy, /^(?:const BASE_UP = \{|Object\.assign\(BASE_UP, \{)/);
    const cost: string[] = [];
    for (const m of base.matchAll(/cost:\s*\{([^}]*)\}/g)) cost.push(...keysIn(m[1]));
    expect(cost.length).toBeGreaterThan(5);
    expect(cost.filter(id => !known(id))).toEqual([]);
  });

  it('POI 掉落表（含 M7.1 新增的家具城/建材市场等）只掉存在的物品', () => {
    const lootKeys: string[] = [];
    for (const m of poisSrc.matchAll(/loot:\s*\{([^}]*)\}/g)) lootKeys.push(...keysIn(m[1]));
    expect(lootKeys.length).toBeGreaterThan(50);
    expect(lootKeys.filter(id => !known(id))).toEqual([]);
  });
});

describe('M7.1 现代建筑与建材产出', () => {
  it('7 个新增商业建筑都带 matBonus，且建材类给得比普通店多', () => {
    const modern = ['furniture', 'hardware', 'megamart', 'office', 'appliance', 'depot', 'buildmart'];
    for (const id of modern) {
      // M8：逐个建筑自己那条必须有 matBonus（原来只断言了"全文出现 id:"，等于没查加成）
      const entry = poisSrc.split('\n').find(l => l.includes(id + ':')) ?? '';
      expect(entry).toContain('matBonus:');
    }
    const bonus = [...poisSrc.matchAll(/matBonus:\s*(\d+)/g)].map(m => Number(m[1]));
    // M8 新增的林场(lumber)/木材加工厂(sawmill) 也带 matBonus（木头专供），总数 7 → 9，
    // 所以这里改成下界：原来的 7 个不许少，新增的不算破坏
    expect(bonus.length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...bonus)).toBeGreaterThanOrEqual(5);   // 建材市场/物流园是建材主力
    expect(bonus.every(n => n > 0)).toBe(true);
  });

  it('净化片与两条净水路线（煮沸 / 净化片）都在配方里', () => {
    expect(IDS).toContain('purify');
    expect(legacy).toMatch(/need:\s*\{\s*dirty:\s*2,\s*wood:\s*1\s*\}/);      // 煮沸
    expect(legacy).toMatch(/need:\s*\{\s*dirty:\s*1,\s*purify:\s*1\s*\}/);    // 净化片
    expect(legacy).toMatch(/out:\s*'purify'/);                                 // 净化片自己做（化工原料+布）
  });

  it('建材加成真的进了材料产出公式（matYield 是 search.ts 唯一入口）', () => {
    const mid = () => 0.5;                                                     // 固定骰点，只看加成差
    const plain = matYield(mid, 1, false, 0, MAT_MUL_NORMAL, MAT_MUL_DEEP);
    const mart = matYield(mid, 1, false, 6, MAT_MUL_NORMAL, MAT_MUL_DEEP);
    expect(mart - plain).toBe(6);                                             // 加多少就是多少，不被四舍五入吃掉
    expect(matYield(mid, 1, true, 6, MAT_MUL_NORMAL, MAT_MUL_DEEP)).toBeGreaterThan(mart);   // 深搜再多一层 ×1.5
    expect(matYield(() => 0, 1, false, 0, MAT_MUL_NORMAL, MAT_MUL_DEEP)).toBeGreaterThanOrEqual(1);  // 最少 1 份
    expect(readFileSync('src/v4/search.ts', 'utf8')).toContain('matYield(Math.random, block.danger, deep, poi.matBonus ?? 0');
  });
});
