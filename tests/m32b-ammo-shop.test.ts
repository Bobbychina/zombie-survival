/* M32b：商人弹药（用户报障「商人卖的子弹还是旧版，没有各种不同的子弹卖！买了子弹相当于吞材料！！」）
 *
 * 根因三连（都在这一份测试里钉住）：
 *   ① 货架上写的是 M25 之前的伪 id `ammo`（背包里根本没这条物品）；
 *   ② 成交走 grant('ammo')，只加到 S.ammo 这个**镜像**上 → 开一枪就被 ammoCount() 覆写 → 材料白花；
 *   ③ 货架没有兜底校验，坏 id 也能扣材料。
 * 所以这里不测"界面长啥样"（那是探针的事），只测**数值与校验**：id 真的存在、口径对得上、穿甲弹更贵、
 * 坏行必须被坏行检查抓住。legacy 的表用源码文本解析（legacy 顶层就摸 window，Node 里 import 会炸）。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MERCHANT_GOODS, ammoShopRows, badShopRows, shopPrice } from '../src/v4/shop-core';
import { CALIBERS, GENERIC_AMMO, ammoOf, resolveAmmoId } from '../src/v4/ammo-core';
import { itemIds, ammoItems } from './legacy-tables';

const IDS = new Set(itemIds().filter(id => id !== 'ammo'));   // 真物品（伪 id 不算）
const AMMO = ammoItems();
/** 伪造一份"只有存在性"的物品表，喂给 badShopRows */
const items = Object.fromEntries([...IDS].map(id => [id, { t: 'x' }]));

/** 每发单价（材料/发）：比价要看这个，不能只看总价 */
const perRound = (row: { id: string; n?: number; cost: number }) => row.cost / (row.n || 1);

describe('商人货架：弹药按口径/弹种卖', () => {
  it('货架上每一行都是真物品（旧版那个伪 id "ammo" 不许再出现）', () => {
    expect(MERCHANT_GOODS.map(r => r.id)).not.toContain('ammo');
    expect(badShopRows(MERCHANT_GOODS, items)).toEqual([]);
  });

  it('弹药段至少有 6 样、5 个口径全都有的卖', () => {
    const rows = ammoShopRows();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const cals = new Set(rows.map(r => AMMO[r.id]?.cal));
    for (const c of Object.keys(CALIBERS)) expect(cals.has(c)).toBe(true);
  });

  it('每个弹药行都真的是弹药、数量与价格是正数（旧 bug 重现即红：id 不在 ITEMS 里）', () => {
    for (const r of ammoShopRows()) {
      expect(AMMO[r.id], r.id + ' 不在 legacy 的弹药表里').toBeTruthy();
      expect(r.n).toBeGreaterThan(0);
      expect(r.cost).toBeGreaterThan(0);
      expect(IDS.has(r.id)).toBe(true);
    }
  });

  it('穿甲弹（pen ≥ 4）每发都比同口径的普通弹贵', () => {
    const price = (id: string) => perRound(ammoShopRows().find(r => r.id === id)!);
    const pairs: [string, string][] = [
      ['a9_ap', 'a9_fmj'], ['a12_slug', 'a12_buck'],
      ['a556_ap', 'a556_fmj'], ['a762_ap', 'a762_fmj'], ['a308_ap', 'a308_m'],
    ];
    for (const [ap, base] of pairs) {
      expect(AMMO[ap].pen).toBeGreaterThan(AMMO[base].pen);
      expect(price(ap)).toBeGreaterThan(price(base));
    }
  });

  it('高级弹限量更狠、每发单价在合理区间（0.8~25 材料/发）', () => {
    const rows = ammoShopRows();
    const cheap = rows.filter(r => AMMO[r.id].pen <= 3), ap = rows.filter(r => AMMO[r.id].pen >= 4);
    for (const r of rows) {
      expect(perRound(r)).toBeGreaterThanOrEqual(0.8);
      expect(perRound(r)).toBeLessThanOrEqual(25);
      expect(r.stock).toBeGreaterThan(0);
      expect(r.stock).toBeLessThanOrEqual(3);
    }
    expect(Math.min(...ap.map(r => r.stock!))).toBeLessThanOrEqual(Math.min(...cheap.map(r => r.stock!)));
  });

  it('物资与装备那些老货的 id 一个都没写错（顺手把整张表体检一遍）', () => {
    const gear = MERCHANT_GOODS.filter(r => r.sec !== 'ammo').map(r => r.id);
    expect(gear).toContain('medkit');
    expect(gear).toContain('marksman');
    for (const id of gear) expect(IDS.has(id)).toBe(true);
  });

  it('成交价至少 1 材料（汇率再低也不会出现 0 元购）', () => {
    expect(shopPrice({ id: 'a9_fmj', cost: 1 }, 0)).toBe(1);
    expect(shopPrice({ id: 'a9_fmj', cost: 28 }, 0.5)).toBe(14);
  });

  it('兜底校验真的会拦下坏货架（缺 id / 价格为 0 / 数量为 0）', () => {
    expect(badShopRows([{ id: 'ammo', n: 15, cost: 30 }], items)).toHaveLength(1);
    expect(badShopRows([{ id: 'a9_fmj', n: 15, cost: 0 }], items)).toHaveLength(1);
    expect(badShopRows([{ id: 'a9_fmj', n: 0, cost: 30 }], items)).toHaveLength(1);
    expect(badShopRows([{ id: 'a9_fmj', n: 15, cost: 28 }], items)).toHaveLength(0);
  });
});

describe('杂牌弹药折成真弹（grant("ammo") 不再吞材料）', () => {
  it('手上有枪就按枪的口径给（补给是你用得上的那种）', () => {
    expect(resolveAmmoId('ammo', { a12_buck: { t: 'ammo', cal: 'c12', pen: 1 } }, 'c12')).toBe('a12_buck');
    expect(resolveAmmoId('ammo', { a308_ap: { t: 'ammo', cal: 'c308', pen: 6 } }, 'c308')).toBe('a308_ap');
  });

  it('没枪（或口径没有对应弹种）就兜底 9mm FMJ，而且兜底那种真在 ITEMS 里', () => {
    expect(resolveAmmoId('ammo', {}, null)).toBe(GENERIC_AMMO);
    expect(resolveAmmoId('ammo', {}, 'c9')).toBe(GENERIC_AMMO);
    expect(IDS.has(GENERIC_AMMO)).toBe(true);
    expect(AMMO[GENERIC_AMMO].cal).toBe('c9');
  });

  it('多个弹种时给该口径最便宜的那种（按穿透升序取第一个）', () => {
    const table = { a9_ap: { t: 'ammo', cal: 'c9', pen: 4 }, a9_fmj: { t: 'ammo', cal: 'c9', pen: 2 } };
    expect(resolveAmmoId('ammo', table, 'c9')).toBe(ammoOf(table, 'c9')[0].id);
    expect(resolveAmmoId('ammo', table, 'c9')).toBe('a9_fmj');
  });

  it('非 ammo 的 id 原样返回（grant 的其它来源不受影响）', () => {
    expect(resolveAmmoId('medkit', {}, 'c9')).toBe('medkit');
    expect(resolveAmmoId('a556_ap', {}, null)).toBe('a556_ap');
  });
});

describe('营地商人的货架也没有伪 id', () => {
  const npcSrc = readFileSync('src/v4/npc.ts', 'utf8');
  const goods = [...npcSrc.matchAll(/\{ id: '([a-z0-9_]+)', n: \d+, base: \d+ \}/g)].map(m => m[1]);

  it('GOODS 里每样都真的存在，弹药是按弹种列的', () => {
    expect(goods.length).toBeGreaterThanOrEqual(10);
    expect(goods).not.toContain('ammo');
    for (const id of goods) expect(IDS.has(id), id + ' 不在 ITEMS 里').toBe(true);
    expect(goods.filter(id => AMMO[id]).length).toBeGreaterThanOrEqual(3);
  });
});
