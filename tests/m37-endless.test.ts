/* M37：通关 → 无尽模式那一段的回归测试。
   为什么要有这组：玩家实测报过「通关好结局之后，到了无尽模式你会直接死，然后地图变成了旧版」——
   根因是 rescueEnding()/gameOver() 把 S.over 置 true 之后，enterEndless() 没把它清掉，
   而 v4 世界面板/区域移动/夜间结算全都以 S.over 为总闸（over=true 时整块退化成旧版探索页）。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resumeFromOver, endDayLabel, endGoalChip, overHint, ENDLESS_REVIVE_RATE } from '../src/v4/endless-core'

const S = (o: Partial<{ over: boolean; hp: number; hpMax: number; ap: number; apMax: number }> = {}) =>
  ({ over: false, hp: 100, hpMax: 100, ap: 6, apMax: 6, ...o })

describe('M37 · resumeFromOver：进无尽模式必须清掉"本局已结束"总闸', () => {
  it('好结局（rescueEnding 置 over=true、血还在）→ 直接回到可玩状态，不动血', () => {
    const s = S({ over: true, hp: 88 })
    const r = resumeFromOver(s)
    expect(r.revived).toBe(false)
    expect(s.over).toBe(false)          // ← 这条就是那个 bug：不清 over，世界面板就一直不渲染
    expect(s.hp).toBe(88)
  })

  it('从死亡界面点进无尽（hp=0）→ 救回三成血，over 清掉', () => {
    const s = S({ over: true, hp: 0, hpMax: 120 })
    const r = resumeFromOver(s)
    expect(r.revived).toBe(true)
    expect(s.hp).toBe(Math.round(120 * ENDLESS_REVIVE_RATE))
    expect(s.hp).toBeGreaterThan(0)
    expect(s.over).toBe(false)
  })

  it('血上限很低也不会救成 0 血（Math.max(1, …)）', () => {
    const s = S({ over: true, hp: 0, hpMax: 2 })
    resumeFromOver(s)
    expect(s.hp).toBe(1)
  })

  it('行动力为 0 时补满（否则进无尽第一件事又是"行动力用完了"）', () => {
    const s = S({ over: true, hp: 50, ap: 0, apMax: 7 })
    resumeFromOver(s)
    expect(s.ap).toBe(7)
  })

  it('行动力还有剩就不动它（不能白送 AP）', () => {
    const s = S({ over: true, hp: 50, ap: 3, apMax: 7 })
    resumeFromOver(s)
    expect(s.ap).toBe(3)
  })

  it('NaN / undefined 血值也按死亡处理（坏档别把玩家卡在 over 里）', () => {
    const s = S({ over: true, hp: NaN as unknown as number })
    expect(resumeFromOver(s).revived).toBe(true)
    expect(s.hp).toBeGreaterThan(0)
  })
})

describe('M37 · 无尽模式的天数与目标牌', () => {
  it('普通局顶栏是 "天数 / 目标"', () => {
    expect(endDayLabel(12, false, 100)).toBe('12 / 100')
  })
  it('无尽局不再显示 "101 / 100"（看着像坏档）', () => {
    const t = endDayLabel(101, true, 100)
    expect(t).toBe('第 101 天 · 无尽')
    expect(t).not.toContain('/')
  })
  it('日历目标牌：普通局说"活到第 100 天"，无尽局说无尽', () => {
    expect(endGoalChip(false, 100)).toContain('活到第 100 天')
    expect(endGoalChip(true, 100)).toContain('无尽')
  })
})

describe('M37 · over 状态下的"下一步"提示', () => {
  it('通关但还活着 → 指向无尽模式（老文案会说"你倒下了"，玩家以为档坏了）', () => {
    const h = overHint({ won: true, endless: false, hp: 88 })
    expect(h.txt).toContain('无尽模式')
    expect(h.act).toBe('enterEndless()')
    expect(h.txt).not.toContain('倒下')
  })
  it('真死亡（血 0）→ 老实说倒下了，给读档按钮', () => {
    const h = overHint({ won: true, endless: false, hp: 0 })
    expect(h.txt).toContain('倒下')
    expect(h.act).toBe('loadGame()')
  })
  it('没通关就死 → 同样是死亡文案', () => {
    expect(overHint({ won: false, endless: false, hp: 0 }).act).toBe('loadGame()')
  })
})

describe('M37 · 接线（legacy 只 import，不重复实现）', () => {
  const legacy = readFileSync('src/legacy/game.ts', 'utf8')
  it('enterEndless() 通过 resumeFromOver 清 over', () => {
    const body = legacy.slice(legacy.indexOf('function enterEndless()'))
    const fn = body.slice(0, body.indexOf('\n}'))
    expect(fn).toContain('resumeFromOver(S)')
  })
  it('rescueEnding() 仍然把 over 置 true（本局确实收尾了，靠 enterEndless 才能继续）', () => {
    const body = legacy.slice(legacy.indexOf('function rescueEnding()'))
    expect(body.slice(0, body.indexOf('\n}'))).toContain('S.over = true')
  })
  it('顶栏/日历目标牌都用 endless-core 的公式', () => {
    expect(legacy).toContain('endDayLabel(S.day, !!S.flags.endless, GOAL_DAY)')
    expect(legacy).toContain('endGoalChip(')
    expect(legacy).toContain("overHint({ won: !!S.flags.won, endless: !!S.flags.endless, hp: S.hp })")
  })
})
