/* M38：QoL 第一批（背包筛选/分批丢弃·存入 / 探索补给快捷键 / 战斗重复上次）的回归测试。
   为什么要有这组：这几处的规则全是"看着简单、改一次错一次"——
   分批丢弃的数量夹取、储物箱"能塞多少塞多少"、快捷键槽位在缺货时不许整体错位、重复上次要自动换目标。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BAG_FILTERS, filterTabs, bagMatch, filterInv, filterCounts, dropCount, depositCount,
  quickSlots, quickPick, repeatTarget, repeatLabel, QUICK_CHAIN,
} from '../src/v4/qol-core'

/* 迷你物品表：类型齐全（含 ammo 与"未知类型"坏档物品） */
const ITEMS: Record<string, { n: string; t?: string }> = {
  can:      { n: '罐头',     t: 'food' },
  water:    { n: '净水',     t: 'drink' },
  bandage:  { n: '绷带',     t: 'med' },
  medkit:   { n: '急救包',   t: 'med' },
  anti:     { n: '抗生素',   t: 'med' },
  iodine:   { n: '碘片',     t: 'med' },
  radaway:  { n: '抗辐射药', t: 'med' },
  painkiller: { n: '止痛药', t: 'med' },
  tape:     { n: '胶带',     t: 'mat' },
  pistol:   { n: '手枪',     t: 'wpn' },
  vest:     { n: '防弹背心', t: 'gear' },
  molotov:  { n: '燃烧瓶',   t: 'thr' },
  keycard:  { n: '门禁卡',   t: 'key' },
  a9_fmj:   { n: '9mm FMJ',  t: 'ammo' },
  mystery:  { n: '???',      t: undefined },   // 旧档/坏档里混进来的未知类型
}

describe('M38 · 背包筛选', () => {
  it('筛选条只显示"真的有东西"的类，all 永远在第一位', () => {
    const tabs = filterTabs(['can', 'tape', 'a9_fmj'], ITEMS)
    expect(tabs[0].id).toBe('all')
    expect(tabs[0].n).toBe(3)
    const ids = tabs.map(t => t.id)
    expect(ids).toContain('food')
    expect(ids).toContain('mat')
    expect(ids).toContain('ammo')
    expect(ids).not.toContain('wpn')      // 没武器就不显示武器类
    expect(ids).not.toContain('key')
  })

  it('分类计数（含弹药这种独立 t；同 id 只算一种）', () => {
    const c = filterCounts(['can', 'water', 'bandage', 'medkit', 'a9_fmj', 'tape', 'keycard'], ITEMS)
    expect(c.all).toBe(7)
    expect(c.food).toBe(1)
    expect(c.drink).toBe(1)
    expect(c.med).toBe(2)
    expect(c.ammo).toBe(1)
    expect(c.key).toBe(1)
    expect(c.thr).toBe(0)
  })

  it('筛选结果正确，且未知类型的物品只在「全部」里露面（不能藏起来）', () => {
    const ids = ['can', 'tape', 'mystery']
    expect(filterInv(ids, ITEMS, 'food')).toEqual(['can'])
    expect(filterInv(ids, ITEMS, 'all')).toEqual(['can', 'tape', 'mystery'])
    expect(filterInv(ids, ITEMS, 'med')).toEqual([])
  })

  it('未知类型的物品不会被算进任何具体类', () => {
    const c = filterCounts(['mystery', 'can'], ITEMS)
    expect(c.food).toBe(1)
    expect(c.med + c.mat + c.wpn + c.gear + c.thr + c.key + c.ammo + c.drink).toBe(0)
  })

  it('筛选条定义覆盖了全部物品类型（新增类型忘了加筛选 = 这类东西点不到）', () => {
    const known = BAG_FILTERS.map(f => f.id).filter(x => x !== 'all').sort()
    expect(known).toEqual(['ammo', 'drink', 'food', 'gear', 'key', 'mat', 'med', 'thr', 'wpn'])
    expect(bagMatch({ t: 'ammo' }, 'ammo')).toBe(true)
    expect(bagMatch(undefined, 'all')).toBe(true)
    expect(bagMatch(undefined, 'med')).toBe(false)
  })
})

describe('M38 · 丢几个 / 存几个', () => {
  it('丢 1 件：只减 1，不清空整叠', () => {
    expect(dropCount(8, 1)).toBe(1)
  })
  it('全丢：等于当前数量', () => {
    expect(dropCount(8, 'all')).toBe(8)
  })
  it('要的比有的多 / 非法输入一律夹回合法范围（不许丢出负数或丢超）', () => {
    expect(dropCount(3, 99)).toBe(3)
    expect(dropCount(3, -5)).toBe(0)
    expect(dropCount(3, NaN as unknown as number)).toBe(0)
    expect(dropCount(3, 2.9)).toBe(2)
    expect(dropCount(0, 'all')).toBe(0)
    expect(dropCount(NaN as unknown as number, 'all')).toBe(0)
  })

  it('储物箱：能塞多少塞多少（剩下一部分留在背包），而不是整笔拒绝', () => {
    expect(depositCount(10, 20, 24)).toEqual({ n: 4, reason: '储物箱只剩 4 格：先存 4 件，其余的还在背包里。' })
  })
  it('储物箱：装得下就全存，没有提示', () => {
    expect(depositCount(3, 0, 24)).toEqual({ n: 3, reason: '' })
  })
  it('储物箱：满了 / 根本没建箱子时给一句人话，一件都不动', () => {
    expect(depositCount(5, 24, 24).n).toBe(0)
    expect(depositCount(5, 24, 24).reason).toContain('满了')
    expect(depositCount(5, 0, 0).n).toBe(0)
    expect(depositCount(5, 0, 0).reason).toContain('储物箱')
  })
})

describe('M38 · 探索补给快捷键（槽位含义固定）', () => {
  const inv = (o: Record<string, number>) => o

  it('只有绷带时只有 1 槽（槽位互不重叠，不会两个键干同一件事）', () => {
    const s = quickSlots(inv({ bandage: 2 }), ITEMS)
    expect(s.map(x => x.key)).toEqual(['1'])
    expect(s[0].id).toBe('bandage')
  })
  it('有绷带 + 急救包时，1=绷带（止血优先）；只有急救包时 1=急救包', () => {
    const s = quickSlots(inv({ bandage: 1, medkit: 3 }), ITEMS)
    expect(s.find(x => x.key === '1')!.id).toBe('bandage')
    expect(quickSlots(inv({ medkit: 3 }), ITEMS).find(x => x.key === '1')!.id).toBe('medkit')
    expect(quickSlots(inv({ medkit: 3 }), ITEMS).find(x => x.key === '1')!.n).toBe(3)
  })
  it('缺货不会让键位整体错位：没有净水时 2 槽消失，罐头仍然是 3', () => {
    const s = quickSlots(inv({ can: 5 }), ITEMS)
    expect(s.map(x => [x.key, x.id])).toEqual([['3', 'can']])
  })
  it('4 槽按"状态药"优先级：抗生素 > 碘片 > 抗辐射药 > 止痛药', () => {
    expect(quickSlots(inv({ painkiller: 1, radaway: 1, iodine: 1, anti: 1 }), ITEMS).find(x => x.key === '4')!.id).toBe('anti')
    expect(quickSlots(inv({ painkiller: 1, radaway: 1, iodine: 1 }), ITEMS).find(x => x.key === '4')!.id).toBe('iodine')
    expect(quickSlots(inv({ painkiller: 1, radaway: 1 }), ITEMS).find(x => x.key === '4')!.id).toBe('radaway')
    expect(quickSlots(inv({ painkiller: 2 }), ITEMS).find(x => x.key === '4')!.id).toBe('painkiller')
  })
  it('数量为 0 / iitems 里没有的 id 不算（旧档里的幽灵物品）', () => {
    expect(quickSlots(inv({ bandage: 0 }), ITEMS)).toEqual([])
    expect(quickSlots(inv({ ghost: 3 } as any), ITEMS)).toEqual([])
  })
  it('quickPick 与 quickSlots 对同一背包给同一个答案；没绑的键返回 null', () => {
    const bag = inv({ medkit: 1, can: 2 })
    for (const s of quickSlots(bag, ITEMS)) expect(quickPick(bag, ITEMS, s.key)).toBe(s.id)
    expect(quickPick(bag, ITEMS, '9')).toBe(null)
    expect(quickPick(bag, ITEMS, '2')).toBe(null)      // 没水
  })
  it('槽位键位固定是 1-4（教程/提示文案写的就是这几个键）', () => {
    expect(QUICK_CHAIN.map(s => s.key)).toEqual(['1', '2', '3', '4'])
  })
})

describe('M38 · 战斗「重复上次」', () => {
  const foes = (...hp: number[]) => hp.map(h => ({ hp: h }))

  it('上次那只还活着 → 继续打它', () => {
    expect(repeatTarget(2, foes(10, 10, 10))).toBe(2)
  })
  it('上次那只死了 → 自动改打第一只活的（不会打空气）', () => {
    expect(repeatTarget(1, foes(10, 0, 8))).toBe(0)
    expect(repeatTarget(0, foes(0, 7))).toBe(1)
  })
  it('全死了 → -1（调用方直接不行动）', () => {
    expect(repeatTarget(0, foes(0, 0))).toBe(-1)
  })
  it('坏目标索引（越界 / NaN / -1）也走"第一只活的"', () => {
    expect(repeatTarget(9, foes(5, 5))).toBe(0)
    expect(repeatTarget(NaN, foes(5, 5))).toBe(0)
    expect(repeatTarget(-1, foes(5, 5))).toBe(0)
  })
  it('按钮文案：有记录才显示，并带上快捷键', () => {
    expect(repeatLabel('m_shoot', '射击')).toBe('↻ 重复上次：射击（R）')
    expect(repeatLabel(null, '射击')).toBe(null)
    expect(repeatLabel('m_shoot', undefined)).toBe(null)
    expect(repeatLabel('m_shoot', '射击', 'X')).toContain('（X）')
  })
})

describe('M38 · 接线（legacy/battle-ui 只 import，不重复实现规则）', () => {
  const legacy = readFileSync('src/legacy/game.ts', 'utf8')
  const bat = readFileSync('src/v4/battle-ui.ts', 'utf8')
  it('丢弃按钮分成「丢1」与「全丢×N」，不再一点整叠没', () => {
    expect(legacy).toContain("dropItem(\\'' + id + '\\',1)")
    expect(legacy).toContain('全丢×')
  })
  it('背包页有筛选条与批量存入（走 qol-core 的 filterTabs/filterInv/depositAll）', () => {
    expect(legacy).toContain('filterTabs(allIds, ITEMS)')
    expect(legacy).toContain('filterInv(allIds, ITEMS, bagFilter)')
    expect(legacy).toContain('onclick="depositAll()"')
    expect(legacy).toContain('setBagFilter')
  })
  it('探索页挂了补给快捷条，键盘数字键走 quickPick', () => {
    expect(legacy).toContain('quickBarHtml()')
    expect(legacy).toContain('quickPick(S.inv, ITEMS, k)')
  })
  it('战斗里成功出招才记 lastAct，新战斗会清空，R 键可重复', () => {
    expect(bat).toContain('lastAct = { id, target: tgt }')
    expect(bat).toContain('lastAct = null;')
    expect(bat).toContain("if (k === 'r' || k === 'R')")
    expect(bat).toContain('repeatTarget(lastAct.target, b.foes)')
  })
})
