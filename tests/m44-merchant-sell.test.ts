/* M44：把多余的东西卖回给商人（用户：「可以让用户将自己的多余物品出售给商人（收购价格比购买价格更低）」）
 *
 * 三条已与用户确认的口径，这份测试逐条钉住：
 *   ① 回收价 = 买价的 45%（与营地 npc.sellPrice 同一个数）；
 *   ② 除剧情道具、独一份的、身上穿/手里拿的之外**什么都能卖**（掉落/采集/制作物也在内）；
 *   ③ 批量出售只算账、不成交 —— 成交必须由 UI 走二次确认（那是探针的事）。
 * 还有一条不变量：**一批货卖回去的钱一定少于买进来**（否则商人 = 刷材料机）。
 * 表还是从 legacy 源码解析（legacy 顶层就摸 window，Node 里 import 会炸）。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MERCHANT_GOODS, SELL_RATE, NO_SELL, ITEM_BASE, baseValueOf, canSell, sellBlockReason,
  sellValue, sellPlan, sellBatchPlan, shopPrice, badShopRows,
} from '../src/v4/shop-core';
import { itemTable } from './legacy-tables';

const ITEMS = itemTable();
const IDS = Object.keys(ITEMS);
const SELLABLE = IDS.filter(id => id !== 'ammo' && canSell(id, ITEMS));      // 'ammo' 是伪 id（背包里不存在）
const SHELF = MERCHANT_GOODS;

describe('M44 收购价：永远是买价的 45%', () => {
  it('回收率 45% 且必须小于 1（大于等于 1 就是刷材料机）', () => {
    expect(SELL_RATE).toBe(0.45);
    expect(SELL_RATE).toBeLessThan(1);
    expect(SELL_RATE).toBeGreaterThan(0);
  });

  it('货架上每一样：整叠买进来再整叠卖回去，一定亏（汇率 0.55 / 1.0 / 1.4 三档都验）', () => {
    for (const rate of [0.55, 1, 1.4]) {
      for (const r of SHELF) {
        const n = r.n || 1;
        const buy = shopPrice(r, rate);
        const back = sellValue(r.id, n, rate, ITEMS);
        expect(back, r.id + ' @rate' + rate + '：卖回 ' + back + ' ≥ 买价 ' + buy).toBeLessThan(buy);
      }
    }
  });

  it('买进来再卖回去至少亏一半上下（不是"只亏 1 材料"这种糊弄）', () => {
    for (const r of SHELF) {
      const n = r.n || 1;
      const buy = shopPrice(r, 1);
      const back = sellValue(r.id, n, 1, ITEMS);
      expect(back / buy).toBeLessThanOrEqual(0.55);
    }
  });

  it('货架价改了，原价表自动跟上（不会出现"货架涨价、回收价还是老价"）', () => {
    for (const r of SHELF) {
      expect(ITEM_BASE[r.id] * (r.n || 1)).toBeCloseTo(r.cost, 6);
    }
  });

  it('单件回收价至少 1 材料（不会出现白送）且低于单价', () => {
    for (const r of SHELF) {
      const unit = r.cost / (r.n || 1);
      const one = sellValue(r.id, 1, 1, ITEMS);
      expect(one).toBeGreaterThanOrEqual(1);
      /* 便宜的弹（9mm 每发 1.87）取整后会顶到 1 材料：仍然低于单价，但会比 45% 略高一点 */
      expect(one, r.id).toBeLessThan(unit);
    }
  });

  it('卖 0 件 = 0 材料（批量里空物品不能被算成 1）', () => {
    expect(sellValue('cloth', 0, 1, ITEMS)).toBe(0);
    expect(sellValue('cloth', -3, 1, ITEMS)).toBe(0);
  });

  it('营地那份回收价也是同一个 45%（两处不许各写一个数）', () => {
    const npcSrc = readFileSync('src/v4/npc.ts', 'utf8');
    expect(npcSrc).toMatch(/SELL_RATE/);
    expect(npcSrc).not.toMatch(/\*\s*0\.45/);
    expect(npcSrc).toMatch(/import \{[^}]*SELL_RATE[^}]*\} from '\.\/shop-core'/);
  });
});

describe('M44 什么能卖：除了剧情 / 独一份 / 身上穿的', () => {
  it('剧情道具一律不收（门禁卡 / 实验数据 / 解药 / 信号枪）', () => {
    for (const id of NO_SELL) {
      expect(ITEMS[id], id + ' 不在物品表里').toBeTruthy();
      expect(canSell(id, ITEMS)).toBe(false);
      expect(sellPlan(id, 'max', { have: 3, items: ITEMS }).times).toBe(0);
    }
    expect(sellBlockReason('keycard', ITEMS)).toMatch(/命根子/);
  });

  it('t=key 的整类都不收（以后新加的剧情道具自动进不来）', () => {
    const keys = IDS.filter(id => ITEMS[id].t === 'key');
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const id of keys) expect(canSell(id, ITEMS), id).toBe(false);
  });

  it('独一份的东西（同伴给的）不收 —— 卖了就再也拿不回来', () => {
    const uniques = IDS.filter(id => ITEMS[id].unique);
    expect(uniques.length).toBeGreaterThanOrEqual(3);
    for (const id of uniques) {
      expect(canSell(id, ITEMS), id).toBe(false);
      expect(sellBlockReason(id, ITEMS)).toMatch(/拿不回来|没了/);
    }
  });

  it('身上穿 / 手里拿的不收（先卸下来才算）', () => {
    const equipped = ['pistol', 'kevlar'];
    expect(canSell('pistol', ITEMS, equipped)).toBe(false);
    expect(sellBlockReason('kevlar', ITEMS, equipped)).toMatch(/卸下来/);
    expect(sellPlan('pistol', 'max', { have: 2, items: ITEMS, equipped }).times).toBe(0);
    expect(canSell('pistol', ITEMS, [])).toBe(true);       // 没穿在身上就能卖
  });

  it('掉落 / 采集 / 制作出来的东西**都能卖**（"多余物品"才成立）', () => {
    const loot = ['cloth', 'metal', 'wood', 'bandage', 'jerky', 'cola', 'molotov', 'axe', 'mushroom', 'fish_cooked', 'o2', 'bait'];
    for (const id of loot) {
      expect(ITEMS[id], id).toBeTruthy();
      expect(canSell(id, ITEMS), id).toBe(true);
      expect(sellValue(id, 1, 1, ITEMS), id).toBeGreaterThanOrEqual(1);
    }
  });

  it('物品表里除了剧情/独一份，**每一件**都有价（新物品忘了进表也按类型兜底）', () => {
    const shelfIds = new Set(SHELF.map(r => r.id));
    for (const id of IDS) {
      if (id === 'ammo') continue;                          // 伪 id：不在背包里
      const base = baseValueOf(id, ITEMS);
      expect(base, id + ' 没有基准价').toBeGreaterThan(0);
      if (!canSell(id, ITEMS)) continue;
      expect(sellValue(id, 1, 1, ITEMS), id + ' 卖不出材料').toBeGreaterThanOrEqual(1);
      /* 货架价是按"整叠标价 ÷ 份数"算的，9mm 每发 1.87 属于正常；其余（手写价/兜底价）不许低于 2 */
      if (!shelfIds.has(id)) expect(base, id + ' 基准价太低（会和 45% 撞成 0）').toBeGreaterThanOrEqual(2);
    }
  });

  it('基准价表里的 id 都是真物品（防写错 id 变成永远不会命中的死价）', () => {
    for (const id of Object.keys(ITEM_BASE)) expect(ITEMS[id], id).toBeTruthy();
  });

  it('伪 id / 不在表里的 id 一律不成交', () => {
    expect(canSell('ammo', ITEMS)).toBe(false);
    expect(canSell('nope_not_here', ITEMS)).toBe(false);
    expect(sellPlan('nope_not_here', 1, { have: 5, items: ITEMS }).times).toBe(0);
    expect(sellBlockReason('nope_not_here', ITEMS)).toMatch(/不在物品表里/);
  });
});

describe('M44 卖几件：sellPlan 把"想卖"和"能卖"对清楚', () => {
  const ctx = { have: 4, rate: 1, items: ITEMS };

  it('要 1 件就 1 件，钱按件算', () => {
    const p = sellPlan('cloth', 1, ctx);
    expect(p.times).toBe(1);
    expect(p.total).toBe(sellValue('cloth', 1, 1, ITEMS));
    expect(p.each).toBe(p.total);
    expect(p.reason).toBe('');
  });

  it("要 'max' 就全卖，单价与总价分得开（整批只取一次整）", () => {
    const p = sellPlan('a9_fmj', 'max', { have: 15, rate: 1, items: ITEMS });
    expect(p.times).toBe(15);
    expect(p.each).toBe(sellValue('a9_fmj', 1, 1, ITEMS));
    expect(p.total).toBe(sellValue('a9_fmj', 15, 1, ITEMS));
    expect(p.total).toBeGreaterThanOrEqual(p.each);        // 整叠卖的零头不会更多
  });

  it('要得比身上多 → 按身上有的卖，并说清为什么', () => {
    const p = sellPlan('cloth', 9, ctx);
    expect(p.times).toBe(4);
    expect(p.max).toBe(4);
    expect(p.reason).toMatch(/只有 4 件/);
  });

  it('没有这件东西 → 0 件 + 一句人话', () => {
    const p = sellPlan('cloth', 1, { have: 0, items: ITEMS });
    expect(p.times).toBe(0);
    expect(p.reason).toMatch(/没有这件东西/);
  });

  it('非法数量（NaN / 负数 / 小数）不会成交出负数或半件', () => {
    expect(sellPlan('cloth', NaN, ctx).times).toBe(0);
    expect(sellPlan('cloth', -5, ctx).times).toBe(0);
    expect(sellPlan('cloth', 2.7, ctx).times).toBe(2);
  });

  it('汇率涨了回收价跟着涨，但永远是买价的 45%', () => {
    const lo = sellValue('medkit', 1, 1, ITEMS);
    const hi = sellValue('medkit', 1, 1.4, ITEMS);
    expect(hi).toBeGreaterThan(lo);
    expect(sellValue('medkit', 2, 1.4, ITEMS)).toBeLessThan(shopPrice({ id: 'medkit', cost: 34 }, 1.4) * 2);
  });
});

describe('M44 批量出售：只算账，成交靠 UI 的二次确认', () => {
  const inv = { cloth: 6, metal: 2, bandage: 3, keycard: 1, pistol: 2, hk_m14: 1, jerky: 0 };

  it('合计 = 每件的钱加起来，件数 = 真的会卖掉的件数', () => {
    const ids = ['cloth', 'metal', 'bandage'];
    const plan = sellBatchPlan(ids, inv, { rate: 1, items: ITEMS });
    expect(plan.ids).toEqual(ids);
    expect(plan.items).toBe(6 + 2 + 3);
    expect(plan.total).toBe(ids.reduce((a, id) => a + sellValue(id, inv[id], 1, ITEMS), 0));
  });

  it('剧情 / 独一份 / 数量为 0 的都不会混进批量里', () => {
    const plan = sellBatchPlan(['cloth', 'keycard', 'hk_m14', 'jerky'], inv, { rate: 1, items: ITEMS });
    expect(plan.ids).toEqual(['cloth']);
    expect(plan.items).toBe(6);
  });

  it('身上穿的那件也不会被批量卖掉', () => {
    const plan = sellBatchPlan(['pistol', 'cloth'], inv, { rate: 1, items: ITEMS, equipped: ['pistol'] });
    expect(plan.ids).toEqual(['cloth']);
  });

  it('空背包 / 空列表 = 0 种 0 件 0 材料（UI 靠这个把按钮藏起来）', () => {
    expect(sellBatchPlan([], inv, { items: ITEMS })).toEqual({ ids: [], items: 0, total: 0 });
    expect(sellBatchPlan(['keycard'], inv, { items: ITEMS }).items).toBe(0);
  });

  it('整批卖的钱一定少于整批买回来（批量也不能变成套利）', () => {
    const ids = SHELF.map(r => r.id);
    const full: Record<string, number> = {};
    SHELF.forEach(r => { full[r.id] = r.n || 1; });
    const back = sellBatchPlan(ids, full, { rate: 1, items: ITEMS }).total;
    const buy = SHELF.reduce((a, r) => a + shopPrice(r, 1), 0);
    expect(back).toBeLessThan(buy);
  });
});

describe('M44 接线：货架与商人都没被这次改动弄坏', () => {
  const src = readFileSync('src/legacy/game.ts', 'utf8');

  it('内联 onclick 用到的名字都挂到了 window（少一个就是整屏 ReferenceError）', () => {
    for (const name of ['setMerchantTab', 'sellMerchant', 'sellMerchantCat', 'sellMerchantCatGo']) {
      expect(src, name + ' 没进 window 导出').toMatch(new RegExp('[,{\\s]' + name + '[,}]'));
    }
  });

  it('导出/引用的 M44 名字**全都真的 import 了**（@ts-nocheck 不查未定义标识符，这条只能靠测试拦）', () => {
    /* 踩过一次：window 导出里写了 ITEM_BASE，import 里漏了它 → 构建后整页
       `ReferenceError: ITEM_BASE is not defined`，白屏。tsc 因为 @ts-nocheck 一声不吭。 */
    const importBlock = /import \{([\s\S]*?)\} from '\.\.\/v4\/shop-core'/.exec(src);
    expect(importBlock, 'shop-core 的 import 语句不见了').toBeTruthy();
    const imported = new Set((importBlock![1].match(/[A-Za-z_][A-Za-z0-9_]*/g) || []));
    for (const name of ['MERCHANT_GOODS', 'badShopRows', 'shopPrice', 'buyPlan', 'sellPlan', 'sellValue', 'sellBatchPlan', 'sellBlockReason', 'canSell', 'ITEM_BASE', 'SELL_RATE']) {
      expect(imported.has(name), name + ' 在 import 里缺失（构建后会 ReferenceError）').toBe(true);
    }
  });

  it('买卖两个页签都在同一个商人弹窗里，且成交前都过纯逻辑校验', () => {
    expect(src).toMatch(/merchantTab === 'sell'/);
    expect(src).toMatch(/sellPlan\(/);                     // 卖：校验走 sellPlan
    expect(src).toMatch(/buyPlan\(/);                      // 买：M39 的校验还在
    expect(src).toMatch(/badShopRows\(\[m\], ITEMS\)/);    // M32b 的坏货架兜底还在
  });

  it('批量出售必须二次确认（先弹确认框，成交按钮在确认框里）', () => {
    expect(src).toMatch(/function sellMerchantCat\(\)[\s\S]{0,900}?确认全卖/);
    expect(src).toMatch(/function sellMerchantCatGo\(\)/);
  });

  it('货架本身没有坏行（M32b 的兜底校验仍然全绿）', () => {
    const items = Object.fromEntries(IDS.map(id => [id, { t: ITEMS[id]?.t || 'x' }]));
    expect(badShopRows(SHELF, items)).toEqual([]);
  });
});
